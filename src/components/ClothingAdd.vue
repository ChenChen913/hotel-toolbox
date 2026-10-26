<script setup lang="ts">
// ClothingAdd —— 分类类型下拉（源实现 src/components/ClothingAdd.vue）
//
// ⚠️ R5-6 起本组件已**泛化**：不再只服务「衣物」，化妆品面板共用同一套逻辑。
//    名字保留 clothing-add（改名要动 8 处，收益不大），看到名字请想到「分类类型下拉」。
//    可选类型 / 落点分类 / 输入提示都由调用方通过属性传入：
//      · types       面板里的预设类型（衣物的默认表留在本文件，化妆品的在 core/extra.ts）
//      · cat         新增项落到哪个分类（调用方在 add 事件里自己取，组件只回传名称）
//      · placeholder 输入框提示（衣物「防晒衣」，化妆品「面膜」）
//      · trigger     触发条占位文案（M18：衣物「选择衣物类型…」/ 化妆品「选择化妆品类型…」，
//                    之前硬编码成衣物的文案，化妆品面板也跟着显示「衣物类型」—— 老板真机抓到）
//
// M18 选完即复位：之前选中「外套」后触发条一直显示「外套」，看起来像还要再选一次；
//      实际选中的衣物已按固定格式列在下方，触发条应回到占位文案等待下一次选择。
//      因此 chosen 属性整个退役（没有调用方传它，选完也不再保留）。
// 源实现用 Teleport to="body" + position: fixed 让面板浮在卡片之上、不挤压下方物品行。
// 小程序没有 Teleport，但页面根节点本身就是最外层，故改写为：
//   1. 测量触发条的位置（小程序 createSelectorQuery → Web 用 ref + getBoundingClientRect，
//      同步拿到结果，不需要回调）；
//   2. 面板 position: fixed，按测量结果定位；下方空间不够时改为向上弹；
//      （R5-7：面板必须放在 <Teleport to="body"> 里，见模板内注释 —— .glass 的
//        backdrop-filter 会把 fixed 的包含块换成卡片本身，直接量视口定位必错位）
//   3. 遮罩层 @touchmove.stop.prevent 阻止穿透滚动，点遮罩关闭；
//   4. 页面滚动时由页面调用 close()（fixed 面板不跟手，滚动即关闭比错位更可控）。
import { computed, nextTick, ref, watch, type CSSProperties } from 'vue';
import AppIcon from './AppIcon.vue';

/** 面板估算最大高度（px），用于判断该向下弹还是向上弹 */
const PANEL_H = 320;

const props = withDefaults(
  defineProps<{
    /** 面板里的预设类型列表（R5-6：由调用方传入；不传时回落到衣物默认表） */
    types?: string[];
    /** 新增项要落到哪个分类（R5-6）。组件本身不用它，只是约定调用方在标签上写 data-cat 供事件路由 */
    cat?: string;
    /** 输入框的 placeholder（R5-6） */
    placeholder?: string;
    /** 触发条占位文案（M18）：衣物 / 化妆品各自传入，不再共用「衣物类型」 */
    trigger?: string;
  }>(),
  {
    // 衣物默认类型表（化妆品走 extra.ts 的 COSMETIC_TYPES 由调用方传入）。
    // 写成内联字面量：withDefaults 的默认值会被提升到模块作用域，不能引用 setup 内的局部常量。
    types: () => ['贴身衣物', '短袖', '长袖', '外套', '裤子', '裙子', '睡衣', '泳衣', '运动装备', '鞋'],
    cat: '',
    placeholder: '输入衣物名称，如：防晒衣',
    trigger: '选择类型…',
  },
);

const emit = defineEmits<{ (e: 'add', name: string): void }>();

const open = ref(false);
const customName = ref('');
/** R6：点「自定义」后聚焦输入行（输入行常驻面板底部，始终可见） */
const focusInput = ref(false);
/** 定位结果（px） */
const panelTop = ref(-1);
const panelLeft = ref(0);
const panelWidth = ref(0);
/** 向上弹时的定位：bottom 距视口底部 */
const panelBottom = ref(-1);

const triggerEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);

/** 打开时刻：用来吃掉「刚打开就紧跟一次 scroll」的抖动（见 close 的注释） */
let openedAt = 0;
function markOpen() {
  open.value = true;
  openedAt = Date.now();
}

const panelStyle = computed<CSSProperties>(() => ({
  ...(panelTop.value >= 0 ? { top: `${panelTop.value}px` } : { bottom: `${panelBottom.value}px` }),
  left: `${panelLeft.value}px`,
  width: `${panelWidth.value}px`,
}));

function onToggle() {
  if (open.value) {
    open.value = false;
    focusInput.value = false;
    return;
  }
  place();
}

/**
 * R6：点列表末尾的「自定义」—— 不关闭面板，聚焦底部输入行。
 * 老板的用法：类型列表里没有想要的东西 → 滑到「自定义」→ 点它 → 输入名称 → 添加。
 */
function onPickCustom() {
  focusInput.value = true;
}

/** 测量触发条位置后打开面板（05 §6.2） */
function place() {
  const el = triggerEl.value;
  if (!el) {
    // 测量失败就退回内联展开，至少功能可用
    markOpen();
    panelTop.value = -1;
    panelBottom.value = -1;
    focusInput.value = false;
    return;
  }
  const r = el.getBoundingClientRect();
  const winH = window.innerHeight;
  const roomBelow = winH ? winH - r.bottom : PANEL_H + 1;
  if (roomBelow >= PANEL_H || !winH) {
    markOpen();
    panelTop.value = r.bottom + 8;
    panelLeft.value = r.left;
    panelWidth.value = r.width;
    panelBottom.value = -1;
    focusInput.value = false;
  } else {
    markOpen();
    panelTop.value = -1;
    panelLeft.value = r.left;
    panelWidth.value = r.width;
    panelBottom.value = winH - r.top + 8;
    focusInput.value = false;
  }
}

/** 供页面滚动时调用：滚动即关闭，避免面板与触发条错位 */
function close() {
  if (!open.value) return;
  // Web 特有的一帧抖动：点触发条时浏览器可能还在「滚动入视野」，scroll 事件在点击之后
  // 才派发，页面级滚动监听会把刚打开的面板立刻关掉（真机上触摸滚动停在点击前，不会出现）。
  // 打开后 300ms 内的关闭请求一律忽略，足以跨过这一帧，且不影响正常滑动关闭。
  if (Date.now() - openedAt < 300) return;
  open.value = false;
  focusInput.value = false;
}

function onPick(t: string) {
  if (!t) return;
  emit('add', t);
  // M18：不保留已选类型 —— 选中的物品已列在下方，触发条回到占位文案
  open.value = false;
  focusInput.value = false;
}

function onInput(e: Event) {
  customName.value = (e.target as HTMLInputElement).value;
}

function onAddCustom() {
  const n = String(customName.value || '').trim();
  if (!n) return;
  emit('add', n);
  customName.value = '';
  open.value = false;
  focusInput.value = false;
}

// 输入行常驻面板底部，focusInput 只是请求聚焦（对应小程序 input 的 focus 属性）
watch(focusInput, (v) => {
  if (!v) return;
  nextTick(() => inputEl.value?.focus());
});

defineExpose({ close });
</script>

