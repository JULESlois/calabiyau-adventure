// 常驻世界状态:能力、旗标、收集品、地图探索、重生锚点。
// 房间(PlayState)是一次性的,WorldState 跨房间存续并负责序列化。

import type { CharId } from '../types';
import { MAX_HP, MAX_STRING } from '../constants';
import {
  HIDDEN_CHIPS,
  progressionStats,
  ROOMS,
  SHOP_ITEMS,
  SHORTCUT_IDS,
  START_ROOM,
  type Ability,
} from './world';

const KNOWN_ABILITIES = new Set<Ability>(['paper', 'cling', 'djump', 'dash', 'kanami']);
const KNOWN_CHIPS = new Set([...SHOP_ITEMS, ...HIDDEN_CHIPS].map((item) => item.id));

export interface WorldSave {
  version: 2;
  abilities: Ability[];
  flags: string[];
  crystals: string[];
  visited: string[];
  benchRoom: string;
  char: CharId;
  cleared: boolean;
  dust?: number;
  chips?: string[];
  shortcuts?: string[];
  hpMax?: number;
}

export class WorldState {
  abilities = new Set<Ability>();
  /** 世界旗标,如 'boss:guardian'、'rescue:kanami' */
  flags = new Set<string>();
  /** 已拾取弦晶 id(`房间:列:行`) */
  crystals = new Set<string>();
  /** 已到访房间(地图屏) */
  visited = new Set<string>();
  /** 重生锚点(信标所在房间) */
  benchRoom: string = START_ROOM;
  /** 是否已通关 */
  cleared = false;
  /** 晶尘(货币) */
  dust = 0;
  /** 已购记忆芯片(永久生效) */
  chips = new Set<string>();
  /** 已从远端开启的永久捷径 */
  shortcuts = new Set<string>();
  /** 生命上限(弦晶共鸣与强健弦芯可提升) */
  hpMax = MAX_HP;
  /** 弦能上限(弦晶共鸣可提升) */
  energyMax = MAX_STRING;

  // ---- 房间之间携带的运行时状态(存档时按信标满状态处理) ----
  char: CharId = 'michele';
  hp = MAX_HP;
  energy = MAX_STRING;

  has(a: Ability): boolean {
    return this.abilities.has(a);
  }

  grant(a: Ability): void {
    this.abilities.add(a);
    if (a === 'kanami') this.flags.add('rescue:kanami');
  }

  crystalId(room: string, col: number, row: number): string {
    return `${room}:${col}:${row}`;
  }

  recalculateStats(): void {
    const stats = progressionStats(this.crystals.size, this.chips);
    this.hpMax = stats.hpMax;
    this.energyMax = stats.energyMax;
    this.hp = Math.min(this.hp, this.hpMax);
    this.energy = Math.min(this.energy, this.energyMax);
  }

  serialize(): WorldSave {
    return {
      version: 2,
      abilities: [...this.abilities],
      flags: [...this.flags],
      crystals: [...this.crystals],
      visited: [...this.visited],
      benchRoom: this.benchRoom,
      char: this.char,
      cleared: this.cleared,
      dust: this.dust,
      chips: [...this.chips],
      shortcuts: [...this.shortcuts],
      hpMax: this.hpMax,
    };
  }

  static deserialize(d: WorldSave): WorldState {
    const w = new WorldState();
    for (const a of d.abilities) if (KNOWN_ABILITIES.has(a)) w.abilities.add(a);
    for (const f of d.flags) if (typeof f === 'string') w.flags.add(f);
    for (const c of d.crystals) if (typeof c === 'string') w.crystals.add(c);
    for (const v of d.visited) if (typeof v === 'string' && ROOMS[v]) w.visited.add(v);
    w.benchRoom = ROOMS[d.benchRoom] ? d.benchRoom : START_ROOM;
    w.char = d.char === 'kanami' && w.abilities.has('kanami') ? 'kanami' : 'michele';
    w.cleared = !!d.cleared;
    w.dust = typeof d.dust === 'number' && Number.isSafeInteger(d.dust) ? Math.max(0, d.dust) : 0;
    for (const c of d.chips ?? []) if (KNOWN_CHIPS.has(c)) w.chips.add(c);
    for (const s of d.shortcuts ?? []) if (SHORTCUT_IDS.has(s)) w.shortcuts.add(s);
    w.recalculateStats();
    return w;
  }
}
