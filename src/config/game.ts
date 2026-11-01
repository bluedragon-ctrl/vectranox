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

// Menu choices for render resolution, as shares of the screen's: `auto` follows QUALITY.autoSteps.
export const RESOLUTIONS = ['auto', 1, 0.75, 0.5] as const;

export const QUALITY = {
  // Tried in order while the frame rate stays below minFps. The game itself never slows down.
  autoSteps: [
    { scale: 1, bloom: true },
    { scale: 0.75, bloom: true },
    { scale: 0.5, bloom: true },
    { scale: 0.5, bloom: false },
  ],
  minFps: 45,
  // Seconds of frames averaged per check, and those skipped first so a change can settle.
  sampleTime: 3,
  settleTime: 1,
  // A step must raise the frame rate this much to stay, or it is undone and checks stop. A screen
  // or browser capped at 30 fps would otherwise lose quality for nothing.
  minGain: 1.1,
} as const;

// Paddle position is its centre.
export const PADDLE = {
  width: 52,
  height: 8,
  y: 28,
  // Held keys ramp from keyStartSpeed to keySpeed over keyRamp seconds: a tap nudges, a hold dashes.
  keyStartSpeed: 80,
  keySpeed: 400,
  keyRamp: 0.12,
} as const;

export const BALL = {
  radius: 4,
  baseSpeed: 230,
  // Added to the base speed for every stage cleared (12 stages per run).
  stageSpeedStep: 9,
  // Added to a ball's speed on every brick hit, up to maxSpeed.
  hitSpeedStep: 2,
  maxSpeed: 460,
  // Bounce angle from vertical when the ball hits the very edge of the paddle.
  maxBounceAngle: (60 * Math.PI) / 180,
  // Minimum |vy| as a fraction of speed, so the ball never travels near-horizontally.
  minVerticalRatio: 0.3,
  // Random launch angle from vertical, +/-.
  serveJitter: (12 * Math.PI) / 180,
} as const;

// Brick grid: row 0 starts `top` units below the top wall.
export const BRICK = {
  width: 24,
  height: 12,
  cols: 13,
  top: 36,
} as const;

export const RULES = {
  lives: 3,
  stageClearDelay: 1.6,
  // A ball below this y is lost.
  lostBallY: -16,
} as const;

export const SCORE = {
  hit: 10,
  perHp: 50,
  explosive: 75,
  capsule: 100,
  // Chain bonus: every brick a ball destroys after the first, before it touches the paddle again,
  // earns chainStep more than the one before, up to chainMax per brick.
  chainStep: 25,
  chainMax: 250,
} as const;

export const INPUT = {
  // Paddle travel per mouse pixel, relative to the on-screen field scale.
  mouseSensitivity: 1,
  // Units/s the paddle glides back to a visible cursor that moved on during a stun.
  stunCatchUp: 420,
} as const;

export const PALETTE = {
  bg: 0x07021a,
  magenta: 0xff2a9d,
  cyan: 0x2de2ff,
  purple: 0x9d4dff,
  yellow: 0xffd23f,
  white: 0xf2e9ff,
  blue: 0x3d8bff,
  red: 0xff3b30,
  orange: 0xff8a2a,
} as const;
