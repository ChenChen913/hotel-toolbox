<script setup lang="ts">
// 行程页 —— 源实现（小程序）pages/stay/stay.{ts,wxml,wxss}
// 头部 / 三段页签 / 准备清单 / 入住检查 / 退房检查 / 自定义添加 / 删除行程。
//
// 与源实现的差异（平台导致）：
//   1. 小程序 data + setData（所有改动一律「读 stay → 改 → saveStay → 整页重渲」）
//      → Vue 响应式：清单由 computed 派生，写操作走 mutate()（改 currentStay + persist）。
//   2. 清单由 prep + custom 合并排序后分组，无法用对象引用定位，沿用稳定键 ikey（'p3'/'c1'）。
//   3. confirm() → 自绘 AppModal（对应源 modal 组件）。
//   4. 「紧急 / 知识详解」跳知识库：小程序是 tabBar 页、switchTab 不能带参，锚点走 core/nav.ts；
//      Web 走 store 的 goKnowledgeModule(模块名, 'stay')。
//   5. 源实现 addCustom() 后没有 persist，小程序版统一走 mutate() 落盘（源项目疑漏，未改源）。
//   6. 小程序用 <swiper> 承载三段、并由 JS 量取高度撑起 swiper；Web 改为「页签 + 条件渲染」，
//      滑动手势用 touchstart/touchend 计算位移实现（见 onTouchEnd），无需量高（内容自适应）。

import { computed, nextTick, onMounted, onUnmounted, ref, type ComponentPublicInstance } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import AppModal from '../components/AppModal.vue';
import ClothingAdd from '../components/ClothingAdd.vue';
import ItemRow from '../components/ItemRow.vue';
import ProgressPill from '../components/ProgressPill.vue';
import { CHECKLISTS, CUSTOM_HINTS, RISK_META } from '../data';
import {
  CAT_ORDER_EXT, COSMETIC_TYPES, EXTRA_CHECKOUT_GROUPS, getStayExt, removeStayExt, setStayExt,
  sortItemsExt, splitByQty, type StayExt,
} from '../extra';
import {
  currentStay, fmtDate, goHome, goKnowledgeModule, persist, removeCurrentStay, stage, suggestedStage,
} from '../store';
import { TOAST_ZERO_TEXT, shouldToastZero } from '../toast';
import { showToast } from '../ui';
import type { PrepItem, Stage, Stay } from '../types';

/** 带稳定键的清单项：'p3' = prep[3]，'c1' = custom[1] */
interface ItemVM extends PrepItem {
  _k: string;
}
interface PrepGroupVM {
  cat: string;
  items: ItemVM[];
  /** 分组内已备齐 / 总数（折叠时也能看到进度，P1-3） */
  done: number;
  total: number;
  /** P1-3 折叠态：存在 UI 层 storage，不进 Stay 数据（避免破坏与源项目的数据一致性） */
  collapsed: boolean;
}
interface CheckItemVM {
  text: string;
  done: boolean;
}
interface CheckGroupVM {
  name: string;
  tone: string;
  /** 风险文字徽标（立即处理 / 建议检查 / 普通注意） */
  riskLabel: string;
  note: string;
  link: string;
  items: CheckItemVM[];
}
interface HintVM {
  icon: string;
  text: string;
}
/** 某个检查段的渲染数据（入住 / 退房共用一个结构，对应源 wxml 的 checkBody） */
interface CheckVM {
  groups: CheckGroupVM[];
  done: number;
  total: number;
  title: string;
}
/** P0-6 自定义确认弹窗状态（源 data.modal） */
interface ModalVM {
  show: boolean;
  title: string;
  content: string;
  confirmText: string;
  danger: boolean;
}

const RISK_TONE: Record<string, string> = { high: 'red', mid: 'orange', low: 'slate' };
const STAGE_LABEL: Record<Stage, string> = { prep: '准备', checkin: '入住', checkout: '退房' };

/**
 * 头部阶段提示。只有「真的按日期推断出来的」才能说「按日期定位」（02 §6 定死的口径），
 * 用户自己切过（页签 / 滑动）一律用中性文案。
 * computed 与 gotoStage 两处共用 —— 文案写两份迟早漂移。
 */
function stageHintOf(st: Stage, auto: boolean): string {
  return auto
    ? `按日期已为你定位到「${STAGE_LABEL[st]}」阶段`
    : `${STAGE_LABEL[st]}阶段 · 左右滑动或点上方页签切换`;
}

/** 三段阶段的合法值。用于校验传入的阶段，避免把任意字符串塞进 stage。 */
const STAGES: Stage[] = ['prep', 'checkin', 'checkout'];
function isStage(v: unknown): v is Stage {
  return typeof v === 'string' && (STAGES as string[]).includes(v);
}

/** ItemRow 回传的事件（源 KeyValEvent；value 的类型按用途各自收窄） */
interface KeyValEvent {
  idx: number;
  ikey: string;
  value: unknown;
}

/** 稳定键 → 实际对象引用 */
function locate(s: Stay | null, k: string): PrepItem | null {
  if (!s || !k) return null;
  const i = Number(k.slice(1));
  if (Number.isNaN(i)) return null;
  const arr = k[0] === 'p' ? s.prep : s.custom;
  return arr[i] || null;
}

/* —— P1-3 分组折叠状态 ——
   存在独立的 UI 层 storage key（htb_ui_*），**不塞进 Stay 数据**：
   否则会破坏与源 Web 项目的数据一致性（红线要求 core/{types,data,engine} 零差异）。

   v2 起**按行程隔离**：结构是 { [stayId]: { [分类]: 是否折叠 } }。
   为什么必须隔离：v1 是按分类名全局共享的，于是在 A 行程里折叠了「衣物」，
   B 行程打开时「衣物」也是折叠的 —— 用户看到的就是「有的展开有的折叠、还找不出规律」。
   隔离之后，**新行程没有任何记录 → 全部分组默认展开**。 */
