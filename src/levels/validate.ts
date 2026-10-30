import { BRICK, FIELD } from '../config/game';
import { ROOM_LABEL } from '../config/run';
import { BOSS, FORMATION } from '../config/tuning';
import { within } from '../game/formation';
import { BRICK_CODES } from '../game/layout';
import type { BossDef, FormationDef, StageTemplate } from './stages';

/** Rows of bricks that fit above the formation line. */
export const MAX_ROWS = Math.floor((FIELD.height - BRICK.top - FORMATION.line) / BRICK.height);

/** Errors break the game or a run; warnings are likely mistakes the game copes with. */
export interface Problem {
  level: 'error' | 'warning';
  message: string;
}

const error = (message: string): Problem => ({ level: 'error', message });
const warning = (message: string): Problem => ({ level: 'warning', message });

/** A room's file in `src/levels/rooms/`. */
export function roomFile(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.json`;
}

/** The index in `defs` of the formation a brick at this cell joins (the first that fits), or -1. */
export function formationAt(defs: readonly FormationDef[], row: number, col: number): number {
  return defs.findIndex((def) => within(row, def.rows) && within(col, def.cols));
}

function isPinball(ch: string): boolean {
  return ch === 'o' || (ch >= 'A' && ch <= 'Z');
}

function cells(room: StageTemplate): { row: number; col: number; ch: string }[] {
  return room.layout.flatMap((line, row) =>
    [...line].flatMap((ch, col) => (ch === '.' ? [] : [{ row, col, ch }])),
  );
}

function checkLayout(room: StageTemplate): Problem[] {
  const problems: Problem[] = [];
  const { layout } = room;
  if (layout.length === 0 || layout.length > MAX_ROWS) problems.push(error(`Needs 1 to ${MAX_ROWS} rows, has ${layout.length}.`));
  layout.forEach((line, row) => {
    if (line.length !== BRICK.cols) problems.push(error(`Row ${row} has ${line.length} columns, expected ${BRICK.cols}.`));
  });

  const portals = new Map<string, number>();
  let breakable = 0;
  for (const { row, col, ch } of cells(room)) {
    if (ch >= 'A' && ch <= 'Z') {
      portals.set(ch, (portals.get(ch) ?? 0) + 1);
    } else if (ch !== 'o') {
      const code = BRICK_CODES[ch];
      if (!code) problems.push(error(`Unknown brick code '${ch}' at row ${row}, column ${col}.`));
      else if (code.kind !== 'steel') breakable++;
    }
  }
  for (const [letter, count] of portals) {
    if (count !== 2) problems.push(error(`Portal ${letter} needs exactly two ends, has ${count}.`));
  }
  if (breakable === 0) problems.push(error('Needs at least one breakable brick, or the room can never be cleared.'));
  return problems;
}

/**
 * Whether a ball can get from the bottom of the field to the core: through anything breakable and
 * through portals, but not through steel, unless that steel is orbiting and so leaves gaps.
 */
function coreReachable(room: StageTemplate): boolean {
  const defs = room.formations ?? [];
  const at = (row: number, col: number): string | undefined => (col >= 0 && col < BRICK.cols ? (room.layout[row]?.charAt(col) ?? (row >= 0 && row < MAX_ROWS ? '.' : undefined)) : undefined);
  const wall = (row: number, col: number): boolean => at(row, col) === '#' && defs[formationAt(defs, row, col)]?.motion !== 'rotate';
  const ends = cells(room).filter((c) => c.ch >= 'A' && c.ch <= 'Z');

  const seen = new Set<string>();
  const queue = Array.from({ length: BRICK.cols }, (_, col) => ({ row: MAX_ROWS - 1, col }));
  while (queue.length > 0) {
    const cell = queue.pop();
    if (!cell) break;
    const { row, col } = cell;
    const key = `${row},${col}`;
    const ch = at(row, col);
    if (ch === undefined || seen.has(key) || wall(row, col)) continue;
    seen.add(key);
    if (ch === 'c') return true;
    queue.push({ row: row - 1, col }, { row: row + 1, col }, { row, col: col - 1 }, { row, col: col + 1 });
    for (const end of ends) if (end.ch === ch) queue.push({ row: end.row, col: end.col });
  }
  return false;
}

function checkCore(room: StageTemplate): Problem[] {
  const core = cells(room).filter((c) => c.ch === 'c');
  if (core.length === 0) return [error('A boss room needs a core (c).')];
  const rows = core.map((c) => c.row);
  const cols = core.map((c) => c.col);
  const area = (Math.max(...rows) - Math.min(...rows) + 1) * (Math.max(...cols) - Math.min(...cols) + 1);
  const problems = area === core.length ? [] : [error('The core cells must fill a rectangle.')];
  if (!coreReachable(room)) problems.push(error('No ball can reach the core, so the room can never be won: open the steel or add a portal.'));
  return problems;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPair = (value: unknown): boolean => Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number');
const isPhase = (value: unknown): boolean =>
  isRecord(value) && typeof value.at === 'number' && Object.values(value).every((v) => typeof v === 'number' || typeof v === 'string');

/** Whether parsed JSON has a boss block's shape; `checkRoom` then judges its values. */
export function isBossDef(value: unknown): value is BossDef {
  if (!isRecord(value)) return false;
  const { hp, phases, vault } = value;
  if (typeof hp !== 'number' || !Array.isArray(phases) || !phases.every(isPhase)) return false;
  return vault === undefined || (isRecord(vault) && isPair(vault.rows) && isPair(vault.cols));
}

function checkBoss(room: StageTemplate): Problem[] {
  const present = new Set(cells(room).map((c) => BRICK_CODES[c.ch]?.kind));
  if (room.room !== 'boss') {
    const bossOnly = (['core', 'turret', 'spawner', 'phantom'] as const).filter((kind) => present.has(kind));
    return bossOnly.length > 0 ? [error(`Only boss rooms can have these: ${bossOnly.join(', ')}.`)] : [];
  }

  const { boss } = room;
  if (!boss) return [error('A boss room needs a boss block.')];
  const problems = checkCore(room);
  if (!(boss.hp > 0)) problems.push(error('The boss needs hp above 0.'));
  const { phases, vault } = boss;
  if (phases.length === 0 || phases[0]?.at !== 1) problems.push(error('The first boss phase must have at: 1.'));
  phases.forEach((phase, i) => {
    const before = phases[i - 1];
    if (phase.at <= 0 || (before && phase.at >= before.at)) problems.push(error(`Boss phase ${i + 1}: at must be above 0 and below the phase before.`));
    for (const kind of ['turret', 'spawner', 'phantom'] as const) {
      const interval = phase[kind];
      if (interval !== undefined && !(interval > BOSS.windup)) problems.push(error(`Boss phase ${i + 1}: ${kind} must be longer than the ${BOSS.windup} s wind-up.`));
      if (interval !== undefined && !present.has(kind)) problems.push(warning(`Boss phase ${i + 1} uses a ${kind}, but the room has none.`));
    }
  });
  if (vault) {
    problems.push(...checkRange('Vault', 'rows', vault.rows, MAX_ROWS), ...checkRange('Vault', 'columns', vault.cols, BRICK.cols));
    const inside = (c: { row: number; col: number }): boolean => within(c.row, vault.rows) && within(c.col, vault.cols);
    if (!cells(room).some((c) => c.ch >= 'A' && c.ch <= 'Z' && !inside(c))) problems.push(error('A vault needs a portal outside it to throw balls out through.'));
  }
  return problems;
}

function checkRange(label: string, axis: string, range: readonly [number, number] | undefined, size: number): Problem[] {
  if (!range) return [];
  const [from, to] = range;
  const valid = Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from <= to && to < size;
  return valid ? [] : [error(`${label}: ${axis} ${from}–${to} is not a valid range (0–${size - 1}).`)];
}

function checkFormation(room: StageTemplate, def: FormationDef, index: number): Problem[] {
  const label = `Formation ${index + 1}`;
  const problems = [...checkRange(label, 'rows', def.rows, MAX_ROWS), ...checkRange(label, 'columns', def.cols, BRICK.cols)];
  if (!(def.motion in FORMATION.motions)) problems.push(error(`${label}: unknown motion '${def.motion}'.`));

  const defs = room.formations ?? [];
  const all = cells(room);
  const members = all.filter((c) => !isPinball(c.ch) && formationAt(defs, c.row, c.col) === index);
  if (members.length === 0) {
    problems.push(warning(`${label} moves no bricks.`));
    return problems;
  }

  if (def.motion === 'march' && members.every((c) => c.ch === '#')) {
    problems.push(warning(`${label} marches on steel alone, which can't be stopped from reaching the line.`));
  }
  if (def.motion === 'rotate') {
    const taken = new Set(members.map((c) => `${c.row},${c.col}`));
    if (members.some((c) => taken.has(`${c.row + 1},${c.col}`))) {
      problems.push(warning(`${label} rotates bricks in neighbouring rows, which will overlap: keep them on every second row.`));
    }
  }

  const rows = members.map((c) => c.row);
  const top = Math.min(...rows);
  const bottom = def.motion === 'march' ? Infinity : Math.max(...rows);
  if (all.some((c) => isPinball(c.ch) && c.row >= top && c.row <= bottom)) {
    problems.push(warning(`${label} moves through a pinball piece, which stays where it is.`));
  }
  return problems;
}

