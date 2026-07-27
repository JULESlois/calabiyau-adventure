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
export const PAPER_SPEED_MULT = 1.3;
export const WALL_SLIDE_SPEED = 55;
export const WALL_JUMP_VX = 175;
export const WALL_JUMP_VY = 300;

export const DASH_SPEED = 330; // 相位突进
export const DASH_TIME = 0.16;
export const DASH_CD = 0.5;
export const POGO_VEL = 290; // 下劈反弹

export const INVULN_TIME = 1.0; // 受击无敌
export const SWITCH_CD = 0.6;

export const COLORS = {
  hud: '#e8ecff',
  hp: '#ff5d7e',
  hpBack: '#3a1626',
  str: '#7ef0ff',
  strBack: '#12303a',
  michele: '#8fd7ff',
  kanami: '#ff9fd0',
};
