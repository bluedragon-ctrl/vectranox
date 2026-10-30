import { FIELD } from '../config/game';
import type { Game } from '../game/Game';

/** World units of the field's top wall the bar sits below, and its inset from the side walls. */
const BAR = { top: 6, inset: 14 } as const;

type ToClient = (x: number, y: number) => { x: number; y: number };

/**
 * The boss's name and core health, in the empty band along the top of the field. A notch marks each
 * phase's threshold. Rebuilt when the room changes; follows window resizes.
 */
export class BossBar {
  private fight: Game['fight'] = null;
  private readonly fill: HTMLElement;
  private readonly name: HTMLElement;
  private readonly track: HTMLElement;

  constructor(
    private root: HTMLElement,
    private toClient: ToClient,
  ) {
    this.name = root.appendChild(document.createElement('span'));
    this.track = root.appendChild(document.createElement('div'));
    this.fill = this.track.appendChild(document.createElement('i'));
  }

  /** Shows the bar during a boss's fight; `null` hides it. */
  update(game: Game | null): void {
    const fight = game?.state === 'serve' || game?.state === 'play' ? game.fight : null;
    if (fight !== this.fight) this.rebuild(game, fight);
    if (!fight) return;
    const left = this.toClient(BAR.inset, FIELD.height - BAR.top);
    const right = this.toClient(FIELD.width - BAR.inset, FIELD.height - BAR.top);
    this.root.style.left = `${left.x}px`;
    this.root.style.top = `${left.y}px`;
    this.root.style.width = `${right.x - left.x}px`;
    this.root.classList.toggle('shielded', fight.shielded);
    this.fill.style.width = `${(fight.core.hp / fight.core.maxHp) * 100}%`;
  }

  private rebuild(game: Game | null, fight: Game['fight']): void {
    this.fight = fight;
    this.root.classList.toggle('hidden', !fight);
    if (!game || !fight) return;
    this.name.textContent = game.stage.name;
    const notches = fight.def.phases.slice(1).map(({ at }) => {
      const notch = document.createElement('b');
      notch.style.left = `${at * 100}%`;
      return notch;
    });
    this.track.replaceChildren(this.fill, ...notches);
  }
}
