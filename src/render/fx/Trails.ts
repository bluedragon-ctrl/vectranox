import * as THREE from 'three';
import type { Ball } from '../../game/types';
import { QuadBatch } from '../QuadBatch';
import { TRAIL_FRAGMENT } from '../materials/ball';

/** Seconds of history a trail shows. */
const TRAIL_TIME = 0.16;
const MAX_POINTS = 32;
/** Minimum travel (world units) before a new trail point is recorded. */
const MIN_STEP = 1.5;

interface Point {
  x: number;
  y: number;
  t: number;
}

interface Trail {
  pts: Point[];
  /** The ball's radius and rendered position this frame; it leads the newest segment. */
  r: number;
  head: Point;
  /** False once the ball is gone and only the tail is left to fade. */
  live: boolean;
}

/**
 * Ball trails from the rendered (interpolated) positions of recent frames. Each segment
 * between consecutive points is a tapered capsule; max blending keeps the joints even.
 */
export class Trails {
  readonly batch = new QuadBatch({ max: 1024, fragmentShader: TRAIL_FRAGMENT, pad: 5, blending: 'max', renderOrder: 20 });
  private trails = new Map<number, Trail>();
  private head = new THREE.Color();
  private tail = new THREE.Color();
  private mixed = new THREE.Color();

  constructor(headColor: THREE.Color, tailColor: THREE.Color) {
    this.head.copy(headColor);
    this.tail.copy(tailColor);
  }

  clear(): void {
    this.trails.clear();
  }

  /** Records this frame's positions and drops stale history. `positions` is parallel to `balls`. */
  update(balls: readonly Ball[], positions: readonly { x: number; y: number }[], now: number): void {
    for (const trail of this.trails.values()) trail.live = false;
    balls.forEach((b, i) => {
      const pos = positions[i];
      if (!pos) return;
      let trail = this.trails.get(b.id);
      if (!trail) this.trails.set(b.id, (trail = { pts: [], r: b.r, head: { x: 0, y: 0, t: 0 }, live: true }));
      trail.live = true;
      trail.r = b.r;
      trail.head.x = pos.x;
      trail.head.y = pos.y;
      trail.head.t = now;
      const pts = trail.pts;
      // A ball held on the paddle has no trail.
      if (b.vx === 0 && b.vy === 0) {
        pts.length = 0;
        return;
      }
      const lastPt = pts[pts.length - 1];
      if (!lastPt || Math.hypot(pos.x - lastPt.x, pos.y - lastPt.y) >= MIN_STEP) {
        pts.push({ x: pos.x, y: pos.y, t: now });
        if (pts.length > MAX_POINTS) pts.shift();
      }
    });
    for (const [id, { pts, live }] of this.trails) {
      while (pts.length > 0 && now - pts[0]!.t > TRAIL_TIME) pts.shift();
      if (!live && pts.length === 0) this.trails.delete(id);
    }
  }

  draw(now: number): void {
    this.batch.begin();
    for (const { pts, r, head, live } of this.trails.values()) {
      const radius = r * 0.7;
      for (let i = 0; i + 1 < pts.length; i++) this.segment(pts[i]!, pts[i + 1]!, radius, now);
      const last = pts[pts.length - 1];
      if (live && last) this.segment(last, head, radius, now);
    }
    this.batch.commit();
  }

  private segment(a: Point, c: Point, r: number, now: number): void {
    const ka = Math.max(0, 1 - (now - a.t) / TRAIL_TIME);
    const kc = Math.max(0, 1 - (now - c.t) / TRAIL_TIME);
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    if (len < 0.01 || kc <= 0) return;
    const rc = r * (0.35 + 0.65 * kc);
    const ra = r * (0.35 + 0.65 * ka);
    const maxR = Math.max(ra, rc);
    this.mixed.copy(this.tail).lerp(this.head, (ka + kc) / 2);
    this.batch.push((a.x + c.x) / 2, (a.y + c.y) / 2, len + maxR * 2, maxR * 2, this.mixed, kc, rc, ra, ka, 0, Math.atan2(c.y - a.y, c.x - a.x));
  }
}
