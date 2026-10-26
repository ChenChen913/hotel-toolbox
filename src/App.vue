<script setup lang="ts">
// 应用外壳（对应小程序 app.json 的 6 个页面 + 自绘 tabBar）
// 四个 tab 页：home / gear / know / mine；两个二级页：wizard / stay（不显示底栏）。
// 视图切换用 key 强制重建，等价小程序的页面 onShow 重新加载。
import { computed } from 'vue';
import { tabBarHidden, view } from './store';
import { toastShow, toastText } from './ui';
import AppToast from './components/AppToast.vue';
import TabBar from './components/TabBar.vue';
import HomeView from './views/HomeView.vue';
import WizardView from './views/WizardView.vue';
import StayView from './views/StayView.vue';
import KnowledgeView from './views/KnowledgeView.vue';
import GearView from './views/GearView.vue';
import MineView from './views/MineView.vue';

const VIEWS = {
  home: HomeView,
  wizard: WizardView,
  stay: StayView,
  know: KnowledgeView,
  gear: GearView,
  mine: MineView,
} as const;

const TAB_INDEX: Record<string, number> = { home: 0, gear: 1, know: 2, mine: 3 };
const isTab = computed(() => Object.prototype.hasOwnProperty.call(TAB_INDEX, view.value));
const selected = computed(() => TAB_INDEX[view.value] ?? 0);
</script>

<template>
  <div :class="{ tabpage: isTab }">
    <component :is="VIEWS[view]" :key="view" />
  </div>

  <TabBar v-if="isTab && !tabBarHidden" :selected="selected" />
  <AppToast :show="toastShow" :text="toastText" />
</template>
