// NPC 定义表(路线图 2.1)。
//
// 一个 NPC = 一条数据:id、名字、头像画法、以及**按世界旗标分支的台词**。
// 刻意不引入任务系统:分支条件全部读 `world.flags` / `world.abilities` 这些**已经存在**
// 的进度信号,所以说话的内容会随冒险自然变化,而不需要第二套进度状态。
//
// 台词是 string[][]:外层是"页",内层是一页里的若干行。翻页由对话框负责。

import type { WorldState } from './world/WorldState';
import { completionReport } from './world/WorldState';
import { CRYSTAL_MILESTONES, totalCrystals } from './world/world';

/**
 * NPC 生成符 → NPC id。
 * 小写字母(大写区已被机关与敌人占满),沿用既有 K/k 的大小写配对惯例。
 * 新增前请先查 docs/ROADMAP.md 的字符命名空间。
 */
export const NPC_MARKERS: Readonly<Record<string, string>> = {
  s: 'keeper',
  t: 'sheller',
  u: 'fisher',
};

export interface NpcDef {
  id: string;
  name: string;
  /** 名牌与头像的主色 */
  color: string;
  /**
   * 该 NPC 此刻是否在场。
   * 城镇热闹度(2.3)完全靠这个函数实现 —— 不需要任何新的进度系统。
   */
  present(world: WorldState): boolean;
  /** 按世界状态选出的台词;外层为页,内层为行。 */
  lines(world: WorldState): string[][];
}

/** 距离下一次弦晶共鸣还差几枚;已达最高档时返回 null。 */
export function crystalsToNextMilestone(world: WorldState): number | null {
  const got = world.crystals.size;
  for (const milestone of CRYSTAL_MILESTONES) {
    if (got < milestone.count) return milestone.count - got;
  }
  return null;
}

export const NPCS: NpcDef[] = [
  {
    id: 'keeper',
    name: '灯塔守',
    color: '#e8c860',
    present: () => true, // 开场就在:城镇 Lv0 也不该空无一人
    lines: (world) => {
      if (!world.has('paper')) {
        return [
          ['海风里有股铁锈味……', '孩子,你还没学会弦化吧?'],
          ['往东走,长廊尽头有座祭坛。', '在那儿,你会明白什么叫「薄成一张纸」。'],
        ];
      }
      if (world.flags.has('boss:guardian')) {
        return [
          ['塔顶那东西倒下的时候,', '整片海都安静了一瞬。'],
          ['灯还亮着。', '想再走走就去走走吧 —— 灯会一直亮着。'],
        ];
      }
      const report = completionReport(world);
      const rooms = report.entries.find((entry) => entry.label === '房间')!;
      if (rooms.got * 2 < rooms.total) {
        return [
          ['我这盏灯照得见的地方,', `你才走了 ${rooms.got} 间屋子。`],
          ['地图上那些发亮的白点,', '是你现在的本事刚好够得着的地方。'],
        ];
      }
      return [
        [`${rooms.got} / ${rooms.total} 间。`, '你比我年轻时候走得远多了。'],
        ['剩下那些难走的,', '多半是要绕回从前去的。'],
      ];
    },
  },
  {
    id: 'sheller',
    name: '拾贝童',
    color: '#8fd7ff',
    present: (world) => world.flags.has('rescue:kanami'),
    lines: (world) => {
      const left = crystalsToNextMilestone(world);
      if (world.crystals.size === 0) {
        return [
          ['你捡到过弦晶吗?', '就是那种蓝蓝的、会响的小石头!'],
          ['全世界一共有八十枚哦。', '我数过的 —— 数了好久。'],
        ];
      }
      if (left === null) {
        return [
          [`${world.crystals.size} 枚……`, '你把能拿的都拿到了吧?'],
          ['那些石头在你身上一起响的时候,', '是不是很好听?'],
        ];
      }
      return [
        [`我看看 —— ${world.crystals.size} / ${totalCrystals()} 枚。`],
        [`再找 ${left} 枚,`, '它们就会一起响一次。', '那种响法我只听过一回。'],
      ];
    },
  },
  {
    id: 'fisher',
    name: '归乡渔妇',
    color: '#ff9fd0',
    present: (world) => world.flags.has('boss:warden') || world.flags.has('boss:arbiter'),
    lines: (world) => {
      if (world.flags.has('boss:guardian')) {
        return [
          ['我男人今早把船开出去了。', '大灾变以后头一回。'],
          ['他说海面上没有那种嗡嗡声了。', '……谢谢你,姑娘。'],
        ];
      }
      return [
        ['大灾变那天,海是从底下亮起来的。'],
        ['晶体从裂缝里长出来,', '像一夜之间开了满山的花。'],
        ['好看吗?好看的。', '可是花开在不该开的地方,就叫灾。'],
      ];
    },
  },
];

export function npcById(id: string): NpcDef | undefined {
  return NPCS.find((npc) => npc.id === id);
}

/** 当前应当出场的 NPC(城镇热闹度由此推出)。 */
export function presentNpcs(world: WorldState): NpcDef[] {
  return NPCS.filter((npc) => npc.present(world));
}

/**
 * 城镇热闹度 0–4。
 * 全部读既有旗标,不新增任何进度状态 —— 这是 2.3 成本最低、效果最好的原因。
 */
export function havenLiveliness(world: WorldState): number {
  if (world.flags.has('boss:guardian')) return 4;
  if (world.flags.has('boss:arbiter') || world.flags.has('boss:gambit')) return 3;
  if (world.flags.has('boss:warden')) return 2;
  if (world.flags.has('rescue:kanami')) return 1;
  return 0;
}
