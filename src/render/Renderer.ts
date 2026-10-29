import * as THREE from 'three';
import { FIELD, PALETTE } from '../config/game';
import type { Game } from '../game/Game';

/** Screen-space padding (px) between the playfield frame and its area. */
const FIELD_PADDING = 28;

export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera();
  private ballMeshes = new Map<number, THREE.Mesh>();
  private ballGeometry = new THREE.CircleGeometry(1, 24);
  private ballMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.white });

  constructor(
    canvas: HTMLCanvasElement,
    private fieldArea: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(PALETTE.bg);
    this.scene.add(createBackgroundGrid(), createFieldFrame());

    new ResizeObserver(() => this.resize()).observe(document.body);
    this.resize();
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
    for (const b of game.balls) {
      let mesh = this.ballMeshes.get(b.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.ballGeometry, this.ballMaterial);
        mesh.scale.setScalar(b.r);
        this.ballMeshes.set(b.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(b.px + (b.x - b.px) * alpha, b.py + (b.y - b.py) * alpha, 1);
    }
    this.renderer.render(this.scene, this.camera);
  }
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
