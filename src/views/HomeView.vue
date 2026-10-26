<script setup lang="ts">
// 首页 —— 源实现 src/components/HomeView.vue
// 刊头 / 空状态 / 统计条 / 行程列表。
//
// 与源实现的差异（仅平台导致的）：
//   1. 「本机浏览器」→「本机」：小程序里没有浏览器（已与用户确认，见 PROGRESS.md 决策 3）。
//   2. 备份与恢复搬到「我的」页（E1）：原先藏在首页最底部的折叠块里，发现率太低，
//      而隐私/协议类内容必须有一个稳定入口，故统一收拢到「我的」。
//
// 扩展层（core/extra.ts）的接入点：行程卡的关系标签、复制上次、清单排序。

import { onMounted, ref } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import { listStays, newStay, saveStay } from '../engine';
import { buildPrepExt, getStayExt, prepStats, setStayExt, sortItemsExt } from '../extra';
import type { Stay } from '../types';
import { APP_VERSION, fmtDate, goWizard, openStay, stayPhaseLabel } from '../store';

/** 版本号：与 package.json / 「我的」页保持一致（store 已导出，不再另写） */
const version = APP_VERSION;

interface StayVM {
  id: string;
  no: string;
  dateLabel: string;
  nights: number;
  meta: string;
  /** 行程卡上的摘要标签（住宿目的 / 关系 / 儿童 / 老人） */
  tags: string[];
  done: number;
  total: number;
  pct: number;
  phase: string;
}

function toVM(s: Stay, idx: number): StayVM {
  // 走扩展层的排序：源 sortItems 用 CAT_ORDER，遇到「娱乐 / 学习」会得到 -1 排到最前
  const items = sortItemsExt([...s.prep, ...s.custom]);
  // 进度口径与行程页 splitByQty 一致（prepStats）：qty = 0 的项不算「已备齐」分母
  const { done, total } = prepStats(items);
  const tags: string[] = [s.conditions.purpose];
  // 住宿关系存在扩展层；默认值「家人」不显示（省得每张卡都挂一个没信息量的词）
  const ext = getStayExt(s.id);
  if (ext && ext.relation !== '家人') tags.push(ext.relation);
  if (s.conditions.children) tags.push(`${s.conditions.children} 个儿童`);
  if (s.conditions.elderly) tags.push('有老人');
  return {
    id: s.id,
    no: String(idx + 1).padStart(2, '0'),
    dateLabel: fmtDate(s.date),
    nights: s.nights,
    meta: tags.join(' · '),
    tags,
    done,
    total,
    pct: total ? Math.round((done * 100) / total) : 0,
    phase: stayPhaseLabel(s) || '',
  };
}

const stays = ref<StayVM[]>([]);
const hasStays = ref(false);
const totalNights = ref(0);
const avgPacked = ref(0);

