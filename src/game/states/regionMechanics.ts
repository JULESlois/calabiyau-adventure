// 区域机关:移动平台、上升气流、压力喷流、共鸣器、传送带、极性终端与永久捷径闸门。
//
// 这些系统彼此独立,只通过 MechanicsHost 这个窄接口回访房间(时间、tile 数据、粒子、玩家位置)。
// 把它们从 PlayState 里搬出来,是为了让"再加一种区域机关"不必再动那个房间状态类。

import { NODE_LIT_TIME, TILE } from '../constants';
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
  /** 受电平台:只在回路点亮期间运转 */
  powered?: boolean;
  /** 受电平台的私有运行时钟(只在通电时推进,断电即冻结在原位) */
  runT?: number;
}

/** 导能节点(#63):被满充电荷的攻击命中后点亮回路数秒。 */
export interface ConductiveNode {
  x: number;
  y: number;
  litT: number;
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

/** 弦镜偏转:发射器 → (玩家在节点上弦化)折转 → 接收器。 */
export interface BeamEmitter {
  x: number;
  y: number;
}

export interface MirrorSocket {
  x: number;
  y: number;
  /** 本帧是否有纸片玩家站位(渲染发光用) */
  active: boolean;
}

export interface BeamReceiver {
  x: number;
  y: number;
  /** 充能 0..1;满则触发一次长显形 */
  charge: number;
  /** 触发后的点亮余辉(渲染) */
  litT: number;
}

/** 当帧解算出的能束折线(渲染用) */
export interface BeamPath {
  segs: { x0: number; y0: number; x1: number; y1: number }[];
  bent: boolean;
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
  readonly playerPaper: boolean;
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
  conductiveNodes: ConductiveNode[] = [];
  emitters: BeamEmitter[] = [];
  mirrorSockets: MirrorSocket[] = [];
  receivers: BeamReceiver[] = [];
  /** 当帧能束(渲染缓存,updateBeams 重建) */
  beams: BeamPath[] = [];

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
      case 'E':
        this.emitters.push({ x: cx, y: bottom - 10 });
        return true;
      case 'Q':
        this.conductiveNodes.push({ x: cx, y: bottom, litT: 0 });
        return true;
      case 'm':
        this.movers.push({
          baseX: cx, baseY: row * TILE, x: cx, y: row * TILE,
          prevX: cx, prevY: row * TILE, w: 40, h: 6,
          axis: 'h', range: 52, speed: 1.1, phase: 0, powered: true, runT: 0,
        });
        return true;
      case 'n':
        this.movers.push({
          baseX: cx, baseY: row * TILE, x: cx, y: row * TILE,
          prevX: cx, prevY: row * TILE, w: 40, h: 6,
          axis: 'v', range: 62, speed: 0.9, phase: 0, powered: true, runT: 0,
        });
        return true;
      case 'C':
        this.mirrorSockets.push({ x: cx, y: bottom, active: false });
        return true;
      case 'V':
        this.receivers.push({ x: cx, y: bottom - 8, charge: 0, litT: 0 });
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

  /** 任一节点点亮即视为本房间回路通电(房间都不大,不做逐台配线)。 */
  get circuitLit(): boolean {
    return this.conductiveNodes.some((node) => node.litT > 0);
  }

  /**
   * 满充攻击命中节点则点亮回路;返回是否命中(调用方据此消耗玩家电荷)。
   * 未满充的攻击打在节点上没有任何效果 —— 电荷才是钥匙,不是子弹。
   */
  tryDischarge(attack: Rect): boolean {
    for (const node of this.conductiveNodes) {
      const zone: Rect = { x: node.x - 10, y: node.y - 24, w: 20, h: 24 };
      if (!rectsOverlap(attack, zone)) continue;
      node.litT = NODE_LIT_TIME;
      this.host.sfx('switch');
      this.host.particles.burst(node.x, node.y - 12, 14, '#ffd75e', 100, 0.5, 'spark');
      return true;
    }
    return false;
  }

  pressureJetActive(jet: PressureJet): boolean {
    return Math.sin(this.host.time * 2.2 + jet.phase) > -0.2;
  }

  // ---------------- 每帧推进 ----------------

  /** 移动平台:先记住上一帧位置,骑乘判定要用到位移增量。 */
  advanceMovers(dt = 0): void {
    for (const node of this.conductiveNodes) node.litT = Math.max(0, node.litT - dt);
    const lit = this.circuitLit;
    for (const m of this.movers) {
      m.prevX = m.x;
      m.prevY = m.y;
      if (m.powered) {
        // 受电平台用私有时钟:断电即冻结,不会因全局时间流逝而瞬移。
        if (!lit) continue;
        m.runT = (m.runT ?? 0) + dt;
        const sp = moverDisplacement(m.runT, m.speed, m.phase, m.range);
        if (m.axis === 'h') m.x = m.baseX + sp;
        else m.y = m.baseY + sp;
        continue;
      }
      const s = moverDisplacement(this.host.time, m.speed, m.phase, m.range);
      if (m.axis === 'h') m.x = m.baseX + s;
      else m.y = m.baseY + s;
    }
  }

