import type { PowerKind, TimedPower } from '../game/types';
import { PALETTE } from './game';
import { POWER } from './tuning';

/*
 * Mods: the cards bought between stages. Everything about them lives here: name, rarity, how
 * far they stack, the effect of one stack and the card text. Edit freely; the simulation only
 * reads this. Mods that grant or lengthen powers say so here (`grant`, `addSeconds`,
 * `stretchGood`), the rest are applied in game/Game.ts where noted.
 */

export type Rarity = 'common' | 'rare' | 'epic';

/** Credits a mod costs, by rarity. What rooms pay is `ROOM_CREDITS` in run.ts. */
export const PRICES: Readonly<Record<Rarity, number>> = { common: 1, rare: 2, epic: 5 };

/**
 * Chance the pick's last card is epic instead of rare: `depth` for each `RUN.bandRooms` rooms of
 * the run (the last entry is used past the end), `elite` and `boss` after those rooms at any depth.
 */
export const EPIC_CHANCE = {
  depth: [0.1, 0.25, 0.4],
  elite: 0.5,
  boss: 1,
} as const;

/** Multiplier steps a lost multiplier drops with 1, 2, 3... stacks of the anchor mod, instead of all of them. */
export const ANCHOR_DROP = [3, 2, 1] as const;

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
  /** Grants `power` on `on`, as a capsule would; the amount is the mod's total effect (seconds, or charges). */
  grant?: { on: GrantTrigger; power: PowerKind };
  /** The total effect is seconds added to every grant of this power, before `stretchGood`. */
  addSeconds?: TimedPower;
  /** The total effect is a fraction added to the time of every good timed power. */
  stretchGood?: true;
  /**
   * Card text for a total effect (`perStack` × stacks), so the text always matches the numbers.
   * `held` gives the numbers the mods held change, with this card's stacks counted.
   */
  describe: (total: number, held: HeldEffects) => string;
}

/** When a mod's `grant` happens: a stage opens, a ball is served, the stage's first ball is, balls split. */
export type GrantTrigger = 'stageStart' | 'launch' | 'firstLaunch' | 'split';

/** Numbers on cards that depend on other mods, worked out as the game does (see game/mods.ts). */
export interface HeldEffects {
  /** What a grant of `base` seconds of `kind` lasts. */
  powerSeconds: (kind: TimedPower, base: number) => number;
  /** Balls each ball becomes on a split. */
  splitInto: number;
}

