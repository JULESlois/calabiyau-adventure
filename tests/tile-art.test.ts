// 地形材质与图底分离。
//
// 这一组守的是三个**只有看像素才会发现、但可以量化**的缺陷:
//   1. 六个区域共用同一种砖,只换四个主题色 —— 地面占满每一帧的下半屏,却毫无区域身份;
//   2. 天穹区地形与近景层几乎同亮(实测分离 0.2),玩家看不清自己站在哪里;
//   3. 六区共用同一套雾霭与微粒,空气的浓稠程度不参与区分地方。
//
// 关于 2 有一个必须记下的教训:**调色板里的底色不等于画出来的样子**。
// 一格 = 底色 + 勾缝 + 孔洞 + 阴影,后三者会把分离度吃掉最多一半
// (乱石砌 0.49、细琢条石 0.45,金属板几乎不掉)。
// 所以静态检查只是下限,权威数值来自 `npm run qa:tiles` 对渲染结果的实测。
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
  // 下限 8:这是**调色板**上的分离,画出来还会被材质侵蚀。天穹区曾经实测只有 0.2。
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

// ---------------- 区域大气 ----------------
// 颜色与材质之外的第三个身份维度。原先六区共用同一套雾霭/微粒处理,只差颜色。

test('no two zones breathe the same air', () => {
  const sigs = Object.entries(ZONES).map(([id, z]) => {
    const a = z.theme.atmosphere;
    return [id, `${a.fogDensity}|${a.fogBand}|${a.drift.kind}|${a.drift.count}|${a.drift.size}|${a.drift.speed}|${a.rays}`] as const;
  });
  const seen = new Map<string, string>();
  for (const [id, sig] of sigs) {
    const clash = seen.get(sig);
    assert.equal(clash, undefined, `${id} 与 ${clash} 的大气完全相同`);
    seen.set(sig, id);
  }
});

test('atmosphere spans a real range rather than nudging one number', () => {
  const d = Object.values(ZONES).map((z) => z.theme.atmosphere.fogDensity);
  assert.ok(Math.max(...d) / Math.min(...d) >= 3, `雾浓度跨度只有 ${Math.min(...d)}–${Math.max(...d)},区分不出来`);
  const kinds = new Set(Object.values(ZONES).map((z) => z.theme.atmosphere.drift.kind));
  assert.equal(kinds.size, 6, '每个区域应有自己的微粒种类');
});

test('particle drift directions actually differ — rising, hovering and falling all occur', () => {
  const speeds = Object.values(ZONES).map((z) => z.theme.atmosphere.drift.speed);
  assert.ok(speeds.some((s) => s < 0), '应有上升的微粒(余烬/气泡/煤灰)');
  assert.ok(speeds.some((s) => s === 0), '应有悬浮的微粒(实验室浮尘)');
  assert.ok(speeds.some((s) => s > 0), '应有下沉的微粒(天穹落雪)');
});

test('light shafts are declared by atmosphere, not hardcoded to two zones', () => {
  const rays = Object.values(ZONES).map((z) => z.theme.atmosphere.rays);
  assert.ok(rays.includes('warm'), '应有暖色光束(海滨落日)');
  assert.ok(rays.includes('cold'), '应有冷色光束(圣堂/天穹)');
  assert.ok(rays.includes('none'), '并非所有区域都该有光束');
  assert.ok(rays.filter((r) => r !== 'none').length >= 3, '光束原本只有两区写死,现在应更广');
});

test('atmosphere snaps at a transition midpoint like material does', () => {
  const from = ZONES.tide.theme;
  const to = ZONES.sky.theme;
  assert.equal(blendLevelThemes(from, to, 0.3).atmosphere.drift.kind, from.atmosphere.drift.kind);
  assert.equal(blendLevelThemes(from, to, 0.7).atmosphere.drift.kind, to.atmosphere.drift.kind);
  // 大气不能被当成颜色混掉
  const mid = blendLevelThemes(from, to, 0.5);
  assert.equal(typeof mid.atmosphere.fogDensity, 'number');
  assert.ok(mid.atmosphere.drift.count > 0);
});

test('particle counts stay within a sane budget', () => {
  // 微粒是每帧全量绘制的,数量失控会直接吃掉帧时间
  for (const [id, z] of Object.entries(ZONES)) {
    const c = z.theme.atmosphere.drift.count;
    assert.ok(c > 0 && c <= 64, `${id} 微粒数 ${c} 超出预算`);
  }
});