  /** 把平台对齐到当前 time(入场与过场用),resetPrevious 时同时抹掉位移增量。 */
  syncMoversToTime(resetPrevious: boolean): void {
    for (const mover of this.movers) {
      if (mover.powered) continue; // 受电平台走私有时钟,入场对齐无意义
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

  /**
   * 弦镜偏转(#43):校准能束沿直线传播;玩家在弦镜节点上弦化时,
   * 自己的纸片身体成为弦面,把经过节点的能束折转 90° 射向接收器。
   * 接收器充能约 1 秒后触发一次长显形(7 秒),点亮附近的隐藏平台路径。
   * 能束不造成伤害 —— 它是纯解谜语言,考的是"站对位置 + 保持形态"。
   */
  updateBeams(dt: number): void {
    this.beams.length = 0;
    if (this.emitters.length === 0) return;
    const host = this.host;
    const level = host.level;
    const solidAt = (x: number, y: number): boolean => {
      const c = Math.floor(x / TILE);
      const r = Math.floor(y / TILE);
      if (c < 0 || c >= level.w) return true;
      if (r < 0 || r >= level.h) return false;
      return level.tiles[r * level.w + c] === 1; // T_SOLID
    };

    for (const socket of this.mirrorSockets) {
      socket.active = host.playerPaper
        && Math.abs(host.playerX - socket.x) < 14
        && Math.abs(host.playerY - (socket.y - 12)) < 26;
    }

    const hitReceivers = new Set<BeamReceiver>();
    for (const emitter of this.emitters) {
      // 朝最近的弦镜节点方向发射;没有节点就朝右。
      let nearest: MirrorSocket | null = null;
      for (const socket of this.mirrorSockets) {
        if (!nearest || Math.abs(socket.x - emitter.x) < Math.abs(nearest.x - emitter.x)) nearest = socket;
      }
      const dir = nearest && nearest.x < emitter.x ? -1 : 1;
      const path: BeamPath = { segs: [], bent: false };

      // 水平段:逐步推进到实体或地图边缘;途经激活节点则折转。
      let x = emitter.x + dir * 8;
      const y = emitter.y;
      let bendAt: MirrorSocket | null = null;
      while (x > 0 && x < level.w * TILE && !solidAt(x, y)) {
        const socket = this.mirrorSockets.find(
          (candidate) => candidate.active && Math.abs(candidate.x - x) < 4 && Math.abs((candidate.y - 12) - y) < 30,
        );
        if (socket) {
          bendAt = socket;
          break;
        }
        x += dir * 4;
      }
      path.segs.push({ x0: emitter.x + dir * 8, y0: y, x1: x, y1: y });

      if (bendAt) {
        path.bent = true;
        // 垂直段:向上折转(接收器按设计放在上方)
        let vy = y - 4;
        let hit: BeamReceiver | null = null;
        while (vy > 0 && !solidAt(bendAt.x, vy)) {
          hit = this.receivers.find(
            (candidate) => Math.abs(candidate.x - bendAt.x) < 10 && Math.abs(candidate.y - vy) < 8,
          ) ?? null;
          if (hit) break;
          vy -= 4;
        }
        path.segs.push({ x0: bendAt.x, y0: y, x1: bendAt.x, y1: hit ? hit.y : vy });
        if (hit) hitReceivers.add(hit);
      }
      this.beams.push(path);
    }

    for (const receiver of this.receivers) {
      receiver.litT = Math.max(0, receiver.litT - dt);
      if (hitReceivers.has(receiver)) {
        receiver.charge = Math.min(1, receiver.charge + dt);
        if (receiver.charge >= 1 && receiver.litT <= 0) {
          // 满充:一次 7 秒长显形,足够玩家收束、恢复 3D 并爬上去。
          receiver.litT = 7;
          receiver.charge = 0;
          host.sfx('crystal');
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            host.particles.spawn({
              x: receiver.x + Math.cos(a) * 6, y: receiver.y + Math.sin(a) * 6,
              vx: Math.cos(a) * 110, vy: Math.sin(a) * 110,
              life: 0.4, color: '#8ee8f4', shape: 'spark', size: 1,
            });
          }
        }
      } else {
        receiver.charge = Math.max(0, receiver.charge - dt * 0.6);
      }
      if (receiver.litT > 0) {
        // 点亮期间持续刷新附近隐藏平台
        const radius = 100;
        const c0 = Math.max(0, Math.floor((receiver.x - radius) / TILE));
        const c1 = Math.min(level.w - 1, Math.floor((receiver.x + radius) / TILE));
        const r0 = Math.max(0, Math.floor((receiver.y - radius) / TILE));
        const r1 = Math.min(level.h - 1, Math.floor((receiver.y + radius) / TILE));
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            if (level.tiles[r * level.w + c] !== T_HIDDEN) continue;
            const hx = c * TILE + TILE / 2;
            const hy = r * TILE + TILE / 2;
            if (Math.hypot(hx - receiver.x, hy - receiver.y) <= radius) {
              host.revealHiddenTile(r * level.w + c, Math.min(receiver.litT, 1.4));
            }
          }
        }
      }
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

    // 导能节点:线圈柱,点亮时金色辉光 + 剩余时间弧
    for (const node of this.conductiveNodes) {
      const lit = node.litT > 0;
      ctx.fillStyle = '#241c10';
      ctx.fillRect(node.x - 6, node.y - 22, 12, 22);
      ctx.strokeStyle = lit ? '#ffd75e' : '#6a5a34';
      ctx.strokeRect(node.x - 5.5, node.y - 21.5, 11, 21);
      // 线圈匝
      ctx.fillStyle = lit ? '#ffe9a8' : '#8a7444';
      for (let i = 0; i < 4; i++) ctx.fillRect(node.x - 4, node.y - 19 + i * 5, 8, 2);
      if (lit) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.18 + 0.08 * Math.sin(time * 9);
        ctx.fillStyle = '#ffd75e';
        ctx.beginPath();
        ctx.arc(node.x, node.y - 11, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // 剩余时间弧
        ctx.save();
        ctx.strokeStyle = '#ffe9a8';
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(node.x, node.y - 11, 10, -Math.PI / 2, -Math.PI / 2 + (node.litT / NODE_LIT_TIME) * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 弦镜偏转:能束、发射器、节点与接收器
    for (const path of this.beams) {
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.25 * Math.abs(Math.sin(time * 8));
      ctx.strokeStyle = path.bent ? '#aef4ff' : '#5a9ab0';
      ctx.lineWidth = path.bent ? 2 : 1;
      for (const seg of path.segs) {
        ctx.beginPath();
        ctx.moveTo(Math.round(seg.x0), Math.round(seg.y0));
        ctx.lineTo(Math.round(seg.x1), Math.round(seg.y1));
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const emitter of this.emitters) {
      ctx.fillStyle = '#18283a';
      ctx.fillRect(emitter.x - 7, emitter.y - 6, 14, 16);
      ctx.fillStyle = '#8ee8f4';
      ctx.fillRect(emitter.x - 2, emitter.y - 3, 4, 6);
      ctx.fillStyle = '#4a6a88';
      ctx.fillRect(emitter.x - 7, emitter.y - 6, 14, 2);
    }
    for (const socket of this.mirrorSockets) {
      // 菱形节点:玩家该在这里弦化。激活时亮起。
      ctx.save();
      ctx.translate(socket.x, socket.y - 12);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = socket.active ? '#aef4ff' : '#4a6a88';
      ctx.globalAlpha = socket.active ? 0.95 : 0.5 + 0.2 * Math.abs(Math.sin(time * 3));
      ctx.strokeRect(-7, -7, 14, 14);
      if (socket.active) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#aef4ff';
        ctx.fillRect(-7, -7, 14, 14);
      }
      ctx.restore();
      // 地面刻痕提示站位
      ctx.fillStyle = 'rgba(142,232,244,0.4)';
      ctx.fillRect(socket.x - 8, socket.y - 1, 16, 1);
    }
    for (const receiver of this.receivers) {
      const lit = receiver.litT > 0;
      ctx.fillStyle = '#18283a';
      ctx.fillRect(receiver.x - 6, receiver.y - 8, 12, 14);
      ctx.strokeStyle = lit ? '#aef4ff' : '#4a6a88';
      ctx.strokeRect(receiver.x - 5.5, receiver.y - 7.5, 11, 13);
      // 充能柱:从下往上填
      const fill = lit ? 1 : receiver.charge;
      if (fill > 0) {
        ctx.fillStyle = lit ? '#e8fbff' : '#8ee8f4';
        const fh = Math.round(10 * fill);
        ctx.fillRect(receiver.x - 3, receiver.y + 3 - fh, 6, fh);
      }
      if (lit) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.2 + 0.1 * Math.sin(time * 6);
        ctx.fillStyle = '#8ee8f4';
        ctx.beginPath();
        ctx.arc(receiver.x, receiver.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
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

    // 移动平台(受电平台断电时压暗,通电时描金)
    const lit = this.circuitLit;
    for (const m of this.movers) {
      const x = Math.round(m.x - m.w / 2);
      const y = Math.round(m.y);
      const dormant = m.powered && !lit;
      ctx.globalAlpha = dormant ? 0.45 : 1;
      ctx.fillStyle = m.powered && lit ? '#ffd75e' : theme.tileEdge;
      ctx.fillRect(x, y, m.w, 2);
      ctx.fillStyle = theme.tileBase;
      ctx.fillRect(x, y + 2, m.w, m.h - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x, y + m.h - 1, m.w, 1);
      ctx.fillStyle = m.powered ? (lit ? '#ffe9a8' : '#6a5a34') : theme.accent;
      ctx.globalAlpha = dormant ? 0.5 : 0.8;
      ctx.fillRect(x + 3, y + 3, 2, 2);
      ctx.fillRect(x + m.w - 5, y + 3, 2, 2);
      ctx.globalAlpha = 1;
    }
  }
}
