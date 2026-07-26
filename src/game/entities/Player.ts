import {
  AIR_ACCEL,
  COYOTE_TIME,
  DOUBLE_JUMP_VEL,
  GRAVITY,
  INVULN_TIME,
  JUMP_BUFFER,
  JUMP_VEL,
  MAX_FALL,
  MAX_HP,
  MAX_STRING,
  PAPER_SPEED_MULT,
  PLAYER_H,
  PLAYER_W,
  RUN_ACCEL,
  RUN_SPEED,
  STRING_DRAIN,
  STRING_REGEN,
  SWITCH_CD,
  TILE,
  WALL_JUMP_VX,
  WALL_JUMP_VY,
  WALL_SLIDE_SPEED,
} from '../constants';
import { T_MEMBRANE, T_ONEWAY, T_SOLID } from '../levels/levels';
import type { CharId } from '../types';
import type { Rect } from '../utils';
import { approach, clamp } from '../utils';
import { makeIceBolt, makeNote } from './bullets';
import { drawChar } from '../render/sprites';
import type { PlayState } from '../states/PlayState';

export class Player {
  x: number; // 脚底中心
  y: number;
  vx = 0;
  vy = 0;
  facing = 1;
  char: CharId = 'michele';
  hp = MAX_HP;
  energy = MAX_STRING;
  paper = false;
  onGround = false;
  clingDir = 0; // 弦化贴墙方向(-1 左墙 / 1 右墙)
  jumpsUsed = 0;
  coyote = 0;
  jumpBuffer = 0;
  dropTimer = 0;
  invuln = 0;
  shootCd = 0;
  meleeT = 0; // 挥击剩余时间
  meleeStep = 0; // 连段 0/1/2
  comboWindow = 0;
  swingId = 0;
  switchCd = 0;
  skillCd: Record<CharId, number> = { michele: 0, kanami: 0 };
  shieldT = 0; // 香奈美护盾
  regenDelay = 0;
  runPhase = 0;
  dead = false;
  shootFlashT = 0;
  /** 弦化残影 */
  private ghosts: { x: number; y: number; t: number }[] = [];
  private ghostAcc = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  get w(): number {
    return this.paper ? 5 : PLAYER_W;
  }

  get h(): number {
    return PLAYER_H;
  }

