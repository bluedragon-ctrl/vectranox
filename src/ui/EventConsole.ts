import type { GameEvents } from '../game/events';

const MAX_LINES = 250;

/** Events logged by the UI itself (start, pause, settings) next to the simulation's. */
export type UiEvent = 'play' | 'pause' | 'resume' | 'pointerLockFallback' | 'controlSwitch' | 'settings' | 'audio' | 'track' | 'musicFailed';
type LogEvent = keyof GameEvents | UiEvent;

/** Events tagged as system-level get a different colour in the log. */
const SYSTEM_EVENTS: ReadonlySet<string> = new Set<LogEvent>([
  'runStart',
  'stageStart',
  'stageClear',
  'lifeLost',
  'formationBreach',
  'bossPhase',
  'bossDown',
  'gameOver',
  'runComplete',
  'draftOpen',
  'play',
  'pause',
  'resume',
  'pointerLockFallback',
  'controlSwitch',
]);

/** Power-up events, highlighted separately. */
const POWER_EVENTS: ReadonlySet<string> = new Set<LogEvent>([
  'powerCollect',
  'powerEnd',
  'explosion',
  'targetBank',
  'modBuy',
  'livesBuy',
  'secondWind',
]);

function eventClass(type: string): string {
  if (SYSTEM_EVENTS.has(type)) return 'ev sys';
  if (POWER_EVENTS.has(type)) return 'ev pow';
  return type === 'stageEvent' ? 'ev stage' : 'ev';
}

interface Entry {
  seconds: number;
  type: string;
  payload: unknown;
}

/**
 * Live "hacker terminal" log of game events in the left panel.
 * Entries are queued and flushed once per frame so a burst of events costs one DOM update;
 * only the newest `MAX_LINES` of a burst ever become elements.
 */
export class EventConsole {
  private queue: Entry[] = [];

  constructor(private el: HTMLElement) {}

  log(seconds: number, type: string, payload: unknown): void {
    this.queue.push({ seconds, type, payload });
  }

  /** Call before other DOM writes in the frame: it reads the scroll position. */
  flush(): void {
    if (this.queue.length === 0) return;
    const stick = this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 4;
    this.el.append(...this.queue.splice(0).slice(-MAX_LINES).map(line));
    while (this.el.childElementCount > MAX_LINES) this.el.firstElementChild?.remove();
    if (stick) this.el.scrollTop = this.el.scrollHeight;
  }
}

function line({ seconds, type, payload }: Entry): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'line';

  const t = document.createElement('span');
  t.className = 't';
  t.textContent = `[${formatTime(seconds)}] `;

  const ev = document.createElement('span');
  ev.className = eventClass(type);
  ev.textContent = toConstCase(type);

  div.append(t, ev, ` ${formatPayload(payload)}`);
  return div;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

function toConstCase(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
}

function formatPayload(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '';
  return Object.entries(payload)
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(' ');
}

function formatValue(v: unknown): string {
  if (typeof v === 'number' && !Number.isInteger(v)) return v.toFixed(1);
  // A list of points would print as [object Object]; how many there are is enough.
  if (Array.isArray(v) && typeof v[0] === 'object') return String(v.length);
  return String(v);
}
