import { BRICK } from '../config/game';
import { RUN, type RoomKind } from '../config/run';
import { Rng } from '../core/rng';
import { TEMPLATES, type StageDef, type StageTemplate } from './stages';

/** Keeps the layout stream apart from the run's other random streams. */
const LAYOUT_SALT = 0x5f3759df;

/**
 * The run's stages, from its seed alone: the same seed always gives the same stages, however the
 * run is played. The first room is a random opener. Each room after it rolls its kind (see `RUN`),
 * then a template of that kind; templates don't repeat while unused ones are left. Bosses come in
 * tier order, the highest one last.
 */
export function assembleRun(seed: number): StageDef[] {
  const rng = new Rng(seed ^ LAYOUT_SALT);
  const used = new Set<StageTemplate>();
  const stages: StageDef[] = [];
  const bosses = TEMPLATES.filter((t) => t.room === 'boss').sort((a, b) => a.tier - b.tier);
  const finalBoss = bosses.pop();
  if (!finalBoss) throw new Error('No boss stage template');
  const openers = TEMPLATES.filter((t) => t.opener);
  for (let depth = 0; depth < RUN.rooms; depth++) {
    const room = rollRoom(rng, stages, bosses.length > 0);
    const opener = depth === 0 ? openers[Math.floor(rng.next() * openers.length)] : undefined;
    const boss = room === 'boss' ? (depth === RUN.rooms - 1 ? finalBoss : bosses.shift()) : undefined;
    const template = opener ?? boss ?? pickTemplate(rng, used, depth, room);
    used.add(template);
    stages.push(buildStage(template, depth, rng.next() < RUN.depth.mirrorChance, rng));
  }
  return stages;
}

/** The kind of the room after `stages`. */
function rollRoom(rng: Rng, stages: readonly StageDef[], bossesLeft: boolean): RoomKind {
  const depth = stages.length;
  if (depth === 0) return 'standard';
  if (depth === RUN.rooms - 1) return 'boss';
  const beforeFinal = depth === RUN.rooms - 2;
  if (bossesLeft && !beforeFinal && rng.next() < chanceSince(RUN.bossChance, stages, 'boss')) return 'boss';
  if (stages[depth - 1]?.room !== 'boss' && rng.next() < chanceSince(RUN.eliteChance, stages, 'elite')) return 'elite';
  return rng.next() < RUN.formationChance ? 'formation' : 'standard';
}

/** The entry of `chances` for the number of rooms since the last room of that kind. */
function chanceSince(chances: readonly number[], stages: readonly StageDef[], room: RoomKind): number {
  const since = stages.length - 1 - stages.map((s) => s.room).lastIndexOf(room);
  return chances[Math.min(since, chances.length - 1)] ?? 0;
}

function pickTemplate(rng: Rng, used: ReadonlySet<StageTemplate>, depth: number, room: RoomKind): StageTemplate {
  const eligible = TEMPLATES.filter((t) => !t.opener && (t.room ?? 'standard') === room);
  const unused = eligible.filter((t) => !used.has(t));
  const pool = unused.length > 0 ? unused : eligible;
  const weights = RUN.tierWeights[Math.min(Math.floor(depth / RUN.bandRooms), RUN.tierWeights.length - 1)];
  const weight = (t: StageTemplate): number => weights?.[t.tier - 1] ?? 0;
  const total = pool.reduce((sum, t) => sum + weight(t), 0);
  // Nothing left of the tiers this deep: any will do.
  if (total === 0) return pool[Math.floor(rng.next() * pool.length)] ?? noTemplate(room);
  let roll = rng.next() * total;
  const pick = pool.find((t) => (roll -= weight(t)) < 0);
  return pick ?? noTemplate(room);
}

function noTemplate(room: RoomKind): never {
  throw new Error(`No ${room} stage template`);
}

/** A template as stage `depth` of the run (0-based). `rng` rolls the depth scaling; without it there is none. */
export function buildStage(template: StageTemplate, depth: number, mirror: boolean, rng?: Rng): StageDef {
  const formations = template.formations ?? [];
  const boss = template.boss ?? null;
  // A boss's vault is given in cells, so bosses always come as drawn.
  const flipped = mirror && !boss;
  return {
    name: template.name,
    room: template.room ?? 'standard',
    layout: scaleLayout(template.layout, depth, flipped, rng),
    formations: flipped ? formations.map((f) => (f.cols ? { ...f, cols: mirrorCols(f.cols) } : f)) : formations,
    formationPace: 1 + RUN.depth.formationPerStage * depth,
    boss,
    threat: template.threat ?? template.tier,
    number: depth + 1,
  };
}

function mirrorCols([from, to]: readonly [number, number]): [number, number] {
  return [BRICK.cols - 1 - to, BRICK.cols - 1 - from];
}

/** Deeper stages turn more bricks tough; any stage may come mirrored. */
function scaleLayout(layout: readonly string[], depth: number, mirror: boolean, rng?: Rng): string[] {
  const { toughPerStage, toughMax, hardPerStage, hardMax } = RUN.depth;
  const tough = Math.min(toughMax, toughPerStage * depth);
  const hard = Math.min(hardMax, hardPerStage * depth);
  return layout.map((row) => {
    const cells = [...row].map((ch) => {
      if (rng && ch === '1' && rng.next() < tough) return '2';
      if (rng && ch === '2' && rng.next() < hard) return '3';
      return ch;
    });
    return (mirror ? cells.reverse() : cells).join('');
  });
}
