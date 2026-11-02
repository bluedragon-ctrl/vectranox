import { STAGE_EVENTS } from '../config/tuning';
import type { Rng } from '../core/rng';
import type { Game } from './Game';
import { isBreakable } from './layout';
import { GOOD_POWERS, rollPower } from './powers';
import type { StageEventDef, StageEventKind } from './types';

const KINDS = Object.keys(STAGE_EVENTS.kinds) as StageEventKind[];

/**
 * The stage events (see `STAGE_EVENTS`): watches the stage for their triggers and runs their effects.
 * What it needs to remember between ticks is kept by `StageEventTracker`.
 */
export class StageEvents {
  private readonly tracker = new StageEventTracker();
  /** Seconds of play since a breakable brick was last hit / destroyed. */
  private sinceHit = 0;
  private sinceKill = 0;

  constructor(private readonly game: Game) {}

  /** A new stage: every trigger armed, nothing fired yet. */
  reset(): void {
    this.tracker.reset();
  }

  /** A new ball is up: the clocks start over, and outside boss rooms some events can fire again. */
  serve(): void {
    this.sinceHit = this.sinceKill = 0;
    this.tracker.arm('safetyNet');
    if (!this.game.fight) this.tracker.refund(STAGE_EVENTS.perBalls);
  }

  /** The ball was launched: low on lives near the end of a stage, the safety net may fire. */
  launch(): void {
    const net = STAGE_EVENTS.kinds.safetyNet;
    if (this.game.lives <= net.lives && this.game.breakableLeft <= net.bricksLeft) this.tryEvent('safetyNet');
  }

  /** A breakable brick was hit. */
  brickHit(): void {
    this.sinceHit = 0;
    this.tracker.arm('pulse');
  }

  /** A breakable brick was destroyed. */
  brickKilled(): void {
    this.sinceKill = 0;
    this.tracker.arm('supplyDrop', 'overload', 'hunter', 'demolition');
  }

  /** Runs every play tick, after the stage was resolved. Triggers for the ongoing events. */
  update(dt: number): void {
    this.sinceHit += dt;
    this.sinceKill += dt;
    this.tracker.tick(dt);
    const { supplyDrop, overload, pulse, hunter, demolition } = STAGE_EVENTS.kinds;
    const left = this.game.breakableLeft;
    const boss = this.game.fight !== null;
    if (left <= supplyDrop.bricksLeft) this.tryLateEvent('supplyDrop');
    if (left <= demolition.bricksLeft) this.tryLateEvent('demolition');
    if (left <= overload.bricksLeft) this.tryLateEvent('overload');
    if (left <= hunter.bricksLeft && (!boss || this.sinceKill >= STAGE_EVENTS.bossHunterIdle)) this.tryLateEvent('hunter');
    if (this.sinceHit >= pulse.idleTime && (boss || (left > 1 && this.tracker.rested))) this.tryEvent('pulse');
    if (this.pulseFinishes && left <= pulse.maxBricks && this.tracker.rested) this.fire('pulse');
  }

  /** Runs an event's effect right away, skipping its trigger and chance. */
  fire(kind: StageEventKind): void {
    const game = this.game;
    const spareLast = !game.fight && !this.pulseFinishes;
    this.tracker.fired(kind);
    game.events.emit('stageEvent', { kind, bricks: game.breakableLeft });
    const { power, duration }: StageEventDef = STAGE_EVENTS.kinds[kind];
    if (power) game.powers.apply(power, duration);
    switch (kind) {
      case 'supplyDrop': {
        const bricks = game.bricks.filter(isBreakable);
        const br = bricks[Math.floor(game.rng.next() * bricks.length)];
        if (br) game.powers.dropCapsule(rollPower(game.rng, GOOD_POWERS), br.x + br.w / 2, br.y + br.h / 2);
        break;
      }
      case 'pulse': {
        const { maxBricks, damage } = STAGE_EVENTS.kinds.pulse;
        this.pulseBricks(Math.min(maxBricks, game.breakableLeft - (spareLast ? 1 : 0)), damage);
        break;
      }
    }
  }

