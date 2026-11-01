import { RESOLUTIONS } from '../config/game';
import type { Resolution, VisualSettings } from '../core/settings';

const TOGGLES: { key: 'bloom' | 'reduceFx'; label: string }[] = [
  { key: 'bloom', label: 'BLOOM' },
  { key: 'reduceFx', label: 'REDUCE FLASH/SHAKE' },
];

function resolutionText(r: Resolution): string {
  return `[${r === 'auto' ? 'AUTO' : `${r * 100}%`.padStart(4, ' ')}]`;
}

/** The video settings in the menu: on/off toggles and a resolution that cycles when clicked. */
export class SettingsPanel {
  constructor(
    root: HTMLElement,
    private settings: VisualSettings,
    private onChange: (settings: VisualSettings) => void,
  ) {
    root.replaceChildren(
      this.row(
        'RESOLUTION',
        () => [resolutionText(this.settings.resolution), true],
        () => {
          const next = RESOLUTIONS.indexOf(this.settings.resolution) + 1;
          this.settings.resolution = RESOLUTIONS[next % RESOLUTIONS.length]!;
        },
      ),
      ...TOGGLES.map(({ key, label }) =>
        this.row(
          label,
          () => [this.settings[key] ? '[ON ]' : '[OFF]', this.settings[key]],
          () => {
            this.settings[key] = !this.settings[key];
          },
        ),
      ),
    );
  }

  /** `read` gives the row's value text and whether it is lit. */
  private row(label: string, read: () => [string, boolean], change: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toggle';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('span');
    value.className = 'val';
    btn.append(name, value);
    const sync = () => {
      const [text, on] = read();
      value.textContent = text;
      btn.classList.toggle('on', on);
    };
    btn.addEventListener('click', () => {
      change();
      sync();
      // Drop focus so Space/Enter keep starting the game instead of re-toggling.
      btn.blur();
      this.onChange({ ...this.settings });
    });
    sync();
    return btn;
  }
}
