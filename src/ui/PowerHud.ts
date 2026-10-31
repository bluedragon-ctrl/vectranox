import { POWER, POWER_LOOK } from '../config/tuning';
import { TIMED_POWERS } from '../game/powers';
import type { PowerKind, TimedPower } from '../game/types';
import { cssColor } from './dom';

interface Row {
  el: HTMLElement;
  bar: HTMLElement;
  secs: HTMLElement;
  shown: string;
  /** Timer value when the power was granted; stage events can grant other durations. */
  full: number;
  last: number;
}

/** Active powers in the left panel: name, a draining bar and seconds left. */
export class PowerHud {
  private rows = new Map<TimedPower, Row>();
  private none: HTMLElement;

  constructor(root: HTMLElement) {
    this.none = document.createElement('div');
    this.none.className = 'power-none';
    this.none.textContent = 'NONE';
    root.replaceChildren(this.none);
    for (const kind of TIMED_POWERS) {
      const track = span('bar');
      const bar = track.appendChild(document.createElement('i'));
      const secs = span('secs');
      const el = powerRow(kind, track, secs);
      root.append(el);
      this.rows.set(kind, { el, bar, secs, shown: '', full: POWER.kinds[kind].duration, last: 0 });
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

/** A hidden row in the power colour: the power's name, then `parts`. */
function powerRow(kind: PowerKind, ...parts: HTMLElement[]): HTMLElement {
  const look = POWER_LOOK[kind];
  const el = document.createElement('div');
  el.className = 'power hidden';
  el.style.setProperty('--c', cssColor(look.color));
  el.classList.toggle('bad', look.bad);
  const name = document.createElement('span');
  name.textContent = look.label;
  el.append(name, ...parts);
  return el;
}

function span(className: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  return el;
}
