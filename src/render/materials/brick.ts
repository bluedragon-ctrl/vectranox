import { SDF } from './common';

/**
 * Bricks with a little 2.5D depth: a bevelled top face, a darker side face below it, a soft drop
 * shadow and a halo. Normal bricks are stylised glass (fresnel rim, inner highlight, refracted
 * backdrop). The rest are opaque: regenerating ones mint plates, steel ones grey riveted plates,
 * explosive ones hazard-striped casings with a hot core.
 * A boss's emitters are dark casings with a mark that lights as they wind up. Its core is the one
 * brick that animates: a reactor casing with an energy bar that pulses faster with each phase.
 *
 * Instance data: colour rgb = tint, alpha = hits left (regenerating bricks show a lit slot per hit).
 * params: x = kind (0 normal, 1 steel, 2 explosive, 3 regenerating, 4 core, 5 turret, 6 spawner,
 * 7 phantom), y = hits a regenerating brick started with, z = hit flash,
 * w = an emitter's wind-up, or the core's heat, 0..1.
 * The instance rectangle is the brick's visual footprint; `uPad` leaves room for halo and shadow.
 */
export const BRICK_FRAGMENT = /* glsl */ `
uniform sampler2D uBackdrop;
uniform vec2 uResolution;
uniform float uPxPerUnit;
uniform float uTime;
varying vec2 vLocal;
varying vec2 vHalf;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

const float DEPTH = 2.6;
const float RADIUS = 1.6;
const float BEVEL = 2.4;
/** Spacing of the hit slots on regenerating bricks. */
const float NOTCH_STEP = 3.4;

/** Gradient of sdRoundBox(p, b, r). */
vec2 gradRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  vec2 g = max(q.x, q.y) > 0.0 ? normalize(max(q, 0.0)) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  return g * vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
}

void main() {
  vec2 p = vLocal;
  vec3 tint = vColor.rgb;
  float kind = vParams.x;
  float maxHp = vParams.y;
  float flash = vParams.z;
  bool steel = kind > 0.5 && kind < 1.5;
  bool explosive = kind > 1.5 && kind < 2.5;
  bool regen = kind > 2.5 && kind < 3.5;
  bool core = kind > 3.5 && kind < 4.5;
  bool emitter = kind > 4.5;
  float pulse = 0.0;

  // Top face sits above the side face; together they fill the footprint.
  vec2 hb = vec2(vHalf.x, vHalf.y - DEPTH * 0.5);
  vec2 pt = p - vec2(0.0, DEPTH * 0.5);
  float dTop = sdRoundBox(pt, hb, RADIUS);
  float dSil = sdRoundBox(p, vHalf, RADIUS);
  float dShadow = sdRoundBox(p - vec2(2.0, -3.0), vHalf, RADIUS);

  // Pillow bevel: tilt the normal outwards near the edge of the top face.
  vec2 grad = gradRoundBox(pt, hb, RADIUS);
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
    // A solid plate, opaque so it never reads as glass: mid-grey body, diagonal hatching on an
    // inset panel, a bright bevel and a rivet at each end. Kept bold enough to survive at ~40 px.
    float panel = sdRoundBox(pt, vec2(hb.x - 4.0, hb.y - 1.2), 0.6);
    float hatch = stroke(fract((pt.x + pt.y) / 2.6) - 0.5, 0.16) * fill(panel);
    top = tint * (0.42 + 0.2 * diff);
    top *= (1.0 - 0.3 * hatch) * (1.0 - 0.45 * stroke(panel, 0.3));
    top += vec3(spec) * 0.5 + mix(tint, vec3(1.0), 0.5) * fres * 0.8;
    vec2 rp = vec2(pt.x - sign(pt.x) * (hb.x - 2.0), pt.y);
    float rivet = length(rp) - 1.1;
    float rivetLit = clamp(0.5 + dot(rp, vec2(-0.5, 0.8)) * 0.7, 0.0, 1.0);
    top = mix(top, tint * (0.3 + 0.7 * rivetLit), fill(rivet));
    side = tint * 0.2;
    edgeColor = mix(tint, vec3(0.6, 0.95, 1.0), 0.45);
  } else if (explosive) {
    // A casing, not glass: dark, with bold hazard stripes on an inset panel and a hot core in the
    // middle. Static, and bold enough to read at ~40 px.
    float panel = sdRoundBox(pt, vec2(hb.x - 1.4, hb.y - 1.2), 0.6);
    float stripes = step(0.5, fract((pt.x - pt.y) / 6.0)) * fill(panel);
    top = tint * (0.14 + 0.1 * diff);
    top = mix(top, tint * 0.8, stripes);
    float core = sdRoundBox(pt, vec2(3.6, 2.0), 1.2);
    top = mix(top, tint * 0.08, fill(core - 0.9));
    top = mix(top, mix(tint, vec3(1.0), 0.6), fill(core));
    top += vec3(spec) * 0.35 + tint * fres * 0.7;
    side = tint * 0.25;
  } else if (core) {
    // A reactor: a ribbed casing round a dark chamber, and a bar of energy in the chamber that
    // breathes and runs outwards. The heat only changes how fast, so it reads at a glance.
    float rate = 2.2 + 5.0 * vParams.w;
    pulse = 0.5 + 0.5 * sin(uTime * rate);
    float chamber = sdRoundBox(pt, hb - vec2(3.2, 2.6), 1.2);
    float ribs = step(0.5, fract(pt.x / 4.0)) * (1.0 - fill(chamber));
    top = tint * (0.3 + 0.28 * diff) * (1.0 - 0.4 * ribs);
    top += vec3(spec) * 0.5 + mix(tint, vec3(1.0), 0.4) * fres * 0.9;
    top = mix(top, tint * 0.05, fill(chamber));
    vec2 q = pt / vec2(hb.x * 0.62, hb.y * 0.34);
    float energy = exp(-dot(q, q)) * (0.8 + 0.2 * sin(abs(pt.x) * 0.9 - uTime * rate * 1.6));
    top += mix(tint, vec3(1.0), energy) * energy * (0.55 + 0.75 * pulse) * fill(chamber);
    side = tint * 0.3;
  } else if (emitter) {
    // A dark casing with a mark that says what it does: a down arrow fires, a chevron sends bricks,
    // a ring releases shadow balls. Dim until it winds up.
    float charge = vParams.w;
    float panel = sdRoundBox(pt, vec2(hb.x - 1.4, hb.y - 1.2), 0.6);
    top = tint * (0.14 + 0.12 * diff) * (1.0 - 0.4 * stroke(panel, 0.3));
    float mark = abs(length(pt) - 2.5) - 0.7;
    if (kind < 5.5) mark = max(abs(pt.x) * 0.85 - pt.y * 0.6 - 1.2, pt.y - 3.0);
    else if (kind < 6.5) mark = max(abs(pt.y - abs(pt.x) * 0.7 + 1.6) - 0.8, abs(pt.x) - 4.6);
    top = mix(top, mix(tint, vec3(1.0), 0.15 + 0.7 * charge) * (0.55 + 0.75 * charge), fill(mark));
    top += tint * charge * 0.3 + vec3(spec) * 0.35 + tint * fres * 0.7;
    side = tint * 0.25;
  } else if (regen) {
    // Plate, not glass: opaque polished metal, dark at the bottom under a strong bevel, with a soft
    // inner glow. The lit slots carry the damage, so the plate itself stays clean.
    top = tint * (0.28 + 0.3 * smoothstep(-1.0, 0.6, yN) + 0.25 * diff);
    top += vec3(spec) * 0.5 + mix(tint, vec3(1.0), 0.4) * fres * 0.9;
    top += tint * exp(-length(pt * vec2(0.14, 0.3))) * 0.5;
    // A slot per hit sunk into the plate across the middle; the ones still to take are lit.
    float hp = vColor.a;
    float slot = floor(pt.x / NOTCH_STEP + maxHp * 0.5);
    float inRow = step(0.0, slot) * step(slot, maxHp - 1.0);
    float notch = sdRoundBox(pt - vec2((slot + 0.5 - maxHp * 0.5) * NOTCH_STEP, 0.0), vec2(0.8, 1.5), 0.4);
    top = mix(top, tint * 0.1, fill(notch - 0.4) * inRow);
    top = mix(top, mix(tint, vec3(1.0), 0.55), fill(notch) * inRow * step(slot, hp - 1.0));
    side = tint * 0.3;
  } else {
    top = bg * (0.25 + tint * 0.9);
    // Light pools at the bottom of the glass body.
    top += tint * (0.22 + mix(0.55, 0.0, smoothstep(-1.0, 0.8, yN)));
    // Inner highlight: a reflection strip just inside the top edge and a glint in the top-left corner.
    float hl = smoothstep(1.1, 0.0, abs(pt.y - (hb.y - 2.0))) * smoothstep(hb.x - 0.5, hb.x - 4.5, abs(pt.x));
    top += vec3(0.85, 0.9, 1.0) * hl * 0.45;
    float glint = exp(-length((pt - vec2(-hb.x + 3.2, hb.y - 2.0)) * vec2(0.6, 1.4)) * 1.2);
    top += vec3(1.0) * glint * 0.6;
    top += tint * diff * 0.12 + tint * fres * 0.9 + vec3(spec) * 0.7;
    side = tint * 0.1 + bg * 0.15;
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
  float halo = exp(-max(dSil, 0.0) * 0.6) * (steel || regen ? 0.08 : core ? 0.12 + 0.22 * pulse : 0.2) + flash * exp(-max(dSil, 0.0) * 0.25) * 0.6;
  col.rgb += edgeColor * halo * outside;
  gl_FragColor = col;
}
`;
