// 世界数据:场景(Zone)与房间(Room)图。
// 每个场景包含多个互联房间(类似渎神/空洞骑士),房间之间通过边缘出口连接。
//
// 房间网格用建造函数生成(rect/set),避免手写 ASCII 对齐错误。
// 图例(与旧版一致,新增几种):
//   #  实体砖块      =  单向平台      ^  尖刺        %  弦膜(纸片形态可穿过)
//   H  隐藏平台(香奈美声呐显形后短暂实体化)      &  极性弦膜(I 终端切换)
//   @  可破坏墙(打碎后永久记录)  !  碎裂平台(踩住即塌,2.5 秒重建)
//   ;  荆棘(掉血+减速,不击退)   :  冰面(低摩擦地表)
//   P  新游戏出生点  T  信标(休息点/重生锚)        E  终局传送门(Boss 房)
//   F  能力·弦化     W  能力·矩阵适配(蹬墙跳)      J  能力·弦翼(二段跳)
//   D  能力·相位突进(冲刺)      S  引航者商人(记忆芯片商店)
//   G  香奈美(救援,解锁切换角色)
//   *  弦晶(全局唯一,拾取后永久记录)  h  回复心  e  弦能电池
//   a/b/c/d  隐藏遗珍芯片(灯芯/潮息/回声/反应堆)
//   1  巡逻机器人    2  浮游炮        3  炮塔      4  盾卫
//   M  横向移动平台  N  纵向移动平台  U  飘飞上升气流  B  Boss
//   >/< 沉潮压力喷流  I  极性终端  O  圣堂共鸣器  K/k 右/左传送带

import type { LevelTheme } from '../levels/levels';
import { MAX_HP, MAX_STRING } from '../constants';
import type { MusicCue } from '../music';

export type Ability = 'paper' | 'cling' | 'djump' | 'dash' | 'flash' | 'skystep' | 'kinetic' | 'kanami';
export type ZoneId = 'coast' | 'tide' | 'lab' | 'choir' | 'sky' | 'hangar';
export type ExitSide = 'left' | 'right' | 'down';

export interface ZoneDef {
  id: ZoneId;
  name: string;
  subtitle: string;
  song: MusicCue;
  theme: LevelTheme;
}

export interface ExitDef {
  side: ExitSide;
  /** 边上的 tile 范围(left/right 为行号,down 为列号),含两端 */
  from: number;
  to: number;
  target: string;
  /** 到达目标房间时的落点 tile(玩家脚底位于 (ey+1)*TILE,x 居中于 ex 列) */
  ex: number;
  ey: number;
  /** 通过此出口所需能力(仅供静态校验与地图提示,物理阻挡由弦膜等地形实现) */
  needs?: Ability[];
}

export interface ShortcutDef {
  /** 全局唯一,写入存档。 */
  id: string;
  name: string;
  /** 关闭时按实体砖处理的 tile 矩形。 */
  gate: { col: number; row: number; w: number; h: number };
  /** 从远端路线抵达后按 F 开启的位置。row 为角色站立格。 */
  lever: { col: number; row: number };
}

export interface RoomDef {
  id: string;
  zone: ZoneId;
  name: string;
  rows: string[];
  exits: ExitDef[];
  /** 地图屏坐标(格) */
  mapX: number;
  mapY: number;
  /** 地图屏纵向占格(默认 1) */
  mapH?: number;
  /** 从远端开启、跨房间持久化的真正捷径。 */
  shortcuts?: ShortcutDef[];
  /**
   * 由 Boss 死亡(而非拉杆)解封的屏障:flag 未置位时按实体砖处理。
   * 用来让守卫战真正成为能力的门,而不是可以绕过的摆设。
   */
  bossGate?: { flag: string; gate: { col: number; row: number; w: number; h: number } };
  /**
   * 暗区:视野收缩为玩家周围的一小圈,其余渐暗。
   * 只改绘制,不改碰撞 —— 暗区考验的是记路,不是手感。
   * 香奈美的声呐脉冲会短暂照亮全屏,让侦察角色在这里真正有位置。
   */
  dark?: boolean;
  /** 跨区缓冲空间:房间内视觉由当前区域逐渐混合到目标区域。 */
  transition?: {
    to: ZoneId;
    /** 目标区域所在的房间边缘,决定色彩渐变方向。 */
    toSide: 'left' | 'right' | 'down';
  };
}

// ---------------- 场景定义 ----------------

export const ZONES: Record<ZoneId, ZoneDef> = {
  coast: {
    id: 'coast',
    name: '海滨长廊',
    subtitle: '欧拉海滨市郊,失控的安保机器人开始游荡……',
    song: 'coast',
    theme: {
      tileStyle: 'masonry',
      skyTop: '#1c0f2e', skyBottom: '#c2541e', far: '#472441', mid: '#2f1a33',
      near: '#1c1024', tileBase: '#4a3f56', tileEdge: '#c08a5a', tileDark: '#231c2c',
      accent: '#e8b06a', fog: 'rgba(200,110,60,0.10)', ember: '#ffb066',
      ambient: 'rgba(200,110,60,0.06)',
    },
  },
  tide: {
    id: 'tide',
    name: '沉潮地窟',
    subtitle: '被海水遗忘的旧城区,泵轮仍在黑暗中缓慢转动。',
    song: 'tide',
    theme: {
      tileStyle: 'wetblock',
      skyTop: '#07131a', skyBottom: '#16323a', far: '#17323a', mid: '#102a31',
      near: '#091b22', tileBase: '#29454a', tileEdge: '#8db8ad', tileDark: '#14272b',
      accent: '#8de0c4', fog: 'rgba(80,150,145,0.10)', ember: '#9bd7c7',
      ambient: 'rgba(50,120,120,0.06)',
    },
  },
  lab: {
    id: 'lab',
    name: '中央研究区',
    subtitle: '深入米斯忒篷研究设施,弦膜封锁了通路。',
    song: 'lab',
    theme: {
      tileStyle: 'panel',
      skyTop: '#060812', skyBottom: '#182448', far: '#1c2444', mid: '#121a34',
      near: '#0a1020', tileBase: '#2a2c44', tileEdge: '#9aa8d8', tileDark: '#161828',
      accent: '#7ef0ff', fog: 'rgba(100,130,200,0.09)', ember: '#aac8e8',
      ambient: 'rgba(90,120,200,0.05)',
    },
  },
  choir: {
    id: 'choir',
    name: '弦声圣堂',
    subtitle: '废弃的共鸣礼堂仍在回应每一发子弹与每一次脚步。',
    song: 'choir',
    theme: {
      tileStyle: 'ashlar',
      skyTop: '#130b20', skyBottom: '#3b244b', far: '#33203f', mid: '#24172f',
      near: '#170e20', tileBase: '#50405e', tileEdge: '#d0a7cc', tileDark: '#251a2c',
      accent: '#f0b4dc', fog: 'rgba(175,100,175,0.10)', ember: '#efb8dc',
      ambient: 'rgba(145,70,145,0.06)',
    },
  },
  sky: {
    id: 'sky',
    name: '天穹回廊',
    subtitle: '通往塔顶的空中走廊,弦化是唯一的通行证。',
    song: 'sky',
    theme: {
      tileStyle: 'cloudstone',
      skyTop: '#3a4468', skyBottom: '#a8b0cc', far: '#8890b0', mid: '#666e92',
      near: '#7a83a8', tileBase: '#2b3048', tileEdge: '#d0d6ec', tileDark: '#1a1e2e',
      accent: '#f0ecd8', fog: 'rgba(200,210,235,0.12)', ember: '#e0e6f4',
      ambient: 'rgba(190,200,230,0.06)',
    },
  },
  hangar: {
    id: 'hangar',
    name: '塔顶机库',
    subtitle: '「守望者 MK-III」在此沉眠。终结这一切吧!',
    song: 'hangar',
    theme: {
      tileStyle: 'plate',
      skyTop: '#12060e', skyBottom: '#3c0d18', far: '#301024', mid: '#200a18',
      near: '#12060e', tileBase: '#342030', tileEdge: '#a85a4a', tileDark: '#1c101c',
      accent: '#ff6a5c', fog: 'rgba(170,50,60,0.10)', ember: '#ff7a50',
      ambient: 'rgba(200,50,60,0.06)',
    },
  },
};

// ---------------- 网格建造工具 ----------------

type Grid = string[][];

function grid(w: number, h: number): Grid {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => '.'));
}

/** 填充矩形区域(行/列均含两端) */
function rect(g: Grid, r0: number, r1: number, c0: number, c1: number, ch: string): void {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) g[r][c] = ch;
  }
}

function set(g: Grid, r: number, c: number, ch: string): void {
  g[r][c] = ch;
}

/**
 * 只往**空格**里填,已有内容一律不动。
 * 水体这类"灌进空腔"的地形必须用它:`rect()` 会覆写,一不留神就冲掉了
 * 地板、拉杆或坠落口 —— 这正是第一版积水踩到的坑(check-maps 当场报出四条错)。
 */
function soak(g: Grid, r0: number, r1: number, c0: number, c1: number, ch: string): void {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) if (g[r][c] === '.') g[r][c] = ch;
  }
}

function rows(g: Grid): string[] {
  return g.map((r) => r.join(''));
}

// ---------------- 房间建造 ----------------
// 手感参考:单跳可越 2 格高 / 3 格宽沟;二段跳约 4 格高 / 6 格宽;
// 蹬墙跳适用于宽 2~4 格的竖井。标准房高 17(一屏),竖井房 34/51。

const R: RoomDef[] = [];

// ======== 海滨长廊 coast ========

{
  // 起点:信标、教学空间。左侧弦膜门通往升降井(捷径,需弦化)。
  const g = grid(50, 17);
  rect(g, 14, 16, 0, 49, '#');
  rect(g, 11, 13, 1, 1, '%'); // 左侧弦膜封门
  set(g, 13, 9, 'P');
  set(g, 13, 20, 'T');
  rect(g, 12, 12, 25, 28, '='); // 台阶
  rect(g, 10, 10, 30, 33, '='); // 观景台
  set(g, 9, 31, '*');
  set(g, 13, 8, 's'); // 灯塔守:开场就有人说话,世界不该是空的
  R.push({
    id: 'coast_start', zone: 'coast', name: '海滨 · 灯塔下', rows: rows(g),
    mapX: 2, mapY: 2,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'pass_coast_lab_upper', ex: 46, ey: 13, needs: ['paper'] },
      { side: 'right', from: 11, to: 13, target: 'coast_walk', ex: 3, ey: 13 },
    ],
  });
}

{
  // 长廊:巡逻机器人;地板中部有弦膜舱口,坠入沉潮地窟(需弦化)。
  const g = grid(64, 17);
  rect(g, 14, 16, 0, 63, '#');
  rect(g, 14, 16, 30, 32, '%'); // 地板弦膜舱口
  rect(g, 12, 12, 20, 23, '=');
  set(g, 11, 21, '*');
  rect(g, 12, 12, 40, 43, '=');
  rect(g, 10, 10, 46, 48, 'H'); // 隐藏平台(声呐显形)
  set(g, 9, 47, '*');
  set(g, 13, 16, '1');
  set(g, 13, 50, '1');
  set(g, 13, 58, 'h');
  // 可破坏墙:长廊高处的封存龛。地面通路完全不受影响,纯属探索奖励;
  // 香奈美的声呐扫过时会先把它描出来 —— 侦察角色第一次有了"找墙"的用处。
  rect(g, 12, 12, 47, 50, '='); // 落脚台
  rect(g, 7, 11, 51, 56, '#'); // 龛体
  rect(g, 9, 10, 52, 55, '.'); // 内腔
  rect(g, 9, 10, 51, 51, '@'); // 可破坏的左面
  set(g, 10, 53, 'e');
  R.push({
    id: 'coast_walk', zone: 'coast', name: '海滨 · 长廊', rows: rows(g),
    mapX: 3, mapY: 2,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'coast_start', ex: 46, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'coast_cliff', ex: 3, ey: 13 },
      { side: 'down', from: 30, to: 32, target: 'pass_coast_tide_drop', ex: 4, ey: 4, needs: ['paper'] },
    ],
  });
}

