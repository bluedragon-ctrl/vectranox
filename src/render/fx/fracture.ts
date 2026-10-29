import { clamp } from '../../core/math';

/** A triangle as its centroid plus two vertices relative to it; the third is -(a + b). */
export interface Shard {
  cx: number;
  cy: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

interface Pt {
  x: number;
  y: number;
}

/**
 * Breaks a rectangle (centre cx/cy, size w×h) into triangles radiating from an impact point,
 * like glass struck at that spot. Rays run from the impact to the corners and to `extraPoints`
 * random points on the edges; every ray is cut once, so each wedge yields a small triangle near
 * the impact and two larger ones beyond. The pieces tile the rectangle exactly.
 */
export function fractureRect(cx: number, cy: number, w: number, h: number, ix: number, iy: number, extraPoints: number): Shard[] {
  const hw = w / 2;
  const hh = h / 2;
  // Keep the impact strictly inside so the fan around it stays convex.
  const imp: Pt = { x: clamp(ix - cx, -hw * 0.9, hw * 0.9), y: clamp(iy - cy, -hh * 0.8, hh * 0.8) };

  const rim: Pt[] = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  const perimeter = 2 * (w + h);
  for (let i = 0; i < extraPoints; i++) rim.push(perimeterPoint(Math.random() * perimeter, w, h));
  rim.sort((p, q) => Math.atan2(p.y - imp.y, p.x - imp.x) - Math.atan2(q.y - imp.y, q.x - imp.x));

  // One cut per ray, shared by both wedges that use it, so neighbouring pieces fit together.
  const cut = rim.map((p) => lerp(imp, p, 0.3 + Math.random() * 0.35));
  const out: Shard[] = [];
  for (let i = 0; i < rim.length; i++) {
    const j = (i + 1) % rim.length;
    const p = rim[i];
    const q = rim[j];
    const cp = cut[i];
    const cq = cut[j];
    if (!p || !q || !cp || !cq) continue;
    push(out, cx, cy, imp, cp, cq);
    push(out, cx, cy, cp, p, q);
    push(out, cx, cy, cp, q, cq);
  }
  return out;
}

/** A small random triangular chip of glass centred on (x, y). Any a, b work: the third vertex -(a + b) keeps the centroid at the centre. */
export function chip(x: number, y: number, r: number): Shard {
  const a0 = Math.random() * Math.PI * 2;
  const a1 = a0 + 1.8 + Math.random() * 1.2;
  const rb = r * (0.6 + Math.random() * 0.4);
  return { cx: x, cy: y, ax: Math.cos(a0) * r, ay: Math.sin(a0) * r, bx: Math.cos(a1) * rb, by: Math.sin(a1) * rb };
}

function push(out: Shard[], cx: number, cy: number, a: Pt, b: Pt, c: Pt): void {
  const mx = (a.x + b.x + c.x) / 3;
  const my = (a.y + b.y + c.y) / 3;
  // Skip slivers: they'd only flicker.
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  if (area < 0.2) return;
  out.push({ cx: cx + mx, cy: cy + my, ax: a.x - mx, ay: a.y - my, bx: b.x - mx, by: b.y - my });
}

/** Point at distance `d` along the rectangle's perimeter, starting bottom-left, counter-clockwise. */
function perimeterPoint(d: number, w: number, h: number): Pt {
  const hw = w / 2;
  const hh = h / 2;
  if (d < w) return { x: -hw + d, y: -hh };
  d -= w;
  if (d < h) return { x: hw, y: -hh + d };
  d -= h;
  if (d < w) return { x: hw - d, y: hh };
  d -= w;
  return { x: -hw, y: hh - d };
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
