// 世界数据静态校验:房间尺寸、生成点支撑、出口配对、能力推进可达性。
// 运行: npm run check:maps
import { readFileSync } from 'node:fs';
import { DT, TILE } from '../src/game/constants';
import {
  parseRows,
  T_BREAKABLE,
  T_CRUMBLE,
  T_EMPTY,
  T_ICE,
  T_MEMBRANE,
  T_ONEWAY,
  T_SOLID,
  T_SPIKE,
  T_THORN,
  T_WATER,
  T_CHAIN,
} from '../src/game/levels/levels';
import { PlayState } from '../src/game/states/PlayState';
import type { Engine } from '../src/game/Engine';
import {
  CRYSTAL_MILESTONES,
  ROOMS,
  ROOM_LIST,
  SHOP_ITEMS,
  START_ROOM,
  totalCrystals,
  ZONES,
  type Ability,
} from '../src/game/world/world';
import { WorldState } from '../src/game/world/WorldState';

declare const process: { exit(code: number): void };

let errors = 0;
const knownSpawns = new Set('PTFWJGDSXYAECVLQ*heabcdg123456789RmnMNUBZ><IOKkstu'.split(''));
const err = (msg: string) => {
  errors++;
  console.error(`  [错误] ${msg}`);
};
const supportsFloor = (tile: number) => tile === T_SOLID || tile === T_ONEWAY || tile === T_MEMBRANE;

/**
 * Phase 1 地形对静态校验而言只是基础类型的别名:
 * 可破坏墙/冰面按实体、碎裂平台按单向、荆棘按尖刺(都是"不该站人的接触伤害")。
 * 在这里折一次,下面所有既有规则都不必逐条改写 —— 与运行时 tileAt() 的做法一致。
 */
const STATIC_TILE_ALIAS = new Map<number, number>([
  [T_BREAKABLE, T_SOLID],
  [T_ICE, T_SOLID],
  [T_CRUMBLE, T_ONEWAY],
  [T_THORN, T_SPIKE],
]);

function parseForChecks(rows: string[]): ReturnType<typeof parseRows> {
  const lvl = parseRows(rows);
  for (let i = 0; i < lvl.tiles.length; i++) {
    const alias = STATIC_TILE_ALIAS.get(lvl.tiles[i]);
    if (alias !== undefined) lvl.tiles[i] = alias;
  }
  return lvl;
}

const parsed = new Map<string, ReturnType<typeof parseRows>>();
/** 未折叠的原始 tile,供 Phase 1 地形的专属规则使用。 */
const rawParsed = new Map<string, ReturnType<typeof parseRows>>();
for (const room of ROOM_LIST) {
  if (parsed.has(room.id)) err(`房间 id 重复: ${room.id}`);
  parsed.set(room.id, parseForChecks(room.rows));
  rawParsed.set(room.id, parseRows(room.rows));
}
if (!ROOMS[START_ROOM]) err(`起始房间不存在: ${START_ROOM}`);

