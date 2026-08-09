// 常驻世界状态:能力、旗标、收集品、地图探索、重生锚点。
// 房间(PlayState)是一次性的,WorldState 跨房间存续并负责序列化。

import type { CharId } from '../types';
import { MAX_HP, MAX_STRING } from '../constants';
import { progressionStats, START_ROOM, type Ability } from './world';

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
      activatedBeacons: [...this.activatedBeacons],
      char: this.char,
      cleared: this.cleared,
      dust: this.dust,
      chips: [...this.chips],
      shortcuts: [...this.shortcuts],
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
    // hpMax/energyMax 只认弦晶与芯片推导出的结果,与运行时成长走同一条路径
    w.recalculateStats();
    return w;
  }
}
