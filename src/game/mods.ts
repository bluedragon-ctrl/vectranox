import { MODS, RARITY_WEIGHTS, type Rarity } from '../config/mods';
import type { Rng } from '../core/rng';
import type { ModKind } from './types';

export const MOD_KINDS = Object.keys(MODS) as ModKind[];
const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic'];

/**
 * Up to `count` different mods the player could still take (not at their stack limit). Each slot
 * rolls a rarity by the sector's weights, then a mod of that rarity; when none of that rarity is
 * left it takes any.
 */
export function rollMods(rng: Rng, owned: Readonly<Record<ModKind, number>>, sector: number, count: number): ModKind[] {
  const open = MOD_KINDS.filter((k) => owned[k] < MODS[k].maxStacks);
  const picks: ModKind[] = [];
  while (picks.length < count) {
    const left = open.filter((k) => !picks.includes(k));
    if (left.length === 0) break;
    const rarity = rollRarity(rng, sector);
    const ofRarity = left.filter((k) => MODS[k].rarity === rarity);
    const from = ofRarity.length > 0 ? ofRarity : left;
    const pick = from[Math.floor(rng.next() * from.length)];
    if (pick) picks.push(pick);
  }
  return picks;
}

function rollRarity(rng: Rng, sector: number): Rarity {
  const weights = RARITY_WEIGHTS[Math.min(sector, RARITY_WEIGHTS.length) - 1] ?? { common: 1, rare: 0, epic: 0 };
  const total = RARITIES.reduce((sum, r) => sum + weights[r], 0);
  let roll = rng.next() * total;
  for (const r of RARITIES) {
    roll -= weights[r];
    if (roll < 0) return r;
  }
  return 'common';
}
