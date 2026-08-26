// 实体地形的**材质**画法。
//
// 为什么单独一个模块:在此之前六个区域共用同一段砖块绘制代码,只换四个主题色 ——
// 也就是说全游戏的地面是**同一种材料的六种配色**。而地面是每一帧都占满画面下半的东西,
// 视觉上的单调正出在这里(路线图里那句「全石头科技」)。
// 实测数据:tileBase 的饱和度在六区之间只差 13 个点(16%–29%),
// 而 accent 差 56 个点 —— 点缀色很丰富,材料本身几乎没有变化。
//
// 现在每个区域有自己的**砌法**:课高、缝线、表面颗粒、顶面处理各不相同。
// 颜色仍旧全部来自 LevelTheme,所以调色与调材质互不干扰。

import { TILE } from '../constants';
import type { LevelTheme } from '../levels/levels';

/** 地形材质。新增区域时在 LevelTheme.tileStyle 指定其一。 */
export type TileStyle =
  | 'masonry' | 'wetblock' | 'panel' | 'ashlar' | 'cloudstone' | 'plate' | 'boardwalk';

export interface SolidTileCtx {
  theme: LevelTheme;
  /** 邻接情况:决定是否画顶面线脚与侧面高光 */
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** 该格的稳定噪声 0..255。由调用方给,**必须掺入房间标识** —— 见 tileNoise()。 */
  h: number;
}

/**
 * 每格的稳定噪声。
 * 原实现是 `(c * 31 + r * 17)`,只依赖世界坐标 —— 于是**两个房间只要地形处在相同列行,
 * 装饰噪点就一模一样**,竖向堆叠的房间会完全重复。掺入房间散列即可打散。
 */
export function tileNoise(c: number, r: number, roomSeed: number): number {
  return (c * 31 + r * 17 + roomSeed * 101) & 255;
}

/** 房间 id → 稳定散列,给 tileNoise 用。 */
export function roomSeedOf(roomId: string): number {
  let n = 0;
  for (let i = 0; i < roomId.length; i++) n = (n * 33 + roomId.charCodeAt(i)) & 0xffff;
  return n;
}

export function drawSolidTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  style: TileStyle,
  s: SolidTileCtx,
): void {
  const t = s.theme;
  ctx.fillStyle = t.tileBase;
  ctx.fillRect(x, y, TILE, TILE);

  switch (style) {
    case 'masonry': ma_sonry(ctx, x, y, s); break;
    case 'wetblock': wetblock(ctx, x, y, s); break;
    case 'panel': panel(ctx, x, y, s); break;
    case 'ashlar': ashlar(ctx, x, y, s); break;
    case 'cloudstone': cloudstone(ctx, x, y, s); break;
    case 'plate': plate(ctx, x, y, s); break;
    case 'boardwalk': boardwalk(ctx, x, y, s); break;
  }

  // ---- 公共的立体感:底部投影、左侧受光、右侧背光 ----
  if (!s.down) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x, y + TILE - 2, TILE, 2);
  }
  if (!s.left) {
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, y, 1, TILE);
  }
  if (!s.right) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x + TILE - 1, y, 1, TILE);
  }
}

// ---------------- 海滨:海蚀过的乱石砌 ----------------
// 课高不齐、缝线歪斜,顶面被海风啃出缺口。
function ma_sonry(ctx: CanvasRenderingContext2D, x: number, y: number, s: SolidTileCtx): void {
  const t = s.theme;
  const jog = s.h % 3;
  ctx.fillStyle = t.tileDark;
  ctx.fillRect(x, y + 6 + jog, TILE, 1);
  ctx.fillRect(x, y + 12 - jog, TILE, 1);
  ctx.fillRect(x + (s.h % 7), y, 1, 6 + jog);
  ctx.fillRect(x + 4 + (s.h % 9), y + 7 + jog, 1, 5);
  // 海蚀麻点
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let i = 0; i < 3; i++) {
    const p = (s.h + i * 53) & 255;
    ctx.fillRect(x + (p % 14) + 1, y + ((p >> 3) % 13) + 1, 1, 1);
  }
  if (!s.up) {
    // 被啃缺的顶沿:不是一条直线
    ctx.fillStyle = t.tileEdge;
    ctx.fillRect(x, y, TILE, 2);
    ctx.fillStyle = t.tileBase;
    ctx.fillRect(x + (s.h % 12), y, 2 + (s.h % 2), 1);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, y + 2, TILE, 1);
  }
}

