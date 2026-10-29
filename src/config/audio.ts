/*
 * Audio tuning: volume steps, music crossfade and the pause muffle. Per-sound levels and pitches
 * live next to the sounds in `src/audio/GameSounds.ts`.
 */
export const AUDIO = {
  /** Volume sliders go from 0 to this many steps; gain follows the square of the level. */
  steps: 10,
  defaults: { master: 8, music: 6, sfx: 8, mute: false },
  /** Seconds two music tracks overlap when one runs into the next. */
  crossfade: 4,
  /** Crossfade when the player skips a track. */
  skipFade: 1.2,
  /** While paused the music drops behind a lowpass filter. */
  pause: { cutoff: 650, gain: 0.6, ramp: 0.3 },
  /** The same sound plays at most once in this many seconds (a blast breaks many bricks in one tick). */
  sfxGap: 0.03,
  /** Brick hits since the paddle last touched a ball climb a pentatonic scale, up to this many notes. */
  comboNotes: 12,
} as const;
