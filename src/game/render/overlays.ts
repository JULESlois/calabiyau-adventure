// 覆盖层界面:地图屏、商店、信标传送、暂停/死亡/能力/通关横幅,以及 toast 与 F 交互提示。
//
// 这些都是只读绘制:它们从 OverlayView 拿一份当帧快照,不碰房间状态。
// 之所以独立成模块,是因为覆盖层的排版与房间玩法逻辑没有关系,却曾经占掉 PlayState 近四百行。

import { COLORS, VIEW_H, VIEW_W } from '../constants';
import { actionLabel, type InputDevice } from '../Input';
import { clamp } from '../utils';
import {
  ABILITY_INFO,
  ROOMS,
  ROOM_LIST,
  SHOP_ITEMS,
  type Ability,
} from '../world/world';
import type { WorldState } from '../world/WorldState';

export type Overlay =
  | 'none'
  | 'pause'
  | 'controls'
  | 'dead'
  | 'ability'
  | 'victory'
  | 'map'
  | 'shop'
  | 'fast_travel';

/** 暂停菜单项;破坏性操作需要二次确认。 */
export type PauseAction = 'resume' | 'controls' | 'bench' | 'title';
export const PAUSE_ITEMS: readonly { action: PauseAction; label: string; danger: boolean }[] = [
  { action: 'resume', label: '继续冒险', danger: false },
  { action: 'controls', label: '操作说明', danger: false },
  { action: 'bench', label: '回到信标', danger: true },
  { action: 'title', label: '返回标题', danger: true },
];

/** 信标传送候选项。 */
export interface BeaconEntry {
  id: string;
  name: string;
  zoneName: string;
  isCurrent: boolean;
}

/** 覆盖层绘制所需的当帧快照;由 PlayState 组装。 */
export interface OverlayView {
  world: WorldState;
  roomId: string;
  roomName: string;
  time: number;
  camX: number;
  camY: number;
  overlay: Overlay;
  overlayT: number;
  abilityKind: Ability;
  shopSel: number;
  fastTravelIndex: number;
  totalCrystals: number;
  toasts: readonly { msg: string; t: number }[];
  /** F 交互提示的世界坐标锚点;无可交互对象时为 null。 */
  promptAnchor: { x: number; y: number } | null;
  /** F 提示下方的一行说明("休息"/"传送"/"开启"…),空串则只画按键框。 */
  promptLabel: string;
  benches: readonly BeaconEntry[];
  /** 最近使用的输入设备:提示文字要跟着玩家手上的东西走。 */
  device: InputDevice;
  /** 暂停菜单光标与二次确认目标。 */
  pauseSel: number;
  pauseConfirm: PauseAction | null;
}

const ZONE_COLOR: Record<string, string> = {
  coast: '#c2743e', tide: '#58a894', lab: '#5a78c8',
  choir: '#b878b8', sky: '#a8b0cc', hangar: '#c85a5c',
};

const F_BIG = 'bold 16px "SimSun", "Songti SC", serif';
const F_MID = '10px "SimSun", "Songti SC", serif';
const F_SMALL = '9px "SimSun", "Songti SC", serif';

/** 哥特描金边框,覆盖层通用。 */
export function ornateFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = 'rgba(10,7,16,0.88)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#a8823c';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
  ctx.strokeStyle = '#4a3c22';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = '#c8a050';
  for (const [dx, dy] of [
    [1, 1],
    [w - 4, 1],
    [1, h - 4],
    [w - 4, h - 4],
  ]) {
    ctx.fillRect(x + dx, y + dy, 3, 3);
  }
}

/** 屏幕层界面总入口:toast → F 提示 → 覆盖层。 */
export function drawOverlays(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  drawToasts(ctx, view);
  drawInteractionPrompt(ctx, view);
  drawOverlay(ctx, view);
}

// 房间名 / 事件提示
function drawToasts(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  if (view.toasts.length === 0) return;
  ctx.textAlign = 'center';
  ctx.font = F_SMALL;
  let ty = VIEW_H - 34;
  for (const t of view.toasts) {
    const a = clamp(t.t / 0.5, 0, 1);
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = 'rgba(8,5,14,0.75)';
    const tw = ctx.measureText(t.msg).width;
    ctx.fillRect(VIEW_W / 2 - tw / 2 - 6, ty - 3, tw + 12, 13);
    ctx.fillStyle = '#d8ccb0';
    ctx.fillText(t.msg, VIEW_W / 2, ty);
    ctx.globalAlpha = 1;
    ty -= 16;
  }
  ctx.textAlign = 'left';
}

