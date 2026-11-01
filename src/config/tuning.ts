import { PALETTE } from './game';

/*
 * Gameplay tuning: power-ups, stage events, special bricks and formations. Everything here is
 * meant to be tweaked by hand; the simulation reads it but never changes it.
 */

/**
 * In-stage power-ups: how often they drop, how long they last and what they do.
 *
 * Drops: every destroyed brick rolls `dropChance`; on a hit, the kind is picked by weight. Weights
 * are relative, so a kind's share of drops is its weight divided by the sum of all weights (set a
 * weight to 0 to switch a kind off). No capsule drops while `maxCapsules` are already falling.
 * `rare` kinds have their own roll: `rareChance` of drops come from them, by their weights among
 * themselves, and stage events never hand them out.
 *
 * Durations are in seconds; 0 means the power is instant. Picking a timed power again restarts
 * its timer, unless more time than that is left; `opposite` powers cancel each other. Capsules,
 * mods and stage events all grant powers the same way (`Game.applyPower`).
 */
export const POWER = {
  /** Chance (0..1) that a destroyed brick drops a capsule. */
  dropChance: 0.14,
  /** Chance (0..1) that a dropped capsule is a rare one. */
  rareChance: 0.05,
  maxCapsules: 3,
  kinds: {
    multi: { duration: 0, weight: 14 },
    laser: { duration: 5, weight: 10 },
    expand: { duration: 15, weight: 12, opposite: 'narrow' },
    narrow: { duration: 10, weight: 8, opposite: 'expand' },
    slow: { duration: 12, weight: 10, opposite: 'fast' },
    fast: { duration: 10, weight: 8, opposite: 'slow' },
    catch: { duration: 15, weight: 9 },
    pierce: { duration: 6, weight: 6 },
    barrier: { duration: 8, weight: 7 },
    life: { duration: 0, weight: 3 },
    /** `charges`: bricks each ball explodes on. */
    detonator: { duration: 0, weight: 6, charges: 1 },
    /** `bricks`: random normal bricks that turn explosive, whatever hits they had left. */
    zap: { duration: 0, weight: 1, rare: true, bricks: 6 },
    /** Shows focus's aim lines without its slowdown. */
    oracle: { duration: 12, weight: 1, rare: true },
  },

  capsuleWidth: 22,
  capsuleHeight: 10,
  fallSpeed: 70,
  maxBalls: 12,
  maxLives: 9,
  /** Balls each ball becomes on a split, before the extra ball mod. */
  splitInto: 2,
  /** Angle between split balls. */
  splitAngle: (22 * Math.PI) / 180,
  expandScale: 1.5,
  narrowScale: 0.65,
  /** Paddle width approaches its target at this rate (1/s). */
  widthRate: 10,
  slowScale: 0.7,
  fastScale: 1.3,
  /** Ball speed while piercing. Takes the place of `fastScale` if higher, doesn't add to it; slow still applies. */
  pierceScale: 1.3,
  /** A caught ball releases itself after this long. */
  catchHold: 3,
  laserCooldown: 0.6,
  /** Share of its points whatever a laser bolt breaks or hits pays, before the bounty mod. */
  laserScore: 0.25,
  boltSpeed: 560,
  boltLength: 8,
  /** Bolts leave the paddle this far in from either end. */
  boltInset: 5,
  barrierY: 7,
  /**
   * A capsule charges every ball in play: each goes off as an explosion of this `radius` and
   * `damage` when it next hits a brick, on top of the hit itself, and flies on. Balls split off a
   * charged ball are charged too. An explosion works the same whatever set it off (see `BRICK_TYPES`).
   */
  detonator: {
    radius: 32,
    damage: 1,
  },
} as const;

