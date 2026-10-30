import { BRICK } from '../src/config/game';
import { ROOM_LABEL, type RoomKind } from '../src/config/run';
import { FORMATION } from '../src/config/tuning';
import type { FormationDef, StageTemplate } from '../src/levels/stages';
import { checkRoom, checkRun, MAX_ROWS, roomFile, type Problem } from '../src/levels/validate';
import type { RoomChange, RoomsState, SaveResult } from './api';
import { cellAt, drawField, fitField, FORMATION_COLORS, type Cell } from './field';
import { formatRoom } from './format';

/** A room in the list. `file` and `base` are null until it is saved; `room` is null once deleted. */
interface Entry {
  file: string | null;
  base: StageTemplate | null;
  room: StageTemplate | null;
  /** The commit `room` was first edited from. */
  since: string;
  undo: StageTemplate[];
  redo: StageTemplate[];
}

type Tool = string;

const DRAFTS_KEY = 'vectranox.editor.drafts';
const ERASE = '.';
const PORTAL = 'portal';
const AREA = 'area';
const EMPTY_ROW = '.'.repeat(BRICK.cols);
const KINDS = Object.keys(ROOM_LABEL) as RoomKind[];
const MOTIONS = Object.keys(FORMATION.motions) as FormationDef['motion'][];

const TOOLS: readonly { tool: Tool; label: string; title: string }[] = [
  { tool: '1', label: '1', title: 'Normal, 1 hit' },
  { tool: '2', label: '2', title: 'Normal, 2 hits' },
  { tool: '3', label: '3', title: 'Normal, 3 hits' },
  { tool: '#', label: '#', title: 'Steel' },
  { tool: '*', label: '*', title: 'Explosive' },
  { tool: 'r', label: 'r', title: 'Regenerating' },
  { tool: 'o', label: 'o', title: 'Pinball target' },
  { tool: PORTAL, label: 'Portal', title: 'Portal end (p); pairs up with the next one placed' },
  { tool: ERASE, label: 'Erase', title: 'Erase (e), or drag with the right button' },
];

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

const canvas = byId<HTMLCanvasElement>('field');
const roomList = byId('room-list');
const filter = byId<HTMLInputElement>('filter');
const toolBar = byId('tools');
const formPanel = byId('form');
const problemPanel = byId('problems');
const hoverLine = byId('hover');
const source = byId('source');
const message = byId('message');
const playButton = byId<HTMLButtonElement>('play');
const saveButton = byId<HTMLButtonElement>('save');
/** Rebuilt with the form, kept here because any edit can enable it. */
let revertButton: HTMLButtonElement | null = null;

let entries: Entry[] = [];
let current: Entry | null = null;
/** The commit the entries were read from. */
let commit = '';
let tool: Tool = '1';
/** Paints the mirrored cell as well. */
let symmetry = false;
/** The formation being edited. */
let selected = 0;
let hover: Cell | null = null;
/** The drag in progress: what it paints, or the corner an area started from. */
let stroke: { ch: string; last: Cell } | { from: Cell; to: Cell } | null = null;
let saving = false;

const isChanged = (e: Entry): boolean => e.room === null || e.base === null || formatRoom(e.room) !== formatRoom(e.base);

/** Rows of a room to the full height of the grid, as cells. */
function gridOf(room: StageTemplate): string[][] {
  return Array.from({ length: MAX_ROWS }, (_, row) => [...(room.layout[row] ?? EMPTY_ROW)]);
}

/** Rows back from the grid, without the empty ones at the bottom. */
function layoutOf(grid: readonly string[][]): string[] {
  const rows = grid.map((cells) => cells.join(''));
  while (rows.length > 1 && rows[rows.length - 1] === EMPTY_ROW) rows.pop();
  return rows;
}

/** The letter for a new portal end: finishing a pair if one is open, else a new pair. */
function nextPortal(grid: readonly string[][]): string {
  const counts = new Map<string, number>();
  for (const ch of grid.flat()) if (ch >= 'A' && ch <= 'Z') counts.set(ch, (counts.get(ch) ?? 0) + 1);
  for (const [letter, count] of counts) if (count === 1) return letter;
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    if (!counts.has(letter)) return letter;
  }
  return 'Z';
}

