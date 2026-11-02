import type { GameMode } from '../config/run';
import { isEntry, type ScoreEntry } from './scores';

/** The score Worker. Unset, the game only has the local table. */
const API = import.meta.env.VITE_SCORES_URL as string | undefined;
const TIMEOUT_MS = 5000;
/** Each mode's table on the server. */
const PATHS: Readonly<Record<GameMode, string>> = {
  run: '/scores',
  challenge: '/challenge-scores',
};

export const ONLINE_SCORES = Boolean(API);

/** What the server made of a run. */
export interface SubmitResult {
  /** The run's place (0-based) among all scores, on or off the table. */
  rank: number;
  scores: ScoreEntry[];
}

/** The body of a call that worked, or null: no game feature waits on the network or fails with it. */
async function call(mode: GameMode, init?: RequestInit): Promise<Record<string, unknown> | null> {
  if (!API) return null;
  try {
    const res = await fetch(`${API}${PATHS[mode]}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function entries(v: unknown): ScoreEntry[] | null {
  return Array.isArray(v) ? v.filter(isEntry) : null;
}

/** The mode's online table, best first, or null if it can't be reached. */
export async function fetchScores(mode: GameMode): Promise<ScoreEntry[] | null> {
  return entries((await call(mode))?.scores);
}

/** Adds a game to the mode's online table; null if it didn't get there. */
export async function submitScore(mode: GameMode, entry: ScoreEntry): Promise<SubmitResult | null> {
  const body = await call(mode, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  const scores = entries(body?.scores);
  return scores && typeof body?.rank === 'number' ? { rank: body.rank, scores } : null;
}
