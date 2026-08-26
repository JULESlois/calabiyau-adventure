// 全程序化像素美术(恶魔城 / 神之亵渎 风格):
// 厚重描边、深色分层阴影、烛火与辉光,不加载任何图片素材。
import type { CharId, StringMode } from '../types';

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
  moveSpeed: number; // 0..1,仅用于步频与身体前倾
  airborne: boolean;
  vy: number;
  takeoff: number; // 1..0,起跳拉伸过渡
  landing: number; // 1..0,落地压缩过渡
  turning: number; // 1..0,反向移动缓冲
  paper: boolean;
  stringMode: StringMode;
  meleeT: number; // 0 无近战,>0 为挥击进度 0..1
  meleeStep: number; // 连段 0/1/2
  shootFlash: number; // 枪口焰 0..1
  hurtFlash: boolean;
  time: number;
}

export type AirMotionStage = 'ground' | 'rise' | 'apex' | 'fall';

export function resolveAirMotionStage(airborne: boolean, vy: number): AirMotionStage {
  if (!airborne) return 'ground';
  if (vy < -70) return 'rise';
  if (vy <= 85) return 'apex';
  return 'fall';
}

/** 飘飞时以脚底为轴向面朝方向前倾，速度只做小幅修正。 */
export function resolveGlideTilt(vy: number, time: number): number {
  const flutter = Math.sin(time * 16) * 0.055;
  const fallTilt = Math.max(-0.06, Math.min(0.12, vy / 360));
  return 0.28 + fallTilt + flutter;
}

interface LocomotionFrame {
  idle: boolean;
  running: boolean;
  air: AirMotionStage;
  bodyY: number;
  hairX: number;
  hairY: number;
  leftX: number;
  rightX: number;
  leftLift: number;
  rightLift: number;
  weaponY: number;
  blink: boolean;
}

function locomotionFrame(pose: CharPose, blinkOffset: number): LocomotionFrame {
  const air = resolveAirMotionStage(pose.airborne, pose.vy);
  const running = pose.moving && air === 'ground';
  const idle = !running && air === 'ground';
  const stride = running ? Math.sin(pose.runPhase) : 0;

  let leftX = 0;
  let rightX = 0;
  let leftLift = 0;
  let rightLift = 0;
  if (running) {
    leftX = Math.round(stride * 2);
    rightX = -leftX;
    leftLift = Math.round(Math.max(0, stride) * 2);
    rightLift = Math.round(Math.max(0, -stride) * 2);
  } else if (air === 'rise') {
    leftX = -1;
    rightX = 1;
    leftLift = 3;
    rightLift = 1;
  } else if (air === 'apex') {
    leftX = -1;
    rightX = 1;
    leftLift = 2;
    rightLift = 3;
  } else if (air === 'fall') {
    leftX = -1;
    rightX = 1;
    leftLift = 0;
    rightLift = 1;
  }

  const bodyY =
    pose.landing > 0.05 || pose.takeoff > 0.2
      ? 1
      : running
        ? -Math.round(Math.abs(Math.sin(pose.runPhase * 2)))
        : 0;
  const hairX = running ? -1 - Math.round(Math.abs(stride)) : air === 'ground' ? 0 : -1;
  const hairY = air === 'rise' ? 2 : air === 'fall' ? -2 : air === 'apex' ? -1 : 0;
  const blinkPhase = (pose.time + blinkOffset) % 4.6;

  return {
    idle,
    running,
    air,
    bodyY,
    hairX,
    hairY,
    leftX,
    rightX,
    leftLift,
    rightLift,
    weaponY: running ? Math.round(Math.abs(Math.sin(pose.runPhase))) : 0,
    blink: idle && blinkPhase > 4.42,
  };
}

function applyNormalMotion(ctx: CanvasRenderingContext2D, pose: CharPose): void {
  if (pose.stringMode !== 'normal') return;

  const speed = Math.max(0, Math.min(1, pose.moveSpeed));
  if (pose.airborne) {
    const stage = resolveAirMotionStage(true, pose.vy);
    if (stage === 'rise') {
      ctx.rotate(speed > 0.1 ? 0.045 : 0);
      ctx.scale(0.95, 1.055);
    } else if (stage === 'apex') {
      ctx.rotate(speed > 0.1 ? 0.02 : 0);
      ctx.scale(1.035, 0.975);
    } else {
      ctx.rotate(speed > 0.1 ? -0.03 : 0);
      ctx.scale(0.975, 1.035);
    }
  }

  if (pose.takeoff > 0) {
    ctx.scale(1 - pose.takeoff * 0.045, 1 + pose.takeoff * 0.065);
  }
  if (!pose.airborne && pose.landing > 0) {
    const impact = pose.landing * pose.landing;
    ctx.scale(1 + impact * 0.09, 1 - impact * 0.115);
  }
  if (!pose.airborne && pose.turning > 0) {
    ctx.rotate(-pose.turning * 0.075);
    ctx.scale(1 - pose.turning * 0.045, 1 + pose.turning * 0.025);
  }
}

