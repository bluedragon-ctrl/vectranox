import { SDF } from './common';

/**
 * Glass glint: a short hard-edged diamond sliver, sharp at both ends and even along its length,
 * drawn along local x (the quad is rotated to its velocity). Colour alpha is the fade.
 */
export const GLINT_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying vec2 vHalf;
varying vec4 vColor;

${SDF}

void main() {
  vec2 p = vLocal;
  float d = (abs(p.x) / vHalf.x + abs(p.y) / vHalf.y - 1.0) * min(vHalf.x, vHalf.y);
  gl_FragColor = vec4(mix(vColor.rgb, vec3(1.0), 0.45) * fill(d) * vColor.a, 0.0);
}
`;

/**
 * Glass piece of a shattered brick: a triangle with vertices params.xy, params.zw and
 * -(params.xy + params.zw) around the quad centre. Tinted translucent body, bright cut edges.
 * Colour rgb already includes the facet glint (computed from the piece's spin on the CPU).
 */
export const PIECE_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

void main() {
  vec2 a = vParams.xy;
  vec2 b = vParams.zw;
  float d = sdTri(vLocal, a, b, -(a + b));
  float body = fill(d);
  vec3 tint = vColor.rgb;
  float fade = vColor.a;
  vec3 c = tint * 0.45 + tint * stroke(d + 0.3, 0.3) * 1.1;
  vec4 col = vec4(c, 0.7) * body * fade;
  col.rgb += tint * exp(-max(d, 0.0) * 1.2) * 0.12 * fade * (1.0 - body);
  gl_FragColor = col;
}
`;

/**
 * Metal piece of a broken armoured (tough) brick: the same triangle as PIECE_FRAGMENT, but an
 * opaque plate with a lit cut edge and no glow. The spin glint in colour rgb reads as metal flashing.
 */
export const METAL_PIECE_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

void main() {
  vec2 a = vParams.xy;
  vec2 b = vParams.zw;
  float d = sdTri(vLocal, a, b, -(a + b));
  vec3 tint = vColor.rgb;
  vec3 c = tint * 0.7 + mix(tint, vec3(1.0), 0.5) * stroke(d + 0.3, 0.3) * 0.8;
  gl_FragColor = vec4(c, 1.0) * fill(d) * vColor.a;
}
`;