/**
 * Focus: an alt press slows the world to `scale`, until the button is let go or `duration`
 * seconds pass. Then it can't be used for `cooldown` seconds. Both times are real
 * seconds, not slowed ones. The paddle gets its own `paddleScale`, applied to keys and mouse alike,
 * so the same hand movement places it more finely.
 *
 * While it runs, a line shows where each falling ball will reach the paddle, through up to
 * `aimBounces` bounces. A ball that won't get there (it turns back up or enters a portal first)
 * has no line. If the paddle as it stands would bounce or catch the ball, a second line runs from
 * there to the first thing the ball hits, for a catch once it is released; a ball already caught
 * has just this line. The bricks are taken as they stand, so moving ones can still prove either
 * line wrong.
 */
export const FOCUS = {
  scale: 0.25,
  paddleScale: 0.3,
  duration: 3,
  cooldown: 5,
  aimBounces: 8,
} as const;

/** Power colours by family: negative powers are always red, the rest go by what they act on. */
const POWER_FAMILY = {
  ball: PALETTE.cyan,
  paddle: PALETTE.magenta,
  life: PALETTE.yellow,
  bad: PALETTE.red,
  /** The detonator acts on the ball, but gets the colour the ball turns. */
  charge: PALETTE.orange,
  rare: PALETTE.white,
} as const;

/** How each power shows up: capsule letter, colour, and whether it is a negative one. */
export const POWER_LOOK = {
  multi: { label: 'MULTI', glyph: 'M', color: POWER_FAMILY.ball, bad: false },
  laser: { label: 'LASER', glyph: 'L', color: POWER_FAMILY.paddle, bad: false },
  expand: { label: 'EXPAND', glyph: 'E', color: POWER_FAMILY.paddle, bad: false },
  narrow: { label: 'NARROW', glyph: 'N', color: POWER_FAMILY.bad, bad: true },
  slow: { label: 'SLOW', glyph: 'S', color: POWER_FAMILY.ball, bad: false },
  fast: { label: 'FAST', glyph: 'F', color: POWER_FAMILY.bad, bad: true },
  catch: { label: 'CATCH', glyph: 'C', color: POWER_FAMILY.paddle, bad: false },
  pierce: { label: 'PIERCE', glyph: 'P', color: POWER_FAMILY.ball, bad: false },
  barrier: { label: 'BARRIER', glyph: 'B', color: POWER_FAMILY.ball, bad: false },
  life: { label: 'LIFE', glyph: '+', color: POWER_FAMILY.life, bad: false },
  detonator: { label: 'DETONATOR', glyph: 'X', color: POWER_FAMILY.charge, bad: false },
  zap: { label: 'ZAP', glyph: 'Z', color: POWER_FAMILY.rare, bad: false },
  oracle: { label: 'ORACLE', glyph: 'O', color: POWER_FAMILY.rare, bad: false },
} as const satisfies Record<keyof typeof POWER.kinds, { label: string; glyph: string; color: number; bad: boolean }>;

/** Banner when a rare capsule is caught. */
export const RARE_POWER_BANNER: Partial<Record<keyof typeof POWER.kinds, { label: string; sub: string; color: number }>> = {
  zap: { label: POWER_LOOK.zap.label, sub: 'BRICKS PRIMED', color: POWER_LOOK.zap.color },
  oracle: { label: POWER_LOOK.oracle.label, sub: 'PATHS REVEALED', color: POWER_LOOK.oracle.color },
};

/**
 * Stage events: rule-based help that keeps the end of a stage from dragging.
 *
 * When an event's trigger is met it rolls `chance` (0..1, set it to 0 to switch the event off).
 * A miss spends the trigger until it re-arms: brick-count triggers re-arm on the next destroyed
 * brick, `pulse` on the next breakable brick hit, `safetyNet` on the next serve.
 * No event fires more than `maxPerStage` times in one stage. Times are in seconds of play.
 *
 * Brick-count events wait for a stall, so a player still breaking bricks finishes the stage alone:
 * `stall` is the seconds without a kill before each firing, the last entry holding from there on.
 * A repeat counts from the kill or from the event's last firing, whichever came later. Only the
 * safety net fires sooner than `gap` after another event. A new serve hands back one firing of
 * those in `perBalls`, since what they gave went with the balls. Boss rooms have no stalls, gap or
 * hand-backs: every event fires once, straight on its trigger, and the hunter after `bossHunterIdle`.
 *
 * `power` is the power an event grants, as a capsule would, for `duration` seconds if given.
 */
