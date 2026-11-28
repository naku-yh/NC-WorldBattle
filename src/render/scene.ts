import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { isMusterLocal, isReservedLocal, laneTiles, terrainAt, toLocal, toWorld, zoneSize } from '../game/board';
import type { GameState, Pt } from '../game/types';
import { DEPOT_COLOR, LANE_COLOR, TERRAIN_COLORS, WATER } from './palette';
import { TerrainDecor, noise } from './terrain';
import { WaterShape, flooded } from './water';

export { worldOf } from './coords';

export const HIGHLIGHT = { move: 0x60a5fa, attack: 0xef4444, spawn: 0xfbbf24, build: 0x4ade80 };

/** Highlights sit a hair above the board, and above the bridge decks too. */
const MARK_Y = 0.075;

/** How many pixels of the water's mask go to a tile: only its outline matters, so it need not be fine. */
const MASK_PX = 24;

/**
 * The water of the map as one body: a soft shade cast out from its banks,
 * then the water itself, in the smooth shape that the sheet laid over it takes
 * too (see `water.ts`). Everything else about the water is that sheet's.
 */
function paintWater(g: CanvasRenderingContext2D, s: GameState): void {
  const { pieces } = new WaterShape(s);
  if (!pieces.length) return;
  const side = s.boardSize * MASK_PX;
  const mask = document.createElement('canvas');
  mask.width = mask.height = side;
  const m = mask.getContext('2d')!;
  m.fillStyle = '#fff';
  for (const { outline } of pieces) {
    m.beginPath();
    outline.forEach(([x, y], i) => (i ? m.lineTo(x * MASK_PX, (s.boardSize - y) * MASK_PX) : m.moveTo(x * MASK_PX, (s.boardSize - y) * MASK_PX)));
    m.closePath();
    m.fill();
  }
  // The shade is the mask's own shadow. The mask is drawn two canvas widths off to the left, and its shadow as far to the right,
  // so the shadow lands here and nothing of the mask itself does.
  const wide = g.canvas.width;
  g.save();
  g.shadowColor = 'rgba(8,24,20,0.55)';
  g.shadowBlur = wide / 40;
  g.shadowOffsetX = wide * 2;
  g.drawImage(mask, -wide * 2, 0, wide, g.canvas.height);
  g.restore();
  m.globalCompositeOperation = 'source-in';
  m.fillStyle = WATER;
  m.fillRect(0, 0, side, side);
  g.drawImage(mask, 0, 0, g.canvas.width, g.canvas.height);
}

/** A soft patch of colour laid over a tile, for grain: a darker patch, a sunnier one, a wet one. */
function patch(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Light in the middle and shade at the edges, so a hill tile reads as a mound seen from above. */
function mound(g: CanvasRenderingContext2D, x0: number, y0: number, px: number): void {
  const cx = x0 + px / 2;
  const cy = y0 + px / 2;
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, px * 0.72);
  grad.addColorStop(0, 'rgba(255,246,220,0.26)');
  grad.addColorStop(0.5, 'rgba(255,246,220,0)');
  grad.addColorStop(0.8, 'rgba(46,34,12,0.2)');
  grad.addColorStop(1, 'rgba(46,34,12,0.32)');
  g.fillStyle = grad;
  g.fillRect(x0, y0, px, px);
}

/** A few patches scattered over a tile: where they fall is fixed by the tile, so a map always looks the same. */
function grain(g: CanvasRenderingContext2D, x: number, y: number, x0: number, y0: number, px: number, patches: string[]): void {
  patches.forEach((color, i) => {
    const r = px * (0.2 + noise(x, y, i, 60) * 0.16);
    patch(g, x0 + r + noise(x, y, i, 61) * (px - 2 * r), y0 + r + noise(x, y, i, 62) * (px - 2 * r), r, color);
  });
}