const COLLAPSE_KEY = 'htb_ui_collapsed_v2';

type CollapseStore = Record<string, Record<string, boolean>>;

function loadCollapsed(stayId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as unknown;
    if (!all || typeof all !== 'object') return {};
    const m = (all as CollapseStore)[stayId];
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}

function saveCollapsed(stayId: string, m: Record<string, boolean>) {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    const all = raw ? (JSON.parse(raw) as unknown) : null;
    const store: CollapseStore = all && typeof all === 'object' ? (all as CollapseStore) : {};
    store[stayId] = m;
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(store));
  } catch {
    /* 折叠状态只是 UI 偏好，写失败不值得打扰用户 */
  }
}

/* —— M17 首进提速：各段内容高度缓存（源 htb_ui_paneh_v1）+ measureSwiper ——
   Web 端**整段删除**，原因：那套代码只为撑起小程序 <swiper> 的确定高度
   （swiper 必须有 px 高度、三段高度差很大，所以要量当前段实高并缓存首帧值）。
   本页面改成「页签 + 条件渲染」，内容高度由文档流自适应，既不需要量高，
   也就没有高度缓存可清 —— 删除行程时不必再 removePaneH。 */

/** 分组折叠状态（按行程隔离；切换后整份替换以触发 computed） */
const collapsed = ref<Record<string, boolean>>({});
/** 扩展层（住宿关系 / 天气 / 性别 / 退房押金勾选），独立 storage key，不进 Stay */
const ext = ref<StayExt | null>(null);
/** 页面缺失态：没有 currentStay（记录被删 / 存储被清空） */
const missing = computed(() => !currentStay.value);

/**
 * 当前所处阶段是不是「系统按日期自动定位」的结果。
 * true  → 头部提示用规格原文「按日期已为你定位到「X」阶段」（02 §6 定死了这句）
 * false → 用户自己切过来的，说「按日期定位」就是假话，换成中性提示
 *         （顺带把「左右滑动」这个新手势讲出来）
 */
const stageAuto = ref(true);

/**
 * 三段共用的常量（源 data.common 里除 assignOpts / zeroOpen / customName / customQty 之外的静态项）。
 * M17 首进提速：常量表直接作初始值，不再每次进页面提交一遍。
 */
const hints: HintVM[] = CUSTOM_HINTS;
/** R5-6：化妆品下拉的预设类型（数据在 core/extra.ts） */
const cosmeticTypes = COSMETIC_TYPES;

/** 展开 / 收起底部的「已设为不带」区域 */
const zeroOpen = ref(false);
/** 「还有一些东西」的自定义输入 */
const customName = ref('');
const customQty = ref(1);

/** P1-1 回到顶部按钮显隐（阈值见 core/gesture.ts 的 SCROLL_TOP_TRIGGER） */
const showGoTop = ref(false);
/** 滚动多少像素才显示「回到顶部」（口径同 core/gesture.ts：120） */
const SCROLL_TOP_TRIGGER = 120;
/** 左右滑动切段的位移阈值（px）：与小程序 swiper 的跟手感对齐，太小会误触 */
const SWIPE_MIN = 60;

/** 准备段吸顶分类条：当前分类 / 计数 / 折叠态 / 距视口顶部 px */
const stickyCat = ref('');
const stickyDone = ref(0);
const stickyTotal = ref(0);
const stickyGi = ref(-1);
const stickyCollapsed = ref(false);
const stickyTop = ref(0);

/** P0-6 自定义确认弹窗状态 */
const modal = ref<ModalVM>({ show: false, title: '', content: '', confirmText: '确定', danger: false });

const segEl = ref<HTMLElement | null>(null);
const prepPaneEl = ref<HTMLElement | null>(null);
/** 两个类型下拉面板的对外能力（源 selectComponent + close()） */
interface AddPanelInstance {
  close(): void;
}
const clothingAddEl = ref<AddPanelInstance | null>(null);
const cosmeticAddEl = ref<AddPanelInstance | null>(null);

/**
 * v-for 里的 ref 会被 Vue 收成数组，故用函数 ref 逐个接住。
 * 同一时刻只有「衣物」「化妆品」各一个面板（源实现靠 isCur + id 选择器达到同样效果）。
 */
function bindClothingAdd(el: Element | ComponentPublicInstance | null) {
  clothingAddEl.value = (el as unknown as AddPanelInstance | null) || null;
}
function bindCosmeticAdd(el: Element | ComponentPublicInstance | null) {
  cosmeticAddEl.value = (el as unknown as AddPanelInstance | null) || null;
}

/** 准备段的渲染数据：prep + custom 合并排序 → 按 qty 拆「要带的 / 不带」→ 分组 */
const allItems = computed<ItemVM[]>(() => {
  const s = currentStay.value;
  if (!s) return [];
  // 防御：导入/旧数据可能缺 prep / custom，宁可显示空清单也不让整页崩成白屏
  const prepList = Array.isArray(s.prep) ? s.prep : [];
  const customList = Array.isArray(s.custom) ? s.custom : [];
  return sortItemsExt([
    ...prepList.map((it, i) => ({ ...it, _k: 'p' + i })),
    ...customList.map((it, i) => ({ ...it, _k: 'c' + i })),
  ]) as ItemVM[];
});

// qty === 0 = 「不带」：不再占着准备清单的位置，也不进「已备齐」的分子分母
// （这一项勾选框是禁用的，留在分母里会让进度永远到不了 100%）。
// 数据层不动 —— 项仍留在 s.prep / s.custom 里，只是不渲染，
// 底部「已设为不带」区域可随时恢复，避免「设为 0 就再也找不回来」。
const split = computed(() => splitByQty(allItems.value));
const activeItems = computed(() => split.value.active);
const zeroItems = computed(() => split.value.zero);

