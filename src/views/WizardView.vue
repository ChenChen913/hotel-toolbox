<script setup lang="ts">
// 创建向导 —— 源实现 src/components/WizardView.vue
// R5-3 起为 7 步：① 性别 → ② 日期晚数 → ③ 人数 → ④ 同行 → ⑤ 住宿情况 → ⑥ 偏好 → ⑦ 确认清单
//
// 与源实现的差异（仅平台导致的）：
//   1. Vue 的 reactive/computed 改为「draft 存 data + 每次改动后 syncDerived() 手动重算」
//      —— 小程序没有响应式，但语义完全一致：草稿改动不落盘，第 7 步保存时才 newStay + saveStay。
//   2. 预览清单用普通数组（非 computed），与源实现刻意的选择一致：
//      若用计算属性，用户在第 7 步添加的自定义物品会在重算时丢失（源注释明确要求）。
//   3. 提示条目取自 data.ts 的 CUSTOM_HINTS（6 条）。
//
// Web 移植差异（仅平台导致的，逻辑一字未动）：
//   · 小程序的 draft + syncDerived 在 Web 端由 ref + computed 承载（第 1 条的反向映射）；
//     relation 的「由同行人员自动判定后写回」仍用 watch 复刻，写回时机与源一致。
//   · wx.pageScrollTo → store 的 scrollTop()；wx.showToast → ui 的 showToast()；
//     页面自己的 toastShow/toastText + 定时器退役（全局浮窗，ui.ts 内部管定时器）。
//   · 页面滚动关闭衣物 / 化妆品面板：bindtap 式的 selectComponent → 模板 ref + close()。
//   · 源页面没有 navigateBack（第 ① 步的返回位是占位块），故不引入返回首页的入口。

import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import Stepper from '../components/Stepper.vue';
import Toggle from '../components/Toggle.vue';
import ItemRow from '../components/ItemRow.vue';
import DatePicker from '../components/DatePicker.vue';
import ClothingAdd from '../components/ClothingAdd.vue';
import { newStay, saveStay } from '../engine';
import { CUSTOM_HINTS } from '../data';
import {
  CAT_ORDER_EXT, COMPANION_RELATIONS, COSMETIC_TYPES, DEFAULT_RELATION, MAX_CHILDREN,
  MAX_COMPANIONS, MAX_ELDERLY, PURPOSES_EXT, PURPOSE_ICONS, WEATHERS,
  autoRelation, buildPrepExt, clampCompanions, companionBudget, getDefaultRelation, isGender,
  isPurposeExt, isWeather, setStayExt, splitByQty, syncElderlyFlag, toSourcePurpose,
} from '../extra';
import type { ConditionsExt, Gender, PurposeExt, Relation, WeatherExt } from '../extra';
import type { ChildAge, Conditions, PrepItem, Prefs } from '../types';
import { fmtDate, openStay, scrollTop } from '../store';
import { TOAST_ZERO_TEXT, shouldToastZero } from '../toast';
import { showToast } from '../ui';

/** R5-3：向导全量步骤（新增第 ① 步「性别」） */
const ALL_STEPS = [1, 2, 3, 4, 5, 6, 7];
/**
 * R6.5：「替其他人管行李」关掉时的流程 —— 跳过第 ③ 步（人数）与第 ④ 步（同行人员）。
 * 清单已经按「自己 1 人」生成（见 core/extra.ts buildPrepExt 的降级），
 * 再问「几个人入住、和谁同行」就没有意义了；住宿情况 / 偏好 / 确认清单照常保留
 * （出差、旅游、经期这些只关于自己的维度仍然有效）。
 */
const SOLO_STEPS = [1, 2, 5, 6, 7];

interface AgeOpt {
  v: ChildAge;
  t: string;
}
interface GroupVM {
  cat: string;
  items: (PrepItem & { _i: number })[];
}
interface EffectVM {
  cond: string;
  items: string;
}

