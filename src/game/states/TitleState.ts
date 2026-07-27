import { VIEW_H, VIEW_W } from '../constants';
import { drawChar } from '../render/sprites';
import { makeRng } from '../utils';
import type { Engine, GameState } from '../Engine';

interface Ash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ph: number;
}

interface Spire {
  x: number;
  w: number;
  h: number;
  peak: number;
  layer: number;
  lit: number[];
}

type Menu = 'main' | 'help' | 'confirmNew';

const F_SERIF = '"SimSun", "Songti SC", serif';

export class TitleState implements GameState {
  private menu: Menu = 'main';
  private sel = 0;
  private time = 0;
  private ash: Ash[] = [];
  private spires: Spire[] = [];
  private hasSave = false;

  constructor(private engine: Engine) {
    const rng = makeRng(97);
    for (let i = 0; i < 46; i++) {
      this.ash.push({
        x: rng() * VIEW_W,
        y: rng() * VIEW_H,
        vx: -4 - rng() * 8,
        vy: 7 + rng() * 12,
        ph: rng() * Math.PI * 2,
      });
    }
    // 两侧城堡剪影
    for (let x = -20; x < VIEW_W + 20; x += 26 + rng() * 40) {
      const centerDist = Math.abs(x - VIEW_W / 2);
      if (centerDist < 90 && rng() < 0.7) continue; // 中央留给月亮与角色
      const layer = rng() < 0.5 ? 0 : 1;
      const h = 40 + rng() * 90 + (centerDist > 150 ? 40 : 0);
      const lit: number[] = [];
      const n = Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) lit.push(rng());
      this.spires.push({ x, w: 12 + rng() * 20, h, peak: 8 + rng() * 16, layer, lit });
    }
  }

  enter(): void {
    this.engine.audio.playSong(0);
    this.menu = 'main';
    this.sel = 0;
    this.hasSave = this.engine.hasSave();
  }

  private mainItems(): string[] {
    return this.hasSave ? ['继续冒险', '新的冒险', '操作说明'] : ['开始冒险', '操作说明'];
  }

  update(dt: number): void {
    this.time += dt;
    for (const a of this.ash) {
      a.ph += dt;
      a.x += (a.vx + Math.sin(a.ph * 1.3) * 5) * dt;
      a.y += a.vy * dt;
      if (a.y > VIEW_H + 4) {
        a.y = -4;
        a.x = Math.random() * VIEW_W;
      }
      if (a.x < -4) a.x = VIEW_W + 4;
    }

    const input = this.engine.input;
    const nOptions = this.menu === 'main' ? this.mainItems().length : this.menu === 'confirmNew' ? 2 : 1;

    if (input.pressed('up')) {
      this.sel = (this.sel - 1 + nOptions) % nOptions;
      this.engine.audio.sfx('ui');
    }
    if (input.pressed('down')) {
      this.sel = (this.sel + 1) % nOptions;
      this.engine.audio.sfx('ui');
    }
    if (input.pressed('confirm') || input.pressed('shoot')) {
      this.engine.audio.sfx('pickup');
      if (this.menu === 'main') {
        const items = this.mainItems();
        const it = items[this.sel];
        if (it === '继续冒险') this.engine.continueGame();
        else if (it === '开始冒险') this.engine.newGame();
        else if (it === '新的冒险') {
          this.menu = 'confirmNew';
          this.sel = 1;
        } else {
          this.menu = 'help';
          this.sel = 0;
        }
      } else if (this.menu === 'confirmNew') {
        if (this.sel === 0) this.engine.newGame();
        else {
          this.menu = 'main';
          this.sel = 0;
        }
      } else {
        this.menu = 'main';
        this.sel = 0;
      }
    }
    if (input.pressed('pause') || input.pressed('skill')) {
      if (this.menu !== 'main') {
        this.menu = 'main';
        this.sel = 0;
        this.engine.audio.sfx('ui');
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const t = this.time;

    // ---- 夜空 ----
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, '#07040e');
    grad.addColorStop(0.55, '#160d24');
    grad.addColorStop(1, '#2e1430');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // 星
    const rng = makeRng(11);
    for (let i = 0; i < 46; i++) {
      const sx = rng() * VIEW_W;
      const sy = rng() * 170;
      const tw = 0.25 + 0.7 * Math.abs(Math.sin(t * 1.4 + i * 1.9));
      ctx.globalAlpha = tw;
      ctx.fillStyle = i % 6 === 0 ? '#aef4ff' : '#d8dcf0';
      ctx.fillRect(Math.round(sx), Math.round(sy), i % 9 === 0 ? 2 : 1, i % 9 === 0 ? 2 : 1);
    }
    ctx.globalAlpha = 1;

    // ---- 巨月 ----
    const mx = VIEW_W / 2;
    const my = 84;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = '#c8c4e8';
    ctx.beginPath();
    ctx.arc(mx, my, 86, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ded8e8';
    ctx.beginPath();
    ctx.arc(mx, my, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(150,145,180,0.45)';
    for (const [ox, oy, cr] of [
      [-20, -12, 10],
      [16, 20, 7],
      [8, -30, 6],
      [-8, 8, 4],
    ]) {
      ctx.beginPath();
      ctx.arc(mx + ox, my + oy, cr, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- 城堡剪影 ----
    const layerC = ['#120b1e', '#1e1229'];
    for (let layer = 0; layer < 2; layer++) {
      ctx.fillStyle = layerC[layer];
      for (const s of this.spires) {
        if (s.layer !== layer) continue;
        const top = VIEW_H - s.h - (layer === 0 ? 30 : 0);
        ctx.fillRect(s.x, top, s.w, VIEW_H - top);
        const cx = s.x + s.w / 2;
        ctx.beginPath();
        ctx.moveTo(s.x + s.w * 0.15, top);
        ctx.lineTo(cx, top - s.peak);
        ctx.lineTo(s.x + s.w * 0.85, top);
        ctx.closePath();
        ctx.fill();
        for (let i = 0; i < s.w - 2; i += 4) ctx.fillRect(s.x + i, top - 3, 2, 3);
        // 窗火
        for (let i = 0; i < s.lit.length; i++) {
          const wy = top + 8 + s.lit[i] * (s.h - 20);
          const wx = s.x + 3 + ((i * 7) % Math.max(4, s.w - 5));
          const flick = 0.4 + 0.5 * Math.abs(Math.sin(t * 3 + i * 2 + s.x));
          ctx.globalAlpha = flick;
          ctx.fillStyle = '#ffb85c';
          ctx.fillRect(Math.round(wx), Math.round(wy), 2, 3);
          ctx.globalAlpha = 1;
          ctx.fillStyle = layerC[layer];
        }
      }
    }

    // 雾霭
    ctx.fillStyle = 'rgba(90,70,130,0.10)';
    ctx.fillRect(0, 150, VIEW_W, 40);
    ctx.fillStyle = 'rgba(90,70,130,0.14)';
    ctx.fillRect(0, 205, VIEW_W, 46);

    // ---- 标题 ----
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const titleY = 38;
    ctx.font = `bold 32px ${F_SERIF}`;
    ctx.fillStyle = '#0e0a14';
    for (const [ox, oy] of [
      [-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, 1], [-1, 1], [1, -1],
    ]) {
      ctx.fillText('卡拉比丘', VIEW_W / 2 + ox, titleY + oy);
    }
    const tg = ctx.createLinearGradient(0, titleY, 0, titleY + 34);
    tg.addColorStop(0, '#f4e6bc');
    tg.addColorStop(0.5, '#d8b060');
    tg.addColorStop(1, '#8a5c28');
    ctx.fillStyle = tg;
    ctx.fillText('卡拉比丘', VIEW_W / 2, titleY);
    const sparkT = (t * 0.6) % 1;
    if (sparkT < 0.35) {
      const sx2 = VIEW_W / 2 - 58 + sparkT * 330;
      ctx.globalAlpha = 0.8 - sparkT * 2;
      ctx.fillStyle = '#fff8e0';
      ctx.fillRect(Math.round(sx2), titleY + 4, 2, 2);
      ctx.fillRect(Math.round(sx2) - 1, titleY + 5, 4, 1);
      ctx.globalAlpha = 1;
    }

    ctx.font = `bold 12px ${F_SERIF}`;
    ctx.fillStyle = '#4a3658';
    ctx.fillText('· 弦 间 冒 险 ·', VIEW_W / 2, 76);
    ctx.font = '7px monospace';
    ctx.fillStyle = '#564468';
    ctx.fillText('~ STRINOVA FAN GAME ~', VIEW_W / 2, 93);
    ctx.fillStyle = '#a8823c';
    ctx.fillRect(VIEW_W / 2 - 70, 106, 140, 1);
    ctx.fillRect(VIEW_W / 2 - 2, 104, 4, 4);

    // ---- 石台上的两位角色 ----
    const pedY = 216;
    for (const px of [VIEW_W / 2 - 78, VIEW_W / 2 + 54]) {
      ctx.fillStyle = '#241a32';
      ctx.fillRect(px, pedY, 24, 16);
      ctx.fillStyle = '#3a2c4a';
      ctx.fillRect(px - 3, pedY, 30, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(px - 3, pedY, 30, 1);
    }
    const idlePose = {
      runPhase: 0,
      moving: false,
      airborne: false,
      vy: 0,
      paper: false,
      meleeT: 0,
      meleeStep: 0,
      shootFlash: 0,
      hurtFlash: false,
      shield: false,
      time: t,
    };
    drawChar(ctx, 'michele', VIEW_W / 2 - 66, pedY, 1, idlePose);
    drawChar(ctx, 'kanami', VIEW_W / 2 + 66, pedY, -1, { ...idlePose, time: t + 1.3 });

    // ---- 菜单 ----
    const panel =
      this.menu === 'main'
        ? { x: VIEW_W / 2 - 66, y: 119, w: 132, h: 62 }
        : this.menu === 'confirmNew'
          ? { x: VIEW_W / 2 - 96, y: 112, w: 192, h: 74 }
          : { x: VIEW_W / 2 - 122, y: 104, w: 244, h: 140 };
    ctx.fillStyle = 'rgba(6,4,12,0.62)';
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.strokeStyle = 'rgba(168,130,60,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1);

    ctx.font = `10px ${F_SERIF}`;
    if (this.menu === 'main') {
      const items = this.mainItems();
      items.forEach((it, i) => {
        const y = items.length === 3 ? 126 + i * 18 : 134 + i * 20;
        const selected = i === this.sel;
        if (selected) {
          ctx.fillStyle = '#f0e0b0';
          ctx.fillText(`✦ ${it} ✦`, VIEW_W / 2, y);
        } else {
          ctx.fillStyle = '#6a6080';
          ctx.fillText(it, VIEW_W / 2, y);
        }
      });
    } else if (this.menu === 'confirmNew') {
      ctx.fillStyle = '#d8ccb0';
      ctx.fillText('开始新的冒险将覆盖现有进度,确定吗?', VIEW_W / 2, 120);
      const opts = ['覆盖并重新开始', '返回'];
      opts.forEach((o, i) => {
        const y = 142 + i * 17;
        const selected = i === this.sel;
        ctx.fillStyle = selected ? (i === 0 ? '#e88a8a' : '#f0e0b0') : '#6a6080';
        ctx.fillText(selected ? `✦ ${o} ✦` : o, VIEW_W / 2, y);
      });
    } else {
      ctx.font = `9px ${F_SERIF}`;
      const lines = [
        'A / D 移动   空格 / W 跳跃   S+跳 下落平台',
        'J 射击(香奈美长按蓄力)  K 近战  L 技能  Q 换人',
        '空中 S+K 下劈弹反 · U/; 冲刺(寻获后)',
        'Shift 弦化 · Tab 地图 · Esc 暂停 · M 静音',
        '',
        '弦化、蹬墙跳、二段跳、相位突进散落世界各处;',
        '香奈美被囚于研究区深处,声呐能显形隐藏平台。',
        '击败敌人掉落晶尘 ✦,可向研究区门厅的',
        '引航者购买「记忆芯片」强化自身。',
        '在「调弦台」休息保存;击败塔顶「守望者 MK-III」。',
      ];
      lines.forEach((l, i) => {
        ctx.fillStyle = i >= 4 ? '#8ee8f4' : '#b8accc';
        if (i >= 4) ctx.fillStyle = i >= 6 ? '#b8accc' : '#8ee8f4';
        ctx.fillText(l, VIEW_W / 2, 112 + i * 13);
      });
      ctx.fillStyle = '#6a6080';
      ctx.fillText('按 确认 返回', VIEW_W / 2, 112 + lines.length * 13 + 4);
    }

    // ---- 飘灰 ----
    for (const a of this.ash) {
      const tw = 0.2 + 0.3 * Math.abs(Math.sin(a.ph * 2));
      ctx.globalAlpha = tw;
      ctx.fillStyle = '#c8bcd8';
      ctx.fillRect(Math.round(a.x), Math.round(a.y), 1, 1);
    }
    ctx.globalAlpha = 1;

    // ---- 底部 ----
    ctx.font = `7px ${F_SERIF}`;
    ctx.fillStyle = '#4a4258';
    ctx.fillText('同人作品 · 非官方 · 仅供学习交流', VIEW_W / 2, VIEW_H - 12);
    if (this.engine.world.cleared) {
      ctx.fillStyle = '#d8b060';
      ctx.fillText('★ 已通关 ★', VIEW_W / 2, VIEW_H - 22);
    }
    ctx.textAlign = 'left';
  }
}
