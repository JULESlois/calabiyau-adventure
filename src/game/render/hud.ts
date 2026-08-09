import { VIEW_W, VIEW_H } from '../constants';
import type { Player } from '../entities/Player';
import type { BossLike } from '../types';
import { CRYSTAL_MILESTONES } from '../world/world';
import type { WorldState } from '../world/WorldState';

const GOLD = '#c8a050';
const GOLD_DK = '#4a3c22';
const GOLD_TXT = '#e8d8a8';
const PLATE = 'rgba(8,6,14,0.82)';

function ornateBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  fill: string,
  fillHi: string,
  back: string,
): void {
  ctx.fillStyle = back;
  ctx.fillRect(x, y, w, h);
  const fw = Math.round(w * Math.max(0, Math.min(1, ratio)));
  if (fw > 0) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, fw, h);
    ctx.fillStyle = fillHi;
    ctx.fillRect(x, y, fw, 1);
  }
  // 刻度
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  for (let i = 1; i < 4; i++) {
    ctx.fillRect(x + Math.round((w / 4) * i), y, 1, h);
  }
  // 边框
  ctx.strokeStyle = GOLD_DK;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
}

function portrait(ctx: CanvasRenderingContext2D, x: number, y: number, isM: boolean): void {
  // 头像底
  ctx.fillStyle = '#141020';
  ctx.fillRect(x, y, 22, 22);
  if (isM) {
    // 米雪儿:暖金高位双马尾 + 黑色科技猫耳 + 蓝瞳
    ctx.fillStyle = '#33363f';
    ctx.fillRect(x + 3, y + 1, 3, 4); // 黑猫耳
    ctx.fillRect(x + 16, y + 1, 3, 4);
    ctx.fillStyle = '#8a8e9e';
    ctx.fillRect(x + 4, y + 2, 1, 1);
    ctx.fillRect(x + 17, y + 2, 1, 1);
    ctx.fillStyle = '#f0b874';
    ctx.fillRect(x + 4, y + 4, 14, 6); // 刘海
    ctx.fillRect(x + 2, y + 5, 4, 15); // 高位长马尾
    ctx.fillRect(x + 16, y + 5, 4, 15);
    ctx.fillStyle = '#f8ddb0';
    ctx.fillRect(x + 4, y + 4, 14, 1);
    ctx.fillStyle = '#4a86d8';
    ctx.fillRect(x + 2, y + 6, 4, 1); // 蓝发绳
    ctx.fillRect(x + 16, y + 6, 4, 1);
    ctx.fillStyle = '#f4dcc4';
    ctx.fillRect(x + 7, y + 9, 8, 9);
    ctx.fillStyle = '#3a7ce0';
    ctx.fillRect(x + 9, y + 12, 1, 3);
    ctx.fillRect(x + 13, y + 12, 1, 3);
  } else {
    // 香奈美:淡紫长发 + 粉挑染 + 呆毛 + 蓝紫瞳
    ctx.fillStyle = '#e6ddf2';
    ctx.fillRect(x + 9, y + 1, 3, 1); // 呆毛
    ctx.fillRect(x + 10, y + 2, 1, 1);
    ctx.fillRect(x + 4, y + 3, 14, 6);
    ctx.fillRect(x + 2, y + 7, 4, 13);
    ctx.fillRect(x + 16, y + 7, 4, 13);
    ctx.fillStyle = '#f8f4fc';
    ctx.fillRect(x + 4, y + 3, 14, 1);
    ctx.fillStyle = '#f078b8';
    ctx.fillRect(x + 5, y + 4, 1, 4); // 粉挑染(刘海)
    ctx.fillRect(x + 17, y + 8, 1, 10);
    ctx.fillStyle = '#3a3644';
    ctx.fillRect(x + 15, y + 3, 2, 2); // 黑色发饰
    ctx.fillStyle = '#f8e2cc';
    ctx.fillRect(x + 7, y + 9, 8, 9);
    ctx.fillStyle = '#7060d0';
    ctx.fillRect(x + 9, y + 12, 1, 3);
    ctx.fillRect(x + 13, y + 12, 1, 3);
  }
}

