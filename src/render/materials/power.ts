import { SDF } from './common';

/**
 * Segment-display glyphs: each letter is a bitmask over 14 strokes on a box of half-size `g`
 * (see `glyphMask` in render/glyphs.ts for the bit order). Returns the distance to the nearest
 * lit stroke's centre line.
 */
const GLYPH = /* glsl */ `
float glyph(vec2 p, float mask, vec2 g) {
  int m = int(mask + 0.5);
  float d = 1e3;
  for (int i = 0; i < 14; i++) {
    if (((m >> i) & 1) == 0) continue;
    vec2 a = vec2(0.0);
    vec2 b = vec2(0.0);
    if (i == 0) { a = vec2(-g.x, g.y); b = g; }
    else if (i == 1) { a = g; b = vec2(g.x, 0.0); }
    else if (i == 2) { a = vec2(g.x, 0.0); b = vec2(g.x, -g.y); }
    else if (i == 3) { a = -g; b = vec2(g.x, -g.y); }
    else if (i == 4) { a = vec2(-g.x, 0.0); b = -g; }
    else if (i == 5) { a = vec2(-g.x, g.y); b = vec2(-g.x, 0.0); }
    else if (i == 6) { a = vec2(-g.x, 0.0); }
    else if (i == 7) { b = vec2(g.x, 0.0); }
    else if (i == 8) { a = vec2(-g.x, g.y); }
    else if (i == 9) { a = vec2(0.0, g.y); }
    else if (i == 10) { a = g; }
    else if (i == 11) { a = -g; }
    else if (i == 12) { a = vec2(0.0, -g.y); }
    else { a = vec2(g.x, -g.y); }
    d = min(d, sdSegment(p, a, b, 0.0));
  }
  return d;
}
`;

/**
 * Power-up capsule: glass pill with a neon rim and a glowing segment letter, same 2.5D shadow
 * as the paddle. Negative powers get hazard stripes at both ends.
 * params: x = glyph mask, y = 1 for negative powers.
 */
export const CAPSULE_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying vec2 vHalf;
varying vec4 vColor;
varying vec4 vParams;

${SDF}
${GLYPH}

void main() {
  vec2 p = vLocal;
  vec3 tint = vColor.rgb;
  float r = vHalf.y;
  float d = sdRoundBox(p, vHalf, r);
  float dShadow = sdRoundBox(p - vec2(1.5, -2.5), vHalf, r);

  float yN = p.y / vHalf.y;
  vec3 body = tint * 0.1 + tint * pow(clamp(abs(yN), 0.0, 1.0), 3.0) * 0.35;
  body += vec3(0.9, 0.95, 1.0) * smoothstep(0.45, 0.8, yN) * smoothstep(vHalf.x - 1.0, vHalf.x - 6.0, abs(p.x)) * 0.18;

  float ends = smoothstep(vHalf.x - 8.0, vHalf.x - 6.5, abs(p.x));
  float stripes = stroke(fract((p.x + p.y) / 3.0) - 0.5, 0.18);
  body += tint * stripes * ends * vParams.y * 0.45;

  float g = glyph(p, vParams.x, vec2(1.9, 2.9));
  float lit = fill(g - 0.45);
  body = mix(body, mix(tint, vec3(1.0), 0.55), lit);
  body += tint * exp(-max(g - 0.45, 0.0) * 1.6) * 0.3 * (1.0 - lit);
  body += tint * stroke(d + 0.4, 0.35) * 0.95;

  vec4 col = vec4(0.0, 0.0, 0.0, 0.45 * (1.0 - smoothstep(-1.0, 2.5, dShadow)));
  col = over(vec4(body, 1.0) * fill(d), col);
  col.rgb += tint * exp(-max(d, 0.0) * 1.0) * 0.1 * (1.0 - fill(d));
  gl_FragColor = col;
}
`;

/** Laser bolt: a thin vertical beam, white-hot towards the tip, glowing additively. */
export const BOLT_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying vec2 vHalf;
varying vec4 vColor;

${SDF}

void main() {
  vec2 p = vLocal;
  float hl = max(vHalf.y - vHalf.x, 0.0);
  float d = sdSegment(p, vec2(0.0, -hl), vec2(0.0, hl), vHalf.x);
  float t = clamp((p.y + vHalf.y) / (2.0 * vHalf.y), 0.0, 1.0);
  vec3 tint = vColor.rgb;
  float core = fill(d);
  vec3 col = mix(tint, vec3(1.0), 0.6 * t) * core;
  col += tint * exp(-max(d, 0.0) * 0.9) * 0.35 * (1.0 - core) * (0.4 + 0.6 * t);
  gl_FragColor = vec4(col, 0.0);
}
`;

/**
 * Barrier: a segmented energy line across the bottom of the field. Brightens where a ball
 * bounced off it. params: x = strength (fades out at the end), y = last hit x (world), z = hit strength.
 */
export const BARRIER_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying vec2 vHalf;
varying vec2 vWorld;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

void main() {
  vec2 p = vLocal;
  float d = abs(p.y) - vHalf.y;
  float hit = vParams.z * exp(-abs(vWorld.x - vParams.y) / 12.0);
  float segments = 0.55 + 0.45 * step(0.25, fract(vWorld.x / 6.0));
  float core = fill(d) * segments;
  float glow = exp(-max(d, 0.0) * 0.7);
  vec3 tint = vColor.rgb;
  vec3 col = tint * (core * 0.85 + glow * (0.12 + hit * 0.5)) + vec3(1.0) * core * hit * 0.6;
  col *= vParams.x * fill(abs(p.x) - vHalf.x);
  gl_FragColor = vec4(col, 0.0);
}
`;

/**
 * Detonator blast: one thin ring that grows from half the blast radius to all of it while it
 * fades. The instance rectangle is the full blast diameter. params: x = strength (1 -> 0).
 */
export const BLAST_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying vec2 vHalf;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

void main() {
  float k = vParams.x;
  float grow = 1.0 - k * k;
  float r = vHalf.x * mix(0.5, 1.0, grow);
  float d = abs(length(vLocal) - r) - 0.6;
  vec3 tint = vColor.rgb;
  vec3 col = mix(tint, vec3(1.0), 0.4) * fill(d) * 0.9 + tint * exp(-max(d, 0.0) * 0.5) * 0.25;
  gl_FragColor = vec4(col * k, 0.0);
}
`;
