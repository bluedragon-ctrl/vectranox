import { POWER } from '../../config/tuning';
import { SDF } from './common';

/**
 * Paddle: glass capsule with a neon rim, a white-hot energy core, a centre mark and magenta emitters
 * at both ends. Same 2.5D treatment as the bricks (top face, side face, shadow).
 *
 * Power-ups add to it: laser raises two emitters where the bolts leave, catch coats the top
 * with a glowing film. A bar in the body shows focus: `uFocus` is how far it reaches from the
 * centre (0..1), `uFocusLit` its brightness, and `uFocusFlash` lights the whole paddle.
 *
 * Instance data: colour = rim tint. params: x = hit pulse (0..1), y = hit offset (-1..1),
 * z = laser (0..1), w = catch (0..1).
 */
export const PADDLE_FRAGMENT = /* glsl */ `
uniform vec3 uAccent;
uniform vec3 uCatch;
uniform float uLaserFlash;
uniform vec3 uFocusColor;
uniform float uFocus;
uniform float uFocusLit;
uniform float uFocusFlash;
varying vec2 vLocal;
varying vec2 vHalf;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

const float DEPTH = 2.0;
const float BOLT_INSET = ${POWER.boltInset.toFixed(1)};

void main() {
  vec2 p = vLocal;
  vec3 tint = vColor.rgb;
  float pulse = vParams.x;
  float hitX = vParams.y * vHalf.x;
  float laser = vParams.z;
  float catchFilm = vParams.w;

  vec2 hb = vec2(vHalf.x, vHalf.y - DEPTH * 0.5);
  vec2 pt = p - vec2(0.0, DEPTH * 0.5);
  float r = hb.y;
  float dTop = sdRoundBox(pt, hb, r);
  float dSil = sdRoundBox(p, vHalf, vHalf.y);
  float dShadow = sdRoundBox(p - vec2(2.0, -3.0), vHalf, vHalf.y);

  float yN = pt.y / hb.y;
  float fres = pow(clamp(abs(yN), 0.0, 1.0), 3.0);
  float capMask = smoothstep(hb.x - 7.0, hb.x - 5.5, abs(pt.x));

  vec3 top = tint * 0.12 + tint * fres * 0.8;
  // Energy core: a thin static hot line.
  float core = exp(-abs(pt.y + 0.2) * 2.2) * (1.0 - capMask);
  top += mix(tint, vec3(1.0), 0.5) * core * 0.5;
  // Segment ticks along the body.
  float ticks = stroke(fract(pt.x / 6.0 + 0.5) - 0.5, 0.03) * smoothstep(0.9, 0.3, abs(yN)) * (1.0 - capMask);
  top += tint * ticks * 0.35;
  // End emitters.
  top = mix(top, uAccent * (0.4 + 0.5 * fres) + uAccent * exp(-abs(pt.y) * 1.5) * 0.5, capMask);
  // Upper highlight.
  top += vec3(0.9, 0.95, 1.0) * smoothstep(0.55, 0.85, yN) * smoothstep(hb.x - 2.0, hb.x - 8.0, abs(pt.x)) * 0.35;

  // Focus bar: fills from the centre out to the emitters.
  float reach = uFocus * (hb.x - 7.0);
  float bar = (1.0 - smoothstep(reach - 0.4, reach + 0.4, abs(pt.x))) * (1.0 - smoothstep(0.45, 0.6, abs(yN))) * smoothstep(0.0, 0.02, uFocus);
  top = mix(top, uFocusColor * uFocusLit, bar);
  top += uFocusColor * uFocusFlash;

  // Hit pulse spreading from the impact point.
  float spread = exp(-abs(pt.x - hitX) / (4.0 + 26.0 * (1.0 - pulse)));
  top += vec3(1.0) * pulse * spread * 0.7;

  // Catch: a sticky film along the top edge.
  top = mix(top, top * 0.6 + uCatch * 0.3, catchFilm);
  top += uCatch * catchFilm * stroke(pt.y - hb.y + 0.9, 0.6) * 1.2;

  // Centre mark: a thin line across the body, on top of any film so it always reads.
  top = mix(top, mix(tint, vec3(1.0), 0.7), stroke(pt.x, 0.45) * 0.9);

  vec3 rimColor = mix(tint, uAccent, capMask);
  rimColor = mix(rimColor, uCatch, catchFilm * smoothstep(0.2, 0.8, yN));
  top += rimColor * stroke(dTop + 0.35, 0.3) * 0.9;
  vec3 side = rimColor * 0.28 * (0.75 + 0.35 * smoothstep(-vHalf.y, -vHalf.y + DEPTH, p.y));

  // Laser emitters: short barrels rising from the top at the bolt muzzles.
  vec2 barrel = vec2(abs(p.x) - (vHalf.x - BOLT_INSET), p.y - vHalf.y - 0.6);
  float dBarrel = sdRoundBox(barrel, vec2(1.0, 1.9), 0.6);
  vec3 barrelColor = mix(uAccent, vec3(1.0), 0.25 + 0.5 * uLaserFlash) * (0.8 + 0.6 * smoothstep(-1.9, 1.9, barrel.y));

  vec4 col = vec4(0.0, 0.0, 0.0, 0.5 * (1.0 - smoothstep(-1.5, 3.0, dShadow)));
  col = over(vec4(side, 1.0) * fill(dSil), col);
  col = over(vec4(barrelColor, 1.0) * fill(dBarrel) * laser, col);
  col = over(vec4(top, 1.0) * fill(dTop), col);
  float outside = 1.0 - fill(dSil);
  col.rgb += rimColor * (exp(-max(dSil, 0.0) * 1.1) * (0.075 + pulse * 0.18)) * outside;
  col.rgb += uFocusColor * exp(-max(dSil, 0.0) * 0.6) * uFocusFlash * 0.5 * outside;
  col.rgb += uAccent * exp(-max(dBarrel, 0.0) * 0.9) * (0.08 + uLaserFlash * 0.4) * laser * (1.0 - fill(dBarrel));
  gl_FragColor = col;
}
`;
