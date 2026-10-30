import { DRAFT, MODS, RARITY_LOOK } from '../config/mods';
import { ROOM_LABEL } from '../config/run';
import { POWER } from '../config/tuning';
import type { Game } from '../game/Game';
import { describeMod } from '../game/mods';
import { cssColor } from './dom';

export type RunAction = { type: 'pick'; index: number } | { type: 'lives' };

/** Milliseconds the screen ignores input after it opens, so clicks and keys meant for the stage don't choose. */
const ARM_MS = 500;
const LIFE_COLOR = 0xff7ad9;

interface CardSpec {
  name: string;
  desc: string;
  color: number;
  tag: string;
  note: string;
  disabled: boolean;
  action: RunAction;
}

/**
 * The pick between stages, over the playfield: a card per mod offer and a last card for extra
 * lives. Cards are buttons; main routes the number keys here. Rebuilt only when what it shows changes.
 */
export class RunScreen {
  private key = '';
  private shownAt = 0;

  constructor(
    private root: HTMLElement,
    private onAction: (action: RunAction) => void,
  ) {}

  /** Whether the screen is up and accepts choices yet. */
  get ready(): boolean {
    return this.key !== '' && performance.now() - this.shownAt >= ARM_MS;
  }

  /** Shows the pick while the game is drafting; `null`, or any other state, hides it. */
  update(game: Game | null): void {
    if (!game || game.state !== 'draft') {
      if (this.key === '') return;
      this.key = '';
      this.root.classList.add('hidden');
      this.root.replaceChildren();
      return;
    }
    const key = `${game.stageIndex}|${game.lives}|${game.offers.join()}`;
    if (key === this.key) return;
    this.shownAt = performance.now();
    this.key = key;
    this.root.classList.remove('hidden');
    this.render(game);
  }

  private render(game: Game): void {
    const cards = game.offers.map((kind, index): CardSpec => {
      const def = MODS[kind];
      const stacks = game.mods[kind] + 1;
      return {
        name: def.name,
        // What it gives once taken, all stacks together.
        desc: describeMod(kind, game.mods, stacks),
        color: RARITY_LOOK[def.rarity].color,
        tag: RARITY_LOOK[def.rarity].label,
        note: def.maxStacks > 1 ? `LV ${stacks}/${def.maxStacks}` : 'UNIQUE',
        disabled: false,
        action: { type: 'pick', index },
      };
    });
    cards.push({
      name: `+${DRAFT.lives} LIVES`,
      desc: game.canPickLives ? 'NO MOD THIS TIME' : 'LIVES FULL',
      color: LIFE_COLOR,
      tag: 'REPAIR',
      note: `${game.lives} → ${Math.min(POWER.maxLives, game.lives + DRAFT.lives)}`,
      disabled: !game.canPickLives,
      action: { type: 'lives' },
    });

    const next = game.stages[game.stageIndex + 1];
    const h1 = document.createElement('h1');
    h1.textContent = game.stage.room === 'elite' ? 'ELITE CACHE' : 'CHOOSE';
    const p = document.createElement('p');
    const room = next ? ROOM_LABEL[next.room] : '';
    p.textContent = next ? `NEXT  STAGE ${next.sector}-${next.number}${room && `  ${room}`}` : '';
    const list = document.createElement('div');
    list.className = 'cards';
    list.append(...cards.map((spec, i) => this.card(spec, i + 1)));
    this.root.replaceChildren(h1, p, list);
  }

  private card(spec: CardSpec, n: number): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card';
    btn.disabled = spec.disabled;
    btn.style.setProperty('--c', cssColor(spec.color));
    // Mousedown, like the playfield: the press is the gesture that can lock the pointer again.
    btn.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.ready) return;
      e.preventDefault();
      this.onAction(spec.action);
    });
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = String(n);
    const body = document.createElement('span');
    body.className = 'body';
    const name = document.createElement('b');
    name.textContent = spec.name;
    const desc = document.createElement('small');
    desc.textContent = spec.desc;
    body.append(name, desc);
    const meta = document.createElement('span');
    meta.className = 'meta';
    const tag = document.createElement('em');
    tag.textContent = spec.tag;
    const note = document.createElement('i');
    note.textContent = spec.note;
    meta.append(tag, note);
    btn.append(key, body, meta);
    return btn;
  }
}
