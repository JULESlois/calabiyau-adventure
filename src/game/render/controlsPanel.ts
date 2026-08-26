// 操作说明 / 状态面板。
//
// 游戏此前完全没有任何地方能查按键:唯一的操作提示是一次性浮空文字,
// 且由存档旗标 tutorial:start 把守,所以隔一周回来的玩家再也看不到 ——
// E(贴墙)、U(冲刺)、Q(换人)、Tab(地图)、下劈、穿板下落全都无从得知,
// 更不知道 Shift 是"按住"而不是"按一下"。
//
// 这里按已取得的能力渐进披露:没拿到的能力不列出来,免得剧透也免得看不懂。

import { VIEW_H, VIEW_W } from '../constants';
import { actionLabel, type Action, type InputDevice } from '../Input';
import {
  ABILITY_INFO,
  HIDDEN_CHIPS,
  SHOP_ITEMS,
  type Ability,
} from '../world/world';

export const CONTROLS_PAGE_COUNT = 2;

export interface ControlsPanelView {
  abilities: ReadonlySet<Ability>;
  chips: ReadonlySet<string>;
  device: InputDevice;
  page: number;
}

/** 中文在 480×270 上低于 9px 就糊成一团,正文一律 10px。 */
const F_TITLE = 'bold 13px "SimSun", "Songti SC", serif';
const F_ROW = '10px "SimSun", "Songti SC", serif';
const F_FOOT = '9px "SimSun", "Songti SC", serif';

interface Row {
  label: string;
  /** 直接给 Action 时按设备翻译;给字符串时原样显示(组合键)。 */
  binding: Action | string;
  /** 需要哪个能力才显示;省略表示始终显示。 */
  needs?: Ability;
  /** 强调"按住"这类容易误解的操作。 */
  note?: string;
}

const ROWS: readonly Row[] = [
  { label: '移动', binding: 'left' },
  { label: '跳跃', binding: 'jump' },
  { label: '射击', binding: 'shoot' },
  { label: '蓄力狙击', binding: 'shoot', needs: 'kanami', note: '长按' },
  { label: '近战连段', binding: 'melee' },
  { label: '角色技能', binding: 'skill' },
  { label: '场景交互', binding: 'interact' },
  { label: '弦化 / 飘飞', binding: 'paper', needs: 'paper', note: '按住不放' },
  { label: '弦闪(擦弹反击)', binding: 'paper', needs: 'flash', note: '弹至瞬按' },
  { label: '踏空第三跳', binding: 'jump', needs: 'skystep', note: '约6秒充能' },
  { label: '贴墙吸附 / 蹬墙', binding: 'wall', needs: 'cling' },
  { label: '相位突进', binding: 'dash', needs: 'dash' },
  { label: '切换角色', binding: 'switch', needs: 'kanami' },
  { label: '地图', binding: 'map' },
  { label: '暂停', binding: 'pause' },
];

/** 组合键说明:这两招游戏里从来没教过,却是过尖刺与下探的关键。 */
const COMBOS: readonly { label: string; keyboard: string; pad: string; note: string }[] = [
  { label: '下劈', keyboard: '空中 S + K', pad: '空中 摇杆下 + B', note: '命中可弹起,重置二段跳' },
  { label: '穿过单向平台', keyboard: 'S + 空格', pad: '摇杆下 + A', note: '向下落穿薄板' },
];