// ---------------- 逐房间检查 ----------------
for (const room of ROOM_LIST) {
  console.log(`\n检查 ${room.id}(${room.name})…`);
  const widths = new Set(room.rows.map((r) => r.length));
  if (widths.size > 1) err(`行宽不一致: ${[...widths].join(', ')}`);

  const lvl = parsed.get(room.id)!;
  const tileAt = (c: number, r: number) =>
    c < 0 || c >= lvl.w ? T_SOLID : r < 0 || r >= lvl.h ? 0 : lvl.tiles[r * lvl.w + c];

  // 地面实体下方必须有支撑('2' 浮游炮除外)
  for (const s of lvl.spawns) {
    if (!'PTFWJGDSXYAECVLQabcdg1345689RBZIOKk><stu'.includes(s.char)) continue;
    let supported = false;
    for (let r = s.row + 1; r < lvl.h; r++) {
      const t = tileAt(s.col, r);
      if (t === T_SOLID || t === T_ONEWAY) {
        supported = true;
        break;
      }
      if (t !== 0) break; // 尖刺/弦膜上不该站人
    }
    if (!supported) err(`${s.char} @ (col ${s.col}, row ${s.row}) 下方没有可站立地面`);
    if (tileAt(s.col, s.row) === T_SOLID) err(`${s.char} @ (col ${s.col}, row ${s.row}) 嵌在实体砖里`);
  }

  // 弦蛭(7)吸附天花板:正上方必须有实体砖,否则伏击设计不成立
  for (const s2 of lvl.spawns) {
    if (s2.char !== '7') continue;
    let ceiling = false;
    for (let r = s2.row - 1; r >= 0; r--) {
      const t = tileAt(s2.col, r);
      if (t === T_SOLID) {
        ceiling = true;
        break;
      }
      if (t !== 0) break; // 单向平台/弦膜不能吸附
    }
    if (!ceiling) err(`弦蛭 7 @ (col ${s2.col}, row ${s2.row}) 上方没有可吸附的天花板`);
  }

  // 出口检查
  for (const e of room.exits) {
    if (e.from > e.to) err(`${e.side} 出口范围倒置: ${e.from}-${e.to}`);
    const target = ROOMS[e.target];
    if (!target) {
      err(`出口指向未知房间 ${e.target}`);
      continue;
    }
    const tl = parsed.get(e.target)!;
    // 落点在目标房间内且不在实体里
    if (e.ex < 0 || e.ex >= tl.w || e.ey < 0 || e.ey >= tl.h) {
      err(`→ ${e.target} 落点 (${e.ex},${e.ey}) 超出目标房间 ${tl.w}×${tl.h}`);
    } else {
      const tt = tl.tiles[e.ey * tl.w + e.ex];
      if (tt === T_SOLID || tt === T_MEMBRANE) err(`→ ${e.target} 落点 (${e.ex},${e.ey}) 嵌在实体/弦膜里`);
      // 玩家高度占两格,上一格也不能是实体
      if (e.ey >= 1 && tl.tiles[(e.ey - 1) * tl.w + e.ex] === T_SOLID) {
        err(`→ ${e.target} 落点 (${e.ex},${e.ey}) 头顶是实体砖`);
      }
      if (e.side !== 'down') {
        const floorRow = e.ey + 1;
        if (floorRow >= tl.h || !supportsFloor(tl.tiles[floorRow * tl.w + e.ex])) {
          err(`→ ${e.target} 侧门落点 (${e.ex},${e.ey}) 脚下没有紧邻地板`);
        }
      }
    }
    // 触发范围不被实体封死(弦膜允许:即"能力门")
    if (e.side === 'left' || e.side === 'right') {
      const c = e.side === 'left' ? 0 : lvl.w - 1;
      let open = false;
      for (let r = e.from; r <= e.to; r++) {
        if (tileAt(c, r) !== T_SOLID) open = true;
      }
      if (!open) err(`${e.side} 出口 rows ${e.from}-${e.to} 被实体砖封死`);
      if (e.from < 0 || e.to >= lvl.h) err(`${e.side} 出口行范围越界`);
      const floorRow = e.to + 1;
      if (floorRow >= lvl.h || !supportsFloor(tileAt(c, floorRow))) {
        err(`${e.side} 出口 rows ${e.from}-${e.to} 门槛没有紧邻地板`);
      }
    } else {
      let open = false;
      for (let c = e.from; c <= e.to; c++) {
        if (tileAt(c, lvl.h - 1) !== T_SOLID) open = true;
      }
      if (!open) err(`down 出口 cols ${e.from}-${e.to} 被实体砖封死`);
      if (e.from < 0 || e.to >= lvl.w) err(`down 出口列范围越界`);
    }

    // 左右通道必须能从目标房间返回；向下坠落口允许单向。
    if (e.side === 'left' || e.side === 'right') {
      const reverse = e.side === 'left' ? 'right' : 'left';
      const paired = target.exits.find((candidate) => candidate.side === reverse && candidate.target === room.id);
      if (!paired) {
        err(`${e.side} 出口 → ${e.target} 缺少 ${reverse} 返回出口`);
      } else if (e.ey !== paired.to) {
        err(`${e.side} 出口 → ${e.target} 落点楼层 ${e.ey} 与目标门槛楼层 ${paired.to} 不一致`);
      }
    }
  }

  const chars = lvl.spawns.map((s) => s.char);
  for (const ch of chars) {
    if (!knownSpawns.has(ch)) err(`未知生成标记: ${ch}`);
  }
  const count = (c: string) => chars.filter((x) => x === c).length;

  for (const shortcut of room.shortcuts ?? []) {
    const { gate, lever } = shortcut;
    if (gate.w < 1 || gate.h < 1) err(`捷径 ${shortcut.id} 门体尺寸无效`);
    if (gate.col < 0 || gate.row < 0 || gate.col + gate.w > lvl.w || gate.row + gate.h > lvl.h) {
      err(`捷径 ${shortcut.id} 门体越界`);
    } else {
      for (let r = gate.row; r < gate.row + gate.h; r++) {
        for (let c = gate.col; c < gate.col + gate.w; c++) {
          if (lvl.tiles[r * lvl.w + c] !== T_EMPTY) err(`捷径 ${shortcut.id} 门体覆盖了静态地形 (${c},${r})`);
          if (lvl.spawns.some((spawn) => spawn.col === c && spawn.row === r)) {
            err(`捷径 ${shortcut.id} 门体覆盖了生成点 (${c},${r})`);
          }
        }
      }
    }
    if (lever.col < 0 || lever.col >= lvl.w || lever.row < 0 || lever.row >= lvl.h - 1) {
      err(`捷径 ${shortcut.id} 开关越界`);
    } else {
      const below = tileAt(lever.col, lever.row + 1);
      if (below !== T_SOLID && below !== T_ONEWAY) err(`捷径 ${shortcut.id} 开关下方没有支撑`);
      if (lvl.tiles[lever.row * lvl.w + lever.col] !== T_EMPTY) err(`捷径 ${shortcut.id} 开关嵌入静态地形`);
      if (lvl.spawns.some((spawn) => spawn.col === lever.col && spawn.row === lever.row)) {
        err(`捷径 ${shortcut.id} 开关与生成点重叠`);
      }
    }
  }
  // 弦镜机器完整性:有发射器就必须有节点与接收器,否则能束永远无处可折。
  if (count('E') > 0 && (count('C') === 0 || count('V') === 0)) {
    err(`${room.id} 有能束发射器但缺少弦镜节点(C)或接收器(V)`);
  }
  // 受电平台没有导能节点就永远不动。
  if ((count('m') > 0 || count('n') > 0) && count('Q') === 0) {
    err(`${room.id} 有受电平台但没有导能节点(Q)`);
  }

  const bossGate = room.bossGate;
  if (bossGate) {
    const g = bossGate.gate;
    if (g.w < 1 || g.h < 1) err(`守卫屏障 ${bossGate.flag} 尺寸无效`);
    if (g.col < 0 || g.row < 0 || g.col + g.w > lvl.w || g.row + g.h > lvl.h) {
      err(`守卫屏障 ${bossGate.flag} 越界`);
    } else {
      for (let r = g.row; r < g.row + g.h; r++) {
        for (let c = g.col; c < g.col + g.w; c++) {
          if (lvl.tiles[r * lvl.w + c] !== T_EMPTY) err(`守卫屏障 ${bossGate.flag} 覆盖了静态地形 (${c},${r})`);
          if (lvl.spawns.some((spawn) => spawn.col === c && spawn.row === r)) {
            err(`守卫屏障 ${bossGate.flag} 覆盖了生成点 (${c},${r})`);
          }
        }
      }
    }
    if (!lvl.spawns.some((spawn) => spawn.char === 'B' || spawn.char === 'Z' || spawn.char === 'A' || spawn.char === 'g')) {
      err(`${room.id} 有守卫屏障但房间里没有 Boss,屏障将永远无法解封`);
    }
  }
  console.log(
    `  [通过] 尺寸 ${lvl.w}×${lvl.h},出口 ${room.exits.length},弦晶 ${count('*')},敌人 ${
      count('1') + count('2') + count('3') + count('4') + count('5') + count('6') +
      count('7') + count('8') + count('9') + count('R')
    }`,
  );
}