// 配色采样自官方立绘(refs: docs/ref_images/):
// 米雪儿·李:暖金色高位长双马尾、蓝瞳、黑色科技猫耳头饰、蓝色短外套(红衬里)、
//            白色连体衣+黑领带+金铃铛、棕腰带、黑指切手套、腿环、黑靴蓝底;「警探」枪灰突击步枪。
const MICHELE = {
  hair: '#f0b874',
  hairHi: '#f8ddb0',
  hairDk: '#c8873e',
  tie: '#4a86d8',
  skin: '#f4dcc4',
  skinDk: '#d0a888',
  white: '#e8e8f0',
  whiteDk: '#b8bcd0',
  blue: '#3c55b8',
  blueHi: '#5a76d8',
  red: '#8a3040',
  neck: '#2a2a34',
  bell: '#e8b83c',
  belt: '#5a4236',
  buckle: '#c8a050',
  ear: '#33363f',
  earIn: '#8a8e9e',
  strap: '#3a3028',
  glove: '#3a3e4a',
  boots: '#23262e',
  bootsHi: '#4a4e58',
  sole: '#3a5dc0',
  gun: '#6e737c',
  gunHi: '#9a9ea6',
  gunDk: '#4a4e56',
  gunGlow: '#8fd7ff',
  eye: '#3a7ce0',
};

// 香奈美:淡紫长发+粉色挑染+呆毛、蓝紫瞳、黑色露肩上衣、粉腰带+白色层叠裙(深粉裙缘)、
//         黑袖+粉手套、白色过膝长靴(粉靴口/灰趾)、背后淡金飘带;「谢幕曲」枪灰狙击枪(大瞄准镜)。
const KANAMI = {
  hair: '#e6ddf2',
  hairHi: '#f8f4fc',
  hairDk: '#b4a4d0',
  streak: '#f078b8',
  ornament: '#3a3644',
  skin: '#f8e2cc',
  skinDk: '#d8ac8c',
  top: '#3a3048',
  topHi: '#574a68',
  beltPink: '#eabdd1',
  skirt: '#f5f3f8',
  skirtDk: '#c8c4d8',
  deepPink: '#d6517e',
  sleeve: '#4c4056',
  glovePink: '#f36094',
  boot: '#eef0f6',
  bootDk: '#c4c8da',
  kneePink: '#f36094',
  toe: '#5a5e6a',
  streamer: '#eed9c0',
  rifle: '#5a5e66',
  rifleHi: '#8a8e94',
  rifleDk: '#33373f',
  scope: '#2a2e38',
  accent: '#f36094',
  mic: '#d8a840',
  micGlow: '#ffe8a0',
  eye: '#7060d0',
};