/** ItemRow 的 qty 事件载荷（idx 是 preview 下标，见模板里的 :idx="it._i"） */
interface IdxValPayload {
  idx: number;
  ikey: string;
  value: number;
}
/** ItemRow 的 toggle 事件载荷 */
interface IdxTogglePayload {
  idx: number;
  ikey: string;
  value: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dstr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 默认草稿（与 02 §2.0 一致） */
function defaultDraft(): Conditions {
  return {
    date: '',
    nights: 1,
    adults: 1,
    children: 0,
    childAge: '0-3',
    elderly: false,
    pet: false,
    purpose: '普通短住',
    prefs: { sleep: false, hygiene: false, mosquito: false, gadgets: false },
  };
}

/**
 * 打开某个条件后新增的物品名（对比开关前后 buildPrepExt 的差集，非硬编码）。
 * 走扩展层的 buildPrepExt —— 否则「朋友同行」「学习培训」带来的物品不会出现在影响说明里。
 */
function fxNames(on: ConditionsExt, off: ConditionsExt): string[] {
  const base = new Set(buildPrepExt(off).map(i => i.name));
  return buildPrepExt(on)
    .filter(i => !base.has(i.name))
    .map(i => i.name);
}

const step = ref(1);
/** 进度条 / N 分母：随「替其他人管行李」开关变化（7 步或 5 步，见 SOLO_STEPS） */
const total = ref(ALL_STEPS.length);
/**
 * R6.5：当前步在全量步骤里的**位置**（1 起算）。
 * 关掉「替其他人管行李」后步骤号不再连续（1,2,5,6,7），
 * 进度条与「N/M」必须用位置而不是步骤号，否则会出现「5/5 还没到最后一步」。
 */
const stepPos = ref(1);
/** 本次的可见步骤序列（由 careOthers 决定，见 ALL_STEPS / SOLO_STEPS） */
const flow = ref<number[]>(ALL_STEPS);
const draft = ref<Conditions>(defaultDraft());

const ages: AgeOpt[] = [
  { v: '0-3', t: '0 至 3 岁' },
  { v: '4-6', t: '4 至 6 岁' },
  { v: '7-12', t: '7 至 12 岁' },
  { v: '13+', t: '13 岁以上' },
];

// —— 扩展层维度（core/extra.ts）——
// 都不进 draft：draft 是源 Conditions 的形状，存进 Stay 后必须与源项目保持一致。
/** D1：住宿关系。源 Purpose 表达不了「情侣 / 朋友」，故单开一维 */
const companionRelations: Relation[] = COMPANION_RELATIONS;
const relation = ref<Relation>(getDefaultRelation());

/**
 * R6：替其他人管行李（第 ① 步的开关，不进 draft —— 属扩展层维度）。
 * 老板的观察：这个小工具一般是一个人用，多人入住时记录所有人的物品，
 * 反而让人分不清「该拿什么、不该拿什么」。
 *   · 开（默认）→ 与过去行为一致：儿童 / 老人 / 同行者的物品一起备，每人份按真实人数算
 *   · 关        → 只按「自己 1 人」生成清单，多人入住也只管自己的行李
 * 为什么默认开：带娃出行时儿童用品被漏掉的代价太大 —— 精简应该是主动选择，不是默认。
 * 清单层面的降级实现在 core/extra.ts 的 buildPrepExt（源引擎是红线，不动）。
 */
const careOthers = ref(true);

/**
 * R5-9：住宿情况的 7 个标签（源 Purpose 是红线不能加值，扩展值放 PurposeExt）。
 * 双写双读：draft.purpose 只存 toSourcePurpose() 的降级结果（源 4 值之一，
 * 源清单规则认它），purposeExt 存用户真正点的那个（界面回显、扩展层 when 认它）。
 */
const purposesExt = PURPOSES_EXT.map(k => ({ k, icon: PURPOSE_ICONS[k] }));
const purposeExt = ref<PurposeExt>('普通短住');

// —— 天气与温度（扩展层，不进 draft）——
const weathers = WEATHERS;
const weather = ref<WeatherExt | ''>('');
/** 气温，默认 22℃；不选天气也能只用温度触发保暖物品 */
const temp = ref(22);

// —— 日期区间选择阶段 ——
/** start=还没选入住日；end=已选入住，等退房日；done=区间已成立 */
const rangePhase = ref<'start' | 'end' | 'done'>('start');

/**
 * R5-3：性别与经期。不进 draft —— draft 是源 Conditions 的形状（红线），
 * 与 relation / careOthers / purposeExt 一样走扩展层 storage（save 时写进 setStayExt）。
 * gender 用空串表示「未选」—— 第 ① 步未选时「开始」按钮灰显。
 */
const gender = ref<'' | Gender>('');
/** R5-5：是否处于经期。仅女性可见、可开；性别切回男性时必须一起清掉（setGender 里做） */
const period = ref(false);

/** R5-6：化妆品下拉的预设类型（数据在 core/extra.ts，不写死在页面里） */
const cosmeticTypes = COSMETIC_TYPES;

// —— R4-2：同行名额（成人同行 + 儿童 + 老人 ≤ adults − 1）——
/** 成人同行人数（不含自己）。源 Conditions 没有这一维 */
const adultsWith = ref(0);
/** 老人数量。源的 elderly 布尔由它派生 —— 见 syncDerived */
const elderlyCount = ref(0);

// 保留 icon 字段：每条提示前有一个图标（源实现 HINT_ICONS）
const hints = CUSTOM_HINTS.map(h => ({ icon: h.icon, text: h.text }));

/** 退房日原始值（YYYY-MM-DD），只用于日历的区间高亮 */
const checkoutDate = computed(() => {
  const d = draft.value;
  if (!d.date) return '';
  // 退房日 = 入住日 + 晚数（手动解析，禁止 new Date('YYYY-MM-DD')）
  const [y, m, dd] = d.date.split('-').map(Number);
  const t = new Date(y, m - 1, dd + d.nights);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
});
const dateLabel = computed(() => (draft.value.date ? fmtDate(draft.value.date) : '先选好日子'));
const leaveLabel = computed(() => (checkoutDate.value ? fmtDate(checkoutDate.value) : ''));

/**
 * 「开始 / 下一步」按钮是否可用（按当前步判断，见 syncDerived：
 * 第 ① 步看性别、第 ② 步看日期、其余恒 true）。
 * 为什么必须拦：空日期会一路带进 newStay()，存出一条 date 为空的行程，
 * 而 suggestedStage() 对空日期一律返回 prep，这条行程就永远卡在准备阶段。
 */
const nextReady = computed(() =>
  step.value === 1 ? isGender(gender.value)
  : step.value === 2 ? !!draft.value.date
  : true,
);

// —— 派生值（源 syncDerived 的 computed 版）——

/**
 * 草稿 + 扩展维度 → 扩展条件（syncDerived 里那份，不含天气 / 温度）。
 * 名额账与关系判定都只需要人这一维。
 */
const ext = computed<ConditionsExt>(() => ({
  ...draft.value,
  relation: relation.value,
  adultsWith: adultsWith.value,
  elderlyCount: elderlyCount.value,
  purposeExt: purposeExt.value,
  gender: gender.value || undefined,
  period: period.value,
  careOthers: careOthers.value,
}));

/**
 * autoRelation 返回非 null = 「没有成人同行，关系由同行人员决定」。
 * R5-4：第 ④ 步的「和谁一起住」整块删除后，这个自动判定仍要写回 ——
 * 否则老人 / 儿童同行时关系会停在默认值，清单里按关系判定的物品就错了。
 * 写回的时机与源 syncDerived 一致：只在 auto 非 null 时写（模板里的选中态要跟着变）。
 */
const autoRel = computed<Relation | null>(() => autoRelation(ext.value));
watch(autoRel, v => {
  if (v !== null) relation.value = v;
}, { immediate: true });

/** 名额账：{ total, used, left } */
const budget = computed(() => companionBudget(ext.value));
/**
 * 三个步进器「＋」的上限。
 * 在 JS 里算好（当前值 + 剩余名额，再压到各维度自己的上限），
 * 名额用尽时 max === value，stepper 自己就会把「＋」禁掉 —— 不用改组件。
 */
const maxAdult = computed(() => Math.min(adultsWith.value + budget.value.left, MAX_COMPANIONS));
const maxChild = computed(() => Math.min(draft.value.children + budget.value.left, MAX_CHILDREN));
const maxElderly = computed(() => Math.min(elderlyCount.value + budget.value.left, MAX_ELDERLY));
/** 名额相关的说明文案（名额用尽 / 人数改小后自动裁剪时给出） */
const companionNote = computed(() =>
  budget.value.left <= 0 && budget.value.total > 0
    ? '同行名额已用完，还要更多同行者请回上一步改入住人数'
    : '',
);

const isOffset = (n: number): boolean => {
  const t = new Date();
  t.setDate(t.getDate() + n);
  return draft.value.date === dstr(t);
};
const quickOn = computed<boolean[]>(() => [isOffset(0), isOffset(1), isOffset(2)]);

const fxChildren = computed(() =>
  fxNames(conds({ children: draft.value.children, childAge: draft.value.childAge }), conds({ children: 0 })).join('、'),
);
// 未开开关时置空：模板里就不用写 `draft.elderly && fxElderly`（WXML 对 & 敏感）
const fxElderly = computed(() =>
  draft.value.elderly ? fxNames(conds({ elderly: true }), conds({ elderly: false })).join('、') : '',
);
// 关系只在真的带来物品变化时才提示（「独自 / 情侣 / 家人」都不加东西，保持空白）
const fxRelation = computed(() =>
  relation.value === '朋友' || relation.value === '同事'
    ? fxNames(conds({ relation: relation.value }), conds({ relation: '家人' })).join('、')
    : '',
);
// P1-5：≥2 人才问同行；1 人只问宠物
const step3Q = computed(() => (draft.value.adults >= 2 ? '同行的是谁？' : '有宠物同行吗？'));
const showChildren = computed(() => draft.value.adults >= 2);

// R5-9：当前选中住宿情况的提示行。动态由规则差集算出 ——
// 比如同一行程选「出差」，1 晚没有烧水壶，提示就只写颈枕，不许诺不会出现的东西。
const purposeFx = computed(() => purposeFxOf(purposeExt.value));
const rangeHint = computed(() =>
  !draft.value.date
    ? '先挑一个日期，才能生成清单'
    : rangePhase.value === 'end'
      ? '再点一天选择退房日'
      : '点日历可调整退房日，点更早的日期重选入住日',
);
const weatherFx = computed(() => {
  const names = fxNames(conds(), conds({ weather: undefined, temp: 22 }));
  return names.length ? names.join('、') : '';
});

/**
 * 草稿 + 扩展维度 → 扩展条件。
 * 清单求值（预览、影响说明）统一走这里，避免有的地方用 buildPrep、有的地方用 buildPrepExt
 * 导致「影响说明说会加棋牌，预览里却没有」这类前后不一致。
 */
function conds(patch?: Partial<ConditionsExt>): ConditionsExt {
  return {
    ...draft.value,
    relation: relation.value,
    adultsWith: adultsWith.value,
    elderlyCount: elderlyCount.value,
    purposeExt: purposeExt.value,
    gender: gender.value || undefined,
    period: period.value,
    careOthers: careOthers.value,
    weather: weather.value || undefined,
    temp: temp.value,
    ...(patch || {}),
  };
}

/**
 * R5-9：某个住宿情况标签对应的提示行。
 * 动态由 buildPrepExt 的差集算出（fxNames），不硬编码文案 —— 规则改了提示自动跟上，
 * 也不会许诺「这条规则根本给不出」的东西。「其他」给中性说明（保密语义：不做任何推断）。
 */
function purposeFxOf(pe: PurposeExt): string {
  if (pe === '其他') return '按通用清单准备，不会根据住宿目的推荐任何东西';
  if (pe === '普通短住') return '按常规短住清单准备';
  const on = conds({ purpose: toSourcePurpose(pe), purposeExt: pe });
  const off = conds({ purpose: '普通短住', purposeExt: '普通短住' });
  const names = fxNames(on, off);
  return names.length ? '＋将加入：' + names.join('、') : '';
}

function setDraft(patch: Partial<Conditions>): void {
  draft.value = { ...draft.value, ...patch };
}

// —— ① 性别 + 管行李范围 ——
/**
 * 性别切换的两条规矩：
 *   · 切回男性必须把 period 一起清掉 —— 否则留下「男性 + 经期」脏状态，
 *     止痛药会跟着冒出来（老板明确要求男女逻辑要跑得通）。
 *   · 切回女性时 period 保留 —— 用户只是来回看看，不该被吞掉选择。
 */
function setGender(g: string): void {
  if (!isGender(g)) return;
  gender.value = g;
  period.value = g === 'female' ? period.value : false;
  // M19：经期开关只给女性渲染，性别一变「是否已全开」的口径就变，全选按钮要重新对账
  //（Web 端 prefsAll 是 computed，这里无需手动 syncPrefsAll）
}

/**
 * R6 / R6.5：替其他人管行李。切到「关」后有两层连锁（第 ① 步的说明文案与之一一对应）：
 *   · 流程连锁 —— 第 ③④ 步（人数 / 同行人员）整段跳过，向导 7 步变 5 步：
 *     清单按自己 1 人算，问几个人、什么关系已没有意义。
 *   · 数据连锁 —— 同行相关数值一并清零（adultsWith / children / elderlyCount / relation）：
 *     留着只会让行程页头部的「· 家人」这类关系显示说谎。
 *     adults 也要一并归 1（B6）：children / elderly 清了而 adults 留在原值的话，
 *     行程页头部仍显示「3 人入住」，与「只按自己 1 人生成」的清单打架。
 * 重新打开后这几项要重新填 —— 换来的是「数据永远和清单一致」。
 */
function toggleCareOthers(): void {
  const next = !careOthers.value;
  careOthers.value = next;
  const f = next ? ALL_STEPS : SOLO_STEPS;
  flow.value = f;
  total.value = f.length;
  if (!next) {
    adultsWith.value = 0;
    elderlyCount.value = 0;
    relation.value = '独自';
    draft.value = { ...draft.value, adults: 1, children: 0, elderly: false };
  }
}

/** R5-5：经期开关。仅女性可见；清单重算发生在进入第 ⑦ 步时（setPreview）。
    M19：经期也是「在意哪些方面」页的开关，它的开合要同步全选按钮的文案 */
function togglePeriod(): void {
  period.value = !period.value;
}

// —— ① 日期与晚数 ——
function setOffset(n: number): void {
  const d = new Date();
  d.setDate(d.getDate() + n);
  // 快捷日期 = 直接选定入住日，下一步让用户点退房日
  rangePhase.value = 'end';
  setDraft({ date: dstr(d) });
}

/**
 * 日历点选（酒店 App 式两段选择）：
 *   · 还没入住日 → 这一下 = 入住日，进入「选退房日」阶段
 *   · 点更晚的日期 → = 退房日，晚数按天差同步
 *   · 点更早或相同的日期 → 重选入住日，回到「选退房日」阶段
 *   · 区间已成立后再点：按上面两条继续调整
 */
function onPickDate(picked: string): void {
  const p = String(picked || '');
  if (!p) return;
  const current = draft.value.date;
  if (!current || rangePhase.value === 'start') {
    rangePhase.value = 'end';
    setDraft({ date: p });
    return;
  }
  if (p <= current) {
    rangePhase.value = 'end';
    setDraft({ date: p });
    return;
  }
  const [y, m, dd] = current.split('-').map(Number);
  const [py, pm, pd] = p.split('-').map(Number);
  const diff = Math.round((Date.UTC(py, pm - 1, pd) - Date.UTC(y, m - 1, dd)) / 86400000);
  if (diff < 1) return;
  rangePhase.value = 'done';
  setDraft({ nights: Math.max(1, Math.min(30, diff)) });
}

function onNights(n: number): void {
  const v = Number(n);
  if (!Number.isFinite(v)) return;
  if (draft.value.date) rangePhase.value = 'done';
  setDraft({ nights: Math.max(1, Math.min(30, Math.round(v))) });
}

// —— ⑤ 天气与温度 ——
function setWeather(w: string): void {
  if (!isWeather(w)) return;
  weather.value = weather.value === w ? '' : w;
}

function onTemp(n: number): void {
  const v = Number(n);
  if (!Number.isFinite(v)) return;
  temp.value = Math.max(-20, Math.min(40, Math.round(v)));
}

// —— ② 人数 ——
// P0-8：原实现 Math.max(当前, 点击值) 让人数「只能升不能降」——从 5 点回「1 人」无效。
// 现改为按区间判断：
//   · 点「1 人 / 2 人」→ 直接生效（允许降，修掉那个 bug）
//   · 点「3 人及以上」→ 若当前已在 3+ 区间则保留真实人数（不压回 3，
//     守住源项目修复过的缺陷，外部评审 §16；真实人数仍由步进器决定）
function setAdults(n: number): void {
  const cur = draft.value.adults;
  applyAdults(n >= 3 && cur >= 3 ? cur : n);
}

function onAdults(n: number): void {
  applyAdults(Number(n));
}

/**
 * P1-5：人数变化时清掉不适用的字段，避免残留。
 * 否则从 3 人改回 1 人后，清单里会莫名多出儿童用品/老人用品。
 *
 * R4-2 起这里还多一件事：**人数改小后同行者可能超额**（3 人住、1 老人 + 1 儿童，
 * 改回 2 人就只剩 1 个名额了），要裁到名额之内，否则账还是对不上。
 *
 * 1 人入住不存在「和谁一起住」，关系回「独自」；其余情况若关系被同行人员锁定，
 * syncDerived 会自己纠正，这里不用管。
 */
function applyAdults(n: number): void {
  const patch: Partial<Conditions> = { adults: n };
  let aw = adultsWith.value;
  let ec = elderlyCount.value;

  if (n <= 1) {
    // 一个人住：不存在同行者，三个维度全部清零
    aw = 0;
    ec = 0;
    patch.children = 0;
    patch.elderly = false;
  } else {
    // 裁剪顺序：成人同行 → 儿童 → 老人（见 core/extra.ts clampCompanions 的注释）
    const c = clampCompanions({
      ...draft.value,
      adults: n,
      adultsWith: aw,
      children: draft.value.children,
      elderlyCount: ec,
    });
    aw = c.adultsWith;
    ec = c.elderlyCount;
    if (c.children !== draft.value.children) patch.children = c.children;
    patch.elderly = syncElderlyFlag(ec);
  }

  adultsWith.value = aw;
  elderlyCount.value = ec;
  relation.value = n <= 1 ? '独自' : (relation.value === '独自' ? DEFAULT_RELATION : relation.value);
  setDraft(patch);
}

/** R4-2：成人同行人数。不进 draft —— 源 Conditions 没有这一维 */
function onAdultsWith(n: number): void {
  adultsWith.value = Number(n);
}

/**
 * R4-2：老人**数量**。
 * 源层的 `elderly` 是布尔（清单规则只认「有没有老人」），所以走 setDraft 同步派生，
 * 数量本身留在扩展层的 elderlyCount。
 */
function onElderlyCount(n: number): void {
  const v = Number(n);
  elderlyCount.value = v;
  setDraft({ elderly: syncElderlyFlag(v) });
}

/** R4-1：第 ③ 步选同行关系（不含「独自」—— 有同行者才问这个） */
function setCompanionRelation(r: Relation): void {
  if (!(COMPANION_RELATIONS as string[]).includes(r)) return;
  relation.value = r;
}

// —— ③ 同行人员 ——
function onChildren(n: number): void {
  setDraft({ children: Number(n) });
}

function setChildAge(v: string): void {
  setDraft({ childAge: v as ChildAge });
}

function togglePet(): void {
  setDraft({ pet: !draft.value.pet });
}

// —— ④ 住宿情况（R5-9：7 个标签一列排放）——
function setPurpose(p: string): void {
  if (!isPurposeExt(p)) return;
  // 双写（缺一不可，见 core/extra.ts PurposeExt 一节）：
  //   purposeExt → 用户真正点的（回显 / 扩展层 when 用）
  //   draft.purpose → 降级后的源值（源清单规则用）
  purposeExt.value = p;
  setDraft({ purpose: toSourcePurpose(p) });
}

// —— ⑥ 偏好 ——
type PrefKey = 'sleep' | 'hygiene' | 'mosquito' | 'gadgets';

function togglePref(k: PrefKey): void {
  const prefs: Prefs = { ...draft.value.prefs, [k]: !draft.value.prefs[k] };
  setDraft({ prefs });
}

/**
 * M18 全选（老板建议）/ M19 补全（老板点名两处）：
 *   · 女性的「是否处于经期」也是这一页的开关，全选时一并触发（不再是漏网之鱼）；
 *   · 全开时再点一次 = 全部关掉（同一颗按钮两态切换）。
 */
function toggleAllPrefs(): void {
  const all = !allOn(draft.value.prefs);
  setDraft({ prefs: { sleep: all, hygiene: all, mosquito: all, gadgets: all } });
  if (gender.value === 'female') period.value = all;
}

/** 这一页的开关是否已全开：四个「在意」偏好 +（女性）经期。
    男性没有经期开关，不参与判定 —— 全选不该替用户编造身体状况。 */
function allOn(prefs: Prefs): boolean {
  const periodOk = gender.value !== 'female' || period.value;
  return !!(prefs.sleep && prefs.hygiene && prefs.mosquito && prefs.gadgets && periodOk);
}

/** M18/M19：第 ⑥ 步开关是否已全开 —— 驱动「全选 / 取消全选」按钮文案
    （Web 端由 computed 承载源 syncPrefsAll 的职责） */
const prefsAll = computed(() => allOn(draft.value.prefs));

// —— 步骤导航（R6.5：按 flow 走 —— careOthers 关掉时 7 步变 5 步）——
function prev(): void {
  const i = flow.value.indexOf(step.value);
  if (i <= 0) return;
  step.value = flow.value[i - 1];
  stepPos.value = i;
  // nextReady 是按步算的（见 syncDerived），切步后必须重算，否则灰显状态串步
  //（Web 端 nextReady 是 computed，自动跟随）
  scrollTop();
}

function next(): void {
  // R5-3：第 ① 步必须先选性别。按钮已灰显，这里再兜一层 ——
  // 性别未知会让卫生巾 / 剃须刀的适配整层失效，生成一份两边都不像的清单。
  if (step.value === 1 && !isGender(gender.value)) {
    showToast('请先选择性别');
    return;
  }
  // 第 ② 步必须先选日期（原第 ① 步的校验顺移到这里）。空日期会存出一条
  // 永远卡在「准备」阶段的行程（suggestedStage 对空日期返回 prep）。
  if (step.value === 2 && !draft.value.date) {
    showToast('请先选择入住日期');
    return;
  }
  const f = flow.value;
  const i = f.indexOf(step.value);
  const nxt = f[i + 1];
  if (nxt === undefined) return;
  if (nxt === 7) {
    // 进入第 ⑦ 步：生成预览（普通数组，不用 computed，否则自定义项会被重算冲掉）
    setPreview(buildPrepExt(conds()));
    conditionEffects.value = buildEffects();
  }
  step.value = nxt;
  stepPos.value = i + 2;
  scrollTop();
}

/** 区块 A：展开 / 收起「你的选择如何影响清单」 */
const fxOpen = ref(false);
/** 区块 A 的展开态。默认收起——它是解释性内容，
    每次进来都铺开会把真正的清单推到首屏之外。 */
function toggleFx(): void {
  fxOpen.value = !fxOpen.value;
}

/** 区块 A：条件 → 实际影响（差值由 buildPrep 求值，非硬编码） */
function buildEffects(): EffectVM[] {
  const d = draft.value;
  const out: EffectVM[] = [];
  // R6.5：「替其他人管行李」关掉时清单按自己 1 人算（buildPrepExt 降级），
  // 「N 人入住、每人份按 N 份」这行就成了假话 —— 不列。
  if (d.adults > 1 && careOthers.value) {
    out.push({ cond: `${d.adults} 人入住`, items: `每人份物品按 ${d.adults} 份准备` });
  }
  out.push({
    cond: `${d.nights} 晚`,
    items:
      d.nights >= 4
        ? `消耗品按 ${d.nights + 1} 份/人，并加入洗衣、晾衣用品`
        : `消耗品按 ${d.nights + 1} 份/人`,
  });
  if (d.children > 0) {
    const c = fxNames(conds({ children: d.children, childAge: d.childAge }), conds({ children: 0 }));
    if (c.length) out.push({ cond: `儿童 ${d.children} 位（${d.childAge} 岁）`, items: c.join('、') });
  }
  if (d.elderly) {
    const o = fxNames(conds({ elderly: true }), conds({ elderly: false }));
    if (o.length) out.push({ cond: '有老人', items: o.join('、') });
  }
  // 扩展层维度：只有真的带来物品时才列出来，避免「选了但没变化」的空行
  if (relation.value === '朋友' || relation.value === '同事') {
    const r = fxNames(conds({ relation: relation.value }), conds({ relation: '家人' }));
    if (r.length) out.push({ cond: `同行：${relation.value}`, items: r.join('、') });
  }
  // R6：「培训 / 学习」偏好开关已删（与第 ⑤ 步「学习培训」标签重复），
  // 学习类物品唯一由住宿情况触发 —— 其差异行会出现在 purposeFx 与清单里。
  const prefLabel: Record<PrefKey, string> = {
    sleep: '睡眠敏感',
    hygiene: '在意卫生',
    mosquito: '蚊虫季节',
    gadgets: '电子设备多',
  };
  (Object.keys(prefLabel) as PrefKey[]).forEach(k => {
    if (!d.prefs[k]) return;
    const o = fxNames(conds({ prefs: { ...d.prefs, [k]: true } }), conds({ prefs: { ...d.prefs, [k]: false } }));
    if (o.length) out.push({ cond: prefLabel[k], items: o.join('、') });
  });
  return out;
}

// —— ⑥ 预览清单 ——
const conditionEffects = ref<EffectVM[]>([]);
const preview = ref<PrepItem[]>([]);
const groups = ref<GroupVM[]>([]);
/** qty === 0（不带）的项：不进清单，收在底部「已设为不带」区域里可恢复 */
const zeroPreview = ref<(PrepItem & { _i: number })[]>([]);
const zeroOpen = ref(false);
const customName = ref('');
const customQty = ref(1);

function setPreview(list: PrepItem[]): void {
  preview.value = list;
  rebuildGroups();
}

function rebuildGroups(): void {
  // 与行程页同一套口径（core/extra.ts 的 splitByQty）：qty === 0（不带）的项
  // 不进分组、不占清单位置，另收在底部「已设为不带」区域里可恢复。
  // 数据不动，仍留在 preview 里等保存。
  const indexed = preview.value.map((it, idx) => ({ ...it, _i: idx }));
  const { active: items, zero } = splitByQty(indexed);
  // R5-6 / R6 修复：女性追加「化妆品」分组（有预置物品时组自然出现；全被设为
  // 不带 / 删掉后这个兜底保证添加入口仍在），**加进 cats 后统一按 CAT_ORDER_EXT
  // 排序** —— 之前是 push 在末尾，导致化妆品组跑到清单最后而不是衣物后面（老板点名）。
  // M18 查重：女性预置香水/口红/粉底后 items 已含「化妆品」，无条件 push 会出现
  // 两个一模一样的「化妆品」组（与行程页同一个 bug，老板真机抓到）。
  // 男性 / 性别未知不出现这个入口（老板拍板）；男性仍可用通用输入自由添加（H44）。
  const cats = [...new Set(items.map(i => i.cat))];
  if (gender.value === 'female' && !cats.includes('化妆品')) cats.push('化妆品');
  cats.sort((a, b) => CAT_ORDER_EXT.indexOf(a) - CAT_ORDER_EXT.indexOf(b));
  groups.value = cats.map(c => ({
    cat: c,
    items: items.filter(x => x.cat === c),
  }));
  zeroPreview.value = zero;
}

/** 展开 / 收起底部的「已设为不带」区域 */
function toggleZero(): void {
  zeroOpen.value = !zeroOpen.value;
}

/** 把「不带」的项恢复为 1 件（与行程页的 restoreZero 同一语义） */
function restoreZero(i: number): void {
  if (!Number.isInteger(i) || i < 0) return;
  preview.value[i].qty = 1;
  rebuildGroups();
}

function onItemQty(e: IdxValPayload): void {
  const i = Number(e.idx);
  if (!Number.isInteger(i) || i < 0) return;
  const before = Number((preview.value[i] as PrepItem | undefined)?.qty);
  const after = Number(e.value);
  preview.value[i].qty = after;
  rebuildGroups();
  // R4-4：数量减到 0 = 不带。这一行会立刻从清单里消失 ——
  // 不告诉用户它去哪了，用户会以为被删掉了。
  if (shouldToastZero(before, after)) showToast(TOAST_ZERO_TEXT);
}

/**
 * R5-2：预览行整行可点后，勾选事件按 preview 下标回写。
 * 与行程页 onItemToggle 同一语义，只是向导里用 _i 下标定位（无稳定键）。
 * 勾选状态不进「已备齐」进度 —— 向导第 ⑦ 步只是确认清单，打勾在这里没有存储意义，
 * 但为了让「点了有反应」，行内视觉态（.row.done）会立即更新。
 */
function onPreviewToggle(e: IdxTogglePayload): void {
  const i = Number(e.idx);
  if (!Number.isInteger(i) || i < 0) return;
  preview.value[i].done = !!e.value;
  rebuildGroups();
}

/**
 * R5-6：衣物 / 化妆品下拉的统一添加入口。落点分类由标签上的 data-cat 决定
 * （一页两个面板，selectComponent('#clothingAdd') 会取错，事件路由靠 dataset）。
 * 同分类同名不重复添加（02 §6 名称去重）。
 */
function addTyped(name: string, cat: string): void {
  const n = String(name || '').trim();
  if (!n) return;
  const list = [...preview.value];
  if (list.some(i => i.cat === cat && i.name === n)) return;
  list.push({
    name: n,
    cat,
    unit: cat === '化妆品' ? '个' : '件',
    // M18：不再臆测用户「从家里带」—— 用户自己加的，就标「自定义」，
    // 与「还有一些东西」入口（addCustom）同一口径。
    prep: '自定义',
    source: '自定义',
    users: '每人',
    qty: 1,
    done: false,
  });
  setPreview(list);
}

function onCustomName(e: Event): void {
  customName.value = (e.target as HTMLInputElement).value;
}

function onCustomQty(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value);
  customQty.value = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function addCustom(): void {
  const name = String(customName.value || '').trim();
  if (!name) return;
  const list = [...preview.value];
  list.push({
    name,
    cat: '自定义',
    unit: '件',
    prep: '自定义',
    source: '自定义',
    users: '共用',
    qty: customQty.value || 1,
    done: false,
  });
  setPreview(list);
  customName.value = '';
  customQty.value = 1;
}

/**
 * 衣物 / 化妆品浮层是 fixed 定位的，页面一滚就会与触发条错位，故滚动即关闭。
 * R5-6：一页可能有两个面板（衣物 + 化妆品），两个都要关。
 * v-for 里的 string ref 会被 Vue 收成数组，故模板用函数式 ref 绑定 ——
 * 与小程序 selectComponent('#clothingAdd' / '#cosmeticAdd') 一一对应。
 */
const clothingAddRef = ref<{ close: () => void } | null>(null);
const cosmeticAddRef = ref<{ close: () => void } | null>(null);

function bindClothingAdd(el: unknown): void {
  clothingAddRef.value = el as { close: () => void } | null;
}
function bindCosmeticAdd(el: unknown): void {
  cosmeticAddRef.value = el as { close: () => void } | null;
}

function onScroll(): void {
  clothingAddRef.value?.close();
  cosmeticAddRef.value?.close();
}

onMounted(() => {
  window.addEventListener('scroll', onScroll);
});

/** 页面卸载时摘掉滚动监听（源 onUnload 清浮窗定时器；Web 端的定时器在 ui.ts 内） */
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll);
});

