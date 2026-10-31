import { DRAFT, EPIC_CHANCE, MODS, type Boosts, type Rarity } from '../config/mods';
import { RUN, type RoomKind } from '../config/run';
import type { Rng } from '../core/rng';
import type { ModKind } from './types';

export const MOD_KINDS = Object.keys(MODS) as ModKind[];

/**
 * Card text for `kind` at `stacks` stacks, with the numbers the other mods in `held` give it
 * (the pick shows the stacks it would have once taken, the panel the stacks held).
 */
export function describeMod(kind: ModKind, held: Readonly<Record<ModKind, number>>, stacks = held[kind]): string {
  const total = (k: ModKind) => MODS[k].perStack * held[k];
  const boosts: Boosts = { extender: total('extender'), longbeam: total('longbeam'), extraball: total('extraball') };
  return MODS[kind].describe(MODS[kind].perStack * stacks, boosts);
}

/** Chance the pick after a `room` turns its last card epic, before stage `depth` of the run (0-based). */
export function epicChance(room: RoomKind, depth: number): number {
  if (room === 'boss') return EPIC_CHANCE.boss;
  if (room === 'elite') return EPIC_CHANCE.elite;
  return EPIC_CHANCE.depth[Math.min(Math.floor(depth / RUN.bandRooms), EPIC_CHANCE.depth.length - 1)] ?? 0;
}

/**
 * Different mods the player could still take (not at their stack limit), one per `DRAFT.slots`
 * entry, the last turned epic with chance `epic` while epics are left. A slot takes any mod once
 * its rarity has run out.
 */
export function rollMods(rng: Rng, owned: Readonly<Record<ModKind, number>>, epic: number): ModKind[] {
  const open = MOD_KINDS.filter((k) => owned[k] < MODS[k].maxStacks);
  const slots: Rarity[] = [...DRAFT.slots];
  if (open.some((k) => MODS[k].rarity === 'epic') && rng.next() < epic) slots[slots.length - 1] = 'epic';
  const picks: ModKind[] = [];
  for (const rarity of slots) {
    const left = open.filter((k) => !picks.includes(k));
    if (left.length === 0) break;
    const ofRarity = left.filter((k) => MODS[k].rarity === rarity);
    const from = ofRarity.length > 0 ? ofRarity : left;
    const pick = from[Math.floor(rng.next() * from.length)];
    if (pick) picks.push(pick);
  }
  return picks;
}
