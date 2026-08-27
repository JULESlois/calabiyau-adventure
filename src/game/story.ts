// 主线叙事节拍:开场、救援、区域入场定调、四场 Boss 的前文与后记、侵蚀反应与终章。
//
// 每个节拍是一段一次性对话:触发即写入旗标并存档,复用 NPC 对话系统的
// 渲染与翻页,不新增任何界面。台词刻意短 —— 这是动作游戏的呼吸,不是视觉小说。
// PlayState 逐帧轮询 storyBeatFor,所以「Boss 倒下的瞬间」这类条件会立即兑现,
// 战后台词因此可以用现在时写。

import type { NpcDef } from './npc';
import { completionReport, type WorldState } from './world/WorldState';

interface StoryBeat {
  /** 一次性旗标,写入 WorldState.flags */
  flag: string;
  /** 触发房间;null 表示条件型(不看房间) */
  roomId: string | null;
  /** 额外条件(默认恒真)。条件恒假的节拍永不触发,自然过期。 */
  when?: (world: WorldState) => boolean;
  /** 仅在侵蚀态房间触发(晶蚀叠景的首见反应) */
  needsCorrupted?: boolean;
  speaker: { id: string; name: string; color: string };
  pages: string[][];
}

const MICHELE = { id: 'story_michele', name: '米雪儿', color: '#8fd7ff' };
const KANAMI = { id: 'story_kanami', name: '香奈美', color: '#ffb0d8' };

const BEATS: StoryBeat[] = [
  // ---- 条件型(不看房间)。放在最前:这类节拍承载状态变化的确认,比入场定调更急。 ----
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
    // 首次踏入侵蚀态房间:确认玩家看到的不是错觉。
    flag: 'story:corruption',
    roomId: null,
    needsCorrupted: true,
    speaker: MICHELE,
    pages: [['这里……被晶源体重写了。', '同一条路,第二次走,要按它的新规则来。']],
  },

  // ---- 开场与区域入场定调 ----
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
    // 沉潮:顺带点破「纸怕水」—— 这是该区域最重要的走法约束。
    flag: 'story:zone_tide',
    roomId: 'tide_entry',
    speaker: MICHELE,
    pages: [['整片旧城都泡在水里……', '纸怕水。这里得换个走法。']],
  },
  {
    // 研究区:救援线的中段递进 —— 开场"信号断掉"在这里重新接上。
    // 救出之后条件恒假,节拍自然过期,不会在后期回访时突兀地响起。
    flag: 'story:zone_lab',
    roomId: 'lab_gate',
    when: (w) => !w.flags.has('rescue:kanami'),
    speaker: MICHELE,
    pages: [['信号——又出现了!很弱,可是在动。', '香奈美,等着我。']],
  },
  {
    flag: 'story:zone_choir',
    roomId: 'choir_nave',
    speaker: MICHELE,
    pages: [['唱诗席空着,烛火却是新的。', '这座圣堂,在等什么人开口。']],
  },
  {
    // 天穹与机库都在救援之后才可达;条件只是保险,不成立就推迟到下次来访。
    flag: 'story:zone_sky',
    roomId: 'sky_gate',
    when: (w) => w.flags.has('rescue:kanami'),
    speaker: KANAMI,
    pages: [['风是从最顶上灌下来的 —— 圣所在呼吸。', '抓稳,别被吹成一张真的纸。']],
  },
  {
    flag: 'story:zone_hangar',
    roomId: 'hangar_gate',
    when: (w) => w.flags.has('rescue:kanami'),
    speaker: KANAMI,
    pages: [['听,装配线还在走。', '没有人告诉这些机器:战争早就结束了。']],
  },
  {
    // 初到潮汐游园:安全区的定调。
    flag: 'story:haven',
    roomId: 'haven_gate',
    speaker: KANAMI,
    pages: [['听,这里还有人的声音。', '再紧的弦,也要有松开的地方。'], ['歇一歇吧,米雪儿。']],
  },

  // ---- Boss 前文 ----
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

  // ---- Boss 后记(逐帧轮询 → 击杀瞬间在原地触发) ----
  {
    // 打赢回响守卫的后记:预告世界将出现侵蚀变化。
    flag: 'story:post_warden',
    roomId: 'sky_wing',
    when: (w) => w.flags.has('boss:warden'),
    speaker: KANAMI,
    pages: [['守卫倒下的瞬间,弦网震了一下……', '来时的路,恐怕已经不是原样了。']],
  },
  {
    // 审判者倒下:点明踏空祭坛的封印已散。
    flag: 'story:post_arbiter',
    roomId: 'choir_organ',
    when: (w) => w.flags.has('boss:arbiter'),
    speaker: KANAMI,
    pages: [['琴声停了 —— 不,是换了首曲子。', '祭坛的封印散了,去看看吧。']],
  },
  {
    flag: 'story:post_gambit',
    roomId: 'sky_gambit',
    when: (w) => w.flags.has('boss:gambit'),
    speaker: MICHELE,
    pages: [['棋士收了它的牌。', '这一局,是我们的。']],
  },
  {
    // 终章第一幕:结算屏关闭("继续探索")后的下一帧,在寂静的机库里响起。
    flag: 'story:post_guardian',
    roomId: 'hangar_boss',
    when: (w) => w.flags.has('boss:guardian'),
    speaker: KANAMI,
    pages: [
      ['……停了。全都停了。', '几百年的命令,到今晚为止。'],
      ['回家吧,米雪儿。', '这次,走大门。'],
    ],
  },
  {
    // 终章第二幕:通关后回到游园望海台 —— 与归乡渔妇"船开出去了"的台词互为印证。
    flag: 'story:epilogue',
    roomId: 'haven_view',
    when: (w) => w.flags.has('boss:guardian'),
    speaker: MICHELE,
    pages: [
      ['看,海上有船。', '大灾变之后的第一条。'],
      ['弦还在响 —— 但不再是哀鸣了。', '剩下的路,我们慢慢走。'],
    ],
  },
];

/**
 * 主线目标:按进度推导出"现在该去做什么"的一句话。
 * 只指方向不画箭头 —— 银河城的乐趣在找路,目标是兜底不是导航。
 * 通关之后目标不清空:先指向尚未挑战的可选 Boss,再指向收集,100% 时落幕。
 */
export function currentObjective(world: WorldState): string {
  if (!world.has('paper')) return '寻找「弦化」的力量 —— 海滨长廊的深处有回应';
  if (!world.has('kanami')) return '深入中央研究区,救出香奈美';
  if (!world.has('cling')) return '取得「矩阵适配」,让墙面成为道路';
  if (!world.flags.has('boss:warden')) return '登上天穹回廊,挑战弦翼圣所的守卫';
  if (!world.has('djump')) return '取得「弦翼」—— 祭坛的屏障已经解除';
  if (!world.flags.has('boss:guardian')) return '穿过塔顶机库,终结守望者 MK-III';
  if (!world.flags.has('boss:arbiter')) return '圣堂的巨管风琴仍在自鸣 —— 弦相审判者在等一个对手';
  if (!world.flags.has('boss:gambit')) return '天穹的星弈厅里,还剩最后一局没有下完';
  if (completionReport(world).percent >= 100) return '所有的弦都归了位 —— 这段旅程,完整落幕';
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
