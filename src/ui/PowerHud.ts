import { POWER, POWER_LOOK } from '../config/tuning';
import type { TimedPower } from '../game/types';

interface Row {
  el: HTMLElement;
  bar: HTMLElement;
  secs: HTMLElement;
  shown: string;
  /** Timer value when the power was granted; stage events can grant other durations. */
  full: number;
  last: number;
}

/** Active timed powers in the left panel: name, a draining bar and seconds left. */
export class PowerHud {
  private rows = new Map<TimedPower, Row>();
  private none: HTMLElement;

  constructor(root: HTMLElement) {
    this.none = document.createElement('div');
    this.none.className = 'power-none';
    this.none.textContent = 'NONE';
    root.replaceChildren(this.none);
    for (const kind of Object.keys(POWER.kinds) as (keyof typeof POWER.kinds)[]) {
      const { duration } = POWER.kinds[kind];
      if (duration === 0) continue;
      const look = POWER_LOOK[kind];
      const el = document.createElement('div');
      el.className = 'power hidden';
      el.style.setProperty('--c', `#${look.color.toString(16).padStart(6, '0')}`);
      el.classList.toggle('bad', look.bad);
      const name = document.createElement('span');
      name.textContent = look.label;
      const track = document.createElement('span');
      track.className = 'bar';
      const bar = document.createElement('i');
      track.append(bar);
      const secs = document.createElement('span');
      secs.className = 'secs';
      el.append(name, track, secs);
      root.append(el);
      this.rows.set(kind as TimedPower, { el, bar, secs, shown: '', full: duration, last: 0 });
    }
  }

  update(timers: Readonly<Record<TimedPower, number>>): void {
    let any = false;
    for (const [kind, row] of this.rows) {
      const left = timers[kind];
      const active = left > 0;
      if (left > row.last) row.full = left;
      row.last = left;
      any ||= active;
      row.el.classList.toggle('hidden', !active);
      if (!active) continue;
      const text = left.toFixed(1);
      if (text === row.shown) continue;
      row.shown = text;
      row.secs.textContent = text;
      row.bar.style.width = `${(left / row.full) * 100}%`;
    }
    this.none.classList.toggle('hidden', any);
  }
}
