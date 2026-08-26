// M0「闭合回路」的行为测试:奖励曲线、晶尘去处、通关结算屏。
// 这一组针对的是"系统都在,但奖励在半程就停了"这一类缺陷 ——
// 因此断言的重点是**曲线覆盖到哪里**,而不是某个数值本身。
import assert from 'node:assert/strict';
import test from 'node:test';
import { INVULN_TIME, TILE } from '../src/game/constants';
import type { Engine } from '../src/game/Engine';
import { parseWorldSave } from '../src/game/save';
import { PlayState, VICTORY_INPUT_DELAY } from '../src/game/states/PlayState';
import {
  CRYSTAL_MILESTONES,
  FORGE_MAX,
  HIDDEN_CHIPS,
  progressionStats,
  repeatableCost,
  ROOM_LIST,
  SHOP_CHIPS,
  SHOP_ITEMS,
  SHORTCUT_IDS,
  totalCrystals,
} from '../src/game/world/world';
import { BOSS_FLAGS, completionReport, WorldState } from '../src/game/world/WorldState';

const FORGE = SHOP_ITEMS.find((i) => i.id === 'forge_core')!;

function makePlayState(
  roomId: string,
  world = new WorldState(),
  pressed: (action: string) => boolean = () => false,
  hooks: { showTitle?: () => void } = {},
): PlayState {
  const engine = {
    world,
    input: { pressed, down: () => false, lastDevice: 'keyboard' as const },
    audio: {
      sfx: () => undefined,
      playSong: () => undefined,
      playStinger: () => undefined,
      setMusicState: () => undefined,
    },
    persistWorld: () => undefined,
    startRoom: () => undefined,
    respawnAtBench: () => undefined,
    showTitle: hooks.showTitle ?? (() => undefined),
  } as unknown as Engine;
  return new PlayState(engine, roomId, { kind: 'start' });
}

const priv = <T>(state: PlayState) => state as unknown as T;

// ---------------- 弦晶奖励曲线 ----------------

test('the crystal curve reaches most of the world, not half of it', () => {
  const total = totalCrystals();
  const last = CRYSTAL_MILESTONES[CRYSTAL_MILESTONES.length - 1].count;
  // 曾经的问题:末档停在 42/80,后半程 47.5% 的收集品毫无作用
  assert.ok(last / total >= 0.8, `末档 ${last}/${total} 覆盖不足 80%`);
  assert.ok(last / total <= 0.92, `末档 ${last}/${total} 过高,等于强迫完美收集`);
});

test('crystal milestones increase monotonically', () => {
  const counts = CRYSTAL_MILESTONES.map((m) => m.count);
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] > counts[i - 1], `里程碑未递增: ${counts[i - 1]} → ${counts[i]}`);
  }
});

test('collecting past the old cap still raises stats', () => {
  const at = (n: number) => progressionStats(n, new Set());
  const oldCap = at(42);
  const full = at(totalCrystals());
  assert.ok(
    full.hpMax > oldCap.hpMax || full.energyMax > oldCap.energyMax,
    '越过旧上限 42 之后应仍有成长',
  );
});

// ---------------- 晶尘去处 ----------------

test('the shop has a repeatable sink so dust never becomes noise', () => {
  const repeatables = SHOP_ITEMS.filter((i) => i.repeatable);
  assert.ok(repeatables.length >= 1, '晶尘可再生,必须有价格递增的无限去处');
});

test('repeatable cost escalates with each purchase', () => {
  const first = repeatableCost(FORGE, 0);
  const second = repeatableCost(FORGE, 1);
  assert.equal(first, FORGE.cost);
  assert.ok(second > first, '重复购买价格应递增');
  assert.equal(second - first, FORGE.repeatable!.costStep);
});

test('buying the forge raises max HP and stops at the cap', () => {
  const world = new WorldState();
  world.dust = 100000;
  const state = makePlayState('lab_gate', world);
  const buy = () => priv<{ buyShopItem(id: string): void }>(state).buyShopItem('forge_core');

  const baseHp = world.hpMax;
  buy();
  assert.equal(world.forgeLevel, 1);
  assert.equal(world.hpMax, baseHp + FORGE.repeatable!.hpBonus);

  for (let i = 0; i < FORGE_MAX + 3; i++) buy();
  assert.equal(world.forgeLevel, FORGE_MAX, '不应越过熔铸上限');
  assert.equal(world.hpMax, baseHp + FORGE_MAX * FORGE.repeatable!.hpBonus);
});

test('the forge refuses when dust is short', () => {
  const world = new WorldState();
  world.dust = FORGE.cost - 1;
  const state = makePlayState('lab_gate', world);
  priv<{ buyShopItem(id: string): void }>(state).buyShopItem('forge_core');
  assert.equal(world.forgeLevel, 0);
  assert.equal(world.dust, FORGE.cost - 1, '买不起时不应扣除晶尘');
});

test('forge level round-trips through a save', () => {
  const world = new WorldState();
  world.forgeLevel = 3;
  const parsed = parseWorldSave(world.serialize());
  assert.ok(parsed);
  const restored = WorldState.deserialize(parsed);
  assert.equal(restored.forgeLevel, 3);
  assert.equal(restored.hpMax, progressionStats(0, new Set(), 3).hpMax);
});

test('an out-of-range forge level is rejected rather than granting free HP', () => {
  const world = new WorldState();
  const save = world.serialize();
  save.forgeLevel = FORGE_MAX + 50;
  assert.equal(parseWorldSave(save), null);
  save.forgeLevel = -1;
  assert.equal(parseWorldSave(save), null);
});

