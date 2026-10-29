import { BALL, BRICK, FIELD, PADDLE, RULES, SCORE } from '../config/game';
import { POWER, POWER_LOOK, STAGE_EVENTS } from '../config/tuning';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import type { StageDef } from '../levels/stages';
import { sweepBox, type SweepHit } from './collision';
import type { GameEvents, WallSide } from './events';
import type {
  Ball,
  Bolt,
  Brick,
  BrickKind,
  Capsule,
  ChargePower,
  GameState,
  HitSource,
  Paddle,
  PowerKind,
  StageEventKind,
  TickInput,
  TimedPower,
} from './types';

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

const POWER_KINDS = Object.keys(POWER.kinds) as PowerKind[];
const TIMED_POWERS = POWER_KINDS.filter((k): k is TimedPower => POWER.kinds[k].duration > 0);
const CHARGE_POWERS: readonly ChargePower[] = ['detonator'];
/** Picking one of these ends the other. */
const OPPOSITE: Partial<Record<TimedPower, TimedPower>> = { expand: 'narrow', narrow: 'expand', slow: 'fast', fast: 'slow' };
const GOOD_POWERS = POWER_KINDS.filter((k) => !POWER_LOOK[k].bad);
const STAGE_EVENT_KINDS = Object.keys(STAGE_EVENTS.kinds) as StageEventKind[];

