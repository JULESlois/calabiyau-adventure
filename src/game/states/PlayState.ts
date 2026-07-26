import { COLORS, INVULN_TIME, MAX_STRING, TILE, VIEW_H, VIEW_W } from '../constants';
import { Boss } from '../entities/boss';
import type { EnemyBullet, PlayerBullet } from '../entities/bullets';
import { Enemy, type EnemyKind } from '../entities/enemies';
import { ParticleSystem } from '../entities/particles';
import { makePickup, type Pickup } from '../entities/pickups';
import { Player } from '../entities/Player';
import {
  LEVELS,
  parseLevel,
  T_EMPTY,
  T_MEMBRANE,
  T_ONEWAY,
  T_SOLID,
  T_SPIKE,
  type ParsedLevel,
} from '../levels/levels';
import { Background } from '../render/background';
import { drawCandle, drawCheckpoint, drawExitGate, drawPickup } from '../render/sprites';
import { drawHUD } from '../render/hud';
import type { WorldApi } from '../types';
import { clamp, lerp, rectsOverlap, type Rect } from '../utils';
import type { Engine, GameState } from '../Engine';

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

interface Checkpoint {
  x: number;
  y: number;
  active: boolean;
}

type Overlay = 'none' | 'pause' | 'dead' | 'clear' | 'victory';

export class PlayState implements GameState, WorldApi {
  level: ParsedLevel;
  levelId: number;
  player: Player;
  enemies: Enemy[] = [];
  boss: Boss | null = null;
  playerBullets: PlayerBullet[] = [];
  enemyBullets: EnemyBullet[] = [];
  pickups: Pickup[] = [];
  movers: Mover[] = [];
  checkpoints: Checkpoint[] = [];
  particles = new ParticleSystem();
  bg: Background;

  gate = { x: 0, y: 0, active: false };
  respawnX = 0;
  respawnY = 0;
  crystals = 0;
  totalCrystals = 0;

  camX = 0;
  camY = 0;
  shakeT = 0;
  shakeMag = 0;
  time = 0;
  introT = 2.8;
  overlay: Overlay = 'none';
  overlayT = 0;
  private meleeHits = new Map<object, number>();
  /** 环境飘浮微粒(余烬/尘埃/落灰),屏幕空间 */
  private embers: { x: number; y: number; vx: number; vy: number; ph: number }[] = [];

  constructor(
    public engine: Engine,
    levelId: number,
  ) {
    this.levelId = levelId;
    const def = LEVELS[levelId - 1];
    this.level = parseLevel(def);
    this.bg = new Background(def.theme, levelId, this.mapW);

    let spawnX = 40;
    let spawnY = 100;
    for (const s of this.level.spawns) {
      const cx = s.col * TILE + TILE / 2;
      const bottom = (s.row + 1) * TILE;
      switch (s.char) {
        case 'P':
          spawnX = cx;
          spawnY = bottom;
          break;
        case 'E':
          this.gate.x = cx;
          this.gate.y = bottom;
          this.gate.active = true;
          break;
        case 'C':
          this.checkpoints.push({ x: cx, y: bottom, active: false });
          break;
        case '*':
          this.pickups.push(makePickup(cx, s.row * TILE + TILE / 2, 'crystal'));
          this.totalCrystals++;
          break;
        case 'h':
          this.pickups.push(makePickup(cx, s.row * TILE + TILE / 2, 'heart'));
          break;
        case 'e':
          this.pickups.push(makePickup(cx, s.row * TILE + TILE / 2, 'energy'));
          break;
        case '1':
          this.enemies.push(new Enemy('patrol', cx, bottom));
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
        case 'B': {
          this.boss = new Boss(cx, bottom);
          this.gate.active = false; // Boss 关:击败后开启传送门
          break;
        }
        default:
          break;
      }
    }

    this.player = new Player(spawnX, spawnY);
    this.respawnX = spawnX;
    this.respawnY = spawnY;

    // 环境微粒
    for (let i = 0; i < 42; i++) {
      const falling = levelId === 3;
      this.embers.push({
        x: Math.random() * VIEW_W,
        y: Math.random() * VIEW_H,
        vx: (Math.random() - 0.5) * 10,
        vy: falling ? 10 + Math.random() * 16 : levelId === 2 ? 0 : -(6 + Math.random() * 14),
        ph: Math.random() * Math.PI * 2,
      });
    }
    this.camX = clamp(spawnX - VIEW_W / 2, 0, Math.max(0, this.mapW - VIEW_W));
    this.camY = clamp(spawnY - VIEW_H / 2, 0, Math.max(0, this.mapH - VIEW_H));
  }

