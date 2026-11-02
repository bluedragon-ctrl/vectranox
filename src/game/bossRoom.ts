import { BALL, BRICK, FIELD, RULES, SCORE } from '../config/game';
import { LASERPIERCE_CORE } from '../config/mods';
import { BOSS } from '../config/tuning';
import { clamp } from '../core/math';
import type { BossFight } from './boss';
import { sweepBox, type SweepHit } from './collision';
import type { Game } from './Game';
import { aim, bounceFlat, closer, MAX_BOUNCES, normalizeVelocity, SKIN, sweepRect, sweepWalls } from './physics';
import type { Brick, EmitterKind, HitSource, ShadowBall } from './types';

/**
 * What happens in boss rooms: the emitters (turrets, spawners, phantoms) and what they send out,
 * which challenge rooms can have too, and the core's phases up to the kill. The phases themselves
 * are kept by `BossFight`, the emitters' turns by `Emitters`.
 */
export class BossRoom {
  constructor(private readonly game: Game) {}

  /** Falling bricks come down like formations do, ahead of the balls; `resolveStage` checks the line. */
  moveFallers(dt: number): void {
    for (const br of this.game.bricks) {
      if (!br.falling || !br.alive) continue;
      br.y -= BOSS.faller.speed * dt;
      for (const b of this.game.balls) if (b.stuck === null) this.game.shoveBall(b, br);
    }
  }

  emitterActs(kind: EmitterKind, br: Brick): void {
    if (kind === 'turret') this.fireTurret(br);
    else if (kind === 'spawner') this.spawnFaller(br);
    else this.releaseShadow(br);
  }

  private fireTurret(br: Brick): void {
    const pattern = this.game.emitters?.timings.fire ?? 'straight';
    const x = br.x + br.w / 2;
    const y = br.y;
    const down = -Math.PI / 2;
    const headings = pattern === 'fan' ? [down - BOSS.shot.fan, down, down + BOSS.shot.fan] : [pattern === 'aimed' ? Math.atan2(this.game.paddle.y - y, this.game.paddle.x - x) : down];
    for (const angle of headings) {
      const vx = Math.cos(angle) * BOSS.shot.speed;
      const vy = Math.sin(angle) * BOSS.shot.speed;
      this.game.shots.push({ id: this.game.newId(), x, y, px: x, py: y, vx, vy });
    }
    this.game.events.emit('shotFired', { x, y, pattern, count: headings.length });
  }

  private spawnFaller(from: Brick): void {
    if (this.game.bricks.filter((br) => br.falling).length >= BOSS.faller.max) return;
    const x = from.x;
    const y = from.y - BRICK.height;
    const brick: Brick = {
      ...from,
      id: this.game.newId(),
      x,
      y,
      px: x,
      py: y,
      w: BRICK.width,
      h: BRICK.height,
      kind: 'normal',
      hp: 1,
      maxHp: 1,
      hitTick: -Infinity,
      falling: true,
      charge: 0,
    };
    this.game.bricks.push(brick);
    this.game.events.emit('brickSpawn', { id: brick.id, x: x + brick.w / 2, y: y + brick.h / 2 });
  }

  private releaseShadow(from: Brick): void {
    if (this.game.shadows.length >= BOSS.shadow.max) return;
    const x = from.x + from.w / 2;
    const y = from.y - BALL.radius;
    const shadow: ShadowBall = { id: this.game.newId(), x, y, px: x, py: y, vx: 0, vy: 0, r: BALL.radius, life: BOSS.shadow.life };
    // At the speed of the real thing, so speed doesn't give it away.
    const speed = this.game.balls[0]?.speed ?? BALL.baseSpeed;
    aim(shadow, Math.PI + this.game.rng.range(-BOSS.shadow.spread, BOSS.shadow.spread), speed);
    this.game.shadows.push(shadow);
    this.game.events.emit('shadowSpawn', { id: shadow.id, x, y });
  }

  updateShadows(dt: number): void {
    this.game.shadows = this.game.shadows.filter((s) => {
      s.life -= dt;
      if (s.life <= 0) return false;
      this.moveShadow(s, dt);
      return s.y >= RULES.lostBallY;
    });
  }

