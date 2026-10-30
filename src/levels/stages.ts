import type { RoomKind } from '../config/run';
import type { FORMATION } from '../config/tuning';

/**
 * Stage templates. A run is assembled from these (see assemble.ts). One string per brick row, top
 * row first, 13 columns.
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

export const TEMPLATES: readonly StageTemplate[] = [
  {
    name: 'BOOT SEQUENCE',
    tier: 1,
    opener: true,
    layout: [
      '1111111111111',
      '1111111111111',
      '1111111111111',
      '1111111111111',
      '1111111111111',
    ],
  },
  {
    name: 'PYRAMID',
    tier: 1,
    layout: [
      '......2......',
      '.....111.....',
      '....11111....',
      '...1111111...',
      '..111111111..',
      '.11111111111.',
      '1111111111111',
      '2222222222222',
    ],
  },
  {
    name: 'INVADER',
    tier: 1,
    layout: [
      '...1.....1...',
      '....1...1....',
      '...1111111...',
      '..11.222.11..',
      '.11111111111.',
      '.1.1111111.1.',
      '.1.1.....1.1.',
      '....11.11....',
    ],
  },
  {
    name: 'SCANLINES',
    tier: 1,
    layout: [
      '1111111111111',
      '.............',
      '2222222222222',
      '.............',
      '1111111111111',
      '.............',
      '1111111111111',
    ],
  },
  {
    name: 'CHECKSUM',
    tier: 1,
    layout: [
      '1.1.1.1.1.1.1',
      '.1.1.1.1.1.1.',
      '1.1.1.1.1.1.1',
      '.1.1.1.1.1.1.',
      '2.2.2.2.2.2.2',
      '.1.1.1.1.1.1.',
    ],
  },
  {
    name: 'WORMHOLE',
    tier: 2,
    layout: [
      '1111111111111',
      '2#.........#2',
      '2#.1..A..1.#2',
      '2#.11...11.#2',
      '2#####.#####2',
      '.............',
      '..o.o.o.o.o..',
      '.............',
      '11.........11',
      '.............',
      '.A...........',
    ],
  },
  {
    name: 'FIREWALL',
    tier: 2,
    layout: [
      '3232323232323',
      '2222222222222',
      '1111111111111',
      '1111111111111',
      '##.##.#.##.##',
      '.............',
      '..111...111..',
    ],
  },
  {
    name: 'PRISM',
    tier: 2,
    layout: [
      '......1......',
      '.....121.....',
      '....12221....',
      '...1223221...',
      '..122333221..',
      '...1223221...',
      '....12221....',
      '.....121.....',
      '......1......',
    ],
  },
  {
    name: 'ARCADE',
    tier: 2,
    layout: [
      '1111111111111',
      '1111111111111',
      '.............',
      '.o..o..o..o..',
      '.............',
      '2222.....2222',
      '1111.....1111',
    ],
  },
  {
    name: 'GATEWAY',
    tier: 2,
    layout: [
      '2111111111112',
      '2111111111112',
      '2.....A.....2',
      '###.#####.###',
      '.............',
      '..1.1.1.1.1..',
      '.............',
      '.............',
      '......A......',
    ],
  },
  {
    name: 'CORE',
    tier: 3,
    layout: [
      '.............',
      '..#2222222#..',
      '..#2111112#..',
      '..#2133312#..',
      '..#2111112#..',
      '..#2222222#..',
      '..#.......#..',
      '.............',
      '1111.....1111',
    ],
  },
  {
    name: 'VAULT',
    tier: 3,
    layout: [
      '.............',
      '.#333333333#.',
      '.#322222223#.',
      '.#321111123#.',
      '.#322222223#.',
      '.#333333333#.',
      '.###.###.###.',
      '.............',
      '.............',
      '11.........11',
    ],
  },
  {
    name: 'GRIDLOCK',
    tier: 3,
    layout: [
      '1212121212121',
      '2121212121212',
      '#...#...#...#',
      '.o.o.o.o.o.o.',
      '.............',
      '3...3...3...3',
    ],
  },
  {
    name: 'BLOCKADE',
    tier: 3,
    layout: [
      '3333333333333',
      '2222222222222',
      '#.#.#.#.#.#.#',
      '1111111111111',
      '1111111111111',
      '.............',
      '..#.......#..',
    ],
  },
  {
    name: 'MINEFIELD',
    tier: 1,
    layout: [
      '..1.1.1.1.1..',
      '.1.*.1.1.*.1.',
      '..1.1.1.1.1..',
      '.1.1.*.*.1.1.',
      '..1.1.1.1.1..',
      '.*.1.1.1.1.*.',
    ],
  },
  {
    name: 'OVERGROWTH',
    tier: 2,
    layout: [
      'r1r1r1r1r1r1r',
      '1r1r1r1r1r1r1',
      '.............',
      'rr.rr.r.rr.rr',
      '.............',
      '2222.....2222',
    ],
  },

  // Formation rooms.
  {
    name: 'PATROL',
    tier: 1,
    room: 'formation',
    layout: [
      '.............',
      '..111111111..',
      '..111111111..',
      '.............',
      '.............',
      '...2222222...',
      '...1111111...',
    ],
    formations: [
      { motion: 'sweep', rows: [1, 2] },
      { motion: 'sweep', rows: [5, 6], reverse: true },
    ],
  },
  {
    name: 'INVASION',
    tier: 1,
    room: 'formation',
    layout: [
      '.............',
      '22.22.22.....',
      '.............',
      '11.11.11.....',
      '.............',
      '11.11.11.....',
      '.............',
      '11.11.11.....',
    ],
    formations: [{ motion: 'march' }],
  },
  {
    name: 'TIDAL',
    tier: 2,
    room: 'formation',
    layout: [
      '.............',
      '.............',
      '1111111111111',
      '1111111111111',
      '2222222222222',
      '1111111111111',
      '1111111111111',
    ],
    formations: [{ motion: 'sine' }],
  },
  {
    name: 'PINWHEEL',
    tier: 2,
    room: 'formation',
    layout: [
      '......1......',
      '.............',
      '......1......',
      '.............',
      '...1..2..1...',
      '.............',
      '....1.1.1....',
      '.............',
      '.....111.....',
      '.............',
      '.11211#11211.',
      '.............',
      '.....111.....',
      '.............',
      '....1.1.1....',
      '.............',
      '...1..2..1...',
      '.............',
      '......1......',
      '.............',
      '......1......',
    ],
    formations: [{ motion: 'rotate' }],
  },
  {
    name: 'CONVOY',
    tier: 2,
    room: 'formation',
    layout: [
      '.............',
      '#11111#......',
      '.............',
      '......#11111#',
      '.............',
      '#11111#......',
      '.............',
      '......#22222#',
    ],
    formations: [
      { motion: 'sweep', rows: [1, 1] },
      { motion: 'sweep', rows: [3, 3] },
      { motion: 'sweep', rows: [5, 5] },
      { motion: 'sweep', rows: [7, 7] },
    ],
  },
  {
    name: 'GRINDER',
    tier: 3,
    room: 'formation',
    layout: [
      '2222222222222',
      '.............',
      '...3.....3...',
      '.............',
      '...1.....1...',
      '.............',
      '.11#11.11#11.',
      '.............',
      '...1.....1...',
      '.............',
      '...3.....3...',
      '.............',
      '1.1.1.1.1.1.1',
    ],
    formations: [
      { motion: 'rotate', rows: [2, 10], cols: [0, 5] },
      { motion: 'rotate', rows: [2, 10], cols: [7, 12], reverse: true },
    ],
  },
  {
    name: 'LEGION',
    tier: 3,
    room: 'formation',
    layout: [
      '33.33.33.....',
      '.............',
      '22.22.22.....',
      '.............',
      '*1.1*.*1.....',
      '.............',
      '22.22.22.....',
      '.............',
      '11.11.11.....',
    ],
    formations: [{ motion: 'march' }],
  },
  {
    name: 'SERPENT',
    tier: 3,
    room: 'formation',
    layout: [
      '.............',
      '.............',
      '2121212121212',
      '1r1r1r1r1r1r1',
      '2121212121212',
      '.............',
      '.............',
      '.............',
      '.............',
      '....#####....',
    ],
    formations: [
      { motion: 'sine', rows: [2, 4] },
      { motion: 'sweep', rows: [9, 9] },
    ],
  },

  // Elite rooms.
  {
    name: 'POWDER KEG',
    tier: 1,
    room: 'elite',
    layout: [
      '2222222222222',
      '22*22*2*22*22',
      '2222222222222',
      '1111111111111',
      '11*11*1*11*11',
      '1111111111111',
    ],
  },
  {
    name: 'HIVE',
    tier: 1,
    room: 'elite',
    layout: [
      '..rr.....rr..',
      '.r22r...r22r.',
      '.r22r...r22r.',
      '..rr.....rr..',
      '.............',
      '1111111111111',
      '2222222222222',
    ],
  },
  {
    name: 'REACTOR',
    tier: 2,
    room: 'elite',
    layout: [
      '.....#.#.....',
      '...##...##...',
      '..#rrrrrrr#..',
      '..#r*****r#..',
      '..#r*****r#..',
      '..#rrrrrrr#..',
      '...###.###...',
      '.............',
      '22.........22',
    ],
  },
  {
    name: 'SIEGE',
    tier: 2,
    room: 'elite',
    layout: [
      '.............',
      '33.33.33.....',
      '.............',
      'r1.1r.r1.....',
      '.............',
      '22.22.22.....',
      '.............',
      '*1.1*.*1.....',
    ],
    formations: [{ motion: 'march' }],
  },
  {
    name: 'CRUCIBLE',
    tier: 3,
    room: 'elite',
    layout: [
      '3333333333333',
      '3r3r3r3r3r3r3',
      '#2*2*2#2*2*2#',
      '#22222#22222#',
      '#rrrrr#rrrrr#',
      '.............',
      '..###...###..',
      '.............',
      '.............',
      '1111.....1111',
    ],
  },
  {
    name: 'OVERLORD',
    tier: 3,
    room: 'elite',
    layout: [
      '3333333333333',
      '2222222222222',
      '.............',
      '.....#3#.....',
      '.............',
      '....3...3....',
      '.............',
      '...#.1.1.#...',
      '.............',
      '...3.2*2.3...',
      '.............',
      '...#.1.1.#...',
      '.............',
      '....3...3....',
      '.............',
      '.....#3#.....',
      '.............',
      '.............',
      '2222.....2222',
      '1111.....1111',
    ],
    formations: [{ motion: 'rotate', rows: [3, 15] }],
  },
];
