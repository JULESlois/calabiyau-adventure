import {
  AIR_ACCEL,
  COYOTE_TIME,
  DASH_CD,
  DASH_SPEED,
  DASH_TIME,
  DOUBLE_JUMP_VEL,
  GLIDE_FALL_SPEED,
  GLIDE_GRAVITY_MULT,
  GLIDE_STRING_DRAIN,
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
  WALL_STRING_DRAIN,
  WALL_JUMP_VX,
  WALL_JUMP_VY,
  WALL_SLIDE_SPEED,
} from '../constants';
import { T_MEMBRANE, T_ONEWAY, T_SOLID } from '../levels/levels';
import type { CharId, PlayerHost, StringMode } from '../types';
import type { Rect } from '../utils';
import { approach, clamp } from '../utils';
import { makeQuickNote, makeRifleShot, makeSnipe } from './bullets';
import { drawChar } from '../render/sprites';


const TAKEOFF_ANIM_TIME = 0.12;
const LANDING_ANIM_TIME = 0.16;
const TURN_ANIM_TIME = 0.12;

export class Player {
  x: number; // 脚底中心
  y: number;
  vx = 0;
  vy = 0;
  facing = 1;
  char: CharId = 'michele';
  hp = MAX_HP;
  energy = MAX_STRING;
  stringMode: StringMode = 'normal';
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
  regenDelay = 0;
  runPhase = 0;
  takeoffAnimT = 0;
  landingAnimT = 0;
  turnAnimT = 0;
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

  get paper(): boolean {
    return this.stringMode !== 'normal';
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
    this.takeoffAnimT = TAKEOFF_ANIM_TIME;
    this.landingAnimT = 0;
    this.jumpsUsed = 1;
    this.airDashed = false;
    this.meleeT = 0;
    this.downSlash = false;
  }

  meleeDamage(): number {
    return this.meleeStep === 2 ? 20 : 12;
  }

  private setStringMode(mode: StringMode, ps: PlayerHost): void {
    if (this.stringMode === mode) return;
    const wasPaper = this.paper;
    const previousWidth = this.w;
    const wallDir = this.stringMode === 'wall' ? this.clingDir : 0;
    const wallLeft = wasPaper && mode === 'normal' && this.nearSolidWall(ps, -1);
    const wallRight = wasPaper && mode === 'normal' && this.nearSolidWall(ps, 1);
    this.stringMode = mode;
    if (wasPaper && !this.paper && this.w > previousWidth) {
      // 纸片恢复普通宽度前先向墙外侧让位，避免横向嵌墙被垂直碰撞器向上挤。
      const originalX = this.x;
      const halfExpansion = (this.w - previousWidth) / 2;
      const awayDir =
        wallDir !== 0 ? -wallDir : wallRight && !wallLeft ? -1 : wallLeft && !wallRight ? 1 : 0;
      const offsets =
        awayDir === 0 ? [-halfExpansion, halfExpansion] : [awayDir * halfExpansion, -awayDir * halfExpansion];
      for (const offset of offsets) {
        this.x = clamp(originalX + offset, this.w / 2, ps.mapW - this.w / 2);
        if (!this.rectBlocked(ps, this.rect())) break;
        this.x = originalX;
      }
    }
    if (mode !== 'wall') this.clingDir = 0;
    if (wasPaper === this.paper) return;
    ps.sfx(this.paper ? 'paperOn' : 'paperOff');
    if (this.paper) {
      ps.particles.burst(this.x, this.centerY(), 10, '#aef4ff', 70, 0.4, 'paper');
    }
  }

  private releaseWall(ps: PlayerHost): void {
    this.vx = 0;
    this.vy = 0;
    this.setStringMode('normal', ps);
  }

  private attachToWall(dir: number, ps: PlayerHost): void {
    this.setStringMode('wall', ps);
    // 变薄后保持朝墙一侧的边缘位置不变，避免下一帧因与墙产生缝隙而自动脱离。
    this.x += dir * ((PLAYER_W - this.w) / 2);
    this.clingDir = dir;
    this.facing = dir;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.airDashed = false;
  }

  private jumpAwayFromWall(ps: PlayerHost): void {
    const wallDir = this.clingDir;
    if (wallDir === 0) return;
    this.vx = -wallDir * WALL_JUMP_VX;
    this.vy = -WALL_JUMP_VY;
    this.takeoffAnimT = TAKEOFF_ANIM_TIME;
    this.landingAnimT = 0;
    this.facing = -wallDir;
    this.onGround = false;
    this.coyote = 0;
    this.jumpsUsed = 1;
    this.jumpBuffer = 0;
    this.setStringMode('normal', ps);
    ps.sfx('doubleJump');
    ps.particles.burst(this.x, this.y, 8, '#aef4ff', 80, 0.35, 'paper');
  }

