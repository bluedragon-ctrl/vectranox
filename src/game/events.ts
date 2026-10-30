import type { RoomKind } from '../config/run';
import type { BrickKind, HitSource, ModKind, PowerKind, StageEventKind, TimedPower } from './types';

export type WallSide = 'left' | 'right' | 'top';

/** Every event the simulation can emit. Payloads must be plain data. */
export type GameEvents = {
  runStart: { seed: number };
  /** `stage` counts through the run (1-based); `sector` and `number` place it in its sector. */
  stageStart: { stage: number; sector: number; number: number; name: string; room: RoomKind; bricks: number };
  ballSpawn: { id: number; x: number; y: number };
  ballLaunch: { id: number; angle: number };
  wallHit: { id: number; side: WallSide; x: number; y: number };
  paddleHit: { id: number; offset: number };
  /** x, y: brick centre; ix, iy: impact point on the brick. */
  brickHit: { id: number; kind: BrickKind; hp: number; by: HitSource; x: number; y: number; ix: number; iy: number };
  /**
   * As `brickHit`; vx, vy: velocity of the ball that broke it, before it bounced (0 for other sources).
   * `chain` is that ball's chain count with this brick (0 for other sources). `points` include `bonus`;
   * both include the score `multiplier` that was in effect.
   */
  brickDestroyed: {
    id: number;
    kind: BrickKind;
    points: number;
    chain: number;
    bonus: number;
    multiplier: number;
    by: HitSource;
    x: number;
    y: number;
    ix: number;
    iy: number;
    vx: number;
    vy: number;
  };
  /** A regenerating brick won back a hit; `hp` is what it has now. */
  brickHeal: { id: number; hp: number };
  /** An explosive brick's fuse ran out at (x, y); `bricks` breakable bricks were in reach. */
  explosion: { x: number; y: number; radius: number; bricks: number };
  /** A marching formation hopped (`dropped`: towards the line). */
  formationStep: { dropped: boolean };
  /** A marching formation reached the line and costs a life; it goes back to its starting height. */
  formationBreach: { lives: number };
  ballCaught: { id: number; offset: number };
  /**
   * The paddle ended a ball's chain of `count` bricks, which earned `total` bonus points (multiplier
   * included); `multiplier` is the score multiplier now.
   */
  chainEnd: { id: number; count: number; total: number; multiplier: number };
  barrierHit: { id: number; x: number };
  /** Ball bounced off a target; `lit` is whether this hit lit it (false if it already was). */
  targetHit: { id: number; ball: number; lit: boolean; points: number; x: number; y: number };
  /** Every target lit: the bank paid `bonus` and the score multiplier is now `multiplier`. */
  targetBank: { multiplier: number; bonus: number };
  /** Ball `id` went into portal `from` and came out of portal `to` at (x, y). */
  portalWarp: { id: number; from: number; to: number; x: number; y: number };
  powerDrop: { id: number; kind: PowerKind; x: number; y: number };
  powerCollect: { id: number; kind: PowerKind };
  powerMissed: { id: number; kind: PowerKind };
  powerEnd: { kind: TimedPower };
  laserFire: { x: number; y: number };
  /** Ball `id` broke brick `brick` and carried on through it (critical mod). */
  breakthrough: { id: number; brick: number };
  /** `balls` balls exploded (see `Game.blastBalls`); `bricks` breakable bricks were in reach, `charges` are left. */
  detonate: { balls: number; radius: number; bricks: number; charges: number };
  /** A stage event fired; `bricks` is how many breakable bricks were left. */
  stageEvent: { kind: StageEventKind; bricks: number };
  ballLost: { id: number };
  /** The last ball was lost but the second wind mod served a new one; `left` uses remain this stage. */
  secondWind: { left: number };
  lifeLost: { lives: number };
  /** `bonus` is what an elite room paid on top; `score` includes it. */
  stageClear: { stage: number; score: number; bonus: number };
  /** The pick between stages opened with these mod offers. */
  draftOpen: { stage: number; offers: ModKind[] };
  modPick: { kind: ModKind; stacks: number };
  /** The pick went to extra lives: `gained` of them, `lives` now. */
  livesPick: { gained: number; lives: number };
  gameOver: { stage: number; score: number };
  runComplete: { score: number };
};
