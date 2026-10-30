/*
 * Run progression tuning: how a run is put together. The picks between stages are in mods.ts.
 * Like tuning.ts, everything here is meant to be tweaked by hand.
 */

/** Standard rooms are still layouts, formation rooms move, elite rooms are hard and pay for it. */
export type RoomKind = 'standard' | 'formation' | 'elite';

/**
 * A run is `sectors` × `stagesPerSector` stages, assembled from the stage templates when the run
 * starts (see levels/assemble.ts). After every cleared stage but the last the player picks a mod
 * or extra lives (see `DRAFT` in mods.ts).
 *
 * `rooms` is the mix of room kinds per sector, in stage order; each slot takes a template of that
 * kind (the first stage of the run is always the opener).
 *
 * Depth scaling: stage n of the run (0-based) turns each normal brick tough (2 hits) with chance
 * `toughPerStage * n` and each 2-hit brick into a 3-hit one with `hardPerStage * n`, capped at
 * the `Max` values. Formations move `formationPerStage * n` faster. A layout is mirrored
 * left-right with `mirrorChance`.
 */
export const RUN = {
  sectors: 3,
  stagesPerSector: 4,
  rooms: [
    ['standard', 'standard', 'formation', 'elite'],
    ['standard', 'formation', 'standard', 'elite'],
    ['formation', 'standard', 'formation', 'elite'],
  ] as readonly (readonly RoomKind[])[],
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

/** How each room kind is named on screen; standard rooms go by their stage name alone. */
export const ROOM_LABEL: Record<RoomKind, string> = {
  standard: '',
  formation: 'FORMATION',
  elite: 'ELITE',
};
