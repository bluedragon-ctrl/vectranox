import { SDF } from './common';

/**
 * Shared by the screen-space scenery of every backdrop. `uVanish` is the vanishing point in device
 * pixels; each backdrop puts its landmark above it, sized by `uSunR` in screen heights.
 * `uDaylight` is the share of the run left, so a backdrop reaches its end state at 0 and a room
 * added to the run moves it back. `uFieldRect` is the playfield (min xy, max xy in device pixels);
 * `uSkip` is the part of it the opaque field always covers, so nothing is drawn there. `uScroll`
 * moves the scenery (it holds still under reduce-FX); `uTime` drives the star twinkle.
 */
const SKY_COMMON = /* glsl */ `
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

bool covered(vec2 frag) {
  return all(greaterThan(frag, uSkip.xy)) && all(lessThan(frag, uSkip.zw));
}

/** Coverage for a distance in pixels. Unlike fill, it holds across the jumps between repeated cells. */
float cover(float px) {
  return clamp(0.5 - px, 0.0, 1.0);
}

/** Stars on a pixel-space lattice, fading towards the horizon. More come out as the sky darkens. */
vec3 stars(vec2 frag, vec2 q, float H) {
  float cellSize = H * 0.018;
  vec2 cell = floor(frag / cellSize);
  float h = hash12(cell);
  float starCut = mix(0.87, 0.93, uDaylight);
  if (h <= starCut) return vec3(0.0);
  vec2 sp = (cell + 0.2 + 0.6 * hash22(cell + 7.0)) * cellSize;
  float d = length(frag - sp) / (H * 0.0016);
  float tw = 1.0 - uTwinkle * 0.5 * (0.5 + 0.5 * sin(uTime * (1.0 + h * 3.0) + h * 80.0));
  return vec3(0.75, 0.7, 1.0) * exp(-d * d) * (h - starCut) * mix(7.0, 14.0, uDaylight) * tw * smoothstep(0.02, 0.25, q.y);
}

/** Perspective floor with a grid scrolling towards the viewer. */
vec3 ground(vec2 q, float dimSky, float dimGlow) {
  // x and z on the ground plane from the perspective divide.
  float z = 1.0 / -q.y;
  vec2 g = vec2(q.x * z * 1.6, z * 0.55 + uScroll * 0.6);
  vec2 fw = fwidth(g);
  vec2 a = abs(fract(g - 0.5) - 0.5) / max(fw, vec2(1e-4));
  float line = 1.0 - clamp(min(a.x, a.y) / 1.3, 0.0, 1.0);
  float far = smoothstep(0.0, 0.18, -q.y);
  line *= clamp(1.4 - max(fw.x, fw.y) * 2.2, 0.0, 1.0);
  vec3 col = mix(uSkyHorizon * 0.35 * dimSky, uSkyTop * 0.6, smoothstep(0.0, 0.4, -q.y));
  col += uGrid * line * (0.22 + 0.6 * far) * dimGlow;
  col += uGrid * 0.18 * exp(q.y * 18.0) * dimGlow;
  return col;
}

/** Horizon line, faded out next to the playfield's side walls so they glow evenly. */
vec3 horizonGlow(vec2 frag, vec2 q, float H, float dimGlow) {
  float wall = min(abs(frag.x - uFieldRect.x), abs(frag.x - uFieldRect.z));
  float horizon = mix(0.15, 1.0, smoothstep(0.0, H * 0.08, wall));
  return uSunBottom * (exp(-abs(q.y) * H * 0.12) * 0.9 + exp(-abs(q.y) * 22.0) * 0.18) * horizon * dimGlow;
}
`;

/**
 * Synthwave sunset: starry sky, striped sun, mountain ridges and a floor grid. At full daylight
 * the sun's centre is `uSunHigh` above the horizon; at 0 it has gone below and the sky has darkened.
 */
export const SKY_FRAGMENT = /* glsl */ `
${SKY_COMMON}

float ridge(float x) {
  float h = 0.0;
  h += abs(sin(x * 6.3 + 1.7)) * 0.045;
  h += abs(sin(x * 15.1 + 0.3)) * 0.02;
  h += abs(sin(x * 37.0 + 2.1)) * 0.007;
  return h * smoothstep(uSunR * 0.6, uSunR * 1.9, abs(x)) + 0.004;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  if (covered(frag)) {
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
    col += stars(frag, q, H);

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
    col = ground(q, dimSky, dimGlow);
  }
  col += horizonGlow(frag, q, H, dimGlow);
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * City lights-out: a skyline at night whose windows and roof signs go dark block by block as the
 * run goes on. One tower over the vanishing point keeps its lights for the last room, and goes
 * dark when that room is cleared. `uSunTop` is the windows, `uSunBottom` the signs and the city's
 * glow, `uRidge` the cooler windows.
 */
export const CITY_FRAGMENT = /* glsl */ `
${SKY_COMMON}

