// 存档 v2:世界状态(能力/旗标/收集/捷径/地图/重生锚)整体序列化。
import { MAX_HP } from './constants';
import {
  HIDDEN_CHIPS,
  progressionStats,
  ROOMS,
  SHOP_ITEMS,
  SHORTCUT_IDS,
  type Ability,
} from './world/world';
import type { WorldSave } from './world/WorldState';

const KEY = 'calabiyau_stringbound_save_v2';
const ABILITIES = new Set<Ability>(['paper', 'cling', 'djump', 'dash', 'kanami']);
const CHIPS = new Set([...SHOP_ITEMS, ...HIDDEN_CHIPS].map((item) => item.id));
const MAX_LIST_LENGTH = 4096;
const MAX_VALUE_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_LIST_LENGTH) return null;
  if (value.some((item) => typeof item !== 'string' || item.length > MAX_VALUE_LENGTH)) return null;
  return [...new Set(value as string[])];
}

/** 校验并规范化 localStorage 中不可信的存档数据。 */
export function parseWorldSave(value: unknown): WorldSave | null {
  if (!isRecord(value) || value.version !== 2) return null;

  const abilities = readStringList(value.abilities);
  const flags = readStringList(value.flags);
  const crystals = readStringList(value.crystals);
  const visited = readStringList(value.visited);
  if (!abilities || !flags || !crystals || !visited) return null;
  if (abilities.some((ability) => !ABILITIES.has(ability as Ability))) return null;
  if (typeof value.benchRoom !== 'string' || !ROOMS[value.benchRoom]) return null;
  if (value.char !== 'michele' && value.char !== 'kanami') return null;
  if (typeof value.cleared !== 'boolean') return null;

  const dust = value.dust ?? 0;
  if (typeof dust !== 'number' || !Number.isSafeInteger(dust) || dust < 0) return null;

  const chips = value.chips === undefined ? [] : readStringList(value.chips);
  if (!chips || chips.some((chip) => !CHIPS.has(chip))) return null;
  const shortcuts = value.shortcuts === undefined ? [] : readStringList(value.shortcuts);
  if (!shortcuts || shortcuts.some((shortcut) => !SHORTCUT_IDS.has(shortcut))) return null;

  if (
    value.hpMax !== undefined &&
    (typeof value.hpMax !== 'number' || !Number.isFinite(value.hpMax) || value.hpMax < MAX_HP)
  ) {
    return null;
  }
  const hpMax = progressionStats(crystals.length, new Set(chips)).hpMax;

  return {
    version: 2,
    abilities: abilities as Ability[],
    flags,
    crystals,
    visited,
    benchRoom: value.benchRoom,
    char: value.char,
    cleared: value.cleared,
    dust,
    chips,
    shortcuts,
    hpMax,
  };
}

export function loadWorldSave(): WorldSave | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return parseWorldSave(JSON.parse(raw));
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
