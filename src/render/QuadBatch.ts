import * as THREE from 'three';
import { QUAD_VERTEX } from './materials/common';

export type BatchBlending = 'premultiplied' | 'additive' | 'max';

export interface QuadBatchOptions {
  max: number;
  fragmentShader: string;
  /** World units added around every quad so the fragment shader has room for halos and shadows. */
  pad?: number;
  uniforms?: Record<string, THREE.IUniform>;
  blending?: BatchBlending;
  renderOrder?: number;
}

/**
 * Instanced quads drawn with one SDF fragment shader. Each instance is a rotated rectangle
 * (centre, size, angle) plus a colour and four free shader parameters. Fill with `push`
 * between `begin` and `commit` once per frame.
 */
export class QuadBatch {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private geometry = new THREE.InstancedBufferGeometry();
  private rect: THREE.InstancedBufferAttribute;
  private color: THREE.InstancedBufferAttribute;
  private params: THREE.InstancedBufferAttribute;
  private rot: THREE.InstancedBufferAttribute;
  private n = 0;

  constructor(private readonly options: QuadBatchOptions) {
    const { max } = options;
    const plane = new THREE.PlaneGeometry(1, 1);
    this.geometry.setIndex(plane.getIndex());
    this.geometry.setAttribute('position', plane.getAttribute('position'));
    this.rect = this.attribute('aRect', 4, max);
    this.color = this.attribute('aColor', 4, max);
    this.params = this.attribute('aParams', 4, max);
    this.rot = this.attribute('aRot', 1, max);
    this.geometry.instanceCount = 0;

    const material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: options.fragmentShader,
      uniforms: { uPad: { value: options.pad ?? 0 }, ...options.uniforms },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    applyBlending(material, options.blending ?? 'premultiplied');

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = options.renderOrder ?? 0;
  }

  get uniforms(): Record<string, THREE.IUniform> {
    return this.mesh.material.uniforms;
  }

  get full(): boolean {
    return this.n >= this.options.max;
  }

  begin(): void {
    this.n = 0;
  }

  push(
    cx: number,
    cy: number,
    w: number,
    h: number,
    color: THREE.Color,
    a = 1,
    p0 = 0,
    p1 = 0,
    p2 = 0,
    p3 = 0,
    angle = 0,
  ): void {
    if (this.n >= this.options.max) return;
    const i = this.n++;
    const r = this.rect.array as Float32Array;
    const c = this.color.array as Float32Array;
    const p = this.params.array as Float32Array;
    r[i * 4] = cx;
    r[i * 4 + 1] = cy;
    r[i * 4 + 2] = w;
    r[i * 4 + 3] = h;
    c[i * 4] = color.r;
    c[i * 4 + 1] = color.g;
    c[i * 4 + 2] = color.b;
    c[i * 4 + 3] = a;
    p[i * 4] = p0;
    p[i * 4 + 1] = p1;
    p[i * 4 + 2] = p2;
    p[i * 4 + 3] = p3;
    (this.rot.array as Float32Array)[i] = angle;
  }

  commit(): void {
    this.geometry.instanceCount = this.n;
    for (const attr of [this.rect, this.color, this.params, this.rot]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.n * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  private attribute(name: string, size: number, max: number): THREE.InstancedBufferAttribute {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size);
    attr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute(name, attr);
    return attr;
  }
}

/**
 * Premultiplied: shaders output colour already multiplied by alpha, so alpha 0 with colour
 * adds light (glows) while alpha 1 covers. Max: overlapping glows don't stack (trails).
 */
export function applyBlending(material: THREE.Material, mode: BatchBlending): void {
  material.blending = THREE.CustomBlending;
  material.blendEquation = mode === 'max' ? THREE.MaxEquation : THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = mode === 'premultiplied' ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor;
}
