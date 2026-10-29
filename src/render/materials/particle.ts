import { SDF } from './common';

export const PARTICLE_KIND = {
  spark: 0,
  shard: 1,
} as const;

/**
 * All particle shapes in one batch, picked by params.x (see PARTICLE_KIND). Colour alpha is the
 * particle's fade. Sparks are capsules along local x (the quad is rotated to their velocity),
 * shards are spinning glass triangles.
 */
export const PARTICLE_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying vec2 vHalf;
varying vec4 vColor;
varying vec4 vParams;

${SDF}

void main() {
  int kind = int(vParams.x + 0.5);
  vec3 tint = vColor.rgb;
  float fade = vColor.a;
  vec2 p = vLocal;
  vec4 col = vec4(0.0);

  if (kind == 0) {
    float r = vHalf.y;
    float d = sdSegment(p, vec2(-vHalf.x + r, 0.0), vec2(vHalf.x - r, 0.0), r);
    float head = smoothstep(-vHalf.x, vHalf.x, p.x);
    vec3 c = mix(tint, vec3(1.0), 0.5 * head) * (fill(d) * 1.8 + exp(-max(d, 0.0) * 0.8) * 0.4);
    col = vec4(c * fade * (0.3 + 0.7 * head), 0.0);
  } else {
    float s = vHalf.x * 0.8;
    float d = sdTriangle(p * vec2(1.0, 1.25), s);
    float body = fill(d);
    vec3 c = tint * 0.5 + tint * stroke(d + 0.35, 0.35) * 1.8;
    col = vec4(c, 0.55) * body * fade;
    col.rgb += tint * exp(-max(d, 0.0) * 0.7) * 0.25 * fade * (1.0 - body);
  }
  gl_FragColor = col;
}
`;
