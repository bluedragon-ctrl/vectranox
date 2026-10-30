import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import type { StageTemplate } from '../src/levels/stages';
import { checkRoom, checkRun, roomFile } from '../src/levels/validate';
import { formatRoom } from './format';

const MAIN = 'main';
const ROOMS_DIR = 'src/levels/rooms';
/** Room editor branches; an open PR from one is where the next save goes. */
const BRANCH_PREFIX = 'rooms/';

export interface OpenPr {
  number: number;
  url: string;
  branch: string;
}

export interface RoomFile {
  file: string;
  room: StageTemplate;
}

/** What the editor opens on: the rooms at `commit`, the tip of the open PR or else of main. */
export interface RoomsState {
  commit: string;
  pr: OpenPr | null;
  rooms: RoomFile[];
}

/** `file` is null for a new room; `room` is null to delete it. */
export interface RoomChange {
  file: string | null;
  room: StageTemplate | null;
  /** The commit this edit started from. */
  since: string;
}

export interface SaveResult {
  pr: OpenPr;
  created: boolean;
  /** The rooms were saved, but something after that went wrong. */
  warning?: string;
}

/** A failure the editor should show as it is. */
class SaveError extends Error {}

function run(command: string, args: readonly string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { env: options.env ?? process.env, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) reject(new SaveError(`${command} ${args[0] ?? ''}: ${stderr.trim() || err.message}`));
      else resolve(stdout.trim());
    });
    child.stdin?.end(options.input);
  });
}

const git = (...args: string[]): Promise<string> => run('git', args);

function roomPath(file: string): string {
  if (!/^[a-z0-9-]+\.json$/.test(file)) throw new SaveError(`Bad room file '${file}'`);
  return `${ROOMS_DIR}/${file}`;
}

async function openPr(): Promise<OpenPr | null> {
  const out = await run('gh', ['pr', 'list', '--state', 'open', '--base', MAIN, '--limit', '100', '--json', 'number,url,headRefName']);
  const prs = JSON.parse(out) as { number: number; url: string; headRefName: string }[];
  const pr = prs.find((p) => p.headRefName.startsWith(BRANCH_PREFIX));
  return pr ? { number: pr.number, url: pr.url, branch: pr.headRefName } : null;
}

async function readRooms(commit: string): Promise<RoomFile[]> {
  const paths = (await git('ls-tree', '--name-only', commit, `${ROOMS_DIR}/`)).split('\n').filter(Boolean);
  return Promise.all(
    paths.map(async (path) => ({
      file: path.slice(ROOMS_DIR.length + 1),
      room: JSON.parse(await git('show', `${commit}:${path}`)) as StageTemplate,
    })),
  );
}

async function state(): Promise<RoomsState> {
  await git('fetch', 'origin');
  const pr = await openPr();
  const commit = await git('rev-parse', `origin/${pr?.branch ?? MAIN}`);
  return { commit, pr, rooms: await readRooms(commit) };
}

async function blob(commit: string, path: string): Promise<string | null> {
  return git('rev-parse', `${commit}:${path}`).catch(() => null);
}

/** Every path written, and every path removed, once the changes are applied. */
function plan(rooms: readonly RoomFile[], changes: readonly RoomChange[]): { writes: Map<string, StageTemplate>; removes: Set<string>; result: Map<string, StageTemplate> } {
  const writes = new Map<string, StageTemplate>();
  const removes = new Set<string>();
  const result = new Map(rooms.map(({ file, room }) => [file, room]));
  // Every old file goes first, so a room can take the name another one is giving up.
  for (const { file } of changes) {
    if (file) {
      roomPath(file);
      removes.add(file);
      result.delete(file);
    }
  }
  for (const { room } of changes) {
    if (room) {
      const target = roomFile(room.name);
      if (result.has(target)) throw new SaveError(`A room called ${room.name} already exists.`);
      roomPath(target);
      writes.set(target, room);
      result.set(target, room);
    }
  }
  for (const target of writes.keys()) removes.delete(target);
  return { writes, removes, result };
}

