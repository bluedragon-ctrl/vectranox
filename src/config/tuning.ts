import { PALETTE } from './game';

/*
 * Gameplay tuning: power-ups and stage events. Everything here is meant to be tweaked by hand;
 * the simulation reads it but never changes it.
 */

/**
 * In-stage power-ups: how often they drop, how long they last and what they do.
 *
 * Drops: every destroyed brick rolls `dropChance`; on a hit, the kind is picked by weight. Weights
 * are relative, so a kind's share of drops is its weight divided by the sum of all weights (set a
 * weight to 0 to switch a kind off). No capsule drops while `maxCapsules` are already falling.
 *
 * Durations are in seconds; 0 means the power is instant. Picking a timed power again restarts
 * its timer; opposites (expand/narrow, slow/fast) cancel each other. Charge powers (detonator)
 * have no timer: each capsule adds charges, and the alt button spends them.
 */
export const POWER = {
  /** Chance (0..1) that a destroyed brick drops a capsule. */
  dropChance: 0.14,
  maxCapsules: 3,
  kinds: {
    multi: { duration: 0, weight: 14 },
    laser: { duration: 12, weight: 10 },
    expand: { duration: 15, weight: 12 },
    narrow: { duration: 10, weight: 8 },
    slow: { duration: 12, weight: 10 },
    fast: { duration: 10, weight: 8 },
    catch: { duration: 15, weight: 9 },
    pierce: { duration: 8, weight: 6 },
    barrier: { duration: 12, weight: 7 },
    life: { duration: 0, weight: 3 },
    detonator: { duration: 0, weight: 6 },
  },

  capsuleWidth: 22,
  capsuleHeight: 10,
  fallSpeed: 70,
  maxBalls: 12,
  maxLives: 9,
  /** Angle between split balls. */
  splitAngle: (22 * Math.PI) / 180,
  expandScale: 1.5,
  narrowScale: 0.65,
  /** Paddle width approaches its target at this rate (1/s). */
  widthRate: 10,
  slowScale: 0.7,
  fastScale: 1.3,
  /** A caught ball releases itself after this long. */
  catchHold: 3,
  laserCooldown: 0.3,
  boltSpeed: 560,
  boltLength: 8,
  /** Bolts leave the paddle this far in from either end. */
  boltInset: 5,
  barrierY: 7,
  /**
   * Alt press: the highest ball explodes and every breakable brick within `radius` (measured to
   * the nearest point of the brick) takes `damage` hits; steel is unaffected and the ball flies on.
   * A capsule adds `charges`, up to `maxCharges`.
   */
  detonator: { charges: 3, maxCharges: 5, radius: 32, damage: 1 },
} as const;

/** How each power shows up: capsule letter, colour, and whether it is a negative one. */
export const POWER_LOOK = {
  multi: { label: 'MULTI', glyph: 'M', color: PALETTE.cyan, bad: false },
  laser: { label: 'LASER', glyph: 'L', color: PALETTE.magenta, bad: false },
  expand: { label: 'EXPAND', glyph: 'E', color: 0x3d8bff, bad: false },
  narrow: { label: 'NARROW', glyph: 'N', color: 0xff3b30, bad: true },
  slow: { label: 'SLOW', glyph: 'S', color: 0x2dffb4, bad: false },
  fast: { label: 'FAST', glyph: 'F', color: 0xff3b30, bad: true },
  catch: { label: 'CATCH', glyph: 'C', color: PALETTE.purple, bad: false },
  pierce: { label: 'PIERCE', glyph: 'P', color: PALETTE.white, bad: false },
  barrier: { label: 'BARRIER', glyph: 'B', color: PALETTE.yellow, bad: false },
  life: { label: 'LIFE', glyph: '+', color: 0xff7ad9, bad: false },
  detonator: { label: 'DETONATOR', glyph: 'X', color: 0xff8a2a, bad: false },
} as const satisfies Record<keyof typeof POWER.kinds, { label: string; glyph: string; color: number; bad: boolean }>;

/**
 * Stage events: rule-based help that keeps the end of a stage from dragging.
 *
 * When an event's trigger is met it rolls `chance` (0..1, set it to 0 to switch the event off).
 * Hit or miss, the trigger is then spent until it re-arms: brick-count triggers re-arm on the
 * next destroyed brick, `pulse` on the next breakable brick hit, `safetyNet` on the next serve.
 * No event fires more than `maxPerStage` times in one stage. Times are in seconds of play.
 */
export const STAGE_EVENTS = {
  kinds: {
    /** A brick spits out a capsule (never a negative one) once few bricks are left. */
    supplyDrop: { chance: 0.75, maxPerStage: 1, bricksLeft: 8 },
    /** Every ball splits in three when the stage is almost done. */
    overload: { chance: 1, maxPerStage: 1, bricksLeft: 4 },
    /**
     * No breakable brick hit for `idleTime`: a pulse rises from the paddle and the lowest `maxBricks`
     * breakable bricks take `damage` hits each (steel shrugs it off).
     */
    pulse: { chance: 1, maxPerStage: 2, idleTime: 10, maxBricks: 8, damage: 1 },
    /** Last few bricks survive `idleTime` without a kill: the paddle gets the laser. */
    hunter: { chance: 1, maxPerStage: 1, bricksLeft: 3, idleTime: 12, duration: 8 },
    /** Serving on the last life late in a stage raises the barrier. */
    safetyNet: { chance: 0.5, maxPerStage: 1, lives: 1, bricksLeft: 15, duration: 15 },
    /** Few bricks left: the paddle gets free detonator charges. */
    demolition: { chance: 0.5, maxPerStage: 1, bricksLeft: 6, charges: 2 },
  },
  /** How long the in-game banner stays up. */
  bannerTime: 1.8,
} as const;

/** In-game banner for each stage event. */
export const STAGE_EVENT_LOOK = {
  supplyDrop: { label: 'SUPPLY DROP', sub: 'CAPSULE INBOUND', color: PALETTE.yellow },
  overload: { label: 'OVERLOAD', sub: 'BALLS SPLIT', color: PALETTE.cyan },
  pulse: { label: 'PULSE', sub: 'GRID SHOCKED', color: PALETTE.purple },
  hunter: { label: 'HUNTER', sub: 'LASER ONLINE', color: PALETTE.magenta },
  safetyNet: { label: 'SAFETY NET', sub: 'BARRIER UP', color: PALETTE.yellow },
  demolition: { label: 'DEMOLITION', sub: 'CHARGES ARMED', color: 0xff8a2a },
} as const satisfies Record<keyof typeof STAGE_EVENTS.kinds, { label: string; sub: string; color: number }>;
