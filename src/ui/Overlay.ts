export interface OverlayContent {
  title: string;
  sub?: string;
  /** Show the high scores and options under the text. */
  menu?: boolean;
}

/** Centred banner over the playfield (title, pause, stage, game over). Only touches the DOM on change. */
export class Overlay {
  private current = '';

  constructor(
    private root: HTMLElement,
    private title: HTMLElement,
    private sub: HTMLElement,
  ) {}

  show(content: OverlayContent | null): void {
    const key = content ? `${content.title}\n${content.sub ?? ''}\n${content.menu ?? false}` : '';
    if (key === this.current) return;
    this.current = key;
    this.root.classList.toggle('hidden', content === null);
    this.root.classList.toggle('with-menu', content?.menu === true);
    if (content) {
      this.title.textContent = content.title;
      this.sub.textContent = content.sub ?? '';
    }
  }
}
