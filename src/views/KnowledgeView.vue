<script setup lang="ts">
// 知识库 —— 源实现 src/components/KnowledgeView.vue
// 免责声明（不可删）→ 等级图例 → 11 个模块 · 44 条，逐条可展开，紧急话术一键复制。
//
// 与源实现的差异（平台导致）：
//   1. 富文本：源实现用 v-html（先 esc 再替换 ** 为 <strong>）。小程序没有 v-html 也不允许
//      动态节点，故把正文预解析成「段落 → 片段（普通/加粗）」结构，用 text 组件渲染。
//      零 HTML、零注入风险，且加粗范围与源实现完全一致。
//   2. navigator.clipboard → wx.setClipboardData（会由系统弹「内容已复制」提示）。
//   3. <details> → 自绘展开态（data 里的 open 布尔）。
//   4. scrollIntoView → createSelectorQuery + pageScrollTo。
//   5. 「返回行程」：知识库是 tabBar 页，进入靠 switchTab（清栈），故返回用 reLaunch。

// R7：免责声明移至「我的」页（知识库这份与它重复），DISCLAIMER 不再被本页引用
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import { EVIDENCE_META, KNOWLEDGE, RISK_META } from '../data';
import { softDashes, toParas } from '../rich';
import type { Para } from '../rich';
import type { KnowledgeEntry } from '../types';
import { backToStay, knowModule, knowReturnTo } from '../store';
import { showToast } from '../ui';

interface EntryVM {
  id: string;
  title: string;
  tone: string;
  /** 风险文字徽标（立即处理 / 建议检查 / 普通注意） */
  riskLabel: string;
  evi: string;
  /** 证据方块颜色档位（blue / green / purple / gray） */
  eviTone: string;
  source: string;
  updated: string;
  hasCopy: boolean;
  /** 复制话术原文：复制失败时展开给用户手动选中 */
  copy: string;
  review: boolean;
  open: boolean;
  paras: Para[];
}
interface ModuleVM {
  name: string;
  count: number;
  /** 模块内最高风险（high / mid / low），用于目录行的风险徽标 */
  risk: string;
  riskLabel: string;
  /** P2-1：模块级折叠。默认 false —— 进来先看到 11 行目录，而不是 44 条正文 */
  open: boolean;
  items: EntryVM[];
}
interface LegendVM {
  label: string;
  tone: string;
}

// 富文本预解析（parseInline / toParas）已抽到 core/rich.ts，与「我的」页共用。
// 知识库这边不再自己维护一份，避免两处口径漂移。

/** 法规时效条目到期后提示复核（源实现 needsReview，函数体一致） */
function needsReview(k: KnowledgeEntry): boolean {
  if (!k.reviewBy) return false;
  const [y, m] = k.reviewBy.split('-').map(Number);
  return new Date() >= new Date(y, m - 1, 1);
}

function buildModules(): ModuleVM[] {
  const names: string[] = [];
  KNOWLEDGE.forEach(k => {
    if (!names.includes(k.module)) names.push(k.module);
  });
  return names.map(name => {
    const list = KNOWLEDGE.filter(k => k.module === name);
    // 目录行的风险徽标：取模块内最高风险（high > mid > low），让用户不展开也能判断优先级
    const risk = list.some(k => k.risk === 'high')
      ? 'high'
      : list.some(k => k.risk === 'mid') ? 'mid' : 'low';
    return {
      name: softDashes(name),
      count: list.length,
      risk,
      riskLabel: RISK_META[risk].label,
      // P2-1：默认全收起。要「进来就能看到目录」而不是「一屏 44 条」
      open: false,
      items: list.map(k => ({
        id: k.id,
        title: softDashes(k.title),
        tone: RISK_META[k.risk].tone,
        riskLabel: RISK_META[k.risk].label,
        evi: EVIDENCE_META[k.evidence].label,
        eviTone: EVIDENCE_META[k.evidence].tone,
        source: softDashes(k.source),
        updated: k.updated,
        hasCopy: !!k.copy,
        copy: k.copy || '',
        review: needsReview(k),
        open: false,
        paras: toParas(k.body),
      })),
    };
  });
}

const eviList = ref<LegendVM[]>([]);
const riskList = ref<LegendVM[]>([]);
const total = ref(0);
const modCount = ref(0);
const modules = ref<ModuleVM[]>([]);
const copiedId = ref('');
/** 复制失败时展开原文，让「请手动选择」有东西可选 */
const revealedCopyId = ref('');
/** P1-1 回到顶部按钮显隐 */
const showGoTop = ref(false);

