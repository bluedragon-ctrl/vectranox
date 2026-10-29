import * as THREE from 'three';
import { QuadBatch } from '../QuadBatch';
import { PARTICLE_FRAGMENT, PARTICLE_KIND, PIECE_FRAGMENT } from '../materials/particle';
import type { Shard } from './fracture';

const MAX = 2048;
/** Glass pieces share the pool but draw with their own shader. */
const PIECE = 2;
const WHITE = new THREE.Color(1, 1, 1);

type Kind = (typeof PARTICLE_KIND)[keyof typeof PARTICLE_KIND] | typeof PIECE;

export interface BurstOptions {
  count: number;
  color: THREE.Color;
  /** Speed range in world units per second. */
  speed: [number, number];
  /** Emission direction (radians) and half-spread; omit for all directions. */
  angle?: number;
  spread?: number;
  life?: [number, number];
  size?: [number, number];
  gravity?: number;
  drag?: number;
}

/**
 * CPU-simulated visual particles: metal sparks, glass glints and shattered glass pieces.
 * Purely cosmetic: driven by wall-clock time, never fed back into the simulation.
 */
export class Particles {
  readonly batch = new QuadBatch({ max: MAX, fragmentShader: PARTICLE_FRAGMENT, pad: 3, renderOrder: 41 });
  readonly pieces = new QuadBatch({ max: MAX, fragmentShader: PIECE_FRAGMENT, pad: 2, renderOrder: 40 });
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
  private tmp = new THREE.Color();

  get count(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  /** Soft sparks with a hot head, for metal hits. */
  sparks(x: number, y: number, o: BurstOptions): void {
    for (let i = 0; i < o.count; i++) {
      const [vx, vy] = velocity(o);
      const k = this.spawn(PARTICLE_KIND.spark, x, y, vx, vy, rand(o.life ?? [0.18, 0.45]), rand(o.size ?? [1.2, 2]), o.color);
      if (k < 0) return;
      this.gravity[k] = o.gravity ?? -120;
      this.drag[k] = o.drag ?? 3.5;
    }
  }

  /** Short sharp slivers of light, for glass. */
  glints(x: number, y: number, o: BurstOptions): void {
    for (let i = 0; i < o.count; i++) {
      const [vx, vy] = velocity(o);
      const k = this.spawn(PARTICLE_KIND.glint, x, y, vx, vy, rand(o.life ?? [0.1, 0.2]), rand(o.size ?? [2.5, 4.5]), o.color);
      if (k < 0) return;
      this.gravity[k] = o.gravity ?? 0;
      this.drag[k] = o.drag ?? 6;
    }
  }

  /** One glass piece (see `fractureRect`), tumbling away with the given velocity. */
  piece(s: Shard, vx: number, vy: number, color: THREE.Color, life: number): void {
    const radius = Math.sqrt(
      Math.max(s.ax * s.ax + s.ay * s.ay, s.bx * s.bx + s.by * s.by, (s.ax + s.bx) ** 2 + (s.ay + s.by) ** 2),
    );
    const k = this.spawn(PIECE, s.cx, s.cy, vx, vy, life, radius, color);
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
      this.age[i] = (this.age[i] ?? 0) + dt;
      if ((this.age[i] ?? 0) >= (this.life[i] ?? 0)) {
        this.remove(i);
        continue;
      }
      const damp = Math.exp(-(this.drag[i] ?? 0) * dt);
      this.vx[i] = (this.vx[i] ?? 0) * damp;
      this.vy[i] = (this.vy[i] ?? 0) * damp + (this.gravity[i] ?? 0) * dt;
      this.x[i] = (this.x[i] ?? 0) + (this.vx[i] ?? 0) * dt;
      this.y[i] = (this.y[i] ?? 0) + (this.vy[i] ?? 0) * dt;
      this.rot[i] = (this.rot[i] ?? 0) + (this.vrot[i] ?? 0) * dt;
      i++;
    }
  }

  draw(): void {
    const b = this.batch;
    const p = this.pieces;
    b.begin();
    p.begin();
    for (let i = 0; i < this.n; i++) {
      const t = (this.age[i] ?? 0) / (this.life[i] ?? 1);
      const x = this.x[i] ?? 0;
      const y = this.y[i] ?? 0;
      const size = this.size[i] ?? 1;
      const color = this.tmp.setRGB(this.rgb[i * 3] ?? 1, this.rgb[i * 3 + 1] ?? 1, this.rgb[i * 3 + 2] ?? 1);
      const vx = this.vx[i] ?? 0;
      const vy = this.vy[i] ?? 0;
      switch (this.kind[i]) {
        case PARTICLE_KIND.spark: {
          const len = size * 2 + Math.hypot(vx, vy) * 0.03;
          b.push(x, y, len, size, color, (1 - t) ** 1.5, PARTICLE_KIND.spark, 0, 0, 0, Math.atan2(vy, vx));
          break;
        }
        case PARTICLE_KIND.glint: {
          const len = size + Math.hypot(vx, vy) * 0.012;
          b.push(x, y, len, size * 0.28, color, 1 - t, PARTICLE_KIND.glint, 0, 0, 0, Math.atan2(vy, vx));
          break;
        }
        case PIECE: {
          // Pieces shrink a little as they fade, and flash when a face turns to the light.
          const s = 1 - 0.35 * t;
          const rot = this.rot[i] ?? 0;
          const glint = Math.abs(Math.cos(rot + (this.phase[i] ?? 0))) ** 16 * 0.6 * this.glintScale;
          color.lerp(WHITE, glint * 0.6).multiplyScalar(1 + glint);
          const extent = 2 * size * s;
          p.push(
            x,
            y,
            extent,
            extent,
            color,
            1 - t * t * t,
            (this.verts[i * 4] ?? 0) * s,
            (this.verts[i * 4 + 1] ?? 0) * s,
            (this.verts[i * 4 + 2] ?? 0) * s,
            (this.verts[i * 4 + 3] ?? 0) * s,
            rot,
          );
          break;
        }
      }
    }
    b.commit();
    p.commit();
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
    this.rgb[i * 3] = color.r;
    this.rgb[i * 3 + 1] = color.g;
    this.rgb[i * 3 + 2] = color.b;
    return i;
  }

  /** Swap-remove: draw order between particles doesn't matter. */
  private remove(i: number): void {
    const last = --this.n;
    if (i === last) return;
    for (const arr of [this.kind, this.x, this.y, this.vx, this.vy, this.age, this.life, this.size, this.rot, this.vrot, this.gravity, this.drag, this.phase]) {
      arr[i] = arr[last] ?? 0;
    }
    for (let c = 0; c < 3; c++) this.rgb[i * 3 + c] = this.rgb[last * 3 + c] ?? 0;
    for (let c = 0; c < 4; c++) this.verts[i * 4 + c] = this.verts[last * 4 + c] ?? 0;
  }
}

function rand([min, max]: [number, number]): number {
  return min + Math.random() * (max - min);
}

function velocity(o: BurstOptions): [number, number] {
  const a = o.angle === undefined ? Math.random() * Math.PI * 2 : o.angle + (Math.random() * 2 - 1) * (o.spread ?? Math.PI);
  const s = rand(o.speed);
  return [Math.cos(a) * s, Math.sin(a) * s];
}
