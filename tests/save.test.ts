import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWorldSave } from '../src/game/save';
import { WorldState, type WorldSave } from '../src/game/world/WorldState';

const validSave: WorldSave = {
  version: 2,
  abilities: ['paper', 'kanami'],
  flags: ['rescue:kanami'],
  crystals: ['coast_start:31:9'],
  visited: ['coast_start'],
  benchRoom: 'coast_start',
  char: 'kanami',
  cleared: false,
  dust: 80,
  chips: ['chip_hp'],
  hpMax: 125,
};

test('valid saves are normalized before deserialization', () => {
  const parsed = parseWorldSave({
    ...validSave,
    abilities: ['paper', 'paper', 'kanami'],
    visited: ['coast_start', 'coast_start'],
    hpMax: 9999,
  });

  assert.ok(parsed);
  assert.deepEqual(parsed.abilities, ['paper', 'kanami']);
  assert.deepEqual(parsed.visited, ['coast_start']);
  assert.equal(parsed.hpMax, 125);

  const world = WorldState.deserialize(parsed);
  assert.equal(world.char, 'kanami');
  assert.equal(world.hpMax, 125);
  assert.equal(world.dust, 80);
});

test('hidden relic chips persist and contribute their permanent stat bonus', () => {
  const parsed = parseWorldSave({
    ...validSave,
    chips: ['chip_hp', 'relic_beacon', 'relic_echo'],
    hpMax: 9999,
  });

  assert.ok(parsed);
  assert.equal(parsed.hpMax, 135);
  const world = WorldState.deserialize(parsed);
  assert.equal(world.hpMax, 135);
  assert.deepEqual([...world.chips], ['chip_hp', 'relic_beacon', 'relic_echo']);
});

test('invalid or partial v2 saves are rejected without throwing', () => {
  const invalidValues: unknown[] = [
    null,
    {},
    { version: 2, abilities: [], benchRoom: 'coast_start' },
    { ...validSave, abilities: ['unknown'] },
    { ...validSave, flags: [42] },
    { ...validSave, benchRoom: 'missing_room' },
    { ...validSave, char: 'unknown' },
    { ...validSave, cleared: 'false' },
    { ...validSave, dust: -1 },
    { ...validSave, chips: ['unknown_chip'] },
    { ...validSave, hpMax: Number.NaN },
  ];

  for (const value of invalidValues) {
    assert.doesNotThrow(() => parseWorldSave(value));
    assert.equal(parseWorldSave(value), null);
  }
});