{
  // 断崖:尖刺沟与平台;高处弦晶留给二段跳回访。
  const g = grid(60, 17);
  rect(g, 14, 16, 0, 14, '#');
  rect(g, 16, 16, 15, 17, '#'); // 沟底
  rect(g, 15, 15, 15, 17, '^'); // 沟内尖刺
  rect(g, 14, 16, 18, 30, '#');
  rect(g, 12, 12, 22, 25, '=');
  rect(g, 14, 16, 31, 59, '#');
  rect(g, 14, 16, 34, 36, '%'); // 纸片化可坠入走私暗港
  rect(g, 13, 13, 40, 42, '^'); // 地表尖刺
  set(g, 13, 50, '1');
  set(g, 13, 55, '6'); // 刺镰魔怪
  set(g, 11, 23, '*');
  // 二段跳回访:高处平台(距地 4 格,单跳不可及)
  rect(g, 10, 10, 33, 36, '#');
  set(g, 9, 34, '*');
  set(g, 13, 46, '8'); // 迫击晶:海崖回访时的新威胁
  rect(g, 13, 13, 52, 54, ';'); // 荆棘:巡逻机与刺镰之间的减速带,硬闯要付代价但不会被弹飞
  R.push({
    id: 'coast_cliff', zone: 'coast', name: '海滨 · 断崖', rows: rows(g),
    mapX: 4, mapY: 2,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'coast_walk', ex: 60, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'coast_shrine', ex: 3, ey: 13 },
      { side: 'down', from: 34, to: 36, target: 'coast_smuggler', ex: 4, ey: 13, needs: ['paper'] },
    ],
  });
}

{
  // 弦之祭坛:获得「弦化」;右侧弦膜密龛立刻练手。
  const g = grid(40, 17);
  rect(g, 14, 16, 0, 39, '#');
  // 祭坛立柱装饰
  rect(g, 12, 13, 17, 17, '#');
  rect(g, 12, 13, 23, 23, '#');
  set(g, 13, 20, 'F');
  set(g, 13, 29, 'T');
  // 弦膜密龛
  rect(g, 9, 9, 33, 39, '#');
  rect(g, 10, 13, 33, 33, '%');
  rect(g, 11, 13, 39, 39, '%'); // 未取得弦化时不能绕过祭坛离开
  set(g, 13, 37, '*');
  set(g, 13, 27, '8'); // 迫击晶
  R.push({
    id: 'coast_shrine', zone: 'coast', name: '海滨 · 弦之祭坛', rows: rows(g),
    mapX: 5, mapY: 2,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'coast_cliff', ex: 56, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'coast_underpier', ex: 3, ey: 13, needs: ['paper'] },
    ],
  });
}

{
  // 潮下廊桥:获得弦化后的正式测试。弦膜分割战场,移动平台跨越尖刺潮沟。
  const g = grid(58, 17);
  rect(g, 14, 16, 0, 57, '#');
  rect(g, 13, 13, 13, 18, '^');
  set(g, 10, 16, 'M');
  rect(g, 8, 13, 27, 27, '%');
  rect(g, 10, 10, 31, 35, '=');
  set(g, 9, 33, '*');
  rect(g, 13, 13, 39, 42, '^');
  set(g, 13, 23, '2');
  set(g, 13, 35, '5');
  set(g, 13, 49, '3');
  set(g, 13, 53, 'e');
  set(g, 13, 30, '1'); // 平衡巡检:巡逻机原仅 8 处
  set(g, 13, 45, '9'); // 逆弦犬
  R.push({
    id: 'coast_underpier', zone: 'coast', name: '海滨 · 潮下廊桥', rows: rows(g),
    mapX: 6, mapY: 2,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'coast_shrine', ex: 36, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'coast_tideworks', ex: 3, ey: 10 },
    ],
  });
}

{
  // 盐蚀泵塔:由上层入口下降到旧城区,纵向平台与弦膜交替。
  const g = grid(36, 34);
  rect(g, 11, 13, 0, 8, '#');
  rect(g, 31, 33, 0, 35, '#');
  rect(g, 14, 14, 11, 17, '=');
  rect(g, 20, 20, 23, 29, '=');
  rect(g, 25, 25, 8, 13, '=');
  rect(g, 21, 30, 18, 18, '%');
  set(g, 17, 25, 'N');
  set(g, 24, 11, '*');
  set(g, 30, 7, '6');
  set(g, 30, 25, '4');
  set(g, 30, 31, 'h');
  R.push({
    id: 'coast_tideworks', zone: 'coast', name: '海滨 · 盐蚀泵塔', rows: rows(g),
    mapX: 8, mapY: 3, mapH: 2,
    exits: [
      { side: 'left', from: 8, to: 10, target: 'coast_underpier', ex: 54, ey: 13 },
      { side: 'right', from: 28, to: 30, target: 'pass_coast_tide', ex: 3, ey: 13 },
    ],
  });
}

{
  // 走私暗港:由断崖秘密坠入口进入,声呐可揭示上层赃物架。
  const g = grid(52, 17);
  rect(g, 14, 16, 0, 51, '#');
  rect(g, 8, 13, 13, 13, '%');
  rect(g, 10, 10, 18, 22, '=');
  rect(g, 8, 8, 25, 29, 'H');
  set(g, 7, 27, '*');
  rect(g, 12, 12, 34, 38, '=');
  set(g, 13, 18, '1');
  set(g, 13, 31, '5');
  set(g, 13, 43, '6');
  set(g, 13, 47, '*');
  R.push({
    id: 'coast_smuggler', zone: 'coast', name: '海滨 · 走私暗港', rows: rows(g),
    mapX: 4, mapY: 6,
    exits: [{ side: 'right', from: 11, to: 13, target: 'coast_stormwall', ex: 3, ey: 13 }],
  });
}

{
  // 风暴防波堤:移动平台与炮火制造可选择的上下路线。
  const g = grid(60, 17);
  rect(g, 14, 16, 0, 11, '#');
  rect(g, 16, 16, 12, 19, '#');
  rect(g, 15, 15, 12, 19, '^');
  rect(g, 14, 16, 20, 33, '#');
  rect(g, 16, 16, 34, 41, '#');
  rect(g, 15, 15, 34, 41, '^');
  rect(g, 14, 16, 42, 59, '#');
  set(g, 10, 16, 'M');
  set(g, 9, 37, 'M');
  set(g, 13, 25, '3');
  set(g, 13, 48, '4');
  set(g, 8, 38, '*');
  rect(g, 14, 14, 44, 52, ':'); // 冰面:浪沫在堤面结冰,推不动也刹不住
  R.push({
    id: 'coast_stormwall', zone: 'coast', name: '海滨 · 风暴防波堤', rows: rows(g),
    mapX: 3, mapY: 5,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'coast_smuggler', ex: 48, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'coast_beacon', ex: 3, ey: 30 },
    ],
  });
}

{
  // 旧灯芯室:竖向回环终点,攀上后从升降井中段返回研究区交通网。
  const g = grid(36, 34);
  rect(g, 6, 6, 24, 35, '#'); // 捷径闸上方封顶,避免从顶部绕过
  rect(g, 31, 33, 0, 35, '#');
  rect(g, 25, 25, 5, 11, '=');
  rect(g, 20, 20, 17, 23, '=');
  rect(g, 15, 15, 7, 12, 'H');
  rect(g, 28, 28, 4, 10, '=');
  rect(g, 22, 22, 11, 17, '=');
  rect(g, 17, 17, 18, 24, '=');
  rect(g, 15, 15, 25, 30, '=');
  rect(g, 13, 13, 21, 26, '=');
  rect(g, 11, 13, 27, 35, '#');
  set(g, 19, 20, 'N');
  set(g, 14, 9, '*');
  set(g, 10, 32, 'a');
  set(g, 30, 14, '2');
  set(g, 30, 25, 'e');
  set(g, 8, 30, '7'); // 弦蛭:吊在捷径封顶下的伏击
  set(g, 30, 12, 't'); // 拾贝童(救出香奈美后出现)
  set(g, 30, 20, 'u'); // 归乡渔妇(击败回响守卫后出现)
  R.push({
    id: 'coast_beacon', zone: 'coast', name: '海滨 · 旧灯芯室', rows: rows(g),
    mapX: 2, mapY: 5, mapH: 2,
    shortcuts: [{
      id: 'beacon_lift', name: '灯芯升降闸',
      gate: { col: 27, row: 7, w: 1, h: 4 },
      lever: { col: 30, row: 10 },
    }],
    exits: [
      { side: 'left', from: 28, to: 30, target: 'coast_stormwall', ex: 56, ey: 13 },
      { side: 'right', from: 8, to: 10, target: 'pass_coast_lab_lower', ex: 3, ey: 13 },
    ],
  });
}

// ======== 沉潮地窟 tide ========

{
  // 地窟入口:长下坡后的安静地标,让玩家建立新区域方向感。
  const g = grid(52, 17);
  rect(g, 14, 16, 0, 51, '#');
  rect(g, 12, 13, 12, 17, '#');
  rect(g, 10, 13, 18, 23, '#');
  rect(g, 12, 12, 29, 34, '=');
  rect(g, 9, 10, 0, 5, '#'); // 泄流闸回程壁架(取得二段跳后可上)
  rect(g, 11, 11, 2, 7, '=');
  set(g, 13, 8, 'T');
  set(g, 9, 21, '*');
  set(g, 13, 27, '>');
  set(g, 13, 38, '1');
  soak(g, 12, 13, 15, 22, '~'); // 阀道浅水
  set(g, 13, 45, '5');
  set(g, 13, 41, '9'); // 逆弦犬
  R.push({
    id: 'tide_entry', zone: 'tide', name: '沉潮 · 褪色门楼', rows: rows(g),
    mapX: 7, mapY: 7,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'pass_coast_tide', ex: 46, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'tide_cistern', ex: 3, ey: 8 },
      { side: 'left', from: 6, to: 8, target: 'tide_vault', ex: 3, ey: 30, needs: ['djump'] },
    ],
  });
}

{
  // 倒悬蓄水池:上层来自门楼/海滨舱口,主路线向井底下降;井底弦膜藏支线。
  const g = grid(36, 34);
  rect(g, 9, 11, 0, 8, '#');
  rect(g, 31, 33, 0, 35, '#');
  rect(g, 31, 33, 16, 18, '%');
  rect(g, 14, 14, 13, 19, '=');
  rect(g, 20, 20, 23, 29, '=');
  rect(g, 25, 25, 8, 14, '=');
  rect(g, 9, 10, 18, 26, '#'); // 中层顶板(弦蛭吸附处)
  set(g, 17, 25, 'N');
  set(g, 24, 11, '*');
  set(g, 30, 12, '>');
  set(g, 30, 6, '6');
  soak(g, 6, 23, 34, 34, '|'); // 吊链:不靠能力也能爬的纵向路
  set(g, 30, 24, '3');
  set(g, 12, 22, '7'); // 弦蛭吸附在中层顶板下
  // 池水分居坠落口两侧,中间 15–19 列留干。
  // 「纸会湿」意味着水与**纸片专用通路**天然互斥 —— 井底那条 needs:['paper'] 的
  // 坠落口若泡在水里就永远走不通(check-maps 会直接报错)。这条干道就是那条规则的物证。
  soak(g, 29, 30, 4, 14, '~');
  soak(g, 29, 30, 20, 28, '~');
  set(g, 8, 6, 'e');
  R.push({
    id: 'tide_cistern', zone: 'tide', name: '沉潮 · 倒悬蓄水池', rows: rows(g),
    mapX: 6, mapY: 6, mapH: 2,
    exits: [
      { side: 'left', from: 6, to: 8, target: 'tide_entry', ex: 48, ey: 13 },
      { side: 'right', from: 28, to: 30, target: 'tide_pumps', ex: 3, ey: 30 },
      { side: 'down', from: 16, to: 18, target: 'tide_reliquary', ex: 4, ey: 13, needs: ['paper'] },
    ],
  });
}

