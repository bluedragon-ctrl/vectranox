export type WallSide = 'left' | 'right' | 'top' | 'bottom';

/** Every event the simulation can emit. Payloads must be plain data. */
export type GameEvents = {
  runStart: { seed: number };
  ballSpawn: { id: number; x: number; y: number };
  wallHit: { id: number; side: WallSide; x: number; y: number };
};
