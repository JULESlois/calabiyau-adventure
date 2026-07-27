// 世界数据:场景(Zone)与房间(Room)图。
// 每个场景包含多个互联房间(类似渎神/空洞骑士),房间之间通过边缘出口连接。
//
// 房间网格用建造函数生成(rect/set),避免手写 ASCII 对齐错误。
// 图例(与旧版一致,新增几种):
//   #  实体砖块      =  单向平台      ^  尖刺        %  弦膜(纸片形态可穿过)
//   H  隐藏平台(香奈美声呐显形后短暂实体化)
//   P  新游戏出生点  T  调弦台(休息点/重生锚)      E  终局传送门(Boss 房)
//   F  能力·弦化     W  能力·矩阵适配(蹬墙跳)      J  能力·弦翼(二段跳)
//   D  能力·相位突进(冲刺)      S  引航者商人(记忆芯片商店)
//   G  香奈美(救援,解锁切换角色)
//   *  弦晶(全局唯一,拾取后永久记录)  h  回复心  e  弦能电池
//   1  巡逻机器人    2  浮游炮        3  炮塔      4  盾卫
//   M  横向移动平台  N  纵向移动平台  B  Boss

import type { LevelTheme } from '../levels/levels';

export type Ability = 'paper' | 'cling' | 'djump' | 'dash' | 'kanami';
export type ZoneId = 'coast' | 'lab' | 'sky' | 'hangar';
export type ExitSide = 'left' | 'right' | 'down';

export interface ZoneDef {
  id: ZoneId;
  name: string;
  subtitle: string;
  song: number;
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
}

// ---------------- 场景定义(沿用四关的主题与配乐) ----------------

export const ZONES: Record<ZoneId, ZoneDef> = {
  coast: {
    id: 'coast',
    name: '海滨长廊',
    subtitle: '欧拉海滨市郊,失控的安保机器人开始游荡……',
    song: 1,
    theme: {
      skyTop: '#1c0f2e', skyBottom: '#c2541e', far: '#472441', mid: '#2f1a33',
      near: '#1c1024', tileBase: '#3e3448', tileEdge: '#c08a5a', tileDark: '#231c2c',
      accent: '#e8b06a', fog: 'rgba(200,110,60,0.10)', ember: '#ffb066',
      ambient: 'rgba(200,110,60,0.06)',
    },
  },
  lab: {
    id: 'lab',
    name: '中央研究区',
    subtitle: '深入米斯忒篷研究设施,弦膜封锁了通路。',
    song: 2,
    theme: {
      skyTop: '#060812', skyBottom: '#182448', far: '#1c2444', mid: '#121a34',
      near: '#0a1020', tileBase: '#2a2c44', tileEdge: '#9aa8d8', tileDark: '#161828',
      accent: '#7ef0ff', fog: 'rgba(100,130,200,0.09)', ember: '#aac8e8',
      ambient: 'rgba(90,120,200,0.05)',
    },
  },
  sky: {
    id: 'sky',
    name: '天穹回廊',
    subtitle: '通往塔顶的空中走廊,弦化是唯一的通行证。',
    song: 3,
    theme: {
      skyTop: '#3a4468', skyBottom: '#a8b0cc', far: '#8890b0', mid: '#666e92',
      near: '#4a5274', tileBase: '#565c78', tileEdge: '#d0d6ec', tileDark: '#383e56',
      accent: '#f0ecd8', fog: 'rgba(200,210,235,0.12)', ember: '#e0e6f4',
      ambient: 'rgba(190,200,230,0.06)',
    },
  },
  hangar: {
    id: 'hangar',
    name: '塔顶机库',
    subtitle: '「守望者 MK-III」在此沉眠。终结这一切吧!',
    song: 4,
    theme: {
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

function rows(g: Grid): string[] {
  return g.map((r) => r.join(''));
}

// ---------------- 房间建造 ----------------
// 手感参考:单跳可越 2 格高 / 3 格宽沟;二段跳约 4 格高 / 6 格宽;
// 蹬墙跳适用于宽 2~4 格的竖井。标准房高 17(一屏),竖井房 34/51。

const R: RoomDef[] = [];

// ======== 海滨长廊 coast ========

{
  // 起点:调弦台、教学空间。左侧弦膜门通往升降井(捷径,需弦化)。
  const g = grid(50, 17);
  rect(g, 14, 16, 0, 49, '#');
  rect(g, 11, 13, 1, 1, '%'); // 左侧弦膜封门
  set(g, 13, 9, 'P');
  set(g, 13, 20, 'T');
  rect(g, 12, 12, 25, 28, '='); // 台阶
  rect(g, 10, 10, 30, 33, '='); // 观景台
  set(g, 9, 31, '*');
  R.push({
    id: 'coast_start', zone: 'coast', name: '海滨 · 灯塔下', rows: rows(g),
    mapX: 2, mapY: 2,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'lab_lift', ex: 24, ey: 13, needs: ['paper'] },
      { side: 'right', from: 11, to: 13, target: 'coast_walk', ex: 3, ey: 13 },
    ],
  });
}

{
  // 长廊:巡逻机器人;地板中部有弦膜舱口,坠入研究区(需弦化)。
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
  R.push({
    id: 'coast_walk', zone: 'coast', name: '海滨 · 长廊', rows: rows(g),
    mapX: 3, mapY: 2,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'coast_start', ex: 46, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'coast_cliff', ex: 3, ey: 13 },
      { side: 'down', from: 30, to: 32, target: 'lab_gate', ex: 11, ey: 2, needs: ['paper'] },
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
  rect(g, 13, 13, 40, 42, '^'); // 地表尖刺
  set(g, 13, 50, '1');
  set(g, 13, 55, '6'); // 刺镰魔怪
  set(g, 11, 23, '*');
  // 二段跳回访:高处平台(距地 4 格,单跳不可及)
  rect(g, 10, 10, 33, 36, '#');
  set(g, 9, 34, '*');
  R.push({
    id: 'coast_cliff', zone: 'coast', name: '海滨 · 断崖', rows: rows(g),
    mapX: 4, mapY: 2,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'coast_walk', ex: 60, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'coast_shrine', ex: 3, ey: 13 },
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
  set(g, 13, 37, '*');
  R.push({
    id: 'coast_shrine', zone: 'coast', name: '海滨 · 弦之祭坛', rows: rows(g),
    mapX: 5, mapY: 2,
    exits: [{ side: 'left', from: 11, to: 13, target: 'coast_cliff', ex: 56, ey: 13 }],
  });
}

// ======== 中央研究区 lab ========

{
  // 升降井:连接海滨与研究区的捷径竖井,需蹬墙跳攀回。
  const g = grid(28, 34);
  rect(g, 31, 33, 0, 27, '#'); // 底部地面
  rect(g, 14, 16, 17, 27, '#'); // 顶部平台(通往海滨)
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
      { side: 'right', from: 11, to: 13, target: 'coast_start', ex: 3, ey: 13, needs: ['cling'] },
      { side: 'right', from: 28, to: 30, target: 'lab_gate', ex: 3, ey: 13 },
    ],
  });
}

