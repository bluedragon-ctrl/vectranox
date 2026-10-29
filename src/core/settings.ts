/** Player-facing video options. Persisted in localStorage. */
export interface VisualSettings {
  crt: boolean;
  bloom: boolean;
  /** Tones down flashes, chromatic pulses and flicker, and disables screen shake. */
  reduceFx: boolean;
}

const KEY = 'vectranox.video';

export function loadVisualSettings(): VisualSettings {
  const defaults: VisualSettings = {
    crt: false,
    bloom: true,
    reduceFx: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<Record<keyof VisualSettings, unknown>>;
    return {
      crt: typeof saved.crt === 'boolean' ? saved.crt : defaults.crt,
      bloom: typeof saved.bloom === 'boolean' ? saved.bloom : defaults.bloom,
      reduceFx: typeof saved.reduceFx === 'boolean' ? saved.reduceFx : defaults.reduceFx,
    };
  } catch {
    return defaults;
  }
}

export function saveVisualSettings(settings: VisualSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked (private mode, file://): settings just don't persist.
  }
}