{
  // 无名遗龛:坠入式隐藏房,用弦膜与隐藏平台保护区域级奖励。
  const g = grid(48, 17);
  rect(g, 14, 16, 0, 47, '#');
  rect(g, 8, 13, 12, 12, '%');
  rect(g, 10, 10, 17, 21, 'H');
  rect(g, 8, 8, 25, 29, 'H');
  rect(g, 6, 6, 33, 38, '#');
  set(g, 5, 35, '*');
  set(g, 5, 37, 'b');
  set(g, 13, 24, 'X'); // 弦闪祭坛:纸片坠入者的奖励
  set(g, 13, 18, '5');
  set(g, 13, 30, '6');
  set(g, 13, 41, '*');
  R.push({
    id: 'tide_reliquary', zone: 'tide', name: '沉潮 · 无名遗龛', rows: rows(g),
    mapX: 5, mapY: 8,
    exits: [{ side: 'right', from: 11, to: 13, target: 'tide_pumps', ex: 3, ey: 21, needs: ['kanami'] }],
  });
}

{
  // 三阀泵房:两条入口在不同高度汇合,纵向移动平台将玩家送往研究区门厅上层。
  const g = grid(56, 34);
  rect(g, 31, 33, 0, 55, '#');
  rect(g, 22, 24, 0, 8, '#');
  rect(g, 11, 13, 47, 55, '#');
  rect(g, 25, 25, 13, 19, '=');
  rect(g, 22, 22, 18, 23, '=');
  rect(g, 19, 19, 25, 31, '=');
  rect(g, 17, 17, 33, 38, '=');
  rect(g, 14, 14, 36, 42, '=');
  set(g, 26, 16, 'N');
  set(g, 21, 38, 'N');
  set(g, 30, 10, '>');
  set(g, 13, 39, '2');
  set(g, 30, 20, '4');
  set(g, 30, 36, '6');
  set(g, 18, 28, '*');
  set(g, 30, 48, 'h');
  set(g, 30, 40, '8'); // 迫击晶
  R.push({
    id: 'tide_pumps', zone: 'tide', name: '沉潮 · 三阀泵房', rows: rows(g),
    mapX: 5, mapY: 6, mapH: 2,
    exits: [
      { side: 'left', from: 28, to: 30, target: 'tide_cistern', ex: 32, ey: 30 },
      { side: 'left', from: 19, to: 21, target: 'tide_reliquary', ex: 44, ey: 13 },
      { side: 'right', from: 8, to: 10, target: 'pass_tide_lab', ex: 3, ey: 13 },
      { side: 'right', from: 28, to: 30, target: 'tide_sluice', ex: 3, ey: 30 },
    ],
  });
}

// 泄流支线:泵房底层向东的可选环线,终点的泄流闸把回程接回门楼上层。

{
  // 泄流阀道:纵向喷流井,压力喷流把纸片横向推过断层。
  const g = grid(48, 34);
  rect(g, 31, 33, 0, 47, '#');
  rect(g, 20, 20, 6, 14, '=');
  rect(g, 24, 24, 20, 28, '=');
  rect(g, 14, 14, 10, 18, '=');
  rect(g, 9, 11, 30, 39, '#');
  set(g, 30, 8, '>');
  set(g, 30, 34, '<');
  set(g, 26, 24, 'N');
  set(g, 8, 34, '*');
  set(g, 13, 14, '*');
  set(g, 30, 20, '5');
  set(g, 30, 40, '1');
  set(g, 30, 44, 'e');
  R.push({
    id: 'tide_sluice', zone: 'tide', name: '沉潮 · 泄流阀道', rows: rows(g),
    mapX: 4, mapY: 7, mapH: 2,
    exits: [
      { side: 'left', from: 28, to: 30, target: 'tide_pumps', ex: 52, ey: 30 },
      { side: 'right', from: 28, to: 30, target: 'tide_gallery', ex: 3, ey: 30 },
    ],
  });
}

{
  // 沉没回廊:信标与声呐显形平台;喷流对撞制造中段站位压力。
  const g = grid(52, 34);
  rect(g, 31, 33, 0, 51, '#');
  rect(g, 26, 26, 8, 16, '=');
  rect(g, 21, 21, 18, 26, '=');
  rect(g, 16, 16, 28, 36, '=');
  rect(g, 11, 13, 40, 51, '#');
  rect(g, 8, 8, 30, 36, 'H');
  set(g, 30, 12, '>');
  set(g, 30, 30, '<');
  set(g, 23, 22, 'N');
  set(g, 30, 26, 'T');
  set(g, 7, 33, '*');
  set(g, 10, 45, '*');
  set(g, 15, 32, '*');
  set(g, 30, 18, '6');
  set(g, 30, 38, '3');
  set(g, 30, 44, '9'); // 逆弦犬:纸片形态也会被嗅到
  set(g, 30, 48, 'h');
  // 可破坏墙:回廊西壁的封死骨龛(不在任何出口行上)
  rect(g, 22, 26, 0, 6, '#');
  rect(g, 24, 25, 1, 5, '.');
  rect(g, 24, 25, 6, 6, '@');
  set(g, 25, 3, 'h');
  // 碎裂平台:踩上就开始塌,塌完 2.5 秒重建 —— 逼出"别站着想"的节奏
  rect(g, 28, 28, 33, 36, '!');
  set(g, 15, 45, '7'); // 弦蛭:吊在东侧顶板下
  rect(g, 24, 24, 8, 12, '!');
  R.push({
    id: 'tide_gallery', zone: 'tide', name: '沉潮 · 沉没回廊', rows: rows(g),
    mapX: 6, mapY: 8, mapH: 2,
    exits: [
      { side: 'left', from: 28, to: 30, target: 'tide_sluice', ex: 44, ey: 30 },
      { side: 'right', from: 28, to: 30, target: 'tide_vault', ex: 3, ey: 30 },
    ],
  });
}

{
  // 泄流库房:环线终点的战斗房;泄流闸开启后成为回门楼的永久捷径。
  const g = grid(44, 34);
  rect(g, 31, 33, 0, 43, '#');
  rect(g, 24, 24, 6, 14, '=');
  rect(g, 18, 18, 16, 24, '=');
  rect(g, 12, 14, 26, 34, '#');
  rect(g, 27, 27, 30, 38, '=');
  set(g, 20, 20, 'N');
  set(g, 11, 30, '*');
  set(g, 26, 34, '*');
  set(g, 30, 8, '4');
  set(g, 30, 20, '5');
  set(g, 30, 34, '6');
  set(g, 30, 26, '8'); // 迫击晶压制中庭
  soak(g, 31, 33, 6, 24, '~'); // 泄流库房积水
  set(g, 30, 38, 'e');
  R.push({
    id: 'tide_vault', zone: 'tide', name: '沉潮 · 泄流库房', rows: rows(g),
    mapX: 7, mapY: 8, mapH: 2,
    shortcuts: [{
      id: 'tide_sluice_gate', name: '沉潮泄流闸',
      gate: { col: 41, row: 28, w: 1, h: 3 },
      lever: { col: 12, row: 30 },
    }],
    exits: [
      { side: 'left', from: 28, to: 30, target: 'tide_gallery', ex: 48, ey: 30 },
      { side: 'right', from: 28, to: 30, target: 'tide_entry', ex: 3, ey: 8 },
    ],
  });
}

// ======== 中央研究区 lab ========

{
  // 升降井:连接海滨与研究区的捷径竖井,需蹬墙跳攀回。
  const g = grid(28, 34);
  rect(g, 31, 33, 0, 27, '#'); // 底部地面
  rect(g, 14, 16, 17, 27, '#'); // 顶部平台(通往海滨)
  rect(g, 22, 22, 0, 4, '#'); // 中层入口门槛,右侧留出下井缺口
  // 竖井双壁(蹬墙跳,间距 3)
  rect(g, 10, 27, 8, 9, '#');
  rect(g, 13, 30, 13, 14, '#');
  set(g, 12, 11, '*');
  set(g, 9, 8, 'e');
  set(g, 30, 22, 'e');
  set(g, 13, 22, 'D'); // 相位突进(顶部平台,自海滨弦膜门坠入或蹬墙攀上)
  R.push({
    id: 'lab_lift', zone: 'lab', name: '研究区 · 升降井', rows: rows(g),
    mapX: 1, mapY: 2, mapH: 2,
    exits: [
      { side: 'left', from: 19, to: 21, target: 'pass_coast_lab_lower', ex: 46, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'pass_coast_lab_upper', ex: 3, ey: 13, needs: ['cling'] },
      { side: 'right', from: 28, to: 30, target: 'lab_gate', ex: 3, ey: 30 },
    ],
  });
}

{
  // 门厅:多高度中央枢纽。下层连主研究区/升降井,上层连沉潮地窟/弦声圣堂。
  const g = grid(44, 34);
  rect(g, 6, 6, 0, 14, '#'); // 沉潮回程闸封顶
  rect(g, 11, 13, 9, 14, '#');
  rect(g, 17, 17, 31, 43, '#'); // 检修暗线闸封顶
  rect(g, 31, 33, 0, 43, '#');
  rect(g, 11, 13, 0, 8, '#');
  rect(g, 11, 13, 35, 43, '#');
  rect(g, 22, 22, 34, 43, '#');
  rect(g, 25, 25, 8, 14, '=');
  rect(g, 22, 22, 13, 18, '=');
  rect(g, 19, 19, 18, 24, '=');
  rect(g, 14, 14, 28, 34, '=');
  set(g, 26, 11, 'N');
  set(g, 17, 21, 'N');
  set(g, 30, 12, 'T');
  set(g, 30, 24, 'S'); // 引航者商人
  set(g, 13, 30, '3');
  set(g, 30, 36, 'h');
  R.push({
    id: 'lab_gate', zone: 'lab', name: '研究区 · 门厅', rows: rows(g),
    mapX: 3, mapY: 3, mapH: 2,
    shortcuts: [
      {
        id: 'tide_return', name: '沉潮回程闸',
        gate: { col: 9, row: 7, w: 1, h: 4 },
        lever: { col: 4, row: 10 },
      },
      {
        id: 'service_hatch', name: '检修暗线闸',
        gate: { col: 34, row: 18, w: 1, h: 4 },
        lever: { col: 40, row: 21 },
      },
    ],
    exits: [
      { side: 'left', from: 8, to: 10, target: 'pass_tide_lab', ex: 46, ey: 13 },
      { side: 'left', from: 28, to: 30, target: 'lab_lift', ex: 24, ey: 30 },
      { side: 'right', from: 8, to: 10, target: 'pass_lab_choir', ex: 3, ey: 13 },
      { side: 'right', from: 19, to: 21, target: 'lab_service', ex: 3, ey: 13, needs: ['dash'] },
      { side: 'right', from: 28, to: 30, target: 'lab_observation', ex: 3, ey: 13 },
    ],
  });
}

