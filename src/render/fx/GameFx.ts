import * as THREE from 'three';
import { FIELD } from '../../config/game';
import { POWER_LOOK } from '../../config/tuning';
import type { Game } from '../../game/Game';
import { BRICK_GAP, brickTint, COLORS } from '../palette';
import { chip, fractureRect } from './fracture';
import { Particles } from './Particles';
import { Shake } from './Shake';
import type { Trails } from './Trails';

const WALL_HIT_SLOTS = 8;
/** Share of the ball's velocity that shattered glass inherits. */
const PIECE_PUSH = 0.12;
/** Upward push on glass shattered by a laser bolt. */
const LASER_PUSH = 45;
/** Outward push on glass shattered by a detonator blast. */
const BLAST_PUSH = 60;
const BLAST_COLOR = new THREE.Color(POWER_LOOK.detonator.color);

export interface WallHit {
  x: number;
  y: number;
  strength: number;
}

/**
 * Turns simulation events into cosmetic effects: shake, flashes and pulses. Particles are
 * reserved for damage (brick hits and destruction).
 * Reads game state only to place effects (ball and brick positions); never writes to it.
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
  /** Last detonator blast: a single ring that grows to the blast radius and fades. */
  readonly blast = { x: 0, y: 0, radius: 0, strength: 0 };
  /** Brick hit-flash strength, lowered by reduce-flashing. */
  brickFlash = 1;

  private reduce = false;
  private nextWallHit = 0;
  private time = 0;
  private game: Game | null = null;
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
    this.blast.strength = Math.max(0, this.blast.strength - dt * 4);
    for (const h of this.wallHits) h.strength = Math.max(0, h.strength - dt * 3);
    this.particles.update(dt);
    this.shake.update(dt);
  }

  attach(game: Game): void {
    this.unsubscribe.forEach((off) => off());
    this.game = game;
    this.particles.clear();
    this.trails.clear();
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
      ev.on('laserFire', () => {
        this.laserFlash = 1;
      }),
      ev.on('detonate', ({ x, y, radius }) => {
        Object.assign(this.blast, { x, y, radius, strength: 1 });
        this.shake.add(0.3);
        this.pulse(BLAST_COLOR, 0.08, 0.3);
      }),
      ev.on('brickHit', ({ id, kind, by, x, y, ix, iy }) => {
        const brick = game.bricks.find((br) => br.id === id);
        const away = Math.atan2(iy - y, ix - x);
        if (kind === 'steel') {
          // Metal on metal: hot sparks, nothing breaks.
          this.particles.sparks(ix, iy, { count: 10, color: COLORS.white, speed: [70, 220], angle: away, spread: 1.1 });
          this.shake.add(0.06);
          return;
        }
        // Glass that holds: a few chips and glints fly off where the ball struck.
        const color = brick ? brickTint(brick, this.tint) : this.tint.copy(COLORS.yellow);
        for (let i = 0; i < 3; i++) {
          const a = away + (Math.random() * 2 - 1) * 1.1;
          const s = 40 + Math.random() * 80;
          this.particles.piece(chip(ix, iy, 0.9 + Math.random() * 0.8), Math.cos(a) * s, Math.sin(a) * s, color, 0.35 + Math.random() * 0.25);
        }
        this.particles.glints(ix, iy, { count: 4, color, speed: [100, 220], angle: away, spread: 1.0 });
        this.shake.add(by === 'pulse' || by === 'blast' ? 0 : 0.04);
      }),
      ev.on('brickDestroyed', ({ id, kind, by, x, y, ix, iy }) => {
        const brick = game.bricks.find((br) => br.id === id);
        const color = brick ? brickTint({ ...brick, hp: brick.maxHp }, this.tint) : this.tint.copy(COLORS.magenta);
        const w = (brick?.w ?? 24) - BRICK_GAP;
        const h = (brick?.h ?? 12) - BRICK_GAP;
        const ball = by === 'ball' ? this.nearestBall(x, y) : null;
        let pushX = (ball?.vx ?? 0) * PIECE_PUSH;
        let pushY = by === 'laser' ? LASER_PUSH : (ball?.vy ?? 0) * PIECE_PUSH;
        if (by === 'blast') {
          const d = Math.hypot(x - this.blast.x, y - this.blast.y) || 1;
          pushX = ((x - this.blast.x) / d) * BLAST_PUSH;
          pushY = ((y - this.blast.y) / d) * BLAST_PUSH;
        }
        // The brick breaks into pieces radiating from the impact; tough glass breaks finer.
        for (const s of fractureRect(x, y, w, h, ix, iy, kind === 'tough' ? 5 : 2)) {
          const dx = s.cx - ix;
          const dy = s.cy - iy;
          const dist = Math.hypot(dx, dy) || 1;
          const speed = (35 + Math.random() * 60) * (1.3 - Math.min(dist / (w * 0.5), 1) * 0.6);
          this.particles.piece(s, (dx / dist) * speed + pushX, (dy / dist) * speed + pushY, color, 0.55 + Math.random() * 0.35);
        }
        this.particles.glints(ix, iy, { count: 5, color, speed: [120, 260] });
        // A pulse or blast breaks many bricks in one tick; its own kick stands in for theirs.
        if (by !== 'pulse' && by !== 'blast') this.shake.add(kind === 'tough' ? 0.16 : 0.1);
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

  private nearestBall(x: number, y: number) {
    let best = null;
    let bestD = Infinity;
    for (const b of this.game?.balls ?? []) {
      const d = (b.x - x) ** 2 + (b.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }
}
