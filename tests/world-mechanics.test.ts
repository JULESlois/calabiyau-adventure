import assert from 'node:assert/strict';
import test from 'node:test';
import type { Engine } from '../src/game/Engine';
import { Enemy } from '../src/game/entities/enemies';
import { T_EMPTY, T_MEMBRANE, T_SOLID } from '../src/game/levels/levels';
import { PlayState, type EntryInfo } from '../src/game/states/PlayState';
import type { MusicCue, MusicIntensity } from '../src/game/music';
import { ABILITY_INFO, ROOM_LIST, type Ability } from '../src/game/world/world';
import { WorldState } from '../src/game/world/WorldState';

interface AudioSpy {
  sfx: (name: string) => void;
  playSong: (cue: MusicCue | -1, fadeTime?: number) => void;
  playStinger: (kind: string) => void;
  setMusicState: (mix: { intensity: MusicIntensity; ducked: boolean }) => void;
}

function silentAudio(): AudioSpy {
  return {
    sfx: () => undefined,
    playSong: () => undefined,
    playStinger: () => undefined,
    setMusicState: () => undefined,
  };
}

function makePlayState(
  roomId: string,
  interact = false,
  entry: EntryInfo = { kind: 'start' },
  audio: AudioSpy = silentAudio(),
): PlayState {
  const engine = {
    world: new WorldState(),
    input: {
      pressed: (action: string) => interact && action === 'interact',
      down: () => false,
    },
    audio,
    persistWorld: () => undefined,
  } as unknown as Engine;
  return new PlayState(engine, roomId, entry);
}

/** 需要逐帧控制输入的用例:传入一个 pressed 判定与要监听的 Engine 回调。 */
function makePlayStateWithInput(
  roomId: string,
  pressed: (action: string) => boolean,
  hooks: { respawnAtBench?: () => void; showTitle?: () => void } = {},
): PlayState {
  const engine = {
    world: new WorldState(),
    input: { pressed, down: () => false, lastDevice: 'keyboard' as const },
    audio: silentAudio(),
    persistWorld: () => undefined,
    startRoom: () => undefined,
    respawnAtBench: hooks.respawnAtBench ?? (() => undefined),
    showTitle: hooks.showTitle ?? (() => undefined),
  } as unknown as Engine;
  return new PlayState(engine, roomId, { kind: 'start' });
}

interface FloatingHintView {
  lines: string[];
  delay: number;
  t: number;
}

const floatingHints = (state: PlayState): FloatingHintView[] =>
  (state as unknown as { floatingHints: FloatingHintView[] }).floatingHints;

test('shortcut gates are solid until their persistent id is opened', () => {
  const state = makePlayState('coast_beacon');
  assert.equal(state.tileAt(27, 7), T_SOLID);

  state.world.shortcuts.add('beacon_lift');
  assert.equal(state.tileAt(27, 7), T_EMPTY);
});

test('F at the far-side lever opens and persists a shortcut', () => {
  const state = makePlayState('coast_beacon', true);
  const shortcut = state.mechanics.shortcuts[0];
  state.player.x = shortcut.lever.x;
  state.player.y = shortcut.lever.y;

  (state as unknown as { updateInteractables(): void }).updateInteractables();

  assert.equal(state.world.shortcuts.has('beacon_lift'), true);
  assert.equal(state.tileAt(27, 7), T_EMPTY);
});

test('fast travel lists only beacons activated by interaction', () => {
  const state = makePlayState('coast_start');
  state.world.visited.add('coast_shrine');
  const getBeacons = () =>
    (state as unknown as { getVisitedBenches(): { id: string }[] }).getVisitedBenches();

  assert.deepEqual(getBeacons().map((beacon) => beacon.id), ['coast_start']);
  state.world.activatedBeacons.add('coast_shrine');
  assert.deepEqual(getBeacons().map((beacon) => beacon.id), ['coast_start', 'coast_shrine']);
});