/** 滚动多少像素才显示「回到顶部」（口径同 core/gesture.ts 的 SCROLL_TOP_TRIGGER） */
const SCROLL_TOP_TRIGGER = 120;

/** 从行程页「知识详解」跳进来时提供返回键；否则回首页（Web 无 tabBar 栈可 navigateBack） */
const backLabel = '返回行程';

function onLoad() {
  eviList.value = Object.keys(EVIDENCE_META).map(k => ({
    label: EVIDENCE_META[k].label,
    tone: EVIDENCE_META[k].tone,
  }));
  riskList.value = Object.keys(RISK_META).map(k => ({
    label: RISK_META[k].label,
    tone: RISK_META[k].tone,
  }));
  const list = buildModules();
  modules.value = list;
  total.value = KNOWLEDGE.length;
  modCount.value = list.length;
}

function onShow() {
  const name = knowModule.value;
  if (!name) return;
  // 一次性消费（对齐主线 core/nav.ts 的 takeNav）：用完就清，
  // 否则下次从 tabBar 进知识库还会自动展开上次那个模块。
  knowModule.value = null;
  const mi = modules.value.findIndex(m => m.name === name);
  if (mi < 0) return;
  // 锚点模块：用户是从行程页点「知识详解」跳进来的，直奔正文 ——
  // 展开目标模块 + 其全部条目，并收起其它模块（与手风琴行为一致），
  // 渲染完成后滚动定位。
  // 注意写入顺序：先批量收起，再单独把目标模块置 true，
  // 这样目标模块原本就是展开态时也不会被误收。
  modules.value.forEach((m, i) => {
    if (i !== mi) m.open = false;
  });
  modules.value[mi].open = true;
  modules.value[mi].items.forEach(it => {
    it.open = true;
  });
  void nextTick(() => scrollToModule(mi));
}

/** createSelectorQuery + pageScrollTo → getBoundingClientRect + scrollTo（同步取坐标） */
function scrollToModule(mi: number) {
  const el = document.getElementById(`mod-${mi}`);
  if (!el) return;
  const top = window.scrollY + el.getBoundingClientRect().top - 12;
  window.scrollTo({ top, behavior: 'smooth' });
}

