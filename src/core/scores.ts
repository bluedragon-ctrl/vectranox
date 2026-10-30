import { readJson, writeJson } from './settings';

/** One finished run on the local table. */
export interface ScoreEntry {
  name: string;
  score: number;
  /** The room the run ended in (`sector-number` on scores from before sectors went). */
  stage: string;
  /** Cleared the whole run. */
  won: boolean;
}

export const NAME_LENGTH = 6;

const TABLE_SIZE = 10;
const FALLBACK_NAME = 'PLAYER';
const KEY = 'vectranox.scores';
const NAME_KEY = 'vectranox.name';

function isEntry(v: unknown): v is ScoreEntry {
  const e = v as Partial<ScoreEntry> | null;
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof e.name === 'string' &&
    typeof e.score === 'number' &&
    Number.isFinite(e.score) &&
    typeof e.stage === 'string' &&
    typeof e.won === 'boolean'
  );
}

export function formatScore(score: number): string {
  return String(score).padStart(6, '0');
}

/** The saved table, best first. */
export function loadScores(): ScoreEntry[] {
  const saved = readJson(KEY);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter(isEntry)
    .sort((a, b) => b.score - a.score)
    .slice(0, TABLE_SIZE);
}

/** The place (0-based) a score would take, or -1 if it misses the table. Ties go below older scores. */
export function rankOf(scores: readonly ScoreEntry[], score: number): number {
  if (score <= 0) return -1;
  const below = scores.findIndex((e) => e.score < score);
  const rank = below === -1 ? scores.length : below;
  return rank < TABLE_SIZE ? rank : -1;
}

/** Saves the entry at its rank and returns the new table. */
export function addScore(scores: readonly ScoreEntry[], entry: ScoreEntry, rank: number): ScoreEntry[] {
  const next = [...scores.slice(0, rank), entry, ...scores.slice(rank)].slice(0, TABLE_SIZE);
  writeJson(KEY, next);
  writeJson(NAME_KEY, entry.name);
  return next;
}

/** What a name field may hold: `[A-Z0-9 ]`, up to 6 characters, no leading spaces. */
export function cleanName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .trimStart()
    .slice(0, NAME_LENGTH);
}

/** The name to save for what was typed. */
export function finalName(raw: string): string {
  return cleanName(raw).trimEnd() || FALLBACK_NAME;
}

/** The name entered last, to prefill the field. */
export function loadLastName(): string {
  const saved = readJson(NAME_KEY);
  return typeof saved === 'string' ? cleanName(saved) : '';
}