const groups = computed<PrepGroupVM[]>(() => {
  const s = currentStay.value;
  if (!s) return [];
  const items = activeItems.value;
  const e = ext.value;
  // R5-6 / R6 修复：女性追加「化妆品」分组（有预置物品时组自然出现；全被设为
  // 不带 / 删掉后这个兜底保证添加入口仍在），**加进 cats 后统一按 CAT_ORDER_EXT
  // 排序** —— 之前是 push 在末尾，导致化妆品组跑到清单最后而不是衣物后面（老板点名）。
  // M18 查重：女性行程预置香水/口红/粉底后 items 已含「化妆品」，无条件 push
  // 会出现两个一模一样的「化妆品」组（老板真机抓到）—— push 前先查重。
  // 男性 / 性别未知（老数据）不出现这个入口 —— 老行程的清单一个都不许变（H49）。
  const cats = [...new Set(items.map(i => i.cat))];
  if (e && e.gender === 'female' && !cats.includes('化妆品')) cats.push('化妆品');
  cats.sort((a, b) => CAT_ORDER_EXT.indexOf(a) - CAT_ORDER_EXT.indexOf(b));
  // 折叠状态按行程隔离：新行程查不到记录 → 全部分组默认展开
  const collapsedMap = collapsed.value;
  return cats.map(cat => {
    const gi = items.filter(i => i.cat === cat);
    return {
      cat,
      items: gi,
      done: gi.filter(i => i.done).length,
      total: gi.length,
      collapsed: !!collapsedMap[cat],
    };
  });
});

const prepDone = computed(() => activeItems.value.filter(i => i.done).length);
const prepTotal = computed(() => activeItems.value.length);

/**
 * 某一检查段的渲染数据。
 * 源实现三段同时渲染（当前段 + 两侧预览），这里按段算好喂给 computed / 模板。
 */
function checkOf(st: 'checkin' | 'checkout'): CheckVM {
  const s = currentStay.value;
  const cl = CHECKLISTS[st];
  const title = st === 'checkin' ? '入住检查' : '退房清点';
  if (!s) return { groups: [], done: 0, total: 0, title };
  // 防御：导入/旧数据可能缺某一组甚至整个矩阵；不能因为一行脏数据让整页白屏
  const matrix = Array.isArray(s[st]) ? s[st] : [];
  const baseGroups = cl.groups.map((g, gi) => ({
    name: g.name,
    tone: RISK_TONE[g.risk] || 'slate',
    riskLabel: RISK_META[g.risk].label,
    note: g.note || '',
    link: g.link || '',
    items: g.items.map((t, ii) => ({
      text: t,
      done: !!(matrix[gi] && matrix[gi][ii]),
    })),
  }));
  // 退房追加「押金与账单」扩展组（老板反馈：退房要检查押金）；
  // 状态存 StayExt.checkoutExtra，不进红线 Stay.checkout。
  const extraGroups = st === 'checkout' ? EXTRA_CHECKOUT_GROUPS : [];
  const e = ext.value;
  const extraState = e && Array.isArray(e.checkoutExtra) ? e.checkoutExtra : [];
  let extraOffset = 0;
  const extraVM = extraGroups.map(g => {
    const items = g.items.map((text, ii) => ({
      text,
      done: !!extraState[extraOffset + ii],
    }));
    extraOffset += g.items.length;
    return {
      name: g.name,
      tone: RISK_TONE[g.risk] || 'slate',
      riskLabel: RISK_META[g.risk].label,
      note: g.note || '',
      link: g.link || '',
      items,
    };
  });
  const baseTotal = cl.groups.reduce((n, g) => n + g.items.length, 0);
  const extraTotal = extraGroups.reduce((n, g) => n + g.items.length, 0);
  const baseDone = matrix.reduce(
    (n, g) => n + (Array.isArray(g) ? g.filter(Boolean).length : 0),
    0,
  );
  const extraDone = extraState.filter(Boolean).length;
  return {
    groups: [...baseGroups, ...extraVM],
    total: baseTotal + extraTotal,
    done: baseDone + Math.min(extraDone, extraTotal),
    title,
  };
}

const checkMap = computed(() => ({
  checkin: checkOf('checkin'),
  checkout: checkOf('checkout'),
}));
/** 当前检查段（入住 / 退房共用一个模板，对应源 wxml 的 checkBody） */
const curCheck = computed<CheckVM>(() => (stage.value === 'checkout' ? checkMap.value.checkout : checkMap.value.checkin));

/** 使用人可选项：['全体', ...guests.label]，长度 > 1 才出现下拉（源实现 assignOptions） */
const assignOpts = computed<string[]>(() => {
  const s = currentStay.value;
  const opts = ['全体', ...((s && s.guests) || []).map(g => g.label)];
  return opts.length > 1 ? opts : [];
});

/** 头部：日期 + 晚数 + purpose / relation / 天气（关系与天气在扩展层，老数据可缺失） */
const dateLabel = computed(() => (currentStay.value ? fmtDate(currentStay.value.date) : ''));
const nights = computed(() => currentStay.value?.nights ?? 0);
const purpose = computed(() => currentStay.value?.conditions.purpose ?? '');
const relationLabel = computed(() => (ext.value ? ' · ' + ext.value.relation : ''));
const weatherLabel = computed(() => {
  const e = ext.value;
  const weatherParts: string[] = [];
  if (e && e.weather) weatherParts.push(e.weather);
  if (e && typeof e.temp === 'number') weatherParts.push(e.temp + '℃');
  return weatherParts.length ? ' · ' + weatherParts.join(' ') : '';
});
const stageHint = computed(() => stageHintOf(stage.value, stageAuto.value));

/** 所有写操作的统一入口：读 → 改 → 存 → （computed 自动重算，等价源的整页重渲） */
function mutate(fn: (s: Stay) => void) {
  const s = currentStay.value;
  if (!s) return;
  fn(s);
  persist();
  scheduleMeasure();
}