onMounted(() => {
  // 小程序 onLoad → onMounted 前半段
  onLoad();
  // 小程序 onShow → onMounted 后半段：视图切换会重建组件，等价于 onShow
  onShow();
  window.addEventListener('scroll', onPageScroll, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener('scroll', onPageScroll);
});

/**
 * P2-1：模块级折叠（手风琴 —— 同一时刻最多展开一个模块）。
 * 点已展开的模块 = 收起，回到「只看目录」。
 *
 * 为什么不用整份回传 modules：modules 里挂着 44 条富文本的预解析结果
 * （段落 → 片段），整份替换要重建几十 KB 的响应式代理，点一下卡一下。
 * 这里只翻转真正发生变化的 open 字段。
 */
function toggleModule(mi: number) {
  const mods = modules.value;
  if (!mods[mi]) return;
  const willOpen = !mods[mi].open;
  mods.forEach((m, i) => {
    m.open = i === mi ? willOpen : false;
  });
}

function toggleEntry(mi: number, ii: number) {
  const mod = modules.value[mi];
  if (!mod || !mod.items[ii]) return;
  mod.items[ii].open = !mod.items[ii].open;
}

/** 老浏览器 / 非安全上下文下的兜底：textarea + execCommand */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function copyEntry(id: string) {
  const k = KNOWLEDGE.find(x => x.id === id);
  if (!k || !k.copy) return;
  let ok = false;
  try {
    await navigator.clipboard.writeText(k.copy);
    ok = true;
  } catch {
    ok = legacyCopy(k.copy);
  }
  if (ok) {
    revealedCopyId.value = '';
    copiedId.value = id;
    showToast('已复制');
    setTimeout(() => {
      if (copiedId.value === id) copiedId.value = '';
    }, 1500);
  } else {
    // 复制彻底不可用（少数浏览器策略）时，把话术本身摊开 —— 至少能手动选中
    revealedCopyId.value = id;
    showToast('已展开话术，请手动选择复制');
  }
}

/** 返回行程（这个入口只在 from='stay' 时渲染，见模板） */
function backTap() {
  backToStay();
}

/** P1-1：滚动一点就显示「回到顶部」（每帧触发，只做布尔翻转判断，禁止构造大对象） */
function onPageScroll() {
  const show = Number.isFinite(window.scrollY) && window.scrollY > SCROLL_TOP_TRIGGER;
  if (show !== showGoTop.value) showGoTop.value = show;
}

/** wx.pageScrollTo({ duration: 300 }) → 平滑滚动 */
function goTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

<template>
  <div class="page">
    <div class="bg-glow"></div>

    <!-- 从行程页「知识详解 / 紧急」跳进来时才显示返回；从 tabBar 进来靠底部导航回去
         （主线 knowledge.wxml 的 showBack 就是这个口径，常驻会多出一个无处可去的入口） -->
    <div v-if="knowReturnTo === 'stay'" class="backbtn" @click="backTap()">
      <AppIcon name="arrow-left" :size="28" tone="i" />
      <span>{{ backLabel }}</span>
    </div>

    <!-- 刊头：与首页同一套编辑风，但更紧凑 -->
    <div class="masthead">
      <div class="mhead-top">
        <div class="brandline">
          <div class="brand-dot"></div>
          <span class="overline">Knowledge Base</span>
        </div>
        <span class="ver num">{{ total }} 条</span>
      </div>
      <div class="display">酒店知识库</div>
      <span class="tagline">住前看一眼，住时心里有数。每条都标注证据来源与风险等级。</span>
    </div>

    <!-- 等级图例 -->
    <div class="glass legend">
      <div class="leg-head">等级图例</div>
      <div class="leg-block">
        <div class="leg-t">证据来源<span class="leg-tag">方块</span></div>
        <div class="leg-items">
          <div v-for="m in eviList" :key="m.label" class="leg-i">
            <div class="dot sq" :class="m.tone"></div>{{ m.label }}
          </div>
        </div>
      </div>
      <div class="leg-block">
        <div class="leg-t">风险等级<span class="leg-tag">圆点</span></div>
        <div class="leg-items">
          <div v-for="m in riskList" :key="m.label" class="leg-i">
            <div class="dot" :class="m.tone"></div>{{ m.label }}
          </div>
        </div>
      </div>
      <div class="leg-note num">共 {{ total }} 条 · 按 {{ modCount }} 个模块分组</div>
    </div>

    <!-- 11 个模块 · 44 条：默认全部收起，首屏只看目录；手风琴式展开 -->
    <template v-for="(m, mi) in modules" :key="m.name">
      <div class="mod-head" :class="{ open: m.open }" @click="toggleModule(mi)">
        <span class="mod-idx num">{{ mi + 1 }}</span>
        <span class="grow mod-name">{{ m.name }}</span>
        <span class="risk-pill" :class="m.risk">{{ m.riskLabel }}</span>
        <span class="cnt num">{{ m.count }} 条</span>
        <div class="mod-chev" :class="{ rot: !m.open }"><AppIcon name="chevron-down" :size="26" tone="k" /></div>
      </div>

      <div v-if="m.open" :id="'mod-' + mi" class="glass card">
        <div v-for="(k, ii) in m.items" :key="k.id" class="entry">
          <div class="sum" @click="toggleEntry(mi, ii)">
            <div class="dot" :class="k.tone"></div>
            <span class="ktitle grow">{{ k.title }}</span>
            <span class="risk-pill" :class="k.tone">{{ k.riskLabel }}</span>
            <div v-if="k.review" class="review"><AppIcon name="alert-triangle" :size="22" tone="a" />复核</div>
            <div class="chev" :class="{ open: k.open }"><AppIcon name="chevron-down" :size="26" tone="k" /></div>
          </div>

          <template v-if="k.open">
            <div class="body">
              <div v-for="p in k.paras" :key="p.k" class="bpara">
                <template v-for="sg in p.segs" :key="sg.k">
                  <span v-if="sg.b" class="b">{{ sg.t }}</span>
                  <span v-else>{{ sg.t }}</span>
                </template>
              </div>
            </div>
            <div class="src">
              <div class="evi">
                <div class="dot sq" :class="k.eviTone"></div>
                <span>证据 {{ k.evi }}</span>
              </div>
              <span class="src-t">来源：{{ k.source }} · 核查于 {{ k.updated }}</span>
              <div v-if="revealedCopyId === k.id" class="copytxt">{{ k.copy }}</div>
              <div v-if="k.hasCopy" class="copybtn" @click="copyEntry(k.id)">
                <AppIcon name="copy" :size="22" tone="i" />{{ copiedId === k.id ? '已复制' : '复制话术' }}
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>

    <!-- 回到顶部 -->
    <div v-if="showGoTop" class="gotop" @click="goTop()" aria-label="回到顶部">
      <AppIcon name="chevron-up" :size="30" tone="d" />
    </div>
  </div>
</template>

<style scoped>
/* 知识库 —— Stitch 现代功能编辑风
   目录行是白卡；展开内容白卡；证据=方块、风险=圆点。 */

.page {
  padding: 0 16px calc(90px + env(safe-area-inset-bottom));
}

/* —— 返回行程 —— */
.backbtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 40px;
  margin: 10px 0 2px;
  padding: 0 11px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow);
  font-size: 12.5px;
  color: var(--ink);
}
.backbtn:active {
  opacity: 0.7;
}

