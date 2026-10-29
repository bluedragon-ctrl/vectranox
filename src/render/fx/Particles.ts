import * as THREE from 'three';
import { QuadBatch } from '../QuadBatch';
import { PARTICLE_FRAGMENT, PARTICLE_KIND } from '../materials/particle';

const MAX = 2048;

type Kind = (typeof PARTICLE_KIND)[keyof typeof PARTICLE_KIND];

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
  intensity?: number;
}

/**
 * CPU-simulated visual particles (sparks and glass shards).
 * Purely cosmetic: driven by wall-clock time, never fed back into the simulation.
 */
export class Particles {
  readonly batch = new QuadBatch({ max: MAX, fragmentShader: PARTICLE_FRAGMENT, pad: 3, renderOrder: 40 });

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
  private intensity = new Float32Array(MAX);
  private rgb = new Float32Array(MAX * 3);
  private tmp = new THREE.Color();

  get count(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  sparks(x: number, y: number, o: BurstOptions): void {
    for (let i = 0; i < o.count; i++) {
      const [vx, vy] = velocity(o);
      const k = this.spawn(PARTICLE_KIND.spark, x, y, vx, vy, rand(o.life ?? [0.18, 0.45]), rand(o.size ?? [1.2, 2]), o.color);
      if (k < 0) return;
      this.gravity[k] = o.gravity ?? -120;
      this.drag[k] = o.drag ?? 3.5;
      this.intensity[k] = o.intensity ?? 1;
    }
  }

  shards(x: number, y: number, w: number, h: number, o: BurstOptions): void {
    for (let i = 0; i < o.count; i++) {
      const px = x + (Math.random() - 0.5) * w;
      const py = y + (Math.random() - 0.5) * h;
      const [vx, vy] = velocity(o);
      const k = this.spawn(PARTICLE_KIND.shard, px, py, vx, vy, rand(o.life ?? [0.45, 0.8]), rand(o.size ?? [2.5, 5]), o.color);
      if (k < 0) return;
      this.rot[k] = Math.random() * Math.PI * 2;
      this.vrot[k] = (Math.random() - 0.5) * 22;
      this.gravity[k] = o.gravity ?? -380;
      this.drag[k] = o.drag ?? 1.2;
      this.intensity[k] = o.intensity ?? 1;
    }
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
    b.begin();
    for (let i = 0; i < this.n; i++) {
      const t = (this.age[i] ?? 0) / (this.life[i] ?? 1);
      const x = this.x[i] ?? 0;
      const y = this.y[i] ?? 0;
      const size = this.size[i] ?? 1;
      const k = this.intensity[i] ?? 1;
      const color = this.tmp.setRGB(this.rgb[i * 3] ?? 1, this.rgb[i * 3 + 1] ?? 1, this.rgb[i * 3 + 2] ?? 1);
      switch (this.kind[i]) {
        case PARTICLE_KIND.spark: {
          const vx = this.vx[i] ?? 0;
          const vy = this.vy[i] ?? 0;
          const len = size * 2 + Math.hypot(vx, vy) * 0.03;
          b.push(x, y, len, size, color, (1 - t) ** 1.5 * k, PARTICLE_KIND.spark, 0, 0, 0, Math.atan2(vy, vx));
          break;
        }
        case PARTICLE_KIND.shard: {
          const s = size * (1 - 0.4 * t);
          b.push(x, y, s, s, color, (1 - t * t) * k, PARTICLE_KIND.shard, 0, 0, 0, this.rot[i] ?? 0);
          break;
        }
      }
    }
    b.commit();
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
    this.intensity[i] = 1;
    this.rgb[i * 3] = color.r;
    this.rgb[i * 3 + 1] = color.g;
    this.rgb[i * 3 + 2] = color.b;
    return i;
  }

  /** Swap-remove: order doesn't matter for additive-ish particles. */
  private remove(i: number): void {
    const last = --this.n;
    if (i === last) return;
    for (const arr of [this.kind, this.x, this.y, this.vx, this.vy, this.age, this.life, this.size, this.rot, this.vrot, this.gravity, this.drag, this.intensity]) {
      arr[i] = arr[last] ?? 0;
    }
    for (let c = 0; c < 3; c++) this.rgb[i * 3 + c] = this.rgb[last * 3 + c] ?? 0;
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
