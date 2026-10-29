import type { POWER, STAGE_EVENTS } from '../config/tuning';

export type GameState = 'serve' | 'play' | 'clear' | 'over' | 'complete';

export type BrickKind = 'normal' | 'tough' | 'steel';

export type PowerKind = keyof typeof POWER.kinds;
/** Powers that give charges, spent one per alt press. */
export type ChargePower = 'detonator';
/** Powers that run on a timer: those with a duration (the rest act once on pickup, or give charges). */
export type TimedPower = { [K in PowerKind]: (typeof POWER.kinds)[K]['duration'] extends 0 ? never : K }[PowerKind];
export type HitSource = 'ball' | 'laser' | 'pulse' | 'blast';
export type StageEventKind = keyof typeof STAGE_EVENTS.kinds;

/** Player input for one tick. Plain data so runs can later be recorded and replayed. */
export interface TickInput {
  /** Paddle movement from the mouse, in world units. */
  dx: number;
  /** Keyboard direction: -1, 0 or 1. */
  axis: number;
  launch: boolean;
  /** Fire button held (auto-fires the laser). */
  fire: boolean;
  /** Alt button press (spends a charge, e.g. detonates a ball). */
  alt: boolean;
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
  /** Bricks this ball has destroyed since it last touched the paddle. */
  chain: number;
  /** Chain bonus points (multiplier included) this chain has earned so far. */
  chainPoints: number;
  /** Id of the portal the ball just came out of; that portal ignores it until it has left. */
  inPortal: number | null;
}

/** Pinball target: a round lamp the ball bounces off and lights. Position is the centre. */
export interface Target {
  /** Tells targets apart from bricks where the ball can hit either. */
  kind: 'target';
  id: number;
  x: number;
  y: number;
  r: number;
  lit: boolean;
  /** Tick of the last hit, for flash effects. */
  hitTick: number;
}

/** One end of a portal pair. Position is the centre. */
export interface Portal {
  id: number;
  x: number;
  y: number;
  r: number;
  /** Id of the portal at the other end. */
  exit: number;
  /** Which pair it belongs to, in layout order (0, 1, ...); pairs are told apart by colour. */
  pair: number;
  /** Tick a ball last went through it, either way, for flash effects. */
  warpTick: number;
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
