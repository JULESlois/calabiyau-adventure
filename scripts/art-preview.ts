// 角色美术预览页:两位角色 × 常规/弦化姿态,放大 6 倍检查像素细节。
// 构建: bun build scripts/art-preview.ts --outdir <dir> --target browser
import { drawChar, type CharPose } from '../src/game/render/sprites';
import type { CharId } from '../src/game/types';

const SCALE = 6;
const CELL_W = 26;
const ROW_H = 40;
const LOGICAL_W = 14 + CELL_W * 11;
const LOGICAL_H = 100;

const canvas = document.createElement('canvas');
canvas.width = LOGICAL_W * SCALE;
canvas.height = LOGICAL_H * SCALE;
canvas.style.imageRendering = 'pixelated';
canvas.style.display = 'block';
canvas.style.margin = '12px auto';
document.body.style.background = '#0b0e1a';
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d')!;

const POSES: [string, Partial<CharPose>][] = [
  ['待机', {}],
  ['奔跑', { moving: true, moveSpeed: 1 }],
  ['起跳', { airborne: true, vy: -360, takeoff: 1, moveSpeed: 0.7 }],
  ['滞空', { airborne: true, vy: 0, moveSpeed: 0.7 }],
  ['下落', { airborne: true, vy: 200 }],
  ['落地', { landing: 1 }],
  ['射击', { shootFlash: 0.8 }],
  ['近战', { meleeT: 0.5, meleeStep: 2 }],
  ['地面弦化', { paper: true, stringMode: 'ground' }],
  ['贴墙', { paper: true, stringMode: 'wall' }],
  ['空中飘飞', { paper: true, stringMode: 'glide', airborne: true, vy: 42 }],
];

function frame(now: number): void {
  const t = now / 1000;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#181428';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.scale(SCALE, SCALE);
  (['michele', 'kanami'] as CharId[]).forEach((char, row) => {
    POSES.forEach(([, part], i) => {
      const pose: CharPose = {
        runPhase: t * 13,
        moving: false,
        moveSpeed: 0,
        airborne: false,
        vy: 0,
        takeoff: 0,
        landing: 0,
        turning: 0,
        meleeT: 0,
        meleeStep: 0,
        shootFlash: 0,
        hurtFlash: false,
        time: t,
        ...part,
        paper: part.paper ?? false,
        stringMode: part.stringMode ?? (part.paper ? 'ground' : 'normal'),
      };
      const x = 16 + i * CELL_W;
      const y = 34 + row * ROW_H;
      // 地面参考线
      ctx.fillStyle = '#2a2440';
      ctx.fillRect(x - 10, y, 21, 1);
      drawChar(ctx, char, x, y, 1, pose);
    });
  });
  ctx.restore();

  // 标签
  ctx.fillStyle = '#8a7a98';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  POSES.forEach(([name], i) => {
    ctx.fillText(name, (16 + i * CELL_W) * SCALE, 26 * SCALE + 14 - SCALE * 20);
  });
  ctx.textAlign = 'left';
  ctx.fillText('米雪儿', 8, 34 * SCALE - 60);
  ctx.fillText('香奈美', 8, 74 * SCALE - 60);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
