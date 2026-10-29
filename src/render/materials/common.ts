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

/** Signed distance to the triangle p0-p1-p2 (either winding). */
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0;
  vec2 e1 = p2 - p1;
  vec2 e2 = p0 - p2;
  vec2 v0 = p - p0;
  vec2 v1 = p - p1;
  vec2 v2 = p - p2;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(q1, q1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(q2, q2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
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
