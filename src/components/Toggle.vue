<script setup lang="ts">
// Toggle —— 开关（对应小程序 components/toggle）
// 视觉 46×26，滑块 22px，开启时深海军蓝底、滑块右移 22px。
// 自身不保存状态，点击后 emit('change', !value)。
defineProps<{ value: boolean }>();
const emit = defineEmits<{ change: [value: boolean] }>();
</script>

<template>
  <div class="switch" :class="{ on: value }" role="switch" :aria-checked="value" @click.stop="emit('change', !value)">
    <div class="knob"></div>
  </div>
</template>

<style scoped>
.switch {
  position: relative;
  flex-shrink: 0;
  width: 46px;
  height: 26px;
  margin: 9px 0;
  border-radius: 999px;
  background: #d8dfe9;
  transition: background 0.2s ease;
  cursor: pointer;
}
.switch.on { background: var(--primary); }
.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.22);
  transition: transform 0.2s ease;
}
.switch.on .knob { transform: translateX(22px); }
</style>