/**
 * 页面滚动（每帧触发的高频回调，只做布尔翻转判断，禁止构造大对象）：
 *   ① 关闭衣物 / 化妆品浮层（fixed 面板不跟手，滚动即关比错位更可控）
 *   ② 决定「回到顶部」按钮的显隐（P1-1）
 *   ③ 准备段吸顶分类条（只做缓存数组的数值比较，分类变化时才提交）
 */
function onPageScroll() {
  closeAddPanels();

  // 源为写死的 scrollTop > 600（要划一屏多才出现，用户反馈「太晚」），
  // 现统一走 core/gesture.ts 的阈值，改一处两个页面同时生效
  const show = Number.isFinite(window.scrollY) && window.scrollY > SCROLL_TOP_TRIGGER;
  if (show !== showGoTop.value) showGoTop.value = show;

  updateSticky(window.scrollY);
}

/** wx.pageScrollTo({ top: 0, duration: 300 }) → 平滑滚动 */
function goTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// —— 头部 ——
/** wx.navigateBack() 的等价物：行程页只从首页 / 首页卡片进入，返回即回首页 */
function goBack() {
  goHome();
}

function goEmergency() {
  goKnowledgeModule('紧急联络', 'stay');
}

// —— 三段页签 ——
/**
 * 切换三段阶段。页签点击与左右滑动共用这一个入口，避免两条路径各写一份逻辑。
 * 用户自己切过之后把 stageAuto 置 false —— 否则头部会一直声称「按日期定位」，
 * 而实际上人是自己划过来的。
 *
 * 源实现的「轻量路径」在这里天然成立：切段不产生任何数据变化，清单 VM 全部来自 computed，
 * 只提交阶段相关的小字段即可（没有 swiper 需要重量高）。
 */
function gotoStage(st: Stage) {
  if (!isStage(st) || st === stage.value) return;
  if (!currentStay.value) return;   // 只做存在性兜底（missing 态），不取数据
  stage.value = st;
  stageAuto.value = false;
  // 离开准备段时立即收起吸顶分类条；回到准备段后 measureGroups 会按滚动位置恢复
  stickyCat.value = '';
  stickyGi.value = -1;
  scheduleMeasure();
}

function onStage(st: Stage) {
  gotoStage(st);
}

// —— 左右滑动切换阶段（M16 滑动终案：源用原生 <swiper>）——
/**
 * 源实现用原生 swiper 承载手势（真机 touch 链路不稳）；Web 没有跨端手势问题，
 * 故退回「页签 + 条件渲染」，滑动用 touchstart/touchend 的位移判断补上，
 * 行为对齐 swiper：横移超过 60px 且横向位移大于纵向才算切段，左滑下一段、右滑上一段。
 * 切段仍然走 gotoStage —— 与点页签同一个入口，两条路径不会各自漂移。
 */
const touchStart = { x: 0, y: 0 };

function onTouchStart(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  touchStart.x = t.clientX;
  touchStart.y = t.clientY;
}

