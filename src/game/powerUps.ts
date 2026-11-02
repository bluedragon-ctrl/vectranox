import { FIELD, SCORE } from '../config/game';
import { POWER } from '../config/tuning';
import { clamp } from '../core/math';
import { sweepBox, type SweepHit } from './collision';
import type { Game } from './Game';
import { powerSeconds, splitInto } from './mods';
import { ballDirection, closer, normalizeVelocity } from './physics';
import { COMMON_POWERS, RARE_POWERS, rollPower, TIMED_POWERS } from './powers';
import type { Ball, Brick, Capsule, PowerDef, PowerKind, TickInput, TimedPower } from './types';

/** Powers that change how fast balls fly. */
const SPEED_POWERS: readonly PowerKind[] = ['slow', 'fast', 'pierce'];

/**
 * In-stage power-ups: capsules dropping and caught, the timed powers running out, and what the
 * instant ones and the laser do. The timers themselves are `Game.timers`, for the HUD.
 */
export class PowerUps {
  private laserCooldown = 0;

  constructor(private readonly game: Game) {}

  /**
   * Applies a power as if its capsule was caught. `amount` is what mods and stage events grant
   * instead of the capsule's: seconds, charges for the detonator, bricks for zap. Public so the dev console can
   * grant powers (`vnx.game.applyPower('laser')`).
   */
  apply(kind: PowerKind, amount?: number): void {
    switch (kind) {
      case 'multi':
        this.splitBalls();
        return;
      case 'life':
        this.game.lives = Math.min(POWER.maxLives, this.game.lives + 1);
        return;
      case 'detonator':
        this.chargeBalls(amount ?? POWER.kinds.detonator.charges);
        return;
      case 'zap':
        this.zapBricks(amount ?? POWER.kinds.zap.bricks);
        return;
    }
    const { duration, opposite }: PowerDef = POWER.kinds[kind];
    if (opposite && this.game.isActive(opposite)) this.end(opposite);
    this.game.timers[kind] = Math.max(this.game.timers[kind], powerSeconds(kind, amount ?? duration, this.game.mods));
    if (SPEED_POWERS.includes(kind)) this.game.rescaleBalls();
  }

  tick(dt: number): void {
    for (const kind of TIMED_POWERS) {
      if (this.game.timers[kind] <= 0) continue;
      this.game.timers[kind] -= dt;
      if (this.game.timers[kind] <= 0) this.end(kind);
    }
  }

  private end(kind: TimedPower): void {
    this.game.timers[kind] = 0;
    this.game.events.emit('powerEnd', { kind });
    if (kind === 'catch') this.game.releaseCaught();
    if (SPEED_POWERS.includes(kind)) this.game.rescaleBalls();
  }

  /** Lost life or cleared stage: timers, capsules and bolts all go. */
  clear(): void {
    for (const kind of TIMED_POWERS) this.game.timers[kind] = 0;
    this.game.capsules = [];
    this.game.bolts = [];
    this.laserCooldown = 0;
  }

  /** Launch press releases caught balls; otherwise holding fire shoots the laser. */
  handleButtons(dt: number, input: TickInput): void {
    this.laserCooldown = Math.max(0, this.laserCooldown - dt);
    if (input.launch && this.game.releaseCaught()) {
      this.laserCooldown = POWER.laserCooldown;
      return;
    }
    if (input.fire && this.game.isActive('laser') && this.laserCooldown === 0) this.fireLaser();
  }

  /** Every ball in play explodes on its next `hits` bricks; more charges than that are kept, not added to. */
  chargeBalls(hits: number): void {
    for (const b of this.game.balls) b.charges = Math.max(b.charges, hits);
  }

  private fireLaser(): void {
    const p = this.game.paddle;
    const y = p.y + p.h / 2 + POWER.boltLength;
    for (const side of [-1, 1]) {
      const x = p.x + side * (p.w / 2 - POWER.boltInset);
      this.game.bolts.push({ id: this.game.newId(), x, y, py: y, pierce: this.game.modValue('laserpierce') });
    }
    this.laserCooldown = POWER.laserCooldown;
    this.game.events.emit('laserFire', { x: p.x, y });
  }

