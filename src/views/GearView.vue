<script setup lang="ts">
// 好物 —— 源实现 src/components/GearView.vue
// 物品名 + 品牌的个人收藏列表，按分类分组；添加时按物品名联想分类（300+ 关键词）。
//
// 与源实现的差异（平台导致）：
//   1. Teleport + fixed 弹窗 → 小程序本身就是全屏容器，遮罩用 fixed 即可（无层叠上下文问题）。
//   2. confirm() → 自绘 modal 组件（P0-6，替代 wx.showModal）。
//      R6：「恢复默认好物」按钮被老板要求删除，页面上已没有需要二次确认的操作，
//      modal 随之下线；core/engine 的 resetGear() 保留（测试仍覆盖，能力不删）。
//   3. autofocus → 小程序 input 用 focus 属性（弹窗打开时置 true）。
//   4. 键盘 Esc 关闭 → 小程序无键盘事件，点遮罩空白处关闭。
//   5. 猜不出分类时保持当前选择，绝不瞎猜（与源实现一致）。
//   6. R6：布局调整 —— 「添加好物」按钮从页面顶部挪到物品列表下面（老板要求）。

import { nextTick, onMounted, ref } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import { addGear, listGear, removeGear } from '../engine';
import { GEAR_CATS_EXT, guessGearCatExt } from '../extra';
import { setTabBarHidden } from '../store';

interface RowVM {
  name: string;
  brand: string;
  index: number;
}
interface GroupVM {
  cat: string;
  rows: RowVM[];
}
interface ChipVM {
  c: string;
  on: boolean;
  /** 联想命中：金色虚线，与用户手点的实线区分 */
  gu: boolean;
}

const groups = ref<GroupVM[]>([]);
const total = ref(0);
// 分类标签的三种状态在 JS 里算好再给模板：模板属性值里写不了 && 表达式
const catChips = ref<ChipVM[]>([]);

const open = ref(false);
const newName = ref('');
const newBrand = ref('');
const addCat = ref(GEAR_CATS_EXT[0]);
/** 联想命中的分类（虚线金色），与用户手点的实线区分 */
const guessed = ref(false);
/** 联想命中时的一次轻微缩放脉冲：两个动画名交替，保证每次命中都能重播 */
const pulseCls = ref('');
const err = ref('');
const focusName = ref(false);
/** 对应小程序的 focus 属性：抽屉打开时把光标放进「物品名称」 */
const nameEl = ref<HTMLInputElement | null>(null);

/** 用户是否手动点过分类标签：点过就以手动为准，联想不再覆盖 */
let catTouched = false;
/** 脉冲动画交替计数：0/1 轮换，用于切换 animation-name 让动画重播 */
let pulseSeq = 0;

// 小程序 onShow → onMounted：视图切换会重建组件，等价于 onShow
onMounted(() => {
  // 从其他页返回时如果抽屉还开着，tabBar 不能重新露出来
  if (open.value) setTabBarHidden(true);
  reload();
  syncChips();
});

function syncChips() {
  catChips.value = GEAR_CATS_EXT.map(c => ({
    c,
    on: addCat.value === c,
    gu: guessed.value && addCat.value === c,
  }));
}

function reload() {
  const entries = listGear();
  const byCat = new Map<string, RowVM[]>();
  entries.forEach((e, i) => {
    const list = byCat.get(e.cat) || [];
    list.push({ name: e.name, brand: e.brand || '', index: i });
    byCat.set(e.cat, list);
  });
  const gs: GroupVM[] = GEAR_CATS_EXT.filter(c => byCat.has(c)).map(cat => ({
    cat,
    rows: byCat.get(cat) || [],
  }));
  groups.value = gs;
  total.value = entries.length;
}

function openAdd() {
  catTouched = false;
  open.value = true;
  newName.value = '';
  newBrand.value = '';
  addCat.value = GEAR_CATS_EXT[0];
  guessed.value = false;
  pulseCls.value = '';
  err.value = '';
  focusName.value = true;
  syncChips();
  // 自定义 tabBar 在页面层之上，抽屉打开时必须先把它藏起来
  setTabBarHidden(true);
  void nextTick(() => {
    if (focusName.value) nameEl.value?.focus();
  });
}

function closeAdd() {
  open.value = false;
  err.value = '';
  focusName.value = false;
  setTabBarHidden(false);
}

/** 弹窗内部的点击占位：阻止冒泡到遮罩，避免点输入框就把弹窗关了 */
function noop() {
  /* 占位 */
}

function onName(e: Event) {
  const name = String((e.target as HTMLInputElement).value || '');
  // 用户手动点过标签后，后续改名不再覆盖他的选择（与源实现 onNameInput 一致）
  if (catTouched) {
    newName.value = name;
    err.value = '';
    pulseCls.value = '';
    syncChips();
    return;
  }
  const g = guessGearCatExt(name);
  // 命中就换一次动画名（a/b 交替），否则同名动画不会重播
  const seq = g ? pulseSeq + 1 : pulseSeq;
  if (g) pulseSeq = seq;
  newName.value = name;
  err.value = '';
  addCat.value = g || addCat.value;
  guessed.value = !!g;
  pulseCls.value = g ? (seq % 2 === 1 ? 'pulse-a' : 'pulse-b') : '';
  syncChips();
}