  /** Trigger met: roll the event's chance once, then wait for it to re-arm. */
  private tryEvent(kind: StageEventKind): void {
    if (this.tracker.roll(kind, this.game.rng)) this.fire(kind);
  }

  /** As `tryEvent`, for a brick-count event: it has to wait its turn, bar in a boss room. */
  private tryLateEvent(kind: StageEventKind): void {
    const ready = this.game.fight
      ? this.tracker.firings(kind) === 0
      : this.tracker.rested && this.tracker.stalled(kind, this.sinceKill);
    if (ready) this.tryEvent(kind);
  }

  /** The stage has stalled for so long that a pulse may take its last brick; never in a boss room. */
  private get pulseFinishes(): boolean {
    return !this.game.fight && this.tracker.quiet('pulse', this.sinceKill) >= STAGE_EVENTS.kinds.pulse.finishAfter;
  }

  /** The lowest `count` breakable bricks take `damage` hits each, struck from below. */
  private pulseBricks(count: number, damage: number): void {
    const targets = this.game.bricks
      .filter(isBreakable)
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .slice(0, count);
    for (const br of targets) this.game.damageBrick(br, 'pulse', br.x + br.w / 2, br.y, damage);
  }
}

/**
 * Per stage: whether each stage event's trigger is armed, how often each event fired, and how long
 * ago each one and any one did.
 */
export class StageEventTracker {
  private readonly armed = {} as Record<StageEventKind, boolean>;
  private readonly count = {} as Record<StageEventKind, number>;
  private readonly sinceFired = {} as Record<StageEventKind, number>;
  private sinceAny = Infinity;

  constructor() {
    this.reset();
  }

  reset(): void {
    for (const kind of KINDS) {
      this.armed[kind] = true;
      this.count[kind] = 0;
      this.sinceFired[kind] = Infinity;
    }
    this.sinceAny = Infinity;
  }

  arm(...kinds: readonly StageEventKind[]): void {
    for (const kind of kinds) this.armed[kind] = true;
  }

  /** Hands back one firing of each of `kinds`, for those that fired. */
  refund(kinds: readonly StageEventKind[]): void {
    for (const kind of kinds) this.count[kind] = Math.max(0, this.count[kind] - 1);
  }

  fired(kind: StageEventKind): void {
    this.count[kind]++;
    this.sinceFired[kind] = 0;
    this.sinceAny = 0;
    this.armed[kind] = true;
  }

  tick(dt: number): void {
    for (const kind of KINDS) this.sinceFired[kind] += dt;
    this.sinceAny += dt;
  }

  firings(kind: StageEventKind): number {
    return this.count[kind];
  }

  /** Whether `STAGE_EVENTS.gap` has passed since the last event. */
  get rested(): boolean {
    return this.sinceAny >= STAGE_EVENTS.gap;
  }

  /** Whether `kind` has waited long enough, `sinceKill` seconds after the last kill, to fire again. */
  stalled(kind: StageEventKind, sinceKill: number): boolean {
    return this.quiet(kind, sinceKill) >= stallOf(STAGE_EVENTS.kinds[kind], this.count[kind]);
  }

  /** Seconds since the last kill or `kind`'s last firing, whichever came later. */
  quiet(kind: StageEventKind, sinceKill: number): number {
    return Math.min(sinceKill, this.sinceFired[kind]);
  }

  /** Trigger met: rolls the event's chance once, a miss spending the trigger; true when it should fire. */
  roll(kind: StageEventKind, rng: Rng): boolean {
    const def = STAGE_EVENTS.kinds[kind];
    if (!this.armed[kind] || this.count[kind] >= def.maxPerStage) return false;
    this.armed[kind] = false;
    return rng.next() < def.chance;
  }
}

/** The `stall` entry for an event's firing number `count`; the last one holds. */
function stallOf({ stall = [] }: StageEventDef, count: number): number {
  return stall[Math.min(count, stall.length - 1)] ?? 0;
}
