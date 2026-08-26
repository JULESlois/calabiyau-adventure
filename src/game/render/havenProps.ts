// 潮汐游园的装饰层(路线图 2.3)。
//
// 城镇的"热闹度"必须**看得见**。逻辑早就有了(`havenLiveliness()` 读既有旗标),
// 但如果画面上什么都不变,那个设计就只是一个返回数字的函数。
//
// 五级全部由 world.flags 推出,**零新进度系统**:
//   0 初见            空长椅、灯串熄着、只有灯塔守
//   1 rescue:kanami   灯串亮一半、茶摊开张
//   2 boss:warden     风车转起来、孩子出现
//   3 boss:arbiter|gambit  夜市摊位、灯全亮
//   4 boss:guardian   烟花

import { TILE } from '../constants';
import type { LevelTheme } from '../levels/levels';

/** 一件城镇装饰:出现所需的最低热闹度 + 位置。 */
interface Decor {
  kind: 'bench' | 'teastall' | 'windmill' | 'market' | 'child';
  /** 需要的最低热闹度 */
  from: number;
  /** tile 列 / 行(脚底) */
  col: number;
  row: number;
}

/** 各房间的装饰表。位置按房间地形手排,不参与碰撞。 */
const HAVEN_DECOR: Readonly<Record<string, readonly Decor[]>> = {
  haven_gate: [
    { kind: 'bench', from: 0, col: 32, row: 14 },
    { kind: 'teastall', from: 1, col: 40, row: 14 },
    { kind: 'child', from: 2, col: 36, row: 14 },
  ],
  haven_lane: [
    { kind: 'bench', from: 0, col: 12, row: 14 },
    { kind: 'teastall', from: 1, col: 26, row: 14 },
    { kind: 'market', from: 3, col: 34, row: 14 },
    { kind: 'market', from: 3, col: 40, row: 14 },
    { kind: 'child', from: 2, col: 16, row: 14 },
  ],
  haven_view: [
    { kind: 'bench', from: 0, col: 22, row: 14 },
    { kind: 'windmill', from: 2, col: 36, row: 14 },
    { kind: 'market', from: 3, col: 26, row: 14 },
  ],
};

export function havenDecorFor(roomId: string, liveliness: number): readonly Decor[] {
  return (HAVEN_DECOR[roomId] ?? []).filter((d) => liveliness >= d.from);
}

/** 该房间在给定热闹度下的装饰件数 —— 供测试断言"世界真的变了"。 */
export function havenDecorCount(roomId: string, liveliness: number): number {
  return havenDecorFor(roomId, liveliness).length;
}

export function drawHavenDecor(
  ctx: CanvasRenderingContext2D,
  roomId: string,
  liveliness: number,
  theme: LevelTheme,
  time: number,
): void {
  for (const d of havenDecorFor(roomId, liveliness)) {
    const x = d.col * TILE + TILE / 2;
    const y = d.row * TILE;
    switch (d.kind) {
      case 'bench': drawBenchSeat(ctx, x, y, liveliness); break;
      case 'teastall': drawTeaStall(ctx, x, y, theme, time); break;
      case 'windmill': drawWindmill(ctx, x, y, theme, time); break;
      case 'market': drawMarketStall(ctx, x, y, theme, time, d.col); break;
      case 'child': drawChild(ctx, x, y, time, d.col); break;
    }
  }
  if (liveliness >= 4) drawFireworks(ctx, time);
}

/** 长椅:Lv0 就在,但只有热闹起来之后才有人坐过的痕迹(靠垫)。 */
function drawBenchSeat(ctx: CanvasRenderingContext2D, x: number, y: number, liveliness: number): void {
  const bx = Math.round(x);
  const by = Math.round(y);
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(bx - 10, by - 6, 20, 3);
  ctx.fillRect(bx - 9, by - 3, 2, 3);
  ctx.fillRect(bx + 7, by - 3, 2, 3);
  ctx.fillStyle = '#6b4630';
  ctx.fillRect(bx - 10, by - 12, 20, 2);
  ctx.fillRect(bx - 10, by - 10, 2, 4);
  ctx.fillRect(bx + 8, by - 10, 2, 4);
  if (liveliness >= 1) {
    ctx.fillStyle = '#c86a7a';
    ctx.fillRect(bx - 6, by - 8, 6, 2);
  }
}