function onBrand(e: Event) {
  newBrand.value = String((e.target as HTMLInputElement).value || '');
}

function pickCat(c: string) {
  if (!c) return;
  catTouched = true;
  addCat.value = c;
  guessed.value = false;
  pulseCls.value = '';
  syncChips();
}

function save() {
  const name = String(newName.value || '').trim();
  if (!name) {
    err.value = '先填物品名称，比如「充电宝」';
    return;
  }
  const brand = String(newBrand.value || '').trim();
  addGear({ name, brand: brand || undefined, cat: addCat.value });
  open.value = false;
  focusName.value = false;
  setTabBarHidden(false);
  reload();
}

function del(i: number) {
  if (Number.isNaN(i)) return;
  removeGear(i);
  reload();
}
</script>

<template>
  <div class="page">
    <div class="bg-glow"></div>

    <div class="gear-head">
      <div class="mhead-top">
        <div class="brandline">
          <div class="brand-dot"></div>
          <span class="overline">Gear Collection</span>
        </div>
        <span class="ver num">{{ total }} 件</span>
      </div>
      <div class="display">好物收藏</div>
      <div class="tagline">记下「哪件东西买了哪个牌子」，下次照着买</div>
    </div>

    <!-- 按分类分组：每个分类一张白卡 -->
    <template v-for="g in groups" :key="g.cat">
      <div class="gcard glass">
        <div class="gcat-head">
          <span class="gcat">{{ g.cat }}</span>
          <span class="gcount num">{{ g.rows.length }} 件</span>
        </div>
        <div v-for="row in g.rows" :key="row.index" class="gearitem">
          <div class="gicon"><AppIcon name="luggage" :size="26" tone="k" /></div>
          <div class="grow gtext">
            <span class="gname">{{ row.name }}</span>
            <span v-if="row.brand" class="gbrand">{{ row.brand }}</span>
            <span v-else class="gbrand gbrand-empty">没记品牌</span>
          </div>
          <div class="pickdel" aria-label="删除" @click="del(row.index)">
            <AppIcon name="trash" :size="24" tone="k" />
          </div>
        </div>
      </div>
    </template>

    <div v-if="total === 0" class="empty">
      <span class="empty-line">还没有收藏任何好物</span>
      <span class="muted">点下方「添加好物」，先填物品名称（如「充电宝」），品牌可留空。</span>
    </div>

    <div class="addbtn" @click="openAdd">
      <AppIcon name="plus" :size="30" tone="c" />
      <span>添加好物</span>
    </div>

    <div v-if="total > 0" class="gearfoot">共 {{ total }} 件 · 个人偏好 · 非商业推荐</div>

    <!-- 添加弹窗：底部抽屉式 -->
    <div v-if="open" class="gmask" @click="closeAdd">
      <div class="gdialog" @click.stop="noop">
        <div class="ghandle"></div>
        <div class="gdlg-head">
          <div class="grow">
            <div class="gdlg-title">添加好物</div>
            <div class="gdlg-sub">记下这是什么东西、买的哪个牌子</div>
          </div>
          <div class="gclose" aria-label="关闭" @click="closeAdd">
            <AppIcon name="x" :size="28" tone="k" />
          </div>
        </div>

        <div class="gfield">
          <div class="glabel">物品名称 <span class="req">必填</span></div>
          <input
            ref="nameEl"
            class="ginput"
            placeholder="如：充电宝、耳塞、拖鞋"
            :value="newName"
            @input="onName"
          />
        </div>

        <div class="gfield">
          <div class="glabel">品牌 · 型号 <span class="opt">选填</span></div>
          <input
            class="ginput"
            placeholder="如：安耳悠、小米"
            :value="newBrand"
            @input="onBrand"
          />
        </div>

        <div class="gfield">
          <div class="glabel">
            所属分类
            <span v-if="guessed" class="ghint">已按名称自动匹配，可手动修改</span>
            <span v-else class="ghint ghint-dim">按名称自动匹配，也可手动指定</span>
          </div>
          <div class="catchips" :class="pulseCls">
            <div
              v-for="ch in catChips"
              :key="ch.c"
              class="catchip"
              :class="{ on: ch.on, guessed: ch.gu }"
              @click="pickCat(ch.c)"
            >
              <AppIcon v-if="ch.on" name="check" :size="20" :tone="ch.gu ? 'g' : 'c'" />
              <span>{{ ch.c }}</span>
            </div>
          </div>
        </div>

        <div v-if="err" class="gerr">{{ err }}</div>
        <div class="gdlg-foot">
          <div class="btn ghost" @click="closeAdd">取消</div>
          <div class="btn" @click="save">保存好物</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 好物 —— Stitch 现代功能编辑风
   分类卡 + 条目行 + 底部抽屉；联想命中仍用琥珀虚线区分。 */

