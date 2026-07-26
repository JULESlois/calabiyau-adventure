// 全程序化像素美术(恶魔城 / 神之亵渎 风格):
// 厚重描边、深色分层阴影、烛火与辉光,不加载任何图片素材。
import type { CharId } from '../types';

const OUTLINE = '#0e0a14';

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

// ---- 离屏画布:先画本体,再取轮廓做描边 ----
let workCanvas: HTMLCanvasElement | null = null;
let workCtx: CanvasRenderingContext2D | null = null;
let silCanvas: HTMLCanvasElement | null = null;
let silCtx: CanvasRenderingContext2D | null = null;
const WORK = 64;
const ORIGIN_X = 32; // 离屏中脚底原点
const ORIGIN_Y = 48;

function ensureWork(): boolean {
  if (workCtx && silCtx) return true;
  if (typeof document === 'undefined') return false;
  workCanvas = document.createElement('canvas');
  workCanvas.width = WORK;
  workCanvas.height = WORK;
  workCtx = workCanvas.getContext('2d');
  silCanvas = document.createElement('canvas');
  silCanvas.width = WORK;
  silCanvas.height = WORK;
  silCtx = silCanvas.getContext('2d');
  if (workCtx) workCtx.imageSmoothingEnabled = false;
  if (silCtx) silCtx.imageSmoothingEnabled = false;
  return !!(workCtx && silCtx);
}

/** 把 workCanvas 以描边形式(4 方向偏移的剪影)+ 本体 blit 到目标 */
function blitOutlined(ctx: CanvasRenderingContext2D): void {
  if (!workCanvas || !silCanvas || !silCtx) return;
  silCtx.clearRect(0, 0, WORK, WORK);
  silCtx.drawImage(workCanvas, 0, 0);
  silCtx.globalCompositeOperation = 'source-in';
  silCtx.fillStyle = OUTLINE;
  silCtx.fillRect(0, 0, WORK, WORK);
  silCtx.globalCompositeOperation = 'source-over';
  ctx.drawImage(silCanvas, -ORIGIN_X - 1, -ORIGIN_Y);
  ctx.drawImage(silCanvas, -ORIGIN_X + 1, -ORIGIN_Y);
  ctx.drawImage(silCanvas, -ORIGIN_X, -ORIGIN_Y - 1);
  ctx.drawImage(silCanvas, -ORIGIN_X, -ORIGIN_Y + 1);
  ctx.drawImage(workCanvas, -ORIGIN_X, -ORIGIN_Y);
}

export interface CharPose {
  runPhase: number;
  moving: boolean;
  airborne: boolean;
  vy: number;
  paper: boolean;
  meleeT: number; // 0 无近战,>0 为挥击进度 0..1
  meleeStep: number; // 连段 0/1/2
  shootFlash: number; // 枪口焰 0..1
  hurtFlash: boolean;
  shield: boolean;
  time: number;
}

const MICHELE = {
  hair: '#7ec4ee',
  hairHi: '#c2e8ff',
  hairDk: '#4a86b8',
  skin: '#f4dcc4',
  skinDk: '#d0a888',
  coat: '#dce6f0',
  coatDk: '#9aaec8',
  trim: '#2e5a8a',
  hood: '#3a5474',
  hoodDk: '#263a52',
  boots: '#2e4058',
  gun: '#54718e',
  gunGlow: '#9fe8ff',
  eye: '#1c3050',
};

const KANAMI = {
  hair: '#f0a0c8',
  hairHi: '#ffd0e4',
  hairDk: '#b86a94',
  skin: '#f8e2cc',
  skinDk: '#d8ac8c',
  dress: '#ece4ec',
  dressDk: '#b89ab0',
  trim: '#c8487e',
  ribbon: '#d83a72',
  boots: '#8a3658',
  mic: '#d8a840',
  micGlow: '#ffe8a0',
  eye: '#5c2440',
};

