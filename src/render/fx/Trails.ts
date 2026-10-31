import * as THREE from 'three';
import type { Ball } from '../../game/types';
import { QuadBatch } from '../QuadBatch';
import { TRAIL_FRAGMENT } from '../materials/ball';
import { ballLook } from '../palette';

/** Seconds of history a trail shows, up to `MAX_LENGTH` world units (so fast balls don't read as beams). */
const TRAIL_TIME = 0.16;
const MAX_LENGTH = 40;
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
  /** The ball's colours as it last looked, so a fading tail keeps them. */
  headColor: THREE.Color;
  tailColor: THREE.Color;
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
  private mixed = new THREE.Color();
  /** Reused end point of a trail cut at `MAX_LENGTH`. */
  private cut: Point = { x: 0, y: 0, t: 0 };

  clear(): void {
    this.trails.clear();
  }

  /** Drops a ball's history, e.g. after it jumped through a portal, so no trail spans the jump. */
  restart(id: number): void {
    this.trails.get(id)?.pts.splice(0);
  }

  /**
   * Records this frame's positions and looks and drops stale history. `positions` is parallel to
   * `balls`; `pierce` is as for `ballLook`.
   */
  update(balls: readonly Ball[], positions: readonly { x: number; y: number }[], now: number, pierce: number): void {
    for (const trail of this.trails.values()) trail.live = false;
    balls.forEach((b, i) => {
      const pos = positions[i];
      if (!pos) return;
      let trail = this.trails.get(b.id);
      if (!trail) {
        trail = { pts: [], r: b.r, head: { x: 0, y: 0, t: 0 }, headColor: new THREE.Color(), tailColor: new THREE.Color(), live: true };
        this.trails.set(b.id, trail);
      }
      trail.live = true;
      trail.r = b.r;
      const look = ballLook(b, pierce);
      trail.headColor.copy(look.color);
      trail.tailColor.copy(look.trailTail);
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

  /** Walks each trail back from its head; it tapers out by age or by distance, whichever ends first. */
  draw(now: number): void {
    this.batch.begin();
    for (const trail of this.trails.values()) {
      const { pts, r, head, live } = trail;
      let c = live ? head : pts[pts.length - 1];
      if (!c) continue;
      let kc = fade(c, 0, now);
      let dist = 0;
      for (let i = pts.length - (live ? 1 : 2); i >= 0 && kc > 0; i--) {
        let a = pts[i]!;
        let len = Math.hypot(c.x - a.x, c.y - a.y);
        dist += len;
        // A long step (low frame rate) can run past the length limit: end the trail right there.
        const over = dist - MAX_LENGTH;
        if (over > 0) {
          const keep = (len - over) / len;
          this.cut.x = c.x + (a.x - c.x) * keep;
          this.cut.y = c.y + (a.y - c.y) * keep;
          this.cut.t = a.t;
          a = this.cut;
          len -= over;
        }
        const ka = fade(a, Math.min(dist, MAX_LENGTH), now);
        if (len >= 0.01) this.segment(trail, a, c, len, ka, kc, r * 0.7);
        c = a;
        kc = ka;
      }
    }
    this.batch.commit();
  }

  /** Segment of `trail` from tail point `a` to head point `c`, with fades `ka` and `kc`. */
  private segment(trail: Trail, a: Point, c: Point, len: number, ka: number, kc: number, r: number): void {
    const rc = r * (0.35 + 0.65 * kc);
    const ra = r * (0.35 + 0.65 * ka);
    const maxR = Math.max(ra, rc);
    this.mixed.copy(trail.tailColor).lerp(trail.headColor, (ka + kc) / 2);
    this.batch.push((a.x + c.x) / 2, (a.y + c.y) / 2, len + maxR * 2, maxR * 2, this.mixed, kc, rc, ra, ka, 0, Math.atan2(c.y - a.y, c.x - a.x));
  }
}

/** 1 at a point just laid down at the ball, 0 once it is `TRAIL_TIME` old or `MAX_LENGTH` behind. */
function fade(p: Point, dist: number, now: number): number {
  return Math.max(0, Math.min(1 - (now - p.t) / TRAIL_TIME, 1 - dist / MAX_LENGTH));
}
