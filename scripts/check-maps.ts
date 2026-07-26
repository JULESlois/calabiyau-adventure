// 关卡数据静态校验:行宽一致性、必要符号、出生点安全等。
// 运行: npx tsx scripts/check-maps.ts (或 bun scripts/check-maps.ts)
import { LEVELS, parseLevel, T_SOLID, T_ONEWAY } from '../src/game/levels/levels';

declare const process: { exit(code: number): void };

let errors = 0;
const err = (msg: string) => {
  errors++;
  console.error(`  ✗ ${msg}`);
};

for (const def of LEVELS) {
  console.log(`\n检查 ${def.name} …`);
  const widths = new Set(def.rows.map((r) => r.length));
  if (widths.size > 1) {
    err(`行宽不一致: ${[...widths].join(', ')}`);
    def.rows.forEach((r, i) => {
      if (r.length !== def.rows[0].length) console.error(`    行 ${i} 宽 ${r.length}(首行 ${def.rows[0].length})`);
    });
  }
  const lvl = parseLevel(def);
  const chars = lvl.spawns.map((s) => s.char);
  const count = (c: string) => chars.filter((x) => x === c).length;

  if (count('P') !== 1) err(`出生点 P 数量 = ${count('P')},应为 1`);
  if (def.id === 4) {
    if (count('B') !== 1) err(`Boss B 数量 = ${count('B')},应为 1`);
  } else if (count('E') !== 1) {
    err(`出口 E 数量 = ${count('E')},应为 1`);
  }

  const tileAt = (c: number, r: number) =>
    c < 0 || c >= lvl.w ? T_SOLID : r < 0 || r >= lvl.h ? 0 : lvl.tiles[r * lvl.w + c];

  // 地面实体(P/C/E/敌人/B)下方必须有支撑
  for (const s of lvl.spawns) {
    if (!'PCE134B'.includes(s.char)) continue;
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
    // 且不能嵌在实体里
    if (tileAt(s.col, s.row) === T_SOLID) err(`${s.char} @ (col ${s.col}, row ${s.row}) 嵌在实体砖里`);
  }

  const crystals = count('*');
  console.log(`  ✓ 尺寸 ${lvl.w}×${lvl.h},弦晶 ${crystals},敌人 ${count('1') + count('2') + count('3') + count('4')},检查点 ${count('C')}`);
}

if (errors > 0) {
  console.error(`\n共 ${errors} 个问题。`);
  process.exit(1);
}
console.log('\n全部关卡校验通过 ✔');
