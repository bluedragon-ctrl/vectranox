import type { BossDef, FormationDef, StageTemplate } from '../src/levels/stages';

/** A room as it goes in its file: one row per line, a formation or boss phase per line, defaults left out. */
export function formatRoom(room: StageTemplate): string {
  const fields = [`  "name": ${JSON.stringify(room.name)}`, `  "tier": ${room.tier}`];
  if (room.room && room.room !== 'standard') fields.push(`  "room": ${JSON.stringify(room.room)}`);
  if (room.opener) fields.push('  "opener": true');
  fields.push(list('layout', room.layout.map((row) => JSON.stringify(row))));
  const formations = room.formations ?? [];
  if (formations.length > 0) fields.push(list('formations', formations.map(formatFormation)));
  if (room.boss) fields.push(formatBoss(room.boss));
  return `{\n${fields.join(',\n')}\n}\n`;
}

function inline(value: object): string {
  const parts = Object.entries(value).map(([key, v]) => `${JSON.stringify(key)}: ${Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'object' ? inline(v as object) : JSON.stringify(v)}`);
  return `{ ${parts.join(', ')} }`;
}

function formatBoss({ hp, phases, vault }: BossDef): string {
  const fields = [`    "hp": ${hp}`];
  if (vault) fields.push(`    "vault": ${inline(vault)}`);
  fields.push(`    "phases": [\n${phases.map((p) => `      ${inline(p)}`).join(',\n')}\n    ]`);
  return `  "boss": {\n${fields.join(',\n')}\n  }`;
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
