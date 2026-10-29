import type { VisualSettings } from '../core/settings';

const OPTIONS: { key: keyof VisualSettings; label: string }[] = [
  { key: 'bloom', label: 'BLOOM' },
  { key: 'reduceFx', label: 'REDUCE FLASH/SHAKE' },
];

/** On/off toggles for the video settings in the left panel. */
export class SettingsPanel {
  constructor(
    root: HTMLElement,
    private settings: VisualSettings,
    private onChange: (settings: VisualSettings) => void,
  ) {
    root.replaceChildren(...OPTIONS.map((opt) => this.toggle(opt.key, opt.label)));
  }

  private toggle(key: keyof VisualSettings, label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toggle';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('span');
    value.className = 'val';
    btn.append(name, value);
    const sync = () => {
      value.textContent = this.settings[key] ? '[ON ]' : '[OFF]';
      btn.classList.toggle('on', this.settings[key]);
    };
    btn.addEventListener('click', () => {
      this.settings[key] = !this.settings[key];
      sync();
      // Drop focus so Space/Enter keep starting the game instead of re-toggling.
      btn.blur();
      this.onChange({ ...this.settings });
    });
    sync();
    return btn;
  }
}
