import { SDF } from './common';

/**
 * Stylised glass bricks with a little 2.5D depth: a bevelled top face (fresnel rim, inner
 * highlight, refracted backdrop), a darker side face below it, a soft drop shadow and a neon halo.
 *
 * Instance data: colour rgb = tint, a = build-in progress (0..1, 1 = fully built).
 * params: x = kind (0 normal, 1 tough, 2 steel), y = damage (0..1), z = hit flash, w = random seed.
 * The instance rectangle is the brick's visual footprint; `uPad` leaves room for halo and shadow.
 */
export const BRICK_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform sampler2D uBackdrop;
uniform vec2 uResolution;
uniform float uPxPerUnit;
varying vec2 vLocal;
varying vec2 vHalf;
varying vec2 vWorld;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

const float DEPTH = 2.6;
const float RADIUS = 1.6;
const float BEVEL = 2.4;

float crackField(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + hash22(cell + o) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return sqrt(d2) - sqrt(d1);
}

void main() {
  vec2 p = vLocal;
  vec3 tint = vColor.rgb;
  float appear = vColor.a;
  float kind = vParams.x;
  float damage = vParams.y;
  float flash = vParams.z;
  float seed = vParams.w;
  bool steel = kind > 1.5;
  bool tough = kind > 0.5 && !steel;

  // Top face sits above the side face; together they fill the footprint.
  vec2 hb = vec2(vHalf.x, vHalf.y - DEPTH * 0.5);
  vec2 pt = p - vec2(0.0, DEPTH * 0.5);
  float dTop = sdRoundBox(pt, hb, RADIUS);
  float dSil = sdRoundBox(p, vHalf, RADIUS);
  float dShadow = sdRoundBox(p - vec2(2.0, -3.0), vHalf, RADIUS);

  // Pillow bevel: tilt the normal outwards near the edge of the top face.
  const vec2 e = vec2(0.05, 0.0);
  vec2 grad = vec2(
    sdRoundBox(pt + e.xy, hb, RADIUS) - sdRoundBox(pt - e.xy, hb, RADIUS),
    sdRoundBox(pt + e.yx, hb, RADIUS) - sdRoundBox(pt - e.yx, hb, RADIUS)
  ) / (2.0 * e.x);
  float bevel = 1.0 - smoothstep(0.0, BEVEL, -dTop);
  vec3 n = normalize(vec3(grad * bevel * 1.4, 1.0));
  vec3 L = normalize(vec3(-0.45, 0.75, 0.6));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, H), 0.0), 48.0);
  float fres = clamp((1.0 - n.z) / 0.42, 0.0, 1.0);
  fres *= fres;

  // Backdrop seen through the glass, bent by the bevel.
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec2 refr = (-n.xy * 2.4 + vec2(0.0, 1.2)) * uPxPerUnit / uResolution;
  vec3 bg = texture2D(uBackdrop, suv + refr).rgb;
  float yN = clamp(pt.y / hb.y, -1.0, 1.0);

  vec3 top;
  vec3 side;
  vec3 edgeColor = tint;
  if (steel) {
    float brushed = hash12(vec2(floor((pt.y + 20.0) * 2.5), seed * 7.0));
    float streak = hash12(vec2(floor((pt.x + 40.0) * 0.35), floor((pt.y + 20.0) * 2.5) + seed));
    top = tint * (0.26 + 0.12 * brushed + 0.05 * streak) + bg * 0.05;
    top += tint * diff * 0.35 + vec3(spec) * 1.1;
    top += mix(tint, vec3(1.0), 0.5) * fres * 0.7;
    vec2 rp = vec2(pt.x - sign(pt.x) * (hb.x - 2.6), pt.y);
    float rivet = length(rp) - 0.9;
    float rivetLit = clamp(0.5 + dot(rp, vec2(-0.5, 0.8)) * 0.7, 0.0, 1.0);
    top = mix(top, tint * (0.2 + 0.6 * rivetLit), fill(rivet));
    top += vec3(0.9) * stroke(rivet, 0.15) * 0.25;
    side = tint * 0.16;
    edgeColor = mix(tint, vec3(0.6, 0.95, 1.0), 0.45);
  } else {
    top = bg * (0.25 + tint * 0.9);
    // Light pools at the bottom of the glass body.
    top += tint * (0.22 + mix(0.55, 0.0, smoothstep(-1.0, 0.8, yN)));
    // Inner highlight: a reflection strip just inside the top edge and a glint in the top-left corner.
    float hl = smoothstep(1.1, 0.0, abs(pt.y - (hb.y - 2.0))) * smoothstep(hb.x - 0.5, hb.x - 4.5, abs(pt.x));
    top += vec3(0.85, 0.9, 1.0) * hl * 0.45;
    float glint = exp(-length((pt - vec2(-hb.x + 3.2, hb.y - 2.0)) * vec2(0.6, 1.4)) * 1.2);
    top += vec3(1.0) * glint * 0.6;
    // Slow diagonal sheen sweeping over the whole wall of bricks.
    float sweep = fract((vWorld.x + vWorld.y * 0.7) / 300.0 - uTime * 0.07);
    float sheen = smoothstep(0.0, 0.015, sweep) * smoothstep(0.05, 0.015, sweep);
    top += (tint * 0.5 + 0.2) * sheen;
    top += tint * diff * 0.12 + tint * fres * 0.9 + vec3(spec) * 0.7;
    side = tint * 0.1 + bg * 0.15;
    if (tough) {
      top += tint * stroke(dTop + 2.4, 0.3) * 0.9;
      if (damage > 0.0) {
        float c = crackField(pt * 0.3 + seed * 17.0);
        float crack = (1.0 - smoothstep(0.0, 0.05 + 0.05 * damage, c));
        float reach = smoothstep(10.0 * damage + 2.0, 0.0, length(pt - (hash22(vec2(seed)) - 0.5) * hb * 1.4));
        top += vec3(1.0, 0.92, 0.75) * crack * reach * (0.6 + damage);
      }
    }
  }
  // Side face: darker, with a faint lip where it meets the top face.
  side *= 0.75 + 0.35 * smoothstep(-vHalf.y, -vHalf.y + DEPTH, p.y);
  // Lower edge of the slab catches a little light.
  side += edgeColor * stroke(dSil + 0.35, 0.25) * 0.7;
  top += edgeColor * stroke(dTop + 0.35, 0.3) * 1.4;
  top += vec3(1.0) * flash * 1.6;
  side += edgeColor * flash * 0.6;

  float shadow = 0.55 * (1.0 - smoothstep(-1.5, 3.0, dShadow));
  vec4 col = vec4(0.0, 0.0, 0.0, shadow);
  col = over(vec4(side, 1.0) * fill(dSil), col);
  col = over(vec4(top, 1.0) * fill(dTop), col);
  float outside = 1.0 - fill(dSil);
  float halo = exp(-max(dSil, 0.0) * 0.6) * (steel ? 0.08 : 0.2) + flash * exp(-max(dSil, 0.0) * 0.25) * 0.6;
  col.rgb += edgeColor * halo * outside;

  // Build-in: the brick materialises from the bottom up behind a bright scan line.
  if (appear < 1.0) {
    float yAll = (p.y + vHalf.y) / (2.0 * vHalf.y);
    float front = appear * 1.3 - 0.15;
    col *= 1.0 - smoothstep(front - 0.03, front + 0.03, yAll);
    col.rgb += tint * exp(-abs(yAll - front) * 16.0) * fill(abs(p.x) - vHalf.x) * 2.0 * (1.0 - appear);
  }
  gl_FragColor = col;
}
`;
