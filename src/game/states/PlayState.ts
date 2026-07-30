import { COLORS, INVULN_TIME, TILE, VIEW_H, VIEW_W } from '../constants';
import { Boss } from '../entities/boss';
import type { EnemyBullet, PlayerBullet } from '../entities/bullets';
import { Enemy, type EnemyKind } from '../entities/enemies';
import { ParticleSystem } from '../entities/particles';
import { makePickup, type Pickup } from '../entities/pickups';
import { Player } from '../entities/Player';
import {
  parseRows,
  T_EMPTY,
  T_HIDDEN,
  T_MEMBRANE,
  T_ONEWAY,
  T_POLARITY,
  T_SOLID,
  T_SPIKE,
  type LevelTheme,
  type ParsedRows,
} from '../levels/levels';
import { CatTurret, SonarDart } from '../entities/gadgets';
import { Background } from '../render/background';
import { drawCandle, drawExitGate, drawPickup } from '../render/sprites';
import { drawAbilityShrine, drawBench, drawCagedKanami, drawNavigator } from '../render/props';
import { drawHUD } from '../render/hud';
import type { StringMode, WorldApi } from '../types';
import { clamp, lerp, rectsOverlap, type Rect } from '../utils';
import type { Engine, GameState } from '../Engine';
import {
  ABILITY_INFO,
  CRYSTAL_MILESTONES,
  HIDDEN_CHIPS,
  HIDDEN_CHIP_MARKERS,
  ROOMS,
  ROOM_LIST,
  SHOP_ITEMS,
  START_ROOM,
  totalCrystals,
  ZONES,
  type Ability,
  type ExitDef,
  type RoomDef,
  type ShortcutDef,
  type ZoneDef,
  type ZoneId,
} from '../world/world';
import type { WorldState } from '../world/WorldState';

export interface SceneContinuity {
  /** 出口门槛在旧画面中的位置,用于把新房间的对应门槛对齐。 */
  portalScreenX: number;
  portalScreenY: number;
  /** 角色相对旧门槛的偏移,保留跳跃或下坠中的横纵位置。 */
  playerPortalOffsetX: number;
  playerPortalOffsetY: number;
  time: number;
  vx: number;
  vy: number;
  facing: number;
  stringMode: StringMode;
  onGround: boolean;
  jumpsUsed: number;
  coyote: number;
  airDashed: boolean;
  dashT: number;
  dashCdT: number;
}

export type EntryInfo =
  | { kind: 'start' }
  | { kind: 'bench'; fromZone?: ZoneId }
  | {
      kind: 'door';
      fromRoom: string;
      ex: number;
      ey: number;
      fromSide: 'left' | 'right' | 'down';
      scene?: SceneContinuity;
    };

interface Mover {
  baseX: number;
  baseY: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  w: number;
  h: number;
  axis: 'h' | 'v';
  range: number;
  speed: number;
  phase: number;
}

interface Updraft {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PressureJet {
  x: number;
  y: number;
  w: number;
  h: number;
  dir: -1 | 1;
  phase: number;
}

interface Resonator {
  x: number;
  y: number;
  phase: number;
  beat: number;
}

interface Conveyor {
  x: number;
  y: number;
  w: number;
  dir: -1 | 1;
}

interface ShortcutRuntime {
  def: ShortcutDef;
  gate: Rect;
  lever: { x: number; y: number };
}

interface BenchSpot {
  x: number;
  y: number;
  resting: boolean;
}

interface AbilitySpot {
  x: number;
  y: number;
  kind: Ability;
}

interface FloatingHint {
  lines: string[];
  x: number;
  y: number;
  delay: number;
  t: number;
  maxT: number;
}

type Overlay = 'none' | 'pause' | 'dead' | 'ability' | 'victory' | 'map' | 'shop' | 'fast_travel';

const TOTAL_CRYSTALS = totalCrystals();
const ZONE_INDEX: Record<string, number> = {
  coast: 1,
  tide: 2,
  lab: 5,
  choir: 4,
  sky: 3,
  hangar: 6,
};

const ZONE_MAP_ORIGIN = ROOM_LIST.reduce(
  (origins, room) => {
    const current = origins[room.zone];
    if (!current) origins[room.zone] = { x: room.mapX, y: room.mapY };
    else {
      current.x = Math.min(current.x, room.mapX);
      current.y = Math.min(current.y, room.mapY);
    }
    return origins;
  },
  {} as Partial<Record<ZoneId, { x: number; y: number }>>,
);

/**
 * 背景相位必须只由房间决定，不能随玩家走过的路径累加。
 * 地图纵坐标不是严格的世界高度，因此只取四分之一屏作为纵向视差步长。
 */
export function roomBackdropAnchor(room: RoomDef): { x: number; y: number } {
  const origin = ZONE_MAP_ORIGIN[room.zone] ?? { x: 0, y: 0 };
  return {
    x: (room.mapX - origin.x) * VIEW_W,
    y: (room.mapY - origin.y) * (VIEW_H / 4),
  };
}

export function moverDisplacement(time: number, speed: number, phase: number, range: number): number {
  return Math.sin(time * speed + phase) * range;
}

export class PlayState implements GameState, WorldApi {
  roomId: string;
  room: RoomDef;
  zone: ZoneDef;
  level: ParsedRows;
  player: Player;
  enemies: Enemy[] = [];
  boss: Boss | null = null;
  playerBullets: PlayerBullet[] = [];
  enemyBullets: EnemyBullet[] = [];
  pickups: (Pickup & { id?: string; chipId?: string })[] = [];
  movers: Mover[] = [];
  updrafts: Updraft[] = [];
  pressureJets: PressureJet[] = [];
  resonators: Resonator[] = [];
  conveyors: Conveyor[] = [];
  polaritySpots: { x: number; y: number }[] = [];
  polarityOpen = false;
  shortcuts: ShortcutRuntime[] = [];
  turrets: CatTurret[] = [];
  darts: SonarDart[] = [];
  /** 显形中的隐藏平台:tile 索引 → 剩余秒数 */
  private hiddenReveal = new Map<number, number>();
  benches: BenchSpot[] = [];
  abilitySpots: AbilitySpot[] = [];
  kanamiSpot: { x: number; y: number } | null = null;
  shopSpot: { x: number; y: number } | null = null;
  shopSel = 0;
  fastTravelIndex = 0;
  private nearBenchSpot: BenchSpot | null = null;
  private nearShop = false;
  private nearAbilitySpot: AbilitySpot | null = null;
  private nearKanamiSpot: { x: number; y: number } | null = null;
  private nearShortcutSpot: ShortcutRuntime | null = null;
  private nearPolaritySpot: { x: number; y: number } | null = null;
  particles = new ParticleSystem();
  bg: Background;
  private transitionBg: Background | null = null;
  private transitionSurface: HTMLCanvasElement | null = null;
  theme: LevelTheme;

  gate = { x: 0, y: 0, active: false };
  lastEntryX = 0;
  lastEntryY = 0;

  camX = 0;
  camY = 0;
  backdropOffsetX = 0;
  backdropOffsetY = 0;
  /** 仅用于房间滑动过场；不会改变逻辑镜头坐标。 */
  transitionWorldOffsetX = 0;
  transitionWorldOffsetY = 0;
  shakeT = 0;
  shakeMag = 0;
  time = 0;
  introT = 0;
  overlay: Overlay = 'none';
  overlayT = 0;
  abilityKind: Ability = 'paper';
  private toasts: { msg: string; t: number }[] = [];
  private floatingHints: FloatingHint[] = [];
  private meleeHits = new Map<object, number>();
  /** 环境飘浮微粒(余烬/尘埃/落灰),屏幕空间 */
  private embers: { x: number; y: number; vx: number; vy: number; ph: number }[] = [];
  private transitionThemeStep = -1;
  private musicThreatT = 0;

  constructor(
    public engine: Engine,
    roomId: string,
    entry: EntryInfo,
  ) {
    this.roomId = roomId;
    this.room = ROOMS[roomId];
    this.zone = ZONES[this.room.zone];
    this.theme = this.zone.theme;
    this.level = parseRows(this.room.rows);
    this.bg = new Background(this.theme, ZONE_INDEX[this.room.zone]);
    if (this.room.transition) {
      const targetZone = ZONES[this.room.transition.to];
      this.transitionBg = new Background(targetZone.theme, ZONE_INDEX[targetZone.id]);
    }

    const world = this.world;
    this.shortcuts = (this.room.shortcuts ?? []).map((def) => ({
      def,
      gate: {
        x: def.gate.col * TILE,
        y: def.gate.row * TILE,
        w: def.gate.w * TILE,
        h: def.gate.h * TILE,
      },
      lever: {
        x: def.lever.col * TILE + TILE / 2,
        y: (def.lever.row + 1) * TILE,
      },
    }));
    let startX = 40;
    let startY = 100;
    for (const s of this.level.spawns) {
      const cx = s.col * TILE + TILE / 2;
      const bottom = (s.row + 1) * TILE;
      switch (s.char) {
        case 'P':
          startX = cx;
          startY = bottom;
          break;
        case 'T':
          this.benches.push({ x: cx, y: bottom, resting: false });
          break;
        case 'F':
          if (!world.has('paper')) this.abilitySpots.push({ x: cx, y: bottom, kind: 'paper' });
          break;
        case 'W':
          if (!world.has('cling')) this.abilitySpots.push({ x: cx, y: bottom, kind: 'cling' });
          break;
        case 'J':
          if (!world.has('djump')) this.abilitySpots.push({ x: cx, y: bottom, kind: 'djump' });
          break;
        case 'D':
          if (!world.has('dash')) this.abilitySpots.push({ x: cx, y: bottom, kind: 'dash' });
          break;
        case 'G':
          if (!world.has('kanami')) this.kanamiSpot = { x: cx, y: bottom };
          break;
        case '*': {
          const id = world.crystalId(roomId, s.col, s.row);
          if (!world.crystals.has(id)) {
            const pk = makePickup(cx, s.row * TILE + TILE / 2, 'crystal') as Pickup & { id?: string };
            pk.id = id;
            this.pickups.push(pk);
          }
          break;
        }
        case 'a':
        case 'b':
        case 'c':
        case 'd': {
          const chipId = HIDDEN_CHIP_MARKERS[s.char];
          if (!world.chips.has(chipId)) {
            const pk = makePickup(cx, s.row * TILE + TILE / 2, 'relic') as Pickup & { chipId?: string };
            pk.chipId = chipId;
            this.pickups.push(pk);
          }
          break;
        }
        case 'h':
          this.pickups.push(makePickup(cx, s.row * TILE + TILE / 2, 'heart'));
          break;
        case 'e':
          this.pickups.push(makePickup(cx, s.row * TILE + TILE / 2, 'energy'));
          break;
        case 'S':
          this.shopSpot = { x: cx, y: bottom };
          break;
        case '1':
          this.enemies.push(new Enemy('patrol', cx, bottom));
          break;
        case '5':
          this.enemies.push(new Enemy('exploder', cx, bottom));
          break;
        case '6':
          this.enemies.push(new Enemy('slasher', cx, bottom));
          break;
        case '2':
          this.enemies.push(new Enemy('drone', cx, bottom));
          break;
        case '3':
          this.enemies.push(new Enemy('turret', cx, bottom));
          break;
        case '4':
          this.enemies.push(new Enemy('shield', cx, bottom));
          break;
        case 'M':
          this.movers.push({
            baseX: cx, baseY: s.row * TILE, x: cx, y: s.row * TILE,
            prevX: cx, prevY: s.row * TILE, w: 40, h: 6,
            axis: 'h', range: 52, speed: 1.1, phase: s.col * 0.7,
          });
          break;
        case 'N':
          this.movers.push({
            baseX: cx, baseY: s.row * TILE, x: cx, y: s.row * TILE,
            prevX: cx, prevY: s.row * TILE, w: 40, h: 6,
            axis: 'v', range: 62, speed: 0.9, phase: s.col * 0.7,
          });
          break;
        case 'U':
          this.updrafts.push({ x: cx - 48, y: bottom - 104, w: 96, h: 104 });
          break;
        case '>':
        case '<': {
          const dir = s.char === '>' ? 1 : -1;
          this.pressureJets.push({
            x: dir > 0 ? cx - 8 : cx - 88,
            y: bottom - 48,
            w: 96,
            h: 48,
            dir,
            phase: s.col * 0.31,
          });
          break;
        }
        case 'I':
          this.polaritySpots.push({ x: cx, y: bottom });
          break;
        case 'O':
          this.resonators.push({ x: cx, y: bottom - 9, phase: s.col * 0.07, beat: -1 });
          break;
        case 'K':
        case 'k':
          this.conveyors.push({ x: cx - 32, y: bottom - 4, w: 64, dir: s.char === 'K' ? 1 : -1 });
          break;
        case 'B':
          if (world.flags.has('boss:guardian')) {
            this.gate.x = this.mapW / 2;
            this.gate.y = this.mapH - 3 * TILE;
            this.gate.active = true;
          } else {
            this.boss = new Boss(cx, bottom);
          }
          break;
        default:
          break;
      }
    }

    // ---- 入场位置 ----
    let px = startX;
    let py = startY;
    let facing = 1;
    let zoneChanged = entry.kind === 'bench' && entry.fromZone !== undefined
      ? entry.fromZone !== this.room.zone
      : true;
    if (entry.kind === 'bench' && this.benches.length > 0) {
      px = this.benches[0].x;
      py = this.benches[0].y;
    } else if (entry.kind === 'door') {
      px = entry.ex * TILE + TILE / 2;
      py = (entry.ey + 1) * TILE;
      facing = entry.fromSide === 'left' ? -1 : 1;
      const fromRoom = ROOMS[entry.fromRoom];
      zoneChanged = this.room.transition ? false : Boolean(fromRoom?.transition) || fromRoom?.zone !== this.room.zone;
    }
    this.player = new Player(px, py);
    this.player.facing = facing;
    this.player.char = world.has('kanami') ? world.char : 'michele';
    this.player.hp = world.hp;
    this.player.energy = world.energy;
    if (entry.kind === 'door' && entry.scene) {
      if (entry.fromSide === 'down') this.player.x += entry.scene.playerPortalOffsetX;
      else this.player.y += entry.scene.playerPortalOffsetY;
      this.player.vx = entry.scene.vx;
      this.player.vy = entry.scene.vy;
      this.player.facing = entry.scene.facing < 0 ? -1 : 1;
      this.player.stringMode = entry.scene.stringMode === 'wall' ? 'normal' : entry.scene.stringMode;
      this.player.onGround = entry.scene.onGround;
      this.player.jumpsUsed = entry.scene.jumpsUsed;
      this.player.coyote = entry.scene.coyote;
      this.player.airDashed = entry.scene.airDashed;
      this.player.dashT = entry.scene.dashT;
      this.player.dashCdT = entry.scene.dashCdT;
      this.time = entry.scene.time;
    }
    this.syncMoversToTime(true);
    this.lastEntryX = this.player.x;
    this.lastEntryY = this.player.y;

    this.introT = zoneChanged ? 2.8 : 0;
    if (
      entry.kind === 'start' &&
      roomId === START_ROOM &&
      world.abilities.size === 0 &&
      !world.flags.has('tutorial:start')
    ) {
      world.flags.add('tutorial:start');
      this.showFloatingHint(
        ['A / D 移动 · W / 空格 跳跃', 'J 射击 · K 近战 · F 交互'],
        this.player.x,
        this.player.y - 48,
        2.8,
      );
    }

    // 环境微粒
    const zi = ZONE_INDEX[this.room.zone];
    for (let i = 0; i < 42; i++) {
      const falling = zi === 3;
      this.embers.push({
        x: Math.random() * VIEW_W,
        y: Math.random() * VIEW_H,
        vx: (Math.random() - 0.5) * 10,
        vy: falling ? 10 + Math.random() * 16 : zi === 2 ? 0 : -(6 + Math.random() * 14),
        ph: Math.random() * Math.PI * 2,
      });
    }
    this.camX = clamp(this.player.x - VIEW_W / 2, 0, Math.max(0, this.mapW - VIEW_W));
    this.camY = clamp(this.player.y - VIEW_H / 2, 0, Math.max(0, this.mapH - VIEW_H));
    if (entry.kind === 'door' && entry.scene) {
      if (entry.fromSide === 'down') {
        this.transitionWorldOffsetX =
          entry.scene.portalScreenX + entry.scene.playerPortalOffsetX - (this.player.x - this.camX);
      } else {
        this.transitionWorldOffsetY =
          entry.scene.portalScreenY + entry.scene.playerPortalOffsetY - (this.player.y - this.camY);
      }
    }
    const backdrop = roomBackdropAnchor(this.room);
    this.backdropOffsetX = backdrop.x;
    this.backdropOffsetY = backdrop.y;
  }