function onTouchEnd(e: TouchEvent) {
  const t = e.changedTouches[0];
  if (!t) return;
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  if (Math.abs(dx) <= SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return;
  const i = STAGES.indexOf(stage.value);
  const next = STAGES[dx < 0 ? i + 1 : i - 1];
  if (next) gotoStage(next);
}

/** 分类标题的几何缓存（页面坐标，避免滚动时反复查询） */
let groupTops: number[] = [];
let prepBottom = 0;
let stickyTopPx = 0;

/** 布局变化后重量一次（内容高度变了，缓存的分类坐标就过期了） */
function scheduleMeasure() {
  void nextTick(() => measureGroups());
}

/**
 * 量准备段每个分类标题的页面坐标，供 onPageScroll 判断当前分类。
 * 只查一次、缓存起来；分组折叠 / 数据变化 / 切段后由 scheduleMeasure 触发重查。
 * 源实现用 createSelectorQuery + scrollOffset；Web 用 getBoundingClientRect + scrollY（同步）。
 */
function measureGroups() {
  const pane = prepPaneEl.value;
  if (!pane) return;
  const heads = Array.from(pane.querySelectorAll<HTMLElement>('.grp-head'));
  const scrollTop = window.scrollY;
  const rect = pane.getBoundingClientRect();
  groupTops = heads.map(h => h.getBoundingClientRect().top + scrollTop);
  prepBottom = rect.top + scrollTop + rect.height;
  // 取 seg-sticky 的高度而不是 bottom：页面在顶部时 bottom 还包含上方头部高度，
  // 吸顶后真正需要的是「段页签自身高度」，也就是吸顶条的 top。
  const seg = segEl.value;
  stickyTopPx = seg ? Math.round(seg.getBoundingClientRect().height) : 0;
  if (stickyTopPx && stickyTopPx !== stickyTop.value) {
    stickyTop.value = stickyTopPx;
  }
  updateSticky(scrollTop);
}

/** 根据滚动位置切换准备段的吸顶分类条 */
function updateSticky(scrollTop: number) {
  if (stage.value !== 'prep' || !groupTops.length) {
    clearSticky();
    return;
  }
  const y = scrollTop + (stickyTopPx || 57) + 6;
  const bottom = prepBottom;
  if (y < groupTops[0] || (bottom > 0 && y > bottom - 16)) {
    clearSticky();
    return;
  }
  let gi = 0;
  for (let i = 0; i < groupTops.length; i++) {
    if (groupTops[i] <= y) gi = i;
  }
  const g = groups.value[gi];
  if (!g) {
    clearSticky();
    return;
  }
  if (gi === stickyGi.value && g.cat === stickyCat.value && g.collapsed === stickyCollapsed.value) return;
  stickyGi.value = gi;
  stickyCat.value = g.cat;
  stickyDone.value = g.done;
  stickyTotal.value = g.total;
  stickyCollapsed.value = g.collapsed;
}

function clearSticky() {
  if (!stickyCat.value && stickyGi.value < 0) return;
  stickyCat.value = '';
  stickyDone.value = 0;
  stickyTotal.value = 0;
  stickyGi.value = -1;
  stickyCollapsed.value = false;
}

/**
 * 衣物与化妆品两个下拉面板统一关闭（onPageScroll 滚动即关）。
 * 源实现用 selectComponent('#clothingAdd' / '#cosmeticAdd')；Web 用组件 ref（见 bind*Add）。
 */
function closeAddPanels() {
  if (clothingAddEl.value && typeof clothingAddEl.value.close === 'function') clothingAddEl.value.close();
  if (cosmeticAddEl.value && typeof cosmeticAddEl.value.close === 'function') cosmeticAddEl.value.close();
}

/** P1-3：折叠/展开某个分组。
    只翻转该分类的折叠位（不整份回传 groups）；状态持久化到 UI 层 storage。 */
function toggleGroup(gi: number) {
  const g = groups.value[gi];
  if (!g) return;
  const next = !g.collapsed;
  collapsed.value = { ...collapsed.value, [g.cat]: next };
  saveCollapsed(currentStay.value?.id || '', collapsed.value);
  scheduleMeasure();
}

// —— 准备清单 ——
function onItemToggle(e: KeyValEvent) {
  const k = String(e.ikey || '');
  const v = Boolean(e.value);
  mutate(s => {
    const it = locate(s, k);
    if (it) it.done = v;
  });
}

function onItemQty(e: KeyValEvent) {
  const k = String(e.ikey || '');
  const v = Number(e.value);
  if (Number.isNaN(v)) return;
  // R4-4：先读旧值 —— mutate 之后就分不清「本来就是 0」和「刚刚变成 0」了
  const prev = Number(locate(currentStay.value, k)?.qty);
  mutate(s => {
    const it = locate(s, k);
    if (it) it.qty = v;
  });
  // 数量减到 0 = 不带。这一行会立刻从清单里消失，得告诉用户它去哪了
  if (shouldToastZero(prev, v)) showToast(TOAST_ZERO_TEXT);
}

/** 展开 / 收起底部的「已设为不带」区域 */
function toggleZero() {
  zeroOpen.value = !zeroOpen.value;
}

/**
 * 把「不带」的项恢复为 1 件。
 * 恢复到 1 而不是原来的数量：原始数量没有单独存（存了就破坏与源项目的数据一致性），
 * 1 是最小可用值，恢复后再按需加减。
 */
function restoreZero(k: string) {
  if (!k) return;
  mutate(s => {
    const it = locate(s, k);
    if (it) it.qty = 1;
  });
}

/** 使用人绑定：写入 item.assign（源实现 ItemRow.onAssign） */
function onItemAssign(e: KeyValEvent) {
  const k = String(e.ikey || '');
  const v = String(e.value ?? '');
  if (!v) return;
  mutate(s => {
    const it = locate(s, k);
    if (it) it.assign = v;
  });
}

/**
 * R5-6：衣物 / 化妆品下拉的统一添加入口。落点分类由调用方传入
 * （源实现靠标签上的 data-cat 路由：一页两个面板，selectComponent 会取错）。
 * 新增到 custom（源实现同款字段）；同名不重复（custom 全局去重，衣物另查 prep 同分类同名）。
 */
function addTyped(name: string, cat: string) {
  const nm = String(name || '').trim();
  if (!nm) return;
  mutate(s => {
    const dup =
      s.prep.some(i => i.cat === cat && i.name === nm) ||
      s.custom.some(i => i.name === nm);
    if (dup) return;
    s.custom.push({
      name: nm,
      cat,
      unit: cat === '化妆品' ? '个' : '件',
      // M18：不再臆测用户「从家里带」—— 用户自己加的，就标「自定义」（与
      // 「还有一些东西」入口的物品同一口径），行内只显示事实标签。
      prep: '自定义',
      source: '自定义',
      users: '每人',
      qty: 1,
      done: false,
    });
  });
}

function onCustomName(e: Event) {
  customName.value = String((e.target as HTMLInputElement).value || '');
}

function onCustomQty(e: Event) {
  const n = Number((e.target as HTMLInputElement).value);
  customQty.value = Number.isNaN(n) || n < 1 ? 1 : n;
}

function addCustom() {
  const name = String(customName.value || '').trim();
  if (!name) return;
  const qty = Number(customQty.value) || 1;
  mutate(s => {
    s.custom.push({
      name,
      cat: '自定义',
      unit: '件',
      prep: '自定义',
      source: '自定义',
      users: '共用',
      qty,
      done: false,
    });
  });
  customName.value = '';
  customQty.value = 1;
}

// —— 入住 / 退房检查 ——
function onCheck(gi: number, ii: number) {
  if (Number.isNaN(gi) || Number.isNaN(ii)) return;
  const st = stage.value;
  if (st === 'prep') return;
  const s = currentStay.value;
  if (!s) return;

  // 退房扩展组（押金与账单）：状态存扩展层，不写红线 Stay.checkout
  const baseCount = CHECKLISTS.checkout.groups.length;
  if (st === 'checkout' && gi >= baseCount) {
    const egi = gi - baseCount;
    const group = EXTRA_CHECKOUT_GROUPS[egi];
    if (!group) return;
    const before = EXTRA_CHECKOUT_GROUPS
      .slice(0, egi)
      .reduce((n, g) => n + g.items.length, 0);
    const e: StayExt = ext.value || { relation: '家人' };
    const state = Array.isArray(e.checkoutExtra) ? [...e.checkoutExtra] : [];
    state[before + ii] = !state[before + ii];
    const nextExt: StayExt = { ...e, checkoutExtra: state };
    ext.value = nextExt;
    setStayExt(s.id, nextExt);
    return;
  }

  mutate(stay => {
    const row = stay[st][gi];
    if (!row) return;
    row[ii] = !row[ii];
  });
}

function goKnow(m: string) {
  if (!m) return;
  goKnowledgeModule(m, 'stay');
}

// —— 删除（P0-6：自绘弹窗，替代 wx.showModal）——
function delStay() {
  modal.value = {
    show: true,
    title: '删除这次入住',
    content: '删除这次入住的所有记录？',
    confirmText: '删除',
    danger: true,
  };
}

function onModalConfirm() {
  modal.value.show = false;
  const id = currentStay.value?.id || '';
  // 同步清掉扩展层里这个行程的关系记录，否则 storage 会随删除次数无限增长
  removeStayExt(id);
  // 源实现此处还 removePaneH（swiper 高度缓存）；Web 无 swiper、无高度缓存，见文件头说明
  removeCurrentStay();
}

function onModalCancel() {
  modal.value.show = false;
}

onMounted(() => {
  const s = currentStay.value;
  if (s) {
    collapsed.value = loadCollapsed(s.id);
    // 住宿关系 / 天气 / 性别 / 退房押金勾选都在扩展层（独立 storage key）
    ext.value = getStayExt(s.id);
    // 只有「真的按日期推断出来的」才算自动定位；来源页指定过（如向导保存后回准备段）就不算
    stageAuto.value = stage.value === suggestedStage(s);
  }
  window.addEventListener('scroll', onPageScroll, { passive: true });
  scheduleMeasure();
});

onUnmounted(() => {
  window.removeEventListener('scroll', onPageScroll);
});
</script>

<template>
  <!-- 三段（准备 / 入住 / 退房）：源用原生 <swiper> 承载，Web 改为页签 + 条件渲染，
       滑动由 touchstart/touchend 的位移判断补上（见 onTouchEnd）。
       结构：页签 sticky → 三段内容 → 危险区。 -->
  <div class="page">
    <div class="bg-glow"></div>

    <div v-if="missing" class="ph">
      <div class="ph-title">没有找到这次入住</div>
      <div class="ph-note">记录可能已被删除，或数据被清空了。</div>
      <div class="btn small" style="margin-top: 20px" @click="goBack()">回首页</div>
    </div>

    <template v-else>
      <!-- 头部工作台卡片 -->
      <div class="st-hero glass">
        <div class="st-bar">
          <div class="icon-btn" aria-label="返回" @click="goBack()">
            <AppIcon name="arrow-left" :size="30" tone="i" />
          </div>
          <div class="grow st-kicker">STAY WORKBENCH</div>
          <div class="emerg" @click="goEmergency()">
            <AppIcon name="siren" :size="24" tone="c" />紧急
          </div>
        </div>
        <div class="st-date num">{{ dateLabel }} · {{ nights }} 晚</div>
        <div class="st-meta">{{ purpose }}{{ relationLabel }}{{ weatherLabel }}</div>
        <div class="st-hint">
          <AppIcon name="compass" :size="20" tone="k" />
          <span>{{ stageHint }}</span>
        </div>
      </div>

      <!-- 三段页签：sticky；源在 swiper 外做吸顶，Web 用 position: sticky -->
      <div ref="segEl" class="seg-sticky">
        <div class="seg">
          <div class="seg-i" :class="{ on: stage === 'prep' }" @click="onStage('prep')">
            <span class="seg-label">准备</span>
            <span class="seg-count num">{{ prepDone }}/{{ prepTotal }}</span>
          </div>
          <div class="seg-i" :class="{ on: stage === 'checkin' }" @click="onStage('checkin')">
            <span class="seg-label">入住</span>
            <span class="seg-count num">{{ checkMap.checkin.done }}/{{ checkMap.checkin.total }}</span>
          </div>
          <div class="seg-i" :class="{ on: stage === 'checkout' }" @click="onStage('checkout')">
            <span class="seg-label">退房</span>
            <span class="seg-count num">{{ checkMap.checkout.done }}/{{ checkMap.checkout.total }}</span>
          </div>
        </div>
      </div>

      <!-- 准备段分类吸顶条：源因为「原生 swiper 会吃掉 position: sticky」，
           改用页面级 fixed 条 + 滚动位置计算当前分组，始终贴在段页签下方。
           Web 沿用同一套机制（同一批类名 / 同一份滚动计算），视觉不变。 -->
      <div
        v-if="stage === 'prep' && stickyCat"
        class="grp-sticky"
        :style="{ top: stickyTop + 'px' }"
        @click="toggleGroup(stickyGi)"
      >
        <div class="grp-titlewrap">
          <span class="grp-cat">{{ stickyCat }}</span>
          <span v-if="stickyTotal" class="grp-cnt num">{{ stickyDone }}/{{ stickyTotal }}</span>
        </div>
        <div class="grp-arrow" :class="{ rot: stickyCollapsed }">
          <AppIcon name="chevron-down" :size="28" tone="k" />
        </div>
      </div>

      <!-- 三段内容：源是 swiper 里三段常驻渲染，每段一个 pane-inner；
           条件渲染后只有当前段在 DOM 里（isCur 恒真，衣物/化妆品面板不必再判 isCur） -->
      <div class="stage-swiper" @touchstart="onTouchStart" @touchend="onTouchEnd">
        <!-- 准备段 -->
        <div v-if="stage === 'prep'" ref="prepPaneEl" class="pane-inner">
          <ProgressPill :done="prepDone" :total="prepTotal" label="已备齐" title="打包完成度" />

          <div v-for="(g, gi) in groups" :key="g.cat" class="grp">
            <div class="grp-head" @click="toggleGroup(gi)">
              <div class="grp-titlewrap">
                <span class="grp-cat">{{ g.cat }}</span>
                <span v-if="g.total" class="grp-cnt num">{{ g.done }}/{{ g.total }}</span>
              </div>
              <div class="grp-arrow" :class="{ rot: g.collapsed }">
                <AppIcon name="chevron-down" :size="28" tone="k" />
              </div>
            </div>
            <div v-if="!g.collapsed" class="glass card">
              <ItemRow
                v-for="it in g.items"
                :key="it._k"
                :item="it"
                :ikey="it._k"
                :opts="assignOpts"
                @toggle="onItemToggle"
                @qty="onItemQty"
                @assign="onItemAssign"
              />
              <ClothingAdd
                v-if="g.cat === '衣物'"
                :ref="bindClothingAdd"
                cat="衣物"
                trigger="选择衣物类型…"
                placeholder="输入衣物名称，如：防晒衣"
                @add="addTyped($event, '衣物')"
              />
              <ClothingAdd
                v-if="g.cat === '化妆品'"
                :ref="bindCosmeticAdd"
                cat="化妆品"
                :types="cosmeticTypes"
                trigger="选择化妆品类型…"
                placeholder="输入化妆品名称，如：面膜"
                @add="addTyped($event, '化妆品')"
              />
            </div>
          </div>

          <div v-if="zeroItems.length" class="zero-zone">
            <div class="zero-head" @click="toggleZero()">
              <span class="grow zero-title">已设为不带（{{ zeroItems.length }} 项）</span>
              <div class="grp-arrow" :class="{ rot: !zeroOpen }">
                <AppIcon name="chevron-down" :size="28" tone="k" />
              </div>
            </div>
            <div v-if="zeroOpen" class="glass card">
              <div v-for="z in zeroItems" :key="z._k" class="zrow">
                <span class="grow zname">{{ z.name }}</span>
                <div class="zrestore" @click="restoreZero(z._k)">恢复</div>
              </div>
            </div>
          </div>

          <div class="glass card think">
            <div class="think-title"><AppIcon name="lightbulb" :size="28" tone="p" />还有一些东西，只有你自己知道</div>
            <div v-for="h in hints" :key="h.text" class="hint-row">
              <AppIcon :name="h.icon" :size="28" tone="p" />
              <span class="muted">{{ h.text }}</span>
            </div>
            <div class="addrow">
              <input
                class="field grow"
                placeholder="添加我的必带物品"
                :value="customName"
                @input="onCustomName"
              />
              <input
                class="field qtyin num"
                type="number"
                placeholder="数量"
                :value="customQty"
                @input="onCustomQty"
              />
              <div class="btn small addbtn" @click="addCustom()">
                <AppIcon name="plus" :size="28" tone="c" />
              </div>
            </div>
          </div>
        </div>

        <!-- 入住 / 退房检查段（源 wxml 的 checkBody：两段共用一个模板） -->
        <div v-else class="pane-inner">
          <ProgressPill :done="curCheck.done" :total="curCheck.total" label="已完成" :title="curCheck.title" />

          <div v-for="(g, gi) in curCheck.groups" :key="g.name">
            <div class="check-head">
              <div class="dot" :class="g.tone"></div>
              <span class="grow check-name">{{ g.name }}</span>
              <span class="risk-pill" :class="g.tone">{{ g.riskLabel }}</span>
              <div v-if="g.link" class="glink" @click="goKnow(g.link)">
                知识详解<AppIcon name="chevron-right" :size="20" tone="k" />
              </div>
            </div>
            <div v-if="g.note" class="gnote">{{ g.note }}</div>
            <div class="glass card check-card">
              <div
                v-for="(ci, ii) in g.items"
                :key="ci.text"
                class="crow"
                :class="{ done: ci.done }"
                @click="onCheck(gi, ii)"
              >
                <span class="crow-check">✓</span>
                <div class="tick" :class="{ on: ci.done }"></div>
                <div class="grow name">{{ ci.text }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 危险区：三个 stage 共用，留在三段内容之外 -->
      <div class="danger-zone">
        <span class="tiny muted dg-note">删除后不可恢复（含清单勾选记录）</span>
        <div class="btn danger-btn" @click="delStay()">
          <AppIcon name="trash" :size="26" tone="r" />删除这次入住
        </div>
      </div>
    </template>

    <div v-if="showGoTop" class="gotop" aria-label="回到顶部" @click="goTop()">
      <AppIcon name="chevron-up" :size="30" tone="d" />
    </div>

    <AppModal
      :show="modal.show"
      :title="modal.title"
      :content="modal.content"
      cancel-text="取消"
      :confirm-text="modal.confirmText"
      :danger="modal.danger"
      @confirm="onModalConfirm"
      @cancel="onModalCancel"
    />
  </div>
</template>

<style scoped>
/* 行程页 —— Stitch 现代功能编辑风
   头部工作台卡 / 黑色分段页签 / 白卡分组 / 方形勾选 / 风险徽标。 */

.page {
  padding: 0 16px 32px;
}

/* —— 头部工作台 —— */
.st-hero {
  margin: 8px 0 4px;
  padding: 11px 12px 10px;
  border-radius: 12px;
}
.st-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: var(--surface-2);
}
/* hover-class="icon-btn-hover" → :active */
.icon-btn:active {
  background: var(--surface-3);
}
.st-kicker {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--ink-3);
}
.emerg {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 3px;
  height: 36px;
  padding: 0 9px;
  border-radius: 6px;
  background: var(--red);
  color: #ffffff;
  font-size: 11.5px;
  font-weight: 600;
}
/* hover-class="emerg-hover" → :active */
.emerg:active {
  opacity: 0.85;
}
.st-date {
  font-size: 20px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: -0.4px;
  color: var(--ink);
}
.st-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--ink-2);
}
.st-hint {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 7px;
  padding: 5px 7px;
  border-radius: 5px;
  background: var(--info-soft);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--ink-2);
}

