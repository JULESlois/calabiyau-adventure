export interface PlayerBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  kind: 'ice' | 'note';
  life: number;
  phase: number;
  freeze: number; // 冻结时长(冰弹)
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
}

export function makeIceBolt(x: number, y: number, dir: number): PlayerBullet {
  return { x, y, vx: 330 * dir, vy: 0, dmg: 11, kind: 'ice', life: 1.1, phase: 0, freeze: 1.1 };
}

export function makeNote(x: number, y: number, dir: number, spread: number): PlayerBullet {
  return {
    x,
    y,
    vx: 240 * dir,
    vy: spread * 34,
    dmg: 5,
    kind: 'note',
    life: 1.0,
    phase: Math.random() * Math.PI * 2,
    freeze: 0,
  };
}

export function makeEnemyBullet(
  x: number,
  y: number,
  vx: number,
  vy: number,
  dmg = 10,
  color = '#ff8a5c',
  r = 2.5,
): EnemyBullet {
  return { x, y, vx, vy, r, dmg, life: 3.2, color };
}
