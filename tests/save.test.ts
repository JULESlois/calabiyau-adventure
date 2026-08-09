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
  activatedBeacons: ['coast_start'],
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
    activatedBeacons: ['coast_start', 'coast_start'],
    hpMax: 9999,
  });

  assert.ok(parsed);
  assert.deepEqual(parsed.abilities, ['paper', 'kanami']);
  assert.deepEqual(parsed.visited, ['coast_start']);
  assert.deepEqual(parsed.activatedBeacons, ['coast_start']);

  const world = WorldState.deserialize(parsed);
  assert.equal(world.char, 'kanami');
  // 被吹大的 hpMax 不会进入解析结果,由弦晶与芯片重新推导
  assert.equal(world.hpMax, 125);
  assert.equal(world.dust, 80);
  assert.deepEqual([...world.activatedBeacons], ['coast_start']);
});

test('legacy v2 saves migrate only the known respawn beacon into fast travel', () => {
  const { activatedBeacons: _omitted, ...legacySave } = validSave;
  const parsed = parseWorldSave({
    ...legacySave,
    visited: ['coast_start', 'coast_shrine', 'lab_gate'],
    benchRoom: 'coast_shrine',
  });

  assert.ok(parsed);
  assert.deepEqual(parsed.activatedBeacons, ['coast_start', 'coast_shrine']);
  const world = WorldState.deserialize(parsed);
  assert.equal(world.activatedBeacons.has('coast_shrine'), true);
  assert.equal(world.activatedBeacons.has('lab_gate'), false);
});

test('hidden relic chips persist and contribute their permanent stat bonus', () => {
  const parsed = parseWorldSave({
    ...validSave,
    chips: ['chip_hp', 'relic_beacon', 'relic_echo'],
    hpMax: 9999,
  });

  assert.ok(parsed);
  assert.equal(parsed.chips.length, 3);
  const world = WorldState.deserialize(parsed);
  assert.equal(world.hpMax, 135);
  assert.deepEqual([...world.chips], ['chip_hp', 'relic_beacon', 'relic_echo']);
});

test('permanent shortcuts and crystal milestone bonuses survive save normalization', () => {
  const crystals = Array.from({ length: 18 }, (_, i) => `test_room:${i}:0`);
  const parsed = parseWorldSave({
    ...validSave,
    crystals,
    shortcuts: ['beacon_lift', 'service_hatch'],
    hpMax: 9999,
  });

  assert.ok(parsed);
  assert.deepEqual(parsed.shortcuts, ['beacon_lift', 'service_hatch']);
  const world = WorldState.deserialize(parsed);
  assert.equal(world.shortcuts.has('beacon_lift'), true);
  assert.equal(world.shortcuts.has('service_hatch'), true);
  assert.equal(world.hpMax, 135);
  assert.equal(world.energyMax, 110);
});

test('tampered character and stale rooms are normalized by the parser itself', () => {
  const parsed = parseWorldSave({
    ...validSave,
    abilities: ['paper'],
    char: 'kanami',
    visited: ['coast_start', 'deleted_room'],
  });

  assert.ok(parsed);
  // 没有 kanami 能力就不能以 kanami 上场,已不存在的房间也不进地图
  assert.equal(parsed.char, 'michele');
  assert.deepEqual(parsed.visited, ['coast_start']);
  const world = WorldState.deserialize(parsed);
  assert.equal(world.char, 'michele');
  assert.deepEqual([...world.visited], ['coast_start']);
});

test('invalid or partial v2 saves are rejected without throwing', () => {
  const invalidValues: unknown[] = [
    null,
    {},
    { version: 2, abilities: [], benchRoom: 'coast_start' },
    { ...validSave, abilities: ['unknown'] },
    { ...validSave, flags: [42] },
    { ...validSave, benchRoom: 'missing_room' },
    { ...validSave, benchRoom: 'coast_walk' },
    { ...validSave, activatedBeacons: ['coast_walk'] },
    { ...validSave, activatedBeacons: [42] },
    { ...validSave, char: 'unknown' },
    { ...validSave, cleared: 'false' },
    { ...validSave, dust: -1 },
    { ...validSave, chips: ['unknown_chip'] },
    { ...validSave, shortcuts: ['unknown_shortcut'] },
    { ...validSave, hpMax: Number.NaN },
  ];

  for (const value of invalidValues) {
    assert.doesNotThrow(() => parseWorldSave(value));
    assert.equal(parseWorldSave(value), null);
  }
});
