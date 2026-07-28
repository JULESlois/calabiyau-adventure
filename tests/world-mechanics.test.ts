import assert from 'node:assert/strict';
import test from 'node:test';
import type { Engine } from '../src/game/Engine';
import { T_EMPTY, T_MEMBRANE, T_SOLID } from '../src/game/levels/levels';
import { PlayState } from '../src/game/states/PlayState';
import { WorldState } from '../src/game/world/WorldState';

function makePlayState(roomId: string, interact = false): PlayState {
  const engine = {
    world: new WorldState(),
    input: {
      pressed: (action: string) => interact && action === 'interact',
    },
    audio: { sfx: () => undefined },
    persistWorld: () => undefined,
  } as unknown as Engine;
  return new PlayState(engine, roomId, { kind: 'start' });
}

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