/* —— 三段页签（吸顶；源在 swiper 外，Web 用 position: sticky）—— */
.seg-sticky {
  position: -webkit-sticky;
  position: sticky;
  top: 0;
  z-index: 800;
  padding: 5px 0;
  background: var(--bg);
}
.seg {
  display: flex;
  padding: 2.5px;
  border-radius: 9px;
  background: var(--surface-2);
}
.seg-i {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  flex: 1;
  height: 47px;
  border-radius: 7px;
  color: var(--ink-2);
  transition: background-color 0.2s ease, color 0.2s ease;
}
.seg-label {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
}
.seg-count {
  font-size: 9px;
  line-height: 1.2;
  color: var(--ink-3);
}
.seg-i.on {
  background: var(--primary);
  color: #ffffff;
  box-shadow: none;
}
.seg-i.on .seg-count {
  color: rgba(255, 255, 255, 0.66);
}

/* —— 准备段分类吸顶条（页面级 fixed，贴在段页签下方）——
   Web：整页是 480px 居中列（.page），fixed 条必须跟列同宽居中，
   否则宽屏下会拉满整条视口。这是本页与源 wxss 唯一的样式偏差，其余照搬。 */
.grp-sticky {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  width: min(480px, 100%);
  z-index: 790; /* < 段页签 800，> 内容 */
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 16px;
  box-sizing: border-box;
  background: var(--surface);
  border-bottom: 1px solid var(--glass-border);
  box-shadow: 0 4px 10px -10px rgba(15, 23, 42, 0.28);
}
.grp-sticky .grp-cat {
  font-size: 14px;
  font-weight: 650;
}
/* hover-class="grp-hover" → :active */
.grp-sticky:active {
  background: var(--surface-2);
}

