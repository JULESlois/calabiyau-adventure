import { GRAVITY, MAX_FALL } from '../constants';
import type { Rect } from '../utils';
import { clamp, dist } from '../utils';
import type { WorldApi } from '../types';
import { drawEnemy } from '../render/sprites';

export type EnemyKind = 'patrol' | 'drone' | 'turret' | 'shield' | 'exploder' | 'slasher';

const STATS: Record<EnemyKind, { hp: number; contact: number; w: number; h: number }> = {
  patrol: { hp: 30, contact: 10, w: 14, h: 12 },
  drone: { hp: 20, contact: 8, w: 12, h: 10 },
  turret: { hp: 45, contact: 8, w: 16, h: 12 },
  shield: { hp: 60, contact: 14, w: 14, h: 18 },
  exploder: { hp: 26, contact: 10, w: 15, h: 13 },
  slasher: { hp: 34, contact: 14, w: 13, h: 12 },
};

export class Enemy {
  kind: EnemyKind;
  x: number; // 脚底中心
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  contactDmg: number;
  dir = -1;
  vy = 0;
  frozen = 0;
  hurtT = 0;
  shootT = 1 + Math.random();
  burstLeft = 0;
  burstT = 0;
  aimAngle = 0;
  /** 被「猫踪喵迹」/声呐标记的剩余时间(受伤 +30%,轮廓高亮) */
  markT = 0;
  homeY: number;
  dead = false;
  /** Boss 召唤的小怪标记 */
  summoned = false;
  /** 爆裂魔怪:引信(<0 未点燃) */
  fuseT = -1;
  /** 刺镰魔怪:0 徘徊 / >0 蓄力 / <0 突刺剩余 */
  lungeT = 0;
  recoverT = 0;

