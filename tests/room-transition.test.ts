import assert from 'node:assert/strict';
import test from 'node:test';
import { TILE, VIEW_H, VIEW_W } from '../src/game/constants';
import type { Engine } from '../src/game/Engine';
import { PlayState, roomTransitionMix } from '../src/game/states/PlayState';
import { transitionOffsets } from '../src/game/states/RoomTransitionState';
import { ROOMS, ROOM_LIST } from '../src/game/world/world';
import { WorldState } from '../src/game/world/WorldState';

function makeEngine(): Engine {
  return {
    world: new WorldState(),
    input: { pressed: () => false },
    audio: { sfx: () => undefined },
    persistWorld: () => undefined,
  } as unknown as Engine;
}

test('camera slide offsets tile old and new rooms without a gap', () => {
  assert.deepEqual(transitionOffsets('right', 0.5), {
    oldX: -VIEW_W / 2,
    oldY: 0,
    nextX: VIEW_W / 2,
    nextY: 0,
  });
  assert.deepEqual(transitionOffsets('left', 1), { oldX: VIEW_W, oldY: 0, nextX: 0, nextY: 0 });
  assert.deepEqual(transitionOffsets('down', 0.25), {
    oldX: 0,
    oldY: -VIEW_H / 4,
    nextX: 0,
    nextY: VIEW_H * 0.75,
  });
});

test('all nine cross-zone borders are routed through transition rooms', () => {
  const passages = ROOM_LIST.filter((room) => room.transition);
  assert.equal(passages.length, 9);

  for (const room of ROOM_LIST) {
    for (const exit of room.exits) {
      const target = ROOMS[exit.target];
      if (target.zone === room.zone) continue;
      const bridge = room.transition ? room : target.transition ? target : null;
      assert.ok(bridge?.transition, `${room.id} -> ${target.id}`);
      assert.deepEqual(new Set([bridge.zone, bridge.transition.to]), new Set([room.zone, target.zone]));
    }
  }
});

test('transition room colour mix reaches the correct region at either orientation', () => {
  const forward = ROOMS.pass_tide_lab;
  const reversed = ROOMS.pass_coast_lab_upper;
  const width = forward.rows[0].length * TILE;
  const height = forward.rows.length * TILE;

  assert.equal(roomTransitionMix(forward, 0, height / 2, width, height), 0);
  assert.equal(roomTransitionMix(forward, width, height / 2, width, height), 1);
  assert.equal(roomTransitionMix(reversed, 0, height / 2, width, height), 1);
  assert.equal(roomTransitionMix(reversed, width, height / 2, width, height), 0);

  const drop = ROOMS.pass_coast_tide_drop;
  const dropHeight = drop.rows.length * TILE;
  assert.equal(roomTransitionMix(drop, width / 2, 0, width, dropHeight), 0);
  assert.equal(roomTransitionMix(drop, width / 2, dropHeight, width, dropHeight), 1);
});

test('same-zone door entry preserves motion, animation time and backdrop coordinates', () => {
  const state = new PlayState(makeEngine(), 'coast_walk', {
    kind: 'door',
    fromRoom: 'coast_start',
    ex: 3,
    ey: 13,
    fromSide: 'right',
    scene: {
      backdropX: 912,
      backdropY: 64,
      time: 18.5,
      vx: 73,
      vy: -41,
      facing: 1,
      stringMode: 'glide',
    },
  });

  assert.equal(state.camX + state.backdropOffsetX, 912);
  assert.equal(state.camY + state.backdropOffsetY, 64);
  assert.equal(state.time, 18.5);
  assert.equal(state.player.vx, 73);
  assert.equal(state.player.vy, -41);
  assert.equal(state.player.stringMode, 'glide');
});
