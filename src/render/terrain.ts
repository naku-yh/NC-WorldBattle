import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isMusterLocal, isReservedLocal, laneTiles, terrainAt, toLocal, toWorld, zoneSize } from '../game/board';
import type { GameState, Pt } from '../game/types';
import { worldOf } from './coords';
import { bake, scrap } from './models';
import { WaterShape, type WaterPoint } from './water';

// Static scenery for the map: woods, rocks, grass, bridges and the water.
// Everything here is decorative; none of it takes part in picking.

/** Deterministic per-tile noise, so a map always looks the same however often it is redrawn. */
export function noise(x: number, y: number, i: number, k = 0): number {
  let h = (Math.imul(x + 31, 374761393) + Math.imul(y + 17, 668265263) + Math.imul(i + 3, 2246822519) + Math.imul(k + 1, 3266489917)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Several primitives as one geometry, so a whole tree is one instance. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(
    parts.map((g) => (g.index ? g.toNonIndexed() : g)),
    false,
  )!;
}

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** A conifer: a trunk under three skirts of needles. */
const PINE_TRUNK = new THREE.CylinderGeometry(0.02, 0.034, 0.24, 5).translate(0, 0.12, 0);
const PINE_TOP = merge([
  new THREE.ConeGeometry(0.175, 0.25, 7).translate(0, 0.31, 0),
  new THREE.ConeGeometry(0.14, 0.22, 7).translate(0, 0.44, 0),
  new THREE.ConeGeometry(0.095, 0.2, 7).translate(0, 0.57, 0),
]);
/** A broadleaf tree: a trunk under a crown of four lumps. */
const LEAF_TRUNK = new THREE.CylinderGeometry(0.024, 0.038, 0.28, 5).translate(0, 0.14, 0);
const LEAF_TOP = merge([
  new THREE.IcosahedronGeometry(0.165, 1).scale(1, 0.85, 1).translate(0, 0.37, 0),
  new THREE.IcosahedronGeometry(0.125, 1).scale(1, 0.85, 1).translate(0.105, 0.31, 0.06),
  new THREE.IcosahedronGeometry(0.12, 1).scale(1, 0.85, 1).translate(-0.095, 0.32, -0.05),
  new THREE.IcosahedronGeometry(0.105, 1).scale(1, 0.85, 1).translate(0.02, 0.47, -0.04),
]);

const ROCK = new THREE.DodecahedronGeometry(0.16, 0).translate(0, 0.07, 0);
const BOULDER = new THREE.IcosahedronGeometry(0.21, 0).scale(1, 0.62, 0.85).translate(0, 0.1, 0);
const PEBBLE = new THREE.DodecahedronGeometry(0.045, 0).translate(0, 0.02, 0);

/** A tuft of three blades, splayed outwards. */
const TUFT = merge(
  [0, 1, 2].map((i) => new THREE.ConeGeometry(0.015, 0.08, 3).translate(0, 0.04, 0).rotateX(0.4).rotateY((i / 3) * Math.PI * 2)),
);
const BLOSSOM = new THREE.OctahedronGeometry(0.018, 0).scale(1, 0.7, 1).translate(0, 0.045, 0);

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** One clock for everything that moves in the wind or on the water; it runs on from board to board. */
const time = { value: 0 };

/**
 * Makes a plant lean to and fro in the wind: the further up the model a
 * vertex is, the further it moves. Each instance sways to its own phase,
 * taken from where it stands.
 */
function sway(material: THREE.MeshStandardMaterial, amount: number): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uSway = { value: amount };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uSway;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 iPos = vec3(0.0);
        #endif
        float bend = sin(uTime * 1.3 + iPos.x * 1.7 + iPos.z * 1.3) + 0.5 * sin(uTime * 2.1 + iPos.z * 2.3 + iPos.x * 0.7);
        transformed.xz += bend * uSway * max(transformed.y, 0.0);`,
      );
  };
  // Two materials that differ only in how far they sway must not share a program.
  material.customProgramCacheKey = () => `sway-${amount}`;
  return material;
}

const BARK = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
const PINE = sway(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), 0.035);
const LEAF = sway(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }), 0.05);
const STONE = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
const GRASS = sway(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), 0.06);
const FLOWER = sway(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, flatShading: true }), 0.06);

const DECK = new THREE.MeshStandardMaterial({ color: 0x9a6a35, roughness: 0.8 });
const DECK_DARK = new THREE.MeshStandardMaterial({ color: 0x6f4820, roughness: 0.9 });
const MASON = new THREE.MeshStandardMaterial({ color: 0x8a8272, roughness: 0.95, flatShading: true });
const LAMP = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc24d, emissiveIntensity: 1.5, roughness: 0.3 });

const GREENS = [0x2f8f46, 0x3a9a4e, 0x277a3c, 0x1f6e38];
const LEAFY = [0x4fae4a, 0x5fb84f, 0x3f9a44, 0x74b845];
const BARKS = [0x5b3a1e, 0x6b4423, 0x4e321a];
const STONES = [0x8a8272, 0x9a9282, 0x76705f];
const GRASSES = [0x5fa860, 0x6fb566, 0x4f9a52, 0x86bf5e];
const FLOWERS = [0xf1f5f9, 0xfde68a, 0xf9a8d4, 0x93c5fd];

/** One of `list`, chosen by the same noise that scatters things: the same tile always gets the same shade. */
function pick<T>(list: readonly T[], x: number, y: number, i: number, k = 0): T {
  return list[Math.floor(noise(x, y, i, k) * list.length) % list.length];
}

// ---------------------------------------------------------------------------
// Placing things
// ---------------------------------------------------------------------------

interface Spot {
  x: number;
  z: number;
  rot: number;
  scale: number;
  color: number;
}

/** Everything of one kind, drawn in a single go whatever there is of it. */
function instanced(geo: THREE.BufferGeometry, material: THREE.Material, spots: Spot[], shadows: boolean): THREE.InstancedMesh | null {
  if (!spots.length) return null;
  const mesh = new THREE.InstancedMesh(geo, material, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  spots.forEach((spot, i) => {
    q.setFromAxisAngle(UP, spot.rot);
    mesh.setMatrixAt(i, m.compose(p.set(spot.x, 0, spot.z), q, s.setScalar(spot.scale)));
    mesh.setColorAt(i, c.setHex(spot.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  return mesh;
}

function tilesOf(s: GameState, kinds: string[]): Pt[] {
  const out: Pt[] = [];
  for (let y = 0; y < s.boardSize; y++) for (let x = 0; x < s.boardSize; x++) if (kinds.includes(terrainAt(s, x, y))) out.push({ x, y });
  return out;
}

/**
 * Spread `count` things round the edge of a tile, leaving the middle for whoever stands there.
 * Nothing is left standing in the water that rounds off into the corners of dry tiles beside a river.
 */
function around(n: number, water: WaterShape, t: Pt, count: number, r0: number, r1: number): Array<{ x: number; z: number; a: number; k: number }> {
  const half = (n - 1) / 2;
  const at = worldOf(t.x, t.y, n);
  const out: Array<{ x: number; z: number; a: number; k: number }> = [];
  for (let k = 0; k < count; k++) {
    const a = noise(t.x, t.y, k) * Math.PI * 2 + k * 2.4;
    const r = r0 + noise(t.x, t.y, k, 1) * (r1 - r0);
    const x = at.x + Math.cos(a) * r;
    const z = at.z + Math.sin(a) * r;
    if (water.at(x + half, half - z)) continue;
    out.push({ x, z, a, k });
  }
  return out;
}

/** Tiles the players have laid out for themselves: base zones' lanes and depot, muster points, and the lanes out to the resource nodes. Nothing grows there. */
function paved(s: GameState): Set<string> {
  const out = new Set<string>();
  for (const p of s.players) {
    const c = s.corners[p.corner];
    const size = zoneSize(p);
    for (let v = 0; v < size; v++) {
      for (let u = 0; u < size; u++) {
        if (isReservedLocal(u, v) || isMusterLocal(u, v)) {
          const q = toWorld(c, u, v);
          out.add(`${q.x},${q.y}`);
        }
      }
    }
    for (const node of s.nodes.filter((nd) => nd.corner === p.corner)) {
      for (const l of laneTiles(toLocal(c, node.x, node.y))) {
        const q = toWorld(c, l.x, l.y);
        out.add(`${q.x},${q.y}`);
      }
    }
  }
  return out;
}

function woods(n: number, water: WaterShape, s: GameState): Record<'pine' | 'leaf', Spot[]> {
  const pine: Spot[] = [];
  const leaf: Spot[] = [];
  for (const t of tilesOf(s, ['forest'])) {
    const count = 3 + Math.floor(noise(t.x, t.y, 9) * 2);
    for (const o of around(n, water, t, count, 0.28, 0.43)) {
      const spot: Spot = { x: o.x, z: o.z, rot: noise(t.x, t.y, o.k, 3) * Math.PI * 2, scale: 0.85 + noise(t.x, t.y, o.k, 2) * 0.6, color: 0 };
      if (noise(t.x, t.y, o.k, 4) < 0.55) {
        spot.color = pick(GREENS, t.x, t.y, o.k, 5);
        pine.push(spot);
      } else {
        spot.color = pick(LEAFY, t.x, t.y, o.k, 5);
        leaf.push(spot);
      }
    }
  }
  return { pine, leaf };
}

/** The same trees again as bare trunks: each in its own shade of bark. */
function trunks(spots: Spot[], seed: number): Spot[] {
  return spots.map((spot, i) => ({ ...spot, color: pick(BARKS, Math.round(spot.x * 10), Math.round(spot.z * 10), i, seed) }));
}

// ---------------------------------------------------------------------------
// Bridges and water
// ---------------------------------------------------------------------------

const PLANK = new THREE.BoxGeometry(0.112, 0.035, 0.6);
const STRINGER = new THREE.BoxGeometry(0.98, 0.04, 0.05);
const ABUTMENT = new THREE.BoxGeometry(0.14, 0.07, 0.72);
const PIER = new THREE.CylinderGeometry(0.05, 0.065, 0.14, 8);
const POST = new THREE.BoxGeometry(0.05, 0.13, 0.05);
const RAIL = new THREE.BoxGeometry(0.98, 0.04, 0.04);
const LAMP_POST = new THREE.CylinderGeometry(0.011, 0.011, 0.17, 6);
const LAMP_BULB = new THREE.SphereGeometry(0.03, 8, 6);

/** One bridge, laid across the waterway on stone, with a rail and a lamp at each corner. */
function bridge(s: GameState, at: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  // The deck runs across the channel, i.e. at right angles to it.
  g.rotation.y = s.waterway === 'vertical' ? 0 : Math.PI / 2;
  g.position.copy(at);
  const put = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, shadow = true): void => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    g.add(m);
  };
  // Planks over two stringers, stone under each end and a pier in the water at each corner.
  for (let i = 0; i < 8; i++) put(PLANK, DECK, -0.392 + i * 0.112, 0.043, 0);
  for (const z of [-0.2, 0.2]) put(STRINGER, DECK_DARK, 0, 0.014, z);
  for (const x of [-0.45, 0.45]) put(ABUTMENT, MASON, x, 0.02, 0);
  for (const x of [-0.24, 0.24]) for (const z of [-0.33, 0.33]) put(PIER, MASON, x, 0.0, z);
  // A rail on either side, and a lamp on a taller post at each corner.
  for (const z of [-0.27, 0.27]) {
    put(RAIL, DECK_DARK, 0, 0.15, z);
    put(RAIL, DECK_DARK, 0, 0.1, z);
    for (const x of [-0.16, 0, 0.16]) put(POST, DECK_DARK, x, 0.105, z);
  }
  for (const x of [-0.44, 0.44]) {
    for (const z of [-0.27, 0.27]) {
      put(LAMP_POST, DECK_DARK, x, 0.14, z);
      put(LAMP_BULB, LAMP, x, 0.235, z, false);
    }
  }
  // Nothing on a bridge moves: all its timbers, all its stone and all its lamps go together.
  bake(g, false);
  return g;
}

/**
 * One sheet over the whole of the water, in the smooth shape of `water.ts`:
 * every piece of that shape fanned out from its hub. Each point carries how
 * far it lies from the nearest bank, which is what puts the foam along the
 * banks, and whether its water is a river on the move or a lake at rest.
 */
function waterSheet(s: GameState): { geo: THREE.BufferGeometry; river: boolean } | null {
  const { pieces, river } = new WaterShape(s);
  const n = s.boardSize;
  const half = (n - 1) / 2;
  const position: number[] = [];
  const depth: number[] = [];
  const flow: number[] = [];
  const index: number[] = [];
  for (const piece of pieces) {
    const first = position.length / 3;
    // The board's y runs the other way round from the world's z.
    const put = ([x, y, d]: WaterPoint): void => {
      position.push(x - half - 0.5, 0.012, half + 0.5 - y);
      depth.push(d);
      flow.push(piece.flow);
    };
    put(piece.hub);
    piece.outline.forEach(put);
    for (let i = 0; i < piece.outline.length; i++) index.push(first, first + 1 + i, first + 1 + ((i + 1) % piece.outline.length));
  }
  if (!position.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 1));
  geo.setIndex(index);
  return { geo, river };
}

const WATER_VERT = /* glsl */ `
  attribute float aDepth;
  attribute float aFlow;
  varying vec3 vWorld;
  varying float vDepth;
  varying float vFlow;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vDepth = aDepth;
    vFlow = aFlow;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform vec3 uSky;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec2 uFlow;
  varying vec3 vWorld;
  varying float vDepth;
  varying float vFlow;
  #include <fog_pars_fragment>

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  /** How high the surface is at a point and a moment. */
  float height(vec2 p, float t) {
    vec2 q = p * 3.1;
    float h = sin(dot(q, vec2(0.8, 0.6)) + t * 1.7) * 0.5;
    h += sin(dot(q, vec2(-0.5, 0.9)) - t * 1.3) * 0.35;
    h += noise(q * 1.7 + uFlow * t * 0.6 * vFlow) * 0.8;
    h += noise(q * 3.3 - uFlow * t * 0.9 * vFlow) * 0.4;
    return h;
  }

  void main() {
    vec2 p = vWorld.xz;
    float t = uTime;
    // The surface's slope, found by stepping a hair either way: that is what catches the light.
    float e = 0.035;
    float slope = 0.05;
    float h = height(p, t);
    vec3 N = normalize(vec3((h - height(p + vec2(e, 0.0), t)) / e * slope, 1.0, (h - height(p + vec2(0.0, e), t)) / e * slope));
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uSun);
    float lit = max(dot(N, L), 0.0);
    // Water seen from the side mirrors the sky; seen from above it shows its own depth.
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 H = normalize(L + V);
    float glint = pow(max(dot(N, H), 0.0), 180.0) * 2.0 + pow(max(dot(N, H), 0.0), 24.0) * 0.12;
    float sparkle = step(0.992, noise(p * 9.0 + uFlow * t * 1.5 * vFlow)) * smoothstep(0.3, 1.0, lit);

    vec3 col = mix(uDeep, uShallow, 0.3 + 0.7 * lit);
    col = mix(col, uSky, fresnel * 0.75);
    col += uSunColor * (glint + sparkle * 0.7);

    // How far this point is from the nearest bank, in tiles.
    float d = vDepth;
    // Foam in a broken band along the banks, and a fleck out in the stream now and then.
    float lace = noise(p * 7.0 - uFlow * t * 0.8 * vFlow);
    float fleck = noise(p * 13.0 + uFlow * t * 0.5);
    float foam = (1.0 - smoothstep(0.03, 0.2 + lace * 0.12, d)) * (0.5 + 0.5 * fleck);
    foam += smoothstep(0.86, 0.94, lace * fleck * 1.6) * 0.2 * vFlow;
    col = mix(col, vec3(0.93, 0.96, 1.0), clamp(foam, 0.0, 1.0) * 0.85);

    float alpha = clamp(mix(0.6, 0.9, fresnel) + foam * 0.3, 0.0, 0.95);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// ---------------------------------------------------------------------------
// The whole lot
// ---------------------------------------------------------------------------

/** Woods, rocks, grass, bridges and water for one map. */
export class TerrainDecor {
  readonly group = new THREE.Group();
  /** What belongs to this map alone, to be let go of with it. */
  private owned: Array<{ dispose(): void }> = [];
  private water: THREE.ShaderMaterial | null = null;

  /** `sun` points from the ground towards the sun. */
  constructor(s: GameState, sun: THREE.Vector3) {
    const n = s.boardSize;
    const keep = (mesh: THREE.InstancedMesh | null): void => {
      if (!mesh) return;
      this.owned.push(mesh);
      this.group.add(mesh);
    };
    // Woods: each tree is one instance of its kind, its crown another of the kind above it.
    // The water's shape, worked out once: the scenery keeps out of it, and the sheet of water is cut to it.
    const water = new WaterShape(s);
    const forest = woods(n, water, s);
    keep(instanced(PINE_TRUNK, BARK, trunks(forest.pine, 11), true));
    keep(instanced(PINE_TOP, PINE, forest.pine, true));
    keep(instanced(LEAF_TRUNK, BARK, trunks(forest.leaf, 12), true));
    keep(instanced(LEAF_TOP, LEAF, forest.leaf, true));

    // Hills: loose stones, a boulder now and then, pebbles between them.
    const stones: Spot[] = [];
    const boulders: Spot[] = [];
    const pebbles: Spot[] = [];
    for (const t of tilesOf(s, ['hill'])) {
      const at = worldOf(t.x, t.y, n);
      for (const o of around(n, water, t, 2 + Math.floor(noise(t.x, t.y, 7) * 2), 0.22, 0.4)) {
        const sc = 0.7 + noise(t.x, t.y, o.k, 7) * 0.9;
        stones.push({ x: o.x, z: o.z, rot: noise(t.x, t.y, o.k, 8) * Math.PI, scale: sc, color: pick(STONES, t.x, t.y, o.k, 10) });
      }
      if (noise(t.x, t.y, 0, 40) < 0.45) {
        const a = noise(t.x, t.y, 1, 41) * Math.PI * 2;
        boulders.push({ x: at.x + Math.cos(a) * 0.2, z: at.z + Math.sin(a) * 0.2, rot: a, scale: 0.7 + noise(t.x, t.y, 2, 42) * 0.7, color: pick(STONES, t.x, t.y, 3, 43) });
      }
      for (const o of around(n, water, t, 4, 0.2, 0.43)) pebbles.push({ x: o.x, z: o.z, rot: o.a, scale: 0.6 + noise(t.x, t.y, o.k, 11) * 0.8, color: pick(STONES, t.x, t.y, o.k, 12) });
    }
    keep(instanced(ROCK, STONE, stones, true));
    keep(instanced(BOULDER, STONE, boulders, true));
    keep(instanced(PEBBLE, STONE, pebbles, false));

    // Grass and the odd flower on open ground the players have not paved.
    const laid = paved(s);
    const tufts: Spot[] = [];
    const blooms: Spot[] = [];
    for (const t of tilesOf(s, ['plain'])) {
      if (laid.has(`${t.x},${t.y}`) || s.nodes.some((nd) => nd.x === t.x && nd.y === t.y)) continue;
      const count = Math.floor(noise(t.x, t.y, 0, 50) * 4);
      for (const o of around(n, water, t, count, 0.28, 0.46)) {
        tufts.push({ x: o.x, z: o.z, rot: o.a, scale: 0.7 + noise(t.x, t.y, o.k, 51) * 0.9, color: pick(GRASSES, t.x, t.y, o.k, 52) });
      }
      const buds = noise(t.x, t.y, 0, 53) < 0.3 ? 1 + Math.floor(noise(t.x, t.y, 1, 54) * 2) : 0;
      for (const o of around(n, water, t, buds, 0.3, 0.44)) blooms.push({ x: o.x, z: o.z, rot: o.a, scale: 0.8 + noise(t.x, t.y, o.k, 55) * 0.6, color: pick(FLOWERS, t.x, t.y, o.k, 56) });
    }
    keep(instanced(TUFT, GRASS, tufts, false));
    keep(instanced(BLOSSOM, FLOWER, blooms, false));

    for (const t of tilesOf(s, ['bridge'])) this.group.add(bridge(s, worldOf(t.x, t.y, n)));

    // The water: one sheet, with the sun and the sky to show in it.
    const sheet = waterSheet(s);
    if (sheet) {
      this.water = new THREE.ShaderMaterial({
        vertexShader: WATER_VERT,
        fragmentShader: WATER_FRAG,
        uniforms: {
          uTime: time,
          uSun: { value: sun.clone().normalize() },
          uSunColor: { value: new THREE.Color(0xfff1d6).multiplyScalar(1.7) },
          uSky: { value: new THREE.Color(0x9fc4e8) },
          uDeep: { value: new THREE.Color(0x0b2648) },
          uShallow: { value: new THREE.Color(0x1b5a9e) },
          // A river runs along the board's axis; a lake only stirs.
          uFlow: { value: s.waterway === 'vertical' ? new THREE.Vector2(0, 1) : new THREE.Vector2(1, 0) },
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
      });
      const water = new THREE.Mesh(sheet.geo, this.water);
      water.renderOrder = 1;
      this.group.add(water);
      this.owned.push(sheet.geo, this.water);
    }
  }

  /** Let go of this map's share of the graphics card's memory. */
  dispose(): void {
    for (const it of this.owned) it.dispose();
    this.owned = [];
    // The bridges were baked, so their timbers are geometries of this map's own.
    for (const child of this.group.children) scrap(child);
  }

  /** The wind and the water move on. */
  tick(dt: number): void {
    time.value += dt;
  }
}
