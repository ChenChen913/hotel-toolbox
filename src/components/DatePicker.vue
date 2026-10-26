<script setup lang="ts">
// DatePicker —— 自绘日历（源实现 src/components/DatePicker.vue）
// 月份切换头 + 7 列星期标头 + 日期网格；今天带金点、选中墨绿底、过去日期弱化。
//
// Stitch 重设计（2026-10-26）：
//   · 新增 end 属性，只用于「显示」退房日与入住区间，不改变选择逻辑；
//     选择仍然只回传入住日（onPick → value）。
//   · 选中 / 退房日都是深色圆角块；区间内用浅蓝底；今天用琥珀点。
//
// ⚠️ 两条硬约束（踩过坑，不要改回去）：
//   1. 禁止给日期格加 aspect-ratio —— 配合 min-height 会把高度反向算成最小宽度，
//      窄屏 7 列撑不下会溢出；
//   2. 星期标头与日期格必须用同一套列宽计算，否则列宽不一致就会错位。
//      这里继续用 flex + 14.2857% 固定百分比宽度。
import { ref, onMounted, watch } from 'vue';
import AppIcon from './AppIcon.vue';

interface Cell {
  key: string;
  str: string;
  d: number | null;
  sel: boolean;
  today: boolean;
  past: boolean;
  /** 入住与退房之间的日期（不含两端） */
  inrange: boolean;
  /** 退房日（仅高亮，不参与选择） */
  endDay: boolean;
  /** 格内小字：入住 / 退房 */
  mark: string;
}

const props = withDefaults(defineProps<{ value: string; end?: string }>(), {
  end: '',
});

const emit = defineEmits<{ (e: 'change', str: string): void }>();

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const MONTH_TAG = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n: number) => String(n).padStart(2, '0');
const toStr = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** 手动 split('-') 解析，禁止 new Date('YYYY-MM-DD')（会被当 UTC，时区偏移导致差一天） */
function parse(s: string): { y: number; m: number } {
  if (!s) {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  }
  const p = s.split('-').map(Number);
  return { y: p[0], m: p[1] - 1 };
}

const y = ref(0);
const m = ref(0);
const cells = ref<Cell[]>([]);
const week = WEEK;
const monthTag = ref('');

onMounted(() => {
  const cur = parse(props.value);
  y.value = cur.y;
  m.value = cur.m;
  monthTag.value = MONTH_TAG[cur.m];
  build();
});

// observers('value, end')：入住日或退房日变化时重算；
// 视图月份跟随入住日所在月份（Vue 下 watch 只在挂载后触发，天然满足「已初始化」）。
watch([() => props.value, () => props.end], () => {
  if (!y.value) return;
  if (props.value) {
    const cur = parse(props.value);
    if (cur.y !== y.value || cur.m !== m.value) {
      y.value = cur.y;
      m.value = cur.m;
      monthTag.value = MONTH_TAG[cur.m];
    }
  }
  build();
});

function build(): void {
  const cy = y.value;
  const cm = m.value;
  const n = new Date();
  const todayStr = toStr(n.getFullYear(), n.getMonth(), n.getDate());
  const lead = new Date(cy, cm, 1).getDay();
  const total = new Date(cy, cm + 1, 0).getDate();
  const value = props.value;
  const end = props.end;

  const list: Cell[] = [];
  for (let i = 0; i < lead; i++) {
    list.push({ key: `p${i}`, str: '', d: null, sel: false, today: false, past: false, inrange: false, endDay: false, mark: '' });
  }
  for (let d = 1; d <= total; d++) {
    const str = toStr(cy, cm, d);
    const sel = str === value;
    const endDay = !!end && str === end;
    const inrange = !!value && !!end && str > value && str < end;
    list.push({
      key: str,
      str,
      d,
      sel,
      today: str === todayStr,
      past: str < todayStr,
      inrange,
      endDay,
      mark: sel ? '入住' : endDay ? '退房' : inrange ? '住' : '',
    });
  }
  while (list.length % 7) {
    const k = list.length;
    list.push({ key: `e${k}`, str: '', d: null, sel: false, today: false, past: false, inrange: false, endDay: false, mark: '' });
  }
  cells.value = list;
  monthTag.value = MONTH_TAG[cm];
}