/** 0.15 → "15%". */
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** 8.399999 → "8.4". */
const secs = (v: number) => `${Math.round(v * 10) / 10}`;

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
    perStack: 0.05,
    describe: (v) => `CAPSULE DROP CHANCE +${pct(v)}`,
  },
  extender: {
    name: 'EXTENDER',
    rarity: 'common',
    maxStacks: 3,
    /** Duration of good timed powers, fraction added. */
    perStack: 0.2,
    stretchGood: true,
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
    addSeconds: 'laser',
    describe: (_, held) => `LASER LASTS ${secs(held.powerSeconds('laser', 0))} S LONGER`,
  },
  bounty: {
    name: 'BOUNTY',
    rarity: 'common',
    maxStacks: 3,
    /** Share of full points laser bolts pay, added (base: `POWER.laserScore`). */
    perStack: 0.25,
    describe: (v) => `LASER PAYS ${pct(POWER.laserScore + v)} OF FULL SCORE`,
  },
  multistart: {
    name: 'MULTI START',
    rarity: 'common',
    maxStacks: 1,
    /** On/off: the first launch of each stage splits the ball, as if a multi-ball capsule was caught. */
    perStack: 1,
    grant: { on: 'firstLaunch', power: 'multi' },
    describe: (_, held) => `EACH STAGE'S FIRST LAUNCH SPLITS THE BALL INTO ${held.splitInto}`,
  },
  extraball: {
    name: 'EXTRA BALL',
    rarity: 'common',
    maxStacks: 2,
    /**
     * More balls from every split (multi-ball capsule, multi start, splitter, overload event): each
     * ball splits into `POWER.splitInto` plus this many.
     */
    perStack: 1,
    describe: (_, held) => `MULTI-BALL SPLITS EACH BALL INTO ${held.splitInto}`,
  },
  armory: {
    name: 'ARMORY',
    rarity: 'common',
    maxStacks: 3,
    /** Bricks each stage's first ball explodes on (see `POWER.detonator`). */
    perStack: 1,
    grant: { on: 'stageStart', power: 'detonator' },
    describe: (v) => `EACH STAGE'S FIRST BALL EXPLODES ON ITS NEXT ${v === 1 ? 'BRICK' : `${v} BRICKS`}`,
  },
  failsafe: {
    name: 'FAILSAFE',
    rarity: 'common',
    maxStacks: 3,
    /** Seconds of barrier at the start of each stage. */
    perStack: 5,
    grant: { on: 'stageStart', power: 'barrier' },
    describe: (v, held) => `START EACH STAGE WITH ${secs(held.powerSeconds('barrier', v))} S OF BARRIER`,
  },
  dilation: {
    name: 'TIME DILATION',
    rarity: 'common',
    maxStacks: 3,
    /** Real seconds added to focus (base: `FOCUS.duration`). */
    perStack: 1,
    describe: (v) => `SLOWDOWN LASTS ${v} S LONGER`,
  },
  recovery: {
    name: 'QUICK RECOVERY',
    rarity: 'common',
    maxStacks: 2,
    /** Real seconds cut from focus's cooldown (base: `FOCUS.cooldown`). */
    perStack: 1,
    describe: (v) => `SLOWDOWN COOLDOWN ${v} S SHORTER`,
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
    /** Radius of every explosion, fraction added (base: `POWER.detonator.radius`, `BRICK_TYPES.explosive.radius`). */
    perStack: 0.3,
    describe: (v) => `EXPLOSION RADIUS +${pct(v)}`,
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
     * Times per stage that losing the last ball serves a new one instead of costing a life.
     * Powers are kept; the multiplier goes as for a lost life, and the room is no longer flawless.
     */
    perStack: 1,
    describe: (v) => `${v === 1 ? 'ONCE' : `${v} TIMES`} A STAGE, A LOST BALL COSTS NO LIFE, ONLY THE MULTIPLIER`,
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
    /** Added to the score multiplier while it is above ×1 (×2 → ×3, ×3 → ×4, ...). */
    perStack: 1,
    describe: (v) => `LIT MULTIPLIER +${v} (×2 BECOMES ×${2 + v})`,
  },
  anchor: {
    name: 'ANCHOR',
    rarity: 'rare',
    maxStacks: ANCHOR_DROP.length,
    /** Index into `ANCHOR_DROP`, plus 1. */
    perStack: 1,
    describe: (v) => {
      const steps = ANCHOR_DROP[v - 1];
      return `LOSING THE MULTIPLIER ONLY DROPS IT ${steps} STEP${steps === 1 ? '' : 'S'}`;
    },
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
    /** Chance each steel brick in reach of an explosion breaks (rolled once per explosion). */
    perStack: 0.25,
    describe: (v) => `${pct(v)} CHANCE AN EXPLOSION BREAKS EACH STEEL BRICK IN REACH`,
  },
  rollback: {
    name: 'ROLLBACK',
    rarity: 'rare',
    maxStacks: 3,
    /**
     * Rooms added as it is taken, not an effect that lasts: the next room comes under the number of
     * the one just cleared, the rooms after it keep theirs, so the sun rises by a room (see `extraRoom`).
     */
    perStack: 1,
    describe: () => 'ROOM NUMBER GOES BACK 1: THE SUN RISES, ONE MORE ROOM TO PLAY',
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
  splitter: {
    name: 'SPLITTER',
    rarity: 'epic',
    maxStacks: 1,
    /** On/off: every serve launch splits the ball, as if a multi-ball capsule was caught. */
    perStack: 1,
    grant: { on: 'launch', power: 'multi' },
    describe: (_, held) => `EVERY SERVE SPLITS THE BALL INTO ${held.splitInto}`,
  },
  laserstart: {
    name: 'LASER START',
    rarity: 'epic',
    maxStacks: 1,
    /** Seconds of laser at the start of each stage (the capsule gives `POWER.kinds.laser.duration`). */
    perStack: 5,
    grant: { on: 'stageStart', power: 'laser' },
    describe: (v, held) => `START EACH STAGE WITH ${secs(held.powerSeconds('laser', v))} S OF LASER`,
  },
  cluster: {
    name: 'CLUSTER CHARGE',
    rarity: 'epic',
    maxStacks: 1,
    /** Balls added by every explosion (up to `POWER.maxBalls`). */
    perStack: 1,
    describe: (v) => `EVERY EXPLOSION ADDS ${v} BALL${v === 1 ? '' : 'S'}`,
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
    grant: { on: 'split', power: 'barrier' },
    describe: (v, held) => `EVERY MULTI-BALL SPLIT RAISES ${secs(held.powerSeconds('barrier', v))} S OF BARRIER`,
  },
  salvage: {
    name: 'SALVAGE',
    rarity: 'epic',
    maxStacks: 1,
    /** Credits added to what every cleared room pays. */
    perStack: 1,
    describe: (v) => `EVERY CLEARED ROOM PAYS ${v} MORE CREDIT${v === 1 ? '' : 'S'}`,
  },
} as const satisfies Record<string, ModDef>;

/**
 * The pick between stages: a mod card of each rarity in `slots` (the last may turn epic, see
 * `EPIC_CHANCE`), plus a card for `lives` extra lives at `livesCost` credits that can be bought
 * again (up to `POWER.maxLives`). Any number of cards can be bought; credits not spent carry over.
 */
export const DRAFT = {
  slots: ['common', 'common', 'rare', 'rare'],
  lives: 1,
  livesCost: 1,
} as const satisfies { slots: readonly Rarity[]; lives: number; livesCost: number };
