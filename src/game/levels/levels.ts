// tile 解析与常量。房间数据见 ../world/world.ts。
// 图例:
//   #  实体砖块        =  单向平台        ^  尖刺        %  弦膜(纸片形态可穿过)
//   H  隐藏平台(香奈美的声呐显形后短暂实体化)  &  极性弦膜(I 终端切换)
//   其余字符视为实体生成点(spawns),由 PlayState 解释。

export interface LevelTheme {
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
        case '.': case ' ': break;
        default:
          spawns.push({ char: ch, col: c, row: r });
          break;
      }
    }
  }
  return { w, h, tiles, spawns };
}