function paintMichele(g: CanvasRenderingContext2D, pose: CharPose): void {
  const t = pose.time;
  const motion = locomotionFrame(pose, 0);
  const top = ORIGIN_Y - 22 + motion.bodyY;
  const x0 = ORIGIN_X;
  const sway = motion.running
    ? Math.round(Math.sin(pose.runPhase - 0.8))
    : Math.round(Math.sin(t * 2.6));
  const tailY = motion.hairY;

  // ---- 高位长双马尾(暖金,垂至膝,后层带摆动)----
  px(g, x0 - 8 + motion.hairX, top + 1 + sway + tailY, 2, 17, MICHELE.hair);
  px(g, x0 + 6 + motion.hairX, top + 1 - sway + tailY, 2, 17, MICHELE.hair);
  px(g, x0 - 8 + motion.hairX, top + 1 + sway + tailY, 1, 17, MICHELE.hairDk);
  px(g, x0 + 7 + motion.hairX, top + 1 - sway + tailY, 1, 17, MICHELE.hairDk);
  px(g, x0 - 8 + motion.hairX, top + 18 + sway + tailY, 2, 2, MICHELE.hairDk); // 尾梢
  px(g, x0 + 6 + motion.hairX, top + 18 - sway + tailY, 2, 2, MICHELE.hairDk);
  // 蓝发绳(高位)
  px(g, x0 - 8 + motion.hairX, top + 2 + sway + tailY, 2, 1, MICHELE.tie);
  px(g, x0 + 6 + motion.hairX, top + 2 - sway + tailY, 2, 1, MICHELE.tie);

  // ---- 黑色科技猫耳头饰 ----
  px(g, x0 - 5, top - 2, 3, 3, MICHELE.ear);
  px(g, x0 - 4, top - 3, 1, 1, MICHELE.ear);
  px(g, x0 + 2, top - 2, 3, 3, MICHELE.ear);
  px(g, x0 + 3, top - 3, 1, 1, MICHELE.ear);
  px(g, x0 - 4, top - 1, 1, 1, MICHELE.earIn);
  px(g, x0 + 3, top - 1, 1, 1, MICHELE.earIn);

  // ---- 金发刘海 ----
  px(g, x0 - 5, top, 10, 5, MICHELE.hair);
  px(g, x0 - 5, top, 10, 1, MICHELE.hairHi);
  px(g, x0 - 5, top + 4, 2, 3, MICHELE.hair);
  px(g, x0 + 3, top + 4, 2, 3, MICHELE.hair);
  px(g, x0 - 5, top + 6, 2, 1, MICHELE.hairDk);
  px(g, x0 + 3, top + 6, 2, 1, MICHELE.hairDk);

  // ---- 脸(蓝瞳)----
  px(g, x0 - 3, top + 4, 6, 4, MICHELE.skin);
  px(g, x0 - 3, top + 7, 6, 1, MICHELE.skinDk);
  if (motion.blink) {
    px(g, x0 - 2, top + 6, 1, 1, MICHELE.eye);
    px(g, x0 + 1, top + 6, 1, 1, MICHELE.eye);
  } else {
    px(g, x0 - 2, top + 5, 1, 2, MICHELE.eye);
    px(g, x0 + 1, top + 5, 1, 2, MICHELE.eye);
  }

  // ---- 白色连体衣 + 蓝色短外套(红衬里)+ 黑领带金铃铛 + 棕腰带 ----
  px(g, x0 - 4, top + 8, 8, 5, MICHELE.white);
  px(g, x0 - 4, top + 8, 8, 1, '#ffffff');
  px(g, x0 - 4, top + 8, 2, 4, MICHELE.blue); // 左袖
  px(g, x0 + 2, top + 8, 2, 4, MICHELE.blue); // 右袖
  px(g, x0 - 4, top + 8, 2, 1, MICHELE.blueHi);
  px(g, x0 + 2, top + 8, 2, 1, MICHELE.blueHi);
  px(g, x0 - 2, top + 8, 1, 1, MICHELE.red); // 红衬里
  px(g, x0 + 1, top + 8, 1, 1, MICHELE.red);
  px(g, x0, top + 8, 1, 2, MICHELE.neck); // 黑领带
  px(g, x0, top + 10, 1, 1, MICHELE.bell); // 金铃铛
  px(g, x0 - 4, top + 12, 8, 1, MICHELE.belt); // 棕腰带
  px(g, x0, top + 12, 1, 1, MICHELE.buckle);
  px(g, x0 - 4, top + 13, 8, 2, MICHELE.white); // 白短裤
  px(g, x0 - 4, top + 14, 8, 1, MICHELE.whiteDk);

  // ---- 手臂 / 警探突击步枪(枪灰)----
  const armSwing = motion.running ? Math.round(Math.sin(pose.runPhase + Math.PI)) : 0;
  const weaponY = motion.weaponY;
  if (pose.meleeT > 0) {
    const sw = Math.round(pose.meleeT * 7);
    px(g, x0 + 1 + sw, top + 9, 5, 2, MICHELE.skin);
    px(g, x0 + 5 + sw, top + 8, 3, 3, MICHELE.gun);
  } else {
    px(g, x0 - 6, top + 9 + armSwing + weaponY, 2, 4, MICHELE.blue); // 后臂(蓝袖)
    px(g, x0 + 2, top + 10 + weaponY, 3, 2, MICHELE.skin); // 前臂
    px(g, x0 + 4, top + 10 + weaponY, 2, 2, MICHELE.glove); // 指切手套
    // 警探:枪身 / 上导轨 / 光学瞄具 / 托 / 弹匣 / 枪口传感
    px(g, x0 + 3, top + 8 + weaponY, 8, 2, MICHELE.gun);
    px(g, x0 + 3, top + 8 + weaponY, 8, 1, MICHELE.gunHi);
    px(g, x0 + 2, top + 9 + weaponY, 1, 2, MICHELE.gunDk);
    px(g, x0 + 5, top + 10 + weaponY, 2, 2, MICHELE.gunDk);
    px(g, x0 + 6, top + 7 + weaponY, 2, 1, MICHELE.gunDk);
    px(g, x0 + 10, top + 8 + weaponY, 1, 1, MICHELE.gunGlow);
  }

  // ---- 裸腿 + 腿环 + 黑靴(蓝底)----
  const leftX = x0 - 3 + motion.leftX;
  const rightX = x0 + 1 + motion.rightX;
  const leftBootY = top + 19 - motion.leftLift;
  const rightBootY = top + 19 - motion.rightLift;
  // 左腿
  px(g, leftX, top + 15, 2, Math.max(1, 4 - motion.leftLift), MICHELE.skin);
  px(g, leftX, top + 16, 2, 1, MICHELE.strap);
  px(g, leftX, leftBootY, 2, 3, MICHELE.boots);
  px(g, leftX, leftBootY, 2, 1, MICHELE.bootsHi);
  px(g, leftX, leftBootY + 2, 3, 1, MICHELE.sole);
  // 右腿
  px(g, rightX, top + 15, 2, Math.max(1, 4 - motion.rightLift), MICHELE.skin);
  px(g, rightX, top + 16, 2, 1, MICHELE.strap);
  px(g, rightX, rightBootY, 2, 3, MICHELE.boots);
  px(g, rightX, rightBootY, 2, 1, MICHELE.bootsHi);
  px(g, rightX, rightBootY + 2, 3, 1, MICHELE.sole);
}

