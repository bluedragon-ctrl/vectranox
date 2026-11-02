import { SDF } from './common';

/**
 * Pinball target: a round lamp in a metal bezel, with the same 2.5D shadow as capsules. Dark
 * glass when unlit, a steady glow when lit; hits flash it white. The instance rectangle is its
 * diameter. params: x = lit (0/1), y = hit flash (1 -> 0).
 */
export const TARGET_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying vec2 vHalf;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

void main() {
  vec2 p = vLocal;
  float r = vHalf.x;
  float d = length(p) - r;
  float dShadow = length(p - vec2(1.2, -2.0)) - r;
  vec3 tint = vColor.rgb;
  float lit = vParams.x;
  float flash = vParams.y;

  float face = fill(d + 1.3);
  vec3 lamp = mix(tint * 0.1, mix(tint, vec3(1.0), 0.35), lit);
  // Dome highlight, top left.
  lamp += vec3(0.9, 0.95, 1.0) * (0.12 + 0.18 * lit) * (1.0 - smoothstep(0.0, 0.55, length(p - vec2(-0.35, 0.35) * r) / r));
  vec3 bezel = vec3(0.55, 0.52, 0.7) * (0.6 + 0.4 * p.y / r) + tint * 0.25 * lit;
  vec3 body = mix(bezel, lamp, face);
  body = mix(body, vec3(1.0), flash * 0.7);

  vec4 col = vec4(0.0, 0.0, 0.0, 0.45 * (1.0 - smoothstep(-1.0, 2.5, dShadow)));
  col = over(vec4(body, 1.0) * fill(d), col);
  col.rgb += tint * exp(-max(d, 0.0) * 0.9) * (0.25 * lit + 0.3 * flash) * (1.0 - fill(d));
  gl_FragColor = col;
}
`;

/**
 * Portal: a small black hole. A black event horizon with a thin photon ring, wrapped in a
 * two-armed accretion disk that spirals in, and a faint outer glow. Covers what is under it.
 * The instance rectangle is its diameter. params: x = spin phase, y = warp flash (1 -> 0).
 */
export const PORTAL_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying vec2 vHalf;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

void main() {
  vec2 p = vLocal;
  float R = vHalf.x;
  float r = length(p);
  float rn = r / R;
  vec3 tint = vColor.rgb;
  float flash = vParams.y;

  // Arms wind tighter towards the centre (log spiral) and turn with the phase.
  float a = atan(p.y, p.x);
  float spiral = 0.5 + 0.5 * sin(2.0 * a + 5.0 * log(max(rn, 0.05)) + vParams.x);
  float disk = smoothstep(1.0, 0.6, rn) * smoothstep(0.32, 0.5, rn);
  float arms = disk * (0.2 + 0.8 * spiral * spiral);
  vec3 col = mix(tint, vec3(1.0), 0.25 * spiral) * arms * (0.75 + 0.6 * flash);

  float horizon = R * 0.36;
  col += mix(tint, vec3(1.0), 0.5) * stroke(r - horizon - 0.4, 0.35) * (0.7 + 0.6 * flash);
  float hole = fill(r - horizon);
  col *= 1.0 - hole;
  col += tint * exp(-max(r - R, 0.0) * 0.8) * 0.12 * (1.0 + flash) * (1.0 - fill(r - R));

  // The hole is opaque black; the disk darkens what is behind it, so it reads on any backdrop.
  float alpha = max(hole, disk * 0.7);
  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * Pad: a dark glass disc the ball passes over. The instance rectangle is its diameter.
 * params: x = kind (0 booster, 1 clock), y = trigger flash (1 -> 0), z = charge (0..1, 1 is
 * ready), w = animation phase (seconds).
 *
 * Booster: a rim and two chevrons pointing up, a wave climbing through them. Clock: a dial with
 * four ticks and a hand that sweeps while it is ready; while it recharges the hand and the lit
 * part of the rim show how far it has come, and the rest is dim. A trigger sends a ring out.
 */
export const PAD_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying vec2 vHalf;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

void main() {
  vec2 p = vLocal;
  float R = vHalf.x;
  float r = length(p);
  vec3 tint = vColor.rgb;
  float flash = vParams.y;
  float charge = vParams.z;
  float t = vParams.w;
  float ready = step(0.999, charge);

  float disc = fill(r - R);
  float rimD = r - (R - 0.7);
  float glow = 0.0;

  if (vParams.x < 0.5) {
    glow += stroke(rimD, 0.4) * (0.7 + 0.3 * sin(t * 5.0));
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      float y = R * (0.05 + 0.4 * fi) - R * 0.25;
      vec2 q = vec2(abs(p.x), p.y - y);
      float d = sdSegment(q, vec2(0.0), vec2(R * 0.42, -R * 0.36), 0.5);
      float wave = 0.5 + 0.5 * sin(t * 9.0 - fi * 1.8);
      glow += fill(d) * (0.35 + 0.75 * wave);
    }
  } else {
    // Clockwise from twelve o'clock, 0..1.
    float turn = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
    float lit = mix(step(turn, charge), 1.0, ready);
    glow += stroke(rimD, 0.4) * mix(0.18, 0.9, lit);
    for (int i = 0; i < 4; i++) {
      float a = float(i) * 1.5707963;
      vec2 dir = vec2(sin(a), cos(a));
      glow += fill(sdSegment(p, dir * R * 0.55, dir * R * 0.72, 0.35)) * mix(0.25, 0.8, ready);
    }
    float hand = mix(charge * 6.2831853, t * 2.5, ready);
    vec2 dir = vec2(sin(hand), cos(hand));
    glow += fill(sdSegment(p, vec2(0.0), dir * R * 0.6, 0.45)) * mix(0.45, 1.0, ready);
    glow += fill(r - 0.9) * 0.8;
  }

  vec3 col = mix(tint, vec3(1.0), 0.3 * flash) * glow * disc * (1.0 + flash);
  // Trigger ring, spreading past the rim as the flash fades.
  float wave = stroke(r - R - (1.0 - flash) * 5.0, 0.6) * flash;
  col += tint * wave;
  col += tint * exp(-max(r - R, 0.0) * 0.9) * (0.08 + 0.1 * ready + 0.3 * flash) * (1.0 - disc);

  float alpha = max(disc * 0.6, wave * 0.5);
  gl_FragColor = vec4(col, alpha);
}
`;