export const STAGE_EVENTS = {
  kinds: {
    /** A brick spits out a capsule (never a negative one) once few bricks are left. */
    supplyDrop: { chance: 1, maxPerStage: 2, bricksLeft: 8, stall: [0, 15] },
    /** Every ball splits (see `POWER.splitInto`) when the stage is almost done. */
    overload: { chance: 1, maxPerStage: 1, bricksLeft: 4, stall: [5], power: 'multi' },
    /**
     * No breakable brick hit for `idleTime`: a pulse rises from the paddle and the lowest `maxBricks`
     * breakable bricks take `damage` hits each (steel shrugs it off). It spares the last brick, so
     * it never ends a stage by itself, until `finishAfter` passes without a kill. Then, with at
     * most `maxBricks` left, it fires past `maxPerStage` and hits them all, so no stage can stall
     * for good on bricks the ball can't reach.
     */
    pulse: { chance: 1, maxPerStage: 2, idleTime: 10, maxBricks: 5, damage: 1, finishAfter: 25 },
    /** Last few bricks survive without a kill: the paddle gets the laser. */
    hunter: { chance: 1, maxPerStage: 3, bricksLeft: 3, stall: [7, 14], power: 'laser', duration: 5 },
    /** Serving on the last life late in a stage raises the barrier. */
    safetyNet: { chance: 0.5, maxPerStage: 1, lives: 1, bricksLeft: 15, power: 'barrier', duration: 15 },
    /** Few bricks left: every ball is charged, as by a detonator capsule. */
    demolition: { chance: 1, maxPerStage: 1, bricksLeft: 6, stall: [3], power: 'detonator' },
  },
  gap: 3,
  perBalls: ['overload', 'demolition'],
  bossHunterIdle: 12,
  /** How long the in-game banner stays up. */
  bannerTime: 1.8,
} as const;

/** In-game banner for each stage event. */
export const STAGE_EVENT_LOOK = {
  supplyDrop: { label: 'SUPPLY DROP', sub: 'CAPSULE INBOUND', color: PALETTE.yellow },
  overload: { label: 'OVERLOAD', sub: 'BALLS SPLIT', color: PALETTE.cyan },
  pulse: { label: 'PULSE', sub: 'GRID SHOCKED', color: PALETTE.purple },
  hunter: { label: 'HUNTER', sub: 'LASER ONLINE', color: PALETTE.magenta },
  safetyNet: { label: 'SAFETY NET', sub: 'BARRIER UP', color: POWER_LOOK.barrier.color },
  demolition: { label: 'DEMOLITION', sub: 'BALLS CHARGED', color: POWER_LOOK.detonator.color },
} as const satisfies Record<keyof typeof STAGE_EVENTS.kinds, { label: string; sub: string; color: number }>;

/**
 * Pinball pieces a stage layout can place (see `StageDef`). Both are circles centred in their cell.
 *
 * Targets: the ball bounces off them and lights them. Lighting every target in the stage completes
 * the bank: it pays `bankBonus`, unlights them all, and moves the score multiplier one step along
 * `multipliers`. So does clearing a room without losing a life or using a second wind. The
 * multiplier scales all brick points; either of those resets it, or drops it `ANCHOR_DROP` steps
 * with the anchor mod (mods.ts), which is why every step is worth 1.
 *
 * Portals come in pairs: a ball whose centre gets within `capture` of one comes out of the other
 * with the same velocity, and ignores that exit until it has left its radius.
 */
