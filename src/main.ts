import './styles/main.css';
import { SIM } from './config/game';
import { Input, type ControlMode } from './core/input';
import { startLoop } from './core/loop';
import { loadVisualSettings, saveVisualSettings } from './core/settings';
import { Game } from './game/Game';
import { STAGES } from './levels/stages';
import { Renderer } from './render/Renderer';
import { EventConsole } from './ui/EventConsole';
import { Overlay, type OverlayContent } from './ui/Overlay';
import { PowerHud } from './ui/PowerHud';
import { SettingsPanel } from './ui/SettingsPanel';

/** Top-level screen state. The simulation has its own finer state (serve, play, clear, ...). */
type UiState = 'title' | 'playing' | 'paused' | 'ended';

/** Seconds the final banner stays up in-game before the end screen accepts input. */
const END_DELAY = 1.5;
const START_HINT = 'CLICK · MOUSE CONTROL\nENTER · KEYBOARD CONTROL';
const CONTROLS_HINT = 'MOVE  ← → / A D / MOUSE\nLAUNCH · FIRE  SPACE / CLICK\nPAUSE  P / ESC';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

// Placeholder table until the score service lands (phase 6).
const PLACEHOLDER_SCORES: [string, number][] = [
  ['NOX   ', 50000],
  ['VECTRA', 40000],
  ['GRID 8', 30000],
  ['NEON  ', 20000],
  ['R4DIUS', 10000],
];

