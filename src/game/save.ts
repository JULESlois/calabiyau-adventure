// 存档 v2:世界状态(能力/旗标/收集/捷径/地图/重生锚)整体序列化。
import { MAX_HP } from './constants';
import {
  FORGE_MAX,
  HIDDEN_CHIPS,
  ROOMS,
  SHOP_CHIPS,
  SHORTCUT_IDS,
  START_ROOM,
  type Ability,
} from './world/world';
import type { ValidWorldSave, WorldSave } from './world/WorldState';

const KEY = 'calabiyau_stringbound_save_v2';
const ABILITIES = new Set<Ability>(['paper', 'cling', 'djump', 'dash', 'flash', 'skystep', 'kinetic', 'kanami']);
// 可重复条目(弦芯熔铸)不是芯片,层数走 forgeLevel;放进这里会让改档能"拥有"它
const CHIPS = new Set([...SHOP_CHIPS, ...HIDDEN_CHIPS].map((item) => item.id));
const MAX_LIST_LENGTH = 4096;
const MAX_VALUE_LENGTH = 256;

function isBeaconRoom(roomId: string): boolean {
  return Boolean(ROOMS[roomId]?.rows.some((row) => row.includes('T')));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `房间:列:行` 是否真的指向一格可破坏墙。
 * 改档若伪造坐标,放行就等于允许在任意实体砖上开洞 —— 那是能穿墙的作弊,
 * 所以这里按房间数据逐格核对,而不是只检查字符串形状。
 */
function isBreakableCell(key: string): boolean {
  // 房间 id 不含冒号,但仍从右侧切分,避免将来改名带来歧义
  const parts = key.split(':');
  if (parts.length < 3) return false;
  const row = Number(parts[parts.length - 1]);
  const col = Number(parts[parts.length - 2]);
  const roomId = parts.slice(0, parts.length - 2).join(':');
  if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row) || col < 0 || row < 0) return false;
  return ROOMS[roomId]?.rows[row]?.[col] === '@';
}

function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_LIST_LENGTH) return null;
  if (value.some((item) => typeof item !== 'string' || item.length > MAX_VALUE_LENGTH)) return null;
  return [...new Set(value as string[])];
}

/**
 * 校验并规范化 localStorage 中不可信的存档数据。
 * 这是存档的唯一信任边界:WorldState.deserialize() 只接受这里产出的 ValidWorldSave,
 * 不再做第二遍校验,所以任何新增字段的白名单/范围检查都必须落在这个函数里。
 */
export function parseWorldSave(value: unknown): ValidWorldSave | null {
  if (!isRecord(value) || value.version !== 2) return null;

  const abilities = readStringList(value.abilities);
  const flags = readStringList(value.flags);
  const crystals = readStringList(value.crystals);
  const visited = readStringList(value.visited);
  if (!abilities || !flags || !crystals || !visited) return null;
  if (abilities.some((ability) => !ABILITIES.has(ability as Ability))) return null;
  if (typeof value.benchRoom !== 'string' || !isBeaconRoom(value.benchRoom)) return null;
  if (value.char !== 'michele' && value.char !== 'kanami') return null;
  if (typeof value.cleared !== 'boolean') return null;

  const dust = value.dust ?? 0;
  if (typeof dust !== 'number' || !Number.isSafeInteger(dust) || dust < 0) return null;

  const chips = value.chips === undefined ? [] : readStringList(value.chips);
  if (!chips || chips.some((chip) => !CHIPS.has(chip))) return null;
  const shortcuts = value.shortcuts === undefined ? [] : readStringList(value.shortcuts);
  if (!shortcuts || shortcuts.some((shortcut) => !SHORTCUT_IDS.has(shortcut))) return null;
  const brokenWalls = value.brokenWalls === undefined ? [] : readStringList(value.brokenWalls);
  if (!brokenWalls) return null;
  // 熔铸层数直接换算成生命上限,所以必须夹在合法区间里,不能信存档里的数字
  const forgeLevel = value.forgeLevel ?? 0;
  if (
    typeof forgeLevel !== 'number'
    || !Number.isSafeInteger(forgeLevel)
    || forgeLevel < 0
    || forgeLevel > FORGE_MAX
  ) {
    return null;
  }
  const savedBeacons = value.activatedBeacons === undefined ? [] : readStringList(value.activatedBeacons);
  if (!savedBeacons || savedBeacons.some((roomId) => !isBeaconRoom(roomId))) return null;
  const activatedBeacons = [...new Set([START_ROOM, value.benchRoom, ...savedBeacons])];

  // hpMax 是派生值:只拦明显被改写的形状,数值本身不带出去,由 recalculateStats() 重算
  if (
    value.hpMax !== undefined &&
    (typeof value.hpMax !== 'number' || !Number.isFinite(value.hpMax) || value.hpMax < MAX_HP)
  ) {
    return null;
  }

  return {
    version: 2,
    abilities: abilities as Ability[],
    flags,
    crystals,
    // 地图屏直接按 id 查房间表,丢掉已不存在的房间而不是让整档作废
    visited: visited.filter((roomId) => ROOMS[roomId]),
    benchRoom: value.benchRoom,
    activatedBeacons,
    // 改档可能把 char 指向还没救出的 kanami:回退到 michele,避免无能力的角色上场
    char: value.char === 'kanami' && abilities.includes('kanami') ? 'kanami' : 'michele',
    cleared: value.cleared,
    dust,
    chips,
    shortcuts,
    // 与 visited 同策略:丢掉已不存在的格位(房间改版很正常),而不是让整档作废
    brokenWalls: brokenWalls.filter(isBreakableCell),
    forgeLevel,
  } as ValidWorldSave;
}

export function loadWorldSave(): ValidWorldSave | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return parseWorldSave(JSON.parse(raw));
  } catch {
    // localStorage 不可用时静默降级
  }
  return null;
}

export function storeWorldSave(data: WorldSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function clearWorldSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
