// 地形肉眼验收:把 renderTiles 的输出直接栅格化成 PNG。
// 运行: npm run qa:tiles   → 输出到 .qa/(已 gitignore)
//
// 为什么不是浏览器截图:本项目的开发环境(Termux/PRoot)里 Chromium 的渲染进程起不来,
// 而地形的对错**只有看像素才知道** —— 第一版可破坏墙的裂纹用的是黑色,
// 在深色主题上等于隐形,单元测试全绿、check-maps 全绿,却是个"米雪儿永远找不到这堵墙"的 bug。
// 因此这里只实现 renderTiles 真正用到的 Canvas2D 子集(fillRect / strokeRect / alpha / 颜色 / translate),
// 其余方法留空,足够把 tile 层画出来。新增地形时请在末尾加一组 shoot(),然后真的去看那张图。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { TILE, VIEW_H, VIEW_W } from '../src/game/constants';
import type { Engine } from '../src/game/Engine';
import { drawOverlays, type OverlayView } from '../src/game/render/overlays';
import { drawDialogue, pageLength } from '../src/game/render/dialogue';
import { npcById } from '../src/game/npc';
import { PlayState } from '../src/game/states/PlayState';
import { HIDDEN_CHIPS, ROOM_LIST, SHOP_CHIPS, SHORTCUT_IDS } from '../src/game/world/world';
import { BOSS_FLAGS, WorldState } from '../src/game/world/WorldState';

mkdirSync('.qa', { recursive: true });

const SCALE = 4;

/** 数字与少量符号的 3×5 点阵 —— 结算屏的读数必须能核对,汉字则不必。 */
const GLYPHS: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '.': ['...', '...', '...', '...', '.#.'],
};

function parseColor(c: string): [number, number, number, number] {
  if (!c) return [0, 0, 0, 0];
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    const n = hex.length === 3
      ? hex.split('').map((h) => parseInt(h + h, 16))
      : [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return [n[0], n[1], n[2], 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v.trim()));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  return [255, 0, 255, 1];
}

class MiniCtx {
  w: number;
  h: number;
  buf: Uint8ClampedArray;
  globalAlpha = 1;
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  private tx = 0;
  private ty = 0;
  private stack: [number, number][] = [];

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.buf = new Uint8ClampedArray(w * h * 4);
    // 背景填成深底,像素风在深底上才看得清
    for (let i = 0; i < w * h; i++) {
      this.buf[i * 4] = 11; this.buf[i * 4 + 1] = 14; this.buf[i * 4 + 2] = 26; this.buf[i * 4 + 3] = 255;
    }
  }
  save() { this.stack.push([this.tx, this.ty]); }
  restore() { const s = this.stack.pop(); if (s) { this.tx = s[0]; this.ty = s[1]; } }
  translate(x: number, y: number) { this.tx += x; this.ty += y; }
  beginPath() {} moveTo() {} lineTo() {} closePath() {} fill() {} stroke() {} arc() {}
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  drawImage() {} clip() {} rect() {} setTransform() {} scale() {} rotate() {}

  // ---- 文字:只画字形盒,不求可读 ----
  // 目的不是读字,而是验证**版面**:面板有没有超出 480×270、行与行有没有压在一起、
  // 数字列有没有顶出边框。数字与 / % 用 3×5 点阵真画出来,好核对读数;
  // 汉字一律画成实心盒(没有字体文件,也不需要)。
  font = '10px sans-serif';
  textAlign: 'left' | 'center' | 'right' = 'left';
  textBaseline = 'alphabetic';

  private fontSize(): number {
    const m = this.font.match(/(\d+)px/);
    return m ? Number(m[1]) : 10;
  }
  private charW(ch: string): number {
    const size = this.fontSize();
    return ch.charCodeAt(0) > 0x2e80 ? size : size * 0.55;
  }
  measureText(t: string) {
    return { width: [...t].reduce((s, ch) => s + this.charW(ch), 0) };
  }
  fillText(text: string, x: number, y: number) {
    const size = this.fontSize();
    const total = this.measureText(text).width;
    let cx = this.textAlign === 'center' ? x - total / 2 : this.textAlign === 'right' ? x - total : x;
    const col = parseColor(this.fillStyle);
    const top = y - size * 0.78;
    for (const ch of text) {
      const w = this.charW(ch);
      if (ch !== ' ') {
        const glyph = GLYPHS[ch];
        if (glyph) {
          // 3×5 点阵,按字号缩放
          const sx = size * 0.55 / 3;
          const sy = size * 0.78 / 5;
          for (let gy = 0; gy < 5; gy++) {
            for (let gx = 0; gx < 3; gx++) {
              if (glyph[gy][gx] !== '#') continue;
              for (let py = 0; py < Math.max(1, Math.round(sy)); py++) {
                for (let px = 0; px < Math.max(1, Math.round(sx)); px++) {
                  this.px(cx + gx * sx + px, top + gy * sy + py, col, this.globalAlpha);
                }
              }
            }
          }
        } else {
          // 汉字/未知字符:实心盒,只表达占位
          for (let iy = 0; iy < Math.round(size * 0.72); iy++) {
            for (let ix = 0; ix < Math.round(w - 1); ix++) {
              this.px(cx + ix, top + iy, col, this.globalAlpha * 0.72);
            }
          }
        }
      }
      cx += w;
    }
  }

  private px(x: number, y: number, col: [number, number, number, number], alpha: number) {
    const sx = Math.round((x + this.tx) * SCALE);
    const sy = Math.round((y + this.ty) * SCALE);
    const a = col[3] * alpha;
    if (a <= 0) return;
    for (let dy = 0; dy < SCALE; dy++) {
      for (let dx = 0; dx < SCALE; dx++) {
        const px = sx + dx;
        const py = sy + dy;
        if (px < 0 || px >= this.w || py < 0 || py >= this.h) continue;
        const i = (py * this.w + px) * 4;
        this.buf[i] = this.buf[i] * (1 - a) + col[0] * a;
        this.buf[i + 1] = this.buf[i + 1] * (1 - a) + col[1] * a;
        this.buf[i + 2] = this.buf[i + 2] * (1 - a) + col[2] * a;
      }
    }
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const col = parseColor(this.fillStyle);
    for (let iy = 0; iy < Math.round(h); iy++) {
      for (let ix = 0; ix < Math.round(w); ix++) this.px(x + ix, y + iy, col, this.globalAlpha);
    }
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    const col = parseColor(this.strokeStyle);
    for (let ix = 0; ix < Math.round(w); ix++) {
      this.px(x + ix, y, col, this.globalAlpha);
      this.px(x + ix, y + Math.round(h) - 1, col, this.globalAlpha);
    }
    for (let iy = 0; iy < Math.round(h); iy++) {
      this.px(x, y + iy, col, this.globalAlpha);
      this.px(x + Math.round(w) - 1, y + iy, col, this.globalAlpha);
    }
  }
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function writePNG(path: string, w: number, h: number, rgba: Uint8ClampedArray) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

