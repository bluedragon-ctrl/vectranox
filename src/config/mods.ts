import { PALETTE } from './game';

/*
 * Mods: the cards picked between stages. Everything about them lives here: name, rarity, how
 * far they stack, the effect of one stack and the card text. Edit freely; the simulation only
 * reads this (each mod's effect is applied in game/Game.ts where noted).
 */

export type Rarity = 'common' | 'rare' | 'epic';
export type RarityWeights = Readonly<Record<Rarity, number>>;

/**
 * Chance of each rarity per card slot, by sector (relative weights; the last row is used past
 * the end). Later sectors lean towards rare and epic cards.
 */
export const RARITY_WEIGHTS: readonly RarityWeights[] = [
  { common: 70, rare: 25, epic: 5 },
  { common: 55, rare: 33, epic: 12 },
  { common: 45, rare: 37, epic: 18 },
];

/** The pick after an elite room, in any sector. */
export const ELITE_WEIGHTS: RarityWeights = { common: 0, rare: 70, epic: 30 };

/** Card tag and colour for each rarity. */
export const RARITY_LOOK = {
  common: { label: 'COMMON', color: PALETTE.cyan },
  rare: { label: 'RARE', color: PALETTE.magenta },
  epic: { label: 'EPIC', color: PALETTE.yellow },
} as const satisfies Record<Rarity, { label: string; color: number }>;

export interface ModDef {
  /** Card title. */
  name: string;
  rarity: Rarity;
  /** How many times it can be picked; once maxed it is no longer offered. */
  maxStacks: number;
  /** Effect of one stack; stacks add up. The unit is given per mod. */
  perStack: number;
  /**
   * Card text for a total effect (`perStack` × stacks), so the text always matches the numbers.
   * `held` has the totals of the mods already held, for cards whose numbers they change.
   */
  describe: (total: number, held: Boosts) => string;
}

/** Totals of the mods that change other mods' numbers (as applied in game/Game.ts). */
export interface Boosts {
  /** Good timed powers last this fraction longer, so do the stage-start ones. */
  extender: number;
  /** Seconds added to every laser grant, before the extender. */
  longbeam: number;
  /** Extra balls per ball from every split. */
  extraball: number;
}

/** 0.15 → "15%". */
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** 8.399999 → "8.4". */
const secs = (v: number) => `${Math.round(v * 10) / 10}`;
/** Balls each ball becomes on a split. */
const splitInto = (held: Boosts) => 3 + held.extraball;