function onShift(n: number): void {
  const d = new Date(y.value, m.value + n, 1);
  y.value = d.getFullYear();
  m.value = d.getMonth();
  monthTag.value = MONTH_TAG[d.getMonth()];
  build();
}

function onPick(str: string): void {
  if (!str) return;
  emit('change', str);
}
</script>

<template>
  <div class="dpk">
    <div class="dpk-head">
      <div class="dpk-nav" aria-label="上个月" @click="onShift(-1)">
        <AppIcon name="chevron-left" :size="30" tone="i" />
      </div>
      <div class="dpk-titlewrap">
        <span class="dpk-title num">{{ y }} 年 {{ m + 1 }} 月</span>
        <span class="dpk-tag num">{{ monthTag }}</span>
      </div>
      <div class="dpk-nav" aria-label="下个月" @click="onShift(1)">
        <AppIcon name="chevron-right" :size="30" tone="i" />
      </div>
    </div>

    <div class="dpk-week">
      <span v-for="w in week" :key="w" class="dpk-w">{{ w }}</span>
    </div>

    <div class="dpk-grid">
      <div
        v-for="item in cells"
        :key="item.key"
        class="dpk-day"
        :class="{ sel: item.sel, endday: item.endDay, inrange: item.inrange, today: item.today, past: item.past }"
        @click="onPick(item.str)"
      >
        <div v-if="item.d !== null" class="dpk-in">
          <span class="dpk-num num">{{ item.d }}</span>
          <span v-if="item.mark" class="dpk-mark">{{ item.mark }}</span>
          <div v-else-if="item.today" class="dpk-today"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* DatePicker —— Stitch 日历
   7 列等宽；标头与日期格同轨（14.2857%）；不加 aspect-ratio（见 ts 顶部注释）。 */
.dpk {
  padding: 2px 0 0;
}

.dpk-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.dpk-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 9px;
}
/* hover-class="dpk-nav-hover" → :active */
.dpk-nav:active {
  background: var(--surface-2);
}
.dpk-titlewrap {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dpk-title {
  font-size: 15px;
  font-weight: 650;
  color: var(--ink);
  letter-spacing: -0.1px;
}
.dpk-tag {
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-2);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}

.dpk-week {
  display: flex;
  margin: 2px 0 3px;
}
.dpk-w {
  width: 14.2857%;
  text-align: center;
  font-size: 10.5px;
  color: var(--ink-3);
  padding: 2px 0;
}

.dpk-grid {
  display: flex;
  flex-wrap: wrap;
}
.dpk-day {
  width: 14.2857%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 9px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ink);
}
.dpk-in {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 42px;
  border-radius: 8px;
}
.dpk-num {
  font-size: 14px;
  line-height: 1.1;
}
.dpk-mark {
  margin-top: 1px;
  font-size: 8px;
  line-height: 1.1;
  color: rgba(255, 255, 255, 0.8);
}
/* hover-class="dpk-day-hover" → :active */
.dpk-day:active .dpk-in {
  background: var(--surface-2);
}
.dpk-day.past {
  color: var(--ink-3);
}
.dpk-day.today {
  color: var(--ink);
  font-weight: 700;
}
.dpk-today {
  width: 3px;
  height: 3px;
  margin-top: 2px;
  border-radius: 50%;
  background: var(--accent);
}
/* 中间住宿日：整格铺浅蓝底 + 内层深一档蓝块 + “住”字
   不能只给极淡的 info-soft，否则和前后黑色入住/退房对比太弱、看不出区间 */
.dpk-day.inrange {
  background: #dbeaff;
}
.dpk-day.inrange .dpk-in {
  background: #a9ccff;
  color: #08265a;
  border: 1px solid #5b95e8;
}
.dpk-day.inrange .dpk-num {
  font-weight: 650;
}
.dpk-day.inrange .dpk-mark {
  color: #08265a;
}
.dpk-day.sel .dpk-in,
.dpk-day.endday .dpk-in {
  background: var(--primary);
  color: #ffffff;
  box-shadow: 0 5px 12px -6px rgba(15, 23, 42, 0.55);
}
.dpk-day.sel .dpk-num,
.dpk-day.endday .dpk-num {
  font-weight: 650;
}
.dpk-day.sel.today .dpk-today {
  background: #ffffff;
}
</style>
