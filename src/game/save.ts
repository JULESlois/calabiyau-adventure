// 存档 v2:世界状态(能力/旗标/收集/地图/重生锚)整体序列化。
import type { WorldSave } from './world/WorldState';

const KEY = 'calabiyau_stringbound_save_v2';

export function loadWorldSave(): WorldSave | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as WorldSave;
    if (d && d.version === 2 && Array.isArray(d.abilities) && typeof d.benchRoom === 'string') {
      return d;
    }
  } catch {
    // localStorage 不可用时静默降级
  }
  return null;
}

export function storeWorldSave(data: WorldSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function clearWorldSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