function frame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(10,7,16,0.94)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#a8823c';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
  ctx.strokeStyle = '#4a3c22';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function drawControlsPanel(ctx: CanvasRenderingContext2D, view: ControlsPanelView): void {
  ctx.save();
  ctx.fillStyle = 'rgba(4,3,10,0.9)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  frame(ctx, 12, 10, VIEW_W - 24, VIEW_H - 20);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.font = F_TITLE;
  ctx.fillStyle = '#e8d8a8';
  ctx.fillText(view.page === 0 ? '操 作 说 明' : '能 力 与 芯 片', VIEW_W / 2, 30);

  if (view.page === 0) drawKeys(ctx, view);
  else drawLoadout(ctx, view);

  // 页码 + 页脚
  ctx.textAlign = 'center';
  ctx.font = F_FOOT;
  ctx.fillStyle = '#6a6080';
  const dots = Array.from({ length: CONTROLS_PAGE_COUNT }, (_, i) => (i === view.page ? '●' : '○')).join(' ');
  ctx.fillText(dots, VIEW_W / 2, VIEW_H - 26);
  ctx.fillStyle = '#8a7a98';
  ctx.fillText(
    `${actionLabel('left', view.device)}/${actionLabel('right', view.device)} 翻页 · ` +
      `${actionLabel('pause', view.device)} 返回`,
    VIEW_W / 2,
    VIEW_H - 14,
  );
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawKeys(ctx: CanvasRenderingContext2D, view: ControlsPanelView): void {
  const rows = ROWS.filter((r) => !r.needs || view.abilities.has(r.needs));
  const labelX = 30;
  const bindX = 168;
  const noteX = 250;
  let y = 50;

  ctx.textAlign = 'left';
  for (const row of rows) {
    ctx.font = F_ROW;
    ctx.fillStyle = '#c8bcd8';
    ctx.fillText(row.label, labelX, y);
    // 绑定列左对齐成一条竖线,方便纵向扫读
    ctx.fillStyle = '#8ee8f4';
    ctx.fillText(bindKeyText(row.binding as Action, view.device, row.label), bindX, y);
    if (row.note) {
      ctx.font = F_FOOT;
      ctx.fillStyle = '#ffd0a0';
      ctx.fillText(row.note, noteX, y);
    }
    y += 13;
  }

  y += 4;
  ctx.font = F_FOOT;
  ctx.fillStyle = '#6a6080';
  ctx.fillText('—— 组合操作 ——', labelX, y);
  y += 13;
  for (const combo of COMBOS) {
    ctx.font = F_ROW;
    ctx.fillStyle = '#c8bcd8';
    ctx.fillText(combo.label, labelX, y);
    ctx.fillStyle = '#8ee8f4';
    ctx.fillText(view.device === 'gamepad' ? combo.pad : combo.keyboard, bindX, y);
    y += 12;
    ctx.font = F_FOOT;
    ctx.fillStyle = '#7a7090';
    ctx.fillText(combo.note, labelX + 10, y);
    y += 13;
  }
}

/** 移动键要显示成一对方向键,而不是单个 'A'。 */
function bindKeyText(action: Action, device: InputDevice, label: string): string {
  if (label === '移动') {
    return `${actionLabel('left', device)} / ${actionLabel('right', device)}`;
  }
  return actionLabel(action, device);
}

function drawLoadout(ctx: CanvasRenderingContext2D, view: ControlsPanelView): void {
  const x = 30;
  let y = 50;
  ctx.textAlign = 'left';

  ctx.font = F_FOOT;
  ctx.fillStyle = '#6a6080';
  ctx.fillText('能力', x, y);
  y += 13;
  for (const key of ['paper', 'cling', 'djump', 'dash', 'flash', 'skystep', 'kanami'] as Ability[]) {
    const owned = view.abilities.has(key);
    const info = ABILITY_INFO[key];
    ctx.font = F_ROW;
    ctx.fillStyle = owned ? '#8ee8f4' : '#4a4458';
    // 未取得的不剧透说明,只留一个占位,免得面板变成攻略。
    ctx.fillText(owned ? info.name : '???', x, y);
    ctx.font = F_FOOT;
    ctx.fillStyle = owned ? '#9a90b0' : '#3e3a4e';
    ctx.fillText(owned ? info.desc : '尚未取得', x + 96, y);
    y += 13;
  }

  y += 6;
  ctx.font = F_FOOT;
  ctx.fillStyle = '#6a6080';
  ctx.fillText('记忆芯片 / 遗珍', x, y);
  y += 13;
  for (const item of [...SHOP_ITEMS, ...HIDDEN_CHIPS]) {
    const owned = view.chips.has(item.id);
    ctx.font = F_ROW;
    ctx.fillStyle = owned ? '#ffe9a8' : '#4a4458';
    ctx.fillText(owned ? item.name : '???', x, y);
    ctx.font = F_FOOT;
    ctx.fillStyle = owned ? '#9a90b0' : '#3e3a4e';
    ctx.fillText(owned ? item.desc : '未持有', x + 96, y);
    y += 12;
  }
}