// ---------------- 沉潮:泡在水里的方石 ----------------
// 缝线整齐但每块都在流水渍,顶面挂着水痕。
function wetblock(ctx: CanvasRenderingContext2D, x: number, y: number, s: SolidTileCtx): void {
  const t = s.theme;
  ctx.fillStyle = t.tileDark;
  ctx.fillRect(x, y + 7, TILE, 1);
  ctx.fillRect(x, y + 15, TILE, 1);
  ctx.fillRect(x + ((s.h % 2) * 8), y, 1, 7);
  ctx.fillRect(x + 8 - ((s.h % 2) * 8), y + 8, 1, 7);
  // 水渍:自缝线向下的深色拖尾
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  const wx = x + 2 + (s.h % 11);
  ctx.fillRect(wx, y + 8, 1, 4 + (s.h % 4));
  if (s.h % 3 === 0) ctx.fillRect(wx + 3, y + 1, 1, 3 + (s.h % 3));
  // 苔痕
  if (s.h % 5 === 0) {
    ctx.fillStyle = t.accent;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(x + (s.h % 9), y + 6, 3, 2);
    ctx.globalAlpha = 1;
  }
  if (!s.up) {
    ctx.fillStyle = t.tileEdge;
    ctx.fillRect(x, y, TILE, 2);
    // 顶沿垂下的水滴痕
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(x + 3 + (s.h % 8), y + 2, 1, 2 + (s.h % 3));
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, y + 2, TILE, 1);
  }
}

// ---------------- 研究区:铆接金属板 ----------------
// 不是砖:是一块块螺接的壁板,接缝笔直,四角有铆钉。
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, s: SolidTileCtx): void {
  const t = s.theme;
  // 板面渐层
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(x + 1, y + 1, TILE - 2, 5);
  // 板缝
  ctx.fillStyle = t.tileDark;
  ctx.fillRect(x, y, TILE, 1);
  ctx.fillRect(x, y, 1, TILE);
  // 铆钉
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x + 2, y + 2, 1, 1);
  ctx.fillRect(x + TILE - 3, y + 2, 1, 1);
  ctx.fillRect(x + 2, y + TILE - 3, 1, 1);
  ctx.fillRect(x + TILE - 3, y + TILE - 3, 1, 1);
  // 检修编号刻痕
  if (s.h % 6 === 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + 5, y + 8, 6, 1);
    ctx.fillRect(x + 5, y + 10, 4, 1);
  }
  if (!s.up) {
    ctx.fillStyle = t.tileEdge;
    ctx.fillRect(x, y, TILE, 2);
    // 顶面导光条:研究区是通着电的
    if (s.h % 3 === 0) {
      ctx.fillStyle = t.accent;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x + 4, y, 8, 1);
      ctx.globalAlpha = 1;
    }
  }
}

// ---------------- 圣堂:细琢条石 ----------------
// 接缝极细、课高统一,表面有凿纹与浅浮雕线。
function ashlar(ctx: CanvasRenderingContext2D, x: number, y: number, s: SolidTileCtx): void {
  const t = s.theme;
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x, y + 5, TILE, 1);
  ctx.fillRect(x, y + 11, TILE, 1);
  ctx.fillRect(x + 5 + (s.h % 2) * 6, y + 6, 1, 5);
  // 斜向凿纹
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 4; i++) ctx.fillRect(x + 2 + i * 3, y + 1 + ((i + s.h) % 3), 1, 3);
  // 浅浮雕:每隔几格一道竖线脚
  if (s.h % 4 === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(x + 7, y + 1, 1, TILE - 2);
  }
  if (!s.up) {
    ctx.fillStyle = t.tileEdge;
    ctx.fillRect(x, y, TILE, 2);
    // 檐口齿饰:圣堂的顶沿是被雕过的
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + 2, y + 2, 2, 1);
    ctx.fillRect(x + 7, y + 2, 2, 1);
    ctx.fillRect(x + 12, y + 2, 2, 1);
  }
}

