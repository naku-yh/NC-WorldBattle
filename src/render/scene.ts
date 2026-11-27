import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { isMusterLocal, isReservedLocal, laneTiles, terrainAt, toLocal, toWorld, zoneSize } from '../game/board';
import type { GameState, Pt } from '../game/types';
import { DEPOT_COLOR, LANE_COLOR, TERRAIN_COLORS } from './palette';
import { TerrainDecor, noise } from './terrain';

export { worldOf } from './coords';

export const HIGHLIGHT = { move: 0x60a5fa, attack: 0xef4444, spawn: 0xfbbf24, build: 0x4ade80 };

/** Highlights sit a hair above the board, and above the bridge decks too. */
const MARK_Y = 0.075;

/** Light streaks on a stretch of water. */
function waves(g: CanvasRenderingContext2D, x0: number, y0: number, px: number, x: number, y: number): void {
  g.strokeStyle = 'rgba(200,232,255,0.3)';
  g.lineWidth = 3;
  g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const ox = x0 + 10 + noise(x, y, i, 20) * (px - 46);
    const oy = y0 + 12 + noise(x, y, i, 21) * (px - 26);
    g.beginPath();
    g.moveTo(ox, oy);
    g.quadraticCurveTo(ox + 9, oy - 6, ox + 18, oy);
    g.quadraticCurveTo(ox + 27, oy + 6, ox + 34, oy);
    g.stroke();
  }
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
      const col = TERRAIN_COLORS[t];
      g.fillStyle = (x + y) % 2 === 0 ? col.a : col.b;
      g.fillRect(X(x), Y(y), px, px);
      if (t === 'water' || t === 'lake') waves(g, X(x), Y(y), px, x, y);
      else if (t === 'bridge') {
        // Planks run along the waterway; the deck is laid across it.
        g.fillStyle = 'rgba(60,34,12,0.45)';
        for (let i = 0; i < 6; i++) {
          const o = px * 0.22 + i * (px * 0.11);
          if (s.waterway === 'vertical') g.fillRect(X(x) + o, Y(y) + px * 0.2, 4, px * 0.6);
          else g.fillRect(X(x) + px * 0.2, Y(y) + o, px * 0.6, 4);
        }
      } else if (t === 'forest' || t === 'hill') {
        // Tufts of undergrowth, or loose stones.
        g.fillStyle = t === 'forest' ? 'rgba(12,40,18,0.35)' : 'rgba(255,246,220,0.16)';
        for (let i = 0; i < 5; i++) {
          const r = 3 + noise(x, y, i, 30) * 5;
          g.beginPath();
          g.arc(X(x) + 8 + noise(x, y, i, 31) * (px - 16), Y(y) + 8 + noise(x, y, i, 32) * (px - 16), r, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }
  // A little organic grain so the lawn does not read as flat vinyl.
  for (let i = 0; i < n * n * 6; i++) {
    g.fillStyle = Math.random() < 0.6 ? 'rgba(20,50,20,0.16)' : 'rgba(255,255,190,0.08)';
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 2 + Math.random() * 4, 1 + Math.random() * 2);
  }

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

    const hemi = new THREE.HemisphereLight(0xd6e9ff, 0x2d472d, 1.15);
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

  /** How far the eye sits from what it looks at when the whole board is in view. */
  get overviewDistance(): number {
    return OVERVIEW * (this.size / 20);
  }

  buildBoard(s: GameState): void {
    if (this.boardTop) {
      this.scene.remove(this.boardTop);
      this.boardTop.geometry.dispose();
      (this.boardTop.material as THREE.Material).dispose();
    }
    if (this.boardBase) this.scene.remove(this.boardBase);
    if (this.decor) this.scene.remove(this.decor.group);
    this.decor = new TerrainDecor(s);
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

    const tex = new THREE.CanvasTexture(drawBoard(s));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.boardTop = new THREE.Mesh(new THREE.PlaneGeometry(n, n), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
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
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    // Pull back on narrow screens so the whole square still fits.
    this.camera.fov = w / h < 1 ? 58 : 42;
    // The HUD covers part of the window: slide the picture so the board is
    // centred in the part the player can actually see.
    const sidebar = w > 860;
    let offX = 0;
    let offY = 0;
    if (this.turning) {
      // Under the title: the board sinks towards the bottom edge.
      offY = -h * 0.25;
    } else {
      offX = sidebar ? 179 : 0;
      offY = sidebar ? -40 : (h * 0.46 + 8) / 2;
    }
    this.camera.setViewOffset(w, h, offX, offY, w, h);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.controls.update();
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