/* —— 三段内容（源为 swiper；Web 内容自适应高度）—— */
.stage-swiper {
  margin: 0 -16px;
  width: calc(100% + 32px);
  /* 源为 swiper 的高度过渡；Web 没有确定高度，这条声明保留只为与源样式对齐 */
  transition: height 0.24s ease;
}
.pane-inner {
  width: 100%;
  padding: 0 16px;
  box-sizing: border-box;
}

/* —— 准备分组 —— */
.grp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  margin-top: 9px;
  padding: 0 2px;
}
/* hover-class="grp-hover" → :active */
.grp-head:active {
  background: var(--surface-2);
}
.grp-titlewrap {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}
.grp-cat {
  font-size: 14.5px;
  font-weight: 650;
  letter-spacing: -0.1px;
  color: var(--ink);
}
.grp-cnt {
  font-size: 10.5px;
  color: var(--ink-3);
}
.grp-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  transition: transform 0.18s ease;
}
.grp-arrow.rot {
  transform: rotate(-90deg);
}

/* —— 检查组头 —— */
.check-head {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 46px;
  margin-top: 9px;
  padding: 0 1px;
}
.check-name {
  font-size: 14.5px;
  font-weight: 650;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.risk-pill {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  height: 18px;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}
.risk-pill.red {
  background: var(--danger-soft);
  color: #b42318;
}
.risk-pill.orange {
  background: var(--warning-soft);
  color: var(--accent-deep);
}
.risk-pill.slate {
  background: var(--surface-2);
  color: var(--ink-2);
}
.glink {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 1px;
  min-height: 36px;
  padding: 0 2px 0 5px;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--ink-2);
}
.gnote {
  margin: 0 1px 6px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--ink-3);
}

