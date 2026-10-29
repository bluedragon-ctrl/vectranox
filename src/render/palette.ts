import * as THREE from 'three';
import { PALETTE } from '../config/game';
import type { BrickKind } from '../game/types';

/** Visual gap between neighbouring bricks (world units); bricks draw this much smaller than their cell. */
export const BRICK_GAP = 1.5;

/** Normal bricks are tinted by row, magenta at the top towards cyan. */
const ROW_COLORS = [PALETTE.magenta, 0xe03cff, PALETTE.purple, 0x6c5cff, 0x3d8bff, PALETTE.cyan];
const STEEL_COLOR = 0x9a92c4;

export interface BrickLook {
  kind: BrickKind;
  row: number;
  hp: number;
  maxHp: number;
}

export function brickTint(br: BrickLook, out: THREE.Color): THREE.Color {
  if (br.kind === 'steel') return out.setHex(STEEL_COLOR);
  if (br.kind === 'tough') return out.setHex(PALETTE.yellow).multiplyScalar(0.55 + 0.45 * (br.hp / br.maxHp));
  return out.setHex(ROW_COLORS[br.row % ROW_COLORS.length] ?? PALETTE.magenta);
}

/** Linear-space palette colours, shared by materials and effects. */
export const COLORS = {
  bg: new THREE.Color(PALETTE.bg),
  magenta: new THREE.Color(PALETTE.magenta),
  cyan: new THREE.Color(PALETTE.cyan),
  purple: new THREE.Color(PALETTE.purple),
  yellow: new THREE.Color(PALETTE.yellow),
  white: new THREE.Color(PALETTE.white),
} as const;
