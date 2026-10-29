import { SDF } from './common';

/**
 * Paddle: glass capsule with a neon rim, a white-hot energy core and magenta emitters at both
 * ends. Same 2.5D treatment as the bricks (top face, side face, shadow).
 *
 * Instance data: colour = rim tint. params: x = hit pulse (0..1), y = hit offset (-1..1).
 */
export const PADDLE_FRAGMENT = /* glsl */ `
uniform vec3 uAccent;
varying vec2 vLocal;
varying vec2 vHalf;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

const float DEPTH = 2.0;

void main() {
  vec2 p = vLocal;
  vec3 tint = vColor.rgb;
  float pulse = vParams.x;
  float hitX = vParams.y * vHalf.x;

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

  // Hit pulse spreading from the impact point.
  float spread = exp(-abs(pt.x - hitX) / (4.0 + 26.0 * (1.0 - pulse)));
  top += vec3(1.0) * pulse * spread * 0.7;

  vec3 rimColor = mix(tint, uAccent, capMask);
  top += rimColor * stroke(dTop + 0.35, 0.3) * 0.9;
  vec3 side = rimColor * 0.28 * (0.75 + 0.35 * smoothstep(-vHalf.y, -vHalf.y + DEPTH, p.y));

  vec4 col = vec4(0.0, 0.0, 0.0, 0.5 * (1.0 - smoothstep(-1.5, 3.0, dShadow)));
  col = over(vec4(side, 1.0) * fill(dSil), col);
  col = over(vec4(top, 1.0) * fill(dTop), col);
  float outside = 1.0 - fill(dSil);
  col.rgb += rimColor * (exp(-max(dSil, 0.0) * 1.1) * (0.075 + pulse * 0.18)) * outside;
  gl_FragColor = col;
}
`;
