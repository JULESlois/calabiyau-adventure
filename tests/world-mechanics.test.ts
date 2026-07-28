import assert from 'node:assert/strict';
import test from 'node:test';
import type { Engine } from '../src/game/Engine';
import { T_EMPTY, T_MEMBRANE, T_SOLID } from '../src/game/levels/levels';
import { PlayState, type EntryInfo } from '../src/game/states/PlayState';
import { ABILITY_INFO, type Ability } from '../src/game/world/world';
import { WorldState } from '../src/game/world/WorldState';

function makePlayState(roomId: string, interact = false, entry: EntryInfo = { kind: 'start' }): PlayState {
  const engine = {
    world: new WorldState(),
    input: {
      pressed: (action: string) => interact && action === 'interact',
    },
    audio: { sfx: () => undefined },
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
