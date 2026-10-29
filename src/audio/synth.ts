interface Envelope {
  /** Seconds from now. */
  at?: number;
  attack?: number;
  /** Total length, attack included. */
  dur: number;
  gain: number;
  /** Stereo position, -1..1. */
  pan?: number;
}

export interface ToneOpts extends Envelope {
  type?: OscillatorType;
  freq: number;
  /** Pitch at the end of the sound (exponential glide). */
  to?: number;
  /** Lowpass cutoff, to soften saw and square waves. */
  cutoff?: number;
}

export interface NoiseOpts extends Envelope {
  filter: BiquadFilterType;
  freq: number;
  /** Filter frequency at the end of the sound (exponential sweep). */
  to?: number;
  q?: number;
}

/** Frequency `semis` semitones above `base`. */
export function note(semis: number, base = 440): number {
  return base * 2 ** (semis / 12);
}

/**
 * One-shot voices for the sound effects: an oscillator or filtered noise through a gain envelope
 * and a stereo panner. Every voice builds its own short-lived nodes and is gone once it stops.
 */
export class Synth {
  private noiseBuffer: AudioBuffer;

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
  ) {
    const length = ctx.sampleRate;
    this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  tone(o: ToneOpts): void {
    const t = this.ctx.currentTime + (o.at ?? 0);
    const osc = this.ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    let src: AudioNode = osc;
    if (o.cutoff) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.cutoff;
      src = osc.connect(lp);
    }
    osc.start(t);
    osc.stop(this.envelope(src, t, o));
  }

  /** Several tones in a row, `step` seconds apart. */
  notes(freqs: number[], step: number, o: Omit<ToneOpts, 'freq'>): void {
    freqs.forEach((freq, i) => this.tone({ ...o, freq, at: (o.at ?? 0) + i * step }));
  }

  noise(o: NoiseOpts): void {
    const t = this.ctx.currentTime + (o.at ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = o.filter;
    filter.Q.value = o.q ?? 1;
    filter.frequency.setValueAtTime(o.freq, t);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    src.connect(filter);
    // Random offset so repeated bursts don't sound identical.
    src.start(t, Math.random() * 0.5);
    src.stop(this.envelope(filter, t, o));
  }

  /** Connects `src` through a gain envelope (and panner) to the output; returns the stop time. */
  private envelope(src: AudioNode, t: number, o: Envelope): number {
    const attack = o.attack ?? 0.004;
    const end = t + Math.max(o.dur, attack + 0.01);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    let last: AudioNode = src.connect(g);
    if (o.pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      last = last.connect(p);
    }
    last.connect(this.out);
    return end + 0.02;
  }
}