.page {
  /* 底部固定「添加好物」按钮 + tabBar 都要留出空间 */
  padding: 0 16px calc(160px + env(safe-area-inset-bottom));
}

/* —— 刊头 —— */
.gear-head {
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
  line-height: 1.6;
  color: var(--ink-2);
}

/* —— 分类卡 —— */
.gcard {
  margin: 8px 0;
  padding: 0 11px 3px;
}
.gcat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 1px 6px;
}
.gcat {
  font-size: 13.5px;
  font-weight: 650;
  color: var(--ink);
}
.gcount {
  font-size: 10px;
  color: var(--ink-3);
}
.gearitem {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 0;
  border-top: 1px solid var(--hairline);
}
.gicon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--surface-2);
}
.gtext {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}
.gname {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gbrand {
  font-size: 11px;
  color: var(--ink-2);
}
.gbrand-empty {
  color: var(--ink-3);
}
.pickdel {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 6px;
}
.pickdel:active {
  background: var(--danger-soft);
}

/* —— 空状态 / 添加 —— */
.emptyp {
  margin-top: 18px;
  text-align: center;
}
.addbtn {
  position: fixed;
  left: 50%;
  right: auto;
  transform: translateX(-50%);
  width: min(448px, calc(100% - 32px));
  bottom: calc(64px + env(safe-area-inset-bottom));
  z-index: 900; /* < tabBar 1000，按钮在 tabBar 上方 */
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 50px;
  margin-top: 0;
  border-radius: 9px;
  background: var(--primary);
  color: #ffffff;
  font-size: 14.5px;
  font-weight: 600;
  box-shadow: 0 7px 15px -9px rgba(15, 23, 42, 0.45);
}
.addbtn:active {
  background: var(--primary-press);
}
.gearfoot {
  margin: 11px 2px 0;
  text-align: center;
  font-size: 10.5px;
  color: var(--ink-3);
}

/* —— 添加弹窗：底部抽屉 —— */
.gmask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1100;
  display: flex;
  align-items: flex-end;
  background: rgba(15, 23, 42, 0.46);
}
.gdialog {
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 7px 16px calc(16px + env(safe-area-inset-bottom));
  border-radius: 14px 14px 0 0;
  background: #ffffff;
  box-shadow: 0 -10px 30px -10px rgba(15, 23, 42, 0.3);
}
.ghandle {
  width: 36px;
  height: 4px;
  margin: 1px auto 11px;
  border-radius: 999px;
  background: var(--line);
}
.gdlg-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 13px;
}
.gdlg-title {
  font-size: 19px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: -0.25px;
  color: var(--ink);
}
.gdlg-sub {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--ink-3);
}
.gclose {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--surface-2);
}
.gclose:active {
  background: var(--surface-3);
}
.gfield {
  margin-bottom: 11px;
}
.glabel {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
}
.ghint {
  font-size: 9.5px;
  font-weight: 500;
  color: var(--success);
}
.ghint-dim {
  color: var(--ink-3);
}
.req {
  font-size: 9px;
  font-weight: 500;
  color: var(--red);
}
.opt {
  font-size: 9px;
  font-weight: 500;
  color: var(--ink-3);
}
.ginput {
  width: 100%;
  height: 46px;
  padding: 0 11px;
  font-size: 14.5px;
  color: var(--ink);
  border: 1px solid transparent;
  border-radius: 7px;
  background: var(--surface-2);
}

/* 分类 chips */
.catchips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.catchip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 40px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: var(--surface-2);
  font-size: 12px;
  color: var(--ink-2);
}
.catchip:active {
  opacity: 0.7;
}
.catchip.on {
  border-color: var(--primary);
  background: var(--primary);
  color: #ffffff;
  font-weight: 600;
}
/* 联想选中的标签：琥珀虚线，和用户手点的实线区分开 */
.catchip.guessed {
  border-color: var(--accent);
  border-style: dashed;
  background: var(--accent-soft);
  color: var(--accent-deep);
}
.catchips.pulse-a {
  animation: gpulse-a 0.32s ease-out;
}
.catchips.pulse-b {
  animation: gpulse-b 0.32s ease-out;
}
@keyframes gpulse-a {
  from { transform: scale(0.98); opacity: 0.7; }
  to { transform: none; opacity: 1; }
}
@keyframes gpulse-b {
  from { transform: scale(0.98); opacity: 0.7; }
  to { transform: none; opacity: 1; }
}
.gerr {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--red);
}
.gdlg-foot {
  display: flex;
  gap: 8px;
  margin-top: 15px;
}
.gdlg-foot .btn {
  flex: 1;
}
.gdlg-foot .btn:active {
  opacity: 0.7;
}
</style>
