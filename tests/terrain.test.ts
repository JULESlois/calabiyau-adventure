// Phase 1 地形词汇的行为测试。
// 只测构造(「这个房间里有 @ 吗」)是不够的 —— 地形的价值全在物理行为上,
// 所以这里一律驱动真实的 tileAt / 物理步进 / 存档往返。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BREAKABLE_HITS,
  BREAKABLE_MELEE_HITS,
  CRUMBLE_DELAY,
  CRUMBLE_RESPAWN,
  DT,
  RUN_SPEED,
  THORN_DMG,
  THORN_SLOW_TIME,
  TILE,
} from '../src/game/constants';
import type { Engine } from '../src/game/Engine';
import { T_EMPTY, T_ONEWAY, T_SOLID } from '../src/game/levels/levels';
import { parseWorldSave } from '../src/game/save';
import { PlayState } from '../src/game/states/PlayState';
import { WorldState } from '../src/game/world/WorldState';

function makePlayState(roomId: string, world = new WorldState()): PlayState {
  const engine = {
    world,
    input: { pressed: () => false, down: () => false, lastDevice: 'keyboard' as const },
    audio: {
      sfx: () => undefined,
      playSong: () => undefined,
      playStinger: () => undefined,
      setMusicState: () => undefined,
    },
    persistWorld: () => undefined,
  } as unknown as Engine;
  return new PlayState(engine, roomId, { kind: 'start' });
}

/** 私有方法在测试里按既有约定用类型断言取出。 */
const priv = <T>(state: PlayState) => state as unknown as T;
const step = (state: PlayState, seconds: number) => {
  for (let t = 0; t < seconds; t += DT) state.update(DT);
};

// coast_walk 高处封存龛:@ 在 col 51 的 row 9 与 row 10
const WALL_ROOM = 'coast_walk';
const WALL_COL = 51;
const WALL_ROW = 10;

// ---------------- 可破坏墙 @ ----------------

test('a breakable wall is solid until it is broken', () => {
  const state = makePlayState(WALL_ROOM);
  assert.equal(state.tileAt(WALL_COL, WALL_ROW), T_SOLID);
  assert.equal(state.rectHitsSolid({ x: WALL_COL * TILE + 2, y: WALL_ROW * TILE + 2, w: 4, h: 4 }), true);
});

test('melee breaks a wall in two swings and the tile turns empty', () => {
  const state = makePlayState(WALL_ROOM);
  const hit = priv<{ damageBreakable(c: number, r: number, p: number): boolean }>(state);

  assert.equal(hit.damageBreakable(WALL_COL, WALL_ROW, BREAKABLE_MELEE_HITS), true);
  assert.equal(state.tileAt(WALL_COL, WALL_ROW), T_SOLID, '一刀不够');

  assert.equal(hit.damageBreakable(WALL_COL, WALL_ROW, BREAKABLE_MELEE_HITS), true);
  assert.equal(state.tileAt(WALL_COL, WALL_ROW), T_EMPTY, '两刀应击碎');
  assert.equal(state.rectHitsSolid({ x: WALL_COL * TILE + 2, y: WALL_ROW * TILE + 2, w: 4, h: 4 }), false);
});

test('a real melee swing next to the wall damages it', () => {
  const state = makePlayState(WALL_ROOM);
  const p = state.player;
  p.x = WALL_COL * TILE - 6;
  p.y = (WALL_ROW + 1) * TILE;
  p.facing = 1;
  p.meleeT = 0.22;
  p.meleeStep = 0;
  p.swingId++;
  priv<{ resolveCombat(): void }>(state).resolveCombat();

  const hits = priv<{ breakHits: Map<number, number> }>(state).breakHits;
  assert.equal(hits.get(WALL_ROW * state.level.w + WALL_COL), BREAKABLE_MELEE_HITS);
});

test('one swing only counts once even across several frames', () => {
  const state = makePlayState(WALL_ROOM);
  const p = state.player;
  p.x = WALL_COL * TILE - 6;
  p.y = (WALL_ROW + 1) * TILE;
  p.facing = 1;
  p.meleeT = 0.22;
  p.swingId++;
  const combat = priv<{ resolveCombat(): void }>(state);
  combat.resolveCombat();
  combat.resolveCombat();
  combat.resolveCombat();

  const hits = priv<{ breakHits: Map<number, number> }>(state).breakHits;
  assert.equal(hits.get(WALL_ROW * state.level.w + WALL_COL), BREAKABLE_MELEE_HITS, '同一次挥击不该重复计数');
});

