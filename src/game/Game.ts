import { BALL, BRICK, FIELD, PADDLE, RULES, SCORE } from '../config/game';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import type { StageDef } from '../levels/stages';
import { sweepBox, type SweepHit } from './collision';
import type { GameEvents, WallSide } from './events';
import type { Ball, Brick, BrickKind, GameState, Paddle, TickInput } from './types';

/** Distance a ball is pushed off a surface after a bounce, so the next sweep starts outside it. */
const SKIN = 0.01;
/** Bounces resolved per ball per tick; leftover motion is dropped (only matters in tight corners). */
const MAX_BOUNCES = 4;

const BRICK_CODES: Partial<Record<string, { kind: BrickKind; hp: number }>> = {
  '1': { kind: 'normal', hp: 1 },
  '2': { kind: 'tough', hp: 2 },
  '3': { kind: 'tough', hp: 3 },
  '#': { kind: 'steel', hp: 0 },
};

type HitTarget = Brick | WallSide | 'paddle';

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Pure simulation. Must not touch three.js, the DOM or Math.random.
 * Advanced by `update` at a fixed rate; everything observable goes out through `events`.
 */
export class Game {
  readonly events = new EventBus<GameEvents>();
  readonly paddle: Paddle = {
    x: FIELD.width / 2,
    px: FIELD.width / 2,
    y: PADDLE.y,
    w: PADDLE.width,
    h: PADDLE.height,
  };
  balls: Ball[] = [];
  bricks: Brick[] = [];
  state: GameState = 'serve';
  /** Seconds since `state` last changed. */
  stateTime = 0;
  stageIndex = 0;
  score = 0;
  lives: number = RULES.lives;
  tick = 0;

  private rng: Rng;
  private nextId = 1;
  private breakableLeft = 0;

  constructor(
    readonly seed: number,
    readonly stages: readonly StageDef[],
  ) {
    if (stages.length === 0) throw new Error('Game needs at least one stage');
    this.rng = new Rng(seed);
  }

  get stage(): StageDef {
    const stage = this.stages[this.stageIndex];
    if (!stage) throw new Error(`No stage ${this.stageIndex}`);
    return stage;
  }

  start(): void {
    this.events.emit('runStart', { seed: this.seed });
    this.loadStage(0);
  }

  update(dt: number, input: TickInput): void {
    this.tick++;
    this.stateTime += dt;
    this.paddle.px = this.paddle.x;
    for (const b of this.balls) {
      b.px = b.x;
      b.py = b.y;
    }

    switch (this.state) {
      case 'serve':
        this.movePaddle(dt, input);
        this.holdBalls();
        if (input.launch) this.launch();
        break;
      case 'play':
        this.movePaddle(dt, input);
        this.updateBalls(dt);
        break;
      case 'clear':
        if (this.stateTime >= RULES.stageClearDelay) this.nextStage();
        break;
      case 'over':
      case 'complete':
        break;
    }
  }

  private setState(state: GameState): void {
    this.state = state;
    this.stateTime = 0;
  }

  private loadStage(index: number): void {
    this.stageIndex = index;
    const stage = this.stage;
    this.bricks = parseLayout(stage.layout, () => this.nextId++);
    this.breakableLeft = this.bricks.filter((br) => br.kind !== 'steel').length;
    this.paddle.x = this.paddle.px = FIELD.width / 2;
    this.events.emit('stageStart', { stage: index + 1, name: stage.name, bricks: this.breakableLeft });
    this.serve();
  }

  private nextStage(): void {
    if (this.stageIndex + 1 < this.stages.length) {
      this.loadStage(this.stageIndex + 1);
    } else {
      this.setState('complete');
      this.events.emit('runComplete', { score: this.score });
    }
  }

  /** New ball resting on the paddle, waiting for launch. */
  private serve(): void {
    this.balls = [];
    const p = this.paddle;
    const x = p.x;
    const y = p.y + p.h / 2 + BALL.radius + SKIN;
    const ball: Ball = {
      id: this.nextId++,
      x,
      y,
      px: x,
      py: y,
      vx: 0,
      vy: 0,
      r: BALL.radius,
      speed: BALL.baseSpeed + this.stageIndex * BALL.stageSpeedStep,
    };
    this.balls.push(ball);
    this.events.emit('ballSpawn', { id: ball.id, x, y });
    this.setState('serve');
  }

