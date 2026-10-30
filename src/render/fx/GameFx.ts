import * as THREE from 'three';
import { BRICK, FIELD } from '../../config/game';
import type { Game } from '../../game/Game';
import type { HitSource } from '../../game/types';
import { BRICK_GAP, brickTint, COLORS, EXPLOSION_COLOR, POWER_COLORS } from '../palette';
import { fractureRect } from './fracture';
import { Particles } from './Particles';
import { Shake } from './Shake';
import type { Trails } from './Trails';

const WALL_HIT_SLOTS = 8;
/** Share of the ball's velocity that shattered glass inherits. */
const PIECE_PUSH = 0.12;
/** Upward push on glass shattered by a laser bolt. */
const LASER_PUSH = 45;
/** Outward push on glass shattered by an explosion. */
const BLAST_PUSH = 60;

interface WallHit {
  x: number;
  y: number;
  strength: number;
}

/**
 * Turns simulation events into cosmetic effects: shake, flashes and pulses. Particles are
 * reserved for bricks breaking.
 * Reads game state only to place effects (brick positions); never writes to it.
 */
export class GameFx {
  readonly particles = new Particles();
  readonly shake = new Shake();
  readonly wallHits: WallHit[] = Array.from({ length: WALL_HIT_SLOTS }, () => ({ x: 0, y: 0, strength: 0 }));
  readonly flashColor = new THREE.Color();
  flash = 0;
  aberration = 0;
  danger = 0;
  paddlePulse = 0;
  paddleHitOffset = 0;
  /** Laser emitters light up on every shot. */
  laserFlash = 0;
  readonly barrierHit = { x: 0, strength: 0 };
  /** Explosions going off: a ring per centre, growing to the radius and fading, on their own clock since they chain. */
  explosions: { x: number; y: number; radius: number; strength: number; color: THREE.Color }[] = [];
  /** Brick hit-flash strength, lowered by reduce-flashing. */
  brickFlash = 1;
  /** Bricks last hit by a pulse or explosion; those strike many at once, so they flash softer. */
  readonly areaHits = new Set<number>();

  private reduce = false;
  private nextWallHit = 0;
  private time = 0;
  private unsubscribe: (() => void)[] = [];
  private tint = new THREE.Color();

  constructor(private trails: Trails) {}

  setReduced(reduce: boolean): void {
    this.reduce = reduce;
    this.shake.scale = reduce ? 0 : 1;
    this.brickFlash = reduce ? 0.3 : 1;
    this.particles.glintScale = reduce ? 0.3 : 1;
    if (reduce) this.flash = this.aberration = 0;
  }

  update(dt: number): void {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.aberration = Math.max(0, this.aberration - dt * 1.8);
    this.danger = Math.max(0, this.danger - dt * 1.1);
    this.paddlePulse = Math.max(0, this.paddlePulse - dt * 4);
    this.laserFlash = Math.max(0, this.laserFlash - dt * 6);
    this.barrierHit.strength = Math.max(0, this.barrierHit.strength - dt * 2.5);
    for (const e of this.explosions) e.strength -= dt * 4;
    this.explosions = this.explosions.filter((e) => e.strength > 0);
    for (const h of this.wallHits) h.strength = Math.max(0, h.strength - dt * 3);
    this.particles.update(dt);
    this.shake.update(dt);
  }