function reload() {
  const sorted = [...listStays()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // 统计条的平均备齐率与单卡进度同一口径（prepStats，qty = 0 不进分母）
  const { done, total } = prepStats(sorted.flatMap(s => [...s.prep, ...s.custom]));
  stays.value = sorted.map(toVM);
  hasStays.value = sorted.length > 0;
  totalNights.value = sorted.reduce((n, s) => n + s.nights, 0);
  avgPacked.value = total ? Math.round((done * 100) / total) : 0;
}

// 小程序 onShow → onMounted：视图切换会重建组件，等价于 onShow
onMounted(reload);

/** 复制上次：用第一条行程的 conditions 重新生成清单，custom 深拷贝后全部重置为未勾选 */
function copyLast() {
  const last = [...listStays()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!last) return;
  // 带上扩展层维度（住宿关系 / 培训学习）：否则「复制上次」会悄悄丢掉棋牌、学习资料这些物品，
  // 而用户的预期是「照上次再来一次」。
  const ext = getStayExt(last.id);
  const s = newStay(last.conditions, buildPrepExt({ ...last.conditions, ...(ext || {}) }));
  s.custom = JSON.parse(JSON.stringify(last.custom)) as typeof s.custom;
  s.custom.forEach(i => {
    i.done = false;
  });
  saveStay(s);
  if (ext) {
    // 退房押金勾选属于上一次行程，不能复制到新行程
    const { checkoutExtra, ...copyExt } = ext;
    setStayExt(s.id, copyExt);
  }
  openStay(s.id);
}
</script>

<template>
  <div class="page">
    <!-- 全局背景层：fixed 铺满视口，避免第一屏之外的渐变接缝 -->
    <div class="bg-glow"></div>

    <!-- 刊头：编辑风，无底色卡片 -->
    <div class="masthead">
      <div class="mhead-top">
        <div class="brandline">
          <div class="brand-dot"></div>
          <span class="overline">Hotel Stay Toolbox</span>
        </div>
        <span class="ver num">v{{ version }}</span>
      </div>
      <div class="display">酒店入住工具箱</div>
      <div class="gold-rule"></div>
      <span class="tagline">让每一次入住，都少一点遗漏，多一点准备</span>

      <div class="btn createbtn" @click="goWizard()">
        <div class="createbtn-icon"><AppIcon name="plus" :size="30" tone="c" /></div>
        <div class="grow createbtn-text">
          <span class="createbtn-title">创建一次入住</span>
          <span class="createbtn-sub">按人数、晚数与偏好生成清单</span>
        </div>
        <AppIcon name="chevron-right" :size="30" tone="c" />
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="!hasStays" class="empty">
      <span class="empty-line">旅程，从一次从容的入住开始</span>
      <span class="muted">回答几个小问题，生成这次入住的准备清单（含数量）</span>
      <span class="muted dim">数据只保存在本机</span>
    </div>

    <template v-if="hasStays">
      <!-- 统计条 -->
      <div class="statrow glass">
        <div class="stat">
          <span class="statlabel">入住次数</span>
          <div class="statv"><span class="num">{{ stays.length }}</span><span class="statunit">次</span></div>
        </div>
        <div class="vsep"></div>
        <div class="stat">
          <span class="statlabel">累计晚数</span>
          <div class="statv"><span class="num">{{ totalNights }}</span><span class="statunit">晚</span></div>
        </div>
        <div class="vsep"></div>
        <div class="stat">
          <span class="statlabel">平均备齐率</span>
          <div class="statv"><span class="num stataccent">{{ avgPacked }}</span><span class="statunit stataccent">%</span></div>
        </div>
      </div>

      <!-- 区块头 + 复制上次 -->
      <div class="sechead">
        <div class="sechead-l">
          <AppIcon name="calendar-days" :size="28" tone="i" />
          <span class="sec-label sec-label-inline">最近的入住</span>
        </div>
        <div class="copylink" @click="copyLast">
          <AppIcon name="copy" :size="22" tone="i" />
          <span>复制上次</span>
        </div>
      </div>

      <!-- 行程卡 -->
      <div v-for="item in stays" :key="item.id" class="staycard glass" @click="openStay(item.id)">
        <div class="key num">{{ item.no }}</div>
        <div class="grow sc-main">
          <div class="sc-top">
            <span class="sc-date num">{{ item.dateLabel }}</span>
            <span v-if="item.phase" class="phase">{{ item.phase }}</span>
          </div>
          <div class="sc-sub">{{ item.nights }} 晚 · {{ item.meta }}</div>
          <div class="tags">
            <span v-for="t in item.tags" :key="t" class="stag">{{ t }}</span>
          </div>
          <div class="sc-foot">
            <div class="miniline"><div class="miniline-in" :style="{ width: item.pct + '%' }"></div></div>
            <div class="sc-count">
              <span class="tiny num">{{ item.done }} / {{ item.total }} 已备齐</span>
              <AppIcon name="chevron-right" :size="24" tone="k" />
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 常驻提示：首页明确告知数据只存本机 -->
    <div class="localnote">
      <AppIcon name="shield" :size="24" tone="k" />
      <span>数据只保存在本机 · 不上传、不联网</span>
    </div>
  </div>
</template>

<style scoped>
/* 首页 —— Stitch 现代功能编辑风
   冷灰白底、白卡、深海军蓝主按钮、琥珀强调。 */

.page {
  padding: 0 16px calc(90px + env(safe-area-inset-bottom));
}

/* —— 刊头 —— */
.masthead {
  padding: 14px 2px 4px;
}
.mhead-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 7px;
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
  display: block;
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
  display: block;
  font-size: 27px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: var(--ink);
}
.gold-rule {
  display: block;
  width: 100%;
  height: 1px;
  margin: 9px 0 8px;
  background: var(--glass-border);
}
.tagline {
  display: block;
  margin-bottom: 13px;
  font-size: 13.5px;
  color: var(--ink-2);
  letter-spacing: 0.01em;
}

