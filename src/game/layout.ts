import { BRICK, FIELD } from '../config/game';
import type { Brick, BrickKind } from './types';

const BRICK_CODES: Partial<Record<string, { kind: BrickKind; hp: number }>> = {
  '1': { kind: 'normal', hp: 1 },
  '2': { kind: 'tough', hp: 2 },
  '3': { kind: 'tough', hp: 3 },
  '#': { kind: 'steel', hp: 0 },
};

/** Bricks for a stage layout (see `StageDef`). */
export function parseLayout(layout: readonly string[], nextId: () => number): Brick[] {
  const bricks: Brick[] = [];
  layout.forEach((line, row) => {
    if (line.length !== BRICK.cols) {
      throw new Error(`Stage row ${row} has ${line.length} columns, expected ${BRICK.cols}`);
    }
    for (let col = 0; col < line.length; col++) {
      const ch = line.charAt(col);
      if (ch === '.') continue;
      const code = BRICK_CODES[ch];
      if (!code) throw new Error(`Unknown brick code '${ch}' at row ${row}, col ${col}`);
      bricks.push({
        id: nextId(),
        row,
        col,
        x: col * BRICK.width,
        y: FIELD.height - BRICK.top - (row + 1) * BRICK.height,
        w: BRICK.width,
        h: BRICK.height,
        kind: code.kind,
        hp: code.hp,
        maxHp: code.hp,
        alive: true,
        hitTick: -Infinity,
      });
    }
  });
  return bricks;
}
