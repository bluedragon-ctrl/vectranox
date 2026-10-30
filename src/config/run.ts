/*
 * Run progression tuning: how a run is put together. The picks between stages are in mods.ts.
 * Like tuning.ts, everything here is meant to be tweaked by hand.
 */

/**
 * Standard rooms are still layouts, formation rooms move, elite rooms are hard and pay for it,
 * boss rooms are won by destroying the core.
 */
export type RoomKind = 'standard' | 'formation' | 'elite' | 'boss';

/**
 * A run is `rooms` rooms, assembled from the stage templates when the run starts (see
 * levels/assemble.ts). After every cleared room but the last the player picks a mod or extra lives
 * (see `DRAFT` in mods.ts).
 *
 * The first room is a random opener and the last the final boss; each room between rolls its kind.
 * `bossChance` and `eliteChance` are the chance of that kind by rooms since the last one (the last
 * entry holds from there on). Bosses leave at least a room before the final boss, elites never
 * follow a boss, and bosses never repeat. `formationChance` splits the rooms left over.
 *
 * Tiers: `tierWeights` is how likely a room of each tier is, per template (relative weights, tier 1
 * first), for each `bandRooms` rooms of the run; the last row is used past the end.
 *
 * Depth scaling: stage n of the run (0-based) turns each normal brick tough (2 hits) with chance
 * `toughPerStage * n` and each 2-hit brick into a 3-hit one with `hardPerStage * n`, capped at
 * the `Max` values. Formations move `formationPerStage * n` faster. A layout is mirrored
 * left-right with `mirrorChance`.
 */
export const RUN = {
  rooms: 12,
  bossChance: [0, 0, 0.1, 0.35, 1],
  eliteChance: [0, 0.35, 0.6, 0.85, 1],
  formationChance: 0.4,
  bandRooms: 4,
  tierWeights: [
    [85, 15, 0],
    [30, 55, 15],
    [10, 40, 50],
  ],
  depth: {
    // Off for now: difficulty comes from ball speed alone (`BALL.stageSpeedStep`) while it is
    // playtested. 0.035 and 0.03 gave about 40% / 30% upgraded bricks by the last stage.
    toughPerStage: 0,
    toughMax: 0.4,
    hardPerStage: 0,
    hardMax: 0.35,
    formationPerStage: 0.03,
    mirrorChance: 0.5,
  },
} as const;

/**
 * Elite rooms: the ball starts `speedBonus` units/s faster, clearing the room pays `clearBonus`
 * (no multiplier), and the pick after it rolls by `ELITE_WEIGHTS` in mods.ts.
 */
export const ELITE = {
  speedBonus: 18,
  clearBonus: 1000,
} as const;

/** Boss rooms: killing the boss pays `clearBonus` (no multiplier); the pick after it rolls by `BOSS_WEIGHTS` in mods.ts. */
export const BOSS_ROOM = {
  clearBonus: 2500,
} as const;

/** How each room kind is named on screen; standard rooms go by their stage name alone. */
export const ROOM_LABEL: Record<RoomKind, string> = {
  standard: '',
  formation: 'FORMATION',
  elite: 'ELITE',
  boss: 'BOSS',
};

/** A room's threat rating as shown on screen: one pip per point. */
export function threatPips(threat: number): string {
  return '▲'.repeat(threat);
}
