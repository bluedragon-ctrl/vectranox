import { MODS, RARITY_WEIGHTS, type Boosts, type Rarity, type RarityWeights } from '../config/mods';
import type { Rng } from '../core/rng';
import type { ModKind } from './types';

export const MOD_KINDS = Object.keys(MODS) as ModKind[];
const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic'];

/**
 * Card text for `kind` at `stacks` stacks, with the numbers the other mods in `held` give it
 * (the pick shows the stacks it would have once taken, the panel the stacks held).
 */
export function describeMod(kind: ModKind, held: Readonly<Record<ModKind, number>>, stacks = held[kind]): string {
  const total = (k: ModKind) => MODS[k].perStack * held[k];
  const boosts: Boosts = { extender: total('extender'), longbeam: total('longbeam'), extraball: total('extraball') };
  return MODS[kind].describe(MODS[kind].perStack * stacks, boosts);
}

/** Rarity weights of a sector's picks. */
export function sectorWeights(sector: number): RarityWeights {
  return RARITY_WEIGHTS[Math.min(sector, RARITY_WEIGHTS.length) - 1] ?? { common: 1, rare: 0, epic: 0 };
}

/**
 * Up to `count` different mods the player could still take (not at their stack limit). Each slot
 * rolls a rarity by `weights` among the rarities that still have a mod left, then a mod of that
 * rarity; when those rarities have no weight it takes any.
 */
export function rollMods(rng: Rng, owned: Readonly<Record<ModKind, number>>, weights: RarityWeights, count: number): ModKind[] {
  const open = MOD_KINDS.filter((k) => owned[k] < MODS[k].maxStacks);
  const picks: ModKind[] = [];
  while (picks.length < count) {
    const left = open.filter((k) => !picks.includes(k));
    if (left.length === 0) break;
    const rarity = rollRarity(rng, weights, new Set(left.map((k) => MODS[k].rarity)));
    const ofRarity = left.filter((k) => MODS[k].rarity === rarity);
    const from = ofRarity.length > 0 ? ofRarity : left;
    const pick = from[Math.floor(rng.next() * from.length)];
    if (pick) picks.push(pick);
  }
  return picks;
}

/** A rarity out of `available` by `weights`; `null` when none of them has any weight. */
function rollRarity(rng: Rng, weights: RarityWeights, available: ReadonlySet<Rarity>): Rarity | null {
  const rarities = RARITIES.filter((r) => available.has(r));
  const total = rarities.reduce((sum, r) => sum + weights[r], 0);
  let roll = rng.next() * total;
  for (const r of rarities) {
    roll -= weights[r];
    if (roll < 0) return r;
  }
  return null;
}
