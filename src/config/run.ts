/*
 * Run progression tuning: how a run is put together. The picks between stages are in mods.ts.
 * Like tuning.ts, everything here is meant to be tweaked by hand.
 */

/**
 * A run is `sectors` × `stagesPerSector` stages, assembled from the stage templates when the run
 * starts (see levels/assemble.ts). After every cleared stage but the last the player picks a mod
 * or extra lives (see `DRAFT` in mods.ts).
 *
 * Depth scaling: stage n of the run (0-based) turns each normal brick tough (2 hits) with chance
 * `toughPerStage * n` and each 2-hit brick into a 3-hit one with `hardPerStage * n`, capped at
 * the `Max` values. A layout is mirrored left-right with `mirrorChance`.
 */
export const RUN = {
  sectors: 3,
  stagesPerSector: 4,
  depth: {
    // Off for now: difficulty comes from ball speed alone (`BALL.stageSpeedStep`) while it is
    // playtested. 0.035 and 0.03 gave about 40% / 30% upgraded bricks by the last stage.
    toughPerStage: 0,
    toughMax: 0.4,
    hardPerStage: 0,
    hardMax: 0.35,
    mirrorChance: 0.5,
  },
} as const;
