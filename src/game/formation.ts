import { FIELD } from '../config/game';
import { FORMATION } from '../config/tuning';
import { lerp } from '../core/math';
import type { FormationDef } from '../levels/stages';
import type { Brick } from './types';

const { sweep, march, rotate, sine } = FORMATION.motions;

/**
 * A group of bricks moving together (see `FORMATION`). Every tick works out each brick's place
 * from where it started, so nothing drifts. Bricks stay level and axis-aligned, which keeps the
 * ball's swept collision as it is; a rotating formation orbits its middle.
 */
export class Formation {
  private readonly homes: readonly { x: number; y: number }[];
  private readonly pivotX: number;
  private readonly pivotY: number;
  /** Seconds of motion, scaled by `pace`. */
  private time = 0;
  /** Sideways travel direction: 1 is right. Also the direction of a rotation. */
  private dir: number;
  /** Sideways travel from home. */
  private offset = 0;
  /** How far the formation has come down. */
  private sunk = 0;
  private retreating = false;
  /** Seconds until the next march hop. */
  private beat: number = march.beat;
  /** Travel left in the current hop. */
  private hop = 0;
  /** The current hop is a drop. */
  dropping = false;

  /** `pace` scales the motion's speed. */
  constructor(
    private readonly def: FormationDef,
    readonly bricks: readonly Brick[],
    private readonly pace: number,
  ) {
    this.homes = bricks.map(({ x, y }) => ({ x, y }));
    const xs = bricks.flatMap((br) => [br.x, br.x + br.w]);
    const ys = bricks.flatMap((br) => [br.y, br.y + br.h]);
    this.pivotX = (Math.min(...xs) + Math.max(...xs)) / 2;
    this.pivotY = (Math.min(...ys) + Math.max(...ys)) / 2;
    this.dir = FIELD.width - Math.max(...xs) >= Math.min(...xs) ? 1 : -1;
    if (def.reverse) this.dir = -this.dir;
  }

  /** Whether this formation comes down at all, so a stage with it has a line to defend. */
  get descends(): boolean {
    return this.def.motion === 'march';
  }

  /** Height of its lowest breakable brick. Steel doesn't count: it can't be stopped. */
  get lowest(): number {
    let y = Infinity;
    for (const br of this.bricks) if (br.alive && br.kind !== 'steel') y = Math.min(y, br.y);
    return y;
  }

  /** Reached the line, and isn't already on its way back. */
  get breached(): boolean {
    return this.descends && !this.retreating && this.lowest <= FORMATION.line;
  }

  /** One tick of play. Returns whether a march hop started. */
  update(dt: number): boolean {
    if (this.retreating) {
      this.settle(dt);
      return false;
    }
    this.time += dt * this.pace;
    let hopped = false;
    if (this.def.motion === 'sweep') {
      if (this.travel(sweep.speed * this.pace * dt)) this.dir = -this.dir;
    } else if (this.def.motion === 'march') {
      hopped = this.march(dt);
    }
    this.place();
    return hopped;
  }

  pushBack(): void {
    this.retreating = this.sunk > 0;
    this.hop = 0;
  }

  /** The way back up; runs while the next serve waits as well. */
  settle(dt: number): void {
    if (!this.retreating) return;
    this.sunk = Math.max(0, this.sunk - FORMATION.retreatSpeed * dt);
    this.retreating = this.sunk > 0;
    this.place();
  }

  private march(dt: number): boolean {
    if (this.hop > 0) {
      const step = Math.min(this.hop, march.hopSpeed * dt);
      this.hop -= step;
      if (this.dropping) this.sunk += step;
      else if (this.travel(step)) this.hop = 0;
    }
    this.beat -= dt * this.pace * lerp(march.fury, 1, this.strength());
    if (this.beat > 0) return false;
    this.beat += march.beat;
    this.dropping = this.room() < 1;
    this.hop = this.dropping ? march.drop : march.step;
    if (this.dropping) this.dir = -this.dir;
    return true;
  }

  /** Moves up to `step` sideways. Returns whether that reached the end of its path. */
  private travel(step: number): boolean {
    const room = this.room();
    this.offset += this.dir * Math.min(step, room);
    return room <= step;
  }

  /** Free space ahead of the bricks still alive. */
  private room(): number {
    let min = Infinity;
    let max = -Infinity;
    for (const br of this.bricks) {
      if (!br.alive) continue;
      min = Math.min(min, br.x);
      max = Math.max(max, br.x + br.w);
    }
    if (min > max) return 0;
    return Math.max(0, this.dir > 0 ? FIELD.width - FORMATION.margin - max : min - FORMATION.margin);
  }

  /** Share of the formation's bricks still alive. */
  private strength(): number {
    let alive = 0;
    for (const br of this.bricks) if (br.alive) alive++;
    return alive / this.bricks.length;
  }

  private place(): void {
    const motion = this.def.motion;
    const angle = this.dir * this.time * rotate.rate;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const phase = (this.time / sine.period) * Math.PI * 2;
    this.bricks.forEach((br, i) => {
      const home = this.homes[i];
      if (!home || !br.alive) return;
      if (motion === 'rotate') {
        const dx = home.x + br.w / 2 - this.pivotX;
        const dy = home.y + br.h / 2 - this.pivotY;
        br.x = this.pivotX + dx * cos - dy * sin - br.w / 2;
        br.y = this.pivotY + dx * sin + dy * cos - br.h / 2;
        return;
      }
      br.x = home.x + this.offset;
      br.y = home.y - this.sunk;
      if (motion === 'sine') br.y += sine.height * Math.sin(phase - br.col * sine.wave);
    });
  }
}

/** The stage's formations; bricks outside all of them stand still. A brick joins the first that fits. */
export function buildFormations(defs: readonly FormationDef[], bricks: readonly Brick[], pace: number): Formation[] {
  const free = new Set(bricks);
  const formations: Formation[] = [];
  for (const def of defs) {
    const members = [...free].filter((br) => within(br.row, def.rows) && within(br.col, def.cols));
    for (const br of members) free.delete(br);
    if (members.length > 0) formations.push(new Formation(def, members, pace));
  }
  return formations;
}

export function within(n: number, range?: readonly [number, number]): boolean {
  return !range || (n >= range[0] && n <= range[1]);
}
