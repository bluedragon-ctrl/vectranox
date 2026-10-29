import * as THREE from 'three';
import { FIELD, PALETTE } from '../config/game';
import { POWER, POWER_LOOK } from '../config/tuning';
import type { VisualSettings } from '../core/settings';
import type { Game } from '../game/Game';
import type { PowerKind, TimedPower } from '../game/types';
import { GameFx } from './fx/GameFx';
import { PostFx } from './fx/PostFx';
import { Trails } from './fx/Trails';
import { FIELD_FRAGMENT, SKY_FRAGMENT } from './materials/backdrop';
import { BALL_FRAGMENT } from './materials/ball';
import { BRICK_FRAGMENT } from './materials/brick';
import { FULLSCREEN_VERTEX } from './materials/common';
import { PADDLE_FRAGMENT } from './materials/paddle';
import { BARRIER_FRAGMENT, BOLT_FRAGMENT, CAPSULE_FRAGMENT } from './materials/power';
import { glyphMask } from './glyphs';
import { BRICK_GAP, brickTint, COLORS } from './palette';
import { QuadBatch } from './QuadBatch';

/** Screen-space padding (px) between the playfield frame and its area. */
const FIELD_PADDING = 28;
const MAX_BRICKS = 256;
const MAX_BALLS = 32;
const MAX_CAPSULES = 8;
const MAX_BOLTS = 64;
/** Seconds over which a power's visuals fade out before it ends. */
const POWER_FADE = 1;
/** Ticks a brick stays lit after a hit. */
const FLASH_TICKS = 12;
/** Horizon height as a fraction of the window, from the bottom. */
const HORIZON = 0.42;
/** Sun radius in screen heights: fills this fraction of the gap right of the field, within limits. */
const SUN = { gapFill: 0.8, minRadius: 0.06, maxRadius: 0.27 } as const;
const BRICK_KIND = { normal: 0, tough: 1, steel: 2 } as const;
const POWER_KINDS = Object.keys(POWER_LOOK) as PowerKind[];
const CAPSULE_LOOK = Object.fromEntries(
  POWER_KINDS.map((k) => [k, { color: new THREE.Color(POWER_LOOK[k].color), mask: glyphMask(POWER_LOOK[k].glyph), bad: POWER_LOOK[k].bad ? 1 : 0 }]),
) as Record<PowerKind, { color: THREE.Color; mask: number; bad: number }>;

/**
 * Two passes per frame:
 * 1. backdrop (synthwave scenery + playfield glass and frame) into its own target, so glass
 *    bricks can sample and refract it;
 * 2. the main scene (backdrop blit, bricks, barrier, trails, capsules, bolts, paddle, balls,
 *    particles) through PostFx.
 * Everything is instanced SDF quads; effects come from simulation events via GameFx.
 */
export class Renderer {
  settings: VisualSettings = { bloom: true, reduceFx: false };

  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.OrthographicCamera();
  private camBase = new THREE.Vector2();
  private pxPerUnit = 1;
  private backdropScene = new THREE.Scene();
  private scene = new THREE.Scene();
  private backdropTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private post: PostFx;
  private trails = new Trails(COLORS.cyan, COLORS.purple);
  private fx = new GameFx(this.trails);

  private skyTime = { value: 0 };
  private resolution = { value: new THREE.Vector2(1, 1) };
  private skyUniforms = {
    uTime: this.skyTime,
    uResolution: this.resolution,
    uVanish: { value: new THREE.Vector2() },
    uSunR: { value: 0.2 },
    uTwinkle: { value: 1 },
    uSkyTop: { value: new THREE.Color(0x0a0326) },
    uSkyHorizon: { value: new THREE.Color(0x3c0d5e) },
    uSunTop: { value: COLORS.yellow },
    uSunBottom: { value: COLORS.magenta },
    uGrid: { value: new THREE.Color(PALETTE.magenta).multiplyScalar(0.8) },
    uRidge: { value: COLORS.purple },
  };
  private field = new QuadBatch({
    max: 1,
    pad: 10,
    fragmentShader: FIELD_FRAGMENT,
    uniforms: {
      uField: { value: new THREE.Vector2(FIELD.width, FIELD.height) },
      uHits: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uDanger: { value: 0 },
      uFrame: { value: COLORS.cyan },
      uGuide: { value: COLORS.purple },
      uDeath: { value: COLORS.magenta },
    },
  });
  private bricks = new QuadBatch({
    max: MAX_BRICKS,
    pad: 7,
    fragmentShader: BRICK_FRAGMENT,
    renderOrder: 10,
    uniforms: {
      uBackdrop: { value: this.backdropTarget.texture },
      uResolution: this.resolution,
      uPxPerUnit: { value: 1 },
    },
  });
  private paddle = new QuadBatch({
    max: 1,
    pad: 4,
    fragmentShader: PADDLE_FRAGMENT,
    renderOrder: 25,
    uniforms: {
      uAccent: { value: COLORS.magenta },
      uCatch: { value: CAPSULE_LOOK.catch.color },
      uLaserFlash: { value: 0 },
    },
  });
  private balls = new QuadBatch({ max: MAX_BALLS, pad: 3, fragmentShader: BALL_FRAGMENT, renderOrder: 30 });
  private barrier = new QuadBatch({ max: 1, pad: 6, fragmentShader: BARRIER_FRAGMENT, renderOrder: 15 });
  private capsules = new QuadBatch({ max: MAX_CAPSULES, pad: 4, fragmentShader: CAPSULE_FRAGMENT, renderOrder: 22 });
  private bolts = new QuadBatch({ max: MAX_BOLTS, pad: 4, fragmentShader: BOLT_FRAGMENT, renderOrder: 24 });

