import assert from 'node:assert/strict';
import test from 'node:test';
import { DASH_CD, DT, GLIDE_FALL_SPEED, TILE, WALL_JUMP_VY } from '../src/game/constants';
import { Player } from '../src/game/entities/Player';
import type { Action } from '../src/game/Input';
import { T_EMPTY, T_MEMBRANE, T_SOLID } from '../src/game/levels/levels';
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
      energyMax: 100,
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

  input.held.add('paper');
  input.justPressed.add('paper');
  for (let i = 0; i < 5; i++) {
    player.update(DT, state);
    input.justPressed.clear();
  }
  assert.equal(player.y, idleY);
  assert.equal(player.stringMode, 'wall');
  assert.equal(player.clingDir, 1);

  // W 在键盘映射中同时包含 up + jump；贴墙时必须只解释为向上移动。
  input.held.clear();
  input.justPressed.clear();
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

test('passive wall detachment stops climbing and restores normal width away from the wall', () => {
  const player = new Player(26.5, 128);
  const { input, state } = makeState(['paper', 'cling']);
  state.tileAt = (col: number, row: number) =>
    (col === 2 && row >= 3 && row < 8) || row === 8 ? T_SOLID : T_EMPTY;
  player.onGround = true;
  input.justPressed.add('wall');
  player.update(DT, state);

  assert.equal(player.stringMode, 'wall');
  assert.equal(player.x, 29);

  input.justPressed.clear();
  input.held.add('up');
  input.held.add('paper');
  let detached = false;
  for (let frame = 0; frame < 60; frame++) {
    const previousY = player.y;
    player.update(DT, state);
    const currentMode: string = player.stringMode;
    if (currentMode !== 'normal') continue;

    detached = true;
    assert.equal(player.clingDir, 0);
    assert.equal(player.x, 26.5);
    assert.ok(player.vy >= 0, `wall climb velocity leaked into normal mode: ${player.vy}`);
    assert.ok(player.y >= previousY, `player rose after leaving the wall: ${previousY} -> ${player.y}`);
    break;
  }
  assert.equal(detached, true);
});

test('losing wall contact ignores a same-frame W jump action', () => {
  const player = new Player(26.5, 100);
  const { input, state } = makeState(['paper', 'cling', 'djump']);
  let wallExists = true;
  state.tileAt = (col: number, row: number) => (wallExists && col === 2 && row <= 12 ? T_SOLID : T_EMPTY);
  input.justPressed.add('wall');
  player.update(DT, state);
  assert.equal(player.stringMode, 'wall');

  wallExists = false;
  input.justPressed.clear();
  input.held.add('up');
  input.held.add('jump');
  input.justPressed.add('jump');
  player.update(DT, state);

  assert.equal(player.stringMode, 'normal');
  assert.equal(player.jumpsUsed, 0);
  assert.equal(player.jumpBuffer, 0);
  assert.ok(player.vy >= 0);
});

test('running out of string energy on a wall cannot wedge the normal body into the wall', () => {
  for (const startX of [26.5, 53.5]) {
    const player = new Player(startX, 100);
    const { input, state } = makeState(['paper', 'cling']);
    input.justPressed.add('wall');
    player.update(DT, state);
    assert.equal(player.stringMode, 'wall');

    input.justPressed.clear();
    player.energy = 0;
    const previousY = player.y;
    player.update(DT, state);

    assert.equal(player.stringMode, 'normal');
    assert.equal(player.x, startX);
    assert.ok(player.y >= previousY, `collision recovery pushed the player upward: ${previousY} -> ${player.y}`);
    assert.equal(player.onGround, false);
  }
});

test('ending an airborne glide beside a wall restores normal width without climbing it', () => {
  for (const [startX, awayDir] of [
    [29.5, -1],
    [50.5, 1],
  ] as const) {
    const player = new Player(startX, 100);
    const { input, state } = makeState(['paper']);
    input.held.add('paper');
    input.justPressed.add('paper');
    player.update(DT, state);
    assert.equal(player.stringMode, 'glide');

    input.held.clear();
    input.justPressed.clear();
    const previousY = player.y;
    player.update(DT, state);

    assert.equal(player.stringMode, 'normal');
    assert.equal(Math.sign(player.x - startX), awayDir);
    assert.ok(player.y >= previousY, `collision recovery pushed the player upward: ${previousY} -> ${player.y}`);
    assert.equal(player.onGround, false);
  }
});

test('Shift selects ground stringification or airborne glide without attaching to a nearby wall', () => {
  const { input, state } = makeState(['paper', 'cling']);
  state.tileAt = (col: number, row: number) =>
    (col === 2 && row < 8) || row === 8 ? T_SOLID : T_EMPTY;

  const grounded = new Player(26.5, 8 * TILE);
  grounded.onGround = true;
  input.held.add('paper');
  grounded.update(DT, state);
  assert.equal(grounded.stringMode, 'ground');
  assert.equal(grounded.clingDir, 0);

  const airborne = new Player(120, 80);
  airborne.onGround = false;
  airborne.vy = 120;
  input.justPressed.add('paper');
  airborne.update(DT, state);
  assert.equal(airborne.stringMode, 'glide');
  assert.ok(airborne.vy <= GLIDE_FALL_SPEED);

  input.held.clear();
  input.justPressed.clear();
  airborne.update(DT, state);
  assert.equal(airborne.stringMode, 'normal');
});