  constructor(kind: EnemyKind, x: number, y: number) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.homeY = y;
    const s = STATS[kind];
    this.w = s.w;
    this.h = s.h;
    this.hp = s.hp;
    this.maxHp = s.hp;
    this.contactDmg = s.contact;
  }

  rect(): Rect {
    return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h };
  }

  /** 盾卫的盾是否挡住来自 fromDir 方向的攻击(fromDir: 攻击行进方向) */
  blocksShot(bulletVx: number): boolean {
    if (this.kind !== 'shield') return false;
    // 盾在面朝方向:子弹迎面而来(与朝向相反)则被挡
    return Math.sign(-bulletVx) === Math.sign(this.dir) && bulletVx !== 0;
  }

  hit(dmg: number, freeze: number, _w: WorldApi): void {
    if (this.markT > 0) dmg *= 1.3;
    this.hp -= dmg;
    this.hurtT = 0.12;
    if (freeze > 0) this.frozen = Math.max(this.frozen, freeze);
    if (this.hp <= 0) this.dead = true;
  }

  update(dt: number, w: WorldApi): void {
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.markT > 0) this.markT -= dt;
    if (this.frozen > 0) {
      this.frozen -= dt;
      // 冻结时仍受重力(地面型)
      if (this.kind === 'patrol' || this.kind === 'shield') this.applyGravity(dt, w);
      return;
    }

    const px = w.playerX;
    const py = w.playerY;
    const d = dist(this.x, this.y - this.h / 2, px, py);

    switch (this.kind) {
      case 'patrol': {
        const speed = 34;
        this.x += this.dir * speed * dt;
        // 碰壁或临崖回头
        const front: Rect = {
          x: this.x + this.dir * (this.w / 2 + 1) - 1,
          y: this.y - this.h + 2,
          w: 2,
          h: this.h - 4,
        };
        if (w.rectHitsSolid(front) || !w.hasGroundAt(this.x + this.dir * (this.w / 2 + 3), this.y + 2)) {
          this.dir *= -1;
        }
        this.applyGravity(dt, w);
        // 偶尔射击
        this.shootT -= dt;
        if (this.shootT <= 0 && d < 150 && Math.abs(py - (this.y - this.h / 2)) < 40 && !w.playerPaper) {
          this.dir = px > this.x ? 1 : -1;
          const vx = this.dir * 130;
          w.fireEnemyBullet(this.x + this.dir * 8, this.y - this.h + 3, vx, 0, 8, '#ff8a5c', 2.5, this);
          w.sfx('shootIce');
          this.shootT = 2.4 + Math.random();
        }
        break;
      }
      case 'drone': {
        // 悬浮追踪
        const targetY = py - 34;
        this.y += clamp(targetY - this.y, -46 * dt, 46 * dt);
        const dx = px - this.x;
        if (Math.abs(dx) > 60) this.x += Math.sign(dx) * 40 * dt;
        else if (Math.abs(dx) < 30) this.x -= Math.sign(dx) * 30 * dt;
        this.dir = dx > 0 ? 1 : -1;
        this.shootT -= dt;
        if (this.shootT <= 0 && d < 190 && !w.playerPaper) {
          const a = Math.atan2(py - (this.y - this.h / 2), px - this.x);
          w.fireEnemyBullet(this.x, this.y - this.h / 2, Math.cos(a) * 120, Math.sin(a) * 120, 8, '#ffb85c', 2.5, this);
          w.sfx('shootNote');
          this.shootT = 2.3 + Math.random() * 0.6;
        }
        break;
      }
      case 'turret': {
        this.aimAngle = Math.atan2(py - (this.y - 8), px - this.x);
        // 让炮管朝向不至于翻转怪异
        this.dir = px > this.x ? 1 : -1;
        this.shootT -= dt;
        if (this.burstLeft > 0) {
          this.burstT -= dt;
          if (this.burstT <= 0) {
            this.burstLeft--;
            this.burstT = 0.16;
            const a = this.aimAngle;
            w.fireEnemyBullet(
              this.x + Math.cos(a) * 10,
              this.y - 8 + Math.sin(a) * 10,
              Math.cos(a) * 150,
              Math.sin(a) * 150,
              9,
              '#ff6a6a',
              2.5,
              this,
            );
            w.sfx('shootIce');
          }
        } else if (this.shootT <= 0 && d < 200 && !w.playerPaper) {
          this.burstLeft = 3;
          this.burstT = 0;
          this.shootT = 2.8;
        }
        break;
      }
      case 'exploder': {
        // 晶源体·爆裂魔怪:爬向玩家,近身点燃引信自爆
        if (this.fuseT >= 0) {
          this.fuseT -= dt;
          this.hurtT = Math.max(this.hurtT, 0.05); // 引信闪烁
          if (this.fuseT <= 0) {
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              w.fireEnemyBullet(this.x, this.y - 6, Math.cos(a) * 130, Math.sin(a) * 130, 10, '#ff5a4a', 3, this);
            }
            w.sfx('explosion');
            w.shake(4);
            w.particles.burst(this.x, this.y - 6, 20, '#c44a9a', 140, 0.6);
            this.dead = true;
          }
          break;
        }
        if (d < 150 && !w.playerPaper) {
          this.dir = px > this.x ? 1 : -1;
          const front: Rect = {
            x: this.x + this.dir * (this.w / 2 + 1) - 1,
            y: this.y - this.h + 2,
            w: 2,
            h: this.h - 4,
          };
          if (!w.rectHitsSolid(front) && w.hasGroundAt(this.x + this.dir * (this.w / 2 + 3), this.y + 2)) {
            this.x += this.dir * 42 * dt;
          }
        }
        this.applyGravity(dt, w);
        if (d < 30) {
          this.fuseT = 0.7; // 点燃
          w.sfx('bossRoar');
        }
        break;
      }
      case 'slasher': {
        // 晶源体·刺镰魔怪:蓄力后高速突刺
        this.applyGravity(dt, w);
        if (this.recoverT > 0) {
          this.recoverT -= dt;
          break;
        }
        if (this.lungeT > 0) {
          // 蓄力(压低起手)
          this.lungeT -= dt;
          if (this.lungeT <= 0) this.lungeT = -0.32; // 转入突刺
          break;
        }
        if (this.lungeT < 0) {
          // 突刺
          this.lungeT += dt;
          const front: Rect = {
            x: this.x + this.dir * (this.w / 2 + 2) - 1,
            y: this.y - this.h + 2,
            w: 2,
            h: this.h - 4,
          };
          if (!w.rectHitsSolid(front)) {
            this.x += this.dir * 250 * dt;
          } else {
            this.lungeT = 0;
          }
          if (this.lungeT >= 0) {
            this.lungeT = 0;
            this.recoverT = 0.8;
          }
          break;
        }
        // 徘徊/索敌
        if (d < 130 && Math.abs(py - (this.y - this.h / 2)) < 34 && !w.playerPaper) {
          this.dir = px > this.x ? 1 : -1;
          this.lungeT = 0.45; // 蓄力
          w.sfx('melee');
        }
        break;
      }
      case 'shield': {
        const dx = px - this.x;
        if (Math.abs(dx) < 170) this.dir = dx > 0 ? 1 : -1;
        const speed = 22;
        const front: Rect = {
          x: this.x + this.dir * (this.w / 2 + 3) - 1,
          y: this.y - this.h + 2,
          w: 2,
          h: this.h - 4,
        };
        if (!w.rectHitsSolid(front) && w.hasGroundAt(this.x + this.dir * (this.w / 2 + 4), this.y + 2)) {
          this.x += this.dir * speed * dt;
        }
        this.applyGravity(dt, w);
        break;
      }
      default:
        break;
    }
  }

  private applyGravity(dt: number, w: WorldApi): void {
    this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);
    let ny = this.y + this.vy * dt;
    const r: Rect = { x: this.x - this.w / 2, y: ny - this.h, w: this.w, h: this.h };
    if (w.rectHitsSolid(r)) {
      // 逐像素上移直到不再陷入地面
      let guard = 24;
      while (guard-- > 0 && w.rectHitsSolid({ x: this.x - this.w / 2, y: ny - this.h, w: this.w, h: this.h })) {
        ny -= 1;
      }
      ny = Math.round(ny);
      this.vy = 0;
    }
    this.y = ny;
  }

  render(ctx: CanvasRenderingContext2D, time: number): void {
    // 标记轮廓(猫踪喵迹 / 声呐)
    if (this.markT > 0) {
      const r = this.rect();
      ctx.globalAlpha = 0.35 + 0.25 * Math.abs(Math.sin(time * 6));
      ctx.strokeStyle = '#ffd75e';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(r.x) - 1.5, Math.round(r.y) - 1.5, r.w + 3, r.h + 3);
      ctx.globalAlpha = 1;
    }
    drawEnemy(ctx, this.kind, this.x, this.y, this.dir, time, this.frozen > 0, this.hurtT > 0, this.aimAngle);
    // 血条(受损时)
    if (this.hp < this.maxHp && this.hp > 0) {
      const w = 14;
      const ratio = this.hp / this.maxHp;
      ctx.fillStyle = '#20101a';
      ctx.fillRect(Math.round(this.x - w / 2), Math.round(this.y - this.h - 6), w, 2);
      ctx.fillStyle = '#ff5d7e';
      ctx.fillRect(Math.round(this.x - w / 2), Math.round(this.y - this.h - 6), Math.round(w * ratio), 2);
    }
  }
}
