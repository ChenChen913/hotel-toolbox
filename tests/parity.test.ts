/**
 * 与小程序主线（D:/hotel-miniprogram）的逻辑一致性用例。
 *
 * 为什么单独一个文件：
 *   `tests/engine.test.ts` 是源项目 38 个用例（逐字未改），盯的是红线三件套。
 *   本文件盯的是小程序端新增的扩展层（extra.ts / repair.ts / rich.ts / toast.ts）——
 *   这几个文件在 Web 端是**整文件复制**过来的，用例也按主线 tests/extra-features.test.ts
 *   与 tests/acceptance.test.ts 的 Z 组移植，编号保持一致，方便两端对照。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { CHECKLISTS } from '../src/data';
import { Storage, buildPrep, listStays, newStay, saveStay } from '../src/engine';
import {
  CAT_ORDER_EXT, EXTRA_CHECKOUT_GROUPS, EXTRA_ITEMS, WEATHERS, buildPrepExt,
  getStayExt, isWeather, prepStats, setStayExt, splitByQty,
} from '../src/extra';
import type { ConditionsExt } from '../src/extra';
import { fitCheckMatrix, normalizeStay, parseStaysPayload, sanitizeBackup } from '../src/repair';
import { parseInline, softDashes, toParas } from '../src/rich';
import { TOAST_MS, TOAST_ZERO_TEXT, shouldToastZero } from '../src/toast';
import type { Conditions } from '../src/types';

const base: Conditions = {
  date: '2026-10-28', nights: 2, adults: 2, children: 0, childAge: '0-3',
  elderly: false, pet: false, purpose: '普通短住',
  prefs: { sleep: false, hygiene: false, mosquito: false, gadgets: false },
};
const c = (patch: Partial<ConditionsExt> = {}): ConditionsExt => ({ ...base, ...patch });
const names = (list: ReturnType<typeof buildPrepExt>) => list.map(i => i.name);
const find = (list: ReturnType<typeof buildPrepExt>, part: string) => list.find(i => i.name.includes(part));

beforeEach(() => {
  ['htb_stays_v1', 'htb_gear_v3', 'htb_gear_v4', 'htb_gear_v5', 'htb_ext_v1', 'htb_stays_v1_corrupt']
    .forEach(k => Storage.removeItem(k));
});

describe('T 天气与温度扩展', () => {
  it('T1 天气枚举与校验', () => {
    expect(WEATHERS.map(w => w.k)).toEqual(['晴朗', '多云', '阴天', '雨天', '雪天']);
    expect(isWeather('雨天')).toBe(true);
    expect(isWeather('阴雨天')).toBe(false);
    expect(isWeather(undefined)).toBe(false);
  });

  it('T2 雨天：雨具与防水收纳；折叠伞升为必带', () => {
    const list = buildPrepExt(c({ weather: '雨天' }));
    expect(names(list)).toEqual(expect.arrayContaining(['雨衣/防水外套', '防水鞋套', '防水收纳袋（电子/证件）']));
    expect(find(list, '折叠伞')!.prep).toBe('必带');
  });

  it('T3 晴天高温：太阳镜 / 防晒霜 / 遮阳帽；不出现雨具', () => {
    const list = buildPrepExt(c({ weather: '晴朗', temp: 30 }));
    expect(names(list)).toEqual(expect.arrayContaining(['太阳镜', '防晒霜', '遮阳帽']));
    expect(names(list)).not.toContain('雨衣/防水外套');
  });

  it('T3b 只设高温（不选天气）也会出防晒与小风扇', () => {
    const list = buildPrepExt(c({ temp: 33 }));
    expect(names(list)).toEqual(expect.arrayContaining(['太阳镜', '防晒霜', '遮阳帽', '便携小风扇']));
  });

  it('T4 低温：保暖内衣 / 手套围巾 / 暖宝宝，外套升为必带', () => {
    const list = buildPrepExt(c({ temp: 0 }));
    expect(names(list)).toEqual(expect.arrayContaining(['保暖内衣/加厚打底', '手套/围巾', '暖宝宝']));
    const coat = list.find(i => i.name.indexOf('外套') === 0)!;
    expect(coat.prep).toBe('必带');
  });

  it('T5 不选天气且常温：不出现天气物品（老行程不变）', () => {
    const list = buildPrepExt(c());
    expect(names(list)).not.toContain('雨衣/防水外套');
    expect(names(list)).not.toContain('太阳镜');
    expect(names(list)).not.toContain('保暖内衣/加厚打底');
  });
});

describe('U 包裹类扩展', () => {
  it('U1 行李箱与随身包恒为候选', () => {
    const list = buildPrepExt(c());
    expect(names(list)).toEqual(expect.arrayContaining(['行李箱/大件行李', '随身小包/斜挎包']));
  });

  it('U2 旅游带双肩包，出差带公文包', () => {
    const travel = buildPrepExt(c({ purpose: '旅游', purposeExt: '旅游' }));
    expect(names(travel)).toContain('双肩包');
    const work = buildPrepExt(c({ purpose: '出差', purposeExt: '出差' }));
    expect(names(work)).toContain('公文包/电脑包');
  });
});

describe('V 退房押金扩展', () => {
  it('V1 退房追加「押金与账单」组，含押金退回检查', () => {
    expect(EXTRA_CHECKOUT_GROUPS.length).toBeGreaterThan(0);
    const text = EXTRA_CHECKOUT_GROUPS.flatMap(g => g.items).join(' ');
    expect(text).toContain('押金');
    expect(text).toContain('预授权');
  });

  it('V2 押金组不写进红线 CHECKLISTS 数据', () => {
    expect(EXTRA_CHECKOUT_GROUPS.every(g => g.items.length > 0)).toBe(true);
  });
});

describe('W 扩展层通用口径', () => {
  it('W1 扩展分类排在 CAT_ORDER_EXT 里，不污染源 CAT_ORDER', () => {
    expect(CAT_ORDER_EXT).toEqual(expect.arrayContaining(['娱乐', '学习', '化妆品']));
    expect(EXTRA_ITEMS.every(i => i.id.startsWith('x_'))).toBe(true);
  });

  it('W2 splitByQty：qty=0 进「不带」，>0 留在清单', () => {
    const { active, zero } = splitByQty([{ qty: 0 }, { qty: 1 }, { qty: 2 }]);
    expect(active).toHaveLength(2);
    expect(zero).toHaveLength(1);
  });

  it('W3 prepStats：qty=0 既不进分子也不进分母', () => {
    const stat = prepStats([{ qty: 0, done: false }, { qty: 1, done: true }, { qty: 2, done: false }]);
    expect(stat).toEqual({ done: 1, total: 2 });
  });

  it('W4 扩展字段按行程存取，删除后不再残留', () => {
    setStayExt('stay_a', { relation: '情侣', adultsWith: 1, elderlyCount: 0, gender: 'female' });
    expect(getStayExt('stay_a')!.relation).toBe('情侣');
    setStayExt('stay_a', { relation: '家人' });
    expect(getStayExt('stay_a')!.relation).toBe('家人');
  });
});

describe('X 轻提示口径', () => {
  it('X1 只在「从有到无」时弹窗，时长与文案与小程序一致', () => {
    expect(shouldToastZero(1, 0)).toBe(true);
    expect(shouldToastZero(0, 0)).toBe(false);
    expect(shouldToastZero(0, 1)).toBe(false);
    expect(TOAST_MS).toBe(1500);
    expect(TOAST_ZERO_TEXT).toContain('已设为不带');
  });
});

describe('Y 富文本与破折号', () => {
  it('Y1 **加粗** 切成片段，破折号统一换成中文逗号', () => {
    expect(parseInline('前**重点**后')).toEqual([
      { b: false, t: '前', k: 0 },
      { b: true, t: '重点', k: 1 },
      { b: false, t: '后', k: 2 },
    ]);
    expect(softDashes('甲——乙—丙')).toBe('甲，乙，丙');
    expect(toParas('第一段\n\n第二段')).toHaveLength(2);
  });
});

describe('Z 存储读修复与导入净化（repair.ts）', () => {
  it('Z1 合法数据零改动：落盘原文经 parseStaysPayload 一个字节都不变', () => {
    const s = newStay({ ...base }, buildPrep(base));
    s.custom = [{
      name: '瑜伽垫', cat: '自定义', unit: '条', prep: '家里带',
      source: '自定义', users: '每人', qty: 1, done: false,
    }];
    saveStay(s);
    const raw = Storage.getItem('htb_stays_v1')!;
    expect(raw).toBeTruthy();
    const payload = parseStaysPayload(raw);
    expect(payload).not.toBeNull();
    expect(payload!.json).toBe(raw);
    expect(payload!.stays).toEqual(listStays());
  });

  it('Z2 救不了的返回 null：JSON 语法坏 / 顶层不是数组', () => {
    expect(parseStaysPayload('{"broken')).toBeNull();
    expect(parseStaysPayload('{"app":1}')).toBeNull();
    expect(parseStaysPayload('null')).toBeNull();
  });

  it('Z3 platform 降级等效演练：坏原文 → 空表继续，engine 照常工作', () => {
    Storage.setItem('htb_stays_v1', '彻底坏了{{{');
    const raw = Storage.getItem('htb_stays_v1')!;
    const fixed = parseStaysPayload(raw);
    expect(fixed).toBeNull();
    Storage.setItem('htb_stays_v1', fixed ? fixed.json : '[]');
    expect(listStays()).toEqual([]);
    saveStay(newStay(base, buildPrep(base)));
    expect(listStays()).toHaveLength(1);
  });

  it('Z4 缺字段的单条行程被补齐到与 newStay 完全同构（键序一致）', () => {
    const s = normalizeStay({
      id: 'stay_x',
      conditions: { date: '2026-11-01', nights: 'x', adults: -3, children: '2' },
    });
    expect(s).not.toBeNull();
    expect(s!.nights).toBe(1);
    expect(s!.date).toBe('2026-11-01');
    expect(s!.prep).toEqual([]);
    expect(s!.custom).toEqual([]);
    expect(s!.conditions.purpose).toBe('普通短住');
    expect(s!.checkin).toEqual(CHECKLISTS.checkin.groups.map(g => g.items.map(() => false)));
    expect(s!.checkout).toEqual(CHECKLISTS.checkout.groups.map(g => g.items.map(() => false)));
    expect(Object.keys(s!)).toEqual(Object.keys(newStay(base, [])));
  });

  it('Z5 救不了的整条丢弃：无 id / 非对象条目不进结果', () => {
    const bad = parseStaysPayload(
      JSON.stringify([null, 12, 'str', { conditions: {} }, { id: 'ok', conditions: base }]),
    )!;
    expect(bad.stays).toHaveLength(1);
    expect(bad.stays[0].id).toBe('ok');
  });

  it('Z6 checkin 矩阵前向兼容：超长裁掉、缺组补 false、对得上的 true 保留', () => {
    const cur = CHECKLISTS.checkin.groups.map(g => g.items.map(() => false));
    cur[0][0] = true;
    cur[1][0] = true;
    const dirty = cur.slice(0, -1).map(row => [...row, true]);
    expect(fitCheckMatrix(dirty, 'checkin')).toEqual(cur);
    expect(fitCheckMatrix(null, 'checkin'))
      .toEqual(CHECKLISTS.checkin.groups.map(g => g.items.map(() => false)));
    expect(fitCheckMatrix('oops', 'checkout'))
      .toEqual(CHECKLISTS.checkout.groups.map(g => g.items.map(() => false)));
  });

  it('Z7 sanitizeBackup 的两道门：语法坏抛 SyntaxError、非本工具箱抛同文案 Error', () => {
    expect(() => sanitizeBackup('不是json')).toThrow(SyntaxError);
    expect(() => sanitizeBackup('{"app":"别的应用","stays":[]}')).toThrow('不是本工具箱的备份文件');
    expect(() => sanitizeBackup('{"stays":[]}')).toThrow('不是本工具箱的备份文件');
  });
});
