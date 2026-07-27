import assert from 'node:assert/strict';
import test from 'node:test';
import { GAMEPAD_BUTTON_ACTIONS, KEYMAP } from '../src/game/Input';

test('keyboard keeps interaction, wall attachment and stringification separate', () => {
  assert.deepEqual(KEYMAP.KeyF, ['interact']);
  assert.deepEqual(KEYMAP.KeyE, ['wall']);
  assert.deepEqual(KEYMAP.ShiftLeft, ['paper']);
  assert.deepEqual(KEYMAP.ShiftRight, ['paper']);
  assert.ok(!KEYMAP.KeyW.includes('confirm'));
  assert.ok(!KEYMAP.KeyW.includes('interact'));
});

test('gamepad gameplay buttons do not combine conflicting actions', () => {
  assert.deepEqual(GAMEPAD_BUTTON_ACTIONS[1], ['melee']);
  assert.deepEqual(GAMEPAD_BUTTON_ACTIONS[4], ['wall']);
  assert.deepEqual(GAMEPAD_BUTTON_ACTIONS[5], ['dash']);
  assert.deepEqual(GAMEPAD_BUTTON_ACTIONS[6], ['paper']);
  assert.deepEqual(GAMEPAD_BUTTON_ACTIONS[8], ['map']);
  assert.deepEqual(GAMEPAD_BUTTON_ACTIONS[9], ['pause']);
  assert.deepEqual(GAMEPAD_BUTTON_ACTIONS[11], ['interact']);
  assert.deepEqual(GAMEPAD_BUTTON_ACTIONS[12], ['up']);
});
