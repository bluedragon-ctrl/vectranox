import type { MODS } from '../config/mods';
import type { POWER, STAGE_EVENTS } from '../config/tuning';

/** `draft` (the pick between stages) waits for the player's choice. */
export type GameState = 'serve' | 'play' | 'clear' | 'draft' | 'over' | 'complete';

export type BrickKind = 'normal' | 'steel' | 'explosive' | 'regen' | 'core' | EmitterKind;
/** Boss bricks that act on the phase's timers: fire shots, send falling bricks, release shadow balls. */
export type EmitterKind = 'turret' | 'spawner' | 'phantom';

export type PowerKind = keyof typeof POWER.kinds;
/** Powers that run on a timer: those with a duration (the rest act once on pickup). */
export type TimedPower = { [K in PowerKind]: (typeof POWER.kinds)[K]['duration'] extends 0 ? never : K }[PowerKind];
/** A `POWER.kinds` entry, for reading the fields only some kinds have. */
export interface PowerDef {
  duration: number;
  opposite?: TimedPower;
}
/** A `STAGE_EVENTS.kinds` entry, for reading the fields only some kinds have. */
export interface StageEventDef {
  chance: number;
  stall?: readonly number[];
  power?: PowerKind;
  duration?: number;
}
export type HitSource = 'ball' | 'laser' | 'pulse' | 'explosion';
/** What set off an explosion: a charged ball, or an explosive brick's fuse. */
export type ExplosionSource = 'charge' | 'brick';
export type StageEventKind = keyof typeof STAGE_EVENTS.kinds;
export type ModKind = keyof typeof MODS;

/** Player input for one tick. Plain data so runs can later be recorded and replayed. */
export interface TickInput {
  /** Paddle movement from the mouse, in world units. */
  dx: number;
  /** Keyboard direction: -1, 0 or 1. */
  axis: number;
  launch: boolean;
  /** Fire button held (auto-fires the laser). */
  fire: boolean;
  /** Alt button press (starts focus). */
  alt: boolean;
  /** Alt button held (keeps focus going). */
  altHeld: boolean;
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
  /** Bricks it will still explode on (detonator). */
  charges: number;
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

/**
 * Decoy from a phantom brick: bounces like a ball but breaks nothing, and losing it costs nothing.
 * Kept out of `Game.balls`, so no ball rule ever applies to it.
 */
export interface ShadowBall {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  r: number;
  /** Seconds until it fades away. */
  life: number;
}

/** Boss shot, stuns the paddle it reaches. Position is the centre. */
export interface Shot {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
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
  /** Bricks it can still break and fly on through (piercing laser mod). */
  pierce: number;
}

/** Position is the bottom-left corner; `px`, `py` are where it was at the previous tick. */
export interface Brick {
  id: number;
  row: number;
  col: number;
  x: number;
  y: number;
  px: number;
  py: number;
  w: number;
  h: number;
  kind: BrickKind;
  /** Hits left; unused for steel. */
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Tick of the last hit, for flash effects. */
  hitTick: number;
  /** Tick a regenerating brick last won back a hit. */
  healTick: number;
  /** Sent by a spawner: falls to the line, pays nothing and doesn't count towards the clear. */
  falling: boolean;
  /** How far an emitter has wound up towards acting, 0..1. */
  charge: number;
}