function setRoom(next: StageTemplate): void {
  if (current) current.room = next;
  saveDrafts();
  refresh();
}

/** Records the room for undo; the edit itself follows with `setRoom`. */
function snapshot(): void {
  if (!current?.room) return;
  current.undo.push(current.room);
  current.redo = [];
}

function change(next: StageTemplate): void {
  snapshot();
  setRoom(next);
}

function step(from: 'undo' | 'redo'): void {
  const room = current?.room;
  const to = from === 'undo' ? 'redo' : 'undo';
  const state = current?.[from].pop();
  if (!current || !room || !state) return;
  current[to].push(room);
  selected = 0;
  setRoom(state);
  renderForm();
}

function paint({ row, col }: Cell, ch: string): void {
  const room = current?.room;
  if (!room) return;
  const grid = gridOf(room);
  const mirrored = BRICK.cols - 1 - col;
  for (const c of symmetry && mirrored !== col ? [col, mirrored] : [col]) {
    const cells = grid[row];
    if (cells) cells[c] = ch === PORTAL ? nextPortal(grid) : ch;
  }
  setRoom({ ...room, layout: layoutOf(grid) });
}

/** Pointer events skip cells on a quick drag, so a stroke paints the whole way between two. */
function paintLine(from: Cell, to: Cell, ch: string): void {
  const steps = Math.max(Math.abs(to.row - from.row), Math.abs(to.col - from.col));
  for (let i = 1; i <= steps; i++) {
    paint({ row: from.row + Math.round(((to.row - from.row) * i) / steps), col: from.col + Math.round(((to.col - from.col) * i) / steps) }, ch);
  }
}

function setFormation(index: number, patch: Partial<FormationDef>): void {
  const room = current?.room;
  if (!room) return;
  const formations = (room.formations ?? []).map((def, i) => (i === index ? clean({ ...def, ...patch }) : def));
  change({ ...room, formations });
}

/** Without the keys that `undefined` or `false` left behind. */
function clean(def: FormationDef): FormationDef {
  const { motion, rows, cols, reverse } = def;
  return { motion, ...(rows ? { rows } : {}), ...(cols ? { cols } : {}), ...(reverse ? { reverse } : {}) };
}

function shiftRange(range: readonly [number, number] | undefined, by: number, size: number): readonly [number, number] | undefined {
  if (!range) return range;
  const [from, to] = range;
  return from + by >= 0 && to + by < size ? [from + by, to + by] : range;
}

/** Moves everything by a cell, wrapping round; formations go along. */
function shift(rows: number, cols: number): void {
  const room = current?.room;
  if (!room) return;
  const grid = gridOf(room);
  const moved = grid.map((_, row) => grid[(row - rows + MAX_ROWS) % MAX_ROWS]?.map((_c, col, line) => line[(col - cols + BRICK.cols) % BRICK.cols] ?? '.') ?? []);
  const formations = room.formations?.map((def) =>
    clean({ ...def, rows: shiftRange(def.rows, rows, MAX_ROWS), cols: shiftRange(def.cols, cols, BRICK.cols) }),
  );
  change({ ...room, layout: layoutOf(moved), ...(formations ? { formations } : {}) });
  renderForm();
}

/** Mirrors left-right, the way the game does. */
function flip(): void {
  const room = current?.room;
  if (!room) return;
  const formations = room.formations?.map((def) => {
    const { cols } = def;
    return cols ? { ...def, cols: [BRICK.cols - 1 - cols[1], BRICK.cols - 1 - cols[0]] as const } : def;
  });
  change({ ...room, layout: room.layout.map((row) => [...row].reverse().join('')), ...(formations ? { formations } : {}) });
  renderForm();
}

