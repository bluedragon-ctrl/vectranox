import * as THREE from 'three';
import { BRICK, FIELD, PADDLE, PALETTE } from '../src/config/game';
import { FORMATION, PINBALL } from '../src/config/tuning';
import { BRICK_CODES } from '../src/game/layout';
import type { StageTemplate } from '../src/levels/stages';
import { formationAt, MAX_ROWS } from '../src/levels/validate';
import { BRICK_GAP, brickTint, PORTAL_COLORS, TARGET_COLOR } from '../src/render/palette';
import { cssColor } from '../src/ui/dom';

/** Marks each formation's bricks, and its card in the side panel. */
export const FORMATION_COLORS = ['#2de2ff', '#ffd23f', '#ff2a9d', '#2dffb4', '#ff8a2a', '#f2e9ff'];

export interface Cell {
  row: number;
  col: number;
}

export interface FieldOptions {
  /** The formation being edited. */
  selected: number;
  hover: Cell | null;
  /** A rectangle being dragged out. */
  area: { from: Cell; to: Cell } | null;
}

const tint = new THREE.Color();

const cellX = (col: number): number => col * BRICK.width;
const cellY = (row: number): number => BRICK.top + row * BRICK.height;

/** World units from the top of the field, which is how the canvas counts. */
const fromTop = (y: number): number => FIELD.height - y;