// ---------------- 全局检查 ----------------
console.log('\n全局检查…');
const allSpawns = ROOM_LIST.flatMap((r) => parsed.get(r.id)!.spawns.map((s) => ({ ...s, room: r.id })));
const globalCount = (c: string) => allSpawns.filter((s) => s.char === c).length;
if (globalCount('P') !== 1) err(`P 出生点数量 = ${globalCount('P')},应为 1`);
if (globalCount('B') !== 1) err(`Boss B 数量 = ${globalCount('B')},应为 1`);
if (globalCount('Z') !== 1) err(`中 Boss Z 数量 = ${globalCount('Z')},应为 1`);
if (globalCount('A') !== 1) err(`审判者 A 数量 = ${globalCount('A')},应为 1`);
if (globalCount('g') !== 1) err(`王车棋士 g 数量 = ${globalCount('g')},应为 1`);
for (const ch of ['F', 'W', 'J', 'G', 'D', 'X', 'Y', 'L']) {
  if (globalCount(ch) !== 1) err(`能力 ${ch} 数量 = ${globalCount(ch)},应为 1`);
}
for (const ch of ['a', 'b', 'c', 'd']) {
  if (globalCount(ch) !== 1) err(`隐藏遗珍 ${ch} 数量 = ${globalCount(ch)},应为 1`);
}
if (globalCount('S') !== 1) err(`商人 S 数量 = ${globalCount('S')},应为 1`);
for (const z of Object.values(ZONES)) {
  const benches = ROOM_LIST.filter((r) => r.zone === z.id && r.rows.some((row) => row.includes('T')));
  if (benches.length === 0) err(`场景 ${z.name} 没有信标`);
}

