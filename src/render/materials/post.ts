/**
 * Bloom's bright pass, drawn at half size. Three's own reads one averaged sample and thresholds
 * that, so a thin rim passes or fails depending on how it lands on the half-size pixels and
 * flickers as a brick moves. This thresholds each of the four pixels underneath, then averages.
 */
export const BLOOM_BRIGHT_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float luminosityThreshold;
uniform float smoothWidth;
varying vec2 vUv;

vec3 bright(vec2 uv) {
  vec3 c = texture2D(tDiffuse, uv).rgb;
  return c * smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, luminance(c));
}

void main() {
  vec2 t = 0.5 / vec2(textureSize(tDiffuse, 0));
  vec3 sum = bright(vUv + vec2(-t.x, -t.y)) + bright(vUv + vec2(t.x, -t.y))
    + bright(vUv + vec2(-t.x, t.y)) + bright(vUv + vec2(t.x, t.y));
  gl_FragColor = vec4(sum * 0.25, 1.0);
}
`;

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
