import { cleanName, finalName, NAME_LENGTH } from '../core/scores';

/** Milliseconds the field ignores input after it opens, so keys mashed at the end of a run don't land in it. */
const ARM_MS = 500;

/** The name field on the end screen, for a run that made the table. */
export class NameEntry {
  private shownAt = 0;

  constructor(
    private root: HTMLFormElement,
    private field: HTMLInputElement,
    private onSubmit: (name: string) => void,
  ) {
    field.maxLength = NAME_LENGTH;
    field.addEventListener('input', () => {
      field.value = cleanName(field.value);
    });
    root.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.ready) this.onSubmit(finalName(field.value));
    });
  }

  /** Whether the field accepts input yet. */
  get ready(): boolean {
    return performance.now() - this.shownAt >= ARM_MS;
  }

  show(name: string): void {
    this.shownAt = performance.now();
    this.root.classList.remove('hidden');
    this.field.value = name;
    this.field.select();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.field.blur();
  }

  /** Puts typing back in the field, after a click elsewhere on the screen took it away. */
  focus(): void {
    this.field.focus();
  }
}
