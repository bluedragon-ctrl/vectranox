import type { RoomKind } from '../config/run';
import type { FORMATION } from '../config/tuning';

/**
 * Stage templates, one JSON file each in `rooms/`, written by the room editor (`npm run editor`).
 * A run is assembled from these (see assemble.ts). One string per brick row, top row first, 13 columns.
 * `1` normal · `2` / `3` tough (hits to break) · `#` steel (indestructible) · `.` empty
 * `*` explosive · `r` regenerating (see `BRICK_TYPES`)
 * Pinball pieces (see `PINBALL`): `o` target · `A`–`Z` portal, each letter used exactly twice (its two ends).
 *
 * `room` is the kind of room it fills (standard unless given); `tier` is the first sector a template
 * can appear in; the last stage of a sector prefers templates of that sector's tier. The `opener`
 * always starts the run. Pinball pieces don't move, so keep them out of a formation's way.
 */
export interface StageTemplate {
  name: string;
  tier: 1 | 2 | 3;
  room?: RoomKind;
  opener?: boolean;
  layout: readonly string[];
  formations?: readonly FormationDef[];
}

/**
 * A group of bricks that moves (see `FORMATION`): those in `rows` and `cols`, both inclusive and
 * all of them when left out. A marching formation shouldn't rely on steel, which can't be stopped
 * from reaching the line and so doesn't count for it.
 */
export interface FormationDef {
  motion: keyof typeof FORMATION.motions;
  rows?: readonly [number, number];
  cols?: readonly [number, number];
  /** Start the other way round. */
  reverse?: boolean;
}

/** One stage of a run: a template after depth scaling. */
export interface StageDef {
  name: string;
  room: RoomKind;
  layout: readonly string[];
  formations: readonly FormationDef[];
  /** Scales the formations' speed. */
  formationPace: number;
  /** 1-based. */
  sector: number;
  /** 1-based position in the sector. */
  number: number;
}

// JSON isn't type-checked: `npm run build` runs them through validate.ts instead.
export const TEMPLATES: readonly StageTemplate[] = Object.values(
  import.meta.glob<StageTemplate>('./rooms/*.json', { eager: true, import: 'default' }),
);
