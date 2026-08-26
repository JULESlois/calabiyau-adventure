// 世界道具的程序化绘制:信标、能力祭坛、牢房中的香奈美。
import type { Ability } from '../world/world';

/** 信标:小型定位终端,兼作休息、存档与传送点(x 为中心,y 为地面) */
export function drawBench(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  active: boolean,
  time: number,
): void {
  const bx = Math.round(x);
  const by = Math.round(y);
  // 金属底座与中央定位桅杆。
  ctx.fillStyle = '#1c2030';
  ctx.fillRect(bx - 11, by - 4, 22, 4);
  ctx.fillStyle = '#46506a';
  ctx.fillRect(bx - 13, by - 5, 26, 2);
  ctx.fillStyle = '#30394e';
  ctx.fillRect(bx - 5, by - 10, 10, 6);
  ctx.fillStyle = '#596780';
  ctx.fillRect(bx - 2, by - 24, 4, 14);
  ctx.fillRect(bx - 7, by - 20, 14, 2);
  ctx.fillStyle = '#8793aa';
  ctx.fillRect(bx - 1, by - 24, 1, 14);

  // 菱形定位核心；激活后发出克制的扫描脉冲。
  const glow = active ? 0.72 + Math.sin(time * 4) * 0.18 : 0.24;
  ctx.save();
  ctx.translate(bx, by - 27);
  ctx.rotate(Math.PI / 4);
  ctx.globalAlpha = glow;
  ctx.fillStyle = active ? '#8ee8f4' : '#53627a';
  ctx.fillRect(-4, -4, 8, 8);
  ctx.fillStyle = active ? '#d8f8ff' : '#78849a';
  ctx.fillRect(-2, -2, 4, 4);
  ctx.restore();

  if (active) {
    const scan = 8 + ((time * 9) % 10);
    ctx.save();
    ctx.globalAlpha = 0.34 * (1 - (scan - 8) / 10);
    ctx.strokeStyle = '#8ee8f4';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(bx, by - 27, scan, Math.max(2, scan * 0.28), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#8ee8f4';
    ctx.fillRect(bx - 8, by - 35, 16, 16);
    ctx.restore();
  }
}

const ABILITY_GLYPH: Record<Ability, { color: string; hi: string }> = {
  paper: { color: '#8ee8f4', hi: '#d8f8ff' },
  cling: { color: '#c47eff', hi: '#e8d0ff' },
  djump: { color: '#ffd75e', hi: '#fff2c0' },
  dash: { color: '#7ae0c8', hi: '#d0fff0' },
  flash: { color: '#e8fbff', hi: '#ffffff' },
  skystep: { color: '#d8ccff', hi: '#f2eeff' },
  kanami: { color: '#ff9fd0', hi: '#ffe0ef' },
};

/** 能力祭坛:悬浮的发光结晶(x 中心,y 地面) */
export function drawAbilityShrine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: Ability,
  time: number,
): void {
  const bx = Math.round(x);
  const by = Math.round(y);
  const c = ABILITY_GLYPH[kind];
  // 基座
  ctx.fillStyle = '#241a32';
  ctx.fillRect(bx - 7, by - 3, 14, 3);
  ctx.fillStyle = '#3a2c4a';
  ctx.fillRect(bx - 5, by - 6, 10, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(bx - 5, by - 6, 10, 1);
  // 悬浮结晶
  const fy = by - 16 + Math.sin(time * 2.4) * 2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.35 + Math.sin(time * 3.1) * 0.12;
  ctx.fillStyle = c.color;
  ctx.beginPath();
  ctx.arc(bx, fy - 3, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(bx, Math.round(fy) - 3);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = c.color;
  ctx.fillRect(-4, -4, 8, 8);
  ctx.fillStyle = c.hi;
  ctx.fillRect(-4, -4, 8, 2);
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

/** 弦膜牢房中的香奈美(等待救援,x 中心,y 地面) */
export function drawCagedKanami(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
): void {
  const bx = Math.round(x);
  const by = Math.round(y);
  // 蹲坐的淡紫发身影(简化轮廓,呆毛+粉挑染)
  ctx.fillStyle = '#e6ddf2';
  ctx.fillRect(bx - 1, by - 16, 2, 1); // 呆毛
  ctx.fillRect(bx - 4, by - 14, 9, 6); // 头发
  ctx.fillRect(bx - 6, by - 10, 3, 7);
  ctx.fillRect(bx + 4, by - 10, 3, 7);
  ctx.fillStyle = '#f8f4fc';
  ctx.fillRect(bx - 4, by - 14, 9, 1);
  ctx.fillStyle = '#f078b8';
  ctx.fillRect(bx + 5, by - 9, 1, 5); // 粉挑染
  ctx.fillStyle = '#f8e2cc';
  ctx.fillRect(bx - 2, by - 12, 5, 4); // 脸
  ctx.fillStyle = '#7060d0';
  ctx.fillRect(bx - 1, by - 11, 1, 2);
  ctx.fillRect(bx + 2, by - 11, 1, 2);
  ctx.fillStyle = '#3a3048';
  ctx.fillRect(bx - 3, by - 8, 7, 8); // 蜷起的身体(黑上衣)
  ctx.fillStyle = '#f5f3f8';
  ctx.fillRect(bx - 3, by - 2, 7, 2); // 白裙缘
  // 微弱的音符祈愿
  const ph = (time * 0.7) % 1;
  if (ph < 0.6) {
    ctx.globalAlpha = 0.7 - ph;
    ctx.fillStyle = '#ffb0d8';
    const ny = by - 18 - ph * 10;
    const nx = bx + 6 + Math.sin(ph * 8) * 2;
    ctx.fillRect(Math.round(nx), Math.round(ny), 2, 2);
    ctx.fillRect(Math.round(nx) + 2, Math.round(ny) - 2, 1, 3);
    ctx.globalAlpha = 1;
  }
}

/** 引航者商人「诺笛」:兜帽斗篷 + 记忆芯片灯箱(x 中心,y 地面) */
export function drawNavigator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
  near: boolean,
): void {
  const bx = Math.round(x);
  const by = Math.round(y);
  const bob = Math.sin(time * 1.6) > 0.3 ? 1 : 0;
  // 斗篷
  ctx.fillStyle = '#2e3a52';
  ctx.fillRect(bx - 6, by - 16 + bob, 12, 16 - bob);
  ctx.fillStyle = '#43537a';
  ctx.fillRect(bx - 6, by - 16 + bob, 12, 2);
  ctx.fillStyle = '#1e2638';
  ctx.fillRect(bx - 6, by - 3, 12, 3);
  // 兜帽阴影中的脸(仅见发光的眼)
  ctx.fillStyle = '#10141e';
  ctx.fillRect(bx - 3, by - 14 + bob, 7, 5);
  ctx.fillStyle = '#8ee8f4';
  ctx.fillRect(bx - 1, by - 12 + bob, 1, 1);
  ctx.fillRect(bx + 2, by - 12 + bob, 1, 1);
  // 记忆芯片灯箱(手提)
  const lx = bx + 8;
  const ly = by - 9 + bob;
  ctx.fillStyle = '#3a3244';
  ctx.fillRect(lx - 1, ly - 3, 6, 7);
  ctx.fillStyle = '#5c5270';
  ctx.fillRect(lx - 1, ly - 3, 6, 1);
  const glow = 0.6 + Math.sin(time * 3.2) * 0.25;
  ctx.globalAlpha = glow;
  ctx.fillStyle = '#7ae0c8';
  ctx.fillRect(lx, ly - 1, 4, 3);
  ctx.fillStyle = '#d0fff0';
  ctx.fillRect(lx + 1, ly, 1, 1);
  ctx.globalAlpha = 1;
  // 交互提示
  if (near) {
    const ny = by - 24 - Math.abs(Math.sin(time * 2.4)) * 2;
    ctx.fillStyle = '#e8d8a8';
    ctx.fillRect(bx - 1, Math.round(ny), 2, 4);
    ctx.fillRect(bx - 2, Math.round(ny) + 1, 4, 1);
  }
}