type HitTarget = Brick | WallSide | 'paddle' | 'barrier';

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
  capsules: Capsule[] = [];
  bolts: Bolt[] = [];
  /** Seconds left on each timed power; 0 is off. */
  readonly timers = Object.fromEntries(TIMED_POWERS.map((k) => [k, 0])) as Record<TimedPower, number>;
  /** Charges held for each charge power, spent by the alt button. */
  readonly charges = Object.fromEntries(CHARGE_POWERS.map((k) => [k, 0])) as Record<ChargePower, number>;
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
  private laserCooldown = 0;
  /** Seconds of play since a breakable brick was last hit / destroyed. */
  private sinceHit = 0;
  private sinceKill = 0;
  /** Per stage: whether each stage event's trigger is armed, and how often it fired. */
  private readonly eventArmed = {} as Record<StageEventKind, boolean>;
  private readonly eventCount = {} as Record<StageEventKind, number>;

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
    for (const c of this.capsules) c.py = c.y;
    for (const bolt of this.bolts) bolt.py = bolt.y;

    switch (this.state) {
      case 'serve':
        this.movePaddle(dt, input);
        this.holdBalls();
        if (input.launch) this.launch();
        break;
      case 'play':
        this.movePaddle(dt, input);
        this.tickPowers(dt);
        this.handleButtons(dt, input);
        this.updateBalls(dt);
        this.updateBolts(dt);
        this.updateCapsules(dt);
        this.resolveStage();
        if (this.state === 'play') this.checkStageEvents(dt);
        break;
      case 'clear':
        if (this.stateTime >= RULES.stageClearDelay) this.nextStage();
        break;
      case 'over':
      case 'complete':
        break;
    }
  }

  isActive(kind: TimedPower): boolean {
    return this.timers[kind] > 0;
  }

  /**
   * Applies a power as if its capsule was caught. Public so the dev console can grant powers
   * (`vnx.game.applyPower('laser')`).
   */
  applyPower(kind: PowerKind, duration: number = POWER.kinds[kind].duration): void {
    switch (kind) {
      case 'multi':
        this.splitBalls();
        return;
      case 'life':
        this.lives = Math.min(POWER.maxLives, this.lives + 1);
        return;
      case 'detonator':
        this.addCharges('detonator', this.charges.detonator > 0 ? POWER.detonator.recharge : POWER.detonator.charges);
        return;
    }
    const opposite = OPPOSITE[kind];
    if (opposite && this.isActive(opposite)) this.endPower(opposite);
    this.timers[kind] = duration;
    if (kind === 'slow' || kind === 'fast') this.rescaleBalls();
  }

  /**
   * Runs a stage event's effect right away, skipping its trigger and chance. Public so the dev
   * console can try them (`vnx.game.fireStageEvent('overload')`).
   */
  fireStageEvent(kind: StageEventKind): void {
    this.eventCount[kind]++;
    this.events.emit('stageEvent', { kind, bricks: this.breakableLeft });
    switch (kind) {
      case 'supplyDrop': {
        const bricks = this.bricks.filter((br) => br.alive && br.kind !== 'steel');
        const br = bricks[Math.floor(this.rng.next() * bricks.length)];
        if (br) this.dropCapsule(this.rollPower(GOOD_POWERS), br.x + br.w / 2, br.y + br.h / 2);
        break;
      }
      case 'overload':
        this.splitBalls();
        break;
      case 'pulse':
        this.pulseBricks(STAGE_EVENTS.kinds.pulse.maxBricks, STAGE_EVENTS.kinds.pulse.damage);
        break;
      case 'hunter':
        this.applyPower('laser', STAGE_EVENTS.kinds.hunter.duration);
        break;
      case 'safetyNet':
        this.applyPower('barrier', STAGE_EVENTS.kinds.safetyNet.duration);
        break;
      case 'demolition':
        this.addCharges('detonator', STAGE_EVENTS.kinds.demolition.charges);
        break;
    }
  }

  /** The balls an alt press would detonate: all of them, or only the highest (see `POWER.detonator`). */
  blastBalls(): Ball[] {
    if (POWER.detonator.target === 'all') return this.balls;
    let best: Ball | null = null;
    for (const b of this.balls) if (!best || b.y > best.y) best = b;
    return best ? [best] : [];
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
    this.paddle.w = PADDLE.width;
    for (const kind of STAGE_EVENT_KINDS) {
      this.eventArmed[kind] = true;
      this.eventCount[kind] = 0;
    }
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

  /** New ball resting on the paddle, waiting for launch. Powers don't survive a lost life. */
  private serve(): void {
    this.balls = [];
    this.clearPowers();
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
      stuck: null,
      stuckTime: 0,
    };
    this.balls.push(ball);
    this.events.emit('ballSpawn', { id: ball.id, x, y });
    this.sinceHit = this.sinceKill = 0;
    this.eventArmed.safetyNet = true;
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
      aim(b, angle, this.ballSpeed(b));
      this.events.emit('ballLaunch', { id: b.id, angle: (angle * 180) / Math.PI });
    }
    this.setState('play');
    const net = STAGE_EVENTS.kinds.safetyNet;
    if (this.lives <= net.lives && this.breakableLeft <= net.bricksLeft) this.tryStageEvent('safetyNet');
  }

  /** Runs every play tick, after the stage was resolved. Triggers for the ongoing events. */
  private checkStageEvents(dt: number): void {
    this.sinceHit += dt;
    this.sinceKill += dt;
    const { supplyDrop, overload, pulse, hunter, demolition } = STAGE_EVENTS.kinds;
    const left = this.breakableLeft;
    if (left <= supplyDrop.bricksLeft) this.tryStageEvent('supplyDrop');
    if (left <= demolition.bricksLeft) this.tryStageEvent('demolition');
    if (left <= overload.bricksLeft) this.tryStageEvent('overload');
    if (this.sinceHit >= pulse.idleTime) this.tryStageEvent('pulse');
    if (left <= hunter.bricksLeft && this.sinceKill >= hunter.idleTime) this.tryStageEvent('hunter');
  }

  /** Trigger met: roll the event's chance once, then wait for it to re-arm. */
  private tryStageEvent(kind: StageEventKind): void {
    const def = STAGE_EVENTS.kinds[kind];
    if (!this.eventArmed[kind] || this.eventCount[kind] >= def.maxPerStage) return;
    this.eventArmed[kind] = false;
    if (this.rng.next() < def.chance) this.fireStageEvent(kind);
  }

  private movePaddle(dt: number, input: TickInput): void {
    const p = this.paddle;
    const scale = this.isActive('expand') ? POWER.expandScale : this.isActive('narrow') ? POWER.narrowScale : 1;
    const target = PADDLE.width * scale;
    p.w += (target - p.w) * Math.min(1, POWER.widthRate * dt);
    if (Math.abs(target - p.w) < 0.01) p.w = target;
    p.x = clamp(p.x + input.dx + input.axis * PADDLE.keySpeed * dt, p.w / 2, FIELD.width - p.w / 2);
  }

  private updateBalls(dt: number): void {
    for (const b of this.balls) {
      if (b.stuck !== null) this.holdCaught(b, dt);
      else this.moveBall(b, dt);
    }
  }

  /** After everything moved: drop broken bricks, then check for a cleared stage or a lost life. */
  private resolveStage(): void {
    if (this.bricks.some((br) => !br.alive)) this.bricks = this.bricks.filter((br) => br.alive);

    if (this.breakableLeft === 0) {
      this.balls = [];
      this.clearPowers();
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
    if (b.stuck !== null) return;
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
      if (dy < 0 && this.isActive('barrier')) {
        const floor = POWER.barrierY + b.r;
        if (b.y >= floor) {
          const t = (floor - b.y) / dy;
          if (t <= 1 && (!hit || t < hit.t)) {
            hit = { t, nx: 0, ny: 1 };
            target = 'barrier';
          }
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

      // Piercing balls go straight through anything breakable.
      if (typeof target === 'object' && target.kind !== 'steel' && this.isActive('pierce')) {
        b.x += dx * hit.t;
        b.y += dy * hit.t;
        remaining *= 1 - hit.t;
        this.ballHitsBrick(target, b, true);
        normalizeVelocity(b, this.ballSpeed(b));
        continue;
      }

      b.x += dx * hit.t + hit.nx * SKIN;
      b.y += dy * hit.t + hit.ny * SKIN;
      remaining *= 1 - hit.t;
      if (hit.nx !== 0) b.vx = Math.abs(b.vx) * hit.nx;
      if (hit.ny !== 0) b.vy = Math.abs(b.vy) * hit.ny;

      if (target === 'paddle') {
        if (this.paddleContact(b, hit.ny > 0)) return;
      } else if (target === 'barrier') this.events.emit('barrierHit', { id: b.id, x: b.x });
      else if (typeof target === 'string') this.events.emit('wallHit', { id: b.id, side: target, x: b.x, y: b.y });
      else this.ballHitsBrick(target, b, false);
      normalizeVelocity(b, this.ballSpeed(b));
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
      this.paddleContact(b, true);
    }
  }

  /**
   * Top-face hits aim the ball by where it landed: centre goes straight up, edges go wide.
   * With catch active the ball sticks instead; returns true when it was caught.
   */
  private paddleContact(b: Ball, top: boolean): boolean {
    const p = this.paddle;
    const offset = clamp((b.x - p.x) / (p.w / 2), -1, 1);
    if (top && this.isActive('catch')) {
      b.stuck = clamp(offset, -0.9, 0.9);
      b.stuckTime = 0;
      b.vx = b.vy = 0;
      this.holdCaught(b, 0);
      this.events.emit('ballCaught', { id: b.id, offset: b.stuck });
      return true;
    }
    if (top) aim(b, offset * BALL.maxBounceAngle, this.ballSpeed(b));
    this.events.emit('paddleHit', { id: b.id, offset });
    return false;
  }


  /** Keeps a caught ball on the paddle; it lets go by itself after a while. */
  private holdCaught(b: Ball, dt: number): void {
    const p = this.paddle;
    b.stuckTime += dt;
    b.x = p.x + (b.stuck ?? 0) * (p.w / 2);
    b.y = p.y + p.h / 2 + b.r + SKIN;
    if (b.stuckTime >= POWER.catchHold) this.release(b);
  }

  private release(b: Ball): void {
    const angle = (b.stuck ?? 0) * BALL.maxBounceAngle;
    b.stuck = null;
    aim(b, angle, this.ballSpeed(b));
    this.events.emit('ballLaunch', { id: b.id, angle: (angle * 180) / Math.PI });
  }

  /** Releases every caught ball; returns whether there were any. */
  private releaseCaught(): boolean {
    let any = false;
    for (const b of this.balls) {
      if (b.stuck === null) continue;
      this.release(b);
      any = true;
    }
    return any;
  }

  private ballSpeed(b: Ball): number {
    const scale = this.isActive('slow') ? POWER.slowScale : this.isActive('fast') ? POWER.fastScale : 1;
    return b.speed * scale;
  }

  /** Brings moving balls to their current speed after slow/fast changes. */
  private rescaleBalls(): void {
    for (const b of this.balls) if (b.vx !== 0 || b.vy !== 0) normalizeVelocity(b, this.ballSpeed(b));
  }

  private tickPowers(dt: number): void {
    for (const kind of TIMED_POWERS) {
      if (this.timers[kind] <= 0) continue;
      this.timers[kind] -= dt;
      if (this.timers[kind] <= 0) this.endPower(kind);
    }
  }

  private endPower(kind: TimedPower): void {
    this.timers[kind] = 0;
    this.events.emit('powerEnd', { kind });
    if (kind === 'catch') this.releaseCaught();
    if (kind === 'slow' || kind === 'fast') this.rescaleBalls();
  }

  /** Lost life or cleared stage: timers, charges, capsules and bolts all go. */
  private clearPowers(): void {
    for (const kind of TIMED_POWERS) this.timers[kind] = 0;
    for (const kind of CHARGE_POWERS) this.charges[kind] = 0;
    this.capsules = [];
    this.bolts = [];
    this.laserCooldown = 0;
  }

  /**
   * Launch press releases caught balls; otherwise holding fire shoots the laser.
   * Alt press spends a detonator charge (with none held it does nothing).
   */
  private handleButtons(dt: number, input: TickInput): void {
    this.laserCooldown = Math.max(0, this.laserCooldown - dt);
    if (input.alt && this.charges.detonator > 0) this.detonate();
    if (input.launch && this.releaseCaught()) {
      this.laserCooldown = POWER.laserCooldown;
      return;
    }
    if (input.fire && this.isActive('laser') && this.laserCooldown === 0) this.fireLaser();
  }

  private addCharges(kind: ChargePower, n: number): void {
    this.charges[kind] = Math.min(POWER[kind].maxCharges, this.charges[kind] + n);
  }

  /**
   * The blast balls explode; breakable bricks in reach of any of them take damage once, struck
   * from the nearest blast. The balls fly on.
   */
  private detonate(): void {
    const balls = this.blastBalls();
    if (balls.length === 0) return;
    this.charges.detonator--;
    const { radius, damage } = POWER.detonator;
    const targets: { br: Brick; ix: number; iy: number }[] = [];
    for (const br of this.bricks) {
      if (!br.alive || br.kind === 'steel') continue;
      let best: { br: Brick; ix: number; iy: number } | null = null;
      let bestD = radius * radius;
      for (const b of balls) {
        const ix = clamp(b.x, br.x, br.x + br.w);
        const iy = clamp(b.y, br.y, br.y + br.h);
        const d = (ix - b.x) ** 2 + (iy - b.y) ** 2;
        if (d <= bestD) {
          best = { br, ix, iy };
          bestD = d;
        }
      }
      if (best) targets.push(best);
    }
    this.events.emit('detonate', { balls: balls.length, radius, bricks: targets.length, charges: this.charges.detonator });
    for (const { br, ix, iy } of targets) {
      for (let i = 0; i < damage && br.alive; i++) this.hitBrick(br, 'blast', ix, iy, false);
    }
  }

  private fireLaser(): void {
    const p = this.paddle;
    const y = p.y + p.h / 2 + POWER.boltLength;
    for (const side of [-1, 1]) {
      const x = p.x + side * (p.w / 2 - POWER.boltInset);
      this.bolts.push({ id: this.nextId++, x, y, py: y });
    }
    this.laserCooldown = POWER.laserCooldown;
    this.events.emit('laserFire', { x: p.x, y });
  }

  /** Bolts fly straight up; each one damages the first brick it reaches. */
  private updateBolts(dt: number): void {
    const dy = POWER.boltSpeed * dt;
    this.bolts = this.bolts.filter((bolt) => {
      let hit: SweepHit | null = null;
      let target: Brick | null = null;
      for (const br of this.bricks) {
        if (!br.alive) continue;
        const h = sweepBox(bolt.x, bolt.y, 0, dy, br.x, br.y, br.x + br.w, br.y + br.h);
        if (h && (!hit || h.t < hit.t)) {
          hit = h;
          target = br;
        }
      }
      if (target) {
        this.hitBrick(target, 'laser', bolt.x, target.y, false);
        return false;
      }
      bolt.y += dy;
      return bolt.y - POWER.boltLength < FIELD.height;
    });
  }

  private updateCapsules(dt: number): void {
    const p = this.paddle;
    const hw = POWER.capsuleWidth / 2;
    const hh = POWER.capsuleHeight / 2;
    this.capsules = this.capsules.filter((c) => {
      c.y -= POWER.fallSpeed * dt;
      if (Math.abs(c.x - p.x) < p.w / 2 + hw && Math.abs(c.y - p.y) < p.h / 2 + hh) {
        this.score += SCORE.capsule;
        this.events.emit('powerCollect', { id: c.id, kind: c.kind });
        this.applyPower(c.kind);
        return false;
      }
      if (c.y + hh >= 0) return true;
      this.events.emit('powerMissed', { id: c.id, kind: c.kind });
      return false;
    });
  }

  /** Each source ball gets a twin on either side, up to the ball limit. */
  private splitBalls(): void {
    for (const src of this.balls.slice()) {
      let dirX = src.vx;
      let dirY = src.vy;
      if (src.stuck !== null) {
        const a = src.stuck * BALL.maxBounceAngle;
        dirX = Math.sin(a);
        dirY = Math.cos(a);
      } else if (dirX === 0 && dirY === 0) {
        dirY = 1;
      }
      for (const side of [-1, 1]) {
        if (this.balls.length >= POWER.maxBalls) return;
        const a = side * POWER.splitAngle;
        const ball: Ball = {
          ...src,
          id: this.nextId++,
          vx: dirX * Math.cos(a) - dirY * Math.sin(a),
          vy: dirX * Math.sin(a) + dirY * Math.cos(a),
          stuck: null,
          stuckTime: 0,
        };
        normalizeVelocity(ball, this.ballSpeed(ball));
        this.balls.push(ball);
        this.events.emit('ballSpawn', { id: ball.id, x: ball.x, y: ball.y });
      }
    }
  }

  private maybeDrop(x: number, y: number): void {
    if (this.breakableLeft === 0 || this.capsules.length >= POWER.maxCapsules) return;
    if (this.rng.next() >= POWER.dropChance) return;
    this.dropCapsule(this.rollPower(POWER_KINDS), x, y);
  }

  private dropCapsule(kind: PowerKind, x: number, y: number): void {
    const hw = POWER.capsuleWidth / 2;
    const capsule: Capsule = { id: this.nextId++, kind, x: clamp(x, hw, FIELD.width - hw), y, py: y };
    this.capsules.push(capsule);
    this.events.emit('powerDrop', { id: capsule.id, kind, x: capsule.x, y });
  }

  /** Weighted pick among `kinds`. */
  private rollPower(kinds: readonly PowerKind[]): PowerKind {
    const total = kinds.reduce((sum, k) => sum + POWER.kinds[k].weight, 0);
    let r = this.rng.next() * total;
    for (const k of kinds) {
      r -= POWER.kinds[k].weight;
      if (r < 0) return k;
    }
    return 'multi';
  }

  /** The lowest `count` breakable bricks take `damage` hits each, struck from below. */
  private pulseBricks(count: number, damage: number): void {
    const targets = this.bricks
      .filter((br) => br.alive && br.kind !== 'steel')
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .slice(0, count);
    for (const br of targets) {
      for (let i = 0; i < damage && br.alive; i++) this.hitBrick(br, 'pulse', br.x + br.w / 2, br.y, false);
    }
  }

  /** Ball struck a brick; it speeds up a little. `smash` breaks it outright (pierce). */
  private ballHitsBrick(br: Brick, b: Ball, smash: boolean): void {
    if (br.kind !== 'steel') b.speed = Math.min(BALL.maxSpeed, b.speed + BALL.hitSpeedStep);
    this.hitBrick(br, 'ball', clamp(b.x, br.x, br.x + br.w), clamp(b.y, br.y, br.y + br.h), smash);
  }

  /** (ix, iy) is the impact point on the brick. */
  private hitBrick(br: Brick, by: HitSource, ix: number, iy: number, smash: boolean): void {
    br.hitTick = this.tick;
    const x = br.x + br.w / 2;
    const y = br.y + br.h / 2;
    if (br.kind === 'steel') {
      this.events.emit('brickHit', { id: br.id, kind: br.kind, hp: br.hp, by, x, y, ix, iy });
      return;
    }

    this.sinceHit = 0;
    this.eventArmed.pulse = true;
    br.hp = smash ? 0 : br.hp - 1;
    if (br.hp > 0) {
      this.score += SCORE.hit;
      this.events.emit('brickHit', { id: br.id, kind: br.kind, hp: br.hp, by, x, y, ix, iy });
      return;
    }

    br.alive = false;
    this.breakableLeft--;
    this.sinceKill = 0;
    this.eventArmed.supplyDrop = this.eventArmed.overload = this.eventArmed.hunter = this.eventArmed.demolition = true;
    const points = br.kind === 'tough' ? br.maxHp * SCORE.toughPerHp : SCORE.normal;
    this.score += points;
    this.events.emit('brickDestroyed', { id: br.id, kind: br.kind, points, by, x, y, ix, iy });
    this.maybeDrop(x, y);
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

/** Sends a ball off at `angle` from vertical (positive is right). */
function aim(b: Ball, angle: number, speed: number): void {
  b.vx = Math.sin(angle) * speed;
  b.vy = Math.cos(angle) * speed;
}

/** Rescales velocity to `speed` and keeps it from going near-horizontal. */
function normalizeVelocity(b: Ball, speed: number): void {
  const len = Math.hypot(b.vx, b.vy) || 1;
  let vx = (b.vx / len) * speed;
  let vy = (b.vy / len) * speed;
  const minVy = speed * BALL.minVerticalRatio;
  if (Math.abs(vy) < minVy) {
    vy = (vy < 0 ? -1 : 1) * minVy;
    vx = (vx < 0 ? -1 : 1) * Math.sqrt(speed * speed - minVy * minVy);
  }
  b.vx = vx;
  b.vy = vy;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
