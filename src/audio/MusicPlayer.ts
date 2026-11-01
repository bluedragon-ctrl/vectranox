import { AUDIO } from '../config/audio';

export interface Track {
  name: string;
  url: string;
}

/** Every .ogg / .mp3 dropped into src/assets/music is picked up at build time. */
const FILES = import.meta.glob<string>('../assets/music/*.{ogg,mp3}', { eager: true, query: '?url', import: 'default' });

export const TRACKS: Track[] = Object.entries(FILES)
  .map(([path, url]) => ({ name: trackName(path), url }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** "../assets/music/02_night-drive.ogg" → "02 NIGHT DRIVE". */
function trackName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  return file.replace(/[_-]+/g, ' ').trim().toUpperCase();
}

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode;
  /** Set once the deck starts fading out, so it never triggers the next crossfade twice. */
  leaving: boolean;
  stopTimer: number;
}

/**
 * Shuffled playlist on two decks: as a track nears its end the other deck starts the next one and
 * the two crossfade. Tracks stream through media elements, so long files are never decoded whole.
 */
export class MusicPlayer {
  /** Called with the new track's name, or null when nothing can play. */
  onTrack: ((name: string | null) => void) | null = null;

  private ctx: AudioContext | null = null;
  private decks: Deck[] = [];
  private active = 0;
  private order: number[] = [];
  private lastPlayed = -1;
  private failures = 0;
  private enabled = true;

  get hasTracks(): boolean {
    return TRACKS.length > 0;
  }

  /** Starts the playlist once the audio context exists. */
  start(ctx: AudioContext, out: AudioNode): void {
    if (this.ctx || !this.hasTracks) return;
    this.ctx = ctx;
    this.decks = [0, 1].map(() => {
      const el = new Audio();
      el.preload = 'auto';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(out);
      const deck: Deck = { el, gain, leaving: true, stopTimer: 0 };
      el.addEventListener('timeupdate', () => {
        const left = el.duration - el.currentTime;
        if (this.isCurrent(deck) && Number.isFinite(left) && left <= AUDIO.crossfade) this.advance(Math.max(left, 0.1));
      });
      el.addEventListener('ended', () => {
        if (this.isCurrent(deck)) this.advance(0.1);
      });
      el.addEventListener('playing', () => {
        if (this.isCurrent(deck)) this.failures = 0;
      });
      el.addEventListener('error', () => {
        if (!this.isCurrent(deck)) return;
        // A broken file: skip it, but stop once every track has failed in a row.
        if (++this.failures < TRACKS.length) this.advance(0.1);
        else this.stop();
      });
      return deck;
    });
    if (this.enabled) this.advance(AUDIO.skipFade);
  }

  /**
   * Disabled music is paused rather than left playing silently, and resumes where it stopped.
   * The pause waits out the bus fade so it doesn't click.
   */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    const deck = this.decks[this.active];
    if (!deck) return;
    window.clearTimeout(deck.stopTimer);
    if (!on) deck.stopTimer = window.setTimeout(() => deck.el.pause(), 100);
    else if (deck.leaving) this.advance(AUDIO.skipFade);
    else deck.el.play().catch(() => undefined);
  }

  /** Skips to the next track. */
  next(): void {
    if (this.ctx && this.enabled) this.advance(AUDIO.skipFade);
  }

  private isCurrent(deck: Deck): boolean {
    return this.enabled && deck === this.decks[this.active] && !deck.leaving;
  }

  /** Fades the current deck out and the next track in on the other deck. */
  private advance(fade: number): void {
    const ctx = this.ctx;
    const track = TRACKS[this.nextTrack()];
    const prev = this.decks[this.active];
    this.active ^= 1;
    const deck = this.decks[this.active];
    if (!ctx || !track || !prev || !deck) return;
    const now = ctx.currentTime;

    if (!prev.leaving) {
      prev.leaving = true;
      ramp(prev.gain, 0, now, fade);
      window.clearTimeout(prev.stopTimer);
      prev.stopTimer = window.setTimeout(() => prev.el.pause(), fade * 1000 + 100);
    }

    window.clearTimeout(deck.stopTimer);
    deck.leaving = false;
    deck.el.src = track.url;
    ramp(deck.gain, 1, now, fade);
    // Rejections (unsupported file) also fire 'error', which skips the track.
    deck.el.play().catch(() => undefined);
    this.onTrack?.(track.name);
  }

  private stop(): void {
    for (const deck of this.decks) {
      deck.leaving = true;
      deck.el.pause();
    }
    this.onTrack?.(null);
  }

  /** Index of the next track: a shuffled pass through the list, never the same track twice in a row. */
  private nextTrack(): number {
    if (this.order.length === 0) {
      const last = this.lastPlayed;
      this.order = shuffle(TRACKS.map((_, i) => i));
      if (this.order.length > 1 && this.order[this.order.length - 1] === last) this.order.unshift(this.order.pop()!);
    }
    this.lastPlayed = this.order.pop() ?? 0;
    return this.lastPlayed;
  }
}

function ramp(gain: GainNode, target: number, now: number, fade: number): void {
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(target, now + Math.max(fade, 0.01));
}

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}
