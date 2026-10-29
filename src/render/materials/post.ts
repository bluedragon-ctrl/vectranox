/**
 * Final full-screen pass: chromatic aberration and full-screen flash, then conversion to the
 * output colour space.
 */
export const FINAL_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uAberration;
uniform vec4 uFlash;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  vec2 shift = (uv - 0.5) * uAberration;
  vec3 col = vec3(
    texture2D(tDiffuse, uv + shift).r,
    texture2D(tDiffuse, uv).g,
    texture2D(tDiffuse, uv - shift).b
  );
  col += uFlash.rgb * uFlash.a;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <colorspace_fragment>
}
`;
