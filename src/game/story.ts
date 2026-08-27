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
  /** 仅在侵蚀态房间触发(晶蚀叠景的首见反应) */
  needsCorrupted?: boolean;
  speaker: { id: string; name: string; color: string };
  pages: string[][];
}

const MICHELE = { id: 'story_michele', name: '米雪儿', color: '#8fd7ff' };
const KANAMI = { id: 'story_kanami', name: '香奈美', color: '#ffb0d8' };

const BEATS: StoryBeat[] = [
  {
    // 打赢回响守卫的后记:预告世界将出现侵蚀变化。
    flag: 'story:post_warden',
    roomId: 'sky_wing',
    when: (w) => w.flags.has('boss:warden'),
    speaker: KANAMI,
    pages: [['守卫倒下的瞬间,弦网震了一下……', '来时的路,恐怕已经不是原样了。']],
  },
  {
    // 首次踏入侵蚀态房间:确认玩家看到的不是错觉。
    flag: 'story:corruption',
    roomId: null,
    needsCorrupted: true,
    speaker: MICHELE,
    pages: [['这里……被晶源体重写了。', '同一条路,第二次走,要按它的新规则来。']],
  },
  {
    // 初到潮汐游园:安全区的定调。
    flag: 'story:haven',
    roomId: 'haven_gate',
    speaker: KANAMI,
    pages: [['听,这里还有人的声音。', '再紧的弦,也要有松开的地方。'], ['歇一歇吧,米雪儿。']],
  },
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

/**
 * 主线目标:按进度推导出"现在该去做什么"的一句话。
 * 只指方向不画箭头 —— 银河城的乐趣在找路,目标是兜底不是导航。
 */
export function currentObjective(world: WorldState): string {
  if (!world.has('paper')) return '寻找「弦化」的力量 —— 海滨长廊的深处有回应';
  if (!world.has('kanami')) return '深入中央研究区,救出香奈美';
  if (!world.has('cling')) return '取得「矩阵适配」,让墙面成为道路';
  if (!world.flags.has('boss:warden')) return '登上天穹回廊,挑战弦翼圣所的守卫';
  if (!world.has('djump')) return '取得「弦翼」—— 祭坛的屏障已经解除';
  if (!world.flags.has('boss:guardian')) return '穿过塔顶机库,终结守望者 MK-III';
  return '欧拉重归平静 —— 去收齐剩下的秘密吧';
}

/** 当前房间此刻应触发的叙事节拍;没有则 null。调用方负责写旗标与存档。 */
export function storyBeatFor(
  roomId: string,
  world: WorldState,
  corrupted = false,
): { flag: string; npc: NpcDef } | null {
  for (const beat of BEATS) {
    if (world.flags.has(beat.flag)) continue;
    if (beat.roomId !== null && beat.roomId !== roomId) continue;
    if (beat.needsCorrupted && !corrupted) continue;
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