test('resting at a beacon saves without hijacking the screen; a second press opens travel', () => {
  const state = makePlayState('coast_shrine', true);
  const beacon = state.benches[0];
  assert.ok(beacon);
  state.player.x = beacon.x;
  state.player.y = beacon.y;
  const interact = () => (state as unknown as { updateInteractables(): void }).updateInteractables();

  // 第一次:只休息与存档。传送列表不该抢走画面 ——
  // 旧版在这里直接弹出列表且光标停在世界第一个房间,连按两次 F 就被送回开局点。
  interact();
  assert.equal(state.world.benchRoom, 'coast_shrine');
  assert.equal(state.world.activatedBeacons.has('coast_shrine'), true);
  assert.equal(state.overlay, 'none');
  assert.equal(beacon.resting, true);

  // 第二次:才打开传送列表,且光标停在当前信标上。
  interact();
  assert.equal(state.overlay, 'fast_travel');
  const list = (state as unknown as {
    getVisitedBenches(): { id: string; isCurrent: boolean }[];
  }).getVisitedBenches();
  assert.ok(list.length > 1, '此时应当有多个可选信标');
  assert.equal(list[state.fastTravelIndex]?.isCurrent, true, '光标必须落在当前信标');
});

test('lab polarity terminals control only the dedicated polarity membrane', () => {
  const state = makePlayState('lab_observation');
  assert.equal(state.tileAt(39, 8), T_MEMBRANE);

  state.mechanics.polarityOpen = true;
  assert.equal(state.tileAt(39, 8), T_EMPTY);
});

test('regional rooms instantiate their signature mechanics', () => {
  assert.equal(makePlayState('tide_entry').mechanics.pressureJets.length, 1);
  assert.equal(makePlayState('choir_nave').mechanics.resonators.length, 1);
  assert.equal(makePlayState('hangar_assembly').mechanics.conveyors.length, 2);
});

test('a fresh game shows basic controls as delayed in-world text, but bench entry does not', () => {
  const fresh = makePlayState('coast_start');
  const hints = floatingHints(fresh);

  assert.equal(hints.length, 1);
  assert.deepEqual(hints[0].lines, ['A / D 移动 · W / 空格 跳跃', 'J 射击 · K 近战 · F 交互']);
  assert.equal(hints[0].delay, 2.8);
  assert.equal(fresh.world.flags.has('tutorial:start'), true);

  const benchEntry = makePlayState('coast_start', false, { kind: 'bench' });
  assert.equal(floatingHints(benchEntry).length, 0);
});

test('every newly granted ability creates a concise in-world key hint', () => {
  const expectedKey: Record<Ability, string> = {
    paper: 'Shift',
    cling: 'E',
    djump: '空格',
    dash: 'U',
    flash: 'Shift',
    skystep: '跳跃',
    kanami: 'Q',
  };

  for (const kind of Object.keys(expectedKey) as Ability[]) {
    const state = makePlayState('coast_shrine');
    (state as unknown as { grantAbility(ability: Ability, x: number, y: number): void })
      .grantAbility(kind, 120, 100);
    const hints = floatingHints(state);
    const hint = hints[hints.length - 1];

    assert.ok(hint, `${kind} did not create a floating hint`);
    assert.deepEqual(hint.lines, [ABILITY_INFO[kind].hint]);
    assert.ok(hint.lines[0].includes(expectedKey[kind]), `${kind}: ${hint.lines[0]}`);
    assert.equal(state.world.has(kind), true);
  }
});

test('nearby enemies raise the music layer and ability overlays duck it', () => {
  const mixes: { intensity: MusicIntensity; ducked: boolean }[] = [];
  const audio = silentAudio();
  audio.setMusicState = (mix) => mixes.push(mix);
  const state = makePlayState('coast_walk', false, { kind: 'start' }, audio);
  const enemy = state.enemies[0];
  assert.ok(enemy);
  enemy.x = state.player.x + 20;
  enemy.y = state.player.y;

  (state as unknown as { syncMusicState(dt: number): void }).syncMusicState(1 / 60);
  assert.deepEqual(mixes[mixes.length - 1], { intensity: 1, ducked: false });

  state.overlay = 'ability';
  (state as unknown as { syncMusicState(dt: number): void }).syncMusicState(1 / 60);
  assert.deepEqual(mixes[mixes.length - 1], { intensity: 1, ducked: true });
});