function drawInteractionPrompt(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  if (!view.promptAnchor) return;
  const bx = Math.round(view.promptAnchor.x - view.camX);
  const by = Math.round(view.promptAnchor.y - view.camY);
  // 六种可交互对象过去共用一个没有标签的「F」方框,玩家按下前不知道会发生什么。
  const key = actionLabel('interact', view.device);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 9px monospace';
  const keyW = Math.max(12, ctx.measureText(key).width + 7);
  ctx.fillStyle = 'rgba(8, 6, 16, 0.9)';
  ctx.fillRect(bx - keyW / 2, by - 10, keyW, 12);
  ctx.strokeStyle = '#8ee8f4';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx - keyW / 2 + 0.5, by - 9.5, keyW - 1, 11);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(key, bx, by - 4);
  if (view.promptLabel) {
    ctx.font = F_SMALL;
    const lw = ctx.measureText(view.promptLabel).width;
    ctx.fillStyle = 'rgba(8, 6, 16, 0.82)';
    ctx.fillRect(bx - lw / 2 - 3, by + 2, lw + 6, 12);
    ctx.fillStyle = '#cfe8f4';
    ctx.fillText(view.promptLabel, bx, by + 8);
  }
  ctx.restore();
}

function drawOverlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  if (view.overlay === 'none') return;
  if (view.overlay === 'map') {
    drawMap(ctx, view);
    return;
  }
  if (view.overlay === 'shop') {
    drawShop(ctx, view);
    return;
  }
  if (view.overlay === 'fast_travel') {
    drawFastTravel(ctx, view);
    return;
  }
  ctx.fillStyle = 'rgba(4, 3, 10, 0.72)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';

  if (view.overlay === 'pause') {
    drawPause(ctx, view);
  } else if (view.overlay === 'dead') {
    ctx.font = F_BIG;
    ctx.fillStyle = '#c86a9a';
    ctx.fillText('信 号 中 断 ……', VIEW_W / 2, 112);
    ctx.font = F_SMALL;
    ctx.fillStyle = '#8a7a98';
    ctx.fillText('正在回到最后的信标', VIEW_W / 2, 138);
    // 死亡不该是强制等待:短暂延迟后允许跳过。
    if (view.overlayT < 1.2) {
      ctx.fillStyle = '#6a6080';
      ctx.fillText(`${actionLabel('confirm', view.device)} 立即重生`, VIEW_W / 2, 158);
    }
  } else if (view.overlay === 'ability') {
    const info = ABILITY_INFO[view.abilityKind];
    const a = clamp(view.overlayT / 0.4, 0, 1);
    ctx.globalAlpha = a;
    // 加高框体,给 ABILITY_INFO.desc 让出位置 —— 那段说明一直存在却从没被画过,
    // 而「地面弦化可穿弦膜」这类文字是玩家唯一能读到的机制解释。
    ornateFrame(ctx, VIEW_W / 2 - 108, 76, 216, 106);
    ctx.font = F_BIG;
    ctx.fillStyle = view.abilityKind === 'kanami' ? '#ffb0d8' : '#8ee8f4';
    ctx.fillText(info.name, VIEW_W / 2, 100);
    ctx.font = F_SMALL;
    ctx.fillStyle = '#e8d8a8';
    ctx.fillText('已获得', VIEW_W / 2, 118);
    ctx.font = F_MID;
    ctx.fillStyle = '#c8bcd8';
    let dy = 138;
    for (const line of wrapText(ctx, info.desc, 190)) {
      ctx.fillText(line, VIEW_W / 2, dy);
      dy += 13;
    }
    if (view.overlayT > 0.6) {
      ctx.font = F_SMALL;
      ctx.fillStyle = '#8a7a98';
      ctx.fillText(`${actionLabel('confirm', view.device)} 确认`, VIEW_W / 2, 172);
    }
    ctx.globalAlpha = 1;
  } else if (view.overlay === 'victory') {
    ornateFrame(ctx, VIEW_W / 2 - 130, 58, 260, 156);
    ctx.font = 'bold 18px "SimSun", "Songti SC", serif';
    ctx.fillStyle = '#e8c860';
    ctx.fillText('守望者 已被击败', VIEW_W / 2, 88);
    ctx.font = F_MID;
    ctx.fillStyle = '#d8ccE8';
    ctx.fillText('欧拉的夜空,重归平静。', VIEW_W / 2, 114);
    ctx.fillStyle = COLORS.michele;
    ctx.fillText('米雪儿:「任务完成,回家喝热可可!」', VIEW_W / 2, 136);
    ctx.fillStyle = COLORS.kanami;
    ctx.fillText('香奈美:「下次冒险,也要一起哦♪」', VIEW_W / 2, 154);
    ctx.font = F_SMALL;
    ctx.fillStyle = '#e878c0';
    ctx.fillText(`◆ 弦晶 ${view.world.crystals.size} / ${view.totalCrystals}`, VIEW_W / 2, 176);
    ctx.fillStyle = '#8a7a98';
    ctx.fillText(`感谢游玩 · ${actionLabel('confirm', view.device)} 返回标题`, VIEW_W / 2, 196);
  }
  ctx.textAlign = 'left';
}