function renderScores(list: HTMLElement): void {
  list.replaceChildren(
    ...PLACEHOLDER_SCORES.map(([name, pts], i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${i + 1}. <span class="name">${name}</span></span><span class="pts">${String(pts).padStart(6, '0')}</span>`;
      return li;
    }),
  );
}

const canvas = el<HTMLCanvasElement>('stage');
const renderer = new Renderer(canvas, el('field-area'));
const videoSettings = loadVisualSettings();
renderer.applySettings(videoSettings);
new SettingsPanel(el('video-toggles'), videoSettings, (settings) => {
  renderer.applySettings(settings);
  saveVisualSettings(settings);
  logUi('settings', { ...settings });
});
const eventConsole = new EventConsole(el('console'));
const overlay = new Overlay(el('overlay'), el('overlay-title'), el('overlay-sub'));
const input = new Input(canvas, renderer);

let ui: UiState = 'title';
/** Waiting for the browser to grant pointer lock before play starts in mouse mode. */
let pendingMouse = false;
let game = newGame();

function newGame(): Game {
  const g = new Game(Date.now() >>> 0, STAGES);
  g.events.onAny((type, payload) => eventConsole.log(g.tick / SIM.tickRate, String(type), payload));
  renderer.attach(g);
  g.start();
  return g;
}

function logUi(type: string, payload: Record<string, unknown> = {}): void {
  eventConsole.log(game.tick / SIM.tickRate, type, payload);
}

/** Start or resume. Mouse mode needs pointer lock first; play begins once the browser grants it. */
function requestStart(mode: ControlMode): void {
  if (ui === 'playing') return;
  if (mode === 'keyboard') {
    enterPlay('keyboard');
    return;
  }
  pendingMouse = true;
  // Chrome returns a promise (rejects e.g. right after Esc); Firefox returns nothing and fires pointerlockerror.
  const request = canvas.requestPointerLock() as Promise<void> | undefined;
  request?.catch(() => undefined);
}

function enterPlay(mode: ControlMode): void {
  const resumed = ui === 'paused';
  if (ui === 'ended') game = newGame();
  input.mode = mode;
  input.reset();
  ui = 'playing';
  logUi(resumed ? 'resume' : 'play', { mode });
}

function pause(reason: string): void {
  if (ui !== 'playing') return;
  ui = 'paused';
  logUi('pause', { reason });
  if (document.pointerLockElement) document.exitPointerLock();
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && ui !== 'playing') requestStart('mouse');
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    if (pendingMouse) {
      pendingMouse = false;
      enterPlay('mouse');
    }
  } else if (ui === 'playing' && input.mode === 'mouse') {
    pause('pointer released');
  }
});

// Lock refused (embedded preview, iframe, Chrome's cooldown right after Esc): play with the visible cursor.
document.addEventListener('pointerlockerror', () => {
  if (!pendingMouse) return;
  pendingMouse = false;
  logUi('pointerLockFallback', { control: 'cursor' });
  enterPlay('mouse');
});

window.addEventListener('blur', () => pause('focus lost'));

// Capture phase: menu keys are handled (and swallowed) before gameplay input sees them.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.repeat) return;
    if (ui === 'playing') {
      // Under pointer lock the browser consumes Esc itself and we pause on pointerlockchange.
      if (e.code === 'KeyP' || (e.code === 'Escape' && !input.locked)) pause('key');
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' || (ui === 'paused' && e.code === 'KeyP')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      requestStart('keyboard');
    }
  },
  { capture: true },
);

function overlayContent(): OverlayContent | null {
  switch (ui) {
    case 'title':
      return { title: 'READY', sub: START_HINT };
    case 'paused':
      return { title: 'PAUSED', sub: `${START_HINT}\n\n${CONTROLS_HINT}` };
    case 'ended':
      return {
        title: game.state === 'complete' ? 'RUN COMPLETE' : 'GAME OVER',
        sub: `SCORE ${formatScore(game.score)}\n\n${START_HINT}`,
      };
    case 'playing':
      switch (game.state) {
        case 'serve':
          return {
            title: `STAGE 1-${game.stageIndex + 1}`,
            sub: `${game.stage.name}\n${input.mode === 'mouse' ? 'CLICK' : 'SPACE'} TO LAUNCH`,
          };
        case 'clear':
          return { title: 'STAGE CLEAR' };
        case 'over':
          return { title: 'GAME OVER' };
        case 'complete':
          return { title: 'RUN COMPLETE' };
        case 'play':
          return null;
      }
  }
}

function formatScore(score: number): string {
  return String(score).padStart(6, '0');
}

renderScores(el('score-list'));

const hudScore = el('hud-score');
const hudLives = el('hud-lives');
const hudSector = el('hud-sector');
const powerHud = new PowerHud(el('power-list'));
const sysFps = el('sys-fps');
const sysTick = el('sys-tick');
const sysBalls = el('sys-balls');
const sysMode = el('sys-mode');
const sysState = el('sys-state');
let fps = 60;

startLoop({
  update: (dt) => {
    if (ui !== 'playing') return;
    game.update(dt, input.sample(game.paddle.x));
    if ((game.state === 'over' || game.state === 'complete') && game.stateTime >= END_DELAY) {
      ui = 'ended';
      if (document.pointerLockElement) document.exitPointerLock();
    }
  },
  render: (alpha, frameTime) => {
    // Paused: the accumulator still runs, so freeze interpolation at the last tick.
    renderer.render(game, ui === 'playing' ? alpha : 1);
    canvas.classList.toggle('hide-cursor', ui === 'playing');
    overlay.show(overlayContent());
    eventConsole.flush();

    if (frameTime > 0) fps += (1 / frameTime - fps) * 0.05;
    setText(hudScore, formatScore(game.score));
    setText(hudLives, String(game.lives));
    setText(hudSector, `1-${game.stageIndex + 1}`);
    powerHud.update(game.timers);
    setText(sysFps, fps.toFixed(0));
    setText(sysTick, String(game.tick));
    setText(sysBalls, String(game.balls.length));
    setText(sysMode, input.absolute ? 'CURSOR' : input.mode.toUpperCase());
    setText(sysState, `${ui}/${game.state}`.toUpperCase());
  },
});

if (import.meta.env.DEV) {
  // Console access for debugging: `vnx.game`, `vnx.renderer`.
  Object.assign(window, { vnx: { get game() { return game; }, renderer } });
}