function paintKanami(g: CanvasRenderingContext2D, pose: CharPose): void {
  const t = pose.time;
  const motion = locomotionFrame(pose, 1.7);
  const top = ORIGIN_Y - 22 + motion.bodyY;
  const x0 = ORIGIN_X;
  const sway = motion.running
    ? Math.round(Math.sin(pose.runPhase - 1.05))
    : Math.round(Math.sin(t * 2.2));
  const tailY = motion.hairY;
  const ribbonTrail = motion.hairX - (motion.running || motion.air !== 'ground' ? 1 : 0);

  // ---- 背后淡金飘带(最后层)----
  px(g, x0 - 8 + ribbonTrail, top + 10 + sway + tailY, 1, 7, KANAMI.streamer);
  px(g, x0 - 10 + ribbonTrail, top + 16 + sway + tailY, 3, 1, KANAMI.streamer);
  px(g, x0 + 6 + ribbonTrail, top + 10 - sway + tailY, 1, 7, KANAMI.streamer);
  px(g, x0 + 4 + ribbonTrail, top + 16 - sway + tailY, 3, 1, KANAMI.streamer);

  // ---- 后发(淡紫长发及腰,粉色挑染)----
  px(g, x0 - 6 + motion.hairX, top + 2 + sway + tailY, 2, 14, KANAMI.hair);
  px(g, x0 + 4 + motion.hairX, top + 2 - sway + tailY, 2, 14, KANAMI.hair);
  px(g, x0 - 6 + motion.hairX, top + 12 + sway + tailY, 2, 4, KANAMI.hairDk); // 发尾阴影
  px(g, x0 + 4 + motion.hairX, top + 12 - sway + tailY, 2, 4, KANAMI.hairDk);
  px(g, x0 + 5 + motion.hairX, top + 4 - sway + tailY, 1, 9, KANAMI.streak); // 粉挑染
  px(g, x0 - 7 + motion.hairX, top + 9 + sway + tailY, 1, 6, KANAMI.hairDk); // 外侧发丝
  px(g, x0 + 6 + motion.hairX, top + 9 - sway + tailY, 1, 6, KANAMI.hairDk);

  // ---- 呆毛 + 侧发饰 ----
  px(g, x0 - 1, top - 3, 2, 1, KANAMI.hair);
  px(g, x0 - 2, top - 2, 1, 1, KANAMI.hair);
  px(g, x0, top - 2, 1, 1, KANAMI.hairHi);
  px(g, x0 + 4, top + 1, 1, 2, KANAMI.ornament); // 黑色科技发饰

  // ---- 刘海(带一缕粉挑染)----
  px(g, x0 - 5, top, 10, 5, KANAMI.hair);
  px(g, x0 - 5, top, 10, 1, KANAMI.hairHi);
  px(g, x0 - 5, top + 4, 2, 4, KANAMI.hair);
  px(g, x0 + 3, top + 4, 2, 4, KANAMI.hair);
  px(g, x0 - 4, top + 1, 1, 3, KANAMI.streak);

  // ---- 脸(蓝紫瞳)----
  px(g, x0 - 3, top + 4, 6, 4, KANAMI.skin);
  px(g, x0 - 3, top + 7, 6, 1, KANAMI.skinDk);
  if (motion.blink) {
    px(g, x0 - 2, top + 6, 1, 1, KANAMI.eye);
    px(g, x0 + 1, top + 6, 1, 1, KANAMI.eye);
  } else {
    px(g, x0 - 2, top + 5, 1, 2, KANAMI.eye);
    px(g, x0 + 1, top + 5, 1, 2, KANAMI.eye);
  }

  // ---- 黑色露肩上衣 + 粉腰带 + 白色层叠裙(深粉裙缘)----
  px(g, x0 - 4, top + 8, 8, 1, KANAMI.skin); // 露肩
  px(g, x0 - 4, top + 9, 8, 3, KANAMI.top);
  px(g, x0 - 4, top + 9, 8, 1, KANAMI.topHi);
  px(g, x0 - 4, top + 12, 8, 1, KANAMI.beltPink);
  const skirtFlare = motion.air !== 'ground' || (motion.running && Math.abs(Math.sin(pose.runPhase)) > 0.65) ? 1 : 0;
  px(g, x0 - 5 - skirtFlare, top + 13, 10 + skirtFlare * 2, 2, KANAMI.skirt);
  px(g, x0 - 5 - skirtFlare, top + 13, 10 + skirtFlare * 2, 1, '#ffffff');
  px(g, x0 - 5 - skirtFlare, top + 14, 10 + skirtFlare * 2, 1, KANAMI.deepPink);
  px(g, x0 - 5 - skirtFlare, top + 13, 1, 2, KANAMI.skirtDk);
  px(g, x0 + 4 + skirtFlare, top + 13, 1, 2, KANAMI.skirtDk);

  // ---- 手臂(黑袖+粉手套)/ 谢幕曲狙击枪(枪灰,大瞄准镜)----
  const armSwing = motion.running ? Math.round(Math.sin(pose.runPhase + Math.PI)) : 0;
  const weaponY = motion.weaponY;
  if (pose.meleeT > 0) {
    const sw = Math.round(pose.meleeT * 7);
    px(g, x0 + 1 + sw, top + 9, 5, 2, KANAMI.sleeve);
    px(g, x0 + 5 + sw, top + 7, 3, 4, KANAMI.mic);
    px(g, x0 + 5 + sw, top + 7, 3, 1, KANAMI.micGlow);
  } else {
    px(g, x0 - 6, top + 9 + armSwing + weaponY, 2, 4, KANAMI.sleeve); // 后臂黑袖
    px(g, x0 + 2, top + 10 + weaponY, 3, 2, KANAMI.sleeve); // 前臂黑袖
    px(g, x0 + 4, top + 10 + weaponY, 2, 2, KANAMI.glovePink); // 粉手套
    // 谢幕曲:枪身 / 上棱线 / 大瞄准镜 / 弹匣 / 枪托 / 枪口制退器 / 粉饰条
    px(g, x0 + 1, top + 8 + weaponY, 11, 2, KANAMI.rifle);
    px(g, x0 + 1, top + 8 + weaponY, 11, 1, KANAMI.rifleHi);
    px(g, x0 + 4, top + 6 + weaponY, 4, 2, KANAMI.scope);
    px(g, x0 + 4, top + 6 + weaponY, 4, 1, '#4a4e5a');
    px(g, x0 + 6, top + 10 + weaponY, 2, 1, KANAMI.rifleDk);
    px(g, x0 + 1, top + 10 + weaponY, 2, 1, KANAMI.rifleDk);
    px(g, x0 + 12, top + 8 + weaponY, 1, 2, KANAMI.rifleDk);
    px(g, x0 + 9, top + 9 + weaponY, 2, 1, KANAMI.accent);
  }

  // ---- 白色过膝长靴(粉靴口 / 灰趾)----
  const leftX = x0 - 3 + motion.leftX;
  const rightX = x0 + 1 + motion.rightX;
  const leftBootY = top + 16 - motion.leftLift;
  const rightBootY = top + 16 - motion.rightLift;
  // 左腿
  px(g, leftX, top + 15, 2, 1, KANAMI.kneePink);
  px(g, leftX, leftBootY, 2, 5, KANAMI.boot);
  px(g, leftX, leftBootY, 1, 1, KANAMI.bootDk);
  px(g, leftX, top + 21 - motion.leftLift, 3, 1, KANAMI.toe);
  // 右腿
  px(g, rightX, top + 15, 2, 1, KANAMI.kneePink);
  px(g, rightX, rightBootY, 2, 5, KANAMI.boot);
  px(g, rightX + 1, rightBootY, 1, 1, KANAMI.bootDk);
  px(g, rightX, top + 21 - motion.rightLift, 3, 1, KANAMI.toe);
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
  applyNormalMotion(ctx, pose);
  if (pose.stringMode === 'ground') {
    ctx.scale(0.25, 1);
    ctx.globalAlpha = 0.92;
  } else if (pose.stringMode === 'wall') {
    ctx.translate(1, 0);
    ctx.scale(0.18, 0.98);
    ctx.globalAlpha = 0.94;
  } else if (pose.stringMode === 'glide') {
    ctx.rotate(resolveGlideTilt(pose.vy, pose.time));
    ctx.transform(0.38, 0, Math.sin(pose.time * 12) * 0.1, 0.92, 0, 0);
    ctx.globalAlpha = 0.9;
  }
  if (pose.hurtFlash) ctx.globalAlpha = 0.55;

  blitOutlined(ctx);

  // 枪口焰(不描边,叠加发光)
  if (pose.shootFlash > 0 && !pose.paper) {
    const f = pose.shootFlash;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = f;
    const gx = char === 'michele' ? 11 : 13;
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

  // 三种弦化形态使用不同轮廓与风动提示。
  if (pose.stringMode === 'ground') {
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(pose.time * 10) * 0.25;
    ctx.strokeStyle = '#aef4ff';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) - 3.5, Math.round(y) - 23.5, 7, 24);
    ctx.restore();
  } else if (pose.stringMode === 'wall') {
    ctx.save();
    ctx.globalAlpha = 0.62 + Math.sin(pose.time * 9) * 0.18;
    ctx.strokeStyle = '#aef4ff';
    ctx.strokeRect(Math.round(x) - 2.5, Math.round(y) - 23.5, 5, 24);
    ctx.fillStyle = '#d8f8ff';
    ctx.fillRect(Math.round(x) + facing * 3, Math.round(y) - 18, 1, 12);
    ctx.restore();
  } else if (pose.stringMode === 'glide') {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (facing < 0) ctx.scale(-1, 1);
    ctx.rotate(resolveGlideTilt(pose.vy, pose.time));
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#aef4ff';
    ctx.strokeRect(-4.5, -23.5, 9, 24);
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = '#d8f8ff';
    for (let i = 0; i < 3; i++) {
      const windX = -12 - i * 7 - ((pose.time * 35 + i * 5) % 8);
      const windY = -18 + i * 7 + Math.sin(pose.time * 8 + i) * 2;
      ctx.fillRect(Math.round(windX), Math.round(windY), 8 + i * 2, 1);
    }
    ctx.restore();
  }

}