// ---------------- Phase 1 地形规则 ----------------
// 可破坏墙的设计契约:打碎它必须有回报。装饰性假墙会训练玩家"墙都能打",
// 之后每一堵真墙都变成猜谜 —— 所以这条不是风格建议,是构建失败。
const REWARD_SPAWNS = new Set('*heabcd'.split(''));
let breakableCount = 0;
let crumbleCount = 0;
let thornCount = 0;
let iceCount = 0;
let waterCount = 0;
let chainCount = 0;
const darkRooms = ROOM_LIST.filter((r) => r.dark).length;

for (const room of ROOM_LIST) {
  const raw = rawParsed.get(room.id)!;
  const { w, h, tiles } = raw;
  const at = (c: number, r: number) => (c < 0 || c >= w || r < 0 || r >= h ? T_SOLID : tiles[r * w + c]);
  const blocks = (t: number) => t === T_SOLID || t === T_MEMBRANE || t === T_BREAKABLE || t === T_ICE;

  for (const t of tiles) {
    if (t === T_BREAKABLE) breakableCount++;
    else if (t === T_CRUMBLE) crumbleCount++;
    else if (t === T_THORN) thornCount++;
    else if (t === T_ICE) iceCount++;
    else if (t === T_WATER) waterCount++;
    else if (t === T_CHAIN) chainCount++;
  }

  // 把开放空间(把未击碎的 @ 当作实体)分成连通区域
  const region = new Int32Array(w * h).fill(-1);
  const regionSize: number[] = [];
  const regionReward: boolean[] = [];
  const rewardAt = new Set(raw.spawns.filter((s) => REWARD_SPAWNS.has(s.char)).map((s) => s.row * w + s.col));
  let nextRegion = 0;
  for (let start = 0; start < w * h; start++) {
    if (region[start] !== -1 || blocks(tiles[start])) continue;
    const id = nextRegion++;
    let size = 0;
    let reward = false;
    const stack = [start];
    region[start] = id;
    while (stack.length) {
      const cur = stack.pop()!;
      size++;
      if (rewardAt.has(cur)) reward = true;
      const c = cur % w;
      const r = (cur - c) / w;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
        const ni = nr * w + nc;
        if (region[ni] !== -1 || blocks(tiles[ni])) continue;
        region[ni] = id;
        stack.push(ni);
      }
    }
    regionSize.push(size);
    regionReward.push(reward);
  }

  // 逐个 @ 连通簇判定
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || tiles[start] !== T_BREAKABLE) continue;
    const cluster: number[] = [];
    const neighbours = new Set<number>();
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      cluster.push(cur);
      const c = cur % w;
      const r = (cur - c) / w;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
        const ni = nr * w + nc;
        if (tiles[ni] === T_BREAKABLE) {
          if (!seen[ni]) {
            seen[ni] = 1;
            stack.push(ni);
          }
        } else if (region[ni] >= 0) {
          neighbours.add(region[ni]);
        }
      }
    }
    const where = `${room.id} 的可破坏墙 @ (col ${cluster[0] % w}, row ${Math.floor(cluster[0] / w)})`;
    if (neighbours.size === 0) {
      err(`${where} 四周全是实体,玩家永远打不到它`);
      continue;
    }
    if (neighbours.size === 1) {
      // 两侧本就连通:只有当它护着奖励时才算"藏了东西"
      if (![...neighbours].some((id) => regionReward[id])) {
        err(`${where} 没有隔开任何空间,后面也没有奖励 —— 装饰性假墙`);
      }
      continue;
    }
    // 隔开了两个区域:若较小的一侧是个死胡同小腔,它必须真的装着东西
    const smallest = [...neighbours].reduce((a, b) => (regionSize[a] <= regionSize[b] ? a : b));
    if (regionSize[smallest] <= 12 && !regionReward[smallest]) {
      err(`${where} 后面是 ${regionSize[smallest]} 格空腔且没有奖励 —— 空腔必须装着东西`);
    }
  }

  // 碎裂平台底下必须是空的,否则塌不塌都一样,机关等于没上线
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (at(c, r) !== T_CRUMBLE) continue;
      if (blocks(at(c, r + 1)) || at(c, r + 1) === T_ONEWAY) {
        err(`${room.id} 的碎裂平台 ! (col ${c}, row ${r}) 正下方就是落脚点,塌落没有意义`);
      }
    }
  }

  // 水体:纸片入水会被强制展开,因此**任何 needs:['paper'] 的坠落口都不能泡在水里**,
  // 否则那条路永远走不通。这条规则来自实际踩坑:第一版蓄水池积水正好盖住井底坠落口。
  for (const exit of room.exits) {
    if (exit.side !== 'down' || !exit.needs?.includes('paper')) continue;
    for (let c = exit.from; c <= exit.to; c++) {
      for (let r = 0; r < h; r++) {
        if (at(c, r) === T_WATER) {
          err(`${room.id} 的纸片坠落口 (col ${c}) 被水体淹没 —— 纸片入水会展开,这条路走不通`);
        }
      }
    }
  }

  // 水面必须够得着:一池水如果四周全是实体,玩家进得去出不来
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (at(c, r) !== T_WATER || at(c, r - 1) === T_WATER) continue;
      // 这是水面格:上方必须是可通行空间
      if (blocks(at(c, r - 1))) {
        err(`${room.id} 的水面 (col ${c}, row ${r}) 被实体封顶 —— 入水后无法上浮离开`);
      }
    }
  }

  // 吊链必须成串且底端离地够高,否则那截链子只是装饰
  for (let c = 0; c < w; c++) {
    let run = 0;
    for (let r = 0; r < h; r++) {
      if (at(c, r) === T_CHAIN) {
        run++;
        continue;
      }
      if (run > 0 && run < 3) {
        err(`${room.id} 的吊链 | (col ${c}, row ${r - run}) 只有 ${run} 格 —— 不足以构成一条纵向路`);
      }
      run = 0;
    }
    if (run > 0 && run < 3) {
      err(`${room.id} 的吊链 | (col ${c}) 只有 ${run} 格 —— 不足以构成一条纵向路`);
    }
  }
}

