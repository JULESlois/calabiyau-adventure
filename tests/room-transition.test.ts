import assert from 'node:assert/strict';
import test from 'node:test';
import { DT, TILE, VIEW_H, VIEW_W } from '../src/game/constants';
import type { Engine } from '../src/game/Engine';
import { parseRows, T_MEMBRANE, T_ONEWAY, T_SOLID } from '../src/game/levels/levels';
import { PlayState, roomTransitionMix, type SceneContinuity } from '../src/game/states/PlayState';
import { transitionOffsets } from '../src/game/states/RoomTransitionState';
import { ROOMS, ROOM_LIST } from '../src/game/world/world';
import { WorldState } from '../src/game/world/WorldState';

function makeEngine(): Engine {
  return {
    world: new WorldState(),
    input: { down: () => false, pressed: () => false },
    audio: {
      sfx: () => undefined,
      playSong: () => undefined,
      playStinger: () => undefined,
      setMusicState: () => undefined,
    },
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
      portalScreenX: VIEW_W,
      portalScreenY: 14 * TILE,
      playerPortalOffsetX: 0,
      playerPortalOffsetY: 0,
      time: 18.5,
      vx: 73,
      vy: -41,
      facing: 1,
      stringMode: 'glide',
      onGround: false,
      jumpsUsed: 1,
      coyote: 0,
      airDashed: false,
      dashT: 0,
      dashCdT: 0,
    },
  });

  assert.equal(state.camX + state.backdropOffsetX, 912);
  assert.equal(state.camY + state.backdropOffsetY, 64);
  assert.equal(state.time, 18.5);
  assert.equal(state.player.vx, 73);
  assert.equal(state.player.vy, -41);
  assert.equal(state.player.stringMode, 'glide');
});

test('horizontal door entry keeps the portal floor and grounded player at the same screen height', () => {
  const scene = {
    backdropX: 912,
    backdropY: 64,
    time: 18.5,
    vx: 73,
    vy: 0,
    facing: 1,
    stringMode: 'normal',
    portalScreenX: VIEW_W,
    portalScreenY: 14 * TILE,
    playerPortalOffsetX: 0,
    playerPortalOffsetY: 0,
    onGround: true,
    jumpsUsed: 0,
    coyote: 0.09,
    airDashed: false,
    dashT: 0,
    dashCdT: 0.2,
  } as SceneContinuity;
  const state = new PlayState(makeEngine(), 'coast_tideworks', {
    kind: 'door',
    fromRoom: 'coast_underpier',
    ex: 3,
    ey: 10,
    fromSide: 'right',
    scene,
  });

  assert.equal(state.player.y - state.camY, scene.portalScreenY);
  assert.equal(state.player.onGround, true);
  assert.equal(state.player.dashCdT, 0.2);

  const beforeSettle = state.player.y - state.camY;
  state.update(DT);
  const afterSettle = state.player.y - state.camY;
  assert.ok(Math.abs(afterSettle - beforeSettle) <= 3.01, `${beforeSettle} -> ${afterSettle}`);
});

test('down door entry preserves the player horizontal offset inside the chute', () => {
  const scene = {
    backdropX: 240,
    backdropY: 270,
    time: 4,
    vx: 0,
    vy: 240,
    facing: 1,
    stringMode: 'ground',
    portalScreenX: VIEW_W / 2,
    portalScreenY: VIEW_H,
    playerPortalOffsetX: 5,
    playerPortalOffsetY: 24,
    onGround: false,
    jumpsUsed: 1,
    coyote: 0,
    airDashed: true,
    dashT: 0,
    dashCdT: 0.3,
  } as SceneContinuity;
  const state = new PlayState(makeEngine(), 'pass_coast_tide_drop', {
    kind: 'door',
    fromRoom: 'coast_walk',
    ex: 4,
    ey: 4,
    fromSide: 'down',
    scene,
  });

  assert.equal(state.player.x - state.camX, scene.portalScreenX + scene.playerPortalOffsetX);
  assert.equal(state.player.jumpsUsed, 1);
  assert.equal(state.player.airDashed, true);
});

test('paired horizontal doors have an immediate shared floor and supported target landing', () => {
  const supports = (tile: number) => tile === T_SOLID || tile === T_ONEWAY || tile === T_MEMBRANE;

  for (const room of ROOM_LIST) {
    const level = parseRows(room.rows);
    for (const exit of room.exits) {
      if (exit.side === 'down') continue;
      const boundaryCol = exit.side === 'left' ? 0 : level.w - 1;
      const floorRow = exit.to + 1;
      assert.ok(
        floorRow < level.h && supports(level.tiles[floorRow * level.w + boundaryCol]),
        `${room.id} ${exit.side} portal has no immediate floor at row ${floorRow}`,
      );

      const target = ROOMS[exit.target];
      const reverseSide = exit.side === 'left' ? 'right' : 'left';
      const reverse = target.exits.find((candidate) => candidate.side === reverseSide && candidate.target === room.id);
      assert.ok(reverse, `${room.id} -> ${target.id} has no paired portal`);
      assert.equal(exit.ey, reverse.to, `${room.id} -> ${target.id} lands on a different floor`);
    }
  }
});

test('ordinary room changes do not enqueue room-name toasts, while region entry keeps its banner', () => {
  const sameZone = new PlayState(makeEngine(), 'coast_walk', {
    kind: 'door',
    fromRoom: 'coast_start',
    ex: 3,
    ey: 13,
    fromSide: 'right',
  });
  const regionEntry = new PlayState(makeEngine(), 'lab_lift', {
    kind: 'door',
    fromRoom: 'pass_coast_lab_upper',
    ex: 3,
    ey: 13,
    fromSide: 'right',
  });

  assert.equal((sameZone as unknown as { toasts: unknown[] }).toasts.length, 0);
  assert.equal(sameZone.introT, 0);
  assert.equal(regionEntry.introT, 2.8);
});