function clearRoom(): void {
  const room = current?.room;
  if (room) change({ ...room, layout: [EMPTY_ROW], formations: [] });
  renderForm();
}

function uniqueName(name: string): string {
  const taken = new Set(entries.flatMap((e) => (e.room ? [roomFile(e.room.name)] : [])));
  if (!taken.has(roomFile(name))) return name;
  for (let n = 2; ; n++) {
    const next = `${name} ${n}`;
    if (!taken.has(roomFile(next))) return next;
  }
}

function addRoom(room: StageTemplate): void {
  const entry: Entry = { file: null, base: null, room, since: commit, undo: [], redo: [] };
  entries.push(entry);
  select(entry);
  saveDrafts();
}

function toggleDeleted(): void {
  if (!current) return;
  if (current.room) {
    if (current.base === null) {
      entries = entries.filter((e) => e !== current);
      select(entries[0] ?? null);
      saveDrafts();
      return;
    }
    current.room = null;
  } else {
    current.room = current.base;
  }
  saveDrafts();
  select(current);
}

function revert(): void {
  if (!current?.base) return;
  current.room = current.base;
  current.undo = [];
  current.redo = [];
  saveDrafts();
  select(current);
}

function select(entry: Entry | null): void {
  current = entry;
  selected = 0;
  renderForm();
  refresh();
}

function changes(): RoomChange[] {
  return entries.filter(isChanged).map(({ file, room, since }) => ({ file, room, since }));
}

function saveDrafts(): void {
  const drafts = changes();
  try {
    if (drafts.length > 0) localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    else localStorage.removeItem(DRAFTS_KEY);
  } catch {
    // Drafts are a convenience; without storage they just don't survive a reload.
  }
}

function loadDrafts(): RoomChange[] {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '[]') as RoomChange[];
  } catch {
    return [];
  }
}

function roomsNow(): StageTemplate[] {
  return entries.flatMap((e) => (e.room ? [e.room] : []));
}

function saveProblems(): Problem[] {
  const edited = entries.filter(isChanged).flatMap((e) => {
    const { room } = e;
    return room ? checkRoom(room).map((p) => ({ ...p, message: `${room.name}: ${p.message}` })) : [];
  });
  return [...edited, ...checkRun(roomsNow())].filter((p) => p.level === 'error');
}

function renderTools(): void {
  const button = (label: string, title: string, active: boolean, onClick: () => void): HTMLButtonElement =>
    make('button', { title, onclick: onClick, className: active ? 'active' : '' }, label);
  toolBar.replaceChildren(
    ...TOOLS.map((t) => button(t.label, t.title, tool === t.tool, () => setTool(t.tool))),
    make('span', { className: 'gap' }),
    button('Symmetry', 'Paint both sides at once (m)', symmetry, () => {
      symmetry = !symmetry;
      renderTools();
    }),
    button('Flip', 'Mirror the room left to right', false, flip),
    make('span', { className: 'gap' }),
    button('←', 'Shift left', false, () => shift(0, -1)),
    button('↑', 'Shift up', false, () => shift(-1, 0)),
    button('↓', 'Shift down', false, () => shift(1, 0)),
    button('→', 'Shift right', false, () => shift(0, 1)),
    make('span', { className: 'gap' }),
    button('Undo', 'Ctrl+Z', false, () => step('undo')),
    button('Redo', 'Ctrl+Y', false, () => step('redo')),
    button('Clear', 'Empty the room', false, clearRoom),
  );
}

function setTool(next: Tool): void {
  tool = next;
  renderTools();
}

function renderList(): void {
  const term = filter.value.trim().toUpperCase();
  const groups = KINDS.map((kind) => {
    const items = entries.filter((e) => {
      const room = e.room ?? e.base;
      return room && (room.room ?? 'standard') === kind && room.name.includes(term);
    });
    items.sort((a, b) => (a.room ?? a.base)!.tier - (b.room ?? b.base)!.tier || (a.room ?? a.base)!.name.localeCompare((b.room ?? b.base)!.name));
    if (items.length === 0) return [];
    return [make('h2', {}, `${kind.toUpperCase()} (${items.length})`), ...items.map(listItem)];
  });
  roomList.replaceChildren(...groups.flat());
}