{
  // 标本观察廊:上下两路围绕玻璃隔舱交错,玩家可选择平台战或地面近战。
  const g = grid(58, 17);
  rect(g, 14, 16, 0, 57, '#');
  rect(g, 8, 13, 18, 18, '#');
  rect(g, 8, 13, 39, 39, '&');
  rect(g, 10, 10, 7, 15, '=');
  rect(g, 8, 8, 23, 34, '=');
  rect(g, 10, 10, 43, 51, '=');
  rect(g, 4, 4, 33, 37, 'H'); // 弦镜谜题的奖励路径:接收器点亮后显形
  set(g, 3, 35, '*');
  set(g, 7, 28, '*');
  set(g, 13, 20, 'E'); // 校准能束发射器
  set(g, 13, 32, 'C'); // 弦镜节点:在此弦化,身体成为弦面
  set(g, 7, 32, 'V'); // 能束接收器(单向平台层)
  set(g, 13, 12, '4');
  set(g, 13, 26, '1');
  set(g, 13, 34, '5');
  set(g, 13, 36, 'I');
  set(g, 13, 47, '3');
  R.push({
    id: 'lab_observation', zone: 'lab', name: '研究区 · 标本观察廊', rows: rows(g),
    mapX: 4, mapY: 4,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'lab_gate', ex: 40, ey: 30 },
      { side: 'right', from: 11, to: 13, target: 'lab_cells', ex: 3, ey: 13 },
    ],
  });
}

{
  // 拘留舱:香奈美被关在弦膜牢房中。
  const g = grid(64, 17);
  rect(g, 14, 16, 0, 63, '#');
  set(g, 12, 28, 'M');
  rect(g, 13, 13, 26, 29, '^');
  set(g, 13, 36, '4');
  set(g, 13, 56, '3');
  // 悬空牢房:弦膜门,下方可通行
  rect(g, 7, 7, 44, 50, '#');
  rect(g, 11, 11, 44, 50, '#');
  rect(g, 8, 10, 44, 44, '%');
  rect(g, 8, 10, 50, 50, '#');
  set(g, 10, 47, 'G');
  set(g, 13, 20, '5'); // 爆裂魔怪
  set(g, 13, 46, '9'); // 逆弦犬:研究区正是逆弦化的源头
  rect(g, 12, 13, 41, 42, '#'); // 登牢台阶
  set(g, 13, 34, 'R'); // 镜弦猎兵:精英原仅 3 处
  set(g, 13, 51, '8'); // 迫击晶
  R.push({
    id: 'lab_cells', zone: 'lab', name: '研究区 · 拘留舱', rows: rows(g),
    mapX: 4, mapY: 3,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'lab_observation', ex: 54, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'lab_resonance', ex: 3, ey: 13 },
    ],
  });
}

{
  // 谐振档案库:救出香奈美后立刻让声呐显形路径,先安全展示再加入敌人压力。
  const g = grid(54, 17);
  rect(g, 14, 16, 0, 53, '#');
  rect(g, 11, 13, 12, 12, '%');
  rect(g, 11, 11, 17, 21, 'H');
  rect(g, 9, 9, 25, 29, 'H');
  rect(g, 7, 7, 33, 37, 'H');
  rect(g, 10, 10, 41, 45, '=');
  set(g, 6, 35, '*');
  set(g, 13, 19, '2');
  set(g, 13, 31, '5');
  set(g, 13, 45, '3');
  set(g, 13, 49, 'e');
  set(g, 13, 25, '1'); // 巡逻机
  set(g, 13, 40, '9'); // 逆弦犬
  R.push({
    id: 'lab_resonance', zone: 'lab', name: '研究区 · 谐振档案库', rows: rows(g),
    mapX: 5, mapY: 4,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'lab_cells', ex: 60, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'lab_maze', ex: 3, ey: 13, needs: ['kanami'] },
    ],
  });
}

{
  // 弦膜密室:弦膜隔断的储藏区。
  const g = grid(56, 17);
  rect(g, 14, 16, 0, 55, '#');
  rect(g, 8, 13, 14, 14, '%');
  rect(g, 5, 8, 28, 28, '#');
  rect(g, 9, 13, 28, 28, '%');
  rect(g, 12, 12, 20, 23, '=');
  rect(g, 8, 8, 32, 35, '=');
  set(g, 7, 33, '*');
  rect(g, 6, 6, 37, 39, 'H'); // 隐藏平台(声呐显形)
  set(g, 5, 38, '*');
  set(g, 13, 22, '*');
  set(g, 13, 40, 'e');
  set(g, 13, 48, '5'); // 爆裂魔怪
  set(g, 13, 34, '8'); // 迫击晶压制迷宫长廊
  set(g, 13, 42, 'R'); // 镜弦猎兵:迷宫的矩阵墙正是它的猎场
  R.push({
    id: 'lab_maze', zone: 'lab', name: '研究区 · 弦膜密室', rows: rows(g),
    mapX: 5, mapY: 3,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'lab_resonance', ex: 50, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'lab_coolant', ex: 3, ey: 8 },
    ],
  });
}

{
  // 冷却中枢:从高层入口下降,移动平台穿过弦膜隔板,路线在底部重新汇合。
  const g = grid(40, 34);
  rect(g, 9, 11, 0, 8, '#');
  rect(g, 31, 33, 0, 39, '#');
  rect(g, 13, 13, 12, 18, '=');
  rect(g, 19, 19, 24, 31, '=');
  rect(g, 25, 25, 8, 15, '=');
  rect(g, 16, 30, 20, 20, '&');
  set(g, 17, 27, 'N');
  set(g, 23, 11, 'M');
  set(g, 18, 27, '*');
  set(g, 30, 9, '5');
  set(g, 30, 16, 'I');
  set(g, 30, 25, '4');
  set(g, 30, 33, 'h');
  R.push({
    id: 'lab_coolant', zone: 'lab', name: '研究区 · 冷却中枢', rows: rows(g),
    mapX: 7, mapY: 4, mapH: 2,
    exits: [
      { side: 'left', from: 6, to: 8, target: 'lab_maze', ex: 52, ey: 13 },
      { side: 'right', from: 28, to: 30, target: 'lab_quarantine', ex: 3, ey: 13 },
    ],
  });
}

{
  // 隔离场:敌人组合考试,平台位置迫使玩家在换角、下劈与纸片闪避间切换。
  const g = grid(62, 17);
  rect(g, 14, 16, 0, 61, '#');
  rect(g, 12, 12, 9, 15, '=');
  rect(g, 10, 10, 24, 31, '=');
  rect(g, 12, 12, 41, 47, '=');
  rect(g, 13, 13, 33, 36, '^');
  set(g, 13, 12, '6');
  set(g, 13, 21, '5');
  set(g, 13, 29, '2');
  set(g, 13, 43, '4');
  set(g, 13, 52, '3');
  set(g, 9, 27, '*');
  set(g, 13, 57, 'h');
  set(g, 13, 26, '9'); // 检疫区的逆弦犬
  rect(g, 14, 14, 17, 23, ':'); // 冰面:冷却剂泄漏冻住的地板
  rect(g, 13, 13, 48, 50, ';'); // 荆棘:晶源体侵蚀出的软刺带
  // 可破坏墙:封存柜,从中层平台横向击碎
  rect(g, 5, 9, 32, 37, '#');
  rect(g, 7, 8, 33, 36, '.');
  rect(g, 7, 8, 32, 32, '@');
  set(g, 8, 34, 'h');
  R.push({
    id: 'lab_quarantine', zone: 'lab', name: '研究区 · 失控隔离场', rows: rows(g),
    mapX: 8, mapY: 5,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'lab_coolant', ex: 36, ey: 30 },
      { side: 'right', from: 11, to: 13, target: 'lab_matrix', ex: 3, ey: 10 },
    ],
  });
}

{
  // 矩阵适配室:坠入深井,获得「矩阵适配」(蹬墙跳)后攀出。
  const g = grid(40, 34);
  rect(g, 11, 13, 0, 8, '#'); // 顶部左侧入口平台
  rect(g, 9, 9, 10, 28, '='); // 顶部栈桥(回程用,跳上去横穿)
  rect(g, 31, 33, 0, 39, '#'); // 井底
  set(g, 30, 6, 'W');
  set(g, 30, 16, 'T');
  set(g, 30, 26, 'h');
  // 右侧攀爬竖井(间距 3),通往天穹
  rect(g, 8, 28, 30, 31, '#');
  rect(g, 11, 30, 35, 36, '#');
  rect(g, 11, 13, 37, 39, '#'); // 右上出口平台
  set(g, 20, 33, '*');
  R.push({
    id: 'lab_matrix', zone: 'lab', name: '研究区 · 矩阵适配室', rows: rows(g),
    mapX: 6, mapY: 3, mapH: 2,
    exits: [
      { side: 'left', from: 8, to: 10, target: 'lab_quarantine', ex: 58, ey: 13 },
      { side: 'left', from: 28, to: 30, target: 'lab_service', ex: 56, ey: 13, needs: ['dash'] },
      { side: 'right', from: 8, to: 10, target: 'pass_lab_sky', ex: 3, ey: 13 },
    ],
  });
}

{
  // 检修暗线:短而危险的冲刺捷径,从矩阵室井底直接返回门厅中层。
  const g = grid(60, 17);
  rect(g, 14, 16, 0, 10, '#');
  rect(g, 16, 16, 11, 19, '#');
  rect(g, 15, 15, 11, 19, '^');
  rect(g, 14, 16, 20, 31, '#');
  rect(g, 16, 16, 32, 42, '#');
  rect(g, 15, 15, 32, 42, '^');
  rect(g, 14, 16, 43, 59, '#');
  set(g, 10, 15, 'M');
  set(g, 9, 37, 'M');
  rect(g, 7, 7, 25, 29, 'H');
  set(g, 6, 27, '*');
  rect(g, 6, 7, 56, 59, '#'); // 受电升降台顶端的检修台
  set(g, 5, 58, '*');
  set(g, 13, 55, 'L'); // 雷行电容祭坛:冲刺捷径的尽头,奖励移动本身
  set(g, 13, 52, 'Q'); // 导能节点
  set(g, 10, 57, 'n'); // 受电升降台:回路点亮才运转
  set(g, 13, 25, '3');
  set(g, 13, 49, '6');
  R.push({
    id: 'lab_service', dark: true, zone: 'lab', name: '研究区 · 检修暗线', rows: rows(g),
    mapX: 4, mapY: 5,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'lab_gate', ex: 40, ey: 21 },
      { side: 'right', from: 11, to: 13, target: 'lab_matrix', ex: 3, ey: 30, needs: ['dash'] },
    ],
  });
}

// ======== 弦声圣堂 choir ========

{
  // 中殿:从研究区上层进入的可选区域,信标与三层看台构成安全前厅。
  const g = grid(56, 17);
  rect(g, 14, 16, 0, 55, '#');
  rect(g, 11, 11, 10, 17, '=');
  rect(g, 8, 8, 23, 31, 'H');
  rect(g, 11, 11, 38, 46, '=');
  rect(g, 9, 10, 49, 55, '#'); // 环廊壁架(取得二段跳后可上)
  set(g, 13, 9, 'T');
  set(g, 7, 27, '*');
  set(g, 13, 28, 'O');
  set(g, 13, 21, '2');
  set(g, 13, 34, '4');
  set(g, 13, 48, '6');
  set(g, 13, 43, '8'); // 迫击晶封锁中殿远端
  set(g, 13, 36, '1'); // 巡逻机
  set(g, 13, 24, '9'); // 逆弦犬
  set(g, 13, 45, 'R'); // 镜弦猎兵
  R.push({
    id: 'choir_nave', zone: 'choir', name: '圣堂 · 失声中殿', rows: rows(g),
    mapX: 3, mapY: 0,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'pass_lab_choir', ex: 46, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'choir_crypt', ex: 3, ey: 13 },
      { side: 'right', from: 6, to: 8, target: 'choir_ambulatory', ex: 3, ey: 13, needs: ['djump'] },
    ],
  });
}

