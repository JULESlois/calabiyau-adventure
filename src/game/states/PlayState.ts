import { FLASH_CHARGE, FLASH_ENERGY_REFUND, FLASH_WINDOW, INVULN_TIME, TILE, VIEW_H, VIEW_W } from '../constants';
import { Boss } from '../entities/boss';
import type { EnemyBullet, PlayerBullet } from '../entities/bullets';
import { Enemy, type EnemyKind } from '../entities/enemies';
import { ParticleSystem } from '../entities/particles';
import { makePickup, type Pickup } from '../entities/pickups';
import { Player } from '../entities/Player';
import { Warden } from '../entities/warden';
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
import { CONTROLS_PAGE_COUNT, drawControlsPanel } from '../render/controlsPanel';
import {
  drawOverlays,
  PAUSE_ITEMS,
  type Overlay,
  type OverlayView,
  type PauseAction,
} from '../render/overlays';
import type { BossLike, GadgetHost, PlayerHost, StringMode, WorldApi } from '../types';
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
  type ZoneDef,
  type ZoneId,
} from '../world/world';
import type { WorldState } from '../world/WorldState';
import { moverDisplacement, RegionMechanics, type MechanicsHost, type ShortcutRuntime } from './regionMechanics';

export { moverDisplacement };

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

export class PlayState implements GameState, WorldApi, MechanicsHost, PlayerHost, GadgetHost {
  roomId: string;
  room: RoomDef;
  zone: ZoneDef;
  level: ParsedRows;
  player: Player;
  enemies: Enemy[] = [];
  boss: BossLike | null = null;
  playerBullets: PlayerBullet[] = [];
  enemyBullets: EnemyBullet[] = [];
  pickups: (Pickup & { id?: string; chipId?: string })[] = [];
  /** 区域机关(平台/气流/喷流/共鸣器/传送带/极性终端/捷径闸门) */
  mechanics = new RegionMechanics(this);
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
  pauseSel = 0;
  pauseConfirm: PauseAction | null = null;
  controlsPage = 0;
  /** 由 Engine 在首次进入房间时置位,用来报一次房间名。 */
  announceRoomName = false;
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
    this.mechanics.buildShortcuts(this.room.shortcuts ?? []);
    this.mechanics.bossGate = this.room.bossGate;
    let startX = 40;
    let startY = 100;
    for (const s of this.level.spawns) {
      const cx = s.col * TILE + TILE / 2;
      const bottom = (s.row + 1) * TILE;
      if (this.mechanics.spawn(s.char, cx, bottom, s.col, s.row)) continue;
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
        case 'X':
          if (!world.has('flash')) this.abilitySpots.push({ x: cx, y: bottom, kind: 'flash' });
          break;
        case 'Y':
          if (!world.has('skystep')) this.abilitySpots.push({ x: cx, y: bottom, kind: 'skystep' });
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
        case '7':
          this.enemies.push(new Enemy('leech', cx, bottom));
          break;
        case '8':
          this.enemies.push(new Enemy('mortar', cx, bottom));
          break;
        case '9':
          this.enemies.push(new Enemy('hound', cx, bottom));
          break;
        case 'Z':
          // 回响守卫:已击败则屏障永久解封,不再重生。
          if (!world.flags.has('boss:warden')) this.boss = new Warden(cx, bottom);
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
    this.mechanics.syncMoversToTime(true);
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
    if (this.mechanics.gateSolidAt(c, r)) return T_SOLID;
    const t = this.level.tiles[r * this.level.w + c];
    if (t === T_POLARITY) return this.mechanics.polarityOpen ? T_EMPTY : T_MEMBRANE;
    if (t === T_HIDDEN) {
      return (this.hiddenReveal.get(r * this.level.w + c) ?? 0) > 0 ? T_SOLID : T_EMPTY;
    }
    return t;
  }

  /** MechanicsHost:共鸣器与声呐共用的隐藏平台显形入口。 */
  revealHiddenTile(tileIndex: number, seconds: number): void {
    this.hiddenReveal.set(tileIndex, seconds);
  }

  /** MechanicsHost:捷径闸门是否已由玩家从远端开启。 */
  isShortcutOpen(id: string): boolean {
    return this.world.shortcuts.has(id);
  }

