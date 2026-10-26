<script setup lang="ts">
// ItemRow —— 物品行（源实现 src/components/ItemRow.vue）
// 勾选框 + 名称/元信息 + 使用人下拉 + 好物入口 + 步进器。
// M19：行尾删除按钮退役 —— stepper 减到 0 已等效删除（收进「已设为不带」可反悔）。
//
// 与源实现的两处平台差异：
//   1. <select> → 小程序原生 picker（下拉弹层由系统提供，无需自绘）。
//   2. 好物面板由本组件内嵌渲染（源实现同款结构），并通过 gear-count 变化通知父级。
//
// 关于 qty === 0：源实现是「留在列表里灰显 + 打「不带」标签 + 禁用勾选」。
// 小程序版按老板要求改了口径 —— qty=0 的项由父级（行程页 / 向导预览）**直接不渲染**，
// 收进底部的「已设为不带」区域里可恢复。所以下面 item.qty === 0 的分支现在不会走到，
// 保留它只是为了万一有别的调用方按源口径传进来时不会渲染错。
import { computed, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import Stepper from './Stepper.vue';
import GearPanel from './GearPanel.vue';
import { listGear } from '../engine';
import type { PrepItem } from '../types';

const props = withDefaults(
  defineProps<{
    item: PrepItem;
    editable?: boolean;
    /** 在父级列表中的下标：事件回传时带上，省得父级依赖 dataset 取索引 */
    idx?: number;
    /**
     * 稳定键：'p3' = prep[3]，'c1' = custom[1]。
     * 行程页的清单由 prep + custom 合并后按分类排序，下标在排序后不再等于原数组下标，
     * 也无法像源实现那样用对象引用比较（小程序 setData 传的是拷贝），故改用稳定键定位。
     */
    ikey?: string;
    /** 使用人可选项（如 ['全体','入住人1','儿童']）；为空则不显示下拉 */
    opts?: string[];
  }>(),
  { editable: true, idx: -1, ikey: '', opts: () => [] as string[] },
);

interface BasePayload {
  idx: number;
  ikey: string;
}
interface TogglePayload extends BasePayload {
  value: boolean;
}
interface QtyPayload extends BasePayload {
  value: number;
}
interface AssignPayload extends BasePayload {
  value: string;
}

const emit = defineEmits<{
  toggle: [p: TogglePayload];
  qty: [p: QtyPayload];
  assign: [p: AssignPayload];
  gearchange: [p: BasePayload];
}>();

const TAG_CLS: Record<string, string> = {
  必带: 'need',
  建议购买: 'buy',
  到店购买: 'shop',
  家里带: 'home',
  推荐: 'rec',
  可选: 'opt',
  自定义: 'src',
};

/**
 * M18 标签审核（老板点名）：「家里带 / 建议购买 / 到店购买」是对用户
 * 「从哪拿、要不要买」的臆测 —— 不知道的就不要标。数据层一字不动（红线），
 * 只在渲染层不显示。保留的四类都有事实依据：
 * 必带（优先级）/ 推荐（引擎判定）/ 可选（开关降级）/ 自定义（用户自己加的）。
 */
const HIDE_PREP = new Set(['家里带', '建议购买', '到店购买']);

const tagCls = ref('opt');
/** M18：臆测类 prep（家里带/建议购买/到店购买）不在行内显示，见 HIDE_PREP */
const showPrepTag = ref(true);
/** 使用人下拉的当前下标（picker 只认下标，assign 存的是文案） */
const assignIdx = ref(0);
/** 已记录的这一件好物条数 */
const gearCount = ref(0);
/** 入口按钮文案：有记录显示「好物 N」，没有显示「记好物」（模板里不做三元拼接） */
const gearLabel = ref('记好物');
const showGear = ref(false);
/** 使用人下拉是否显示（opts 非空且可编辑时为 true） */
const showAssign = ref(false);
/** 只有来自 ITEMS 的物品才有 itemId，自定义物品不显示好物入口 */
const hasGear = ref(false);
/** 上一次算好物条数时的 name+cat，用于脏检查 */
const gearKey = ref('');

// observers: 'item.prep'
watch(
  () => props.item.prep,
  prep => {
    tagCls.value = TAG_CLS[prep] || 'opt';
    showPrepTag.value = !HIDE_PREP.has(prep);
  },
  { immediate: true },
);

// observers: 'item.name, item.cat'
watch(() => [props.item.name, props.item.cat], () => syncGear(), { immediate: true });

// observers: 'item.assign, opts, editable'
watch(() => [props.item.assign, props.opts, props.editable], () => syncAssign(), { immediate: true });

/** idx 与 ikey 一并回传，父级按自己用哪种定位方式取用 */
function payload(): BasePayload;
function payload<T>(extra: { value: T }): BasePayload & { value: T };
function payload<T>(extra?: { value: T }): BasePayload | (BasePayload & { value: T }) {
  return { idx: props.idx, ikey: props.ikey, ...(extra || {}) };
}

/**
 * 重算好物条数。列表全量重渲时每一行都会触发一次 observer，
 * 若不做缓存，勾选一项就会导致 60 行各读一次 Storage，故用 name+cat 做脏检查。
 */
function syncGear(force = false) {
  const it = props.item;
  // 源实现：v-if="props.item.itemId" —— 自定义物品不提供好物入口。
  // M18（老板点名）：证件类（手机 / 钱包 / 现金等）整类豁免 —— 这些东西
  // 早就买好了、入住时只求快拿快走，行内不再出现「记好物」入口。
  const g = !!it.itemId && it.cat !== '证件';
  if (!g) {
    hasGear.value = false;
    gearCount.value = 0;
    showGear.value = false;
    return;
  }
  const key = `${it.cat}|${it.name}`;
  if (!force && gearKey.value === key) return;
  gearKey.value = key;
  const n = listGear(it.cat).filter(x => x.name === it.name).length;
  hasGear.value = true;
  gearCount.value = n;
  // M18：面板里记的是「你用过的品牌」，没有记录时引导语从购物腔
  // 改为记录腔（记录你用哪款），语义与功能对齐。
  gearLabel.value = n > 0 ? `好物 ${n}` : '记好物';
}

function syncAssign() {
  const it = props.item;
  const opts = props.opts;
  // 「opts 非空 && editable」在 JS 里算成一个布尔
  const show = opts.length > 0 && props.editable;
  if (!show) {
    showAssign.value = false;
    assignIdx.value = 0;
    return;
  }
  // 源实现：:value="props.item.assign ?? assignOptions[0]"
  const i = opts.indexOf(it.assign ?? opts[0]);
  showAssign.value = true;
  assignIdx.value = i < 0 ? 0 : i;
}

function onToggle() {
  const item = props.item;
  // qty === 0 时勾选框禁用（与源实现 :disabled 一致）
  if (item.qty === 0) return;
  emit('toggle', payload({ value: !item.done }));
}

function onQty(v: number) {
  emit('qty', payload({ value: v }));
}

function onAssign(e: Event) {
  const opts = props.opts;
  const i = opts.indexOf((e.target as HTMLSelectElement).value);
  if (i < 0 || i >= opts.length) return;
  assignIdx.value = i;
  emit('assign', payload({ value: opts[i] }));
}

function toggleGear() {
  showGear.value = !showGear.value;
}

function onGearChange() {
  syncGear(true);
  emit('gearchange', payload());
}
</script>

<template>
  <!-- R5-2：根节点整行可点 —— 点名称/标签/空白都等于点勾选框。
       行内其它可点元素必须用 .stop 截住冒泡（stop 只挡「继续向上冒泡」，
       元素自己的 handler 照常执行），否则点步进器会连带触发勾选。
       onToggle 内部对 qty === 0 直接 return（不带的东西不可勾，与源实现一致）。 -->
  <div
    class="row"
    :class="{ done: props.item.done, zero: props.item.qty === 0, wrap: showGear }"
    @click="onToggle"
  >
    <!-- 完成态右上角虚化对勾：常驻节点 + CSS 切 opacity（不能用 v-if，会丢过渡），
         纯装饰、pointer-events:none，不挡步进器。 -->
    <span class="row-check">✓</span>

    <!-- .stop：点勾选框只触发一次（若用普通 @click，勾选框自己的 + 冒泡到根的会触发两次） -->
    <div
      v-if="props.editable"
      class="tick"
      :class="{ on: props.item.done, off: props.item.qty === 0 }"
      @click.stop="onToggle"
    >
      <AppIcon v-if="props.item.done" name="check" :size="24" tone="c" />
    </div>

    <div class="grow main">
      <div class="name">{{ props.item.name }}</div>
      <div class="meta">
        <span class="users">{{ props.item.users }}</span>
        <span v-if="props.item.qty === 0" class="tag zero">不带</span>
        <!-- M18 标签审核：臆测类 prep（家里带/建议购买/到店购买）不显示，只渲染
             有事实依据的 必带/推荐/可选/自定义 —— showPrepTag 由 JS 预计算（模板不写裸比较） -->
        <span v-else-if="showPrepTag" class="tag" :class="tagCls">{{ props.item.prep }}</span>

        <!-- 使用人下拉：多人行程时把物品绑定到人（源实现 assignOptions + <select>）。
             .stop：下拉的点选不该连带勾选整行 -->
        <select
          v-if="showAssign"
          class="assign"
          :value="props.opts[assignIdx]"
          @click.stop
          @change="onAssign"
        >
          <option v-for="o in props.opts" :key="o" :value="o">{{ o }}</option>
        </select>

        <!-- 好物入口：只有来自 ITEMS 的物品才有 itemId（源实现 v-if="item.itemId"） -->
        <div
          v-if="hasGear"
          class="gearbtn"
          :class="{ open: showGear }"
          @click.stop="toggleGear"
        >{{ gearLabel }}</div>
      </div>
    </div>

    <!-- .stop 挂在 Stepper 组件根上：拦住内部冒泡出来的 tap，加减数量不切换勾选 -->
    <Stepper :value="props.item.qty" :min="0" :unit="props.item.unit" @click.stop @change="onQty" />

    <!-- M19（老板点名）：行尾删除按钮退役 —— stepper 减到 0 即收进「已设为不带」，
         等效删除且可反悔，单独的删除键属于多余入口；源实现此处为 Trash2 图标，不再移植。 -->

    <GearPanel
      v-if="showGear"
      :name="props.item.name"
      :cat="props.item.cat"
      @click.stop
      @change="onGearChange"
    />
  </div>
</template>

<style scoped>
/* ItemRow —— Stitch 物品行
   结构：方形勾选 / 名称 + meta / 右侧步进器；完成态淡绿底 + 右上角水印勾。
   组件样式隔离，通用类（.grow/.hv）必须在组件内再写一份。 */

.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 56px;
  margin: 0 -6px;
  padding: 9px 6px;
  border-radius: 8px;
  transition: background-color 0.18s ease;
}
.row + .row::after {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  top: 0;
  height: 1px;
  background: var(--hairline);
}