function listItem(entry: Entry): HTMLElement {
  const room = entry.room ?? entry.base;
  const classes = ['room-item'];
  if (entry === current) classes.push('current');
  if (entry.room === null) classes.push('deleted');
  else if (checkRoom(entry.room).some((p) => p.level === 'error')) classes.push('bad');
  else if (isChanged(entry)) classes.push('changed');
  return make(
    'button',
    { className: classes.join(' '), onclick: () => select(entry) },
    make('span', {}, `${isChanged(entry) ? '● ' : ''}${room?.name ?? ''}`),
    make('span', { className: 'tier' }, `T${room?.tier ?? ''}`),
  );
}

function field(labelText: string, input: HTMLElement): HTMLElement {
  return make('div', { className: 'row' }, make('label', {}, labelText), input);
}

function options<T extends string | number>(values: readonly T[], value: T): HTMLOptionElement[] {
  return values.map((v) => make('option', { value: String(v), selected: v === value }, String(v)));
}

function rangeInputs(range: readonly [number, number] | undefined, size: number, onChange: (next: readonly [number, number] | undefined) => void): HTMLElement[] {
  const number = (value: number | undefined): HTMLInputElement =>
    make('input', { type: 'number', min: '0', max: String(size - 1), value: value === undefined ? '' : String(value), placeholder: 'all' });
  const from = number(range?.[0]);
  const to = number(range?.[1]);
  const update = (): void => {
    if (from.value === '' && to.value === '') onChange(undefined);
    else onChange([from.value === '' ? 0 : Number(from.value), to.value === '' ? size - 1 : Number(to.value)]);
  };
  from.onchange = update;
  to.onchange = update;
  return [from, make('span', {}, 'to'), to];
}

function formationCard(def: FormationDef, index: number): HTMLElement {
  const motion = make('select', {}, ...options(MOTIONS, def.motion));
  motion.onchange = () => setFormation(index, { motion: motion.value as FormationDef['motion'] });
  const reverse = make('input', { type: 'checkbox', checked: def.reverse === true });
  reverse.onchange = () => setFormation(index, { reverse: reverse.checked });
  const area = make('button', { title: 'Drag over the grid to set the rows and columns' }, 'Drag area');
  area.onclick = () => {
    selected = index;
    setTool(AREA);
    renderForm();
    refresh();
  };
  const remove = make('button', {}, 'Remove');
  remove.onclick = () => {
    const room = current?.room;
    if (!room) return;
    change({ ...room, formations: room.formations?.filter((_, i) => i !== index) ?? [] });
    selected = 0;
    renderForm();
  };
  const card = make(
    'div',
    { className: index === selected ? 'formation selected' : 'formation' },
    field('Motion', motion),
    field('Rows', make('div', { className: 'row' }, ...rangeInputs(def.rows, MAX_ROWS, (rows) => setFormation(index, { rows })))),
    field('Columns', make('div', { className: 'row' }, ...rangeInputs(def.cols, BRICK.cols, (cols) => setFormation(index, { cols })))),
    make('div', { className: 'row' }, make('label', { className: 'check' }, reverse, 'Reverse'), area, remove),
  );
  card.style.borderLeftColor = FORMATION_COLORS[index % FORMATION_COLORS.length] ?? '';
  card.onclick = () => {
    if (selected === index) return;
    selected = index;
    refresh();
    for (const [i, node] of [...formPanel.querySelectorAll('.formation')].entries()) node.classList.toggle('selected', i === index);
  };
  return card;
}

