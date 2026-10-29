import { BALL, FIELD } from '../config/game';
import type { SweepHit } from './collision';
import type { WallSide } from './events';
import type { Ball } from './types';

/** Whether `h` is a hit that comes before `best` (or the first one). */
export function closer(h: SweepHit | null, best: SweepHit | null): h is SweepHit {
  return h !== null && (best === null || h.t < best.t);
}

/** Left, right and top walls as planes. The bottom is open. */
export function sweepWalls(b: Ball, dx: number, dy: number): (SweepHit & { side: WallSide }) | null {
  let best: (SweepHit & { side: WallSide }) | null = null;
  if (dx < 0) {
    const t = (b.r - b.x) / dx;
    if (t <= 1) best = { t: Math.max(0, t), nx: 1, ny: 0, side: 'left' };
  } else if (dx > 0) {
    const t = (FIELD.width - b.r - b.x) / dx;
    if (t <= 1) best = { t: Math.max(0, t), nx: -1, ny: 0, side: 'right' };
  }
  if (dy > 0) {
    const t = Math.max(0, (FIELD.height - b.r - b.y) / dy);
    if (t <= 1 && (!best || t < best.t)) best = { t, nx: 0, ny: -1, side: 'top' };
  }
  return best;
}

/** Sends a ball off at `angle` from vertical (positive is right). */
export function aim(b: Ball, angle: number, speed: number): void {
  b.vx = Math.sin(angle) * speed;
  b.vy = Math.cos(angle) * speed;
}

/** Rescales velocity to `speed` and keeps it from going near-horizontal. */
export function normalizeVelocity(b: Ball, speed: number): void {
  const len = Math.hypot(b.vx, b.vy) || 1;
  let vx = (b.vx / len) * speed;
  let vy = (b.vy / len) * speed;
  const minVy = speed * BALL.minVerticalRatio;
  if (Math.abs(vy) < minVy) {
    vy = (vy < 0 ? -1 : 1) * minVy;
    vx = (vx < 0 ? -1 : 1) * Math.sqrt(speed * speed - minVy * minVy);
  }
  b.vx = vx;
  b.vy = vy;
}
