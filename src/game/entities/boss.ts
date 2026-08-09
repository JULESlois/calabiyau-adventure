import { GRAVITY, TILE } from '../constants';
import type { Rect } from '../utils';
import { clamp } from '../utils';
import type { WorldApi } from '../types';

type BossState =
  | 'dormant'
  | 'intro'
  | 'idle'
  | 'slamTele'
  | 'slamAir'
  | 'fan'
  | 'chargeTele'
  | 'charge'
  | 'stunned'
  | 'ring'
  | 'dying'
  | 'dead';

export class Boss {
  readonly kind = 'guardian' as const;
  readonly displayName = '守望者 MK-III';
  readonly phases = 3;
  readonly contactDmg = 18;
  x: number;
  y: number; // 脚底中心
  w = 44;
  h = 44;
  hp = 900;
  maxHp = 900;
  state: BossState = 'dormant';
  stateT = 0;
  vx = 0;
  vy = 0;
  facing = -1;
  hurtT = 0;
  attackCd = 1.2;
  volleys = 0;
  summonT = 6;
  deathT = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  get phase(): number {
    const r = this.hp / this.maxHp;
    return r > 0.66 ? 1 : r > 0.33 ? 2 : 3;
  }

  rect(): Rect {
    return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h };
  }

  get active(): boolean {
    return this.state !== 'dormant' && this.state !== 'dead' && this.state !== 'dying';
  }

  awaken(w: WorldApi): void {
    if (this.state !== 'dormant') return;
    this.state = 'intro';
    this.stateT = 2.0;
    w.sfx('bossRoar');
    w.shake(6);
  }

  hit(dmg: number, w: WorldApi): void {
    if (this.state === 'dormant' || this.state === 'dying' || this.state === 'dead') return;
    const mult = this.state === 'stunned' ? 2 : 1;
    this.hp -= dmg * mult;
    this.hurtT = 0.1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'dying';
      this.stateT = 2.6;
      this.deathT = 0;
      w.shake(8);
      w.sfx('explosion');
    }
  }

  update(dt: number, w: WorldApi): void {
    if (this.state === 'dormant' || this.state === 'dead') return;
    this.stateT -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    const px = w.playerX;
    const groundY = this.groundY(w);

    switch (this.state) {
      case 'intro':
        if (this.stateT <= 0) this.enterIdle();
        break;

      case 'idle': {
        this.facing = px > this.x ? 1 : -1;
        // 缓步逼近
        this.x += this.facing * 26 * dt;
        this.x = clamp(this.x, 30, w.mapW - 30);
        this.attackCd -= dt;
        this.summonT -= dt;
        if (this.phase >= 2 && this.summonT <= 0) {
          this.summonT = 11;
          w.spawnEnemy('drone', this.x - this.facing * 30, this.y - 60);
          w.sfx('switch');
        }
        if (this.attackCd <= 0) this.pickAttack(w);
        break;
      }

      case 'slamTele':
        if (this.stateT <= 0) {
          this.state = 'slamAir';
          this.vy = -400;
          this.vx = clamp((px - this.x) * 1.6, -220, 220);
          w.sfx('jump');
        }
        break;

      case 'slamAir': {
        this.vy += GRAVITY * 1.1 * dt;
        this.x = clamp(this.x + this.vx * dt, 26, w.mapW - 26);
        this.y += this.vy * dt;
        if (this.vy > 0 && this.y >= groundY) {
          this.y = groundY;
          this.vy = 0;
          // 落地冲击波:沿地面双向
          const wy = this.y - 5;
          w.fireEnemyBullet(this.x - 20, wy, -170, 0, 14, '#ffd75e', 5);
          w.fireEnemyBullet(this.x + 20, wy, 170, 0, 14, '#ffd75e', 5);
          if (this.phase >= 3) {
            w.fireEnemyBullet(this.x - 20, wy - 3, -120, 0, 12, '#ff8a5c', 4);
            w.fireEnemyBullet(this.x + 20, wy - 3, 120, 0, 12, '#ff8a5c', 4);
          }
          w.shake(7);
          w.sfx('explosion');
          w.particles.burst(this.x, this.y, 24, '#c8b090', 130, 0.6, 'square', 300);
          this.enterIdle();
        }
        break;
      }

      case 'fan': {
        this.facing = px > this.x ? 1 : -1;
        if (this.stateT <= 0) {
          const cx = this.x + this.facing * 18;
          const cy = this.y - 26;
          const base = Math.atan2(w.playerY - cy, px - cx);
          for (let i = -2; i <= 2; i++) {
            const a = base + i * 0.16;
            w.fireEnemyBullet(cx, cy, Math.cos(a) * 140, Math.sin(a) * 140, 9, '#ff6a6a');
          }
          w.sfx('shootIce');
          this.volleys--;
          this.stateT = 0.55;
          if (this.volleys <= 0) this.enterIdle();
        }
        break;
      }

      case 'chargeTele':
        this.facing = px > this.x ? 1 : -1;
        if (this.stateT <= 0) {
          this.state = 'charge';
          this.vx = this.facing * 275;
          w.sfx('bossRoar');
        }
        break;

      case 'charge': {
        this.x += this.vx * dt;
        w.particles.burst(this.x - this.facing * 20, this.y - 6, 2, '#8a93b8', 60, 0.3);
        if (this.x <= 28 || this.x >= w.mapW - 28) {
          this.x = clamp(this.x, 28, w.mapW - 28);
          this.state = 'stunned';
          this.stateT = 1.7;
          w.shake(9);
          w.sfx('explosion');
          w.particles.burst(this.x + this.facing * 20, this.y - 24, 20, '#ffd75e', 140, 0.7);
        }
        break;
      }

      case 'stunned':
        if (this.stateT <= 0) this.enterIdle();
        break;

      case 'ring': {
        if (this.stateT <= 0) {
          const n = 12;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + (this.volleys % 2) * (Math.PI / n);
            w.fireEnemyBullet(this.x, this.y - 24, Math.cos(a) * 110, Math.sin(a) * 110, 9, '#c47eff');
          }
          w.sfx('shootNote');
          this.volleys--;
          this.stateT = 0.8;
          if (this.volleys <= 0) this.enterIdle();
        }
        break;
      }

      case 'dying': {
        this.deathT += dt;
        if (Math.random() < 0.3) {
          w.particles.burst(
            this.x + (Math.random() - 0.5) * 40,
            this.y - Math.random() * 44,
            8,
            Math.random() < 0.5 ? '#ffd75e' : '#ff6a6a',
            120,
            0.6,
          );
          if (Math.random() < 0.4) w.sfx('explosion');
        }
        if (this.stateT <= 0) {
          this.state = 'dead';
          w.shake(10);
          w.sfx('explosion');
          w.particles.burst(this.x, this.y - 22, 60, '#ffe9a8', 220, 1.2);
        }
        break;
      }

      default:
        break;
    }
  }

  private enterIdle(): void {
    this.state = 'idle';
    this.attackCd = this.phase === 3 ? 0.7 : this.phase === 2 ? 1.0 : 1.3;
  }

  private pickAttack(w: WorldApi): void {
    const px = w.playerX;
    const dx = Math.abs(px - this.x);
    const roll = Math.random();
    if (this.phase >= 3 && roll < 0.3) {
      this.state = 'ring';
      this.volleys = 2;
      this.stateT = 0.3;
    } else if (this.phase >= 2 && roll < 0.55 && dx > 60) {
      this.state = 'chargeTele';
      this.stateT = 0.55;
    } else if (dx < 120 || roll < 0.75) {
      this.state = 'slamTele';
      this.stateT = 0.5;
    } else {
      this.state = 'fan';
      this.volleys = 3;
      this.stateT = 0.3;
    }
  }

  private groundY(w: WorldApi): number {
    // 简化:Boss 战场地面固定在地图底部往上 3 tile
    return w.mapH - 3 * TILE;
  }

  render(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.state === 'dead') return;
    ctx.save();
    ctx.translate(Math.round(this.x), Math.round(this.y));
    if (this.hurtT > 0) ctx.globalAlpha = 0.6;

    const f = this.facing;
    const telegraphing = this.state === 'slamTele' || this.state === 'chargeTele';
    const flash = telegraphing && Math.floor(time * 12) % 2 === 0;
    const bodyC = flash ? '#7a3446' : '#3c3448';
    const bodyHi = flash ? '#9a4a5c' : '#5a5270';
    const darkC = flash ? '#5a2434' : '#241f30';
    const P = (x: number, y: number, w2: number, h2: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w2, h2);
    };

    const crouch = this.state === 'slamTele' ? 4 : 0;

    // 冲撞拖影
    if (this.state === 'charge') {
      ctx.globalAlpha = 0.25;
      P(-16 - f * 14, -36, 32, 24, bodyC);
      ctx.globalAlpha = 0.12;
      P(-16 - f * 26, -34, 32, 20, bodyC);
      ctx.globalAlpha = 1;
    }

    // 腿
    P(-18, -14 + crouch, 8, 14 - crouch, darkC);
    P(10, -14 + crouch, 8, 14 - crouch, darkC);
    P(-18, -14 + crouch, 8, 1, bodyHi);
    P(10, -14 + crouch, 8, 1, bodyHi);
    P(-20, -4, 12, 4, '#16121e');
    P(8, -4, 12, 4, '#16121e');
    // 躯干
    P(-16, -36 + crouch, 32, 24, bodyC);
    P(-16, -36 + crouch, 32, 2, bodyHi);
    P(-16, -18 + crouch, 32, 3, darkC);
    // 装甲铆钉
    P(-13, -33 + crouch, 2, 2, bodyHi);
    P(11, -33 + crouch, 2, 2, bodyHi);
    // 肩炮 + 警示条纹
    P(-24, -40 + crouch, 10, 10, darkC);
    P(14, -40 + crouch, 10, 10, darkC);
    for (let i = 0; i < 4; i++) {
      P(-23 + i * 2, -32 + crouch, 2, 2, i % 2 === 0 ? '#c8a03c' : '#16121e');
      P(15 + i * 2, -32 + crouch, 2, 2, i % 2 === 0 ? '#c8a03c' : '#16121e');
    }
    P(-22, -43 + crouch, 4, 4, '#6a6480');
    P(18, -43 + crouch, 4, 4, '#6a6480');
    // 头部/面甲
    P(-8, -46 + crouch, 16, 10, bodyC);
    P(-8, -46 + crouch, 16, 1, bodyHi);
    P(-6 + f * 2, -43 + crouch, 12, 3, this.state === 'stunned' ? '#ffd75e' : '#ff3d5c');
    P(-6 + f * 2, -43 + crouch, 12, 1, this.state === 'stunned' ? '#fff0c0' : '#ff8a9a');

    // 核心(辉光)
    const stunned = this.state === 'stunned';
    const coreGlow = stunned ? 0.9 : 0.5 + Math.sin(time * 5) * 0.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = coreGlow * 0.3;
    ctx.fillStyle = stunned ? '#ffe9a8' : '#7ef0ff';
    ctx.beginPath();
    ctx.arc(0, -26 + crouch, stunned ? 13 : 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = coreGlow;
    P(-4, -30 + crouch, 8, 8, stunned ? '#ffe9a8' : '#7ef0ff');
    ctx.globalAlpha = 1;
    P(-2, -28 + crouch, 4, 4, '#ffffff');

    // 眩晕星星
    if (stunned) {
      for (let i = 0; i < 3; i++) {
        const a = time * 4 + (i * Math.PI * 2) / 3;
        const sx2 = Math.cos(a) * 14;
        const sy2 = -52 + Math.sin(a) * 4;
        P(Math.round(sx2) - 1, Math.round(sy2), 3, 1, '#ffd75e');
        P(Math.round(sx2), Math.round(sy2) - 1, 1, 3, '#ffd75e');
      }
    }

    ctx.restore();
  }
}
