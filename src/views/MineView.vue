<script setup lang="ts">
// 我的 —— 新建页面（源项目没有这一页；CHANGE-REQUESTS §11.3 / DEV-PLAN E1）。
//
// 定位：备份与恢复 / 关于 / 清空全部数据。
// 「备份与恢复」是从首页底部那个折叠块搬过来的 —— 那里发现率极低，
// 而隐私与协议类内容又必须有一个稳定入口（提审必查项）。
//
// M18 去重：数据概况卡已删（入住次数 / 晚数 / 平均备齐与首页统计条一模一样，
//           只显示一次 —— 留在首页）；偏好设置卡已删（老板拍板没用，改默认值
//           没有直接反馈，向导里本来就能按行程选）。
//
// 🔴 三条原则：
//   1. 绝不放账号登录 / 手机号 / 头像 / 昵称。本工具零账号、零网络、零埋点，
//      这是它的产品优势，不能自己毁掉。
//   2. 这一页不发任何网络请求，展示的全是本机数据。
//   3. 「清空全部数据」不可逆，必须走自绘二次确认弹窗（P0-6），不用原生 confirm。
//
// 平台差异（Web 端）：小程序用剪贴板传 JSON，浏览器没有等价体验，
// 改成「下载备份文件 / 选择备份文件导入」—— 提示文案里的「剪贴板」相应改成「备份文件」。

import { ref } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import AppModal from '../components/AppModal.vue';
import { DISCLAIMER } from '../data';
import { Storage, listStays } from '../engine';
import { exportDataExt, importDataExt } from '../extra';
import { lineParas, toParas } from '../rich';
import type { Para } from '../rich';
import { APP_VERSION, setTabBarHidden } from '../store';

/** 版本号：与 package.json 的 version 保持一致，改版本只改这两处 */
const version = APP_VERSION;

/**
 * 「清空全部数据」要清的 key。
 * 刻意逐个列出、不用「清空整个 localStorage」一把清空：那会把同一域名下
 * 其它页面的数据一并清掉，属于越权操作。
 */
const OWN_KEYS = [
  'htb_stays_v1',      // 行程
  'htb_stays_v1_corrupt', // 读修复隔离的损坏存储原文（core/platform.ts 存档，一并清掉）
  'htb_gear_v5',       // 好物（当前版本）
  'htb_gear_v4',       // 好物旧版（迁移残留）
  'htb_gear_v3',       // 好物旧版（迁移残留）
  'htb_ui_collapsed_v2', // 分组折叠状态（UI 层，v2 起按行程隔离）
  'htb_ui_collapsed_v1', // 旧版折叠状态（v1 全局共享，已废弃，清掉残留）
  'htb_ui_paneh_v1',    // 各段内容高度缓存（M17 首进提速，按行程隔离）
  'htb_ext_v1',        // 扩展层：住宿关系 / 培训学习
];

// —— 卡片 1 · 备份与恢复 ——
const backupMsg = ref('');
/** 等待确认导入的备份原文（用户选中文件后先存着，确认弹窗点了才真导入） */
const importText = ref('');
/** 隐藏的文件选择框：点「导入备份」时由代码触发，浏览器才会弹选择器 */
const fileInput = ref<HTMLInputElement | null>(null);

// —— 卡片 2 · 关于 ——
const discTitle = DISCLAIMER.title;
// 免责声明 4 条是「一行一条」，用 lineParas（与知识库顶部那份完全同源）
const discLines: Para[] = lineParas(DISCLAIMER.lines);
const discTriggers: Para[] = toParas(DISCLAIMER.triggers);
const discOpen = ref(false);
const privacyOpen = ref(false);

/** P0-6 自绘确认弹窗 */
interface ModalState {
  show: boolean;
  title: string;
  content: string;
  confirmText: string;
  danger: boolean;
}
const modal = ref<ModalState>({ show: false, title: '', content: '', confirmText: '确定', danger: false });

