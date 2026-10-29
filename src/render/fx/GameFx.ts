import * as THREE from 'three';
import { FIELD } from '../../config/game';
import type { Game } from '../../game/Game';
import type { WallSide } from '../../game/events';
import { brickTint, COLORS } from '../palette';
import { Particles } from './Particles';
import { Shake } from './Shake';
import type { Trails } from './Trails';

const WALL_HIT_SLOTS = 8;
const WALL_SPARK_ANGLE: Record<WallSide, number> = { left: 0, right: Math.PI, top: -Math.PI / 2 };

export interface WallHit {
  x: number;
  y: number;
  strength: number;
}

/**
 * Turns simulation events into cosmetic effects: particles, shake, flashes and pulses.
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
    this.particles.glowScale = reduce ? 0.35 : 1;
    this.brickFlash = reduce ? 0.3 : 1;
    if (reduce) this.flash = this.aberration = 0;
  }

  update(dt: number): void {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.aberration = Math.max(0, this.aberration - dt * 1.8);
    this.danger = Math.max(0, this.danger - dt * 1.1);
    this.paddlePulse = Math.max(0, this.paddlePulse - dt * 4);
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
      ev.on('ballSpawn', ({ x, y }) => {
        this.particles.glow(x, y, 6, 18, 0.35, COLORS.cyan, 0.4);
        this.particles.ring(x, y, 2, 12, 0.3, COLORS.cyan, 0.6);
      }),
      ev.on('ballLaunch', ({ id }) => {
        const ball = this.ball(id);
        if (!ball) return;
        this.particles.ring(ball.x, ball.y, 3, 14, 0.3, COLORS.cyan, 0.5);
        this.particles.sparks(ball.x, ball.y - ball.r, { count: 8, color: COLORS.cyan, speed: [60, 140], angle: -Math.PI / 2, spread: 1.1 });
      }),
      ev.on('wallHit', ({ side, x, y }) => {
        const px = side === 'left' ? 0 : side === 'right' ? FIELD.width : x;
        const py = side === 'top' ? FIELD.height : y;
        const slot = this.wallHits[this.nextWallHit];
        this.nextWallHit = (this.nextWallHit + 1) % WALL_HIT_SLOTS;
        if (slot) Object.assign(slot, { x: px, y: py, strength: 1 });
        this.particles.sparks(px, py, { count: 6, color: COLORS.cyan, speed: [50, 150], angle: WALL_SPARK_ANGLE[side], spread: 1.0 });
      }),
      ev.on('paddleHit', ({ id, offset }) => {
        this.paddlePulse = 1;
        this.paddleHitOffset = offset;
        const ball = this.ball(id);
        if (!ball) return;
        this.particles.sparks(ball.x, ball.y - ball.r, { count: 9, color: COLORS.cyan, speed: [60, 180], angle: Math.PI / 2, spread: 0.9 });
        this.particles.glow(ball.x, ball.y - ball.r, 6, 14, 0.12, COLORS.white, 0.25);
      }),
      ev.on('brickHit', ({ id, kind, x, y }) => {
        const brick = game.bricks.find((br) => br.id === id);
        const ball = this.nearestBall(x, y);
        const ix = ball?.x ?? x;
        const iy = ball?.y ?? y;
        const color = brick ? brickTint(brick, this.tint) : this.tint.copy(COLORS.white);
        const steel = kind === 'steel';
        this.particles.sparks(ix, iy, {
          count: steel ? 10 : 7,
          color: steel ? COLORS.white : color,
          speed: [70, steel ? 220 : 170],
          angle: Math.atan2(iy - y, ix - x),
          spread: 1.1,
        });
        this.shake.add(steel ? 0.06 : 0.04);
      }),
      ev.on('brickDestroyed', ({ id, kind, x, y }) => {
        const brick = game.bricks.find((br) => br.id === id);
        const color = brick ? brickTint({ ...brick, hp: brick.maxHp }, this.tint) : this.tint.copy(COLORS.magenta);
        const w = brick?.w ?? 24;
        const h = brick?.h ?? 12;
        this.particles.shards(x, y, w * 0.8, h * 0.6, { count: 10, color, speed: [30, 140], angle: Math.PI / 2, spread: Math.PI * 0.9 });
        this.particles.sparks(x, y, { count: 12, color, speed: [80, 260] });
        this.shake.add(kind === 'tough' ? 0.16 : 0.1);
      }),
      ev.on('ballLost', ({ id }) => {
        const ball = this.ball(id) ?? this.trails.last(id);
        const x = Math.min(FIELD.width, Math.max(0, ball?.x ?? FIELD.width / 2));
        this.particles.sparks(x, 0, { count: 22, color: COLORS.magenta, speed: [80, 260], angle: Math.PI / 2, spread: 0.7, gravity: -260 });
        this.particles.ring(x, 0, 4, 40, 0.5, COLORS.magenta);
        this.shake.add(0.3);
      }),
      ev.on('lifeLost', () => {
        this.shake.add(0.55);
        this.pulse(COLORS.magenta, 0.3, 1);
        this.danger = 1;
      }),
      ev.on('stageClear', () => {
        this.particles.ring(FIELD.width / 2, FIELD.height / 2, 10, 280, 0.9, COLORS.cyan);
        this.shake.add(0.2);
        this.pulse(COLORS.cyan, 0.15, 0.5);
      }),
      ev.on('gameOver', () => {
        this.pulse(COLORS.magenta, 0.2, 1);
        this.danger = 1;
      }),
      ev.on('runComplete', () => {
        this.particles.ring(FIELD.width / 2, FIELD.height / 2, 10, 320, 1.2, COLORS.yellow);
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

  private ball(id: number) {
    return this.game?.balls.find((b) => b.id === id);
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