if (breakableCount === 0) err('世界里没有任何可破坏墙 @,Phase 1 地形词汇未铺设');
if (waterCount === 0) err('世界里没有任何水体 ~,Phase 1.5 未铺设');
if (chainCount === 0) err('世界里没有任何吊链 |,Phase 1.6 未铺设');
if (darkRooms === 0) err('世界里没有任何暗区房间,Phase 1.7 未铺设');
console.log(
  `  [通过] Phase 1 地形铺设 ${breakableCount} 可破坏墙 / ${crumbleCount} 碎裂平台 / ` +
    `${thornCount} 荆棘 / ${iceCount} 冰面 / ${waterCount} 水体 / ${chainCount} 吊链 / ${darkRooms} 暗区`,
);

// ---------------- 奖励曲线不得中途断掉 ----------------
// 世界一扩张,收集品数量就涨,而里程碑与商店价格是写死的常量 —— 于是奖励曲线
// 会静默地在半程结束。这里把"探索到最后仍有回报"变成一条会失败的构建规则。
{
  const crystals = totalCrystals();
  const counts = CRYSTAL_MILESTONES.map((m) => m.count);
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] <= counts[i - 1]) err(`弦晶里程碑未递增: ${counts[i - 1]} → ${counts[i]}`);
  }
  const last = counts[counts.length - 1];
  const ratio = last / crystals;
  // 下限 80%:再低就意味着后段收集毫无作用;上限 92%:末档不该要求接近完美收集
  if (ratio < 0.8 || ratio > 0.92) {
    err(
      `弦晶末档里程碑 ${last} 占总量 ${crystals} 的 ${(ratio * 100).toFixed(0)}%,`
        + '应落在 80%–92%(过低=后半程收集无回报,过高=强迫完美收集)',
    );
  } else {
    console.log(`  [通过] 弦晶奖励曲线覆盖到 ${last}/${crystals}(${(ratio * 100).toFixed(0)}%)`);
  }

  // 晶尘是可再生资源(敌人随房间重入刷新),因此必须存在一个价格递增的无限去处,
  // 否则一次性商品买完后,晶尘的掉落/音效/动画全部退化成噪音。
  if (!SHOP_ITEMS.some((item) => item.repeatable)) {
    err('商店没有可重复购买的条目 —— 晶尘在买完一次性商品后会变成纯噪音');
  }
  // 一次性商品的总价不该被单程产出轻易淹没
  const enemyChars = allSpawns.filter((s) => '123456789R'.includes(s.char));
  const richKinds = new Set(['5', '6']); // 爆裂魔怪 / 刺镰魔怪掉落更多
  const dustSupply = enemyChars.reduce((sum, s) => sum + (richKinds.has(s.char) ? 5 : 2.5), 0)
    + 60 + 80 + 70 + 120; // 四场 Boss
  const oneOffCost = SHOP_ITEMS.filter((i) => !i.repeatable).reduce((sum, i) => sum + i.cost, 0);
  if (oneOffCost < dustSupply * 0.5) {
    err(
      `一次性商品总价 ${oneOffCost} 不足单程晶尘产出 ${Math.round(dustSupply)} 的一半,`
        + '中盘就会买空',
    );
  } else {
    console.log(
      `  [通过] 晶尘经济 单程产出约 ${Math.round(dustSupply)} / 一次性商品 ${oneOffCost} + 可重复条目`,
    );
  }
}

