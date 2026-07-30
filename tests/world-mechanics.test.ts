import assert from 'node:assert/strict';
import test from 'node:test';
import type { Engine } from '../src/game/Engine';
import { T_EMPTY, T_MEMBRANE, T_SOLID } from '../src/game/levels/levels';
import { PlayState, type EntryInfo } from '../src/game/states/PlayState';
import type { MusicCue, MusicIntensity } from '../src/game/music';
import { ABILITY_INFO, type Ability } from '../src/game/world/world';
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
  const shortcut = state.shortcuts[0];
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

test('interacting with a beacon records it as activated before opening fast travel', () => {
  const state = makePlayState('coast_shrine', true);
  const beacon = state.benches[0];
  assert.ok(beacon);
  state.player.x = beacon.x;
  state.player.y = beacon.y;

  (state as unknown as { updateInteractables(): void }).updateInteractables();

  assert.equal(state.world.benchRoom, 'coast_shrine');
  assert.equal(state.world.activatedBeacons.has('coast_shrine'), true);
  assert.equal(state.overlay, 'fast_travel');
});

test('lab polarity terminals control only the dedicated polarity membrane', () => {
  const state = makePlayState('lab_observation');
  assert.equal(state.tileAt(39, 8), T_MEMBRANE);

  state.polarityOpen = true;
  assert.equal(state.tileAt(39, 8), T_EMPTY);
});

test('regional rooms instantiate their signature mechanics', () => {
  assert.equal(makePlayState('tide_entry').pressureJets.length, 1);
  assert.equal(makePlayState('choir_nave').resonators.length, 1);
  assert.equal(makePlayState('hangar_assembly').conveyors.length, 2);
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