  /** As `Game.moveBall` with every rule taken out: it bounces off walls, bricks and the paddle, and that's all. */
  private moveShadow(s: ShadowBall, dt: number): void {
    const speed = Math.hypot(s.vx, s.vy);
    let remaining = 1;
    for (let i = 0; i < MAX_BOUNCES && remaining > 0; i++) {
      const dx = s.vx * dt * remaining;
      const dy = s.vy * dt * remaining;
      let hit: SweepHit | null = sweepWalls(s, dx, dy);
      for (const br of this.game.bricks) {
        if (!br.alive) continue;
        const h = sweepRect(s, dx, dy, br);
        if (closer(h, hit)) hit = h;
      }
      let onPaddle = false;
      if (s.vy < 0) {
        const box = this.game.paddleBox(s.r);
        const h = sweepBox(s.x, s.y, dx, dy, box.minX, box.minY, box.maxX, box.maxY);
        if (closer(h, hit)) {
          hit = h;
          onPaddle = h.ny > 0;
        }
      }
      if (!hit) {
        s.x += dx;
        s.y += dy;
        return;
      }
      s.x += dx * hit.t + hit.nx * SKIN;
      s.y += dy * hit.t + hit.ny * SKIN;
      remaining *= 1 - hit.t;
      bounceFlat(s, hit.nx, hit.ny);
      if (onPaddle) aim(s, (clamp((s.x - this.game.paddle.x) / (this.game.paddle.w / 2), -1, 1)) * BALL.maxBounceAngle, speed);
      normalizeVelocity(s, speed);
    }
  }

  /** Shots fly through the bricks; the only thing they can hit is the paddle. */
  updateShots(dt: number): void {
    const p = this.game.paddle;
    const { radius } = BOSS.shot;
    this.game.shots = this.game.shots.filter((s) => {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (Math.abs(s.x - p.x) < p.w / 2 + radius && Math.abs(s.y - p.y) < p.h / 2 + radius) {
        this.game.stun = BOSS.stun;
        this.game.events.emit('paddleStun', { x: p.x, seconds: BOSS.stun });
        return false;
      }
      return s.y >= -radius && s.x >= -radius && s.x <= FIELD.width + radius;
    });
  }

  paceFormations(): void {
    const pace = this.game.fight?.phase.pace ?? 1;
    for (const f of this.game.formations) f.boost = pace;
  }

  /** The core takes the hit, up to the phase's threshold; reaching that starts the next phase or ends the fight. */
  hitCore(core: Brick, by: HitSource, ix: number, iy: number): void {
    const fight = this.game.fight;
    const x = core.x + core.w / 2;
    const y = core.y + core.h / 2;
    if (!fight || fight.shielded) {
      this.game.events.emit('brickHit', { id: core.id, kind: core.kind, hp: core.hp, by, x, y, ix, iy });
      return;
    }
    const floor = fight.floor;
    const boltDamage = BOSS.laserDamage + LASERPIERCE_CORE * this.game.mods.laserpierce;
    core.hp = Math.max(floor, core.hp - (by === 'laser' ? boltDamage : 1));
    this.game.score += this.game.paid(SCORE.hit * this.game.multiplier, by);
    this.game.events.emit('brickHit', { id: core.id, kind: core.kind, hp: core.hp, by, x, y, ix, iy });
    if (core.hp > floor) return;
    if (core.hp > 0) this.nextPhase(fight);
    else this.killCore(core, x, y);
  }

  private nextPhase(fight: BossFight): void {
    fight.advance();
    this.paceFormations();
    this.ejectFromVault();
    this.game.events.emit('bossPhase', { phase: fight.phaseIndex + 1, phases: fight.def.phases.length, hp: fight.core.hp });
  }

  /** Balls in the vault go back out through the first portal outside it, heading down. */
  private ejectFromVault(): void {
    const vault = this.game.fight?.def.vault;
    if (!vault) return;
    const minX = vault.cols[0] * BRICK.width;
    const maxX = (vault.cols[1] + 1) * BRICK.width;
    const maxY = FIELD.height - BRICK.top - vault.rows[0] * BRICK.height;
    const minY = FIELD.height - BRICK.top - (vault.rows[1] + 1) * BRICK.height;
    const inside = (p: { x: number; y: number }): boolean => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    const exit = this.game.portals.find((p) => !inside(p));
    if (!exit) return;
    for (const b of this.game.balls) {
      if (!inside(b)) continue;
      b.x = b.px = exit.x;
      b.y = b.py = exit.y;
      b.vy = -Math.abs(b.vy);
      b.inPortal = exit.id;
      this.game.events.emit('portalWarp', { id: b.id, from: exit.exit, to: exit.id, x: exit.x, y: exit.y });
    }
  }

  /** The core goes and the room goes with it; `resolveStage` picks up the win. */
  private killCore(core: Brick, x: number, y: number): void {
    core.alive = false;
    this.game.breakableLeft--;
    this.game.events.emit('bossDown', { x, y });
    this.shatter(core);
    for (const br of this.game.bricks) {
      if (!br.alive) continue;
      br.alive = false;
      this.shatter(br);
    }
  }

  /** A broken brick that pays nothing: it goes from its centre, as if by an explosion there. */
  private shatter(br: Brick): void {
    const x = br.x + br.w / 2;
    const y = br.y + br.h / 2;
    this.game.events.emit('brickDestroyed', { id: br.id, kind: br.kind, points: 0, chain: 0, bonus: 0, multiplier: this.game.multiplier, by: 'explosion', x, y, ix: x, iy: y, vx: 0, vy: 0 });
  }
}
