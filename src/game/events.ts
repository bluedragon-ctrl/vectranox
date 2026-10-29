import type { BrickKind, HitSource, PowerKind, StageEventKind, TimedPower } from './types';

export type WallSide = 'left' | 'right' | 'top';

/** Every event the simulation can emit. Payloads must be plain data. */
export type GameEvents = {
  runStart: { seed: number };
  stageStart: { stage: number; name: string; bricks: number };
  ballSpawn: { id: number; x: number; y: number };
  ballLaunch: { id: number; angle: number };
  wallHit: { id: number; side: WallSide; x: number; y: number };
  paddleHit: { id: number; offset: number };
  /** x, y: brick centre; ix, iy: impact point on the brick. */
  brickHit: { id: number; kind: BrickKind; hp: number; by: HitSource; x: number; y: number; ix: number; iy: number };
  brickDestroyed: { id: number; kind: BrickKind; points: number; by: HitSource; x: number; y: number; ix: number; iy: number };
  ballCaught: { id: number; offset: number };
  barrierHit: { id: number; x: number };
  powerDrop: { id: number; kind: PowerKind; x: number; y: number };
  powerCollect: { id: number; kind: PowerKind };
  powerMissed: { id: number; kind: PowerKind };
  powerEnd: { kind: TimedPower };
  laserFire: { x: number; y: number };
  /** A stage event fired; `bricks` is how many breakable bricks were left. */
  stageEvent: { kind: StageEventKind; bricks: number };
  ballLost: { id: number };
  lifeLost: { lives: number };
  stageClear: { stage: number; score: number };
  gameOver: { stage: number; score: number };
  runComplete: { score: number };
};