export function drawHUD(
  ctx: CanvasRenderingContext2D,
  player: Player,
  world: WorldState,
  totalCrystals: number,
  boss: BossLike | null,
  muted: boolean,
): void {
  const crystals = world.crystals.size;
  ctx.save();
  ctx.textBaseline = 'top';
  const isM = player.char === 'michele';

  // ---- 状态板 ----
  ctx.fillStyle = PLATE;
  ctx.fillRect(5, 5, 124, 32);
  ctx.strokeStyle = GOLD_DK;
  ctx.lineWidth = 1;
  ctx.strokeRect(5.5, 5.5, 123, 31);
  ctx.strokeStyle = GOLD;
  ctx.strokeRect(7.5, 7.5, 119, 27);
  // 角饰
  ctx.fillStyle = GOLD;
  ctx.fillRect(5, 5, 3, 3);
  ctx.fillRect(126, 5, 3, 3);
  ctx.fillRect(5, 34, 3, 3);
  ctx.fillRect(126, 34, 3, 3);

  portrait(ctx, 10, 10, isM);
  ctx.strokeStyle = GOLD_DK;
  ctx.strokeRect(9.5, 9.5, 23, 23);

  ctx.font = '7px "SimSun", "Songti SC", serif';
  ctx.fillStyle = GOLD_TXT;
  ctx.fillText(isM ? '米雪儿' : '香奈美', 38, 9);

  // 血条(低血量泛红闪)
  const lowHp = player.hp <= 25;
  const hpFill = lowHp && Math.floor(performance.now() / 300) % 2 === 0 ? '#e04a5c' : '#a82838';
  ornateBar(ctx, 38, 19, 72, 5, player.hp / world.hpMax, hpFill, '#e8707c', '#26090f');
  // 弦能条:满槽只够约 3 秒弦化,见底会让玩家在空中直接脱离飘飞,
  // 所以和血条一样需要一个提前的闪烁预警,而不是无声见底。
  const energyRatio = player.energy / world.energyMax;
  const lowEnergy = energyRatio <= 0.25;
  const energyFill = lowEnergy && Math.floor(performance.now() / 220) % 2 === 0 ? '#8ae0f4' : '#4ab4cc';
  ornateBar(ctx, 38, 27, 72, 4, energyRatio, energyFill, '#a8ecf4', '#0a2028');
  if (lowEnergy) {
    ctx.fillStyle = Math.floor(performance.now() / 220) % 2 === 0 ? '#a8ecf4' : '#3a6a80';
    ctx.fillRect(113, 27, 2, 4);
  }

  // ---- 技能符印(菱形)----
  const cd = player.skillCd[player.char];
  const sx = 146;
  const sy = 20;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = PLATE;
  ctx.fillRect(-8, -8, 16, 16);
  ctx.strokeStyle = cd <= 0 ? GOLD : GOLD_DK;
  ctx.strokeRect(-8.5, -8.5, 17, 17);
  ctx.restore();
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = isM ? '#8ee8f4' : '#ffd75e';
  ctx.font = isM ? '7px "SimSun", "Songti SC", serif' : '9px monospace';
  ctx.fillText(isM ? '喵' : '♪', sx, sy - 5);
  if (cd > 0) {
    // 冷却期把符印压暗并用一条竖向排空的进度替代数字:
    // 6-7px 的数字挤在旋转方框里几乎读不出来。
    const total = player.char === 'michele' ? 9 : 10;
    const left = Math.min(1, cd / total);
    ctx.fillStyle = 'rgba(8,6,14,0.62)';
    ctx.fillRect(sx - 8, sy - 13, 16, Math.round(16 * left));
    ctx.fillStyle = '#6a6080';
    ctx.fillRect(sx - 8, sy + 3 - Math.round(16 * left), 16, 1);
  } else if (Math.floor(performance.now() / 260) % 2 === 0) {
    // 冷却结束后短暂高亮,提示技能又能用了。
    ctx.strokeStyle = '#fff0c0';
    ctx.strokeRect(sx - 9.5, sy - 14.5, 19, 19);
  }
  ctx.font = '6px monospace';
  ctx.fillStyle = '#6a6080';
  ctx.fillText('L', sx, sy + 10);
  ctx.textAlign = 'left';

  // ---- 弦晶计数 ----
  ctx.font = '8px monospace';
  ctx.fillStyle = '#e878c0';
  ctx.fillText('◆', VIEW_W - 56, 9);
  ctx.fillStyle = GOLD_TXT;
  ctx.fillText(`${crystals}/${totalCrystals}`, VIEW_W - 46, 9);
  // 距离下一次共鸣还差几枚 —— 没有这行,17/76 这个数字对玩家毫无意义。
  const next = CRYSTAL_MILESTONES.find((m) => crystals < m.count);
  ctx.font = '7px monospace';
  if (next) {
    const prev = CRYSTAL_MILESTONES.filter((m) => m.count <= crystals).pop();
    const from = prev ? prev.count : 0;
    const span = Math.max(1, next.count - from);
    const filled = Math.round(((crystals - from) / span) * 12);
    ctx.fillStyle = '#3a2a3e';
    ctx.fillRect(VIEW_W - 56, 12, 24, 2);
    ctx.fillStyle = '#e878c0';
    ctx.fillRect(VIEW_W - 56, 12, Math.max(0, filled * 2), 2);
    ctx.fillStyle = '#8a7a98';
    ctx.fillText(`+${next.count - crystals}`, VIEW_W - 30, 14);
  } else {
    ctx.fillStyle = '#7a6a8e';
    ctx.fillText('共鸣全开', VIEW_W - 56, 14);
  }
  // 晶尘
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(`✦ ${world.dust}`, VIEW_W - 56, 20);
  if (muted) {
    ctx.fillStyle = '#6a6080';
    ctx.fillText('♪×', VIEW_W - 26, 31);
  }

  // ---- Boss 血条 ----
  if (boss && boss.active) {
    const w = 210;
    const x = (VIEW_W - w) / 2;
    const y = VIEW_H - 15;
    ctx.font = '9px "SimSun", "Songti SC", serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD_TXT;
    ctx.fillText(boss.displayName, VIEW_W / 2, VIEW_H - 28);
    ctx.textAlign = 'left';
    ctx.fillStyle = PLATE;
    ctx.fillRect(x - 4, y - 3, w + 8, 13);
    ornateBar(ctx, x, y, w, 6, boss.hp / boss.maxHp, '#a02838', '#e8707c', '#1c0710');
    // 阶段刻痕:按该 Boss 实际阶段数划分,而不是固定三段
    ctx.fillStyle = GOLD;
    for (let i = 1; i < boss.phases; i++) {
      ctx.fillRect(x + Math.round((w * i) / boss.phases), y - 2, 1, 10);
    }
    // 端饰
    ctx.fillStyle = GOLD;
    ctx.fillRect(x - 4, y - 3, 2, 13);
    ctx.fillRect(x + w + 2, y - 3, 2, 13);
  }

  ctx.restore();
}