/** Window cell in screen heights. */
const vec2 WINDOW = vec2(0.0062, 0.0095);
const float LAST_TOWER = 0.36;
const float SPIRE = 0.055;

/** Lit while the run has more left than this, switching over as the daylight settles on a step. */
float lit(float rank) {
  return smoothstep(rank - 0.012, rank + 0.012, uDaylight);
}

/** A row of towers standing on the horizon. Rows are told apart by \`salt\`; row 0 has the last tower. */
void towers(vec2 q, float H, float width, float low, float high, float salt, float strength, inout vec3 col) {
  float cell = floor(q.x / width + 0.5);
  bool last = salt < 0.5 && cell == 0.0;
  float block = hash12(vec2(cell, salt + 9.0));
  float height = last ? LAST_TOWER : mix(low, high, hash12(vec2(cell, salt + 3.0)));
  float x = (fract(q.x / width + 0.5) - 0.5) * width;
  float halfWidth = width * 0.42;
  float d = sdRoundBox(vec2(x, q.y - height * 0.5), vec2(halfWidth, height * 0.5), 0.0) * H;
  float body = cover(d);
  if (last) body = max(body, cover(sdSegment(vec2(x, q.y), vec2(0.0, height), vec2(0.0, height + SPIRE), 0.0012) * H));
  col = mix(col, uSkyTop * mix(0.45, 0.8, 1.0 - strength), body);

  // Every other tower has gone dark by the last room, so its rank starts above one room's share.
  float rankOf = 0.09 + 0.91 * block;
  float roof = cover(abs(d) - 0.6) * step(height - 0.002, q.y);
  col += uSunBottom * roof * lit(last ? 0.03 : rankOf) * 0.6 * strength;

  if (last) {
    float beacon = length(vec2(x, q.y - height - SPIRE)) * H;
    col += uSunBottom * (cover(beacon - 2.0) * 0.9 + exp(-beacon * 0.22) * 0.3) * lit(0.03);
  }

  if (body <= 0.0 || abs(x) > halfWidth - WINDOW.x * 0.6 || q.y > height - WINDOW.y * 0.6) return;
  vec2 grid = vec2(x, q.y) / WINDOW;
  vec2 wc = floor(grid);
  vec2 wp = (fract(grid) - 0.5) * WINDOW * H;
  float pane = cover(sdRoundBox(wp, WINDOW * H * vec2(0.3, 0.32), 0.0));
  float pick = hash12(wc + vec2(cell * 17.0, salt * 5.0));
  // Some windows were never lit.
  if (hash12(wc.yx + vec2(salt, cell * 31.0)) < 0.3) return;
  float rank = last ? 0.02 + 0.05 * pick : 0.09 + 0.91 * mix(block, pick, 0.45);
  vec3 tint = pick < 0.75 ? uSunTop : pick < 0.92 ? uRidge : uSunBottom;
  col += tint * pane * lit(rank) * strength * 0.5;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  if (covered(frag)) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float H = uResolution.y;
  vec2 q = (frag - uVanish) / H;
  vec3 col;
  float dimSky = mix(0.3, 1.0, uDaylight);
  float dimGlow = mix(0.12, 1.0, uDaylight);

  if (q.y >= 0.0) {
    float t = clamp(q.y / 0.75, 0.0, 1.0);
    col = mix(uSkyHorizon * dimSky, uSkyTop * mix(0.5, 1.0, uDaylight), pow(t, 0.45));
    col += stars(frag, q, H);
    // The glow the lit city throws on the sky.
    col += uSunBottom * exp(-q.y * 9.0) * 0.14 * uDaylight;
    towers(q, H, 0.043, 0.1, 0.3, 1.0, 0.45, col);
    towers(q, H, 0.062, 0.05, 0.22, 0.0, 1.0, col);
  } else {
    col = ground(q, dimSky, dimGlow);
    col += uSunBottom * exp(q.y * 14.0) * 0.1 * uDaylight;
  }
  col += horizonGlow(frag, q, H, dimGlow);
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Rising tide: the sea moves up a beach towards the viewer under a still moon. Once it reaches the
 * torii gate on the beach the gate sinks, reflected in the water, so its top bar is all that shows
 * in the last room; when that room is cleared only the water and the horizon are left. `uSunTop`
 * is the moon, `uSunBottom` the foam and the horizon, `uRidge` the gate.
 */
export const TIDE_FRAGMENT = /* glsl */ `
${SKY_COMMON}

/** Depth of the waterline: at the end of the run (below the screen) and at its start. */
const float SHORE_END = 0.6;
const float SHORE_START = 16.0;
/** The gate in units of uSunR: where its foot stands below the horizon, and its full height. */
const float GATE_FOOT = 1.1;
const float GATE_HEIGHT = 2.2;

/** Pillars, the tie beam and the post and bar above it, in gate units with the foot at y = 0. */
float gateFrame(vec2 p) {
  vec2 a = vec2(abs(p.x), p.y);
  float d = sdSegment(a, vec2(0.62, 0.0), vec2(0.54, 2.0), 0.06);
  d = min(d, sdRoundBox(a - vec2(0.0, 1.55), vec2(0.76, 0.04), 0.0));
  d = min(d, sdRoundBox(a - vec2(0.0, 1.75), vec2(0.05, 0.18), 0.0));
  return min(d, sdRoundBox(a - vec2(0.0, 1.93), vec2(0.84, 0.045), 0.0));
}

/** The dark top bar, curving up at its ends. */
float gateRoof(vec2 p) {
  return sdRoundBox(vec2(p.x, p.y - 2.08 - 0.16 * p.x * p.x), vec2(0.98, 0.07), 0.0);
}

/** Draws the gate at gate-unit point p, over \`col\`, at the given strength. */
void gate(vec2 p, float H, float strength, inout vec3 col) {
  float px = uSunR * H;
  float roof = gateRoof(p) * px;
  col = mix(col, uRidge * 0.7, cover(gateFrame(p) * px) * strength);
  col = mix(col, uSkyTop * 1.5, cover(roof) * strength);
  col += uRidge * cover(abs(roof) - 0.6) * 0.5 * strength;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  if (covered(frag)) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float H = uResolution.y;
  vec2 q = (frag - uVanish) / H;
  vec3 col;
  float dimSky = mix(0.55, 1.0, uDaylight);
  float dimGlow = mix(0.5, 1.0, uDaylight);
  float zShore = mix(SHORE_END, SHORE_START, uDaylight);
  bool wet = false;

  if (q.y >= 0.0) {
    float t = clamp(q.y / 0.75, 0.0, 1.0);
    col = mix(uSkyHorizon * dimSky, uSkyTop * mix(0.6, 1.0, uDaylight), pow(t, 0.45));
    col += stars(frag, q, H);

    // Moon, under the bloom threshold like the sun, so its glow is drawn here.
    float radius = uSunR * 0.62;
    // Rises behind the gate's top bar.
    vec2 mc = q - vec2(0.0, uSunHigh * 1.35);
    float md = length(mc) - radius;
    float seas = smoothstep(radius * 0.5, radius * 0.2, length(mc - radius * vec2(0.3, 0.25))) * 0.16
      + smoothstep(radius * 0.32, radius * 0.1, length(mc + radius * vec2(0.35, 0.3))) * 0.12;
    col = mix(col, uSunTop * (0.9 - seas), fill(md * H));
    col += uSunTop * exp(-max(md, 0.0) * 8.0) * 0.16 * (1.0 - fill(md * H));
  } else {
    float shoreY = -1.0 / zShore + sin(q.x * 40.0 + uScroll * 0.7) * 0.002;
    float edge = (q.y - shoreY) * H;
    if (edge < 0.0) {
      col = ground(q, dimSky, dimGlow);
    } else {
      wet = true;
      float z = 1.0 / -q.y;
      col = uSkyTop * 0.9 + uSkyHorizon * 0.3 * exp(q.y * 12.0);
      // Moonlight broken up by slow swells, which blur out towards the horizon.
      float phase = z * 5.0 + sin(q.x * z * 3.0) * 1.5 + uScroll * 0.5;
      float swell = 0.5 + 0.5 * sin(phase);
      swell *= clamp(1.4 - fwidth(z * 5.0) * 0.4, 0.0, 1.0);
      float path = exp(-abs(q.x) / (uSunR * 0.28));
      col += uSunTop * path * (0.06 + 0.3 * swell) + uSunBottom * 0.025 * swell;
    }
    col += uSunBottom * (cover(abs(edge) - 0.7) * 0.7 + exp(-abs(edge) * 0.15) * 0.12);
  }

  col += horizonGlow(frag, q, H, dimGlow);

  // The gate sinks from the moment the water reaches it, however deep the window puts it, and has
  // gone as the run ends. It stays clipped at its foot, the one height the water can be seen to reach.
  float foot = -GATE_FOOT * uSunR;
  float reach = (1.0 / -foot - SHORE_END) / (SHORE_START - SHORE_END);
  float sunk = clamp(1.0 - uDaylight / reach, 0.0, 1.0);
  float lift = (q.y - foot) / uSunR + sunk * (GATE_HEIGHT + 0.25);
  if (sunk < 1.0 && abs(q.x) < uSunR * 1.1) {
    if (q.y >= foot) gate(vec2(q.x / uSunR, lift), H, 1.0, col);
    else if (wet) {
      // Reflection, broken up by the same slow swells as the moonlight.
      float ripple = sin(q.y * 150.0 + uScroll * 1.2) * 0.02;
      float mirrored = 2.0 * sunk * (GATE_HEIGHT + 0.25) - lift;
      gate(vec2(q.x / uSunR + ripple, mirrored), H, 0.3, col);
    }
  }
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
