import { AUDIO } from '../config/audio';
import { FIELD } from '../config/game';
import { POWER_LOOK } from '../config/tuning';
import type { Game } from '../game/Game';
import type { HitSource } from '../game/types';
import type { AudioEngine } from './AudioEngine';
import { note, type Synth } from './synth';

/** Semitone steps of a major pentatonic scale, for the brick-combo pitch. */
const PENTATONIC = [0, 2, 4, 7, 9];
/** Stereo width: a sound at the field's edge pans this far. */
const PAN_WIDTH = 0.6;
const C5 = note(3, 440);

/**
 * Turns simulation events into synthesized sound effects, the way GameFx turns them into visuals.
 * Sounds pan with their x position, and brick hits climb a scale until the paddle touches a ball.
 * Reads game state only to place sounds (paddle position); never writes to it.
 */
export class GameSounds {
  private unsubscribe: (() => void)[] = [];
  private lastPlayed = new Map<string, number>();
  private combo = 0;

  constructor(private engine: AudioEngine) {}

  attach(game: Game): void {
    this.unsubscribe.forEach((off) => off());
    this.combo = 0;
    const ev = game.events;
    const paddlePan = () => pan(game.paddle.x);
    this.unsubscribe = [
      ev.on('stageStart', () => {
        this.combo = 0;
        this.play('stage', (s) => s.notes([note(-9, C5), note(-5, C5), note(0, C5)], 0.07, { type: 'triangle', dur: 0.18, gain: 0.18 }));
      }),
      ev.on('ballLaunch', () => {
        this.play('launch', (s) => s.tone({ type: 'triangle', freq: 300, to: 620, dur: 0.12, gain: 0.2, pan: paddlePan() }));
      }),
      ev.on('wallHit', ({ side, x }) => {
        const p = side === 'left' ? -PAN_WIDTH : side === 'right' ? PAN_WIDTH : pan(x);
        this.play('wall', (s) => s.tone({ type: 'triangle', freq: 640, to: 560, dur: 0.045, gain: 0.1, pan: p }));
      }),
      ev.on('paddleHit', ({ offset }) => {
        this.combo = 0;
        const p = paddlePan();
        // Off-centre hits sound a little higher, like the steeper bounce they give.
        const freq = 260 * (1 + Math.abs(offset) * 0.25);
        this.play('paddle', (s) => {
          s.tone({ type: 'triangle', freq, to: freq * 0.9, dur: 0.09, gain: 0.3, pan: p });
          s.tone({ freq: 110, to: 70, dur: 0.08, gain: 0.25, pan: p });
        });
      }),
      ev.on('ballCaught', () => {
        this.combo = 0;
        this.play('catch', (s) => s.tone({ freq: 200, to: 140, dur: 0.1, gain: 0.3, pan: paddlePan() }));
      }),
      ev.on('brickHit', ({ kind, by, ix }) => {
        const p = pan(ix);
        if (kind === 'steel') {
          // Unbreakable: a bright, inharmonic ring.
          this.play('steel', (s) => {
            for (const [freq, gain] of [[1250, 0.07], [1880, 0.05], [2630, 0.035]] as const) s.tone({ freq, dur: 0.3, gain, pan: p });
            s.noise({ filter: 'highpass', freq: 5000, dur: 0.03, gain: 0.08, pan: p });
          });
          return;
        }
        const ping = this.comboNote(by);
        // Armoured plate that holds: a dull clank plus the combo note.
        this.play('clank', (s) => {
          s.tone({ type: 'triangle', freq: 420, to: 380, dur: 0.12, gain: 0.14, pan: p });
          s.tone({ type: 'triangle', freq: 667, to: 610, dur: 0.1, gain: 0.08, pan: p });
          s.noise({ filter: 'bandpass', freq: 2400, q: 2, dur: 0.05, gain: 0.18, pan: p });
          s.tone({ freq: ping, dur: 0.16, gain: 0.07, pan: p });
        });
      }),
      ev.on('brickDestroyed', ({ kind, by, ix }) => {
        const p = pan(ix);
        const ping = this.comboNote(by);
        if (kind !== 'normal') {
          // Metal giving way: a low crunch.
          this.play('crunch', (s) => {
            s.noise({ filter: 'bandpass', freq: 1400, to: 350, q: 1.5, dur: 0.3, gain: 0.32, pan: p });
            s.tone({ type: 'triangle', freq: 170, to: 70, dur: 0.25, gain: 0.25, pan: p });
            s.tone({ freq: ping, dur: 0.3, gain: 0.1, pan: p });
          });
          return;
        }
        // Glass: a bright shatter and a ringing note that climbs with the combo.
        this.play('glass', (s) => {
          s.noise({ filter: 'highpass', freq: 3200, dur: 0.2, gain: 0.22, pan: p });
          s.noise({ filter: 'bandpass', freq: 6500, q: 3, attack: 0.01, dur: 0.12, gain: 0.12, pan: p });
          s.tone({ freq: ping, dur: 0.28, gain: 0.13, pan: p });
          s.tone({ freq: ping * 1.5, at: 0.02, dur: 0.2, gain: 0.05, pan: p });
        });
      }),
      ev.on('explosion', ({ x }) => {
        const p = pan(x);
        // A smaller cousin of the detonator's boom.
        this.play('explosion', (s) => {
          s.noise({ filter: 'lowpass', freq: 1800, to: 180, dur: 0.28, gain: 0.32, pan: p });
          s.tone({ freq: 110, to: 42, dur: 0.24, gain: 0.3, pan: p });
        });
      }),
      ev.on('brickHeal', () => {
        this.play('heal', (s) => s.tone({ type: 'triangle', freq: 520, to: 780, dur: 0.12, gain: 0.05 }));
      }),
      ev.on('formationStep', ({ dropped }) => {
        // The march's beat: a low thud, deeper when the formation comes down.
        const freq = dropped ? 62 : 82;
        this.play('march', (s) => s.tone({ type: 'triangle', freq, to: freq * 0.8, dur: 0.1, gain: dropped ? 0.2 : 0.12 }));
      }),
      ev.on('formationBreach', () => {
        this.play('breach', (s) => s.notes([660, 494, 660, 494], 0.1, { type: 'square', cutoff: 2000, dur: 0.09, gain: 0.08 }));
      }),
      ev.on('barrierHit', ({ x }) => {
        this.play('barrier', (s) => {
          s.tone({ freq: 660, to: 990, dur: 0.16, gain: 0.16, pan: pan(x) });
          s.tone({ type: 'triangle', freq: 1320, dur: 0.1, gain: 0.05, pan: pan(x) });
        });
      }),
      ev.on('targetHit', ({ lit, x }) => {
        const p = pan(x);
        // A bell: brighter when the hit lights the target.
        this.play('target', (s) => {
          const freq = lit ? note(12, C5) : note(7, C5);
          s.tone({ freq, dur: 0.22, gain: 0.1, pan: p });
          s.tone({ freq: freq * 2.76, dur: 0.12, gain: 0.03, pan: p });
        });
      }),
      ev.on('targetBank', () => {
        this.play('bank', (s) => s.notes([0, 4, 7, 12, 16].map((n) => note(n, C5)), 0.05, { type: 'square', cutoff: 3200, dur: 0.12, gain: 0.07 }));
      }),
      ev.on('portalWarp', ({ x }) => {
        // Swallowed and spat out: a sweep down, then up.
        this.play('warp', (s) => {
          s.tone({ type: 'sine', freq: 900, to: 120, dur: 0.12, gain: 0.16 });
          s.tone({ type: 'triangle', freq: 160, to: 1100, at: 0.1, dur: 0.14, gain: 0.1, pan: pan(x) });
        });
      }),
      ev.on('powerDrop', ({ x }) => {
        this.play('drop', (s) => s.tone({ freq: 1180, to: 900, dur: 0.06, gain: 0.05, pan: pan(x) }));
      }),
      ev.on('powerCollect', ({ kind }) => {
        const p = paddlePan();
        if (POWER_LOOK[kind].bad) {
          this.play('powerBad', (s) => s.notes([440, 330, 233], 0.07, { type: 'sawtooth', cutoff: 1400, dur: 0.14, gain: 0.12, pan: p }));
        } else {
          const steps = kind === 'life' ? [0, 4, 7, 12] : [0, 4, 7];
          this.play('power', (s) => s.notes(steps.map((n) => note(n, C5)), 0.06, { type: 'square', cutoff: 2600, dur: 0.13, gain: 0.07, pan: p }));
        }
      }),
      ev.on('modPick', () => {
        this.play('mod', (s) => s.notes([0, 7, 12, 16].map((n) => note(n, C5)), 0.06, { type: 'square', cutoff: 2800, dur: 0.14, gain: 0.07 }));
      }),
      ev.on('livesPick', () => {
        this.play('lives', (s) => s.notes([0, 4, 7, 12, 16].map((n) => note(n, C5)), 0.06, { type: 'triangle', dur: 0.16, gain: 0.1 }));
      }),
      ev.on('powerEnd', () => {
        this.play('powerEnd', (s) => s.notes([note(7, C5), note(0, C5)], 0.09, { type: 'triangle', dur: 0.14, gain: 0.08 }));
      }),
      ev.on('laserFire', ({ x }) => {
        this.play('laser', (s) => s.tone({ type: 'sawtooth', freq: 1700, to: 320, cutoff: 4200, dur: 0.09, gain: 0.07, pan: pan(x) }));
      }),
      ev.on('detonate', () => {
        this.play('detonate', (s) => {
          s.noise({ filter: 'lowpass', freq: 2400, to: 140, dur: 0.55, gain: 0.5 });
          s.tone({ freq: 130, to: 34, dur: 0.5, gain: 0.5 });
        });
      }),
      ev.on('stageEvent', ({ kind }) => {
        this.play('event', (s) => {
          s.notes([note(7, C5), note(12, C5)], 0.1, { type: 'square', cutoff: 2400, dur: 0.12, gain: 0.07 });
          if (kind === 'pulse') s.noise({ filter: 'bandpass', freq: 250, to: 3000, q: 1.2, attack: 0.1, dur: 0.45, gain: 0.25 });
        });
      }),
      ev.on('ballLost', () => {
        this.play('lost', (s) => s.tone({ freq: 420, to: 120, dur: 0.35, gain: 0.18 }));
      }),
      ev.on('secondWind', () => {
        // The lost-life sweep turned around: a quick rise back up.
        this.play('secondWind', (s) => s.tone({ type: 'triangle', freq: 180, to: 720, dur: 0.35, gain: 0.18 }));
      }),
      ev.on('lifeLost', () => {
        this.combo = 0;
        this.play('life', (s) => {
          s.tone({ type: 'sawtooth', freq: 220, to: 52, cutoff: 1100, dur: 0.75, gain: 0.25 });
          s.noise({ filter: 'lowpass', freq: 900, to: 120, dur: 0.5, gain: 0.25 });
        });
      }),
      ev.on('stageClear', () => {
        this.play('clear', (s) => {
          s.notes([0, 4, 7, 12].map((n) => note(n, C5)), 0.08, { type: 'square', cutoff: 3000, dur: 0.16, gain: 0.08 });
          s.notes([note(4, C5), note(7, C5), note(12, C5)], 0, { type: 'triangle', at: 0.32, dur: 0.7, gain: 0.07 });
        });
      }),
      ev.on('gameOver', () => {
        this.play('over', (s) => s.notes([note(-2, C5), note(-6, C5), note(-9, C5), note(-14, C5)], 0.2, { type: 'sawtooth', cutoff: 1300, dur: 0.4, gain: 0.14 }));
      }),
      ev.on('runComplete', () => {
        this.play('complete', (s) => {
          s.notes([0, 4, 7, 12, 16, 19, 24].map((n) => note(n, C5)), 0.07, { type: 'square', cutoff: 3200, dur: 0.15, gain: 0.07 });
          s.notes([note(0, C5), note(4, C5), note(7, C5)], 0, { type: 'triangle', at: 0.5, dur: 1.2, gain: 0.08 });
        });
      }),
    ];
  }

  /** Plays a sound unless the same one just played (a blast breaks many bricks in one tick). */
  private play(key: string, sound: (s: Synth) => void): void {
    const synth = this.engine.synth;
    if (!synth || !this.engine.running) return;
    const now = performance.now() / 1000;
    if (now - (this.lastPlayed.get(key) ?? -Infinity) < AUDIO.sfxGap) return;
    this.lastPlayed.set(key, now);
    sound(synth);
  }

  /** The combo note for this hit; ball and laser hits move it one step up the scale. */
  private comboNote(by: HitSource): number {
    const n = Math.min(this.combo, AUDIO.comboNotes - 1);
    if (by === 'ball' || by === 'laser') this.combo++;
    const octave = Math.floor(n / PENTATONIC.length);
    return note((PENTATONIC[n % PENTATONIC.length] ?? 0) + octave * 12, note(-5, C5));
  }
}

function pan(x: number): number {
  return ((x / FIELD.width) * 2 - 1) * PAN_WIDTH;
}
