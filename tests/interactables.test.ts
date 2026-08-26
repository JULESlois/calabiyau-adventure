// 可交互物注册表(路线图 2.0)。
//
// 这一层原本是 PlayState 里三串手排的 if 链:一串负责"按 F 做什么",
// 另两串负责"提示写什么、画在哪",靠一句注释约定三者同序。
// 实际上早已不同序 —— 信标在提示链里排第一、在检测链里排第三 ——
// 所以两者一旦重叠,提示会写「休息」而按下去开的是闸门。
// 现在三者住在同一条记录里,下面这组用例守的就是"提示与行为同源"这个不变量。
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Engine } from '../src/game/Engine';
import { PlayState, type Interactable } from '../src/game/states/PlayState';
import { WorldState } from '../src/game/world/WorldState';
import { rectsOverlap } from '../src/game/utils';

function makePlayState(roomId: string, world = new WorldState(), interact = false): PlayState {
  const engine = {
    world,
    input: {
      pressed: (action: string) => interact && action === 'interact',
      down: () => false,
      lastDevice: 'keyboard' as const,
    },
    audio: {
      sfx: () => undefined,
      playSong: () => undefined,
      playStinger: () => undefined,
      setMusicState: () => undefined,
    },
    persistWorld: () => undefined,
    startRoom: () => undefined,
    respawnAtBench: () => undefined,
    showTitle: () => undefined,
  } as unknown as Engine;
  return new PlayState(engine, roomId, { kind: 'start' });
}

type Probe = {
  collectInteractables(): Interactable[];
  updateInteractables(): void;
  interactionPromptLabel(): string;
  interactionPromptAnchor(): { x: number; y: number } | null;
  activeInteractable: Interactable | null;
};
const probe = (s: PlayState) => s as unknown as Probe;

// 覆盖多种可交互物的房间样本
const ROOMS_WITH_INTERACTABLES = [
  'coast_start', // 信标
  'coast_shrine', // 信标 + 能力祭坛
  'coast_beacon', // 捷径拉杆
  'lab_gate', // 商人
  'lab_matrix', // 能力祭坛
];

test('every interactable carries its own zone, label, anchor and behaviour', () => {
  for (const id of ROOMS_WITH_INTERACTABLES) {
    for (const item of probe(makePlayState(id)).collectInteractables()) {
      assert.ok(item.id, `${id}: 缺少 id`);
      assert.ok(item.zone.w > 0 && item.zone.h > 0, `${id}/${item.id}: 触发范围为空`);
      assert.ok(item.label.length > 0, `${id}/${item.id}: 没有提示文字`);
      assert.equal(typeof item.interact, 'function', `${id}/${item.id}: 没有行为`);
    }
  }
});

test('an anchor sits on the thing it points at, not somewhere else', () => {
  // 提示锚点与触发范围来自同一条记录,横向必须落在范围内 ——
  // 这条断言拦的是新增条目时把别人的坐标复制过来的手滑。
  for (const id of ROOMS_WITH_INTERACTABLES) {
    for (const item of probe(makePlayState(id)).collectInteractables()) {
      assert.ok(
        item.anchor.x >= item.zone.x && item.anchor.x <= item.zone.x + item.zone.w,
        `${id}/${item.id}: 锚点 x=${item.anchor.x} 落在触发范围之外`,
      );
    }
  }
});

test('the prompt always describes the interactable that would actually fire', () => {
  // 旧结构的核心缺陷:提示链与检测链各自排序,重叠时会各说各话。
  for (const id of ROOMS_WITH_INTERACTABLES) {
    const state = makePlayState(id);
    const p = probe(state);
    for (const item of p.collectInteractables()) {
      state.player.x = item.zone.x + item.zone.w / 2;
      state.player.y = item.zone.y + item.zone.h;
      p.updateInteractables();
      const active = p.activeInteractable;
      if (!active) continue; // 该条目被更高优先级的条目遮住,属正常
      assert.equal(p.interactionPromptLabel(), active.label, `${id}: 提示文字与生效条目不符`);
      assert.deepEqual(p.interactionPromptAnchor(), active.anchor, `${id}: 提示锚点与生效条目不符`);
    }
  }
});

test('the selected interactable is the first overlapping one in registry order', () => {
  const state = makePlayState('coast_shrine');
  const p = probe(state);
  const items = p.collectInteractables();
  const target = items[0];
  state.player.x = target.zone.x + target.zone.w / 2;
  state.player.y = target.zone.y + target.zone.h;
  p.updateInteractables();

  const pr = state.player.rect();
  const expected = items.find((i) => rectsOverlap(pr, i.zone));
  assert.equal(p.activeInteractable?.id, expected?.id, '应选中注册表中第一个重叠条目');
});

test('nothing is offered while the player is dead', () => {
  const state = makePlayState('coast_start');
  const p = probe(state);
  const bench = p.collectInteractables()[0];
  state.player.x = bench.zone.x + bench.zone.w / 2;
  state.player.y = bench.zone.y + bench.zone.h;
  state.player.dead = true;
  p.updateInteractables();
  assert.equal(p.activeInteractable, null);
  assert.equal(p.interactionPromptLabel(), '');
});

test('a beacon relabels itself from rest to travel once used', () => {
  const world = new WorldState();
  const state = makePlayState('coast_shrine', world, true);
  const p = probe(state);
  const bench = state.benches[0];
  assert.ok(bench);
  state.player.x = bench.x;
  state.player.y = bench.y;

  const labelFor = (id: string) => p.collectInteractables().find((i) => i.id.startsWith(id))?.label;
  assert.equal(labelFor('bench'), '休息');
  p.updateInteractables();
  assert.equal(bench.resting, true);
  assert.equal(labelFor('bench'), '传送', '休息之后同一条记录应改口为传送');
});

test('an opened shortcut leaves the registry entirely', () => {
  const world = new WorldState();
  const state = makePlayState('coast_beacon', world, true);
  const p = probe(state);
  const shortcut = state.mechanics.shortcuts[0];
  state.player.x = shortcut.lever.x;
  state.player.y = shortcut.lever.y;

  assert.ok(p.collectInteractables().some((i) => i.id === `shortcut:${shortcut.def.id}`));
  p.updateInteractables();
  assert.equal(world.shortcuts.has(shortcut.def.id), true);
  assert.equal(
    p.collectInteractables().some((i) => i.id === `shortcut:${shortcut.def.id}`),
    false,
    '已开启的闸门不该继续提供交互',
  );
});

test('a polarity terminal reports the action it is about to take', () => {
  const state = makePlayState('lab_maze');
  const p = probe(state);
  const terminal = () => p.collectInteractables().find((i) => i.id.startsWith('polarity:'));
  const before = terminal();
  if (!before) return; // 该房间没有极性终端时跳过
  const wasOpen = state.mechanics.polarityOpen;
  assert.equal(before.label, wasOpen ? '封锁极性膜' : '开放极性膜');
  before.interact();
  assert.equal(state.mechanics.polarityOpen, !wasOpen);
  assert.equal(terminal()!.label, wasOpen ? '开放极性膜' : '封锁极性膜', '提示应跟随状态翻转');
});

test('taking an ability removes its shrine from the registry', () => {
  const state = makePlayState('coast_shrine');
  const p = probe(state);
  const shrine = p.collectInteractables().find((i) => i.id.startsWith('ability:'));
  if (!shrine) return;
  shrine.interact();
  assert.equal(
    p.collectInteractables().some((i) => i.id === shrine.id),
    false,
    '取得后祭坛应从注册表消失',
  );
});