/** 当前弹窗对应哪个操作：'' | 'import' | 'clear'。放 ref 外，避免无谓的视图重渲 */
let modalAction: '' | 'import' | 'clear' = '';

// —— 卡片 2 · 关于（折叠用 v-if 直接切，不做高度动画）——
function toggleDisc() {
  discOpen.value = !discOpen.value;
}

function togglePrivacy() {
  privacyOpen.value = !privacyOpen.value;
}

/** 备份文件名带上导出时刻，导多份也不会互相覆盖 */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// —— 卡片 1 · 备份与恢复（自首页搬来，逻辑不变）——
function doExport() {
  // 下载必须由用户点击触发（06 §2 R3），不能放到 onMounted 里。
  // exportDataExt = 源备份结构 + ext 段（住宿关系 / 培训学习），少了 ext 会静默丢数据。
  try {
    const blob = new Blob([exportDataExt()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hotel-toolbox-backup-${stamp()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    backupMsg.value = '已导出备份文件';
  } catch {
    backupMsg.value = '导出失败，请重试';
  }
}

/** 点「导入备份」= 打开系统文件选择器 */
function doImport() {
  fileInput.value?.click();
}

/**
 * 导入：覆盖是不可逆的（会整体替换本机行程与好物），故先二次确认。
 * 与「删除行程」「清空数据」保持一致的确认策略（02 §6「删除确认」）。
 */
async function onFilePicked(e: Event) {
  const el = e.target as HTMLInputElement;
  const file = el.files && el.files[0];
  // 清空 value，才能连续两次选同一个文件
  el.value = '';
  if (!file) return;

  let text = '';
  try {
    text = await file.text();
  } catch {
    backupMsg.value = '读取备份文件失败，请重试';
    return;
  }
  if (!text.trim()) {
    backupMsg.value = '备份文件是空的，请重新选择备份文件再点导入';
    return;
  }
  const cur = listStays().length;
  modalAction = 'import';
  setTabBarHidden(true);
  importText.value = text;
  modal.value = {
    show: true,
    title: '导入备份',
    content: cur
      ? `导入会覆盖本机现有的 ${cur} 个行程与全部好物，确定继续？`
      : '导入会覆盖本机现有的全部数据，确定继续？',
    confirmText: '覆盖导入',
    danger: true,
  };
}

function runImport() {
  const text = importText.value;
  try {
    // importDataExt = 源 importData（校验 app 字段、非法即抛）+ 扩展段回写
    const r = importDataExt(text);
    backupMsg.value = `已导入 ${r.stays} 个行程、${r.gear} 组好物`;
  } catch (err) {
    // 非法 JSON 要给友好提示，不能把 SyntaxError 原文丢给用户
    const msg = err instanceof SyntaxError
      ? '备份文件不是有效的备份 JSON'
      : (err instanceof Error ? err.message : '导入失败');
    backupMsg.value = msg;
  }
}

// —— 危险区 · 清空全部数据 ——
function askClear() {
  modalAction = 'clear';
  setTabBarHidden(true);
  modal.value = {
    show: true,
    title: '清空全部数据',
    content: '会删掉本机所有行程、好物与个性化设置，且无法恢复。建议先导出备份。',
    confirmText: '全部清空',
    danger: true,
  };
}

function clearAll() {
  // 走 engine 的 Storage（Web 下已被 platform.ts 换成 localStorage），
  // 而不是直接调 localStorage.removeItem —— 这样 node 测试里也能跑同一套逻辑。
  OWN_KEYS.forEach((k: string) => Storage.removeItem(k));
  backupMsg.value = '已清空本机全部数据';
  importText.value = '';
}

function onModalConfirm() {
  const action = modalAction;
  modalAction = '';
  setTabBarHidden(false);
  modal.value = { ...modal.value, show: false };
  if (action === 'clear') clearAll();
  else if (action === 'import') runImport();
}

function onModalCancel() {
  modalAction = '';
  setTabBarHidden(false);
  modal.value = { ...modal.value, show: false };
}
</script>

<template>
  <div class="page">
    <div class="bg-glow"></div>

    <div class="masthead">
      <div class="mhead-top">
        <div class="brandline">
          <div class="brand-dot"></div>
          <span class="overline">Stay Toolbox</span>
        </div>
        <span class="ver">本机</span>
      </div>
      <div class="display">我的</div>
      <div class="tagline">管好你的本机数据</div>
    </div>

    <!-- 卡片 1 · 备份与恢复 -->
    <div class="glass card">
      <div class="cardhead">
        <AppIcon name="download" :size="28" tone="i" />
        <span class="cardtitle">备份与恢复</span>
      </div>
      <div class="note">
        <div class="note-line"><span class="note-no">1</span><span>数据只存在本机。导出的 JSON 会存成备份文件，可在换设备或重装后导入恢复。</span></div>
        <div class="note-line"><span class="note-no">2</span><span>清理浏览器数据或缓存会一并清掉本机数据，重要数据请先导出。</span></div>
      </div>
      <div class="backuprow">
        <div class="btn small" @click="doExport">
          <AppIcon name="download" :size="24" tone="c" />导出备份
        </div>
        <div class="btn small plain" @click="doImport">
          <AppIcon name="upload" :size="24" tone="d" />导入备份
        </div>
        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          class="filepick"
          @change="onFilePicked"
        />
      </div>
      <span v-if="backupMsg" class="bmsg">{{ backupMsg }}</span>
    </div>

    <!-- 卡片 2 · 关于 -->
    <div class="glass card">
      <div class="cardhead">
        <AppIcon name="shield" :size="28" tone="i" />
        <span class="cardtitle">关于</span>
      </div>

      <!-- 免责声明：与知识库同源（core/data.ts 的 DISCLAIMER） -->
      <div class="arow" @click="toggleDisc">
        <span class="grow alabel">免责声明</span>
        <div class="chev" :class="{ open: discOpen }"><AppIcon name="chevron-down" :size="26" tone="k" /></div>
      </div>
      <div v-if="discOpen" class="abody">
        <div class="dtitle">{{ discTitle }}</div>
        <div v-for="p in discLines" :key="p.k" class="ali">
          <template v-for="sg in p.segs" :key="sg.k">
            <span v-if="sg.b" class="b">{{ sg.t }}</span>
            <span v-else>{{ sg.t }}</span>
          </template>
        </div>
        <div class="d-alert">
          <div class="d-alert-t">触发即处理</div>
          <div class="d-alert-p">
            <template v-for="p in discTriggers" :key="p.k">
              <template v-for="sg in p.segs" :key="sg.k">
                <span v-if="sg.b" class="b">{{ sg.t }}</span>
                <span v-else>{{ sg.t }}</span>
              </template>
            </template>
          </div>
        </div>
      </div>

      <!-- 隐私说明：只陈述实际行为 -->
      <div class="arow" @click="togglePrivacy">
        <span class="grow alabel">隐私说明</span>
        <div class="chev" :class="{ open: privacyOpen }"><AppIcon name="chevron-down" :size="26" tone="k" /></div>
      </div>
      <div v-if="privacyOpen" class="abody">
        <div class="ali">本工具不联网、不收集任何个人信息：没有账号，不要手机号，不读头像昵称，没有埋点。</div>
        <div class="ali">所有行程、清单、好物与偏好都只写在本机浏览器的本地存储里，不上传任何服务器。</div>
        <div class="ali">「导出备份」= 把 JSON 存成备份文件，保存到哪里完全由你自己决定。</div>
        <div class="ali">清理浏览器数据或缓存会一并清掉本机数据，重要数据请提前导出。</div>
      </div>

      <div class="arow arow-static">
        <span class="grow alabel">版本</span>
        <span class="muted tiny num">v{{ version }}</span>
      </div>
    </div>

    <!-- 危险区 -->
    <div class="danger-zone">
      <span class="tiny muted dg-note">清空后不可恢复（含清单勾选记录）</span>
      <div class="btn danger-btn" @click="askClear">
        <AppIcon name="trash" :size="26" tone="r" />清空全部数据
      </div>
    </div>

    <AppModal
      :show="modal.show"
      :title="modal.title"
      :content="modal.content"
      cancel-text="取消"
      :confirm-text="modal.confirmText"
      :danger="modal.danger"
      @confirm="onModalConfirm"
      @cancel="onModalCancel"
    />
  </div>
</template>

<style scoped>
/* 我的 —— Stitch 视觉延伸
   无设计稿，按同一套令牌：白卡、深海军蓝、琥珀强调、危险区隔离。
   源 WXSS 的 .page 左右 32rpx 与底部 180rpx 由全局 .tabpage .page 接管。 */

/* —— 刊头 —— */
.masthead {
  padding: 12px 2px 4px;
}
.mhead-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.brandline {
  display: flex;
  align-items: center;
  gap: 5px;
}
.brand-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
}
.overline {
  display: block;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: var(--ink-3);
}
.ver {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 10px;
  font-weight: 600;
  color: var(--ink-3);
}
.display {
  display: block;
  font-size: 25px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: var(--ink);
}
.tagline {
  display: block;
  margin-top: 5px;
  font-size: 12.5px;
  color: var(--ink-2);
}

/* —— 卡片 —— */
.card {
  margin-top: 9px;
  padding: 14px;
}
.cardhead {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 8px;
}
.cardtitle {
  font-size: 14px;
  font-weight: 650;
  color: var(--ink);
}
.note {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-2);
}
.note-line {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.note-no {
  flex-shrink: 0;
  font-weight: 650;
  color: var(--ink);
}
.backuprow {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.backuprow .btn {
  flex: 1;
  gap: 4px;
  padding: 0 6px;
}
/* 文件选择框只由「导入备份」按钮唤起，不占版面 */
.filepick {
  display: none;
}
.bmsg {
  display: block;
  margin-top: 7px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--info-soft);
  font-size: 11px;
  line-height: 1.55;
  color: var(--ink-2);
}

/* —— 关于 / 可展开行 —— */
.arow {
  display: flex;
  align-items: center;
  min-height: 46px;
  border-top: 1px solid var(--hairline);
}
.arow:active {
  opacity: 0.7;
}
.arow-static {
  min-height: 38px;
}
.arow-static:active {
  opacity: 1;
}
.alabel {
  font-size: 13.5px;
  color: var(--ink);
}
.chev {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding-left: 4px;
  color: var(--ink-3);
  transition: transform 0.2s;
}
.chev.open {
  transform: rotate(180deg);
}
.abody {
  margin: 0 0 8px;
  padding: 9px 10px;
  border-radius: 7px;
  background: var(--surface-2);
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-2);
}
.dtitle {
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}
.ali {
  position: relative;
  padding-left: 10px;
  margin-bottom: 5px;
}
.ali:last-child {
  margin-bottom: 0;
}
.ali::before {
  content: "";
  position: absolute;
  left: 0;
  top: 7.5px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--accent);
}
.b {
  font-weight: 650;
  color: var(--ink);
}
.d-alert {
  margin-top: 8px;
  padding: 9px 10px;
  border-radius: 6px;
  background: var(--danger-soft);
  border: 1px solid rgba(239, 68, 68, 0.18);
}
.d-alert-t {
  margin-bottom: 3px;
  font-size: 11.5px;
  font-weight: 700;
  color: #b42318;
}
.d-alert-p {
  font-size: 12px;
  line-height: 1.65;
  color: var(--ink-2);
}
.d-alert .b {
  color: #b42318;
}

/* —— 危险区 —— */
.danger-zone {
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px solid var(--hairline);
}
.dg-note {
  display: block;
  margin-bottom: 7px;
  text-align: center;
}
.danger-btn {
  background: var(--danger-soft);
  color: #b42318;
  border: 1px solid rgba(239, 68, 68, 0.22);
  box-shadow: none;
  font-weight: 600;
}
</style>
