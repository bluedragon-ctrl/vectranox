export interface SweepHit {
  /** Fraction of the motion at which contact happens, in [0, 1]. */
  t: number;
  /** Normal of the face that was hit. */
  nx: number;
  ny: number;
}

/**
 * Sweeps point (ox, oy) along (dx, dy) against an AABB (slab method).
 * For a ball, pass the box expanded by its radius (Minkowski sum; corners count as square,
 * which reads as slightly forgiving in play).
 * Returns null on a miss, or when the point starts inside the box.
 */
export function sweepBox(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): SweepHit | null {
  let tEnter = -Infinity;
  let tExit = Infinity;
  let nx = 0;
  let ny = 0;

  if (dx === 0) {
    if (ox <= minX || ox >= maxX) return null;
  } else {
    const t1 = (minX - ox) / dx;
    const t2 = (maxX - ox) / dx;
    tEnter = Math.min(t1, t2);
    tExit = Math.max(t1, t2);
    nx = dx > 0 ? -1 : 1;
  }

  if (dy === 0) {
    if (oy <= minY || oy >= maxY) return null;
  } else {
    const t1 = (minY - oy) / dy;
    const t2 = (maxY - oy) / dy;
    const near = Math.min(t1, t2);
    if (near > tEnter) {
      tEnter = near;
      nx = 0;
      ny = dy > 0 ? -1 : 1;
    }
    tExit = Math.min(tExit, Math.max(t1, t2));
  }

  if (tEnter > tExit || tEnter < 0 || tEnter > 1) return null;
  return { t: tEnter, nx, ny };
}
