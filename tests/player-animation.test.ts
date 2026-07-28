import assert from 'node:assert/strict';
import test from 'node:test';
import { DT } from '../src/game/constants';
import { Player } from '../src/game/entities/Player';
import type { Action } from '../src/game/Input';
import { T_EMPTY, T_SOLID } from '../src/game/levels/levels';
import { resolveAirMotionStage } from '../src/game/render/sprites';
import type { PlayState } from '../src/game/states/PlayState';

class TestInput {
  held = new Set<Action>();
  justPressed = new Set<Action>();

  down(action: Action): boolean {
    return this.held.has(action);
  }

  pressed(action: Action): boolean {
    return this.justPressed.has(action);
  }
}

function makeState(tileAt: (col: number, row: number) => number = () => T_EMPTY) {
  const input = new TestInput();
  const state = {
    input,
    world: {
      has: () => false,
      chips: new Set<string>(),
      energyMax: 100,
    },
    mapW: 480,
    mapH: 270,
    tileAt,
    sfx: () => undefined,
    shake: () => undefined,
    particles: {
      burst: () => undefined,
      spawn: () => undefined,
    },
    playerBullets: [],
    deployTurret: () => undefined,
    throwSonarDart: () => undefined,
  } as unknown as PlayState;
  return { input, state };
}

test('air motion resolves rise, apex and fall as separate animation stages', () => {
  assert.equal(resolveAirMotionStage(false, -300), 'ground');
  assert.equal(resolveAirMotionStage(true, -300), 'rise');
  assert.equal(resolveAirMotionStage(true, 0), 'apex');
  assert.equal(resolveAirMotionStage(true, 200), 'fall');
});

test('jumping starts the takeoff animation without changing jump physics', () => {
  const { input, state } = makeState();
  const player = new Player(120, 100);
  player.onGround = true;
  input.held.add('jump');
  input.justPressed.add('jump');

  player.update(DT, state);

  assert.ok(player.takeoffAnimT > 0);
  assert.equal(player.landingAnimT, 0);
  assert.ok(player.vy < 0);
  assert.equal(player.onGround, false);
});

test('a real downward impact starts one landing animation and normal ground contact does not refresh it', () => {
  const floor = (_col: number, row: number) => (row >= 8 ? T_SOLID : T_EMPTY);
  const { state } = makeState(floor);
  const player = new Player(120, 120);
  player.vy = 260;

  for (let i = 0; i < 8 && !player.onGround; i++) player.update(DT, state);

  assert.equal(player.onGround, true);
  assert.ok(player.landingAnimT > 0);
  const landingAfterImpact = player.landingAnimT;
  player.update(DT, state);
  assert.ok(player.landingAnimT < landingAfterImpact);
});

test('standing and walking stay grounded on the exact solid tile top every frame', () => {
  const floor = (_col: number, row: number) => (row >= 8 ? T_SOLID : T_EMPTY);

  for (const action of [null, 'right'] as const) {
    const { input, state } = makeState(floor);
    const player = new Player(120, 128);
    player.onGround = true;
    if (action) input.held.add(action);

    for (let frame = 0; frame < 12; frame++) {
      player.update(DT, state);
      assert.equal(player.y, 128, `${action ?? 'idle'} frame ${frame}: feet left the tile top`);
      assert.equal(player.vy, 0, `${action ?? 'idle'} frame ${frame}: vertical speed was not cleared`);
      assert.equal(player.onGround, true, `${action ?? 'idle'} frame ${frame}: ground state flickered`);
    }
  }
});

test('reversing direction at speed starts a short turning transition', () => {
  const floor = (_col: number, row: number) => (row >= 8 ? T_SOLID : T_EMPTY);
  const { input, state } = makeState(floor);
  const player = new Player(120, 128);
  player.onGround = true;
  player.vx = 120;
  player.facing = 1;
  input.held.add('left');

  player.update(DT, state);

  assert.equal(player.facing, -1);
  assert.ok(player.turnAnimT > 0);
});
