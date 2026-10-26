<script setup lang="ts">
// Stepper —— 步进器（对应小程序 components/stepper）
// 方形减号 + 数值 + 方形加号 + 单位；到达 min/max 时对应按钮禁用。
// 自身不保存状态：改值后 emit('change', v)，由父级决定是否回写（单向数据流）。
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';

const props = withDefaults(defineProps<{
  value?: number;
  min?: number;
  max?: number;
  unit?: string;
}>(), { value: 1, min: 1, max: 99, unit: '' });

const emit = defineEmits<{ change: [value: number] }>();

const minusOff = computed(() => props.value <= props.min);
const plusOff = computed(() => props.value >= props.max);

function onStep(d: number) {
  const next = Math.max(props.min, Math.min(props.max, props.value + d));
  if (next === props.value) return;
  emit('change', next);
}
</script>

<template>
  <div class="stepper">
    <div class="stwrap" @click.stop="onStep(-1)">
      <div class="st" :class="{ off: minusOff }">
        <AppIcon name="minus" :size="28" :tone="minusOff ? 'k' : 'd'" />
      </div>
    </div>
    <div class="valwrap" @click.stop>
      <span class="val num">{{ value }}</span>
      <span v-if="unit" class="unit">{{ unit }}</span>
    </div>
    <div class="stwrap" @click.stop="onStep(1)">
      <div class="st" :class="{ off: plusOff }">
        <AppIcon name="plus" :size="28" :tone="plusOff ? 'k' : 'd'" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 视觉按钮 32px 方形浅底；外层 44px 透明热区保证触摸目标 */
.stepper { display: flex; align-items: center; flex-shrink: 0; }
.stwrap { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; }
.st {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid transparent;
  transition: transform 0.14s ease, background 0.14s ease;
}
.stwrap:active .st { transform: scale(0.92); background: var(--surface-3); }
.st.off { opacity: 0.38; }
.valwrap { display: flex; align-items: baseline; justify-content: center; min-width: 32px; margin: 0 1px; }
.val { min-width: 18px; text-align: center; font-size: 17px; font-weight: 600; color: var(--ink); line-height: 1; }
.unit { margin-left: 2px; font-size: 11px; color: var(--ink-3); }
</style>
