import * as THREE from 'three';
import { FIELD, PALETTE } from '../config/game';
import type { Game } from '../game/Game';
import type { Brick } from '../game/types';

/** Screen-space padding (px) between the playfield frame and its area. */
const FIELD_PADDING = 28;
const MAX_BRICKS = 256;
const MAX_BALLS = 32;
/** Ticks a brick stays lit after a hit. */
const FLASH_TICKS = 10;
/** Visual gap between neighbouring bricks, and the width of the bright rim around their dark core. */
const BRICK_GAP = 1.5;
const RIM = 1.5;
/** Normal bricks are tinted by row, magenta at the top towards cyan. */
const ROW_COLORS = [PALETTE.magenta, 0xe03cff, PALETTE.purple, 0x6c5cff, 0x3d8bff, PALETTE.cyan];
const STEEL_COLOR = 0x8c84b0;
const CORE_DIM = 0.3;
const WHITE = new THREE.Color(PALETTE.white);

/** Phase 1 placeholder look: flat rimmed quads. Replaced by SDF/glass materials in phase 2. */
export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera();
  private pxPerUnit = 1;

  private brickRims = createInstanced(new THREE.PlaneGeometry(1, 1), MAX_BRICKS);
  private brickCores = createInstanced(new THREE.PlaneGeometry(1, 1), MAX_BRICKS);
  private balls = createInstanced(new THREE.CircleGeometry(1, 20), MAX_BALLS);
  private ballGlows = createInstanced(new THREE.CircleGeometry(1, 20), MAX_BALLS, 0.18);
  private paddleRim = createQuad(PALETTE.cyan);
  private paddleCore = createQuad(new THREE.Color(PALETTE.cyan).multiplyScalar(CORE_DIM).getHex());

  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(
    canvas: HTMLCanvasElement,
    private fieldArea: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(PALETTE.bg);
    this.scene.add(
      createBackgroundGrid(),
      createFieldFrame(),
      this.brickRims,
      this.brickCores,
      this.paddleRim,
      this.paddleCore,
      this.ballGlows,
      this.balls,
    );

    new ResizeObserver(() => this.resize()).observe(document.body);
    this.resize();
  }

  /** CSS pixels per world unit. */
  get scale(): number {
    return this.pxPerUnit;
  }

  /** World x under a window-space CSS pixel x. */
  screenToWorldX(clientX: number): number {
    return this.camera.position.x + (clientX - window.innerWidth / 2) / this.pxPerUnit;
  }

  /**
   * The canvas covers the whole window; the camera is positioned so the playfield
   * fits (letterboxed) inside the #field-area element, leaving the left panel over background.
   */
  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);

    const area = this.fieldArea.getBoundingClientRect();
    const scale = Math.max(
      0.01,
      Math.min(
        (area.width - FIELD_PADDING * 2) / FIELD.width,
        (area.height - FIELD_PADDING * 2) / FIELD.height,
      ),
    );
    this.pxPerUnit = scale;
    const areaCx = area.left + area.width / 2;
    const areaCy = area.top + area.height / 2;

    const halfW = w / (2 * scale);
    const halfH = h / (2 * scale);
    const camX = FIELD.width / 2 - (areaCx - w / 2) / scale;
    const camY = FIELD.height / 2 + (areaCy - h / 2) / scale;

    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH, near: -100, far: 100 });
    this.camera.position.set(camX, camY, 10);
    this.camera.updateProjectionMatrix();
  }

  render(game: Game, alpha: number): void {
    this.drawBricks(game);
    this.drawPaddle(game, alpha);
    this.drawBalls(game, alpha);
    this.renderer.render(this.scene, this.camera);
  }

  private drawBricks(game: Game): void {
    let n = 0;
    for (const br of game.bricks) {
      if (!br.alive) continue;
      brickColor(br, this.color);
      const flash = 1 - (game.tick - br.hitTick) / FLASH_TICKS;
      if (flash > 0) this.color.lerp(WHITE, flash * 0.8);

      const x = br.x + br.w / 2;
      const y = br.y + br.h / 2;
      const w = br.w - BRICK_GAP;
      const h = br.h - BRICK_GAP;
      this.place(this.brickRims, n, x, y, w, h, 0.5, this.color);
      this.place(this.brickCores, n, x, y, w - RIM * 2, h - RIM * 2, 0.6, this.color.multiplyScalar(CORE_DIM));
      n++;
    }
    commit(this.brickRims, n);
    commit(this.brickCores, n);
  }

  private drawPaddle(game: Game, alpha: number): void {
    const p = game.paddle;
    const x = p.px + (p.x - p.px) * alpha;
    this.paddleRim.position.set(x, p.y, 0.5);
    this.paddleRim.scale.set(p.w, p.h, 1);
    this.paddleCore.position.set(x, p.y, 0.6);
    this.paddleCore.scale.set(p.w - RIM * 2, p.h - RIM * 2, 1);
  }

  private drawBalls(game: Game, alpha: number): void {
    let n = 0;
    for (const b of game.balls) {
      if (n >= MAX_BALLS) break;
      const x = b.px + (b.x - b.px) * alpha;
      const y = b.py + (b.y - b.py) * alpha;
      this.place(this.balls, n, x, y, b.r, b.r, 1);
      this.place(this.ballGlows, n, x, y, b.r * 2.6, b.r * 2.6, 0.9);
      n++;
    }
    commit(this.balls, n);
    commit(this.ballGlows, n);
  }

  private place(
    mesh: THREE.InstancedMesh,
    i: number,
    x: number,
    y: number,
    sx: number,
    sy: number,
    z: number,
    color?: THREE.Color,
  ): void {
    this.dummy.position.set(x, y, z);
    this.dummy.scale.set(sx, sy, 1);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(i, this.dummy.matrix);
    if (color) mesh.setColorAt(i, color);
  }
}

