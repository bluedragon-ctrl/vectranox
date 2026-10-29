import * as THREE from 'three';
import { PALETTE } from '../config/game';
import { POWER_LOOK } from '../config/tuning';
import type { BrickKind, PowerKind } from '../game/types';

/** Visual gap between neighbouring bricks (world units); bricks draw this much smaller than their cell. */
export const BRICK_GAP = 1.5;

/** Normal bricks are tinted by row, magenta at the top towards cyan. */
const ROW_COLORS = [PALETTE.magenta, 0xe03cff, PALETTE.purple, 0x6c5cff, PALETTE.blue, PALETTE.cyan];
const STEEL_COLOR = 0x9a92c4;
/**
 * Brightest a glass or gold tint may be (linear luminance). Yellow and cyan are far brighter than
 * magenta or purple at full strength and would flood the bloom, so they are dimmed to this.
 */
const MAX_TINT_LUMA = 0.35;

interface BrickLook {
  kind: BrickKind;
  row: number;
  hp: number;
  maxHp: number;
}

export function brickTint(br: BrickLook, out: THREE.Color): THREE.Color {
  if (br.kind === 'steel') return out.setHex(STEEL_COLOR);
  if (br.kind === 'tough') return capBrightness(out.setHex(PALETTE.yellow)).multiplyScalar(0.55 + 0.45 * (br.hp / br.maxHp));
  return capBrightness(out.setHex(ROW_COLORS[br.row % ROW_COLORS.length] ?? PALETTE.magenta));
}

function capBrightness(c: THREE.Color): THREE.Color {
  const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return luma > MAX_TINT_LUMA ? c.multiplyScalar(MAX_TINT_LUMA / luma) : c;
}

/** Linear-space palette colours, shared by materials and effects. */
export const COLORS = {
  magenta: new THREE.Color(PALETTE.magenta),
  cyan: new THREE.Color(PALETTE.cyan),
  purple: new THREE.Color(PALETTE.purple),
  yellow: new THREE.Color(PALETTE.yellow),
} as const;

/** Each power's colour (see `POWER_LOOK`), linear. */
export const POWER_COLORS = Object.fromEntries(
  (Object.keys(POWER_LOOK) as PowerKind[]).map((k) => [k, new THREE.Color(POWER_LOOK[k].color)]),
) as Record<PowerKind, THREE.Color>;

/**
 * Capsule tints: power colours capped like glass bricks, so a light capsule's letter and rim stay
 * under the bloom threshold just as the dark ones do, instead of smearing into a halo.
 */
export const CAPSULE_COLORS = Object.fromEntries(
  (Object.keys(POWER_COLORS) as PowerKind[]).map((k) => [k, capBrightness(POWER_COLORS[k].clone())]),
) as Record<PowerKind, THREE.Color>;

/** Pinball target lamp, linear and capped like glass so a lit bank doesn't flood the bloom. */
export const TARGET_COLOR = capBrightness(new THREE.Color(0x2dffb4));

/** Accretion-disk colour of each portal pair, in layout order (repeats past the end). */
export const PORTAL_COLORS = [PALETTE.purple, PALETTE.cyan, PALETTE.orange].map((hex) => new THREE.Color(hex));
