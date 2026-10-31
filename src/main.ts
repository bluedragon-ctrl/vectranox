import './styles/main.css';
import { AudioEngine } from './audio/AudioEngine';
import { GameSounds } from './audio/GameSounds';
import { Input, type ControlMode } from './core/input';
import { PALETTE } from './config/game';
import { BOSS_ROOM, ELITE, ROOM_LABEL, threatPips } from './config/run';
import { startLoop } from './core/loop';
import { addScore, formatScore, loadLastName, loadScores, NAME_LENGTH, rankOf, type ScoreEntry } from './core/scores';
import { loadAudioSettings, loadVisualSettings, saveAudioSettings, saveVisualSettings } from './core/settings';
import { Game } from './game/Game';
import type { StageTemplate } from './levels/stages';
import { Renderer } from './render/Renderer';
import { AudioPanel } from './ui/AudioPanel';
import { BossBar } from './ui/BossBar';
import { ChainPopups } from './ui/ChainPopups';
import { EventBanner } from './ui/EventBanner';
import { EventConsole, type UiEvent } from './ui/EventConsole';
import { ModHud } from './ui/ModHud';
import { NameEntry } from './ui/NameEntry';
import { Overlay, type OverlayContent } from './ui/Overlay';
import { PowerHud } from './ui/PowerHud';
import { RunScreen, type RunAction } from './ui/RunScreen';
import { SettingsPanel } from './ui/SettingsPanel';

/**
 * Top-level screen state. The simulation has its own finer state (serve, play, clear, ...).
 * `between`: the pick between stages is up, with the pointer free to click it.
 * `naming`: the run made the high scores and the name field is up; `ended` follows.
 */
type UiState = 'title' | 'playing' | 'paused' | 'between' | 'naming' | 'ended';

