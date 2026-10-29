import { PALETTE } from './game';

/**
 * In-stage power-ups: how often they drop, how long they last and what they do.
 *
 * Drops: every destroyed brick rolls `dropChance`; on a hit, the kind is picked by weight. Weights
 * are relative, so a kind's share of drops is its weight divided by the sum of all weights (set a
 * weight to 0 to switch a kind off). No capsule drops while `maxCapsules` are already falling.
 *
 * Durations are in seconds; 0 means the power is instant. Picking a timed power again restarts
 * its timer; opposites (expand/narrow, slow/fast) cancel each other.
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
} as const satisfies Record<keyof typeof POWER.kinds, { label: string; glyph: string; color: number; bad: boolean }>;