function paintMichele(g: CanvasRenderingContext2D, pose: CharPose): void {
  const t = pose.time;
  const idle = !pose.moving && !pose.airborne;
  const bob = idle ? (Math.sin(t * 2.2) > 0.2 ? 1 : 0) : pose.moving && !pose.airborne && Math.abs(Math.sin(pose.runPhase)) > 0.6 ? -1 : 0;
  const top = ORIGIN_Y - 22 + bob;
  const x0 = ORIGIN_X;
  const sway = Math.round(Math.sin(t * 2.6) * 1);
  const legSwing = pose.moving && !pose.airborne ? Math.round(Math.sin(pose.runPhase) * 2) : 0;
  const airLeg = pose.airborne ? (pose.vy < 0 ? -2 : 1) : 0;

  // ---- 双马尾(后层,带摆动)----
  px(g, x0 - 8, top + 3 + sway, 3, 10, MICHELE.hairDk);
  px(g, x0 + 5, top + 3 - sway, 3, 10, MICHELE.hairDk);
  px(g, x0 - 8, top + 3 + sway, 1, 8, MICHELE.hair);
  px(g, x0 + 5, top + 3 - sway, 1, 8, MICHELE.hair);
  px(g, x0 - 9, top + 8 + sway, 1, 4, MICHELE.hairDk);
  px(g, x0 + 7, top + 8 - sway, 1, 4, MICHELE.hairDk);

  // ---- 兜帽熊耳 ----
  px(g, x0 - 6, top - 2, 3, 3, MICHELE.hood);
  px(g, x0 + 3, top - 2, 3, 3, MICHELE.hood);
  px(g, x0 - 5, top - 1, 1, 1, MICHELE.hoodDk);
  px(g, x0 + 4, top - 1, 1, 1, MICHELE.hoodDk);

  // ---- 头发 ----
  px(g, x0 - 5, top, 10, 5, MICHELE.hair);
  px(g, x0 - 5, top, 10, 1, MICHELE.hairHi); // 顶部受月光
  px(g, x0 - 5, top + 4, 2, 4, MICHELE.hair);
  px(g, x0 + 3, top + 4, 2, 4, MICHELE.hair);
  px(g, x0 - 5, top + 7, 2, 1, MICHELE.hairDk);
  px(g, x0 + 3, top + 7, 2, 1, MICHELE.hairDk);

  // ---- 脸 ----
  px(g, x0 - 3, top + 4, 6, 4, MICHELE.skin);
  px(g, x0 - 3, top + 7, 6, 1, MICHELE.skinDk);
  px(g, x0 + 1, top + 5, 1, 2, MICHELE.eye);
  px(g, x0 - 2, top + 5, 1, 2, MICHELE.eye);

  // ---- 大衣 ----
  px(g, x0 - 4, top + 8, 8, 7, MICHELE.coat);
  px(g, x0 - 4, top + 12, 8, 3, MICHELE.coatDk);
  px(g, x0 - 1, top + 8, 2, 7, MICHELE.trim); // 中缝
  px(g, x0 - 4, top + 8, 8, 1, '#f4f8fc'); // 肩部高光
  // 后摆
  px(g, x0 - 6, top + 10, 2, 5, MICHELE.coatDk);

  // ---- 手臂 / 冰霜手枪 ----
  const armSwing = pose.moving && !pose.airborne ? Math.round(Math.sin(pose.runPhase + Math.PI) * 1) : 0;
  if (pose.meleeT > 0) {
    const sw = Math.round(pose.meleeT * 7);
    px(g, x0 + 1 + sw, top + 9, 5, 2, MICHELE.skin);
    px(g, x0 + 5 + sw, top + 8, 3, 3, MICHELE.gun);
  } else {
    px(g, x0 - 6, top + 9 + armSwing, 2, 4, MICHELE.coatDk); // 后臂
    px(g, x0 + 2, top + 10, 4, 2, MICHELE.skin);
    px(g, x0 + 5, top + 8, 4, 3, MICHELE.gun);
    px(g, x0 + 8, top + 9, 2, 1, MICHELE.gunGlow);
  }

  // ---- 腿 ----
  px(g, x0 - 3, top + 15, 2, 7 + (pose.airborne ? airLeg : legSwing > 0 ? -1 : 0), MICHELE.boots);
  px(g, x0 + 1, top + 15, 2, 7 + (pose.airborne ? -airLeg : legSwing < 0 ? -1 : 0), MICHELE.boots);
  px(g, x0 - 3, top + 15, 2, 1, MICHELE.coatDk);
  px(g, x0 + 1, top + 15, 2, 1, MICHELE.coatDk);
}