const shortcutIds = new Set<string>();
for (const room of ROOM_LIST) {
  for (const shortcut of room.shortcuts ?? []) {
    if (shortcutIds.has(shortcut.id)) err(`捷径 id 重复: ${shortcut.id}`);
    shortcutIds.add(shortcut.id);
  }
}
if (shortcutIds.size < 5) err(`永久捷径仅 ${shortcutIds.size} 个,至少需要 5 个`);
if (ROOM_LIST.filter((r) => r.zone === 'tide').reduce((n, r) => n + [...r.rows.join('')].filter((c) => c === '>' || c === '<').length, 0) < 3) {
  err('沉潮地窟压力喷流少于 3 个');
}
if (globalCount('I') < 2 || ROOM_LIST.filter((r) => r.zone === 'lab').reduce((n, r) => n + [...r.rows.join('')].filter((c) => c === '&').length, 0) < 10) {
  err('中央研究区的极性终端/极性膜不足');
}
if (globalCount('O') < 3) err(`弦声圣堂共鸣器仅 ${globalCount('O')} 个,至少需要 3 个`);
if (globalCount('K') + globalCount('k') < 5) err('塔顶机库传送带少于 5 条');
console.log(
  `  [通过] 区域机关 ${shortcutIds.size} 捷径 / ${globalCount('>') + globalCount('<')} 喷流 / ` +
    `${globalCount('I')} 极性终端 / ${globalCount('O')} 共鸣器 / ${globalCount('K') + globalCount('k')} 传送带`,
);

const transitionRooms = ROOM_LIST.filter((room) => room.transition);
if (transitionRooms.length < 9) err(`跨区过渡房仅 ${transitionRooms.length} 个,现有跨区边界至少需要 9 个`);
for (const room of transitionRooms) {
  const transition = room.transition!;
  if (transition.to === room.zone) err(`${room.id} 的过渡目标与自身区域相同`);
  const originExit = room.exits.some((exit) => ROOMS[exit.target]?.zone === room.zone)
    || ROOM_LIST.some((candidate) => candidate.zone === room.zone && candidate.exits.some((exit) => exit.target === room.id));
  const targetExit = room.exits.some(
    (exit) => exit.side === transition.toSide && ROOMS[exit.target]?.zone === transition.to,
  );
  if (!originExit) err(`${room.id} 没有连接回起始区域 ${room.zone}`);
  if (!targetExit) err(`${room.id} 的 ${transition.toSide} 侧没有连接目标区域 ${transition.to}`);
}
for (const room of ROOM_LIST) {
  for (const exit of room.exits) {
    const target = ROOMS[exit.target];
    if (!target || room.zone === target.zone) continue;
    const bridge = room.transition ? room : target.transition ? target : null;
    const zones = bridge?.transition ? new Set([bridge.zone, bridge.transition.to]) : null;
    if (!zones?.has(room.zone) || !zones.has(target.zone)) {
      err(`跨区连接 ${room.id} → ${target.id} 未经过匹配的过渡房`);
    }
  }
}
console.log(`  [通过] ${transitionRooms.length} 个跨区过渡房覆盖全部区域边界`);