/** The side form. Only rebuilt when its shape changes, so typing keeps the focus. */
function renderForm(): void {
  const room = current?.room ?? null;
  if (!current) {
    formPanel.replaceChildren();
    return;
  }
  if (!room) {
    formPanel.replaceChildren(make('p', {}, `${current.base?.name ?? ''} will be deleted on save.`), make('button', { onclick: toggleDeleted }, 'Restore'));
    return;
  }

  const name = make('input', { type: 'text', value: room.name });
  name.oninput = () => {
    const at = name.selectionStart;
    name.value = name.value.toUpperCase();
    name.setSelectionRange(at, at);
    if (current?.room) change({ ...current.room, name: name.value });
  };
  const tier = make('select', {}, ...options([1, 2, 3], room.tier));
  tier.onchange = () => current?.room && change({ ...current.room, tier: Number(tier.value) as StageTemplate['tier'] });
  const kind = make('select', {}, ...options(KINDS, room.room ?? 'standard'));
  kind.onchange = () => {
    if (!current?.room) return;
    const { room: _old, ...rest } = current.room;
    change(kind.value === 'standard' ? rest : { ...rest, room: kind.value as RoomKind });
  };
  const opener = make('input', { type: 'checkbox', checked: room.opener === true });
  opener.onchange = () => {
    if (!current?.room) return;
    const { opener: _old, ...rest } = current.room;
    change(opener.checked ? { ...rest, opener: true } : rest);
  };

  const add = make('button', {}, 'Add formation');
  add.onclick = () => {
    const edited = current?.room;
    if (!edited) return;
    const formations = [...(edited.formations ?? []), { motion: 'sweep' as const }];
    selected = formations.length - 1;
    change({ ...edited, formations });
    renderForm();
  };

  revertButton = make('button', { onclick: revert, disabled: !current.base || !isChanged(current) }, 'Revert');
  formPanel.replaceChildren(
    field('Name', name),
    field('Tier', tier),
    field('Kind', kind),
    make('label', { className: 'check' }, opener, 'Always opens the run'),
    make(
      'div',
      { className: 'row actions' },
      make('button', { onclick: () => addRoom({ ...room, name: uniqueName(`${room.name} COPY`), opener: false }) }, 'Duplicate'),
      revertButton,
      make('button', { onclick: toggleDeleted }, 'Delete'),
    ),
    make('h2', {}, 'FORMATIONS'),
    ...(room.formations ?? []).map(formationCard),
    add,
  );
}

function renderProblems(): void {
  const room = current?.room;
  const problems = [...(room ? checkRoom(room) : []), ...checkRun(roomsNow())];
  problemPanel.replaceChildren(
    make('h2', {}, 'CHECKS'),
    ...(problems.length > 0
      ? problems.map((p) => make('p', { className: p.level }, p.message))
      : [make('p', { className: 'ok' }, 'All good.')]),
  );
}

function refresh(): void {
  const room = current?.room ?? current?.base;
  if (room) {
    const area = stroke && 'from' in stroke ? stroke : null;
    drawField(canvas, room, { selected, hover, area });
  }
  renderList();
  renderProblems();
  const count = entries.filter(isChanged).length;
  const errors = saveProblems();
  if (revertButton) revertButton.disabled = !current?.base || !isChanged(current);
  playButton.disabled = !current?.room || checkRoom(current.room).some((p) => p.level === 'error');
  saveButton.disabled = saving || count === 0 || errors.length > 0;
  saveButton.textContent = saving ? 'Saving…' : count > 0 ? `Save ${count} room${count === 1 ? '' : 's'} to PR` : 'Save';
  saveButton.title = errors[0]?.message ?? '';
}