  /** MechanicsHost:守卫屏障读世界旗标(Boss 击败后永久解封)。 */
  isFlagSet(flag: string): boolean {
    return this.world.flags.has(flag);
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
    // 音乐由 Engine.startRoom 按场景切换。
    // 房间名过去只出现在地图与传送列表里,首次进入报一次,57 个房间才叫得出名字。
    if (this.announceRoomName && this.introT <= 0) this.toast(this.room.name);
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
        this.pauseSel = 0;
        this.pauseConfirm = null;
        this.sfx('ui');
        return;
      }
      if (this.overlay === 'pause') {
        // 确认框里的 Esc 只取消确认,不直接退出菜单。
        if (this.pauseConfirm) this.pauseConfirm = null;
        else this.overlay = 'none';
        this.sfx('ui');
        return;
      }
    }

    if (this.overlay === 'controls') {
      this.time += dt * 0.2;
      if (input.pressed('left') || input.pressed('up')) {
        this.controlsPage = (this.controlsPage + CONTROLS_PAGE_COUNT - 1) % CONTROLS_PAGE_COUNT;
        this.sfx('ui');
      }
      if (input.pressed('right') || input.pressed('down')) {
        this.controlsPage = (this.controlsPage + 1) % CONTROLS_PAGE_COUNT;
        this.sfx('ui');
      }
      if (input.pressed('pause') || input.pressed('confirm') || input.pressed('map')) {
        this.overlay = 'pause';
        this.sfx('ui');
      }
      return;
    }

    if (this.overlay === 'pause') {
      this.time += dt * 0.2;
      if (this.pauseConfirm) {
        if (input.pressed('confirm') || input.pressed('interact')) {
          this.runPauseAction(this.pauseConfirm);
        }
        return;
      }
      const n = PAUSE_ITEMS.length;
      if (input.pressed('up')) {
        this.pauseSel = (this.pauseSel - 1 + n) % n;
        this.sfx('ui');
      }
      if (input.pressed('down')) {
        this.pauseSel = (this.pauseSel + 1) % n;
        this.sfx('ui');
      }
      if (input.pressed('confirm') || input.pressed('interact')) {
        const item = PAUSE_ITEMS[this.pauseSel];
        this.sfx('ui');
        // 会丢掉探索进度的两项一律先问一遍。
        if (item.danger) this.pauseConfirm = item.action;
        else this.runPauseAction(item.action);
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
      // 死亡不该是强制等待:过掉最初的演出后就允许立刻重生。
      const canSkip = this.overlayT < 1.2;
      if (this.overlayT <= 0 || (canSkip && (input.pressed('confirm') || input.pressed('interact')))) {
        this.engine.respawnAtBench();
      }
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
    this.mechanics.advanceMovers();
    this.mechanics.updateResonators();

    // 玩家
    this.player.update(dt, this);
    this.mechanics.applyUpdrafts(dt, this.player);
    this.mechanics.applyPressureJets(dt, this.player);
    this.mechanics.rideMovers(this.player);
    this.mechanics.rideConveyors(dt, this.player);

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
      if (!wasDead && this.boss.state === 'dead') this.onBossDefeated(this.boss);
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

  /**
   * 两场 Boss 战的结算完全不同:守望者开通关门,回响守卫只解封弦能屏障。
   * 共同点是清场、写旗标与立即存档 —— 玩家不该因为战后掉线而重打。
   */
  private onBossDefeated(boss: BossLike): void {
    this.engine.audio.playStinger('bossDefeat');
    this.engine.audio.playSong(this.zone.song, 1.8);
    this.engine.audio.setMusicState({ intensity: 0, ducked: false });
    this.enemyBullets = [];
    for (const e of this.enemies) e.dead = true;

    if (boss.kind === 'guardian') {
      if (this.gate.active) return;
      this.world.flags.add('boss:guardian');
      this.world.dust += 120;
      this.toast('获得 120 晶尘');
      this.gate.x = this.mapW / 2;
      this.gate.y = this.mapH - 3 * TILE;
      this.gate.active = true;
    } else {
      if (this.world.flags.has('boss:warden')) return;
      this.world.flags.add('boss:warden');
      this.world.dust += 60;
      this.toast('弦能屏障解除 · 获得 60 晶尘');
      this.shake(4);
      this.particles.burst(boss.x, boss.y - 16, 26, '#c47eff', 150, 0.9, 'spark');
    }
    this.persistRuntime();
  }

  private runPauseAction(action: PauseAction): void {
    this.pauseConfirm = null;
    switch (action) {
      case 'resume':
        this.overlay = 'none';
        break;
      case 'controls':
        this.overlay = 'controls';
        this.controlsPage = 0;
        break;
      case 'bench':
        this.engine.respawnAtBench();
        break;
      case 'title':
        this.persistRuntime();
        this.engine.showTitle();
        break;
      default:
        break;
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
    for (const shortcut of this.mechanics.shortcuts) {
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
    for (const spot of this.mechanics.polaritySpots) {
      const zone: Rect = { x: spot.x - 12, y: spot.y - 28, w: 24, h: 28 };
      if (!rectsOverlap(pr, zone)) continue;
      this.nearPolaritySpot = spot;
      if (this.input.pressed('interact')) {
        this.mechanics.polarityOpen = !this.mechanics.polarityOpen;
        this.sfx('switch');
        this.toast(this.mechanics.polarityOpen ? '极性膜：开放' : '极性膜：封锁');
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
          if (b.resting) {
            // 已经休息过:同一个键改为开传送列表,并把光标停在当前信标上,
            // 免得手快连按两次 F 就被送回开局房间。
            this.overlay = 'fast_travel';
            const list = this.getVisitedBenches();
            const here = list.findIndex((entry) => entry.isCurrent);
            this.fastTravelIndex = here >= 0 ? here : 0;
            this.sfx('ui');
            return;
          }
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
      const canFlash = this.world.has('flash') && p.paperEnterT <= FLASH_WINDOW;
      for (const b of this.enemyBullets) {
        const grazing = Math.abs(b.x - this.playerX) < 10 && Math.abs(b.y - this.playerY) < 14;
        if (!grazing) continue;
        // 弦闪:子弹将至的一瞬弦化 —— 擦弹成功,强化下一击并返还少量弦能。
        // 子弹本身不消失(原作语义是"擦过纸片"),但同一颗只触发一次。
        if (canFlash && !b.flashed) {
          b.flashed = true;
          p.flashChargeT = FLASH_CHARGE;
          p.energy = Math.min(this.world.energyMax, p.energy + FLASH_ENERGY_REFUND);
          this.sfx('crystal');
          this.shake(1);
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            this.particles.spawn({
              x: this.playerX, y: this.playerY,
              vx: Math.cos(a) * 130, vy: Math.sin(a) * 130,
              life: 0.28, color: '#e8fbff', shape: 'spark', size: 1,
            });
          }
        } else if (Math.random() < 0.2) {
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
        p.hurt(this.boss.contactDmg, this.boss.x, this);
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
    this.mechanics.render(ctx);

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
    ctx.fillStyle = this.theme.ember;
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

    if (transient) drawOverlays(ctx, this.overlayView());
    if (transient && this.overlay === 'controls') {
      drawControlsPanel(ctx, {
        abilities: this.world.abilities,
        chips: this.world.chips,
        device: this.engine.input.lastDevice,
        page: this.controlsPage,
      });
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
            ctx.globalAlpha = this.mechanics.polarityOpen ? 0.12 : pulse + 0.18;
            ctx.fillStyle = this.mechanics.polarityOpen ? '#8de0c4' : '#7060d0';
            ctx.fillRect(x + 2, y, TILE - 4, TILE);
            ctx.globalAlpha = this.mechanics.polarityOpen ? 0.3 : 0.8;
            ctx.fillStyle = this.mechanics.polarityOpen ? '#b8f4df' : '#e878c0';
            ctx.fillRect(x + 1, y, TILE - 2, 1);
            ctx.fillRect(x + 1, y + TILE - 1, TILE - 2, 1);
            if (!this.mechanics.polarityOpen) {
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

  /** 覆盖层与 toast 由 render/overlays.ts 绘制;这里只组装它需要的当帧快照。 */
  private overlayView(): OverlayView {
    return {
      world: this.world,
      roomId: this.roomId,
      roomName: this.room.name,
      time: this.time,
      camX: this.camX,
      camY: this.camY,
      overlay: this.overlay,
      overlayT: this.overlayT,
      abilityKind: this.abilityKind,
      shopSel: this.shopSel,
      fastTravelIndex: this.fastTravelIndex,
      totalCrystals: TOTAL_CRYSTALS,
      toasts: this.toasts,
      promptAnchor: this.interactionPromptAnchor(),
      promptLabel: this.interactionPromptLabel(),
      benches: this.getVisitedBenches(),
      device: this.engine.input.lastDevice,
      pauseSel: this.pauseSel,
      pauseConfirm: this.pauseConfirm,
    };
  }

  /** 让玩家在按下之前就知道这一下会发生什么。 */
  private interactionPromptLabel(): string {
    if (this.nearBenchSpot) return this.nearBenchSpot.resting ? '传送' : '休息';
    if (this.nearShortcutSpot) return '开启闸门';
    if (this.nearPolaritySpot) return this.mechanics.polarityOpen ? '封锁极性膜' : '开放极性膜';
    if (this.nearAbilitySpot) return '取得能力';
    if (this.nearKanamiSpot) return '解救香奈美';
    if (this.nearShop && this.shopSpot) return '交易';
    return '';
  }

  /** F 提示只显示一个目标,优先级与 updateInteractables 的检测顺序一致。 */
  private interactionPromptAnchor(): { x: number; y: number } | null {
    if (this.nearBenchSpot) return { x: this.nearBenchSpot.x, y: this.nearBenchSpot.y - 32 };
    if (this.nearShortcutSpot) {
      return { x: this.nearShortcutSpot.lever.x, y: this.nearShortcutSpot.lever.y - 22 };
    }
    if (this.nearPolaritySpot) return { x: this.nearPolaritySpot.x, y: this.nearPolaritySpot.y - 22 };
    if (this.nearAbilitySpot) return { x: this.nearAbilitySpot.x, y: this.nearAbilitySpot.y - 28 };
    if (this.nearKanamiSpot) return { x: this.nearKanamiSpot.x, y: this.nearKanamiSpot.y - 26 };
    if (this.nearShop && this.shopSpot) return { x: this.shopSpot.x, y: this.shopSpot.y - 26 };
    return null;
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
