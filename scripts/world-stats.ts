import { ROOM_LIST, ZONES } from '../src/game/world/world';

const byZone: Record<string, typeof ROOM_LIST> = {};
for (const r of ROOM_LIST) (byZone[r.zone] ??= [] as never).push(r as never);
for (const z of Object.keys(ZONES)) {
  const rs = byZone[z] ?? [];
  const maxY = Math.max(...rs.map((r) => r.mapY + (r.mapH ?? 1) - 1));
  console.log(
    z.padEnd(7),
    String(rs.length).padStart(2),
    'rooms | mapX',
    Math.min(...rs.map((r) => r.mapX)), '-', Math.max(...rs.map((r) => r.mapX)),
    '| mapY', Math.min(...rs.map((r) => r.mapY)), '-', maxY,
  );
}
console.log();

const occ = new Map<string, string>();
for (const r of ROOM_LIST) {
  for (let y = r.mapY; y < r.mapY + (r.mapH ?? 1); y++) occ.set(`${r.mapX},${y}`, r.zone[0]);
}
const xs = ROOM_LIST.map((r) => r.mapX);
const ys = ROOM_LIST.flatMap((r) => [r.mapY, r.mapY + (r.mapH ?? 1) - 1]);
const x0 = Math.min(...xs); const x1 = Math.max(...xs);
const y0 = Math.min(...ys); const y1 = Math.max(...ys);
console.log(`map occupancy (letter=zone initial, .=free)  x:${x0}..${x1} y:${y0}..${y1}`);
let header = '     ';
for (let x = x0; x <= x1; x++) header += String(x % 10);
console.log(header);
for (let y = y0; y <= y1; y++) {
  let line = String(y).padStart(3) + '  ';
  for (let x = x0; x <= x1; x++) line += occ.get(`${x},${y}`) ?? '.';
  console.log(line);
}
console.log();
const degree = new Map<string, number>();
for (const r of ROOM_LIST) {
  for (const e of r.exits) {
    degree.set(r.id, (degree.get(r.id) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
}
const leaves = ROOM_LIST.filter((r) => (degree.get(r.id) ?? 0) <= 1);
console.log('dead-end rooms (degree<=1):', leaves.map((r) => `${r.zone}:${r.id}`).join(', ') || 'none');

// 传入区域名可打印该区域的房间与出口明细: npx tsx scripts/world-stats.ts tide choir
const wanted = process.argv.slice(2);
for (const z of wanted) {
  console.log(`\n===== ${z} =====`);
  for (const r of ROOM_LIST.filter((x) => x.zone === z)) {
    console.log(
      r.id.padEnd(20), r.name.padEnd(18),
      `${r.rows[0].length}x${r.rows.length}`,
      `map(${r.mapX},${r.mapY}${r.mapH ? ` h${r.mapH}` : ''})`,
      r.transition ? `TRANS->${r.transition.to}` : '',
    );
    for (const e of r.exits) {
      console.log(
        '    ', e.side.padEnd(6), `${e.from}-${e.to}`.padEnd(7),
        `-> ${e.target}`.padEnd(28), `land(${e.ex},${e.ey})`,
        e.needs ? `needs ${e.needs.join('+')}` : '',
      );
    }
  }
}