// —— 保存 ——
function save(): void {
  // 深拷贝：避免把 data 里的引用对象写进存储（源实现同样处理）
  const s = newStay(
    JSON.parse(JSON.stringify(draft.value)) as Conditions,
    JSON.parse(JSON.stringify(preview.value)) as PrepItem[],
  );
  saveStay(s);
  // 扩展维度不进 Stay 结构（Stay 属红线），单独存扩展层 storage。
  // 少了这一步，「朋友同行 → 棋牌」这类信息在「复制上次」和「我的」页里就丢了。
  setStayExt(s.id, {
    relation: relation.value,
    adultsWith: adultsWith.value,
    elderlyCount: elderlyCount.value,
    // R5-9 / R5-3 / R6：扩展层的住宿情况、性别与管行李维度。Stay.conditions.purpose
    // 已是 toSourcePurpose 降级后的源值，用户真正点的「学习培训 / 看病 / 其他」在这里。
    // study 不再写入（R6 删掉偏好页开关），老数据里的 study 字段由 loadExt 兼容读取。
    purposeExt: purposeExt.value,
    gender: gender.value || undefined,
    period: period.value,
    careOthers: careOthers.value,
    weather: weather.value || undefined,
    temp: temp.value,
  });
  // 显式落到「准备」阶段：suggestedStage() 是「按日期推断」，今天入住会推断成 checkin，
  // 但刚保存完这次入住，用户接下来要做的是准备物品，不是做入住检查。
  openStay(s.id, true);
}
</script>

