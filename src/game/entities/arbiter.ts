import { TILE } from '../constants';
import type { Rect } from '../utils';
import { clamp } from '../utils';
import type { WorldApi } from '../types';

type ArbiterState =
  | 'dormant'
  | 'intro'
  | 'idle'
  | 'bloomTele'
  | 'bloom'
  | 'sweepTele'
  | 'sweep'
  | 'dashTele'
  | 'dash'
  | 'unfurl'
  | 'dying'
  | 'dead';

/** 平面相扫击的推进速度;RUN_SPEED 118 之下,普通形态徒步就能拉开。 */
const SWEEP_SPEED = 150;
/** 体积相花期弹速:偏慢,留出"该弦化了"的读招时间。 */
const BLOOM_SPEED = 118;

/**
 * 「弦相审判」——圣堂 · 巨管风琴的可选 Boss,守着「踏空蓄步」祭坛。
 * 它是对弦化的一整场考试:攻击分两种空间相位,读懂预警后必须主动决定形态 ——
 * - 体积相(bloom):慢速弹花占满空间。纸片形态可以让弹丸穿身而过(既有全局规则),
 *   所以答案是弦化;但弦化耗能且不能攻击,不能无脑挂机。
 * - 平面相(sweep):一道沿弦面推进的波纹,只对纸片形态结算伤害(经 WorldApi.hurtPlayer),
 *   普通形态从它面前走过毫发无伤 —— 答案是及时恢复 3D。
 * - 弦跃(dash):Boss 自己纸化冲过玩家所在位置,落位展弦即失衡窗口(2 倍伤害),
 *   与镜弦猎兵同一套读招语言,玩家在小怪身上学到的经验直接适用。
 * 半血后体积相变密、平面相双向合拢,考的是形态切换的节奏而不是反应速度。
 */
export class Arbiter {
  readonly kind = 'arbiter' as const;
  readonly displayName = '弦相审判者';
  readonly phases = 2;
  /** 接触伤害只在 3D 战斗态存在;行程与失衡期由 active 状态另行处理。 */
  readonly contactDmg = 14;
  x: number;
  y: number; // 脚底中心
  w = 30;
  h = 40;
  hp = 560;
  maxHp = 560;
  state: ArbiterState = 'dormant';
  stateT = 0;
  /** 当前状态总时长,渲染用它画蓄力渐变 */
  stateDur = 0;
  facing = -1;
  hurtT = 0;
  attackCd = 1.4;
  volleys = 0;
  tickT = 0;
  /** 平面相波纹(至多两道,phase 2 双向合拢) */
  sweeps: { x: number; dir: number; hit: boolean }[] = [];
  /** 弦跃行程 */
  dashFromX = 0;
  dashToX = 0;
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

  /** 弦跃行程中不可触碰(与镜弦猎兵同规则),由 PlayState 的战斗结算尊重。 */
  get intangible(): boolean {
    return this.state === 'dash';
  }

  awaken(w: WorldApi): void {
    if (this.state !== 'dormant') return;
    this.enterState('intro', 1.6);
    w.sfx('bossRoar');
    w.shake(5);
  }