{
  // 无词墓廊:纸片通道隐藏在柱列后,井口可坠入更深的遗物室。
  const g = grid(60, 17);
  rect(g, 14, 16, 0, 59, '#');
  rect(g, 14, 16, 31, 33, '%');
  rect(g, 8, 13, 15, 15, '%');
  rect(g, 10, 10, 20, 25, '=');
  rect(g, 8, 8, 37, 42, 'H');
  rect(g, 6, 7, 43, 50, '#'); // 墓廊拱顶(弦蛭吸附处)
  set(g, 7, 39, '*');
  set(g, 13, 37, 'O');
  set(g, 13, 22, '5');
  set(g, 13, 41, '3');
  set(g, 13, 50, '6');
  set(g, 9, 46, '7'); // 弦蛭吊在墓廊拱顶
  R.push({
    id: 'choir_crypt', zone: 'choir', name: '圣堂 · 无词墓廊', rows: rows(g),
    mapX: 4, mapY: 0,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'choir_nave', ex: 52, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'choir_belfry', ex: 3, ey: 46, needs: ['cling'] },
      { side: 'down', from: 31, to: 33, target: 'choir_reliquary', ex: 4, ey: 13, needs: ['paper'] },
    ],
  });
}

{
  // 回声遗物室:只有声呐能铺出完整路径,奖励后从钟塔中层离开。
  const g = grid(48, 17);
  rect(g, 14, 16, 0, 47, '#');
  rect(g, 11, 11, 10, 14, 'H');
  rect(g, 9, 9, 18, 22, 'H');
  rect(g, 7, 7, 26, 30, 'H');
  rect(g, 9, 9, 35, 39, '=');
  set(g, 6, 28, '*');
  set(g, 13, 24, 'O');
  set(g, 8, 37, 'c');
  set(g, 13, 17, '2');
  set(g, 13, 31, '5');
  set(g, 13, 42, '*');
  R.push({
    id: 'choir_reliquary', zone: 'choir', name: '圣堂 · 回声遗物室', rows: rows(g),
    mapX: 5, mapY: -1,
    exits: [{ side: 'right', from: 11, to: 13, target: 'choir_belfry', ex: 3, ey: 29, needs: ['kanami'] }],
  });
}

{
  // 断钟塔:三层出口把墓廊、隐藏遗物室和天穹竖廊织成跨区捷径。
  const g = grid(36, 51);
  rect(g, 5, 5, 20, 35, '#'); // 高层回程闸封顶
  rect(g, 48, 50, 0, 35, '#');
  rect(g, 47, 47, 0, 8, '#'); // 墓廊入口门槛与相邻房地板齐平
  rect(g, 30, 32, 0, 8, '#');
  rect(g, 10, 12, 27, 35, '#');
  rect(g, 35, 47, 12, 13, '#');
  rect(g, 33, 47, 17, 18, '#');
  rect(g, 19, 33, 7, 8, '#');
  rect(g, 17, 31, 12, 13, '#');
  rect(g, 8, 22, 20, 21, '#');
  rect(g, 10, 24, 25, 26, '#');
  rect(g, 38, 38, 22, 28, '=');
  rect(g, 24, 24, 15, 20, '=');
  rect(g, 13, 13, 8, 14, '=');
  rect(g, 20, 21, 0, 5, '#'); // 管风琴侧廊壁架
  rect(g, 27, 27, 2, 6, '=');
  rect(g, 24, 24, 2, 6, '=');
  rect(g, 22, 22, 2, 6, '=');
  set(g, 44, 15, '2');
  set(g, 27, 10, '6');
  set(g, 14, 23, '2');
  set(g, 23, 17, '*');
  set(g, 47, 27, 'e');
  R.push({
    id: 'choir_belfry', zone: 'choir', name: '圣堂 · 断钟塔', rows: rows(g),
    mapX: 6, mapY: -1, mapH: 3,
    shortcuts: [{
      id: 'belfry_return', name: '断钟回程闸',
      gate: { col: 27, row: 6, w: 1, h: 4 },
      lever: { col: 32, row: 9 },
    }],
    exits: [
      { side: 'left', from: 44, to: 46, target: 'choir_crypt', ex: 56, ey: 13 },
      { side: 'left', from: 27, to: 29, target: 'choir_reliquary', ex: 44, ey: 13 },
      { side: 'right', from: 7, to: 9, target: 'pass_choir_sky', ex: 3, ey: 13, needs: ['cling'] },
      { side: 'left', from: 17, to: 19, target: 'choir_organ', ex: 3, ey: 13, needs: ['djump'] },
    ],
  });
}

// 管风琴支线:中殿上层与钟塔中层之间的可选环线,三台共鸣器串起节拍平台。

{
  // 环廊:共鸣器显形看台,连接中殿壁架与抄经室。
  const g = grid(52, 17);
  rect(g, 14, 16, 0, 51, '#');
  rect(g, 11, 11, 8, 15, '=');
  rect(g, 8, 8, 20, 27, 'H');
  rect(g, 11, 11, 32, 39, '=');
  rect(g, 6, 6, 24, 31, '#');
  set(g, 13, 18, 'O');
  set(g, 7, 27, '*');
  set(g, 10, 35, '*');
  set(g, 13, 12, '5');
  set(g, 13, 30, '2');
  set(g, 13, 42, '6');
  set(g, 13, 46, 'h');
  R.push({
    id: 'choir_ambulatory', zone: 'choir', name: '圣堂 · 无声环廊', rows: rows(g),
    mapX: 2, mapY: 0,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'choir_nave', ex: 52, ey: 8 },
      { side: 'right', from: 11, to: 13, target: 'choir_scriptorium', ex: 3, ey: 13 },
    ],
  });
}

{
  // 抄经室:尖刺与节拍平台交错,下劈可借尖刺弹起取上层弦晶。
  const g = grid(48, 17);
  rect(g, 14, 16, 0, 47, '#');
  rect(g, 13, 13, 16, 19, '^');
  rect(g, 11, 11, 6, 13, '=');
  rect(g, 8, 8, 22, 29, 'H');
  rect(g, 10, 10, 33, 40, '=');
  rect(g, 5, 6, 34, 42, '#'); // 抄经室顶板(弦蛭吸附处)
  set(g, 13, 24, 'O');
  set(g, 13, 45, 'T'); // 管风琴环信标(原在巨管风琴,给审判庭让位)
  set(g, 7, 26, '*');
  set(g, 8, 38, '7'); // 抄经室顶的弦蛭
  set(g, 8, 41, '7'); // 第二只弦蛭
  set(g, 9, 36, '*');
  set(g, 13, 21, '*');
  set(g, 13, 10, '5');
  set(g, 13, 31, '6');
  set(g, 13, 43, '3');
  rect(g, 13, 13, 33, 36, ';'); // 荆棘:抄经席之间的藤刺
  rect(g, 11, 11, 24, 28, '!'); // 碎裂平台:节拍平台之外的另一种"不能久留"
  R.push({
    id: 'choir_scriptorium', zone: 'choir', name: '圣堂 · 无字抄经室', rows: rows(g),
    mapX: 2, mapY: 1,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'choir_ambulatory', ex: 48, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'choir_organ', ex: 3, ey: 13 },
    ],
  });
}

{
  // 巨管风琴:支线信标与移动平台;右门接回断钟塔中层,闭合圣堂环线。
  const g = grid(44, 17);
  rect(g, 14, 16, 0, 43, '#');
  rect(g, 11, 11, 10, 17, '=');
  rect(g, 8, 8, 21, 28, 'H');
  rect(g, 5, 7, 30, 37, '#');
  rect(g, 9, 10, 38, 43, '#'); // 祭坛壁龛顶板
  set(g, 10, 24, 'M');
  set(g, 13, 20, 'O');
  set(g, 13, 41, 'Y'); // 踏空蓄步祭坛:审判者倒下前被弦能屏障封在壁龛里
  set(g, 7, 25, '*');
  set(g, 4, 33, '*');
  set(g, 13, 14, '4');
  set(g, 13, 30, 'A'); // 弦相审判者
  R.push({
    id: 'choir_organ', zone: 'choir', name: '圣堂 · 巨管风琴', rows: rows(g),
    mapX: 2, mapY: -1,
    bossGate: { flag: 'boss:arbiter', gate: { col: 38, row: 11, w: 1, h: 3 } },
    exits: [
      { side: 'left', from: 11, to: 13, target: 'choir_scriptorium', ex: 44, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'choir_belfry', ex: 3, ey: 19 },
    ],
  });
}

// ======== 天穹回廊 sky ========

{
  // 天穹竖廊:三屏高的攀爬井。
  const g = grid(30, 51);
  rect(g, 47, 49, 0, 29, '#'); // 底部
  rect(g, 26, 26, 0, 5, '#'); // 圣堂侧入口门槛,进入后可向下落入竖井
  // 三段成对攀爬井(井宽 2~3,蹬墙跳交替上行)+ 单向平台歇脚
  rect(g, 36, 46, 12, 13, '#'); // A 井左壁
  rect(g, 34, 46, 17, 18, '#'); // A 井右壁
  rect(g, 40, 40, 20, 24, '=');
  rect(g, 33, 33, 4, 8, '=');
  rect(g, 18, 31, 6, 7, '#'); // B 井左壁
  rect(g, 20, 33, 11, 12, '#'); // B 井右壁
  rect(g, 26, 26, 16, 20, '=');
  rect(g, 12, 24, 18, 19, '#'); // C 井左壁
  rect(g, 10, 24, 22, 23, '#'); // C 井右壁
  rect(g, 11, 13, 22, 29, '#'); // 顶部右侧出口平台
  set(g, 30, 15, '2');
  set(g, 16, 12, '2');
  set(g, 46, 20, '6'); // 刺镰魔怪(井底)
  set(g, 25, 18, '*');
  set(g, 46, 6, 'e');
  R.push({
    id: 'sky_gate', zone: 'sky', name: '天穹 · 竖廊', rows: rows(g),
    mapX: 7, mapY: 1, mapH: 3,
    exits: [
      { side: 'left', from: 44, to: 46, target: 'pass_lab_sky', ex: 46, ey: 13, needs: ['cling'] },
      { side: 'left', from: 23, to: 25, target: 'pass_choir_sky', ex: 46, ey: 13, needs: ['cling'] },
      { side: 'right', from: 8, to: 10, target: 'sky_corridor', ex: 3, ey: 13, needs: ['cling'] },
    ],
  });
}

{
  // 天穹回廊:信标;上层高台需「弦翼」(二段跳)。
  const g = grid(64, 17);
  rect(g, 14, 16, 0, 63, '#');
  rect(g, 14, 16, 20, 22, '%'); // 声呐档案馆的秘密坠入口
  set(g, 13, 12, 'T');
  rect(g, 12, 12, 24, 26, '=');
  // 高台:距地面 4 格,需二段跳
  rect(g, 10, 10, 38, 63, '#');
  set(g, 9, 42, '*');
  set(g, 13, 30, '2');
  set(g, 13, 40, '5'); // 爆裂魔怪
  set(g, 13, 48, '3');
  set(g, 13, 56, 'h');
  set(g, 13, 44, '9'); // 天穹竖廊的逆弦犬
  set(g, 13, 33, '1'); // 巡逻机
  set(g, 13, 51, '9'); // 逆弦犬
  set(g, 13, 58, 'R'); // 镜弦猎兵
  R.push({
    id: 'sky_corridor', zone: 'sky', name: '天穹 · 回廊', rows: rows(g),
    mapX: 8, mapY: 1,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'sky_gate', ex: 25, ey: 10 },
      { side: 'right', from: 11, to: 13, target: 'sky_windworks', ex: 3, ey: 13 },
      { side: 'down', from: 20, to: 22, target: 'sky_archive', ex: 4, ey: 13, needs: ['paper', 'kanami'] },
    ],
  });
}