function paintKanami(g: CanvasRenderingContext2D, pose: CharPose): void {
  const t = pose.time;
  const idle = !pose.moving && !pose.airborne;
  const bob = idle ? (Math.sin(t * 2.0) > 0.2 ? 1 : 0) : pose.moving && !pose.airborne && Math.abs(Math.sin(pose.runPhase)) > 0.6 ? -1 : 0;
  const top = ORIGIN_Y - 22 + bob;
  const x0 = ORIGIN_X;
  const sway = Math.round(Math.sin(t * 2.2) * 1);
  const legSwing = pose.moving && !pose.airborne ? Math.round(Math.sin(pose.runPhase) * 2) : 0;
  const airLeg = pose.airborne ? (pose.vy < 0 ? -2 : 1) : 0;

  // ---- 长发(后层)----
  px(g, x0 - 7, top + 2 + sway, 3, 15, KANAMI.hairDk);
  px(g, x0 + 4, top + 2 - sway, 3, 15, KANAMI.hairDk);
  px(g, x0 - 7, top + 2 + sway, 1, 12, KANAMI.hair);
  px(g, x0 + 4, top + 2 - sway, 1, 12, KANAMI.hair);
  px(g, x0 - 8, top + 8 + sway, 1, 7, KANAMI.hairDk);
  px(g, x0 + 7, top + 8 - sway, 1, 7, KANAMI.hairDk);

  // ---- 头发 ----
  px(g, x0 - 5, top, 10, 5, KANAMI.hair);
  px(g, x0 - 5, top, 10, 1, KANAMI.hairHi);
  px(g, x0 - 5, top + 4, 2, 5, KANAMI.hair);
  px(g, x0 + 3, top + 4, 2, 5, KANAMI.hair);
  // 星形发饰
  px(g, x0 + 3, top, 2, 2, KANAMI.ribbon);
  px(g, x0 + 4, top - 1, 1, 1, '#ff7aa2');

  // ---- 脸 ----
  px(g, x0 - 3, top + 4, 6, 4, KANAMI.skin);
  px(g, x0 - 3, top + 7, 6, 1, KANAMI.skinDk);
  px(g, x0 + 1, top + 5, 1, 2, KANAMI.eye);
  px(g, x0 - 2, top + 5, 1, 2, KANAMI.eye);

  // ---- 连衣裙 ----
  px(g, x0 - 4, top + 8, 8, 5, KANAMI.dress);
  px(g, x0 - 5, top + 12, 10, 3, KANAMI.dress);
  px(g, x0 - 5, top + 14, 10, 1, KANAMI.dressDk);
  px(g, x0 - 1, top + 8, 2, 5, KANAMI.trim);
  px(g, x0 - 4, top + 8, 8, 1, '#f8f4f8');
  px(g, x0 - 5, top + 12, 1, 3, KANAMI.dressDk);
  px(g, x0 + 4, top + 12, 1, 3, KANAMI.dressDk);

  // ---- 手臂 / 星星麦克风 ----
  const armSwing = pose.moving && !pose.airborne ? Math.round(Math.sin(pose.runPhase + Math.PI) * 1) : 0;
  if (pose.meleeT > 0) {
    const sw = Math.round(pose.meleeT * 7);
    px(g, x0 + 1 + sw, top + 9, 5, 2, KANAMI.skin);
    px(g, x0 + 5 + sw, top + 7, 3, 4, KANAMI.mic);
  } else {
    px(g, x0 - 6, top + 9 + armSwing, 2, 4, KANAMI.dressDk);
    px(g, x0 + 2, top + 10, 3, 2, KANAMI.skin);
    px(g, x0 + 5, top + 8, 2, 4, KANAMI.mic);
    px(g, x0 + 5, top + 7, 2, 2, KANAMI.micGlow);
  }

  // ---- 腿 ----
  px(g, x0 - 3, top + 15, 2, 7 + (pose.airborne ? airLeg : legSwing > 0 ? -1 : 0), KANAMI.boots);
  px(g, x0 + 1, top + 15, 2, 7 + (pose.airborne ? -airLeg : legSwing < 0 ? -1 : 0), KANAMI.boots);
}

