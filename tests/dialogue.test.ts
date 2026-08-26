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
  nodiRemark,
  presentNpcs,
} from '../src/game/npc';
import { pageLength } from '../src/game/render/dialogue';
import { havenDecorCount, havenDecorFor } from '../src/game/render/havenProps';
import { PlayState, type Interactable } from '../src/game/states/PlayState';
import { CRYSTAL_MILESTONES, ROOM_LIST, SHOP_CHIPS, totalCrystals } from '../src/game/world/world';
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

/** 灯塔守所在的房间(2.2 落地后迁入潮汐游园园门)。 */
const KEEPER_ROOM = 'haven_gate';

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
  const state = makePlayState(KEEPER_ROOM);
  const npc = probe(state).collectInteractables().find((i) => i.id === 'npc:keeper');
  assert.ok(npc, '园门应当站着灯塔守');
  assert.equal(npc!.label, '交谈');
  npc!.interact();
  assert.equal(state.overlay, 'dialogue');
  assert.ok(probe(state).dialogue);
});

test('the typewriter fills in over time, then confirm turns the page', () => {
  let press = false;
  const state = makePlayState(KEEPER_ROOM, new WorldState(), () => press);
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
  const state = makePlayState(KEEPER_ROOM, new WorldState(), () => true);
  probe(state).collectInteractables().find((i) => i.id === 'npc:keeper')!.interact();
  const pages = probe(state).dialogue!.pages.length;

  // 每页最多两次确认(补全 + 翻页),留足余量
  for (let i = 0; i < pages * 3 + 4; i++) state.update(DT);

  assert.equal(state.overlay, 'none', '读完应关闭对话');
  assert.equal(probe(state).dialogue, null);
});

test('the typewriter speed matches the configured characters per second', () => {
  const state = makePlayState(KEEPER_ROOM);
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

// ---------------- 城镇成长必须看得见(2.3 的另一半) ----------------
// 逻辑早就有了,但如果画面上什么都不变,那个设计就只是一个返回数字的函数。

test('the town gains visible decoration at every liveliness tier', () => {
  const rooms = ['haven_gate', 'haven_lane', 'haven_view'];
  const total = (lv: number) => rooms.reduce((n, id) => n + havenDecorCount(id, lv), 0);
  let previous = total(0);
  assert.ok(previous > 0, 'Lv0 也该有长椅之类的东西,空城不是城');
  for (let lv = 1; lv <= 3; lv++) {
    const now = total(lv);
    assert.ok(now > previous, `热闹度 ${lv} 相比 ${lv - 1} 没有任何新装饰出现`);
    previous = now;
  }
});

test('each tier introduces the thing the roadmap promised', () => {
  const kinds = (lv: number) =>
    new Set(['haven_gate', 'haven_lane', 'haven_view'].flatMap((id) => havenDecorFor(id, lv).map((d) => d.kind)));
  assert.ok(kinds(0).has('bench'), 'Lv0:长椅');
  assert.ok(!kinds(0).has('teastall'), 'Lv0 不该有茶摊');
  assert.ok(kinds(1).has('teastall'), 'Lv1:茶摊开张');
  assert.ok(kinds(2).has('windmill'), 'Lv2:风车转起来');
  assert.ok(kinds(2).has('child'), 'Lv2:孩子出现');
  assert.ok(kinds(3).has('market'), 'Lv3:夜市摊位');
});

test('decoration never regresses as the adventure advances', () => {
  for (const id of ['haven_gate', 'haven_lane', 'haven_view']) {
    for (let lv = 1; lv <= 4; lv++) {
      assert.ok(
        havenDecorCount(id, lv) >= havenDecorCount(id, lv - 1),
        `${id} 在热闹度 ${lv} 反而变少了`,
      );
    }
  }
});

test('every NPC carries three to five reachable conversations', () => {
  // 路线图 2.4:每人 3-5 组分支对话。少于 3 组,"随进度改口"就立不住。
  const build = (opts: { paper?: boolean; flags?: string[]; crystals?: number; rooms?: number }) => {
    const w = new WorldState();
    if (opts.paper) w.grant('paper');
    for (const f of opts.flags ?? []) w.flags.add(f);
    for (let i = 0; i < (opts.crystals ?? 0); i++) w.crystals.add(`r:${i}:0`);
    ROOM_LIST.slice(0, opts.rooms ?? 0).forEach((r) => w.visited.add(r.id));
    return w;
  };
  const states = [
    build({}), build({ paper: true }), build({ paper: true, rooms: 50 }),
    build({ paper: true, flags: ['rescue:kanami'] }),
    build({ paper: true, flags: ['boss:warden'] }),
    build({ paper: true, flags: ['boss:warden', 'boss:arbiter'] }),
    build({ paper: true, flags: ['boss:guardian'] }),
    build({ paper: true, crystals: 1 }),
    build({ paper: true, crystals: 7, flags: ['rescue:kanami'] }),
    build({ paper: true, crystals: 79, flags: ['rescue:kanami'] }),
  ];
  for (const npc of NPCS) {
    const branches = new Set(states.map((w) => JSON.stringify(npc.lines(w))));
    assert.ok(branches.size >= 3, `${npc.name} 只有 ${branches.size} 组对话,少于 3`);
    assert.ok(branches.size <= 6, `${npc.name} 有 ${branches.size} 组对话,超出计划的 3-5`);
  }
});

test('the town is where the NPCs actually live', () => {
  const havenRooms = ROOM_LIST.filter((r) => r.zone === 'haven');
  const markers = new Set(Object.keys(NPC_MARKERS));
  const placed = havenRooms.reduce(
    (n, r) => n + r.rows.join('').split('').filter((c) => markers.has(c)).length,
    0,
  );
  assert.equal(placed, NPCS.length, '名册上的人应当全部住在城镇里');
});

test('Nodi speaks, and what he says tracks the adventure', () => {
  // 他刻意不走对话框:每次买东西先读一段字是纯粹的摩擦。
  // 但"随进度评论战绩"这条要求仍然成立 —— 只是画在商店面板里。
  const build = (f: (w: WorldState) => void) => { const w = new WorldState(); f(w); return w; };
  const states = [
    build(() => undefined),
    build((w) => w.flags.add('rescue:kanami')),
    build((w) => w.flags.add('boss:warden')),
    build((w) => w.flags.add('boss:arbiter')),
    build((w) => w.flags.add('boss:guardian')),
    build((w) => { w.dust = 500; }),
    build((w) => { for (const c of SHOP_CHIPS) w.chips.add(c.id); }),
  ];
  const lines = states.map((w) => nodiRemark(w));
  for (const line of lines) assert.ok(line.length > 0, '诺笛不该沉默');
  assert.ok(new Set(lines).size >= 5, `诺笛只有 ${new Set(lines).size} 种说法,不够跟着进度走`);
});

test('every roster NPC now has a voice', () => {
  // 2.4 名册四人:三人走对话框,诺笛走商店面板 —— 但都不是哑巴。
  for (const npc of NPCS) assert.ok(npc.lines(new WorldState()).length > 0, `${npc.name} 没有台词`);
  assert.ok(nodiRemark(new WorldState()).length > 0, '诺笛没有台词');
});
