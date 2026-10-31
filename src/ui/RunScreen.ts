import { DRAFT, MODS, PRICES, RARITY_LOOK } from '../config/mods';
import { PALETTE } from '../config/game';
import { ROOM_LABEL, threatPips } from '../config/run';
import { POWER, POWER_LOOK } from '../config/tuning';
import type { Game } from '../game/Game';
import { describeMod } from '../game/mods';
import { cssColor } from './dom';

export type RunAction = { type: 'pick'; index: number } | { type: 'lives' } | { type: 'continue' };

/** Milliseconds the screen ignores input after it opens, so clicks and keys meant for the stage don't choose. */
const ARM_MS = 500;

interface CardSpec {
  name: string;
  desc: string;
  color: number;
  tag: string;
  note: string;
  /** Credits it costs; `null` shows no price. */
  price: number | null;
  disabled: boolean;
  action: RunAction;
}

/**
 * The pick between stages, over the playfield: a card per mod offer, a card for extra lives and a
 * last one to move on. Cards are buttons; main routes the keys here. Rebuilt only when what it
 * shows changes.
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
    const key = `${game.stageIndex}|${game.lives}|${game.credits}|${game.offers.join()}`;
    if (key === this.key) return;
    // Only opening arms it: a card bought must not hold up the next one.
    if (this.key === '') this.shownAt = performance.now();
    this.key = key;
    this.root.classList.remove('hidden');
    this.render(game);
  }

  private render(game: Game): void {
    const cards = game.offers.map((kind, index): CardSpec => {
      const def = MODS[kind];
      const bought = game.bought.has(kind);
      const stacks = game.mods[kind] + (bought ? 0 : 1);
      return {
        name: def.name,
        // What it gives once taken, all stacks together.
        desc: describeMod(kind, game.mods, stacks),
        color: RARITY_LOOK[def.rarity].color,
        tag: RARITY_LOOK[def.rarity].label,
        note: bought ? 'BOUGHT' : def.maxStacks > 1 ? `LV ${stacks}/${def.maxStacks}` : 'UNIQUE',
        price: bought ? null : PRICES[def.rarity],
        disabled: !game.canBuyMod(index),
        action: { type: 'pick', index },
      };
    });
    const livesFull = game.lives >= POWER.maxLives;
    cards.push({
      name: `+${DRAFT.lives} ${DRAFT.lives === 1 ? 'LIFE' : 'LIVES'}`,
      desc: livesFull ? 'LIVES FULL' : 'CAN BE BOUGHT AGAIN',
      color: POWER_LOOK.life.color,
      tag: 'REPAIR',
      note: `${game.lives} → ${Math.min(POWER.maxLives, game.lives + DRAFT.lives)}`,
      price: livesFull ? null : DRAFT.livesCost,
      disabled: !game.canBuyLives,
      action: { type: 'lives' },
    });
    cards.push({
      name: 'CONTINUE',
      desc: game.credits > 0 ? `KEEP ${game.credits} CREDIT${game.credits === 1 ? '' : 'S'} FOR LATER` : 'NO CREDITS LEFT',
      color: PALETTE.cyan,
      tag: '',
      note: '',
      price: null,
      disabled: false,
      action: { type: 'continue' },
    });

    const next = game.stages[game.stageIndex + 1];
    const h1 = document.createElement('h1');
    h1.textContent = game.stage.room === 'boss' ? 'BOSS CACHE' : game.stage.room === 'elite' ? 'ELITE CACHE' : 'CHOOSE';
    const p = document.createElement('p');
    const room = next ? ROOM_LABEL[next.room] : '';
    p.textContent = next ? `NEXT  ROOM ${next.number}${room && `  ${room}`}  ${threatPips(next.threat)}` : '';
    const credits = document.createElement('p');
    credits.className = 'credits';
    credits.textContent = `CREDITS  ${game.credits}`;
    const list = document.createElement('div');
    list.className = 'cards';
    // Number keys for what is on sale, Enter to move on.
    list.append(...cards.map((spec, i) => this.card(spec, spec.action.type === 'continue' ? '↵' : String(i + 1))));
    this.root.replaceChildren(h1, p, credits, list);
  }

  private card(spec: CardSpec, shortcut: string): HTMLButtonElement {
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
    key.textContent = shortcut;
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
    const price = document.createElement('strong');
    price.textContent = spec.price === null ? '' : `${spec.price} CR`;
    btn.append(key, body, meta, price);
    return btn;
  }
}
