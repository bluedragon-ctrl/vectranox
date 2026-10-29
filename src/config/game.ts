// Playfield in world units. Origin bottom-left, y up. 3:4 portrait, 13 columns of 24-unit bricks.
export const FIELD = {
  width: 312,
  height: 416,
} as const;

export const SIM = {
  tickRate: 120,
  // Longest frame we simulate; anything slower (tab switch, debugger) is dropped.
  maxFrameTime: 0.25,
} as const;

export const PALETTE = {
  bg: 0x07021a,
  magenta: 0xff2a9d,
  cyan: 0x2de2ff,
  purple: 0x9d4dff,
  yellow: 0xffd23f,
  white: 0xf2e9ff,
} as const;