/** 按像素宽度折行(中文按字拆,足够应付这里的短句)。 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * 暂停菜单。旧版把「回到信标」「返回标题」直接绑在 J / L(也就是射击与技能键,
 * 手柄上还是 X/RT 与 Y)上且没有确认 —— 战斗中一暂停就可能被瞬间传走、丢掉全部探索进度。
 * 现在改成光标菜单,破坏性项一律二次确认。
 */
function drawPause(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  const rowH = 22;
  const h = 68 + PAUSE_ITEMS.length * rowH;
  const top = Math.round((VIEW_H - h) / 2);
  ornateFrame(ctx, VIEW_W / 2 - 104, top, 208, h);

  ctx.textAlign = 'center';
  ctx.font = F_BIG;
  ctx.fillStyle = '#e8d8a8';
  ctx.fillText('暂 停', VIEW_W / 2, top + 26);

  const confirming = view.pauseConfirm !== null;
  PAUSE_ITEMS.forEach((item, i) => {
    const y = top + 50 + i * rowH;
    const sel = i === view.pauseSel;
    const dim = confirming && !sel;
    ctx.globalAlpha = dim ? 0.3 : 1;
    if (sel && !confirming) {
      ctx.fillStyle = 'rgba(168,130,60,0.18)';
      ctx.fillRect(VIEW_W / 2 - 88, y - 12, 176, 18);
      ctx.fillStyle = '#e8c860';
      ctx.fillRect(VIEW_W / 2 - 82, y - 5, 3, 3);
    }
    ctx.font = F_MID;
    ctx.fillStyle = item.danger
      ? sel ? '#ffb0a0' : '#a8807c'
      : sel ? '#f0e0b0' : '#b8accc';
    ctx.fillText(item.label, VIEW_W / 2, y);
    ctx.globalAlpha = 1;
  });

  ctx.font = F_SMALL;
  if (confirming) {
    const label = PAUSE_ITEMS.find((it) => it.action === view.pauseConfirm)?.label ?? '';
    ctx.fillStyle = '#ffd0a0';
    ctx.fillText(`确定要「${label}」吗?`, VIEW_W / 2, top + h - 30);
    ctx.fillStyle = '#8a7a98';
    ctx.fillText(
      `${actionLabel('confirm', view.device)} 确定 · ${actionLabel('pause', view.device)} 取消`,
      VIEW_W / 2,
      top + h - 14,
    );
  } else {
    ctx.fillStyle = '#8a7a98';
    ctx.fillText(
      `${actionLabel('up', view.device)}/${actionLabel('down', view.device)} 选择 · ` +
        `${actionLabel('confirm', view.device)} 确定 · ${actionLabel('pause', view.device)} 继续`,
      VIEW_W / 2,
      top + h - 16,
    );
  }
  ctx.textAlign = 'left';
}

