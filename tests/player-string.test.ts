import assert from 'node:assert/strict';
import test from 'node:test';
import { DT, GLIDE_FALL_SPEED, WALL_JUMP_VY } from '../src/game/constants';
import { Player } from '../src/game/entities/Player';
import type { Action } from '../src/game/Input';
import { T_EMPTY, T_SOLID } from '../src/game/levels/levels';
import { resolveGlideTilt } from '../src/game/render/sprites';
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

test('wall mode stays still without input, W/S only move vertically, and E wall-jumps away', () => {
  const player = new Player(26.5, 100);
  const { input, state } = makeState(['paper', 'cling']);
  input.justPressed.add('wall');
  player.update(DT, state);

  assert.equal(player.stringMode, 'wall');
  assert.equal(player.clingDir, 1);

  input.justPressed.clear();
  const idleY = player.y;
  for (let i = 0; i < 5; i++) player.update(DT, state);
  assert.equal(player.y, idleY);
  assert.equal(player.stringMode, 'wall');

  // W 在键盘映射中同时包含 up + jump；贴墙时必须只解释为向上移动。
  input.held.add('up');
  input.held.add('jump');
  input.justPressed.add('jump');
  const beforeY = player.y;
  player.update(DT, state);
  assert.ok(player.y < beforeY);
  assert.equal(player.stringMode, 'wall');
  assert.equal(player.clingDir, 1);

  input.held.clear();
  input.justPressed.clear();
  input.held.add('down');
  const beforeDownY = player.y;
  player.update(DT, state);
  assert.ok(player.y > beforeDownY);
  assert.equal(player.stringMode, 'wall');

  input.held.clear();
  input.justPressed.clear();
  input.justPressed.add('wall');
  player.update(DT, state);
  assert.equal(player.stringMode, 'normal');
  assert.equal(player.clingDir, 0);
  assert.ok(player.vx < 0);
  assert.ok(player.vy < -WALL_JUMP_VY * 0.75);
  assert.equal(player.facing, -1);
});

test('Shift only enables glide while airborne and never attaches to a nearby wall', () => {
  const { input, state } = makeState(['paper', 'cling']);

  const grounded = new Player(26.5, 100);
  grounded.onGround = true;
  input.held.add('paper');
  grounded.update(DT, state);
  assert.equal(grounded.stringMode, 'normal');
  assert.equal(grounded.clingDir, 0);

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

test('glide consumes jump input without triggering an extra airborne jump', () => {
  const { input, state } = makeState(['paper', 'djump']);
  const player = new Player(120, 80);
  player.vy = 120;
  player.jumpsUsed = 1;
  input.held.add('paper');
  input.held.add('jump');
  input.justPressed.add('jump');

  player.update(DT, state);

  assert.equal(player.stringMode, 'glide');
  assert.equal(player.jumpsUsed, 1);
  assert.equal(player.jumpBuffer, 0);
  assert.ok(player.vy >= 0);
  assert.ok(player.vy <= GLIDE_FALL_SPEED);
});

test('glide pose leans the character head toward the facing direction', () => {
  assert.ok(resolveGlideTilt(0, 0) > 0);
  assert.ok(resolveGlideTilt(GLIDE_FALL_SPEED, 0) > 0);
});

test('enemy bullets preserve their owner for Michele passive marking', () => {
  const owner = { id: 'enemy' };
  const fakeState = { enemyBullets: [] } as unknown as PlayState;

  PlayState.prototype.fireEnemyBullet.call(fakeState, 1, 2, 3, 4, 5, '#fff', 2, owner);

  assert.equal(fakeState.enemyBullets.length, 1);
  assert.equal(fakeState.enemyBullets[0].owner, owner);
});
