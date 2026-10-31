import { SDF } from './common';

/**
 * Screen-space synthwave scenery: starry sky, striped sun, mountain ridges and a perspective
 * floor grid scrolling towards the viewer. `uVanish` is the vanishing point in device pixels;
 * the sun sets above it, with radius `uSunR` in screen heights. `uDaylight` is the share of the
 * run left: at 1 the sun's centre is `uSunHigh` above the horizon, at 0 it has gone below and the
 * sky has darkened. `uFieldRect` is the playfield
 * (min xy, max xy in device pixels); `uSkip` is the part of it the opaque field always covers,
 * so nothing is drawn there. `uScroll` moves the grid and sun stripes (it holds still under
 * reduce-FX); `uTime` drives the star twinkle.
 */
export const SKY_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uScroll;
uniform vec2 uResolution;
uniform vec2 uVanish;
uniform float uSunR;
uniform float uSunHigh;
uniform float uDaylight;
uniform vec4 uSkip;
uniform vec4 uFieldRect;
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
  // What's lit by the sun dims as it sets: the sky falls furthest at the horizon, where it glowed.
  float dimSky = mix(0.3, 1.0, uDaylight);
  float dimGlow = mix(0.4, 1.0, uDaylight);

  if (q.y >= 0.0) {
    float t = clamp(q.y / 0.75, 0.0, 1.0);
    col = mix(uSkyHorizon * dimSky, uSkyTop * mix(0.5, 1.0, uDaylight), pow(t, 0.45));

    // Stars on a pixel-space lattice, fading towards the horizon. More come out as the sky darkens.
    float cellSize = H * 0.018;
    vec2 cell = floor(frag / cellSize);
    float h = hash12(cell);
    float starCut = mix(0.87, 0.93, uDaylight);
    if (h > starCut) {
      vec2 sp = (cell + 0.2 + 0.6 * hash22(cell + 7.0)) * cellSize;
      float d = length(frag - sp) / (H * 0.0016);
      float tw = 1.0 - uTwinkle * 0.5 * (0.5 + 0.5 * sin(uTime * (1.0 + h * 3.0) + h * 80.0));
      col += vec3(0.75, 0.7, 1.0) * exp(-d * d) * (h - starCut) * mix(7.0, 14.0, uDaylight) * tw * smoothstep(0.02, 0.25, q.y);
    }

    // Sun: one gradient over the whole disc, with cut-outs that widen gradually towards the
    // horizon. Kept under the bloom threshold (bloom would only catch the yellow top), so its
    // glow is drawn here, even all round, and goes with the last of the sun.
    vec2 sc = q - vec2(0.0, mix(-uSunR, uSunHigh, uDaylight));
    float sd = length(sc) - uSunR;
    float sy = sc.y / uSunR;
    vec3 sunColor = mix(uSunBottom, uSunTop, smoothstep(-1.0, 1.0, clamp(sy, -1.0, 1.0)));
    float band = fract(sy * 8.0 + uScroll * 0.12);
    float gap = smoothstep(0.7, -1.0, sy) * 0.55;
    float aa = fwidth(sy * 8.0);
    float cut = gap < 0.005 ? 1.0 : smoothstep(gap - aa, gap + aa, band);
    float sunMask = fill(sd * H) * cut;
    col = mix(col, sunColor * 0.88, sunMask);
    col += sunColor * exp(-max(sd, 0.0) * 7.0) * 0.22 * (1.0 - fill(sd * H)) * smoothstep(0.0, 0.08, uDaylight);

    // Mountain ridge with a neon edge and faint contour lines.
    float rh = ridge(q.x);
    float rd = (q.y - rh) * H;
    float inRidge = fill(rd);
    float contour = stroke(fract(q.y * 90.0) - 0.5, 0.06) * smoothstep(0.0, -0.03 * H, rd);
    vec3 rock = uSkyTop * 0.6 + uRidge * contour * 0.12;
    col = mix(col, rock, inRidge);
    col += uRidge * (stroke(rd, 0.6) * 0.9 + exp(-abs(rd) * 0.25) * 0.15) * dimGlow;
  } else {
    // Floor: x and z on the ground plane from the perspective divide.
    float z = 1.0 / -q.y;
    vec2 g = vec2(q.x * z * 1.6, z * 0.55 + uScroll * 0.6);
    vec2 fw = fwidth(g);
    vec2 a = abs(fract(g - 0.5) - 0.5) / max(fw, vec2(1e-4));
    float line = 1.0 - clamp(min(a.x, a.y) / 1.3, 0.0, 1.0);
    float far = smoothstep(0.0, 0.18, -q.y);
    line *= clamp(1.4 - max(fw.x, fw.y) * 2.2, 0.0, 1.0);
    col = mix(uSkyHorizon * 0.35 * dimSky, uSkyTop * 0.6, smoothstep(0.0, 0.4, -q.y));
    col += uGrid * line * (0.22 + 0.6 * far) * dimGlow;
    col += uGrid * 0.18 * exp(q.y * 18.0) * dimGlow;
  }
  // Horizon line, faded out next to the playfield's side walls so they glow evenly.
  float wall = min(abs(frag.x - uFieldRect.x), abs(frag.x - uFieldRect.z));
  float horizon = mix(0.15, 1.0, smoothstep(0.0, H * 0.08, wall));
  col += uSunBottom * (exp(-abs(q.y) * H * 0.12) * 0.9 + exp(-abs(q.y) * 22.0) * 0.18) * horizon * dimGlow;
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * The playfield: opaque dark well over the scenery, neon U-shaped frame (the bottom is open) and a dashed death line.
 * `uHits` holds recent wall impacts: xy = world position, z = strength (0..1).
 * `uLine` is the line marching formations must not reach: x = height, y = brightness (0 when the stage has none).
 */
export const FIELD_FRAGMENT = /* glsl */ `
uniform vec2 uField;
uniform vec4 uHits[8];
uniform float uDanger;
uniform vec2 uLine;
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

  float lineY = w.y - uLine.x;
  float lineDash = step(0.35, fract(w.x / 13.0));
  col.rgb += uDeath * (stroke(lineY, 0.4) * lineDash + exp(-abs(lineY) * 0.3) * 0.12) * uLine.y * inside;
  gl_FragColor = col;
}
`;