function drawMap(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  const world = view.world;
  ctx.fillStyle = 'rgba(4,3,10,0.88)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const cw = 30;
  const ch = 20;
  let minX = 99;
  let maxX = -99;
  let minY = 99;
  let maxY = -99;
  for (const r of ROOM_LIST) {
    minX = Math.min(minX, r.mapX);
    maxX = Math.max(maxX, r.mapX);
    minY = Math.min(minY, r.mapY);
    maxY = Math.max(maxY, r.mapY + (r.mapH ?? 1) - 1);
  }
  const ox = Math.round((VIEW_W - (maxX - minX + 1) * cw) / 2);
  const oy = Math.round((VIEW_H - (maxY - minY + 1) * ch) / 2) + 8;

  // 已探索房间之间的连线,让地图呈现真实回环而不是孤立色块。
  const linked = new Set<string>();
  ctx.lineWidth = 1;
  for (const r of ROOM_LIST) {
    if (!world.visited.has(r.id)) continue;
    for (const e of r.exits) {
      if (!world.visited.has(e.target)) continue;
      const key = [r.id, e.target].sort().join('|');
      if (linked.has(key)) continue;
      linked.add(key);
      const target = ROOMS[e.target];
      const x0 = ox + (r.mapX - minX + 0.5) * cw;
      const y0 = oy + (r.mapY - minY + (r.mapH ?? 1) / 2) * ch;
      const x1 = ox + (target.mapX - minX + 0.5) * cw;
      const y1 = oy + (target.mapY - minY + (target.mapH ?? 1) / 2) * ch;
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = ZONE_COLOR[r.zone];
      ctx.beginPath();
      ctx.moveTo(Math.round(x0), Math.round(y0));
      ctx.lineTo(Math.round(x1), Math.round(y1));
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  for (const r of ROOM_LIST) {
    if (!world.visited.has(r.id)) continue;
    const x = ox + (r.mapX - minX) * cw;
    const y = oy + (r.mapY - minY) * ch;
    const h = (r.mapH ?? 1) * ch;
    const current = r.id === view.roomId;
    ctx.globalAlpha = current ? 0.55 : 0.28;
    ctx.fillStyle = ZONE_COLOR[r.zone];
    ctx.fillRect(x + 2, y + 2, cw - 4, h - 4);
    if (r.transition) {
      ctx.fillStyle = ZONE_COLOR[r.transition.to];
      if (r.transition.toSide === 'left') ctx.fillRect(x + 2, y + 2, (cw - 4) / 2, h - 4);
      else if (r.transition.toSide === 'down') ctx.fillRect(x + 2, y + h / 2, cw - 4, h / 2 - 2);
      else ctx.fillRect(x + cw / 2, y + 2, cw / 2 - 2, h - 4);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = current && Math.floor(view.time * 10) % 2 === 0 ? '#f0e0b0' : ZONE_COLOR[r.zone];
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 2.5, y + 2.5, cw - 5, h - 5);
    // 信标标记
    if (r.rows.some((row) => row.includes('T'))) {
      ctx.fillStyle = '#8ee8f4';
      ctx.fillRect(x + cw / 2 - 1, y + h / 2 - 1, 3, 3);
    }
    if (r.shortcuts?.length) {
      const allOpen = r.shortcuts.every((shortcut) => world.shortcuts.has(shortcut.id));
      ctx.fillStyle = allOpen ? '#8de0c4' : '#d8a850';
      ctx.fillRect(x + cw - 7, y + 4, 3, 3);
    }
    if (current) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + cw / 2 - 1, y + h / 2 - 5, 2, 2);
    }

    // 通往未到访房间的出口画成短桩:这是地图上唯一的"还没走过的方向"线索。
    // 弦迹测绘(#48):曾经能力不足、现在条件已满足的关口是"回访候选" ——
    // 用明亮脉冲区分,解决"记得哪里过不去、忘了是哪间房"的中期通病。
    for (const e of r.exits) {
      if (world.visited.has(e.target)) continue;
      const needs = e.needs ?? [];
      const gated = needs.some((need) => !world.abilities.has(need));
      const revisit = !gated && needs.length > 0;
      if (revisit) {
        ctx.fillStyle = '#e8fbff';
        ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(view.time * 4));
      } else {
        ctx.fillStyle = gated ? '#d8a850' : '#8ee8f4';
        ctx.globalAlpha = 0.85;
      }
      const midY = y + h / 2;
      const stub = revisit ? 6 : 5;
      if (e.side === 'left') ctx.fillRect(x - stub + 2, midY - 1, stub, 2);
      else if (e.side === 'right') ctx.fillRect(x + cw - 2, midY - 1, stub, 2);
      else ctx.fillRect(x + cw / 2 - 1, y + h - 2, 2, stub);
      ctx.globalAlpha = 1;
    }

    // 仍有未拾取弦晶的房间打一个小点,给收集向玩家一条可执行的线索。
    let remaining = 0;
    for (let row = 0; row < r.rows.length; row++) {
      for (let col = 0; col < r.rows[row].length; col++) {
        if (r.rows[row][col] !== '*') continue;
        if (!world.crystals.has(`${r.id}:${col}:${row}`)) remaining++;
      }
    }
    if (remaining > 0) {
      ctx.fillStyle = '#e878c0';
      ctx.fillRect(x + 4, y + h - 7, 3, 3);
    }
  }

  ctx.textAlign = 'center';
  ctx.font = 'bold 12px "SimSun", "Songti SC", serif';
  ctx.fillStyle = '#e8d8a8';
  ctx.fillText('欧拉 · 区域图', VIEW_W / 2, 20);

  // 图例:之前青色信标点与金/青捷径点没有任何说明。
  ctx.font = F_SMALL;
  ctx.textAlign = 'left';
  const legend: [string, string][] = [
    ['#8ee8f4', '信标'],
    ['#e878c0', '未取弦晶'],
    ['#8ee8f4', '未探索'],
    ['#d8a850', '能力未足'],
    ['#e8fbff', '可回访'],
  ];
  let lx = 10;
  for (let i = 0; i < legend.length; i++) {
    const [color, label] = legend[i];
    ctx.fillStyle = color;
    if (i >= 2) ctx.fillRect(lx, 30, 5, 2);
    else ctx.fillRect(lx, 28, 3, 3);
    ctx.fillStyle = '#8a7a98';
    ctx.fillText(label, lx + 8, 33);
    lx += 12 + ctx.measureText(label).width;
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#8a7a98';
  const visited = [...world.visited].length;
  // 回访候选:能力条件已满足、但目标房仍未到访的关口数量。
  let revisitCount = 0;
  for (const r of ROOM_LIST) {
    if (!world.visited.has(r.id)) continue;
    for (const e of r.exits) {
      const needs = e.needs ?? [];
      if (needs.length === 0 || world.visited.has(e.target)) continue;
      if (needs.every((need) => world.abilities.has(need))) revisitCount++;
    }
  }
  const revisitNote = revisitCount > 0 ? `　可回访 ${revisitCount}` : '';
  ctx.fillText(
    `${view.roomName}　◆ ${world.crystals.size}/${view.totalCrystals}　房间 ${visited}/${ROOM_LIST.length}${revisitNote}`,
    VIEW_W / 2,
    VIEW_H - 26,
  );
  ctx.fillText(
    `${actionLabel('map', view.device)} / ${actionLabel('pause', view.device)} 关闭`,
    VIEW_W / 2,
    VIEW_H - 12,
  );
  ctx.textAlign = 'left';
}

