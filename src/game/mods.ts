import { DRAFT, EPIC_CHANCE, MODS, type HeldEffects, type ModDef, type Rarity } from '../config/mods';
import { RUN, type RoomKind } from '../config/run';
import { POWER, POWER_LOOK } from '../config/tuning';
import type { Rng } from '../core/rng';
import type { ModKind, TimedPower } from './types';

export const MOD_KINDS = Object.keys(MODS) as ModKind[];

/** Stacks held of each mod. */
export type ModStacks = Readonly<Record<ModKind, number>>;

/** The mods that grant a power, and when (see `ModDef.grant`). */
export const MOD_GRANTS = MOD_KINDS.flatMap((kind) => {
  const { grant }: ModDef = MODS[kind];
  return grant ? [{ kind, ...grant }] : [];
});

/** What a grant of `base` seconds of `kind` lasts with `mods`. Bad powers are left as they are. */
export function powerSeconds(kind: TimedPower, base: number, mods: ModStacks): number {
  if (POWER_LOOK[kind].bad) return base;
  let seconds = base;
  let stretch = 1;
  for (const k of MOD_KINDS) {
    const def: ModDef = MODS[k];
    const total = def.perStack * mods[k];
    if (def.addSeconds === kind) seconds += total;
    if (def.stretchGood) stretch += total;
  }
  return seconds * stretch;
}

/** Balls each ball becomes on a split with `mods`. */
export function splitInto(mods: ModStacks): number {
  return POWER.splitInto + MODS.extraball.perStack * mods.extraball;
}

/**
 * Card text for `kind` at `stacks` stacks, with the numbers the other mods in `held` give it
 * (the pick shows the stacks it would have once taken, the panel the stacks held).
 */
export function describeMod(kind: ModKind, held: ModStacks, stacks = held[kind]): string {
  const shown: ModStacks = { ...held, [kind]: stacks };
  const effects: HeldEffects = { powerSeconds: (power, base) => powerSeconds(power, base, shown), splitInto: splitInto(shown) };
  return MODS[kind].describe(MODS[kind].perStack * stacks, effects);
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
export function rollMods(rng: Rng, owned: ModStacks, epic: number): ModKind[] {
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