test('the repeatable entry is not a chip, so it cannot be forged into the chip list', () => {
  assert.ok(!SHOP_CHIPS.some((i) => i.id === 'forge_core'));
  const world = new WorldState();
  const save = world.serialize();
  save.chips = ['forge_core'];
  assert.equal(parseWorldSave(save), null, '可重复条目不该能作为芯片写进存档');
});

// ---------------- 通关结算 ----------------

test('a fresh world reports near-zero completion, a finished one reports 100%', () => {
  const fresh = completionReport(new WorldState());
  assert.ok(fresh.percent < 15, `新档完成度应接近 0,实为 ${fresh.percent}`);

  const done = new WorldState();
  for (const r of ROOM_LIST) {
    done.visited.add(r.id);
    r.rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch === '*') done.crystals.add(done.crystalId(r.id, x, y));
      });
    });
  }
  for (const c of [...HIDDEN_CHIPS, ...SHOP_CHIPS]) done.chips.add(c.id);
  for (const id of SHORTCUT_IDS) done.shortcuts.add(id);
  for (const f of BOSS_FLAGS) done.flags.add(f);
  assert.equal(completionReport(done).percent, 100);
});

test('completion averages the categories so bosses are not drowned out by crystals', () => {
  // 全部 4 个 Boss + 0 收集:按"总获得/总数量"会算出个位数,按分项平均才反映真实进度
  const w = new WorldState();
  for (const f of BOSS_FLAGS) w.flags.add(f);
  const report = completionReport(w);
  const bosses = report.entries.find((e) => e.label === '首领')!;
  assert.equal(bosses.got, BOSS_FLAGS.length);
  assert.ok(report.percent >= 16, `四场 Boss 全清应至少体现为 1/6,实为 ${report.percent}%`);
});

test('the completion report covers every progress axis', () => {
  const labels = completionReport(new WorldState()).entries.map((e) => e.label);
  assert.deepEqual(labels, ['弦晶', '遗珍', '芯片', '捷径', '房间', '首领']);
  const rooms = completionReport(new WorldState()).entries.find((e) => e.label === '房间')!;
  assert.equal(rooms.total, ROOM_LIST.length);
});

// ---------------- 结算屏交互 ----------------

function victoryState(pressed: (a: string) => boolean, onTitle: () => void): PlayState {
  const state = makePlayState('hangar_boss', new WorldState(), pressed, { showTitle: onTitle });
  state.overlay = 'victory';
  state.overlayT = 7;
  return state;
}

test('the victory screen no longer ejects the player to the title on its own', () => {
  let toTitle = 0;
  const state = victoryState(() => false, () => { toTitle++; });
  for (let i = 0; i < 60 * 12; i++) state.update(1 / 60); // 12 秒,远超旧的 7 秒自动退出
  assert.equal(toTitle, 0, '结算屏不应自动弹回标题');
  assert.equal(state.overlay, 'victory');
});

test('the victory screen ignores input during the opening beat', () => {
  let toTitle = 0;
  const state = victoryState((a) => a === 'confirm', () => { toTitle++; });
  state.victorySel = 1;
  state.update(1 / 60);
  assert.equal(toTitle, 0, '通关瞬间的连打不该跳过结算');
  assert.ok(state.overlayT > VICTORY_INPUT_DELAY);
});

test('"keep exploring" is the default and resumes play instead of ending the run', () => {
  let toTitle = 0;
  const state = victoryState((a) => a === 'confirm', () => { toTitle++; });
  assert.equal(state.victorySel, 0, '默认光标应停在「继续探索」');
  state.overlayT = VICTORY_INPUT_DELAY - 0.01;
  state.update(1 / 60);
  assert.equal(state.overlay, 'none', '应回到游戏而不是标题');
  assert.equal(toTitle, 0);
});

test('"return to title" is reachable with one move of the cursor', () => {
  let toTitle = 0;
  let allow = 'down';
  const state = victoryState((a) => a === allow, () => { toTitle++; });
  state.overlayT = VICTORY_INPUT_DELAY - 0.01;
  state.update(1 / 60);
  assert.equal(state.victorySel, 1);
  allow = 'confirm';
  state.update(1 / 60);
  assert.equal(toTitle, 1);
});

// ---------------- 新芯片 ----------------

test('chip_guard lengthens the invulnerability window', () => {
  const plain = makePlayState('coast_walk');
  plain.player.hurt(1, plain.player.x + 10, plain);
  const baseline = plain.player.invuln;

  const world = new WorldState();
  world.chips.add('chip_guard');
  const guarded = makePlayState('coast_walk', world);
  guarded.player.hurt(1, guarded.player.x + 10, guarded);

  assert.equal(baseline, INVULN_TIME);
  assert.ok(guarded.player.invuln > baseline, '潮汐外壳应延长无敌时间');
});

test('chip_quarry doubles melee wall-breaking, opening a wall in one swing', () => {
  const world = new WorldState();
  world.chips.add('chip_quarry');
  const state = makePlayState('coast_walk', world);
  const p = state.player;
  p.x = 51 * TILE - 6;
  p.y = 11 * TILE;
  p.facing = 1;
  p.meleeT = 0.22;
  p.swingId++;
  priv<{ resolveCombat(): void }>(state).resolveCombat();

  assert.equal(state.tileAt(51, 10), 0, '裂石之握应让一刀拆穿一格');
});
