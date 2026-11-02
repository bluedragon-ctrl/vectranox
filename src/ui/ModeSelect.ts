import type { GameMode } from '../config/run';

const LABELS: Readonly<Record<GameMode, string>> = {
  run: 'RUN',
  challenge: 'CHALLENGE',
};

/** The title and end screens' choice between a run and a challenge. Only touches the DOM on change. */
export class ModeSelect {
  private readonly buttons: Record<GameMode, HTMLButtonElement>;
  private shown: boolean | null = null;

  constructor(
    private root: HTMLElement,
    mode: GameMode,
    onPick: (mode: GameMode) => void,
  ) {
    const make = (m: GameMode): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = LABELS[m];
      btn.addEventListener('click', () => {
        // Drop focus so Space/Enter keep starting the game instead of clicking again.
        btn.blur();
        onPick(m);
      });
      return btn;
    };
    this.buttons = { run: make('run'), challenge: make('challenge') };
    root.replaceChildren(this.buttons.run, this.buttons.challenge);
    this.select(mode);
  }

  select(mode: GameMode): void {
    for (const [m, btn] of Object.entries(this.buttons)) btn.classList.toggle('on', m === mode);
  }

  show(visible: boolean): void {
    if (visible === this.shown) return;
    this.shown = visible;
    this.root.classList.toggle('hidden', !visible);
  }
}
