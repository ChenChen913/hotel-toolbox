<script setup lang="ts">
// 底部通栏导航（对应小程序 custom-tab-bar）
// 白底、顶部 1px 分隔线、4 等分、图标在上文字在下、选中深色 + 顶部短横线。
// 只在四个 tab 页显示；wizard / stay 这类二级页面不显示。
import AppIcon from './AppIcon.vue';
import { goGear, goHome, goKnowledge, goMine } from '../store';

const props = defineProps<{ selected: number }>();

interface TabItem { text: string; icon: string; go: () => void }
const TABS: TabItem[] = [
  { text: '行程', icon: 'house', go: goHome },
  { text: '好物', icon: 'luggage', go: goGear },
  { text: '知识库', icon: 'book-open', go: goKnowledge },
  { text: '我的', icon: 'circle-user', go: goMine },
];

function onTab(i: number) {
  if (i === props.selected) return;
  TABS[i].go();
}
</script>

<template>
  <div class="tbwrap">
    <div class="navbar">
      <div
        v-for="(t, i) in TABS"
        :key="t.text"
        class="tab"
        :class="{ on: selected === i }"
        @click="onTab(i)"
      >
        <AppIcon :name="t.icon" :size="40" :tone="selected === i ? 'd' : ''" />
        <span class="tbtext">{{ t.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tbwrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  background: #ffffff;
  border-top: 1px solid #e4e9f1;
  padding-bottom: env(safe-area-inset-bottom);
}
.navbar { display: flex; align-items: stretch; height: 52px; padding: 0 6px; max-width: 480px; margin: 0 auto; }
.tab {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: #94a3b8;
  cursor: pointer;
}
/* 选中项：顶部短横线 + 深色图标文字 */
.tab.on::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  width: 18px;
  height: 2px;
  margin-left: -9px;
  border-radius: 0 0 2px 2px;
  background: #0f172a;
}
.tbtext { font-size: 10px; line-height: 1.2; font-weight: 500; letter-spacing: 0.02em; }
.tab.on { color: #0f172a; }
.tab.on .tbtext { font-weight: 600; }
</style>
