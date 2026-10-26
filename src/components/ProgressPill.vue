<script setup lang="ts">
// ProgressPill —— 进度卡（对应小程序 components/progress-pill）
// 行程页三处复用：准备「已备齐」、入住/退房「已完成」。
// title 为空时回退到 label（与小程序 observers 里的 head 同口径）。
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  done: number;
  total: number;
  label?: string;
  /** 卡片标题（准备段「打包完成度」/ 入住段「入住检查」…）；为空时回退到 label */
  title?: string;
}>(), { label: '', title: '' });

const pct = computed(() => (props.total ? Math.round((props.done * 100) / props.total) : 0));
const head = computed(() => props.title || props.label);
</script>

<template>
  <div class="pill">
    <div class="pill-head">
      <span class="pill-title">{{ head }}</span>
      <span class="pill-pct num">{{ pct }}%</span>
    </div>
    <div class="prog"><div class="fill" :style="{ width: pct + '%' }"></div></div>
    <div class="text"><span class="dn num">{{ done }}</span><span class="sl"> / {{ total }} {{ label }}</span></div>
  </div>
</template>

<style scoped>
.pill {
  margin: 10px 0 4px;
  padding: 13px 14px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow);
}
.pill-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.pill-title { font-size: 14px; font-weight: 600; color: var(--ink); }
.pill-pct { font-size: 17px; font-weight: 700; color: var(--ink); letter-spacing: -0.25px; }
.prog { height: 5px; margin-top: 9px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.fill { height: 100%; border-radius: 999px; background: var(--primary); transition: width 0.24s ease-out; }
.text { margin-top: 7px; font-size: 11px; color: var(--ink-3); }
.dn { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.sl { color: var(--ink-3); }
</style>