  private holdBalls(): void {
    const p = this.paddle;
    for (const b of this.balls) {
      b.x = p.x;
      b.y = p.y + p.h / 2 + b.r + SKIN;
    }
  }

  private launch(): void {
    for (const b of this.balls) {
      const angle = this.rng.range(-BALL.serveJitter, BALL.serveJitter);
      b.vx = Math.sin(angle) * b.speed;
      b.vy = Math.cos(angle) * b.speed;
      this.events.emit('ballLaunch', { id: b.id, angle: (angle * 180) / Math.PI });
    }
    this.setState('play');
  }

  private movePaddle(dt: number, input: TickInput): void {
    const p = this.paddle;
    p.x = clamp(p.x + input.dx + input.axis * PADDLE.keySpeed * dt, p.w / 2, FIELD.width - p.w / 2);
  }

  private updateBalls(dt: number): void {
    for (const b of this.balls) this.moveBall(b, dt);
    if (this.bricks.some((br) => !br.alive)) this.bricks = this.bricks.filter((br) => br.alive);

    if (this.breakableLeft === 0) {
      this.balls = [];
      this.setState('clear');
      this.events.emit('stageClear', { stage: this.stageIndex + 1, score: this.score });
      return;
    }

    this.balls = this.balls.filter((b) => {
      if (b.y >= RULES.lostBallY) return true;
      this.events.emit('ballLost', { id: b.id });
      return false;
    });
    if (this.balls.length === 0) this.loseLife();
  }

  private loseLife(): void {
    this.lives--;
    this.events.emit('lifeLost', { lives: this.lives });
    if (this.lives > 0) {
      this.serve();
    } else {
      this.setState('over');
      this.events.emit('gameOver', { stage: this.stageIndex + 1, score: this.score });
    }
  }

  /** Moves a ball for one tick, resolving bounces in time order (swept, so nothing tunnels). */
  private moveBall(b: Ball, dt: number): void {
    this.rescueFromPaddle(b);
    let remaining = 1;
    for (let i = 0; i < MAX_BOUNCES && remaining > 0; i++) {
      const dx = b.vx * dt * remaining;
      const dy = b.vy * dt * remaining;

      const wall = sweepWalls(b, dx, dy);
      let hit: SweepHit | null = wall;
      let target: HitTarget | null = wall ? wall.side : null;
      for (const br of this.bricks) {
        if (!br.alive) continue;
        const h = sweepBox(b.x, b.y, dx, dy, br.x - b.r, br.y - b.r, br.x + br.w + b.r, br.y + br.h + b.r);
        if (h && (!hit || h.t < hit.t)) {
          hit = h;
          target = br;
        }
      }
      if (b.vy < 0) {
        const box = this.paddleBox(b.r);
        const h = sweepBox(b.x, b.y, dx, dy, box.minX, box.minY, box.maxX, box.maxY);
        if (h && (!hit || h.t < hit.t)) {
          hit = h;
          target = 'paddle';
        }
      }

      if (!hit || !target) {
        b.x += dx;
        b.y += dy;
        break;
      }

      b.x += dx * hit.t + hit.nx * SKIN;
      b.y += dy * hit.t + hit.ny * SKIN;
      remaining *= 1 - hit.t;
      if (hit.nx !== 0) b.vx = Math.abs(b.vx) * hit.nx;
      if (hit.ny !== 0) b.vy = Math.abs(b.vy) * hit.ny;

      if (target === 'paddle') this.paddleBounce(b, hit.ny > 0);
      else if (typeof target === 'string') this.events.emit('wallHit', { id: b.id, side: target, x: b.x, y: b.y });
      else this.hitBrick(target, b);
      normalizeVelocity(b);
    }
    b.x = clamp(b.x, b.r, FIELD.width - b.r);
    b.y = Math.min(b.y, FIELD.height - b.r);
  }

  private paddleBox(r: number): Box {
    const p = this.paddle;
    return {
      minX: p.x - p.w / 2 - r,
      minY: p.y - p.h / 2 - r,
      maxX: p.x + p.w / 2 + r,
      maxY: p.y + p.h / 2 + r,
    };
  }

