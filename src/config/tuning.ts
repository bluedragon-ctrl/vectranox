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
   * Alt press spends one charge: every ball explodes (`target: 'highest'` blows only the ball
   * nearest the bricks) and each breakable brick within `radius` of any of them (measured to the
   * nearest point of the brick) takes `damage` hits, once per press however many balls reach it.
   * Steel is unaffected and the balls fly on. A capsule gives `charges` when none are held, else
   * `recharge` more, up to `maxCharges`.
   */
  detonator: {
    charges: 3,
    recharge: 1,
    maxCharges: 5,
    radius: 32,
    damage: 1,
    target: 'all' as 'all' | 'highest',
  },
} as const;

/** How each power shows up: capsule letter, colour, and whether it is a negative one. */
export const POWER_LOOK = {
  multi: { label: 'MULTI', glyph: 'M', color: PALETTE.cyan, bad: false },
  laser: { label: 'LASER', glyph: 'L', color: PALETTE.magenta, bad: false },
  expand: { label: 'EXPAND', glyph: 'E', color: PALETTE.blue, bad: false },
  narrow: { label: 'NARROW', glyph: 'N', color: PALETTE.red, bad: true },
  slow: { label: 'SLOW', glyph: 'S', color: 0x2dffb4, bad: false },
  fast: { label: 'FAST', glyph: 'F', color: PALETTE.red, bad: true },
  catch: { label: 'CATCH', glyph: 'C', color: PALETTE.purple, bad: false },
  pierce: { label: 'PIERCE', glyph: 'P', color: PALETTE.white, bad: false },
  barrier: { label: 'BARRIER', glyph: 'B', color: PALETTE.yellow, bad: false },
  life: { label: 'LIFE', glyph: '+', color: 0xff7ad9, bad: false },
  detonator: { label: 'DETONATOR', glyph: 'X', color: PALETTE.orange, bad: false },
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
  demolition: { label: 'DEMOLITION', sub: 'CHARGES ARMED', color: PALETTE.orange },
} as const satisfies Record<keyof typeof STAGE_EVENTS.kinds, { label: string; sub: string; color: number }>;

/**
 * Pinball pieces a stage layout can place (see `StageDef`). Both are circles centred in their cell.
 *
 * Targets: the ball bounces off them and lights them. Lighting every target in the stage completes
 * the bank: it pays `bankBonus`, unlights them all, and moves the score multiplier one step along
 * `multipliers`. The multiplier scales all brick points and lasts until a life is lost.
 *
 * Portals come in pairs: a ball whose centre gets within `capture` of one comes out of the other
 * with the same velocity, and ignores that exit until it has left its radius.
 */
export const PINBALL = {
  target: { radius: 5, points: 25 },
  bankBonus: 500,
  multipliers: [1, 2, 3, 5],
  portal: { radius: 10, capture: 5 },
} as const;
