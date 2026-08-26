// 逻辑分辨率(像素风,按整数倍缩放到屏幕)
export const VIEW_W = 480;
export const VIEW_H = 270;

export const TILE = 16;
export const DT = 1 / 60;

export const GRAVITY = 1350;
export const MAX_FALL = 380;

// 玩家
export const PLAYER_W = 10;
export const PLAYER_H = 20;
export const RUN_SPEED = 118;
export const RUN_ACCEL = 1400;
export const AIR_ACCEL = 950;
export const JUMP_VEL = 320;
export const DOUBLE_JUMP_VEL = 290;
export const COYOTE_TIME = 0.09;
export const JUMP_BUFFER = 0.12;

export const MAX_HP = 100;
export const MAX_STRING = 100; // 弦能
export const STRING_DRAIN = 34; // 每秒消耗
export const STRING_REGEN = 26; // 每秒恢复
export const PAPER_SPEED_MULT = 0.82;
export const WALL_SLIDE_SPEED = 110;
export const GLIDE_FALL_SPEED = 42;
export const GLIDE_GRAVITY_MULT = 0.22;
export const GLIDE_STRING_DRAIN = 24;
export const WALL_STRING_DRAIN = 12;
export const WALL_JUMP_VX = 175;
export const WALL_JUMP_VY = 300;

export const DASH_SPEED = 330; // 相位突进
export const DASH_TIME = 0.16;
export const DASH_CD = 0.5;
export const POGO_VEL = 290; // 下劈反弹

export const INVULN_TIME = 1.0; // 受击无敌
export const SWITCH_CD = 0.6;

// 踏空蓄步(能力 skystep):按时间再生的第三跳,空中也继续充能
export const SKYSTEP_CD = 6.0; // 原作诺诺被动 2026-07 调整后的 6 秒
export const SKYSTEP_VEL = 268; // 略低于二段跳,定位是"续一口",不是更高的跳

// 雷行电容(能力 kinetic):持续移动蓄电,满充后命中导能节点点亮回路
export const KINETIC_BUILD_TIME = 2.4; // 持续移动多久充满
export const KINETIC_DECAY = 0.25; // 静止时每秒衰减
export const NODE_LIT_TIME = 4.5; // 回路点亮秒数

// 弦闪(能力 flash):敌弹临身的瞬间弦化 → 擦弹 → 强化下一击
export const FLASH_WINDOW = 0.14; // 进入纸片后多久内算"精准"
export const FLASH_CHARGE = 4.0; // 强化窗口持续秒数
export const FLASH_MULT = 1.8; // 下一击伤害倍率
export const FLASH_ENERGY_REFUND = 10; // 触发时返还弦能,鼓励继续弦化节奏

// ---- 地形词汇(Phase 1)----
// 可破坏墙(tile @):近战一击顶数发子弹,鼓励贴脸拆墙而不是站远处点射
export const BREAKABLE_HITS = 6; // 累计"点数"达到即碎
export const BREAKABLE_MELEE_HITS = 3; // 一次近战计 3 点 → 两刀拆一格
// 碎裂平台(tile !):塌落后必定重建,否则单块平台过河会造成不可逆卡关
export const CRUMBLE_DELAY = 0.45; // 踩住多久开始塌
export const CRUMBLE_RESPAWN = 2.5; // 塌落后多久重建
// 荆棘(tile ;):非致死减速带 —— 疼且慢,但不击退不弹起,给"硬闯"留成本可控的选项
export const THORN_DMG = 4;
export const THORN_SLOW_TIME = 0.6;
export const THORN_SLOW_MULT = 0.6; // 减速 40%
// 冰面(tile :):加速与减速共用同一个 accel 项,所以压低它即可同时得到"推不动"与"刹不住"
export const ICE_ACCEL_MULT = 0.35;

// 水体(tile ~):半高浮力区
export const WATER_SPEED_MULT = 0.45; // 水中水平速度 −55%
export const WATER_JUMP_MULT = 0.7; // 水中起跳 −30%
export const WATER_GRAVITY_MULT = 0.28; // 缓沉而不是直坠
export const WATER_MAX_SINK = 70; // 下沉终速

// 吊链(tile |):无能力需求的纵向抓附
export const CHAIN_CLIMB_SPEED = 74;
export const CHAIN_RELEASE_VX = 96; // 松手蹬离链条的水平初速

// 暗区(RoomDef.dark)
export const DARK_VISION_RADIUS = 90; // 玩家周围的可见半径
export const DARK_SONAR_LIGHT = 1.6; // 声呐照亮全屏的持续秒数

export const COLORS = {
  hud: '#e8ecff',
  hp: '#ff5d7e',
  hpBack: '#3a1626',
  str: '#7ef0ff',
  strBack: '#12303a',
  michele: '#8fd7ff',
  kanami: '#ff9fd0',
};
