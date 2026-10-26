<script setup lang="ts">
// 轻提示（对应小程序 components/toast）
// 常驻节点 + opacity/transform 切换，进退场都有动画；pointer-events:none 不挡操作。
// 显隐由 ui.ts 的 showToast 控制，时长 TOAST_MS。
import AppIcon from './AppIcon.vue';

defineProps<{ show: boolean; text: string }>();
</script>

<template>
  <div class="toast" :class="{ on: show }" role="alert">
    <div class="toast-ic"><AppIcon name="check" :size="24" tone="c" /></div>
    <span class="toast-t">{{ text }}</span>
  </div>
</template>

<style scoped>
/* z-index 1050：底栏 1000 / 回到顶部 950 之上，模态 1100 之下 */
.toast {
  position: fixed;
  left: 50%;
  bottom: 110px;
  z-index: 1050;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100vw - 48px);
  padding: 9px 13px 9px 9px;
  border-radius: 999px;
  background: #0f172a;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 12px 25px -9px rgba(15, 23, 42, 0.5);
  font-size: 12.5px;
  line-height: 1.45;
  color: #ffffff;
  opacity: 0;
  transform: translate(-50%, 12px);
  transition: opacity 0.2s ease, transform 0.2s ease;
  pointer-events: none;
}
.toast.on { opacity: 1; transform: translate(-50%, 0); }
.toast-ic {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
}
.toast-t { white-space: normal; }
</style>
