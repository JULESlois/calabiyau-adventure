import { VIEW_W, VIEW_H } from '../constants';
import type { LevelTheme } from '../levels/levels';
import { makeRng } from '../utils';

type DecoKind = 'spire' | 'cloud' | 'pillar' | 'window' | 'banner' | 'wave' | 'chain';

interface Deco {
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number; // 0 远 1 中 2 近
  kind: DecoKind;
  seed: number;
  lit: number[];
}

type FrontKind = 'fgPillar' | 'fgMerlon' | 'fgFog' | 'fgBanner' | 'fgChain';

interface FrontDeco {
  x: number;
  w: number;
  h: number;
  kind: FrontKind;
  seed: number;
}

/** 前景遮挡层视差(>1,比场景更靠近镜头) */
const FRONT_PARALLAX = 1.3;
/** 内墙装饰层视差(<1,贴在场景后) */
const WALL_PARALLAX = 0.85;
/** 区域背景以固定周期重复,允许跨房间延续视差坐标而不会耗尽装饰。 */
const BACKGROUND_PERIOD = 4096;

function wrappedScreenX(worldX: number, cameraX: number, margin: number): number {
  const raw = worldX - cameraX + margin;
  return ((raw % BACKGROUND_PERIOD) + BACKGROUND_PERIOD) % BACKGROUND_PERIOD - margin;
}

function celestialShift(cameraX: number, amount: number): number {
  return Math.sin((cameraX / BACKGROUND_PERIOD) * Math.PI * 2) * amount;
}

/**
 * 程序化视差背景(恶魔城风):
 * L1 暮色城墙+落日海面 / L2 月下大厅(拱窗月光) / L3 钟塔云海 / L4 王座厅(石柱旗帜)
 */
export class Background {
  private decos: Deco[] = [];
  private fronts: FrontDeco[] = [];

  constructor(
    private theme: LevelTheme,
    private levelId: number,
  ) {
    const rng = makeRng(levelId * 7919 + 23);
    const span = BACKGROUND_PERIOD;
    this.buildFront(rng);

    if (levelId === 1) {
      // 远景:城堡尖塔群 + 城墙
      for (let x = 0; x < span; x += 30 + rng() * 55) {
        const layer = rng() < 0.5 ? 0 : rng() < 0.8 ? 1 : 2;
        const h = 60 + rng() * (layer === 0 ? 130 : 90);
        const lit: number[] = [];
        const n = Math.floor(rng() * 4);
        for (let i = 0; i < n; i++) lit.push(rng());
        this.decos.push({ x, y: 0, w: 12 + rng() * 22, h, layer, kind: 'spire', seed: rng(), lit });
      }
      for (let x = 0; x < span; x += 18 + rng() * 26) {
        this.decos.push({ x, y: 206 + rng() * 40, w: 8 + rng() * 18, h: 1, layer: 2, kind: 'wave', seed: rng(), lit: [] });
      }
    } else if (levelId === 2) {
      // 大厅:中层哥特拱窗 + 近层石柱
      for (let x = 0; x < span; x += 90 + rng() * 60) {
        this.decos.push({ x, y: 46 + rng() * 26, w: 26, h: 62, layer: 1, kind: 'window', seed: rng(), lit: [] });
      }
      for (let x = 0; x < span; x += 120 + rng() * 80) {
        this.decos.push({ x, y: 0, w: 16 + rng() * 6, h: VIEW_H, layer: 2, kind: 'pillar', seed: rng(), lit: [] });
      }
      for (let x = 40; x < span; x += 70 + rng() * 90) {
        this.decos.push({ x, y: 0, w: 2, h: 60 + rng() * 80, layer: 1, kind: 'chain', seed: rng(), lit: [] });
      }
    } else if (levelId === 3) {
      // 云海 + 塔尖从云中探出
      for (let x = 0; x < span; x += 36 + rng() * 70) {
        const layer = rng() < 0.5 ? 0 : 1;
        this.decos.push({ x, y: 60 + rng() * 170, w: 34 + rng() * 66, h: 9 + rng() * 12, layer, kind: 'cloud', seed: rng(), lit: [] });
      }
      for (let x = 0; x < span; x += 90 + rng() * 120) {
        this.decos.push({ x, y: 0, w: 14 + rng() * 16, h: 40 + rng() * 60, layer: 0, kind: 'spire', seed: rng(), lit: [rng()] });
      }
    } else {
      // 王座厅:石柱 + 垂旗 + 锁链
      for (let x = 0; x < span; x += 100 + rng() * 70) {
        this.decos.push({ x, y: 0, w: 18 + rng() * 8, h: VIEW_H, layer: rng() < 0.5 ? 1 : 2, kind: 'pillar', seed: rng(), lit: [] });
      }
      for (let x = 50; x < span; x += 110 + rng() * 90) {
        this.decos.push({ x, y: 0, w: 22, h: 66 + rng() * 30, layer: 1, kind: 'banner', seed: rng(), lit: [] });
      }
      for (let x = 30; x < span; x += 60 + rng() * 70) {
        this.decos.push({ x, y: 0, w: 2, h: 50 + rng() * 100, layer: 2, kind: 'chain', seed: rng(), lit: [] });
      }
    }
  }