<template>
  <div class="cwrap">
    <!-- 占位文案由调用方传 trigger（衣物/化妆品各自一套），选中后不复位成已选类型 -->
    <div ref="triggerEl" class="ctrigger" :class="{ on: open }" @click="onToggle">
      <span class="cph">{{ props.trigger }}</span>
      <AppIcon name="chevron-down" :size="26" tone="k" :style="{ transform: `rotate(${open ? 180 : 0}deg)` }" />
    </div>
  </div>

  <!-- 浮层：遮罩 + 定位面板（替代 Teleport to body + fixed）。
       R5-7：必须包在 <Teleport to="body"> 里 —— 本组件渲染在卡片内部，卡片若带
       backdrop-filter / transform 会成为后代 position:fixed 的包含块。
       新设计已去掉 backdrop-filter，但 Teleport 仍保留：它是弹层最稳的做法，
       也避免后续有人给卡片加 transform 时再次错位。

       R6 结构保留：
         ① 类型列表用 .clist（scroll-view）接管滚动；
         ② 输入行常驻面板底部，列表末尾「自定义」只聚焦不关闭。 -->
  <Teleport to="body">
    <div v-if="open" class="cmask" @click="close" @touchmove.stop.prevent>
      <div class="cpanel" :class="{ up: panelTop < 0 }" :style="panelStyle" @click.stop>
        <div class="chead">
          <span class="ctitle">选择{{ props.cat }}类型</span>
          <div class="cclose" aria-label="关闭" @click="close">
            <AppIcon name="x" :size="28" tone="k" />
          </div>
        </div>

        <!-- M19：show-scrollbar 在 scroll-view 上需同时开启 enhanced 才生效（官方文档）。
             下方 classic 滚动条样式作为 WebView 兜底。 -->
        <div class="clist">
          <div v-for="t in props.types" :key="t" class="copt" @click="onPick(t)">{{ t }}</div>
          <div class="copt copt-custom" @click="onPickCustom">
            <AppIcon name="plus" :size="24" tone="p" />
            <span>自定义</span>
          </div>
        </div>

        <div class="crow">
          <input
            ref="inputEl"
            class="cinput"
            :value="customName"
            :placeholder="props.placeholder"
            @input="onInput"
          />
          <div class="caddbtn" @click="onAddCustom">添加</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ClothingAdd —— 分类类型下拉
   M5：内联展开 → 真浮层（fixed + 遮罩）；新设计改为白卡面板 + 结构线。 */

.cwrap {
  width: 100%;
  padding: 7px 0 2px;
}
.ctrigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  padding: 0 11px;
  border-radius: 7px;
  border: 1px solid var(--glass-border);
  background: var(--surface-2);
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
}
.ctrigger.on {
  border-color: var(--line);
  background: var(--surface-3);
}
.cph {
  color: var(--ink-3);
}

/* —— 浮层 —— */
.cmask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 1090;
  background: rgba(15, 23, 42, 0.28);
}

.cpanel {
  position: fixed;
  z-index: 1100;
  max-height: 330px;
  display: flex;
  flex-direction: column;
  padding: 9px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid var(--glass-border);
  box-shadow: 0 20px 50px -15px rgba(15, 23, 42, 0.4);
}

.chead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1px 2px 6px;
}
.ctitle {
  font-size: 13px;
  font-weight: 650;
  color: var(--ink);
}
.cclose {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin: -4px -4px -4px 0;
  border-radius: 6px;
  cursor: pointer;
}
.cclose:active {
  background: var(--surface-2);
}

.clist {
  flex: 1;
  min-height: 0;
  max-height: 250px;
  overflow-y: auto;
}
.clist::-webkit-scrollbar {
  width: 2px;
}
.clist::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 1px;
}

.copt {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 9px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
}
.copt:active {
  background: var(--surface-2);
}
.copt-custom {
  gap: 4px;
  margin-top: 3px;
  padding-top: 5px;
  border-top: 1px solid var(--hairline);
  border-radius: 0;
  color: var(--ink);
  font-weight: 600;
}
.crow {
  display: flex;
  gap: 5px;
  padding-top: 7px;
  margin-top: 3px;
  border-top: 1px solid var(--hairline);
}
.cinput {
  flex: 1;
  min-width: 0;
  min-height: 38px;
  padding: 0 9px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid transparent;
  font-size: 12.5px;
  color: var(--ink);
}
.cinput::placeholder {
  color: var(--ink-3);
}
.caddbtn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-height: 38px;
  padding: 0 13px;
  border-radius: 6px;
  background: var(--primary);
  color: #ffffff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.caddbtn:active {
  opacity: 0.84;
}
</style>