/** Commits on top of `base` with a throwaway index, leaving the working tree alone. */
async function commitRooms(base: string, writes: ReadonlyMap<string, StageTemplate>, removes: ReadonlySet<string>, message: string): Promise<string> {
  const index = join(tmpdir(), `vectranox-editor-${randomUUID()}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const indexed = (...args: string[]): Promise<string> => run('git', args, { env });
  try {
    await indexed('read-tree', base);
    for (const file of removes) await indexed('update-index', '--force-remove', roomPath(file));
    for (const [file, room] of writes) {
      const sha = await run('git', ['hash-object', '-w', '--stdin'], { input: formatRoom(room) });
      await indexed('update-index', '--add', '--cacheinfo', `100644,${sha},${roomPath(file)}`);
    }
    const tree = await indexed('write-tree');
    if (tree === (await git('rev-parse', `${base}^{tree}`))) throw new SaveError('Nothing to save: the rooms are the same as on the branch.');
    return await git('commit-tree', tree, '-p', base, '-m', message);
  } finally {
    await rm(index, { force: true });
  }
}

function displayName(path: string): string {
  return path.slice(ROOMS_DIR.length + 1, -'.json'.length).replace(/-/g, ' ').toUpperCase();
}

function roomList(names: readonly string[]): string {
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} +${names.length - 3} more` : shown;
}

/** The title and body of a PR, from everything it changes since it left main. */
async function describe(commit: string): Promise<{ title: string; body: string }> {
  const diff = await git('diff', '--no-renames', '--name-status', `origin/${MAIN}...${commit}`, '--', ROOMS_DIR);
  const entries = diff.split('\n').filter(Boolean).map((line) => {
    const [status = '', path = ''] = line.split('\t');
    return { status, name: displayName(path) };
  });
  const section = (status: string, heading: string): string[] => {
    const names = entries.filter((e) => e.status === status).map((e) => `- ${e.name}`);
    return names.length > 0 ? [`**${heading}**`, ...names, ''] : [];
  };
  return {
    title: `Edit rooms: ${roomList(entries.map((e) => e.name))}`,
    body: [...section('A', 'New'), ...section('M', 'Changed'), ...section('D', 'Removed'), 'Made with the room editor.'].join('\n'),
  };
}

function branchName(room: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return `${BRANCH_PREFIX}${stamp}-${room.toLowerCase().replace(/ /g, '-')}`;
}

async function save(changes: readonly RoomChange[]): Promise<SaveResult> {
  if (changes.length === 0) throw new SaveError('Nothing to save.');
  const { commit: base, pr, rooms } = await state();
  const { writes, removes, result } = plan(rooms, changes);

  // Someone else's commits are fine unless they touched these same rooms.
  const stale: string[] = [];
  for (const { file, since } of changes) {
    if (file && (await blob(since, roomPath(file))) !== (await blob(base, roomPath(file)))) stale.push(file);
  }
  if (stale.length > 0) throw new SaveError(`Changed on GitHub since you started: ${stale.join(', ')}. Revert those rooms and reload to pick up the new version.`);

  const errors = [
    ...[...writes.values()].flatMap((room) => checkRoom(room).map((p) => ({ ...p, message: `${room.name}: ${p.message}` }))),
    ...checkRun([...result.values()]),
  ].filter((p) => p.level === 'error');
  if (errors.length > 0) throw new SaveError(errors.map((p) => p.message).join(' '));

  const names = [...writes.keys(), ...removes].map((file) => displayName(roomPath(file)));
  const commit = await commitRooms(base, writes, removes, `Edit rooms: ${roomList(names)}`);
  const branch = pr?.branch ?? branchName(names[0] ?? 'rooms');
  await git('push', 'origin', `${commit}:refs/heads/${branch}`);

  if (pr) {
    // The rooms are in the PR by now, so a failure here only leaves its description behind.
    try {
      const { title, body } = await describe(commit);
      await run('gh', ['pr', 'edit', String(pr.number), '--title', title, '--body', body]);
      return { pr, created: false };
    } catch (err) {
      return { pr, created: false, warning: `The PR description was not updated: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  try {
    const { title, body } = await describe(commit);
    const url = await run('gh', ['pr', 'create', '--base', MAIN, '--head', branch, '--title', title, '--body', body]);
    return { pr: { number: Number(url.split('/').pop()), url, branch }, created: true };
  } catch (err) {
    // No PR means nothing was saved, so don't leave its branch behind.
    await git('push', 'origin', '--delete', branch).catch(() => undefined);
    throw err;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

/** Saving pushes with the user's own credentials, so only the editor's own page may ask for it. */
function fromEditor(req: IncomingMessage): boolean {
  const { origin, host } = req.headers;
  return !!origin && new URL(origin).host === host;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method === 'GET') {
      send(res, 200, await state());
    } else if (req.method === 'POST' && fromEditor(req)) {
      send(res, 200, await save(JSON.parse(await readBody(req)) as RoomChange[]));
    } else {
      send(res, 403, { error: 'Not allowed.' });
    }
  } catch (err) {
    send(res, err instanceof SaveError ? 400 : 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

/** The editor's backend: reads rooms from GitHub's copy of the repo and saves them as a PR. */
export function roomsApi(): Plugin {
  return {
    name: 'rooms-api',
    configureServer(server) {
      server.middlewares.use('/api/rooms', (req, res) => void handle(req, res));
    },
  };
}
