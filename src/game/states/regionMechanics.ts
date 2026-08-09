// 区域机关:移动平台、上升气流、压力喷流、共鸣器、传送带、极性终端与永久捷径闸门。
//
// 这些系统彼此独立,只通过 MechanicsHost 这个窄接口回访房间(时间、tile 数据、粒子、玩家位置)。
// 把它们从 PlayState 里搬出来,是为了让"再加一种区域机关"不必再动那个房间状态类。

import { TILE } from '../constants';
import type { ParticleSystem } from '../entities/particles';
import type { Player } from '../entities/Player';
import { T_HIDDEN, type LevelTheme, type ParsedRows } from '../levels/levels';
import { clamp, rectsOverlap, type Rect } from '../utils';
import type { RoomDef, ShortcutDef } from '../world/world';

export interface Mover {
  baseX: number;
  baseY: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  w: number;
  h: number;
  axis: 'h' | 'v';
  range: number;
  speed: number;
  phase: number;
}

export interface Updraft {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PressureJet {
  x: number;
  y: number;
  w: number;
  h: number;
  dir: -1 | 1;
  phase: number;
}

export interface Resonator {
  x: number;
  y: number;
  phase: number;
  beat: number;
}

export interface Conveyor {
  x: number;
  y: number;
  w: number;
  dir: -1 | 1;
}

export interface ShortcutRuntime {
  def: ShortcutDef;
  gate: Rect;
  lever: { x: number; y: number };
}

/** 机关需要向房间回问的最小集合,由 PlayState 实现。 */
export interface MechanicsHost {
  readonly time: number;
  readonly level: ParsedRows;
  readonly theme: LevelTheme;
  readonly particles: ParticleSystem;
  readonly playerX: number;
  readonly playerY: number;
  sfx(name: string): void;
  /** 让隐藏平台显形 seconds 秒(tile 线性索引)。 */
  revealHiddenTile(tileIndex: number, seconds: number): void;
  isShortcutOpen(id: string): boolean;
  isFlagSet(flag: string): boolean;
}

/** 移动平台位移只由时间决定,因此跨房间与存档回放都能对齐。 */
export function moverDisplacement(time: number, speed: number, phase: number, range: number): number {
  return Math.sin(time * speed + phase) * range;
}

const RESONATOR_PERIOD = 2.8;
const RESONATOR_RADIUS = 150;

export class RegionMechanics {
  movers: Mover[] = [];
  updrafts: Updraft[] = [];
  pressureJets: PressureJet[] = [];
  resonators: Resonator[] = [];
  conveyors: Conveyor[] = [];
  polaritySpots: { x: number; y: number }[] = [];
  polarityOpen = false;
  shortcuts: ShortcutRuntime[] = [];
  /** Boss 死亡才解封的屏障(每房间至多一道) */
  bossGate: RoomDef['bossGate'] = undefined;

  constructor(private host: MechanicsHost) {}

  // ---------------- 建造 ----------------

  /** 消费一个关卡生成点字符;返回 false 表示该字符不属于区域机关。 */
  spawn(char: string, cx: number, bottom: number, col: number, row: number): boolean {
    switch (char) {
      case 'M':
        this.movers.push({
          baseX: cx, baseY: row * TILE, x: cx, y: row * TILE,
          prevX: cx, prevY: row * TILE, w: 40, h: 6,
          axis: 'h', range: 52, speed: 1.1, phase: col * 0.7,
        });
        return true;
      case 'N':
        this.movers.push({
          baseX: cx, baseY: row * TILE, x: cx, y: row * TILE,
          prevX: cx, prevY: row * TILE, w: 40, h: 6,
          axis: 'v', range: 62, speed: 0.9, phase: col * 0.7,
        });
        return true;
      case 'U':
        this.updrafts.push({ x: cx - 48, y: bottom - 104, w: 96, h: 104 });
        return true;
      case '>':
      case '<': {
        const dir = char === '>' ? 1 : -1;
        this.pressureJets.push({
          x: dir > 0 ? cx - 8 : cx - 88,
          y: bottom - 48,
          w: 96,
          h: 48,
          dir,
          phase: col * 0.31,
        });
        return true;
      }
      case 'I':
        this.polaritySpots.push({ x: cx, y: bottom });
        return true;
      case 'O':
        this.resonators.push({ x: cx, y: bottom - 9, phase: col * 0.07, beat: -1 });
        return true;
      case 'K':
      case 'k':
        this.conveyors.push({ x: cx - 32, y: bottom - 4, w: 64, dir: char === 'K' ? 1 : -1 });
        return true;
      default:
        return false;
    }
  }