  // ---------------- WorldApi ----------------
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

  tileAt(c: number, r: number): number {
    if (c < 0 || c >= this.level.w) return T_SOLID; // 左右边界为墙
    if (r < 0 || r >= this.level.h) return T_EMPTY; // 上下开放
    return this.level.tiles[r * this.level.w + c];
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

  fireEnemyBullet(x: number, y: number, vx: number, vy: number, dmg = 10, color = '#ff8a5c', r = 2.5): void {
    this.enemyBullets.push({ x, y, vx, vy, r, dmg, life: 3.2, color });
  }

  spawnEnemy(kind: string, x: number, y: number): void {
    const summonedAlive = this.enemies.filter((e) => e.summoned && !e.dead).length;
    if (summonedAlive >= 2) return;
    const e = new Enemy(kind as EnemyKind, x, y);
    e.summoned = true;
    this.enemies.push(e);
    this.particles.burst(x, y - 8, 10, '#c47eff', 80, 0.4);
  }

  freezeNova(x: number, y: number): void {
    this.sfx('skillIce');
    this.shake(3);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      this.particles.spawn({
        x, y,
        vx: Math.cos(a) * 160, vy: Math.sin(a) * 160,
        life: 0.5, color: '#bfeaff', shape: 'snow',
      });
    }
    for (const e of this.enemies) {
      if (!e.dead && Math.hypot(e.x - x, e.y - e.h / 2 - y) < 100) {
        e.hit(15, 2.6, this);
        this.onEnemyDamaged(e);
      }
    }
    if (this.boss && this.boss.active && Math.hypot(this.boss.x - x, this.boss.y - 24 - y) < 120) {
      this.boss.hit(25, this);
    }
    this.enemyBullets = this.enemyBullets.filter((b) => Math.hypot(b.x - x, b.y - y) > 105);
  }

  // ---------------- 主循环 ----------------
  enter(): void {
    this.engine.audio.playSong(this.level.def.song);
  }

  update(dt: number): void {
    const input = this.engine.input;

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
      if (input.pressed('shoot')) this.engine.startLevel(this.levelId);
      else if (input.pressed('skill')) this.engine.showTitle();
      return;
    }