/* —— 刊头 —— */
.masthead {
  padding: 12px 2px 4px;
}
.mhead-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.brandline {
  display: flex;
  align-items: center;
  gap: 5px;
}
.brand-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
}
.overline {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: var(--ink-3);
}
.ver {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 10px;
  font-weight: 600;
  color: var(--ink-3);
}
.display {
  font-size: 25px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: var(--ink);
}
.tagline {
  display: block;
  margin-top: 5px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ink-2);
}
.b {
  font-weight: 650;
  color: var(--ink);
}

/* —— 图例 —— */
.legend {
  margin-top: 11px;
  padding: 14px 14px 11px;
}
.leg-head {
  margin-bottom: 9px;
  font-size: 13px;
  font-weight: 650;
  color: var(--ink);
}
.leg-block + .leg-block {
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px solid var(--hairline);
}
.leg-t {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-2);
}
.leg-tag {
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-2);
  font-size: 9px;
  font-weight: 500;
  color: var(--ink-3);
}
.leg-items {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.leg-i {
  display: flex;
  align-items: center;
  padding: 3.5px 7px;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 11px;
  color: var(--ink-2);
}
.leg-note {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid var(--hairline);
  font-size: 10.5px;
  color: var(--ink-3);
}

/* —— 模块目录行 —— */
.mod-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 50px;
  margin: 6px 0;
  padding: 0 10px;
  border-radius: 9px;
  background: var(--surface);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow);
  transition: background 0.16s ease;
}
.mod-head.open {
  background: var(--surface-2);
  border-color: var(--line);
}
.mod-head:active {
  background: #fafbfd;
}
.mod-idx {
  flex-shrink: 0;
  width: 22px;
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-3);
  letter-spacing: 0.02em;
}
.mod-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cnt {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 500;
  color: var(--ink-3);
}
.mod-chev {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}
.mod-chev.rot {
  transform: rotate(-90deg);
}

/* —— 风险徽标 —— */
.risk-pill {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  height: 18px;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 9.5px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}
.risk-pill.high,
.risk-pill.red {
  background: var(--danger-soft);
  color: #b42318;
}
.risk-pill.mid,
.risk-pill.orange {
  background: var(--warning-soft);
  color: var(--accent-deep);
}
.risk-pill.low,
.risk-pill.slate {
  background: var(--surface-2);
  color: var(--ink-2);
}

/* —— 展开后的条目卡 —— */
.card {
  padding: 2px 12px;
  margin-bottom: 9px;
}
.entry {
  padding: 2px 0;
  border-bottom: 1px solid var(--hairline);
}
.entry:last-child {
  border-bottom: 0;
}
.sum {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 48px;
}
.sum:active {
  opacity: 0.7;
}
.ktitle {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.review {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--warning-soft);
  font-size: 9px;
  color: var(--accent-deep);
}
.chev {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding-left: 2px;
  color: var(--ink-3);
  transition: transform 0.2s;
}
.chev.open {
  transform: rotate(180deg);
}
.body {
  margin: 4px 0 9px;
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--ink-2);
}
.bpara {
  margin-bottom: 6px;
}
.src {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 7px;
  padding: 7px 0 10px;
  border-top: 1px solid var(--hairline);
  font-size: 10.5px;
  color: var(--ink-3);
}
.evi {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.src-t {
  flex: 1;
  min-width: 110px;
}
.copybtn {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  margin-left: auto;
  min-height: 36px;
  padding: 0 8px;
  border-radius: 5px;
  background: var(--surface-2);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ink);
}
.copybtn:active {
  opacity: 0.7;
}

/* 复制失败时展开的原文：必须可选，否则「请手动选择」是句空话 */
.copytxt {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--surface-2);
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ink-2);
  user-select: text;
  -webkit-user-select: text;
  word-break: break-word;
}

/* —— 回到顶部 —— */
.gotop {
  position: fixed;
  right: max(16px, calc((100vw - 480px) / 2 + 16px));
  bottom: calc(80px + env(safe-area-inset-bottom));
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
.gotop:active {
  opacity: 0.7;
}
</style>
