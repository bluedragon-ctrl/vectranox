import { BRICK, FIELD } from '../config/game';
import { BRICK_TYPES, PINBALL } from '../config/tuning';
import type { Brick, BrickKind, Portal, Target } from './types';

export const BRICK_CODES: Partial<Record<string, { kind: BrickKind; hp: number }>> = {
  '1': { kind: 'normal', hp: 1 },
  '2': { kind: 'tough', hp: 2 },
  '3': { kind: 'tough', hp: 3 },
  '#': { kind: 'steel', hp: 0 },
  '*': { kind: 'explosive', hp: 1 },
  r: { kind: 'regen', hp: BRICK_TYPES.regen.hp },
};

export interface StagePieces {
  bricks: Brick[];
  targets: Target[];
  portals: Portal[];
}

/** Bricks and pinball pieces for a stage layout (see `StageDef`). */
export function parseLayout(layout: readonly string[], nextId: () => number): StagePieces {
  const bricks: Brick[] = [];
  const targets: Target[] = [];
  const ends = new Map<string, { x: number; y: number }[]>();
  layout.forEach((line, row) => {
    if (line.length !== BRICK.cols) {
      throw new Error(`Stage row ${row} has ${line.length} columns, expected ${BRICK.cols}`);
    }
    for (let col = 0; col < line.length; col++) {
      const ch = line.charAt(col);
      if (ch === '.') continue;
      const x = col * BRICK.width;
      const y = FIELD.height - BRICK.top - (row + 1) * BRICK.height;
      const cx = x + BRICK.width / 2;
      const cy = y + BRICK.height / 2;
      if (ch === 'o') {
        targets.push({ kind: 'target', id: nextId(), x: cx, y: cy, r: PINBALL.target.radius, lit: false, hitTick: -Infinity });
        continue;
      }
      if (ch >= 'A' && ch <= 'Z') {
        const list = ends.get(ch) ?? [];
        list.push({ x: cx, y: cy });
        ends.set(ch, list);
        continue;
      }
      const code = BRICK_CODES[ch];
      if (!code) throw new Error(`Unknown brick code '${ch}' at row ${row}, col ${col}`);
      bricks.push({
        id: nextId(),
        row,
        col,
        x,
        y,
        px: x,
        py: y,
        w: BRICK.width,
        h: BRICK.height,
        kind: code.kind,
        hp: code.hp,
        maxHp: code.hp,
        alive: true,
        hitTick: -Infinity,
        healTick: -Infinity,
      });
    }
  });

  const portals: Portal[] = [];
  [...ends.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([letter, [a, b, ...rest]], pair) => {
      if (!a || !b || rest.length > 0) throw new Error(`Portal '${letter}' needs exactly two ends`);
      const ia = nextId();
      const ib = nextId();
      const r = PINBALL.portal.radius;
      portals.push({ id: ia, ...a, r, exit: ib, pair, warpTick: -Infinity }, { id: ib, ...b, r, exit: ia, pair, warpTick: -Infinity });
    });
  return { bricks, targets, portals };
}