  /** A fast paddle can move under a falling ball within one tick; bounce it instead of swallowing it. */
  private rescueFromPaddle(b: Ball): void {
    const box = this.paddleBox(b.r);
    if (b.vy < 0 && b.y > this.paddle.y && b.y < box.maxY && b.x > box.minX && b.x < box.maxX) {
      b.y = box.maxY + SKIN;
      this.paddleBounce(b, true);
    }
  }

  /** Top-face hits aim the ball by where it landed: centre goes straight up, edges go wide. */
  private paddleBounce(b: Ball, top: boolean): void {
    const p = this.paddle;
    const offset = clamp((b.x - p.x) / (p.w / 2), -1, 1);
    if (top) {
      const angle = offset * BALL.maxBounceAngle;
      b.vx = Math.sin(angle) * b.speed;
      b.vy = Math.cos(angle) * b.speed;
    }
    this.events.emit('paddleHit', { id: b.id, offset });
  }

  private hitBrick(br: Brick, b: Ball): void {
    br.hitTick = this.tick;
    const x = br.x + br.w / 2;
    const y = br.y + br.h / 2;
    if (br.kind === 'steel') {
      this.events.emit('brickHit', { id: br.id, kind: br.kind, hp: br.hp, x, y });
      return;
    }

    b.speed = Math.min(BALL.maxSpeed, b.speed + BALL.hitSpeedStep);
    br.hp--;
    if (br.hp > 0) {
      this.score += SCORE.hit;
      this.events.emit('brickHit', { id: br.id, kind: br.kind, hp: br.hp, x, y });
      return;
    }

    br.alive = false;
    this.breakableLeft--;
    const points = br.kind === 'tough' ? br.maxHp * SCORE.toughPerHp : SCORE.normal;
    this.score += points;
    this.events.emit('brickDestroyed', { id: br.id, kind: br.kind, points, x, y });
  }
}

function parseLayout(layout: readonly string[], nextId: () => number): Brick[] {
  const bricks: Brick[] = [];
  layout.forEach((line, row) => {
    if (line.length !== BRICK.cols) {
      throw new Error(`Stage row ${row} has ${line.length} columns, expected ${BRICK.cols}`);
    }
    for (let col = 0; col < line.length; col++) {
      const ch = line.charAt(col);
      if (ch === '.') continue;
      const code = BRICK_CODES[ch];
      if (!code) throw new Error(`Unknown brick code '${ch}' at row ${row}, col ${col}`);
      bricks.push({
        id: nextId(),
        row,
        col,
        x: col * BRICK.width,
        y: FIELD.height - BRICK.top - (row + 1) * BRICK.height,
        w: BRICK.width,
        h: BRICK.height,
        kind: code.kind,
        hp: code.hp,
        maxHp: code.hp,
        alive: true,
        hitTick: -Infinity,
      });
    }
  });
  return bricks;
}

/** Left, right and top walls as planes. The bottom is open. */
function sweepWalls(b: Ball, dx: number, dy: number): (SweepHit & { side: WallSide }) | null {
  let best: (SweepHit & { side: WallSide }) | null = null;
  if (dx < 0) {
    const t = (b.r - b.x) / dx;
    if (t <= 1) best = { t: Math.max(0, t), nx: 1, ny: 0, side: 'left' };
  } else if (dx > 0) {
    const t = (FIELD.width - b.r - b.x) / dx;
    if (t <= 1) best = { t: Math.max(0, t), nx: -1, ny: 0, side: 'right' };
  }
  if (dy > 0) {
    const t = Math.max(0, (FIELD.height - b.r - b.y) / dy);
    if (t <= 1 && (!best || t < best.t)) best = { t, nx: 0, ny: -1, side: 'top' };
  }
  return best;
}

/** Rescales velocity to the ball's speed and keeps it from going near-horizontal. */
function normalizeVelocity(b: Ball): void {
  const len = Math.hypot(b.vx, b.vy) || 1;
  let vx = (b.vx / len) * b.speed;
  let vy = (b.vy / len) * b.speed;
  const minVy = b.speed * BALL.minVerticalRatio;
  if (Math.abs(vy) < minVy) {
    vy = (vy < 0 ? -1 : 1) * minVy;
    vx = (vx < 0 ? -1 : 1) * Math.sqrt(b.speed * b.speed - minVy * minVy);
  }
  b.vx = vx;
  b.vy = vy;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
