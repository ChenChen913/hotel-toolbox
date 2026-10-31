// 应用状态（无路由库：六个视图 + 四 tab 足够 —— 与小程序端页面结构一一对应）
import { ref } from 'vue';
import type { Stage, Stay } from './types';
import { deleteStay as engineDelete, getStay, saveStay } from './engine';

/** home / gear / know / mine 是四个 tab 页；wizard / stay 是在 tab 之外打开的页面 */
export const view = ref<'home' | 'wizard' | 'stay' | 'know' | 'gear' | 'mine'>('home');
export const stage = ref<Stage>('prep');
export const currentStay = ref<Stay | null>(null);
/** 知识库锚点：指定模块名时，知识库打开后滚动到该模块并展开 */
export const knowModule = ref<string | null>(null);
export const knowReturnTo = ref<'stay' | null>(null);
/** 页面级弹层（好物抽屉 / 确认弹窗）打开时隐藏底部通栏导航，对应小程序 setTabBarHidden */
export const tabBarHidden = ref(false);

export function scrollTop() { window.scrollTo({ top: 0 }); }

export function setTabBarHidden(hidden: boolean) { tabBarHidden.value = hidden; }

/** 按日期推断当前阶段（聊02 定稿：系统自动把用户带到当前阶段） */
export function suggestedStage(s: Pick<Stay, 'date' | 'nights'>): Stage {
  if (!s.date) return 'prep';
  const [y, m, d] = s.date.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + s.nights - 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today < start) return 'prep';
  if (today <= end) return 'checkin';
  return 'checkout';
}

/** 首页卡片上的阶段徽标文案（不在期内则不显示） */
export function stayPhaseLabel(s: Stay): string | null {
  if (!s.date) return null;
  const [y, m, d] = s.date.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + s.nights - 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today < start) return `还有 ${Math.ceil((+start - +today) / 86400000)} 天入住`;
  if (today <= end) return '入住中';
  return null;
}

export function openStay(id: string, afterCreate = false) {
  currentStay.value = getStay(id);
  // 新建保存后恒落「准备」：用户下一步是收拾行李，不是立刻做入住检查。
  // （主线 wizard.ts 保存后是 redirectTo(...&stage=prep)，stay.ts 对 stage=prep 强制取值；
  //   之前这里按日期推断，当天入住的新行程会直接跳到「入住检查」，与主线相反。）
  // 重新打开旧行程时才按日期自动定位。
  stage.value = afterCreate ? 'prep'
                            : (currentStay.value ? suggestedStage(currentStay.value) : 'prep');
  view.value = 'stay';
  scrollTop();
}
export function goHome() { knowReturnTo.value = null; view.value = 'home'; scrollTop(); }
export function goKnowledge() { knowReturnTo.value = null; knowModule.value = null; view.value = 'know'; scrollTop(); }
export function goWizard() { view.value = 'wizard'; scrollTop(); }
export function goGear() { knowReturnTo.value = null; view.value = 'gear'; scrollTop(); }
export function goMine() { knowReturnTo.value = null; view.value = 'mine'; scrollTop(); }
export function backToStay() { knowReturnTo.value = null; view.value = 'stay'; scrollTop(); }
/** 打开知识库并定位到指定模块（紧急入口、检查组互链共用）；from='stay' 时提供返回键 */
export function goKnowledgeModule(module: string, from?: 'stay') {
  knowModule.value = module;
  if (from) knowReturnTo.value = from;
  view.value = 'know';
  scrollTop();
}
export function persist() { if (currentStay.value) saveStay(currentStay.value); }
export function removeCurrentStay() {
  if (currentStay.value) engineDelete(currentStay.value.id);
  currentStay.value = null;
  goHome();
}

/** '2026-10-03' → '10月3日 · 周六'（手动解析避免 UTC 时区偏移） */
export function fmtDate(date: string): string {
  if (!date) return '未填日期';
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${m}月${d}日 · 周${'日一二三四五六'[dt.getDay()]}`;
}

/** 与小程序端一致的版本号口径：构建期从 package.json 注入，避免手改漂移 */
export const APP_VERSION = __APP_VERSION__;

/**
 * 清空数据后重置会话态（不改变当前视图）。
 * 不清的话 currentStay 仍指向已删除的行程，之后任何 persist() 都会把它写回 storage。
 */
export function clearSession() {
  currentStay.value = null;
  knowModule.value = null;
  knowReturnTo.value = null;
  stage.value = 'prep';
}
