<script setup lang="ts">
// GearPanel —— 只展示「这一件物品」的好物收藏（源实现 src/components/GearPanel.vue）
// 耳塞行里出现充电宝的品牌没有意义，故按 name + cat 双重过滤。
//
// ⚠️ 与源实现的不同（修了一处下标错位）：
//   源实现 rows = listGear(cat).map((entry, index) => ({ entry, index }))，
//   index 是「按 cat 过滤后」的下标，但 removeGear(index) 是在「完整列表」上 splice。
//   当 cat 不是第一个分类时下标会错位，删到别的条目上。
//   这里改成在完整列表上定位下标（name + cat 双条件），删除一定命中自己那一条。
//   （源项目未改动，仅在此记录。）
import { nextTick, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import { addGear, listGear, removeGear } from '../engine';
import type { GearEntry } from '../types';

/** 物品名（如「耳塞」）/ 物品分类（如「洗漱」），与 name 一起定位 */
const props = defineProps<{ name: string; cat: string }>();
const emit = defineEmits<{ change: [] }>();

interface RowVM {
  index: number; // 完整列表中的真实下标
  name: string;
  brand: string;
}

const rows = ref<RowVM[]>([]);
const adding = ref(false);
const newBrand = ref('');
const focusBrand = ref(false);
const brandEl = ref<HTMLInputElement | null>(null);

/** 重新定位当前物品的好物行 */
function refresh(emitChange = true) {
  const name = props.name;
  const cat = props.cat;
  rows.value = listGear()
    .map((entry: GearEntry, index: number) => ({ entry, index }))
    .filter(r => r.entry.name === name && r.entry.cat === cat)
    .map(r => ({ index: r.index, name: r.entry.name, brand: r.entry.brand || '' }));
  if (emitChange) emit('change');
}

// observers: 'name, cat'
watch(() => [props.name, props.cat], () => refresh(false), { immediate: true });

function toggleAdd() {
  adding.value = !adding.value;
  focusBrand.value = !adding.value;
  if (focusBrand.value) nextTick(() => brandEl.value?.focus());
}

function cancelAdd() {
  adding.value = false;
  newBrand.value = '';
  focusBrand.value = false;
}

function onBrand(e: Event) {
  newBrand.value = String((e.target as HTMLInputElement).value || '');
}

function add() {
  const brand = String(newBrand.value || '').trim();
  addGear({ name: props.name, brand: brand || undefined, cat: props.cat });
  adding.value = false;
  newBrand.value = '';
  focusBrand.value = false;
  refresh();
}

function remove(i: number) {
  if (Number.isNaN(i) || i < 0) return;
  removeGear(i);
  refresh();
}
</script>

<template>
  <div class="gearpanel" @click.stop>
    <div class="gphead">
      <div class="gphead-l">
        <div class="gpmark"></div>
        <span class="gptitle">关联好物</span>
      </div>
      <span class="gpfoot">个人偏好 · 非商业推荐</span>
    </div>

    <div v-for="r in rows" :key="r.index" class="gearitem">
      <div class="grow">
        <span class="gname">{{ r.name }}</span>
        <span v-if="r.brand" class="gbrand">{{ r.brand }}</span>
        <span v-else class="gbrand gbrand-empty">只记了物品，没记品牌</span>
      </div>
      <div class="pickdel" aria-label="删除" @click.stop="remove(r.index)">
        <AppIcon name="trash" :size="24" tone="k" />
      </div>
    </div>

    <div v-if="rows.length === 0" class="gpempty">还没记这一件。可以只记品牌，也可以只记「用哪款」。</div>

    <template v-if="adding">
      <div class="gearadd">
        <input
          ref="brandEl"
          class="ginput grow"
          placeholder="品牌 · 型号（可留空）"
          :value="newBrand"
          @input="onBrand"
          @click.stop
        />
        <div class="gbtn" @click.stop="add">保存</div>
        <div class="gcancel" @click.stop="cancelAdd">取消</div>
      </div>
    </template>
    <template v-else>
      <div class="gactions">
        <div class="gaction" @click.stop="toggleAdd">
          <AppIcon name="plus" :size="24" tone="d" />
          <span>记一个品牌</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* GearPanel —— 物品行内展开的「关联好物」面板
   浅蓝灰底、结构线、紧凑行高；组件内不依赖全局样式里的类。 */
.gearpanel {
  width: 100%;
  margin-top: 5px;
  padding: 9px 10px 7px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--glass-border);
}
.gphead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 2px;
}
.gphead-l {
  display: flex;
  align-items: center;
  gap: 4px;
}
.gpmark {
  width: 3px;
  height: 11px;
  border-radius: 1.5px;
  background: var(--accent);
}
.gptitle {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
}
.gpfoot {
  font-size: 9.5px;
  color: var(--ink-3);
}

.gearitem {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  border-bottom: 1px solid var(--hairline);
}
.gearitem:last-of-type {
  border-bottom: 0;
}
.grow {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 5px;
  flex-wrap: wrap;
}
.gname {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
}
.gbrand {
  font-size: 11.5px;
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
  cursor: pointer;
}
.pickdel:active {
  background: var(--danger-soft);
  opacity: 0.72;
}

.gpempty {
  margin: 4px 0 1px;
  font-size: 11.5px;
  color: var(--ink-2);
}

.gearadd {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
}
.ginput {
  min-width: 0;
  min-height: 36px;
  padding: 0 8px;
  border-radius: 6px;
  background: #ffffff;
  border: 1px solid var(--line);
  font-size: 12px;
  color: var(--ink);
}
.gbtn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-height: 36px;
  padding: 0 10px;
  border-radius: 6px;
  background: var(--primary);
  color: #ffffff;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.gbtn:active {
  opacity: 0.72;
}
.gcancel {
  flex-shrink: 0;
  padding: 0 3px;
  font-size: 11.5px;
  color: var(--ink-3);
  cursor: pointer;
}
.gcancel:active {
  opacity: 0.72;
}

.gactions {
  display: flex;
  align-items: center;
  margin-top: 4px;
}
.gaction {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 36px;
  padding: 0 2px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
}
.gaction:active {
  opacity: 0.72;
}
</style>
