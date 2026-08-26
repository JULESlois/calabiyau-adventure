import type { TileStyle } from '../render/tileStyles';

// tile 解析与常量。房间数据见 ../world/world.ts。
// 图例:
//   #  实体砖块        =  单向平台        ^  尖刺        %  弦膜(纸片形态可穿过)
//   H  隐藏平台(香奈美的声呐显形后短暂实体化)  &  极性弦膜(I 终端切换)
//   @  可破坏墙(击打若干次后永久碎裂)      !  碎裂平台(踩上后塌落,离房重置)
//   ;  荆棘(非致死减速带)                 :  冰面(低摩擦地表)
//   ~  水体(浮力区;纸片入水强制展开)      |  吊链(无能力需求的纵向抓附)
//   其余字符视为实体生成点(spawns),由 PlayState 解释。
//
// 地形 tile 一律用标点,生成符一律用字母数字 —— 见 docs/ROADMAP.md 的字符命名空间。

/**
 * 区域大气。
 * 在此之前六个区域共用同一套雾霭/微粒处理,只差颜色 ——
 * 而"空气的浓稠程度"比色相更能把地方区分开:机库该是呛人的,天穹该是稀薄的。
 */
export interface ZoneAtmosphere {
  /** 层间雾带的浓度倍率(1 = 原样) */
  fogDensity: number;
  /** 雾带高度(px) */
  fogBand: number;
  /** 环境微粒 */
  drift: {
    /** 只影响观感命名与绘制细节 */
    kind: 'ember' | 'bubble' | 'dust' | 'mote' | 'snow' | 'soot' | 'lantern';
    count: number;
    /** 边长(px) */
    size: number;
    /** 纵向速度基数:正=下沉,负=上升,0=悬浮 */
    speed: number;
    /** 横向摆幅 */
    sway: number;
  };
  /** 斜向光束 */
  rays: 'none' | 'warm' | 'cold';
}

export interface LevelTheme {
  /**
   * 地形材质(砌法)。颜色之外的第二个区域身份维度 ——
   * 在此之前六区共用同一种砖,只换颜色,而地面占满每一帧的下半屏。
   */
  tileStyle: TileStyle;
  /** 大气(雾浓度、微粒、光束)——区域身份的第三个维度,在颜色与材质之外。 */
  atmosphere: ZoneAtmosphere;
  skyTop: string;
  skyBottom: string;
  far: string;
  mid: string;
  near: string;
  tileBase: string;
  tileEdge: string; // 顶部石雕线脚 / 月光描边
  tileDark: string;
  accent: string; // 主题点缀色(烛火/霓虹/雪光/警灯)
  fog: string; // 雾霭带(含透明度)
  ember: string; // 环境飘浮微粒(余烬/尘埃/落灰)
  ambient: string; // 前景氛围色罩(含透明度)
}

// Tile 常量
export const T_EMPTY = 0;
export const T_SOLID = 1;
export const T_ONEWAY = 2;
export const T_SPIKE = 3;
export const T_MEMBRANE = 4;
export const T_HIDDEN = 5; // 隐藏平台:被声呐显形后短暂实体化
export const T_POLARITY = 6; // 研究区极性弦膜:由房间终端切换
export const T_BREAKABLE = 7; // 可破坏墙:未碎时等同实体,碎裂永久写入存档
export const T_CRUMBLE = 8; // 碎裂平台:踩住片刻后塌落,过一会儿重建
export const T_THORN = 9; // 荆棘:不实体,接触掉血并减速(与尖刺的击退区分)
export const T_ICE = 10; // 冰面:实体地表,加减速都被压低
export const T_WATER = 11; // 水体:不实体的浮力区;纸片入水强制展开(纸会湿)
export const T_CHAIN = 12; // 吊链:不实体,可抓附纵向移动 —— 不需要任何能力

export interface SpawnPoint {
  char: string;
  col: number;
  row: number;
}

export interface ParsedRows {
  w: number;
  h: number;
  tiles: Uint8Array;
  spawns: SpawnPoint[];
}

export function parseRows(rows: string[]): ParsedRows {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const tiles = new Uint8Array(w * h);
  const spawns: SpawnPoint[] = [];
  for (let r = 0; r < h; r++) {
    const line = rows[r];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      switch (ch) {
        case '#': tiles[r * w + c] = T_SOLID; break;
        case '=': tiles[r * w + c] = T_ONEWAY; break;
        case '^': tiles[r * w + c] = T_SPIKE; break;
        case '%': tiles[r * w + c] = T_MEMBRANE; break;
        case 'H': tiles[r * w + c] = T_HIDDEN; break;
        case '&': tiles[r * w + c] = T_POLARITY; break;
        case '@': tiles[r * w + c] = T_BREAKABLE; break;
        case '!': tiles[r * w + c] = T_CRUMBLE; break;
        case ';': tiles[r * w + c] = T_THORN; break;
        case ':': tiles[r * w + c] = T_ICE; break;
        case '~': tiles[r * w + c] = T_WATER; break;
        case '|': tiles[r * w + c] = T_CHAIN; break;
        case '.': case ' ': break;
        default:
          spawns.push({ char: ch, col: c, row: r });
          break;
      }
    }
  }
  return { w, h, tiles, spawns };
}
