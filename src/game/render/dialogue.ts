// 对话框覆盖层(路线图 2.1)。
//
// 与 overlays.ts 同样的约定:**纯绘制**。每帧只拿一份只读快照,不持有任何状态 ——
// 打字机进度、当前页都住在 PlayState,这里只负责把它们画出来。
import { VIEW_H, VIEW_W } from '../constants';
import { actionLabel, type InputDevice } from '../Input';
import { ornateFrame } from './overlays';

export interface DialogueView {
  /** 说话人名字 */
  speaker: string;
  /** 名牌与头像主色 */
  color: string;
  /** 当前页的若干行 */
  lines: readonly string[];
  /** 已显示的字符数(打字机);≥ 本页总字数即为显示完毕 */
  revealed: number;
  /** 当前页 / 总页数,用于翻页指示 */
  page: number;
  pageCount: number;
  device: InputDevice;
  /** 用于头像呼吸动画 */
  time: number;
}

const BOX_H = 74;
const BOX_MARGIN = 14;
const PORTRAIT = 34;

/** 本页总字数 —— 打字机是否放完由调用方按它判断。 */
export function pageLength(lines: readonly string[]): number {
  return lines.reduce((sum, line) => sum + line.length, 0);
}

export function drawDialogue(ctx: CanvasRenderingContext2D, view: DialogueView): void {
  const boxY = VIEW_H - BOX_H - BOX_MARGIN;
  const boxX = BOX_MARGIN;
  const boxW = VIEW_W - BOX_MARGIN * 2;

  // 只压暗场景上半部,对话框自己是实底 —— 对话时世界不该完全消失
  ctx.fillStyle = 'rgba(4,3,10,0.45)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = 'rgba(8,7,16,0.94)';
  ctx.fillRect(boxX, boxY, boxW, BOX_H);
  ornateFrame(ctx, boxX, boxY, boxW, BOX_H);

  // ---- 头像 ----
  const px = boxX + 10;
  const py = boxY + 10;
  drawPortrait(ctx, px, py, PORTRAIT, view.color, view.time);

  // ---- 名牌 ----
  const textX = px + PORTRAIT + 12;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 10px "SimSun", "Songti SC", serif';
  ctx.fillStyle = view.color;
  ctx.fillText(view.speaker, textX, boxY + 18);
  ctx.fillStyle = 'rgba(140,130,170,0.45)';
  ctx.fillRect(textX, boxY + 22, boxW - (textX - boxX) - 12, 1);

  // ---- 正文(打字机逐字)----
  ctx.font = '9px "SimSun", "Songti SC", serif';
  ctx.fillStyle = '#ddd6ea';
  let budget = view.revealed;
  view.lines.forEach((line, i) => {
    if (budget <= 0) return;
    const shown = line.slice(0, budget);
    budget -= line.length;
    ctx.fillText(shown, textX, boxY + 38 + i * 13);
  });

  // ---- 翻页 / 结束提示 ----
  const done = view.revealed >= pageLength(view.lines);
  if (done) {
    const last = view.page >= view.pageCount - 1;
    ctx.font = '7px "SimSun", "Songti SC", serif';
    ctx.fillStyle = '#7a7092';
    ctx.textAlign = 'right';
    ctx.fillText(
      `${actionLabel('confirm', view.device)} ${last ? '结束' : '继续'}`,
      boxX + boxW - 10,
      boxY + BOX_H - 8,
    );
    // 小三角:未读完时闪动,读完最后一页则不画
    if (!last) {
      const bob = Math.sin(view.time * 6) > 0 ? 0 : 1;
      ctx.fillStyle = view.color;
      ctx.fillRect(boxX + boxW - 8, boxY + BOX_H - 20 + bob, 3, 1);
      ctx.fillRect(boxX + boxW - 7, boxY + BOX_H - 19 + bob, 1, 1);
    }
    ctx.textAlign = 'left';
  }

  // 页码(多于一页时才画)
  if (view.pageCount > 1) {
    ctx.font = '7px "SimSun", "Songti SC", serif';
    ctx.fillStyle = '#5a5270';
    ctx.textAlign = 'right';
    ctx.fillText(`${view.page + 1}/${view.pageCount}`, boxX + boxW - 10, boxY + 18);
    ctx.textAlign = 'left';
  }
}

/**
 * 程序化像素头像:与全项目一致,不使用任何图片素材。
 * 只画到"能认出是谁"的程度 —— 一个带发色的剪影 + 呼吸起伏。
 */
function drawPortrait(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  time: number,
): void {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = 'rgba(160,150,190,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);

  const breathe = Math.sin(time * 2) > 0 ? 0 : 1;
  const cx = x + size / 2;
  const top = y + 8 + breathe;

  // 头发/兜帽剪影
  ctx.fillStyle = color;
  ctx.fillRect(cx - 8, top, 16, 6);
  ctx.fillRect(cx - 9, top + 3, 18, 8);
  // 面部
  ctx.fillStyle = '#e8d8c8';
  ctx.fillRect(cx - 6, top + 5, 12, 9);
  // 眼睛
  ctx.fillStyle = '#2a2438';
  ctx.fillRect(cx - 4, top + 8, 2, 2);
  ctx.fillRect(cx + 2, top + 8, 2, 2);
  // 肩
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.75;
  ctx.fillRect(cx - 10, top + 15, 20, size - (top - y) - 15);
  ctx.globalAlpha = 1;
}