/** Seconds the final banner stays up in-game before the end screen accepts input. */
const END_DELAY = 1.5;
const START_HINT = 'CLICK / ENTER TO START';
const CONTROLS_HINT = 'MOVE  ← → / A D / MOUSE\nLAUNCH · FIRE  SPACE / CLICK\nDETONATE  X / RIGHT CLICK\nPAUSE  P / ESC · MUTE  M';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Fills the table; `highlight` marks the row of the run that just ended. */
function renderScores(list: HTMLElement, scores: readonly ScoreEntry[], highlight = -1): void {
  if (scores.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'NO SCORES YET';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...scores.map((entry, i) => {
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = entry.name.padEnd(NAME_LENGTH);
      const rank = document.createElement('span');
      rank.append(`${String(i + 1).padStart(2)}. `, name);
      const stage = document.createElement('span');
      stage.className = entry.won ? 'stage won' : 'stage';
      stage.textContent = entry.won ? 'WIN' : entry.stage;
      const points = document.createElement('span');
      points.className = 'pts';
      points.textContent = formatScore(entry.score);
      const li = document.createElement('li');
      li.classList.toggle('new', i === highlight);
      li.append(rank, stage, points);
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
const runScreen = new RunScreen(el('run-screen'), (action) => runAction(action, 'mouse'));
const bossBar = new BossBar(el('boss-bar'), (x, y) => renderer.worldToClient(x, y));
const scoreList = el('score-list');
const nameEntry = new NameEntry(el<HTMLFormElement>('name-entry'), el<HTMLInputElement>('name-field'), saveScore);

let ui: UiState = 'title';
let scores = loadScores();
/** The place the run that just ended took on the table, or -1. */
let endRank = -1;
/** Waiting for the browser to grant pointer lock before play starts in mouse mode. */
let pendingMouse = false;
/** Waiting for pointer lock after a click during keyboard play; play goes on meanwhile. */
let pendingSwitch = false;
/** The room the editor's Play button sent, if any: every new game starts on it. */
const playtest = import.meta.env.DEV ? new URLSearchParams(location.search).get('room') : null;
let game = newGame();

function newGame(): Game {
  const g = new Game(Date.now() >>> 0);
  g.events.onAny((type, payload) => eventConsole.log(g.time, String(type), payload));
  g.events.on('stageEvent', ({ kind }) => banner.show(kind, g.time));
  g.events.on('bossPhase', ({ phase, phases }) => banner.announce({ label: `PHASE ${phase}/${phases}`, sub: 'CORE SHIELDED', color: PALETTE.yellow }, g.time));
  renderer.attach(g);
  sounds.attach(g);
  chainPopups.attach(g);
  g.start();
  if (playtest) g.tryTemplate(JSON.parse(playtest) as StageTemplate);
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
  if (ui === 'playing' || ui === 'naming') return;
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
  const resumed = ui === 'paused' || ui === 'between';
  if (ui === 'ended') {
    game = newGame();
    endRank = -1;
    renderScores(scoreList, scores);
  }
  input.mode = mode;
  input.reset();
  pendingSwitch = false;
  ui = 'playing';
  audio.setMuffled(false);
  logUi(resumed ? 'resume' : 'play', { mode });
}

/** A keyboard player reached for the mouse: hand steering over without pausing. */
function switchToMouse(control: 'lock' | 'cursor'): void {
  pendingSwitch = false;
  if (ui !== 'playing' || input.mode === 'mouse') return;
  input.mode = 'mouse';
  logUi('controlSwitch', { mode: 'mouse', control });
}

/**
 * The pick between stages is up. Once a choice starts the next stage, `between` lasts until the
 * browser answers the pointer-lock request; meanwhile the serve screen shows and a click or
 * Enter starts play as usual (in case the browser never answers).
 */
function choosing(): boolean {
  return ui === 'between' && game.state === 'draft';
}

/** A choice on the pick screen. Once the next stage is up, play resumes with the device that chose. */
function runAction(action: RunAction, via: ControlMode): void {
  if (ui !== 'between' || !runScreen.ready) return;
  if (action.type === 'pick') game.buyMod(action.index);
  else if (action.type === 'lives') game.buyLives();
  else game.endDraft();
  if (game.state === 'serve') requestStart(via);
}

/** Number keys buy a card: the mod offers in order, then the lives card. Enter moves on. */
function runKey(code: string): boolean {
  if (code === 'Enter' || code === 'NumpadEnter') {
    runAction({ type: 'continue' }, 'keyboard');
    return true;
  }
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code)?.[1];
  if (!digit) return false;
  const index = Number(digit) - 1;
  if (index > game.offers.length) return false;
  runAction(index < game.offers.length ? { type: 'pick', index } : { type: 'lives' }, 'keyboard');
  return true;
}

/** The run is over: asks for a name if it made the table. A single room from the editor never counts. */
function endRun(): void {
  releasePointer();
  endRank = playtest ? -1 : rankOf(scores, game.score);
  if (endRank < 0) {
    ui = 'ended';
    return;
  }
  ui = 'naming';
  nameEntry.show(loadLastName());
}

function saveScore(name: string): void {
  if (ui !== 'naming') return;
  scores = addScore(scores, { name, score: game.score, stage: String(game.stage.number), won: game.state === 'complete' }, endRank);
  renderScores(scoreList, scores, endRank);
  nameEntry.hide();
  ui = 'ended';
}

function pause(reason: string): void {
  if (ui !== 'playing') return;
  ui = 'paused';
  audio.setMuffled(true);
  logUi('pause', { reason });
  releasePointer();
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || choosing()) return;
  if (ui !== 'playing') {
    requestStart('mouse');
  } else if (input.mode === 'keyboard' && !pendingSwitch) {
    // The click itself still launches or fires; steering moves to the mouse once locked.
    pendingSwitch = true;
    const request = canvas.requestPointerLock() as Promise<void> | undefined;
    request?.catch(() => undefined);
  }
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    if (pendingMouse) {
      pendingMouse = false;
      enterPlay('mouse');
    } else if (pendingSwitch) {
      switchToMouse('lock');
    }
  } else if (ui === 'playing' && input.mode === 'mouse') {
    pause('pointer released');
  }
});