function shoot(name: string, roomId: string, colFrom: number, rowFrom: number, cols: number, rows: number,
               prep?: (s: PlayState) => void, frames = 1) {
  const world = new WorldState();
  const engine = {
    world,
    input: { pressed: () => false, down: () => false, lastDevice: 'keyboard' as const },
    audio: { sfx() {}, playSong() {}, playStinger() {}, setMusicState() {} },
    persistWorld() {}, startRoom() {}, respawnAtBench() {}, showTitle() {},
  } as unknown as Engine;
  const state = new PlayState(engine, roomId, { kind: 'start' });
  prep?.(state);
  for (let i = 0; i < frames; i++) state.update(1 / 60);

  const ctx = new MiniCtx(cols * TILE * SCALE, rows * TILE * SCALE);
  const cx = colFrom * TILE;
  const cy = rowFrom * TILE;
  ctx.translate(-cx, -cy);
  (state as unknown as { renderTiles(c: unknown, x: number, y: number): void })
    .renderTiles(ctx as unknown as CanvasRenderingContext2D, cx, cy);
  writePNG(`.qa/${name}.png`, ctx.w, ctx.h, ctx.buf);
  console.log(`  ${name}.png  ${ctx.w}x${ctx.h}  (${roomId} cols ${colFrom}-${colFrom + cols})`);
}

const breakAt = (c: number, r: number, pts: number) => (s: PlayState) =>
  (s as unknown as { damageBreakable(c: number, r: number, p: number): boolean }).damageBreakable(c, r, pts);

