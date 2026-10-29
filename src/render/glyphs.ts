/**
 * Strokes of the 14-segment glyphs drawn by the capsule shader, by bit:
 *
 *    ---0---
 *   |\  |  /|
 *   5 8 9 10 1
 *   |  \|/  |
 *    -6- -7-
 *   |  /|\  |
 *   4 11 12 13 2
 *   |/  |  \|
 *    ---3---
 */
const SEGMENTS: Record<string, readonly number[]> = {
  B: [0, 1, 2, 3, 7, 9, 12],
  C: [0, 3, 4, 5],
  E: [0, 3, 4, 5, 6],
  F: [0, 4, 5, 6],
  L: [3, 4, 5],
  M: [1, 2, 4, 5, 8, 10],
  N: [1, 2, 4, 5, 8, 13],
  P: [0, 1, 4, 5, 6, 7],
  S: [0, 2, 3, 5, 6, 7],
  '+': [6, 7, 9, 12],
};

export function glyphMask(ch: string): number {
  const segs = SEGMENTS[ch];
  if (!segs) throw new Error(`No glyph for '${ch}'`);
  return segs.reduce((mask, s) => mask | (1 << s), 0);
}
