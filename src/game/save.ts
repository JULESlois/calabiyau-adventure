export interface SaveData {
  unlocked: number; // 已解锁到第几关 (1-4)
  cleared: boolean; // 是否通关过
  bestCrystals: Record<number, number>;
}

const KEY = 'calabiyau_stringbound_save_v1';

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as SaveData;
      if (typeof d.unlocked === 'number') {
        return { unlocked: d.unlocked, cleared: !!d.cleared, bestCrystals: d.bestCrystals ?? {} };
      }
    }
  } catch {
    // localStorage 不可用时静默降级
  }
  return { unlocked: 1, cleared: false, bestCrystals: {} };
}

export function storeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}
