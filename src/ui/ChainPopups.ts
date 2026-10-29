import { FIELD, SCORE } from '../config/game';
import { clamp } from '../core/math';
import type { Game } from '../game/Game';

/** Popups alive at once; a piercing ball can break a row in a few ticks. */
const MAX_POPUPS = 12;
/** World units above the paddle where a finished chain's summary appears. */
const SUMMARY_LIFT = 40;
/** Popup centres stay this far inside the side walls, so edge bricks' popups don't overhang. */
const EDGE_INSET = 24;

type ToClient = (x: number, y: number) => { x: number; y: number };

/**
 * Chain bonus feedback over the playfield: each bonus brick floats its bonus up from where it
 * broke, and a finished chain sums up above the paddle. Pure CSS animation; `setPaused` holds it.
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
      ev.on('brickDestroyed', ({ chain, bonus, x, y }) => {
        if (bonus === 0) return;
        const tier = bonus >= SCORE.chainMax ? 3 : chain >= 5 ? 2 : 1;
        this.spawn('bonus', tier, x, y, `×${chain}`, `+${bonus}`);
      }),
      ev.on('chainEnd', ({ count, total }) => {
        const tier = count >= 8 ? 3 : count >= 5 ? 2 : 1;
        this.spawn('summary', tier, game.paddle.x, game.paddle.y + SUMMARY_LIFT, `CHAIN ×${count}`, `+${total}`);
      }),
    ];
  }

  setPaused(paused: boolean): void {
    this.root.classList.toggle('paused', paused);
  }

  private spawn(kind: string, tier: number, x: number, y: number, label: string, value: string): void {
    while (this.root.childElementCount >= MAX_POPUPS) this.root.firstElementChild?.remove();
    const pos = this.toClient(clamp(x, EDGE_INSET, FIELD.width - EDGE_INSET), y);
    const el = document.createElement('div');
    el.className = `popup ${kind} t${tier}`;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    const small = el.appendChild(document.createElement('span'));
    small.textContent = label;
    const big = el.appendChild(document.createElement('b'));
    big.textContent = value;
    el.addEventListener('animationend', () => el.remove());
    this.root.append(el);
  }
}
