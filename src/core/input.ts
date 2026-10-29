import { INPUT } from '../config/game';
import type { TickInput } from '../game/types';

export type ControlMode = 'mouse' | 'keyboard';

/** Mapping from screen to playfield, provided by the renderer. */
export interface FieldView {
  /** CSS pixels per world unit. */
  readonly scale: number;
  screenToWorldX(clientX: number): number;
}

const LEFT_KEYS = ['ArrowLeft', 'KeyA'];
const RIGHT_KEYS = ['ArrowRight', 'KeyD'];
const LAUNCH_KEY = 'Space';
const ALT_KEY = 'KeyX';
/** MouseEvent.button for the alt action. */
const ALT_BUTTON = 2;

/**
 * Collects mouse and keyboard input between ticks and hands it to the simulation as plain
 * per-tick data. Menu keys (start, pause) are handled in main.
 *
 * Mouse mode uses relative motion under pointer lock. Where the browser refuses the lock
 * (embedded previews, iframes), the paddle follows the visible cursor instead.
 */
export class Input {
  mode: ControlMode = 'mouse';

  private dx = 0;
  private cursorX: number | null = null;
  private launch = false;
  private alt = false;
  private mouseHeld = false;
  private held = new Set<string>();

  constructor(
    private lockTarget: HTMLElement,
    private view: FieldView,
  ) {
    document.addEventListener('mousemove', (e) => {
      if (this.locked) this.dx += (e.movementX / this.view.scale) * INPUT.mouseSensitivity;
      else this.cursorX = e.clientX;
    });
    document.addEventListener('mousedown', (e) => {
      if (this.mode !== 'mouse') return;
      if (e.button === ALT_BUTTON) this.alt = true;
      if (e.button !== 0) return;
      this.launch = true;
      this.mouseHeld = true;
    });
    // Right click is the alt button, so the playfield never opens a context menu.
    lockTarget.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseHeld = false;
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === LAUNCH_KEY || LEFT_KEYS.includes(e.code) || RIGHT_KEYS.includes(e.code)) e.preventDefault();
      this.held.add(e.code);
      if (e.code === LAUNCH_KEY && !e.repeat) this.launch = true;
      if (e.code === ALT_KEY && !e.repeat) this.alt = true;
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.mouseHeld = false;
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.lockTarget;
  }

  /** Mouse mode without pointer lock: the paddle tracks the cursor position. */
  get absolute(): boolean {
    return this.mode === 'mouse' && !this.locked;
  }

  /**
   * Input for the next tick; consumes accumulated mouse motion and the launch and alt presses.
   * The launch button doubles as fire: `launch` is the press, `fire` is held.
   */
  sample(paddleX: number): TickInput {
    const right = RIGHT_KEYS.some((k) => this.held.has(k)) ? 1 : 0;
    const left = LEFT_KEYS.some((k) => this.held.has(k)) ? 1 : 0;
    let dx = this.dx;
    if (this.absolute && this.cursorX !== null) dx = this.view.screenToWorldX(this.cursorX) - paddleX;
    const fire = this.held.has(LAUNCH_KEY) || (this.mode === 'mouse' && this.mouseHeld);
    const input: TickInput = { dx, axis: right - left, launch: this.launch, fire, alt: this.alt };
    this.dx = 0;
    this.launch = this.alt = false;
    return input;
  }

  /** Drops anything collected while the game was not running. */
  reset(): void {
    this.dx = 0;
    this.launch = this.alt = false;
  }
}