// ---------------- 关键动作的运行时可达性 ----------------
// needs 只是设计意图，不能作为路径成立的证明。对纸片坠落口运行真实 Player 状态机，
// 确认玩家能从舱口表面持续按 Shift 穿过弦膜并实际触发目标出口。
class TraversalInput {
  held = new Set<string>();

  down(action: string): boolean {
    return this.held.has(action);
  }

  pressed(): boolean {
    return false;
  }
}

let checkedPaperDrops = 0;
for (const room of ROOM_LIST) {
  const lvl = parsed.get(room.id)!;
  for (const exit of room.exits) {
    if (exit.side !== 'down' || !(exit.needs ?? []).includes('paper')) continue;
    checkedPaperDrops++;

    let hatchTop = -1;
    for (let row = 0; row < lvl.h && hatchTop < 0; row++) {
      for (let col = exit.from; col <= exit.to; col++) {
        if (lvl.tiles[row * lvl.w + col] === T_MEMBRANE) {
          hatchTop = row;
          break;
        }
      }
    }
    if (hatchTop < 0) {
      err(`${room.id} 的纸片坠落口 cols ${exit.from}-${exit.to} 没有弦膜舱口`);
      continue;
    }

    const input = new TraversalInput();
    input.held.add('paper');
    const world = new WorldState();
    world.grant('paper');
    for (const ability of exit.needs ?? []) world.grant(ability);
    let transitionedTo = '';
    const engine = {
      input,
      world,
      audio: { sfx: () => undefined },
      persistWorld: () => undefined,
      startRoom: (target: string) => {
        transitionedTo = target;
      },
    } as unknown as Engine;
    const state = new PlayState(engine, room.id, { kind: 'start' });
    state.enemies.length = 0;
    state.boss = null;
    state.player.x = ((exit.from + exit.to + 1) / 2) * TILE;
    state.player.y = hatchTop * TILE;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.onGround = true;
    state.player.energy = world.energyMax;

    let autoGlided = false;
    for (let frame = 0; frame < 180 && !transitionedTo; frame++) {
      state.player.update(DT, state);
      autoGlided ||= state.player.stringMode === 'glide';
      (state as unknown as { checkExits(): boolean }).checkExits();
    }
    if (transitionedTo !== exit.target) {
      err(
        `${room.id} 的纸片坠落口无法按设计触发 ${exit.target}` +
          ` (最终 y=${state.player.y.toFixed(2)},形态=${state.player.stringMode})`,
      );
    }
    if (!autoGlided) err(`${room.id} 的地面弦化坠落没有复用飘飞形态`);
  }
}
console.log(`  [通过] ${checkedPaperDrops} 个纸片坠落口均通过真实移动与出口触发验证`);

// ---------------- 世界规模与拓扑预算 ----------------
if (ROOM_LIST.length < 48) err(`房间总数 ${ROOM_LIST.length},扩展世界至少需要 48 间`);
if (Object.keys(ZONES).length < 6) err(`场景总数 ${Object.keys(ZONES).length},至少需要 6 个主题区域`);
if (globalCount('*') < 40) err(`弦晶总数 ${globalCount('*')},探索奖励密度不足`);

const edges = new Set<string>();
const neighbours = new Map<string, Set<string>>();
for (const room of ROOM_LIST) neighbours.set(room.id, new Set());
for (const room of ROOM_LIST) {
  for (const exit of room.exits) {
    const key = [room.id, exit.target].sort().join('|');
    edges.add(key);
    neighbours.get(room.id)?.add(exit.target);
    neighbours.get(exit.target)?.add(room.id);
  }
}
const cycleRank = edges.size - ROOM_LIST.length + 1;
const junctions = [...neighbours.values()].filter((links) => links.size >= 3).length;
const dynamicRooms = ROOM_LIST.filter((room) => room.rows.some((row) => /[MNU]/.test(row))).length;
if (cycleRank < 8) err(`世界独立环路仅 ${cycleRank},至少需要 8 个`);
if (junctions < 10) err(`三向以上枢纽仅 ${junctions},至少需要 10 个`);
if (dynamicRooms < 12) err(`使用移动平台/气流的房间仅 ${dynamicRooms},至少需要 12 个`);

