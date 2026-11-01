import { FIELD, SCORE } from '../config/game';
import { chainBonus, type Game } from '../game/Game';

/** CSS pixels between the badge and the playfield's right wall, or the panel's left edge. */
const WALL_GAP = 14;

type ToClient = (x: number, y: number) => { x: number; y: number };

/**
 * Chain bonus and target bank feedback: one badge just outside the playfield's bottom-right corner, clear of
 * the ball and paddle; it never goes inside the field. Each bonus brick replaces it with the chain count
 * and that brick's bonus; a finished chain shows its total a little longer. Points shown include the
 * score multiplier, and while it is above ×1 the badge says so. Pure CSS animation; `setPaused` holds it.
 */
export class ChainPopups {
  private unsubscribe: (() => void)[] = [];

  constructor(
    private root: HTMLElement,
    private panel: HTMLElement,
    private toClient: ToClient,
  ) {}

  attach(game: Game): void {
    this.unsubscribe.forEach((off) => off());
    this.root.replaceChildren();
    const ev = game.events;
    this.unsubscribe = [
      ev.on('brickDestroyed', ({ chain, bonus, multiplier }) => {
        if (bonus === 0) return;
        const tier = chainBonus(chain) >= SCORE.chainMax ? 3 : chain >= 5 ? 2 : 1;
        this.show('bonus', tier, `CHAIN ×${chain}`, `+${bonus}`, this.multiTag(multiplier));
      }),
      ev.on('chainEnd', ({ count, total, multiplier }) => {
        const tier = count >= 8 ? 3 : count >= 5 ? 2 : 1;
        this.show('summary', tier, `CHAIN ×${count} TOTAL`, `+${total}`, this.multiTag(multiplier));
      }),
      ev.on('targetBank', ({ multiplier, bonus }) => {
        this.show('summary bank', 1, `TARGET BANK +${bonus}`, `×${multiplier}`, 'MULTIPLIER');
      }),
    ];
  }

  setPaused(paused: boolean): void {
    this.root.classList.toggle('paused', paused);
  }

  /** Says the points were multiplied, when they were. */
  private multiTag(multiplier: number): string | undefined {
    return multiplier > 1 ? `MULTI ×${multiplier}` : undefined;
  }

  private show(kind: string, tier: number, label: string, value: string, tagText?: string): void {
    const el = document.createElement('div');
    el.className = `popup ${kind} t${tier}`;
    const small = el.appendChild(document.createElement('span'));
    small.textContent = label;
    if (tagText) {
      const tag = el.appendChild(document.createElement('i'));
      tag.textContent = tagText;
    }
    const big = el.appendChild(document.createElement('b'));
    big.textContent = value;
    el.addEventListener('animationend', () => el.remove());
    this.root.replaceChildren(el);
    // Placed per popup, so it follows window resizes. A narrow window leaves no room past the
    // wall; then it docks over the side panel instead, level with the field's bottom.
    const pos = this.toClient(FIELD.width, 0);
    const outside = pos.x + WALL_GAP + el.offsetWidth <= window.innerWidth - WALL_GAP;
    this.root.classList.toggle('docked', !outside);
    el.style.left = `${outside ? pos.x + WALL_GAP : this.panel.getBoundingClientRect().left + WALL_GAP}px`;
    el.style.top = `${pos.y}px`;
  }
}
