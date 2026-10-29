/**
 * Shared GLSL. Shaders are written GLSL1-style (attribute/varying/gl_FragColor); three.js
 * converts them for WebGL2, where fwidth and friends are built in.
 *
 * Colours are linear (THREE.Color converts hex values on set). The final post pass converts to sRGB.
 */

/** Vertex shader for QuadBatch: rotated rectangle grown by `uPad` world units on every side. */
export const QUAD_VERTEX = /* glsl */ `
attribute vec4 aRect;
attribute vec4 aColor;
attribute vec4 aParams;
attribute float aRot;
uniform float uPad;
varying vec2 vLocal;
varying vec2 vHalf;
varying vec2 vWorld;
varying vec4 vColor;
varying vec4 vParams;

void main() {
  vec2 local = position.xy * (aRect.zw + 2.0 * uPad);
  float c = cos(aRot);
  float s = sin(aRot);
  vec2 world = aRect.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vLocal = local;
  vHalf = aRect.zw * 0.5;
  vWorld = world;
  vColor = aColor;
  vParams = aParams;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 0.0, 1.0);
}
`;

/** Full-screen triangle-ish quad ignoring the camera (PlaneGeometry(2, 2)). */
export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const SDF = /* glsl */ `
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

/** Capsule from a to b with radius r. */
float sdSegment(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float sdTriangle(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

/** Anti-aliased coverage of the inside (d < 0) of a distance field. */
float fill(float d) {
  float w = max(fwidth(d), 1e-4);
  return clamp(0.5 - d / w, 0.0, 1.0);
}

/** Anti-aliased line of half-width hw centred on the d = 0 contour. */
float stroke(float d, float hw) {
  return fill(abs(d) - hw);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

/** Premultiplied "src over dst". */
vec4 over(vec4 src, vec4 dst) {
  return src + dst * (1.0 - src.a);
}
`;