  private ballPositions: { x: number; y: number }[] = [];
  private color = new THREE.Color();
  private lastFrame = performance.now();

  constructor(
    canvas: HTMLCanvasElement,
    private fieldArea: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(PALETTE.bg);

    this.backdropScene.add(
      fullscreenQuad(
        new THREE.ShaderMaterial({
          vertexShader: FULLSCREEN_VERTEX,
          fragmentShader: SKY_FRAGMENT,
          uniforms: this.skyUniforms,
          depthTest: false,
          depthWrite: false,
        }),
      ),
      this.field.mesh,
    );

    const blit = fullscreenQuad(
      new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: 'uniform sampler2D uTex; varying vec2 vUv; void main() { gl_FragColor = texture2D(uTex, vUv); }',
        uniforms: { uTex: { value: this.backdropTarget.texture } },
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.scene.add(
      blit,
      this.bricks.mesh,
      this.barrier.mesh,
      this.trails.batch.mesh,
      this.capsules.mesh,
      this.bolts.mesh,
      this.paddle.mesh,
      this.balls.mesh,
      this.fx.particles.pieces.mesh,
      this.fx.particles.batch.mesh,
    );

    this.post = new PostFx(this.renderer, this.scene, this.camera);
    new ResizeObserver(() => this.resize()).observe(document.body);
    this.resize();
  }

  /** CSS pixels per world unit. */
  get scale(): number {
    return this.pxPerUnit;
  }

  /** World x under a window-space CSS pixel x (ignores screen shake). */
  screenToWorldX(clientX: number): number {
    return this.camBase.x + (clientX - window.innerWidth / 2) / this.pxPerUnit;
  }

  /** Route a (new) game's events to the effects. Call before `game.start()` to catch the first stage. */
  attach(game: Game): void {
    this.fx.attach(game);
  }

  applySettings(settings: VisualSettings): void {
    this.settings = { ...settings };
    this.fx.setReduced(settings.reduceFx);
    this.skyUniforms.uTwinkle.value = settings.reduceFx ? 0 : 1;
  }

  /**
   * The canvas covers the whole window; the camera is positioned so the playfield
   * fits (letterboxed) inside the #field-area element, leaving the left panel over background.
   */
  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, pr);
    this.backdropTarget.setSize(Math.round(w * pr), Math.round(h * pr));
    this.resolution.value.set(Math.round(w * pr), Math.round(h * pr));

    const area = this.fieldArea.getBoundingClientRect();
    const scale = Math.max(
      0.01,
      Math.min(
        (area.width - FIELD_PADDING * 2) / FIELD.width,
        (area.height - FIELD_PADDING * 2) / FIELD.height,
      ),
    );
    this.pxPerUnit = scale;
    this.bricks.uniforms.uPxPerUnit!.value = scale * pr;
    const areaCx = area.left + area.width / 2;
    const areaCy = area.top + area.height / 2;
    // The playfield is opaque, so the sun and the grid's vanishing point go in the gap to its right.
    const fieldRight = areaCx + (FIELD.width / 2) * scale;
    const gap = w - fieldRight;
    this.skyUniforms.uVanish.value.set((fieldRight + gap / 2) * pr, h * HORIZON * pr);
    this.skyUniforms.uSunR.value = Math.min(SUN.maxRadius, Math.max(SUN.minRadius, (gap * SUN.gapFill) / 2 / h));

