import { STAGE_EVENT_LOOK, STAGE_EVENTS } from '../config/tuning';
import type { StageEventKind } from '../game/types';
import { cssColor } from './dom';

/**
 * Short banner over the playfield when a stage event fires. Timed in game seconds, so it holds
 * while the game is paused.
 */
export class EventBanner {
  private shownAt = -Infinity;
  private visible = false;

  constructor(
    private root: HTMLElement,
    private title: HTMLElement,
    private sub: HTMLElement,
  ) {}

  show(kind: StageEventKind, now: number): void {
    const look = STAGE_EVENT_LOOK[kind];
    this.title.textContent = look.label;
    this.sub.textContent = look.sub;
    this.root.style.setProperty('--c', cssColor(look.color));
    this.shownAt = now;
    // Restart the fade-in even if a banner is already up.
    this.root.classList.add('hidden');
    void this.root.offsetWidth;
    this.root.classList.remove('hidden');
    this.visible = true;
  }

  /** Hides the banner once its time is up; `now` in game seconds. */
  update(now: number): void {
    if (!this.visible || now - this.shownAt < STAGE_EVENTS.bannerTime) return;
    this.hide();
  }

  hide(): void {
    this.visible = false;
    this.root.classList.add('hidden');
  }
}