/* 方形勾选：视觉 22px，上下 margin 11px 把热区撑到 44px */
.tick {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin: 11px 0;
  border-radius: 6px;
  border: 2px solid var(--line);
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.16s ease, border-color 0.16s ease;
}
.tick.on {
  background: var(--primary);
  border-color: var(--primary);
}
.tick.off {
  opacity: 0.35;
}

.grow {
  flex: 1;
  min-width: 0;
}
.hv {
  opacity: 0.72;
}
.row:active {
  opacity: 0.72;
}

.main {
  padding: 1px 0;
}
.name {
  display: block;
  max-width: 100%;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row.done {
  background: var(--success-soft);
}
.row.done .name {
  color: var(--ink);
}
.row.zero .name {
  opacity: 0.5;
}

.row-check {
  position: absolute;
  right: 1px;
  top: -3px;
  font-size: 52px;
  line-height: 1;
  font-weight: 700;
  color: rgba(15, 159, 110, 0.16);
  pointer-events: none;
  z-index: 0;
  opacity: 0;
  transition: opacity 0.18s ease;
}
.row.done .row-check {
  opacity: 1;
}

.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-3);
}
.users {
  font-size: 11px;
  color: var(--ink-3);
}
.tag {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  min-height: 17px;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 9.5px;
  line-height: 1;
  background: var(--surface-2);
  color: var(--ink-2);
  white-space: nowrap;
}
.tag.need {
  background: var(--danger-soft);
  color: #b42318;
}
.tag.rec {
  background: var(--info-soft);
  color: #1d4ed8;
}
.tag.opt {
  background: var(--surface-2);
  color: var(--ink-2);
}
.tag.src {
  background: var(--accent-soft);
  color: var(--accent-deep);
}
.tag.zero {
  background: var(--surface-2);
  color: var(--ink-3);
}
.tag.buy,
.tag.shop,
.tag.home {
  background: var(--surface-2);
  color: var(--ink-2);
}

/* 展开好物面板时整行换行，面板占满一行 */
.row.wrap {
  flex-wrap: wrap;
}

/* —— 使用人下拉 —— */
.assign {
  display: inline-block;
  min-height: 24px;
  padding: 0 4px;
  border: 0;
  border-radius: 4px;
  background: var(--surface-2);
  font-size: 10.5px;
  color: var(--ink-2);
}

/* —— 好物入口 —— */
.gearbtn {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  min-height: 22px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.gearbtn.open {
  background: #ffe8c2;
}
</style>
