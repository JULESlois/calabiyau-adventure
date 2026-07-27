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
  | 'map'
  | 'dash'
  | 'confirm'
  | 'interact';

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
  KeyE: ['interact'],
  KeyF: ['interact'],
  KeyJ: ['shoot'],
  KeyK: ['melee'],
  KeyL: ['skill'],
  ShiftLeft: ['paper'],
  ShiftRight: ['paper'],
  KeyQ: ['switch'],
  Escape: ['pause'],
  KeyM: ['mute'],
  Tab: ['map'],
  KeyI: ['map'],
  KeyU: ['dash'],
  Semicolon: ['dash'],
  Enter: ['confirm'],
};

export class Input {
  private keyboardHeld = new Set<Action>();
  private gamepadHeld = new Set<Action>();
  private pressedNow = new Set<Action>();

  /** 供音频解锁等一次性副作用 */
  onAnyKey: (() => void) | null = null;

  private keydown = (e: KeyboardEvent) => {
    const actions = KEYMAP[e.code];
    if (!actions) return;
    e.preventDefault();
    if (this.onAnyKey) this.onAnyKey();
    for (const a of actions) {
      if (!this.keyboardHeld.has(a) && !this.gamepadHeld.has(a)) {
        this.pressedNow.add(a);
      }
      this.keyboardHeld.add(a);
    }
  };

  private keyup = (e: KeyboardEvent) => {
    const actions = KEYMAP[e.code];
    if (!actions) return;
    for (const a of actions) this.keyboardHeld.delete(a);
  };

  private pointerdown = () => {
    if (this.onAnyKey) this.onAnyKey();
  };

  private blur = () => {
    this.keyboardHeld.clear();
    this.gamepadHeld.clear();
  };

  attach(): void {
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('pointerdown', this.pointerdown);
    window.addEventListener('blur', this.blur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('pointerdown', this.pointerdown);
    window.removeEventListener('blur', this.blur);
  }

  pollGamepad(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const gamepads = navigator.getGamepads();
    const currentGpActions = new Set<Action>();

    for (const gp of gamepads) {
      if (!gp || !gp.connected) continue;

      const DEADZONE = 0.35;
      const lx = gp.axes[0] ?? 0;
      const ly = gp.axes[1] ?? 0;

      if (lx < -DEADZONE) currentGpActions.add('left');
      if (lx > DEADZONE) currentGpActions.add('right');
      if (ly < -DEADZONE) {
        currentGpActions.add('up');
        currentGpActions.add('jump');
      }
      if (ly > DEADZONE) currentGpActions.add('down');

      const b = gp.buttons;
      if (b[0]?.pressed) { currentGpActions.add('jump'); currentGpActions.add('confirm'); currentGpActions.add('interact'); } // A / Cross
      if (b[1]?.pressed) { currentGpActions.add('melee'); currentGpActions.add('dash'); }    // B / Circle
      if (b[2]?.pressed) { currentGpActions.add('shoot'); currentGpActions.add('interact'); }                                  // X / Square
      if (b[3]?.pressed) { currentGpActions.add('skill'); currentGpActions.add('interact'); }                                  // Y / Triangle
      if (b[4]?.pressed) { currentGpActions.add('paper'); }                                  // LB
      if (b[5]?.pressed) { currentGpActions.add('dash'); }                                   // RB
      if (b[6]?.pressed) { currentGpActions.add('paper'); }                                  // LT
      if (b[7]?.pressed) { currentGpActions.add('shoot'); }                                  // RT
      if (b[8]?.pressed) { currentGpActions.add('switch'); }                                 // Select
      if (b[9]?.pressed) { currentGpActions.add('pause'); currentGpActions.add('map'); }    // Start
      if (b[10]?.pressed) { currentGpActions.add('switch'); }                                // L3
      if (b[12]?.pressed) { currentGpActions.add('up'); currentGpActions.add('jump'); }     // D-Pad Up
      if (b[13]?.pressed) { currentGpActions.add('down'); }                                  // D-Pad Down
      if (b[14]?.pressed) { currentGpActions.add('left'); }                                  // D-Pad Left
      if (b[15]?.pressed) { currentGpActions.add('right'); }                                 // D-Pad Right
    }

    if (currentGpActions.size > 0 && this.onAnyKey) {
      this.onAnyKey();
    }

    for (const action of currentGpActions) {
      if (!this.gamepadHeld.has(action) && !this.keyboardHeld.has(action)) {
        this.pressedNow.add(action);
      }
    }

    this.gamepadHeld = currentGpActions;
  }

  down(a: Action): boolean {
    return this.keyboardHeld.has(a) || this.gamepadHeld.has(a);
  }

  pressed(a: Action): boolean {
    return this.pressedNow.has(a);
  }

  /** 每帧末尾调用,清掉"刚按下"状态 */
  endFrame(): void {
    this.pressedNow.clear();
  }
}
