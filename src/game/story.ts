// 主线叙事节拍:开场、救援、四场 Boss 的前文。
//
// 每个节拍是一段一次性对话:触发即写入旗标并存档,复用 NPC 对话系统的
// 渲染与翻页,不新增任何界面。台词刻意短 —— 这是动作游戏的呼吸,不是视觉小说。

import type { NpcDef } from './npc';
import type { WorldState } from './world/WorldState';

interface StoryBeat {
  /** 一次性旗标,写入 WorldState.flags */
  flag: string;
  /** 触发房间;null 表示条件型(不看房间) */
  roomId: string | null;
  /** 额外条件(默认恒真) */
  when?: (world: WorldState) => boolean;
  speaker: { id: string; name: string; color: string };
  pages: string[][];
}

const MICHELE = { id: 'story_michele', name: '米雪儿', color: '#8fd7ff' };
const KANAMI = { id: 'story_kanami', name: '香奈美', color: '#ffb0d8' };

const BEATS: StoryBeat[] = [
  {
    // 开场:只在白板存档的第一间房触发,交代目标。
    flag: 'story:opening',
    roomId: 'coast_start',
    when: (w) => w.abilities.size === 0,
    speaker: MICHELE,
    pages: [
      ['信号在这里断掉的……香奈美,你到底被带去了哪里?'],
      ['灯塔还亮着,说明设施还有弦能。', '先探路,先活着。'],
    ],
  },
  {
    // 救出香奈美后的第一句话:确认同伴关系与 Q 键。
    flag: 'story:kanami',
    roomId: null,
    when: (w) => w.flags.has('rescue:kanami'),
    speaker: KANAMI,
    pages: [
      ['……米雪儿?真的是你。', '他们在用我的声呐找什么东西——'],
      ['别一个人扛。从现在起,换手交给我。'],
    ],
  },
  {
    flag: 'story:pre_warden',
    roomId: 'sky_wing',
    speaker: MICHELE,
    pages: [['祭坛被弦能封住了……', '这台守卫机,还在执行几百年前的命令。']],
  },
  {
    flag: 'story:pre_arbiter',
    roomId: 'choir_organ',
    speaker: KANAMI,
    pages: [['管风琴在自己演奏……不,是它在「审判」。', '小心,它读得懂你的形态。']],
  },
  {
    flag: 'story:pre_gambit',
    roomId: 'sky_gambit',
    speaker: KANAMI,
    pages: [['五个锚点,全是残影。', '看牌路,别看它的脸。']],
  },
  {
    flag: 'story:pre_guardian',
    roomId: 'hangar_boss',
    speaker: MICHELE,
    pages: [['塔顶就在上面。守望者 MK-III——', '打完这台,我们就回家。']],
  },
];

/** 当前房间此刻应触发的叙事节拍;没有则 null。调用方负责写旗标与存档。 */
export function storyBeatFor(roomId: string, world: WorldState): { flag: string; npc: NpcDef } | null {
  for (const beat of BEATS) {
    if (world.flags.has(beat.flag)) continue;
    if (beat.roomId !== null && beat.roomId !== roomId) continue;
    if (beat.when && !beat.when(world)) continue;
    return {
      flag: beat.flag,
      npc: {
        id: beat.speaker.id,
        name: beat.speaker.name,
        color: beat.speaker.color,
        present: () => true,
        lines: () => beat.pages,
      },
    };
  }
  return null;
}
