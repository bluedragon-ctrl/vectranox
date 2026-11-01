import { AUDIO } from '../config/audio';

/** Player-facing video options. Persisted in localStorage. */
export interface VisualSettings {
  bloom: boolean;
  /** Tones down flashes and chromatic pulses, stops star twinkle, and disables screen shake. */
  reduceFx: boolean;
}

/** Player-facing audio options. Levels are slider steps, 0..`AUDIO.steps`. Persisted in localStorage. */
export interface AudioSettings {
  music: number;
  sfx: number;
  musicOn: boolean;
  sfxOn: boolean;
}

const KEY = 'vectranox.video';
const AUDIO_KEY = 'vectranox.audio';

export function loadVisualSettings(): VisualSettings {
  const defaults: VisualSettings = {
    bloom: true,
    reduceFx: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  const saved = load<VisualSettings>(KEY);
  if (!saved) return defaults;
  return {
    bloom: typeof saved.bloom === 'boolean' ? saved.bloom : defaults.bloom,
    reduceFx: typeof saved.reduceFx === 'boolean' ? saved.reduceFx : defaults.reduceFx,
  };
}

export function saveVisualSettings(settings: VisualSettings): void {
  writeJson(KEY, settings);
}

export function loadAudioSettings(): AudioSettings {
  const defaults: AudioSettings = { ...AUDIO.defaults };
  const saved = load<AudioSettings>(AUDIO_KEY);
  if (!saved) return defaults;
  const level = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= AUDIO.steps ? v : fallback;
  return {
    music: level(saved.music, defaults.music),
    sfx: level(saved.sfx, defaults.sfx),
    musicOn: typeof saved.musicOn === 'boolean' ? saved.musicOn : defaults.musicOn,
    sfxOn: typeof saved.sfxOn === 'boolean' ? saved.sfxOn : defaults.sfxOn,
  };
}

export function saveAudioSettings(settings: AudioSettings): void {
  writeJson(AUDIO_KEY, settings);
}

function load<T>(key: string): Partial<Record<keyof T, unknown>> | null {
  const parsed = readJson(key);
  return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<Record<keyof T, unknown>>) : null;
}

export function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked (private mode, file://): it just doesn't persist.
  }
}
