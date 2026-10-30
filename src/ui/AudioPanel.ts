import { AUDIO } from '../config/audio';
import type { AudioSettings } from '../core/settings';

type Level = 'master' | 'music' | 'sfx';

const LEVELS: { key: Level; label: string }[] = [
  { key: 'master', label: 'MASTER' },
  { key: 'music', label: 'MUSIC' },
  { key: 'sfx', label: 'SFX' },
];

/**
 * Audio settings in the menu: a segmented slider per volume (click or drag along it, or
 * use the mouse wheel), a mute toggle, and the current music track, which skips when clicked.
 */
export class AudioPanel {
  private syncs: (() => void)[] = [];
  private track: HTMLButtonElement;
  private trackName: HTMLSpanElement;

  constructor(
    root: HTMLElement,
    private settings: AudioSettings,
    private onChange: (settings: AudioSettings) => void,
    onSkip: () => void,
  ) {
    const rows: HTMLElement[] = LEVELS.map((opt) => this.slider(opt.key, opt.label));
    rows.push(this.muteToggle());

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
  }

  /** Shows the playing track; null means there is nothing to play. `waiting`: not started yet. */
  setTrack(name: string | null, waiting = false): void {
    this.trackName.textContent = name === null ? 'NONE' : waiting ? '--' : `${name} »`;
    this.track.disabled = name === null || waiting;
    this.track.classList.toggle('on', name !== null && !waiting);
  }

  toggleMute(): void {
    this.settings.mute = !this.settings.mute;
    this.changed();
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

  private slider(key: Level, label: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'level';
    const name = document.createElement('span');
    name.textContent = label;
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
      cells.forEach((cell, i) => cell.classList.toggle('on', i < level));
      value.textContent = String(level * (100 / AUDIO.steps)).padStart(3, ' ');
      segs.setAttribute('aria-valuenow', String(level));
      row.classList.toggle('muted', this.settings.mute);
    };
    this.syncs.push(sync);
    sync();
    return row;
  }

  private muteToggle(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toggle';
    const name = document.createElement('span');
    name.textContent = 'MUTE (M)';
    const value = document.createElement('span');
    value.className = 'val';
    btn.append(name, value);
    btn.addEventListener('click', () => {
      // Drop focus so Space/Enter keep starting the game instead of re-toggling.
      btn.blur();
      this.toggleMute();
    });
    const sync = () => {
      value.textContent = this.settings.mute ? '[ON ]' : '[OFF]';
      btn.classList.toggle('on', this.settings.mute);
    };
    this.syncs.push(sync);
    sync();
    return btn;
  }
}