    const halfW = w / (2 * scale);
    const halfH = h / (2 * scale);
    this.camBase.set(FIELD.width / 2 - (areaCx - w / 2) / scale, FIELD.height / 2 + (areaCy - h / 2) / scale);
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH, near: -100, far: 100 });
    this.camera.updateProjectionMatrix();
  }

  render(game: Game, alpha: number): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    this.fx.update(dt);
    this.skyTime.value += dt;

    const shake = this.fx.shake;
    this.camera.position.set(this.camBase.x + shake.x, this.camBase.y + shake.y, 10);
    this.camera.rotation.z = shake.roll;
    this.camera.updateMatrixWorld();

    this.interpolateBalls(game, alpha);
    this.trails.update(game.balls, this.ballPositions, this.fx.now);

    this.drawField();
    this.drawBricks(game);
    this.drawBarrier(game);
    this.drawCapsules(game, alpha);
    this.drawBolts(game, alpha);
    this.drawPaddle(game, alpha);
    this.drawBalls(game);
    this.trails.draw(game.balls, this.ballPositions, this.fx.now);
    this.fx.particles.draw();

    this.renderer.setRenderTarget(this.backdropTarget);
    this.renderer.render(this.backdropScene, this.camera);
    this.renderer.setRenderTarget(null);
    this.post.render({
      bloom: this.settings.bloom,
      aberration: this.fx.aberration,
      flash: this.fx.flashColor,
      flashAmount: this.fx.flash,
    });
  }

  private interpolateBalls(game: Game, alpha: number): void {
    const out = this.ballPositions;
    out.length = Math.min(game.balls.length, MAX_BALLS);
    for (let i = 0; i < out.length; i++) {
      const b = game.balls[i];
      if (!b) continue;
      const p = (out[i] ??= { x: 0, y: 0 });
      p.x = b.px + (b.x - b.px) * alpha;
      p.y = b.py + (b.y - b.py) * alpha;
    }
  }

  private drawField(): void {
    const u = this.field.uniforms;
    (u.uHits!.value as THREE.Vector4[]).forEach((v, i) => {
      const hit = this.fx.wallHits[i];
      v.set(hit?.x ?? 0, hit?.y ?? 0, hit?.strength ?? 0, 0);
    });
    u.uDanger!.value = this.fx.danger;
    this.field.begin();
    this.field.push(FIELD.width / 2, FIELD.height / 2, FIELD.width, FIELD.height, this.color.setRGB(1, 1, 1));
    this.field.commit();
  }

  private drawBricks(game: Game): void {
    const b = this.bricks;
    b.begin();
    for (const br of game.bricks) {
      if (!br.alive) continue;
      const flash = Math.max(0, 1 - (game.tick - br.hitTick) / FLASH_TICKS) * this.fx.brickFlash;
      const damage = br.kind === 'tough' ? 1 - br.hp / br.maxHp : 0;
      b.push(
        br.x + br.w / 2,
        br.y + br.h / 2,
        br.w - BRICK_GAP,
        br.h - BRICK_GAP,
        brickTint(br, this.color),
        1,
        BRICK_KIND[br.kind],
        damage,
        flash * flash,
        (br.id * 0.6180339) % 1,
      );
    }
    b.commit();
  }

  private drawBarrier(game: Game): void {
    this.barrier.begin();
    const level = powerLevel(game, 'barrier');
    if (level > 0) {
      const hit = this.fx.barrierHit;
      this.barrier.push(FIELD.width / 2, POWER.barrierY, FIELD.width, 1.2, COLORS.yellow, 1, level, hit.x, hit.strength);
    }
    this.barrier.commit();
  }

  private drawCapsules(game: Game, alpha: number): void {
    this.capsules.begin();
    for (const c of game.capsules) {
      const look = CAPSULE_LOOK[c.kind];
      const y = c.py + (c.y - c.py) * alpha;
      this.capsules.push(c.x, y, POWER.capsuleWidth, POWER.capsuleHeight, look.color, 1, look.mask, look.bad);
    }
    this.capsules.commit();
  }

  private drawBolts(game: Game, alpha: number): void {
    this.bolts.begin();
    for (const bolt of game.bolts) {
      const tip = bolt.py + (bolt.y - bolt.py) * alpha;
      this.bolts.push(bolt.x, tip - POWER.boltLength / 2, 1.6, POWER.boltLength, COLORS.magenta);
    }
    this.bolts.commit();
  }

  private drawPaddle(game: Game, alpha: number): void {
    const p = game.paddle;
    const x = p.px + (p.x - p.px) * alpha;
    this.paddle.uniforms.uLaserFlash!.value = this.fx.laserFlash;
    this.paddle.begin();
    this.paddle.push(
      x,
      p.y,
      p.w,
      p.h,
      COLORS.cyan,
      1,
      this.fx.paddlePulse,
      this.fx.paddleHitOffset,
      powerLevel(game, 'laser'),
      powerLevel(game, 'catch'),
    );
    this.paddle.commit();
  }

  /** Piercing balls burn hotter. */
  private drawBalls(game: Game): void {
    const pierce = powerLevel(game, 'pierce');
    this.color.copy(COLORS.cyan).lerp(CAPSULE_LOOK.pierce.color, pierce * 0.7);
    this.balls.begin();
    this.ballPositions.forEach((pos, i) => {
      const r = game.balls[i]?.r ?? 4;
      this.balls.push(pos.x, pos.y, r * 2, r * 2, this.color, 1, pierce);
    });
    this.balls.commit();
  }
}

/** 1 while a power runs, fading to 0 over its last second. */
function powerLevel(game: Game, kind: TimedPower): number {
  return Math.min(1, game.timers[kind] / POWER_FADE);
}

function fullscreenQuad(material: THREE.ShaderMaterial): THREE.Mesh {
  material.transparent = true;
  material.blending = THREE.NoBlending;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}
