/** The online high scores: `GET /scores` reads the table, `POST /scores` adds a run to it. */

/** The parts of Cloudflare's D1 API used here. */
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { last_row_id: number } }>;
}

interface Env {
  ALLOWED_ORIGINS: string;
  DB: { prepare(sql: string): D1Statement };
  SUBMIT_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

interface ScoreRow {
  name: string;
  score: number;
  stage: string;
  won: number;
}

const TABLE_SIZE = 10;
/** Well past any real run; stops only absurd values. */
const MAX_SCORE = 100_000_000;
/** One to six characters of `[A-Z0-9 ]`, no space at either end. */
const NAME = /^[A-Z0-9](?:[A-Z0-9 ]{0,4}[A-Z0-9])?$/;
/** The room number a run ended in. */
const STAGE = /^[1-9][0-9]?$/;

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  return origin && env.ALLOWED_ORIGINS.split(',').includes(origin) ? origin : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
}

function json(body: unknown, origin: string | null, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  });
}

async function topScores(env: Env): Promise<{ name: string; score: number; stage: string; won: boolean }[]> {
  const { results } = await env.DB.prepare('SELECT name, score, stage, won FROM scores ORDER BY score DESC, id ASC LIMIT ?')
    .bind(TABLE_SIZE)
    .all<ScoreRow>();
  return results.map((row) => ({ ...row, won: row.won === 1 }));
}

async function submit(request: Request, env: Env, origin: string): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await env.SUBMIT_LIMIT.limit({ key: ip });
  if (!success) return json({ error: 'rate limited' }, origin, 429);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const { name, score, stage, won } = body ?? {};
  if (
    typeof name !== 'string' ||
    !NAME.test(name) ||
    typeof score !== 'number' ||
    !Number.isSafeInteger(score) ||
    score <= 0 ||
    score > MAX_SCORE ||
    typeof stage !== 'string' ||
    !STAGE.test(stage) ||
    typeof won !== 'boolean'
  ) {
    return json({ error: 'bad score' }, origin, 400);
  }

  const { meta } = await env.DB.prepare('INSERT INTO scores (name, score, stage, won, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(name, score, stage, won ? 1 : 0, Date.now())
    .run();
  const above = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE score > ? OR (score = ? AND id < ?)')
    .bind(score, score, meta.last_row_id)
    .first<{ n: number }>();
  return json({ rank: above?.n ?? 0, scores: await topScores(env) }, origin, 201);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request, env);
    if (new URL(request.url).pathname !== '/scores') return json({ error: 'not found' }, origin, 404);

    switch (request.method) {
      case 'OPTIONS':
        return new Response(null, {
          status: 204,
          headers: { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', ...corsHeaders(origin) },
        });
      case 'GET':
        return json({ scores: await topScores(env) }, origin);
      case 'POST':
        // Keeps other sites from posting; a script can still fake the header.
        if (!origin) return json({ error: 'forbidden' }, origin, 403);
        return submit(request, env, origin);
      default:
        return json({ error: 'method not allowed' }, origin, 405);
    }
  },
};
