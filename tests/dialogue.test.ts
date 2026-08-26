// 对话系统与城镇成长(路线图 2.1 / 2.3)。
//
// 2.3 的设计要点是**零新进度系统**:谁在场、说什么,全部由已有的 world.flags 推出。
// 所以这一组用例的重点不是"对话框能不能画",而是"进度推进后世界是否真的变了"。
import assert from 'node:assert/strict';
import test from 'node:test';
import { DIALOGUE_CPS, DT } from '../src/game/constants';
import type { Engine } from '../src/game/Engine';
import {
  crystalsToNextMilestone,
  havenLiveliness,
  NPCS,
  NPC_MARKERS,
  npcById,
  presentNpcs,
} from '../src/game/npc';
import { pageLength } from '../src/game/render/dialogue';
import { PlayState, type Interactable } from '../src/game/states/PlayState';
import { CRYSTAL_MILESTONES, ROOM_LIST, totalCrystals } from '../src/game/world/world';
import { WorldState } from '../src/game/world/WorldState';

function makePlayState(
  roomId: string,
  world = new WorldState(),
  pressed: (a: string) => boolean = () => false,
): PlayState {
  const engine = {
    world,
    input: { pressed, down: () => false, lastDevice: 'keyboard' as const },
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
  dialogue: { pages: string[][]; page: number; revealed: number } | null;
};
const probe = (s: PlayState) => s as unknown as Probe;

// ---------------- NPC 定义表 ----------------

test('every NPC marker maps to a real NPC definition', () => {
  for (const [marker, id] of Object.entries(NPC_MARKERS)) {
    assert.ok(npcById(id), `生成符 ${marker} 指向不存在的 NPC ${id}`);
  }
  assert.equal(new Set(Object.values(NPC_MARKERS)).size, Object.keys(NPC_MARKERS).length, '生成符不应重复指向同一人');
});

test('NPC markers do not collide with terrain or existing spawn characters', () => {
  // 字符命名空间是这个项目反复强调的东西 —— 冲突了会静默毁掉房间数据
  const terrain = new Set('#=^%H&@!;:~|'.split(''));
  const existing = new Set('PTFWJGDSXYAECVLQ*heabcdg123456789RmnMNUBZ><IOKk'.split(''));
  for (const marker of Object.keys(NPC_MARKERS)) {
    assert.equal(terrain.has(marker), false, `${marker} 与地形符冲突`);
    assert.equal(existing.has(marker), false, `${marker} 与既有生成符冲突`);
  }
});

test('every NPC has speakable lines in every progress state', () => {
  const states: WorldState[] = [];
  const fresh = new WorldState();
  states.push(fresh);
  for (const flag of ['rescue:kanami', 'boss:warden', 'boss:arbiter', 'boss:gambit', 'boss:guardian']) {
    const w = new WorldState();
    w.flags.add(flag);
    states.push(w);
  }
  const done = new WorldState();
  for (const f of ['rescue:kanami', 'boss:warden', 'boss:arbiter', 'boss:gambit', 'boss:guardian']) done.flags.add(f);
  states.push(done);

  for (const npc of NPCS) {
    for (const world of states) {
      const pages = npc.lines(world);
      assert.ok(pages.length > 0, `${npc.name} 在某个进度下没有台词`);
      for (const page of pages) {
        assert.ok(page.length > 0, `${npc.name} 有空页`);
        assert.ok(pageLength(page) > 0, `${npc.name} 有空行页`);
      }
    }
  }
});

test('dialogue branches on world flags rather than a separate quest system', () => {
  const keeper = npcById('keeper')!;
  const before = keeper.lines(new WorldState());
  const after = new WorldState();
  after.grant('paper');
  const withPaper = keeper.lines(after);
  assert.notDeepEqual(before, withPaper, '取得弦化后灯塔守应改口');

  const cleared = new WorldState();
  cleared.grant('paper');
  cleared.flags.add('boss:guardian');
  assert.notDeepEqual(keeper.lines(cleared), withPaper, '通关后应再次改口');
});

test('the sheller reports the real distance to the next resonance', () => {
  const world = new WorldState();
  world.crystals.add('a:1:1');
  const left = crystalsToNextMilestone(world);
  assert.equal(left, CRYSTAL_MILESTONES[0].count - 1);
  const text = npcById('sheller')!.lines(world).flat().join('');
  assert.ok(text.includes(String(left)), '台词应引用真实的剩余枚数');
  assert.ok(text.includes(String(totalCrystals())), '台词应引用真实的弦晶总数');
});

// ---------------- 城镇成长(2.3) ----------------

test('town liveliness rises with existing flags and adds no new progress state', () => {
  const w = new WorldState();
  assert.equal(havenLiveliness(w), 0);
  w.flags.add('rescue:kanami');
  assert.equal(havenLiveliness(w), 1);
  w.flags.add('boss:warden');
  assert.equal(havenLiveliness(w), 2);
  w.flags.add('boss:gambit');
  assert.equal(havenLiveliness(w), 3);
  w.flags.add('boss:guardian');
  assert.equal(havenLiveliness(w), 4);
});

test('more people turn up as the adventure progresses', () => {
  const w = new WorldState();
  const at = () => presentNpcs(w).length;
  const lv0 = at();
  assert.ok(lv0 >= 1, '开场就该有人在,空城不是城');
  w.flags.add('rescue:kanami');
  assert.ok(at() > lv0, '救出香奈美后应多一个人');
  const lv1 = at();
  w.flags.add('boss:warden');
  assert.ok(at() > lv1, '击败守卫后应再多一个人');
});

test('absent NPCs are not spawned into the room at all', () => {
  const fresh = makePlayState('coast_beacon', new WorldState());
  const ids = (s: PlayState) =>
    probe(s).collectInteractables().filter((i) => i.id.startsWith('npc:')).map((i) => i.id);
  assert.deepEqual(ids(fresh), [], '进度未到时不该出现在场景里');

  const later = new WorldState();
  later.flags.add('rescue:kanami');
  assert.ok(ids(makePlayState('coast_beacon', later)).includes('npc:sheller'));
});

// ---------------- 对话推进 ----------------

test('talking to an NPC opens the dialogue overlay', () => {
  const state = makePlayState('coast_start');
  const npc = probe(state).collectInteractables().find((i) => i.id === 'npc:keeper');
  assert.ok(npc, '灯塔下应当站着灯塔守');
  assert.equal(npc!.label, '交谈');
  npc!.interact();
  assert.equal(state.overlay, 'dialogue');
  assert.ok(probe(state).dialogue);
});

test('the typewriter fills in over time, then confirm turns the page', () => {
  let press = false;
  const state = makePlayState('coast_start', new WorldState(), () => press);
  probe(state).collectInteractables().find((i) => i.id === 'npc:keeper')!.interact();
  const d = probe(state).dialogue!;
  const total = pageLength(d.pages[0]);
  assert.equal(d.revealed, 0);

  state.update(DT);
  assert.ok(d.revealed > 0 && d.revealed < total, '应逐字显示而不是一次放完');

  // 未放完时按确认 = 先补全本页,不翻页
  press = true;
  state.update(DT);
  assert.equal(d.revealed, total);
  assert.equal(d.page, 0, '第一次确认应补全本页,而不是跳过它');

  // 放完后再按才翻页
  state.update(DT);
  assert.equal(d.page, 1);
  assert.equal(d.revealed, 0);
});

test('confirming past the last page closes the dialogue and returns control', () => {
  const state = makePlayState('coast_start', new WorldState(), () => true);
  probe(state).collectInteractables().find((i) => i.id === 'npc:keeper')!.interact();
  const pages = probe(state).dialogue!.pages.length;

  // 每页最多两次确认(补全 + 翻页),留足余量
  for (let i = 0; i < pages * 3 + 4; i++) state.update(DT);

  assert.equal(state.overlay, 'none', '读完应关闭对话');
  assert.equal(probe(state).dialogue, null);
});

test('the typewriter speed matches the configured characters per second', () => {
  const state = makePlayState('coast_start');
  probe(state).collectInteractables().find((i) => i.id === 'npc:keeper')!.interact();
  const d = probe(state).dialogue!;
  for (let i = 0; i < 6; i++) state.update(DT);
  assert.ok(Math.abs(d.revealed - DIALOGUE_CPS * DT * 6) < 0.001);
});

test('NPCs are placed on real ground in real rooms', () => {
  const markers = new Set(Object.keys(NPC_MARKERS));
  let placed = 0;
  for (const room of ROOM_LIST) {
    room.rows.forEach((row) => {
      for (const ch of row) if (markers.has(ch)) placed++;
    });
  }
  assert.ok(placed >= NPCS.length, `世界里只放了 ${placed} 个 NPC,少于名册 ${NPCS.length} 人`);
});