/* —— 检查行 —— */
.check-card {
  padding: 2px 10px;
}
.crow {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 48px;
  padding: 9px 6px;
  margin: 0 -6px;
  border-radius: 7px;
  transition: background-color 0.18s ease;
}
.crow + .crow::after {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  top: 0;
  height: 1px;
  background: var(--hairline);
}
.crow .name {
  font-size: 14px;
  line-height: 1.55;
  color: var(--ink);
}
.crow.done {
  background: var(--success-soft);
}
.crow.done .name {
  color: var(--ink);
}
/* hover-class="hv" → :active（源全局 .hv 为 opacity: .7） */
.crow:active {
  opacity: 0.7;
}
.crow-check {
  position: absolute;
  right: 1px;
  top: -2px;
  font-size: 44px;
  line-height: 1;
  font-weight: 700;
  color: rgba(15, 159, 110, 0.14);
  pointer-events: none;
  z-index: 0;
  opacity: 0;
  transition: opacity 0.18s ease;
}
.crow.done .crow-check {
  opacity: 1;
}
.tick {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 2px solid var(--line);
  background: #ffffff;
}
.tick.on {
  border-color: var(--primary);
  background: var(--primary);
}
.tick.on::after {
  content: "✓";
  font-size: 12px;
  line-height: 1;
  color: #ffffff;
}

/* —— 自定义提示块 —— */
.think {
  margin-top: 12px;
  padding: 13px;
}
.think-title {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
  font-size: 14px;
  font-weight: 650;
  color: var(--ink);
}
.hint-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 0;
  font-size: 12px;
}
.addrow {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
}
.addrow .field {
  height: 38px;
  min-height: 38px;
  padding: 0 8px;
}
.qtyin {
  width: 55px;
  flex: 0 0 55px;
  text-align: center;
}
.addbtn {
  flex-shrink: 0;
  padding: 0 11px;
}
/* hover-class="hv" → :active */
.addbtn:active {
  opacity: 0.7;
}

/* —— 「已设为不带」区域（源 hover-class="hv"）—— */
.zero-head:active {
  opacity: 0.7;
}
.zrestore:active {
  opacity: 0.7;
}

/* —— 危险区 —— */
.danger-zone {
  margin-top: 20px;
  padding-top: 12px;
  border-top: 1px solid var(--hairline);
}
.dg-note {
  display: block;
  margin-bottom: 7px;
  text-align: center;
}
.danger-btn {
  background: var(--danger-soft);
  color: #b42318;
  border: 1px solid rgba(239, 68, 68, 0.22);
  box-shadow: none;
  font-weight: 600;
}
/* hover-class="hv" → :active */
.danger-btn:active {
  opacity: 0.7;
}

/* —— 回到顶部 —— */
.gotop {
  position: fixed;
  right: 16px;
  bottom: calc(24px + env(safe-area-inset-bottom));
  z-index: 950;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--surface);
  border: 1px solid var(--glass-border);
  box-shadow: 0 5px 13px -6px rgba(15, 23, 42, 0.3);
}
/* hover-class="hv" → :active */
.gotop:active {
  opacity: 0.7;
}
</style>
