// ui.ts —— 全局轻提示（对应小程序各页的 toastShow / toastText + 定时器）
//
// 小程序里每个页面各自持有 toastShow / toastText，由页面 onShow 之外的手动定时器关闭。
// Web 端没有页面实例这一层，收敛成一个全局浮窗：调用 showToast 即可，
// 时长仍用 core 口径 TOAST_MS（1500ms，历史见 src/toast.ts 注释）。

import { ref } from 'vue';
import { TOAST_MS } from './toast';

export const toastShow = ref(false);
export const toastText = ref('');

// 不写 window.setTimeout：node（vitest）里没有 window，
// 而 showToast 也被 platform 的写失败分支调用，必须能在非浏览器环境下跑。
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string): void {
  toastText.value = text;
  toastShow.value = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    toastShow.value = false;
  }, TOAST_MS);
}
