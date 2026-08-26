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

// 弦闪(能力 flash):敌弹临身的瞬间弦化 → 擦弹 → 强化下一击
export const FLASH_WINDOW = 0.14; // 进入纸片后多久内算"精准"
export const FLASH_CHARGE = 4.0; // 强化窗口持续秒数
export const FLASH_MULT = 1.8; // 下一击伤害倍率
export const FLASH_ENERGY_REFUND = 10; // 触发时返还弦能,鼓励继续弦化节奏

export const COLORS = {
  hud: '#e8ecff',
  hp: '#ff5d7e',
  hpBack: '#3a1626',
  str: '#7ef0ff',
  strBack: '#12303a',
  michele: '#8fd7ff',
  kanami: '#ff9fd0',
};
