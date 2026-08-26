// 地形材质与图底分离。
//
// 这一组守的是两个**只有看像素才会发现、但可以量化**的缺陷:
//   1. 六个区域共用同一种砖,只换四个主题色 —— 地面占满每一帧的下半屏,却毫无区域身份;
//   2. 天穹区地形与近景层的感知亮度只差 0.2,玩家看不清自己站在哪里。
//      按 HSL 明度看这两者差 3 个点,完全看不出问题 —— HSL 的 L 不是感知亮度。
import assert from 'node:assert/strict';
import test from 'node:test';
import { TILE } from '../src/game/constants';
import { drawSolidTile, roomSeedOf, tileNoise, type TileStyle } from '../src/game/render/tileStyles';
import { blendLevelThemes } from '../src/game/states/PlayState';
import { ROOM_LIST, ZONES } from '../src/game/world/world';

/** Rec.709 感知亮度 0..100。 */
function lum(hex: string): number {
  const m = hex.match(/#([0-9a-f]{6})/i);
  if (!m) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * 100;
}

/** 记录每次绘制调用的极简 ctx,用来比较两种材质是否真的画了不同的东西。 */
function recordingCtx() {
  const ops: string[] = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', globalAlpha: 1,
    fillRect(x: number, y: number, w: number, h: number) {
      ops.push(`fill ${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)} ${this.fillStyle}@${this.globalAlpha}`);
    },
    strokeRect() { ops.push('stroke'); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

const STYLES: TileStyle[] = ['masonry', 'wetblock', 'panel', 'ashlar', 'cloudstone', 'plate'];
const NEIGHBOURS = { up: false, down: false, left: false, right: false };

test('every zone has its own terrain material, not just its own colours', () => {
  const styles = Object.values(ZONES).map((z) => z.theme.tileStyle);
  assert.equal(new Set(styles).size, styles.length, `材质重复:${styles.join(', ')}`);
});

test('terrain separates from the backdrop by perceptual luminance in every zone', () => {
  // 下限 8:低于此值时地形会融进近景层。天穹区曾经是 0.2。
  for (const [id, zone] of Object.entries(ZONES)) {
    const gap = Math.abs(lum(zone.theme.tileBase) - lum(zone.theme.near));
    assert.ok(gap >= 8, `${id} 地形与背景亮度只差 ${gap.toFixed(1)}`);
  }
});

test('no material may erode more than half of its own base tile', () => {
  // 这条用例守的是**调色板检查为什么只是下限**。
  // 一格画出来 = 底色 + 勾缝 + 孔洞 + 阴影,后三者会把图底分离度吃掉一部分。
  // 实测各材质的侵蚀比例在 0.45–1.03 之间(乱石砌与细琢条石最狠) ——
  // 也就是说调色板差 12 的区域,画出来可能只剩 5.5。
  // 若某种材质压得比这更狠,check-maps 的下限就会失去意义,必须在这里拦下。
  const theme = ZONES.coast.theme;
  for (const style of STYLES) {
    const { ctx, ops } = recordingCtx();
    drawSolidTile(ctx, 0, 0, style, { theme, ...NEIGHBOURS, h: 96 });
    let darkened = 0;
    for (const op of ops) {
      const m = op.match(/^fill (-?\d+),(-?\d+),(-?\d+),(-?\d+) (\S+)@([\d.]+)$/);
      if (!m) continue;
      const [, , , w, h, color, alpha] = m;
      const rgba = color.match(/rgba\(0,0,0,([\d.]+)\)/);
      if (!rgba) continue; // 只统计压暗
      darkened += Number(w) * Number(h) * Number(rgba[1]) * Number(alpha);
    }
    const fraction = darkened / (TILE * TILE);
    assert.ok(
      fraction < 0.5,
      `材质 ${style} 压暗了自身 ${(fraction * 100).toFixed(0)}% 的面积,会吃掉图底分离`,
    );
  }
});

test('the static palette floor leaves room for that erosion', () => {
  // check-maps 的下限必须高于"想要的渲染分离度",否则最狠的材质会把它吃穿。
  for (const [id, zone] of Object.entries(ZONES)) {
    const gap = Math.abs(lum(zone.theme.tileBase) - lum(zone.theme.near));
    assert.ok(gap >= 11, `${id} 调色板分离 ${gap.toFixed(1)} 低于下限 11`);
  }
});

test('each material draws a visibly different tile', () => {
  const theme = ZONES.coast.theme;
  const drawn = new Map<string, string>();
  for (const style of STYLES) {
    const { ctx, ops } = recordingCtx();
    drawSolidTile(ctx, 0, 0, style, { theme, ...NEIGHBOURS, h: 64 });
    const sig = ops.join('|');
    for (const [other, otherSig] of drawn) {
      assert.notEqual(sig, otherSig, `${style} 与 ${other} 画出来完全一样`);
    }
    drawn.set(style, sig);
  }
  assert.equal(drawn.size, STYLES.length);
});

test('the top surface is treated differently per material', () => {
  // 顶沿是视线最先落到的地方,不同材质必须在这里也不同
  const theme = ZONES.coast.theme;
  const tops = new Set<string>();
  for (const style of STYLES) {
    const withTop = recordingCtx();
    drawSolidTile(withTop.ctx, 0, 0, style, { theme, ...NEIGHBOURS, up: false, h: 12 });
    const noTop = recordingCtx();
    drawSolidTile(noTop.ctx, 0, 0, style, { theme, ...NEIGHBOURS, up: true, h: 12 });
    // 顶沿专属的那部分绘制 = 两者之差
    tops.add(withTop.ops.filter((o) => !noTop.ops.includes(o)).join('|'));
  }
  assert.equal(tops.size, STYLES.length, '有材质共用了同一种顶沿处理');
});

test('every material stays inside its own tile', () => {
  const theme = ZONES.coast.theme;
  for (const style of STYLES) {
    const { ctx, ops } = recordingCtx();
    drawSolidTile(ctx, 0, 0, style, { theme, ...NEIGHBOURS, h: 200 });
    for (const op of ops) {
      const m = op.match(/^fill (-?\d+),(-?\d+),(-?\d+),(-?\d+)/);
      if (!m) continue;
      const [x, y, w, h] = m.slice(1).map(Number);
      assert.ok(x >= 0 && y >= 0, `${style} 画到了格子左/上之外: ${op}`);
      assert.ok(x + w <= TILE && y + h <= TILE, `${style} 画出了格子右/下边界: ${op}`);
    }
  }
});

// ---------------- 装饰噪点不得跨房间重复 ----------------

test('two rooms do not share the same decorative noise at the same coordinates', () => {
  // 原实现的噪声只由世界坐标决定,竖向堆叠的房间会一模一样。
  const a = roomSeedOf('coast_walk');
  const b = roomSeedOf('tide_entry');
  assert.notEqual(a, b, '不同房间应有不同散列');
  let differs = 0;
  for (let c = 0; c < 40; c++) {
    for (let r = 0; r < 16; r++) {
      if (tileNoise(c, r, a) !== tileNoise(c, r, b)) differs++;
    }
  }
  assert.ok(differs > 40 * 16 * 0.9, `同坐标噪点应基本不同,实际只有 ${differs}/640 处不同`);
});

test('noise stays stable for a given room, so terrain does not shimmer', () => {
  const seed = roomSeedOf('lab_cells');
  for (let i = 0; i < 20; i++) {
    assert.equal(tileNoise(7, 3, seed), tileNoise(7, 3, seed));
  }
});

test('room seeds are distinct across the whole world', () => {
  const seeds = new Map<number, string>();
  let collisions = 0;
  for (const room of ROOM_LIST) {
    const seed = roomSeedOf(room.id);
    if (seeds.has(seed)) collisions++;
    seeds.set(seed, room.id);
  }
  // 少量碰撞无害(只影响装饰),但不该成片
  assert.ok(collisions <= 2, `${collisions} 个房间散列碰撞,装饰会成片重复`);
});

// ---------------- 跨区过渡 ----------------

test('material snaps at the midpoint of a transition instead of interpolating', () => {
  const from = ZONES.coast.theme;
  const to = ZONES.tide.theme;
  assert.equal(blendLevelThemes(from, to, 0).tileStyle, from.tileStyle);
  assert.equal(blendLevelThemes(from, to, 0.49).tileStyle, from.tileStyle);
  assert.equal(blendLevelThemes(from, to, 0.5).tileStyle, to.tileStyle);
  assert.equal(blendLevelThemes(from, to, 1).tileStyle, to.tileStyle);
});

test('blending still interpolates colours and never emits a style as a colour', () => {
  const mid = blendLevelThemes(ZONES.coast.theme, ZONES.hangar.theme, 0.5);
  assert.match(mid.tileBase, /^rgba\(/, '颜色应插值为 rgba');
  assert.ok(STYLES.includes(mid.tileStyle), 'tileStyle 应仍是合法材质而不是被当成颜色混掉');
});