  // ---------------- WorldApi ----------------
  get world(): WorldState {
    return this.engine.world;
  }
  get mapW(): number {
    return this.level.w * TILE;
  }
  get mapH(): number {
    return this.level.h * TILE;
  }
  get playerX(): number {
    return this.player.centerX();
  }
  get playerY(): number {
    return this.player.centerY();
  }
  get playerPaper(): boolean {
    return this.player.paper;
  }
  get input() {
    return this.engine.input;
  }

  sfx(name: string): void {
    this.engine.audio.sfx(name);
  }

  shake(n: number): void {
    this.shakeT = 0.35;
    this.shakeMag = Math.max(this.shakeMag, n);
  }

  toast(msg: string): void {
    this.toasts.push({ msg, t: 2.6 });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  private showFloatingHint(lines: string[], x: number, y: number, delay = 0, duration = 4.8): void {
    this.floatingHints.push({ lines, x, y, delay, t: duration, maxT: duration });
  }

  private updateFloatingHints(dt: number): void {
    for (const hint of this.floatingHints) {
      if (hint.delay > 0) hint.delay = Math.max(0, hint.delay - dt);
      else hint.t -= dt;
    }
    this.floatingHints = this.floatingHints.filter((hint) => hint.t > 0);
  }

  tileAt(c: number, r: number): number {
    if (c < 0 || c >= this.level.w) return T_SOLID; // 左右边界为墙
    if (r < 0 || r >= this.level.h) return T_EMPTY; // 上下开放
    for (const shortcut of this.shortcuts) {
      if (this.world.shortcuts.has(shortcut.def.id)) continue;
      const g = shortcut.def.gate;
      if (c >= g.col && c < g.col + g.w && r >= g.row && r < g.row + g.h) return T_SOLID;
    }
    const t = this.level.tiles[r * this.level.w + c];
    if (t === T_POLARITY) return this.polarityOpen ? T_EMPTY : T_MEMBRANE;
    if (t === T_HIDDEN) {
      return (this.hiddenReveal.get(r * this.level.w + c) ?? 0) > 0 ? T_SOLID : T_EMPTY;
    }
    return t;
  }

  rectHitsSolid(rect: Rect, paper = false): boolean {
    const c0 = Math.floor(rect.x / TILE);
    const c1 = Math.floor((rect.x + rect.w - 0.001) / TILE);
    const r0 = Math.floor(rect.y / TILE);
    const r1 = Math.floor((rect.y + rect.h - 0.001) / TILE);
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const t = this.tileAt(c, r);
        if (t === T_SOLID) return true;
        if (t === T_MEMBRANE && !paper) return true;
      }
    }
    return false;
  }

  hasGroundAt(x: number, y: number): boolean {
    const t = this.tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
    return t === T_SOLID || t === T_ONEWAY;
  }

  fireEnemyBullet(
    x: number,
    y: number,
    vx: number,
    vy: number,
    dmg = 10,
    color = '#ff8a5c',
    r = 2.5,
    owner?: object,
  ): void {
    this.enemyBullets.push({ x, y, vx, vy, r, dmg, life: 3.2, color, owner });
  }

  spawnEnemy(kind: string, x: number, y: number): void {
    const summonedAlive = this.enemies.filter((e) => e.summoned && !e.dead).length;
    if (summonedAlive >= 2) return;
    const e = new Enemy(kind as EnemyKind, x, y);
    e.summoned = true;
    this.enemies.push(e);
    this.particles.burst(x, y - 8, 10, '#c47eff', 80, 0.4);
  }

  // ---------------- 主循环 ----------------
  enter(): void {
    // 音乐由 Engine.startRoom 按场景切换
  }