test('the guardian switches from hangar ambience to boss music only when awakened', () => {
  const songs: (MusicCue | -1)[] = [];
  const stingers: string[] = [];
  const audio = silentAudio();
  audio.playSong = (cue) => songs.push(cue);
  audio.playStinger = (kind) => stingers.push(kind);
  const state = makePlayState('hangar_boss', false, { kind: 'start' }, audio);
  assert.ok(state.boss);
  state.player.x = state.boss.x - 100;

  state.update(1 / 60);

  assert.equal(state.boss.state, 'intro');
  assert.deepEqual(songs, ['boss']);
  assert.deepEqual(stingers, ['bossAwaken']);
});

// 静态校验证明房间数据自洽,但证明不了房间能真的跑起来。
// 这里把全部房间各推进若干帧,任何构造或每帧逻辑抛错都会在这里暴露。
test('every room instantiates and simulates without throwing', () => {
  const world = new WorldState();
  for (const ability of ['paper', 'cling', 'djump', 'dash', 'kanami'] as Ability[]) world.grant(ability);

  for (const room of ROOM_LIST) {
    const engine = {
      world,
      input: { pressed: () => false, down: () => false },
      audio: silentAudio(),
      persistWorld: () => undefined,
      startRoom: () => undefined,
      respawnAtBench: () => undefined,
      showTitle: () => undefined,
    } as unknown as Engine;

    let state: PlayState;
    try {
      state = new PlayState(engine, room.id, { kind: 'start' });
    } catch (error) {
      assert.fail(`${room.id} 构造失败: ${String(error)}`);
    }
    for (let frame = 0; frame < 12; frame++) {
      try {
        state.update(1 / 60);
      } catch (error) {
        assert.fail(`${room.id} 第 ${frame} 帧更新失败: ${String(error)}`);
      }
    }
    // 玩家出生点必须站在房间内,而不是从地图外坠落。
    assert.ok(state.player.y <= state.mapH + 50, `${room.id} 出生后立刻坠出地图`);
  }
});

test('the warden barrier seals the wing altar until the guard is defeated', () => {
  const state = makePlayState('sky_wing');
  // 屏障未解封时是实体砖:能力祭坛所在的壁龛真的进不去。
  assert.equal(state.tileAt(41, 12), T_SOLID);
  assert.ok(state.boss, '弦翼圣所应当有守卫');
  assert.equal(state.boss?.kind, 'warden');

  state.world.flags.add('boss:warden');
  assert.equal(state.tileAt(41, 12), T_EMPTY);
});

test('defeating the warden opens the barrier and never triggers the ending', () => {
  const state = makePlayState('sky_wing');
  const boss = state.boss;
  assert.ok(boss);
  boss.awaken(state);
  // 直接打空血量,走真实的死亡流程。
  boss.hit(boss.maxHp + 100, state);
  for (let i = 0; i < 400 && boss.state !== 'dead'; i++) state.update(1 / 60);

  assert.equal(boss.state, 'dead', '守卫应当在数秒内完成死亡演出');
  assert.ok(state.world.flags.has('boss:warden'), '击败守卫应写入旗标');
  assert.equal(state.tileAt(41, 12), T_EMPTY, '屏障应当解封');
  assert.equal(state.gate.active, false, '中 Boss 不应开启通关门');
  assert.equal(state.world.cleared, false, '中 Boss 不应判定通关');
  assert.equal(state.overlay, 'none', '中 Boss 不应弹出通关覆盖层');
});

test('the hound tracks the player through paper form; other enemies do not', () => {
  const hound = new Enemy('hound', 100, 208);
  const patrol = new Enemy('patrol', 100, 208);
  // 玩家就在附近,但处于纸片形态。
  const world = {
    time: 0,
    mapW: 800,
    mapH: 272,
    playerX: 160,
    playerY: 200,
    playerPaper: true,
    particles: { spawn: () => undefined, burst: () => undefined },
    rectHitsSolid: () => false,
    hasGroundAt: () => true,
    fireEnemyBullet: () => undefined,
    sfx: () => undefined,
    shake: () => undefined,
    spawnEnemy: () => undefined,
  } as unknown as Parameters<Enemy['update']>[1];

  hound.update(1 / 60, world);
  patrol.update(1 / 60, world);

  assert.ok(hound.lungeT > 0, '逆弦犬应当对纸片形态起手嗅探');
  assert.equal(patrol.shootT > 0, true, '巡逻兵不应对纸片形态开火');
});

