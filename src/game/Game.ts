import { FIELD } from '../config/game';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import type { GameEvents, WallSide } from './events';

export interface Ball {
  id: number;
  x: number;
  y: number;
  /** Position at the previous tick, for render interpolation. */
  px: number;
  py: number;
  vx: number;
  vy: number;
  r: number;
}

/**
 * Pure simulation. Must not touch three.js, the DOM or Math.random.
 * Phase 0: a few balls bouncing inside the field to exercise loop, events and renderer.
 */
export class Game {
  readonly events = new EventBus<GameEvents>();
  readonly balls: Ball[] = [];
  tick = 0;

  private rng: Rng;
  private nextId = 1;

  constructor(readonly seed: number) {
    this.rng = new Rng(seed);
  }

  start(): void {
    this.events.emit('runStart', { seed: this.seed });
    for (let i = 0; i < 3; i++) this.spawnBall();
  }

  update(dt: number): void {
    this.tick++;
    for (const b of this.balls) {
      b.px = b.x;
      b.py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      this.bounce(b);
    }
  }

  private spawnBall(): void {
    const angle = this.rng.range(Math.PI * 0.2, Math.PI * 0.8);
    const speed = this.rng.range(160, 240);
    const x = FIELD.width / 2;
    const y = FIELD.height * 0.25;
    const ball: Ball = {
      id: this.nextId++,
      x,
      y,
      px: x,
      py: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 5,
    };
    this.balls.push(ball);
    this.events.emit('ballSpawn', { id: ball.id, x, y });
  }

  private bounce(b: Ball): void {
    let side: WallSide | null = null;
    if (b.x - b.r < 0) {
      b.x = b.r;
      b.vx = Math.abs(b.vx);
      side = 'left';
    } else if (b.x + b.r > FIELD.width) {
      b.x = FIELD.width - b.r;
      b.vx = -Math.abs(b.vx);
      side = 'right';
    }
    if (b.y - b.r < 0) {
      b.y = b.r;
      b.vy = Math.abs(b.vy);
      side = 'bottom';
    } else if (b.y + b.r > FIELD.height) {
      b.y = FIELD.height - b.r;
      b.vy = -Math.abs(b.vy);
      side = 'top';
    }
    if (side) this.events.emit('wallHit', { id: b.id, side, x: b.x, y: b.y });
  }
}