<template>
  <div class="page">
    <div class="bg-glow"></div>

    <!-- 顶部：返回 + 进度条 + N/M（R6.5：N/M 用 stepPos，步骤号可能不连续） -->
    <div class="wiz-head">
      <div v-if="stepPos > 1" class="icon-btn" aria-label="上一步" @click="prev()">
        <AppIcon name="arrow-left" :size="32" tone="i" />
      </div>
      <div v-else class="icon-btn placeholder"></div>
      <div class="track"><div class="track-in" :style="{ width: (stepPos / total * 100) + '%' }"></div></div>
      <span class="stepno num">{{ stepPos }}<span class="stepno-total">/{{ total }}</span></span>
    </div>

    <!-- 当前步骤的小标签：设计稿的 STEP 02 · STAY CALCULATION 对应这里 -->
    <div class="step-eyebrow">
      <div class="dot"></div>
      <span class="num">STEP {{ stepPos }} / {{ total }}</span>
    </div>

    <!-- ① 性别 + 管行李范围 -->
    <template v-if="step === 1">
      <div class="q">你的性别？</div>
      <span class="qsub">清单会按性别适配，之后随时可改</span>
      <div class="glass card">
        <div class="picklist">
          <div class="pickrow pickrow-lg" :class="{ on: gender === 'male' }" @click="setGender('male')">
            <AppIcon name="mars" :size="48" tone="p" />
            <span class="picklabel">男</span>
            <div class="pickcheck"><AppIcon v-if="gender === 'male'" name="check" :size="24" tone="c" /></div>
          </div>
          <div class="pickrow pickrow-lg" :class="{ on: gender === 'female' }" @click="setGender('female')">
            <AppIcon name="venus" :size="48" tone="p" />
            <span class="picklabel">女</span>
            <div class="pickcheck"><AppIcon v-if="gender === 'female'" name="check" :size="24" tone="c" /></div>
          </div>
        </div>

        <div class="srow carerow">
          <div class="slabel"><AppIcon name="users" :size="34" tone="p" />替其他人管行李</div>
          <Toggle :value="careOthers" @change="toggleCareOthers()" />
        </div>
        <div v-if="careOthers" class="carefx">
          <div class="carefx-row">
            <div class="carefx-num">1</div>
            <div class="carefx-body">
              <span class="carefx-t">后面照常询问</span>
              <span class="carefx-d">几个人入住、和谁同行、有没有孩子老人</span>
            </div>
          </div>
          <div class="carefx-row">
            <div class="carefx-num">2</div>
            <div class="carefx-body">
              <span class="carefx-t">清单按所有入住人一起准备</span>
              <span class="carefx-d">每人份按真实人数算，儿童、老人物品一并列入</span>
            </div>
          </div>
        </div>
        <div v-if="!careOthers" class="carefx">
          <div class="carefx-row">
            <div class="carefx-num">1</div>
            <div class="carefx-body">
              <span class="carefx-t">后面不再问同行的事</span>
              <span class="carefx-d">跳过人数和同行人员，直接去选住宿情况</span>
            </div>
          </div>
          <div class="carefx-row">
            <div class="carefx-num">2</div>
            <div class="carefx-body">
              <span class="carefx-t">清单只按你一个人准备</span>
              <span class="carefx-d">所有每人份按 1 份算，儿童、老人、同行者物品不出现</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ② 日期与晚数 -->
    <template v-else-if="step === 2">
      <div class="q">什么时候入住？</div>
      <span class="qsub">选好日期和晚数，清单会按天数计算消耗品数量</span>
      <div class="glass card">
        <!-- 入住 / 退房摘要 -->
        <div class="datepair">
          <div class="datecell">
            <span class="datecap">入住 CHECK-IN</span>
            <span class="dateval num">{{ dateLabel }}</span>
          </div>
          <div class="datecell datecell-r">
            <span class="datecap">退房 CHECK-OUT</span>
            <span class="dateval num">{{ leaveLabel }}</span>
          </div>
        </div>
        <span class="datehint">{{ rangeHint }}</span>

        <div class="quickrow">
          <div class="qchip" :class="{ on: quickOn[0] }" @click="setOffset(0)">今天</div>
          <div class="qchip" :class="{ on: quickOn[1] }" @click="setOffset(1)">明天</div>
          <div class="qchip" :class="{ on: quickOn[2] }" @click="setOffset(2)">后天</div>
        </div>

        <div class="wdivider"></div>
        <div class="nightsrow">
          <div class="fl"><AppIcon name="compass" :size="28" tone="p" />住几晚</div>
          <Stepper :value="draft.nights" :min="1" :max="30" unit="晚" @change="onNights" />
        </div>
        <span class="hint">晚数 ≥ 4 会自动加入长住物品（洗衣、晾衣）。</span>

        <div class="dslot">
          <DatePicker :value="draft.date" :end="checkoutDate" @change="onPickDate" />
        </div>

      </div>
    </template>

    <!-- ③ 人数 -->
    <template v-else-if="step === 3">
      <div class="q">这次有几个人入住？</div>
      <span class="qsub">人数会决定每人份物品的数量</span>
      <div class="glass card">
        <div class="picklist">
          <div class="pickrow" :class="{ on: draft.adults === 1 }" @click="setAdults(1)">
            <AppIcon name="user" :size="38" tone="p" />
            <span class="picklabel">1 人</span>
            <div class="pickcheck"><AppIcon v-if="draft.adults === 1" name="check" :size="22" tone="c" /></div>
          </div>
          <div class="pickrow" :class="{ on: draft.adults === 2 }" @click="setAdults(2)">
            <AppIcon name="users" :size="38" tone="p" />
            <span class="picklabel">2 人</span>
            <div class="pickcheck"><AppIcon v-if="draft.adults === 2" name="check" :size="22" tone="c" /></div>
          </div>
          <div class="pickrow" :class="{ on: draft.adults >= 3 }" @click="setAdults(3)">
            <AppIcon name="users-3" :size="38" tone="p" />
            <span class="picklabel">3 人及以上</span>
            <div class="pickcheck"><AppIcon v-if="draft.adults >= 3" name="check" :size="22" tone="c" /></div>
          </div>
        </div>

        <template v-if="draft.adults >= 3">
          <div class="pickexpand">
            <div class="fxline">几人入住就按几人准备，请确认真实人数</div>
            <div class="nightsrow nightsrow-end">
              <Stepper :value="draft.adults" :min="3" :max="10" unit="人" @change="onAdults" />
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- ④ 同行人员 -->
    <template v-else-if="step === 4">
      <div class="q">
        {{ step3Q }}<span v-if="showChildren" class="qsub muted">你自己占 1 位，其余都是同行者</span>
      </div>
      <div class="glass card">
        <template v-if="showChildren">
          <div class="budget">
            <span class="num budget-n">本次 {{ draft.adults }} 人</span>
            <span class="muted"> · 你占 1 位 · 还剩</span>
            <span class="num budget-left">{{ budget.left }}</span>
            <span class="muted"> 个同行名额</span>
          </div>

          <div class="nightsrow">
            <div class="fl"><AppIcon name="user" :size="28" tone="p" />成人同行</div>
            <Stepper :value="adultsWith" :min="0" :max="maxAdult" unit="人" @change="onAdultsWith" />
          </div>

          <div class="nightsrow">
            <div class="fl"><AppIcon name="users" :size="28" tone="p" />儿童</div>
            <Stepper :value="draft.children" :min="0" :max="maxChild" unit="个" @change="onChildren" />
          </div>
          <template v-if="draft.children > 0">
            <div class="fl fl-gap">年龄段</div>
            <div class="chips">
              <div
                v-for="item in ages"
                :key="item.v"
                class="chip"
                :class="{ on: draft.childAge === item.v }"
                @click="setChildAge(item.v)"
              >{{ item.t }}</div>
            </div>
            <div v-if="fxChildren" class="fxline">＋将加入：{{ fxChildren }}</div>
          </template>

          <div class="nightsrow">
            <div class="fl"><AppIcon name="users-3" :size="28" tone="p" />老人</div>
            <Stepper :value="elderlyCount" :min="0" :max="maxElderly" unit="位" @change="onElderlyCount" />
          </div>
          <div v-if="fxElderly" class="fxline">＋将加入：{{ fxElderly }}</div>

          <div v-if="companionNote" class="fxline warn">{{ companionNote }}</div>

          <template v-if="adultsWith > 0">
            <div class="fl fl-gap">和你同行的是什么关系？</div>
            <div class="chips">
              <div
                v-for="item in companionRelations"
                :key="item"
                class="chip"
                :class="{ on: relation === item }"
                @click="setCompanionRelation(item)"
              >{{ item }}</div>
            </div>
            <div v-if="fxRelation" class="fxline">＋将加入：{{ fxRelation }}</div>
          </template>
        </template>

        <div class="switch-rows" :class="{ 'switch-rows-flush': !showChildren }">
          <div class="srow">
            <span class="slabel">有宠物同行<span v-if="draft.pet" class="muted">（用品稍后自行添加）</span></span>
            <Toggle :value="draft.pet" @change="togglePet()" />
          </div>
        </div>
      </div>
    </template>

    <!-- ⑤ 住宿情况 -->
    <template v-else-if="step === 5">
      <div class="q">这次住宿属于哪种情况？</div>
      <span class="qsub">影响清单里的场景物品；天气和温度单独补充在后面</span>
      <div class="glass card">
        <div class="picklist">
          <div
            v-for="item in purposesExt"
            :key="item.k"
            class="pickrow"
            :class="{ on: purposeExt === item.k }"
            @click="setPurpose(item.k)"
          >
            <AppIcon :name="item.icon" :size="38" tone="p" />
            <span class="picklabel">{{ item.k }}</span>
            <div class="pickcheck"><AppIcon v-if="purposeExt === item.k" name="check" :size="22" tone="c" /></div>
          </div>
        </div>
        <div v-if="purposeFx" class="fxline">{{ purposeFx }}</div>
      </div>

      <div class="sec-label">天气与温度（可选）</div>
      <div class="glass card">
        <div class="chips weatherchips">
          <div
            v-for="item in weathers"
            :key="item.k"
            class="chip"
            :class="{ on: weather === item.k }"
            @click="setWeather(item.k)"
          >
            <AppIcon :name="item.icon" :size="26" :tone="weather === item.k ? 'c' : 'p'" />
            {{ item.k }}
          </div>
        </div>
        <div class="wdivider"></div>
        <div class="nightsrow">
          <div class="fl"><AppIcon name="thermometer" :size="28" tone="p" />气温</div>
          <Stepper :value="temp" :min="-20" :max="40" unit="℃" @change="onTemp" />
        </div>
        <div v-if="weatherFx" class="fxline">＋将加入：{{ weatherFx }}</div>
        <span v-else class="hint">不选天气就按常规准备；气温会影响防晒或保暖物品。</span>
      </div>
    </template>

    <!-- ⑥ 偏好 -->
    <template v-else-if="step === 6">
      <div class="q qhead">
        <span>你在意哪些方面？</span>
        <div class="selall" @click="toggleAllPrefs()">{{ prefsAll ? '取消全选' : '全选' }}</div>
      </div>
      <span class="qsub">选中的会加进清单，之后随时可改</span>
      <div class="glass card">
        <div class="srow">
          <div class="slabel"><AppIcon name="moon" :size="34" tone="p" />睡眠敏感</div>
          <Toggle :value="draft.prefs.sleep" @change="togglePref('sleep')" />
        </div>
        <div v-if="draft.prefs.sleep" class="fxline">＋将加入：眼罩、耳塞</div>

        <div class="srow">
          <div class="slabel"><AppIcon name="droplets" :size="34" tone="p" />在意卫生</div>
          <Toggle :value="draft.prefs.hygiene" @change="togglePref('hygiene')" />
        </div>
        <div v-if="draft.prefs.hygiene" class="fxline">＋将加入：一次性床单/隔脏睡袋</div>

        <div class="srow">
          <div class="slabel"><AppIcon name="bug" :size="34" tone="p" />蚊虫季节</div>
          <Toggle :value="draft.prefs.mosquito" @change="togglePref('mosquito')" />
        </div>
        <div v-if="draft.prefs.mosquito" class="fxline">＋将加入：驱蚊液/花露水</div>

        <div class="srow">
          <div class="slabel"><AppIcon name="plug" :size="34" tone="p" />电子设备多</div>
          <Toggle :value="draft.prefs.gadgets" @change="togglePref('gadgets')" />
        </div>
        <div v-if="draft.prefs.gadgets" class="fxline">＋将加入：氮化镓多口充电器、USB 数据阻断器、魔方插座</div>

        <template v-if="gender === 'female'">
          <div class="srow">
            <div class="slabel"><AppIcon name="droplets" :size="34" tone="p" />是否处于经期</div>
            <Toggle :value="period" @change="togglePeriod()" />
          </div>
          <div v-if="period" class="fxline">＋将加入：卫生巾/护垫（必带）、止痛药</div>
        </template>
      </div>
    </template>

    <!-- ⑦ 确认清单 -->
    <template v-else>
      <div class="q">确认你的专属入住清单</div>
      <span class="qsub">根据前面的条件生成，可在这里调整数量或增删</span>

      <!-- 区块 A · 你的选择如何影响清单 -->
      <div class="glass card fxcards">
        <div class="think-title fx-head" @click="toggleFx()">
          <AppIcon name="sliders" :size="30" tone="p" />
          <span class="grow fx-title">你的选择如何影响清单</span>
          <div class="fx-arrow" :class="{ rot: !fxOpen }">
            <AppIcon name="chevron-down" :size="26" tone="k" />
          </div>
        </div>
        <template v-if="fxOpen">
          <div v-for="item in conditionEffects" :key="item.cond" class="hint-row">
            <span class="fxcond">{{ item.cond }}</span>
            <span class="muted fxitems">{{ item.items }}</span>
          </div>
          <div class="hint-row">
            <span class="fxcond">数量规则</span>
            <span class="muted fxitems">消耗品 = 人数 ×（晚数 + 1），上衣每人封顶 4 件，均可手动调整</span>
          </div>
        </template>
      </div>

      <!-- 区块 B · 清单预览 -->
      <template v-for="item in groups" :key="item.cat">
        <div class="sec-label">{{ item.cat }}</div>
        <div class="glass card">
          <ItemRow
            v-for="it in item.items"
            :key="it._i"
            :item="it"
            :idx="it._i"
            :editable="true"
            @toggle="onPreviewToggle"
            @qty="onItemQty"
          />
          <ClothingAdd
            v-if="item.cat === '衣物'"
            :ref="bindClothingAdd"
            cat="衣物"
            trigger="选择衣物类型…"
            placeholder="输入衣物名称，如：防晒衣"
            @add="(n: string) => addTyped(n, '衣物')"
          />
          <ClothingAdd
            v-if="item.cat === '化妆品'"
            :ref="bindCosmeticAdd"
            cat="化妆品"
            :types="cosmeticTypes"
            trigger="选择化妆品类型…"
            placeholder="输入化妆品名称，如：面膜"
            @add="(n: string) => addTyped(n, '化妆品')"
          />
        </div>
      </template>

      <!-- 已设为不带 -->
      <div v-if="zeroPreview.length" class="zero-zone">
        <div class="zero-head" @click="toggleZero()">
          <span class="grow zero-title">已设为不带（{{ zeroPreview.length }} 项）</span>
          <div class="fx-arrow" :class="{ rot: !zeroOpen }">
            <AppIcon name="chevron-down" :size="28" tone="k" />
          </div>
        </div>
        <div v-if="zeroOpen" class="glass card">
          <div v-for="z in zeroPreview" :key="z._i" class="zrow">
            <span class="grow zname">{{ z.name }}</span>
            <div class="zrestore" @click="restoreZero(z._i)">恢复</div>
          </div>
        </div>
      </div>

      <!-- 区块 C · 自定义物品 -->
      <div class="glass card think">
        <div class="think-title"><AppIcon name="lightbulb" :size="30" tone="p" />还有一些东西，只有你自己知道</div>
        <div v-for="item in hints" :key="item.text" class="hint-row">
          <AppIcon :name="item.icon" :size="30" tone="p" />
          <span class="muted">{{ item.text }}</span>
        </div>
        <div class="addrow">
          <input
            class="field growfield"
            :value="customName"
            placeholder="物品名，如：相机电池"
            @input="onCustomName"
          />
          <input
            class="field qtyin num"
            type="number"
            :value="customQty"
            @input="onCustomQty"
          />
          <div class="btn small addbtn" @click="addCustom()">
            <AppIcon name="plus" :size="28" tone="c" />
          </div>
        </div>
      </div>
    </template>

    <!-- 底部固定动作栏 -->
    <div class="wiz-foot">
      <template v-if="stepPos !== total">
        <div class="btn" :class="{ 'btn-off': !nextReady }" @click="next()">
          {{ step === 1 ? '开始' : '下一步' }}
          <AppIcon name="chevron-right" :size="28" tone="c" />
        </div>
      </template>
      <template v-else>
        <div class="btn plain foot-back" @click="prev()">返回修改</div>
        <div class="btn foot-save" @click="save()">保存这次入住</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 创建向导 —— Stitch 现代功能编辑风
   七步共用一套步骤头、问句、白卡与固定底栏；
   日期步额外有「入住 / 退房」摘要卡。 */