    this.time += dt;
    this.introT -= dt;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) this.shakeMag = 0;
    }
    this.particles.update(dt);

    // 结算类覆盖层
    if (this.overlay === 'dead') {
      this.overlayT -= dt;
      if (this.overlayT <= 0) this.respawn();
      return;
    }
    if (this.overlay === 'clear' || this.overlay === 'victory') {
      this.overlayT -= dt;
      const canSkip = this.overlayT < 2.6;
      if ((canSkip && (input.pressed('confirm') || input.pressed('shoot'))) || this.overlayT <= 0) {
        if (this.overlay === 'victory' || this.levelId >= LEVELS.length) this.engine.showTitle();
        else this.engine.startLevel(this.levelId + 1);
      }
      return;
    }

    // 移动平台
    for (const m of this.movers) {
      m.prevX = m.x;
      m.prevY = m.y;
      const s = Math.sin(this.time * m.speed + m.phase) * m.range;
      if (m.axis === 'h') m.x = m.baseX + s;
      else m.y = m.baseY + s;
    }

    // 玩家
    this.player.update(dt, this);
    this.rideMovers();

    // Boss 触发与更新
    if (this.boss) {
      if (this.boss.state === 'dormant' && Math.abs(this.playerX - this.boss.x) < 200) {
        this.boss.awaken(this);
      }
      const wasDead = this.boss.state === 'dead';
      this.boss.update(dt, this);
      if (!wasDead && this.boss.state === 'dead' && !this.gate.active) {
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
      // 只更新镜头附近的敌人
      if (Math.abs(e.x - this.playerX) < VIEW_W * 0.9) {
        e.update(dt, this);
      }
    }

    this.updateBullets(dt);
    this.resolveCombat(dt);
    this.checkHazards();
    this.collectPickups();
    this.checkGates();
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
      this.overlayT = 1.5;
      this.sfx('explosion');
      this.particles.burst(this.playerX, this.playerY, 24, this.player.char === 'michele' ? '#8fd7ff' : '#ffb0d8', 150, 0.8);
    }
  }

  private updateEmbers(dt: number): void {
    for (const e of this.embers) {
      e.ph += dt;
      e.x += (e.vx + Math.sin(e.ph * 1.4) * 6) * dt;
      e.y += (this.levelId === 2 ? Math.sin(e.ph) * 8 : e.vy) * dt;
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
      // 站上判定:脚在平台顶附近且在下落/站立
      if (p.vy >= 0 && p.y >= top - 8 && p.y <= top + Math.max(8, dy + 8)) {
        p.y = top;
        p.vy = 0;
        p.onGround = true;
        p.jumpsUsed = 0;
        // 平台携带
        p.x += m.x - m.prevX;
        if (dy > 0) p.y += 0; // 顶已同步
      }
    }
  }

  private updateBullets(dt: number): void {
    // 玩家子弹
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
      // 拖尾
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
        this.playerBullets.splice(i, 1);
      }
    }
    // 敌方子弹
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
      // 近战可以击碎子弹
      if (!remove && melee && rectsOverlap(melee, { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 })) {
        this.particles.burst(b.x, b.y, 6, '#ffd75e', 70, 0.3, 'spark');
        this.sfx('meleeHit');
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
      // 掉落
      if (Math.random() < 0.28) {
        this.pickups.push(makePickup(e.x, e.y - 10, Math.random() < 0.5 ? 'heart' : 'energy', true));
      }
    } else {
      this.sfx('meleeHit');
    }
  }

  private resolveCombat(dt: number): void {
    const p = this.player;
    const pr = p.rect();

    // 玩家子弹 vs 敌人 / Boss
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
        } else {
          e.hit(b.dmg, b.kind === 'ice' ? 0.32 : 0, this);
          this.particles.burst(b.x, b.y, 5, b.kind === 'ice' ? '#7ef0ff' : '#ffb0d8', 60, 0.3);
          this.onEnemyDamaged(e);
        }
        consumed = true;
        break;
      }
      if (!consumed && this.boss && this.boss.active && rectsOverlap(br, this.boss.rect())) {
        this.boss.hit(b.dmg, this);
        this.particles.burst(b.x, b.y, 5, b.kind === 'ice' ? '#7ef0ff' : '#ffb0d8', 60, 0.3);
        consumed = true;
      }
      if (consumed) this.playerBullets.splice(i, 1);
    }

    // 近战 vs 敌人 / Boss
    const melee = p.meleeHitbox();
    if (melee) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (this.meleeHits.get(e) === p.swingId) continue;
        if (rectsOverlap(melee, e.rect())) {
          this.meleeHits.set(e, p.swingId);
          e.hit(p.meleeDamage(), 0, this);
          e.x += p.facing * 4;
          this.onEnemyDamaged(e);
          this.shake(p.meleeStep === 2 ? 3 : 1);
        }
      }
      if (this.boss && this.boss.active && this.meleeHits.get(this.boss) !== p.swingId) {
        if (rectsOverlap(melee, this.boss.rect())) {
          this.meleeHits.set(this.boss, p.swingId);
          this.boss.hit(p.meleeDamage(), this);
          this.particles.burst(melee.x + melee.w / 2, melee.y + melee.h / 2, 8, '#ffd75e', 90, 0.4, 'spark');
          this.sfx('meleeHit');
        }
      }
    }

    // 敌方子弹 vs 玩家(纸片形态直接穿过!)
    if (!p.paper && !p.dead) {
      for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
        const b = this.enemyBullets[i];
        if (rectsOverlap(pr, { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 })) {
          if (p.hurt(b.dmg, b.x, this)) {
            this.enemyBullets.splice(i, 1);
          }
        }
      }
    } else if (p.paper) {
      // 子弹穿过纸片的擦弹微光
      for (const b of this.enemyBullets) {
        if (Math.abs(b.x - this.playerX) < 10 && Math.abs(b.y - this.playerY) < 14 && Math.random() < 0.2) {
          this.particles.spawn({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.2, color: '#aef4ff', shape: 'spark' });
        }
      }
    }

    // 接触伤害
    if (!p.dead) {
      for (const e of this.enemies) {
        if (e.dead || e.frozen > 0) continue;
        if (rectsOverlap(pr, e.rect())) {
          p.hurt(e.contactDmg, e.x, this);
        }
      }
      if (this.boss && this.boss.active && this.boss.state !== 'stunned' && rectsOverlap(pr, this.boss.rect())) {
        p.hurt(18, this.boss.x, this);
      }
    }

    // 清理尸体(保留 dead 标记的敌人以免数组频繁重排,但过多时清理)
    if (this.enemies.length > 40) {
      this.enemies = this.enemies.filter((e) => !e.dead);
    }
  }

  private checkHazards(): void {
    const p = this.player;
    if (p.dead) return;
    // 尖刺
    const r = p.rect();
    const c0 = Math.floor(r.x / TILE);
    const c1 = Math.floor((r.x + r.w - 0.001) / TILE);
    const r0 = Math.floor(r.y / TILE);
    const r1 = Math.floor((r.y + r.h - 0.001) / TILE);
    outer: for (let c = c0; c <= c1; c++) {
      for (let rr = r0; rr <= r1; rr++) {
        if (this.tileAt(c, rr) === T_SPIKE) {
          // 只有碰到尖刺上半段才受伤
          if (r.y + r.h > rr * TILE + 6) {
            p.hurt(12, p.x + (Math.random() - 0.5), this);
            p.vy = -240;
            break outer;
          }
        }
      }
    }
    // 坠落出界
    if (p.y > this.mapH + 50) {
      p.invuln = 0;
      const wasAlive = !p.dead;
      p.hurt(30, p.x, this);
      if (wasAlive && !p.dead) {
        p.x = this.respawnX;
        p.y = this.respawnY;
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
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += 1 / 60;
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
          case 'heart':
            p.hp = Math.min(100, p.hp + 25);
            this.sfx('pickup');
            this.particles.burst(pk.x, pk.y, 8, '#ff5d7e', 70, 0.4);
            break;
          case 'energy':
            p.energy = Math.min(MAX_STRING, p.energy + 45);
            this.sfx('pickup');
            this.particles.burst(pk.x, pk.y, 8, '#7ef0ff', 70, 0.4);
            break;
          case 'crystal':
            this.crystals++;
            this.sfx('crystal');
            this.particles.burst(pk.x, pk.y, 10, '#ff8ad0', 80, 0.5, 'spark');
            break;
          default:
            break;
        }
        this.pickups.splice(i, 1);
      }
    }
  }

  private checkGates(): void {
    const p = this.player;
    if (p.dead) return;
    // 检查点
    for (const c of this.checkpoints) {
      if (!c.active && Math.abs(p.x - c.x) < 14 && Math.abs(p.y - c.y) < 24) {
        c.active = true;
        this.respawnX = c.x;
        this.respawnY = c.y;
        this.sfx('checkpoint');
        this.particles.burst(c.x, c.y - 16, 14, '#7ef0ff', 80, 0.6);
      }
    }
    // 出口
    if (this.gate.active && Math.abs(p.x - this.gate.x) < 12 && Math.abs(p.y - this.gate.y) < 26) {
      const save = this.engine.save;
      save.unlocked = Math.max(save.unlocked, Math.min(this.levelId + 1, LEVELS.length));
      save.bestCrystals[this.levelId] = Math.max(save.bestCrystals[this.levelId] ?? 0, this.crystals);
      if (this.levelId >= LEVELS.length) {
        save.cleared = true;
        this.overlay = 'victory';
        this.overlayT = 6;
      } else {
        this.overlay = 'clear';
        this.overlayT = 3.4;
      }
      this.engine.persistSave();
      this.engine.audio.playSong(-1);
      this.sfx('checkpoint');
    }
  }

  private respawn(): void {
    const p = this.player;
    p.dead = false;
    p.hp = 100;
    p.energy = MAX_STRING;
    p.x = this.respawnX;
    p.y = this.respawnY;
    p.vx = 0;
    p.vy = 0;
    p.paper = false;
    p.invuln = 1.6;
    this.enemyBullets = [];
    this.overlay = 'none';
    this.introT = Math.max(this.introT, 0);
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
  render(ctx: CanvasRenderingContext2D): void {
    const shakeX = this.shakeT > 0 ? (Math.random() - 0.5) * this.shakeMag : 0;
    const shakeY = this.shakeT > 0 ? (Math.random() - 0.5) * this.shakeMag : 0;
    const cx = Math.round(this.camX + shakeX);
    const cy = Math.round(this.camY + shakeY);

    this.bg.render(ctx, this.camX, this.camY, this.time);

    ctx.save();
    ctx.translate(-cx, -cy);

    this.renderTiles(ctx, cx, cy);

    // 移动平台
    const theme = this.level.def.theme;
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

    // 检查点 / 传送门
    for (const c of this.checkpoints) drawCheckpoint(ctx, c.x, c.y, c.active, this.time);
    if (this.gate.active) drawExitGate(ctx, this.gate.x, this.gate.y, this.time);

    // 拾取物
    for (const pk of this.pickups) drawPickup(ctx, pk.kind, pk.x, pk.y, pk.t);

    // 敌人与 Boss
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.x < cx - 40 || e.x > cx + VIEW_W + 40) continue;
      e.render(ctx, this.time);
    }
    if (this.boss) this.boss.render(ctx, this.time);

    // 玩家
    this.player.render(ctx, this.time);

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
    this.bg.renderFront(ctx, this.camX, this.camY, this.time);

    // 环境微粒(屏幕空间)
    const theme2 = this.level.def.theme;
    ctx.fillStyle = theme2.ember;
    for (const e of this.embers) {
      const tw = 0.25 + 0.3 * Math.abs(Math.sin(e.ph * 2));
      ctx.globalAlpha = tw;
      ctx.fillRect(Math.round(e.x), Math.round(e.y), 1, 1);
    }
    ctx.globalAlpha = 1;

    // HUD
    drawHUD(ctx, this.player, this.crystals, this.totalCrystals, this.boss, this.engine.audio.muted);

    // 受击红闪 / 低血量脉冲
    const p = this.player;
    let flash = 0;
    if (!p.dead) {
      // 仅在"刚受伤"的短暂窗口闪红(重生/调试的长无敌不触发)
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

    // 关卡开场横幅(哥特卷轴风)
    if (this.introT > 0) {
      const a = clamp(this.introT > 2.2 ? (2.8 - this.introT) / 0.6 : this.introT / 0.8, 0, 1);
      const cy = VIEW_H / 2;
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = 'rgba(8,5,14,0.9)';
      ctx.fillRect(0, cy - 30, VIEW_W, 58);
      // 金色饰线
      ctx.fillStyle = '#a8823c';
      ctx.fillRect(VIEW_W / 2 - 90, cy - 30, 180, 1);
      ctx.fillRect(VIEW_W / 2 - 90, cy + 27, 180, 1);
      ctx.fillRect(VIEW_W / 2 - 2, cy - 33, 4, 4);
      ctx.fillRect(VIEW_W / 2 - 2, cy + 25, 4, 4);
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px "SimSun", "Songti SC", serif';
      ctx.fillStyle = '#e8d8a8';
      ctx.fillText(this.level.def.name, VIEW_W / 2, cy - 10);
      ctx.font = '9px "SimSun", "Songti SC", serif';
      ctx.fillStyle = '#8a7a98';
      ctx.fillText(this.level.def.subtitle, VIEW_W / 2, cy + 12);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }

    this.renderOverlay(ctx);
  }

  private renderTiles(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const theme = this.level.def.theme;
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

            // 石砖基底
            ctx.fillStyle = theme.tileBase;
            ctx.fillRect(x, y, TILE, TILE);
            // 砖缝(错缝砌法:上半砖缝在左侧,下半在中间)
            ctx.fillStyle = theme.tileDark;
            ctx.fillRect(x, y + 7, TILE, 1);
            ctx.fillRect(x, y + 15, TILE, 1);
            ctx.fillRect(x, y, 1, 7);
            ctx.fillRect(x + 8, y + 8, 1, 7);
            // 风化与裂纹
            if (h % 5 === 0) {
              ctx.fillStyle = 'rgba(255,255,255,0.06)';
              ctx.fillRect(x + (h % 11), y + 2 + (h % 4), 2, 1);
            }
            if (h % 7 === 0) {
              ctx.fillStyle = theme.tileDark;
              ctx.fillRect(x + 3 + (h % 9), y + 9, 1, 3);
              ctx.fillRect(x + 2 + (h % 9), y + 11, 1, 2);
            }
            // 顶部石雕线脚
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
            // 底部深影
            if (!solidDn) {
              ctx.fillStyle = 'rgba(0,0,0,0.4)';
              ctx.fillRect(x, y + 14, TILE, 2);
            }
            // 侧面受光/背光
            if (!solidL) {
              ctx.fillStyle = 'rgba(255,255,255,0.10)';
              ctx.fillRect(x, y, 1, TILE);
            }
            if (!solidR) {
              ctx.fillStyle = 'rgba(0,0,0,0.28)';
              ctx.fillRect(x + TILE - 1, y, 1, TILE);
            }
            // 烛台点缀(顶面,稀疏)
            if (!solidUp && (c * 13 + r * 7) % 29 === 0 && this.tileAt(c, r - 1) === T_EMPTY && this.tileAt(c, r - 2) === T_EMPTY) {
              drawCandle(ctx, x + 7, y, this.time + h, theme.accent);
            }
            break;
          }
          case T_ONEWAY: {
            // 石造挑檐
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
            // 铁刺与底板
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
          case T_MEMBRANE: {
            // 弦膜:哥特神秘光幕,纸片形态可穿过
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

  private renderOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.overlay === 'none') return;
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
      ctx.fillText('Esc 继续 · J 重试本关 · L 返回标题', VIEW_W / 2, 136);
    } else if (this.overlay === 'dead') {
      ctx.font = F_BIG;
      ctx.fillStyle = '#c86a9a';
      ctx.fillText('弦 线 断 裂 ……', VIEW_W / 2, 112);
      ctx.font = F_SMALL;
      ctx.fillStyle = '#8a7a98';
      ctx.fillText('正在从检查点重新出发', VIEW_W / 2, 138);
    } else if (this.overlay === 'clear') {
      this.ornateFrame(ctx, VIEW_W / 2 - 100, 76, 200, 92);
      ctx.font = F_BIG;
      ctx.fillStyle = '#e8d8a8';
      ctx.fillText('关 卡 完 成', VIEW_W / 2, 102);
      ctx.font = F_MID;
      ctx.fillStyle = '#e878c0';
      ctx.fillText(`◆ 弦晶 ${this.crystals} / ${this.totalCrystals}`, VIEW_W / 2, 128);
      if (this.overlayT < 2.6) {
        ctx.font = F_SMALL;
        ctx.fillStyle = '#8a7a98';
        ctx.fillText('按 确认 进入下一关', VIEW_W / 2, 152);
      }
    } else if (this.overlay === 'victory') {
      this.ornateFrame(ctx, VIEW_W / 2 - 130, 62, 260, 148);
      ctx.font = 'bold 18px "SimSun", "Songti SC", serif';
      ctx.fillStyle = '#e8c860';
      ctx.fillText('守望者 已被击败', VIEW_W / 2, 92);
      ctx.font = F_MID;
      ctx.fillStyle = '#d8ccE8';
      ctx.fillText('欧拉的夜空,重归平静。', VIEW_W / 2, 118);
      ctx.fillStyle = COLORS.michele;
      ctx.fillText('米雪儿:「任务完成,回家喝热可可!」', VIEW_W / 2, 140);
      ctx.fillStyle = COLORS.kanami;
      ctx.fillText('香奈美:「下次冒险,也要一起哦♪」', VIEW_W / 2, 158);
      ctx.font = F_SMALL;
      ctx.fillStyle = '#8a7a98';
      ctx.fillText('感谢游玩 · 按 确认 返回标题', VIEW_W / 2, 190);
    }
    ctx.textAlign = 'left';
  }
}
