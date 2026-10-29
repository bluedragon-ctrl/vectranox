import { RUN } from '../config/run';
import { Rng } from '../core/rng';
import { TEMPLATES, type StageDef, type StageTemplate } from './stages';

/** Keeps the layout stream apart from the run's other random streams. */
const LAYOUT_SALT = 0x5f3759df;

/**
 * The run's stages, from its seed alone: the same seed always gives the same stages, however the
 * run is played. Templates don't repeat while unused ones are left for the sector.
 */
export function assembleRun(seed: number): StageDef[] {
  const rng = new Rng(seed ^ LAYOUT_SALT);
  const used = new Set<StageTemplate>();
  const stages: StageDef[] = [];
  for (let sector = 1; sector <= RUN.sectors; sector++) {
    for (let number = 1; number <= RUN.stagesPerSector; number++) {
      const template = pickTemplate(rng, used, sector, number === RUN.stagesPerSector, stages.length === 0);
      used.add(template);
      stages.push({ name: template.name, layout: scaleLayout(template.layout, stages.length, rng), sector, number });
    }
  }
  return stages;
}

function pickTemplate(rng: Rng, used: ReadonlySet<StageTemplate>, sector: number, last: boolean, first: boolean): StageTemplate {
  const opener = TEMPLATES.find((t) => t.opener);
  if (first && opener) return opener;
  const eligible = TEMPLATES.filter((t) => t.tier <= sector && !t.opener);
  let pool = eligible.filter((t) => !used.has(t));
  if (pool.length === 0) pool = eligible;
  if (last) {
    const top = pool.filter((t) => t.tier === sector);
    if (top.length > 0) pool = top;
  }
  const pick = pool[Math.floor(rng.next() * pool.length)];
  if (!pick) throw new Error(`No stage template for sector ${sector}`);
  return pick;
}

/** Deeper stages turn more bricks tough; any stage may come mirrored. */
function scaleLayout(layout: readonly string[], depth: number, rng: Rng): string[] {
  const { toughPerStage, toughMax, hardPerStage, hardMax, mirrorChance } = RUN.depth;
  const tough = Math.min(toughMax, toughPerStage * depth);
  const hard = Math.min(hardMax, hardPerStage * depth);
  const mirror = rng.next() < mirrorChance;
  return layout.map((row) => {
    const cells = [...row].map((ch) => {
      if (ch === '1' && rng.next() < tough) return '2';
      if (ch === '2' && rng.next() < hard) return '3';
      return ch;
    });
    return (mirror ? cells.reverse() : cells).join('');
  });
}