.page {
  padding: 0 16px calc(130px + env(safe-area-inset-bottom));
}

/* —— 顶部步骤条 —— */
.wiz-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 4px;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 9px;
  background: var(--surface);
  border: 1px solid var(--glass-border);
}
.icon-btn.placeholder {
  background: transparent;
  border-color: transparent;
}
/* hover-class="icon-btn-hover" → :active */
.icon-btn:active {
  background: var(--surface-2);
}
.track {
  flex: 1;
  height: 4px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}
.track-in {
  height: 100%;
  border-radius: 999px;
  background: var(--primary);
  transition: width 0.25s ease;
}
.stepno {
  min-width: 33px;
  text-align: right;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
}
.stepno-total {
  font-size: 10px;
  font-weight: 500;
  color: var(--ink-3);
}
.step-eyebrow {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 7px 2px 5px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--ink-3);
}

/* —— 问句 —— */
.q {
  font-size: 22px;
  line-height: 1.2;
  margin: 2px 2px 4px;
  font-weight: 700;
  letter-spacing: -0.4px;
  color: var(--ink);
}
.qhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.qsub {
  display: block;
  font-size: 12px;
  line-height: 1.55;
  color: var(--ink-2);
  font-weight: 400;
  margin: 0 2px 12px;
}
.qhead + .qsub {
  margin-top: 4px;
}
.q .qsub {
  margin: 3px 0 0;
}
.selall {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--primary);
  border: 1px solid var(--primary);
  font-size: 12px;
  font-weight: 650;
  line-height: 1;
  color: #ffffff;
  box-shadow: 0 4px 10px -7px rgba(15, 23, 42, 0.55);
}
/* hover-class="selall-hover" → :active */
.selall:active {
  opacity: 0.82;
}