  /**
   * Bolts fly straight up; each one damages the first brick it reaches. A piercing bolt that
   * breaks it flies on (from where it is, next tick).
   */
  updateBolts(dt: number): void {
    const dy = POWER.boltSpeed * dt;
    this.game.bolts = this.game.bolts.filter((bolt) => {
      let hit: SweepHit | null = null;
      let target: Brick | null = null;
      for (const br of this.game.bricks) {
        if (!br.alive) continue;
        // A moving brick can land on a bolt, which no sweep would catch.
        const inside = bolt.x > br.x && bolt.x < br.x + br.w && bolt.y > br.y && bolt.y < br.y + br.h;
        const h = inside ? { t: 0, nx: 0, ny: -1 } : sweepBox(bolt.x, bolt.y, 0, dy, br.x, br.y, br.x + br.w, br.y + br.h);
        if (closer(h, hit)) {
          hit = h;
          target = br;
        }
      }
      if (target) {
        this.game.hitBrick(target, 'laser', bolt.x, target.y);
        if (target.alive || bolt.pierce === 0) return false;
        bolt.pierce--;
        return true;
      }
      bolt.y += dy;
      return bolt.y - POWER.boltLength < FIELD.height;
    });
  }

  updateCapsules(dt: number): void {
    const p = this.game.paddle;
    const hw = POWER.capsuleWidth / 2;
    const hh = POWER.capsuleHeight / 2;
    this.game.capsules = this.game.capsules.filter((c) => {
      c.y -= POWER.fallSpeed * dt;
      if (Math.abs(c.x - p.x) < p.w / 2 + hw && Math.abs(c.y - p.y) < p.h / 2 + hh) {
        this.game.score += SCORE.capsule;
        this.game.events.emit('powerCollect', { id: c.id, kind: c.kind });
        this.apply(c.kind);
        return false;
      }
      if (c.y + hh >= 0) return true;
      this.game.events.emit('powerMissed', { id: c.id, kind: c.kind });
      return false;
    });
  }

  /**
   * Each source ball gets twins fanned out around its direction, `POWER.splitAngle` apart, on a
   * random side first: enough to make `POWER.splitInto` balls, plus one per extra ball mod stack.
   * Up to the ball limit.
   */
  private splitBalls(): void {
    this.game.grantMods('split');
    const twins = splitInto(this.game.mods) - 1;
    for (const src of this.game.balls.slice()) {
      const [dirX, dirY] = ballDirection(src);
      const side = this.game.rng.next() < 0.5 ? 1 : -1;
      for (let i = 0; i < twins; i++) {
        if (this.game.balls.length >= POWER.maxBalls) return;
        // +1, -1, +2, -2 steps out from the source's direction.
        this.addTwin(src, dirX, dirY, side * (i % 2 === 0 ? 1 : -1) * (Math.floor(i / 2) + 1) * POWER.splitAngle);
      }
    }
  }

  /** A copy of `src` at its position, moving along (dirX, dirY) turned by `angle`. */
  addTwin(src: Ball, dirX: number, dirY: number, angle: number, charges = src.charges): void {
    const ball: Ball = {
      ...src,
      id: this.game.newId(),
      vx: dirX * Math.cos(angle) - dirY * Math.sin(angle),
      vy: dirX * Math.sin(angle) + dirY * Math.cos(angle),
      stuck: null,
      stuckTime: 0,
      // Twins start their own chain, so a split can't multiply a long one.
      chain: 0,
      chainPoints: 0,
      inPortal: src.inPortal,
      inPad: src.inPad,
      charges,
    };
    normalizeVelocity(ball, this.game.ballSpeed(ball));
    this.game.balls.push(ball);
    this.game.events.emit('ballSpawn', { id: ball.id, x: ball.x, y: ball.y });
  }

  maybeDrop(x: number, y: number, chance = POWER.dropChance + this.game.modValue('lucky')): void {
    if (this.game.breakableLeft === 0 || this.game.capsules.length >= POWER.maxCapsules) return;
    if (this.game.rng.next() >= chance) return;
    const pool = this.game.rng.next() < POWER.rareChance ? RARE_POWERS : COMMON_POWERS;
    this.dropCapsule(rollPower(this.game.rng, pool), x, y);
  }

  dropCapsule(kind: PowerKind, x: number, y: number): void {
    const hw = POWER.capsuleWidth / 2;
    const capsule: Capsule = { id: this.game.newId(), kind, x: clamp(x, hw, FIELD.width - hw), y, py: y };
    this.game.capsules.push(capsule);
    this.game.events.emit('powerDrop', { id: capsule.id, kind, x: capsule.x, y });
  }

  /** Up to `count` random normal bricks turn explosive and flash; one hit now breaks them. */
  private zapBricks(count: number): void {
    const bricks = this.game.bricks.filter((br) => br.alive && br.kind === 'normal' && !br.falling);
    for (let i = 0; i < count && bricks.length > 0; i++) {
      const [br] = bricks.splice(Math.floor(this.game.rng.next() * bricks.length), 1);
      if (!br) break;
      br.kind = 'explosive';
      br.hp = br.maxHp = 1;
      br.hitTick = this.game.tick;
    }
  }
}