test('the leech only drops when the player is actually underneath it', () => {
  const leech = new Enemy('leech', 100, 100);
  const base = {
    time: 0, mapW: 800, mapH: 272, playerY: 240, playerPaper: false,
    particles: { spawn: () => undefined, burst: () => undefined },
    rectHitsSolid: () => false, hasGroundAt: () => false,
    fireEnemyBullet: () => undefined, sfx: () => undefined,
    shake: () => undefined, spawnEnemy: () => undefined,
  };

  // 远处经过:不该脱落,否则伏击一次就报废。
  leech.update(1 / 60, { ...base, playerX: 300 } as unknown as Parameters<Enemy['update']>[1]);
  assert.equal(leech.leechPhase, 'hang');

  // 走到正下方:脱落。
  leech.update(1 / 60, { ...base, playerX: 104 } as unknown as Parameters<Enemy['update']>[1]);
  assert.equal(leech.leechPhase, 'drop');
});

test('pause never fires a destructive action without confirmation', () => {
  // 旧版把「回到信标」绑在 shoot(J / 手柄 X 与 RT)、「返回标题」绑在 skill(L / Y)上,
  // 且没有确认 —— 战斗中一暂停,拇指还搭在 RT 上就会被瞬间传走。
  const pressed = new Set<string>();
  let respawned = 0;
  let toTitle = 0;
  const state = makePlayStateWithInput(
    'coast_shrine',
    (action) => pressed.has(action),
    { respawnAtBench: () => { respawned++; }, showTitle: () => { toTitle++; } },
  );

  pressed.clear(); pressed.add('pause');
  state.update(1 / 60);
  assert.equal(state.overlay, 'pause');

  // 战斗键在暂停菜单里必须完全无效。
  pressed.clear(); pressed.add('shoot');
  state.update(1 / 60);
  pressed.clear(); pressed.add('skill');
  state.update(1 / 60);
  assert.equal(respawned, 0, 'shoot 不该触发回信标');
  assert.equal(toTitle, 0, 'skill 不该触发返回标题');
  assert.equal(state.overlay, 'pause');

  // 走到「回到信标」并确认一次:只进入确认态,不执行。
  pressed.clear(); pressed.add('down');
  state.update(1 / 60);
  state.update(1 / 60);
  assert.equal(state.pauseSel, 2);
  pressed.clear(); pressed.add('confirm');
  state.update(1 / 60);
  assert.equal(state.pauseConfirm, 'bench');
  assert.equal(respawned, 0, '第一次确认只应弹出确认框');

  // 再确认一次才真的执行。
  pressed.clear(); pressed.add('confirm');
  state.update(1 / 60);
  assert.equal(respawned, 1);
});

test('pause can back out of a confirmation without losing progress', () => {
  const pressed = new Set<string>();
  let respawned = 0;
  const state = makePlayStateWithInput(
    'coast_shrine',
    (action) => pressed.has(action),
    { respawnAtBench: () => { respawned++; } },
  );
  pressed.clear(); pressed.add('pause');
  state.update(1 / 60);
  pressed.clear(); pressed.add('down');
  state.update(1 / 60);
  state.update(1 / 60);
  pressed.clear(); pressed.add('confirm');
  state.update(1 / 60);
  assert.equal(state.pauseConfirm, 'bench');

  // Esc 只取消确认,菜单还在。
  pressed.clear(); pressed.add('pause');
  state.update(1 / 60);
  assert.equal(state.pauseConfirm, null);
  assert.equal(state.overlay, 'pause');
  assert.equal(respawned, 0);
});

// ---------------- 弦闪(能力 flash) ----------------