/* —— 卡片 —— */
.card {
  padding: 13px;
  margin-bottom: 2px;
}

/* —— 表单行 —— */
.fl {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--ink);
}
.fl-gap {
  margin-top: 13px;
  margin-bottom: 6px;
  color: var(--ink-2);
}
.nightsrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 0;
}
.nightsrow-end {
  justify-content: flex-end;
}
.srow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  padding: 5px 0;
}
.slabel {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 14px;
  color: var(--ink);
}

/* —— 选择列表 —— */
.picklist {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.pickrow {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 48px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--surface-2);
  font-size: 14.5px;
  color: var(--ink);
}
/* hover-class="hv" → :active（全局 .hv 为 opacity: .7） */
.pickrow:active {
  opacity: 0.7;
}
.pickrow.on {
  border-color: var(--primary);
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px var(--primary);
}
.picklabel {
  flex: 1;
  min-width: 0;
}
.pickcheck {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 1px solid var(--line);
  background: var(--surface);
}
.pickrow.on .pickcheck {
  border-color: var(--primary);
  background: var(--primary);
}
.pickrow-lg {
  min-height: 66px;
  padding: 0 13px;
  border-radius: 10px;
  font-size: 17px;
}
.pickrow-lg .pickcheck {
  width: 22px;
  height: 22px;
}
.carerow {
  margin-top: 12px;
  padding-top: 9px;
  border-top: 1px solid var(--hairline);
}
.pickexpand {
  margin-top: 12px;
  padding-top: 9px;
  border-top: 1px solid var(--hairline);
}
.pickexpand .nightsrow {
  margin-top: 7px;
}

