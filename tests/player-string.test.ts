import assert from 'node:assert/strict';
import test from 'node:test';
import { DT, GLIDE_FALL_SPEED } from '../src/game/constants';
import { Player } from '../src/game/entities/Player';
import type { Action } from '../src/game/Input';
import { T_EMPTY, T_SOLID } from '../src/game/levels/levels';
import { PlayState } from '../src/game/states/PlayState';
import type { Ability } from '../src/game/world/world';

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

function makeState(abilities: Ability[] = []) {
  const input = new TestInput();
  const owned = new Set<Ability>(abilities);
  const state = {
    input,
    world: {
      has: (ability: Ability) => owned.has(ability),
      chips: new Set<string>(),
    },
    mapW: 480,
    mapH: 270,
    tileAt: (col: number, row: number) => (col === 2 && row >= 0 && row <= 12 ? T_SOLID : T_EMPTY),
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
  return { input, owned, state };
}

test('E cannot attach to a wall before Matrix Adaptation is unlocked', () => {
  const player = new Player(26.5, 100);
  const { input, state } = makeState(['paper']);
  input.justPressed.add('wall');

  player.update(DT, state);

  assert.equal(player.stringMode, 'normal');
  assert.equal(player.clingDir, 0);
});

test('E attaches to a wall, allows vertical movement and toggles off', () => {
  const player = new Player(26.5, 100);
  const { input, state } = makeState(['paper', 'cling']);
  input.justPressed.add('wall');
  player.update(DT, state);

  assert.equal(player.stringMode, 'wall');
  assert.equal(player.clingDir, 1);

  input.justPressed.clear();
  input.held.add('up');
  const beforeY = player.y;
  player.update(DT, state);
  assert.ok(player.y < beforeY);

  input.held.clear();
  input.justPressed.add('wall');
  player.update(DT, state);
  assert.equal(player.stringMode, 'normal');
  assert.equal(player.clingDir, 0);
});

test('Shift selects separate ground stringification and airborne glide modes', () => {
  const { input, state } = makeState(['paper']);

  const grounded = new Player(120, 100);
  grounded.onGround = true;
  input.held.add('paper');
  grounded.update(DT, state);
  assert.equal(grounded.stringMode, 'ground');

  const airborne = new Player(120, 80);
  airborne.onGround = false;
  airborne.vy = 120;
  airborne.update(DT, state);
  assert.equal(airborne.stringMode, 'glide');
  assert.ok(airborne.vy <= GLIDE_FALL_SPEED);

  input.held.clear();
  airborne.update(DT, state);
  assert.equal(airborne.stringMode, 'normal');
});

test('enemy bullets preserve their owner for Michele passive marking', () => {
  const owner = { id: 'enemy' };
  const fakeState = { enemyBullets: [] } as unknown as PlayState;

  PlayState.prototype.fireEnemyBullet.call(fakeState, 1, 2, 3, 4, 5, '#fff', 2, owner);

  assert.equal(fakeState.enemyBullets.length, 1);
  assert.equal(fakeState.enemyBullets[0].owner, owner);
});
