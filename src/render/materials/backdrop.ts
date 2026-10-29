import { SDF } from './common';

/**
 * Screen-space synthwave scenery: starry sky, striped sun, mountain ridges and a perspective
 * floor grid scrolling towards the viewer. `uVanish` is the vanishing point in device pixels;
 * the sun sits on it, with radius `uSunR` in screen heights. `uSkip` (min xy, max xy in device
 * pixels) is covered by the opaque playfield, so nothing is drawn there.
 */
export const SKY_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uVanish;
uniform float uSunR;
uniform vec4 uSkip;
uniform float uTwinkle;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSunTop;
uniform vec3 uSunBottom;
uniform vec3 uGrid;
uniform vec3 uRidge;

${SDF}

float ridge(float x) {
  float h = 0.0;
  h += abs(sin(x * 6.3 + 1.7)) * 0.045;
  h += abs(sin(x * 15.1 + 0.3)) * 0.02;
  h += abs(sin(x * 37.0 + 2.1)) * 0.007;
  return h * smoothstep(uSunR * 0.6, uSunR * 1.9, abs(x)) + 0.004;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  if (all(greaterThan(frag, uSkip.xy)) && all(lessThan(frag, uSkip.zw))) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float H = uResolution.y;
  vec2 q = (frag - uVanish) / H;
  vec3 col;

  if (q.y >= 0.0) {
    float t = clamp(q.y / 0.75, 0.0, 1.0);
    col = mix(uSkyHorizon, uSkyTop, pow(t, 0.45));

    // Stars on a pixel-space lattice, fading towards the horizon.
    float cellSize = H * 0.018;
    vec2 cell = floor(frag / cellSize);
    float h = hash12(cell);
    if (h > 0.93) {
      vec2 sp = (cell + 0.2 + 0.6 * hash22(cell + 7.0)) * cellSize;
      float d = length(frag - sp) / (H * 0.0016);
      float tw = 1.0 - uTwinkle * 0.5 * (0.5 + 0.5 * sin(uTime * (1.0 + h * 3.0) + h * 80.0));
      col += vec3(0.75, 0.7, 1.0) * exp(-d * d) * (h - 0.93) * 14.0 * tw * smoothstep(0.02, 0.25, q.y);
    }

    // Sun: one gradient over the whole disc, with cut-outs that widen gradually towards the
    // horizon. Kept under the bloom threshold (bloom would only catch the yellow top), so its
    // glow is drawn here, even all round.
    vec2 sc = q - vec2(0.0, uSunR * 0.55);
    float sd = length(sc) - uSunR;
    float sy = sc.y / uSunR;
    vec3 sunColor = mix(uSunBottom, uSunTop, smoothstep(-1.0, 1.0, clamp(sy, -1.0, 1.0)));
    float band = fract(sy * 8.0 + uTime * 0.12);
    float gap = smoothstep(0.7, -1.0, sy) * 0.55;
    float aa = fwidth(sy * 8.0);
    float cut = gap < 0.005 ? 1.0 : smoothstep(gap - aa, gap + aa, band);
    float sunMask = fill(sd * H) * cut;
    col = mix(col, sunColor * 0.88, sunMask);
    col += sunColor * exp(-max(sd, 0.0) * 7.0) * 0.22 * (1.0 - fill(sd * H));

    // Mountain ridge with a neon edge and faint contour lines.
    float rh = ridge(q.x);
    float rd = (q.y - rh) * H;
    float inRidge = fill(rd);
    float contour = stroke(fract(q.y * 90.0) - 0.5, 0.06) * smoothstep(0.0, -0.03 * H, rd);
    vec3 rock = uSkyTop * 0.6 + uRidge * contour * 0.12;
    col = mix(col, rock, inRidge);
    col += uRidge * (stroke(rd, 0.6) * 0.9 + exp(-abs(rd) * 0.25) * 0.15);
  } else {
    // Floor: x and z on the ground plane from the perspective divide.
    float z = 1.0 / -q.y;
    vec2 g = vec2(q.x * z * 1.6, z * 0.55 + uTime * 0.6);
    vec2 fw = fwidth(g);
    vec2 a = abs(fract(g - 0.5) - 0.5) / max(fw, vec2(1e-4));
    float line = 1.0 - clamp(min(a.x, a.y) / 1.3, 0.0, 1.0);
    float far = smoothstep(0.0, 0.18, -q.y);
    line *= clamp(1.4 - max(fw.x, fw.y) * 2.2, 0.0, 1.0);
    col = mix(uSkyHorizon * 0.35, uSkyTop * 0.6, smoothstep(0.0, 0.4, -q.y));
    col += uGrid * line * (0.22 + 0.6 * far);
    col += uGrid * 0.18 * exp(q.y * 18.0);
  }
  // Horizon line.
  col += uSunBottom * exp(-abs(q.y) * H * 0.12) * 0.9 + uSunBottom * exp(-abs(q.y) * 22.0) * 0.18;
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * The playfield: opaque dark well over the scenery, neon U-shaped frame (the bottom is open) and a dashed death line.
 * `uHits` holds recent wall impacts: xy = world position, z = strength (0..1).
 */
export const FIELD_FRAGMENT = /* glsl */ `
uniform vec2 uField;
uniform vec4 uHits[8];
uniform float uDanger;
uniform vec3 uFrame;
uniform vec3 uGuide;
uniform vec3 uDeath;
varying vec2 vWorld;

${SDF}

void main() {
  vec2 w = vWorld;
  vec2 halfSize = uField * 0.5;
  float inside = fill(sdRoundBox(w - halfSize, halfSize, 0.0));

  float lowGlow = exp(-w.y * 0.05) * (0.05 + uDanger * 0.5);
  // Top of the well is a touch lighter so it doesn't read as a hole.
  vec3 interior = uGuide * 0.012 * smoothstep(0.0, uField.y, w.y) + uDeath * lowGlow;
  vec4 col = vec4(interior + vec3(0.003, 0.001, 0.009), 1.0) * inside;

  float d = min(
    min(sdSegment(w, vec2(0.0, 0.0), vec2(0.0, uField.y), 0.0), sdSegment(w, vec2(uField.x, 0.0), uField, 0.0)),
    sdSegment(w, vec2(0.0, uField.y), uField, 0.0)
  );
  float hit = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 h = uHits[i];
    hit += h.z * exp(-length(w - h.xy) / 8.0);
  }
  // Kept below the bloom threshold so the frame glows the same everywhere (bloom would
  // brighten the top edge, which sits next to the bricks and the screen border).
  vec3 frame = uFrame * (1.0 + hit * 0.15);
  col.rgb += frame * (stroke(d, 0.5) * 0.85 + exp(-d * 0.5) * 0.18);

  float dash = step(0.5, fract(w.x / 8.0)) * step(0.0, w.x) * step(w.x, uField.x);
  col.rgb += uDeath * stroke(w.y, 0.35) * dash * (0.5 + uDanger);
  gl_FragColor = col;
}
`;
