/**
 * 平台存储层（src/platform.ts）的回归用例。
 *
 * 为什么单独建文件：
 *   `tests/parity.test.ts` 的 Z3 是「手动模拟」platform 的降级分支，并没有真正调用
 *   installWebStorage —— 于是「platform.ts 从未被 main.ts 引用」这个 P0 一直没被测出来。
 *   这里用一份 localStorage 替身，真正走一遍替换后的 Storage，盯住三件事：
 *     1. 行程存储损坏 → 返回 '[]' 且原文进隔离键（不再白屏）；
 *     2. 好物存储（含 v4/v3 迁移源）损坏 → 返回 null，engine 不会裸 JSON.parse 抛错；
 *     3. 合法数据一个字节都不动。
 *
 * node 环境没有 localStorage，用例自己装一个最小实现；装完再动态 import，
 * 保证 engine 侧拿到的就是被替换后的对象。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StoreMap = Map<string, string>;

function makeLocalStorage(map: StoreMap) {
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  };
}

let map: StoreMap;

beforeEach(() => {
  map = new Map();
  vi.stubGlobal('localStorage', makeLocalStorage(map));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('platform installWebStorage', () => {
  it('未安装时读到坏数据会抛错（证明这层确实必要）', async () => {
    map.set('htb_stays_v1', '坏了{{{');
    const { Storage } = await import('../src/engine');
    // engine 的裸 JSON.parse 在 listStays 里抛错 —— 这正是 platform 要兜住的场景
    expect(() => JSON.parse(Storage.getItem('htb_stays_v1') || '[]')).toThrow();
  });

  it('行程存储损坏：返回空表 + 原文隔离，应用照常启动', async () => {
    map.set('htb_stays_v1', '坏了{{{');
    const { Storage, STORE_KEY, listStays } = await import('../src/engine');
    const { installWebStorage, CORRUPT_KEY } = await import('../src/platform');
    installWebStorage();

    expect(Storage.getItem(STORE_KEY)).toBe('[]');
    expect(map.get(CORRUPT_KEY)).toBe('坏了{{{');
    expect(listStays()).toEqual([]);
  });

  it('好物 v5 损坏：返回 null 并隔离，engine 回落到种子而不是抛错', async () => {
    map.set('htb_gear_v5', 'not-json');
    const { Storage, listGear } = await import('../src/engine');
    const { installWebStorage, GEAR_CORRUPT_KEY } = await import('../src/platform');
    installWebStorage();

    expect(Storage.getItem('htb_gear_v5')).toBeNull();
    expect(map.get(GEAR_CORRUPT_KEY)).toBe('not-json');
    expect(() => listGear()).not.toThrow();
  });

  it('好物旧版 v4/v3 损坏：同样不抛错（engine 里这两支是裸 parse）', async () => {
    map.set('htb_gear_v4', '{坏');
    map.set('htb_gear_v3', '{也坏');
    const { Storage, listGear } = await import('../src/engine');
    const { installWebStorage } = await import('../src/platform');
    installWebStorage();

    expect(Storage.getItem('htb_gear_v4')).toBeNull();
    expect(Storage.getItem('htb_gear_v3')).toBeNull();
    expect(() => listGear()).not.toThrow();
  });

  it('合法行程数据原样返回，不被重写', async () => {
    const { Storage, STORE_KEY, newStay, saveStay } = await import('../src/engine');
    const { installWebStorage } = await import('../src/platform');
    installWebStorage();

    const conditions = {
      date: '2026-02-01', nights: 2, adults: 1, children: 0, childAge: '0-3' as const,
      elderly: false, pet: false, purpose: '普通短住' as const,
      prefs: { sleep: false, hygiene: false, mosquito: false, gadgets: false },
    };
    saveStay(newStay(conditions, []));
    const raw = map.get(STORE_KEY)!;
    expect(raw).toBeTruthy();
    // 读修复的承诺：合法数据一个字节都不动
    expect(Storage.getItem(STORE_KEY)).toBe(raw);
  });

  it('写入失败时提示用户（隐私模式 / 配额满）', async () => {
    // 原生方法在 install 时就被摘取，所以要一开始就换成「写必失败」的替身
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
    });
    const { Storage } = await import('../src/engine');
    const { installWebStorage } = await import('../src/platform');
    const { toastText } = await import('../src/ui');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installWebStorage();

    Storage.setItem('htb_stays_v1', '[]');
    expect(toastText.value).toContain('本次修改可能未保存');
  });
});
