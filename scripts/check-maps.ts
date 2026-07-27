// 世界数据静态校验:房间尺寸、生成点支撑、出口配对、能力推进可达性。
// 运行: npx tsx scripts/check-maps.ts (或 bun scripts/check-maps.ts)
import { parseRows, T_MEMBRANE, T_ONEWAY, T_SOLID } from '../src/game/levels/levels';
import { ROOMS, ROOM_LIST, START_ROOM, ZONES, type Ability } from '../src/game/world/world';

declare const process: { exit(code: number): void };

let errors = 0;
const err = (msg: string) => {
  errors++;
  console.error(`  ✗ ${msg}`);
};

const parsed = new Map<string, ReturnType<typeof parseRows>>();
for (const room of ROOM_LIST) parsed.set(room.id, parseRows(room.rows));

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
    if (!'PTFWJGDS13456B'.includes(s.char)) continue;
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
  }

  const chars = lvl.spawns.map((s) => s.char);
  const count = (c: string) => chars.filter((x) => x === c).length;
  console.log(
    `  ✓ 尺寸 ${lvl.w}×${lvl.h},出口 ${room.exits.length},弦晶 ${count('*')},敌人 ${
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
if (globalCount('S') !== 1) err(`商人 S 数量 = ${globalCount('S')},应为 1`);
for (const z of Object.values(ZONES)) {
  const benches = ROOM_LIST.filter((r) => r.zone === z.id && r.rows.some((row) => row.includes('T')));
  if (benches.length === 0) err(`场景 ${z.name} 没有调弦台`);
}

// ---------------- 能力推进可达性(BFS 到不动点) ----------------
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
  console.log(`  ✓ 全部 ${ROOM_LIST.length} 个房间按能力推进可达;能力获取齐全 [${[...owned].join(', ')}]`);
}

if (errors > 0) {
  console.error(`\n共 ${errors} 个问题。`);
  process.exit(1);
}
console.log('\n全部世界数据校验通过 ✔');