test('two swings open a gap the player can actually fit through', () => {
  // 玩家 20px 高 = 1.25 格,所以只打穿一格是进不去的。
  // 挥击盒纵向覆盖两行,因此一次挥击应同时打到 @ 的上下两格 —— 这才是"能不能进去"的真问题。
  const state = makePlayState(WALL_ROOM);
  const p = state.player;
  p.x = WALL_COL * TILE - 6;
  p.y = (WALL_ROW + 1) * TILE;
  p.facing = 1;
  const combat = priv<{ resolveCombat(): void }>(state);

  for (let swing = 0; swing < 2; swing++) {
    p.meleeT = 0.22;
    p.swingId++;
    combat.resolveCombat();
  }

  assert.equal(state.tileAt(WALL_COL, WALL_ROW), T_EMPTY, '下格应被打穿');
  assert.equal(state.tileAt(WALL_COL, WALL_ROW - 1), T_EMPTY, '上格也应被同一次挥击打穿');
  // 站在洞里的玩家外形盒不该再撞到实体
  assert.equal(
    state.rectHitsSolid({ x: WALL_COL * TILE + 3, y: (WALL_ROW - 1) * TILE + 12, w: 10, h: 20 }),
    false,
    '两格高的缺口应容得下玩家',
  );
});

test('bullets chip the wall and need more hits than melee', () => {
  const state = makePlayState(WALL_ROOM);
  const hit = priv<{ damageBreakable(c: number, r: number, p: number): boolean }>(state);
  for (let i = 0; i < BREAKABLE_HITS - 1; i++) hit.damageBreakable(WALL_COL, WALL_ROW, 1);
  assert.equal(state.tileAt(WALL_COL, WALL_ROW), T_SOLID);

  hit.damageBreakable(WALL_COL, WALL_ROW, 1);
  assert.equal(state.tileAt(WALL_COL, WALL_ROW), T_EMPTY);
});

test('a broken wall is recorded in the world and stays open on re-entry', () => {
  const world = new WorldState();
  const first = makePlayState(WALL_ROOM, world);
  priv<{ damageBreakable(c: number, r: number, p: number): boolean }>(first)
    .damageBreakable(WALL_COL, WALL_ROW, BREAKABLE_HITS);
  assert.ok(world.brokenWalls.has(world.breakableId(WALL_ROOM, WALL_COL, WALL_ROW)));

  // 重新进入同一个房间:地形改动住在 WorldState,而不是这一份 PlayState
  const second = makePlayState(WALL_ROOM, world);
  assert.equal(second.tileAt(WALL_COL, WALL_ROW), T_EMPTY);
});

test('an already-broken wall takes no further damage', () => {
  const world = new WorldState();
  world.brokenWalls.add(world.breakableId(WALL_ROOM, WALL_COL, WALL_ROW));
  const state = makePlayState(WALL_ROOM, world);
  const hit = priv<{ damageBreakable(c: number, r: number, p: number): boolean }>(state);
  assert.equal(hit.damageBreakable(WALL_COL, WALL_ROW, BREAKABLE_MELEE_HITS), false);
});

test('kanami sonar outlines nearby unbroken breakable walls', () => {
  const state = makePlayState(WALL_ROOM);
  const idx = WALL_ROW * state.level.w + WALL_COL;
  const outlined = priv<{ breakableSonar: Map<number, number> }>(state).breakableSonar;
  assert.equal(outlined.has(idx), false);

  state.sonarPulse(WALL_COL * TILE, WALL_ROW * TILE, 44);
  assert.ok((outlined.get(idx) ?? 0) > 0, '声呐脉冲应描出附近的可破坏墙');
});

// ---------------- 碎裂平台 ! ----------------

// tide_gallery 的碎裂平台:row 28,col 33-36
const CRUMBLE_ROOM = 'tide_gallery';
const CRUMBLE_COL = 34;
const CRUMBLE_ROW = 28;

test('a crumbling platform carries weight until it is stood on', () => {
  const state = makePlayState(CRUMBLE_ROOM);
  assert.equal(state.tileAt(CRUMBLE_COL, CRUMBLE_ROW), T_ONEWAY);
  assert.equal(state.hasGroundAt(CRUMBLE_COL * TILE + 8, CRUMBLE_ROW * TILE + 8), true);
});

test('standing on a crumbling platform collapses it, and it rebuilds later', () => {
  const state = makePlayState(CRUMBLE_ROOM);
  const p = state.player;
  p.x = CRUMBLE_COL * TILE + TILE / 2;
  p.y = CRUMBLE_ROW * TILE;
  p.vx = 0;
  p.vy = 0;

  step(state, CRUMBLE_DELAY + 0.1);
  assert.equal(state.tileAt(CRUMBLE_COL, CRUMBLE_ROW), T_EMPTY, '踩住后应塌落');

  // 必定重建 —— 否则一块独木桥塌掉就是不可逆卡关
  step(state, CRUMBLE_RESPAWN + 0.2);
  assert.equal(state.tileAt(CRUMBLE_COL, CRUMBLE_ROW), T_ONEWAY, '塌落后应重建');
});