/** The sky the map sits under, as a band of colour from the ground (bottom) to the zenith (top). */
function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, '#26352a');
  grad.addColorStop(0.47, '#7f9a80');
  grad.addColorStop(0.53, '#d5e6f6');
  grad.addColorStop(0.75, '#8db8ea');
  grad.addColorStop(1, '#4f86d2');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawBoard(s: GameState): HTMLCanvasElement {
  const n = s.boardSize;
  const px = 96;
  const c = document.createElement('canvas');
  c.width = c.height = n * px;
  const g = c.getContext('2d')!;
  const X = (tx: number): number => tx * px;
  const Y = (ty: number): number => (n - 1 - ty) * px;

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const t = terrainAt(s, x, y);
      // Water is painted afterwards as one smooth shape. Its tiles start out as lawn: that is what shows along the banks and in the rounded corners.
      const col = TERRAIN_COLORS[flooded(s, x, y) ? 'plain' : t];
      g.fillStyle = (x + y) % 2 === 0 ? col.a : col.b;
      g.fillRect(X(x), Y(y), px, px);
      if (t === 'forest') {
        // A dark floor under the trees, with what light gets through it.
        grain(g, x, y, X(x), Y(y), px, ['rgba(8,32,14,0.34)', 'rgba(8,32,14,0.26)', 'rgba(170,214,120,0.12)']);
        g.fillStyle = 'rgba(12,40,18,0.35)';
        for (let i = 0; i < 5; i++) {
          const r = 3 + noise(x, y, i, 30) * 5;
          g.beginPath();
          g.arc(X(x) + 8 + noise(x, y, i, 31) * (px - 16), Y(y) + 8 + noise(x, y, i, 32) * (px - 16), r, 0, Math.PI * 2);
          g.fill();
        }
      } else if (t === 'hill') {
        mound(g, X(x), Y(y), px);
        grain(g, x, y, X(x), Y(y), px, ['rgba(60,48,26,0.16)']);
      } else {
        // Lawn: a little worn here, a little lush there, so it does not read as flat vinyl.
        grain(g, x, y, X(x), Y(y), px, ['rgba(24,70,26,0.16)', 'rgba(24,70,26,0.12)', 'rgba(196,232,140,0.1)']);
      }
    }
  }
  // A little organic grain so the lawn does not read as flat vinyl.
  for (let i = 0; i < n * n * 6; i++) {
    g.fillStyle = Math.random() < 0.6 ? 'rgba(20,50,20,0.16)' : 'rgba(255,255,190,0.08)';
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 2 + Math.random() * 4, 1 + Math.random() * 2);
  }
  paintWater(g, s);

  for (const p of s.players) {
    const c0 = s.corners[p.corner];
    const size = zoneSize(p);
    const at = (u: number, v: number): [number, number] => [X(c0.ox + u * c0.dx), Y(c0.oy + v * c0.dy)];
    // Truck depot, the lanes the trucks drive along and the tile new units appear on, inside the zone...
    for (let v = 0; v < size; v++) {
      for (let u = 0; u < size; u++) {
        if (!isReservedLocal(u, v) && !isMusterLocal(u, v)) continue;
        const depot = u >= 1 && u <= 2 && v >= 2 && v <= 3;
        g.fillStyle = depot ? DEPOT_COLOR : LANE_COLOR;
        const [x, y] = at(u, v);
        g.fillRect(x, y, px, px);
        if (depot) {
          g.strokeStyle = 'rgba(40,46,56,0.5)';
          g.lineWidth = 3;
          g.strokeRect(x + 6, y + 6, px - 12, px - 12);
        }
      }
    }
    // ...and on out to each resource node.
    g.fillStyle = LANE_COLOR;
    for (const node of s.nodes.filter((nd) => nd.corner === p.corner)) {
      for (const l of laneTiles(toLocal(c0, node.x, node.y))) {
        const q = toWorld(c0, l.x, l.y);
        if (q.x === node.x && q.y === node.y) continue; // the node has a model of its own
        g.fillRect(X(q.x), Y(q.y), px, px);
      }
    }
    // Home zone tint and border: a tile wider on both sides once the base is upgraded.
    const x0 = Math.min(c0.ox, c0.ox + (size - 1) * c0.dx);
    const y1 = Math.max(c0.oy, c0.oy + (size - 1) * c0.dy);
    g.fillStyle = p.color;
    g.globalAlpha = 0.2;
    g.fillRect(X(x0), Y(y1), size * px, size * px);
    g.globalAlpha = 1;
    g.strokeStyle = p.color;
    g.lineWidth = 7;
    g.strokeRect(X(x0) + 3.5, Y(y1) + 3.5, size * px - 7, size * px - 7);
  }

  g.strokeStyle = 'rgba(255,255,255,0.11)';
  g.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    g.beginPath();
    g.moveTo(i * px, 0);
    g.lineTo(i * px, c.height);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * px);
    g.lineTo(c.width, i * px);
    g.stroke();
  }
  return c;
}

