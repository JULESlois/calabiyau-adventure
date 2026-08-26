import type { PlayerBullet } from './entities/bullets';
import type { Enemy } from './entities/enemies';
import type { ParticleSystem } from './entities/particles';
import type { Input } from './Input';
import type { Rect } from './utils';
import type { WorldState } from './world/WorldState';

export type CharId = 'michele' | 'kanami';
export type StringMode = 'normal' | 'ground' | 'wall' | 'glide';

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
    owner?: object,
  ): void;
  sfx(name: string): void;
  shake(n: number): void;
  spawnEnemy(kind: string, x: number, y: number): void;
  /**
   * 直接对玩家结算一次伤害(受无敌帧保护)。
   * 敌弹永远打不到纸片形态,而「弦相审判」的平面相攻击恰恰只打纸片 ——
   * 这类"非弹丸"的命中只能由 Boss 主动发起。
   */
  hurtPlayer(dmg: number, fromX: number): boolean;
}

/**
 * 玩家对房间的完整依赖面。
 * 玩家比敌人需要得多(输入、永久能力、发射己方子弹、部署技能物),但仍远少于整个
 * PlayState —— 显式列出来,可以挡住往房间状态里随手取值的漂移。
 */
export interface PlayerHost extends WorldApi {
  readonly input: Input;
  readonly world: WorldState;
  readonly playerBullets: PlayerBullet[];
  tileAt(c: number, r: number): number;
  deployTurret(x: number, y: number): void;
  throwSonarDart(x: number, y: number, dir: number): void;
}

/**
 * Boss 的共同契约。房间里的战斗结算、HUD 血条与部署物索敌都只依赖这一层,
 * 因此加一个新 Boss 不需要再改 PlayState 的战斗代码。
 */
export interface BossLike {
  /** 区分结算方式:守望者通关,回响守卫只解封屏障。 */
  readonly kind: 'guardian' | 'warden' | 'arbiter';
  readonly displayName: string;
  /** HUD 血条的阶段刻痕数量。 */
  readonly phases: number;
  /** 贴身接触伤害。 */
  readonly contactDmg: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  readonly state: string;
  readonly active: boolean;
  rect(): Rect;
  awaken(w: WorldApi): void;
  hit(dmg: number, w: WorldApi): void;
  update(dt: number, w: WorldApi): void;
  render(ctx: CanvasRenderingContext2D, time: number): void;
}

/** 部署物(喵喵卫士 / 声呐镖)需要索敌,因此比敌人多看到敌人与 Boss 列表。 */
export interface GadgetHost extends WorldApi {
  readonly enemies: Enemy[];
  readonly boss: BossLike | null;
  readonly playerBullets: PlayerBullet[];
  sonarPulse(x: number, y: number, radius: number, heal?: boolean): void;
}