test('a last-instant paper entry flashes the bullet and charges the next attack', () => {
  const state = makePlayState('coast_start');
  state.world.grant('paper');
  state.world.grant('flash');
  const p = state.player;
  p.energy = 50;
  (p as unknown as { stringMode: string }).stringMode = 'ground';
  p.paperEnterT = 0.05;
  state.enemyBullets.push({
    x: p.centerX(), y: p.centerY(), vx: 0, vy: 0, r: 2.5, dmg: 8, life: 1, color: '#fff',
  });

  (state as unknown as { resolveCombat(): void }).resolveCombat();

  assert.ok(p.flashChargeT > 0, '精准弦化应触发弦闪充能');
  assert.equal(state.enemyBullets[0].flashed, true, '子弹应被标记,不能重复触发');
  assert.ok(p.energy > 50, '触发时应返还弦能');

  // 同一颗子弹第二次结算不再触发
  p.flashChargeT = 0;
  (state as unknown as { resolveCombat(): void }).resolveCombat();
  assert.equal(p.flashChargeT, 0);
});

test('flash does not trigger without the ability or outside the window', () => {
  const noAbility = makePlayState('coast_start');
  noAbility.world.grant('paper');
  const p1 = noAbility.player;
  (p1 as unknown as { stringMode: string }).stringMode = 'ground';
  p1.paperEnterT = 0.05;
  noAbility.enemyBullets.push({ x: p1.centerX(), y: p1.centerY(), vx: 0, vy: 0, r: 2.5, dmg: 8, life: 1, color: '#fff' });
  (noAbility as unknown as { resolveCombat(): void }).resolveCombat();
  assert.equal(p1.flashChargeT, 0, '未取得弦闪时不该触发');

  // 长按弦化挂机不算精准:窗口已过
  const late = makePlayState('coast_start');
  late.world.grant('paper');
  late.world.grant('flash');
  const p2 = late.player;
  (p2 as unknown as { stringMode: string }).stringMode = 'ground';
  p2.paperEnterT = 0.5;
  late.enemyBullets.push({ x: p2.centerX(), y: p2.centerY(), vx: 0, vy: 0, r: 2.5, dmg: 8, life: 1, color: '#fff' });
  (late as unknown as { resolveCombat(): void }).resolveCombat();
  assert.equal(p2.flashChargeT, 0, '窗口过期不该触发');
});

test('the flash charge empowers exactly one attack', () => {
  const state = makePlayState('coast_start');
  state.world.grant('paper');
  state.world.grant('flash');
  const p = state.player;
  p.flashChargeT = 3;

  const before = state.playerBullets.length;
  (p as unknown as { shoot(ps: unknown): void }).shoot(state);
  assert.equal(state.playerBullets.length, before + 1);
  const boosted = state.playerBullets[state.playerBullets.length - 1];
  assert.ok(boosted.dmg > 7, `强化弹伤害应高于基础 7,实际 ${boosted.dmg}`);
  assert.equal(p.flashChargeT, 0, '强化应在发射时被消费');

  (p as unknown as { shoot(ps: unknown): void }).shoot(state);
  const normal = state.playerBullets[state.playerBullets.length - 1];
  assert.equal(normal.dmg, 7);
});

// ---------------- 踏空蓄步(能力 skystep) ----------------

test('skystep grants a third jump that consumes a timed charge', () => {
  const pressed = new Set<string>();
  const held = new Set<string>();
  const engine = {
    world: new WorldState(),
    input: {
      pressed: (a: string) => pressed.has(a),
      down: (a: string) => held.has(a),
      lastDevice: 'keyboard' as const,
    },
    audio: silentAudio(),
    persistWorld: () => undefined,
    startRoom: () => undefined,
  } as unknown as Engine;
  const state = new PlayState(engine, 'coast_start', { kind: 'start' });
  state.enemies.length = 0;
  const p = state.player;
  state.world.grant('djump');
  state.world.grant('skystep');

  // 悬空并耗尽两段跳
  p.onGround = false;
  p.coyote = 0;
  p.jumpsUsed = 2;
  p.y = 120;
  p.vy = 100;

  pressed.add('jump');
  state.update(1 / 60);
  pressed.clear();

  assert.ok(p.vy < 0, '第三跳应给出向上速度');
  assert.ok(p.skystepCdT > 5, '虚步应进入约 6 秒充能');

  // 充能未满:再按无效
  p.vy = 100;
  pressed.add('jump');
  state.update(1 / 60);
  pressed.clear();
  assert.ok(p.vy > 0, '充能中不该再次触发');

  // 先耗尽跳跃缓冲(0.12 秒),否则上一步按下的跳跃会在充能就绪的瞬间被兑现 ——
  // 那是缓冲系统的正确行为,但这里要验证的是"计时归零"本身。
  for (let i = 0; i < 10; i++) state.update(1 / 60);

  // 充能按时间恢复(空中同样计时)
  p.skystepCdT = 0.02;
  state.update(1 / 60);
  state.update(1 / 60);
  assert.equal(p.skystepCdT, 0, '计时应归零就绪');
});