// Lock refused (embedded preview, iframe, Chrome's cooldown right after Esc): play with the visible cursor.
document.addEventListener('pointerlockerror', () => {
  if (pendingSwitch) {
    switchToMouse('cursor');
    return;
  }
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
    if (ui === 'naming') {
      // Keys go to the name field alone; gameplay input would swallow Space and the steering keys.
      e.stopImmediatePropagation();
      if (e.repeat || !nameEntry.ready) e.preventDefault();
      else nameEntry.focus();
      return;
    }
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
    if (choosing()) {
      // Space is the launch key, so it never chooses here: a held or mashed launch can't pick.
      if (runKey(e.code)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
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
      return { title: 'READY', sub: START_HINT, menu: true };
    case 'paused':
      return { title: 'PAUSED', sub: `${START_HINT}\n\n${CONTROLS_HINT}`, menu: true };
    case 'naming':
      return { title: endTitle(), sub: `SCORE ${formatScore(game.score)}\nNEW HIGH SCORE  #${endRank + 1}`, menu: true };
    case 'ended':
      return { title: endTitle(), sub: `SCORE ${formatScore(game.score)}\n\n${START_HINT}`, menu: true };
    case 'between':
    case 'playing':
      switch (game.state) {
        case 'serve':
          if (game.breached) return { title: 'LINE BREACHED', sub: 'FORMATION PUSHED BACK\nCLICK / SPACE TO LAUNCH' };
          return {
            title: `ROOM ${roomCount(game)}  ${threatPips(game.stage.threat)}`,
            sub: `${stageLabel(game)}\nCLICK / SPACE TO LAUNCH`,
          };
        case 'clear':
          return { title: game.stage.room === 'boss' ? 'BOSS DESTROYED' : 'STAGE CLEAR', sub: clearSub(game) };
        // The pick screen takes over.
        case 'draft':
          return null;
        case 'over':
          return { title: 'GAME OVER' };
        case 'complete':
          return { title: 'RUN COMPLETE' };
        case 'play':
          return null;
      }
  }
}

function endTitle(): string {
  return game.state === 'complete' ? 'RUN COMPLETE' : 'GAME OVER';
}

/** What the room just cleared paid: an elite or boss bonus, then its credits. */
function clearSub(g: Game): string {
  const bonus = g.stage.room === 'boss' ? `BOSS BONUS +${BOSS_ROOM.clearBonus}` : g.stage.room === 'elite' ? `ELITE BONUS +${ELITE.clearBonus}` : '';
  const pay = g.roomCredits;
  return [bonus, pay > 0 ? `+${pay} CREDIT${pay === 1 ? '' : 'S'}` : ''].filter(Boolean).join('\n');
}

/** This room out of the run's total. */
function roomCount(g: Game): string {
  return `${g.stage.number}/${g.stages.length}`;
}

/** The stage's name, after its room kind unless it is a standard room. */
function stageLabel(g: Game): string {
  const room = ROOM_LABEL[g.stage.room];
  return room ? `${room} · ${g.stage.name}` : g.stage.name;
}

/** The longest live chain and the bonus its last brick earned (multiplied); a dash until a chain pays. */
function formatChain(g: Game): string {
  let chain = 0;
  for (const b of g.balls) chain = Math.max(chain, b.chain);
  return chain >= 2 ? `×${chain} +${g.chainBonus(chain) * g.multiplier}` : '—';
}

renderScores(scoreList, scores);

const hudScore = el('hud-score');
const hudRoom = el('hud-room');
const hudLives = el('hud-lives');
const hudCredits = el('hud-credits');
const hudChain = el('hud-chain');
const hudMult = el('hud-mult');
const powerHud = new PowerHud(el('power-list'));
const modHud = new ModHud(el('mod-list'));
const sysFps = el('sys-fps');
const sysBalls = el('sys-balls');
let fps = 60;

startLoop({
  update: (dt) => {
    if (ui !== 'playing') return;
    game.update(dt, input.sample(game.paddle.x, game.stun > 0));
    if ((game.state === 'over' || game.state === 'complete') && game.stateTime >= END_DELAY) {
      endRun();
    } else if (game.state === 'draft') {
      ui = 'between';
      audio.setMuffled(true);
      logUi('pause', { reason: game.state });
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
    runScreen.update(ui === 'between' ? game : null);
    bossBar.update(ui === 'title' || ui === 'naming' || ui === 'ended' ? null : game);
    // Menus and stage banners take over the field; a stage event banner never shares it.
    if (content || ui === 'between') banner.hide();
    else banner.update(game.time);

    if (frameTime > 0) fps += (1 / frameTime - fps) * 0.05;
    setText(hudScore, formatScore(game.score));
    setText(hudRoom, roomCount(game));
    setText(hudLives, String(game.lives));
    setText(hudCredits, String(game.credits));
    setText(hudChain, formatChain(game));
    setText(hudMult, `×${game.multiplier}`);
    powerHud.update(game.timers, game.charges);
    modHud.update(game.mods);
    setText(sysFps, fps.toFixed(0));
    setText(sysBalls, String(game.balls.length));
  },
});

if (import.meta.env.DEV) {
  // Console access for debugging: `vnx.game`, `vnx.renderer`, `vnx.audio`.
  Object.assign(window, { vnx: { get game() { return game; }, renderer, audio } });
}
