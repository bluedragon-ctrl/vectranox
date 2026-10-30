import type { RoomKind } from '../config/run';
import type { FORMATION } from '../config/tuning';

/**
 * Stage templates, one JSON file each in `rooms/`, written by the room editor (`npm run editor`).
 * A run is assembled from these (see assemble.ts). One string per brick row, top row first, 13 columns.
 * `1` / `2` / `3` normal (hits to break) · `#` steel (indestructible) · `.` empty
 * `*` explosive · `r` regenerating (see `BRICK_TYPES`)
 * Pinball pieces (see `PINBALL`): `o` target · `A`–`Z` portal, each letter used exactly twice (its two ends).
 * Boss rooms only: `c` core, a filled rectangle of cells that makes one big brick · `t` turret ·
 * `s` spawner · `g` phantom (see `BOSS`).
 *
 * `room` is the kind of room it fills (standard unless given); `tier` says how deep in a run it
 * tends to appear (see `RUN.tierWeights`), and for bosses their order. `threat` is the 1 to 3 pips
 * announcing how hard it plays, the tier unless given. A run starts with one of the `opener` rooms,
 * which appear nowhere else.
 * Pinball pieces don't move, so keep them out of a formation's way.
 */
export interface StageTemplate {
  name: string;
  tier: 1 | 2 | 3;
  threat?: 1 | 2 | 3;
  room?: RoomKind;
  opener?: boolean;
  layout: readonly string[];
  formations?: readonly FormationDef[];
  /** What a boss room's core and emitters do; required for one. */
  boss?: BossDef;
}

/** How a turret aims: down, at the paddle, or three down in a spread. */
export type FirePattern = 'straight' | 'aimed' | 'fan';

/**
 * A boss's fight. `phases` run from the top: each starts once the core is down to its `at` share
 * of `hp`, so the first has `at: 1`. `vault`, the cells of a sealed part of the room: balls in it
 * are thrown out through a portal at every phase change.
 */
export interface BossDef {
  hp: number;
  phases: readonly BossPhase[];
  vault?: { rows: readonly [number, number]; cols: readonly [number, number] };
}

/** Seconds between `turret`, `spawner` and `phantom` actions (left out: that kind stays idle). `pace` speeds the formations. */
export interface BossPhase {
  at: number;
  fire?: FirePattern;
  turret?: number;
  spawner?: number;
  phantom?: number;
  pace?: number;
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
  /** Set in boss rooms. */
  boss: BossDef | null;
  /** Pips announcing the room. */
  threat: number;
  /** 1-based position in the run. */
  number: number;
}

// JSON isn't type-checked: `npm run build` runs them through validate.ts instead.
export const TEMPLATES: readonly StageTemplate[] = Object.values(
  import.meta.glob<StageTemplate>('./rooms/*.json', { eager: true, import: 'default' }),
);