  attach(game: Game): void {
    this.unsubscribe.forEach((off) => off());
    this.particles.clear();
    this.trails.clear();
    this.areaHits.clear();
    this.explosions = [];
    const ev = game.events;
    this.unsubscribe = [
      ev.on('wallHit', ({ side, x, y }) => {
        const px = side === 'left' ? 0 : side === 'right' ? FIELD.width : x;
        const py = side === 'top' ? FIELD.height : y;
        const slot = this.wallHits[this.nextWallHit];
        this.nextWallHit = (this.nextWallHit + 1) % WALL_HIT_SLOTS;
        if (slot) Object.assign(slot, { x: px, y: py, strength: 1 });
      }),
      ev.on('paddleHit', ({ offset }) => {
        this.paddlePulse = 1;
        this.paddleHitOffset = offset;
      }),
      ev.on('ballCaught', ({ offset }) => {
        this.paddlePulse = 0.6;
        this.paddleHitOffset = offset;
      }),
      ev.on('powerCollect', () => {
        this.paddlePulse = 1;
        this.paddleHitOffset = 0;
      }),
      ev.on('barrierHit', ({ x }) => {
        this.barrierHit.x = x;
        this.barrierHit.strength = 1;
      }),
      ev.on('portalWarp', ({ id }) => {
        this.trails.restart(id);
      }),
      ev.on('laserFire', () => {
        this.laserFlash = 1;
      }),
      ev.on('explosion', ({ source, centres, radius }) => {
        const color = source === 'charge' ? POWER_COLORS.detonator : EXPLOSION_COLOR;
        for (const { x, y } of centres) this.explosions.push({ x, y, radius, strength: 1, color });
        if (source === 'brick') {
          this.shake.add(0.14);
          return;
        }
        this.shake.add(0.3);
        this.pulse(POWER_COLORS.detonator, 0.08, 0.3);
      }),
      // A brick that survives a hit just flashes and kicks: no particles.
      ev.on('brickHit', ({ id, kind, by }) => {
        const area = isArea(by);
        if (area) this.areaHits.add(id);
        else this.areaHits.delete(id);
        this.shake.add(kind === 'steel' ? 0.06 : area ? 0 : 0.04);
      }),
      ev.on('brickDestroyed', ({ id, kind, by, x, y, ix, iy, vx, vy }) => {
        this.areaHits.delete(id);
        const brick = game.bricks.find((br) => br.id === id);
        const color = brick ? brickTint({ ...brick, hp: brick.maxHp }, this.tint) : this.tint.copy(COLORS.magenta);
        const w = (brick?.w ?? BRICK.width) - BRICK_GAP;
        const h = (brick?.h ?? BRICK.height) - BRICK_GAP;
        let pushX = vx * PIECE_PUSH;
        let pushY = by === 'laser' ? LASER_PUSH : vy * PIECE_PUSH;
        const centre = by === 'explosion' ? nearest(this.explosions, x, y) : null;
        if (centre) {
          const d = Math.hypot(x - centre.x, y - centre.y) || 1;
          pushX = ((x - centre.x) / d) * BLAST_PUSH;
          pushY = ((y - centre.y) / d) * BLAST_PUSH;
        }
        // The brick breaks into pieces radiating from the impact: glass shards and glints, or for an
        // any other kind a few metal pieces and nothing else.
        const metal = kind !== 'normal';
        for (const s of fractureRect(x, y, w, h, ix, iy, metal ? 3 : 2)) {
          const dx = s.cx - ix;
          const dy = s.cy - iy;
          const dist = Math.hypot(dx, dy) || 1;
          const speed = (35 + Math.random() * 60) * (1.3 - Math.min(dist / (w * 0.5), 1) * 0.6);
          this.particles.piece(s, (dx / dist) * speed + pushX, (dy / dist) * speed + pushY, color, 0.55 + Math.random() * 0.35, metal);
        }
        if (!metal) this.particles.glints(ix, iy, { count: 5, color, speed: [120, 260] });
        // An area hit breaks many bricks in one tick; its own kick stands in for theirs.
        if (!isArea(by)) this.shake.add(0.1);
      }),
      ev.on('stageEvent', ({ kind }) => {
        if (kind !== 'pulse') return;
        this.shake.add(0.25);
        this.pulse(COLORS.purple, 0.12, 0.4);
      }),
      ev.on('ballLost', () => {
        this.shake.add(0.3);
      }),
      ev.on('lifeLost', () => {
        this.shake.add(0.55);
        this.pulse(COLORS.magenta, 0.3, 1);
        this.danger = 1;
      }),
      ev.on('formationStep', ({ dropped }) => {
        if (dropped) this.shake.add(0.05);
      }),
      ev.on('stageClear', () => {
        this.shake.add(0.2);
        this.pulse(COLORS.cyan, 0.15, 0.5);
      }),
      ev.on('gameOver', () => {
        this.pulse(COLORS.magenta, 0.2, 1);
        this.danger = 1;
      }),
      ev.on('runComplete', () => {
        this.pulse(COLORS.yellow, 0.2, 0.6);
      }),
    ];
  }

  get now(): number {
    return this.time;
  }

  /** Full-screen flash and chromatic aberration kick; skipped entirely under reduce-flashing. */
  private pulse(color: THREE.Color, flash: number, aberration: number): void {
    if (this.reduce) return;
    this.flashColor.copy(color);
    this.flash = Math.max(this.flash, flash);
    this.aberration = Math.max(this.aberration, aberration);
  }
}

/** Hits that strike many bricks at once. */
function isArea(by: HitSource): boolean {
  return by === 'pulse' || by === 'explosion';
}

function nearest(centres: readonly { x: number; y: number }[], x: number, y: number): { x: number; y: number } | null {
  let best = null;
  let bestD = Infinity;
  for (const c of centres) {
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
