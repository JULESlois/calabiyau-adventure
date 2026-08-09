import { TILE } from '../constants';
import type { Rect } from '../utils';
import { approach, clamp } from '../utils';
import type { WorldApi } from '../types';

type WardenState =
  | 'dormant'
  | 'intro'
  | 'idle'
  | 'blinkTele'
  | 'blinkIn'
  | 'spokeTele'
  | 'spoke'
  | 'needleTele'
  | 'needle'
  | 'stunned'
  | 'shift'
  | 'dying'
  | 'dead';

/** 辐弦的基础臂数:90° 缝隙是徒步可穿的下限,再密就必须靠二段跳了 */
const SPOKE_ARMS = 4;
/** 悬弦帘幕的列数 */
const NEEDLE_COLS = 7;
/** 悬弦从多高垂下(像素);比房间顶低一点,避免生成即撞上层平台 */
const NEEDLE_TOP = 148;

/**
 * 「回响守卫」——天穹 · 弦翼圣所的中盘守卫,打赢它才拿到「弦翼」(二段跳)。
 * 与终盘 Boss(砸地 / 冲撞 / 散弹 / 环弹)刻意分工:它不靠体重,而是围绕「弦化」与
 * 高度做文章 —— 崩解成纸片闪现换位、张开弦翼扫出旋转辐弦、从空中垂下悬弦帘幕。
 * 因为这场战斗正是二段跳的入学考试,所有攻势都必须只用纸化/攀附/突进/换人躲开,
 * 任何"必须二段跳才能过"的图形都是设计错误。
 */
export class Warden {
  /** 结算方式的判别标记:回响守卫只解封屏障,不触发通关。 */
  readonly kind = 'warden' as const;
  /** HUD Boss 条用的名字(终盘 Boss 的名字目前写死在 HUD 里,这里显式暴露) */
  readonly displayName: string = '回响守卫';
  /** HUD 血条按这个数画阶段刻痕:中盘只有两段,不能沿用终盘的三段 */
  readonly phases: number = 2;
  /** 接触伤害;比终盘 Boss 的 18 低,因为此时玩家还没有二段跳可以脱离贴身 */
  readonly contactDmg: number = 12;
  x: number;
  y: number; // 脚底中心
  w = 34;
  h = 34;
  hp = 420;
  maxHp = 420;
  state: WardenState = 'dormant';
  stateT = 0;
  /** 当前状态的总时长;render 靠它把"蓄力"画成看得见的渐变 */
  stateDur = 0;
  facing = -1;
  hurtT = 0;
  attackCd = 1.5;
  /** 节拍计数:辐弦用来抽稀音效,悬弦用来数剩余列 */
  volleys = 0;
  /** 吐弹节拍器 */
  tickT = 0;
  /** 辐弦当前角度(前摇期间不转,让预览线读得清) */
  spokeA = 0;
  /** 悬弦帘幕的落点(绝对 x);前摇时就画出来 */
  columns: number[] = [];
  /** 半血演出只播一次 */
  shifted = false;
  deathT = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  get phase(): number {
    // 中盘只分两阶段:一次升级足够,三段式留给终盘 Boss
    return this.hp / this.maxHp > 0.5 ? 1 : 2;
  }

