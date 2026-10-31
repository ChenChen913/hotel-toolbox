<script setup lang="ts">
// 自定义确认弹窗（对应小程序 components/modal）—— 替代 window.confirm，视觉与全站一致。
// z-index 1100 > 底部导航 1000；遮罩实色，不用 backdrop-filter。
//
// Web 端补充（主线在小程序里由平台兜住）：
//   · 遮罩拦截 touchmove，弹窗打开时背景不跟着滚（主线 catchtouchmove="noop"）；
//   · Esc = 取消，键盘可关；
//   · 打开时锁 body 滚动，关闭后还原。
import { onUnmounted, watch } from 'vue';

const props = withDefaults(defineProps<{
  show: boolean;
  title?: string;
  content?: string;
  cancelText?: string;
  confirmText?: string;
  /** 危险操作：确认按钮走 --red 实底 */
  danger?: boolean;
}>(), { title: '', content: '', cancelText: '取消', confirmText: '确定', danger: false });

const emit = defineEmits<{ cancel: []; confirm: [] }>();

function onKey(e: KeyboardEvent) {
  if (!props.show) return;
  if (e.key === 'Escape') emit('cancel');
  if (e.key === 'Enter') emit('confirm');
}

let prevOverflow = '';
watch(() => props.show, (v) => {
  if (typeof document === 'undefined') return;
  if (v) {
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
  } else {
    document.body.style.overflow = prevOverflow;
    window.removeEventListener('keydown', onKey);
  }
}, { immediate: true });

onUnmounted(() => {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = prevOverflow;
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div
    v-if="show"
    class="mask"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    @click="emit('cancel')"
    @touchmove.stop.prevent
  >
    <div class="dialog" @click.stop>
      <div class="dlg-title">{{ title }}</div>
      <div class="dlg-body">{{ content }}</div>
      <div class="dlg-foot">
        <div class="dlg-btn plain" @click="emit('cancel')">{{ cancelText }}</div>
        <div class="dlg-btn" :class="{ danger }" @click="emit('confirm')">{{ confirmText }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 28px;
  background: rgba(15, 23, 42, 0.48);
  animation: m-fade 0.18s ease both;
}
.dialog {
  width: 100%;
  max-width: 310px;
  padding: 20px 18px 15px;
  border-radius: 14px;
  background: #ffffff;
  border: 1px solid var(--glass-border);
  box-shadow: 0 20px 50px -15px rgba(15, 23, 42, 0.45);
  animation: m-pop 0.2s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
.dlg-title { font-size: 17px; font-weight: 700; letter-spacing: -0.15px; color: var(--ink); margin-bottom: 7px; }
.dlg-body { font-size: 13.5px; line-height: 1.65; color: var(--ink-2); margin-bottom: 17px; }
.dlg-foot { display: flex; gap: 8px; }
.dlg-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  border-radius: 8px;
  font-size: 14.5px;
  font-weight: 600;
  background: var(--primary);
  color: #ffffff;
  cursor: pointer;
  transition: opacity 0.14s ease;
}
.dlg-btn.plain { background: var(--surface-2); color: var(--ink-2); border: 1px solid transparent; }
.dlg-btn.danger { background: var(--red); color: #ffffff; }
.dlg-btn:active { opacity: 0.85; }

@keyframes m-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes m-pop {
  from { opacity: 0; transform: translateY(8px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