  buildShortcuts(defs: readonly ShortcutDef[]): void {
    this.shortcuts = defs.map((def) => ({
      def,
      gate: {
        x: def.gate.col * TILE,
        y: def.gate.row * TILE,
        w: def.gate.w * TILE,
        h: def.gate.h * TILE,
      },
      lever: {
        x: def.lever.col * TILE + TILE / 2,
        y: (def.lever.row + 1) * TILE,
      },
    }));
  }

  // ---------------- 查询 ----------------

  /** 未开启的捷径闸门与未打通的守卫屏障在 tile 层面都等同于实心墙。 */
  gateSolidAt(c: number, r: number): boolean {
    for (const shortcut of this.shortcuts) {
      if (this.host.isShortcutOpen(shortcut.def.id)) continue;
      const g = shortcut.def.gate;
      if (c >= g.col && c < g.col + g.w && r >= g.row && r < g.row + g.h) return true;
    }
    const boss = this.bossGate;
    if (boss && !this.host.isFlagSet(boss.flag)) {
      const g = boss.gate;
      if (c >= g.col && c < g.col + g.w && r >= g.row && r < g.row + g.h) return true;
    }
    return false;
  }

  pressureJetActive(jet: PressureJet): boolean {
    return Math.sin(this.host.time * 2.2 + jet.phase) > -0.2;
  }

  // ---------------- 每帧推进 ----------------

  /** 移动平台:先记住上一帧位置,骑乘判定要用到位移增量。 */
  advanceMovers(): void {
    for (const m of this.movers) {
      m.prevX = m.x;
      m.prevY = m.y;
      const s = moverDisplacement(this.host.time, m.speed, m.phase, m.range);
      if (m.axis === 'h') m.x = m.baseX + s;
      else m.y = m.baseY + s;
    }
  }

  /** 把平台对齐到当前 time(入场与过场用),resetPrevious 时同时抹掉位移增量。 */
  syncMoversToTime(resetPrevious: boolean): void {
    for (const mover of this.movers) {
      const displacement = moverDisplacement(this.host.time, mover.speed, mover.phase, mover.range);
      if (mover.axis === 'h') mover.x = mover.baseX + displacement;
      else mover.y = mover.baseY + displacement;
      if (resetPrevious) {
        mover.prevX = mover.x;
        mover.prevY = mover.y;
      }
    }
  }