const occupiedMapCells = new Map<string, string>();
for (const room of ROOM_LIST) {
  for (let y = room.mapY; y < room.mapY + (room.mapH ?? 1); y++) {
    const key = `${room.mapX},${y}`;
    const previous = occupiedMapCells.get(key);
    if (previous) err(`地图格 ${key} 被 ${previous} 与 ${room.id} 重叠占用`);
    else occupiedMapCells.set(key, room.id);
  }
}
console.log(
  `  [通过] 世界规模 ${ROOM_LIST.length} 房间 / ${Object.keys(ZONES).length} 区域 / ${edges.size} 连接 / ${cycleRank} 环路 / ${junctions} 枢纽`,
);

// ---------------- 面向读者的文档:拓扑数字防漂移 ----------------
// 上面的预算只是下限,世界扩张时文档里写死的规模数字会静默过期。
// 这里把文档的说法与实际计算值对账,让文档跟着数据一起失败。
// 每份对外描述世界规模的文件都必须列在这里 —— 没被对账的文档一定会腐烂,
// intro.html 就是先例:它停在"四十八个互联房间"整整十个房间没人发现。
const TOPOLOGY_CLAIMS: { label: string; pattern: RegExp; actual: number }[] = [
  { label: '区域数', pattern: /(\d+)\s*个区域/, actual: Object.keys(ZONES).length },
  { label: '房间数', pattern: /(\d+)\s*个互联房间/, actual: ROOM_LIST.length },
  { label: '连接数', pattern: /(\d+)\s*条连接/, actual: edges.size },
  { label: '独立回环数', pattern: /(\d+)\s*个独立回环/, actual: cycleRank },
  { label: '三向以上枢纽数', pattern: /(\d+)\s*个三向以上枢纽/, actual: junctions },
  { label: '永久捷径数', pattern: /(\d+)\s*道升降闸/, actual: shortcutIds.size },
];
/** 第二个字段是该文件必须对账的项;着陆页只讲区域与房间,不必背下全部拓扑。 */
const CLAIM_FILES: { file: string; labels: string[] }[] = [
  { file: 'README.md', labels: TOPOLOGY_CLAIMS.map((c) => c.label) },
  { file: 'intro.html', labels: ['区域数', '房间数'] },
];

let checkedClaims = 0;
for (const { file, labels } of CLAIM_FILES) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    err(`无法读取 ${file},拓扑数字无法对账`);
    continue;
  }
  for (const claim of TOPOLOGY_CLAIMS.filter((c) => labels.includes(c.label))) {
    checkedClaims++;
    const match = text.match(claim.pattern);
    if (!match) {
      err(`${file} 中找不到${claim.label}的说明(应为「${claim.actual}」),模式 ${claim.pattern}`);
      continue;
    }
    if (Number(match[1]) !== claim.actual) {
      err(`${file} ${claim.label}写作 ${match[1]},实际为 ${claim.actual};请同步该文件`);
    }
  }
}
if (errors === 0) {
  console.log(`  [通过] ${CLAIM_FILES.length} 份文档的 ${checkedClaims} 项拓扑数字与世界数据一致`);
}

// ---------------- 能力推进拓扑可达性(BFS 到不动点) ----------------
const abilityOf: Record<string, Ability> = { F: 'paper', W: 'cling', J: 'djump', D: 'dash', G: 'kanami', X: 'flash', Y: 'skystep', L: 'kinetic' };
const owned = new Set<Ability>();
let reachable = new Set<string>([START_ROOM]);
let changed = true;
while (changed) {
  changed = false;
  // 收集可达房间中的能力
  for (const id of reachable) {
    for (const s of parsed.get(id)!.spawns) {
      const a = abilityOf[s.char];
      if (a && !owned.has(a)) {
        owned.add(a);
        changed = true;
      }
    }
  }
  // 沿满足能力需求的出口扩张
  for (const id of [...reachable]) {
    for (const e of ROOMS[id].exits) {
      if (reachable.has(e.target)) continue;
      const needs = e.needs ?? [];
      if (needs.every((n) => owned.has(n))) {
        reachable.add(e.target);
        changed = true;
      }
    }
  }
}
const unreachable = ROOM_LIST.filter((r) => !reachable.has(r.id));
if (unreachable.length > 0) {
  err(`按能力推进不可达的房间: ${unreachable.map((r) => r.id).join(', ')}`);
} else {
  console.log(
    `  [通过] 拓扑层面连接全部 ${ROOM_LIST.length} 个房间;能力标记齐全 [${[...owned].join(', ')}]` +
      '；关键动作由运行时场景另行验证',
  );
}

if (errors > 0) {
  console.error(`\n共 ${errors} 个问题。`);
  process.exit(1);
}
console.log('\n全部世界数据校验通过');