  setTheme(theme: LevelTheme): void {
    this.theme = theme;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, time: number): void {
    const t = this.theme;

    // ---- 天空 ----
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, t.skyTop);
    grad.addColorStop(1, t.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // ---- 天体 ----
    this.renderCelestial(ctx, camX, time);

    // ---- 视差层 ----
    const parallax = [0.15, 0.32, 0.55];
    const layerColor = [t.far, t.mid, t.near];
    for (let layer = 0; layer < 3; layer++) {
      const px = camX * parallax[layer];
      const py = camY * (parallax[layer] * 0.4);
      for (const d of this.decos) {
        if (d.layer !== layer) continue;
        const sx = Math.round(wrappedScreenX(d.x, px, 140));
        if (sx + d.w < -30 || sx > VIEW_W + 30) continue;
        this.renderDeco(ctx, d, sx, py, layerColor[layer], time);
      }
      // 层间雾霭
      ctx.fillStyle = t.fog;
      const fogY = 120 + layer * 55 - py * 0.5;
      ctx.fillRect(0, fogY, VIEW_W, 34);
    }

    // ---- 神光(斜向光束)----
    if (this.levelId === 1 || this.levelId === 3) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const rayC = this.levelId === 1 ? 'rgba(255,170,90,0.05)' : 'rgba(235,240,255,0.06)';
      ctx.fillStyle = rayC;
      for (let i = 0; i < 3; i++) {
        const sway = Math.sin(time * 0.3 + i * 2.1) * 8;
        const bx = ((i * 190 - camX * 0.1) % (VIEW_W + 260)) - 130 + sway;
        ctx.beginPath();
        ctx.moveTo(bx, -10);
        ctx.lineTo(bx + 50, -10);
        ctx.lineTo(bx - 30, VIEW_H + 10);
        ctx.lineTo(bx - 80, VIEW_H + 10);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // ---- 内墙装饰层(贴近场景,视差 0.85)----
    this.renderWall(ctx, camX, camY, time);

    // ---- 海面(L1)----
    if (this.levelId === 1) {
      const seaY = 214;
      const seaGrad = ctx.createLinearGradient(0, seaY, 0, VIEW_H);
      seaGrad.addColorStop(0, 'rgba(60,20,40,0.55)');
      seaGrad.addColorStop(1, 'rgba(20,8,20,0.75)');
      ctx.fillStyle = seaGrad;
      ctx.fillRect(0, seaY, VIEW_W, VIEW_H - seaY);
      // 落日光路
      const sunX = Math.round(VIEW_W * 0.68 - celestialShift(camX, 24));
      ctx.globalCompositeOperation = 'lighter';
      for (let yy = seaY + 3; yy < VIEW_H; yy += 4) {
        const w = 10 + (yy - seaY) * 0.8 + Math.sin(time * 2 + yy) * 4;
        ctx.globalAlpha = 0.05 + 0.03 * Math.sin(time * 3 + yy * 0.7);
        ctx.fillStyle = '#ffb066';
        ctx.fillRect(sunX - w / 2, yy, w, 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---- 氛围色罩 ----
    ctx.fillStyle = t.ambient;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  private buildFront(rng: () => number): void {
    const span = BACKGROUND_PERIOD;
    if (this.levelId === 1) {
      // 残破城齿沿底部 + 偶发断柱
      for (let x = 0; x < span; x += 300 + rng() * 260) {
        this.fronts.push({ x, w: 22 + rng() * 10, h: 90 + rng() * 70, kind: 'fgPillar', seed: rng() });
      }
      for (let x = 0; x < span; x += 130 + rng() * 120) {
        this.fronts.push({ x, w: 60 + rng() * 50, h: 14, kind: 'fgMerlon', seed: rng() });
      }
    } else if (this.levelId === 2) {
      for (let x = 0; x < span; x += 340 + rng() * 240) {
        this.fronts.push({ x, w: 24 + rng() * 8, h: VIEW_H, kind: 'fgPillar', seed: rng() });
      }
      for (let x = 120; x < span; x += 260 + rng() * 220) {
        this.fronts.push({ x, w: 3, h: 46 + rng() * 50, kind: 'fgChain', seed: rng() });
      }
    } else if (this.levelId === 3) {
      for (let x = 0; x < span; x += 260 + rng() * 200) {
        this.fronts.push({ x, w: 120 + rng() * 130, h: 22 + rng() * 16, kind: 'fgFog', seed: rng() });
      }
    } else {
      for (let x = 0; x < span; x += 320 + rng() * 220) {
        this.fronts.push({ x, w: 26 + rng() * 8, h: 74 + rng() * 50, kind: 'fgBanner', seed: rng() });
      }
      for (let x = 140; x < span; x += 240 + rng() * 200) {
        this.fronts.push({ x, w: 3, h: 60 + rng() * 70, kind: 'fgChain', seed: rng() });
      }
    }
  }

  /** 内墙装饰层:壁柱与线脚,只用于室内关(L2/L4) */
  private renderWall(ctx: CanvasRenderingContext2D, camX: number, camY: number, time: number): void {
    if (this.levelId !== 2 && this.levelId !== 4) return;
    const px = camX * WALL_PARALLAX;
    const py = camY * WALL_PARALLAX * 0.3;
    const isThrone = this.levelId === 4;
    const wallTop = 128 - py;

    // 横向线脚
    ctx.fillStyle = isThrone ? 'rgba(90,30,44,0.35)' : 'rgba(70,84,140,0.28)';
    ctx.fillRect(0, wallTop, VIEW_W, 2);
    ctx.fillRect(0, wallTop + 5, VIEW_W, 1);

    // 暗砖纹理带(线脚以下)
    ctx.fillStyle = isThrone ? 'rgba(60,20,32,0.22)' : 'rgba(40,52,96,0.20)';
    const brickH = 10;
    for (let gy = wallTop + 8; gy < VIEW_H; gy += brickH) {
      ctx.fillRect(0, gy, VIEW_W, 1);
    }
    const rowOff = Math.floor((wallTop + 8) / brickH);
    for (let gx = -((px % 40) + 40) % 40; gx < VIEW_W + 40; gx += 20) {
      for (let row = 0; row < Math.ceil((VIEW_H - wallTop) / brickH); row++) {
        const jx = gx + ((row + rowOff) % 2) * 10;
        ctx.fillRect(Math.round(jx), wallTop + 8 + row * brickH, 1, brickH);
      }
    }

    // 壁柱(每 160px 一根)
    const step = 160;
    for (let wx = -(((px % step) + step) % step); wx < VIEW_W + step; wx += step) {
      const x = Math.round(wx);
      ctx.fillStyle = isThrone ? 'rgba(46,14,26,0.5)' : 'rgba(28,36,72,0.45)';
      ctx.fillRect(x, wallTop - 24, 12, VIEW_H - wallTop + 24);
      ctx.fillStyle = isThrone ? 'rgba(120,50,60,0.4)' : 'rgba(110,126,190,0.35)';
      ctx.fillRect(x, wallTop - 24, 12, 3);
      ctx.fillRect(x - 2, wallTop - 21, 16, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x + 1, wallTop - 24, 2, VIEW_H - wallTop + 24);
      // 壁灯
      if (isThrone) {
        const flick = 0.5 + 0.4 * Math.abs(Math.sin(time * 4 + wx));
        ctx.globalAlpha = flick;
        ctx.fillStyle = '#ffb066';
        ctx.fillRect(x + 5, wallTop - 8, 2, 3);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = flick * 0.16;
        ctx.beginPath();
        ctx.arc(x + 6, wallTop - 6, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
    }
  }

  /**
   * 前景遮挡层(视差 1.3,画在场景与实体之上、HUD 之下)。
   * 半透明 + 稀疏摆放,保证玩法可读性。
   */
  renderFront(ctx: CanvasRenderingContext2D, camX: number, camY: number, time: number): void {
    const px = camX * FRONT_PARALLAX;
    const py = camY * 0.12;
    for (const f of this.fronts) {
      const sx = Math.round(wrappedScreenX(f.x, px, 280));
      if (sx + f.w + 40 < 0 || sx > VIEW_W + 40) continue;
      switch (f.kind) {
        case 'fgPillar': {
          const fromTop = this.levelId === 2;
          const h = fromTop ? VIEW_H : f.h;
          const y = fromTop ? 0 : VIEW_H - h + py;
          ctx.globalAlpha = 0.88;
          ctx.fillStyle = '#0b0812';
          ctx.fillRect(sx, y, f.w, h);
          // 柱头 / 断口
          if (fromTop) {
            ctx.fillRect(sx - 4, 0, f.w + 8, 16);
            ctx.fillRect(sx - 4, VIEW_H - 22, f.w + 8, 22);
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.fillRect(sx + 2, 0, 3, VIEW_H);
          } else {
            ctx.fillRect(sx - 3, y, f.w + 6, 4);
            // 断裂顶部锯齿
            ctx.fillStyle = '#0b0812';
            for (let i = 0; i < f.w; i += 6) {
              ctx.fillRect(sx + i, y - 4 - (i * 7 + f.seed * 40) % 5, 4, 6);
            }
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.fillRect(sx + 2, y, 2, h);
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'fgMerlon': {
          // 前景残垛(底缘剪影)
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = '#0b0812';
          const baseY = VIEW_H - 8 + py;
          ctx.fillRect(sx, baseY, f.w, 10);
          for (let i = 0; i < f.w - 6; i += 14) {
            ctx.fillRect(sx + i, baseY - 6, 8, 6);
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'fgFog': {
          const drift = (time * 14 * (0.6 + f.seed * 0.8)) % (VIEW_W + f.w * 2);
          const fx = ((sx + drift) % (VIEW_W + f.w * 2)) - f.w;
          const fy = 60 + f.seed * 150 + Math.sin(time * 0.5 + f.seed * 7) * 6 + py;
          ctx.globalAlpha = 0.10 + f.seed * 0.06;
          ctx.fillStyle = '#e8ecf8';
          ctx.fillRect(Math.round(fx), Math.round(fy), f.w, f.h);
          ctx.fillRect(Math.round(fx + f.w * 0.2), Math.round(fy - f.h * 0.4), f.w * 0.6, f.h * 0.5);
          ctx.fillRect(Math.round(fx + f.w * 0.15), Math.round(fy + f.h), f.w * 0.7, f.h * 0.35);
          ctx.globalAlpha = 1;
          break;
        }
        case 'fgBanner': {
          const sway = Math.sin(time * 0.7 + f.seed * 8) * 2;
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = '#2e0a14';
          ctx.fillRect(sx, 0, f.w, f.h);
          ctx.beginPath();
          ctx.moveTo(sx, f.h);
          ctx.lineTo(sx + f.w / 2 + sway, f.h + 14);
          ctx.lineTo(sx + f.w, f.h);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(120,80,30,0.5)';
          ctx.fillRect(sx, 0, f.w, 2);
          ctx.globalAlpha = 1;
          break;
        }
        case 'fgChain': {
          const sway = Math.sin(time * 0.9 + f.seed * 9) * 1.5;
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = '#0b0812';
          for (let yy = 0; yy < f.h; yy += 6) {
            const cx2 = Math.round(sx + sway * (yy / f.h));
            ctx.fillRect(cx2, yy, 2, 4);
            ctx.fillRect(cx2 - 1, yy + 4, 1, 2);
            ctx.fillRect(cx2 + 2, yy + 4, 1, 2);
          }
          ctx.globalAlpha = 1;
          break;
        }
        default:
          break;
      }
    }
  }

  private renderCelestial(ctx: CanvasRenderingContext2D, camX: number, time: number): void {
    if (this.levelId === 1) {
      // 血色落日(巨大,低垂)
      const x = Math.round(VIEW_W * 0.68 - celestialShift(camX, 24));
      const y = 168;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#ff8a3c';
      ctx.beginPath();
      ctx.arc(x, y, 52, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#f0a050';
      ctx.beginPath();
      ctx.arc(x, y, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffc880';
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fill();
      // 低云横切日面(裁剪在日面内)
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 36, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = this.theme.skyTop;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x - 40, y - 8, 80, 3);
      ctx.fillRect(x - 40, y + 4, 80, 4);
      ctx.fillRect(x - 40, y + 16, 80, 3);
      ctx.globalAlpha = 1;
      ctx.restore();
    } else if (this.levelId === 2 || this.levelId === 3) {
      // 恶魔城式巨月
      const big = this.levelId === 3;
      const x = Math.round(VIEW_W * (big ? 0.3 : 0.24) - celestialShift(camX, big ? 22 : 16));
      const y = big ? 70 : 62;
      const r = big ? 44 : 30;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = '#c8d4f0';
      ctx.beginPath();
      ctx.arc(x, y, r + 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = big ? '#e8ecf8' : '#dce4f4';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // 月面陨坑(独立路径,避免弧间连线)
      ctx.fillStyle = 'rgba(150,160,190,0.5)';
      for (const [ox, oy, cr] of [
        [-0.3, -0.2, 0.18],
        [0.25, 0.3, 0.13],
        [0.1, -0.45, 0.1],
      ]) {
        ctx.beginPath();
        ctx.arc(x + r * ox, y + r * oy, r * cr, 0, Math.PI * 2);
        ctx.fill();
      }
      // 星
      if (this.levelId === 2) {
        const rng = makeRng(77);
        for (let i = 0; i < 40; i++) {
          const sx = rng() * VIEW_W;
          const sy = rng() * 150;
          const tw = 0.3 + 0.7 * Math.abs(Math.sin(time * 1.2 + i * 1.7));
          ctx.globalAlpha = tw * 0.8;
          ctx.fillStyle = i % 5 === 0 ? '#aef4ff' : '#e8ecf8';
          ctx.fillRect(Math.round(sx), Math.round(sy), i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
        }
        ctx.globalAlpha = 1;
      }
    }
    // L4 无天体:王座厅内部
  }

  private renderDeco(
    ctx: CanvasRenderingContext2D,
    d: Deco,
    sx: number,
    py: number,
    color: string,
    time: number,
  ): void {
    switch (d.kind) {
      case 'spire': {
        const top = VIEW_H - d.h - py * 0.3;
        ctx.fillStyle = color;
        ctx.fillRect(sx, top, d.w, VIEW_H - top);
        // 尖顶
        const peakW = Math.max(4, d.w * 0.6);
        const cx = sx + d.w / 2;
        ctx.beginPath();
        ctx.moveTo(cx - peakW / 2, top);
        ctx.lineTo(cx, top - 10 - d.seed * 14);
        ctx.lineTo(cx + peakW / 2, top);
        ctx.closePath();
        ctx.fill();
        // 城齿
        for (let i = 0; i < d.w - 2; i += 4) {
          ctx.fillRect(sx + i, top - 3, 2, 3);
        }
        // 窗灯(烛光摇曳)
        for (let i = 0; i < d.lit.length; i++) {
          const wy = top + 10 + d.lit[i] * (d.h - 24);
          const wx = sx + 3 + ((i * 7) % Math.max(4, d.w - 5));
          const flick = 0.5 + 0.5 * Math.abs(Math.sin(time * 3 + i * 2 + d.seed * 9));
          ctx.globalAlpha = 0.45 + flick * 0.35;
          ctx.fillStyle = '#ffc06a';
          ctx.fillRect(Math.round(wx), Math.round(wy), 2, 3);
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'cloud': {
        const cy = d.y - py + Math.sin(time * 0.3 + d.x) * 2;
        ctx.globalAlpha = d.layer === 0 ? 0.4 : 0.6;
        ctx.fillStyle = color;
        ctx.fillRect(sx, Math.round(cy), d.w, d.h);
        ctx.fillRect(sx + 6, Math.round(cy) - 4, d.w * 0.55, 4);
        ctx.fillRect(sx + d.w * 0.3, Math.round(cy) + d.h, d.w * 0.5, 3);
        ctx.globalAlpha = 1;
        break;
      }
      case 'pillar': {
        ctx.fillStyle = color;
        ctx.fillRect(sx, 0, d.w, VIEW_H);
        // 柱头柱础
        ctx.fillRect(sx - 3, 0, d.w + 6, 14);
        ctx.fillRect(sx - 3, VIEW_H - 40, d.w + 6, 40);
        // 柱身高光
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(sx + 1, 0, 2, VIEW_H);
        // 凹槽
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(sx + d.w - 3, 0, 2, VIEW_H);
        ctx.fillRect(sx + Math.floor(d.w / 2), 14, 1, VIEW_H - 54);
        break;
      }
      case 'window': {
        const wy = d.y - py * 0.5;
        // 拱窗月光
        ctx.save();
        ctx.fillStyle = 'rgba(180,200,240,0.16)';
        ctx.beginPath();
        ctx.moveTo(sx, wy + d.h);
        ctx.lineTo(sx, wy + 10);
        ctx.arc(sx + d.w / 2, wy + 10, d.w / 2, Math.PI, 0);
        ctx.lineTo(sx + d.w, wy + d.h);
        ctx.closePath();
        ctx.fill();
        // 窗棂
        ctx.fillStyle = 'rgba(10,14,28,0.8)';
        ctx.fillRect(sx + d.w / 2 - 1, wy, 2, d.h);
        ctx.fillRect(sx, wy + d.h * 0.45, d.w, 2);
        // 落到"地面"的光斑
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(170,195,240,0.05)';
        ctx.beginPath();
        ctx.moveTo(sx - 4, VIEW_H);
        ctx.lineTo(sx + 4, wy + d.h);
        ctx.lineTo(sx + d.w - 4, wy + d.h);
        ctx.lineTo(sx + d.w + 14, VIEW_H);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'banner': {
        const wy = -py * 0.4;
        const sway = Math.sin(time * 0.8 + d.seed * 6) * 2;
        ctx.fillStyle = '#5c1424';
        ctx.fillRect(sx, wy, d.w, d.h);
        ctx.beginPath();
        ctx.moveTo(sx, wy + d.h);
        ctx.lineTo(sx + d.w / 2 + sway, wy + d.h + 12);
        ctx.lineTo(sx + d.w, wy + d.h);
        ctx.closePath();
        ctx.fill();
        // 金边与纹章
        ctx.fillStyle = '#a8823c';
        ctx.fillRect(sx, wy, d.w, 2);
        ctx.fillRect(sx + d.w / 2 - 1, wy + d.h * 0.35, 2, 8);
        ctx.fillRect(sx + d.w / 2 - 3, wy + d.h * 0.35 + 3, 6, 2);
        break;
      }
      case 'chain': {
        const wy = -py * 0.4;
        ctx.fillStyle = 'rgba(20,16,28,0.9)';
        for (let yy = 0; yy < d.h; yy += 5) {
          ctx.fillRect(sx, wy + yy, 2, 3);
          ctx.fillRect(sx - 1, wy + yy + 3, 1, 2);
          ctx.fillRect(sx + 2, wy + yy + 3, 1, 2);
        }
        break;
      }
      case 'wave': {
        ctx.globalAlpha = 0.3 + 0.25 * Math.sin(time * 2 + d.x * 0.1);
        ctx.fillStyle = '#e89a5c';
        ctx.fillRect(sx, Math.round(d.y - py), d.w, 1);
        ctx.globalAlpha = 1;
        break;
      }
      default:
        break;
    }
  }
}
