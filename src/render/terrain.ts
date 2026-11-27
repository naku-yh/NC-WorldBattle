import * as THREE from 'three';
import { terrainAt } from '../game/board';
import type { GameState, Pt } from '../game/types';
import { worldOf } from './coords';

// Static scenery for the map: woods, rocks, bridges and the sheen on water.
// Everything here is decorative; none of it takes part in picking.

/** Deterministic per-tile noise, so a map always looks the same however often it is redrawn. */
export function noise(x: number, y: number, i: number, k = 0): number {
  let h = (Math.imul(x + 31, 374761393) + Math.imul(y + 17, 668265263) + Math.imul(i + 3, 2246822519) + Math.imul(k + 1, 3266489917)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const TRUNK = new THREE.CylinderGeometry(0.028, 0.045, 0.24, 5).translate(0, 0.12, 0);
const CANOPY = new THREE.ConeGeometry(0.19, 0.46, 6).translate(0, 0.42, 0);
const ROCK = new THREE.DodecahedronGeometry(0.16, 0).translate(0, 0.07, 0);
const WATER = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

const TRUNK_MAT = new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.95 });
const CANOPY_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
const DECK_MAT = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.85 });
const RAIL_MAT = new THREE.MeshStandardMaterial({ color: 0x6b4520, roughness: 0.9 });
const WATER_MAT = new THREE.MeshStandardMaterial({ color: 0x3b9be0, transparent: true, opacity: 0.3, roughness: 0.08, metalness: 0.55, depthWrite: false });

const GREENS = [0x2f8f46, 0x3a9a4e, 0x277a3c, 0x46a35a];
const STONES = [0x8a8272, 0x9a9282, 0x76705f];

function tilesOf(s: GameState, kind: string[]): Pt[] {
  const out: Pt[] = [];
  for (let y = 0; y < s.boardSize; y++) for (let x = 0; x < s.boardSize; x++) if (kind.includes(terrainAt(s, x, y))) out.push({ x, y });
  return out;
}

/** Sprays `perTile` things around the edge of each tile, leaving the middle for whoever stands there. */
function scatter(group: THREE.Group, tiles: Pt[], geo: THREE.BufferGeometry, mat: THREE.Material, perTile: (x: number, y: number) => number, place: (m: THREE.Matrix4, c: THREE.Color, at: THREE.Vector3, x: number, y: number, i: number) => void, s: GameState): void {
  const total = tiles.reduce((n, t) => n + perTile(t.x, t.y), 0);
  if (!total) return;
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let i = 0;
  for (const t of tiles) {
    for (let k = 0; k < perTile(t.x, t.y); k++) {
      place(m, c, worldOf(t.x, t.y, s.boardSize), t.x, t.y, k);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c);
      i++;
    }
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);
}

/** One bridge, laid across the waterway. */
function bridge(s: GameState, at: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  // The deck runs across the channel, i.e. at right angles to it.
  g.rotation.y = s.waterway === 'vertical' ? 0 : Math.PI / 2;
  g.position.copy(at);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.05, 0.6), DECK_MAT);
  deck.position.y = 0.035;
  deck.receiveShadow = true;
  g.add(deck);
  for (const z of [-0.27, 0.27]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.045, 0.04), RAIL_MAT);
    rail.position.set(0, 0.105, z);
    rail.castShadow = true;
    g.add(rail);
    for (const x of [-0.44, 0, 0.44]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.05), RAIL_MAT);
      post.position.set(x, 0.075, z);
      g.add(post);
    }
  }
  // Planks: thin darker strips across the deck.
  const plank = new THREE.MeshStandardMaterial({ color: 0x74481f, roughness: 0.9 });
  for (let x = -0.4; x <= 0.41; x += 0.16) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.052, 0.6), plank);
    p.position.set(x, 0.035, 0);
    g.add(p);
  }
  return g;
}

/** Woods, rocks, bridges and water for one map. */
export class TerrainDecor {
  readonly group = new THREE.Group();
  private clock = 0;

  constructor(s: GameState) {
    const n = s.boardSize;
    scatter(
      this.group,
      tilesOf(s, ['forest']),
      TRUNK,
      TRUNK_MAT,
      (x, y) => 2 + Math.floor(noise(x, y, 9) * 2),
      (m, c, at, x, y, k) => {
        const a = noise(x, y, k) * Math.PI * 2;
        const r = 0.3 + noise(x, y, k, 1) * 0.14;
        const sc = 0.75 + noise(x, y, k, 2) * 0.55;
        m.makeRotationY(noise(x, y, k, 3) * Math.PI);
        m.scale(new THREE.Vector3(sc, sc, sc));
        m.setPosition(at.x + Math.cos(a) * r, 0, at.z + Math.sin(a) * r);
        c.setHex(0xffffff);
      },
      s,
    );
    scatter(
      this.group,
      tilesOf(s, ['forest']),
      CANOPY,
      CANOPY_MAT,
      (x, y) => 2 + Math.floor(noise(x, y, 9) * 2),
      (m, c, at, x, y, k) => {
        const a = noise(x, y, k) * Math.PI * 2;
        const r = 0.3 + noise(x, y, k, 1) * 0.14;
        const sc = 0.75 + noise(x, y, k, 2) * 0.55;
        m.makeRotationY(noise(x, y, k, 3) * Math.PI);
        m.scale(new THREE.Vector3(sc, sc, sc));
        m.setPosition(at.x + Math.cos(a) * r, 0, at.z + Math.sin(a) * r);
        c.setHex(GREENS[Math.floor(noise(x, y, k, 4) * GREENS.length)]);
      },
      s,
    );
    scatter(
      this.group,
      tilesOf(s, ['hill']),
      ROCK,
      ROCK_MAT,
      (x, y) => 2 + Math.floor(noise(x, y, 7) * 2),
      (m, c, at, x, y, k) => {
        const a = noise(x, y, k, 5) * Math.PI * 2;
        const r = 0.24 + noise(x, y, k, 6) * 0.16;
        const sc = 0.7 + noise(x, y, k, 7) * 0.9;
        m.makeRotationY(noise(x, y, k, 8) * Math.PI);
        m.scale(new THREE.Vector3(sc, sc * (0.55 + noise(x, y, k, 9) * 0.35), sc));
        m.setPosition(at.x + Math.cos(a) * r, 0, at.z + Math.sin(a) * r);
        c.setHex(STONES[Math.floor(noise(x, y, k, 10) * STONES.length)]);
      },
      s,
    );
    for (const t of tilesOf(s, ['bridge'])) this.group.add(bridge(s, worldOf(t.x, t.y, n)));
    const wet = tilesOf(s, ['water', 'lake']);
    if (wet.length) {
      const water = new THREE.InstancedMesh(WATER, WATER_MAT, wet.length);
      const m = new THREE.Matrix4();
      wet.forEach((t, i) => {
        m.setPosition(worldOf(t.x, t.y, n).setY(0.012));
        water.setMatrixAt(i, m);
      });
      water.renderOrder = 1;
      this.group.add(water);
    }
  }

  /** A slow shimmer on the water. */
  tick(dt: number): void {
    this.clock += dt;
    WATER_MAT.opacity = 0.27 + Math.sin(this.clock * 0.9) * 0.05;
  }
}
