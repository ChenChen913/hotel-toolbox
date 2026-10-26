<script setup lang="ts">
// 图标组件 —— 对应小程序 components/icon
// 图标本体是小程序端 tools/gen-icons.py 生成的 base64 SVG（styles/icons.css），
// 颜色由 class 后缀决定（''=ink-2 / i=ink / k=ink-3 / p=primary / d=primary-deep
// / g=amber-deep / a=amber / c=white / r=danger / e=success / b=blue / v=violet），
// 不能靠 color 继承，因为 background-image 里的 SVG 拿不到外部 CSS 变量。
//
// size 沿用小程序口径（rpx），渲染时 ÷2 换成 px。
import { computed } from 'vue';

const props = withDefaults(defineProps<{ name: string; size?: number; tone?: string }>(), {
  name: '',
  size: 36,
  tone: '',
});

const cls = computed(() => `ic ic-${props.name}${props.tone ? `-${props.tone}` : ''}`);
const box = computed(() => `${props.size / 2}px`);
</script>

<template>
  <span :class="cls" :style="{ width: box, height: box }" aria-hidden="true"></span>
</template>