export const PINBALL = {
  target: { radius: 5, points: 25 },
  bankBonus: 500,
  multipliers: [1, 2, 3, 4, 5],
  portal: { radius: 10, capture: 5 },
} as const;

/**
 * Special bricks.
 *
 * Explosive: `fuse` seconds after it breaks, it goes off as an explosion of this `radius` and
 * `damage` at its centre. Every breakable brick in reach (measured to the nearest point of the
 * brick) takes the damage once; explosives caught in it set each other off, one fuse later. Steel
 * is unaffected, bar the steel breaker mod. Charged balls work the same way, and the blast
 * radius, steel breaker and cluster charge mods apply to both.
 *
 * Regenerating: takes `hp` hits and wins one back after `delay` seconds without a hit, again
 * every `delay` until it is whole.
 */
export const BRICK_TYPES = {
  explosive: { radius: 22, damage: 1, fuse: 0.08 },
  regen: { hp: 2, delay: 4 },
} as const;

/**
 * Boss rooms: what every boss shares. What each boss does when is in its room file (see `BossDef`).
 *
 * Emitters flash for `windup` seconds before they act. A phase break lasts `phaseBreak` seconds: the
 * core takes no damage and nothing fires. Damage can't run past a phase's threshold, so one good
 * shot into a vault can't end the fight. Lasers do `laserDamage` per bolt to the core; everything
 * else does a whole hit. Portals in a boss room catch a ball from `portalCapture`, as they are
 * the only way into a vault.
 *
 * `shot`: speed, hit radius, and the angle between a fan's shots. `stun`: seconds the paddle can't
 * move after a shot reaches it. `faller`: speed of a spawner's bricks and how many can be falling
 * at once. `shadow`: seconds a shadow ball lasts, how many at once, and how far from straight down
 * it can leave.
 */
export const BOSS = {
  windup: 0.5,
  phaseBreak: 1.5,
  laserDamage: 0.3,
  portalCapture: 9,
  shot: { speed: 150, radius: 3, fan: (20 * Math.PI) / 180 },
  stun: 0.7,
  faller: { speed: 14, max: 3 },
  shadow: { life: 6, max: 4, spread: (35 * Math.PI) / 180 },
} as const;

/**
 * Formations: groups of bricks that move while the ball is in play (see `StageTemplate.formations`).
 *
 * A marching formation's breakable bricks reaching `line` cost a life and send it back to its
 * starting height at `retreatSpeed`. The line lights up over the last `warning` units.
 *
 * A brick moving onto a ball shoves it out, with at least `shove` units/s away from the brick.
 *
 * Motions, each scaled by the stage's depth:
 * - sweep: side to side at `speed`, turning `margin` short of the walls.
 * - march: a hop of `step` every `beat` seconds at `hopSpeed`. At the walls the hop is a `drop`
 *   downwards instead, and the direction flips. Both the sweep and the march turn at the bricks
 *   still alive, so clearing the outer columns widens their path. The beat runs up to `fury`
 *   times faster as the formation's bricks are destroyed.
 * - rotate: orbits the middle of the formation at `rate` radians/s. Bricks stay level, so spacing
 *   them at least 24 units apart (every second row) keeps them from overlapping.
 * - sine: columns bob `height` up and down over `period` seconds, each `wave` radians behind the last.
 * - hold: stays put. Formations claim bricks by rectangle, so this keeps the middle of a rotating
 *   ring out of it.
 */
export const FORMATION = {
  line: 72,
  warning: 60,
  retreatSpeed: 300,
  shove: 120,
  margin: 10,
  motions: {
    sweep: { speed: 38 },
    march: { step: 8, beat: 0.42, drop: 12, hopSpeed: 140, fury: 2.2 },
    rotate: { rate: 0.5 },
    sine: { height: 14, period: 3.4, wave: 0.6 },
    hold: {},
  },
} as const;
