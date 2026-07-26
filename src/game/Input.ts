export type Action =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'jump'
  | 'shoot'
  | 'melee'
  | 'skill'
  | 'paper'
  | 'switch'
  | 'pause'
  | 'mute'
  | 'confirm';

const KEYMAP: Record<string, Action[]> = {
  KeyA: ['left'],
  ArrowLeft: ['left'],
  KeyD: ['right'],
  ArrowRight: ['right'],
  KeyW: ['up', 'jump'],
  ArrowUp: ['up', 'jump'],
  KeyS: ['down'],
  ArrowDown: ['down'],
  Space: ['jump', 'confirm'],
  KeyJ: ['shoot'],
  KeyK: ['melee'],
  KeyL: ['skill'],
  ShiftLeft: ['paper'],
  ShiftRight: ['paper'],
  KeyQ: ['switch'],
  Escape: ['pause'],
  KeyM: ['mute'],
  Enter: ['confirm'],
};

export class Input {
  private held = new Set<Action>();
  private pressedNow = new Set<Action>();
  /** 供音频解锁等一次性副作用 */
  onAnyKey: (() => void) | null = null;

  private keydown = (e: KeyboardEvent) => {
    const actions = KEYMAP[e.code];
    if (!actions) return;
    e.preventDefault();
    if (this.onAnyKey) this.onAnyKey();
    for (const a of actions) {
      if (!this.held.has(a)) this.pressedNow.add(a);
      this.held.add(a);
    }
  };

  private keyup = (e: KeyboardEvent) => {
    const actions = KEYMAP[e.code];
    if (!actions) return;
    for (const a of actions) this.held.delete(a);
  };

  private blur = () => {
    this.held.clear();
  };

  attach(): void {
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.blur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.blur);
  }

  down(a: Action): boolean {
    return this.held.has(a);
  }

  pressed(a: Action): boolean {
    return this.pressedNow.has(a);
  }

  /** 每帧末尾调用,清掉"刚按下"状态 */
  endFrame(): void {
    this.pressedNow.clear();
  }
}