function drawShop(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  const world = view.world;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(4,3,10,0.82)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ornateFrame(ctx, VIEW_W / 2 - 128, 40, 256, 178);
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px "SimSun", "Songti SC", serif';
  ctx.fillStyle = '#e8d8a8';
  ctx.fillText('引航者 · 诺笛', VIEW_W / 2, 60);
  ctx.font = '8px "SimSun", "Songti SC", serif';
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(`晶尘 ${world.dust}`, VIEW_W / 2, 79);

  ctx.textAlign = 'left';
  SHOP_ITEMS.forEach((it, i) => {
    const rowTop = 91 + i * 25;
    const nameY = rowTop + 9;
    const sel = i === view.shopSel;
    const owned = world.chips.has(it.id);
    if (sel) {
      ctx.fillStyle = 'rgba(168,130,60,0.18)';
      ctx.fillRect(VIEW_W / 2 - 118, rowTop, 236, 23);
      ctx.fillStyle = '#e8c860';
      ctx.fillRect(VIEW_W / 2 - 111, nameY - 4, 3, 3);
    }
    ctx.font = '9px "SimSun", "Songti SC", serif';
    ctx.fillStyle = owned ? '#5a5468' : sel ? '#f0e0b0' : '#b8accc';
    ctx.fillText(it.name, VIEW_W / 2 - 104, nameY);
    ctx.font = F_SMALL;
    ctx.fillStyle = owned ? '#4a4458' : '#8a7a98';
    ctx.fillText(it.desc, VIEW_W / 2 - 104, nameY + 10);
    ctx.textAlign = 'right';
    ctx.fillStyle = owned ? '#5a5468' : world.dust >= it.cost ? '#ffe9a8' : '#a85a5c';
    ctx.fillText(owned ? '已接入' : `${it.cost}`, VIEW_W / 2 + 110, nameY);
    ctx.textAlign = 'left';
  });

  ctx.textAlign = 'center';
  ctx.font = '8px "SimSun", "Songti SC", serif';
  ctx.fillStyle = '#8a7a98';
  ctx.fillText(
    `${actionLabel('up', view.device)}/${actionLabel('down', view.device)} 选择 · ` +
      `${actionLabel('interact', view.device)} 购买 · ${actionLabel('pause', view.device)} 关闭`,
    VIEW_W / 2,
    208,
  );
  ctx.restore();
}