{
  // 风箱庭:上升气流只托住空中飘飞的纸片,将 Shift 飘飞变成独立路线机制。
  const g = grid(60, 17);
  rect(g, 14, 16, 0, 59, '#');
  rect(g, 13, 13, 13, 20, '^');
  rect(g, 13, 13, 39, 47, '^');
  set(g, 13, 17, 'U');
  set(g, 13, 43, 'U');
  rect(g, 8, 8, 14, 20, '=');
  rect(g, 6, 6, 27, 33, '=');
  rect(g, 8, 8, 41, 47, '=');
  set(g, 5, 30, '*');
  set(g, 13, 27, '2');
  set(g, 13, 34, '3');
  set(g, 13, 52, '6');
  set(g, 13, 56, 'e');
  rect(g, 13, 13, 22, 25, ';'); // 荆棘:高空风口结的霜刺
  rect(g, 10, 10, 22, 25, '!'); // 碎裂平台:正压在荆棘上方,塌了就要吃刺
  rect(g, 14, 14, 29, 36, ':'); // 冰面:背风面结的薄冰
  R.push({
    id: 'sky_windworks', zone: 'sky', name: '天穹 · 风箱庭', rows: rows(g),
    mapX: 9, mapY: 1,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'sky_corridor', ex: 60, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'sky_wing', ex: 3, ey: 13, needs: ['paper'] },
    ],
  });
}

{
  // 弦翼圣所:守卫战后获得「弦翼」。
  // 「回响守卫」倒下前,弦能屏障封住能力祭坛所在的壁龛 —— 这场战斗是真正的门。
  const g = grid(48, 17);
  rect(g, 14, 16, 0, 47, '#');
  set(g, 13, 20, 'Z'); // 回响守卫
  set(g, 13, 36, '3');
  set(g, 13, 43, 'J');
  rect(g, 10, 10, 8, 11, '='); // 二段跳可及的高台
  set(g, 9, 9, '*');
  rect(g, 10, 10, 40, 43, '#'); // 上层入口落脚台
  rect(g, 10, 12, 44, 47, '#'); // 取得二段跳后从上层出口离开
  R.push({
    id: 'sky_wing', zone: 'sky', name: '天穹 · 弦翼圣所', rows: rows(g),
    mapX: 10, mapY: 1,
    bossGate: { flag: 'boss:warden', gate: { col: 41, row: 11, w: 1, h: 3 } },
    exits: [
      { side: 'left', from: 11, to: 13, target: 'sky_windworks', ex: 56, ey: 13 },
      { side: 'right', from: 7, to: 9, target: 'sky_orrery', ex: 3, ey: 13, needs: ['djump'] },
    ],
  });
}

{
  // 轨道仪:二段跳后立刻进入移动平台组合题,下层尖刺迫使玩家规划落点。
  const g = grid(64, 17);
  rect(g, 14, 16, 0, 10, '#');
  rect(g, 16, 16, 11, 52, '#');
  rect(g, 15, 15, 11, 52, '^');
  rect(g, 14, 16, 53, 63, '#');
  set(g, 11, 16, 'M');
  set(g, 8, 27, 'N');
  set(g, 10, 39, 'M');
  set(g, 7, 49, 'N');
  rect(g, 6, 6, 30, 34, 'H');
  set(g, 5, 32, '*');
  set(g, 13, 7, 'e');
  set(g, 13, 57, '2');
  R.push({
    id: 'sky_orrery', zone: 'sky', name: '天穹 · 失衡轨道仪', rows: rows(g),
    mapX: 11, mapY: 1,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'sky_wing', ex: 40, ey: 9 },
      { side: 'right', from: 11, to: 13, target: 'sky_peak', ex: 3, ey: 30, needs: ['djump'] },
    ],
  });
}

{
  // 云背档案馆:长廊秘密坠入口,声呐平台通向钟摆塔的技巧支线。
  const g = grid(54, 17);
  rect(g, 14, 16, 0, 53, '#');
  rect(g, 8, 13, 12, 12, '%');
  rect(g, 11, 11, 17, 21, 'H');
  rect(g, 8, 8, 26, 30, 'H');
  rect(g, 10, 10, 36, 41, 'H');
  set(g, 7, 28, '*');
  set(g, 13, 20, '5');
  set(g, 13, 34, '3');
  set(g, 13, 46, '6');
  set(g, 13, 50, '*');
  set(g, 13, 37, '8'); // 迫击晶封锁档案馆中段
  set(g, 13, 44, 'R'); // 镜弦猎兵
  set(g, 13, 24, '9'); // 云背档案馆的逆弦犬
  R.push({
    id: 'sky_archive', dark: true, zone: 'sky', name: '天穹 · 云背档案馆', rows: rows(g),
    mapX: 9, mapY: 3,
    exits: [{ side: 'right', from: 11, to: 13, target: 'sky_belltower', ex: 3, ey: 30, needs: ['kanami'] }],
  });
}

{
  // 钟摆塔:无人机与炮弹既是威胁也是下劈跳板,最终接入天穹之巅上层。
  const g = grid(36, 34);
  rect(g, 31, 33, 0, 35, '#');
  rect(g, 10, 12, 27, 35, '#');
  rect(g, 25, 25, 7, 13, '=');
  rect(g, 20, 20, 20, 26, '=');
  rect(g, 15, 15, 8, 14, '=');
  set(g, 27, 18, 'N');
  set(g, 23, 10, '2');
  set(g, 18, 23, '3');
  set(g, 13, 11, '2');
  set(g, 14, 11, '*');
  set(g, 30, 29, 'e');
  set(g, 30, 22, '8'); // 迫击晶
  soak(g, 10, 28, 17, 17, '|'); // 钟楼吊链
  R.push({
    id: 'sky_belltower', zone: 'sky', name: '天穹 · 钟摆塔', rows: rows(g),
    mapX: 10, mapY: 3, mapH: 2,
    exits: [
      { side: 'left', from: 28, to: 30, target: 'sky_archive', ex: 50, ey: 13 },
      { side: 'right', from: 7, to: 9, target: 'sky_peak', ex: 3, ey: 9, needs: ['djump'] },
      { side: 'right', from: 28, to: 30, target: 'sky_gambit', ex: 3, ey: 13 },
    ],
  });
}

{
  // 天穹之巅:主路线与钟塔支线在不同高度汇合,攀升后进入机库装配线。
  const g = grid(56, 34);
  rect(g, 31, 33, 0, 10, '#');
  rect(g, 10, 12, 0, 8, '#');
  rect(g, 10, 12, 47, 55, '#');
  rect(g, 26, 28, 15, 20, '#');
  rect(g, 21, 23, 25, 30, '#');
  rect(g, 16, 18, 34, 39, '#');
  rect(g, 12, 12, 41, 46, 'H');
  set(g, 25, 17, '*');
  set(g, 20, 27, '2');
  set(g, 15, 36, '*');
  set(g, 11, 43, '*');
  set(g, 24, 26, 'U');
  set(g, 30, 7, 'e');
  set(g, 17, 36, '2');
  R.push({
    id: 'sky_peak', zone: 'sky', name: '天穹 · 之巅', rows: rows(g),
    mapX: 12, mapY: 0, mapH: 2,
    exits: [
      { side: 'left', from: 28, to: 30, target: 'sky_orrery', ex: 60, ey: 13 },
      { side: 'left', from: 7, to: 9, target: 'sky_belltower', ex: 32, ey: 9 },
      { side: 'right', from: 7, to: 9, target: 'pass_sky_hangar', ex: 3, ey: 13 },
    ],
  });
}

{
  // 星弈厅:王车迷局 —— 加拉蒂亚式真假身换位 Boss 的对弈场。
  // 五枚牌位锚点由 Boss 自持;屏障封住右侧弦晶密室,倒下才解封。
  const g = grid(48, 17);
  rect(g, 14, 16, 0, 47, '#');
  rect(g, 10, 10, 10, 16, '=');
  rect(g, 10, 10, 30, 36, '=');
  rect(g, 9, 13, 40, 40, '#'); // 密室隔墙(缺口由屏障封住)
  set(g, 13, 23, 'g'); // 王车棋士
  set(g, 13, 43, '*');
  set(g, 12, 45, '*');
  R.push({
    id: 'sky_gambit', zone: 'sky', name: '天穹 · 星弈厅', rows: rows(g),
    mapX: 11, mapY: 3,
    bossGate: { flag: 'boss:gambit', gate: { col: 41, row: 11, w: 1, h: 3 } },
    exits: [{ side: 'left', from: 11, to: 13, target: 'sky_belltower', ex: 32, ey: 30 }],
  });
}

// ======== 塔顶机库 hangar ========

{
  // 装配线:纸片、飘飞、冲刺与敌弹下劈的综合考试,下方藏反应堆旁路。
  const g = grid(64, 17);
  rect(g, 14, 16, 0, 63, '#');
  rect(g, 14, 16, 30, 32, '%');
  rect(g, 8, 13, 15, 15, '%');
  rect(g, 10, 10, 20, 25, '=');
  rect(g, 8, 8, 36, 42, 'H');
  rect(g, 11, 11, 49, 55, '=');
  rect(g, 9, 10, 57, 63, '#'); // 高空步道壁架
  set(g, 9, 22, 'M');
  set(g, 13, 18, 'K');
  set(g, 13, 46, 'k');
  set(g, 7, 39, '*');
  set(g, 13, 10, '6');
  set(g, 13, 23, '3');
  set(g, 13, 38, '4');
  set(g, 13, 51, '5');
  set(g, 13, 58, '2');
  set(g, 13, 41, '1'); // 巡逻机
  set(g, 13, 54, 'R'); // 镜弦猎兵
  R.push({
    id: 'hangar_assembly', zone: 'hangar', name: '机库 · 悬吊装配线', rows: rows(g),
    mapX: 13, mapY: 0,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'pass_sky_hangar', ex: 46, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'hangar_gate', ex: 3, ey: 30 },
      { side: 'down', from: 30, to: 32, target: 'hangar_reactor', ex: 4, ey: 13, needs: ['paper'] },
      { side: 'right', from: 6, to: 8, target: 'hangar_catwalk', ex: 3, ey: 8, needs: ['djump'] },
    ],
  });
}

{
  // 反应堆旁路:可选高压战斗房,完成后从前厅上层回到 Boss 路线。
  const g = grid(56, 17);
  rect(g, 14, 16, 0, 55, '#');
  rect(g, 13, 13, 17, 20, '^');
  rect(g, 13, 13, 35, 38, '^');
  rect(g, 10, 10, 8, 13, '=');
  rect(g, 8, 8, 24, 30, '=');
  rect(g, 10, 10, 43, 48, '=');
  set(g, 7, 27, '*');
  set(g, 7, 25, 'd');
  set(g, 13, 22, 'K');
  set(g, 13, 40, 'k');
  set(g, 13, 11, '5');
  set(g, 13, 16, '6');
  set(g, 13, 27, '4');
  set(g, 13, 33, '2');
  set(g, 13, 45, '3');
  set(g, 13, 29, '9'); // 逆弦犬巡守反应堆
  set(g, 13, 50, '*');
  R.push({
    id: 'hangar_reactor', zone: 'hangar', name: '机库 · 反应堆旁路', rows: rows(g),
    mapX: 13, mapY: 2,
    exits: [{ side: 'right', from: 11, to: 13, target: 'hangar_gate', ex: 3, ey: 9 }],
  });
}

