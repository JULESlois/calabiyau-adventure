// 角色部署物:米雪儿的「喵喵卫士」猫炮塔、香奈美的「旋律回响」声呐镖。
import { makeTurretBolt } from './bullets';
import type { PlayState } from '../states/PlayState';

export const TURRET_LIFE = 10; // 秒
export const TURRET_RANGE = 150;

/** 喵喵卫士:落地猫形炮塔,自动索敌射击(命中减速) */
export class CatTurret {
  t = TURRET_LIFE;
  fireT = 0.5;
  earPh = Math.random() * Math.PI * 2;
  facing = 1;

  constructor(
    public x: number,
    public y: number, // 脚底
  ) {}

  get dead(): boolean {
    return this.t <= 0;
  }

  update(dt: number, ps: PlayState): void {
    this.t -= dt;
    this.fireT -= dt;
    if (this.fireT > 0) return;

    // 索敌:最近的存活敌人,否则 Boss
    let tx = 0;
    let ty = 0;
    let best = TURRET_RANGE;
    let found = false;
    for (const e of ps.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - this.x, e.y - e.h / 2 - (this.y - 10));
      if (d < best) {
        best = d;
        tx = e.x;
        ty = e.y - e.h / 2;
        found = true;
      }
    }
    if (!found && ps.boss && ps.boss.active) {
      const d = Math.hypot(ps.boss.x - this.x, ps.boss.y - 24 - (this.y - 10));
      if (d < TURRET_RANGE) {
        tx = ps.boss.x;
        ty = ps.boss.y - 24;
        found = true;
      }
    }
    if (!found) return;

    const a = Math.atan2(ty - (this.y - 10), tx - this.x);
    this.facing = tx >= this.x ? 1 : -1;
    ps.playerBullets.push(makeTurretBolt(this.x + Math.cos(a) * 8, this.y - 10 + Math.sin(a) * 8, a));
    ps.sfx('shootIce');
    ps.particles.burst(this.x + Math.cos(a) * 9, this.y - 10 + Math.sin(a) * 9, 2, '#8fd7ff', 30, 0.15);
    this.fireT = 0.8;
  }

  render(ctx: CanvasRenderingContext2D, time: number): void {
    const bx = Math.round(this.x);
    const by = Math.round(this.y);
    const blink = this.t < 2 && Math.floor(time * 8) % 2 === 0; // 即将消失闪烁
    if (blink) ctx.globalAlpha = 0.5;
    const f = this.facing;
    // 底座
    ctx.fillStyle = '#1c3050';
    ctx.fillRect(bx - 6, by - 3, 12, 3);
    ctx.fillStyle = '#3a5474';
    ctx.fillRect(bx - 5, by - 4, 10, 1);
    // 猫身
    ctx.fillStyle = '#7ec4ee';
    ctx.fillRect(bx - 5, by - 12, 10, 9);
    ctx.fillStyle = '#c2e8ff';
    ctx.fillRect(bx - 5, by - 12, 10, 1);
    // 猫耳(轻轻抽动)
    const tw = Math.sin(time * 5 + this.earPh) > 0.86 ? 1 : 0;
    ctx.fillStyle = '#7ec4ee';
    ctx.fillRect(bx - 5, by - 15 - tw, 3, 3 + tw);
    ctx.fillRect(bx + 2, by - 15, 3, 3);
    ctx.fillStyle = '#f0a0c8';
    ctx.fillRect(bx - 4, by - 14 - tw, 1, 1);
    ctx.fillRect(bx + 3, by - 14, 1, 1);
    // 眼(发光)+ 炮口
    ctx.fillStyle = '#fff2c0';
    ctx.fillRect(bx - 3 + (f > 0 ? 1 : 0), by - 10, 2, 2);
    ctx.fillRect(bx + 1 + (f > 0 ? 1 : 0), by - 10, 2, 2);
    ctx.fillStyle = '#1c3050';
    ctx.fillRect(bx + f * 5, by - 8, 2, 2);
    ctx.globalAlpha = 1;
  }
}

export const DART_LIFE = 6; // 秒
export const DART_PULSE = 1.2;
export const SONAR_R = 60;

/** 旋律回响:掷出的声呐镖,钉附后周期释放声波(显形+微伤+为附近的香奈美回复) */
export class SonarDart {
  stuck = false;
  t = DART_LIFE;
  pulseT = 0.2;
  ringT = 0; // 最近一次脉冲的扩散动画

  constructor(
    public x: number,
    public y: number,
    public vx: number,
    public vy: number,
  ) {}

  get dead(): boolean {
    return this.t <= 0;
  }

  update(dt: number, ps: PlayState): void {
    this.t -= dt;
    this.ringT = Math.max(0, this.ringT - dt);
    if (!this.stuck) {
      this.vy += 700 * dt;
      const nx = this.x + this.vx * dt;
      const ny = this.y + this.vy * dt;
      if (ps.rectHitsSolid({ x: nx - 2, y: ny - 2, w: 4, h: 4 })) {
        this.stuck = true; // 钉附
        ps.sfx('shootNote');
      } else {
        this.x = nx;
        this.y = ny;
        if (this.y > ps.mapH + 20) this.t = 0;
      }
    }
    this.pulseT -= dt;
    if (this.stuck && this.pulseT <= 0) {
      this.pulseT = DART_PULSE;
      this.ringT = 0.4;
      ps.sonarPulse(this.x, this.y, SONAR_R, true);
    }
  }

  render(ctx: CanvasRenderingContext2D, time: number): void {
    const bx = Math.round(this.x);
    const by = Math.round(this.y);
    // 扩散声环
    if (this.ringT > 0) {
      const p = 1 - this.ringT / 0.4;
      ctx.globalAlpha = 0.5 * (1 - p);
      ctx.strokeStyle = '#ffb0d8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bx, by, SONAR_R * p, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 音符镖本体
    const bob = this.stuck ? Math.sin(time * 4) * 1 : 0;
    ctx.fillStyle = '#ff5fa8';
    ctx.fillRect(bx - 2, by - 2 + bob, 4, 4);
    ctx.fillStyle = '#ffd0e4';
    ctx.fillRect(bx - 2, by - 2 + bob, 4, 1);
    ctx.fillStyle = '#ffb0d8';
    ctx.fillRect(bx + 2, by - 5 + bob, 1, 4);
    ctx.fillRect(bx + 1, by - 5 + bob, 2, 1);
  }
}
