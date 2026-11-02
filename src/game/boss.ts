import { BOSS } from '../config/tuning';
import type { BossDef, BossPhase, EmitterTimings } from '../levels/stages';
import type { Brick, EmitterKind } from './types';

const EMITTERS: readonly EmitterKind[] = ['turret', 'spawner', 'phantom'];

/**
 * When the emitters (turrets, spawners, phantoms) act, by `timings`. A kind's bricks take turns,
 * and each flashes for `BOSS.windup` before it acts, so the player can see it coming. Breaking an
 * emitter just takes it out of the rotation; what it does is up to `Game`. A boss fight swaps the
 * timings at each phase; a challenge room keeps its own.
 */
export class Emitters {
  /** Seconds until each kind acts next. */
  private readonly wait = { turret: 0, spawner: 0, phantom: 0 };
  /** The brick winding up to act, per kind. */
  private readonly armed: Record<EmitterKind, Brick | null> = { turret: null, spawner: null, phantom: null };
  /** Id of the brick that acted last, per kind. */
  private readonly last = { turret: 0, spawner: 0, phantom: 0 };

  constructor(public timings: EmitterTimings) {
    this.restart(timings);
  }

  /** Every kind starts its timer over on `timings`, and whatever was winding up lets go. */
  restart(timings: EmitterTimings): void {
    this.timings = timings;
    for (const kind of EMITTERS) {
      this.wait[kind] = timings[kind] ?? 0;
      const brick = this.armed[kind];
      if (brick) brick.charge = 0;
      this.armed[kind] = null;
    }
  }

  /** One tick of play; `act` runs for each emitter whose turn has come. */
  update(dt: number, bricks: readonly Brick[], act: (kind: EmitterKind, brick: Brick) => void): void {
    for (const kind of EMITTERS) {
      const interval = this.timings[kind];
      if (interval === undefined) continue;
      this.wait[kind] -= dt;
      if (this.wait[kind] > BOSS.windup) continue;
      let brick = this.armed[kind];
      if (!brick?.alive) brick = this.armed[kind] = this.nextEmitter(kind, bricks);
      if (brick) brick.charge = 1 - Math.max(0, this.wait[kind]) / BOSS.windup;
      if (this.wait[kind] > 0) continue;
      this.wait[kind] += interval;
      this.armed[kind] = null;
      if (!brick) continue;
      brick.charge = 0;
      this.last[kind] = brick.id;
      act(kind, brick);
    }
  }

  /** The next brick of a kind by id, wrapping round. */
  private nextEmitter(kind: EmitterKind, bricks: readonly Brick[]): Brick | null {
    let first: Brick | null = null;
    let next: Brick | null = null;
    for (const br of bricks) {
      if (br.kind !== kind || !br.alive) continue;
      if (!first || br.id < first.id) first = br;
      if (br.id > this.last[kind] && (!next || br.id < next.id)) next = br;
    }
    return next ?? first;
  }
}

/** A boss room's fight: which phase it is in, each with its own emitter timings (see `Emitters`). */
export class BossFight {
  phaseIndex = 0;
  readonly emitters: Emitters;
  /** Seconds left of the phase break. */
  private hold = 0;

  constructor(
    readonly def: BossDef,
    readonly core: Brick,
  ) {
    this.emitters = new Emitters(this.phase);
  }

  get phase(): BossPhase {
    const phase = this.def.phases[this.phaseIndex];
    if (!phase) throw new Error(`No boss phase ${this.phaseIndex}`);
    return phase;
  }

  /** The core takes no damage for now. */
  get shielded(): boolean {
    return this.hold > 0;
  }

  /** How far this phase's damage can take the core: the next phase's threshold, or 0 in the last. */
  get floor(): number {
    return (this.def.phases[this.phaseIndex + 1]?.at ?? 0) * this.def.hp;
  }

  /** How far along the fight is, 0..1 by phases. */
  get heat(): number {
    return this.def.phases.length > 1 ? this.phaseIndex / (this.def.phases.length - 1) : 0;
  }

  /** Moves on to the next phase and starts its break. */
  advance(): void {
    this.phaseIndex++;
    this.hold = BOSS.phaseBreak;
    this.emitters.restart(this.phase);
  }

  /** One tick of play: nothing acts during a phase break. */
  update(dt: number, bricks: readonly Brick[], act: (kind: EmitterKind, brick: Brick) => void): void {
    if (this.hold > 0) {
      this.hold -= dt;
      return;
    }
    this.emitters.update(dt, bricks, act);
  }
}
