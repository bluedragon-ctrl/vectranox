import { FIELD, SCORE } from '../config/game';
import type { Game } from '../game/Game';

/** CSS pixels between the playfield's right wall and the badge. */
const WALL_GAP = 14;

type ToClient = (x: number, y: number) => { x: number; y: number };

/**
 * Chain bonus feedback: one badge just outside the playfield's bottom-right corner, clear of
 * the ball and paddle. Each bonus brick replaces it with the chain count and that brick's bonus;
 * a finished chain shows its total a little longer. Pure CSS animation; `setPaused` holds it.
 */
export class ChainPopups {
  private unsubscribe: (() => void)[] = [];

  constructor(
    private root: HTMLElement,
    private toClient: ToClient,
  ) {}

  attach(game: Game): void {
    this.unsubscribe.forEach((off) => off());
    this.root.replaceChildren();
    const ev = game.events;
    this.unsubscribe = [
      ev.on('brickDestroyed', ({ chain, bonus }) => {
        if (bonus === 0) return;
        const tier = bonus >= SCORE.chainMax ? 3 : chain >= 5 ? 2 : 1;
        this.show('bonus', tier, `CHAIN ×${chain}`, `+${bonus}`);
      }),
      ev.on('chainEnd', ({ count, total }) => {
        const tier = count >= 8 ? 3 : count >= 5 ? 2 : 1;
        this.show('summary', tier, `CHAIN ×${count} TOTAL`, `+${total}`);
      }),
    ];
  }

  setPaused(paused: boolean): void {
    this.root.classList.toggle('paused', paused);
  }

  private show(kind: string, tier: number, label: string, value: string): void {
    const el = document.createElement('div');
    el.className = `popup ${kind} t${tier}`;
    const small = el.appendChild(document.createElement('span'));
    small.textContent = label;
    const big = el.appendChild(document.createElement('b'));
    big.textContent = value;
    el.addEventListener('animationend', () => el.remove());
    this.root.replaceChildren(el);
    // Placed per popup, so it follows window resizes. A narrow window leaves no room past the
    // wall; then it tucks inside the corner instead.
    const pos = this.toClient(FIELD.width, 0);
    const width = el.offsetWidth;
    const outside = pos.x + WALL_GAP + width <= window.innerWidth - WALL_GAP;
    el.style.left = `${outside ? pos.x + WALL_GAP : pos.x - WALL_GAP - width}px`;
    el.style.top = `${outside ? pos.y : pos.y - WALL_GAP}px`;
  }
}
