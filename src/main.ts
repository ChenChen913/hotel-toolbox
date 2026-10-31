import { createApp } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import { installWebStorage } from './platform';
import './styles/global.css';

// 把 engine 的 Storage 换成「带读修复 + 写失败提示」的浏览器实现。
// 必须早于任何数据读取（App 挂载时首页就会 listStays），所以放在最前面。
installWebStorage();

// registerType: 'autoUpdate' 已经在检测到新版本时自动接管并刷新，
// 这里不再手写 onNeedRefresh → location.reload()（重复刷新会在向导填写途中打断用户）。
registerSW({ immediate: true });

createApp(App).mount('#app');
