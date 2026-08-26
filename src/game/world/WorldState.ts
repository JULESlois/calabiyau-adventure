// 常驻世界状态:能力、旗标、收集品、地图探索、重生锚点。
// 房间(PlayState)是一次性的,WorldState 跨房间存续并负责序列化。

import type { CharId } from '../types';
import { MAX_HP, MAX_STRING } from '../constants';
import {
  HIDDEN_CHIPS,
  progressionStats,
  ROOM_LIST,
  SHOP_CHIPS,
  SHORTCUT_IDS,
  START_ROOM,
  totalCrystals,
  type Ability,
} from './world';

/** 存档的可序列化形状;来自 localStorage 时字段可能被手改过,尚不可信。 */
export interface WorldSave {
  version: 2;
  abilities: Ability[];
  flags: string[];
  crystals: string[];
  visited: string[];
  benchRoom: string;
  activatedBeacons?: string[];
  char: CharId;
  cleared: boolean;
  dust?: number;
  chips?: string[];
  shortcuts?: string[];
  brokenWalls?: string[];
  forgeLevel?: number;
  hpMax?: number;
}

declare const validated: unique symbol;

/**
 * 经 save.ts 的 parseWorldSave() 校验、规范化并补全默认值后的存档。
 * 品牌符号不导出,所以只有校验器能造出这个类型 —— deserialize() 借此在类型层面
 * 拒收任何未过校验的 localStorage 数据,校验逻辑因此只需存在于一处。
 * 派生字段 hpMax 被刻意剔除:它由弦晶与芯片重算,存档里的数值一律不采信。
 */
export type ValidWorldSave = Required<Omit<WorldSave, 'hpMax'>> & {
  readonly [validated]: true;
};

/** 通关结算屏的一行。 */
export interface CompletionEntry {
  label: string;
  got: number;
  total: number;
}

/** 四场 Boss 的旗标(结算屏与完成度都按这一份名单)。 */
export const BOSS_FLAGS = ['boss:warden', 'boss:arbiter', 'boss:gambit', 'boss:guardian'] as const;

/**
 * 通关完成度。
 * 总分取**各项比例的平均**而不是"总获得/总数量":后者会让弦晶(80 项)
 * 淹没 Boss(4 项)与遗珍(4 项),把一次全收集跑和一次直冲通关显示成几乎一样的数字。
 */
export function completionReport(w: WorldState): { entries: CompletionEntry[]; percent: number } {
  const owned = (ids: readonly string[]) => ids.filter((id) => w.chips.has(id)).length;
  const entries: CompletionEntry[] = [
    { label: '弦晶', got: w.crystals.size, total: totalCrystals() },
    { label: '遗珍', got: owned(HIDDEN_CHIPS.map((c) => c.id)), total: HIDDEN_CHIPS.length },
    { label: '芯片', got: owned(SHOP_CHIPS.map((c) => c.id)), total: SHOP_CHIPS.length },
    { label: '捷径', got: w.shortcuts.size, total: SHORTCUT_IDS.size },
    { label: '房间', got: w.visited.size, total: ROOM_LIST.length },
    { label: '首领', got: BOSS_FLAGS.filter((f) => w.flags.has(f)).length, total: BOSS_FLAGS.length },
  ];
  const mean = entries.reduce((sum, e) => sum + (e.total > 0 ? Math.min(1, e.got / e.total) : 1), 0)
    / entries.length;
  return { entries, percent: Math.round(mean * 100) };
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
  /** 已由玩家实际互动激活的信标；仅这些地点可快速传送。 */
  activatedBeacons = new Set<string>([START_ROOM]);
  /** 是否已通关 */
  cleared = false;
  /** 晶尘(货币) */
  dust = 0;
  /** 已购记忆芯片(永久生效) */
  chips = new Set<string>();
  /** 已从远端开启的永久捷径 */
  shortcuts = new Set<string>();
  /** 已击碎的可破坏墙(`房间:列:行`),与 crystals 同构 */
  brokenWalls = new Set<string>();
  /** 弦芯熔铸的已购次数(可重复商品) */
  forgeLevel = 0;
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

  /** 可破坏墙与弦晶同构:房间 + 格位唯一定位一处地形改动。 */
  breakableId(room: string, col: number, row: number): string {
    return `${room}:${col}:${row}`;
  }

  recalculateStats(): void {
    const stats = progressionStats(this.crystals.size, this.chips, this.forgeLevel);
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
      activatedBeacons: [...this.activatedBeacons],
      char: this.char,
      cleared: this.cleared,
      dust: this.dust,
      chips: [...this.chips],
      shortcuts: [...this.shortcuts],
      brokenWalls: [...this.brokenWalls],
      forgeLevel: this.forgeLevel,
      hpMax: this.hpMax,
    };
  }

  /** 入参已由 parseWorldSave() 校验,这里不再重复校验,只还原状态并推导派生值。 */
  static deserialize(d: ValidWorldSave): WorldState {
    const w = new WorldState();
    w.abilities = new Set(d.abilities);
    w.flags = new Set(d.flags);
    w.crystals = new Set(d.crystals);
    w.visited = new Set(d.visited);
    w.benchRoom = d.benchRoom;
    w.activatedBeacons = new Set(d.activatedBeacons);
    w.char = d.char;
    w.cleared = d.cleared;
    w.dust = d.dust;
    w.chips = new Set(d.chips);
    w.shortcuts = new Set(d.shortcuts);
    w.brokenWalls = new Set(d.brokenWalls);
    w.forgeLevel = d.forgeLevel;
    // hpMax/energyMax 只认弦晶与芯片推导出的结果,与运行时成长走同一条路径
    w.recalculateStats();
    return w;
  }
}