/* —— 日期摘要卡 —— */
.datepair {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px;
  border-radius: 9px;
  background: var(--surface-2);
}
.datecell {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.datecell-r {
  align-items: flex-end;
  text-align: right;
  padding-left: 9px;
  border-left: 1px solid var(--hairline);
}
.datecap {
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--ink-3);
}
.dateval {
  font-size: 14px;
  line-height: 1.25;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: -0.15px;
}
.datehint {
  display: block;
  margin-top: 5px;
  font-size: 10.5px;
  color: var(--accent-deep);
}

/* 快捷日期：4 等分。用 flex-basis:0 + min-width:0，避免旧版 calc 踩临界点 */
.quickrow {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 11px 0 4px;
}
.qchip {
  flex: 1 1 0;
  width: auto;
  min-width: 0;
  min-height: 44px;
  padding: 0 2px;
  border-radius: 7px;
  font-size: 12px;
}
/* hover-class="qchip-hover" → :active */
.qchip:active {
  background: var(--surface-2);
}

/* 日历展开区 */
.dslot {
  margin: 7px 0 3px;
  padding: 5px 4px 3px;
  border-radius: 9px;
  background: var(--surface-2);
}
.wdivider {
  height: 1px;
  margin: 9px 0 5px;
  background: var(--hairline);
}
.hint {
  display: block;
  margin-top: 6px;
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--ink-3);
}

