import { STAGE_EVENTS } from '../config/tuning';
import type { Rng } from '../core/rng';
import type { StageEventDef, StageEventKind } from './types';

const KINDS = Object.keys(STAGE_EVENTS.kinds) as StageEventKind[];

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
