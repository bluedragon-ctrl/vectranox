import './styles/main.css';
import { AudioEngine } from './audio/AudioEngine';
import { GameSounds } from './audio/GameSounds';
import { Input, type ControlMode } from './core/input';
import { startLoop } from './core/loop';
import { loadAudioSettings, loadVisualSettings, saveAudioSettings, saveVisualSettings } from './core/settings';
import { chainBonus, Game } from './game/Game';
import { STAGES } from './levels/stages';
import { Renderer } from './render/Renderer';
import { AudioPanel } from './ui/AudioPanel';
import { ChainPopups } from './ui/ChainPopups';
import { EventBanner } from './ui/EventBanner';
import { EventConsole, type UiEvent } from './ui/EventConsole';
import { Overlay, type OverlayContent } from './ui/Overlay';
import { PowerHud } from './ui/PowerHud';
import { SettingsPanel } from './ui/SettingsPanel';

/** Top-level screen state. The simulation has its own finer state (serve, play, clear, ...). */
type UiState = 'title' | 'playing' | 'paused' | 'ended';

/** Seconds the final banner stays up in-game before the end screen accepts input. */
const END_DELAY = 1.5;
const START_HINT = 'CLICK · MOUSE CONTROL\nENTER · KEYBOARD CONTROL';
const CONTROLS_HINT = 'MOVE  ← → / A D / MOUSE\nLAUNCH · FIRE  SPACE / CLICK\nDETONATE  X / RIGHT CLICK\nPAUSE  P / ESC · MUTE  M';

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
    ...PLACEHOLDER_SCORES.map(([player, pts], i) => {
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = player;
      const rank = document.createElement('span');
      rank.append(`${i + 1}. `, name);
      const points = document.createElement('span');
      points.className = 'pts';
      points.textContent = formatScore(pts);
      const li = document.createElement('li');
      li.append(rank, points);
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
const audioSettings = loadAudioSettings();
const audio = new AudioEngine(audioSettings);
const sounds = new GameSounds(audio);
const audioPanel = new AudioPanel(
  el('audio-controls'),
  audioSettings,
  (settings) => {
    audio.apply(settings);
    saveAudioSettings(settings);
    logUi('audio', { ...settings });
  },
  () => audio.music.next(),
);
audioPanel.setTrack(audio.music.hasTracks ? '' : null, true);
audio.music.onTrack = (name) => {
  audioPanel.setTrack(name);
  logUi(name === null ? 'musicFailed' : 'track', name === null ? {} : { name });
};
// Browsers only start audio from a user gesture; the first click or key press anywhere unlocks it.
window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
window.addEventListener('keydown', () => audio.unlock(), { capture: true });
const eventConsole = new EventConsole(el('console'));
const overlay = new Overlay(el('overlay'), el('overlay-title'), el('overlay-sub'));
const banner = new EventBanner(el('event-banner'), el('event-title'), el('event-sub'));
const input = new Input(canvas, renderer);
const chainPopups = new ChainPopups(el('popups'), (x, y) => renderer.worldToClient(x, y));

let ui: UiState = 'title';
/** Waiting for the browser to grant pointer lock before play starts in mouse mode. */
let pendingMouse = false;
let game = newGame();

function newGame(): Game {
  const g = new Game(Date.now() >>> 0, STAGES);
  g.events.onAny((type, payload) => eventConsole.log(g.time, String(type), payload));
  g.events.on('stageEvent', ({ kind }) => banner.show(kind, g.time));
  renderer.attach(g);
  sounds.attach(g);
  chainPopups.attach(g);
  g.start();
  return g;
}

function logUi(type: UiEvent, payload: Record<string, unknown> = {}): void {
  eventConsole.log(game.time, type, payload);
}

function releasePointer(): void {
  if (document.pointerLockElement) document.exitPointerLock();
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
  audio.setMuffled(false);
  logUi(resumed ? 'resume' : 'play', { mode });
}

function pause(reason: string): void {
  if (ui !== 'playing') return;
  ui = 'paused';
  audio.setMuffled(true);
  logUi('pause', { reason });
  releasePointer();
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
    if (e.code === 'KeyM') {
      audioPanel.toggleMute();
      return;
    }
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

/** The longest live chain and the bonus its last brick earned (multiplied); a dash until a chain pays. */
function formatChain(balls: readonly { chain: number }[], multiplier: number): string {
  let chain = 0;
  for (const b of balls) chain = Math.max(chain, b.chain);
  return chain >= 2 ? `×${chain} +${chainBonus(chain) * multiplier}` : '—';
}

renderScores(el('score-list'));

const hudScore = el('hud-score');
const hudLives = el('hud-lives');
const hudSector = el('hud-sector');
const hudChain = el('hud-chain');
const hudMult = el('hud-mult');
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
      releasePointer();
    }
  },
  render: (alpha, frameTime) => {
    // First, while layout is still clean: it reads the console's scroll position.
    eventConsole.flush();
    // Paused: the accumulator still runs, so freeze interpolation at the last tick.
    renderer.render(game, ui === 'playing' ? alpha : 1, frameTime);
    canvas.classList.toggle('hide-cursor', ui === 'playing');
    chainPopups.setPaused(ui !== 'playing');
    const content = overlayContent();
    overlay.show(content);
    // Menus and stage banners take over the field; a stage event banner never shares it.
    if (content) banner.hide();
    else banner.update(game.time);

    if (frameTime > 0) fps += (1 / frameTime - fps) * 0.05;
    setText(hudScore, formatScore(game.score));
    setText(hudLives, String(game.lives));
    setText(hudSector, `1-${game.stageIndex + 1}`);
    setText(hudChain, formatChain(game.balls, game.multiplier));
    setText(hudMult, `×${game.multiplier}`);
    powerHud.update(game.timers, game.charges);
    setText(sysFps, fps.toFixed(0));
    setText(sysTick, String(game.tick));
    setText(sysBalls, String(game.balls.length));
    setText(sysMode, input.absolute ? 'CURSOR' : input.mode.toUpperCase());
    setText(sysState, `${ui}/${game.state}`.toUpperCase());
  },
});

if (import.meta.env.DEV) {
  // Console access for debugging: `vnx.game`, `vnx.renderer`, `vnx.audio`.
  Object.assign(window, { vnx: { get game() { return game; }, renderer, audio } });
}