// 可破坏墙:完好 / 受击(裂纹加密+透光) / 已击碎
shoot('01-breakable-intact', 'coast_walk', 46, 6, 14, 10);
shoot('02-breakable-damaged', 'coast_walk', 46, 6, 14, 10, breakAt(51, 10, 3));
shoot('03-breakable-broken', 'coast_walk', 46, 6, 14, 10, breakAt(51, 10, 99));
// 声呐描边
shoot('04-breakable-sonar', 'coast_walk', 46, 6, 14, 10, (s) => s.sonarPulse(51 * TILE, 10 * TILE, 60));
// 荆棘
shoot('05-thorns', 'coast_cliff', 47, 9, 14, 8);
// 冰面
shoot('06-ice', 'coast_stormwall', 40, 10, 16, 7);
// 碎裂平台:完好 / 塌落中(抖动+落灰)/ 已塌(虚影)
shoot('07-crumble-intact', 'tide_gallery', 30, 25, 12, 8);
shoot('08-crumble-shaking', 'tide_gallery', 30, 25, 12, 8, (s) => {
  const idx = 28 * s.level.w + 34;
  (s as unknown as { crumbleT: Map<number, number> }).crumbleT.set(idx, 0.08);
});
shoot('09-crumble-collapsed', 'tide_gallery', 30, 25, 12, 8, (s) => {
  for (let c = 33; c <= 36; c++) {
    (s as unknown as { crumbleT: Map<number, number> }).crumbleT.set(28 * s.level.w + c, -1.2);
  }
});
// 1.5 水体:水面波纹 + 池底;1.6 吊链:必须一眼看出"这条能爬"
shoot('13-water', 'tide_cistern', 4, 26, 16, 8);
shoot('14-chain', 'tide_cistern', 29, 8, 10, 10);

// 对话框版面(2.1)。汉字在这里画成占位盒 —— 无法验证字形,
// 但**能验证版面**:框体是否溢出 480×270、正文行距是否与头像/名牌打架、
// 打字机中途的断字位置是否合理。
function shootDialogue(name: string, npcId: string, revealed: number, page = 0) {
  const world = new WorldState();
  world.flags.add('rescue:kanami');
  const npc = npcById(npcId)!;
  const pages = npc.lines(world);
  const ctx = new MiniCtx(VIEW_W * SCALE, VIEW_H * SCALE);
  drawDialogue(ctx as unknown as CanvasRenderingContext2D, {
    speaker: npc.name,
    color: npc.color,
    lines: pages[page],
    revealed: revealed < 0 ? pageLength(pages[page]) : revealed,
    page,
    pageCount: pages.length,
    device: 'keyboard',
    time: 1.2,
  });
  writePNG(`.qa/${name}.png`, ctx.w, ctx.h, ctx.buf);
  console.log(`  ${name}.png  ${ctx.w}x${ctx.h}  (${npc.name} 第 ${page + 1}/${pages.length} 页)`);
}

shootDialogue('15-dialogue-mid', 'keeper', 9);
shootDialogue('16-dialogue-full', 'sheller', -1, 1);

// ---- 覆盖层版面(结算屏 / 商店)----
// 这两块面板都在 M0 里加了内容(结算屏 6 项分栏 + 两个选项;商店 4 条 → 7 条),
// 逻辑分辨率只有 480×270,溢出是真实风险。画整屏,连边界一起看。
function shootOverlay(name: string, roomId: string, prep: (s: PlayState) => void) {
  const world = new WorldState();
  const engine = {
    world,
    input: { pressed: () => false, down: () => false, lastDevice: 'keyboard' as const },
    audio: { sfx() {}, playSong() {}, playStinger() {}, setMusicState() {} },
    persistWorld() {}, startRoom() {}, respawnAtBench() {}, showTitle() {},
  } as unknown as Engine;
  const state = new PlayState(engine, roomId, { kind: 'start' });
  prep(state);
  const ctx = new MiniCtx(VIEW_W * SCALE, VIEW_H * SCALE);
  drawOverlays(ctx as unknown as CanvasRenderingContext2D,
    (state as unknown as { overlayView(): OverlayView }).overlayView());
  writePNG(`.qa/${name}.png`, ctx.w, ctx.h, ctx.buf);
  console.log(`  ${name}.png  ${ctx.w}x${ctx.h}  (整屏 ${VIEW_W}x${VIEW_H})`);
}

shootOverlay('10-victory-fresh', 'hangar_boss', (s) => {
  s.overlay = 'victory';
  s.overlayT = 3;
  s.world.flags.add('boss:guardian');
  s.world.visited.add('hangar_boss');
});
shootOverlay('11-victory-complete', 'hangar_boss', (s) => {
  s.overlay = 'victory';
  s.overlayT = 3;
  s.victorySel = 1;
  const w = s.world;
  for (const r of ROOM_LIST) {
    w.visited.add(r.id);
    r.rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '*') w.crystals.add(w.crystalId(r.id, x, y));
    }));
  }
  for (const c of [...HIDDEN_CHIPS, ...SHOP_CHIPS]) w.chips.add(c.id);
  for (const id of SHORTCUT_IDS) w.shortcuts.add(id);
  for (const f of BOSS_FLAGS) w.flags.add(f);
});
shootOverlay('12-shop', 'lab_gate', (s) => {
  s.overlay = 'shop';
  s.shopSel = 6;
  s.world.dust = 420;
  s.world.chips.add('chip_hp');
  s.world.forgeLevel = 2;
});

console.log('\n渲染完毕');
