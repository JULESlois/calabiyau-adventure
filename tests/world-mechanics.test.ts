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
