export interface PlayerBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  kind: 'ice' | 'note' | 'snipe';
  life: number;
  phase: number;
  freeze: number; // 命中冻结/减速时长
  pierce: number; // 剩余穿透数(≤0 时命中即消耗)
  /** 同一颗子弹不重复命中同一目标 */
  hit?: Set<object>;
}

export interface EnemyBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  life: number;
  color: string;
  /** 发射者(米雪儿「猫踪喵迹」被动反向标记用) */
  owner?: object;
  /** 已被弦闪擦过,同一颗子弹不重复触发 */
  flashed?: boolean;
}

/** 米雪儿·警探:速射步枪弹(命中短暂冰凝减速) */
export function makeRifleShot(x: number, y: number, dir: number): PlayerBullet {
  return { x, y, vx: 340 * dir, vy: 0, dmg: 7, kind: 'ice', life: 0.9, phase: 0, freeze: 0.22, pierce: 1 };
}

/** 香奈美·谢幕曲:轻点速射音符 */
export function makeQuickNote(x: number, y: number, dir: number): PlayerBullet {
  return {
    x, y, vx: 260 * dir, vy: 0, dmg: 6, kind: 'note', life: 0.9,
    phase: Math.random() * Math.PI * 2, freeze: 0, pierce: 1,
  };
}

/** 香奈美·谢幕曲:蓄力狙击(charge ∈ [0,1],满蓄穿透) */
export function makeSnipe(x: number, y: number, dir: number, charge: number): PlayerBullet {
  return {
    x, y,
    vx: (300 + 230 * charge) * dir,
    vy: 0,
    dmg: 8 + Math.round(18 * charge),
    kind: 'snipe',
    life: 1.2,
    phase: 0,
    freeze: 0,
    pierce: charge > 0.85 ? 3 : 1,
  };
}

/** 喵喵卫士炮塔弹(自动索敌,减速) */
export function makeTurretBolt(x: number, y: number, angle: number): PlayerBullet {
  return {
    x, y,
    vx: Math.cos(angle) * 260,
    vy: Math.sin(angle) * 260,
    dmg: 5,
    kind: 'ice',
    life: 0.8,
    phase: 0,
    freeze: 0.5,
    pierce: 1,
  };
}