/** 敌人当帧的攻击意图;渲染层据此画出"要出手了"的预告。 */
export interface EnemyPose {
  frozen: boolean;
  hurtFlash: boolean;
  aimAngle: number;
  /** 蓄力进度 0..1(刺镰突刺前摇 / 逆弦犬嗅探 / 迫击晶装填);<0 表示未蓄力 */
  windup: number;
  /** 引信进度 0..1(爆裂魔怪);<0 表示未点燃 */
  fuse: number;
  /** 是否处于突进 / 俯冲中 */
  lunging: boolean;
  /** 逆弦犬已锁定玩家 */
  locked: boolean;
  /** 镜弦猎兵:正沿墙面弦化行进 */
  traveling: boolean;
  /** 展弦失衡进度 1..0;<0 表示不在失衡中 */
  unfurl: number;
}

function paintEnemy(
  g: CanvasRenderingContext2D,
  kind: string,
  facing: number,
  time: number,
  pose: EnemyPose,
): void {
  const { frozen, aimAngle } = pose;
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
    case 'exploder': {
      if (facing < 0) g.scale(-1, 1);
      // 引信点燃时脉动速率随进度加快,并画出爆炸半径提示圈 ——
      // 玩家需要看一眼就知道"还有多久"和"要躲多远"。
      const lit = pose.fuse >= 0;
      const beat = lit ? 6 + pose.fuse * 26 : 6;
      const puls = 1 + Math.sin(time * beat) * 0.5;
      const bodyC = frozen ? '#8fc8e8' : lit ? '#8a3a5a' : '#6a2a7a';
      const veinC = frozen ? '#c8ecf8' : '#c44a9a';
      const coreC = frozen ? '#e8f8ff' : lit && Math.floor(time * beat) % 2 === 0 ? '#fff0d0' : '#ff5a4a';
      if (lit) {
        g.save();
        g.globalAlpha = 0.10 + pose.fuse * 0.18;
        g.strokeStyle = '#ff8a5c';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(0, -6, 15 + pose.fuse * 5, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
      // 蠕行的晶簇肉团
      px(g, -7, -10, 14, 8, bodyC);
      px(g, -7, -10, 14, 1, veinC);
      px(g, -5, -12, 4, 2, bodyC);
      px(g, 2, -13, 3, 3, bodyC);
      px(g, -8, -6, 2, 4, bodyC);
      px(g, 6, -7, 2, 5, bodyC);
      // 晶棘
      px(g, -3, -14, 1, 2, veinC);
      px(g, 4, -15, 1, 2, veinC);
      // 不稳定核心(脉动)
      px(g, -2, -8, 4 + Math.round(puls), 3, coreC);
      px(g, -1, -7, 2, 1, '#ffd0a0');
      if (lit) px(g, -3, -16, 2, 3, '#ffe08a'); // 引信火花
      // 蠕足
      const crawl = Math.floor(time * 8) % 2;
      px(g, -6 + crawl, -2, 3, 2, '#3a1a44');
      px(g, 0, -2, 3, 2, '#3a1a44');
      px(g, 4 - crawl, -2, 3, 2, '#3a1a44');
      break;
    }
    case 'slasher': {
      if (facing < 0) g.scale(-1, 1);
      const winding = pose.windup >= 0;
      const bodyC = frozen ? '#8fc8e8' : winding ? '#a33048' : '#7a2438';
      const boneC = frozen ? '#c8ecf8' : '#e8c8c0';
      const eyeC2 = frozen ? '#e8f8ff' : '#ff3d5c';
      // 突刺拖影:让高速位移读起来是"冲出去"而不是瞬移
      if (pose.lunging) {
        g.save();
        g.globalAlpha = 0.22;
        px(g, -12, -12, 11, 8, bodyC);
        g.globalAlpha = 0.11;
        px(g, -19, -11, 11, 7, bodyC);
        g.restore();
      }
      // 蓄力时压低身体、镰刃高举 —— 前摇越满,举得越高
      const crouch = winding ? Math.round(pose.windup * 2) : 0;
      const raise = winding ? 2 + Math.round(pose.windup * 3) : Math.floor(time * 5) % 2;
      // 弓身晶壳
      px(g, -6, -12 + crouch, 11, 8 - crouch, bodyC);
      px(g, -6, -12 + crouch, 11, 1, '#a84a60');
      px(g, -7, -8, 2, 4, bodyC);
      // 镰刃前肢(骨白,起手上扬)
      px(g, 4, -14 - raise, 2, 6, boneC);
      px(g, 5, -16 - raise, 2, 3, boneC);
      px(g, 6, -17 - raise, 1, 2, '#fff4ec');
      if (winding) {
        // 刃尖寒光:蓄力的关键读牌信号
        g.save();
        g.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(time * 18));
        px(g, 6, -19 - raise, 2, 2, '#ffffff');
        px(g, 8, -17 - raise, 2, 1, '#ffe8f0');
        g.restore();
      }
      // 独眼
      px(g, 0, -10 + crouch, 4, 3, '#12060e');
      px(g, 1, -9 + crouch, 2, 1, winding ? '#fff0a0' : eyeC2);
      // 节肢
      const step = Math.floor(time * 10) % 2;
      px(g, -5 + step, -4, 2, 4, '#3a1420');
      px(g, -1, -4, 2, 4, '#3a1420');
      px(g, 3 - step, -4, 2, 4, '#3a1420');
      break;
    }
    case 'leech': {
      if (facing < 0) g.scale(-1, 1);
      const bodyC = frozen ? '#8fc8e8' : '#2f5f58';
      const finC = frozen ? '#c8ecf8' : '#8de0c4';
      // 弦蛭:悬吊时垂下弦丝,坠落时收成锥形
      if (pose.lunging) {
        px(g, -4, -10, 8, 10, bodyC);
        px(g, -4, -10, 8, 1, finC);
        px(g, -2, -1, 4, 3, finC); // 收拢的尖端
        px(g, -3, -7, 6, 2, '#12201e');
        px(g, -2, -6, 2, 1, '#ffe08a');
      } else {
        // 悬吊:上方的弦丝随时间轻摆
        const sway = Math.sin(time * 2.2) * 1.5;
        g.save();
        g.globalAlpha = 0.55;
        px(g, Math.round(sway), -22, 1, 12, finC);
        g.restore();
        px(g, -6, -10, 12, 7, bodyC);
        px(g, -6, -10, 12, 1, finC);
        px(g, -4, -3, 8, 3, bodyC);
        // 吸盘环
        for (let i = 0; i < 3; i++) px(g, -4 + i * 3, -2, 2, 2, '#12201e');
        px(g, -3, -7, 6, 2, '#12201e');
        const blink = Math.floor(time * 3) % 4 === 0;
        px(g, -2, -6, 2, 1, blink ? '#12201e' : '#ffe08a');
        px(g, 1, -6, 2, 1, blink ? '#12201e' : '#ffe08a');
      }
      break;
    }
    case 'mortar': {
      if (facing < 0) g.scale(-1, 1);
      const charging = pose.windup >= 0;
      const chargeLvl = charging ? pose.windup : 0;
      const bodyC = frozen ? '#8fc8e8' : '#4a3a30';
      const hiC = frozen ? '#c8ecf8' : '#7a6250';
      // 底座与配重
      px(g, -8, -6, 16, 6, bodyC);
      px(g, -8, -6, 16, 1, hiC);
      px(g, -9, -2, 18, 2, '#1e1610');
      // 炮管上仰(固定角度,读起来就是抛射武器)
      px(g, -2, -13, 5, 8, bodyC);
      px(g, -1, -16, 5, 5, bodyC);
      px(g, -1, -16, 5, 1, hiC);
      // 装填蓄光:亮度与半径随进度上升,满蓄前一刻最刺眼
      if (charging) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.25 + chargeLvl * 0.6;
        g.fillStyle = chargeLvl > 0.8 ? '#fff0c8' : '#ffb066';
        g.beginPath();
        g.arc(1, -15, 2 + chargeLvl * 4, 0, Math.PI * 2);
        g.fill();
        g.restore();
        px(g, 0, -16, 3, 2, chargeLvl > 0.8 ? '#ffffff' : '#ffd08a');
      }
      // 侧面弹仓
      px(g, -7, -11, 4, 5, '#2e241c');
      px(g, -6, -10, 2, 3, '#c8843c');
      break;
    }
    case 'stringer': {
      if (facing < 0) g.scale(-1, 1);
      const violet = frozen ? '#8fc8e8' : '#5a3a86';
      const hiC = frozen ? '#c8ecf8' : '#a878e0';
      const glow = frozen ? '#e8f8ff' : '#c47eff';
      if (pose.traveling) {
        // 行程中:整个身体压成一道纸片流光,读起来是"贴着弦面滑走"
        g.save();
        g.globalAlpha = 0.85;
        px(g, -10, -10, 20, 3, glow);
        px(g, -14, -9, 8, 1, hiC);
        g.globalAlpha = 0.4;
        px(g, -18, -10, 6, 2, violet);
        g.restore();
        break;
      }
      const unfurling = pose.unfurl >= 0;
      if (unfurling) {
        // 展弦:纸片从中线向两侧摊开,失衡窗口的读牌信号
        const open = 1 - pose.unfurl;
        g.save();
        g.globalAlpha = 0.5 + open * 0.5;
        px(g, -Math.round(7 * open) - 1, -16, Math.round(14 * open) + 2, 14, violet);
        px(g, -1, -18, 2, 18, glow);
        g.globalAlpha = 0.7;
        px(g, -Math.round(7 * open), -16, 1, 14, hiC);
        px(g, Math.round(7 * open), -16, 1, 14, hiC);
        g.restore();
        // 失衡星芒
        g.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(time * 14));
        px(g, -1, -21, 3, 1, '#ffe9a8');
        px(g, 0, -22, 1, 3, '#ffe9a8');
        g.globalAlpha = 1;
        break;
      }
      // 3D 战斗形态:高瘦猎兵,肩披弦纹斗篷
      px(g, -5, -17, 10, 12, violet);
      px(g, -5, -17, 10, 1, hiC);
      px(g, -6, -12, 3, 8, violet); // 斗篷摆
      const swayC = Math.floor(time * 4) % 2;
      px(g, -7, -6 + swayC, 3, 3, violet);
      // 头 / 单目
      px(g, -3, -21, 7, 5, violet);
      px(g, -3, -21, 7, 1, hiC);
      px(g, 0, -19, 3, 2, '#12060e');
      px(g, 1, -19, 1, 1, glow);
      // 胸口弦核(它换位的能量源)
      const corePulse = Math.floor(time * 3) % 2;
      px(g, -1, -13, 3, 3, corePulse ? glow : hiC);
      // 腿
      const step2 = Math.floor(time * 7) % 2;
      px(g, -4 + step2, -5, 3, 5, '#241a34');
      px(g, 1 - step2, -5, 3, 5, '#241a34');
      // 弦纹:身侧两根绷紧的弦
      g.globalAlpha = 0.55;
      px(g, -8, -18, 1, 14, glow);
      px(g, 7, -16, 1, 12, glow);
      g.globalAlpha = 1;
      break;
    }
    case 'hound': {
      if (facing < 0) g.scale(-1, 1);
      const sniffing = pose.windup >= 0;
      const hunting = pose.locked;
      const bodyC = frozen ? '#8fc8e8' : hunting ? '#4a2a68' : '#33253f';
      const hiC = frozen ? '#c8ecf8' : '#8a5ec8';
      const glowC = frozen ? '#e8f8ff' : '#c47eff';
      // 锁定时全身逆弦辉光:这是"它能看见纸片形态"的唯一提示
      if (hunting) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.16 + 0.10 * Math.abs(Math.sin(time * 9));
        g.fillStyle = glowC;
        g.beginPath();
        g.arc(0, -7, 13, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      // 低伏的兽形躯干
      px(g, -7, -11, 13, 6, bodyC);
      px(g, -7, -11, 13, 1, hiC);
      px(g, 4, -13, 6, 5, bodyC); // 头
      px(g, 4, -13, 6, 1, hiC);
      px(g, 9, -10, 2, 2, '#120c18'); // 吻部
      // 双眼:嗅探时缩成一线,锁定后亮起
      px(g, 6, -11, 3, sniffing ? 1 : 2, hunting ? '#ffe08a' : glowC);
      // 背脊弦刺
      for (let i = 0; i < 4; i++) px(g, -5 + i * 3, -13 - (i === 1 || i === 2 ? 1 : 0), 1, 2, glowC);
      // 四肢:锁定冲刺时步频翻倍
      const gait = Math.floor(time * (hunting ? 18 : 7)) % 2;
      px(g, -5 + gait, -5, 2, 5, '#1a1220');
      px(g, -1, -5, 2, 5, '#1a1220');
      px(g, 3 - gait, -5, 2, 5, '#1a1220');
      // 尾
      px(g, -9, -12 + (gait ? 1 : 0), 3, 1, bodyC);
      if (sniffing) {
        // 嗅探火花:起手窗口的读牌信号
        g.save();
        g.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(time * 20));
        px(g, 11, -10, 2, 1, '#ffe08a');
        px(g, 13, -11, 1, 1, '#fff4d0');
        g.restore();
      }
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
  pose: EnemyPose,
): void {
  if (!ensureWork() || !workCtx) return;
  workCtx.clearRect(0, 0, WORK, WORK);
  paintEnemy(workCtx, kind, facing, time, pose);

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  // 受击用叠加亮闪而不是压低透明度:在暗背景上"变透明"读起来像消失,不像被打到。
  blitOutlined(ctx);
  if (pose.hurtFlash) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    blitOutlined(ctx);
    ctx.restore();
  }
  if (pose.frozen) {
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
  const glowC = kind === 'heart'
    ? 'rgba(255,80,110,0.14)'
    : kind === 'energy'
      ? 'rgba(110,230,255,0.14)'
      : kind === 'relic'
        ? 'rgba(255,220,130,0.18)'
        : 'rgba(255,120,200,0.16)';
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
    case 'dust': {
      const tw = 0.55 + Math.sin(t * 7) * 0.35;
      ctx.globalAlpha = tw;
      px(ctx, -1, -2, 2, 2, '#ffe9a8');
      px(ctx, 0, -3, 1, 1, '#8ee8f4');
      ctx.globalAlpha = 1;
      break;
    }
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
    case 'relic': {
      const glow = 0.7 + Math.sin(t * 4) * 0.25;
      ctx.globalAlpha = glow;
      px(ctx, -4, -5, 8, 10, '#49361b');
      px(ctx, -3, -4, 6, 8, '#d8ae58');
      px(ctx, -1, -6, 2, 12, '#ffe9a8');
      px(ctx, -2, -2, 4, 4, '#8ee8f4');
      px(ctx, -1, -1, 2, 2, '#effcff');
      ctx.globalAlpha = 1;
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