{
  // 门厅:自长廊坠入之处;调弦台。
  const g = grid(56, 17);
  rect(g, 14, 16, 0, 55, '#');
  set(g, 13, 18, 'T');
  set(g, 13, 30, 'S'); // 引航者商人
  rect(g, 12, 12, 26, 29, '=');
  set(g, 13, 44, '3');
  set(g, 13, 50, 'h');
  R.push({
    id: 'lab_gate', zone: 'lab', name: '研究区 · 门厅', rows: rows(g),
    mapX: 3, mapY: 3,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'lab_lift', ex: 24, ey: 30 },
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
  rect(g, 12, 13, 41, 42, '#'); // 登牢台阶
  R.push({
    id: 'lab_cells', zone: 'lab', name: '研究区 · 拘留舱', rows: rows(g),
    mapX: 4, mapY: 3,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'lab_gate', ex: 52, ey: 13 },
      { side: 'right', from: 11, to: 13, target: 'lab_maze', ex: 3, ey: 13 },
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
  R.push({
    id: 'lab_maze', zone: 'lab', name: '研究区 · 弦膜密室', rows: rows(g),
    mapX: 5, mapY: 3,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'lab_cells', ex: 60, ey: 13 },
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
      { side: 'left', from: 8, to: 10, target: 'lab_maze', ex: 52, ey: 13 },
      { side: 'right', from: 8, to: 10, target: 'sky_gate', ex: 4, ey: 46 },
    ],
  });
}

// ======== 天穹回廊 sky ========

{
  // 天穹竖廊:三屏高的攀爬井。
  const g = grid(30, 51);
  rect(g, 47, 49, 0, 29, '#'); // 底部
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
      { side: 'left', from: 44, to: 46, target: 'lab_matrix', ex: 37, ey: 10, needs: ['cling'] },
      { side: 'right', from: 8, to: 10, target: 'sky_corridor', ex: 3, ey: 13, needs: ['cling'] },
    ],
  });
}

{
  // 天穹回廊:调弦台;上层高台需「弦翼」(二段跳)。
  const g = grid(64, 17);
  rect(g, 14, 16, 0, 63, '#');
  set(g, 13, 12, 'T');
  rect(g, 12, 12, 24, 26, '=');
  // 高台:距地面 4 格,需二段跳
  rect(g, 10, 10, 38, 63, '#');
  set(g, 9, 42, '*');
  set(g, 13, 30, '2');
  set(g, 13, 40, '5'); // 爆裂魔怪
  set(g, 13, 48, '3');
  set(g, 13, 56, 'h');
  R.push({
    id: 'sky_corridor', zone: 'sky', name: '天穹 · 回廊', rows: rows(g),
    mapX: 8, mapY: 1,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'sky_gate', ex: 25, ey: 10 },
      { side: 'right', from: 11, to: 13, target: 'sky_wing', ex: 3, ey: 13 },
      { side: 'right', from: 7, to: 9, target: 'sky_peak', ex: 3, ey: 13, needs: ['djump'] },
    ],
  });
}