test('without the skystep ability the third jump never fires', () => {
  const pressed = new Set<string>();
  const engine = {
    world: new WorldState(),
    input: {
      pressed: (a: string) => pressed.has(a),
      down: () => false,
      lastDevice: 'keyboard' as const,
    },
    audio: silentAudio(),
    persistWorld: () => undefined,
    startRoom: () => undefined,
  } as unknown as Engine;
  const state = new PlayState(engine, 'coast_start', { kind: 'start' });
  state.enemies.length = 0;
  const p = state.player;
  state.world.grant('djump');
  p.onGround = false;
  p.coyote = 0;
  p.jumpsUsed = 2;
  p.y = 120;
  p.vy = 100;

  pressed.add('jump');
  state.update(1 / 60);

  assert.ok(p.vy > 0, '未取得踏空蓄步时两段跳耗尽后不该再跳');
});

// ---------------- 镜弦猎兵(stringer) ----------------

function stringerWorld(px: number, py: number) {
  return {
    time: 0, mapW: 800, mapH: 272,
    playerX: px, playerY: py, playerPaper: false,
    particles: { spawn: () => undefined, burst: () => undefined },
    rectHitsSolid: () => false,
    hasGroundAt: (_x: number, y: number) => y >= 200,
    fireEnemyBullet: () => undefined,
    sfx: () => undefined, shake: () => undefined, spawnEnemy: () => undefined,
  } as unknown as Parameters<Enemy['update']>[1];
}

test('the stringer relocates across the player when pressured and staggers on unfurl', () => {
  const e = new Enemy('stringer', 300, 208);
  const w = stringerWorld(340, 200);

  // 连挨三下 → 触发弦化换位
  e.hit(5, 0, w); e.hit(5, 0, w); e.hit(5, 0, w);
  e.update(1 / 60, w);
  assert.ok(e.travelT >= 0, '受压后应进入弦化行程');
  assert.equal(e.intangible, true, '行程中应不可触碰');

  // 行程中 hit 无效
  const hpBefore = e.hp;
  e.hit(99, 0, w);
  assert.equal(e.hp, hpBefore, '行程中不该吃到伤害');

  // 走完行程(0.55 秒)→ 展弦失衡
  for (let i = 0; i < 40 && e.travelT >= 0; i++) e.update(1 / 60, w);
  assert.equal(e.travelT, -1, '行程应结束');
  assert.ok(e.unfurlT > 0, '落位后应进入展弦失衡');
  assert.ok(e.x > 340, '应换位到玩家另一侧');

  // 失衡窗口吃 1.6 倍伤害
  const hp2 = e.hp;
  e.hit(10, 0, w);
  assert.equal(hp2 - e.hp, 16, '展弦期间应吃 1.6 倍伤害');
});

test('the stringer holds its ground while the pressure threshold is not met', () => {
  const e = new Enemy('stringer', 300, 208);
  const w = stringerWorld(500, 200); // 远距离,也没有受压
  e.update(1 / 60, w);
  assert.equal(e.travelT, -1, '无压力时不该换位');
});

// ---------------- 弦相审判(arbiter) ----------------