  hit(dmg: number, w: WorldApi): void {
    if (this.state === 'dormant' || this.state === 'dying' || this.state === 'dead') return;
    if (this.intangible) return;
    const mult = this.state === 'unfurl' ? 2 : 1;
    this.hp -= dmg * mult;
    this.hurtT = 0.1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.enterState('dying', 2.4);
      this.deathT = 0;
      this.sweeps = [];
      w.shake(8);
      w.sfx('explosion');
    }
  }

  update(dt: number, w: WorldApi): void {
    if (this.state === 'dormant' || this.state === 'dead') return;
    this.stateT -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    const px = w.playerX;
    const groundY = w.mapH - 3 * TILE;

    // 平面相波纹独立推进:即使 Boss 已切换状态,已放出的波纹也要走完。
    for (let i = this.sweeps.length - 1; i >= 0; i--) {
      const s = this.sweeps[i];
      s.x += s.dir * SWEEP_SPEED * dt;
      // 只对纸片形态结算;普通形态从波纹里走过去毫发无伤。
      if (!s.hit && w.playerPaper && Math.abs(s.x - px) < 9) {
        if (w.hurtPlayer(13, s.x)) s.hit = true;
      }
      if (Math.random() < 0.4) {
        w.particles.spawn({
          x: s.x, y: groundY - Math.random() * 60,
          vx: s.dir * 20, vy: -15 - Math.random() * 25,
          life: 0.22, color: '#e878c0', shape: 'spark', size: 1,
        });
      }
      if (s.x < -20 || s.x > w.mapW + 20) this.sweeps.splice(i, 1);
    }

    switch (this.state) {
      case 'intro':
        if (this.stateT <= 0) this.enterIdle();
        break;

      case 'idle': {
        this.facing = px > this.x ? 1 : -1;
        this.x = clamp(this.x + this.facing * 20 * dt, 40, w.mapW - 40);
        this.y = Math.min(this.y + 200 * dt, groundY);
        this.attackCd -= dt;
        if (this.attackCd <= 0) this.pickAttack(w);
        break;
      }

      case 'bloomTele':
        this.facing = px > this.x ? 1 : -1;
        if (this.stateT <= 0) {
          this.enterState('bloom', 0.1);
          this.volleys = this.phase === 2 ? 3 : 2;
          this.tickT = 0;
        }
        break;

      case 'bloom': {
        // 体积相:慢速弹花,一波一波占满空间;弦化即可穿过。
        this.tickT -= dt;
        if (this.tickT <= 0 && this.volleys > 0) {
          const n = this.phase === 2 ? 10 : 8;
          const offset = (this.volleys % 2) * (Math.PI / n);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + offset;
            w.fireEnemyBullet(
              this.x, this.y - this.h / 2,
              Math.cos(a) * BLOOM_SPEED, Math.sin(a) * BLOOM_SPEED,
              10, '#8ee8f4', 3,
            );
          }
          w.sfx('shootIce');
          this.volleys--;
          this.tickT = 0.62;
        }
        if (this.volleys <= 0 && this.tickT <= 0) this.enterIdle();
        break;
      }

      case 'sweepTele':
        if (this.stateT <= 0) {
          // 平面相:phase 1 单向,phase 2 双向合拢逼玩家在两道波纹之间选形态。
          this.sweeps.push({ x: this.facing > 0 ? -10 : w.mapW + 10, dir: this.facing > 0 ? 1 : -1, hit: false });
          if (this.phase === 2) {
            this.sweeps.push({ x: this.facing > 0 ? w.mapW + 10 : -10, dir: this.facing > 0 ? -1 : 1, hit: false });
          }
          w.sfx('paperOn');
          this.enterState('sweep', 1.2);
        }
        break;

      case 'sweep':
        if (this.stateT <= 0) this.enterIdle();
        break;

      case 'dashTele':
        this.facing = px > this.x ? 1 : -1;
        if (this.stateT <= 0) {
          this.dashFromX = this.x;
          // 穿过玩家当前位置,落到另一侧;读招方式与镜弦猎兵一致。
          this.dashToX = clamp(px + this.facing * 70, 40, w.mapW - 40);
          this.enterState('dash', 0.42);
          w.sfx('paperOn');
        }
        break;

      case 'dash': {
        const t = 1 - Math.max(0, this.stateT) / this.stateDur;
        const ease = t * t * (3 - 2 * t);
        this.x = this.dashFromX + (this.dashToX - this.dashFromX) * ease;
        if (Math.random() < 0.6) {
          w.particles.spawn({
            x: this.x, y: this.y - this.h / 2 + (Math.random() - 0.5) * 20,
            vx: -this.facing * 30, vy: (Math.random() - 0.5) * 20,
            life: 0.2, color: '#e878c0', shape: 'paper', size: 1,
          });
        }
        if (this.stateT <= 0) {
          // 展弦失衡:整场战斗唯一的 2 倍伤害窗口。
          this.enterState('unfurl', this.phase === 2 ? 1.0 : 1.4);
          w.sfx('paperOff');
          w.particles.burst(this.x, this.y - this.h / 2, 14, '#e878c0', 100, 0.5, 'paper');
        }
        break;
      }

      case 'unfurl':
        if (this.stateT <= 0) this.enterIdle();
        break;

      case 'dying': {
        this.deathT += dt;
        if (Math.random() < 0.3) {
          w.particles.burst(
            this.x + (Math.random() - 0.5) * 30,
            this.y - Math.random() * this.h,
            8,
            Math.random() < 0.5 ? '#8ee8f4' : '#e878c0',
            110,
            0.6,
            'paper',
          );
        }
        if (this.stateT <= 0) {
          this.state = 'dead';
          w.shake(9);
          w.sfx('explosion');
          w.particles.burst(this.x, this.y - 20, 50, '#f0e8ff', 200, 1.1, 'paper');
        }
        break;
      }

      default:
        break;
    }
  }

  private enterState(s: ArbiterState, dur: number): void {
    this.state = s;
    this.stateT = dur;
    this.stateDur = dur;
  }

  private enterIdle(): void {
    this.state = 'idle';
    this.attackCd = this.phase === 2 ? 0.9 : 1.3;
  }

  private pickAttack(w: WorldApi): void {
    const roll = Math.random();
    const dx = Math.abs(w.playerX - this.x);
    // 玩家赖在纸片形态时偏向平面相 —— 考试要考没复习的科目。
    const paperBias = w.playerPaper ? 0.3 : 0;
    if (roll < 0.32 + paperBias) this.enterState('sweepTele', 0.7);
    else if (roll < 0.65 || dx > 170) this.enterState('bloomTele', 0.6);
    else this.enterState('dashTele', 0.5);
  }

  render(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.state === 'dead') return;

    // 平面相波纹:全高弦面涟漪,和弹丸一眼区分。
    for (const s of this.sweeps) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.3 * Math.abs(Math.sin(time * 10));
      ctx.fillStyle = '#e878c0';
      ctx.fillRect(Math.round(s.x) - 1, 0, 2, this.y);
      ctx.globalAlpha = 0.16;
      ctx.fillRect(Math.round(s.x) - 4, 0, 8, this.y);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(Math.round(this.x), Math.round(this.y));
    const baseA = this.hurtT > 0 ? 0.6 : 1;
    ctx.globalAlpha = baseA;

    const f = this.facing;
    const telegraphing = this.state === 'bloomTele' || this.state === 'sweepTele' || this.state === 'dashTele';
    const flash = telegraphing && Math.floor(time * 12) % 2 === 0;
    // 预警配色区分相位:体积相闪青,平面相闪粉,弦跃闪白
    const teleC = this.state === 'bloomTele' ? '#3a7686' : this.state === 'sweepTele' ? '#863a6a' : '#6a6a86';
    const bodyC = flash ? teleC : '#2e2444';
    const hiC = flash ? '#a8d8e8' : '#5a4a80';
    const P = (x: number, y: number, w2: number, h2: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w2, h2);
    };

    if (this.state === 'dash') {
      // 弦跃:压成一道纸光
      ctx.globalAlpha = 0.85 * baseA;
      P(-14, -24, 28, 4, '#e878c0');
      P(-20, -23, 8, 2, '#f8d8ec');
      ctx.restore();
      return;
    }

    const unfurling = this.state === 'unfurl';
    const openRatio = unfurling ? 1 - Math.max(0, this.stateT) / this.stateDur : 1;

    // 长袍审判者:躯干为一册摊开的"弦典"
    const bw = Math.round(15 * openRatio) + 2;
    P(-bw, -36, bw * 2, 30, bodyC);
    P(-bw, -36, bw * 2, 2, hiC);
    P(-bw, -8, bw * 2, 3, '#1c1630');
    // 中缝弦线
    P(-1, -40, 2, 34, unfurling ? '#ffe9a8' : '#e878c0');
    // 头冠(天平意象:左右各一枚砝码)
    P(-6, -44, 12, 7, bodyC);
    P(-6, -44, 12, 1, hiC);
    P(-12, -42 + Math.round(Math.sin(time * 2) * 2), 4, 4, '#8ee8f4');
    P(8, -42 + Math.round(Math.sin(time * 2 + Math.PI) * 2), 4, 4, '#e878c0');
    // 独目
    P(-2 + f, -41, 5, 2, unfurling ? '#ffe9a8' : '#f0f0ff');

    // 弦核:失衡时大亮
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (unfurling ? 0.85 : 0.4 + Math.sin(time * 4) * 0.15) * baseA;
    ctx.fillStyle = unfurling ? '#ffe9a8' : '#c47eff';
    ctx.beginPath();
    ctx.arc(0, -22, unfurling ? 12 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    P(-3, -25, 6, 6, unfurling ? '#ffe9a8' : '#c47eff');
    P(-1, -23, 2, 2, '#ffffff');

    // 失衡星芒(与守望者的眩晕语言一致)
    if (unfurling) {
      for (let i = 0; i < 3; i++) {
        const a = time * 4 + (i * Math.PI * 2) / 3;
        const sx = Math.cos(a) * 12;
        const sy = -48 + Math.sin(a) * 3;
        P(Math.round(sx) - 1, Math.round(sy), 3, 1, '#ffd75e');
        P(Math.round(sx), Math.round(sy) - 1, 1, 3, '#ffd75e');
      }
    }

    ctx.restore();
  }
}