  update(dt: number): void {
    const input = this.engine.input;
    this.syncMusicState(dt);

    // 地图屏
    if (input.pressed('map') && (this.overlay === 'none' || this.overlay === 'map')) {
      this.overlay = this.overlay === 'map' ? 'none' : 'map';
      this.sfx('ui');
      return;
    }
    if (this.overlay === 'map') {
      this.time += dt * 0.2;
      if (input.pressed('pause') || input.pressed('confirm')) {
        this.overlay = 'none';
        this.sfx('ui');
      }
      return;
    }

    if (input.pressed('pause')) {
      if (this.overlay === 'none') {
        this.overlay = 'pause';
        this.sfx('ui');
        return;
      }
      if (this.overlay === 'pause') {
        this.overlay = 'none';
        this.sfx('ui');
      }
    }

    if (this.overlay === 'pause') {
      if (input.pressed('shoot')) this.engine.respawnAtBench();
      else if (input.pressed('skill')) {
        this.persistRuntime();
        this.engine.showTitle();
      }
      return;
    }

    if (this.overlay === 'shop') {
      this.time += dt * 0.2;
      const n = SHOP_ITEMS.length;
      if (input.pressed('up')) {
        this.shopSel = (this.shopSel - 1 + n) % n;
        this.sfx('ui');
      }
      if (input.pressed('down')) {
        this.shopSel = (this.shopSel + 1) % n;
        this.sfx('ui');
      }
      if (input.pressed('confirm') || input.pressed('interact')) {
        this.buyShopItem(SHOP_ITEMS[this.shopSel].id);
      }
      if (input.pressed('pause') || input.pressed('map')) {
        this.overlay = 'none';
        this.sfx('ui');
      }
      return;
    }

    if (this.overlay === 'fast_travel') {
      this.time += dt * 0.2;
      const bList = this.getVisitedBenches();
      const n = bList.length;
      if (n > 0) {
        if (input.pressed('up')) {
          this.fastTravelIndex = (this.fastTravelIndex - 1 + n) % n;
          this.sfx('ui');
        }
        if (input.pressed('down')) {
          this.fastTravelIndex = (this.fastTravelIndex + 1) % n;
          this.sfx('ui');
        }
        if (input.pressed('confirm') || input.pressed('interact')) {
          const dest = bList[this.fastTravelIndex];
          this.overlay = 'none';
          this.sfx('ui');
          if (dest.id !== this.roomId) {
            this.engine.startBeaconTransfer(dest.id);
          }
        }
      }
      if (input.pressed('pause') || input.pressed('map')) {
        this.overlay = 'none';
        this.sfx('ui');
      }
      return;
    }

    if (this.overlay === 'ability') {
      this.time += dt;
      this.overlayT += dt;
      this.particles.update(dt);
      if (this.overlayT > 0.6 && (input.pressed('confirm') || input.pressed('shoot'))) {
        this.overlay = 'none';
        this.sfx('ui');
      }
      return;
    }

    this.time += dt;
    this.introT -= dt;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) this.shakeMag = 0;
    }
    this.particles.update(dt);
    this.updateFloatingHints(dt);
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter((t) => t.t > 0);

    // 结算类覆盖层
    if (this.overlay === 'dead') {
      this.overlayT -= dt;
      if (this.overlayT <= 0) this.engine.respawnAtBench();
      return;
    }
    if (this.overlay === 'victory') {
      this.overlayT -= dt;
      const canSkip = this.overlayT < 3.2;
      if ((canSkip && (input.pressed('confirm') || input.pressed('shoot'))) || this.overlayT <= 0) {
        this.engine.showTitle();
      }
      return;
    }

    // 移动平台
    for (const m of this.movers) {
      m.prevX = m.x;
      m.prevY = m.y;
      const s = moverDisplacement(this.time, m.speed, m.phase, m.range);
      if (m.axis === 'h') m.x = m.baseX + s;
      else m.y = m.baseY + s;
    }
    this.updateResonators();

    // 玩家
    this.player.update(dt, this);
    this.applyUpdrafts(dt);
    this.applyPressureJets(dt);
    this.rideMovers();
    this.rideConveyors(dt);

    // 房间出口(可能切换状态,之后立即返回)
    if (this.checkExits()) return;

    // 信标 / 能力 / 香奈美 / 商人 手动交互
    this.updateInteractables();

    // Boss 触发与更新
    if (this.boss) {
      if (this.boss.state === 'dormant' && Math.abs(this.playerX - this.boss.x) < 200) {
        this.boss.awaken(this);
        this.engine.audio.playSong('boss', 1.1);
        this.engine.audio.playStinger('bossAwaken');
      }
      const wasDead = this.boss.state === 'dead';
      this.boss.update(dt, this);
      if (!wasDead && this.boss.state === 'dead' && !this.gate.active) {
        this.engine.audio.playStinger('bossDefeat');
        this.engine.audio.playSong('hangar', 1.8);
        this.engine.audio.setMusicState({ intensity: 0, ducked: false });
        this.world.flags.add('boss:guardian');
        this.world.dust += 120;
        this.toast('获得 120 晶尘');
        this.engine.persistWorld();
        this.gate.x = this.mapW / 2;
        this.gate.y = this.mapH - 3 * TILE;
        this.gate.active = true;
        this.enemyBullets = [];
        for (const e of this.enemies) e.dead = true;
      }
    }

    // 敌人
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (Math.abs(e.x - this.playerX) < VIEW_W * 0.9) {
        e.update(dt, this);
      }
    }

    // 部署物(喵喵卫士 / 声呐镖)与隐藏平台计时
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      this.turrets[i].update(dt, this);
      if (this.turrets[i].dead) {
        this.particles.burst(this.turrets[i].x, this.turrets[i].y - 8, 8, '#8fd7ff', 60, 0.4, 'paper');
        this.turrets.splice(i, 1);
      }
    }
    for (let i = this.darts.length - 1; i >= 0; i--) {
      this.darts[i].update(dt, this);
      if (this.darts[i].dead) this.darts.splice(i, 1);
    }
    for (const [k, v] of this.hiddenReveal) {
      const nv = v - dt;
      if (nv <= 0) this.hiddenReveal.delete(k);
      else this.hiddenReveal.set(k, nv);
    }

    this.updateBullets(dt);
    this.resolveCombat();
    this.checkHazards();
    this.collectPickups();
    this.checkGate();
    this.updateCamera(dt);
    this.updateEmbers(dt);

    // 传送门粒子
    if (this.gate.active && Math.random() < 0.14) {
      this.particles.spawn({
        x: this.gate.x + (Math.random() - 0.5) * 16,
        y: this.gate.y - Math.random() * 6,
        vx: (Math.random() - 0.5) * 8,
        vy: -18 - Math.random() * 26,
        life: 0.9,
        color: Math.random() < 0.5 ? '#7ee0f4' : '#e878c0',
        shape: 'spark',
        size: 1,
      });
    }

    if (this.player.dead && this.overlay === 'none') {
      this.overlay = 'dead';
      this.overlayT = 1.6;
      this.engine.audio.setMusicState({ intensity: 0, ducked: true });
      this.sfx('explosion');
      this.particles.burst(this.playerX, this.playerY, 24, this.player.char === 'michele' ? '#8fd7ff' : '#ffb0d8', 150, 0.8);
    }
  }

  private syncMusicState(dt: number): void {
    const bossActive = Boolean(
      this.boss &&
      this.boss.state !== 'dormant' &&
      this.boss.state !== 'dead',
    );
    const gameplayActive = this.overlay === 'none';
    const nearbyThreat = gameplayActive && this.enemies.some((enemy) => (
      !enemy.dead &&
      Math.abs(enemy.x - this.playerX) < VIEW_W * 0.65 &&
      Math.abs(enemy.y - this.playerY) < VIEW_H * 0.8
    ));

    if (nearbyThreat) this.musicThreatT = 2.8;
    else if (gameplayActive) this.musicThreatT = Math.max(0, this.musicThreatT - dt);

    const ducked = this.overlay === 'pause' ||
      this.overlay === 'map' ||
      this.overlay === 'shop' ||
      this.overlay === 'fast_travel' ||
      this.overlay === 'ability' ||
      this.overlay === 'dead';
    const intensity = bossActive ? 2 : this.musicThreatT > 0 ? 1 : 0;
    this.engine.audio.setMusicState({ intensity, ducked });
  }

  // ---------------- 房间切换 ----------------

  private persistRuntime(): void {
    const w = this.world;
    w.char = this.player.char;
    w.hp = this.player.hp;
    w.energy = this.player.energy;
    this.engine.persistWorld();
  }

  private goThrough(exit: ExitDef): void {
    this.persistRuntime();
    const portalX = exit.side === 'down'
      ? ((exit.from + exit.to + 1) / 2) * TILE
      : exit.side === 'left'
        ? 0
        : this.mapW;
    const portalY = exit.side === 'down' ? this.mapH : (exit.to + 1) * TILE;
    this.engine.startRoom(exit.target, {
      kind: 'door',
      fromRoom: this.roomId,
      ex: exit.ex,
      ey: exit.ey,
      fromSide: exit.side,
      scene: {
        portalScreenX: portalX - this.camX,
        portalScreenY: portalY - this.camY,
        playerPortalOffsetX: this.player.x - portalX,
        playerPortalOffsetY: this.player.y - portalY,
        time: this.time,
        vx: this.player.vx,
        vy: this.player.vy,
        facing: this.player.facing,
        stringMode: this.player.stringMode,
        onGround: this.player.onGround,
        jumpsUsed: this.player.jumpsUsed,
        coyote: this.player.coyote,
        airDashed: this.player.airDashed,
        dashT: this.player.dashT,
        dashCdT: this.player.dashCdT,
      },
    });
  }

  /** 返回 true 表示已切换房间 */
  private checkExits(): boolean {
    const p = this.player;
    if (p.dead) return false;
    const r0 = Math.floor((p.y - p.h) / TILE);
    const r1 = Math.floor((p.y - 0.001) / TILE);
    const c = Math.floor(p.x / TILE);
    for (const e of this.room.exits) {
      if (e.side === 'left') {
        if (p.x <= 8 && r1 >= e.from && r0 <= e.to) {
          this.goThrough(e);
          return true;
        }
      } else if (e.side === 'right') {
        if (p.x >= this.mapW - 8 && r1 >= e.from && r0 <= e.to) {
          this.goThrough(e);
          return true;
        }
      } else {
        // down
        if (p.y >= this.mapH + 24 && c >= e.from && c <= e.to) {
          this.goThrough(e);
          return true;
        }
      }
    }
    return false;
  }

  // ---------------- 信标与能力 (手动交互) ----------------

  private getVisitedBenches(): { id: string; name: string; zoneName: string; isCurrent: boolean }[] {
    const list: { id: string; name: string; zoneName: string; isCurrent: boolean }[] = [];
    for (const rid of Object.keys(ROOMS)) {
      const rm = ROOMS[rid];
      if (rm.rows.some((r) => r.includes('T')) && this.world.activatedBeacons.has(rid)) {
        const zn = ZONES[rm.zone]?.name ?? '';
        list.push({
          id: rid,
          name: rm.name,
          zoneName: zn,
          isCurrent: rid === this.roomId,
        });
      }
    }
    return list;
  }

  private updateInteractables(): void {
    const p = this.player;
    if (p.dead) return;
    const pr = p.rect();

    // 永久捷径开关:只在关闭时显示 F,从远端开启后立即持久化。
    this.nearShortcutSpot = null;
    for (const shortcut of this.shortcuts) {
      if (this.world.shortcuts.has(shortcut.def.id)) continue;
      const zone: Rect = { x: shortcut.lever.x - 12, y: shortcut.lever.y - 28, w: 24, h: 28 };
      if (!rectsOverlap(pr, zone)) continue;
      this.nearShortcutSpot = shortcut;
      if (this.input.pressed('interact')) {
        this.world.shortcuts.add(shortcut.def.id);
        this.engine.persistWorld();
        this.sfx('switch');
        this.shake(2);
        this.toast(`${shortcut.def.name} 已开启`);
        this.particles.burst(shortcut.lever.x, shortcut.lever.y - 12, 16, '#ffe9a8', 85, 0.55, 'spark');
        this.nearShortcutSpot = null;
        return;
      }
      break;
    }

    // 研究区极性终端:切换本房间的极性弦膜。
    this.nearPolaritySpot = null;
    for (const spot of this.polaritySpots) {
      const zone: Rect = { x: spot.x - 12, y: spot.y - 28, w: 24, h: 28 };
      if (!rectsOverlap(pr, zone)) continue;
      this.nearPolaritySpot = spot;
      if (this.input.pressed('interact')) {
        this.polarityOpen = !this.polarityOpen;
        this.sfx('switch');
        this.toast(this.polarityOpen ? '极性膜：开放' : '极性膜：封锁');
        this.particles.burst(spot.x, spot.y - 12, 12, '#7ef0ff', 70, 0.4, 'spark');
        return;
      }
      break;
    }

    // 1. 信标 (Bench)
    this.nearBenchSpot = null;
    for (const b of this.benches) {
      const zone: Rect = { x: b.x - 14, y: b.y - 30, w: 28, h: 30 };
      if (rectsOverlap(pr, zone)) {
        this.nearBenchSpot = b;
        if (this.input.pressed('interact')) {
          b.resting = true;
          const w = this.world;
          p.hp = w.hpMax;
          p.energy = w.energyMax;
          w.benchRoom = this.roomId;
          w.activatedBeacons.add(this.roomId);
          w.hp = w.hpMax;
          w.energy = w.energyMax;
          w.char = p.char;
          this.engine.persistWorld();
          this.sfx('checkpoint');
          this.toast('信标已激活 · 进度已保存');
          this.particles.burst(b.x, b.y - 14, 16, '#8ee8f4', 70, 0.7, 'spark');

          // 开启快速传送 overlay
          this.overlay = 'fast_travel';
          this.fastTravelIndex = 0;
          this.sfx('ui');
          return;
        }
        break;
      }
    }

    // 2. 能力祭坛 (Ability Shrine)
    this.nearAbilitySpot = null;
    for (let i = this.abilitySpots.length - 1; i >= 0; i--) {
      const a = this.abilitySpots[i];
      const zone: Rect = { x: a.x - 12, y: a.y - 28, w: 24, h: 28 };
      if (rectsOverlap(pr, zone)) {
        this.nearAbilitySpot = a;
        if (this.input.pressed('interact')) {
          this.abilitySpots.splice(i, 1);
          this.grantAbility(a.kind, a.x, a.y);
          this.nearAbilitySpot = null;
          return;
        }
        break;
      }
    }

    // 3. 救出香奈美 (Caged Kanami)
    this.nearKanamiSpot = null;
    if (this.kanamiSpot) {
      const k = this.kanamiSpot;
      const zone: Rect = { x: k.x - 12, y: k.y - 26, w: 24, h: 26 };
      if (rectsOverlap(pr, zone)) {
        this.nearKanamiSpot = k;
        if (this.input.pressed('interact')) {
          this.kanamiSpot = null;
          this.grantAbility('kanami', k.x, k.y);
          this.nearKanamiSpot = null;
          return;
        }
      }
    }

    // 4. 商人 (Shop NPC)
    this.nearShop = false;
    if (this.shopSpot) {
      const zone: Rect = { x: this.shopSpot.x - 16, y: this.shopSpot.y - 26, w: 32, h: 26 };
      if (rectsOverlap(pr, zone)) {
        this.nearShop = true;
        if (this.input.pressed('interact')) {
          this.overlay = 'shop';
          this.shopSel = 0;
          this.sfx('ui');
          return;
        }
      }
    }
  }

  private grantAbility(kind: Ability, x: number, y: number): void {
    this.world.grant(kind);
    this.persistRuntime();
    this.overlay = 'ability';
    this.abilityKind = kind;
    this.overlayT = 0;
    this.sfx('crystal');
    this.sfx('checkpoint');
    this.engine.audio.playStinger('ability');
    this.engine.audio.setMusicState({ intensity: 0, ducked: true });
    const color = kind === 'kanami' ? '#ffb0d8' : '#8ee8f4';
    this.particles.burst(x, y - 12, 26, color, 120, 0.9, kind === 'kanami' ? 'note' : 'spark');
    this.showFloatingHint([ABILITY_INFO[kind].hint], x, y - 40);
    this.shake(2);
  }

  // ---------------- 商店与晶尘 ----------------

  private buyShopItem(id: string): void {
    const item = SHOP_ITEMS.find((i) => i.id === id);
    if (!item) return;
    const w = this.world;
    if (w.chips.has(id)) {
      this.toast('已持有此记忆芯片');
      return;
    }
    if (w.dust < item.cost) {
      this.toast('晶尘不足……');
      this.sfx('hurt');
      return;
    }
    w.dust -= item.cost;
    const previousHpMax = w.hpMax;
    w.chips.add(id);
    w.recalculateStats();
    const hpGain = w.hpMax - previousHpMax;
    if (hpGain > 0) this.player.hp = Math.min(w.hpMax, this.player.hp + hpGain);
    w.hp = this.player.hp;
    this.engine.persistWorld();
    this.sfx('crystal');
    this.sfx('checkpoint');
    this.toast(`${item.name} 已接入`);
  }

  /** 敌人死亡时散落晶尘 */
  spawnDust(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const pk = makePickup(x + (Math.random() - 0.5) * 10, y - 6, 'dust', true);
      pk.vy = -100 - Math.random() * 80;
      this.pickups.push(pk);
    }
  }

  // ---------------- 角色部署物与声呐 ----------------

  /** 米雪儿:部署喵喵卫士(至多 2 台,先入先出) */
  deployTurret(x: number, y: number): void {
    if (this.turrets.length >= 2) this.turrets.shift();
    this.turrets.push(new CatTurret(x, y));
    this.sfx('switch');
    this.toast('喵喵卫士,就位!');
    this.particles.burst(x, y - 10, 12, '#8fd7ff', 80, 0.5, 'spark');
  }

  /** 香奈美:掷出旋律回响声呐镖 */
  throwSonarDart(x: number, y: number, dir: number): void {
    if (this.darts.length >= 2) this.darts.shift();
    this.darts.push(new SonarDart(x, y, dir * 240, -60));
  }

  /** 声呐脉冲:标记+微伤敌人、显形隐藏平台;heal 时为附近的玩家回复(歌声治愈) */
  sonarPulse(x: number, y: number, radius: number, heal = false): void {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.particles.spawn({
        x: x + Math.cos(a) * 6,
        y: y + Math.sin(a) * 6,
        vx: Math.cos(a) * radius * 1.8,
        vy: Math.sin(a) * radius * 1.8,
        life: 0.32,
        color: '#ffb0d8',
        shape: 'spark',
        size: 1,
      });
    }
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - x, e.y - e.h / 2 - y) < radius) {
        e.markT = Math.max(e.markT, 2.5);
        e.hit(3, 0, this);
        this.onEnemyDamaged(e);
      }
    }
    if (this.boss && this.boss.active && Math.hypot(this.boss.x - x, this.boss.y - 24 - y) < radius + 16) {
      this.boss.hit(3, this);
    }
    // 显形隐藏平台
    const c0 = Math.max(0, Math.floor((x - radius) / TILE));
    const c1 = Math.min(this.level.w - 1, Math.floor((x + radius) / TILE));
    const r0 = Math.max(0, Math.floor((y - radius) / TILE));
    const r1 = Math.min(this.level.h - 1, Math.floor((y + radius) / TILE));
    let fresh = false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (this.level.tiles[r * this.level.w + c] !== T_HIDDEN) continue;
        if (!this.hiddenReveal.has(r * this.level.w + c)) fresh = true;
        this.hiddenReveal.set(r * this.level.w + c, this.world.chips.has('relic_echo') ? 9 : 6);
      }
    }
    if (fresh) this.sfx('crystal');
    if (heal && !this.player.dead && Math.hypot(this.playerX - x, this.playerY - y) < radius) {
      if (this.player.hp < this.world.hpMax) {
        this.player.hp = Math.min(this.world.hpMax, this.player.hp + 2);
        this.particles.spawn({
          x: this.playerX, y: this.playerY - 14, vx: 0, vy: -30,
          life: 0.5, color: '#ffd0e4', shape: 'note',
        });
      }
    }
  }

  // ---------------- 战斗与拾取 ----------------

  private updateEmbers(dt: number): void {
    const zi = ZONE_INDEX[this.room.zone];
    for (const e of this.embers) {
      e.ph += dt;
      e.x += (e.vx + Math.sin(e.ph * 1.4) * 6) * dt;
      e.y += (zi === 2 ? Math.sin(e.ph) * 8 : e.vy) * dt;
      if (e.y < -4) e.y = VIEW_H + 4;
      if (e.y > VIEW_H + 4) e.y = -4;
      if (e.x < -4) e.x = VIEW_W + 4;
      if (e.x > VIEW_W + 4) e.x = -4;
    }
  }

  private rideMovers(): void {
    const p = this.player;
    const pr = p.rect();
    for (const m of this.movers) {
      const top = m.y;
      const mx0 = m.x - m.w / 2;
      const mx1 = m.x + m.w / 2;
      const overlapX = pr.x + pr.w > mx0 && pr.x < mx1;
      if (!overlapX) continue;
      const dy = m.y - m.prevY;
      if (p.vy >= 0 && p.y >= top - 8 && p.y <= top + Math.max(8, dy + 8)) {
        p.y = top;
        p.vy = 0;
        p.onGround = true;
        p.jumpsUsed = 0;
        p.x += m.x - m.prevX;
      }
    }
  }

  private applyUpdrafts(dt: number): void {
    const p = this.player;
    if (p.stringMode !== 'glide') return;
    const pr = p.rect();
    for (const u of this.updrafts) {
      if (!rectsOverlap(pr, u)) continue;
      p.vy = Math.max(-150, p.vy - 520 * dt);
      if (Math.random() < 0.35) {
        this.particles.spawn({
          x: p.x + (Math.random() - 0.5) * 14,
          y: p.y - Math.random() * p.h,
          vx: (Math.random() - 0.5) * 12,
          vy: -40 - Math.random() * 35,
          life: 0.35,
          color: '#e8f4ff',
          shape: 'paper',
          size: 1,
        });
      }
    }
  }

  private pressureJetActive(jet: PressureJet): boolean {
    return Math.sin(this.time * 2.2 + jet.phase) > -0.2;
  }

  private applyPressureJets(dt: number): void {
    const p = this.player;
    if (p.stringMode === 'wall') return;
    const pr = p.rect();
    for (const jet of this.pressureJets) {
      if (!this.pressureJetActive(jet) || !rectsOverlap(pr, jet)) continue;
      const force = p.paper ? 520 : 260;
      p.vx = clamp(p.vx + jet.dir * force * dt, -190, 190);
      if (Math.random() < 0.18) {
        this.particles.spawn({
          x: p.x - jet.dir * (4 + Math.random() * 10),
          y: p.centerY() + (Math.random() - 0.5) * 16,
          vx: jet.dir * (45 + Math.random() * 35),
          vy: (Math.random() - 0.5) * 18,
          life: 0.28,
          color: '#8de0c4',
          shape: 'spark',
          size: 1,
        });
      }
    }
  }

  private rideConveyors(dt: number): void {
    const p = this.player;
    if (!p.onGround || p.stringMode === 'wall') return;
    for (const belt of this.conveyors) {
      if (p.x < belt.x || p.x > belt.x + belt.w || Math.abs(p.y - (belt.y + 4)) > 5) continue;
      p.vx = clamp(p.vx + belt.dir * 420 * dt, -155, 155);
    }
  }

  private updateResonators(): void {
    for (const resonator of this.resonators) {
      const beat = Math.floor((this.time + resonator.phase) / 2.8);
      if (beat === resonator.beat) continue;
      resonator.beat = beat;
      const radius = 150;
      const c0 = Math.max(0, Math.floor((resonator.x - radius) / TILE));
      const c1 = Math.min(this.level.w - 1, Math.floor((resonator.x + radius) / TILE));
      const r0 = Math.max(0, Math.floor((resonator.y - radius) / TILE));
      const r1 = Math.min(this.level.h - 1, Math.floor((resonator.y + radius) / TILE));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (this.level.tiles[r * this.level.w + c] !== T_HIDDEN) continue;
          const x = c * TILE + TILE / 2;
          const y = r * TILE + TILE / 2;
          if (Math.hypot(x - resonator.x, y - resonator.y) <= radius) {
            this.hiddenReveal.set(r * this.level.w + c, 1.2);
          }
        }
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        this.particles.spawn({
          x: resonator.x + Math.cos(a) * 8,
          y: resonator.y + Math.sin(a) * 8,
          vx: Math.cos(a) * 120,
          vy: Math.sin(a) * 120,
          life: 0.42,
          color: '#f0b4dc',
          shape: 'note',
          size: 1,
        });
      }
      if (Math.hypot(this.playerX - resonator.x, this.playerY - resonator.y) < 240) this.sfx('switch');
    }
  }

  private updateBullets(dt: number): void {
    for (let i = this.playerBullets.length - 1; i >= 0; i--) {
      const b = this.playerBullets[i];
      b.life -= dt;
      b.x += b.vx * dt;
      if (b.kind === 'note') {
        b.phase += dt * 9;
        b.y += (b.vy + Math.sin(b.phase) * 26) * dt;
      } else {
        b.y += b.vy * dt;
      }
      if (Math.random() < 0.55) {
        this.particles.spawn({
          x: b.x - b.vx * 0.008,
          y: b.y + (Math.random() - 0.5) * 2,
          vx: 0,
          vy: 0,
          life: 0.16,
          color: b.kind === 'ice' ? '#7ec4ee' : '#f0a0c8',
          size: 1,
          shape: 'square',
        });
      }
      const hitTile = this.rectHitsSolid({ x: b.x - 2, y: b.y - 2, w: 4, h: 4 });
      if (b.life <= 0 || hitTile) {
        if (hitTile) {
          this.particles.burst(b.x, b.y, 4, b.kind === 'ice' ? '#7ef0ff' : '#ffb0d8', 50, 0.25, 'spark');
        }
        // 交响爆音:香奈美的弹着点产生声呐
        if (b.kind !== 'ice') this.sonarPulse(b.x, b.y, 44);
        this.playerBullets.splice(i, 1);
      }
    }
    const melee = this.player.meleeHitbox();
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i];
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      let remove = b.life <= 0;
      if (!remove && this.rectHitsSolid({ x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 })) {
        remove = true;
      }
      if (!remove && melee && rectsOverlap(melee, { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 })) {
        this.particles.burst(b.x, b.y, 6, '#ffd75e', 70, 0.3, 'spark');
        this.sfx('meleeHit');
        if (this.player.downSlash) this.player.pogoBounce();
        remove = true;
      }
      if (remove) {
        this.enemyBullets.splice(i, 1);
      }
    }
  }

  private onEnemyDamaged(e: Enemy): void {
    if (e.dead) {
      this.sfx('enemyDie');
      this.particles.burst(e.x, e.y - e.h / 2, 14, '#8a93b8', 110, 0.5);
      this.particles.burst(e.x, e.y - e.h / 2, 6, '#ffd75e', 80, 0.4, 'spark');
      const rich = e.kind === 'exploder' || e.kind === 'slasher';
      this.spawnDust(e.x, e.y, rich ? 4 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 2));
      if (Math.random() < 0.28) {
        this.pickups.push(makePickup(e.x, e.y - 10, Math.random() < 0.5 ? 'heart' : 'energy', true));
      }
    } else {
      this.sfx('meleeHit');
    }
  }

  private resolveCombat(): void {
    const p = this.player;
    const pr = p.rect();

    for (let i = this.playerBullets.length - 1; i >= 0; i--) {
      const b = this.playerBullets[i];
      const br: Rect = { x: b.x - 3, y: b.y - 3, w: 6, h: 6 };
      let consumed = false;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (!rectsOverlap(br, e.rect())) continue;
        if (e.blocksShot(b.vx)) {
          this.particles.burst(b.x, b.y, 5, '#aeb8dd', 60, 0.25, 'spark');
          this.sfx('meleeHit');
          consumed = true;
          break;
        }
        if (!b.hit) b.hit = new Set();
        if (b.hit.has(e)) continue; // 穿透弹不重复命中
        b.hit.add(e);
        e.hit(b.dmg, b.freeze, this);
        this.particles.burst(b.x, b.y, 5, b.kind === 'ice' ? '#7ef0ff' : '#ffb0d8', 60, 0.3);
        this.onEnemyDamaged(e);
        b.pierce--;
        if (b.pierce <= 0) {
          consumed = true;
          break;
        }
      }
      if (!consumed && this.boss && this.boss.active && rectsOverlap(br, this.boss.rect())) {
        if (!b.hit) b.hit = new Set();
        if (!b.hit.has(this.boss)) {
          b.hit.add(this.boss);
          this.boss.hit(b.dmg, this);
          this.particles.burst(b.x, b.y, 5, b.kind === 'ice' ? '#7ef0ff' : '#ffb0d8', 60, 0.3);
          b.pierce--;
          if (b.pierce <= 0) consumed = true;
        }
      }
      if (consumed) {
        if (b.kind !== 'ice') this.sonarPulse(b.x, b.y, 44);
        this.playerBullets.splice(i, 1);
      }
    }

    const melee = p.meleeHitbox();
    if (melee) {
      const bladeMul = this.world.chips.has('chip_blade') ? 1.3 : 1;
      const wasDown = p.downSlash;
      let pogoHit = false;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (this.meleeHits.get(e) === p.swingId) continue;
        if (rectsOverlap(melee, e.rect())) {
          this.meleeHits.set(e, p.swingId);
          e.hit(Math.round(p.meleeDamage() * bladeMul), 0, this);
          e.x += p.facing * 4;
          this.onEnemyDamaged(e);
          this.shake(p.meleeStep === 2 ? 3 : 1);
          if (wasDown) pogoHit = true;
        }
      }
      if (this.boss && this.boss.active && this.meleeHits.get(this.boss) !== p.swingId) {
        if (rectsOverlap(melee, this.boss.rect())) {
          this.meleeHits.set(this.boss, p.swingId);
          this.boss.hit(Math.round(p.meleeDamage() * bladeMul), this);
          this.particles.burst(melee.x + melee.w / 2, melee.y + melee.h / 2, 8, '#ffd75e', 90, 0.4, 'spark');
          this.sfx('meleeHit');
          if (wasDown) pogoHit = true;
        }
      }
      if (pogoHit) {
        p.pogoBounce();
        this.particles.burst(p.x, p.y, 8, '#ffd75e', 80, 0.35, 'spark');
        this.sfx('meleeHit');
      }
    }

    if (!p.paper && !p.dead) {
      for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
        const b = this.enemyBullets[i];
        if (rectsOverlap(pr, { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 })) {
          if (p.hurt(b.dmg, b.x, this)) {
            // 猫踪喵迹:攻击米雪儿的敌人被标记
            if (p.char === 'michele' && b.owner instanceof Enemy && !b.owner.dead) {
              b.owner.markT = Math.max(b.owner.markT, 5);
            }
            this.enemyBullets.splice(i, 1);
          }
        }
      }
    } else if (p.paper) {
      for (const b of this.enemyBullets) {
        if (Math.abs(b.x - this.playerX) < 10 && Math.abs(b.y - this.playerY) < 14 && Math.random() < 0.2) {
          this.particles.spawn({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.2, color: '#aef4ff', shape: 'spark' });
        }
      }
    }

    if (!p.dead) {
      for (const e of this.enemies) {
        if (e.dead || e.frozen > 0) continue;
        if (rectsOverlap(pr, e.rect())) {
          if (p.hurt(e.contactDmg, e.x, this) && p.char === 'michele') {
            e.markT = Math.max(e.markT, 5); // 猫踪喵迹
          }
        }
      }
      if (this.boss && this.boss.active && this.boss.state !== 'stunned' && rectsOverlap(pr, this.boss.rect())) {
        p.hurt(18, this.boss.x, this);
      }
    }

    if (this.enemies.length > 40) {
      this.enemies = this.enemies.filter((e) => !e.dead);
    }
  }

  private checkHazards(): void {
    const p = this.player;
    if (p.dead) return;
    const r = p.rect();
    const c0 = Math.floor(r.x / TILE);
    const c1 = Math.floor((r.x + r.w - 0.001) / TILE);
    const r0 = Math.floor(r.y / TILE);
    const r1 = Math.floor((r.y + r.h - 0.001) / TILE);
    outer: for (let c = c0; c <= c1; c++) {
      for (let rr = r0; rr <= r1; rr++) {
        if (this.tileAt(c, rr) === T_SPIKE) {
          if (r.y + r.h > rr * TILE + 6) {
            if (p.downSlash && p.meleeT > 0) {
              // 下劈弹开尖刺
              p.pogoBounce();
              p.invuln = Math.max(p.invuln, 0.3);
              this.particles.burst(p.x, p.y, 8, '#c8c4d8', 80, 0.35, 'spark');
              this.sfx('meleeHit');
            } else {
              p.hurt(12, p.x + (Math.random() - 0.5), this);
              p.vy = -240;
            }
            break outer;
          }
        }
      }
    }
    // 坠落出界(不在向下出口范围内时)
    if (p.y > this.mapH + 50) {
      p.invuln = 0;
      const wasAlive = !p.dead;
      p.hurt(30, p.x, this);
      if (wasAlive && !p.dead) {
        p.x = this.lastEntryX;
        p.y = this.lastEntryY;
        p.vx = 0;
        p.vy = 0;
        p.invuln = 1.4;
        this.enemyBullets = [];
      }
    }
  }

  private collectPickups(): void {
    const p = this.player;
    if (p.dead) return;
    const pr = p.rect();
    const magnetR = this.world.chips.has('chip_magnet') ? 110 : 50;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += 1 / 60;
      // 晶尘磁吸
      if (pk.kind === 'dust') {
        const dx = this.playerX - pk.x;
        const dy = this.playerY - pk.y;
        const d = Math.hypot(dx, dy);
        if (d < magnetR && d > 1) {
          pk.landed = true;
          pk.x += (dx / d) * 240 * (1 / 60);
          pk.y += (dy / d) * 240 * (1 / 60);
        }
      }
      if (!pk.landed) {
        pk.vy += 500 / 60;
        pk.y += pk.vy / 60;
        if (this.rectHitsSolid({ x: pk.x - 3, y: pk.y, w: 6, h: 4 })) {
          pk.landed = true;
          pk.vy = 0;
        }
        if (pk.y > this.mapH + 30) {
          this.pickups.splice(i, 1);
          continue;
        }
      }
      if (rectsOverlap(pr, { x: pk.x - 6, y: pk.y - 8, w: 12, h: 16 })) {
        switch (pk.kind) {
          case 'dust':
            this.world.dust += 1;
            this.sfx('ui');
            break;
          case 'heart':
            p.hp = Math.min(this.world.hpMax, p.hp + 25);
            this.sfx('pickup');
            this.particles.burst(pk.x, pk.y, 8, '#ff5d7e', 70, 0.4);
            break;
          case 'energy':
            p.energy = Math.min(this.world.energyMax, p.energy + 45);
            this.sfx('pickup');
            this.particles.burst(pk.x, pk.y, 8, '#7ef0ff', 70, 0.4);
            break;
          case 'crystal':
            if (pk.id) {
              const previousHpMax = this.world.hpMax;
              const previousEnergyMax = this.world.energyMax;
              this.world.crystals.add(pk.id);
              this.world.recalculateStats();
              const hpGain = this.world.hpMax - previousHpMax;
              const energyGain = this.world.energyMax - previousEnergyMax;
              if (hpGain > 0) p.hp = Math.min(this.world.hpMax, p.hp + hpGain);
              if (energyGain > 0) p.energy = Math.min(this.world.energyMax, p.energy + energyGain);
              const milestone = CRYSTAL_MILESTONES.find((item) => item.count === this.world.crystals.size);
              if (milestone) this.toast(`${milestone.name} · ${milestone.desc}`);
              this.engine.persistWorld();
            }
            this.sfx('crystal');
            this.particles.burst(pk.x, pk.y, 10, '#ff8ad0', 80, 0.5, 'spark');
            break;
          case 'relic': {
            if (pk.chipId) {
              const previousHpMax = this.world.hpMax;
              this.world.chips.add(pk.chipId);
              this.world.recalculateStats();
              const hpGain = this.world.hpMax - previousHpMax;
              if (hpGain > 0) p.hp = Math.min(this.world.hpMax, p.hp + hpGain);
              const relic = HIDDEN_CHIPS.find((item) => item.id === pk.chipId);
              if (relic) this.toast(`获得 ${relic.name}`);
              this.engine.persistWorld();
            }
            this.sfx('crystal');
            this.particles.burst(pk.x, pk.y, 14, '#ffe9a8', 95, 0.65, 'spark');
            break;
          }
          default:
            break;
        }
        this.pickups.splice(i, 1);
      }
    }
  }

  private checkGate(): void {
    const p = this.player;
    if (p.dead) return;
    if (this.gate.active && Math.abs(p.x - this.gate.x) < 12 && Math.abs(p.y - this.gate.y) < 26) {
      this.world.cleared = true;
      this.persistRuntime();
      this.overlay = 'victory';
      this.overlayT = 7;
      this.engine.audio.setMusicState({ intensity: 0, ducked: false });
      this.engine.audio.playSong('ending', 1.4);
      this.engine.audio.playStinger('victory');
      this.sfx('checkpoint');
    }
  }

  private updateVisualTheme(): void {
    const transition = this.room.transition;
    if (!transition) {
      this.theme = this.zone.theme;
      this.bg.setTheme(this.theme);
      return;
    }
    const mix = roomTransitionMix(this.room, this.playerX, this.playerY, this.mapW, this.mapH);
    const step = Math.round(mix * 48);
    if (step !== this.transitionThemeStep) {
      this.transitionThemeStep = step;
      this.theme = blendLevelThemes(this.zone.theme, ZONES[transition.to].theme, step / 48);
    }
  }

  private transitionBackgroundMix(): number {
    if (!this.room.transition || !this.transitionBg) return 0;
    return roomTransitionMix(this.room, this.playerX, this.playerY, this.mapW, this.mapH);
  }

  private getTransitionSurface(): HTMLCanvasElement | null {
    if (this.transitionSurface) return this.transitionSurface;
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const surface = canvas.getContext('2d');
    if (!surface) return null;
    surface.imageSmoothingEnabled = false;
    this.transitionSurface = canvas;
    return canvas;
  }

  private drawBackgroundLayer(
    ctx: CanvasRenderingContext2D,
    background: Background,
    backdropX: number,
    backdropY: number,
    alpha: number,
    front: boolean,
  ): boolean {
    const canvas = this.getTransitionSurface();
    const surface = canvas?.getContext('2d');
    if (!canvas || !surface) return false;
    surface.setTransform(1, 0, 0, 1, 0, 0);
    surface.globalAlpha = 1;
    surface.globalCompositeOperation = 'source-over';
    surface.clearRect(0, 0, VIEW_W, VIEW_H);
    if (front) background.renderFront(surface, backdropX, backdropY, this.time);
    else background.render(surface, backdropX, backdropY, this.time);
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
    return true;
  }

  private renderBackground(
    ctx: CanvasRenderingContext2D,
    backdropX: number,
    backdropY: number,
    mix: number,
  ): void {
    if (!this.transitionBg || mix <= 0) {
      this.bg.render(ctx, backdropX, backdropY, this.time);
      return;
    }
    if (mix >= 1) {
      this.transitionBg.render(ctx, backdropX, backdropY, this.time);
      return;
    }
    this.bg.render(ctx, backdropX, backdropY, this.time);
    this.drawBackgroundLayer(ctx, this.transitionBg, backdropX, backdropY, mix, false);
  }

  private renderBackgroundFront(
    ctx: CanvasRenderingContext2D,
    backdropX: number,
    backdropY: number,
    mix: number,
  ): void {
    if (!this.transitionBg || mix <= 0) {
      this.bg.renderFront(ctx, backdropX, backdropY, this.time);
      return;
    }
    if (mix >= 1) {
      this.transitionBg.renderFront(ctx, backdropX, backdropY, this.time);
      return;
    }
    const renderedSource = this.drawBackgroundLayer(ctx, this.bg, backdropX, backdropY, 1 - mix, true);
    const renderedTarget = this.drawBackgroundLayer(ctx, this.transitionBg, backdropX, backdropY, mix, true);
    if (!renderedSource && !renderedTarget) this.bg.renderFront(ctx, backdropX, backdropY, this.time);
  }

  private syncMoversToTime(resetPrevious: boolean): void {
    for (const mover of this.movers) {
      const displacement = moverDisplacement(this.time, mover.speed, mover.phase, mover.range);
      if (mover.axis === 'h') mover.x = mover.baseX + displacement;
      else mover.y = mover.baseY + displacement;
      if (resetPrevious) {
        mover.prevX = mover.x;
        mover.prevY = mover.y;
      }
    }
  }

  private updateCamera(dt: number): void {
    const targetX = clamp(
      this.playerX + this.player.facing * 24 - VIEW_W / 2,
      0,
      Math.max(0, this.mapW - VIEW_W),
    );
    const targetY = clamp(this.playerY - VIEW_H / 2 - 8, 0, Math.max(0, this.mapH - VIEW_H));
    const k = 1 - Math.exp(-6 * dt);
    this.camX = lerp(this.camX, targetX, k);
    this.camY = lerp(this.camY, targetY, k);
  }

  // ---------------- 渲染 ----------------
  render(
    ctx: CanvasRenderingContext2D,
    chrome = true,
    playerVisible = true,
    transitionWorldOffsetX = 0,
    transitionWorldOffsetY = 0,
  ): void {
    this.updateVisualTheme();
    const shakeX = this.shakeT > 0 ? (Math.random() - 0.5) * this.shakeMag : 0;
    const shakeY = this.shakeT > 0 ? (Math.random() - 0.5) * this.shakeMag : 0;
    const cx = Math.round(this.camX + shakeX);
    const cy = Math.round(this.camY + shakeY);

    const backdropX = this.camX + this.backdropOffsetX;
    const backdropY = this.camY + this.backdropOffsetY;
    const backgroundMix = this.transitionBackgroundMix();
    this.renderBackground(ctx, backdropX, backdropY, backgroundMix);

    ctx.save();
    ctx.translate(-cx + transitionWorldOffsetX, -cy + transitionWorldOffsetY);

    this.renderTiles(ctx, cx, cy);
    this.renderWorldMechanics(ctx);

    // 上升气流:只对空中飘飞状态生效。
    for (const u of this.updrafts) {
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = this.theme.accent;
      ctx.fillRect(u.x, u.y, u.w, u.h);
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = this.theme.accent;
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const xx = u.x + 7 + ((i * 29 + this.time * 24) % Math.max(1, u.w - 14));
        const yy = u.y + u.h - ((i * 31 + this.time * 46) % u.h);
        ctx.beginPath();
        ctx.moveTo(Math.round(xx), Math.round(yy + 9));
        ctx.quadraticCurveTo(xx + Math.sin(this.time * 2 + i) * 4, yy + 4, xx, yy);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 移动平台
    const theme = this.theme;
    for (const m of this.movers) {
      const x = Math.round(m.x - m.w / 2);
      const y = Math.round(m.y);
      ctx.fillStyle = theme.tileEdge;
      ctx.fillRect(x, y, m.w, 2);
      ctx.fillStyle = theme.tileBase;
      ctx.fillRect(x, y + 2, m.w, m.h - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x, y + m.h - 1, m.w, 1);
      ctx.fillStyle = theme.accent;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x + 3, y + 3, 2, 2);
      ctx.fillRect(x + m.w - 5, y + 3, 2, 2);
      ctx.globalAlpha = 1;
    }

    // 信标 / 能力祭坛 / 香奈美 / 传送门
    for (const b of this.benches) drawBench(ctx, b.x, b.y, b.resting || this.world.benchRoom === this.roomId, this.time);
    for (const a of this.abilitySpots) drawAbilityShrine(ctx, a.x, a.y, a.kind, this.time);
    if (this.kanamiSpot) drawCagedKanami(ctx, this.kanamiSpot.x, this.kanamiSpot.y, this.time);
    if (this.shopSpot) {
      drawNavigator(ctx, this.shopSpot.x, this.shopSpot.y, this.time, false);
    }
    if (this.gate.active) drawExitGate(ctx, this.gate.x, this.gate.y, this.time);

    // 拾取物
    for (const pk of this.pickups) drawPickup(ctx, pk.kind, pk.x, pk.y, pk.t);

    // 部署物
    for (const t of this.turrets) t.render(ctx, this.time);
    for (const d of this.darts) d.render(ctx, this.time);

    // 敌人与 Boss
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.x < cx - 40 || e.x > cx + VIEW_W + 40) continue;
      e.render(ctx, this.time);
    }
    if (this.boss) this.boss.render(ctx, this.time);

    // 玩家
    if (playerVisible) this.player.render(ctx, this.time);
    this.renderFloatingHints(ctx);

    // 子弹
    for (const b of this.playerBullets) {
      if (b.kind === 'ice') {
        ctx.fillStyle = '#bfeff9';
        ctx.fillRect(Math.round(b.x - 4), Math.round(b.y - 1), 8, 2);
        ctx.fillStyle = '#7ef0ff';
        ctx.fillRect(Math.round(b.x - 2), Math.round(b.y - 2), 5, 4);
      } else {
        ctx.fillStyle = '#ffb0d8';
        ctx.fillRect(Math.round(b.x), Math.round(b.y - 4), 2, 5);
        ctx.fillStyle = '#ff5fa8';
        ctx.fillRect(Math.round(b.x - 2), Math.round(b.y), 4, 3);
      }
    }
    for (const b of this.enemyBullets) {
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(Math.round(b.x), Math.round(b.y), b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 1, 1);
    }

    this.particles.render(ctx);
    ctx.restore();

    // 前景遮挡层(视差 1.3)
    this.renderBackgroundFront(ctx, backdropX, backdropY, backgroundMix);

    // 环境微粒(屏幕空间)
    ctx.fillStyle = theme.ember;
    for (const e of this.embers) {
      const tw = 0.25 + 0.3 * Math.abs(Math.sin(e.ph * 2));
      ctx.globalAlpha = tw;
      ctx.fillRect(Math.round(e.x), Math.round(e.y), 1, 1);
    }
    ctx.globalAlpha = 1;

    if (chrome) this.renderChrome(ctx);
  }

  private renderFloatingHints(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 9px "SimSun", "Songti SC", monospace';
    for (const hint of this.floatingHints) {
      if (hint.delay > 0) continue;
      const age = hint.maxT - hint.t;
      const alpha = clamp(Math.min(age / 0.25, hint.t / 0.7), 0, 1);
      const floatY = hint.y - age * 4 + Math.sin(this.time * 3) * 0.6;
      for (let i = 0; i < hint.lines.length; i++) {
        const y = Math.round(floatY + i * 12);
        ctx.globalAlpha = alpha * 0.75;
        ctx.fillStyle = '#08060c';
        ctx.fillText(hint.lines[i], Math.round(hint.x) + 1, y + 1);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(hint.lines[i], Math.round(hint.x), y);
      }
    }
    ctx.restore();
  }

  renderTransitionPlayer(ctx: CanvasRenderingContext2D, screenX: number, screenY: number): void {
    ctx.save();
    ctx.translate(Math.round(screenX - this.player.x), Math.round(screenY - this.player.y));
    this.player.render(ctx, this.time);
    ctx.restore();
  }

  /** 固定在屏幕上的界面层;房间滑动时只绘制新房间的一份。 */
  renderChrome(ctx: CanvasRenderingContext2D, transient = true): void {
    drawHUD(ctx, this.player, this.world, TOTAL_CRYSTALS, this.boss, this.engine.audio.muted);

    // 受击红闪 / 低血量脉冲
    const p = this.player;
    let flash = 0;
    if (!p.dead) {
      if (p.invuln > INVULN_TIME - 0.3 && p.invuln <= INVULN_TIME + 0.01) {
        flash = clamp((p.invuln - (INVULN_TIME - 0.3)) / 0.3, 0, 1) * 0.32;
      } else if (p.hp <= 25) {
        flash = 0.09 + 0.05 * Math.sin(this.time * 6);
      }
    }
    if (flash > 0) {
      const rg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 90, VIEW_W / 2, VIEW_H / 2, 300);
      rg.addColorStop(0, 'rgba(200,40,60,0)');
      rg.addColorStop(1, `rgba(200,40,60,${flash})`);
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    // 场景开场横幅(哥特卷轴风)
    if (transient && this.introT > 0) {
      const a = clamp(this.introT > 2.2 ? (2.8 - this.introT) / 0.6 : this.introT / 0.8, 0, 1);
      const cyy = VIEW_H / 2;
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = 'rgba(8,5,14,0.9)';
      ctx.fillRect(0, cyy - 30, VIEW_W, 58);
      ctx.fillStyle = '#a8823c';
      ctx.fillRect(VIEW_W / 2 - 90, cyy - 30, 180, 1);
      ctx.fillRect(VIEW_W / 2 - 90, cyy + 27, 180, 1);
      ctx.fillRect(VIEW_W / 2 - 2, cyy - 33, 4, 4);
      ctx.fillRect(VIEW_W / 2 - 2, cyy + 25, 4, 4);
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px "SimSun", "Songti SC", serif';
      ctx.fillStyle = '#e8d8a8';
      ctx.fillText(this.zone.name, VIEW_W / 2, cyy - 10);
      ctx.font = '9px "SimSun", "Songti SC", serif';
      ctx.fillStyle = '#8a7a98';
      ctx.fillText(this.zone.subtitle, VIEW_W / 2, cyy + 12);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }

    if (transient) this.renderToasts(ctx);
  }

  private renderWorldMechanics(ctx: CanvasRenderingContext2D): void {
    const theme = this.theme;

    for (const jet of this.pressureJets) {
      const active = this.pressureJetActive(jet);
      ctx.save();
      ctx.globalAlpha = active ? 0.2 : 0.06;
      ctx.fillStyle = '#8de0c4';
      ctx.fillRect(jet.x, jet.y, jet.w, jet.h);
      ctx.strokeStyle = '#b8f4df';
      ctx.globalAlpha = active ? 0.48 : 0.14;
      for (let i = 0; i < 6; i++) {
        const travel = ((this.time * (active ? 72 : 18) + i * 19) % jet.w);
        const x = jet.dir > 0 ? jet.x + travel : jet.x + jet.w - travel;
        const y = jet.y + 7 + ((i * 13) % Math.max(8, jet.h - 14));
        ctx.beginPath();
        ctx.moveTo(Math.round(x - jet.dir * 10), Math.round(y));
        ctx.lineTo(Math.round(x), Math.round(y));
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const belt of this.conveyors) {
      ctx.fillStyle = '#1b2028';
      ctx.fillRect(belt.x, belt.y, belt.w, 4);
      ctx.fillStyle = theme.accent;
      for (let i = 0; i < belt.w; i += 10) {
        const raw = (this.time * 30 * belt.dir + i) % belt.w;
        const off = Math.floor((raw + belt.w) % belt.w);
        ctx.fillRect(belt.x + off, belt.y + 1, 4, 1);
      }
      ctx.fillStyle = '#758090';
      ctx.fillRect(belt.x, belt.y, belt.w, 1);
    }

    for (const resonator of this.resonators) {
      const cycle = ((this.time + resonator.phase) % 2.8) / 2.8;
      ctx.save();
      ctx.globalAlpha = (1 - cycle) * 0.3;
      ctx.strokeStyle = '#f0b4dc';
      ctx.beginPath();
      ctx.arc(resonator.x, resonator.y, 8 + cycle * 70, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#39243f';
      ctx.fillRect(resonator.x - 6, resonator.y - 7, 12, 7);
      ctx.fillStyle = '#f0b4dc';
      ctx.fillRect(resonator.x - 2, resonator.y - 12, 4, 7);
      ctx.fillStyle = '#fff0fa';
      ctx.fillRect(resonator.x - 1, resonator.y - 11, 2, 2);
      ctx.restore();
    }

    for (const spot of this.polaritySpots) {
      ctx.fillStyle = '#18243a';
      ctx.fillRect(spot.x - 6, spot.y - 18, 12, 18);
      ctx.strokeStyle = '#7088b8';
      ctx.strokeRect(spot.x - 5.5, spot.y - 17.5, 11, 17);
      ctx.fillStyle = this.polarityOpen ? '#8de0c4' : '#e878c0';
      ctx.fillRect(spot.x - 2, spot.y - 14, 4, 4);
    }

    for (const shortcut of this.shortcuts) {
      const open = this.world.shortcuts.has(shortcut.def.id);
      if (!open) {
        const gate = shortcut.gate;
        ctx.fillStyle = 'rgba(20,18,28,0.78)';
        ctx.fillRect(gate.x, gate.y, gate.w, gate.h);
        ctx.strokeStyle = '#b58b4a';
        ctx.strokeRect(gate.x + 0.5, gate.y + 0.5, gate.w - 1, gate.h - 1);
        ctx.fillStyle = '#74654f';
        for (let x = gate.x + 3; x < gate.x + gate.w; x += 6) ctx.fillRect(x, gate.y, 2, gate.h);
        for (let y = gate.y + 7; y < gate.y + gate.h; y += 12) ctx.fillRect(gate.x, y, gate.w, 2);
      }
      const lever = shortcut.lever;
      ctx.fillStyle = '#25222c';
      ctx.fillRect(lever.x - 6, lever.y - 17, 12, 17);
      ctx.strokeStyle = '#75664d';
      ctx.strokeRect(lever.x - 5.5, lever.y - 16.5, 11, 16);
      ctx.fillStyle = open ? '#8de0c4' : '#d8a850';
      ctx.fillRect(lever.x - 2, lever.y - 13, 4, 4);
      ctx.fillRect(lever.x - (open ? 1 : 4), lever.y - 10, 2, 6);
    }
  }

  private renderTiles(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const theme = this.theme;
    const c0 = Math.max(0, Math.floor(cx / TILE));
    const c1 = Math.min(this.level.w - 1, Math.floor((cx + VIEW_W) / TILE));
    const r0 = Math.max(0, Math.floor(cy / TILE));
    const r1 = Math.min(this.level.h - 1, Math.floor((cy + VIEW_H) / TILE));

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const t = this.level.tiles[r * this.level.w + c];
        if (t === T_EMPTY) continue;
        const x = c * TILE;
        const y = r * TILE;
        switch (t) {
          case T_SOLID: {
            const solidUp = this.tileAt(c, r - 1) === T_SOLID;
            const solidDn = this.tileAt(c, r + 1) === T_SOLID;
            const solidL = this.tileAt(c - 1, r) === T_SOLID;
            const solidR = this.tileAt(c + 1, r) === T_SOLID;
            const h = (c * 31 + r * 17) & 255;

            ctx.fillStyle = theme.tileBase;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = theme.tileDark;
            ctx.fillRect(x, y + 7, TILE, 1);
            ctx.fillRect(x, y + 15, TILE, 1);
            ctx.fillRect(x, y, 1, 7);
            ctx.fillRect(x + 8, y + 8, 1, 7);
            if (h % 5 === 0) {
              ctx.fillStyle = 'rgba(255,255,255,0.06)';
              ctx.fillRect(x + (h % 11), y + 2 + (h % 4), 2, 1);
            }
            if (h % 7 === 0) {
              ctx.fillStyle = theme.tileDark;
              ctx.fillRect(x + 3 + (h % 9), y + 9, 1, 3);
              ctx.fillRect(x + 2 + (h % 9), y + 11, 1, 2);
            }
            if (!solidUp) {
              ctx.fillStyle = theme.tileEdge;
              ctx.fillRect(x, y, TILE, 2);
              ctx.fillStyle = 'rgba(0,0,0,0.25)';
              ctx.fillRect(x, y + 2, TILE, 1);
              if (h % 4 === 0) {
                ctx.fillStyle = theme.accent;
                ctx.globalAlpha = 0.5;
                ctx.fillRect(x + 6, y, 3, 1);
                ctx.globalAlpha = 1;
              }
            }
            if (!solidDn) {
              ctx.fillStyle = 'rgba(0,0,0,0.4)';
              ctx.fillRect(x, y + 14, TILE, 2);
            }
            if (!solidL) {
              ctx.fillStyle = 'rgba(255,255,255,0.10)';
              ctx.fillRect(x, y, 1, TILE);
            }
            if (!solidR) {
              ctx.fillStyle = 'rgba(0,0,0,0.28)';
              ctx.fillRect(x + TILE - 1, y, 1, TILE);
            }
            if (!solidUp && (c * 13 + r * 7) % 29 === 0 && this.tileAt(c, r - 1) === T_EMPTY && this.tileAt(c, r - 2) === T_EMPTY) {
              drawCandle(ctx, x + 7, y, this.time + h, theme.accent);
            }
            break;
          }
          case T_ONEWAY: {
            ctx.fillStyle = theme.tileEdge;
            ctx.fillRect(x, y, TILE, 2);
            ctx.fillStyle = theme.tileDark;
            ctx.fillRect(x, y + 2, TILE, 2);
            ctx.fillRect(x + 2, y + 4, 2, 2);
            ctx.fillRect(x + TILE - 4, y + 4, 2, 2);
            ctx.fillStyle = 'rgba(255,255,255,0.14)';
            ctx.fillRect(x, y, TILE, 1);
            break;
          }
          case T_SPIKE: {
            ctx.fillStyle = '#1e1a28';
            ctx.fillRect(x, y + 13, TILE, 3);
            for (let i = 0; i < 4; i++) {
              const sx = x + i * 4;
              ctx.fillStyle = '#5a5468';
              ctx.beginPath();
              ctx.moveTo(sx, y + TILE - 2);
              ctx.lineTo(sx + 2, y + 5);
              ctx.lineTo(sx + 4, y + TILE - 2);
              ctx.closePath();
              ctx.fill();
              ctx.fillStyle = '#c8c4d8';
              ctx.fillRect(sx + 1, y + 5, 1, 3);
            }
            break;
          }
          case T_HIDDEN: {
            const rev = this.hiddenReveal.get(r * this.level.w + c) ?? 0;
            if (rev > 0) {
              // 显形中的弦能平台(临近消失时闪烁)
              const blink = rev < 1.2 && Math.floor(this.time * 8) % 2 === 0 ? 0.4 : 0.9;
              ctx.globalAlpha = blink;
              ctx.fillStyle = '#8ee8f4';
              ctx.fillRect(x, y, TILE, 2);
              ctx.globalAlpha = blink * 0.4;
              ctx.fillStyle = '#ffb0d8';
              ctx.fillRect(x + 1, y + 2, TILE - 2, TILE - 4);
              ctx.globalAlpha = blink * 0.8;
              ctx.fillStyle = '#d8a850';
              ctx.fillRect(x, y + TILE - 1, TILE, 1);
              ctx.globalAlpha = 1;
            } else {
              // 未显形:偶现的微光提示
              const tw = Math.sin(this.time * 1.6 + (c * 7 + r * 13) * 0.9);
              if (tw > 0.93) {
                ctx.globalAlpha = 0.18;
                ctx.fillStyle = '#ffb0d8';
                ctx.fillRect(x + 7, y + 7, 2, 2);
                ctx.globalAlpha = 1;
              }
            }
            break;
          }
          case T_MEMBRANE: {
            const pulse = 0.4 + Math.sin(this.time * 3 + (c + r) * 0.8) * 0.18;
            ctx.globalAlpha = pulse;
            ctx.fillStyle = '#b04a90';
            ctx.fillRect(x + 1, y, TILE - 2, TILE);
            ctx.globalAlpha = pulse + 0.3;
            ctx.fillStyle = '#8ee8f4';
            const off = Math.floor(this.time * 10) % 4;
            for (let i = 0; i < 4; i++) {
              const wy = y + ((i * 4 + off) % TILE);
              const wobble = Math.round(Math.sin(this.time * 5 + wy * 0.5) * 1);
              ctx.fillRect(x + 3 + wobble, wy, TILE - 6, 1);
            }
            ctx.globalAlpha = 0.7;
            ctx.fillStyle = '#d8a850';
            ctx.fillRect(x + 1, y, TILE - 2, 1);
            ctx.fillRect(x + 1, y + TILE - 1, TILE - 2, 1);
            ctx.globalAlpha = 1;
            break;
          }
          case T_POLARITY: {
            const pulse = 0.35 + Math.sin(this.time * 4 + (c + r) * 0.7) * 0.15;
            ctx.globalAlpha = this.polarityOpen ? 0.12 : pulse + 0.18;
            ctx.fillStyle = this.polarityOpen ? '#8de0c4' : '#7060d0';
            ctx.fillRect(x + 2, y, TILE - 4, TILE);
            ctx.globalAlpha = this.polarityOpen ? 0.3 : 0.8;
            ctx.fillStyle = this.polarityOpen ? '#b8f4df' : '#e878c0';
            ctx.fillRect(x + 1, y, TILE - 2, 1);
            ctx.fillRect(x + 1, y + TILE - 1, TILE - 2, 1);
            if (!this.polarityOpen) {
              const off = Math.floor(this.time * 12) % 5;
              ctx.fillRect(x + 4 + off, y + 2, 1, TILE - 4);
              ctx.fillRect(x + 10 - off, y + 2, 1, TILE - 4);
            }
            ctx.globalAlpha = 1;
            break;
          }
          default:
            break;
        }
      }
    }
  }

  private ornateFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.fillStyle = 'rgba(10,7,16,0.88)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#a8823c';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
    ctx.strokeStyle = '#4a3c22';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = '#c8a050';
    for (const [dx, dy] of [
      [1, 1],
      [w - 4, 1],
      [1, h - 4],
      [w - 4, h - 4],
    ]) {
      ctx.fillRect(x + dx, y + dy, 3, 3);
    }
  }

  private renderMap(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(4,3,10,0.88)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const cw = 30;
    const ch = 20;
    let minX = 99;
    let maxX = -99;
    let minY = 99;
    let maxY = -99;
    for (const r of ROOM_LIST) {
      minX = Math.min(minX, r.mapX);
      maxX = Math.max(maxX, r.mapX);
      minY = Math.min(minY, r.mapY);
      maxY = Math.max(maxY, r.mapY + (r.mapH ?? 1) - 1);
    }
    const ox = Math.round((VIEW_W - (maxX - minX + 1) * cw) / 2);
    const oy = Math.round((VIEW_H - (maxY - minY + 1) * ch) / 2) + 8;

    const zoneColor: Record<string, string> = {
      coast: '#c2743e', tide: '#58a894', lab: '#5a78c8',
      choir: '#b878b8', sky: '#a8b0cc', hangar: '#c85a5c',
    };

    // 已探索房间之间的连线,让地图呈现真实回环而不是孤立色块。
    const linked = new Set<string>();
    ctx.lineWidth = 1;
    for (const r of ROOM_LIST) {
      if (!this.world.visited.has(r.id)) continue;
      for (const e of r.exits) {
        if (!this.world.visited.has(e.target)) continue;
        const key = [r.id, e.target].sort().join('|');
        if (linked.has(key)) continue;
        linked.add(key);
        const target = ROOMS[e.target];
        const x0 = ox + (r.mapX - minX + 0.5) * cw;
        const y0 = oy + (r.mapY - minY + (r.mapH ?? 1) / 2) * ch;
        const x1 = ox + (target.mapX - minX + 0.5) * cw;
        const y1 = oy + (target.mapY - minY + (target.mapH ?? 1) / 2) * ch;
        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = zoneColor[r.zone];
        ctx.beginPath();
        ctx.moveTo(Math.round(x0), Math.round(y0));
        ctx.lineTo(Math.round(x1), Math.round(y1));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    for (const r of ROOM_LIST) {
      if (!this.world.visited.has(r.id)) continue;
      const x = ox + (r.mapX - minX) * cw;
      const y = oy + (r.mapY - minY) * ch;
      const h = (r.mapH ?? 1) * ch;
      const current = r.id === this.roomId;
      ctx.globalAlpha = current ? 0.55 : 0.28;
      ctx.fillStyle = zoneColor[r.zone];
      ctx.fillRect(x + 2, y + 2, cw - 4, h - 4);
      if (r.transition) {
        ctx.fillStyle = zoneColor[r.transition.to];
        if (r.transition.toSide === 'left') ctx.fillRect(x + 2, y + 2, (cw - 4) / 2, h - 4);
        else if (r.transition.toSide === 'down') ctx.fillRect(x + 2, y + h / 2, cw - 4, h / 2 - 2);
        else ctx.fillRect(x + cw / 2, y + 2, cw / 2 - 2, h - 4);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = current && Math.floor(this.time * 10) % 2 === 0 ? '#f0e0b0' : zoneColor[r.zone];
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 2.5, y + 2.5, cw - 5, h - 5);
      // 信标标记
      if (r.rows.some((row) => row.includes('T'))) {
        ctx.fillStyle = '#8ee8f4';
        ctx.fillRect(x + cw / 2 - 1, y + h / 2 - 1, 3, 3);
      }
      if (r.shortcuts?.length) {
        const allOpen = r.shortcuts.every((shortcut) => this.world.shortcuts.has(shortcut.id));
        ctx.fillStyle = allOpen ? '#8de0c4' : '#d8a850';
        ctx.fillRect(x + cw - 7, y + 4, 3, 3);
      }
      if (current) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x + cw / 2 - 1, y + h / 2 - 5, 2, 2);
      }
    }

    ctx.textAlign = 'center';
    ctx.font = 'bold 12px "SimSun", "Songti SC", serif';
    ctx.fillStyle = '#e8d8a8';
    ctx.fillText('欧拉 · 区域图', VIEW_W / 2, 22);
    ctx.font = '8px "SimSun", "Songti SC", serif';
    ctx.fillStyle = '#8a7a98';
    ctx.fillText(`${this.room.name}    ◆ ${this.world.crystals.size}/${TOTAL_CRYSTALS}`, VIEW_W / 2, VIEW_H - 24);
    ctx.fillText('Tab / Esc 关闭', VIEW_W / 2, VIEW_H - 12);
    ctx.textAlign = 'left';
  }

  private renderShop(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(4,3,10,0.82)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.ornateFrame(ctx, VIEW_W / 2 - 128, 40, 256, 178);
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px "SimSun", "Songti SC", serif';
    ctx.fillStyle = '#e8d8a8';
    ctx.fillText('引航者 · 诺笛', VIEW_W / 2, 60);
    ctx.font = '8px "SimSun", "Songti SC", serif';
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(`晶尘 ${this.world.dust}`, VIEW_W / 2, 79);

    ctx.textAlign = 'left';
    SHOP_ITEMS.forEach((it, i) => {
      const rowTop = 91 + i * 25;
      const nameY = rowTop + 9;
      const sel = i === this.shopSel;
      const owned = this.world.chips.has(it.id);
      if (sel) {
        ctx.fillStyle = 'rgba(168,130,60,0.18)';
        ctx.fillRect(VIEW_W / 2 - 118, rowTop, 236, 23);
        ctx.fillStyle = '#e8c860';
        ctx.fillRect(VIEW_W / 2 - 111, nameY - 4, 3, 3);
      }
      ctx.font = '9px "SimSun", "Songti SC", serif';
      ctx.fillStyle = owned ? '#5a5468' : sel ? '#f0e0b0' : '#b8accc';
      ctx.fillText(it.name, VIEW_W / 2 - 104, nameY);
      ctx.font = '8px "SimSun", "Songti SC", serif';
      ctx.fillStyle = owned ? '#4a4458' : '#8a7a98';
      ctx.fillText(it.desc, VIEW_W / 2 - 104, nameY + 10);
      ctx.textAlign = 'right';
      ctx.fillStyle = owned ? '#5a5468' : this.world.dust >= it.cost ? '#ffe9a8' : '#a85a5c';
      ctx.fillText(owned ? '已接入' : `${it.cost}`, VIEW_W / 2 + 110, nameY);
      ctx.textAlign = 'left';
    });

    ctx.textAlign = 'center';
    ctx.font = '8px "SimSun", "Songti SC", serif';
    ctx.fillStyle = '#8a7a98';
    ctx.fillText('↑↓ 选择 · F 购买 · Esc 关闭', VIEW_W / 2, 208);
    ctx.restore();
  }

  // 房间名 / 事件提示
  private renderToasts(ctx: CanvasRenderingContext2D): void {
    if (this.toasts.length > 0) {
      ctx.textAlign = 'center';
      ctx.font = '9px "SimSun", "Songti SC", serif';
      let ty = VIEW_H - 34;
      for (const t of this.toasts) {
        const a = clamp(t.t / 0.5, 0, 1);
        ctx.globalAlpha = a * 0.9;
        ctx.fillStyle = 'rgba(8,5,14,0.75)';
        const tw = ctx.measureText(t.msg).width;
        ctx.fillRect(VIEW_W / 2 - tw / 2 - 6, ty - 3, tw + 12, 13);
        ctx.fillStyle = '#d8ccb0';
        ctx.fillText(t.msg, VIEW_W / 2, ty);
        ctx.globalAlpha = 1;
        ty -= 16;
      }
      ctx.textAlign = 'left';
    }

    this.renderInteractionPrompts(ctx);
    this.renderOverlay(ctx);
  }

  private renderInteractionPrompts(ctx: CanvasRenderingContext2D): void {
    let px = 0;
    let py = 0;

    if (this.nearBenchSpot) {
      px = this.nearBenchSpot.x;
      py = this.nearBenchSpot.y - 32;
    } else if (this.nearShortcutSpot) {
      px = this.nearShortcutSpot.lever.x;
      py = this.nearShortcutSpot.lever.y - 22;
    } else if (this.nearPolaritySpot) {
      px = this.nearPolaritySpot.x;
      py = this.nearPolaritySpot.y - 22;
    } else if (this.nearAbilitySpot) {
      px = this.nearAbilitySpot.x;
      py = this.nearAbilitySpot.y - 28;
    } else if (this.nearKanamiSpot) {
      px = this.nearKanamiSpot.x;
      py = this.nearKanamiSpot.y - 26;
    } else if (this.nearShop && this.shopSpot) {
      px = this.shopSpot.x;
      py = this.shopSpot.y - 26;
    } else {
      return;
    }

    const bx = Math.round(px - this.camX);
    const by = Math.round(py - this.camY);
    ctx.save();
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(8, 6, 16, 0.9)';
    ctx.fillRect(bx - 6, by - 10, 12, 12);
    ctx.strokeStyle = '#8ee8f4';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 5.5, by - 9.5, 11, 11);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('F', bx, by - 4);
    ctx.restore();
  }

  private renderFastTravel(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(4, 3, 10, 0.88)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const frameW = 270;
    const frameH = 238;
    const frameX = Math.round(VIEW_W / 2 - frameW / 2);
    const frameY = 16;
    this.ornateFrame(ctx, frameX, frameY, frameW, frameH);

    ctx.textAlign = 'center';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#8ee8f4';
    ctx.fillText('信 标 传 送', VIEW_W / 2, frameY + 20);

    ctx.fillStyle = '#4a3c5c';
    ctx.fillRect(frameX + 20, frameY + 26, frameW - 40, 1);

    const benches = this.getVisitedBenches();
    if (benches.length === 0) {
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#8a7a98';
      ctx.fillText('尚未激活其他信标……', VIEW_W / 2, frameY + 110);
    } else {
      const MAX_VISIBLE = 5;
      const total = benches.length;
      // 保持当前选中项在可视窗口内
      const scrollOffset = Math.max(0, Math.min(total - MAX_VISIBLE, this.fastTravelIndex - 2));
      const visibleList = benches.slice(scrollOffset, scrollOffset + MAX_VISIBLE);

      const listStartY = frameY + 32;
      const cardW = 236;
      const cardH = 25;
      const cardX = Math.round(VIEW_W / 2 - cardW / 2);

      visibleList.forEach((b, index) => {
        const i = scrollOffset + index;
        const cardY = listStartY + index * 29;
        const isSel = i === this.fastTravelIndex;

        // 只保留轻量选中标记,避免每个传送点都被文字框包围。
        if (isSel) {
          ctx.fillStyle = '#8ee8f4';
          ctx.fillRect(cardX - 5, cardY + 10, 3, 3);
          ctx.globalAlpha = 0.22;
          ctx.fillRect(cardX + 4, cardY + cardH - 1, cardW - 8, 1);
          ctx.globalAlpha = 1;
        }

        // 左侧文字: 区域与房间名
        ctx.textAlign = 'left';
        ctx.font = isSel ? 'bold 10px sans-serif' : '10px sans-serif';

        // 区域前缀
        ctx.fillStyle = isSel ? '#7ae0c8' : '#8a7a98';
        const zoneTag = `[${b.zoneName}] `;
        ctx.fillText(zoneTag, cardX + 8, cardY + 16);
        const tagW = ctx.measureText(zoneTag).width;

        // 房间名
        ctx.fillStyle = b.isCurrent ? '#ffd75e' : isSel ? '#ffffff' : '#c8b8d8';
        ctx.fillText(b.name, cardX + 8 + tagW, cardY + 16);

        // 右侧状态标签
        ctx.textAlign = 'right';
        ctx.font = '9px sans-serif';
        if (b.isCurrent) {
          ctx.fillStyle = '#ffd75e';
          ctx.fillText('(当前信标)', cardX + cardW - 8, cardY + 16);
        } else if (isSel) {
          ctx.fillStyle = '#8ee8f4';
          ctx.fillText('按 F 传送 ▶', cardX + cardW - 8, cardY + 16);
        } else {
          ctx.fillStyle = '#5a4c6a';
          ctx.fillText('已到访', cardX + cardW - 8, cardY + 16);
        }
      });

      // 滚动指示指示器
      if (scrollOffset > 0) {
        ctx.textAlign = 'center';
        ctx.font = '8px sans-serif';
        ctx.fillStyle = '#8ee8f4';
        ctx.fillText('▲', frameX + frameW - 22, frameY + 20);
      }
      if (scrollOffset + MAX_VISIBLE < total) {
        ctx.textAlign = 'center';
        ctx.font = '8px sans-serif';
        ctx.fillStyle = '#8ee8f4';
        ctx.fillText('▼', frameX + frameW - 22, listStartY + MAX_VISIBLE * 29);
      }
    }

    ctx.textAlign = 'center';
    ctx.font = '9px sans-serif';
    ctx.fillStyle = '#8a7a98';
    ctx.fillText('↑/↓ 选择 · F 键 确认传送 · Esc 取消', VIEW_W / 2, frameY + frameH - 10);
    ctx.textAlign = 'left';
  }

  private renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.overlay === 'none') return;
    if (this.overlay === 'map') {
      this.renderMap(ctx);
      return;
    }
    if (this.overlay === 'shop') {
      this.renderShop(ctx);
      return;
    }
    if (this.overlay === 'fast_travel') {
      this.renderFastTravel(ctx);
      return;
    }
    ctx.fillStyle = 'rgba(4, 3, 10, 0.72)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    const F_BIG = 'bold 16px "SimSun", "Songti SC", serif';
    const F_MID = '10px "SimSun", "Songti SC", serif';
    const F_SMALL = '9px "SimSun", "Songti SC", serif';

    if (this.overlay === 'pause') {
      this.ornateFrame(ctx, VIEW_W / 2 - 90, 78, 180, 84);
      ctx.font = F_BIG;
      ctx.fillStyle = '#e8d8a8';
      ctx.fillText('暂 停', VIEW_W / 2, 104);
      ctx.font = F_SMALL;
      ctx.fillStyle = '#8a7a98';
      ctx.fillText('Esc 继续 · J 回到信标 · L 返回标题', VIEW_W / 2, 136);
    } else if (this.overlay === 'dead') {
      ctx.font = F_BIG;
      ctx.fillStyle = '#c86a9a';
      ctx.fillText('信 号 中 断 ……', VIEW_W / 2, 112);
      ctx.font = F_SMALL;
      ctx.fillStyle = '#8a7a98';
      ctx.fillText('正在回到最后的信标', VIEW_W / 2, 138);
    } else if (this.overlay === 'ability') {
      const info = ABILITY_INFO[this.abilityKind];
      const a = clamp(this.overlayT / 0.4, 0, 1);
      ctx.globalAlpha = a;
      this.ornateFrame(ctx, VIEW_W / 2 - 90, 84, 180, 82);
      ctx.font = F_BIG;
      ctx.fillStyle = this.abilityKind === 'kanami' ? '#ffb0d8' : '#8ee8f4';
      ctx.fillText(info.name, VIEW_W / 2, 108);
      ctx.font = F_SMALL;
      ctx.fillStyle = '#e8d8a8';
      ctx.fillText('已获得', VIEW_W / 2, 132);
      if (this.overlayT > 0.6) {
        ctx.fillStyle = '#8a7a98';
        ctx.fillText('确认', VIEW_W / 2, 154);
      }
      ctx.globalAlpha = 1;
    } else if (this.overlay === 'victory') {
      this.ornateFrame(ctx, VIEW_W / 2 - 130, 58, 260, 156);
      ctx.font = 'bold 18px "SimSun", "Songti SC", serif';
      ctx.fillStyle = '#e8c860';
      ctx.fillText('守望者 已被击败', VIEW_W / 2, 88);
      ctx.font = F_MID;
      ctx.fillStyle = '#d8ccE8';
      ctx.fillText('欧拉的夜空,重归平静。', VIEW_W / 2, 114);
      ctx.fillStyle = COLORS.michele;
      ctx.fillText('米雪儿:「任务完成,回家喝热可可!」', VIEW_W / 2, 136);
      ctx.fillStyle = COLORS.kanami;
      ctx.fillText('香奈美:「下次冒险,也要一起哦♪」', VIEW_W / 2, 154);
      ctx.font = F_SMALL;
      ctx.fillStyle = '#e878c0';
      ctx.fillText(`◆ 弦晶 ${this.world.crystals.size} / ${TOTAL_CRYSTALS}`, VIEW_W / 2, 176);
      ctx.fillStyle = '#8a7a98';
      ctx.fillText('感谢游玩 · 按 确认 返回标题', VIEW_W / 2, 196);
    }
    ctx.textAlign = 'left';
  }
}

