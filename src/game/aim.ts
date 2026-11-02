import { BALL, FIELD } from '../config/game';
import { FOCUS } from '../config/tuning';
import { clamp } from '../core/math';
import { sweepCircle, type SweepHit } from './collision';
import type { Game } from './Game';
import { aim, bounceFlat, CATCH_EDGE, closer, normalizeVelocity, reflect, SKIN, sweepRect, sweepWalls } from './physics';
import type { Ball } from './types';

/*
 * The aim lines shown under focus or the oracle power: where each falling ball will reach the
 * paddle, and where it goes from there. Reads the game; never changes it.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Where a falling ball goes from here: the points it turns at, ending where it reaches the
 * paddle's height. Empty for a caught ball, which is there already. Null if it won't get
 * there (see `FOCUS`). Bounces as `Game.moveBall` does.
 */
export function aimPath(game: Game, b: Ball): Point[] | null {
  if (b.stuck !== null) return [];
  if (b.vy >= 0) return null;
  const floor = game.restY(b.r);
  const speed = Math.hypot(b.vx, b.vy);
  const probe = { x: b.x, y: b.y, r: b.r, vx: b.vx, vy: b.vy };
  const path: Point[] = [];
  for (let i = 0; i < FOCUS.aimBounces; i++) {
    if (probe.y <= floor) return null;
    // Each leg runs down to the paddle's height unless something gets in the way.
    const reach = (floor - probe.y) / probe.vy;
    const dx = probe.vx * reach;
    const dy = probe.vy * reach;

    const { hit, round, portal } = firstContact(game, probe, dx, dy, b.inPortal);
    if (portal) return null;
    if (!hit) {
      path.push({ x: probe.x + dx, y: floor });
      return path;
    }
    probe.x += dx * hit.t + hit.nx * SKIN;
    probe.y += dy * hit.t + hit.ny * SKIN;
    path.push({ x: probe.x, y: probe.y });
    if (round) reflect(probe, hit.nx, hit.ny);
    else bounceFlat(probe, hit.nx, hit.ny);
    normalizeVelocity(probe, speed);
    if (probe.vy >= 0) return null;
  }
  return null;
}

/**
 * Where a ball arriving at `landing` (the end of its `ballPath`) first hits something after
 * leaving the paddle as it stands now, bounced or, with catch, released from where it sticks.
 * Null if the paddle would miss it.
 */
export function aimRebound(game: Game, b: Ball, landing: Point): Point | null {
  const p = game.paddle;
  if (b.stuck === null && Math.abs(landing.x - p.x) >= p.w / 2 + b.r) return null;
  const edge = game.isActive('catch') ? CATCH_EDGE : 1;
  const offset = b.stuck ?? clamp((landing.x - p.x) / (p.w / 2), -edge, edge);
  const probe = { x: landing.x, y: landing.y, r: b.r, vx: 0, vy: 0 };
  aim(probe, offset * BALL.maxBounceAngle, Math.hypot(FIELD.width, FIELD.height));
  const { hit } = firstContact(game, probe, probe.vx, probe.vy, null);
  return hit && { x: probe.x + probe.vx * hit.t, y: probe.y + probe.vy * hit.t };
}

/** What a ball moving by (dx, dy) reaches first, as `Game.moveBall` sees it, for the aim line. `portal`: that's a portal. */
function firstContact(game: Game, ball: Pick<Ball, 'x' | 'y' | 'r'>, dx: number, dy: number, inPortal: number | null): { hit: SweepHit | null; round: boolean; portal: boolean } {
  const { x, y, r } = ball;
  let hit: SweepHit | null = sweepWalls(ball, dx, dy);
  let round = false;
  let portal = false;
  for (const br of game.bricks) {
    if (!br.alive || game.pierces(br)) continue;
    const h = sweepRect(ball, dx, dy, br);
    if (closer(h, hit)) hit = h;
  }
  for (const tg of game.targets) {
    const h = sweepCircle(x, y, dx, dy, tg.x, tg.y, tg.r + r);
    if (closer(h, hit)) {
      hit = h;
      round = true;
    }
  }
  for (const p of game.portals) {
    if (p.id === inPortal) continue;
    const h = sweepCircle(x, y, dx, dy, p.x, p.y, game.portalCapture);
    if (closer(h, hit)) {
      hit = h;
      portal = true;
    }
  }
  return { hit, round, portal };
}
