/** CSS colour for a 0xrrggbb number. */
export function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}
