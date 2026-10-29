import { POWER, POWER_LOOK } from '../config/tuning';
import type { ChargePower, TimedPower } from '../game/types';

interface Row {
  el: HTMLElement;
  bar: HTMLElement;
  secs: HTMLElement;
  shown: string;
  /** Timer value when the power was granted; stage events can grant other durations. */
  full: number;
  last: number;
}

interface ChargeRow {
  el: HTMLElement;
  pips: HTMLElement[];
  count: HTMLElement;
  shown: number;
}

/**
 * Active powers in the left panel. Timed ones: name, a draining bar and seconds left. Charge
 * ones: name, a pip per charge slot and the count.
 */
export class PowerHud {
  private rows = new Map<TimedPower, Row>();
  private chargeRows = new Map<ChargePower, ChargeRow>();
  private none: HTMLElement;

  constructor(root: HTMLElement) {
    this.none = document.createElement('div');
    this.none.className = 'power-none';
    this.none.textContent = 'NONE';
    root.replaceChildren(this.none);
    for (const kind of Object.keys(POWER.kinds) as (keyof typeof POWER.kinds)[]) {
      const { duration } = POWER.kinds[kind];
      if (duration === 0) continue;
      const el = powerRow(kind);
      const track = document.createElement('span');
      track.className = 'bar';
      const bar = document.createElement('i');
      track.append(bar);
      const secs = document.createElement('span');
      secs.className = 'secs';
      el.append(track, secs);
      root.append(el);
      this.rows.set(kind as TimedPower, { el, bar, secs, shown: '', full: duration, last: 0 });
    }
    const kind: ChargePower = 'detonator';
    const el = powerRow(kind);
    const track = document.createElement('span');
    track.className = 'pips';
    const pips = Array.from({ length: POWER[kind].maxCharges }, () => track.appendChild(document.createElement('i')));
    const count = document.createElement('span');
    count.className = 'secs';
    el.append(track, count);
    root.append(el);
    this.chargeRows.set(kind, { el, pips, count, shown: -1 });
  }

  update(timers: Readonly<Record<TimedPower, number>>, charges: Readonly<Record<ChargePower, number>>): void {
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
    for (const [kind, row] of this.chargeRows) {
      const n = charges[kind];
      any ||= n > 0;
      row.el.classList.toggle('hidden', n === 0);
      if (n === row.shown) continue;
      row.shown = n;
      row.count.textContent = `x${n}`;
      row.pips.forEach((pip, i) => pip.classList.toggle('on', i < n));
    }
    this.none.classList.toggle('hidden', any);
  }
}

/** A hidden row in the power colour, holding the power's name. */
function powerRow(kind: keyof typeof POWER.kinds): HTMLElement {
  const look = POWER_LOOK[kind];
  const el = document.createElement('div');
  el.className = 'power hidden';
  el.style.setProperty('--c', `#${look.color.toString(16).padStart(6, '0')}`);
  el.classList.toggle('bad', look.bad);
  const name = document.createElement('span');
  name.textContent = look.label;
  el.append(name);
  return el;
}
