import type { ParticleSystem } from './entities/particles';
import type { Rect } from './utils';

export type CharId = 'michele' | 'kanami';

/** 实体与世界交互的窄接口,由 PlayState 实现 */
export interface WorldApi {
  time: number;
  mapW: number; // 像素宽
  mapH: number; // 像素高
  playerX: number; // 玩家中心
  playerY: number;
  playerPaper: boolean;
  particles: ParticleSystem;
  rectHitsSolid(r: Rect, paper?: boolean): boolean;
  hasGroundAt(x: number, y: number): boolean;
  fireEnemyBullet(
    x: number,
    y: number,
    vx: number,
    vy: number,
    dmg?: number,
    color?: string,
    r?: number,
  ): void;
  sfx(name: string): void;
  shake(n: number): void;
  spawnEnemy(kind: string, x: number, y: number): void;
}
