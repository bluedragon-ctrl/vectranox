/**
 * Final full-screen pass: chromatic aberration, full-screen flash, optional CRT (soft
 * scanlines, vignette, grain, flicker), then conversion to the output colour space.
 */
export const FINAL_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uPixelRatio;
uniform float uAberration;
uniform vec4 uFlash;
uniform float uCrt;
uniform float uFlicker;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  vec2 dc = uv - 0.5;
  vec2 shift = dc * uAberration;
  vec3 col = vec3(
    texture2D(tDiffuse, uv + shift).r,
    texture2D(tDiffuse, uv).g,
    texture2D(tDiffuse, uv - shift).b
  );
  col += uFlash.rgb * uFlash.a;

  if (uCrt > 0.5) {
    vec2 px = gl_FragCoord.xy / uPixelRatio;
    float scan = 0.5 + 0.5 * sin(px.y * 6.2831853 / 3.0);
    col *= 0.88 + 0.12 * scan;
    col *= 1.0 - dot(dc, dc) * 0.85;
    col += (hash12(gl_FragCoord.xy + fract(uTime) * 917.0) - 0.5) * 0.018;
    col *= 1.06 + uFlicker * 0.025 * sin(uTime * 120.0);
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <colorspace_fragment>
}
`;