  update(dt: number, ps: PlayerHost): void {
    const input = ps.input;

    // ---- 计时器 ----
    this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.dropTimer = Math.max(0, this.dropTimer - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.shootCd = Math.max(0, this.shootCd - dt);
    this.switchCd = Math.max(0, this.switchCd - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    this.regenDelay = Math.max(0, this.regenDelay - dt);
    this.takeoffAnimT = Math.max(0, this.takeoffAnimT - dt);
    this.landingAnimT = Math.max(0, this.landingAnimT - dt);
    this.turnAnimT = Math.max(0, this.turnAnimT - dt);
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
      this.moveAndCollide(dt, ps);
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
      this.dashCdT = ps.world.chips.has('relic_reactor') ? DASH_CD * 0.6 : DASH_CD;
      if (!this.onGround) this.airDashed = true;
      this.vy = 0;
      ps.sfx('doubleJump');
      ps.particles.burst(this.x - this.facing * 6, this.centerY(), 8, '#7ae0c8', 60, 0.3, 'spark');
    }

    // ---- 弦化形态：地面 Shift 弦化、空中 Shift 飘飞，E 贴墙 ----
    const hasPaper = ps.world.has('paper');
    const hasCling = ps.world.has('cling');
    const holdPaper = input.down('paper');
    const pressPaper = input.pressed('paper');
    const pressWall = input.pressed('wall');

    const wallLeft = this.nearSolidWall(ps, -1);
    const wallRight = this.nearSolidWall(ps, 1);
    const nearAnyWall = (wallLeft ? -1 : 0) || (wallRight ? 1 : 0);
    const startedOnWall = this.stringMode === 'wall';
    let jumpedFromWall = false;

    if (this.stringMode === 'wall') {
      if (pressWall) {
        this.jumpAwayFromWall(ps);
        jumpedFromWall = true;
      } else if (!hasPaper || !hasCling || this.energy <= 0 || !this.nearSolidWall(ps, this.clingDir)) {
        this.releaseWall(ps);
      }
    } else if (pressWall && nearAnyWall !== 0 && hasPaper && hasCling && this.energy > 1) {
      this.attachToWall(nearAnyWall, ps);
    }

    if (this.stringMode !== 'wall') {
      let desired: StringMode = 'normal';
      if (hasPaper && this.energy > 1) {
        if (this.stringMode === 'ground') {
          // 先保持地面形态完成本帧碰撞,确认失去支撑后再切换飘飞。
          desired = holdPaper ? 'ground' : 'normal';
        } else if (this.onGround) {
          desired = holdPaper ? 'ground' : 'normal';
        } else if (this.stringMode === 'glide') {
          desired = holdPaper ? 'glide' : 'normal';
        } else if (holdPaper && pressPaper) {
          // 从地面一路按住 Shift 不会自动飘飞，必须在空中重新按下。
          desired = 'glide';
        }
      }
      this.setStringMode(desired, ps);
    }

    if (this.paper) {
      const baseDrain =
        this.stringMode === 'wall'
          ? WALL_STRING_DRAIN
          : this.stringMode === 'glide'
            ? GLIDE_STRING_DRAIN
            : STRING_DRAIN;
      const drain =
        this.stringMode === 'glide' && ps.world.chips.has('relic_tide') ? baseDrain * 0.75 : baseDrain;
      this.energy = Math.max(0, this.energy - drain * dt);
      this.regenDelay = 0.55;
      if (this.energy <= 0) {
        if (this.stringMode === 'wall') this.releaseWall(ps);
        else this.setStringMode('normal', ps);
      }
    } else if (this.regenDelay <= 0) {
      const regenMul = ps.world.chips.has('chip_regen') ? 1.4 : 1;
      this.energy = Math.min(ps.world.energyMax, this.energy + STRING_REGEN * regenMul * dt);
    }

    // ---- 水平移动 ----
    const left = input.down('left');
    const right = input.down('right');
    const moveDir = (right ? 1 : 0) - (left ? 1 : 0);
    const maxSpeed = RUN_SPEED * (this.paper ? PAPER_SPEED_MULT : this.charging ? 0.6 : 1);
    const accel = this.onGround ? RUN_ACCEL : AIR_ACCEL;
    if (this.stringMode === 'wall') {
      this.vx = 0;
    } else if (moveDir !== 0) {
      this.vx = approach(this.vx, moveDir * maxSpeed, accel * dt);
      if (moveDir !== this.facing && Math.abs(this.vx) > 30) this.turnAnimT = TURN_ANIM_TIME;
      this.facing = moveDir;
    } else {
      this.vx = approach(this.vx, 0, accel * dt);
    }
    if (this.onGround && this.stringMode === 'normal' && Math.abs(this.vx) > 12) {
      const speedRatio = Math.min(1, Math.abs(this.vx) / RUN_SPEED);
      this.runPhase = (this.runPhase + dt * (7 + speedRatio * 11)) % (Math.PI * 2);
    }

    // ---- 跳跃 ----
    // 贴墙和飘飞状态都不接受普通/二段跳输入。
    if (startedOnWall || this.stringMode === 'wall' || this.stringMode === 'glide') {
      this.jumpBuffer = 0;
    } else if (!jumpedFromWall && input.pressed('jump')) {
      this.jumpBuffer = JUMP_BUFFER;
    }
    const grounded = this.onGround || this.coyote > 0;

    if (this.jumpBuffer > 0) {
      if (input.down('down') && this.onGround && this.standingOnOneway(ps)) {
        // 下落穿过单向平台
        this.dropTimer = 0.22;
        this.jumpBuffer = 0;
        this.onGround = false;
      } else if (grounded) {
        this.vy = -JUMP_VEL;
        this.takeoffAnimT = TAKEOFF_ANIM_TIME;
        this.landingAnimT = 0;
        this.onGround = false;
        this.coyote = 0;
        this.jumpsUsed = 1;
        this.jumpBuffer = 0;
        if (this.stringMode === 'ground') this.setStringMode('normal', ps);
        ps.sfx('jump');
      } else if (this.jumpsUsed < 2 && ps.world.has('djump')) {
        this.vy = -DOUBLE_JUMP_VEL;
        this.takeoffAnimT = TAKEOFF_ANIM_TIME;
        this.landingAnimT = 0;
        this.jumpsUsed = 2;
        this.jumpBuffer = 0;
        ps.sfx('doubleJump');
        ps.particles.burst(this.x, this.y, 6, this.char === 'michele' ? '#8fd7ff' : '#ffb0d8', 60, 0.3);
      }
    }
    // 松开跳跃键短跳
    if (!jumpedFromWall && !input.down('jump') && this.vy < -120) {
      this.vy = -120;
    }

    // ---- 重力 / 贴墙上下爬行 / 空中弦化飘飞 ----
    if (this.stringMode === 'wall') {
      const up = input.down('up');
      const down = input.down('down');
      if (up) {
        this.vy = -WALL_SLIDE_SPEED;
      } else if (down) {
        this.vy = WALL_SLIDE_SPEED;
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
    } else if (this.stringMode === 'glide') {
      // 飘飞只减缓下落。上升阶段仍使用普通重力,避免稍晚一帧按 Shift 放大跳跃高度。
      const gravityMultiplier = this.vy < 0 ? 1 : GLIDE_GRAVITY_MULT;
      this.vy = Math.min(this.vy + GRAVITY * gravityMultiplier * dt, GLIDE_FALL_SPEED);
    } else {
      this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);
    }

    // ---- 位移与碰撞 ----
    this.moveAndCollide(dt, ps);
    if (this.stringMode === 'ground' && !this.onGround && this.vy >= 0 && holdPaper && this.energy > 1) {
      this.setStringMode('glide', ps);
    }
    if (this.stringMode === 'glide' && this.onGround) {
      this.setStringMode(holdPaper && this.energy > 1 ? 'ground' : 'normal', ps);
    }

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
  private shoot(ps: PlayerHost): void {
    const gy = this.y - 11;
    ps.playerBullets.push(makeRifleShot(this.x + this.facing * 8, gy, this.facing));
    this.shootCd = 0.14;
    ps.sfx('shootIce');
    this.shootFlashT = 0.09;
    ps.particles.burst(this.x + this.facing * 10, gy, 3, '#7ef0ff', 40, 0.15);
  }

  /** 香奈美·谢幕曲(松开时按蓄力射出) */
  private fireSnipe(ps: PlayerHost): void {
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

  private castSkill(ps: PlayerHost): void {
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
  hurt(dmg: number, fromX: number, ps: PlayerHost): boolean {
    if (this.invuln > 0 || this.dead) return false;
    this.hp -= dmg;
    this.invuln = INVULN_TIME;
    const dir = this.x < fromX ? -1 : 1;
    this.vx = dir * 150;
    this.vy = -170;
    this.setStringMode('normal', ps);
    ps.sfx('hurt');
    ps.shake(4);
    ps.particles.burst(this.x, this.centerY(), 10, '#ff5d7e', 100, 0.5);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
    }
    return true;
  }

  private standingOnOneway(ps: PlayerHost): boolean {
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

  private rectBlocked(ps: PlayerHost, r: Rect): boolean {
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

  /** 返回本帧脚底向下跨过的首个可站立砖块顶面。 */
  private landingSurfaceY(ps: PlayerHost, prevFeet: number, nextFeet: number): number | null {
    const c0 = Math.floor((this.x - this.w / 2) / TILE);
    const c1 = Math.floor((this.x + this.w / 2 - 0.001) / TILE);
    const rowStart = Math.max(0, Math.floor((prevFeet - 0.001) / TILE));
    const rowEnd = Math.floor(nextFeet / TILE);

    for (let row = rowStart; row <= rowEnd; row++) {
      const top = row * TILE;
      if (prevFeet > top + 0.5 || nextFeet < top) continue;

      for (let c = c0; c <= c1; c++) {
        const tile = ps.tileAt(c, row);
        if (this.solidForMe(tile) || (tile === T_ONEWAY && this.dropTimer <= 0)) return top;
      }
    }
    return null;
  }

  /** 检查指定方向 (dir: -1 左 / 1 右) 是否紧贴普通实体墙 (排除弦膜%) */
  nearSolidWall(ps: PlayerHost, dir: number): boolean {
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

  private moveAndCollide(dt: number, ps: PlayerHost): void {
    // --- 水平 ---
    let nx = this.x + this.vx * dt;
    nx = clamp(nx, this.w / 2, ps.mapW - this.w / 2);
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
      }
    }
    this.x = nx;

    // --- 垂直 ---
    let ny = this.y + this.vy * dt;
    this.onGround = false;
    if (this.vy >= 0) {
      // 下落:检查实体 + 单向平台
      const prevFeet = this.y;
      const surfaceY = this.landingSurfaceY(ps, prevFeet, ny);
      let landed = surfaceY !== null;
      if (surfaceY !== null) {
        // 脚底直接吸附到砖块顶面，避免逐像素回退留下 1px 间隙。
        ny = surfaceY;
      } else if (this.rectBlocked(ps, { x: this.x - this.w / 2, y: ny - this.h, w: this.w, h: this.h })) {
        // 异常重叠时保留逐像素脱困，正常落地由上方的跨面检测处理。
        landed = true;
        let steps = Math.ceil(this.vy * dt) + 1;
        while (steps-- > 0 && this.rectBlocked(ps, { x: this.x - this.w / 2, y: ny - this.h, w: this.w, h: this.h })) {
          ny -= 1;
        }
        ny = Math.round(ny);
      }
      if (landed) {
        const impactSpeed = this.vy;
        if (impactSpeed > 200) {
          ps.particles.burst(this.x, ny, 4, '#9aa4c8', 40, 0.25);
        }
        this.vy = 0;
        if (this.stringMode === 'wall') {
          this.onGround = false;
          this.coyote = 0;
        } else {
          if (impactSpeed > 110) {
            this.landingAnimT = LANDING_ANIM_TIME * clamp(impactSpeed / 360, 0.55, 1);
            this.takeoffAnimT = 0;
          }
          this.onGround = true;
          this.jumpsUsed = 0;
          this.coyote = COYOTE_TIME;
          this.clingDir = 0;
        }
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
      moveSpeed: Math.min(1, Math.abs(this.vx) / RUN_SPEED),
      airborne: !this.onGround,
      vy: this.vy,
      takeoff: this.takeoffAnimT / TAKEOFF_ANIM_TIME,
      landing: this.landingAnimT / LANDING_ANIM_TIME,
      turning: this.turnAnimT / TURN_ANIM_TIME,
      paper: this.paper,
      stringMode: this.stringMode,
      meleeT: this.meleeT > 0 ? 1 - this.meleeT / 0.2 : 0,
      meleeStep: this.meleeStep,
      shootFlash: this.shootFlashT > 0 ? this.shootFlashT / 0.09 : 0,
      hurtFlash: this.invuln > INVULN_TIME - 0.15,
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