{
  // 机库前厅:大战前的宁静;信标。
  const g = grid(40, 34);
  rect(g, 6, 6, 0, 14, '#'); // 反应堆回程闸封顶
  rect(g, 31, 33, 0, 39, '#');
  rect(g, 10, 12, 0, 14, '#');
  rect(g, 23, 23, 12, 18, '=');
  rect(g, 17, 17, 22, 28, '=');
  rect(g, 10, 12, 32, 39, '#'); // 熔铸台门槛
  rect(g, 14, 14, 30, 36, '=');
  set(g, 12, 30, 'N');
  set(g, 21, 15, 'N');
  set(g, 30, 16, 'T');
  set(g, 30, 24, 'h');
  set(g, 30, 27, 'e');
  set(g, 30, 33, 'K');
  soak(g, 6, 28, 20, 20, '|'); // 机库吊链
  set(g, 30, 29, '8'); // 迫击晶
  R.push({
    id: 'hangar_gate', zone: 'hangar', name: '机库 · 前厅', rows: rows(g),
    mapX: 14, mapY: 0, mapH: 2,
    shortcuts: [{
      id: 'reactor_return', name: '反应堆回程闸',
      gate: { col: 9, row: 7, w: 1, h: 3 },
      lever: { col: 4, row: 9 },
    }],
    exits: [
      { side: 'left', from: 7, to: 9, target: 'hangar_reactor', ex: 52, ey: 13 },
      { side: 'left', from: 28, to: 30, target: 'hangar_assembly', ex: 60, ey: 13 },
      { side: 'right', from: 28, to: 30, target: 'hangar_boss', ex: 3, ey: 13 },
      { side: 'right', from: 7, to: 9, target: 'hangar_foundry', ex: 3, ey: 13, needs: ['djump'] },
    ],
  });
}

{
  // 塔顶机库:Boss「守望者 MK-III」。
  const g = grid(40, 17);
  rect(g, 14, 16, 0, 39, '#');
  rect(g, 5, 5, 3, 6, '#');
  rect(g, 5, 5, 33, 36, '#');
  rect(g, 10, 10, 9, 12, '=');
  rect(g, 10, 10, 23, 26, '=');
  set(g, 13, 33, 'B');
  R.push({
    id: 'hangar_boss', zone: 'hangar', name: '塔顶机库', rows: rows(g),
    mapX: 15, mapY: 1,
    exits: [{ side: 'left', from: 11, to: 13, target: 'hangar_gate', ex: 36, ey: 30 }],
  });
}

// 熔铸支线:前厅上层向东的可选环线,高空步道把回程接回装配线顶层。

{
  // 熔铸台:双向传送带改变站位,尖刺带迫使玩家用下劈或冲刺过线。
  const g = grid(56, 17);
  rect(g, 14, 16, 0, 55, '#');
  rect(g, 13, 13, 18, 21, '^');
  rect(g, 11, 11, 8, 14, '=');
  rect(g, 8, 8, 24, 31, '=');
  rect(g, 11, 11, 38, 45, '=');
  set(g, 13, 16, 'K');
  set(g, 13, 34, 'k');
  set(g, 7, 27, '*');
  set(g, 10, 41, '*');
  set(g, 13, 12, '5');
  set(g, 13, 26, '4');
  set(g, 13, 31, '6');
  set(g, 13, 42, '3');
  set(g, 13, 46, '8'); // 迫击晶守熔铸台出口
  set(g, 13, 37, 'R'); // 镜弦猎兵
  set(g, 13, 50, 'h');
  R.push({
    id: 'hangar_foundry', zone: 'hangar', name: '机库 · 熔铸台', rows: rows(g),
    mapX: 15, mapY: 0,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'hangar_gate', ex: 36, ey: 9 },
      { side: 'right', from: 11, to: 13, target: 'hangar_catwalk', ex: 3, ey: 13 },
    ],
  });
}

{
  // 高空步道:支线信标;移动平台与上升气流把玩家送上壁架回装配线。
  const g = grid(60, 17);
  rect(g, 14, 16, 0, 59, '#');
  rect(g, 9, 10, 0, 6, '#'); // 装配线回程壁架
  rect(g, 11, 11, 3, 9, '=');
  rect(g, 8, 8, 18, 25, '=');
  rect(g, 11, 11, 30, 37, '=');
  rect(g, 6, 6, 42, 49, '#');
  set(g, 10, 20, 'M');
  set(g, 12, 33, 'U');
  set(g, 13, 14, 'K');
  set(g, 13, 44, 'k');
  set(g, 13, 26, 'T');
  set(g, 7, 22, '*');
  set(g, 5, 45, '*');
  set(g, 13, 34, '4');
  set(g, 13, 40, '6');
  set(g, 13, 52, '3');
  set(g, 13, 56, 'e');
  R.push({
    id: 'hangar_catwalk', zone: 'hangar', name: '机库 · 高空步道', rows: rows(g),
    mapX: 15, mapY: 2,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'hangar_foundry', ex: 52, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'hangar_hold', ex: 3, ey: 13 },
      { side: 'left', from: 6, to: 8, target: 'hangar_assembly', ex: 60, ey: 8 },
    ],
  });
}

{
  // 弹药舱:环线尽头的战斗房;补给闸开启后才能取到上层弦晶。
  const g = grid(48, 17);
  rect(g, 14, 16, 0, 47, '#');
  rect(g, 13, 13, 20, 23, '^');
  rect(g, 11, 11, 6, 13, '=');
  rect(g, 8, 8, 26, 33, 'H');
  rect(g, 5, 7, 36, 43, '#');
  set(g, 13, 17, 'K');
  set(g, 13, 30, 'k');
  set(g, 7, 30, '*');
  set(g, 4, 39, '*');
  set(g, 13, 14, '*');
  set(g, 13, 10, '5');
  set(g, 13, 26, '4');
  set(g, 13, 34, '6');
  set(g, 13, 44, '3');
  // 可破坏墙:弹药舱的封存格,从西侧平台横向击碎
  rect(g, 7, 11, 14, 20, '#');
  rect(g, 9, 10, 15, 19, '.');
  rect(g, 9, 10, 14, 14, '@');
  set(g, 10, 17, 'e');
  set(g, 9, 40, '7'); // 弦蛭:吊在弹药架顶板下
  R.push({
    id: 'hangar_hold', zone: 'hangar', name: '机库 · 弹药舱', rows: rows(g),
    mapX: 15, mapY: 3,
    shortcuts: [{
      id: 'hold_supply_gate', name: '弹药补给闸',
      gate: { col: 35, row: 11, w: 1, h: 3 },
      lever: { col: 12, row: 13 },
    }],
    exits: [
      { side: 'left', from: 11, to: 13, target: 'hangar_catwalk', ex: 56, ey: 13 },
    ],
  });
}

// ======== 跨区域过渡房 ========
// 过渡房保留独立加载,但在房间内部逐步混合两侧区域的色彩与标志性机关。

{
  // 海滨旧检修管:海风从右侧灌入,越过弦膜后逐渐显露研究设施的冷光。
  const g = grid(50, 17);
  rect(g, 14, 16, 0, 49, '#');
  rect(g, 8, 13, 24, 24, '%');
  rect(g, 10, 10, 15, 20, '=');
  rect(g, 8, 8, 28, 34, '=');
  set(g, 7, 31, '*');
  set(g, 13, 39, '2');
  R.push({
    id: 'pass_coast_lab_upper', zone: 'coast', name: '边界 · 旧检修管', rows: rows(g),
    mapX: 0, mapY: 2,
    transition: { to: 'lab', toSide: 'left' },
    exits: [
      { side: 'left', from: 11, to: 13, target: 'lab_lift', ex: 24, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'coast_start', ex: 3, ey: 13 },
    ],
  });
}

{
  // 灯芯输能廊:暖色供能管逐段变成研究区极性导轨。
  const g = grid(50, 17);
  rect(g, 14, 16, 0, 49, '#');
  rect(g, 9, 13, 35, 35, '&');
  rect(g, 10, 10, 11, 17, '=');
  rect(g, 8, 8, 25, 31, '=');
  set(g, 13, 29, 'I');
  set(g, 13, 18, '1');
  set(g, 7, 28, '*');
  R.push({
    id: 'pass_coast_lab_lower', zone: 'coast', name: '边界 · 灯芯输能廊', rows: rows(g),
    mapX: 1, mapY: 4,
    transition: { to: 'lab', toSide: 'right' },
    exits: [
      { side: 'left', from: 11, to: 13, target: 'coast_beacon', ex: 32, ey: 10 },
      { side: 'right', from: 11, to: 13, target: 'lab_lift', ex: 3, ey: 21 },
    ],
  });
}

{
  // 海堤排水闸:海滨石堤下沉为蓄水渠道,第一股压力流预告沉潮地窟。
  const g = grid(50, 17);
  rect(g, 14, 16, 0, 49, '#');
  rect(g, 12, 13, 11, 16, '#');
  rect(g, 10, 13, 17, 22, '#');
  rect(g, 12, 12, 28, 34, '=');
  set(g, 13, 26, '>');
  set(g, 13, 39, '5');
  set(g, 9, 20, '*');
  R.push({
    id: 'pass_coast_tide', zone: 'coast', name: '边界 · 海堤排水闸', rows: rows(g),
    mapX: 8, mapY: 6,
    transition: { to: 'tide', toSide: 'right' },
    exits: [
      { side: 'left', from: 11, to: 13, target: 'coast_tideworks', ex: 32, ey: 30 },
      { side: 'right', from: 11, to: 13, target: 'tide_entry', ex: 3, ey: 13 },
    ],
  });
}

{
  // 淹没检疫渠:潮压和极性膜在同一条短路线中交接,作为研究区机关的安全预演。
  const g = grid(50, 17);
  rect(g, 14, 16, 0, 49, '#');
  rect(g, 8, 13, 36, 36, '&');
  rect(g, 10, 10, 14, 20, '=');
  rect(g, 9, 9, 28, 33, '=');
  set(g, 13, 12, '>');
  set(g, 13, 31, 'I');
  set(g, 8, 30, '*');
  R.push({
    id: 'pass_tide_lab', zone: 'tide', name: '边界 · 淹没检疫渠', rows: rows(g),
    mapX: 6, mapY: 5,
    transition: { to: 'lab', toSide: 'right' },
    exits: [
      { side: 'left', from: 11, to: 13, target: 'tide_pumps', ex: 52, ey: 10 },
      { side: 'right', from: 11, to: 13, target: 'lab_gate', ex: 3, ey: 10 },
    ],
  });
}

{
  // 暗潮泄水井:隐藏舱口下的单向坠井,光色随下降逐步被深水吞没。
  const g = grid(24, 34);
  rect(g, 31, 33, 0, 23, '#');
  rect(g, 31, 33, 10, 12, '.');
  rect(g, 9, 9, 3, 8, '=');
  rect(g, 15, 15, 13, 19, '=');
  rect(g, 21, 21, 4, 10, '=');
  rect(g, 26, 26, 14, 20, '=');
  rect(g, 12, 24, 11, 11, '%');
  set(g, 19, 7, '*');
  set(g, 25, 17, '2');
  set(g, 30, 7, '>');
  R.push({
    id: 'pass_coast_tide_drop', zone: 'coast', name: '边界 · 暗潮泄水井', rows: rows(g),
    mapX: 3, mapY: 6, mapH: 2,
    transition: { to: 'tide', toSide: 'down' },
    exits: [
      { side: 'down', from: 10, to: 12, target: 'tide_cistern', ex: 4, ey: 4 },
    ],
  });
}