/** Fits the canvas to its parent, keeping the field's proportions. */
export function fitField(canvas: HTMLCanvasElement): void {
  const parent = canvas.parentElement;
  if (!parent) return;
  const scale = Math.min(parent.clientWidth / FIELD.width, parent.clientHeight / FIELD.height);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${FIELD.width * scale}px`;
  canvas.style.height = `${FIELD.height * scale}px`;
  canvas.width = Math.round(FIELD.width * scale * dpr);
  canvas.height = Math.round(FIELD.height * scale * dpr);
}

/** The editable cell under a pointer position, or null. */
export function cellAt(canvas: HTMLCanvasElement, clientX: number, clientY: number): Cell | null {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * FIELD.width;
  const y = ((clientY - rect.top) / rect.height) * FIELD.height;
  const col = Math.floor(x / BRICK.width);
  const row = Math.floor((y - BRICK.top) / BRICK.height);
  return col >= 0 && col < BRICK.cols && row >= 0 && row < MAX_ROWS ? { row, col } : null;
}

function drawBackdrop(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = cssColor(PALETTE.bg);
  ctx.fillRect(0, 0, FIELD.width, FIELD.height);

  ctx.strokeStyle = 'rgba(157, 77, 255, 0.16)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let col = 0; col <= BRICK.cols; col++) {
    ctx.moveTo(cellX(col), cellY(0));
    ctx.lineTo(cellX(col), cellY(MAX_ROWS));
  }
  for (let row = 0; row <= MAX_ROWS; row++) {
    ctx.moveTo(0, cellY(row));
    ctx.lineTo(FIELD.width, cellY(row));
  }
  ctx.stroke();

  ctx.strokeStyle = cssColor(PALETTE.red);
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(0, fromTop(FORMATION.line));
  ctx.lineTo(FIELD.width, fromTop(FORMATION.line));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = cssColor(PALETTE.cyan);
  ctx.fillRect((FIELD.width - PADDLE.width) / 2, fromTop(PADDLE.y) - PADDLE.height / 2, PADDLE.width, PADDLE.height);
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.font = '8px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function drawBrick(ctx: CanvasRenderingContext2D, ch: string, row: number, col: number): void {
  const code = BRICK_CODES[ch];
  const inset = BRICK_GAP / 2;
  const look = { kind: code?.kind ?? 'normal', row, hp: code?.hp ?? 1, maxHp: code?.hp ?? 1 };
  ctx.fillStyle = code ? brickTint(look, tint).getStyle() : cssColor(PALETTE.red);
  ctx.fillRect(cellX(col) + inset, cellY(row) + inset, BRICK.width - BRICK_GAP, BRICK.height - BRICK_GAP);
  if (ch !== '1') label(ctx, ch, cellX(col) + BRICK.width / 2, cellY(row) + BRICK.height / 2, '#fff');
}

function drawPiece(ctx: CanvasRenderingContext2D, ch: string, row: number, col: number, pair: number, whole: boolean): void {
  const x = cellX(col) + BRICK.width / 2;
  const y = cellY(row) + BRICK.height / 2;
  const portal = ch !== 'o';
  ctx.beginPath();
  ctx.arc(x, y, portal ? PINBALL.portal.radius : PINBALL.target.radius, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  const color = PORTAL_COLORS[pair % PORTAL_COLORS.length];
  ctx.strokeStyle = !portal ? TARGET_COLOR.getStyle() : whole && color ? color.getStyle() : cssColor(PALETTE.red);
  ctx.stroke();
  if (portal) label(ctx, ch, x, y, '#fff');
}

/** Each formation's bricks outlined in its colour, a rotation's orbit, and the selected one's range. */
function drawFormations(ctx: CanvasRenderingContext2D, room: StageTemplate, selected: number): void {
  const defs = room.formations ?? [];
  const members = defs.map((): Cell[] => []);
  room.layout.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch === '.' || ch === 'o' || (ch >= 'A' && ch <= 'Z')) return;
      members[formationAt(defs, row, col)]?.push({ row, col });
    });
  });

  defs.forEach((def, i) => {
    const cells = members[i] ?? [];
    const color = FORMATION_COLORS[i % FORMATION_COLORS.length] ?? '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = i === selected ? 1.5 : 0.75;
    for (const { row, col } of cells) ctx.strokeRect(cellX(col) + 1, cellY(row) + 1, BRICK.width - 2, BRICK.height - 2);

    if (def.motion === 'rotate' && cells.length > 0) drawOrbit(ctx, cells);
    if (i === selected) {
      const [top, bottom] = def.rows ?? [0, MAX_ROWS - 1];
      const [left, right] = def.cols ?? [0, BRICK.cols - 1];
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(cellX(left), cellY(top), cellX(right + 1) - cellX(left), cellY(bottom + 1) - cellY(top));
      ctx.setLineDash([]);
    }
  });
}

function drawOrbit(ctx: CanvasRenderingContext2D, cells: readonly Cell[]): void {
  const x = (Math.min(...cells.map((c) => cellX(c.col))) + Math.max(...cells.map((c) => cellX(c.col + 1)))) / 2;
  const y = (Math.min(...cells.map((c) => cellY(c.row))) + Math.max(...cells.map((c) => cellY(c.row + 1)))) / 2;
  const reach = Math.max(
    ...cells.map((c) => Math.hypot(cellX(c.col) + BRICK.width / 2 - x, cellY(c.row) + BRICK.height / 2 - y)),
  );
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.arc(x, y, reach, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeRect(x - 1.5, y - 1.5, 3, 3);
}

export function drawField(canvas: HTMLCanvasElement, room: StageTemplate, { selected, hover, area }: FieldOptions): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const scale = canvas.width / FIELD.width;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawBackdrop(ctx);

  const letters = [...new Set(room.layout.join('').replace(/[^A-Z]/g, ''))].sort();
  const text = room.layout.join('');
  room.layout.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch === '.') return;
      if (ch === 'o' || (ch >= 'A' && ch <= 'Z')) {
        drawPiece(ctx, ch, row, col, letters.indexOf(ch), text.split(ch).length === 3);
      } else {
        drawBrick(ctx, ch, row, col);
      }
    });
  });

  drawFormations(ctx, room, selected);

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  if (area) {
    const left = Math.min(area.from.col, area.to.col);
    const top = Math.min(area.from.row, area.to.row);
    const right = Math.max(area.from.col, area.to.col) + 1;
    const bottom = Math.max(area.from.row, area.to.row) + 1;
    ctx.strokeRect(cellX(left), cellY(top), cellX(right) - cellX(left), cellY(bottom) - cellY(top));
  } else if (hover) {
    ctx.strokeRect(cellX(hover.col), cellY(hover.row), BRICK.width, BRICK.height);
  }
}