/** The usual line of sight: from the target up and towards the camera. */
export const VIEW_DIR = new THREE.Vector3(0, 20.6, 24.5).normalize();
/** The four corners of the board, as fractions of its half-width. */
const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];
/** Eye-to-target distance at which the medium board fills the view. */
const OVERVIEW = Math.hypot(20.6, 24.5);
/** The title screen looks from lower down, so the bases and woods stand up against the sky. */
const SHOWCASE_DIR = new THREE.Vector3(0, 12.5, 24).normalize();
/** How far the eye sits then, as a share of the overview distance. */
const SHOWCASE_DIST = 0.86;

/** Owns the WebGL context, camera and everything that is not a game entity. */
export class Scene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** Entities live here; rebuilt when a new match starts. */
  readonly dynamic = new THREE.Group();
  readonly overlay = new THREE.Group();
  private boardTop: THREE.Mesh | null = null;
  private boardBase: THREE.Mesh | null = null;
  /** The map painted onto the board. Let go of with the board: it is the largest thing on the card. */
  private boardTex: THREE.CanvasTexture | null = null;
  private tiles: THREE.Mesh[] = [];
  private tileMats = new Map<number, THREE.MeshBasicMaterial>();
  private hover: THREE.LineSegments;
  private inspect: THREE.LineSegments;
  private ghost: THREE.Mesh[] = [];
  private ghostOk = new THREE.MeshBasicMaterial({ color: HIGHLIGHT.build, transparent: true, opacity: 0.5, depthWrite: false });
  private ghostNo = new THREE.MeshBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.5, depthWrite: false });
  private sun: THREE.DirectionalLight;
  private decor: TerrainDecor | null = null;
  readonly ring: THREE.Mesh;
  size = 20;
  private panning = false;
  /** The title screen is up: the board turns on its own and sits low in the window, under the title. */
  private turning = false;
  /** Size of the picture, as last measured by `resize`. */
  private viewW = 0;
  private viewH = 0;
  /** Width the gathering panel covers on the right, on top of the sidebar; 0 while it is down. */
  private sideInset = 0;
  /** That width as the picture sees it just now: it eases towards `sideInset`. */
  private insetNow = 0;
  /** The distance the whole board was last framed at, for keeping it all in view when the panel goes up or comes down. */
  private framed = 0;
  /** A stand-in for the eye when trying out how far back it has to sit (see `overviewDistance`). */
  private spy: THREE.PerspectiveCamera | null = null;

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0x0d1220);
    this.scene.fog = new THREE.Fog(0x0d1220, 48, 120);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 260);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 64;
    this.controls.maxPolarAngle = 1.32;
    this.controls.minPolarAngle = 0.12;
    // Panning slides the board around on the ground instead of lifting the eye off it.
    this.controls.screenSpacePanning = false;
    this.resetView();

    // Something for every glossy surface to reflect, armour and water above all: a sky
    // that is blue overhead, pale at the horizon and dark ground below it.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const sky = new THREE.Scene();
    sky.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide })));
    this.scene.environment = pmrem.fromScene(sky, 0.03).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0xd6e9ff, 0x2d472d, 0.7);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
    const sun = this.sun;
    sun.position.set(16, 28, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -17;
    sun.shadow.camera.right = 17;
    sun.shadow.camera.top = 17;
    sun.shadow.camera.bottom = -17;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.025;
    const fill = new THREE.DirectionalLight(0x8fb0ff, 0.4);
    fill.position.set(-14, 12, -16);
    this.scene.add(hemi, sun, sun.target, fill);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ color: 0x101827, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.62;
    ground.receiveShadow = true;
    this.scene.add(ground, this.dynamic, this.overlay);

    const tileGeo = new THREE.PlaneGeometry(0.9, 0.9);
    for (let i = 0; i < 320; i++) {
      const m = new THREE.Mesh(tileGeo, this.tileMat(0xffffff));
      m.rotation.x = -Math.PI / 2;
      m.position.y = MARK_Y;
      m.visible = false;
      this.overlay.add(m);
      this.tiles.push(m);
    }
    const outline = (color: number, opacity: number): THREE.LineSegments => {
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
      l.rotation.x = -Math.PI / 2;
      l.position.y = MARK_Y + 0.012;
      l.visible = false;
      this.overlay.add(l);
      return l;
    };
    this.hover = outline(0xffffff, 0.85);
    this.inspect = outline(0xfde047, 1);
    // A building's footprint while the player is choosing where to put it.
    const ghostGeo = new THREE.PlaneGeometry(0.94, 0.94);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(ghostGeo, this.ghostOk);
      m.rotation.x = -Math.PI / 2;
      m.position.y = MARK_Y + 0.006;
      m.visible = false;
      this.overlay.add(m);
      this.ghost.push(m);
    }

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.36, 0.46, 40),
      new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = MARK_Y + 0.015;
    this.ring.visible = false;
    this.ring.renderOrder = 5;
    this.overlay.add(this.ring);

    this.resize();
  }

  private tileMat(color: number): THREE.MeshBasicMaterial {
    let m = this.tileMats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false });
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      this.tileMats.set(color, m);
    }
    return m;
  }

  /**
   * How far the eye sits from what it looks at when the whole board is in
   * view: the usual distance, or further back if the sidebar and the gathering
   * panel between them leave too narrow a stretch of window for the board.
   */
  get overviewDistance(): number {
    const base = OVERVIEW * (this.size / 20);
    // Under the title there is no sidebar, and on a narrow screen it lies along the bottom instead.
    if (this.turning || this.viewW <= 860) return (this.framed = base);
    // The width the picture may fill: short of the sidebar with its margin, the gathering panel, and a little air.
    const room = this.viewW - 358 - this.insetNow - 48;
    if (this.wholeBoardIn(base, room)) return (this.framed = base);
    // Half-way between a distance that is too close and one that is sure to be far enough, until they meet.
    let near = base;
    let far = base * 3;
    for (let i = 0; i < 14; i++) {
      const mid = (near + far) / 2;
      if (this.wholeBoardIn(mid, room)) far = mid;
      else near = mid;
    }
    return (this.framed = far);
  }

  /** Would all four corners of the board land inside a strip `room` pixels wide, centred where the picture is centred, from `dist` away? */
  private wholeBoardIn(dist: number, room: number): boolean {
    // A stand-in for the eye, looking at the board's centre from the usual line of sight; it borrows the real projection.
    this.spy ??= new THREE.PerspectiveCamera();
    this.spy.position.copy(VIEW_DIR).multiplyScalar(dist);
    this.spy.updateMatrixWorld();
    this.spy.lookAt(0, 0, 0);
    this.spy.updateMatrixWorld();
    this.spy.projectionMatrix.copy(this.camera.projectionMatrix);
    // The view offset slides the picture away from the window's middle, to the middle of the strip; measure from there.
    const centre = (-2 * (this.camera.view?.offsetX ?? 0)) / this.viewW;
    const half = this.size / 2;
    const at = new THREE.Vector3();
    for (const [x, z] of CORNERS) {
      if (Math.abs(at.set(x * half, 0, z * half).project(this.spy).x - centre) > room / this.viewW) return false;
    }
    return true;
  }

  buildBoard(s: GameState): void {
    // Everything that belonged to the last board goes with it. The picture is rebuilt every
    // time a board is put on, the title screen's included, so nothing may be left behind.
    if (this.boardTop) {
      this.scene.remove(this.boardTop);
      this.boardTop.geometry.dispose();
      (this.boardTop.material as THREE.Material).dispose();
      this.boardTex?.dispose();
    }
    if (this.boardBase) {
      this.scene.remove(this.boardBase);
      this.boardBase.geometry.dispose();
      (this.boardBase.material as THREE.Material).dispose();
    }
    if (this.decor) {
      this.scene.remove(this.decor.group);
      this.decor.dispose();
    }
    this.decor = new TerrainDecor(s, this.sun.position);
    this.scene.add(this.decor.group);
    this.size = s.boardSize;
    const n = s.boardSize;
    const k = n / 20;
    // Haze and shadows reach as far as the board does, whatever its size.
    (this.scene.fog as THREE.Fog).near = 48 * k;
    (this.scene.fog as THREE.Fog).far = 120 * k;
    this.sun.shadow.camera.left = -17 * k;
    this.sun.shadow.camera.right = 17 * k;
    this.sun.shadow.camera.top = 17 * k;
    this.sun.shadow.camera.bottom = -17 * k;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.controls.maxDistance = this.overviewDistance * 1.7;

    this.boardTex = new THREE.CanvasTexture(drawBoard(s));
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    this.boardTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.boardTop = new THREE.Mesh(new THREE.PlaneGeometry(n, n), new THREE.MeshStandardMaterial({ map: this.boardTex, roughness: 0.92 }));
    this.boardTop.rotation.x = -Math.PI / 2;
    this.boardTop.receiveShadow = true;
    this.boardBase = new THREE.Mesh(new THREE.BoxGeometry(n + 0.7, 0.6, n + 0.7), new THREE.MeshStandardMaterial({ color: 0x1a2130, roughness: 0.85 }));
    this.boardBase.position.y = -0.31;
    this.boardBase.receiveShadow = true;
    this.scene.add(this.boardBase, this.boardTop);
  }

  /** Coloured squares on the board: where a unit can go, what it can hit, where a building may stand. */
  setHighlights(tiles: Array<Pt & { color: number }>): void {
    let i = 0;
    for (const t of tiles) {
      const m = this.tiles[i++];
      if (!m) return;
      m.material = this.tileMat(t.color);
      m.position.set(t.x - (this.size - 1) / 2, MARK_Y, (this.size - 1) / 2 - t.y);
      m.visible = true;
    }
    for (; i < this.tiles.length; i++) this.tiles[i].visible = false;
  }

  setHover(tile: Pt | null): void {
    this.hover.visible = !!tile;
    if (tile) this.hover.position.set(tile.x - (this.size - 1) / 2, MARK_Y + 0.012, (this.size - 1) / 2 - tile.y);
  }

  /** The tile the player clicked to look at, kept outlined until they click elsewhere. */
  setInspect(tile: Pt | null): void {
    this.inspect.visible = !!tile;
    if (tile) this.inspect.position.set(tile.x - (this.size - 1) / 2, MARK_Y + 0.012, (this.size - 1) / 2 - tile.y);
  }

  /** Footprint preview while placing a building. */
  setGhost(tiles: Pt[], ok: boolean): void {
    this.ghost.forEach((m, i) => {
      const t = tiles[i];
      m.visible = !!t;
      m.material = ok ? this.ghostOk : this.ghostNo;
      if (t) m.position.set(t.x - (this.size - 1) / 2, MARK_Y + 0.006, (this.size - 1) / 2 - t.y);
    });
  }

  /** Screen point -> entity-free board lookup. Returns the tile under the cursor. */
  tileAt(clientX: number, clientY: number): Pt | null {
    if (!this.boardTop) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.boardTop, false)[0];
    if (!hit) return null;
    const n = this.size;
    const x = Math.round(hit.point.x + (n - 1) / 2);
    const y = Math.round((n - 1) / 2 - hit.point.z);
    return x >= 0 && y >= 0 && x < n && y < n ? { x, y } : null;
  }

  /** The whole board, seen from the near side. Also ends the slow turn of the title screen. */
  resetView(): void {
    this.controls.autoRotate = false;
    if (this.turning) {
      this.turning = false;
      this.resize();
    }
    this.frame(new THREE.Vector3(0, 0, 0));
  }

  /** The title screen: the board from lower down, turning slowly, set below the middle of the window. */
  showcase(): void {
    this.turning = true;
    // Left still for those who ask their system for less movement.
    this.controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controls.autoRotateSpeed = 0.3;
    this.frame(new THREE.Vector3(0, 0, 0), this.overviewDistance * SHOWCASE_DIST, SHOWCASE_DIR);
    this.resize();
  }

  /** Looks at `at` from `dist` away, along the usual line of sight. */
  frame(at: THREE.Vector3, dist = this.overviewDistance, dir = VIEW_DIR): void {
    this.controls.target.copy(at);
    this.camera.position.copy(at).addScaledVector(dir, dist);
    this.controls.update();
  }

  /** While on, dragging with the left button slides the board instead of turning the camera. */
  setPanMode(on: boolean): void {
    this.panning = on;
    this.controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    this.canvas.style.cursor = on ? 'grab' : '';
  }

  get isPanning(): boolean {
    return this.panning;
  }

  /** Which patch of the board the camera has in sight, in tile coordinates. */
  viewBounds(): { x0: number; y0: number; x1: number; y1: number } {
    const n = this.size;
    const half = (n - 1) / 2;
    const toTile = (cx: number, cy: number): { x: number; y: number } | null => {
      const rect = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const at = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      if (!at) return null;
      return { x: at.x + half, y: half - at.z };
    };
    const rect = this.canvas.getBoundingClientRect();
    const pts = [toTile(rect.left, rect.top), toTile(rect.right, rect.top), toTile(rect.left, rect.bottom), toTile(rect.right, rect.bottom)].filter((p): p is { x: number; y: number } => !!p);
    if (!pts.length) return { x0: 0, y0: 0, x1: n, y1: n };
    const clamp = (v: number): number => Math.max(-0.5, Math.min(n - 0.5, v));
    return {
      x0: clamp(Math.floor(Math.min(...pts.map((p) => p.x)))),
      x1: clamp(Math.ceil(Math.max(...pts.map((p) => p.x)))),
      y0: clamp(Math.floor(Math.min(...pts.map((p) => p.y)))),
      y1: clamp(Math.ceil(Math.max(...pts.map((p) => p.y)))),
    };
  }

  /** Per-frame scenery animation. */
  tick(dt: number): void {
    this.decor?.tick(dt);
  }

  resize(): void {
    this.viewW = this.canvas.clientWidth || window.innerWidth;
    this.viewH = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(this.viewW, this.viewH, false);
    // Pull back on narrow screens so the whole square still fits.
    this.camera.fov = this.viewW / this.viewH < 1 ? 58 : 42;
    this.insetNow = this.sideInset;
    this.applyViewOffset();
  }

  /**
   * The gathering panel went up or came down: `px` is how much of the right
   * edge it covers, on top of the sidebar. The board glides out of its way.
   */
  setSideInset(px: number): void {
    this.sideInset = px;
  }

  /**
   * Slides the picture so the board is centred in the part of the window the
   * HUD leaves visible.
   */
  private applyViewOffset(): void {
    const w = this.viewW;
    const h = this.viewH;
    const sidebar = w > 860;
    let offX = 0;
    let offY = 0;
    if (this.turning) {
      // Under the title: the board sinks towards the bottom edge.
      offY = -h * 0.25;
    } else {
      // Half of what the sidebar, and the gathering panel while it is up, cover on the right.
      offX = sidebar ? 179 + this.insetNow / 2 : 0;
      offY = sidebar ? -40 : (h * 0.46 + 8) / 2;
    }
    this.camera.setViewOffset(w, h, offX, offY, w, h);
  }

  render(): void {
    this.controls.update();
    // The gathering panel's share of the window eases in and out, so the board glides rather than jumps.
    if (this.insetNow !== this.sideInset) {
      const framed = this.framed;
      const d = this.sideInset - this.insetNow;
      this.insetNow = Math.abs(d) < 0.5 ? this.sideInset : this.insetNow + d * 0.14;
      this.applyViewOffset();
      // A board that was all in view a moment ago stays all in view: the eye backs off as far as the panel now makes necessary.
      const t = this.controls.target;
      if (framed > 0 && t.lengthSq() < 1e-4 && Math.abs(this.camera.position.distanceTo(t) - framed) < 0.05) {
        this.camera.position.sub(t).setLength(this.overviewDistance).add(t);
      }
    }
    // Panning may slide the board around, but never out from under the camera.
    const t = this.controls.target;
    const lim = this.size / 2 + 3;
    const dx = THREE.MathUtils.clamp(t.x, -lim, lim) - t.x;
    const dz = THREE.MathUtils.clamp(t.z, -lim, lim) - t.z;
    if (dx || dz) {
      t.x += dx;
      t.z += dz;
      this.camera.position.x += dx;
      this.camera.position.z += dz;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