/** What is wrong with one room on its own. */
export function checkRoom(room: StageTemplate): Problem[] {
  const problems: Problem[] = [];
  if (!/^[A-Z0-9][A-Z0-9 '-]*$/.test(room.name)) problems.push(error('Name needs capitals, digits and spaces.'));
  if (![1, 2, 3].includes(room.tier)) problems.push(error(`Tier must be 1, 2 or 3, is ${String(room.tier)}.`));
  if (room.threat !== undefined && ![1, 2, 3].includes(room.threat)) problems.push(error(`Threat must be 1, 2 or 3, is ${String(room.threat)}.`));
  if (room.room && !(room.room in ROOM_LABEL)) problems.push(error(`Unknown room kind '${String(room.room)}'.`));
  problems.push(...checkLayout(room), ...checkBoss(room));
  const defs = room.formations ?? [];
  if (room.room === 'formation' && defs.length === 0) problems.push(warning('A formation room with nothing moving.'));
  defs.forEach((def, i) => problems.push(...checkFormation(room, def, i)));
  return problems;
}

/** What is wrong with the rooms as a set: every kind a run can roll must have a room. */
export function checkRun(rooms: readonly StageTemplate[]): Problem[] {
  const problems: Problem[] = [];
  const files = new Map<string, string[]>();
  for (const { name } of rooms) files.set(roomFile(name), [...(files.get(roomFile(name)) ?? []), name]);
  for (const names of files.values()) {
    if (names.length > 1) problems.push(error(`Room names clash: ${names.join(', ')}.`));
  }

  for (const kind of Object.keys(ROOM_LABEL)) {
    if (!rooms.some((r) => !r.opener && (r.room ?? 'standard') === kind)) problems.push(error(`No ${kind} room.`));
  }
  return problems;
}
