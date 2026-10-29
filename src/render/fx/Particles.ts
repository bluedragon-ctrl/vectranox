import * as THREE from 'three';
import { QuadBatch } from '../QuadBatch';
import { GLINT_FRAGMENT, METAL_PIECE_FRAGMENT, PIECE_FRAGMENT } from '../materials/particle';
import type { Shard } from './fracture';

const MAX = 2048;
/** Particle kinds; they share the pool but each draws with its own shader. */
const GLINT = 0;
const PIECE = 1;
const METAL_PIECE = 2;
const WHITE = new THREE.Color(1, 1, 1);

type Kind = typeof GLINT | typeof PIECE | typeof METAL_PIECE;
type Range = readonly [number, number];

export interface BurstOptions {
  count: number;
  color: THREE.Color;
  /** Speed range in world units per second. */
  speed: Range;
  /** Emission direction (radians) and half-spread; omit for all directions. */
  angle?: number;
  spread?: number;
  life?: Range;
  size?: Range;
  drag?: number;
}

/**
 * CPU-simulated visual particles: glass glints and broken glass or metal pieces.
 * Purely cosmetic: driven by wall-clock time, never fed back into the simulation.
 */
export class Particles {
  readonly glintBatch = new QuadBatch({ max: MAX, fragmentShader: GLINT_FRAGMENT, pad: 3, renderOrder: 41 });
  readonly pieces = new QuadBatch({ max: MAX, fragmentShader: PIECE_FRAGMENT, pad: 2, renderOrder: 40 });
  readonly metalPieces = new QuadBatch({ max: MAX, fragmentShader: METAL_PIECE_FRAGMENT, pad: 1, renderOrder: 40 });
  /** Strength of the facet glint on spinning pieces (lowered by reduce-flashing). */
  glintScale = 1;

  private n = 0;
  private kind = new Uint8Array(MAX);
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private age = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private rot = new Float32Array(MAX);
  private vrot = new Float32Array(MAX);
  private gravity = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private phase = new Float32Array(MAX);
  private rgb = new Float32Array(MAX * 3);
  /** Piece vertices relative to the centre: ax, ay, bx, by (the third is -(a + b)). */
  private verts = new Float32Array(MAX * 4);
  /** The one-value-per-particle arrays, for `remove`. */
  private scalars = [this.kind, this.x, this.y, this.vx, this.vy, this.age, this.life, this.size, this.rot, this.vrot, this.gravity, this.drag, this.phase];
  private tmp = new THREE.Color();

  clear(): void {
    this.n = 0;
  }

  /** Short sharp slivers of light, for breaking glass. */
  glints(x: number, y: number, o: BurstOptions): void {
    for (let i = 0; i < o.count; i++) {
      const a = o.angle === undefined ? Math.random() * Math.PI * 2 : o.angle + (Math.random() * 2 - 1) * (o.spread ?? Math.PI);
      const s = rand(o.speed);
      const k = this.spawn(GLINT, x, y, Math.cos(a) * s, Math.sin(a) * s, rand(o.life ?? [0.1, 0.2]), rand(o.size ?? [2.5, 4.5]), o.color);
      if (k < 0) return;
      this.drag[k] = o.drag ?? 6;
    }
  }

  /** One glass (or `metal`) piece (see `fractureRect`), tumbling away with the given velocity. */
  piece(s: Shard, vx: number, vy: number, color: THREE.Color, life: number, metal = false): void {
    const radius = Math.sqrt(
      Math.max(s.ax * s.ax + s.ay * s.ay, s.bx * s.bx + s.by * s.by, (s.ax + s.bx) ** 2 + (s.ay + s.by) ** 2),
    );
    const k = this.spawn(metal ? METAL_PIECE : PIECE, s.cx, s.cy, vx, vy, life, radius, color);
    if (k < 0) return;
    this.verts[k * 4] = s.ax;
    this.verts[k * 4 + 1] = s.ay;
    this.verts[k * 4 + 2] = s.bx;
    this.verts[k * 4 + 3] = s.by;
    this.vrot[k] = (Math.random() < 0.5 ? -1 : 1) * rand([3, 11]);
    this.phase[k] = Math.random() * Math.PI;
    this.gravity[k] = -200;
    this.drag[k] = 1.4;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      const age = this.age[i]! + dt;
      if (age >= this.life[i]!) {
        this.remove(i);
        continue;
      }
      this.age[i] = age;
      const damp = Math.exp(-this.drag[i]! * dt);
      const vx = this.vx[i]! * damp;
      const vy = this.vy[i]! * damp + this.gravity[i]! * dt;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.x[i] = this.x[i]! + vx * dt;
      this.y[i] = this.y[i]! + vy * dt;
      this.rot[i] = this.rot[i]! + this.vrot[i]! * dt;
      i++;
    }
  }

  draw(): void {
    this.glintBatch.begin();
    this.pieces.begin();
    this.metalPieces.begin();
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i]! / this.life[i]!;
      const x = this.x[i]!;
      const y = this.y[i]!;
      const size = this.size[i]!;
      const color = this.tmp.fromArray(this.rgb, i * 3);
      const vx = this.vx[i]!;
      const vy = this.vy[i]!;
      switch (this.kind[i]) {
        case GLINT: {
          const len = size + Math.hypot(vx, vy) * 0.012;
          this.glintBatch.push(x, y, len, size * 0.28, color, 1 - t, 0, 0, 0, 0, Math.atan2(vy, vx));
          break;
        }
        case PIECE:
        case METAL_PIECE: {
          // Pieces shrink a little as they fade, and flash when a face turns to the light.
          const s = 1 - 0.35 * t;
          const rot = this.rot[i]!;
          const glint = Math.abs(Math.cos(rot + this.phase[i]!)) ** 16 * 0.6 * this.glintScale;
          color.lerp(WHITE, glint * 0.6).multiplyScalar(1 + glint);
          const extent = 2 * size * s;
          const v = i * 4;
          (this.kind[i] === PIECE ? this.pieces : this.metalPieces).push(x, y, extent, extent, color, 1 - t * t * t, this.verts[v]! * s, this.verts[v + 1]! * s, this.verts[v + 2]! * s, this.verts[v + 3]! * s, rot);
          break;
        }
      }
    }
    this.glintBatch.commit();
    this.pieces.commit();
    this.metalPieces.commit();
  }

  private spawn(kind: Kind, x: number, y: number, vx: number, vy: number, life: number, size: number, color: THREE.Color): number {
    if (this.n >= MAX) return -1;
    const i = this.n++;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.rot[i] = 0;
    this.vrot[i] = 0;
    this.gravity[i] = 0;
    this.drag[i] = 0;
    this.phase[i] = 0;
    color.toArray(this.rgb, i * 3);
    return i;
  }

  /** Swap-remove: draw order between particles doesn't matter. */
  private remove(i: number): void {
    const last = --this.n;
    if (i === last) return;
    for (const arr of this.scalars) arr[i] = arr[last]!;
    this.rgb.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.verts.copyWithin(i * 4, last * 4, last * 4 + 4);
  }
}

function rand([min, max]: Range): number {
  return min + Math.random() * (max - min);
}