{
  // 隔离礼拜堂:实验隔舱改建的祈祷室,极性灯逐渐让位于周期共鸣。
  const g = grid(50, 17);
  rect(g, 14, 16, 0, 49, '#');
  rect(g, 8, 13, 18, 18, '&');
  rect(g, 10, 10, 25, 31, 'H');
  rect(g, 8, 8, 35, 41, 'H');
  set(g, 13, 13, 'I');
  set(g, 13, 34, 'O');
  set(g, 7, 38, '*');
  R.push({
    id: 'pass_lab_choir', zone: 'lab', name: '边界 · 隔离礼拜堂', rows: rows(g),
    mapX: 3, mapY: 1,
    transition: { to: 'choir', toSide: 'right' },
    exits: [
      { side: 'left', from: 11, to: 13, target: 'lab_gate', ex: 40, ey: 10 },
      { side: 'right', from: 11, to: 13, target: 'choir_nave', ex: 3, ey: 13 },
    ],
  });
}

{
  // 外部观测梯:封闭实验走廊破开穹顶,极性膜后的气流托起纸片。
  const g = grid(50, 17);
  rect(g, 14, 16, 0, 49, '#');
  rect(g, 8, 13, 23, 23, '&');
  rect(g, 8, 8, 29, 35, '=');
  rect(g, 6, 6, 39, 45, '=');
  set(g, 13, 17, 'I');
  set(g, 13, 33, 'U');
  set(g, 5, 42, '*');
  R.push({
    id: 'pass_lab_sky', zone: 'lab', name: '边界 · 外部观测梯', rows: rows(g),
    mapX: 7, mapY: 0,
    transition: { to: 'sky', toSide: 'right' },
    exits: [
      { side: 'left', from: 11, to: 13, target: 'lab_matrix', ex: 37, ey: 10 },
      { side: 'right', from: 11, to: 13, target: 'sky_gate', ex: 4, ey: 46 },
    ],
  });
}

{
  // 破顶钟廊:共鸣台阶一路显形到露天缺口,高处气流接管移动节奏。
  const g = grid(50, 17);
  rect(g, 14, 16, 0, 49, '#');
  rect(g, 11, 11, 12, 18, 'H');
  rect(g, 8, 8, 24, 30, 'H');
  rect(g, 6, 6, 37, 43, '=');
  set(g, 13, 20, 'O');
  set(g, 13, 34, 'U');
  set(g, 5, 40, '*');
  R.push({
    id: 'pass_choir_sky', zone: 'choir', name: '边界 · 破顶钟廊', rows: rows(g),
    mapX: 5, mapY: 1,
    transition: { to: 'sky', toSide: 'right' },
    exits: [
      { side: 'left', from: 11, to: 13, target: 'choir_belfry', ex: 32, ey: 9 },
      { side: 'right', from: 11, to: 13, target: 'sky_gate', ex: 4, ey: 25 },
    ],
  });
}

{
  // 发射塔外缘:开放风道逐渐收束成机库输送线,最后一段让气流和传送带叠加。
  const g = grid(50, 17);
  rect(g, 14, 16, 0, 49, '#');
  rect(g, 10, 10, 10, 16, '=');
  rect(g, 8, 8, 22, 28, '=');
  rect(g, 10, 10, 35, 41, '=');
  set(g, 13, 14, 'U');
  set(g, 13, 31, 'K');
  set(g, 13, 41, 'k');
  set(g, 7, 25, '*');
  set(g, 13, 44, '4');
  R.push({
    id: 'pass_sky_hangar', zone: 'sky', name: '边界 · 发射塔外缘', rows: rows(g),
    mapX: 12, mapY: 2,
    transition: { to: 'hangar', toSide: 'right' },
    exits: [
      { side: 'left', from: 11, to: 13, target: 'sky_peak', ex: 52, ey: 9 },
      { side: 'right', from: 11, to: 13, target: 'hangar_assembly', ex: 3, ey: 13 },
    ],
  });
}

// ---------------- 导出 ----------------

export const ROOMS: Record<string, RoomDef> = Object.fromEntries(R.map((r) => [r.id, r]));
export const ROOM_LIST: RoomDef[] = R;
export const START_ROOM = 'coast_start';
export const SHORTCUT_IDS = new Set(ROOM_LIST.flatMap((room) => room.shortcuts?.map((s) => s.id) ?? []));

export const ABILITY_INFO: Record<Ability, { name: string; desc: string; hint: string }> = {
  kinetic: {
    name: '雷行电容',
    desc: '持续移动积蓄电荷,满充后攻击导能节点即可点亮回路',
    hint: '奔跑蓄电 · 满充后 K 击节点',
  },
  skystep: {
    name: '踏空蓄步',
    desc: '获得按时间充能的第三跳,滞空时也会继续充能',
    hint: '空中再按一次跳跃 · 虚步约6秒充能',
  },
  flash: {
    name: '弦闪',
    desc: '敌弹临身的瞬间弦化,可擦开子弹并强化下一次攻击',
    hint: '子弹将至的一瞬 按住Shift',
  },
  paper: {
    name: '弦 化',
    desc: '身体展开为二维纸片。地面弦化可穿弦膜,空中弦化会随风飘飞。',
    hint: '按住 Shift 弦化 · 离地后进入飘飞',
  },
  cling: {
    name: '矩阵适配',
    desc: '巴布洛矩阵认可了你。纸片形态可以贴附墙面。',
    hint: '靠墙按 E 吸附 · W / S 移动 · E 脱离',
  },
  djump: {
    name: '弦 翼',
    desc: '弦能在身后织出微光之翼。',
    hint: '空中再次按 W / 空格 跳跃',
  },
  dash: {
    name: '相位突进',
    desc: '短距弦相位跃迁,身影破空而行。',
    hint: '按 U / ; 冲刺 · 空中限一次',
  },
  kanami: {
    name: '香奈美加入了队伍!',
    desc: '「初次见面,我叫香奈美。准备好跟随我的歌声了吗?」',
    hint: '按 Q 切换角色 · 长按 J 蓄力射击',
  },
};

export interface ShopItem {
  id: string;
  name: string;
  desc: string;
  cost: number;
  /**
   * 可重复购买的条目。晶尘是**可再生**资源(敌人随房间重入刷新),
   * 而一次性商品的总价是有限的 —— 只有一次性商品时,晶尘必然在中盘变成纯噪音。
   * 递增价格给它一个永远填不满的去处。
   */
  repeatable?: { hpBonus: number; costStep: number; max: number };
}

/** 第 n 次(从 0 起)购买该可重复条目的价格。 */
export function repeatableCost(item: ShopItem, owned: number): number {
  return item.cost + (item.repeatable?.costStep ?? 0) * owned;
}

export interface HiddenChip {
  id: string;
  name: string;
  desc: string;
}

/** 支线尽头的独有遗珍,不进入商店。 */
export const HIDDEN_CHIPS: HiddenChip[] = [
  { id: 'relic_beacon', name: '遗珍·不熄灯芯', desc: '生命上限 +10' },
  { id: 'relic_tide', name: '遗珍·沉潮薄鳃', desc: '空中飘飞的弦能消耗 -25%' },
  { id: 'relic_echo', name: '遗珍·无词音叉', desc: '隐藏平台显形时间延长至 9 秒' },
  { id: 'relic_reactor', name: '遗珍·余热电枢', desc: '相位突进恢复时间 -40%' },
];

export const HIDDEN_CHIP_MARKERS: Readonly<Record<string, string>> = {
  a: 'relic_beacon',
  b: 'relic_tide',
  c: 'relic_echo',
  d: 'relic_reactor',
};

/** 引航者商店:记忆芯片(购入后永久生效) */
// 单程晶尘产出约 780(133 敌人 + 4 Boss),而原先全店只要 260 —— 三倍供过于求,
// 且敌人随房间重入刷新,实际供给无上限。下面把一次性商品补到 460,
// 再加一个价格递增的可重复条目(6 次共 720),让晶尘在全程都还有去处。
export const SHOP_ITEMS: ShopItem[] = [
  { id: 'chip_hp', name: '记忆芯片·强健弦芯', desc: '生命上限 +25(购入时立即回复)', cost: 80 },
  { id: 'chip_blade', name: '记忆芯片·利刃回响', desc: '近战伤害 +30%', cost: 70 },
  { id: 'chip_regen', name: '记忆芯片·快弦回路', desc: '弦能回复速度 +40%', cost: 60 },
  { id: 'chip_magnet', name: '记忆芯片·晶尘磁石', desc: '晶尘吸取范围大幅扩大', cost: 50 },
  { id: 'chip_quarry', name: '记忆芯片·裂石之握', desc: '近战拆可破坏墙的效率翻倍', cost: 90 },
  { id: 'chip_guard', name: '记忆芯片·潮汐外壳', desc: '受击后的无敌时间 +25%', cost: 110 },
  {
    id: 'forge_core',
    name: '弦芯熔铸',
    desc: '生命上限 +4(可重复,价格递增)',
    cost: 45,
    repeatable: { hpBonus: 4, costStep: 30, max: 6 },
  },
];

/** 一次性芯片(不含可重复条目)—— 完成度统计与存档白名单都只认这一批。 */
export const SHOP_CHIPS: ShopItem[] = SHOP_ITEMS.filter((item) => !item.repeatable);

export interface CrystalMilestone {
  count: number;
  name: string;
  desc: string;
  hpBonus?: number;
  energyBonus?: number;
}

/** 弦晶不再只是计数:四段共鸣提供可感知的永久成长。 */
// 里程碑必须覆盖弦晶总量的绝大部分。原先最后一档停在 42,而世界里有 80 枚 ——
// 也就是说后半程 47.5% 的收集品在机制上毫无作用,探索到一半奖励曲线就断了。
// 末档定在 68/80(85%)而不是 80:最后一档不该要求完美收集,留 12 枚容错。
// check-maps 会校验末档确实落在总量的 80%–90% 区间,防止世界扩张后这条曲线再次断掉。
export const CRYSTAL_MILESTONES: CrystalMilestone[] = [
  { count: 8, name: '微光共鸣', desc: '弦能上限 +10', energyBonus: 10 },
  { count: 18, name: '稳固共鸣', desc: '生命上限 +10', hpBonus: 10 },
  { count: 30, name: '潮汐共鸣', desc: '弦能上限 +15', energyBonus: 15 },
  { count: 42, name: '弦界共鸣', desc: '生命上限 +15', hpBonus: 15 },
  { count: 54, name: '涌流共鸣', desc: '弦能上限 +15', energyBonus: 15 },
  { count: 68, name: '万弦共鸣', desc: '生命上限 +20', hpBonus: 20 },
];

export const FORGE_ITEM = SHOP_ITEMS.find((item) => item.id === 'forge_core')!;
/** 弦芯熔铸的合法层数上限 —— 存档校验与购买逻辑共用这一个来源。 */
export const FORGE_MAX = FORGE_ITEM.repeatable?.max ?? 0;

export function progressionStats(
  crystalCount: number,
  chips: ReadonlySet<string>,
  forgeLevel = 0,
): { hpMax: number; energyMax: number } {
  let hpMax = MAX_HP;
  let energyMax = MAX_STRING;
  if (chips.has('chip_hp')) hpMax += 25;
  if (chips.has('relic_beacon')) hpMax += 10;
  hpMax += Math.max(0, Math.min(FORGE_MAX, forgeLevel)) * (FORGE_ITEM.repeatable?.hpBonus ?? 0);
  for (const milestone of CRYSTAL_MILESTONES) {
    if (crystalCount < milestone.count) continue;
    hpMax += milestone.hpBonus ?? 0;
    energyMax += milestone.energyBonus ?? 0;
  }
  return { hpMax, energyMax };
}

/** 全世界弦晶总数(静态统计) */
export function totalCrystals(): number {
  let n = 0;
  for (const r of ROOM_LIST) {
    for (const line of r.rows) {
      for (const ch of line) if (ch === '*') n++;
    }
  }
  return n;
}
