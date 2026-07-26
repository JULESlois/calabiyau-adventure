import { AudioSys } from './Audio';
import { DT, VIEW_H, VIEW_W } from './constants';
import { Input } from './Input';
import { loadSave, storeSave, type SaveData } from './save';
import { PlayState } from './states/PlayState';
import { TitleState } from './states/TitleState';

export interface GameState {
  enter(): void;
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
}

export class Engine {
  ctx: CanvasRenderingContext2D;
  input = new Input();
  audio = new AudioSys();
  save: SaveData;
  state: GameState | null = null;

  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private post: HTMLCanvasElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.save = loadSave();
    this.input.onAnyKey = () => this.audio.unlock();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.input.attach();
    this.showTitle();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);

    // 冒烟测试 / 调试钩子
    (window as unknown as Record<string, unknown>).__CBQ__ = {
      engine: this,
      startLevel: (n: number) => this.startLevel(n),
      info: () => {
        const s = this.state;
        if (s instanceof PlayState) {
          return {
            state: 'play',
            level: s.levelId,
            x: Math.round(s.player.x),
            y: Math.round(s.player.y),
            hp: s.player.hp,
            energy: Math.round(s.player.energy),
            char: s.player.char,
            paper: s.player.paper,
            overlay: s.overlay,
            enemies: s.enemies.filter((e) => !e.dead).length,
            crystals: s.crystals,
            boss: s.boss ? { state: s.boss.state, hp: s.boss.hp } : null,
          };
        }
        return { state: 'title' };
      },
    };
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.audio.dispose();
  }

  showTitle(): void {
    this.state = new TitleState(this);
    this.state.enter();
  }

  startLevel(n: number): void {
    this.state = new PlayState(this, n);
    this.state.enter();
  }

  persistSave(): void {
    storeSave(this.save);
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1; // 切后台回来防跳帧
    this.acc += dt;

    let steps = 0;
    while (this.acc >= DT && steps < 6) {
      if (this.input.pressed('mute')) this.audio.toggleMute();
      this.state?.update(DT);
      this.input.endFrame();
      this.acc -= DT;
      steps++;
    }
    if (steps === 6) this.acc = 0;

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    this.state?.render(ctx);

    // 后处理:哥特暗角
    if (!this.post) this.post = buildVignette();
    if (this.post) ctx.drawImage(this.post, 0, 0);
  };
}

function buildVignette(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = VIEW_W;
  c.height = VIEW_H;
  const g = c.getContext('2d');
  if (!g) return null;
  const rg = g.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 105, VIEW_W / 2, VIEW_H / 2, 305);
  rg.addColorStop(0, 'rgba(6,4,12,0)');
  rg.addColorStop(0.7, 'rgba(6,4,12,0.18)');
  rg.addColorStop(1, 'rgba(6,4,12,0.52)');
  g.fillStyle = rg;
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  // 顶部再压一点,舞台感
  const lg = g.createLinearGradient(0, 0, 0, 40);
  lg.addColorStop(0, 'rgba(4,3,8,0.30)');
  lg.addColorStop(1, 'rgba(4,3,8,0)');
  g.fillStyle = lg;
  g.fillRect(0, 0, VIEW_W, 40);
  return c;
}
