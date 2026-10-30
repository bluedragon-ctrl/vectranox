import { BRICK } from '../config/game';
import { RUN, type RoomKind } from '../config/run';
import { Rng } from '../core/rng';
import { TEMPLATES, type StageDef, type StageTemplate } from './stages';

/** Keeps the layout stream apart from the run's other random streams. */
const LAYOUT_SALT = 0x5f3759df;

/**
 * The run's stages, from its seed alone: the same seed always gives the same stages, however the
 * run is played. Each sector fills its `RUN.rooms` slots; templates don't repeat while unused ones
 * are left for the slot.
 */
export function assembleRun(seed: number): StageDef[] {
  const rng = new Rng(seed ^ LAYOUT_SALT);
  const used = new Set<StageTemplate>();
  const stages: StageDef[] = [];
  for (let sector = 1; sector <= RUN.sectors; sector++) {
    for (let number = 1; number <= RUN.stagesPerSector; number++) {
      const room = RUN.rooms[sector - 1]?.[number - 1] ?? 'standard';
      const template = pickTemplate(rng, used, sector, room, number === RUN.stagesPerSector, stages.length === 0);
      used.add(template);
      stages.push(buildStage(template, stages.length, sector, number, rng.next() < RUN.depth.mirrorChance, rng));
    }
  }
  return stages;
}

function pickTemplate(rng: Rng, used: ReadonlySet<StageTemplate>, sector: number, room: RoomKind, last: boolean, first: boolean): StageTemplate {
  const opener = TEMPLATES.find((t) => t.opener);
  if (first && opener) return opener;
  const eligible = TEMPLATES.filter((t) => t.tier <= sector && !t.opener && (t.room ?? 'standard') === room);
  let pool = eligible.filter((t) => !used.has(t));
  if (pool.length === 0) pool = eligible;
  if (last) {
    const top = pool.filter((t) => t.tier === sector);
    if (top.length > 0) pool = top;
  }
  const pick = pool[Math.floor(rng.next() * pool.length)];
  if (!pick) throw new Error(`No ${room} stage template for sector ${sector}`);
  return pick;
}

/** A template as stage `depth` of the run (0-based). `rng` rolls the depth scaling; without it there is none. */
export function buildStage(template: StageTemplate, depth: number, sector: number, number: number, mirror: boolean, rng?: Rng): StageDef {
  const formations = template.formations ?? [];
  return {
    name: template.name,
    room: template.room ?? 'standard',
    layout: scaleLayout(template.layout, depth, mirror, rng),
    formations: mirror ? formations.map((f) => (f.cols ? { ...f, cols: mirrorCols(f.cols) } : f)) : formations,
    formationPace: 1 + RUN.depth.formationPerStage * depth,
    sector,
    number,
  };
}

function mirrorCols([from, to]: readonly [number, number]): [number, number] {
  return [BRICK.cols - 1 - to, BRICK.cols - 1 - from];
}

/** Deeper stages add hits to more bricks; any stage may come mirrored. */
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
