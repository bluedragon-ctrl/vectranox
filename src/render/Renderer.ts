import * as THREE from 'three';
import { FIELD, PALETTE } from '../config/game';
import { BOSS, FORMATION, POWER, POWER_LOOK } from '../config/tuning';
import { lerp } from '../core/math';
import type { VisualSettings } from '../core/settings';
import type { Game } from '../game/Game';
import { CHARGE_POWERS } from '../game/powers';
import type { PowerKind, TimedPower } from '../game/types';
import { GameFx } from './fx/GameFx';
import { PostFx } from './fx/PostFx';
import { Trails } from './fx/Trails';
import { FIELD_FRAGMENT, SKY_FRAGMENT } from './materials/backdrop';
import { BALL_FRAGMENT } from './materials/ball';
import { BRICK_FRAGMENT } from './materials/brick';
import { FULLSCREEN_VERTEX } from './materials/common';
import { PADDLE_FRAGMENT } from './materials/paddle';
import { PORTAL_FRAGMENT, TARGET_FRAGMENT } from './materials/pinball';
import { BARRIER_FRAGMENT, BLAST_FRAGMENT, BOLT_FRAGMENT, CAPSULE_FRAGMENT, CHARGE_FRAGMENT, SHOT_FRAGMENT } from './materials/power';
import { glyphMask } from './glyphs';
import { BRICK_GAP, brickTint, CAPSULE_COLORS, COLORS, PIERCE_BALL_COLOR, PORTAL_COLORS, POWER_COLORS, SHOT_COLOR, TARGET_COLOR } from './palette';
import { QuadBatch } from './QuadBatch';

