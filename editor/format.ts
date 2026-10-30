import type { FormationDef, StageTemplate } from '../src/levels/stages';

/** A room as it goes in its file: one row per line, a formation per line, defaults left out. */
export function formatRoom(room: StageTemplate): string {
  const fields = [`  "name": ${JSON.stringify(room.name)}`, `  "tier": ${room.tier}`];
  if (room.room && room.room !== 'standard') fields.push(`  "room": ${JSON.stringify(room.room)}`);
  if (room.opener) fields.push('  "opener": true');
  fields.push(list('layout', room.layout.map((row) => JSON.stringify(row))));
  const formations = room.formations ?? [];
  if (formations.length > 0) fields.push(list('formations', formations.map(formatFormation)));
  return `{\n${fields.join(',\n')}\n}\n`;
}

function list(key: string, items: readonly string[]): string {
  return `  "${key}": [\n${items.map((item) => `    ${item}`).join(',\n')}\n  ]`;
}

function formatFormation({ motion, rows, cols, reverse }: FormationDef): string {
  const parts = [`"motion": ${JSON.stringify(motion)}`];
  if (rows) parts.push(`"rows": [${rows[0]}, ${rows[1]}]`);
  if (cols) parts.push(`"cols": [${cols[0]}, ${cols[1]}]`);
  if (reverse) parts.push('"reverse": true');
  return `{ ${parts.join(', ')} }`;
}
