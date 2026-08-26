import { TILE } from '../constants';
import type { Rect } from '../utils';
import { clamp } from '../utils';
import type { WorldApi } from '../types';

type GambitState = 'dormant' | 'intro' | 'idle' | 'castle' | 'dying' | 'dead';

interface Decoy {
  x: number;
  y: number;
  hp: number;
  fireT: number;
}

/** 假身一击即碎的血量:它们是信息资源,不是血牛。 */
const DECOY_HP = 12;
/** 王车易位的行程时长 */
const CASTLE_TIME = 0.38;

/**
 * 「王车棋士」——天穹 · 星弈厅的可选 Boss(#64 王车迷局)。
 * 它不靠弹幕密度,而把「场上哪个是本体、下一次本体在哪」做成核心读招:
 * - 五枚牌位锚点固定在场地上,本体与两具假身落位其中。
 * - 假身外形相同但没有王冠辉光与核心脉动;命中即碎(不掉 Boss 血),
 *   碎裂会短暂减少场上火力 —— 打假身不亏,是主动获取信息的手段。
 * - 本体受创累积或计时到点便发动「王车易位」:与一具假身换位,
 *   换位轨迹是一条清晰的牌光流 —— 目的地永远看得见、可学习,不是猜杯子。
 * - 半血后易位更频繁、牌雨更密,考验的是持续追踪而不是反应。
 */
export class Gambit {
  readonly kind = 'gambit' as const;
  readonly displayName = '王车棋士';
  readonly phases = 2;
  readonly contactDmg = 12;
  x: number;
  y: number; // 脚底中心(本体)
  w = 26;
  h = 34;
  hp = 500;
  maxHp = 500;
  state: GambitState = 'dormant';
  stateT = 0;
  facing = -1;
  hurtT = 0;
  /** 牌位锚点(awaken 时按场宽铺开) */
  anchors: { x: number; y: number }[] = [];
  decoys: Decoy[] = [];
  /** 自上次易位以来吃到的伤害;够了就换 */
  damageSinceCastle = 0;
  castleCdT = 8;
  fireT = 1.2;
  /** 易位轨迹(渲染 + 教学信息) */
  trail: { fromX: number; toX: number; y: number; t: number } | null = null;
  castleFromX = 0;
  castleToX = 0;
  deathT = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  get phase(): number {
    return this.hp / this.maxHp > 0.5 ? 1 : 2;
  }

