import { formatScore, NAME_LENGTH, type ScoreEntry } from '../core/scores';

/** The high scores block. */
export class ScoreBoard {
  constructor(private list: HTMLElement) {}

  /** `scores` is null when the server can't be reached; `highlight` marks the row of the run that just ended. */
  show(scores: readonly ScoreEntry[] | null, highlight = -1): void {
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
