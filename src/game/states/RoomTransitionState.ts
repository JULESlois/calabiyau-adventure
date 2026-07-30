import { VIEW_H, VIEW_W } from '../constants';
import type { Engine, GameState } from '../Engine';
import type { PlayState } from './PlayState';

export type RoomTransitionSide = 'left' | 'right' | 'down';

export interface TransitionOffsets {
  oldX: number;
  oldY: number;
  nextX: number;
  nextY: number;
}

/** 两个独立房间画面的镜头位移。progress 范围为 0..1。 */
export function transitionOffsets(side: RoomTransitionSide, progress: number): TransitionOffsets {
  const p = Math.max(0, Math.min(1, progress));
  const clean = (value: number) => Object.is(value, -0) ? 0 : value;
  if (side === 'left') {
    return { oldX: p * VIEW_W, oldY: 0, nextX: clean(-(1 - p) * VIEW_W), nextY: 0 };
  }
  if (side === 'down') {
    return { oldX: 0, oldY: clean(-p * VIEW_H), nextX: 0, nextY: (1 - p) * VIEW_H };
  }
  return { oldX: clean(-p * VIEW_W), oldY: 0, nextX: (1 - p) * VIEW_W, nextY: 0 };
}

/**
 * 房间仍然独立加载,这里只冻结玩法并把前后两个画面拼成一次短镜头滑动。
 * HUD 单独固定绘制,避免两套界面跟着房间一起滑过屏幕。
 */
export class RoomTransitionState implements GameState {
  private elapsed = 0;

  constructor(
    private engine: Engine,
    readonly previous: PlayState,
    readonly next: PlayState,
    readonly side: RoomTransitionSide,
    readonly duration: number,
  ) {}

  enter(): void {}

  update(dt: number): void {
    this.elapsed += dt;
    if (this.elapsed >= this.duration) this.engine.completeRoomTransition(this, this.next);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const linear = Math.max(0, Math.min(1, this.elapsed / this.duration));
    const eased = linear * linear * (3 - 2 * linear);
    const offsets = transitionOffsets(this.side, eased);
    const alignment = 1 - eased;
    const nextWorldX = this.next.transitionWorldOffsetX * alignment;
    const nextWorldY = this.next.transitionWorldOffsetY * alignment;

    ctx.fillStyle = '#05040a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.renderScene(ctx, this.previous, offsets.oldX, offsets.oldY, 0, 0);
    this.renderScene(ctx, this.next, offsets.nextX, offsets.nextY, nextWorldX, nextWorldY);
    const oldPlayerX = this.previous.player.x - Math.round(this.previous.camX) + offsets.oldX;
    const oldPlayerY = this.previous.player.y - Math.round(this.previous.camY) + offsets.oldY;
    const nextPlayerX = this.next.player.x - Math.round(this.next.camX) + offsets.nextX + nextWorldX;
    const nextPlayerY = this.next.player.y - Math.round(this.next.camY) + offsets.nextY + nextWorldY;
    const playerX = oldPlayerX + (nextPlayerX - oldPlayerX) * eased;
    const playerY = oldPlayerY + (nextPlayerY - oldPlayerY) * eased;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();
    this.next.renderTransitionPlayer(ctx, playerX, playerY);
    ctx.restore();
    this.next.renderChrome(ctx, false);
  }

  private renderScene(
    ctx: CanvasRenderingContext2D,
    state: PlayState,
    x: number,
    y: number,
    worldX: number,
    worldY: number,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();
    ctx.translate(Math.round(x), Math.round(y));
    state.render(ctx, false, false, worldX, worldY);
    ctx.restore();
  }
}
