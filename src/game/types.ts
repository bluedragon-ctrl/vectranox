export type GameState = 'serve' | 'play' | 'clear' | 'over' | 'complete';

export type BrickKind = 'normal' | 'tough' | 'steel';

/** Player input for one tick. Plain data so runs can later be recorded and replayed. */
export interface TickInput {
  /** Paddle movement from the mouse, in world units. */
  dx: number;
  /** Keyboard direction: -1, 0 or 1. */
  axis: number;
  launch: boolean;
}

/** Position is the centre; `px` is x at the previous tick, for render interpolation. */
export interface Paddle {
  x: number;
  px: number;
  y: number;
  w: number;
  h: number;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  r: number;
  speed: number;
}

/** Position is the bottom-left corner. */
export interface Brick {
  id: number;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: BrickKind;
  /** Hits left; unused for steel. */
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Tick of the last hit, for flash effects. */
  hitTick: number;
}