{
  // 弦翼圣所:守卫战后获得「弦翼」。
  const g = grid(48, 17);
  rect(g, 14, 16, 0, 47, '#');
  set(g, 13, 20, '2');
  set(g, 13, 26, '4');
  set(g, 13, 32, '6'); // 刺镰魔怪
  set(g, 13, 36, '3');
  rect(g, 12, 13, 41, 41, '#');
  set(g, 13, 43, 'J');
  rect(g, 10, 10, 8, 11, '='); // 二段跳可及的高台
  set(g, 9, 9, '*');
  R.push({
    id: 'sky_wing', zone: 'sky', name: '天穹 · 弦翼圣所', rows: rows(g),
    mapX: 9, mapY: 1,
    exits: [{ side: 'left', from: 11, to: 13, target: 'sky_corridor', ex: 60, ey: 13 }],
  });
}

{
  // 天穹之巅:浮岛跳跃(需二段跳),通往机库。
  const g = grid(56, 17);
  rect(g, 14, 16, 0, 8, '#'); // 入口岛
  rect(g, 12, 14, 14, 18, '#');
  rect(g, 10, 12, 24, 28, '#');
  rect(g, 8, 10, 33, 37, '#');
  rect(g, 6, 16, 43, 55, '#'); // 终端高塔
  set(g, 11, 16, '*');
  set(g, 7, 35, '*');
  rect(g, 8, 8, 19, 22, 'H'); // 隐藏平台(声呐显形)
  set(g, 7, 20, '*');
  set(g, 13, 20, '2');
  set(g, 9, 31, '2');
  R.push({
    id: 'sky_peak', zone: 'sky', name: '天穹 · 之巅', rows: rows(g),
    mapX: 9, mapY: 0,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'sky_corridor', ex: 60, ey: 9 },
      { side: 'right', from: 3, to: 5, target: 'hangar_gate', ex: 3, ey: 13 },
    ],
  });
}

// ======== 塔顶机库 hangar ========

{
  // 机库前厅:大战前的宁静;调弦台。
  const g = grid(40, 17);
  rect(g, 14, 16, 0, 39, '#');
  set(g, 13, 16, 'T');
  set(g, 13, 24, 'h');
  set(g, 13, 27, 'e');
  R.push({
    id: 'hangar_gate', zone: 'hangar', name: '机库 · 前厅', rows: rows(g),
    mapX: 10, mapY: 0,
    exits: [
      { side: 'left', from: 11, to: 13, target: 'sky_peak', ex: 52, ey: 5 },
      { side: 'right', from: 11, to: 13, target: 'hangar_boss', ex: 3, ey: 13 },
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
    mapX: 11, mapY: 0,
    exits: [{ side: 'left', from: 11, to: 13, target: 'hangar_gate', ex: 36, ey: 13 }],
  });
}

// ---------------- 导出 ----------------

export const ROOMS: Record<string, RoomDef> = Object.fromEntries(R.map((r) => [r.id, r]));
export const ROOM_LIST: RoomDef[] = R;
export const START_ROOM = 'coast_start';

export const ABILITY_INFO: Record<Ability, { name: string; desc: string; hint: string }> = {
  paper: {
    name: '弦 化',
    desc: '身体展开为二维纸片,敌人的子弹将穿身而过。',
    hint: '按住 Shift 弦化 · 可穿过粉色弦膜',
  },
  cling: {
    name: '矩阵适配',
    desc: '巴布洛矩阵认可了你。纸片形态可以贴附墙面。',
    hint: '弦化中贴墙滑行 · 跳跃蹬墙而上',
  },
  djump: {
    name: '弦 翼',
    desc: '弦能在身后织出微光之翼。',
    hint: '空中可再次跳跃',
  },
  dash: {
    name: '相位突进',
    desc: '短距弦相位跃迁,身影破空而行。',
    hint: '按 U 或 ; 冲刺 · 空中限一次',
  },
  kanami: {
    name: '香奈美加入了队伍!',
    desc: '「初次见面,我叫香奈美。准备好跟随我的歌声了吗?」',
    hint: '按 Q 切换 · 长按 J 蓄力狙击 · 声呐能显形隐藏之物',
  },
};

export interface ShopItem {
  id: string;
  name: string;
  desc: string;
  cost: number;
}

/** 引航者商店:记忆芯片(购入后永久生效) */
export const SHOP_ITEMS: ShopItem[] = [
  { id: 'chip_hp', name: '记忆芯片·强健弦芯', desc: '生命上限 +25(购入时立即回复)', cost: 80 },
  { id: 'chip_blade', name: '记忆芯片·利刃回响', desc: '近战伤害 +30%', cost: 70 },
  { id: 'chip_regen', name: '记忆芯片·快弦回路', desc: '弦能回复速度 +40%', cost: 60 },
  { id: 'chip_magnet', name: '记忆芯片·晶尘磁石', desc: '晶尘吸取范围大幅扩大', cost: 50 },
];

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