/** Screen-space padding (px) between the playfield frame and its area. */
const FIELD_PADDING = 28;
const MAX_BRICKS = 256;
const MAX_BALLS = 32;
const MAX_CAPSULES = 8;
const MAX_BOLTS = 64;
const MAX_SHOTS = 64;
const MAX_TARGETS = 64;
const MAX_PORTALS = 16;
/** Portal accretion disks turn at this rate (radians/s). A slow spin, so it keeps going under reduce-FX. */
const PORTAL_SPIN = 2.2;
/** Ticks a portal stays bright after a ball goes through it. */
const WARP_FLASH_TICKS = 30;
/** Seconds over which a power's visuals fade out before it ends. */
const POWER_FADE = 1;
/** Ticks a brick stays lit after a hit. */
const FLASH_TICKS = 12;
/** Hit flash strength for bricks struck by a pulse or blast, which light up many at once. */
const AREA_FLASH = 0.35;
/** Ticks a regenerating brick stays lit after winning back a hit, and how bright. */
const HEAL_FLASH = { ticks: 30, strength: 0.25 } as const;
/** Formation line brightness: at rest, and added as a formation closes in on it. */
const LINE_GLOW = { rest: 0.35, near: 0.9 } as const;
/** Held charges show as dots under the paddle: dot diameter, spacing, and drop below the paddle's bottom edge. */
const CHARGE_DOT = { size: 2.6, step: 4, drop: 3.5 } as const;
/** Horizon height as a fraction of the window, from the bottom. */
const HORIZON = 0.42;
/** Sun radius in screen heights: fills this fraction of the gap right of the field, within limits. */
const SUN = { gapFill: 0.8, minRadius: 0.06, maxRadius: 0.27 } as const;
/** World units the playfield can move under screen shake (offset, plus roll at its corners). */
const SHAKE_MARGIN = 12;
const BRICK_KIND = { normal: 0, tough: 1, steel: 2, explosive: 3, regen: 4, core: 5, turret: 6, spawner: 7, phantom: 8 } as const;
/** Shadow balls fade out over their last second, and never quite match a real ball's brightness. */
const SHADOW_LOOK = { fade: 1, alpha: 0.7 } as const;
const POWER_KINDS = Object.keys(POWER_LOOK) as PowerKind[];
const CAPSULE_LOOK = Object.fromEntries(
  POWER_KINDS.map((k) => [k, { color: CAPSULE_COLORS[k], mask: glyphMask(POWER_LOOK[k].glyph), bad: POWER_LOOK[k].bad ? 1 : 0 }]),
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
  /** Drives the scrolling grid and sun stripes; holds still under reduce-FX. */
  private skyScroll = { value: 0 };
  private resolution = { value: new THREE.Vector2(1, 1) };
  private skyUniforms = {
    uTime: this.skyTime,
    uScroll: this.skyScroll,
    uResolution: this.resolution,
    uVanish: { value: new THREE.Vector2() },
    uSunR: { value: 0.2 },
    uSkip: { value: new THREE.Vector4() },
    uFieldRect: { value: new THREE.Vector4() },
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
      uLine: { value: new THREE.Vector2(FORMATION.line, 0) },
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
      uTime: { value: 0 },
    },
  });
  private paddle = new QuadBatch({
    max: 1,
    pad: 4,
    fragmentShader: PADDLE_FRAGMENT,
    renderOrder: 25,
    uniforms: {
      uAccent: { value: COLORS.magenta },
      uCatch: { value: POWER_COLORS.catch },
      uLaserFlash: { value: 0 },
    },
  });
  private balls = new QuadBatch({ max: MAX_BALLS, pad: 3, fragmentShader: BALL_FRAGMENT, renderOrder: 30 });
  private barrier = new QuadBatch({ max: 1, pad: 6, fragmentShader: BARRIER_FRAGMENT, renderOrder: 15 });
  private capsules = new QuadBatch({ max: MAX_CAPSULES, pad: 4, fragmentShader: CAPSULE_FRAGMENT, renderOrder: 22 });
  private bolts = new QuadBatch({ max: MAX_BOLTS, pad: 4, fragmentShader: BOLT_FRAGMENT, renderOrder: 24 });
  private shots = new QuadBatch({ max: MAX_SHOTS, pad: 4, fragmentShader: SHOT_FRAGMENT, renderOrder: 23 });
  private blast = new QuadBatch({ max: MAX_BALLS, pad: 4, fragmentShader: BLAST_FRAGMENT, renderOrder: 26 });
  private targets = new QuadBatch({ max: MAX_TARGETS, pad: 6, fragmentShader: TARGET_FRAGMENT, renderOrder: 11 });
  private portals = new QuadBatch({ max: MAX_PORTALS, pad: 6, fragmentShader: PORTAL_FRAGMENT, renderOrder: 9 });
  /** Drives the portals' spin. */
  private portalTime = 0;
  private chargeDots = new QuadBatch({ max: 16, pad: 2, fragmentShader: CHARGE_FRAGMENT, renderOrder: 27 });

  private ballPositions: { x: number; y: number }[] = [];
  private color = new THREE.Color();
  private armedColor = new THREE.Color();

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
      this.portals.mesh,
      this.targets.mesh,
      this.bricks.mesh,
      this.barrier.mesh,
      this.trails.batch.mesh,
      this.capsules.mesh,
      this.shots.mesh,
      this.bolts.mesh,
      this.paddle.mesh,
      this.chargeDots.mesh,
      this.blast.mesh,
      this.balls.mesh,
      this.fx.particles.pieces.mesh,
      this.fx.particles.metalPieces.mesh,
      this.fx.particles.glintBatch.mesh,
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

  /** Window-space CSS pixel position of a world point (ignores screen shake). */
  worldToClient(x: number, y: number): { x: number; y: number } {
    return {
      x: window.innerWidth / 2 + (x - this.camBase.x) * this.pxPerUnit,
      y: window.innerHeight / 2 - (y - this.camBase.y) * this.pxPerUnit,
    };
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
    // The playfield in device pixels (y up), and the part of it that stays covered even shaken,
    // which the sky skips.
    const areaCyUp = h - areaCy;
    const rect = (inset: number) => {
      const hw = (FIELD.width / 2 - inset) * scale;
      const hh = (FIELD.height / 2 - inset) * scale;
      return [(areaCx - hw) * pr, (areaCyUp - hh) * pr, (areaCx + hw) * pr, (areaCyUp + hh) * pr] as const;
    };
    this.skyUniforms.uFieldRect.value.set(...rect(0));
    this.skyUniforms.uSkip.value.set(...rect(SHAKE_MARGIN));

    const halfW = w / (2 * scale);
    const halfH = h / (2 * scale);
    this.camBase.set(FIELD.width / 2 - (areaCx - w / 2) / scale, FIELD.height / 2 + (areaCy - h / 2) / scale);
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH, near: -100, far: 100 });
    this.camera.updateProjectionMatrix();
  }

  /** `frameTime`: wall-clock seconds since the last frame, which drive the effects. */
  render(game: Game, alpha: number, frameTime: number): void {
    const dt = Math.min(frameTime, 0.1);
    this.fx.update(dt);
    this.skyTime.value += dt;
    if (!this.settings.reduceFx) this.skyScroll.value += dt;
    this.portalTime += dt;

    const shake = this.fx.shake;
    this.camera.position.set(this.camBase.x + shake.x, this.camBase.y + shake.y, 10);
    this.camera.rotation.z = shake.roll;
    this.camera.updateMatrixWorld();

    this.interpolateBalls(game, alpha);
    this.trails.update(game.balls, this.ballPositions, this.fx.now);

    this.drawField(game);
    this.drawPortals(game);
    this.drawTargets(game);
    this.drawBricks(game, alpha);
    this.drawBarrier(game);
    this.drawCapsules(game, alpha);
    this.drawShots(game, alpha);
    this.drawBolts(game, alpha);
    this.drawPaddle(game, alpha);
    this.drawBlast();
    this.drawBalls(game, alpha);
    this.trails.draw(this.fx.now);
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
      p.x = lerp(b.px, b.x, alpha);
      p.y = lerp(b.py, b.y, alpha);
    }
  }

  private drawField(game: Game): void {
    const u = this.field.uniforms;
    (u.uHits!.value as THREE.Vector4[]).forEach((v, i) => {
      const hit = this.fx.wallHits[i];
      v.set(hit?.x ?? 0, hit?.y ?? 0, hit?.strength ?? 0, 0);
    });
    u.uDanger!.value = this.fx.danger;
    const pressure = game.linePressure;
    (u.uLine!.value as THREE.Vector2).y = pressure === null ? 0 : LINE_GLOW.rest + LINE_GLOW.near * pressure;
    this.field.begin();
    this.field.push(FIELD.width / 2, FIELD.height / 2, FIELD.width, FIELD.height, this.color.setRGB(1, 1, 1));
    this.field.commit();
  }

  private drawBricks(game: Game, alpha: number): void {
    const b = this.bricks;
    b.uniforms.uTime!.value = this.portalTime;
    b.begin();
    for (const br of game.bricks) {
      if (!br.alive) continue;
      const flash = Math.max(0, 1 - (game.tick - br.hitTick) / FLASH_TICKS) * this.fx.brickFlash * (this.fx.areaHits.has(br.id) ? AREA_FLASH : 1);
      const heal = Math.max(0, 1 - (game.tick - br.healTick) / HEAL_FLASH.ticks) * this.fx.brickFlash * HEAL_FLASH.strength;
      b.push(
        lerp(br.px, br.x, alpha) + br.w / 2,
        lerp(br.py, br.y, alpha) + br.h / 2,
        br.w - BRICK_GAP,
        br.h - BRICK_GAP,
        brickTint(br, this.color),
        br.kind === 'tough' || br.kind === 'regen' ? br.hp : 1,
        BRICK_KIND[br.kind],
        br.maxHp,
        Math.max(flash * flash, heal),
        br.kind === 'core' ? (game.fight?.heat ?? 0) : br.charge,
      );
    }
    b.commit();
  }

  private drawTargets(game: Game): void {
    this.targets.begin();
    for (const t of game.targets) {
      const flash = Math.max(0, 1 - (game.tick - t.hitTick) / FLASH_TICKS) * this.fx.brickFlash;
      this.targets.push(t.x, t.y, t.r * 2, t.r * 2, TARGET_COLOR, 1, t.lit ? 1 : 0, flash * flash);
    }
    this.targets.commit();
  }

  /** Each pair has its own colour; the two ends of a pair spin opposite ways (in and out). */
  private drawPortals(game: Game): void {
    this.portals.begin();
    for (const p of game.portals) {
      const color = PORTAL_COLORS[p.pair % PORTAL_COLORS.length] ?? COLORS.purple;
      const spin = (p.id < p.exit ? 1 : -1) * this.portalTime * PORTAL_SPIN;
      const flash = Math.max(0, 1 - (game.tick - p.warpTick) / WARP_FLASH_TICKS) * this.fx.brickFlash;
      this.portals.push(p.x, p.y, p.r * 2, p.r * 2, color, 1, spin, flash);
    }
    this.portals.commit();
  }

  private drawBarrier(game: Game): void {
    this.barrier.begin();
    const level = powerLevel(game, 'barrier');
    if (level > 0) {
      const hit = this.fx.barrierHit;
      this.barrier.push(FIELD.width / 2, POWER.barrierY, FIELD.width, 1.2, POWER_COLORS.barrier, 1, level, hit.x, hit.strength);
    }
    this.barrier.commit();
  }

  private drawCapsules(game: Game, alpha: number): void {
    this.capsules.begin();
    for (const c of game.capsules) {
      const look = CAPSULE_LOOK[c.kind];
      const y = lerp(c.py, c.y, alpha);
      this.capsules.push(c.x, y, POWER.capsuleWidth, POWER.capsuleHeight, look.color, 1, look.mask, look.bad);
    }
    this.capsules.commit();
  }

  private drawShots(game: Game, alpha: number): void {
    const size = BOSS.shot.radius * 3.6;
    this.shots.begin();
    for (const s of game.shots) this.shots.push(lerp(s.px, s.x, alpha), lerp(s.py, s.y, alpha), size, size, SHOT_COLOR);
    this.shots.commit();
  }

  private drawBolts(game: Game, alpha: number): void {
    this.bolts.begin();
    for (const bolt of game.bolts) {
      const tip = lerp(bolt.py, bolt.y, alpha);
      this.bolts.push(bolt.x, tip - POWER.boltLength / 2, 1.6, POWER.boltLength, COLORS.magenta);
    }
    this.bolts.commit();
  }

  private drawPaddle(game: Game, alpha: number): void {
    const p = game.paddle;
    const x = lerp(p.px, p.x, alpha);
    this.paddle.uniforms.uLaserFlash!.value = this.fx.laserFlash;
    this.paddle.begin();
    this.paddle.push(
      x,
      p.y,
      p.w,
      p.h,
      game.stun > 0 ? SHOT_COLOR : COLORS.cyan,
      1,
      this.fx.paddlePulse,
      this.fx.paddleHitOffset,
      powerLevel(game, 'laser'),
      powerLevel(game, 'catch'),
    );
    this.paddle.commit();
    this.drawCharges(game, x);
  }

  /** Held charges as a row of dots under the paddle, one per charge, in the power's colour. */
  private drawCharges(game: Game, x: number): void {
    const p = game.paddle;
    const dots = this.chargeDots;
    let y = p.y - p.h / 2 - CHARGE_DOT.drop;
    dots.begin();
    for (const kind of CHARGE_POWERS) {
      const n = game.charges[kind];
      if (n === 0) continue;
      for (let i = 0; i < n; i++) {
        dots.push(x + (i - (n - 1) / 2) * CHARGE_DOT.step, y, CHARGE_DOT.size, CHARGE_DOT.size, POWER_COLORS[kind]);
      }
      y -= CHARGE_DOT.step;
    }
    dots.commit();
  }

  private drawBlast(): void {
    this.blast.begin();
    for (const e of this.fx.explosions) this.blast.push(e.x, e.y, e.radius * 2, e.radius * 2, e.color, 1, e.strength);
    this.blast.commit();
  }

  /** Piercing balls burn hotter; with detonator charges held, the balls that would blow are tinted. */
  private drawBalls(game: Game, alpha: number): void {
    const pierce = powerLevel(game, 'pierce');
    const armed = game.charges.detonator > 0 ? game.blastBalls() : [];
    this.color.copy(COLORS.cyan).lerp(PIERCE_BALL_COLOR, pierce * 0.7);
    this.armedColor.copy(this.color).lerp(POWER_COLORS.detonator, 0.75);
    this.balls.begin();
    this.ballPositions.forEach((pos, i) => {
      const ball = game.balls[i];
      if (!ball) return;
      this.balls.push(pos.x, pos.y, ball.r * 2, ball.r * 2, armed.includes(ball) ? this.armedColor : this.color, 1, pierce);
    });
    for (const s of game.shadows) {
      const fade = SHADOW_LOOK.alpha * Math.min(1, s.life / SHADOW_LOOK.fade);
      this.balls.push(lerp(s.px, s.x, alpha), lerp(s.py, s.y, alpha), s.r * 2, s.r * 2, COLORS.purple, fade);
    }
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