function pointerMove(e: PointerEvent): void {
  const cell = cellAt(canvas, e.clientX, e.clientY);
  hover = cell;
  hoverLine.textContent = cell ? `row ${cell.row} · column ${cell.col}` : '';
  if (cell && stroke) {
    if ('from' in stroke) {
      stroke.to = cell;
    } else {
      paintLine(stroke.last, cell, stroke.ch);
      stroke.last = cell;
    }
  }
  const room = current?.room ?? current?.base;
  if (room) drawField(canvas, room, { selected, hover, area: stroke && 'from' in stroke ? stroke : null });
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  const cell = cellAt(canvas, e.clientX, e.clientY);
  if (!cell || !current?.room) return;
  canvas.setPointerCapture(e.pointerId);
  if (tool === AREA && e.button === 0) {
    stroke = { from: cell, to: cell };
    return;
  }
  snapshot();
  const ch = e.button === 2 ? ERASE : tool;
  paint(cell, ch);
  // Each portal end is a click of its own.
  stroke = ch === PORTAL ? null : { ch, last: cell };
});
canvas.addEventListener('pointermove', pointerMove);
canvas.addEventListener('pointerup', () => {
  if (stroke && 'from' in stroke) {
    const { from, to } = stroke;
    stroke = null;
    setFormation(selected, {
      rows: [Math.min(from.row, to.row), Math.max(from.row, to.row)],
      cols: [Math.min(from.col, to.col), Math.max(from.col, to.col)],
    });
    setTool('1');
    renderForm();
    return;
  }
  stroke = null;
});
canvas.addEventListener('pointerleave', () => {
  hover = null;
  hoverLine.textContent = '';
  refresh();
});

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') step(e.shiftKey ? 'redo' : 'undo');
    else if (e.key === 'y') step('redo');
    else return;
    e.preventDefault();
    return;
  }
  const key = e.key;
  if (TOOLS.some((t) => t.tool === key && key !== ERASE)) setTool(key);
  else if (key === 'p') setTool(PORTAL);
  else if (key === 'e' || key === '.') setTool(ERASE);
  else if (key === 'm') {
    symmetry = !symmetry;
    renderTools();
  }
});

window.addEventListener('resize', () => {
  fitField(canvas);
  refresh();
});

filter.addEventListener('input', renderList);
byId('new-room').addEventListener('click', () => addRoom({ name: uniqueName('NEW ROOM'), tier: 1, layout: [EMPTY_ROW] }));

playButton.addEventListener('click', () => {
  if (current?.room) window.open(`/?room=${encodeURIComponent(JSON.stringify(current.room))}`, '_blank');
});

saveButton.addEventListener('click', () => void save());

function showMessage(text: string | Node, bad = false): void {
  message.replaceChildren(text);
  message.classList.toggle('bad', bad);
}

async function api<T>(init?: RequestInit): Promise<T> {
  const res = await fetch('/api/rooms', init);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
  return data;
}

async function save(): Promise<void> {
  saving = true;
  showMessage('Saving…');
  refresh();
  try {
    const { pr, created } = await api<SaveResult>({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes()) });
    for (const entry of entries) entry.room = entry.base;
    saveDrafts();
    await load(current?.room?.name);
    const link = make('a', { href: pr.url, target: '_blank', rel: 'noreferrer' }, `PR #${pr.number}`);
    showMessage(make('span', {}, created ? 'Opened ' : 'Updated ', link));
  } catch (err) {
    showMessage(err instanceof Error ? err.message : String(err), true);
  } finally {
    saving = false;
    refresh();
  }
}

/** Reads the rooms and lays any unsaved drafts back over them. */
async function load(open?: string): Promise<void> {
  const state = await api<RoomsState>();
  commit = state.commit;
  entries = state.rooms.map(({ file, room }) => ({ file, base: room, room, since: commit, undo: [], redo: [] }));
  for (const { file, room, since } of loadDrafts()) {
    const entry = entries.find((e) => e.file === file);
    if (entry) Object.assign(entry, { room, since });
    else if (room) entries.push({ file: null, base: null, room, since, undo: [], redo: [] });
  }
  saveDrafts();
  source.replaceChildren(
    ...(state.pr
      ? ['adding to ', make('a', { href: state.pr.url, target: '_blank', rel: 'noreferrer' }, `PR #${state.pr.number}`)]
      : ['from main']),
  );
  const named = entries.find((e) => e.room?.name === open);
  select(named ?? entries.find((e) => e.room?.opener) ?? entries[0] ?? null);
}

renderTools();
fitField(canvas);
load().catch((err: unknown) => showMessage(err instanceof Error ? err.message : String(err), true));
