import {
  AIR_ACCEL,
  COYOTE_TIME,
  DASH_CD,
  DASH_SPEED,
  DASH_TIME,
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
import { makeQuickNote, makeRifleShot, makeSnipe } from './bullets';
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
  /** 香奈美·谢幕曲蓄力(秒,满蓄 0.7) */
  chargeT = 0;
  charging = false;
  /** 相位突进 */
  dashT = 0;
  dashCdT = 0;
  airDashed = false;
  /** 下劈(pogo) */
  downSlash = false;
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
    if (this.downSlash) {
      return { x: this.x - 8, y: this.y - 4, w: 16, h: 14 };
    }
    const reach = this.meleeStep === 2 ? 24 : 20;
    return {
      x: this.facing > 0 ? this.x + 2 : this.x - 2 - reach,
      y: this.y - this.h - 2,
      w: reach,
      h: this.h + 4,
    };
  }

  /** 下劈命中后的反弹(重置二段跳与空中冲刺) */
  pogoBounce(): void {
    this.vy = -290;
    this.jumpsUsed = 1;
    this.airDashed = false;
    this.meleeT = 0;
    this.downSlash = false;
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
    this.dashCdT = Math.max(0, this.dashCdT - dt);
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

    // ---- 相位突进(冲刺)----
    if (this.onGround || this.clingDir !== 0) this.airDashed = false;
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.facing * DASH_SPEED;
      this.vy = 0;
      this.moveAndCollide(dt, ps, this.facing);
      this.ghostAcc += dt;
      if (this.ghostAcc > 0.03) {
        this.ghostAcc = 0;
        this.ghosts.push({ x: this.x, y: this.y, t: 0.2 });
        if (this.ghosts.length > 6) this.ghosts.shift();
      }
      return;
    }
    if (
      ps.world.has('dash') &&
      input.pressed('dash') &&
      this.dashCdT <= 0 &&
      !this.paper &&
      (this.onGround || !this.airDashed)
    ) {
      this.dashT = DASH_TIME;
      this.dashCdT = DASH_CD;
      if (!this.onGround) this.airDashed = true;
      this.vy = 0;
      ps.sfx('doubleJump');
      ps.particles.burst(this.x - this.facing * 6, this.centerY(), 8, '#7ae0c8', 60, 0.3, 'spark');
    }

    // ---- 弦化(纸片形态) & 贴墙爬行 & 空中滑翔 ----
    const hasPaper = ps.world.has('paper');
    const hasCling = ps.world.has('cling');
    const holdPaper = input.down('paper');
    const pressInteract = input.pressed('interact');

    const wallLeft = this.nearSolidWall(ps, -1);
    const wallRight = this.nearSolidWall(ps, 1);
    const nearAnyWall = (wallLeft ? -1 : 0) || (wallRight ? 1 : 0);

    // 贴墙按 E (或使用弦化/贴墙能力) 进入贴墙弦化状态 (在弦膜%旁不可进行贴墙E交互)
    if (pressInteract && nearAnyWall !== 0 && hasPaper && this.energy > 1) {
      if (this.clingDir !== 0) {
        this.clingDir = 0;
        this.paper = false;
        ps.sfx('paperOff');
      } else {
        this.paper = true;
        this.clingDir = nearAnyWall;
        this.facing = nearAnyWall;
        ps.sfx('paperOn');
        ps.particles.burst(this.x, this.centerY(), 8, '#aef4ff', 70, 0.4, 'paper');
      }
    } else if (holdPaper && hasPaper && this.energy > 1) {
      if (!this.paper) {
        this.paper = true;
        ps.sfx('paperOn');
        ps.particles.burst(this.x, this.centerY(), 10, '#aef4ff', 70, 0.4, 'paper');
      }
      if (hasCling && nearAnyWall !== 0 && this.clingDir === 0 && !this.onGround) {
        this.clingDir = nearAnyWall;
      }
    } else if (!holdPaper && this.clingDir === 0 && this.paper) {
      this.paper = false;
      ps.sfx('paperOff');
    }

    if (this.clingDir !== 0) {
      if (!this.nearSolidWall(ps, this.clingDir) || this.energy <= 0) {
        this.clingDir = 0;
        this.paper = false;
        ps.sfx('paperOff');
      }
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
      const regenMul = ps.world.chips.has('chip_regen') ? 1.4 : 1;
      this.energy = Math.min(MAX_STRING, this.energy + STRING_REGEN * regenMul * dt);
    }

    // ---- 水平移动 ----
    const left = input.down('left');
    const right = input.down('right');
    const moveDir = (right ? 1 : 0) - (left ? 1 : 0);
    const maxSpeed = RUN_SPEED * (this.paper ? PAPER_SPEED_MULT : this.charging ? 0.6 : 1);
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
      } else if (this.jumpsUsed < 2 && ps.world.has('djump')) {
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

    // ---- 重力 / 贴墙上下爬行 / 空中弦化飘飞(滑翔) ----
    if (this.clingDir !== 0) {
      const up = input.down('up');
      const down = input.down('down');
      if (up) {
        this.vy = -110;
      } else if (down) {
        this.vy = 110;
      } else {
        this.vy = 0;
      }
      if (Math.random() < 0.2) {
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
    } else {
      this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);
      if (this.paper && !this.onGround && this.vy > 35) {
        this.vy = 35; // 空中弦化飘飞(滑翔)
      }
    }

    // ---- 位移与碰撞 ----
    this.moveAndCollide(dt, ps, moveDir);

    // ---- 战斗(纸片形态下不可攻击) ----
    if (!this.paper) {
      const shootDown = input.down('shoot');
      if (this.char === 'michele') {
        // 警探:全自动速射
        this.charging = false;
        this.chargeT = 0;
        if (shootDown && this.shootCd <= 0) {
          this.shoot(ps);
        }
      } else {
        // 谢幕曲:长按蓄力,松开射出
        if (shootDown && this.shootCd <= 0) {
          if (!this.charging) ps.sfx('paperOff');
          this.charging = true;
          this.chargeT = Math.min(0.7, this.chargeT + dt);
        } else if (!shootDown && this.charging) {
          this.fireSnipe(ps);
          this.charging = false;
          this.chargeT = 0;
        }
      }
      if (input.pressed('melee') && this.meleeT <= 0) {
        if (!this.onGround && input.down('down')) {
          // 下劈(pogo)
          this.downSlash = true;
          this.meleeStep = 0;
          this.meleeT = 0.22;
          this.swingId++;
          ps.sfx('melee');
        } else {
          this.downSlash = false;
          this.meleeStep = this.comboWindow > 0 ? (this.meleeStep + 1) % 3 : 0;
          this.meleeT = 0.2;
          this.comboWindow = 0.55;
          this.swingId++;
          ps.sfx('melee');
        }
      }
      if (this.downSlash && this.onGround) this.downSlash = false;
      if (input.pressed('skill')) {
        this.castSkill(ps);
      }
    }

    if (this.paper) {
      this.charging = false;
      this.chargeT = 0;
    }

    // ---- 切换角色(需香奈美已加入)----
    if (input.pressed('switch') && this.switchCd <= 0 && ps.world.has('kanami')) {
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

  /** 米雪儿·警探速射 */
  private shoot(ps: PlayState): void {
    const gy = this.y - 11;
    ps.playerBullets.push(makeRifleShot(this.x + this.facing * 8, gy, this.facing));
    this.shootCd = 0.14;
    ps.sfx('shootIce');
    this.shootFlashT = 0.09;
    ps.particles.burst(this.x + this.facing * 10, gy, 3, '#7ef0ff', 40, 0.15);
  }

  /** 香奈美·谢幕曲(松开时按蓄力射出) */
  private fireSnipe(ps: PlayState): void {
    const gy = this.y - 11;
    if (this.chargeT < 0.15) {
      ps.playerBullets.push(makeQuickNote(this.x + this.facing * 7, gy, this.facing));
      this.shootCd = 0.28;
      ps.sfx('shootNote');
    } else {
      const charge = this.chargeT / 0.7;
      ps.playerBullets.push(makeSnipe(this.x + this.facing * 8, gy, this.facing, charge));
      this.shootCd = 0.45;
      ps.sfx('shootNote');
      ps.sfx('melee');
      if (charge > 0.85) ps.shake(2);
      ps.particles.burst(this.x + this.facing * 12, gy, 6, '#ff8ad0', 70, 0.25, 'spark');
    }
    this.shootFlashT = 0.09;
    ps.particles.burst(this.x + this.facing * 10, gy, 3, '#ffb0d8', 40, 0.15);
  }

  private castSkill(ps: PlayState): void {
    if (this.char === 'michele') {
      // 喵喵卫士:部署猫炮塔
      if (this.skillCd.michele > 0) return;
      this.skillCd.michele = 9;
      ps.deployTurret(this.x + this.facing * 10, this.y);
    } else {
      // 旋律回响:掷出声呐镖
      if (this.skillCd.kanami > 0) return;
      this.skillCd.kanami = 10;
      ps.throwSonarDart(this.x + this.facing * 6, this.y - 14, this.facing);
      ps.sfx('skillHeal');
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

  /** 检查指定方向 (dir: -1 左 / 1 右) 是否紧贴普通实体墙 (排除弦膜%) */
  nearSolidWall(ps: PlayState, dir: number): boolean {
    const r = this.rect();
    const probe: Rect = {
      x: dir < 0 ? r.x - 3 : r.x + r.w,
      y: r.y + 2,
      w: 3,
      h: r.h - 4,
    };
    const c0 = Math.floor(probe.x / TILE);
    const c1 = Math.floor((probe.x + probe.w - 0.001) / TILE);
    const r0 = Math.floor(probe.y / TILE);
    const r1 = Math.floor((probe.y + probe.h - 0.001) / TILE);
    for (let c = c0; c <= c1; c++) {
      for (let rr = r0; rr <= r1; rr++) {
        if (ps.tileAt(c, rr) === T_SOLID) return true;
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

    // 弦化贴墙判定:空中 + 纸片形态 + 推向墙(需已获得「矩阵适配」)
    if (this.paper && ps.world.has('cling') && !this.onGround && moveDir !== 0) {
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
    // 谢幕曲蓄力条
    if (this.charging) {
      const p = this.chargeT / 0.7;
      const bx = Math.round(this.x) - 8;
      const by = Math.round(this.y) - this.h - 7;
      ctx.fillStyle = 'rgba(10,7,16,0.7)';
      ctx.fillRect(bx, by, 16, 3);
      ctx.fillStyle = p >= 1 ? '#ffd75e' : '#ff8ad0';
      ctx.fillRect(bx + 1, by + 1, Math.round(14 * p), 1);
      if (p >= 1 && Math.floor(time * 10) % 2 === 0) {
        ctx.fillStyle = '#fff2c0';
        ctx.fillRect(bx + 15, by, 2, 3);
      }
    }
  }
}