  rect(): Rect {
    return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h };
  }

  centerX(): number {
    return this.x;
  }

  centerY(): number {
    return this.y - this.h / 2;
  }

  meleeHitbox(): Rect | null {
    if (this.meleeT <= 0) return null;
    const reach = this.meleeStep === 2 ? 24 : 20;
    return {
      x: this.facing > 0 ? this.x + 2 : this.x - 2 - reach,
      y: this.y - this.h - 2,
      w: reach,
      h: this.h + 4,
    };
  }

  meleeDamage(): number {
    return this.meleeStep === 2 ? 20 : 12;
  }

  update(dt: number, ps: PlayState): void {
    const input = ps.input;

    // ---- 计时器 ----
    this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.dropTimer = Math.max(0, this.dropTimer - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.shootCd = Math.max(0, this.shootCd - dt);
    this.switchCd = Math.max(0, this.switchCd - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    this.regenDelay = Math.max(0, this.regenDelay - dt);
    this.skillCd.michele = Math.max(0, this.skillCd.michele - dt);
    this.skillCd.kanami = Math.max(0, this.skillCd.kanami - dt);
    if (this.meleeT > 0) this.meleeT -= dt;
    this.shootFlashT = Math.max(0, this.shootFlashT - dt);

    // 弦化残影
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      this.ghosts[i].t -= dt;
      if (this.ghosts[i].t <= 0) this.ghosts.splice(i, 1);
    }
    if (this.paper) {
      this.ghostAcc += dt;
      if (this.ghostAcc > 0.055 && (Math.abs(this.vx) > 20 || Math.abs(this.vy) > 20)) {
        this.ghostAcc = 0;
        this.ghosts.push({ x: this.x, y: this.y, t: 0.22 });
        if (this.ghosts.length > 6) this.ghosts.shift();
      }
    }

    // ---- 弦化(纸片形态):按住 Shift ----
    const wantPaper = input.down('paper') && this.energy > 1;
    if (wantPaper && !this.paper) {
      this.paper = true;
      ps.sfx('paperOn');
      ps.particles.burst(this.x, this.centerY(), 10, '#aef4ff', 70, 0.4, 'paper');
    } else if (!wantPaper && this.paper) {
      this.paper = false;
      this.clingDir = 0;
      ps.sfx('paperOff');
    }
    if (this.paper) {
      const drain = this.clingDir !== 0 ? 12 : STRING_DRAIN;
      this.energy = Math.max(0, this.energy - drain * dt);
      this.regenDelay = 0.55;
      if (this.energy <= 0) {
        this.paper = false;
        this.clingDir = 0;
        ps.sfx('paperOff');
      }
    } else if (this.regenDelay <= 0) {
      this.energy = Math.min(MAX_STRING, this.energy + STRING_REGEN * dt);
    }

    // ---- 水平移动 ----
    const left = input.down('left');
    const right = input.down('right');
    const moveDir = (right ? 1 : 0) - (left ? 1 : 0);
    const maxSpeed = RUN_SPEED * (this.paper ? PAPER_SPEED_MULT : 1);
    const accel = this.onGround ? RUN_ACCEL : AIR_ACCEL;
    if (moveDir !== 0) {
      this.vx = approach(this.vx, moveDir * maxSpeed, accel * dt);
      this.facing = moveDir;
      this.runPhase += dt * 13;
    } else {
      this.vx = approach(this.vx, 0, accel * dt);
    }

    // ---- 跳跃 ----
    if (input.pressed('jump')) this.jumpBuffer = JUMP_BUFFER;
    const grounded = this.onGround || this.coyote > 0;

    if (this.jumpBuffer > 0) {
      if (input.down('down') && this.onGround && this.standingOnOneway(ps)) {
        // 下落穿过单向平台
        this.dropTimer = 0.22;
        this.jumpBuffer = 0;
        this.onGround = false;
      } else if (this.clingDir !== 0 && !this.onGround) {
        // 弦化蹬墙跳
        this.vx = -this.clingDir * WALL_JUMP_VX;
        this.vy = -WALL_JUMP_VY;
        this.facing = -this.clingDir;
        this.clingDir = 0;
        this.jumpsUsed = 1;
        this.jumpBuffer = 0;
        ps.sfx('doubleJump');
        ps.particles.burst(this.x, this.y, 8, '#aef4ff', 80, 0.35, 'paper');
      } else if (grounded) {
        this.vy = -JUMP_VEL;
        this.onGround = false;
        this.coyote = 0;
        this.jumpsUsed = 1;
        this.jumpBuffer = 0;
        ps.sfx('jump');
      } else if (this.jumpsUsed < 2) {
        this.vy = -DOUBLE_JUMP_VEL;
        this.jumpsUsed = 2;
        this.jumpBuffer = 0;
        ps.sfx('doubleJump');
        ps.particles.burst(this.x, this.y, 6, this.char === 'michele' ? '#8fd7ff' : '#ffb0d8', 60, 0.3);
      }
    }
    // 松开跳跃键短跳
    if (!input.down('jump') && this.vy < -120) {
      this.vy = -120;
    }

    // ---- 重力 / 贴墙滑落 ----
    this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);
    if (this.clingDir !== 0 && this.vy > WALL_SLIDE_SPEED) {
      this.vy = WALL_SLIDE_SPEED;
      if (Math.random() < 0.3) {
        ps.particles.spawn({
          x: this.x + this.clingDir * 3,
          y: this.y - 4,
          vx: 0,
          vy: -20,
          life: 0.3,
          color: '#aef4ff',
          shape: 'paper',
        });
      }
    }

    // ---- 位移与碰撞 ----
    this.moveAndCollide(dt, ps, moveDir);

    // ---- 战斗(纸片形态下不可攻击) ----
    if (!this.paper) {
      if (input.down('shoot') && this.shootCd <= 0) {
        this.shoot(ps);
      }
      if (input.pressed('melee') && this.meleeT <= 0) {
        this.meleeStep = this.comboWindow > 0 ? (this.meleeStep + 1) % 3 : 0;
        this.meleeT = 0.2;
        this.comboWindow = 0.55;
        this.swingId++;
        ps.sfx('melee');
      }
      if (input.pressed('skill')) {
        this.castSkill(ps);
      }
    }

    // ---- 切换角色 ----
    if (input.pressed('switch') && this.switchCd <= 0) {
      this.char = this.char === 'michele' ? 'kanami' : 'michele';
      this.switchCd = SWITCH_CD;
      this.invuln = Math.max(this.invuln, 0.3);
      ps.sfx('switch');
      ps.particles.burst(
        this.x,
        this.centerY(),
        14,
        this.char === 'michele' ? '#8fd7ff' : '#ffb0d8',
        90,
        0.5,
        this.char === 'kanami' ? 'note' : 'snow',
      );
    }
  }

  private shoot(ps: PlayState): void {
    const gy = this.y - 11;
    if (this.char === 'michele') {
      ps.playerBullets.push(makeIceBolt(this.x + this.facing * 8, gy, this.facing));
      this.shootCd = 0.19;
      ps.sfx('shootIce');
    } else {
      for (let i = -1; i <= 1; i++) {
        ps.playerBullets.push(makeNote(this.x + this.facing * 7, gy, this.facing, i));
      }
      this.shootCd = 0.36;
      ps.sfx('shootNote');
    }
    this.shootFlashT = 0.09;
    ps.particles.burst(this.x + this.facing * 10, gy, 3, this.char === 'michele' ? '#7ef0ff' : '#ffb0d8', 40, 0.15);
  }

  private castSkill(ps: PlayState): void {
    if (this.char === 'michele') {
      if (this.skillCd.michele > 0) return;
      this.skillCd.michele = 9;
      ps.freezeNova(this.x, this.centerY());
    } else {
      if (this.skillCd.kanami > 0) return;
      this.skillCd.kanami = 12;
      this.hp = Math.min(MAX_HP, this.hp + 30);
      this.shieldT = 1.5;
      ps.sfx('skillHeal');
      for (let i = 0; i < 12; i++) {
        ps.particles.spawn({
          x: this.x + (Math.random() - 0.5) * 20,
          y: this.y - Math.random() * 20,
          vx: 0,
          vy: -40 - Math.random() * 30,
          life: 0.7,
          color: i % 2 === 0 ? '#ffd75e' : '#ffb0d8',
          shape: 'note',
        });
      }
    }
  }

  /** 受伤。返回是否实际受伤 */
  hurt(dmg: number, fromX: number, ps: PlayState): boolean {
    if (this.invuln > 0 || this.dead) return false;
    if (this.shieldT > 0) {
      ps.particles.burst(this.x, this.centerY(), 8, '#ffd75e', 80, 0.4, 'spark');
      ps.sfx('meleeHit');
      return false;
    }
    this.hp -= dmg;
    this.invuln = INVULN_TIME;
    const dir = this.x < fromX ? -1 : 1;
    this.vx = dir * 150;
    this.vy = -170;
    this.paper = false;
    this.clingDir = 0;
    ps.sfx('hurt');
    ps.shake(4);
    ps.particles.burst(this.x, this.centerY(), 10, '#ff5d7e', 100, 0.5);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
    }
    return true;
  }

  private standingOnOneway(ps: PlayState): boolean {
    const r = this.rect();
    const row = Math.floor((this.y + 1) / TILE);
    const c0 = Math.floor(r.x / TILE);
    const c1 = Math.floor((r.x + r.w - 0.01) / TILE);
    for (let c = c0; c <= c1; c++) {
      const t = ps.tileAt(c, row);
      if (t === T_SOLID || t === T_MEMBRANE) return false;
      if (t === T_ONEWAY) return true;
    }
    return false;
  }

  private solidForMe(t: number): boolean {
    if (t === T_SOLID) return true;
    if (t === T_MEMBRANE) return !this.paper;
    return false;
  }

  private rectBlocked(ps: PlayState, r: Rect): boolean {
    const c0 = Math.floor(r.x / TILE);
    const c1 = Math.floor((r.x + r.w - 0.001) / TILE);
    const r0 = Math.floor(r.y / TILE);
    const r1 = Math.floor((r.y + r.h - 0.001) / TILE);
    for (let c = c0; c <= c1; c++) {
      for (let rr = r0; rr <= r1; rr++) {
        if (this.solidForMe(ps.tileAt(c, rr))) return true;
      }
    }
    return false;
  }

  private moveAndCollide(dt: number, ps: PlayState, moveDir: number): void {
    // --- 水平 ---
    let nx = this.x + this.vx * dt;
    nx = clamp(nx, this.w / 2, ps.mapW - this.w / 2);
    let hitWallDir = 0;
    {
      const r: Rect = { x: nx - this.w / 2, y: this.y - this.h, w: this.w, h: this.h };
      if (this.rectBlocked(ps, r)) {
        const dir = nx > this.x ? 1 : -1;
        // 逐像素回退
        let steps = Math.ceil(Math.abs(nx - this.x)) + 1;
        while (steps-- > 0 && this.rectBlocked(ps, { x: nx - this.w / 2, y: this.y - this.h, w: this.w, h: this.h })) {
          nx -= dir;
        }
        nx = Math.round(nx);
        // 若回退后仍卡住(异常),恢复原位
        if (this.rectBlocked(ps, { x: nx - this.w / 2, y: this.y - this.h, w: this.w, h: this.h })) {
          nx = this.x;
        }
        this.vx = 0;
        hitWallDir = dir;
      }
    }
    this.x = nx;

    // 弦化贴墙判定:空中 + 纸片形态 + 推向墙
    if (this.paper && !this.onGround && moveDir !== 0) {
      const probe: Rect = {
        x: this.x - this.w / 2 + moveDir * 2,
        y: this.y - this.h + 2,
        w: this.w,
        h: this.h - 4,
      };
      this.clingDir = this.rectBlocked(ps, probe) ? moveDir : 0;
    } else if (hitWallDir === 0) {
      this.clingDir = 0;
    }

    // --- 垂直 ---
    let ny = this.y + this.vy * dt;
    this.onGround = false;
    if (this.vy >= 0) {
      // 下落:检查实体 + 单向平台
      const prevFeet = this.y;
      const r: Rect = { x: this.x - this.w / 2, y: ny - this.h, w: this.w, h: this.h };
      let landed = false;
      if (this.rectBlocked(ps, r)) {
        landed = true;
      } else if (this.dropTimer <= 0) {
        // 单向平台:仅当之前脚在平台顶上方
        const rowNew = Math.floor((ny - 0.001) / TILE);
        const rowPrev = Math.floor((prevFeet - 0.001) / TILE);
        if (rowNew > rowPrev || (this.vy > 0 && prevFeet <= rowNew * TILE + 0.5)) {
          const c0 = Math.floor((this.x - this.w / 2) / TILE);
          const c1 = Math.floor((this.x + this.w / 2 - 0.001) / TILE);
          for (let row = Math.max(rowPrev, 0); row <= rowNew; row++) {
            const top = row * TILE;
            if (prevFeet <= top + 0.5 && ny >= top) {
              for (let c = c0; c <= c1; c++) {
                if (ps.tileAt(c, row) === T_ONEWAY) {
                  ny = top;
                  landed = true;
                  break;
                }
              }
            }
            if (landed) break;
          }
        }
      }
      if (landed && this.rectBlocked(ps, { x: this.x - this.w / 2, y: ny - this.h, w: this.w, h: this.h })) {
        // 从实体块上方精确落地
        let steps = Math.ceil(this.vy * dt) + 1;
        while (steps-- > 0 && this.rectBlocked(ps, { x: this.x - this.w / 2, y: ny - this.h, w: this.w, h: this.h })) {
          ny -= 1;
        }
        ny = Math.round(ny);
      }
      if (landed) {
        if (this.vy > 200) {
          ps.particles.burst(this.x, ny, 4, '#9aa4c8', 40, 0.25);
        }
        this.vy = 0;
        this.onGround = true;
        this.jumpsUsed = 0;
        this.coyote = COYOTE_TIME;
        this.clingDir = 0;
      }
    } else {
      // 上升:只挡实体
      const r: Rect = { x: this.x - this.w / 2, y: ny - this.h, w: this.w, h: this.h };
      if (this.rectBlocked(ps, r)) {
        let steps = Math.ceil(Math.abs(this.vy) * dt) + 1;
        while (steps-- > 0 && this.rectBlocked(ps, { x: this.x - this.w / 2, y: ny - this.h, w: this.w, h: this.h })) {
          ny += 1;
        }
        ny = Math.round(ny);
        this.vy = 0;
      }
    }
    this.y = ny;

    if (this.onGround) this.coyote = COYOTE_TIME;
  }

  render(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.dead) return;
    // 弦化残影
    for (const g of this.ghosts) {
      ctx.globalAlpha = (g.t / 0.22) * 0.3;
      ctx.fillStyle = '#8ee8f4';
      ctx.fillRect(Math.round(g.x) - 1, Math.round(g.y) - 21, 3, 21);
      ctx.globalAlpha = 1;
    }
    const blink = this.invuln > 0 && Math.floor(time * 16) % 2 === 0;
    if (blink) return;
    drawChar(ctx, this.char, this.x, this.y, this.facing, {
      runPhase: this.runPhase,
      moving: Math.abs(this.vx) > 12,
      airborne: !this.onGround,
      vy: this.vy,
      paper: this.paper,
      meleeT: this.meleeT > 0 ? 1 - this.meleeT / 0.2 : 0,
      meleeStep: this.meleeStep,
      shootFlash: this.shootFlashT > 0 ? this.shootFlashT / 0.09 : 0,
      hurtFlash: this.invuln > INVULN_TIME - 0.15,
      shield: this.shieldT > 0,
      time,
    });
  }
}
