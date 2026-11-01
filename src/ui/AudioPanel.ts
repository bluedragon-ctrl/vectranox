import { AUDIO } from '../config/audio';
import type { AudioSettings } from '../core/settings';

type Level = 'music' | 'sfx';
type Channel = 'musicOn' | 'sfxOn';

const LEVELS: { key: Level; channel: Channel; label: string; hotkey: string }[] = [
  { key: 'music', channel: 'musicOn', label: 'MUSIC', hotkey: 'M' },
  { key: 'sfx', channel: 'sfxOn', label: 'SFX', hotkey: 'F' },
];

/**
 * Audio settings in the menu: for music and for effects, a name that switches the channel on and
 * off and a segmented slider for its volume (click or drag along it, or use the mouse wheel).
 * Below them the current music track, which skips when clicked.
 */
export class AudioPanel {
  private syncs: (() => void)[] = [];
  private track: HTMLButtonElement;
  private trackName: HTMLSpanElement;
  private playing: string | null = null;
  private waiting = false;

  constructor(
    root: HTMLElement,
    private settings: AudioSettings,
    private onChange: (settings: AudioSettings) => void,
    onSkip: () => void,
  ) {
    const rows: HTMLElement[] = LEVELS.map((opt) => this.slider(opt.key, opt.channel, opt.label, opt.hotkey));

    this.track = document.createElement('button');
    this.track.type = 'button';
    this.track.className = 'toggle track';
    this.track.title = 'Next track';
    const name = document.createElement('span');
    name.textContent = 'TRACK';
    this.trackName = document.createElement('span');
    this.trackName.className = 'val';
    this.track.append(name, this.trackName);
    this.track.addEventListener('click', () => {
      this.track.blur();
      onSkip();
    });
    rows.push(this.track);
    root.replaceChildren(...rows);
    this.syncs.push(() => this.syncTrack());
  }

  /** Shows the playing track; null means there is nothing to play. `waiting`: not started yet. */
  setTrack(name: string | null, waiting = false): void {
    this.playing = name;
    this.waiting = waiting;
    this.syncTrack();
  }

  toggle(channel: Channel): void {
    this.settings[channel] = !this.settings[channel];
    this.changed();
  }

  private syncTrack(): void {
    const name = this.playing;
    const idle = this.waiting || !this.settings.musicOn;
    this.trackName.textContent = name === null ? 'NONE' : idle ? '--' : `${name} »`;
    this.track.disabled = name === null || idle;
    this.track.classList.toggle('on', name !== null && !idle);
  }

  private changed(): void {
    this.syncs.forEach((sync) => sync());
    this.onChange({ ...this.settings });
  }

  private set(key: Level, value: number): void {
    const v = Math.max(0, Math.min(AUDIO.steps, value));
    if (v === this.settings[key]) return;
    this.settings[key] = v;
    this.changed();
  }

  private slider(key: Level, channel: Channel, label: string, hotkey: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'level';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'toggle';
    name.textContent = `${label} (${hotkey})`;
    name.addEventListener('click', () => {
      // Drop focus so Space/Enter keep starting the game instead of re-toggling.
      name.blur();
      this.toggle(channel);
    });
    const segs = document.createElement('div');
    segs.className = 'segs';
    segs.setAttribute('role', 'slider');
    segs.setAttribute('aria-label', `${label} volume`);
    segs.setAttribute('aria-valuemin', '0');
    segs.setAttribute('aria-valuemax', String(AUDIO.steps));
    const cells = Array.from({ length: AUDIO.steps }, () => segs.appendChild(document.createElement('i')));
    const value = document.createElement('span');
    value.className = 'val';
    row.append(name, segs, value);

    // Each segment's right half rounds up, so the far left is 0 and the far right is full.
    const fromPointer = (e: PointerEvent) => {
      const rect = segs.getBoundingClientRect();
      this.set(key, Math.round(((e.clientX - rect.left) / rect.width) * AUDIO.steps));
    };
    segs.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      segs.setPointerCapture(e.pointerId);
      fromPointer(e);
    });
    segs.addEventListener('pointermove', (e) => {
      if (segs.hasPointerCapture(e.pointerId)) fromPointer(e);
    });
    segs.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.set(key, this.settings[key] + (e.deltaY < 0 ? 1 : -1));
      },
      { passive: false },
    );

    const sync = () => {
      const level = this.settings[key];
      const on = this.settings[channel];
      cells.forEach((cell, i) => cell.classList.toggle('on', i < level));
      value.textContent = on ? String(level * (100 / AUDIO.steps)).padStart(3, ' ') : 'OFF';
      segs.setAttribute('aria-valuenow', String(level));
      name.setAttribute('aria-pressed', String(on));
      row.classList.toggle('muted', !on);
    };
    this.syncs.push(sync);
    sync();
    return row;
  }
}
