// platform.ts —— 浏览器存储适配层（对应小程序 core/platform.ts）
//
// engine.ts 是红线文件（与小程序端逐字一致），它把读写收敛到导出的 Storage 对象上。
// 这儿在启动时把三个方法替换成 localStorage 实现，并补上小程序端同名能力：
//   · 读行程主存储先过 repair.parseStaysPayload：存储损坏不再白屏，坏数据隔离到
//     CORRUPT_KEY 备查，救不回来的按空表继续（A1 / A4）；
//   · 写失败不再静默：本地存储写满或隐私模式受限时提示「本次修改可能未保存」（A3）。
//
// 纯浏览器 API，不碰 wx.*；node 测试不 import 本文件，engine 仍走内存 Storage。

import { Storage, STORE_KEY } from './engine';
import { parseStaysPayload } from './repair';
import { showToast } from './ui';

/** 损坏存储的隔离键：原文存档，方便人工找回；mine 页的 OWN_KEYS 里有它 */
export const CORRUPT_KEY = 'htb_stays_v1_corrupt';

export function installWebStorage(): void {
  Storage.getItem = (k: string): string | null => {
    try {
      const v = localStorage.getItem(k);
      if (v === null) return null;
      if (k === STORE_KEY) {
        const fixed = parseStaysPayload(v);
        if (fixed) return fixed.json;
        if (localStorage.getItem(CORRUPT_KEY) === null) {
          localStorage.setItem(CORRUPT_KEY, v);
        }
        return '[]';
      }
      return v;
    } catch {
      return null;
    }
  };
  Storage.setItem = (k: string, v: string): void => {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      console.error('[StayKit] 存储写入失败', k, e);
      showToast('本机存储异常，本次修改可能未保存');
    }
  };
  Storage.removeItem = (k: string): void => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* 读不到只是数据没了，不值得打扰用户 */
    }
  };
}