  /** 圣堂共鸣器:按节拍显形半径内的隐藏平台。 */
  updateResonators(): void {
    const host = this.host;
    const level = host.level;
    for (const resonator of this.resonators) {
      const beat = Math.floor((host.time + resonator.phase) / RESONATOR_PERIOD);
      if (beat === resonator.beat) continue;
      resonator.beat = beat;
      const c0 = Math.max(0, Math.floor((resonator.x - RESONATOR_RADIUS) / TILE));
      const c1 = Math.min(level.w - 1, Math.floor((resonator.x + RESONATOR_RADIUS) / TILE));
      const r0 = Math.max(0, Math.floor((resonator.y - RESONATOR_RADIUS) / TILE));
      const r1 = Math.min(level.h - 1, Math.floor((resonator.y + RESONATOR_RADIUS) / TILE));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (level.tiles[r * level.w + c] !== T_HIDDEN) continue;
          const x = c * TILE + TILE / 2;
          const y = r * TILE + TILE / 2;
          if (Math.hypot(x - resonator.x, y - resonator.y) <= RESONATOR_RADIUS) {
            host.revealHiddenTile(r * level.w + c, 1.2);
          }
        }
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        host.particles.spawn({
          x: resonator.x + Math.cos(a) * 8,
          y: resonator.y + Math.sin(a) * 8,
          vx: Math.cos(a) * 120,
          vy: Math.sin(a) * 120,
          life: 0.42,
          color: '#f0b4dc',
          shape: 'note',
          size: 1,
        });
      }
      if (Math.hypot(host.playerX - resonator.x, host.playerY - resonator.y) < 240) host.sfx('switch');
    }
  }

  // ---------------- 作用于玩家 ----------------

  /** 上升气流:只托起空中飘飞的纸片形态。 */
  applyUpdrafts(dt: number, p: Player): void {
    if (p.stringMode !== 'glide') return;
    const pr = p.rect();
    for (const u of this.updrafts) {
      if (!rectsOverlap(pr, u)) continue;
      p.vy = Math.max(-150, p.vy - 520 * dt);
      if (Math.random() < 0.35) {
        this.host.particles.spawn({
          x: p.x + (Math.random() - 0.5) * 14,
          y: p.y - Math.random() * p.h,
          vx: (Math.random() - 0.5) * 12,
          vy: -40 - Math.random() * 35,
          life: 0.35,
          color: '#e8f4ff',
          shape: 'paper',
          size: 1,
        });
      }
    }
  }

  /** 沉潮地窟压力喷流:纸片受力更大。 */
  applyPressureJets(dt: number, p: Player): void {
    if (p.stringMode === 'wall') return;
    const pr = p.rect();
    for (const jet of this.pressureJets) {
      if (!this.pressureJetActive(jet) || !rectsOverlap(pr, jet)) continue;
      const force = p.paper ? 520 : 260;
      p.vx = clamp(p.vx + jet.dir * force * dt, -190, 190);
      if (Math.random() < 0.18) {
        this.host.particles.spawn({
          x: p.x - jet.dir * (4 + Math.random() * 10),
          y: p.centerY() + (Math.random() - 0.5) * 16,
          vx: jet.dir * (45 + Math.random() * 35),
          vy: (Math.random() - 0.5) * 18,
          life: 0.28,
          color: '#8de0c4',
          shape: 'spark',
          size: 1,
        });
      }
    }
  }

  rideMovers(p: Player): void {
    const pr = p.rect();
    for (const m of this.movers) {
      const top = m.y;
      const mx0 = m.x - m.w / 2;
      const mx1 = m.x + m.w / 2;
      const overlapX = pr.x + pr.w > mx0 && pr.x < mx1;
      if (!overlapX) continue;
      const dy = m.y - m.prevY;
      if (p.vy >= 0 && p.y >= top - 8 && p.y <= top + Math.max(8, dy + 8)) {
        p.y = top;
        p.vy = 0;
        p.onGround = true;
        p.jumpsUsed = 0;
        p.x += m.x - m.prevX;
      }
    }
  }

  rideConveyors(dt: number, p: Player): void {
    if (!p.onGround || p.stringMode === 'wall') return;
    for (const belt of this.conveyors) {
      if (p.x < belt.x || p.x > belt.x + belt.w || Math.abs(p.y - (belt.y + 4)) > 5) continue;
      p.vx = clamp(p.vx + belt.dir * 420 * dt, -155, 155);
    }
  }

  // ---------------- 渲染 ----------------

  /** 绘制顺序与原先 PlayState 内联时一致:喷流/传送带/共鸣器/终端/闸门 → 气流 → 平台。 */
  render(ctx: CanvasRenderingContext2D): void {
    const { time, theme } = this.host;

    for (const jet of this.pressureJets) {
      const active = this.pressureJetActive(jet);
      ctx.save();
      ctx.globalAlpha = active ? 0.2 : 0.06;
      ctx.fillStyle = '#8de0c4';
      ctx.fillRect(jet.x, jet.y, jet.w, jet.h);
      ctx.strokeStyle = '#b8f4df';
      ctx.globalAlpha = active ? 0.48 : 0.14;
      for (let i = 0; i < 6; i++) {
        const travel = (time * (active ? 72 : 18) + i * 19) % jet.w;
        const x = jet.dir > 0 ? jet.x + travel : jet.x + jet.w - travel;
        const y = jet.y + 7 + ((i * 13) % Math.max(8, jet.h - 14));
        ctx.beginPath();
        ctx.moveTo(Math.round(x - jet.dir * 10), Math.round(y));
        ctx.lineTo(Math.round(x), Math.round(y));
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const belt of this.conveyors) {
      ctx.fillStyle = '#1b2028';
      ctx.fillRect(belt.x, belt.y, belt.w, 4);
      ctx.fillStyle = theme.accent;
      for (let i = 0; i < belt.w; i += 10) {
        const raw = (time * 30 * belt.dir + i) % belt.w;
        const off = Math.floor((raw + belt.w) % belt.w);
        ctx.fillRect(belt.x + off, belt.y + 1, 4, 1);
      }
      ctx.fillStyle = '#758090';
      ctx.fillRect(belt.x, belt.y, belt.w, 1);
    }

    for (const resonator of this.resonators) {
      const cycle = ((time + resonator.phase) % RESONATOR_PERIOD) / RESONATOR_PERIOD;
      ctx.save();
      ctx.globalAlpha = (1 - cycle) * 0.3;
      ctx.strokeStyle = '#f0b4dc';
      ctx.beginPath();
      ctx.arc(resonator.x, resonator.y, 8 + cycle * 70, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#39243f';
      ctx.fillRect(resonator.x - 6, resonator.y - 7, 12, 7);
      ctx.fillStyle = '#f0b4dc';
      ctx.fillRect(resonator.x - 2, resonator.y - 12, 4, 7);
      ctx.fillStyle = '#fff0fa';
      ctx.fillRect(resonator.x - 1, resonator.y - 11, 2, 2);
      ctx.restore();
    }

    for (const spot of this.polaritySpots) {
      ctx.fillStyle = '#18243a';
      ctx.fillRect(spot.x - 6, spot.y - 18, 12, 18);
      ctx.strokeStyle = '#7088b8';
      ctx.strokeRect(spot.x - 5.5, spot.y - 17.5, 11, 17);
      ctx.fillStyle = this.polarityOpen ? '#8de0c4' : '#e878c0';
      ctx.fillRect(spot.x - 2, spot.y - 14, 4, 4);
    }

    for (const shortcut of this.shortcuts) {
      const open = this.host.isShortcutOpen(shortcut.def.id);
      if (!open) {
        const gate = shortcut.gate;
        ctx.fillStyle = 'rgba(20,18,28,0.78)';
        ctx.fillRect(gate.x, gate.y, gate.w, gate.h);
        ctx.strokeStyle = '#b58b4a';
        ctx.strokeRect(gate.x + 0.5, gate.y + 0.5, gate.w - 1, gate.h - 1);
        ctx.fillStyle = '#74654f';
        for (let x = gate.x + 3; x < gate.x + gate.w; x += 6) ctx.fillRect(x, gate.y, 2, gate.h);
        for (let y = gate.y + 7; y < gate.y + gate.h; y += 12) ctx.fillRect(gate.x, y, gate.w, 2);
      }
      const lever = shortcut.lever;
      ctx.fillStyle = '#25222c';
      ctx.fillRect(lever.x - 6, lever.y - 17, 12, 17);
      ctx.strokeStyle = '#75664d';
      ctx.strokeRect(lever.x - 5.5, lever.y - 16.5, 11, 16);
      ctx.fillStyle = open ? '#8de0c4' : '#d8a850';
      ctx.fillRect(lever.x - 2, lever.y - 13, 4, 4);
      ctx.fillRect(lever.x - (open ? 1 : 4), lever.y - 10, 2, 6);
    }

    // 守卫屏障:与捷径闸门刻意不同 —— 没有拉杆,只有封印纹样。
    const bossGate = this.bossGate;
    if (bossGate && !this.host.isFlagSet(bossGate.flag)) {
      const g = bossGate.gate;
      const x = g.col * TILE;
      const y = g.row * TILE;
      const w = g.w * TILE;
      const h = g.h * TILE;
      ctx.fillStyle = 'rgba(24,14,34,0.82)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#8a5ec8';
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.25 * Math.abs(Math.sin(time * 2.4));
      ctx.fillStyle = '#c47eff';
      for (let yy = y + 3; yy < y + h - 2; yy += 7) ctx.fillRect(x + 1, yy, w - 2, 1);
      ctx.fillRect(x + w / 2 - 1, y + 2, 2, h - 4);
      ctx.restore();
    }

    // 上升气流
    for (const u of this.updrafts) {
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = theme.accent;
      ctx.fillRect(u.x, u.y, u.w, u.h);
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const xx = u.x + 7 + ((i * 29 + time * 24) % Math.max(1, u.w - 14));
        const yy = u.y + u.h - ((i * 31 + time * 46) % u.h);
        ctx.beginPath();
        ctx.moveTo(Math.round(xx), Math.round(yy + 9));
        ctx.quadraticCurveTo(xx + Math.sin(time * 2 + i) * 4, yy + 4, xx, yy);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 移动平台
    for (const m of this.movers) {
      const x = Math.round(m.x - m.w / 2);
      const y = Math.round(m.y);
      ctx.fillStyle = theme.tileEdge;
      ctx.fillRect(x, y, m.w, 2);
      ctx.fillStyle = theme.tileBase;
      ctx.fillRect(x, y + 2, m.w, m.h - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x, y + m.h - 1, m.w, 1);
      ctx.fillStyle = theme.accent;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x + 3, y + 3, 2, 2);
      ctx.fillRect(x + m.w - 5, y + 3, 2, 2);
      ctx.globalAlpha = 1;
    }
  }
}
