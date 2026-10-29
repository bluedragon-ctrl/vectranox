import { AUDIO } from '../config/audio';
import type { AudioSettings } from '../core/settings';
import { MusicPlayer } from './MusicPlayer';
import { Synth } from './synth';

/**
 * Owns the WebAudio graph:
 *
 *   sfx bus ──────────────────────┐
 *   music decks → muffle → music ─┴→ master → limiter → speakers
 *
 * Browsers only let audio start from a user gesture, so the context is created on the first
 * click or key press (`unlock`); until then the game is silent and sounds are simply skipped.
 */
export class AudioEngine {
  readonly music = new MusicPlayer();
  /** Null until the first user gesture. */
  synth: Synth | null = null;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private muffleGain: GainNode | null = null;
  private muffled = false;

  constructor(private settings: AudioSettings) {}

  /** True once sounds can play right now. */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Call from a user gesture: creates the context the first time, resumes it after that. */
  unlock(): void {
    if (!this.ctx) this.build(new AudioContext());
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => undefined);
  }

  apply(settings: AudioSettings): void {
    this.settings = { ...settings };
    if (!this.ctx || !this.master || !this.musicBus || !this.sfxBus) return;
    const now = this.ctx.currentTime;
    const level = (steps: number) => (steps / AUDIO.steps) ** 2;
    smooth(this.master.gain, settings.mute ? 0 : level(settings.master), now);
    smooth(this.musicBus.gain, level(settings.music), now);
    smooth(this.sfxBus.gain, level(settings.sfx), now);
  }

  /** Pause screen: the music drops behind a lowpass filter. */
  setMuffled(on: boolean): void {
    this.muffled = on;
    if (!this.ctx || !this.muffle || !this.muffleGain) return;
    const now = this.ctx.currentTime;
    const { cutoff, gain, ramp } = AUDIO.pause;
    const nyquist = this.ctx.sampleRate / 2;
    this.muffle.frequency.cancelScheduledValues(now);
    this.muffle.frequency.setValueAtTime(this.muffle.frequency.value, now);
    this.muffle.frequency.exponentialRampToValueAtTime(on ? cutoff : nyquist, now + ramp);
    smooth(this.muffleGain.gain, on ? gain : 1, now, ramp);
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    // Brick showers stack many voices; a hard-kneed compressor keeps them from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.connect(limiter);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.muffleGain = ctx.createGain();
    this.muffleGain.connect(this.musicBus);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = ctx.sampleRate / 2;
    this.muffle.connect(this.muffleGain);

    this.synth = new Synth(ctx, this.sfxBus);
    this.apply(this.settings);
    this.setMuffled(this.muffled);
    this.music.start(ctx, this.muffle);
  }
}

/** Short ramp instead of a jump, so volume changes don't click. */
function smooth(param: AudioParam, value: number, now: number, time = 0.05): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + time);
}