function brickColor(br: Brick, out: THREE.Color): THREE.Color {
  if (br.kind === 'steel') return out.setHex(STEEL_COLOR);
  if (br.kind === 'tough') return out.setHex(PALETTE.yellow).multiplyScalar(0.4 + 0.6 * (br.hp / br.maxHp));
  return out.setHex(ROW_COLORS[br.row % ROW_COLORS.length] ?? PALETTE.magenta);
}

/** Instanced mesh with per-instance colour (initialised to white so the shader includes it). */
function createInstanced(geometry: THREE.BufferGeometry, max: number, opacity = 1): THREE.InstancedMesh {
  const material =
    opacity < 1
      ? new THREE.MeshBasicMaterial({
          transparent: true,
          opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      : new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, max);
  for (let i = 0; i < max; i++) mesh.setColorAt(i, WHITE);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

function commit(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function createQuad(color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color }));
}

/** Placeholder synthwave floor grid behind everything (replaced in phase 2). */
function createBackgroundGrid(): THREE.Object3D {
  const size = 4000;
  const step = 24;
  const points: number[] = [];
  for (let v = -size; v <= size; v += step) {
    points.push(v, -size, 0, v, size, 0, -size, v, 0, size, v, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color: PALETTE.purple, transparent: true, opacity: 0.12 });
  const grid = new THREE.LineSegments(geometry, material);
  grid.position.set(FIELD.width / 2, FIELD.height / 2, -5);
  return grid;
}

/** Neon frame around the playfield: crisp line plus a fake glow made of wider faint quads. */
function createFieldFrame(): THREE.Object3D {
  const group = new THREE.Group();

  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.width, FIELD.height),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }),
  );
  fill.position.set(FIELD.width / 2, FIELD.height / 2, -1);
  group.add(fill);

  const corners = [
    [0, 0],
    [FIELD.width, 0],
    [FIELD.width, FIELD.height],
    [0, FIELD.height],
  ];
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(corners.map(([x, y]) => new THREE.Vector3(x, y, 0))),
    new THREE.LineBasicMaterial({ color: PALETTE.cyan }),
  );
  group.add(outline);

  for (const [width, opacity] of [
    [3, 0.25],
    [8, 0.08],
  ] as const) {
    const glow = new THREE.Mesh(
      frameStripGeometry(width),
      new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity, depthWrite: false }),
    );
    group.add(glow);
  }
  return group;
}

/** A hollow rectangle of the given thickness centred on the field border. */
function frameStripGeometry(thickness: number): THREE.ShapeGeometry {
  const t = thickness / 2;
  const outer = new THREE.Shape([
    new THREE.Vector2(-t, -t),
    new THREE.Vector2(FIELD.width + t, -t),
    new THREE.Vector2(FIELD.width + t, FIELD.height + t),
    new THREE.Vector2(-t, FIELD.height + t),
  ]);
  outer.holes.push(
    new THREE.Path([
      new THREE.Vector2(t, t),
      new THREE.Vector2(t, FIELD.height - t),
      new THREE.Vector2(FIELD.width - t, FIELD.height - t),
      new THREE.Vector2(FIELD.width - t, t),
    ]),
  );
  return new THREE.ShapeGeometry(outer);
}