test('the arbiter guards the skystep shrine behind a boss gate', () => {
  const state = makePlayState('choir_organ');
  assert.ok(state.boss, '巨管风琴应有审判者');
  assert.equal(state.boss?.kind, 'arbiter');
  // 壁龛被屏障封住
  assert.equal(state.tileAt(38, 12), T_SOLID);
  state.world.flags.add('boss:arbiter');
  assert.equal(state.tileAt(38, 12), T_EMPTY);
});

test('planar sweeps hurt only the paper form; volumetric blooms are bullets', () => {
  const state = makePlayState('choir_organ');
  const boss = state.boss;
  assert.ok(boss);
  const arbiter = boss as unknown as {
    sweeps: { x: number; dir: number; hit: boolean }[];
    update(dt: number, w: unknown): void;
  };
  const p = state.player;
  boss.awaken(state);

  // 手动放一道波纹压到玩家位置
  arbiter.sweeps.push({ x: p.centerX() - 2, dir: 1, hit: false });

  // 3D 形态:波纹穿过,毫发无伤
  const hp3d = p.hp;
  arbiter.update(1 / 60, state);
  assert.equal(p.hp, hp3d, '普通形态不该被平面相击中');

  // 纸片形态:被结算
  (p as unknown as { stringMode: string }).stringMode = 'ground';
  p.invuln = 0;
  arbiter.sweeps.length = 0;
  arbiter.sweeps.push({ x: p.centerX() - 2, dir: 1, hit: false });
  arbiter.update(1 / 60, state);
  assert.ok(p.hp < hp3d, '纸片形态应被平面相击中');
});

test('defeating the arbiter unseals the gate without ending the game', () => {
  const state = makePlayState('choir_organ');
  const boss = state.boss;
  assert.ok(boss);
  boss.awaken(state);
  boss.hit(boss.maxHp + 50, state);
  for (let i = 0; i < 400 && boss.state !== 'dead'; i++) state.update(1 / 60);

  assert.equal(boss.state, 'dead');
  assert.ok(state.world.flags.has('boss:arbiter'), '击败应写入旗标');
  assert.equal(state.tileAt(38, 12), T_EMPTY, '屏障应解封');
  assert.equal(state.world.cleared, false, '可选 Boss 不该判定通关');
  assert.equal(state.overlay, 'none');
});

// ---------------- 弦镜偏转(#43) ----------------

test('a papered player on the mirror socket bends the beam and charges the receiver', () => {
  const state = makePlayState('lab_observation');
  state.world.grant('paper');
  const p = state.player;
  const socket = state.mechanics.mirrorSockets[0];
  const receiver = state.mechanics.receivers[0];
  assert.ok(socket && receiver, '观察廊应装有弦镜机器');

  // 站上节点并弦化
  p.x = socket.x;
  p.y = socket.y;
  (p as unknown as { stringMode: string }).stringMode = 'ground';

  for (let i = 0; i < 30; i++) state.mechanics.updateBeams(1 / 60);
  assert.ok(receiver.charge > 0.3, `接收器应在充能,实际 ${receiver.charge}`);
  assert.ok(state.mechanics.beams.some((b) => b.bent), '能束应发生折转');

  // 充满 → 点亮 → 隐藏平台显形
  receiver.charge = 0.999;
  state.mechanics.updateBeams(1 / 60);
  assert.ok(receiver.litT > 0, '满充应点亮接收器');
  state.mechanics.updateBeams(1 / 60);
  assert.equal(state.tileAt(35, 4), T_SOLID, '点亮期间隐藏平台应显形');
});

test('the beam passes straight when the player is not papered on the socket', () => {
  const state = makePlayState('lab_observation');
  state.world.grant('paper');
  const p = state.player;
  const socket = state.mechanics.mirrorSockets[0];
  const receiver = state.mechanics.receivers[0];

  // 站在节点上但保持 3D:不折转
  p.x = socket.x;
  p.y = socket.y;
  for (let i = 0; i < 30; i++) state.mechanics.updateBeams(1 / 60);
  assert.equal(receiver.charge, 0, '普通形态不该折转能束');
  assert.ok(state.mechanics.beams.every((b) => !b.bent));
  assert.equal(state.tileAt(35, 4), T_EMPTY, '隐藏平台应保持隐藏');
});
