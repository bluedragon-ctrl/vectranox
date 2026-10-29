import { SDF } from './common';

/**
 * Ball: white-hot core, tinted rim and a wide soft halo. The instance rectangle is the ball's
 * diameter; `uPad` holds the halo. params: x = glow boost (0..1).
 */
export const BALL_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying vec2 vHalf;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

void main() {
  float r = vHalf.x;
  float d = length(vLocal) - r;
  vec3 tint = vColor.rgb;
  float boost = vParams.x;
  float body = fill(d);
  float t = clamp(length(vLocal) / r, 0.0, 1.0);
  vec3 core = mix(vec3(1.25, 1.2, 1.3), tint * 1.1, smoothstep(0.35, 1.0, t));
  vec4 col = vec4(core, 1.0) * body;
  float halo = exp(-max(d, 0.0) * 1.1) * (0.15 + boost * 0.15);
  col.rgb += tint * halo * (1.0 - body);
  gl_FragColor = col * vColor.a;
}
`;

/**
 * Trail segment: a capsule along local x from -L/2 to +L/2, tapering from radius params.x at
 * the head (+x) to params.y at the tail. Colour fades from colour.a at the head to params.z
 * at the tail. Drawn with max blending so overlapping joints don't double up.
 */
export const TRAIL_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying vec2 vHalf;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

void main() {
  float len = max(vHalf.x - max(vParams.x, vParams.y), 0.0);
  vec2 a = vec2(-len, 0.0);
  vec2 b = vec2(len, 0.0);
  float h = clamp((vLocal.x - a.x) / max(b.x - a.x, 1e-4), 0.0, 1.0);
  float r = mix(vParams.y, vParams.x, h);
  float d = sdSegment(vLocal, a, b, 0.0) - r;
  float k = mix(vParams.z, vColor.a, h);
  float core = fill(d);
  float glow = exp(-max(d, 0.0) * 0.45);
  vec3 col = vColor.rgb * (core * 0.7 + glow * 0.12) * k;
  gl_FragColor = vec4(col, 0.0);
}
`;
