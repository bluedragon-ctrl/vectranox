/**
 * Stage templates. A run is assembled from these (see assemble.ts). One string per brick row, top
 * row first, 13 columns.
 * `1` normal · `2` / `3` tough (hits to break) · `#` steel (indestructible) · `.` empty
 * Pinball pieces (see `PINBALL`): `o` target · `A`–`Z` portal, each letter used exactly twice (its two ends).
 *
 * `tier` is the first sector a template can appear in; the last stage of a sector prefers templates
 * of that sector's tier. The `opener` always starts the run.
 */
export interface StageTemplate {
  name: string;
  tier: 1 | 2 | 3;
  opener?: boolean;
  layout: readonly string[];
}

/** One stage of a run: a template after depth scaling. */
export interface StageDef {
  name: string;
  layout: readonly string[];
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
];