/** 茶摊:Lv1 开张。壶口冒热气。 */
function drawTeaStall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  theme: LevelTheme,
  time: number,
): void {
  const bx = Math.round(x);
  const by = Math.round(y);
  // 摊面与支腿
  ctx.fillStyle = '#5a3a26';
  ctx.fillRect(bx - 11, by - 9, 22, 3);
  ctx.fillRect(bx - 9, by - 6, 2, 6);
  ctx.fillRect(bx + 7, by - 6, 2, 6);
  // 顶棚
  ctx.fillStyle = theme.accent;
  ctx.fillRect(bx - 13, by - 22, 26, 3);
  ctx.fillStyle = '#8a4a3a';
  for (let i = 0; i < 5; i++) ctx.fillRect(bx - 13 + i * 6, by - 22, 3, 3);
  ctx.fillStyle = '#5a3a26';
  ctx.fillRect(bx - 12, by - 19, 1, 10);
  ctx.fillRect(bx + 11, by - 19, 1, 10);
  // 茶壶
  ctx.fillStyle = '#c8c0b0';
  ctx.fillRect(bx - 3, by - 14, 6, 5);
  ctx.fillRect(bx + 3, by - 13, 2, 1);
  // 热气:向上飘散
  ctx.fillStyle = 'rgba(255,240,220,0.45)';
  for (let i = 0; i < 3; i++) {
    const t = (time * 12 + i * 7) % 14;
    ctx.globalAlpha = 0.5 * (1 - t / 14);
    ctx.fillRect(bx - 1 + Math.round(Math.sin(time * 2 + i) * 2), by - 15 - t, 1, 2);
  }
  ctx.globalAlpha = 1;
}

/** 风车:Lv2 起转动。转速恒定,是"日子恢复了"的可读信号。 */
function drawWindmill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  theme: LevelTheme,
  time: number,
): void {
  const bx = Math.round(x);
  const by = Math.round(y);
  ctx.fillStyle = '#5a3a26';
  ctx.fillRect(bx - 1, by - 30, 3, 30);
  const cx = bx;
  const cy = by - 30;
  const spin = time * 1.1;
  for (let k = 0; k < 4; k++) {
    const a = spin + (k / 4) * Math.PI * 2;
    ctx.fillStyle = k % 2 === 0 ? theme.accent : '#e8a070';
    for (let r = 2; r < 11; r++) {
      ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
      ctx.fillRect(
        Math.round(cx + Math.cos(a) * r - Math.sin(a) * 2),
        Math.round(cy + Math.sin(a) * r + Math.cos(a) * 2),
        1,
        1,
      );
    }
  }
  ctx.fillStyle = '#3a2418';
  ctx.fillRect(cx - 1, cy - 1, 3, 3);
}

/** 夜市摊位:Lv3 出现,棚布颜色按位置错开,免得三个摊位长得一样。 */
function drawMarketStall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  theme: LevelTheme,
  time: number,
  seed: number,
): void {
  const bx = Math.round(x);
  const by = Math.round(y);
  const hues = ['#c85a6a', '#5a8ac8', '#c8a050'];
  const cloth = hues[seed % hues.length];
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(bx - 9, by - 8, 18, 3);
  ctx.fillRect(bx - 8, by - 5, 2, 5);
  ctx.fillRect(bx + 6, by - 5, 2, 5);
  // 棚布:随风微动
  const wave = Math.round(Math.sin(time * 1.6 + seed) * 1);
  ctx.fillStyle = cloth;
  ctx.fillRect(bx - 11, by - 20 + wave, 22, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let i = 0; i < 4; i++) ctx.fillRect(bx - 11 + i * 6, by - 20 + wave, 2, 4);
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(bx - 10, by - 16 + wave, 1, 8);
  ctx.fillRect(bx + 9, by - 16 + wave, 1, 8);
  // 摊上的货
  ctx.fillStyle = theme.accent;
  ctx.fillRect(bx - 5, by - 11, 3, 3);
  ctx.fillRect(bx + 1, by - 11, 4, 3);
}

/** 孩子:Lv2 出现,来回小步跑 —— 城镇有小孩才算真的活过来。 */
function drawChild(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number): void {
  const range = 18;
  const bx = Math.round(x + Math.sin(time * 0.9 + seed) * range);
  const by = Math.round(y);
  const step = Math.sin(time * 7 + seed) > 0 ? 1 : 0;
  ctx.fillStyle = '#2a2438';
  ctx.fillRect(bx - 2, by - 4, 2, 4 - step);
  ctx.fillRect(bx + 1, by - 4, 2, 4 - (1 - step));
  ctx.fillStyle = '#7ec8a0';
  ctx.fillRect(bx - 3, by - 11, 7, 7);
  ctx.fillStyle = '#e8d8c8';
  ctx.fillRect(bx - 2, by - 16, 5, 5);
  ctx.fillStyle = '#4a3a2a';
  ctx.fillRect(bx - 3, by - 17, 7, 2);
}

/** 烟花:Lv4(通关)。屏幕空间,低频、不抢戏。 */
function drawFireworks(ctx: CanvasRenderingContext2D, time: number): void {
  const colors = ['#ffd18a', '#ff9fd0', '#8fd7ff'];
  for (let k = 0; k < 3; k++) {
    const cycle = 3.4;
    const t = ((time + k * 1.3) % cycle) / cycle;
    if (t > 0.6) continue; // 大部分时间天上是空的,才显得是"偶尔一朵"
    const fx = 90 + k * 130;
    const fy = 46 + (k % 2) * 26;
    const r = t * 26;
    ctx.globalAlpha = Math.max(0, 0.85 - t * 1.4);
    ctx.fillStyle = colors[k % colors.length];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillRect(Math.round(fx + Math.cos(a) * r), Math.round(fy + Math.sin(a) * r), 1, 1);
    }
    ctx.globalAlpha = 1;
  }
}
