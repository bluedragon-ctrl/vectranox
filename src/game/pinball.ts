import { POWER, PINBALL, SECRET_CODES, type SecretCode, type TargetColor } from '../config/tuning';
import type { Game } from './Game';
import { normalizeVelocity } from './physics';
import type { Ball, Pad, Target } from './types';

const SECRET_KINDS = Object.keys(SECRET_CODES) as SecretCode[];
/** Target colours to remember: enough for the longest secret code. */
const SECRET_LENGTH = Math.max(...SECRET_KINDS.map((kind) => SECRET_CODES[kind].sequence.length));

function endsWith<T>(list: readonly T[], tail: readonly T[]): boolean {
  const from = list.length - tail.length;
  return from >= 0 && tail.every((item, i) => list[from + i] === item);
}

/** The pinball pieces a room can have: pads (boosters and clocks), portals and targets with their secret codes. */
export class Pinball {
  /** Colours of the targets hit in this room, oldest first, since the last secret code; only the newest `SECRET_LENGTH` are kept. */
  private targetColors: TargetColor[] = [];

  constructor(private readonly game: Game) {}

  /** A new room: no colours played yet. */
  reset(): void {
    this.targetColors = [];
  }

  /** A ball whose centre comes within a pad's reach sets it off, once each time it goes through. */
  checkPads(b: Ball): void {
    if (b.inPad !== null) {
      const pad = this.game.pads.find((p) => p.id === b.inPad);
      if (pad && (b.x - pad.x) ** 2 + (b.y - pad.y) ** 2 <= pad.r ** 2) return;
      b.inPad = null;
    }
    for (const pad of this.game.pads) {
      if ((b.x - pad.x) ** 2 + (b.y - pad.y) ** 2 >= PINBALL[pad.kind].capture ** 2) continue;
      b.inPad = pad.id;
      if (pad.kind === 'boost') this.boostBall(pad, b);
      else this.windClock(pad, b);
      return;
    }
  }

  /** Booster: the ball keeps the extra speed until it is lost. */
  private boostBall(pad: Pad, b: Ball): void {
    // Under the same top speed as brick hits, dampener included.
    b.speed = Math.min(this.game.maxBallSpeed, Math.max(b.speed, b.speed * PINBALL.boost.scale));
    normalizeVelocity(b, this.game.ballSpeed(b));
    pad.hitTick = this.game.tick;
    this.game.events.emit('padBoost', { id: b.id, pad: pad.id, speed: b.speed, x: pad.x, y: pad.y });
  }

  /** Clock: more time while some is left, then a rest before it works again. */
  private windClock(pad: Pad, b: Ball): void {
    if (pad.recharge > 0 || this.game.timeLeft === 0) return;
    const { seconds, recharge } = PINBALL.clock;
    this.game.timeLeft += seconds;
    pad.recharge = recharge;
    pad.hitTick = this.game.tick;
    this.game.events.emit('padClock', { id: b.id, pad: pad.id, seconds, x: pad.x, y: pad.y });
  }

  /** Recharges used clocks; runs with the room's clock, while a ball is in play. */
  tickPads(dt: number): void {
    for (const pad of this.game.pads) {
      if (pad.recharge === 0) continue;
      pad.recharge = Math.max(0, pad.recharge - dt);
      if (pad.recharge > 0) continue;
      pad.readyTick = this.game.tick;
      this.game.events.emit('padReady', { pad: pad.id, x: pad.x, y: pad.y });
    }
  }

  /** A ball that reaches a portal's centre comes out of the other end, moving the same way. */
  checkPortals(b: Ball): void {
    if (b.inPortal !== null) {
      const from = this.game.portals.find((p) => p.id === b.inPortal);
      if (!from || (b.x - from.x) ** 2 + (b.y - from.y) ** 2 > from.r ** 2) b.inPortal = null;
      return;
    }
    const capture = this.game.portalCapture ** 2;
    for (const p of this.game.portals) {
      if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 >= capture) continue;
      const exit = this.game.portals.find((q) => q.id === p.exit);
      if (!exit) return;
      // Jump, not travel: no interpolation across the field.
      b.x = b.px = exit.x;
      b.y = b.py = exit.y;
      b.inPortal = exit.id;
      p.warpTick = exit.warpTick = this.game.tick;
      this.game.events.emit('portalWarp', { id: b.id, from: p.id, to: exit.id, x: exit.x, y: exit.y });
      // Portal split mod: a second ball may come out alongside, angled off to one side.
      if (this.game.mods.portalsplit > 0 && this.game.balls.length < POWER.maxBalls && this.game.rng.next() < this.game.modValue('portalsplit')) {
        this.game.powers.addTwin(b, b.vx, b.vy, POWER.splitAngle);
      }
      return;
    }
  }

  /** Lights the target; lighting the last one completes the bank. */
  hitTarget(tg: Target, b: Ball): void {
    tg.hitTick = this.game.tick;
    const lit = !tg.lit;
    tg.lit = true;
    this.game.score += PINBALL.target.points;
    this.game.events.emit('targetHit', { id: tg.id, ball: b.id, lit, points: PINBALL.target.points, x: tg.x, y: tg.y });
    this.playSecret(tg.color);
    if (!lit || !this.game.targets.every((t) => t.lit)) return;
    for (const t of this.game.targets) {
      t.lit = false;
      t.hitTick = this.game.tick;
    }
    this.game.raiseMultiplier();
    this.game.score += PINBALL.bankBonus;
    this.game.events.emit('targetBank', { multiplier: this.game.multiplier, bonus: PINBALL.bankBonus });
  }

  /** Adds a target hit to the colours played; a secret code they now end with pays and starts them afresh. */
  private playSecret(color: TargetColor): void {
    const played = this.targetColors;
    played.push(color);
    if (played.length > SECRET_LENGTH) played.shift();
    const code = SECRET_KINDS.find((kind) => endsWith(played, SECRET_CODES[kind].sequence));
    if (!code) return;
    played.length = 0;
    const { award } = SECRET_CODES[code];
    let points = 0;
    if (award.kind === 'points') {
      points = award.points * this.game.multiplier;
      this.game.score += points;
    } else if (award.kind === 'multiplier') {
      this.game.raiseMultiplier();
    } else {
      this.game.powers.chargeBalls(award.charges);
    }
    this.game.events.emit('secretCode', { code, points, multiplier: this.game.multiplier });
  }
}