function drawFastTravel(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  ctx.fillStyle = 'rgba(4, 3, 10, 0.88)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const frameW = 270;
  const frameH = 238;
  const frameX = Math.round(VIEW_W / 2 - frameW / 2);
  const frameY = 16;
  ornateFrame(ctx, frameX, frameY, frameW, frameH);

  ctx.textAlign = 'center';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#8ee8f4';
  ctx.fillText('信 标 传 送', VIEW_W / 2, frameY + 20);

  ctx.fillStyle = '#4a3c5c';
  ctx.fillRect(frameX + 20, frameY + 26, frameW - 40, 1);

  const benches = view.benches;
  if (benches.length === 0) {
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#8a7a98';
    ctx.fillText('尚未激活其他信标……', VIEW_W / 2, frameY + 110);
  } else {
    const MAX_VISIBLE = 5;
    const total = benches.length;
    // 保持当前选中项在可视窗口内
    const scrollOffset = Math.max(0, Math.min(total - MAX_VISIBLE, view.fastTravelIndex - 2));
    const visibleList = benches.slice(scrollOffset, scrollOffset + MAX_VISIBLE);

    const listStartY = frameY + 32;
    const cardW = 236;
    const cardH = 25;
    const cardX = Math.round(VIEW_W / 2 - cardW / 2);

    visibleList.forEach((b, index) => {
      const i = scrollOffset + index;
      const cardY = listStartY + index * 29;
      const isSel = i === view.fastTravelIndex;

      // 只保留轻量选中标记,避免每个传送点都被文字框包围。
      if (isSel) {
        ctx.fillStyle = '#8ee8f4';
        ctx.fillRect(cardX - 5, cardY + 10, 3, 3);
        ctx.globalAlpha = 0.22;
        ctx.fillRect(cardX + 4, cardY + cardH - 1, cardW - 8, 1);
        ctx.globalAlpha = 1;
      }

      // 左侧文字: 区域与房间名
      ctx.textAlign = 'left';
      ctx.font = isSel ? 'bold 10px sans-serif' : '10px sans-serif';

      // 区域前缀
      ctx.fillStyle = isSel ? '#7ae0c8' : '#8a7a98';
      const zoneTag = `[${b.zoneName}] `;
      ctx.fillText(zoneTag, cardX + 8, cardY + 16);
      const tagW = ctx.measureText(zoneTag).width;

      // 房间名
      ctx.fillStyle = b.isCurrent ? '#ffd75e' : isSel ? '#ffffff' : '#c8b8d8';
      ctx.fillText(b.name, cardX + 8 + tagW, cardY + 16);

      // 右侧状态标签
      ctx.textAlign = 'right';
      ctx.font = '9px sans-serif';
      if (b.isCurrent) {
        ctx.fillStyle = '#ffd75e';
        ctx.fillText('(当前信标)', cardX + cardW - 8, cardY + 16);
      } else if (isSel) {
        ctx.fillStyle = '#8ee8f4';
        ctx.fillText(`${actionLabel('interact', view.device)} 传送 ▶`, cardX + cardW - 8, cardY + 16);
      } else {
        ctx.fillStyle = '#5a4c6a';
        ctx.fillText('已到访', cardX + cardW - 8, cardY + 16);
      }
    });

    // 滚动指示指示器
    if (scrollOffset > 0) {
      ctx.textAlign = 'center';
      ctx.font = '8px sans-serif';
      ctx.fillStyle = '#8ee8f4';
      ctx.fillText('▲', frameX + frameW - 22, frameY + 20);
    }
    if (scrollOffset + MAX_VISIBLE < total) {
      ctx.textAlign = 'center';
      ctx.font = '8px sans-serif';
      ctx.fillStyle = '#8ee8f4';
      ctx.fillText('▼', frameX + frameW - 22, listStartY + MAX_VISIBLE * 29);
    }
  }

  ctx.textAlign = 'center';
  ctx.font = '9px sans-serif';
  ctx.fillStyle = '#8a7a98';
  ctx.fillText(
    `${actionLabel('up', view.device)}/${actionLabel('down', view.device)} 选择 · ` +
      `${actionLabel('interact', view.device)} 传送 · ${actionLabel('pause', view.device)} 取消`,
    VIEW_W / 2,
    frameY + frameH - 10,
  );
  ctx.textAlign = 'left';
}
