// 世界数据静态校验:房间尺寸、生成点支撑、出口配对、能力推进可达性。
// 运行: npm run check:maps
import { DT, TILE } from '../src/game/constants';
import { parseRows, T_EMPTY, T_MEMBRANE, T_ONEWAY, T_SOLID } from '../src/game/levels/levels';
import { PlayState } from '../src/game/states/PlayState';
import type { Engine } from '../src/game/Engine';
import { ROOMS, ROOM_LIST, START_ROOM, ZONES, type Ability } from '../src/game/world/world';
import { WorldState } from '../src/game/world/WorldState';

declare const process: { exit(code: number): void };

let errors = 0;
const knownSpawns = new Set('PTFWJGDS*heabcd123456MNUB><IOKk'.split(''));
const err = (msg: string) => {
  errors++;
  console.error(`  [错误] ${msg}`);
};

const parsed = new Map<string, ReturnType<typeof parseRows>>();
for (const room of ROOM_LIST) {
  if (parsed.has(room.id)) err(`房间 id 重复: ${room.id}`);
  parsed.set(room.id, parseRows(room.rows));
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
    if (!'PTFWJGDSabcd13456BIOKk><'.includes(s.char)) continue;
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
      const paired = target.exits.some((candidate) => candidate.side === reverse && candidate.target === room.id);
      if (!paired) err(`${e.side} 出口 → ${e.target} 缺少 ${reverse} 返回出口`);
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
  console.log(
    `  [通过] 尺寸 ${lvl.w}×${lvl.h},出口 ${room.exits.length},弦晶 ${count('*')},敌人 ${
      count('1') + count('2') + count('3') + count('4') + count('5') + count('6')
    }`,
  );
}

// ---------------- 全局检查 ----------------
console.log('\n全局检查…');
const allSpawns = ROOM_LIST.flatMap((r) => parsed.get(r.id)!.spawns.map((s) => ({ ...s, room: r.id })));
const globalCount = (c: string) => allSpawns.filter((s) => s.char === c).length;
if (globalCount('P') !== 1) err(`P 出生点数量 = ${globalCount('P')},应为 1`);
if (globalCount('B') !== 1) err(`Boss B 数量 = ${globalCount('B')},应为 1`);
for (const ch of ['F', 'W', 'J', 'G', 'D']) {
  if (globalCount(ch) !== 1) err(`能力 ${ch} 数量 = ${globalCount(ch)},应为 1`);
}
for (const ch of ['a', 'b', 'c', 'd']) {
  if (globalCount(ch) !== 1) err(`隐藏遗珍 ${ch} 数量 = ${globalCount(ch)},应为 1`);
}
if (globalCount('S') !== 1) err(`商人 S 数量 = ${globalCount('S')},应为 1`);
for (const z of Object.values(ZONES)) {
  const benches = ROOM_LIST.filter((r) => r.zone === z.id && r.rows.some((row) => row.includes('T')));
  if (benches.length === 0) err(`场景 ${z.name} 没有调弦台`);
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
    if (autoGlided) err(`${room.id} 的地面弦化坠落错误地自动进入了飘飞形态`);
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

// ---------------- 能力推进拓扑可达性(BFS 到不动点) ----------------
const abilityOf: Record<string, Ability> = { F: 'paper', W: 'cling', J: 'djump', D: 'dash', G: 'kanami' };
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
