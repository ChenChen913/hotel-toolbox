// platform.ts —— 浏览器存储适配层（对应小程序 core/platform.ts）
//
// engine.ts 是红线文件（与小程序端逐字一致），它把读写收敛到导出的 Storage 对象上。
// 这儿在启动时把三个方法替换成 localStorage 实现，并补上小程序端同名能力：
//   · 读行程主存储先过 repair.parseStaysPayload：存储损坏不再白屏，坏数据隔离到
//     CORRUPT_KEY 备查，救不回来的按空表继续（A1 / A4）；
//   · 读好物存储（v5 与两个旧版迁移源）先做 JSON 合法性校验：engine 里旧版分支是
//     裸 JSON.parse，坏数据会直接抛穿「好物」「我的」两页；坏原文隔离后按「没有这一版」继续；
//   · 写失败不再静默：本地存储写满或隐私模式受限时提示「本次修改可能未保存」（A3）。
//
// ⚠️ 必须是「先生成原生方法快照，再替换」：
//   浏览器里 `Storage` 就是 `localStorage` 本身（同一个对象）。若替换后的方法里
//   继续写 `localStorage.getItem(...)`，调用会指回刚替换的函数 → 无限递归 →
//   异常被 catch 成 null，表现为「所有数据都读不到」。
//
// 纯浏览器 API，不碰 wx.*；node 测试若没有 localStorage，本函数直接返回。

import { Storage, STORE_KEY } from './engine';
import { parseStaysPayload } from './repair';
import { showToast } from './ui';

/** 行程损坏原文的隔离键：原文存档，方便人工找回；mine 页的 OWN_KEYS 里有它 */
export const CORRUPT_KEY = 'htb_stays_v1_corrupt';

/** 好物损坏原文的隔离键（v5 / v4 / v3 任意一版解析失败都会存这里） */
export const GEAR_CORRUPT_KEY = 'htb_gear_corrupt';

/** 好物存储的三个版本键：v5 当前，v4/v3 是迁移源 */
const GEAR_KEYS = new Set(['htb_gear_v5', 'htb_gear_v4', 'htb_gear_v3']);

interface NativeOps {
  get(k: string): string | null;
  set(k: string, v: string): void;
  del(k: string): void;
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function installWebStorage(): void {
  if (typeof localStorage === 'undefined') return;

  // 先摘出原生方法并绑定，后面所有读写都走它，绝不回头引用 localStorage.*
  const native: NativeOps = {
    get: localStorage.getItem.bind(localStorage),
    set: localStorage.setItem.bind(localStorage),
    del: localStorage.removeItem.bind(localStorage),
  };

  /** 原文隔离：只保留第一份，避免每次启动互相覆盖 */
  const quarantine = (key: string, raw: string): void => {
    try {
      if (native.get(key) === null) native.set(key, raw);
    } catch {
      /* 隔离本身失败不阻塞主流程 */
    }
  };

  Storage.getItem = (k: string): string | null => {
    try {
      const v = native.get(k);
      if (v === null) return null;
      if (k === STORE_KEY) {
        const fixed = parseStaysPayload(v);
        if (fixed) return fixed.json;
        quarantine(CORRUPT_KEY, v);
        return '[]';
      }
      if (GEAR_KEYS.has(k)) {
        if (isJson(v)) return v;
        quarantine(GEAR_CORRUPT_KEY, v);
        return null;
      }
      return v;
    } catch {
      return null;
    }
  };

  Storage.setItem = (k: string, v: string): void => {
    try {
      native.set(k, v);
    } catch (e) {
      console.error('[StayKit] 存储写入失败', k, e);
      showToast('本机存储异常，本次修改可能未保存');
    }
  };

  Storage.removeItem = (k: string): void => {
    try {
      native.del(k);
    } catch {
      /* 读不到只是数据没了，不值得打扰用户 */
    }
  };
}