/** 过渡房两端各保留少量纯区域色,中段使用平滑插值。 */
export function roomTransitionMix(
  room: RoomDef,
  playerX: number,
  playerY: number,
  mapW: number,
  mapH: number,
): number {
  if (!room.transition || mapW <= 0 || mapH <= 0) return 0;
  const horizontal = clamp((playerX / mapW - 0.08) / 0.84, 0, 1);
  const vertical = clamp((playerY / mapH - 0.08) / 0.84, 0, 1);
  const towardTarget = room.transition.toSide === 'down'
    ? vertical
    : room.transition.toSide === 'right'
      ? horizontal
      : 1 - horizontal;
  return towardTarget * towardTarget * (3 - 2 * towardTarget);
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseThemeColor(value: string): Rgba {
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return {
      r: Number.parseInt(value.slice(1, 3), 16),
      g: Number.parseInt(value.slice(3, 5), 16),
      b: Number.parseInt(value.slice(5, 7), 16),
      a: 1,
    };
  }
  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (match) {
    const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
    return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

function blendThemeColor(from: string, to: string, mix: number): string {
  const a = parseThemeColor(from);
  const b = parseThemeColor(to);
  const channel = (x: number, y: number) => Math.round(lerp(x, y, mix));
  const alpha = Math.round(lerp(a.a, b.a, mix) * 1000) / 1000;
  return `rgba(${channel(a.r, b.r)},${channel(a.g, b.g)},${channel(a.b, b.b)},${alpha})`;
}

export function blendLevelThemes(from: LevelTheme, to: LevelTheme, mix: number): LevelTheme {
  const result = {} as LevelTheme;
  for (const key of Object.keys(from) as (keyof LevelTheme)[]) {
    result[key] = blendThemeColor(from[key], to[key], clamp(mix, 0, 1));
  }
  return result;
}
