import { GRAVITY, MAX_FALL } from '../constants';
import type { Rect } from '../utils';
import { clamp, dist } from '../utils';
import type { WorldApi } from '../types';
import { drawEnemy, type EnemyPose } from '../render/sprites';

export type EnemyKind =
  | 'patrol'
  | 'drone'
  | 'turret'
  | 'shield'
  | 'exploder'
  | 'slasher'
  | 'leech'
  | 'mortar'
  | 'hound'
  | 'stringer';

const STATS: Record<EnemyKind, { hp: number; contact: number; w: number; h: number }> = {
  patrol: { hp: 30, contact: 10, w: 14, h: 12 },
  drone: { hp: 20, contact: 8, w: 12, h: 10 },
  turret: { hp: 45, contact: 8, w: 16, h: 12 },
  shield: { hp: 60, contact: 14, w: 14, h: 18 },
  exploder: { hp: 26, contact: 10, w: 15, h: 13 },
  slasher: { hp: 34, contact: 14, w: 13, h: 12 },
  leech: { hp: 24, contact: 12, w: 12, h: 10 },
  mortar: { hp: 50, contact: 8, w: 16, h: 14 },
  hound: { hp: 32, contact: 14, w: 14, h: 12 },
  stringer: { hp: 55, contact: 12, w: 13, h: 18 },
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
  /** 刺镰魔怪与逆弦犬共用:0 徘徊 / >0 蓄力 / <0 突刺剩余 */
  lungeT = 0;
  recoverT = 0;
  /** 弦蛭:'hang' 吸附天花板 / 'drop' 坠落 / 'crawl' 落地后爬行 */
  leechPhase: 'hang' | 'drop' | 'crawl' = 'hang';
  /** 迫击晶:装填进度(0..1),满则发射;<0 为冷却 */
  chargeT = -1;
  /** 逆弦犬:锁定玩家的剩余时间(锁定期间无视纸片形态) */
  lockT = 0;
  /** 镜弦猎兵:弦化换位的行程(0..1);<0 表示不在行程中 */
  travelT = -1;
  travelFromX = 0;
  travelFromY = 0;
  travelToX = 0;
  travelToY = 0;
  /** 展弦失衡窗口(受伤 +60%) */
  unfurlT = 0;
  /** 换位冷却与受压计数 */
  stringCdT = 0;
  pressureHits = 0;

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

  /** 需要重力的地面型;弦蛭吸附天花板时不算,坠落后才算。 */
  get grounded(): boolean {
    switch (this.kind) {
      case 'patrol':
      case 'shield':
      case 'exploder':
      case 'slasher':
      case 'mortar':
      case 'hound':
        return true;
      case 'leech':
        return this.leechPhase !== 'hang';
      case 'stringer':
        return this.travelT < 0;
      default:
        return false;
    }
  }

  /** 镜弦猎兵弦化行程中是一道纸光,子弹/近战/接触全部穿过。 */
  get intangible(): boolean {
    return this.kind === 'stringer' && this.travelT >= 0;
  }

  hit(dmg: number, freeze: number, _w: WorldApi): void {
    if (this.intangible) return;
    if (this.markT > 0) dmg *= 1.3;
    if (this.unfurlT > 0) dmg *= 1.6; // 展弦失衡:读准出口的奖励
    this.hp -= dmg;
    this.hurtT = 0.12;
    this.pressureHits++;
    if (freeze > 0) this.frozen = Math.max(this.frozen, freeze);
    if (this.hp <= 0) this.dead = true;
  }

  update(dt: number, w: WorldApi): void {
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.markT > 0) this.markT -= dt;
    if (this.frozen > 0) {
      this.frozen -= dt;
      // 冻结时仍受重力(地面型)
      if (this.grounded) this.applyGravity(dt, w);
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
          // 引信由渲染层按 fuseT 画独立的闪烁与爆炸半径圈,
          // 不再借用 hurtT —— 那会让"点燃"和"被打中"看起来一模一样。
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
      case 'leech': {
        // 弦蛭:吸附天花板的伏击者,玩家走到下方才脱落。
        if (this.leechPhase === 'hang') {
          this.dir = px > this.x ? 1 : -1;
          // 只有玩家确实在正下方时才脱落,避免远处经过就白白掉光。
          if (Math.abs(px - this.x) < 18 && py > this.y && d < 150) {
            this.leechPhase = 'drop';
            this.vy = 0;
            w.sfx('switch');
          }
          break;
        }
        this.applyGravity(dt, w);
        if (this.leechPhase === 'drop') {
          if (w.hasGroundAt(this.x, this.y + 2)) {
            this.leechPhase = 'crawl';
            w.particles.burst(this.x, this.y - 4, 8, '#8de0c4', 70, 0.35);
          }
          break;
        }
        // 落地后贴地爬行追击
        this.dir = px > this.x ? 1 : -1;
        const leechFront: Rect = {
          x: this.x + this.dir * (this.w / 2 + 1) - 1,
          y: this.y - this.h + 2,
          w: 2,
          h: this.h - 4,
        };
        if (!w.rectHitsSolid(leechFront) && w.hasGroundAt(this.x + this.dir * (this.w / 2 + 3), this.y + 2)) {
          this.x += this.dir * 56 * dt;
        }
        break;
      }
      case 'mortar': {
        // 迫击晶:装填期完全静止且有明显蓄光,出膛后是可被近战击碎的慢速重弹。
        this.applyGravity(dt, w);
        this.dir = px > this.x ? 1 : -1;
        if (this.chargeT < 0) {
          this.chargeT += dt / 2.6; // 冷却
          if (this.chargeT >= 0) this.chargeT = 0;
          break;
        }
        if (d > 260 || w.playerPaper) {
          this.chargeT = 0; // 目标离开则卸弹
          break;
        }
        this.chargeT += dt / 1.1;
        if (this.chargeT >= 1) {
          const cy = this.y - this.h + 2;
          const base = Math.atan2(py - cy, px - this.x);
          for (let i = -1; i <= 1; i++) {
            const a = base + i * 0.22;
            w.fireEnemyBullet(this.x, cy, Math.cos(a) * 82, Math.sin(a) * 82, 16, '#ffb066', 5, this);
          }
          w.sfx('explosion');
          w.shake(2);
          w.particles.burst(this.x, cy, 10, '#ffd08a', 90, 0.4, 'spark');
          this.chargeT = -1;
        }
        break;
      }
      case 'hound': {
        // 逆弦犬:唯一会追击纸片形态的敌人 —— 弦化不再是万能的隐身衣。
        this.applyGravity(dt, w);
        if (this.lungeT > 0) {
          this.lungeT -= dt; // 嗅探起手,给玩家反应窗口
          if (this.lungeT <= 0) {
            this.lockT = 3.2;
            w.sfx('bossRoar');
          }
          break;
        }
        if (this.lockT > 0) {
          this.lockT -= dt;
          this.dir = px > this.x ? 1 : -1;
          const houndFront: Rect = {
            x: this.x + this.dir * (this.w / 2 + 1) - 1,
            y: this.y - this.h + 2,
            w: 2,
            h: this.h - 4,
          };
          if (!w.rectHitsSolid(houndFront) && w.hasGroundAt(this.x + this.dir * (this.w / 2 + 3), this.y + 2)) {
            this.x += this.dir * 92 * dt;
          }
          if (Math.random() < 0.25) {
            w.particles.spawn({
              x: this.x - this.dir * 6,
              y: this.y - 3,
              vx: -this.dir * 20,
              vy: -10,
              life: 0.24,
              color: '#c47eff',
              shape: 'spark',
              size: 1,
            });
          }
          break;
        }
        // 巡游:注意这里不看 playerPaper,弦化同样会被嗅到。
        if (d < 170) {
          this.dir = px > this.x ? 1 : -1;
          this.lungeT = 0.35;
          w.sfx('melee');
          break;
        }
        const roamFront: Rect = {
          x: this.x + this.dir * (this.w / 2 + 1) - 1,
          y: this.y - this.h + 2,
          w: 2,
          h: this.h - 4,
        };
        if (w.rectHitsSolid(roamFront) || !w.hasGroundAt(this.x + this.dir * (this.w / 2 + 3), this.y + 2)) {
          this.dir *= -1;
        }
        this.x += this.dir * 30 * dt;
        break;
      }
      case 'stringer': {
        // 镜弦猎兵:墙不是它的边界。受压或被贴近时弦化换位,
        // 在玩家另一侧展弦并重新开火;展弦瞬间是读得到的失衡窗口。
        this.stringCdT = Math.max(0, this.stringCdT - dt);
        if (this.travelT >= 0) {
          this.travelT += dt / 0.55;
          const t = Math.min(1, this.travelT);
          const ease = t * t * (3 - 2 * t);
          this.x = this.travelFromX + (this.travelToX - this.travelFromX) * ease;
          // 行程走一条上凸弧线,读起来是"沿墙/顶掠过"而不是瞬移
          const arc = Math.sin(t * Math.PI) * 46;
          this.y = this.travelFromY + (this.travelToY - this.travelFromY) * ease - arc;
          if (Math.random() < 0.5) {
            w.particles.spawn({
              x: this.x, y: this.y - this.h / 2,
              vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20,
              life: 0.25, color: '#c47eff', shape: 'paper', size: 1,
            });
          }
          if (this.travelT >= 1) {
            this.travelT = -1;
            this.y = this.travelToY;
            this.unfurlT = 0.55;
            this.vy = 0;
            w.sfx('paperOff');
            w.particles.burst(this.x, this.y - this.h / 2, 12, '#c47eff', 90, 0.4, 'paper');
          }
          break;
        }
        this.applyGravity(dt, w);
        if (this.unfurlT > 0) {
          this.unfurlT -= dt; // 失衡:站桩挨打
          break;
        }
        this.dir = px > this.x ? 1 : -1;
        // 受压(挨了 3 下)或被贴身,且冷却完毕 → 弦化换位到玩家另一侧
        if (this.stringCdT <= 0 && (this.pressureHits >= 3 || d < 56)) {
          this.pressureHits = 0;
          this.stringCdT = 4.5;
          this.travelFromX = this.x;
          this.travelFromY = this.y;
          // 目的地:镜像到玩家另一侧,落点向下探到有地面为止
          const mirrorX = clamp(px + (px - this.x) * 0.9 + this.dir * 20, 24, w.mapW - 24);
          let landY = this.y;
          for (let probe = py - 64; probe < py + 96; probe += 8) {
            if (w.hasGroundAt(mirrorX, probe)) {
              landY = probe - 2;
              break;
            }
          }
          this.travelToX = mirrorX;
          this.travelToY = landY;
          this.travelT = 0;
          w.sfx('paperOn');
          w.particles.burst(this.x, this.y - this.h / 2, 10, '#c47eff', 70, 0.35, 'paper');
          break;
        }
        // 保持中距离,双发点射
        if (d < 70) this.x -= this.dir * 30 * dt;
        else if (d > 150) this.x += this.dir * 26 * dt;
        this.shootT -= dt;
        if (this.burstLeft > 0) {
          this.burstT -= dt;
          if (this.burstT <= 0) {
            this.burstLeft--;
            this.burstT = 0.14;
            const a = Math.atan2(py - (this.y - this.h * 0.7), px - this.x);
            w.fireEnemyBullet(
              this.x + Math.cos(a) * 9, this.y - this.h * 0.7 + Math.sin(a) * 9,
              Math.cos(a) * 165, Math.sin(a) * 165, 9, '#c47eff', 2.5, this,
            );
            w.sfx('shootNote');
          }
        } else if (this.shootT <= 0 && d < 210 && !w.playerPaper) {
          this.burstLeft = 2;
          this.burstT = 0;
          this.shootT = 2.1 + Math.random() * 0.5;
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

  /** 把攻击意图交给渲染层,让每个"要出手了"的状态都有独立的画面表达。 */
  private pose(): EnemyPose {
    return {
      frozen: this.frozen > 0,
      hurtFlash: this.hurtT > 0,
      aimAngle: this.aimAngle,
      windup: this.kind === 'mortar'
        ? (this.chargeT >= 0 ? this.chargeT : -1)
        : this.lungeT > 0 ? 1 - this.lungeT / (this.kind === 'hound' ? 0.35 : 0.45) : -1,
      fuse: this.fuseT >= 0 ? 1 - this.fuseT / 0.7 : -1,
      lunging: this.lungeT < 0 || this.leechPhase === 'drop',
      locked: this.lockT > 0,
      traveling: this.travelT >= 0,
      unfurl: this.unfurlT > 0 ? this.unfurlT / 0.55 : -1,
    };
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
    drawEnemy(ctx, this.kind, this.x, this.y, this.dir, time, this.pose());
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
