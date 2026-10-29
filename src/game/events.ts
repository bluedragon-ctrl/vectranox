import type { BrickKind } from './types';

export type WallSide = 'left' | 'right' | 'top';

/** Every event the simulation can emit. Payloads must be plain data. */
export type GameEvents = {
  runStart: { seed: number };
  stageStart: { stage: number; name: string; bricks: number };
  ballSpawn: { id: number; x: number; y: number };
  ballLaunch: { id: number; angle: number };
  wallHit: { id: number; side: WallSide; x: number; y: number };
  paddleHit: { id: number; offset: number };
  brickHit: { id: number; kind: BrickKind; hp: number; x: number; y: number };
  brickDestroyed: { id: number; kind: BrickKind; points: number; x: number; y: number };
  ballLost: { id: number };
  lifeLost: { lives: number };
  stageClear: { stage: number; score: number };
  gameOver: { stage: number; score: number };
  runComplete: { score: number };
};