test('a collapsed platform is intact again on room re-entry', () => {
  const world = new WorldState();
  const first = makePlayState(CRUMBLE_ROOM, world);
  priv<{ crumbleT: Map<number, number> }>(first)
    .crumbleT.set(CRUMBLE_ROW * first.level.w + CRUMBLE_COL, -CRUMBLE_RESPAWN);
  assert.equal(first.tileAt(CRUMBLE_COL, CRUMBLE_ROW), T_EMPTY);

  // 房间运行时状态,不进存档
  const second = makePlayState(CRUMBLE_ROOM, world);
  assert.equal(second.tileAt(CRUMBLE_COL, CRUMBLE_ROW), T_ONEWAY);
  assert.equal(world.serialize().brokenWalls?.length ?? 0, 0);
});

// ---------------- 荆棘 ; ----------------

// coast_cliff 的荆棘:row 13,col 52-54
const THORN_ROOM = 'coast_cliff';
const THORN_COL = 53;
const THORN_ROW = 13;

test('thorns hurt and slow the player without knocking them back', () => {
  const state = makePlayState(THORN_ROOM);
  const p = state.player;
  p.x = THORN_COL * TILE + TILE / 2;
  p.y = (THORN_ROW + 1) * TILE;
  p.vx = RUN_SPEED;
  p.vy = 0;
  p.invuln = 0;
  const hpBefore = p.hp;

  priv<{ checkHazards(): void }>(state).checkHazards();

  assert.equal(p.hp, hpBefore - THORN_DMG, '荆棘应掉固定血量');
  assert.equal(p.slowT, THORN_SLOW_TIME, '荆棘应施加减速');
  // 尖刺会把玩家弹开(vy = -240),荆棘刻意不这样做
  assert.equal(p.vy, 0, '荆棘不该把玩家弹起');
  assert.equal(p.vx, RUN_SPEED, '荆棘不该击退玩家');
});

test('the thorn slow decays on its own', () => {
  const state = makePlayState(THORN_ROOM);
  const p = state.player;
  p.slowT = THORN_SLOW_TIME;
  step(state, THORN_SLOW_TIME + 0.1);
  assert.equal(p.slowT, 0);
});

// ---------------- 冰面 : ----------------

// coast_stormwall 的冰面:row 14,col 44-52(col 48 上有盾卫,取样避开它)
const ICE_ROOM = 'coast_stormwall';
const ICE_COL = 45;
const ICE_ROW = 14;

test('ice is solid ground but reports itself as slippery', () => {
  const state = makePlayState(ICE_ROOM);
  assert.equal(state.tileAt(ICE_COL, ICE_ROW), T_SOLID, '冰是实体地表');
  assert.equal(state.isIceAt(ICE_COL, ICE_ROW), true);
  assert.equal(state.isIceAt(2, ICE_ROW), false, '普通石砖不该报告为冰');
});

test('a player coasts further on ice than on stone', () => {
  // 只驱动玩家物理,不跑整个房间 —— 敌人接触伤害也会改写 vx,会污染这项测量
  const slide = (col: number): { vx: number; grounded: boolean } => {
    const state = makePlayState(ICE_ROOM);
    const p = state.player;
    p.x = col * TILE + TILE / 2;
    p.y = ICE_ROW * TILE;
    p.vy = 0;
    p.vx = RUN_SPEED;
    // 无输入:唯一作用在 vx 上的就是减速项
    for (let t = 0; t < 0.05; t += DT) p.update(DT, state);
    return { vx: Math.abs(p.vx), grounded: p.onGround };
  };
  const onIce = slide(ICE_COL);
  const onStone = slide(20);
  assert.ok(onIce.grounded && onStone.grounded, '两次取样都应站在地面上');
  assert.ok(
    onIce.vx > onStone.vx * 1.4,
    `冰上应明显刹不住(冰 ${onIce.vx.toFixed(1)} vs 石 ${onStone.vx.toFixed(1)})`,
  );
});

// ---------------- 存档 ----------------

test('broken walls survive a save round-trip', () => {
  const world = new WorldState();
  const id = world.breakableId(WALL_ROOM, WALL_COL, WALL_ROW);
  world.brokenWalls.add(id);

  const parsed = parseWorldSave(world.serialize());
  assert.ok(parsed);
  assert.deepEqual(WorldState.deserialize(parsed).brokenWalls, new Set([id]));
});

test('forged breakable coordinates are dropped instead of punching holes in solid rock', () => {
  const world = new WorldState();
  const save = world.serialize();
  // 伪造:一处真实的实体砖、一个不存在的房间、一个越界坐标
  save.brokenWalls = [`${WALL_ROOM}:2:15`, 'no_such_room:1:1', `${WALL_ROOM}:9999:9999`];

  const parsed = parseWorldSave(save);
  assert.ok(parsed);
  assert.deepEqual(parsed.brokenWalls, [], '只有真正的 @ 格位才允许写进存档');
});

test('a legitimate breakable coordinate survives validation', () => {
  const world = new WorldState();
  const save = world.serialize();
  save.brokenWalls = [`${WALL_ROOM}:${WALL_COL}:${WALL_ROW}`];

  const parsed = parseWorldSave(save);
  assert.ok(parsed);
  assert.deepEqual(parsed.brokenWalls, [`${WALL_ROOM}:${WALL_COL}:${WALL_ROW}`]);
});
