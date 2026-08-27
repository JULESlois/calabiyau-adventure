import { AudioSys } from './Audio';
import { DT, VIEW_H, VIEW_W } from './constants';
import { Input } from './Input';
import { clearWorldSave, loadWorldSave, storeWorldSave } from './save';
import { loadSettings, storeSettings, type GameSettings } from './settings';
import { PlayState, type EntryInfo } from './states/PlayState';
import { BeaconTransferState } from './states/BeaconTransferState';
import { RoomTransitionState } from './states/RoomTransitionState';
import { TitleState } from './states/TitleState';
import { ROOMS, START_ROOM, ZONES, type Ability } from './world/world';
import { WorldState } from './world/WorldState';

export interface GameState {
  enter(): void;
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
  /**
   * 界面层(HUD/覆盖层/对话)的高分辨率绘制入口。
   * UI 画布按显示分辨率开背板并预乘 scale 变换,绘制代码仍用 480×270 逻辑坐标,
   * 文字因此在真实像素上栅格化 —— 中文终于不再是放大后的马赛克。
   * 不实现则回退到主画布(测试与无 DOM 工装走这条路)。
   */
  renderUi?(ctx: CanvasRenderingContext2D): void;
}

export class Engine {
  ctx: CanvasRenderingContext2D;
  input = new Input();
  audio = new AudioSys();
  world = new WorldState();
  settings: GameSettings = loadSettings();
  state: GameState | null = null;

  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private post: HTMLCanvasElement | null = null;
  private uiCtx: CanvasRenderingContext2D | null = null;
  private uiScale = 1;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.audio.applyVolumePrefs(this.settings.musicVol, this.settings.sfxVol, this.settings.muted);
    this.input.onAnyKey = () => this.audio.unlock();
  }

  /** React 宿主在布局变化时同步 UI 画布;scale 含 devicePixelRatio。 */
  setUiSurface(canvas: HTMLCanvasElement, scale: number): void {
    this.uiCtx = canvas.getContext('2d');
    this.uiScale = Math.max(0.1, scale);
  }

  get hasUiSurface(): boolean {
    return this.uiCtx !== null;
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
          for (const a of ['paper', 'cling', 'djump', 'dash', 'flash', 'skystep', 'kinetic', 'kanami'] as Ability[]) this.world.grant(a);
        },
        info: () => {
          const s = this.state instanceof RoomTransitionState || this.state instanceof BeaconTransferState
            ? this.state.next
            : this.state;
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
    this.audio.setMusicState({ intensity: 0, ducked: false });
    this.state = new TitleState(this);
    this.state.enter();
  }

  startRoom(roomId: string, entry: EntryInfo): void {
    const room = ROOMS[roomId];
    if (!room) {
      console.error(`未知房间: ${roomId}`);
      return;
    }
    const previous = entry.kind === 'door' && this.state instanceof PlayState ? this.state : null;
    // 先取再加:进入后才知道这是不是第一次到访,用来决定要不要报房间名。
    const firstVisit = !this.world.visited.has(roomId);
    this.world.visited.add(roomId);
    const fromRoom = entry.kind === 'door' ? ROOMS[entry.fromRoom] : undefined;
    const keepBoundaryMusic = Boolean(
      room.transition && fromRoom && (fromRoom.zone === room.zone || fromRoom.zone === room.transition.to),
    );
    this.audio.setMusicState({ intensity: 0, ducked: false });
    if (!keepBoundaryMusic) {
      const fadeTime = entry.kind === 'door' ? 1.15 : 0.8;
      this.audio.playSong(ZONES[room.zone].song, fadeTime);
    }

    const next = new PlayState(this, roomId, entry);
    next.announceRoomName = firstVisit;
    next.enter();
    if (previous && entry.kind === 'door') {
      const sameZone = previous.room.zone === room.zone;
      this.state = new RoomTransitionState(this, previous, next, entry.fromSide, sameZone ? 0.36 : 0.46);
      this.state.enter();
    } else {
      this.state = next;
    }
  }

  completeRoomTransition(transition: RoomTransitionState, next: PlayState): void {
    if (this.state === transition) this.state = next;
  }

  startBeaconTransfer(roomId: string): void {
    if (!(this.state instanceof PlayState)) return;
    const room = ROOMS[roomId];
    if (!room || !this.world.activatedBeacons.has(roomId)) return;

    const previous = this.state;
    this.world.visited.add(roomId);
    this.audio.setMusicState({ intensity: 0, ducked: false });
    this.audio.playSong(ZONES[room.zone].song, 0.8);
    const next = new PlayState(this, roomId, { kind: 'bench', fromZone: previous.room.zone });
    next.enter();
    this.state = new BeaconTransferState(this, previous, next);
    this.state.enter();
  }

  completeBeaconTransfer(transfer: BeaconTransferState, next: PlayState): void {
    if (this.state === transfer) this.state = next;
  }

  persistWorld(): void {
    storeWorldSave(this.world.serialize());
  }

  /** 设置菜单改动后统一走这里:应用 + 落盘。 */
  applySettings(): void {
    this.audio.applyVolumePrefs(this.settings.musicVol, this.settings.sfxVol, this.settings.muted);
    storeSettings(this.settings);
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
      if (this.input.pressed('mute')) {
        this.settings.muted = this.audio.toggleMute();
        storeSettings(this.settings);
      }
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

    // UI 层:显示分辨率画布,叠在暗角之上
    if (this.uiCtx && this.state?.renderUi) {
      const ui = this.uiCtx;
      ui.setTransform(1, 0, 0, 1, 0, 0);
      ui.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
      ui.setTransform(this.uiScale, 0, 0, this.uiScale, 0, 0);
      this.state.renderUi(ui);
      ui.setTransform(1, 0, 0, 1, 0, 0);
    }
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