/* 主按钮：黑色大行动区 */
.createbtn {
  min-height: 62px;
  padding: 0 11px;
  border-radius: 11px;
  gap: 8px;
  box-shadow: 0 8px 17px -10px rgba(15, 23, 42, 0.5);
}
.createbtn:active {
  background: var(--primary-press);
}
.createbtn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 33px;
  height: 33px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
}
.createbtn-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.createbtn-title {
  font-size: 15.5px;
  font-weight: 650;
  line-height: 1.2;
  color: #ffffff;
}
.createbtn-sub {
  font-size: 10.5px;
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.62);
}

/* —— 空状态 —— */
.empty {
  text-align: left;
  padding: 22px 18px;
  margin-top: 14px;
}
.empty-line {
  display: block;
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.15px;
  color: var(--ink);
  margin-bottom: 5px;
}
.empty .muted {
  display: block;
  margin: 4px 0;
  font-size: 13px;
}
.empty .dim {
  opacity: 0.8;
  font-size: 11.5px;
}

/* —— 统计条 —— */
.statrow {
  display: flex;
  align-items: stretch;
  padding: 13px 4px 12px;
  margin: 16px 0 4px;
}
.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.statlabel {
  font-size: 10.5px;
  color: var(--ink-3);
  letter-spacing: 0.02em;
}
.statv {
  display: flex;
  align-items: baseline;
  gap: 1.5px;
}
.stat .num {
  font-size: 22px;
  line-height: 1.1;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: -0.5px;
}
.statunit {
  font-size: 10px;
  color: var(--ink-3);
}
.stataccent {
  color: var(--accent-deep) !important;
}
.vsep {
  width: 1px;
  margin: 4px 0;
  background: var(--hairline);
}

/* —— 区块头 —— */
.sechead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 20px 1px 7px;
}
.sechead-l {
  display: flex;
  align-items: center;
  gap: 5px;
}
.sec-label-inline {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  color: var(--ink);
}
.copylink {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 40px;
  padding: 0 9px;
  border-radius: 6px;
  background: var(--surface-2);
  font-size: 11.5px;
  color: var(--ink-2);
}
.copylink:active {
  opacity: 0.7;
}

/* —— 行程卡 —— */
.staycard {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 13px 12px;
  margin: 8px 0;
  border-radius: 11px;
}
.staycard:active {
  background: #fafbfd;
}
.key {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #ffffff;
  background: var(--primary);
}
.sc-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sc-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
}
.sc-date {
  font-size: 15.5px;
  line-height: 1.3;
  font-weight: 650;
  color: var(--ink);
  letter-spacing: -0.15px;
}
.phase {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent-deep);
  background: var(--accent-soft);
  white-space: nowrap;
}
.sc-sub {
  margin-top: 1px;
  font-size: 11px;
  color: var(--ink-3);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}
.stag {
  display: inline-flex;
  align-items: center;
  height: 19px;
  padding: 0 6px;
  border-radius: 3.5px;
  background: var(--surface-2);
  font-size: 10px;
  color: var(--ink-2);
  white-space: nowrap;
}
.sc-foot {
  margin-top: 9px;
}
.miniline {
  height: 4px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}
.miniline-in {
  height: 100%;
  border-radius: 999px;
  background: var(--primary);
  transition: width 0.3s ease;
}
.sc-count {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}
.sc-count .tiny {
  font-size: 10.5px;
  color: var(--ink-3);
}

/* 常驻「数据只保存在本机」提示 */
.localnote {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin: 14px 0 0;
  padding: 9px 10px;
  border-radius: 7px;
  background: var(--surface);
  border: 1px solid var(--glass-border);
  font-size: 11px;
  color: var(--ink-3);
}
</style>
