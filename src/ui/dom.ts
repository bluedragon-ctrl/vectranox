/** The element with this id; throws if the page lacks it. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

/** CSS colour for a 0xrrggbb number. */
export function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}