/** 绘制角色。(x, y) 是脚底中心,facing: 1 右 / -1 左 */
export function drawChar(
  ctx: CanvasRenderingContext2D,
  char: CharId,
  x: number,
  y: number,
  facing: number,
  pose: CharPose,
): void {
  if (!ensureWork() || !workCtx) return;
  workCtx.clearRect(0, 0, WORK, WORK);
  if (char === 'michele') paintMichele(workCtx, pose);
  else paintKanami(workCtx, pose);

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (facing < 0) ctx.scale(-1, 1);
  if (pose.paper) {
    const flutter = Math.sin(pose.time * 14) * 0.06;
    ctx.scale(0.26 + flutter, 1);
    ctx.globalAlpha = 0.92;
  }
  if (pose.hurtFlash) ctx.globalAlpha = 0.55;

  blitOutlined(ctx);

  // 枪口焰(不描边,叠加发光)
  if (pose.shootFlash > 0 && !pose.paper) {
    const f = pose.shootFlash;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = f;
    const gx = 10;
    const gy = -13;
    const glow = char === 'michele' ? '#9fe8ff' : '#ffd0a0';
    px(ctx, gx, gy - 1, 3, 3, glow);
    px(ctx, gx + 3, gy, 2, 1, '#ffffff');
    px(ctx, gx - 1, gy, 1, 1, '#ffffff');
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // 近战挥击弧光
  if (pose.meleeT > 0) {
    const prog = pose.meleeT;
    const big = pose.meleeStep === 2;
    const r = big ? 17 : 14;
    const a0 = -Math.PI / 2.6 + prog * 1.0;
    const a1 = a0 + Math.PI / 2.4;
    ctx.globalAlpha = (1 - prog) * 0.9;
    ctx.strokeStyle = char === 'michele' ? '#bfeff9' : '#ffe0b0';
    ctx.lineWidth = big ? 3 : 2;
    ctx.beginPath();
    ctx.arc(2, -11, r, a0, a1);
    ctx.stroke();
    ctx.globalAlpha = (1 - prog) * 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(2, -11, r - 2, a0 + 0.1, a1 - 0.1);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // 纸片形态描边微光
  if (pose.paper) {
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(pose.time * 10) * 0.25;
    ctx.strokeStyle = '#aef4ff';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) - 3.5, Math.round(y) - 23.5, 7, 24);
    ctx.restore();
  }

  // 香奈美护盾
  if (pose.shield) {
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(pose.time * 8) * 0.15;
    ctx.strokeStyle = '#ffd75e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(Math.round(x), Math.round(y) - 11, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.arc(Math.round(x), Math.round(y) - 11, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function paintEnemy(
  g: CanvasRenderingContext2D,
  kind: string,
  facing: number,
  time: number,
  frozen: boolean,
  aimAngle: number,
): void {
  const x0 = ORIGIN_X;
  const y0 = ORIGIN_Y;
  const body = frozen ? '#8fc8e8' : '#4a4658';
  const bodyHi = frozen ? '#c8ecf8' : '#6a6478';
  const dark = frozen ? '#68a8cc' : '#2e2a3a';
  const eye = frozen ? '#d0f0ff' : '#ff4a3c';
  const eyeGlow = frozen ? '#e8f8ff' : '#ff9a80';

  g.save();
  g.translate(x0, y0);

  switch (kind) {
    case 'patrol': {
      if (facing < 0) g.scale(-1, 1);
      px(g, -7, -12, 14, 8, body);
      px(g, -7, -12, 14, 1, bodyHi);
      px(g, -7, -6, 14, 2, dark);
      const tread = Math.floor(time * 10) % 2;
      px(g, -8, -4, 16, 4, '#1e1a28');
      for (let i = 0; i < 4; i++) px(g, -7 + i * 4 + tread, -3, 2, 2, '#3e3a4e');
      px(g, 1, -11, 5, 3, '#0e0c16');
      px(g, 2, -10, 3, 1, eye);
      px(g, 3, -10, 1, 1, eyeGlow);
      px(g, -5, -15, 1, 3, dark);
      px(g, -5, -15, 1, 1, eye);
      break;
    }
    case 'drone': {
      const hover = Math.sin(time * 6) * 1.5;
      g.translate(0, Math.round(hover));
      px(g, -6, -14, 12, 8, body);
      px(g, -6, -14, 12, 1, bodyHi);
      px(g, -6, -8, 12, 2, dark);
      px(g, -3, -12, 6, 3, '#0e0c16');
      px(g, -2, -11, 3, 1, eye);
      px(g, 0, -11, 1, 1, eyeGlow);
      const rot = Math.floor(time * 20) % 2;
      px(g, -9 + rot * 2, -16, 6, 1, '#7a748e');
      px(g, 3 - rot * 2, -16, 6, 1, '#7a748e');
      px(g, -1, -6, 2, 2, dark);
      break;
    }
    case 'turret': {
      px(g, -8, -6, 16, 6, dark);
      px(g, -8, -6, 16, 1, body);
      px(g, -6, -12, 12, 6, body);
      px(g, -6, -12, 12, 1, bodyHi);
      px(g, -2, -11, 4, 3, '#0e0c16');
      px(g, -1, -10, 2, 1, eye);
      g.save();
      g.translate(0, -8);
      g.rotate(aimAngle);
      px(g, 3, -2, 9, 4, dark);
      px(g, 3, -2, 9, 1, body);
      px(g, 11, -1, 2, 2, eye);
      g.restore();
      break;
    }
    case 'shield': {
      if (facing < 0) g.scale(-1, 1);
      px(g, -7, -16, 12, 12, body);
      px(g, -7, -16, 12, 1, bodyHi);
      px(g, -7, -6, 12, 2, dark);
      px(g, -2, -14, 5, 3, '#0e0c16');
      px(g, -1, -13, 3, 1, eye);
      const step = Math.floor(time * 6) % 2;
      px(g, -6 + step, -4, 3, 4, '#1e1a28');
      px(g, 1 - step, -4, 3, 4, '#1e1a28');
      // 哥特纹章大盾
      px(g, 6, -19, 4, 19, frozen ? '#b8dcf0' : '#6a647e');
      px(g, 6, -19, 4, 2, '#8a84a0');
      px(g, 7, -14, 2, 6, dark);
      px(g, 7, -12, 2, 2, eye);
      break;
    }
    default:
      break;
  }
  g.restore();
}

/** 敌人绘制:kind 与关卡解析字符一致 */
export function drawEnemy(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  facing: number,
  time: number,
  frozen: boolean,
  hurtFlash: boolean,
  aimAngle = 0,
): void {
  if (!ensureWork() || !workCtx) return;
  workCtx.clearRect(0, 0, WORK, WORK);
  paintEnemy(workCtx, kind, facing, time, frozen, aimAngle);

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (hurtFlash) ctx.globalAlpha = 0.6;
  blitOutlined(ctx);
  if (frozen) {
    ctx.globalAlpha = 0.3;
    px(ctx, -9, -20, 18, 20, '#bfeaff');
  }
  ctx.restore();
}

/** 拾取物(带辉光) */
export function drawPickup(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  t: number,
): void {
  const bob = Math.sin(t * 3) * 2;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y + bob));

  // 辉光
  ctx.globalCompositeOperation = 'lighter';
  const glowC = kind === 'heart' ? 'rgba(255,80,110,0.14)' : kind === 'energy' ? 'rgba(110,230,255,0.14)' : 'rgba(255,120,200,0.16)';
  ctx.fillStyle = glowC;
  ctx.beginPath();
  ctx.arc(0, -1, 8 + Math.sin(t * 5) * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  switch (kind) {
    case 'heart':
      px(ctx, -3, -3, 3, 3, '#e04a64');
      px(ctx, 1, -3, 3, 3, '#e04a64');
      px(ctx, -3, -1, 7, 3, '#e04a64');
      px(ctx, -2, 1, 5, 2, '#a82846');
      px(ctx, 0, 3, 1, 1, '#a82846');
      px(ctx, -2, -2, 1, 1, '#ff9ab0');
      break;
    case 'energy':
      px(ctx, -2, -5, 5, 10, '#0e2830');
      px(ctx, -1, -4, 3, 8, '#6ee0f4');
      px(ctx, 0, -6, 1, 1, '#6ee0f4');
      px(ctx, -1, -2, 1, 2, '#d6fbff');
      break;
    case 'crystal': {
      const glow = 0.65 + Math.sin(t * 5) * 0.3;
      ctx.globalAlpha = glow;
      px(ctx, -1, -6, 2, 2, '#ffd0ec');
      px(ctx, -2, -4, 4, 4, '#e878c0');
      px(ctx, -3, -3, 6, 2, '#e878c0');
      px(ctx, -1, 0, 2, 2, '#b0508e');
      ctx.globalAlpha = 1;
      px(ctx, -1, -4, 1, 2, '#fff0fa');
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/** 出口:哥特拱门传送门 */
export function drawExitGate(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  // 石拱门
  px(ctx, -12, -30, 4, 30, '#3a3244');
  px(ctx, 8, -30, 4, 30, '#3a3244');
  px(ctx, -12, -30, 1, 30, '#5c5270');
  px(ctx, 8, -30, 1, 30, '#5c5270');
  // 拱顶
  px(ctx, -12, -33, 24, 3, '#4a4258');
  px(ctx, -9, -36, 18, 3, '#4a4258');
  px(ctx, -5, -38, 10, 2, '#4a4258');
  px(ctx, -9, -36, 18, 1, '#6c6280');
  px(ctx, -5, -38, 10, 1, '#6c6280');
  // 顶部宝石
  const gemGlow = 0.6 + Math.sin(t * 4) * 0.3;
  ctx.globalAlpha = gemGlow;
  px(ctx, -1, -41, 2, 3, '#e878c0');
  ctx.globalAlpha = 1;

  // 传送光幕
  for (let i = 0; i < 7; i++) {
    const a = 0.22 + 0.18 * Math.sin(t * 4 + i * 1.3);
    ctx.globalAlpha = a;
    px(ctx, -8, -31 + i * 4.5, 16, 4, i % 2 === 0 ? '#7ee0f4' : '#e878c0');
  }
  // 辉光
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.10 + Math.sin(t * 3) * 0.04;
  ctx.fillStyle = '#b08ae0';
  ctx.beginPath();
  ctx.arc(0, -16, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 检查点:烛台路标(点亮后燃起弦火) */
export function drawCheckpoint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  active: boolean,
  t: number,
): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  // 石座
  px(ctx, -4, -3, 8, 3, '#3a3244');
  px(ctx, -4, -3, 8, 1, '#5c5270');
  // 烛柱
  px(ctx, -1, -18, 2, 15, '#4a4258');
  px(ctx, -1, -18, 1, 15, '#6c6280');
  px(ctx, -3, -19, 6, 2, '#4a4258');
  px(ctx, -3, -19, 6, 1, '#6c6280');

  if (active) {
    // 弦火(青粉色火焰)
    const f = Math.floor(t * 10) % 3;
    px(ctx, -1, -23 + f * 0.5, 2, 4, '#7ee0f4');
    px(ctx, -2, -22, 4, 2, 'rgba(126,224,244,0.5)');
    px(ctx, 0, -24, 1, 2, '#e878c0');
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.14 + Math.sin(t * 6) * 0.05;
    ctx.fillStyle = '#7ee0f4';
    ctx.beginPath();
    ctx.arc(0, -21, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  } else {
    px(ctx, -1, -21, 2, 2, '#2e2a3a');
  }
  ctx.restore();
}

/** 烛火装饰(地形点缀) */
export function drawCandle(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, accent: string): void {
  const flick = Math.floor(t * 9) % 3;
  px(ctx, x, y - 5, 2, 5, '#d8cfc0');
  px(ctx, x, y - 5, 1, 5, '#f4efe4');
  px(ctx, x, y - 7 - (flick === 2 ? 1 : 0), 2, 2 + (flick === 2 ? 1 : 0), accent);
  px(ctx, x, y - 8 - (flick === 2 ? 1 : 0), 1, 1, '#fff4d0');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.10 + flick * 0.02;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(x + 1, y - 7, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
