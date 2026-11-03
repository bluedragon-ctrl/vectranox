import { RUN, type GameMode } from '../config/run';

const CARDS: Readonly<Record<GameMode, { label: string; detail: string }>> = {
  run: { label: 'RUN', detail: `${RUN.rooms} ROOMS\nMODS · BOSSES` },
  challenge: { label: 'CHALLENGE', detail: 'ONE ROOM\nBEAT THE CLOCK · NO MODS' },
};

const HINT = '← → MODE  ·  ENTER START';

/**
 * The title and end screens' menu: a card for a run and one for a challenge, the picked one lit,
 * and a big START button under them. Only touches the DOM on change.
 */
export class ModeSelect {
  private readonly cards: Record<GameMode, HTMLButtonElement>;
  private shown: boolean | null = null;

  constructor(
    private root: HTMLElement,
    mode: GameMode,
    onPick: (mode: GameMode) => void,
    onStart: () => void,
  ) {
    const make = (m: GameMode): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mode-card';
      const label = document.createElement('b');
      label.textContent = CARDS[m].label;
      const detail = document.createElement('span');
      detail.textContent = CARDS[m].detail;
      btn.append(label, detail);
      btn.addEventListener('click', () => {
        // Drop focus so Space/Enter keep starting the game instead of clicking again.
        btn.blur();
        onPick(m);
      });
      return btn;
    };
    this.cards = { run: make('run'), challenge: make('challenge') };

    const modes = document.createElement('div');
    modes.className = 'modes';
    modes.append(this.cards.run, this.cards.challenge);

    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'start';
    start.textContent = 'START';
    start.addEventListener('click', () => {
      start.blur();
      onStart();
    });

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = HINT;

    root.replaceChildren(modes, start, hint);
    this.select(mode);
  }

  select(mode: GameMode): void {
    for (const [m, btn] of Object.entries(this.cards)) {
      btn.classList.toggle('on', m === mode);
      btn.setAttribute('aria-pressed', String(m === mode));
    }
  }

  show(visible: boolean): void {
    if (visible === this.shown) return;
    this.shown = visible;
    this.root.classList.toggle('hidden', !visible);
  }
}