  rect(): Rect {
    return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h };
  }

  get active(): boolean {
    return this.state !== 'dormant' && this.state !== 'dying' && this.state !== 'dead';
  }

  /** 易位行程中本体化为牌光,不可触碰。 */
  get intangible(): boolean {
    return this.state === 'castle';
  }

  /** 假身的受击盒;PlayState 的子弹/近战循环据此结算。 */
  decoyRects(): Rect[] {
    return this.decoys.map((d) => ({ x: d.x - this.w / 2, y: d.y - this.h, w: this.w, h: this.h }));
  }

  hitDecoy(index: number, w: WorldApi): void {
    const decoy = this.decoys[index];
    if (!decoy) return;
    decoy.hp = 0;
    this.decoys.splice(index, 1);
    // 碎成一蓬牌屑:明确告诉玩家"这是假的",且火力随之变薄。
    w.sfx('paperOff');
    w.particles.burst(decoy.x, decoy.y - this.h / 2, 16, '#e8d8a8', 110, 0.5, 'paper');
  }

  awaken(w: WorldApi): void {
    if (this.state !== 'dormant') return;
    // 五枚锚点按场宽铺开;y 固定在地面。
    const groundY = w.mapH - 3 * TILE;
    this.anchors = [0.14, 0.32, 0.5, 0.68, 0.86].map((f) => ({
      x: clamp(f * w.mapW, 30, w.mapW - 30),
      y: groundY,
    }));
    this.state = 'intro';
    this.stateT = 1.5;
    // 开局发牌:本体居中,假身在两翼。
    this.x = this.anchors[2].x;
    this.y = groundY;
    this.dealDecoys(w);
    w.sfx('bossRoar');
    w.shake(5);
  }

  hit(dmg: number, w: WorldApi): void {
    if (this.state === 'dormant' || this.state === 'dying' || this.state === 'dead') return;
    if (this.intangible) return;
    this.hp -= dmg;
    this.hurtT = 0.1;
    this.damageSinceCastle += dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'dying';
      this.stateT = 2.2;
      this.deathT = 0;
      this.decoys = [];
      w.shake(8);
      w.sfx('explosion');
    }
  }

  update(dt: number, w: WorldApi): void {
    if (this.state === 'dormant' || this.state === 'dead') return;
    this.stateT -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.trail) {
      this.trail.t -= dt;
      if (this.trail.t <= 0) this.trail = null;
    }
    const px = w.playerX;
    const py = w.playerY;

    switch (this.state) {
      case 'intro':
        if (this.stateT <= 0) this.enterIdle();
        break;

      case 'idle': {
        this.facing = px > this.x ? 1 : -1;
        this.castleCdT -= dt;
        // 本体牌扇:三张追踪牌
        this.fireT -= dt;
        if (this.fireT <= 0) {
          const base = Math.atan2(py - (this.y - this.h * 0.7), px - this.x);
          for (let i = -1; i <= 1; i++) {
            const a = base + i * 0.18;
            w.fireEnemyBullet(
              this.x + Math.cos(a) * 10, this.y - this.h * 0.7 + Math.sin(a) * 10,
              Math.cos(a) * 135, Math.sin(a) * 135, 9, '#e8d8a8', 3,
            );
          }
          w.sfx('shootNote');
          this.fireT = this.phase === 2 ? 1.35 : 1.8;
        }
        // 假身冷牌:慢速单发,火力薄但方向多
        for (const decoy of this.decoys) {
          decoy.fireT -= dt;
          if (decoy.fireT <= 0) {
            const a = Math.atan2(py - (decoy.y - this.h * 0.7), px - decoy.x);
            w.fireEnemyBullet(
              decoy.x + Math.cos(a) * 10, decoy.y - this.h * 0.7 + Math.sin(a) * 10,
              Math.cos(a) * 105, Math.sin(a) * 105, 8, '#b8accc', 2.5,
            );
            decoy.fireT = this.phase === 2 ? 2.0 : 2.6;
          }
        }
        // 王车易位:受创累积或计时到点
        if (this.damageSinceCastle >= 60 || this.castleCdT <= 0) this.startCastle(w);
        break;
      }

      case 'castle': {
        const t = 1 - Math.max(0, this.stateT) / CASTLE_TIME;
        const ease = t * t * (3 - 2 * t);
        this.x = this.castleFromX + (this.castleToX - this.castleFromX) * ease;
        if (Math.random() < 0.6) {
          w.particles.spawn({
            x: this.x, y: this.y - this.h / 2 + (Math.random() - 0.5) * 24,
            vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
            life: 0.25, color: '#e8d8a8', shape: 'paper', size: 1,
          });
        }
        if (this.stateT <= 0) {
          this.x = this.castleToX;
          this.enterIdle();
        }
        break;
      }

      case 'dying': {
        this.deathT += dt;
        if (Math.random() < 0.3) {
          w.particles.burst(
            this.x + (Math.random() - 0.5) * 30, this.y - Math.random() * this.h,
            8, Math.random() < 0.5 ? '#e8d8a8' : '#c8a050', 110, 0.6, 'paper',
          );
        }
        if (this.stateT <= 0) {
          this.state = 'dead';
          w.shake(9);
          w.sfx('explosion');
          w.particles.burst(this.x, this.y - 18, 50, '#f0e8d0', 200, 1.1, 'paper');
        }
        break;
      }

      default:
        break;
    }
  }

  private enterIdle(): void {
    this.state = 'idle';
  }

  /** 在未被占用的锚点补齐两具假身。 */
  private dealDecoys(w: WorldApi): void {
    const free = this.anchors.filter(
      (anchor) => Math.abs(anchor.x - this.x) > 20 && !this.decoys.some((d) => Math.abs(d.x - anchor.x) < 20),
    );
    while (this.decoys.length < 2 && free.length > 0) {
      const idx = Math.floor(Math.random() * free.length);
      const anchor = free.splice(idx, 1)[0];
      this.decoys.push({ x: anchor.x, y: anchor.y, hp: DECOY_HP, fireT: 1.4 + Math.random() });
      w.particles.burst(anchor.x, anchor.y - this.h / 2, 10, '#b8accc', 80, 0.4, 'paper');
    }
  }

  /**
   * 王车易位:与一具存活假身换位;假身被全部击碎时重新发牌再换。
   * 轨迹保留 0.6 秒 —— 目的地必须是玩家看得见、学得会的信息。
   */
  private startCastle(w: WorldApi): void {
    this.damageSinceCastle = 0;
    this.castleCdT = this.phase === 2 ? 5.5 : 8;
    if (this.decoys.length === 0) this.dealDecoys(w);
    this.castleFromX = this.x;
    if (this.decoys.length > 0) {
      const idx = Math.floor(Math.random() * this.decoys.length);
      const partner = this.decoys[idx];
      this.castleToX = partner.x;
      partner.x = this.castleFromX; // 真正的"易位":假身来到本体的旧位
    } else {
      const anchor = this.anchors[Math.floor(Math.random() * this.anchors.length)];
      this.castleToX = anchor.x;
    }
    this.trail = { fromX: this.castleFromX, toX: this.castleToX, y: this.y - this.h / 2, t: 0.6 };
    this.state = 'castle';
    this.stateT = CASTLE_TIME;
    w.sfx('paperOn');
  }

  render(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.state === 'dead') return;

    // 牌位锚点:地面淡金刻痕,玩家据此预判易位落点。
    for (const anchor of this.anchors) {
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.15 * Math.abs(Math.sin(time * 2 + anchor.x));
      ctx.strokeStyle = '#c8a050';
      ctx.strokeRect(anchor.x - 7, anchor.y - 3, 14, 3);
      ctx.restore();
    }

    // 易位轨迹:牌光流,0.6 秒内可读
    if (this.trail) {
      ctx.save();
      ctx.globalAlpha = clamp(this.trail.t / 0.6, 0, 1) * 0.7;
      ctx.strokeStyle = '#ffe9a8';
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(Math.round(this.trail.fromX), Math.round(this.trail.y));
      ctx.lineTo(Math.round(this.trail.toX), Math.round(this.trail.y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 假身:同形,但无王冠辉光、核心不脉动 —— 这是稳定可学的辨识差。
    for (const decoy of this.decoys) {
      this.paintBody(ctx, decoy.x, decoy.y, time, false);
    }

    if (this.state === 'castle') {
      // 易位行程:本体压成一道牌光
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#ffe9a8';
      ctx.fillRect(Math.round(this.x) - 12, Math.round(this.y) - 22, 24, 3);
      ctx.restore();
      return;
    }
    this.paintBody(ctx, this.x, this.y, time, true);
  }

  private paintBody(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, real: boolean): void {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (!real) ctx.globalAlpha = 0.82;
    else if (this.hurtT > 0) ctx.globalAlpha = 0.6;
    const f = this.facing;
    const P = (px: number, py: number, w2: number, h2: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(px, py, w2, h2);
    };
    // 长袍棋士
    P(-9, -28, 18, 24, '#2c2434');
    P(-9, -28, 18, 2, '#5a4a68');
    P(-11, -10, 22, 6, '#1c1626');
    // 头
    P(-5, -34, 11, 7, '#2c2434');
    P(-3 + f * 2, -32, 6, 2, real ? '#ffe9a8' : '#8a7a98');
    // 手中牌扇
    for (let i = 0; i < 3; i++) {
      P(6 * f + i * 2 * f, -20 - i, 4, 6, i % 2 === 0 ? '#e8d8a8' : '#c8b888');
    }
    if (real) {
      // 王冠辉光 + 核心脉动:只有本体有。
      const glint = 0.5 + 0.5 * Math.abs(Math.sin(time * 3));
      ctx.globalAlpha = glint;
      P(-4, -38, 9, 3, '#ffe9a8');
      P(-2, -40, 2, 2, '#fff4d0');
      P(3, -40, 2, 2, '#fff4d0');
      ctx.globalAlpha = 1;
      const pulse = 0.45 + Math.sin(time * 4) * 0.2;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = pulse * 0.4;
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(0, -18, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      P(-2, -20, 4, 4, '#ffe9a8');
    } else {
      // 假身:王冠位置是哑光的
      P(-4, -38, 9, 3, '#5a4a68');
    }
    ctx.restore();
  }
}
