import { STAGE_EVENTS } from '../config/tuning';
import type { Rng } from '../core/rng';
import type { StageEventKind } from './types';

const KINDS = Object.keys(STAGE_EVENTS.kinds) as StageEventKind[];

/** Per stage: whether each stage event's trigger is armed, and how often each event fired. */
export class StageEventTracker {
  private readonly armed = {} as Record<StageEventKind, boolean>;
  private readonly count = {} as Record<StageEventKind, number>;

  constructor() {
    this.reset();
  }

  reset(): void {
    for (const kind of KINDS) {
      this.armed[kind] = true;
      this.count[kind] = 0;
    }
  }

  arm(...kinds: StageEventKind[]): void {
    for (const kind of kinds) this.armed[kind] = true;
  }

  fired(kind: StageEventKind): void {
    this.count[kind]++;
  }

  /** Trigger met: spends the trigger and rolls the event's chance once; true when it should fire. */
  roll(kind: StageEventKind, rng: Rng): boolean {
    const def = STAGE_EVENTS.kinds[kind];
    if (!this.armed[kind] || this.count[kind] >= def.maxPerStage) return false;
    this.armed[kind] = false;
    return rng.next() < def.chance;
  }
}
