// 玩家本地偏好:音量、屏震、弦化输入模式、静音。
//
// 刻意与 WorldSave 分开存(独立 key、独立版本):偏好不是进度,
// 不应该走 ValidWorldSave 的信任边界,也不应该在「新的冒险」时被清掉。

const KEY = 'calabiyau_stringbound_settings_v1';

export interface GameSettings {
  /** 音乐音量 0..1 */
  musicVol: number;
  /** 音效音量 0..1 */
  sfxVol: number;
  /** 屏幕震动强度:0 关 / 0.5 减半 / 1 全开 */
  shake: number;
  /** true 时弦化为切换式(按一下进入、再按退出),给按住困难的玩家 */
  paperToggle: boolean;
  muted: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  musicVol: 0.8,
  sfxVol: 0.8,
  shake: 1,
  paperToggle: false,
  muted: false,
};

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

/** 宽容解析:偏好损坏就回默认值,绝不因此拒绝加载。 */
export function parseSettings(value: unknown): GameSettings {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };
  const v = value as Record<string, unknown>;
  const shakeRaw = clamp01(v.shake, DEFAULT_SETTINGS.shake);
  return {
    musicVol: clamp01(v.musicVol, DEFAULT_SETTINGS.musicVol),
    sfxVol: clamp01(v.sfxVol, DEFAULT_SETTINGS.sfxVol),
    // 只允许三档,避免存档里出现 0.37 这类没有 UI 表达的值
    shake: shakeRaw >= 0.75 ? 1 : shakeRaw >= 0.25 ? 0.5 : 0,
    paperToggle: v.paperToggle === true,
    muted: v.muted === true,
  };
}

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return parseSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function storeSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // localStorage 不可用时静默:偏好丢了不致命
  }
}
