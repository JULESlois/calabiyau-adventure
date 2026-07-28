import { AudioSys } from './Audio';
import { DT, VIEW_H, VIEW_W } from './constants';
import { Input } from './Input';
import { clearWorldSave, loadWorldSave, storeWorldSave } from './save';
import { PlayState, type EntryInfo } from './states/PlayState';
import { TitleState } from './states/TitleState';
import { ROOMS, START_ROOM, ZONES, type Ability } from './world/world';
import { WorldState } from './world/WorldState';

export interface GameState {
  enter(): void;
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
}

export class Engine {
  ctx: CanvasRenderingContext2D;
  input = new Input();
  audio = new AudioSys();
  world = new WorldState();
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
    this.input.onAnyKey = () => this.audio.unlock();
  }

  hasSave(): boolean {
    return loadWorldSave() !== null;
  }

  newGame(): void {
    clearWorldSave();
    this.world = new WorldState();
    this.startRoom(START_ROOM, { kind: 'start' });
  }

  continueGame(): void {
    const d = loadWorldSave();
    this.world = d ? WorldState.deserialize(d) : new WorldState();
    this.world.hp = this.world.hpMax;
    this.world.energy = this.world.energyMax;
    this.startRoom(this.world.benchRoom, { kind: 'bench' });
  }

  respawnAtBench(): void {
    this.world.hp = this.world.hpMax;
    this.world.energy = this.world.energyMax;
    this.startRoom(this.world.benchRoom, { kind: 'bench' });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.input.attach();
    this.showTitle();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__CBQ__ = {
        engine: this,
        newGame: () => this.newGame(),
        continueGame: () => this.continueGame(),
        goRoom: (id: string) => this.startRoom(id, { kind: 'start' }),
        grant: (a: Ability) => {
          this.world.grant(a);
        },
        giveDust: (n: number) => {
          this.world.dust += n;
        },
        grantAll: () => {
          for (const a of ['paper', 'cling', 'djump', 'dash', 'kanami'] as Ability[]) this.world.grant(a);
        },
        info: () => {
          const s = this.state;
          if (s instanceof PlayState) {
            return {
              state: 'play',
              room: s.roomId,
              zone: s.room.zone,
              x: Math.round(s.player.x),
              y: Math.round(s.player.y),
              hp: s.player.hp,
              hpMax: this.world.hpMax,
              energy: Math.round(s.player.energy),
              energyMax: this.world.energyMax,
              char: s.player.char,
              paper: s.player.paper,
              stringMode: s.player.stringMode,
              overlay: s.overlay,
              abilities: [...this.world.abilities],
              crystals: this.world.crystals.size,
              shortcuts: [...this.world.shortcuts],
              visited: [...this.world.visited],
              enemies: s.enemies.filter((e) => !e.dead).length,
              boss: s.boss ? { state: s.boss.state, hp: s.boss.hp } : null,
            };
          }
          return { state: 'title' };
        },
      };
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.audio.dispose();
    if (import.meta.env.DEV) {
      const host = window as unknown as Record<string, unknown>;
      const hook = host.__CBQ__;
      if (typeof hook === 'object' && hook !== null && Reflect.get(hook, 'engine') === this) {
        delete host.__CBQ__;
      }
    }
  }

  showTitle(): void {
    this.state = new TitleState(this);
    this.state.enter();
  }

  startRoom(roomId: string, entry: EntryInfo): void {
    const room = ROOMS[roomId];
    if (!room) {
      console.error(`未知房间: ${roomId}`);
      return;
    }
    this.world.visited.add(roomId);
    this.audio.playSong(ZONES[room.zone].song);
    this.state = new PlayState(this, roomId, entry);
    this.state.enter();
  }

  persistWorld(): void {
    storeWorldSave(this.world.serialize());
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
      this.input.pollGamepad();
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
  const lg = g.createLinearGradient(0, 0, 0, 40);
  lg.addColorStop(0, 'rgba(4,3,8,0.30)');
  lg.addColorStop(1, 'rgba(4,3,8,0)');
  g.fillStyle = lg;
  g.fillRect(0, 0, VIEW_W, 40);
  return c;
}
