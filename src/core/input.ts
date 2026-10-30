import { INPUT, SIM } from '../config/game';
import { clamp } from './math';
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

/** Direction a key steers: -1, 1, or 0 for any other key. */
function keyAxis(code: string): number {
  return RIGHT_KEYS.includes(code) ? 1 : LEFT_KEYS.includes(code) ? -1 : 0;
}

/**
 * Collects mouse and keyboard input between ticks and hands it to the simulation as plain
 * per-tick data. Menu keys (start, pause) are handled in main.
 *
 * Keys and mouse buttons work in either mode, so players can switch mid-game. Mouse mode
 * uses relative motion under pointer lock. Where the browser refuses the lock (embedded
 * previews, iframes), the paddle follows the visible cursor, but only on ticks the cursor
 * moved, so a resting mouse does not fight the keys. A cursor that moved on while the paddle
 * was stunned is caught up with at `INPUT.stunCatchUp`, so the paddle glides back instead of jumping.
 */
export class Input {
  mode: ControlMode = 'mouse';

  private dx = 0;
  private cursorX: number | null = null;
  private cursorMoved = false;
  /** The cursor moved during a stun and the paddle hasn't reached it yet. */
  private catchUp = false;
  private launch = false;
  private alt = false;
  private mouseHeld = false;
  private held = new Set<string>();
  /** Direction of the latest steering press. */
  private lastAxis = 0;
  /** Direction pressed since the last sample, so a tap between two ticks still counts. */
  private tapAxis = 0;

  constructor(
    private lockTarget: HTMLElement,
    private view: FieldView,
  ) {
    document.addEventListener('mousemove', (e) => {
      if (this.locked) this.dx += (e.movementX / this.view.scale) * INPUT.mouseSensitivity;
      else {
        this.cursorX = e.clientX;
        this.cursorMoved = true;
      }
    });
    // On the playfield only (under pointer lock every click lands there), so clicking the
    // side panels during keyboard play does not fire.
    lockTarget.addEventListener('mousedown', (e) => {
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
      const axis = keyAxis(e.code);
      if (e.code === LAUNCH_KEY || axis !== 0) e.preventDefault();
      this.held.add(e.code);
      if (axis !== 0 && !e.repeat) this.lastAxis = this.tapAxis = axis;
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
   * The launch button doubles as fire: `launch` is the press, `fire` is held. `stunned`: the paddle
   * can't move this tick.
   */
  sample(paddleX: number, stunned = false): TickInput {
    const right = RIGHT_KEYS.some((k) => this.held.has(k)) ? 1 : 0;
    const left = LEFT_KEYS.some((k) => this.held.has(k)) ? 1 : 0;
    // The latest press wins, so rolling from one key to the other doesn't stall the paddle.
    const axis = this.tapAxis || (right && left ? this.lastAxis : right - left);
    let dx = this.dx;
    if (this.absolute && this.cursorX !== null) dx = this.cursorTravel(this.view.screenToWorldX(this.cursorX) - paddleX, stunned, dx);
    const fire = this.held.has(LAUNCH_KEY) || this.mouseHeld;
    const input: TickInput = { dx, axis, launch: this.launch, fire, alt: this.alt };
    this.dx = this.tapAxis = 0;
    this.cursorMoved = this.launch = this.alt = false;
    return input;
  }

  /** Paddle travel this tick when it follows the cursor, `toCursor` away; `rest` when it doesn't. */
  private cursorTravel(toCursor: number, stunned: boolean, rest: number): number {
    if (stunned) {
      this.catchUp ||= this.cursorMoved;
      return rest;
    }
    if (!this.catchUp) return this.cursorMoved ? toCursor : rest;
    const step = INPUT.stunCatchUp / SIM.tickRate;
    this.catchUp = Math.abs(toCursor) > step;
    return clamp(toCursor, -step, step);
  }

  /** Drops anything collected while the game was not running. */
  reset(): void {
    this.dx = this.tapAxis = 0;
    this.cursorMoved = this.catchUp = this.launch = this.alt = false;
  }
}