/** Every mod. The key is the mod's id (used by the dev console: `vnx.game.applyMod('wide')`). */
export const MODS = {
  // ── Common ──
  wide: {
    name: 'WIDE FRAME',
    rarity: 'common',
    maxStacks: 3,
    /** Paddle width, fraction of the base width added. */
    perStack: 0.1,
    describe: (v) => `PADDLE ${pct(v)} WIDER`,
  },
  lucky: {
    name: 'LUCKY DROPS',
    rarity: 'common',
    maxStacks: 3,
    /** Capsule drop chance per destroyed brick, added (base: `POWER.dropChance`). */
    perStack: 0.03,
    describe: (v) => `CAPSULE DROP CHANCE +${pct(v)}`,
  },
  magnet: {
    name: 'MAGNET',
    rarity: 'common',
    maxStacks: 2,
    /** Units per second falling capsules drift sideways towards the paddle. */
    perStack: 45,
    describe: (v) => `CAPSULES DRIFT TO THE PADDLE (${v} U/S)`,
  },
  extender: {
    name: 'EXTENDER',
    rarity: 'common',
    maxStacks: 3,
    /** Duration of good timed powers, fraction added. */
    perStack: 0.2,
    describe: (v) => `GOOD POWERS LAST ${pct(v)} LONGER`,
  },
  dampener: {
    name: 'DAMPENER',
    rarity: 'common',
    maxStacks: 2,
    /** Ball speed, fraction cut (base and top speed). */
    perStack: 0.05,
    describe: (v) => `BALL ${pct(v)} SLOWER`,
  },

  longbeam: {
    name: 'LONG BEAM',
    rarity: 'common',
    maxStacks: 3,
    /** Seconds added to every laser grant (capsule, laser start, hunter event), before the extender. */
    perStack: 3,
    describe: (v, held) => `LASER LASTS ${secs(v * (1 + held.extender))} S LONGER`,
  },
  multistart: {
    name: 'MULTI START',
    rarity: 'common',
    maxStacks: 1,
    /** On/off: the first launch of each stage splits the ball, as if a multi-ball capsule was caught. */
    perStack: 1,
    describe: (_, held) => `EACH STAGE'S FIRST LAUNCH SPLITS THE BALL INTO ${splitInto(held)}`,
  },
  extraball: {
    name: 'EXTRA BALL',
    rarity: 'common',
    maxStacks: 2,
    /**
     * More balls from every split (multi-ball capsule, multi start, splitter, overload event): each
     * ball splits into 3 plus this many.
     */
    perStack: 1,
    describe: (v, held) => `MULTI-BALL SPLITS EACH BALL INTO ${splitInto({ ...held, extraball: v })}`,
  },
  armory: {
    name: 'ARMORY',
    rarity: 'common',
    maxStacks: 3,
    /** Detonator charges at the start of each stage (capped at `POWER.detonator.maxCharges`). */
    perStack: 1,
    describe: (v) => `START EACH STAGE WITH ${v} DETONATOR CHARGE${v === 1 ? '' : 'S'}`,
  },
  failsafe: {
    name: 'FAILSAFE',
    rarity: 'common',
    maxStacks: 3,
    /** Seconds of barrier at the start of each stage. */
    perStack: 7,
    describe: (v, held) => `START EACH STAGE WITH ${secs(v * (1 + held.extender))} S OF BARRIER`,
  },

  // ── Rare ──
  crit: {
    name: 'CRITICAL',
    rarity: 'rare',
    maxStacks: 3,
    /** Chance a ball that breaks a brick carries on through it instead of bouncing. */
    perStack: 0.15,
    describe: (v) => `${pct(v)} CHANCE THE BALL GOES ON THROUGH A BROKEN BRICK`,
  },
  blast: {
    name: 'BLAST RADIUS',
    rarity: 'rare',
    maxStacks: 3,
    /** Detonator blast radius, fraction added (base: `POWER.detonator.radius`). */
    perStack: 0.3,
    describe: (v) => `DETONATOR BLAST RADIUS +${pct(v)}`,
  },
  chainlink: {
    name: 'CHAIN LINK',
    rarity: 'rare',
    maxStacks: 2,
    /** Chain bonus, fraction added. */
    perStack: 0.5,
    describe: (v) => `CHAIN BONUS +${pct(v)}`,
  },
  secondwind: {
    name: 'SECOND WIND',
    rarity: 'rare',
    maxStacks: 2,
    /**
     * Times per stage that losing the last ball serves a new one instead of costing a life
     * (powers and the multiplier are kept).
     */
    perStack: 1,
    describe: (v) => `${v === 1 ? 'ONCE' : `${v} TIMES`} A STAGE, A LOST BALL COSTS NO LIFE`,
  },
  laserpierce: {
    name: 'PIERCING LASER',
    rarity: 'rare',
    maxStacks: 2,
    /** Bricks a laser bolt can break and fly on through before it stops. */
    perStack: 1,
    describe: (v) => `LASER BOLTS GO THROUGH ${v} BROKEN BRICK${v === 1 ? '' : 'S'}`,
  },
  amplifier: {
    name: 'AMPLIFIER',
    rarity: 'rare',
    maxStacks: 3,
    /** Added to the score multiplier while a target bank has it above ×1 (×2 → ×3, ×3 → ×4, ...). */
    perStack: 1,
    describe: (v) => `LIT MULTIPLIER +${v} (×2 BECOMES ×${2 + v})`,
  },
  portalsplit: {
    name: 'WORMHOLE ECHO',
    rarity: 'rare',
    maxStacks: 3,
    /** Chance a ball going through a portal comes out as two (up to `POWER.maxBalls`). */
    perStack: 0.25,
    describe: (v) => `${pct(v)} CHANCE A BALL LEAVES A PORTAL AS TWO`,
  },
  steelbreak: {
    name: 'STEEL BREAKER',
    rarity: 'rare',
    maxStacks: 2,
    /** Chance each steel brick in reach of a detonation breaks (rolled once per press). */
    perStack: 0.25,
    describe: (v) => `${pct(v)} CHANCE A DETONATION BREAKS EACH STEEL BRICK IN REACH`,
  },

  // ── Epic ──
  heavy: {
    name: 'HEAVY BALL',
    rarity: 'epic',
    maxStacks: 1,
    /** Extra hits each ball hit deals. */
    perStack: 1,
    describe: (v) => `BALL HITS DEAL ${1 + v}× DAMAGE`,
  },
  anchor: {
    name: 'ANCHOR',
    rarity: 'epic',
    maxStacks: 1,
    /** On/off: losing a life drops the multiplier one step instead of resetting it. */
    perStack: 1,
    describe: () => 'A LOST LIFE ONLY DROPS THE MULTIPLIER ONE STEP',
  },
  splitter: {
    name: 'SPLITTER',
    rarity: 'epic',
    maxStacks: 1,
    /** On/off: every serve launch splits the ball in three. */
    perStack: 1,
    describe: (_, held) => `EVERY SERVE SPLITS THE BALL INTO ${splitInto(held)}`,
  },
  laserstart: {
    name: 'LASER START',
    rarity: 'epic',
    maxStacks: 1,
    /** Seconds of laser at the start of each stage (the capsule gives `POWER.kinds.laser.duration`). */
    perStack: 10,
    describe: (v, held) => `START EACH STAGE WITH ${secs((v + held.longbeam) * (1 + held.extender))} S OF LASER`,
  },
  cluster: {
    name: 'CLUSTER CHARGE',
    rarity: 'epic',
    maxStacks: 1,
    /** Balls added by every detonation (up to `POWER.maxBalls`). */
    perStack: 1,
    describe: (v) => `EVERY DETONATION ADDS ${v} BALL${v === 1 ? '' : 'S'}`,
  },
  splitguard: {
    name: 'SPLIT GUARD',
    rarity: 'epic',
    maxStacks: 2,
    /**
     * Seconds of barrier from every split (multi-ball capsule, multi start, splitter, overload
     * event). A longer barrier already up is left alone.
     */
    perStack: 5,
    describe: (v, held) => `EVERY MULTI-BALL SPLIT RAISES ${secs(v * (1 + held.extender))} S OF BARRIER`,
  },
} as const satisfies Record<string, ModDef>;

/**
 * The pick between stages: `offers` mod cards, plus a card for `lives` extra lives instead (up
 * to `POWER.maxLives`).
 */
export const DRAFT = {
  offers: 3,
  lives: 2,
} as const;
