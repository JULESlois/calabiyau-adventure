import { VIEW_H, VIEW_W } from '../constants';
import type { Engine, GameState } from '../Engine';
import type { PlayState } from './PlayState';

export interface BeaconTransferFrame {
  showNext: boolean;
  blackout: number;
}

/** 前半程淡出旧房间，完全黑场时换房，后半程淡入新房间。 */
export function beaconTransferFrame(progress: number): BeaconTransferFrame {
  const p = Math.max(0, Math.min(1, progress));
  const half = p < 0.5 ? p * 2 : (1 - p) * 2;
  const blackout = half * half * (3 - 2 * half);
  return { showNext: p >= 0.5, blackout };
}

export class BeaconTransferState implements GameState {
  private elapsed = 0;

  constructor(
    private engine: Engine,
    readonly previous: PlayState,
    readonly next: PlayState,
    readonly duration = 0.5,
  ) {}

  enter(): void {}

  update(dt: number): void {
    this.elapsed += dt;
    if (this.elapsed >= this.duration) this.engine.completeBeaconTransfer(this, this.next);
  }

  renderUi(ctx: CanvasRenderingContext2D): void {
    const frame = beaconTransferFrame(this.elapsed / this.duration);
    (frame.showNext ? this.next : this.previous).renderUi(ctx);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const frame = beaconTransferFrame(this.elapsed / this.duration);
    (frame.showNext ? this.next : this.previous).render(ctx);
    if (frame.blackout <= 0) return;
    ctx.save();
    ctx.globalAlpha = frame.blackout;
    ctx.fillStyle = '#03040a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }
}
