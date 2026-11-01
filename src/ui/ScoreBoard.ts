import { formatScore, NAME_LENGTH, type ScoreEntry } from '../core/scores';

export type ScoreView = 'world' | 'local';

/** The high scores block: the local table and, with a score server, the online one on a second tab. */
export class ScoreBoard {
  private view: ScoreView = 'local';
  private local: readonly ScoreEntry[] = [];
  private localHighlight = -1;
  private world: readonly ScoreEntry[] | null = null;
  private worldHighlight = -1;

  constructor(
    private list: HTMLElement,
    private tabs: Record<ScoreView, HTMLButtonElement>,
    online: boolean,
  ) {
    tabs.world.parentElement?.classList.toggle('hidden', !online);
    tabs.world.addEventListener('click', () => this.show('world'));
    tabs.local.addEventListener('click', () => this.show('local'));
  }

  /** `highlight` marks the row of the run that just ended. */
  setLocal(scores: readonly ScoreEntry[], highlight = -1): void {
    this.local = scores;
    this.localHighlight = highlight;
    this.render();
  }

  /** `scores` is null while the server can't be reached. */
  setWorld(scores: readonly ScoreEntry[] | null, highlight = -1): void {
    this.world = scores;
    this.worldHighlight = highlight;
    this.render();
  }

  show(view: ScoreView): void {
    this.view = view;
    this.render();
  }

  private render(): void {
    this.tabs.world.classList.toggle('active', this.view === 'world');
    this.tabs.local.classList.toggle('active', this.view === 'local');
    const world = this.view === 'world';
    const scores = world ? this.world : this.local;
    const highlight = world ? this.worldHighlight : this.localHighlight;
    if (!scores || scores.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = scores ? 'NO SCORES YET' : 'SERVER NOT REACHED';
      this.list.replaceChildren(li);
      return;
    }
    this.list.replaceChildren(
      ...scores.map((entry, i) => {
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = entry.name.padEnd(NAME_LENGTH);
        const rank = document.createElement('span');
        rank.append(`${String(i + 1).padStart(2)}. `, name);
        const stage = document.createElement('span');
        stage.className = entry.won ? 'stage won' : 'stage';
        stage.textContent = entry.won ? 'WIN' : entry.stage;
        const points = document.createElement('span');
        points.className = 'pts';
        points.textContent = formatScore(entry.score);
        const li = document.createElement('li');
        li.classList.toggle('new', i === highlight);
        li.append(rank, stage, points);
        return li;
      }),
    );
  }
}