  rect(): Rect {
    return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h };
  }

  get active(): boolean {
    return this.state !== 'dormant' && this.state !== 'dead' && this.state !== 'dying';
  }

  awaken(w: WorldApi): void {
    if (this.state !== 'dormant') return;
    this.enterState('intro', 1.8);
    w.sfx('bossRoar');
    w.shake(5);
    w.particles.burst(this.x, this.y - 18, 24, '#c47eff', 110, 0.8, 'paper');
  }

  hit(dmg: number, w: WorldApi): void {
    if (this.state === 'dormant' || this.state === 'dying' || this.state === 'dead') return;
    // 破绽窗口的回报:与终盘 Boss 一致的 2 倍,读懂收招的玩家能省掉一半血量
    const mult = this.state === 'stunned' ? 2 : 1;
    this.hp -= dmg * mult;
    this.hurtT = 0.1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.enterState('dying', 2.2);
      this.deathT = 0;
      w.shake(7);
      w.sfx('explosion');
    }
  }

  update(dt: number, w: WorldApi): void {
    if (this.state === 'dormant' || this.state === 'dead') return;
    this.stateT -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    const px = w.playerX;
    const groundY = this.groundY(w);

    // 半血相位切换:直接打断当前动作。玩家因此丢掉一个破绽窗口,但换来一个明确的
    // "它变强了"读点 —— 中盘 Boss 的信息量要写在脸上。
    if (!this.shifted && this.hp <= this.maxHp * 0.5 && this.state !== 'dying') {
      this.shifted = true;
      this.enterShift(w);
    }

    switch (this.state) {
      case 'intro':
        if (this.stateT <= 0) this.enterIdle();
        break;

      case 'idle': {
        this.facing = px > this.x ? 1 : -1;
        // 悬浮巡弋:比终盘 Boss 的 26 更慢,没有二段跳的玩家永远能绕到它背后
        this.x = clamp(this.x + this.facing * 20 * dt, 26, w.mapW - 26);
        // 待机一定落回地面,近战才有稳定的输出窗口
        this.y = approach(this.y, groundY, 90 * dt);
        this.attackCd -= dt;
        if (this.attackCd <= 0) this.pickAttack(w);
        break;
      }

      case 'blinkTele':
        // 前摇期间不动:身体正在解成纸带,玩家看到就该开始拉开距离
        this.facing = px > this.x ? 1 : -1;
        if (this.stateT <= 0) this.blink(w, groundY);
        break;

      case 'blinkIn': {
        this.y = approach(this.y, groundY, 140 * dt);
        if (this.stateT <= 0) {
          const cy = this.y - 20;
          // 重组冲击:上半圆 5 发。朝下不发,那几发只会立刻撞地板,白给一个空窗
          for (let i = 0; i <= 4; i++) {
            const a = -Math.PI + (i / 4) * Math.PI;
            w.fireEnemyBullet(
              this.x + Math.cos(a) * 14,
              cy + Math.sin(a) * 14,
              Math.cos(a) * 130,
              Math.sin(a) * 130,
              7,
              '#7ef0ff',
              2.5,
              this,
            );
          }
          w.sfx('shootIce');
          w.shake(2);
          this.enterIdle();
          // 闪现只是位移,不给破绽;但也别立刻接大招,留一口气给玩家反打
          this.attackCd = 0.6;
        }
        break;
      }

      case 'spokeTele':
        // 张开弦翼、悬起、把即将扫过的四条弦先画出来
        this.y = approach(this.y, groundY - 20, 60 * dt);
        if (this.stateT <= 0) {
          this.enterState('spoke', 1.9);
          this.tickT = 0;
          this.volleys = 0;
          w.sfx('bossRoar');
        }
        break;

      case 'spoke': {
        this.y = approach(this.y, groundY - 20, 90 * dt);
        // 1.2 rad/s:缝隙掠过地面的速度低于跑速 118,徒步跟着缝隙走就能过
        this.spokeA += 1.2 * dt;
        this.tickT -= dt;
        if (this.tickT <= 0) {
          this.tickT = 0.11;
          const cy = this.y - 20;
          for (let i = 0; i < SPOKE_ARMS; i++) {
            const a = this.spokeA + (i / SPOKE_ARMS) * Math.PI * 2;
            w.fireEnemyBullet(
              this.x + Math.cos(a) * 13,
              cy + Math.sin(a) * 13,
              Math.cos(a) * 118,
              Math.sin(a) * 118,
              8,
              '#7ef0ff',
              2.5,
              this,
            );
            // 相位二唯一的升级:两条逆向旋弦,缝隙开始朝两个方向移动。
            // 只加两条(而不是再来四条),是为了把缝隙留在徒步可穿的宽度上。
            if (this.phase >= 2 && i % 2 === 0) {
              const b = -this.spokeA + (i / SPOKE_ARMS) * Math.PI * 2 + Math.PI / SPOKE_ARMS;
              w.fireEnemyBullet(
                this.x + Math.cos(b) * 13,
                cy + Math.sin(b) * 13,
                Math.cos(b) * 118,
                Math.sin(b) * 118,
                8,
                '#c47eff',
                2.5,
                this,
              );
            }
          }
          this.volleys++;
          if (this.volleys % 3 === 0) w.sfx('shootNote'); // 每拍都响会糊成噪音
        }
        if (this.stateT <= 0) this.enterStunned(w, 1.7);
        break;
      }

      case 'needleTele':
        this.y = approach(this.y, groundY - 18, 60 * dt);
        if (this.stateT <= 0) {
          // 帘幕总时长 = 列数 × 节拍 + 一点收尾,收尾期间不再落针
          this.enterState('needle', NEEDLE_COLS * 0.2 + 0.3);
          this.volleys = NEEDLE_COLS;
          this.tickT = 0;
          w.sfx('bossRoar');
        }
        break;

      case 'needle': {
        this.y = approach(this.y, groundY - 18, 80 * dt);
        this.tickT -= dt;
        if (this.tickT <= 0 && this.volleys > 0) {
          this.tickT = 0.2;
          const cx = this.columns[NEEDLE_COLS - this.volleys];
          this.volleys--;
          // 每列 3 根:单发只是一个点,叠三发才读得出"针"的形状
          for (let i = 0; i < 3; i++) {
            w.fireEnemyBullet(cx, groundY - NEEDLE_TOP - i * 9, 0, 190, 7, '#c47eff', 2.5, this);
          }
          w.sfx('shootNote');
          w.particles.burst(cx, groundY - NEEDLE_TOP, 3, '#c47eff', 40, 0.3, 'paper');
        }
        // 帘幕是收益较低的压制技,破绽也相应更短
        if (this.volleys <= 0 && this.stateT <= 0) this.enterStunned(w, 0.9);
        break;
      }

      case 'stunned':
        // 弦力耗尽:落回地面,近战与下劈都够得到
        this.y = approach(this.y, groundY, 150 * dt);
        if (this.stateT <= 0) this.enterIdle();
        break;

      case 'shift': {
        this.y = approach(this.y, groundY, 110 * dt);
        if (this.stateT <= 0) {
          // 演出尾巴上推开一圈弦:免费窗口可以有,但贪刀要付一点代价
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            w.fireEnemyBullet(
              this.x + Math.cos(a) * 14,
              this.y - 20 + Math.sin(a) * 14,
              Math.cos(a) * 120,
              Math.sin(a) * 120,
              7,
              '#c47eff',
              2.5,
              this,
            );
          }
          w.sfx('shootNote');
          this.enterIdle();
        }
        break;
      }

      case 'dying': {
        this.deathT += dt;
        // 弦解体:纸带一层层散掉,不像终盘 Boss 那样爆成火球
        if (Math.random() < 0.35) {
          w.particles.burst(
            this.x + (Math.random() - 0.5) * 30,
            this.y - Math.random() * 34,
            6,
            Math.random() < 0.5 ? '#c47eff' : '#7ef0ff',
            100,
            0.7,
            'paper',
          );
          if (Math.random() < 0.3) w.sfx('crystal');
        }
        if (this.stateT <= 0) {
          this.state = 'dead';
          w.shake(8);
          w.sfx('explosion');
          w.particles.burst(this.x, this.y - 18, 48, '#d8f4ff', 200, 1.1, 'paper');
        }
        break;
      }

      default:
        break;
    }
  }

  private enterState(s: WardenState, dur: number): void {
    this.state = s;
    this.stateT = dur;
    this.stateDur = dur;
  }

  private enterIdle(): void {
    this.enterState('idle', 0);
    // 相位二压得更紧,但仍比终盘 Boss 的 0.7~1.3 宽松:这里是教学关
    this.attackCd = this.phase >= 2 ? 1.05 : 1.5;
  }

  private enterStunned(w: WorldApi, dur: number): void {
    this.enterState('stunned', dur);
    w.sfx('crystal');
    w.particles.burst(this.x, this.y - 20, 14, '#c47eff', 90, 0.5, 'paper');
  }

  private enterShift(w: WorldApi): void {
    this.enterState('shift', 1.0);
    w.sfx('bossRoar');
    w.shake(5);
    w.particles.burst(this.x, this.y - 18, 26, '#c47eff', 130, 0.7, 'paper');
  }

  private pickAttack(w: WorldApi): void {
    const dx = Math.abs(w.playerX - this.x);
    const roll = Math.random();
    if (dx < 54 && roll < 0.65) {
      // 被贴身就先弦化换位:否则一个没有位移的中盘 Boss 会被贴脸平砍白打
      this.enterState('blinkTele', 0.5);
      w.sfx('switch');
    } else if (roll < 0.4) {
      this.enterNeedle(w);
    } else if (roll < 0.8) {
      this.enterState('spokeTele', 0.7);
      this.spokeA = Math.random() * Math.PI * 2;
      w.sfx('crystal');
    } else {
      this.enterState('blinkTele', 0.5);
      w.sfx('switch');
    }
  }

  private enterNeedle(w: WorldApi): void {
    this.enterState('needleTele', 0.75);
    this.tickT = 0;
    this.columns.length = 0;
    // 帘幕从玩家身后起、朝身前推:玩家要么逆着帘幕跑回起点,要么在 40px 的
    // 列距里侧身让针。列距刻意大于玩家宽度许多,让"站定不动"也有活路。
    const dir = w.playerX > this.x ? 1 : -1;
    const start = w.playerX - dir * 40;
    for (let i = 0; i < NEEDLE_COLS; i++) {
      this.columns.push(clamp(start + dir * 40 * i, 18, w.mapW - 18));
    }
    w.sfx('crystal');
  }

  /** 弦化闪现:在玩家另一侧重组,逼玩家重新选边 */
  private blink(w: WorldApi, groundY: number): void {
    const px = w.playerX;
    w.particles.burst(this.x, this.y - 18, 20, '#7ef0ff', 120, 0.6, 'paper');
    const side = px > this.x ? 1 : -1;
    // 落点离玩家 46px:够压迫,又不至于重组瞬间就贴脸吃一次无法规避的接触伤害
    let dest = px + side * 46;
    if (dest < 40 || dest > w.mapW - 40) dest = px - side * 46;
    this.x = clamp(dest, 30, w.mapW - 30);
    this.y = groundY;
    this.facing = px > this.x ? 1 : -1;
    this.enterState('blinkIn', 0.4);
    w.sfx('shootNote');
    w.particles.burst(this.x, this.y - 18, 20, '#c47eff', 120, 0.6, 'paper');
  }

  private groundY(w: WorldApi): number {
    // 与终盘 Boss 同约定:战场地面固定在地图底部往上 3 tile
    return w.mapH - 3 * TILE;
  }

  /** 前摇进度 0→1;render 用它把蓄力画成渐变而不是突变 */
  private get windup(): number {
    return this.stateDur > 0 ? clamp(1 - this.stateT / this.stateDur, 0, 1) : 1;
  }

  /** 弦化程度 0→1(1 = 完全散成纸带):入场/闪现/死亡共用同一套解体视觉 */
  private scatter(): number {
    switch (this.state) {
      case 'intro':
        return Math.max(0, 1 - this.windup * 1.6); // 凝聚成形后还站一会儿
      case 'blinkTele':
        return this.windup;
      case 'blinkIn':
        return 1 - this.windup;
      case 'dying':
        return clamp(this.deathT / 2.2, 0, 1);
      default:
        return 0;
    }
  }

  render(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.state === 'dead') return;
    ctx.save();
    ctx.translate(Math.round(this.x), Math.round(this.y));
    // 受击变暗与终盘 Boss 一致;后面所有临时透明度都以它为基准还原
    const baseA = this.hurtT > 0 ? 0.6 : 1;
    ctx.globalAlpha = baseA;

    const f = this.facing;
    const P = (x: number, y: number, w2: number, h2: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w2, h2);
    };
    // 辉光也只用 fillRect:叠三层同心方块代替径向渐变,保持像素风
    const glow = (gx: number, gy: number, r: number, c: string, a: number) => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 3; i >= 1; i--) {
        ctx.globalAlpha = baseA * a * (0.3 / i);
        const s = Math.round(r * (0.5 + i * 0.35));
        ctx.fillStyle = c;
        ctx.fillRect(Math.round(gx) - s, Math.round(gy) - s, s * 2, s * 2);
      }
      ctx.restore();
    };

    const stunned = this.state === 'stunned';
    const telegraphing =
      this.state === 'blinkTele' ||
      this.state === 'spokeTele' ||
      this.state === 'needleTele' ||
      this.state === 'shift';
    // 前摇闪烁:沿用终盘 Boss 的"身体换色 + 姿态改变"双重信号
    const flash = telegraphing && Math.floor(time * 12) % 2 === 0;
    const bodyC = flash ? '#5a2f7a' : '#2c2840';
    const bodyHi = flash ? '#b478e8' : '#4a4468';
    const darkC = flash ? '#33184a' : '#16131f';
    const eyeC = stunned ? '#ffd75e' : flash ? '#f0c0ff' : '#7ef0ff';

    const sc = this.scatter();
    if (sc > 0.02) {
      // ---- 弦化形态:身体解成横向纸带,越散越透 ----
      const dead = this.state === 'dying';
      for (let i = 0; i < 17; i++) {
        const sy = -34 + i * 2;
        const off = Math.round(Math.sin(i * 1.7 + time * 9) * sc * (dead ? 22 : 15));
        const drift = dead ? Math.round(sc * sc * i * -1.5) : 0;
        // 纺锤形轮廓,中段最宽;取偶数宽度才能保证 -bw/2 落在整像素上
        const bw = 22 - 2 * Math.floor(Math.abs(i - 8) / 2);
        ctx.globalAlpha = baseA * (1 - sc * (dead ? 1 : 0.8));
        P(-bw / 2 + off, sy + drift, bw, 2, i % 2 === 0 ? '#3a3454' : '#241f36');
        if (i % 3 === 0) P(-bw / 2 + off, sy + drift, bw, 1, sc > 0.5 ? '#c47eff' : '#7ef0ff');
      }
      ctx.globalAlpha = baseA;
      // 眼缝是最后消失/最先出现的部分,给"它还在那里"一个锚点
      if (sc < 0.85) {
        P(-5 + f * 2, -31, 10, 2, eyeC);
        glow(f * 2, -30, 7, '#7ef0ff', 1 - sc);
      }
      if (this.state === 'blinkIn') this.drawBurstLanes(ctx, time, baseA);
      ctx.restore();
      return;
    }

    // ---- 姿态:前摇张翼、眩晕塌陷 ----
    let spread = 0;
    if (this.state === 'spokeTele') spread = Math.round(this.windup * 9);
    else if (this.state === 'spoke') spread = 9;
    else if (this.state === 'needleTele') spread = Math.round(this.windup * 5);
    else if (this.state === 'needle') spread = 5;
    else if (stunned) spread = -2; // 弦翼垂落收拢
    const slump = stunned ? 5 : 0;
    const bob = Math.round(Math.sin(time * 2.2) * (spread > 0 ? 1.5 : 0.8));
    const top = slump + bob; // 上半身整体位移

    // 悬弦裙摆:下窄上宽的纸带,底端随时间摆动 —— 它是"浮"着的,不长腿
    for (let i = 0; i < 6; i++) {
      const yy = -2 - i * 2;
      // 半宽取整,收窄到躯干同宽(i=5 时正好 22)才接得上腰
      const hw = 3 + Math.round(i * 1.6);
      const sway = Math.round(Math.sin(time * 3 - i * 0.5) * (5 - i) * 0.5);
      P(-hw + sway, yy, hw * 2, 2, i < 2 ? darkC : bodyC);
      if (i === 5) P(-hw + sway, yy, hw * 2, 1, bodyHi);
    }
    P(-2, -2, 4, 2, eyeC); // 裙摆末端的弦芯

    // 弦翼(肩甲):内缘发光,张开量就是"我要放大招了"的读点
    const wingH = 14 + (spread > 4 ? 4 : 0);
    P(-16 - spread, -30 + top, 5, wingH, darkC);
    P(-12 - spread, -30 + top, 1, wingH, spread > 0 ? '#7ef0ff' : bodyHi);
    P(11 + spread, -30 + top, 5, wingH, darkC);
    P(11 + spread, -30 + top, 1, wingH, spread > 0 ? '#7ef0ff' : bodyHi);
    if (spread > 4) {
      glow(-14 - spread, -23 + top, 6, '#7ef0ff', 0.8);
      glow(14 + spread, -23 + top, 6, '#7ef0ff', 0.8);
    }

    // 躯干
    P(-11, -28 + top, 22, 16, bodyC);
    P(-11, -28 + top, 22, 2, bodyHi);
    P(-11, -15 + top, 22, 3, darkC);
    // 躯干上的三根竖弦
    ctx.globalAlpha = baseA * 0.55;
    P(-6, -26 + top, 1, 10, '#7ef0ff');
    P(0, -26 + top, 1, 10, '#c47eff');
    P(6, -26 + top, 1, 10, '#7ef0ff');
    ctx.globalAlpha = baseA;
    // 胸核(菱形):眩晕时开裂发烫
    const coreC = stunned ? '#ffd75e' : '#c47eff';
    P(-2, -25 + top, 4, 6, coreC);
    P(-3, -24 + top, 6, 4, coreC);
    P(-1, -23 + top, 2, 2, '#ffffff');
    glow(0, -22 + top, stunned ? 12 : 8, coreC, stunned ? 1 : 0.55 + Math.sin(time * 5) * 0.2);

    // 兜帽与面甲
    P(-9, -28 + top, 18, 3, bodyC);
    P(-8, -34 + top, 16, 8, bodyC);
    P(-8, -34 + top, 16, 1, bodyHi);
    P(-9, -33 + top, 1, 5, darkC);
    P(8, -33 + top, 1, 5, darkC);
    P(-5 + f * 2, -31 + top, 10, 2, eyeC);
    P(-5 + f * 2, -31 + top, 10, 1, stunned ? '#fff0c0' : '#d8faff');
    glow(f * 2, -30 + top, stunned ? 5 : 8, eyeC, stunned ? 0.5 : 0.8);

    if (stunned) {
      // 断弦垂落 + 旋转火花:这套"打我"的视觉语言与终盘 Boss 的眩晕星星同源
      for (let i = 0; i < 3; i++) {
        const bx = -8 + i * 8;
        for (let j = 0; j < 5; j++) {
          const sw = Math.round(Math.sin(time * 7 + i * 1.3 + j * 0.5) * (j * 0.6));
          P(bx + sw, -14 + top + j * 3, 1, 2, j % 2 === 0 ? '#7ef0ff' : '#3a3454');
        }
      }
      for (let i = 0; i < 3; i++) {
        const a = time * 4 + (i * Math.PI * 2) / 3;
        const sx = Math.round(Math.cos(a) * 14);
        const sy = -42 + Math.round(Math.sin(a) * 4);
        P(sx - 1, sy, 3, 1, '#ffd75e');
        P(sx, sy - 1, 1, 3, '#ffd75e');
      }
    } else {
      // 环绕头顶的弦结:蓄力时转得更快、绕得更开
      const fast = this.state === 'spoke' || this.state === 'spokeTele';
      const rr = 13 + (this.state === 'spoke' ? 3 : 0);
      for (let i = 0; i < 6; i++) {
        const a = time * (fast ? 3.4 : 1) + (i / 6) * Math.PI * 2;
        const nx = Math.round(Math.cos(a) * rr);
        const ny = -38 + top + Math.round(Math.sin(a) * 4);
        P(nx - 1, ny - 1, 2, 2, i % 2 === 0 ? '#7ef0ff' : '#c47eff');
      }
    }

    // ---- 攻击预告线 ----
    if (this.state === 'spokeTele' || this.state === 'spoke') {
      // 辐弦即将扫过的四条线:前摇期间角度不变,让玩家先站到缝隙里
      const preview = this.state === 'spokeTele';
      ctx.globalAlpha = baseA * (preview ? 0.25 + 0.3 * Math.abs(Math.sin(time * 10)) : 0.14);
      for (let i = 0; i < SPOKE_ARMS; i++) {
        const a = this.spokeA + (i / SPOKE_ARMS) * Math.PI * 2;
        for (let d = 16; d < 52; d += 5) {
          P(Math.round(Math.cos(a) * d) - 1, -20 + Math.round(Math.sin(a) * d) - 1, 2, 2, '#7ef0ff');
        }
        if (this.phase >= 2 && i % 2 === 0) {
          const b = -this.spokeA + (i / SPOKE_ARMS) * Math.PI * 2 + Math.PI / SPOKE_ARMS;
          for (let d = 16; d < 52; d += 5) {
            P(Math.round(Math.cos(b) * d) - 1, -20 + Math.round(Math.sin(b) * d) - 1, 2, 2, '#c47eff');
          }
        }
      }
      ctx.globalAlpha = baseA;
    }
    if (this.state === 'needleTele' || this.state === 'needle') {
      // 悬弦落点:前摇时七列全亮,落针后只留未落的几列
      const first = this.state === 'needle' ? NEEDLE_COLS - this.volleys : 0;
      const bright = this.state === 'needleTele';
      ctx.globalAlpha = baseA * (bright ? 0.25 + 0.35 * Math.abs(Math.sin(time * 9)) : 0.16);
      for (let i = first; i < this.columns.length; i++) {
        const gx = Math.round(this.columns[i] - Math.round(this.x));
        for (let yy = -136; yy < -6; yy += 7) P(gx - 1, yy, 2, 3, '#c47eff');
      }
      ctx.globalAlpha = baseA;
    }
    if (this.state === 'shift') {
      // 相位演出:一圈向外扩张的弦环
      const r = 10 + this.windup * 40;
      ctx.globalAlpha = baseA * (1 - this.windup) * 0.8;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + time * 2;
        P(Math.round(Math.cos(a) * r) - 1, -20 + Math.round(Math.sin(a) * r) - 1, 3, 3, '#c47eff');
      }
      ctx.globalAlpha = baseA;
    }

    ctx.restore();
  }

  /** 重组冲击的五条弹道预告(在弦化形态里画,因为它就是那一瞬的前摇) */
  private drawBurstLanes(ctx: CanvasRenderingContext2D, time: number, baseA: number): void {
    ctx.globalAlpha = baseA * (0.2 + 0.4 * this.windup * Math.abs(Math.sin(time * 14)));
    ctx.fillStyle = '#7ef0ff';
    for (let i = 0; i <= 4; i++) {
      const a = -Math.PI + (i / 4) * Math.PI;
      for (let d = 16; d < 40; d += 5) {
        ctx.fillRect(Math.round(Math.cos(a) * d) - 1, -20 + Math.round(Math.sin(a) * d) - 1, 2, 2);
      }
    }
    ctx.globalAlpha = baseA;
  }
}