test('holding ground stringification through a jump does not auto-enter glide or wall mode', () => {
  const { input, state } = makeState(['paper', 'cling']);
  state.tileAt = (col: number, row: number) =>
    (col === 2 && row < 8) || row === 8 ? T_SOLID : T_EMPTY;
  const player = new Player(26.5, 128);
  player.onGround = true;
  input.held.add('paper');
  player.update(DT, state);
  assert.equal(player.stringMode, 'ground');

  input.held.add('up');
  input.held.add('jump');
  input.justPressed.add('jump');
  player.update(DT, state);
  assert.equal(player.stringMode, 'normal');
  assert.equal(player.clingDir, 0);
  assert.ok(player.vy < 0);

  input.justPressed.clear();
  player.update(DT, state);
  assert.equal(player.stringMode, 'normal');
  assert.equal(player.clingDir, 0);

  input.held.clear();
  player.update(DT, state);
  input.held.add('paper');
  input.justPressed.add('paper');
  player.update(DT, state);
  assert.equal(player.stringMode, 'glide');
});

test('ground stringification becomes glide after losing floor support', () => {
  const { input, state } = makeState(['paper']);
  let hasFloor = true;
  state.tileAt = (_col: number, row: number) => (hasFloor && row === 8 ? T_SOLID : T_EMPTY);
  const player = new Player(120, 8 * TILE);
  player.onGround = true;
  input.held.add('paper');

  player.update(DT, state);
  assert.equal(player.stringMode, 'ground');

  hasFloor = false;
  player.update(DT, state);

  assert.equal(player.stringMode, 'glide');
  assert.ok(player.vy >= 0);
});

test('falling through a membrane hatch reuses glide movement', () => {
  const { input, state } = makeState(['paper']);
  state.tileAt = (_col: number, row: number) =>
    row >= 8 && row <= 10 ? T_MEMBRANE : T_EMPTY;
  const player = new Player(120, 8 * TILE);
  player.onGround = true;
  input.held.add('paper');

  const modes = new Set<string>();
  for (let frame = 0; frame < 120; frame++) {
    player.update(DT, state);
    modes.add(player.stringMode);
  }

  assert.ok(player.y > 11 * TILE, `player did not clear the membrane hatch: y=${player.y}`);
  assert.deepEqual([...modes], ['glide']);

  input.held.clear();
  player.update(DT, state);
  assert.equal(player.stringMode, 'normal');
});

test('pressing stringification one frame after jump does not amplify jump height', () => {
  const simulateApex = (paperFrame: number) => {
    const { input, state } = makeState(['paper']);
    state.tileAt = (_col: number, row: number) => (row >= 8 ? T_SOLID : T_EMPTY);
    const player = new Player(120, 8 * TILE);
    player.onGround = true;
    input.held.add('jump');
    input.justPressed.add('jump');

    let apex = player.y;
    let enteredGlide = false;
    for (let frame = 0; frame < 90; frame++) {
      if (frame === paperFrame) {
        input.held.add('paper');
        input.justPressed.add('paper');
      }
      player.update(DT, state);
      enteredGlide ||= player.stringMode === 'glide';
      apex = Math.min(apex, player.y);
      input.justPressed.clear();
      if (frame > 0 && player.vy >= 0) break;
    }
    return { apex, enteredGlide, jumpsUsed: player.jumpsUsed };
  };

  const normal = simulateApex(-1);
  const staggeredCombo = simulateApex(1);

  assert.equal(staggeredCombo.enteredGlide, true);
  assert.equal(staggeredCombo.jumpsUsed, 1);
  assert.ok(
    Math.abs(staggeredCombo.apex - normal.apex) <= 0.5,
    `normal apex ${normal.apex}, Shift+jump apex ${staggeredCombo.apex}`,
  );
});

test('glide consumes jump input without triggering an extra airborne jump', () => {
  const { input, state } = makeState(['paper', 'djump']);
  const player = new Player(120, 80);
  player.vy = 120;
  player.jumpsUsed = 1;
  input.held.add('paper');
  input.held.add('jump');
  input.justPressed.add('paper');
  input.justPressed.add('jump');

  player.update(DT, state);

  assert.equal(player.stringMode, 'glide');
  assert.equal(player.jumpsUsed, 1);
  assert.equal(player.jumpBuffer, 0);
  assert.ok(player.vy >= 0);
  assert.ok(player.vy <= GLIDE_FALL_SPEED);
});

test('hidden relics reduce glide drain and dash recovery without changing input rules', () => {
  const normal = makeState(['paper']);
  const relic = makeState(['paper']);
  relic.state.world.chips.add('relic_tide');
  const normalPlayer = new Player(120, 80);
  const relicPlayer = new Player(120, 80);
  for (const input of [normal.input, relic.input]) {
    input.held.add('paper');
    input.justPressed.add('paper');
  }
  normalPlayer.update(DT, normal.state);
  relicPlayer.update(DT, relic.state);
  const normalDrain = 100 - normalPlayer.energy;
  const relicDrain = 100 - relicPlayer.energy;
  assert.ok(relicDrain < normalDrain);
  assert.ok(Math.abs(relicDrain / normalDrain - 0.75) < 0.01);

  const dash = makeState(['dash']);
  dash.state.world.chips.add('relic_reactor');
  dash.input.justPressed.add('dash');
  const dashPlayer = new Player(120, 80);
  dashPlayer.onGround = true;
  dashPlayer.update(DT, dash.state);
  assert.equal(dashPlayer.dashCdT, DASH_CD * 0.6);
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
