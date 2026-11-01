import { POWER, POWER_LOOK } from '../config/tuning';
import type { Rng } from '../core/rng';
import type { PowerDef, PowerKind, TimedPower } from './types';

export const POWER_KINDS = Object.keys(POWER.kinds) as PowerKind[];
export const TIMED_POWERS = POWER_KINDS.filter((k): k is TimedPower => POWER.kinds[k].duration > 0);
export const RARE_POWERS = POWER_KINDS.filter((k) => (POWER.kinds[k] as PowerDef).rare);
export const COMMON_POWERS = POWER_KINDS.filter((k) => !RARE_POWERS.includes(k));
/** What stage events may hand out: no negative powers, and rare ones are only ever found. */
export const GOOD_POWERS = COMMON_POWERS.filter((k) => !POWER_LOOK[k].bad);

/** Weighted pick among `kinds`. */
export function rollPower(rng: Rng, kinds: readonly PowerKind[]): PowerKind {
  const total = kinds.reduce((sum, k) => sum + POWER.kinds[k].weight, 0);
  let r = rng.next() * total;
  for (const k of kinds) {
    r -= POWER.kinds[k].weight;
    if (r < 0) return k;
  }
  return 'multi';
}
