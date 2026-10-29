import { MODS, RARITY_LOOK } from '../config/mods';
import { MOD_KINDS } from '../game/mods';
import type { ModKind } from '../game/types';
import { cssColor } from './dom';

/** The run's mods in the left panel: name in its rarity colour and the stacks held. */
export class ModHud {
  private shown = '';

  constructor(private root: HTMLElement) {
    this.update(Object.fromEntries(MOD_KINDS.map((k) => [k, 0])) as Record<ModKind, number>);
  }

  update(mods: Readonly<Record<ModKind, number>>): void {
    const held = MOD_KINDS.filter((k) => mods[k] > 0);
    const key = held.map((k) => `${k}${mods[k]}`).join();
    if (key === this.shown && this.root.childElementCount > 0) return;
    this.shown = key;
    if (held.length === 0) {
      const none = document.createElement('div');
      none.className = 'power-none';
      none.textContent = 'NONE';
      this.root.replaceChildren(none);
      return;
    }
    this.root.replaceChildren(
      ...held.map((kind) => {
        const def = MODS[kind];
        const row = document.createElement('div');
        row.className = 'mod';
        row.style.setProperty('--c', cssColor(RARITY_LOOK[def.rarity].color));
        row.title = def.describe(def.perStack * mods[kind]);
        const name = document.createElement('span');
        name.textContent = def.name;
        const stacks = document.createElement('span');
        stacks.className = 'stacks';
        stacks.textContent = def.maxStacks > 1 ? `${mods[kind]}/${def.maxStacks}` : '';
        row.append(name, stacks);
        return row;
      }),
    );
  }
}
