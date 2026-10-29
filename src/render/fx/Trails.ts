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

/**
 * Ball trails from the rendered (interpolated) positions of recent frames. Each segment
 * between consecutive points is a tapered capsule; max blending keeps the joints even.
 */
export class Trails {
  readonly batch = new QuadBatch({ max: 1024, fragmentShader: TRAIL_FRAGMENT, pad: 5, blending: 'max', renderOrder: 20 });
  private trails = new Map<number, Point[]>();
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
    const live = new Set<number>();
    balls.forEach((b, i) => {
      const pos = positions[i];
      if (!pos) return;
      live.add(b.id);
      let pts = this.trails.get(b.id);
      if (!pts) this.trails.set(b.id, (pts = []));
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
    for (const [id, pts] of this.trails) {
      while (pts.length > 0 && now - (pts[0]?.t ?? now) > TRAIL_TIME) pts.shift();
      if (!live.has(id) && pts.length === 0) this.trails.delete(id);
    }
  }

  draw(balls: readonly Ball[], positions: readonly { x: number; y: number }[], now: number): void {
    const b = this.batch;
    b.begin();
    const radius = new Map(balls.map((ball, i) => [ball.id, { r: ball.r, pos: positions[i] }]));
    for (const [id, pts] of this.trails) {
      const info = radius.get(id);
      const r = (info?.r ?? 4) * 0.7;
      // The newest segment runs from the last point to the ball's current position.
      const chain = info?.pos ? [...pts, { x: info.pos.x, y: info.pos.y, t: now }] : pts;
      for (let i = 0; i + 1 < chain.length; i++) {
        const a = chain[i];
        const c = chain[i + 1];
        if (!a || !c) continue;
        const ka = Math.max(0, 1 - (now - a.t) / TRAIL_TIME);
        const kc = Math.max(0, 1 - (now - c.t) / TRAIL_TIME);
        const len = Math.hypot(c.x - a.x, c.y - a.y);
        if (len < 0.01 || kc <= 0) continue;
        const rc = r * (0.35 + 0.65 * kc);
        const ra = r * (0.35 + 0.65 * ka);
        const maxR = Math.max(ra, rc);
        this.mixed.copy(this.tail).lerp(this.head, (ka + kc) / 2);
        b.push((a.x + c.x) / 2, (a.y + c.y) / 2, len + maxR * 2, maxR * 2, this.mixed, kc, rc, ra, ka, 0, Math.atan2(c.y - a.y, c.x - a.x));
      }
    }
    b.commit();
  }
}
