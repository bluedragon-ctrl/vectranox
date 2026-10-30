import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FULLSCREEN_VERTEX } from '../materials/common';
import { BLOOM_BRIGHT_FRAGMENT, FINAL_FRAGMENT } from '../materials/post';

/**
 * `reach` scales how far the glow spreads; `radius` only reweights the blur levels, not their extent.
 * A tighter blur packs the same light into less area, so `strength` must drop with `reach` or the
 * halo just gets brighter and looks no smaller.
 */
const BLOOM = { strength: 0.12, radius: 0.25, threshold: 0.75, reach: 0.5 } as const;
/** Chromatic aberration in UV units at the screen corner: resting value and full pulse. */
const ABERRATION = { base: 0, pulse: 0.018 } as const;

export interface PostParams {
  bloom: boolean;
  /** 0..1 pulse on top of the base aberration. */
  aberration: number;
  flash: THREE.Color;
  flashAmount: number;
}

/** Scene → bloom → final pass (aberration, flash, sRGB output). Buffers are half-float, so neon can exceed 1. */
export class PostFx {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private final: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.bloom.materialHighPassFilter.fragmentShader = BLOOM_BRIGHT_FRAGMENT;
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          uAberration: { value: ABERRATION.base },
          uFlash: { value: new THREE.Vector4() },
        },
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: FINAL_FRAGMENT,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.composer.addPass(this.final);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    // The pass resets invSize on every resize. Shrinking it packs the blur taps closer together.
    for (const material of this.bloom.separableBlurMaterials) {
      (this.uniform('invSize', material.uniforms).value as THREE.Vector2).multiplyScalar(BLOOM.reach);
    }
  }

  render(p: PostParams): void {
    this.bloom.enabled = p.bloom;
    this.uniform('uAberration').value = ABERRATION.base + ABERRATION.pulse * p.aberration;
    (this.uniform('uFlash').value as THREE.Vector4).set(p.flash.r, p.flash.g, p.flash.b, p.flashAmount);
    this.composer.render();
  }

  private uniform(name: string, uniforms = this.final.uniforms): THREE.IUniform {
    const u = uniforms[name];
    if (!u) throw new Error(`Missing uniform ${name}`);
    return u;
  }
}
