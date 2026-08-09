// 找出可以安全放置地面敌人的位置:脚下是实体、身位为空、且没有既有生成点。
// 用法: npx tsx scripts/find-slots.ts lab_atrium sky_corridor
import { parseRows, T_EMPTY, T_SOLID } from '../src/game/levels/levels';
import { ROOMS, ROOM_LIST } from '../src/game/world/world';

const wanted = process.argv.slice(2);
const rooms = wanted.length > 0 ? wanted.map((id) => ROOMS[id]).filter(Boolean) : ROOM_LIST;

for (const room of rooms) {
  const lvl = parseRows(room.rows);
  const taken = new Set(lvl.spawns.map((s) => `${s.col},${s.row}`));
  const at = (c: number, r: number) => lvl.tiles[r * lvl.w + c];
  const slots: number[] = [];
  // 站立行取房间底板上方一格
  for (let r = 1; r < lvl.h - 1; r++) {
    for (let c = 2; c < lvl.w - 2; c++) {
      if (at(c, r) !== T_EMPTY || at(c, r + 1) !== T_SOLID) continue;
      if (at(c, r - 1) !== T_EMPTY) continue; // 头顶要空
      if (taken.has(`${c},${r}`)) continue;
      // 左右各留一格活动空间,避免贴墙生成
      if (at(c - 1, r) !== T_EMPTY || at(c + 1, r) !== T_EMPTY) continue;
      slots.push(r * 1000 + c);
    }
  }
  const byRow = new Map<number, number[]>();
  for (const s of slots) {
    const r = Math.floor(s / 1000);
    const c = s % 1000;
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r)!.push(c);
  }
  console.log(`\n${room.id} (${lvl.w}x${lvl.h})`);
  for (const [r, cols] of [...byRow].sort((a, b) => a[0] - b[0])) {
    console.log(`  row ${r}: cols ${cols.join(',')}`);
  }
}