/* —— 同行名额 / 关系 —— */
.budget {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  margin-bottom: 9px;
  padding: 8px 9px;
  border-radius: 7px;
  background: var(--info-soft);
  font-size: 12px;
  line-height: 1.5;
}
.budget-n {
  font-weight: 700;
  color: var(--ink);
}
.budget-left {
  padding: 0 2px;
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
}
.chip {
  gap: 4px;
  min-height: 40px;
  padding: 0 11px;
  font-size: 12px;
}
.switch-rows {
  margin-top: 12px;
  padding-top: 4px;
  border-top: 1px solid var(--hairline);
}
.switch-rows-flush {
  margin-top: 0;
  border-top: 0;
  padding-top: 0;
}

/* —— 第 ⑦ 步 —— */
.fxcards {
  margin-bottom: 12px;
}
.think {
  margin-top: 13px;
}
.think-title {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  font-size: 14px;
  font-weight: 650;
  color: var(--ink);
}
.fx-head {
  min-height: 44px;
  margin-bottom: 0;
  padding: 2px 0;
}
/* hover-class="hv" → :active */
.fx-head:active {
  opacity: 0.7;
}
.fx-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fx-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  transition: transform 0.18s ease;
}
.fx-arrow.rot {
  transform: rotate(-90deg);
}
.hint-row {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 4px 0;
}
.fxcond {
  flex-shrink: 0;
  min-width: 88px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink);
}
.fxitems {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  line-height: 1.55;
}
.addrow {
  display: flex;
  gap: 5px;
  margin-top: 8px;
}
.growfield {
  flex: 1;
  min-width: 0;
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
.sec-label {
  margin: 13px 2px 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
}
.zero-zone {
  margin-top: 12px;
}
.zero-head {
  min-height: 44px;
  padding: 0 2px;
}
/* hover-class="hv" → :active */
.zero-head:active {
  opacity: 0.7;
}
.zero-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
}
.zrestore:active {
  opacity: 0.7;
}

/* —— 固定底栏 —— */
/* Web：整页是 480px 居中列（.page），fixed 条必须跟列同宽居中，
   否则宽屏下会拉满整条视口。这是本页与源 wxss 唯一的样式偏差，其余照搬。 */
.wiz-foot {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  width: min(480px, 100%);
  bottom: 0;
  z-index: 900;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 6px;
  padding: 8px 16px calc(8px + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.97);
  border-top: 1px solid var(--glass-border);
  box-shadow: 0 -4px 12px -9px rgba(15, 23, 42, 0.18);
}
.wiz-foot .btn {
  flex: 1;
  min-height: 48px;
}
.foot-back {
  flex: 0 0 100px !important;
  font-size: 13px;
  color: var(--ink-2);
}
.foot-save {
  flex: 1;
}
.btn-off {
  opacity: 0.38;
  box-shadow: none;
}
/* —— 「替其他人管行李」开关影响（第四轮改版：无「」、编号 + 标题/说明两行）—— */
.carefx {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 8px;
  padding: 9px 10px;
  border-radius: 8px;
  background: var(--surface-2);
}
.carefx-row {
  display: flex;
  align-items: flex-start;
  gap: 7px;
}
.carefx-num {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: 50%;
  background: var(--primary);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}
.carefx-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.carefx-t {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--ink);
}
.carefx-d {
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--ink-2);
}

/* —— 天气 chips —— */
.weatherchips {
  margin-bottom: 2px;
}
.weatherchips .chip {
  gap: 4px;
  padding: 0 9px;
}
</style>