// ---------------- 天穹:多孔轻石 ----------------
// 明度最高的一区,材质要**压暗**才能与背景分层(实测原本 tile 与 near 只差 3 点)。
// 手法:大量孔洞与阴影面积,让整体视觉重量下沉,而不必改动主题色。
function cloudstone(ctx: CanvasRenderingContext2D, x: number, y: number, s: SolidTileCtx): void {
  const t = s.theme;
  // 孔洞:成片的深色小坑,显著压低整格的视觉明度
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  for (let i = 0; i < 7; i++) {
    const p = (s.h + i * 37) & 255;
    const px = x + 1 + (p % 13);
    const py = y + 1 + ((p >> 2) % 13);
    ctx.fillRect(px, py, 1 + (p % 2), 1 + ((p >> 4) % 2));
  }
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(x, y + 9, TILE, 2);
  ctx.fillRect(x, y + 14, TILE, 2);
  // 受光的上棱
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(x, y + 3, TILE, 1);
  if (!s.up) {
    ctx.fillStyle = t.tileEdge;
    ctx.fillRect(x, y, TILE, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fillRect(x, y + 2, TILE, 2);
  }
}

// ---------------- 机库:焊接钢板 ----------------
// 大块钢板 + 焊缝 + 顶面警戒斜纹。全游戏最"工业"的一区。
function plate(ctx: CanvasRenderingContext2D, x: number, y: number, s: SolidTileCtx): void {
  const t = s.theme;
  // 焊缝:粗、断续、带一点高光
  ctx.fillStyle = t.tileDark;
  ctx.fillRect(x, y + 8, TILE, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 4 + (s.h % 2), y + 8, 2, 1);
  // 竖向拼板缝
  if (s.h % 3 === 0) {
    ctx.fillStyle = t.tileDark;
    ctx.fillRect(x + 11, y, 1, 8);
  }
  // 锈斑
  if (s.h % 5 === 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fillRect(x + 2 + (s.h % 8), y + 11, 3, 2);
  }
  if (!s.up) {
    // 警戒斜纹:机库的顶沿是刷了漆的
    ctx.fillStyle = t.tileEdge;
    ctx.fillRect(x, y, TILE, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 4 + ((s.h % 4)), y, 2, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, y + 3, TILE, 1);
  }
}

// ---------------- 潮汐游园:海边木栈道 ----------------
// 全游戏唯一的木质地面。安全区在脚感上也该和别处不一样 ——
// 石头是"要提防的地方",木板是"有人住的地方"。
function boardwalk(ctx: CanvasRenderingContext2D, x: number, y: number, s: SolidTileCtx): void {
  const t = s.theme;
  // 横铺的板材:三条,板缝深
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(x, y + 5, TILE, 1);
  ctx.fillRect(x, y + 11, TILE, 1);
  // 木纹
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  for (let i = 0; i < 3; i++) {
    const p = (s.h + i * 41) & 255;
    ctx.fillRect(x + 1 + (p % 10), y + 1 + i * 6, 3 + (p % 4), 1);
  }
  // 钉头
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(x + 2, y + 2, 1, 1);
  ctx.fillRect(x + TILE - 3, y + 8, 1, 1);
  if (!s.up) {
    // 顶面被踩得发亮,边缘一道磨圆的暖光
    ctx.fillStyle = t.tileEdge;
    ctx.fillRect(x, y, TILE, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x + 1, y, TILE - 2, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(x, y + 2, TILE, 1);
  }
}
