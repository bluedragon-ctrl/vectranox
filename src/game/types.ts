import type { POWER } from '../config/powers';

export type GameState = 'serve' | 'play' | 'clear' | 'over' | 'complete';

export type BrickKind = 'normal' | 'tough' | 'steel';

export type PowerKind = keyof typeof POWER.kinds;
/** Powers that run on a timer (the rest act once on pickup). */
export type TimedPower = Exclude<PowerKind, 'multi' | 'life'>;
export type HitSource = 'ball' | 'laser';

/** Player input for one tick. Plain data so runs can later be recorded and replayed. */
export interface TickInput {
  /** Paddle movement from the mouse, in world units. */
  dx: number;
  /** Keyboard direction: -1, 0 or 1. */
  axis: number;
  launch: boolean;
  /** Fire button held (auto-fires the laser). */
  fire: boolean;
}

/** Position is the centre; `px` is x at the previous tick, for render interpolation. */
export interface Paddle {
  x: number;
  px: number;
  y: number;
  w: number;
  h: number;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  r: number;
  /** Base speed; the slow/fast powers scale it. */
  speed: number;
  /** Set while the catch power holds the ball: position along the paddle, -1..1. */
  stuck: number | null;
  /** Seconds the ball has been held by catch. */
  stuckTime: number;
}

/** Falling power-up. Position is the centre. */
export interface Capsule {
  id: number;
  kind: PowerKind;
  x: number;
  y: number;
  py: number;
}

/** Laser bolt. Position is the tip. */
export interface Bolt {
  id: number;
  x: number;
  y: number;
  py: number;
}

/** Position is the bottom-left corner. */
export interface Brick {
  id: number;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: BrickKind;
  /** Hits left; unused for steel. */
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Tick of the last hit, for flash effects. */
  hitTick: number;
}
