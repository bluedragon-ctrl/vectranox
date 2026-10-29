const MAX_LINES = 250;

/** Events tagged as system-level get a different colour in the log. */
const SYSTEM_EVENTS = new Set([
  'runStart',
  'stageStart',
  'stageClear',
  'lifeLost',
  'gameOver',
  'runComplete',
  'play',
  'pause',
  'resume',
  'pointerLockFallback',
]);

/** Power-up events, highlighted separately. */
const POWER_EVENTS = new Set(['powerCollect', 'powerEnd']);

function eventClass(type: string): string {
  if (SYSTEM_EVENTS.has(type)) return 'ev sys';
  if (POWER_EVENTS.has(type)) return 'ev pow';
  return type === 'stageEvent' ? 'ev stage' : 'ev';
}

/**
 * Live "hacker terminal" log of game events in the left panel.
 * Lines are queued and flushed once per frame so a burst of events costs one DOM update.
 */
export class EventConsole {
  private queue: HTMLDivElement[] = [];

  constructor(private el: HTMLElement) {}

  log(seconds: number, type: string, payload: unknown): void {
    const line = document.createElement('div');
    line.className = 'line';

    const t = document.createElement('span');
    t.className = 't';
    t.textContent = `[${formatTime(seconds)}] `;

    const ev = document.createElement('span');
    ev.className = eventClass(type);
    ev.textContent = toConstCase(type);

    line.append(t, ev, ` ${formatPayload(payload)}`);
    this.queue.push(line);
  }

  flush(): void {
    if (this.queue.length === 0) return;
    const stick = this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 4;
    this.el.append(...this.queue.splice(0));
    while (this.el.childElementCount > MAX_LINES) this.el.firstElementChild?.remove();
    if (stick) this.el.scrollTop = this.el.scrollHeight;
  }
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
    .map(([k, v]) => `${k}=${typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : String(v)}`)
    .join(' ');
}
