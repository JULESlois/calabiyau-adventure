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
  | 'interact'
  | 'wall';

export const KEYMAP: Readonly<Record<string, readonly Action[]>> = {
  KeyA: ['left'],
  ArrowLeft: ['left'],
  KeyD: ['right'],
  ArrowRight: ['right'],
  KeyW: ['up', 'jump'],
  ArrowUp: ['up', 'jump'],
  KeyS: ['down'],
  ArrowDown: ['down'],
  Space: ['jump', 'confirm'],
  KeyE: ['wall'],
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

/** Standard Gamepad 映射。互斥动作使用独立按键，避免一次输入触发多个玩法动作。 */
export const GAMEPAD_BUTTON_ACTIONS: Readonly<Partial<Record<number, readonly Action[]>>> = {
  0: ['jump', 'confirm'], // A / Cross
  1: ['melee'], // B / Circle
  2: ['shoot'], // X / Square
  3: ['skill'], // Y / Triangle
  4: ['wall'], // LB：贴墙吸附/脱离
  5: ['dash'], // RB
  6: ['paper'], // LT：普通弦化/空中飘飞
  7: ['shoot'], // RT
  8: ['map'], // Select / Back
  9: ['pause'], // Start / Menu
  10: ['switch'], // L3
  11: ['interact'], // R3：场景交互
  12: ['up'], // D-Pad Up
  13: ['down'], // D-Pad Down
  14: ['left'], // D-Pad Left
  15: ['right'], // D-Pad Right
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
      }
      if (ly > DEADZONE) currentGpActions.add('down');

      const b = gp.buttons;
      for (const [index, actions] of Object.entries(GAMEPAD_BUTTON_ACTIONS)) {
        if (!actions || !b[Number(index)]?.pressed) continue;
        for (const action of actions) currentGpActions.add(action);
      }
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
