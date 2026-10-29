import './styles/main.css';
import { SIM } from './config/game';
import { startLoop } from './core/loop';
import { Game } from './game/Game';
import { Renderer } from './render/Renderer';
import { EventConsole } from './ui/EventConsole';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
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

const game = new Game(Date.now() >>> 0);
const renderer = new Renderer(el<HTMLCanvasElement>('stage'), el('field-area'));
const eventConsole = new EventConsole(el('console'));

game.events.onAny((type, payload) => eventConsole.log(game.tick / SIM.tickRate, String(type), payload));
renderScores(el('score-list'));

const sysFps = el('sys-fps');
const sysTick = el('sys-tick');
const sysBalls = el('sys-balls');
let fps = 60;

game.start();
startLoop({
  update: (dt) => game.update(dt),
  render: (alpha, frameTime) => {
    renderer.render(game, alpha);
    eventConsole.flush();
    if (frameTime > 0) fps += (1 / frameTime - fps) * 0.05;
    sysFps.textContent = fps.toFixed(0);
    sysTick.textContent = String(game.tick);
    sysBalls.textContent = String(game.balls.length);
  },
});
