import * as THREE from 'three';
import type { AlienKey, BuildingKey, ResourceKey, UnitKey } from '../game/types';

export interface Model {
  group: THREE.Group;
  /** Turret heads that swing towards whatever is being shot at. */
  heads: THREE.Group[];
  /** Rough top of the model; the health bar floats above it. */
  height: number;
  /** Height of the solid body a click should hit. Falls back to `height`; thin masts and cranes above it stay unclickable. */
  hitH?: number;
  /** Parts that turn by themselves just for show, such as a radar dish. */
  spin?: THREE.Object3D[];
}

export interface TruckModel {
  group: THREE.Group;
  cargo: THREE.Mesh;
}

// Models are built from primitives; geometry and materials are shared so a
// hundred units cost no more than a handful of draw setups.
const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.MeshStandardMaterial>();

interface MatOpts {
  rough?: number;
  metal?: number;
  emissive?: number;
  glow?: number;
  opacity?: number;
}

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

const box = (w: number, h: number, d: number): THREE.BufferGeometry => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt: number, rb: number, h: number, seg = 12): THREE.BufferGeometry =>
  cached(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const sph = (r: number, seg = 12): THREE.BufferGeometry => cached(`s${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, Math.floor(seg / 2))));
const cap = (r: number, l: number): THREE.BufferGeometry => cached(`p${r},${l}`, () => new THREE.CapsuleGeometry(r, l, 4, 10));
const cone = (r: number, h: number, seg = 8): THREE.BufferGeometry => cached(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const octa = (r: number): THREE.BufferGeometry => cached(`o${r}`, () => new THREE.OctahedronGeometry(r));
const dodeca = (r: number): THREE.BufferGeometry => cached(`d${r}`, () => new THREE.DodecahedronGeometry(r));
const torus = (r: number, t: number): THREE.BufferGeometry => cached(`t${r},${t}`, () => new THREE.TorusGeometry(r, t, 6, 20));

function mat(color: number, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${o.rough ?? ''}|${o.metal ?? ''}|${o.emissive ?? ''}|${o.glow ?? ''}|${o.opacity ?? ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.75,
      metalness: o.metal ?? 0.05,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.glow ?? 1,
      transparent: o.opacity !== undefined,
      opacity: o.opacity ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}

const UP = new THREE.Vector3(0, 1, 0);

/** A rod from `a` to `b`: a leg, a mast, a stay. */
function limb(parent: THREE.Object3D, a: [number, number, number], b: [number, number, number], r: number, material: THREE.Material): THREE.Mesh {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const m = new THREE.Mesh(cyl(r, r * 1.2, Math.round(from.distanceTo(to) * 1000) / 1000, 6), material);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, to.sub(from).normalize());
  m.castShadow = true;
  parent.add(m);
  return m;
}

const tint = new THREE.Color();
/** Darker (<1) or lighter (>1) variant of a player colour. */
function shade(color: number, f: number): number {
  tint.setHex(color);
  if (f <= 1) tint.multiplyScalar(f);
  else tint.lerp(new THREE.Color(0xffffff), f - 1);
  return tint.getHex();
}

type Rot = [number, number, number];

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, rot?: Rot): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const TREAD = 0x23272f;
const DARK = 0x1f2430;
const GUNMETAL = 0x4a5262;
const STEEL = 0x7b8598;
const HAZARD = 0xd9a441;

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

function soldier(color: number, kind: 'infantry' | 'sniper' | 'at'): Model {
  const g = new THREE.Group();
  const dark = shade(color, 0.5);
  add(g, cap(0.075, 0.18), mat(color), 0, 0.21, 0);
  add(g, sph(0.078), mat(dark), 0, 0.375, 0);
  add(g, box(0.17, 0.05, 0.12), mat(shade(color, 0.7)), 0, 0.27, -0.01); // pack
  if (kind === 'infantry') {
    add(g, box(0.025, 0.025, 0.26), mat(DARK), 0.07, 0.25, 0.1);
  } else if (kind === 'sniper') {
    add(g, box(0.022, 0.022, 0.46), mat(DARK), 0.07, 0.27, 0.17);
    add(g, box(0.032, 0.036, 0.07), mat(GUNMETAL, { metal: 0.6 }), 0.07, 0.3, 0.21);
    add(g, cyl(0.082, 0.092, 0.028, 10), mat(shade(color, 0.35)), 0, 0.432, 0); // beret
  } else {
    add(g, cyl(0.034, 0.034, 0.42, 8), mat(0x46512f), -0.085, 0.41, 0.06, [Math.PI / 2, 0, 0]);
    add(g, cyl(0.042, 0.042, 0.03, 8), mat(DARK), -0.085, 0.41, 0.27, [Math.PI / 2, 0, 0]);
  }
  return { group: g, heads: [], height: 0.47 };
}

function tankBody(color: number, w = 0.46, l = 0.6, h = 0.14): THREE.Group {
  const g = new THREE.Group();
  add(g, box(w, h, l), mat(color, { rough: 0.55, metal: 0.3 }), 0, 0.17, 0);
  add(g, box(0.1, 0.14, l + 0.03), mat(TREAD), -(w / 2 + 0.045), 0.09, 0);
  add(g, box(0.1, 0.14, l + 0.03), mat(TREAD), w / 2 + 0.045, 0.09, 0);
  add(g, box(w * 0.55, 0.025, l * 0.45), mat(shade(color, 0.65)), 0, 0.17 + h / 2 + 0.012, -0.08);
  return g;
}

function gun(len: number, r: number): THREE.Mesh {
  const m = new THREE.Mesh(cyl(r, r, len, 8), mat(GUNMETAL, { rough: 0.4, metal: 0.6 }));
  m.rotation.x = Math.PI / 2;
  m.position.set(0, 0.05, len / 2 + 0.1);
  m.castShadow = true;
  return m;
}

function turretHead(color: number, barrels: 0 | 1 | 2, len: number, r: number, dome = false, extras?: (h: THREE.Group) => void): THREE.Group {
  const h = new THREE.Group();
  if (dome) add(h, cyl(0.13, 0.17, 0.13, 14), mat(shade(color, 0.82), { rough: 0.45, metal: 0.3 }), 0, 0.05, 0);
  else add(h, box(0.27, 0.14, 0.31), mat(shade(color, 0.82), { rough: 0.5, metal: 0.3 }), 0, 0.05, -0.03);
  for (const o of barrels === 2 ? [-0.05, 0.05] : barrels === 1 ? [0] : []) {
    const b = gun(len, r);
    b.position.x = o;
    h.add(b);
  }
  extras?.(h);
  return h;
}

function fighter(color: number): Model {
  const g = new THREE.Group();
  const skin = mat(color, { rough: 0.4, metal: 0.4 });
  add(g, cap(0.065, 0.34), skin, 0, 0, 0, [Math.PI / 2, 0, 0]);
  add(g, cone(0.065, 0.16, 8), mat(shade(color, 0.6)), 0, 0, 0.33, [Math.PI / 2, 0, 0]);
  add(g, box(0.32, 0.02, 0.17), mat(shade(color, 0.88)), -0.2, 0, -0.02, [0, -0.5, 0]);
  add(g, box(0.32, 0.02, 0.17), mat(shade(color, 0.88)), 0.2, 0, -0.02, [0, 0.5, 0]);
  add(g, box(0.26, 0.02, 0.1), skin, 0, 0, -0.2);
  add(g, box(0.02, 0.14, 0.12), mat(shade(color, 0.6)), 0, 0.08, -0.2);
  add(g, sph(0.05), mat(0xd6efff, { emissive: 0x38bdf8, glow: 0.6, rough: 0.1 }), 0, 0.055, 0.1).scale.set(1, 0.75, 1.9);
  const engine = mat(0xffb27a, { emissive: 0xf97316, glow: 1.6 });
  add(g, cyl(0.028, 0.028, 0.05, 8), engine, -0.03, 0, -0.2, [Math.PI / 2, 0, 0]);
  add(g, cyl(0.028, 0.028, 0.05, 8), engine, 0.03, 0, -0.2, [Math.PI / 2, 0, 0]);
  return { group: g, heads: [], height: 0.16 };
}

export function buildUnit(key: UnitKey, color: number): Model {
  switch (key) {
    case 'truck':
      return { group: buildTruck(color).group, heads: [], height: 0.3 };
    case 'infantry':
      return soldier(color, 'infantry');
    case 'sniper':
      return soldier(color, 'sniper');
    case 'atSoldier':
      return soldier(color, 'at');
    case 'tank': {
      const g = tankBody(color);
      const h = turretHead(color, 1, 0.4, 0.022);
      h.position.y = 0.27;
      g.add(h);
      return { group: g, heads: [h], height: 0.42 };
    }
    case 'twinTank': {
      const g = tankBody(color, 0.5, 0.62);
      const h = turretHead(color, 2, 0.46, 0.02);
      h.position.y = 0.27;
      g.add(h);
      return { group: g, heads: [h], height: 0.42 };
    }
    case 'aaTank': {
      const g = tankBody(color, 0.48, 0.58);
      const h = new THREE.Group();
      add(h, box(0.3, 0.07, 0.3), mat(shade(color, 0.82), { metal: 0.3 }), 0, 0.03, 0);
      for (const o of [-0.055, 0.055]) add(h, cyl(0.02, 0.02, 0.46, 8), mat(GUNMETAL, { metal: 0.6, rough: 0.4 }), o, 0.2, 0.18, [Math.PI / 2 - 0.75, 0, 0]);
      add(h, box(0.17, 0.13, 0.02), mat(GUNMETAL, { metal: 0.5 }), 0, 0.15, -0.14, [-0.3, 0, 0]);
      h.position.y = 0.25;
      g.add(h);
      return { group: g, heads: [h], height: 0.44 };
    }
    case 'missileTank': {
      const g = tankBody(color, 0.5, 0.6, 0.16);
      const h = new THREE.Group();
      add(h, box(0.29, 0.13, 0.36), mat(shade(color, 0.82), { metal: 0.3 }), 0, 0.07, -0.03);
      for (const o of [-0.068, 0.068]) {
        add(h, cyl(0.036, 0.036, 0.3, 8), mat(0xe5e7eb, { rough: 0.4 }), o, 0.08, 0.2, [Math.PI / 2 - 0.18, 0, 0]);
        add(h, cone(0.036, 0.08, 8), mat(0xef4444), o, 0.135, 0.387, [Math.PI / 2 - 0.18, 0, 0]);
      }
      h.position.y = 0.27;
      g.add(h);
      return { group: g, heads: [h], height: 0.44 };
    }
    case 'laserTank': {
      const g = tankBody(color);
      const h = turretHead(color, 0, 0, 0, true, (head) => {
        add(head, torus(0.085, 0.012), mat(GUNMETAL, { metal: 0.6 }), 0, 0.09, 0.1);
        add(head, torus(0.065, 0.012), mat(GUNMETAL, { metal: 0.6 }), 0, 0.09, 0.18);
        add(head, octa(0.075), mat(0x67e8f9, { emissive: 0x06b6d4, glow: 1.3, rough: 0.2 }), 0, 0.09, 0.28);
      });
      h.position.y = 0.27;
      g.add(h);
      return { group: g, heads: [h], height: 0.46 };
    }
    case 'apocalypse': {
      const g = tankBody(shade(color, 0.75), 0.62, 0.78, 0.2);
      add(g, box(0.68, 0.06, 0.26), mat(shade(color, 0.5)), 0, 0.31, -0.3);
      add(g, box(0.68, 0.06, 0.1), mat(HAZARD), 0, 0.285, 0.4);
      const front = turretHead(color, 1, 0.56, 0.03);
      front.position.set(0, 0.35, 0.14);
      const rear = turretHead(color, 1, 0.46, 0.028);
      rear.position.set(0, 0.52, -0.17);
      g.add(front, rear);
      return { group: g, heads: [front, rear], height: 0.64 };
    }
    case 'fighter':
      return fighter(color);
  }
}

export function buildTruck(color: number): TruckModel {
  const g = new THREE.Group();
  add(g, box(0.2, 0.13, 0.18), mat(color), 0, 0.19, 0.2);
  add(g, box(0.18, 0.06, 0.03), mat(0xa9c6dc, { rough: 0.15, metal: 0.3 }), 0, 0.215, 0.292);
  const bed = mat(shade(color, 0.55));
  add(g, box(0.24, 0.04, 0.32), bed, 0, 0.135, -0.06);
  add(g, box(0.02, 0.07, 0.32), bed, -0.11, 0.19, -0.06);
  add(g, box(0.02, 0.07, 0.32), bed, 0.11, 0.19, -0.06);
  for (const x of [-0.125, 0.125]) for (const z of [0.2, -0.04, -0.17]) add(g, cyl(0.045, 0.045, 0.035, 10), mat(TREAD), x, 0.045, z, [0, 0, Math.PI / 2]);
  const cargo = add(g, box(0.19, 0.09, 0.27), mat(0x9ca3af), 0, 0.2, -0.06);
  cargo.visible = false;
  return { group: g, cargo };
}

const CARGO_COLORS: Record<ResourceKey, number> = { ore: 0xd6d3d1, oil: 0x1f2937, meat: 0xfb7185 };
/** What a truck shows on its flatbed once it has loaded up. */
export function cargoMaterial(res: ResourceKey): THREE.Material {
  return mat(CARGO_COLORS[res], { rough: 0.6, metal: res === 'ore' ? 0.5 : 0.05 });
}

// ---------------------------------------------------------------------------
// Buildings. Model +Z faces the battlefield.
// ---------------------------------------------------------------------------

function slab(g: THREE.Group, w: number, d: number, color = 0x4b5563): void {
  add(g, box(w, 0.06, d), mat(color, { rough: 0.9 }), 0, 0.03, 0);
}

function flag(g: THREE.Group, color: number, x: number, y: number, z: number): void {
  add(g, cyl(0.012, 0.012, 0.8, 6), mat(STEEL, { metal: 0.6 }), x, y + 0.4, z);
  add(g, box(0.26, 0.16, 0.012), mat(color, { rough: 0.6 }), x + 0.14, y + 0.7, z);
}

function glow(color: number, intensity = 1.2): THREE.MeshStandardMaterial {
  return mat(color, { emissive: color, glow: intensity, rough: 0.3 });
}

/**
 * The base once upgraded: a keep with gold inlay, a tower under a dome, four
 * corner turrets with lights, and a radar dish that never stops turning.
 */
function grandBase(color: number): Model {
  const g = new THREE.Group();
  const gold = mat(0xf2c14e, { metal: 0.8, rough: 0.3 });
  const steel = mat(0xdfe6f2, { metal: 0.35, rough: 0.4 });
  const domeMat = mat(shade(color, 1.15), { rough: 0.3, metal: 0.25 });
  const dome = (r: number): THREE.BufferGeometry => cached(`h${r}`, () => new THREE.SphereGeometry(r, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2));
  slab(g, 1.9, 1.9, 0x4a5262);
  // A gold line inlaid round the plinth.
  for (const [w, d, x, z] of [
    [1.86, 0.05, 0, 0.9],
    [1.86, 0.05, 0, -0.9],
    [0.05, 1.86, 0.9, 0],
    [0.05, 1.86, -0.9, 0],
  ]) {
    add(g, box(w, 0.014, d), gold, x, 0.067, z);
  }
  // The keep, with a gold cornice and an emblem over the gate.
  add(g, box(1.2, 0.56, 1.2), steel, 0, 0.34, 0);
  add(g, box(1.26, 0.08, 1.26), mat(color, { rough: 0.5 }), 0, 0.3, 0);
  add(g, box(1.24, 0.03, 1.24), gold, 0, 0.635, 0);
  add(g, box(0.56, 0.34, 0.03), mat(DARK), 0, 0.24, 0.615);
  add(g, octa(0.1), glow(0xf2c14e, 0.9), 0, 0.51, 0.63).scale.set(1, 1, 0.3);
  // The tower and its dome.
  add(g, cyl(0.36, 0.42, 0.62, 8), steel, 0, 0.95, 0);
  add(g, cyl(0.4, 0.4, 0.04, 8), gold, 0, 0.78, 0);
  add(g, dome(0.37), domeMat, 0, 1.26, 0);
  add(g, torus(0.37, 0.02), gold, 0, 1.265, 0, [Math.PI / 2, 0, 0]);
  add(g, sph(0.05, 8), glow(color, 1.6), 0, 1.66, 0);
  // Four corner turrets, each with a light on top.
  for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
    add(g, cyl(0.15, 0.17, 0.5, 8), steel, x, 0.31, z);
    add(g, cyl(0.17, 0.17, 0.03, 8), gold, x, 0.575, z);
    add(g, dome(0.16), domeMat, x, 0.59, z);
    add(g, sph(0.045, 8), glow(color), x, 0.75, z);
  }
  // A mast with a warning light, and the radar that turns on the dome.
  add(g, cyl(0.012, 0.012, 0.44, 6), mat(STEEL, { metal: 0.6 }), 0.16, 1.6, -0.14);
  add(g, sph(0.04, 8), glow(0xff5a5a, 1.8), 0.16, 1.84, -0.14);
  const radar = new THREE.Group();
  add(radar, cyl(0.02, 0.026, 0.2, 6), mat(GUNMETAL), 0, 0.1, 0);
  add(radar, box(0.36, 0.17, 0.03), mat(0xdfe6f2, { metal: 0.4 }), 0, 0.29, 0, [0.5, 0, 0]);
  add(radar, sph(0.02, 6), glow(0x7dd3fc, 1.6), 0, 0.36, 0.07);
  radar.position.set(-0.2, 1.46, 0.18);
  g.add(radar);
  flag(g, color, -0.6, 0.06, -0.6);
  flag(g, color, 0.6, 0.06, -0.6);
  return { group: g, heads: [], height: 1.95, hitH: 1.65, spin: [radar] };
}

export function buildBuilding(key: BuildingKey, level: 1 | 2, color: number): Model | null {
  switch (key) {
    case 'hq': {
      if (level === 2) return grandBase(color);
      const g = new THREE.Group();
      slab(g, 1.9, 1.9, 0x39404d);
      add(g, box(1.2, 0.5, 1.2), mat(STEEL, { metal: 0.25, rough: 0.55 }), 0, 0.31, 0);
      add(g, box(1.24, 0.07, 1.24), mat(color, { rough: 0.5 }), 0, 0.3, 0);
      add(g, new THREE.SphereGeometry(0.42, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), mat(shade(color, 1.15), { rough: 0.35, metal: 0.2 }), 0, 0.56, 0);
      for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
        add(g, box(0.15, 0.34, 0.15), mat(GUNMETAL), x, 0.2, z);
        add(g, sph(0.045, 8), glow(color), x, 0.4, z);
      }
      add(g, cyl(0.012, 0.012, 0.7, 6), mat(STEEL, { metal: 0.6 }), 0.45, 0.36 + 0.35, 0.45);
      add(g, sph(0.04, 8), glow(0xff5a5a, 1.6), 0.45, 1.07, 0.45);
      add(g, box(0.5, 0.3, 0.03), mat(DARK), 0, 0.2, 0.615);
      flag(g, color, -0.6, 0.06, -0.6);
      return { group: g, heads: [], height: 1.05, hitH: 1.0 };
    }
    case 'powerPlant': {
      const g = new THREE.Group();
      add(g, box(0.74, 0.26, 0.74), mat(0x64748b, { metal: 0.3 }), 0, 0.19, 0);
      add(g, box(0.78, 0.05, 0.78), mat(color, { rough: 0.5 }), 0, 0.2, 0);
      add(g, cyl(0.19, 0.26, 0.52, 14), mat(0xa3aebd, { rough: 0.8 }), -0.14, 0.58, 0);
      add(g, cyl(0.15, 0.19, 0.04, 14), mat(DARK), -0.14, 0.84, 0);
      add(g, cyl(0.11, 0.15, 0.36, 12), mat(0x8d99aa, { rough: 0.8 }), 0.21, 0.5, 0.19);
      add(g, box(0.055, 0.22, 0.03), glow(0xfacc15, 1.4), 0.2, 0.4, -0.375, [0, 0, 0.45]);
      add(g, box(0.16, 0.1, 0.2), mat(GUNMETAL), 0.23, 0.37, -0.22);
      return { group: g, heads: [], height: 0.9, hitH: 0.85 };
    }
    case 'factory': {
      const g = new THREE.Group();
      add(g, box(0.8, 0.3, 0.6), mat(0x8d8275, { rough: 0.8 }), 0, 0.21, 0);
      add(g, box(0.84, 0.05, 0.64), mat(0x6f665b), 0, 0.38, 0);
      add(g, box(0.84, 0.06, 0.62), mat(color, { rough: 0.5 }), 0, 0.14, 0);
      add(g, cyl(0.045, 0.062, 0.44, 10), mat(GUNMETAL), 0.3, 0.6, -0.2);
      add(g, cyl(0.05, 0.05, 0.03, 10), mat(0x9aa6b6, { emissive: 0x94a3b8, glow: 0.3 }), 0.3, 0.83, -0.2);
      add(g, box(0.24, 0.2, 0.02), mat(DARK), -0.14, 0.16, 0.305);
      add(g, box(0.16, 0.07, 0.3), mat(0xb8c2d0, { rough: 0.3, metal: 0.3 }), 0.24, 0.44, 0.1);
      return { group: g, heads: [], height: 0.9, hitH: 0.5 };
    }
    case 'barracks': {
      const g = new THREE.Group();
      add(g, box(1.76, 0.3, 0.62), mat(0x5f6b3c, { rough: 0.8 }), 0, 0.21, 0);
      add(g, box(1.8, 0.07, 0.66), mat(0x465030), 0, 0.39, 0);
      add(g, box(1.78, 0.06, 0.63), mat(color, { rough: 0.5 }), 0, 0.13, 0);
      for (const x of [-0.55, 0, 0.55]) add(g, box(0.17, 0.21, 0.02), mat(DARK), x, 0.165, 0.315);
      for (const x of [-0.8, 0.8]) add(g, box(0.12, 0.05, 0.06), glow(0xfde68a, 1.1), x, 0.33, 0.32);
      flag(g, color, 0.82, 0.06, -0.22);
      return { group: g, heads: [], height: 0.5, hitH: 0.5 };
    }
    case 'warFactory': {
      const g = new THREE.Group();
      add(g, box(1.76, 0.62, 1.5), mat(0x4a5261, { metal: 0.3, rough: 0.6 }), 0, 0.37, 0);
      add(g, box(1.8, 0.08, 1.54), mat(color, { rough: 0.5 }), 0, 0.6, 0);
      for (const x of [-0.55, 0, 0.55]) add(g, box(0.24, 0.08, 0.24), mat(GUNMETAL), x, 0.72, -0.4);
      add(g, box(0.9, 0.44, 0.03), mat(0x151a22), 0, 0.28, 0.755);
      for (let i = 0; i < 5; i++) add(g, box(0.9, 0.02, 0.035), mat(0x3a4150), 0, 0.1 + i * 0.09, 0.762);
      add(g, box(0.08, 0.56, 0.08), mat(HAZARD, { rough: 0.6 }), 0.74, 0.99, -0.62);
      add(g, box(0.56, 0.07, 0.08), mat(HAZARD, { rough: 0.6 }), 0.5, 1.24, -0.62);
      add(g, cyl(0.01, 0.01, 0.2, 6), mat(STEEL, { metal: 0.6 }), 0.24, 1.11, -0.62);
      return { group: g, heads: [], height: 1.3, hitH: 0.8 };
    }
    case 'airport': {
      const g = new THREE.Group();
      slab(g, 1.9, 1.9, 0x30363f);
      for (let i = 0; i < 6; i++) add(g, box(0.06, 0.012, 0.2), mat(0xe5e7eb, { rough: 0.8 }), -0.25, 0.066, -0.62 + i * 0.25);
      for (const z of [-0.78, 0.78]) add(g, box(1.0, 0.012, 0.04), mat(0xf59e0b, { rough: 0.8 }), -0.25, 0.066, z);
      add(g, box(0.62, 0.26, 0.5), mat(0x7c8494, { metal: 0.3 }), -0.6, 0.19, -0.6);
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.62, 14, 1, false, 0, Math.PI), mat(0x9aa3b2, { metal: 0.3, rough: 0.5 }));
      arch.rotation.z = Math.PI / 2;
      arch.position.set(-0.6, 0.32, -0.6);
      arch.castShadow = true;
      arch.receiveShadow = true;
      g.add(arch);
      add(g, cyl(0.07, 0.095, 0.5, 10), mat(0xa3aebd), 0.72, 0.31, -0.72);
      add(g, box(0.27, 0.15, 0.27), mat(color, { rough: 0.5 }), 0.72, 0.63, -0.72);
      add(g, box(0.29, 0.05, 0.29), glow(0x7dd3fc, 0.9), 0.72, 0.64, -0.72);
      add(g, cyl(0.01, 0.01, 0.3, 6), mat(STEEL, { metal: 0.6 }), 0.72, 0.85, -0.72);
      return { group: g, heads: [], height: 1.0, hitH: 0.45 };
    }
    case 'turret': {
      const heavy = level === 2;
      const g = new THREE.Group();
      add(g, cyl(0.27, 0.32, 0.1, 14), mat(GUNMETAL), 0, 0.05, 0);
      add(g, cyl(0.19, 0.22, 0.07, 14), mat(shade(color, 0.6), { metal: 0.3 }), 0, 0.13, 0);
      const h = turretHead(color, heavy ? 2 : 1, heavy ? 0.56 : 0.46, heavy ? 0.026 : 0.024, false, (head) => {
        if (heavy) add(head, box(0.2, 0.1, 0.12), mat(HAZARD), 0, 0.14, -0.2);
      });
      h.scale.setScalar(heavy ? 1.25 : 1);
      h.position.y = 0.2;
      g.add(h);
      add(g, box(0.74, 0.05, 0.74), mat(shade(color, 0.5), { rough: 0.9 }), 0, 0.025, 0);
      return { group: g, heads: [h], height: heavy ? 0.5 : 0.42 };
    }
    case 'aaGun': {
      const stinger = level === 2;
      const g = new THREE.Group();
      add(g, cyl(0.26, 0.31, 0.1, 14), mat(GUNMETAL), 0, 0.05, 0);
      add(g, box(0.74, 0.05, 0.74), mat(shade(color, 0.5), { rough: 0.9 }), 0, 0.025, 0);
      const h = new THREE.Group();
      if (stinger) {
        add(h, box(0.2, 0.14, 0.22), mat(shade(color, 0.7), { metal: 0.3 }), 0, 0.02, -0.04);
        add(h, box(0.3, 0.16, 0.3), mat(0x4b5545, { metal: 0.3 }), 0, 0.14, 0.1, [Math.PI / 2 - 0.5, 0, 0]);
        for (const [x, y] of [[-0.07, 0.19], [0.07, 0.19], [-0.07, 0.28], [0.07, 0.28]]) {
          add(h, cyl(0.032, 0.032, 0.34, 8), mat(0x3f4639), x, y, 0.16, [Math.PI / 2 - 0.5, 0, 0]);
        }
      } else {
        add(h, box(0.2, 0.12, 0.2), mat(shade(color, 0.7), { metal: 0.3 }), 0, 0.04, -0.02);
        for (const o of [-0.05, 0.05]) add(h, cyl(0.02, 0.02, 0.56, 8), mat(GUNMETAL, { metal: 0.6, rough: 0.4 }), o, 0.26, 0.13, [Math.PI / 2 - 1.0, 0, 0]);
        add(h, box(0.14, 0.1, 0.1), mat(DARK), 0, 0.03, -0.2);
      }
      h.position.y = 0.17;
      g.add(h);
      return { group: g, heads: [h], height: stinger ? 0.5 : 0.48 };
    }
    default:
      // The defense net is drawn as a force field by the view, not as a model.
      return null;
  }
}

// ---------------------------------------------------------------------------
// Resource nodes
// ---------------------------------------------------------------------------

const NODE_COLORS: Record<ResourceKey, number> = { ore: 0xfbbf24, oil: 0xf97316, meat: 0xfb7185 };

export function buildNode(res: ResourceKey): Model {
  const g = new THREE.Group();
  if (res === 'ore') {
    add(g, cyl(0.46, 0.46, 0.02, 20), mat(0x6b5a44, { rough: 1 }), 0, 0.01, 0);
    add(g, dodeca(0.2), mat(0x737d8f, { rough: 0.9 }), -0.13, 0.17, -0.08);
    add(g, dodeca(0.15), mat(0x818b9d, { rough: 0.9 }), 0.16, 0.13, 0.1);
    add(g, dodeca(0.12), mat(0x69738a, { rough: 0.9 }), 0.08, 0.1, -0.22);
    for (const [x, y, z] of [[-0.1, 0.3, 0.02], [0.2, 0.2, 0.16], [0.12, 0.17, -0.28], [-0.24, 0.14, -0.1]]) {
      add(g, octa(0.055), mat(NODE_COLORS.ore, { emissive: NODE_COLORS.ore, glow: 0.55, rough: 0.3, metal: 0.6 }), x, y, z);
    }
    add(g, box(0.3, 0.26, 0.05), mat(DARK), 0, 0.14, 0.42);
    for (const x of [-0.17, 0.17]) add(g, box(0.04, 0.3, 0.04), mat(0x8b5a2b), x, 0.15, 0.44);
    add(g, box(0.4, 0.04, 0.04), mat(0x8b5a2b), 0, 0.31, 0.44);
  } else if (res === 'oil') {
    add(g, cyl(0.45, 0.45, 0.03, 24), mat(0x12151c, { rough: 0.12, metal: 0.2 }), 0, 0.015, 0);
    add(g, cyl(0.27, 0.27, 0.012, 20), mat(0x1e2635, { rough: 0.05, metal: 0.3 }), 0.06, 0.035, 0.04);
    add(g, box(0.32, 0.06, 0.32), mat(GUNMETAL), 0, 0.05, 0);
    add(g, box(0.06, 0.5, 0.06), mat(0xea580c), 0, 0.31, 0);
    add(g, box(0.6, 0.05, 0.06), mat(0xf97316), 0, 0.57, 0, [0, 0, 0.28]);
    add(g, box(0.08, 0.17, 0.08), mat(0xea580c), 0.285, 0.49, 0);
    add(g, box(0.17, 0.12, 0.15), mat(GUNMETAL), -0.2, 0.62, 0);
    add(g, cyl(0.012, 0.012, 0.3, 6), mat(STEEL, { metal: 0.6 }), 0.285, 0.28, 0);
  } else {
    add(g, cyl(0.46, 0.46, 0.02, 20), mat(0x7fb24a, { rough: 1 }), 0, 0.01, 0);
    const wood = mat(0x8b5a2b);
    for (const [x, z] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38], [0, -0.38], [0, 0.38]]) add(g, box(0.03, 0.17, 0.03), wood, x, 0.085, z);
    for (const z of [-0.38, 0.38]) for (const y of [0.07, 0.13]) add(g, box(0.78, 0.02, 0.02), wood, 0, y, z);
    add(g, box(0.3, 0.2, 0.24), mat(0xb91c1c, { rough: 0.7 }), -0.12, 0.12, -0.13);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.32, 3), mat(0x6b1d1d));
    roof.rotation.z = Math.PI / 2;
    roof.position.set(-0.12, 0.3, -0.13);
    roof.castShadow = true;
    g.add(roof);
    // A cow.
    const cow = new THREE.Group();
    add(cow, box(0.2, 0.11, 0.12), mat(0xf8fafc), 0, 0.13, 0);
    add(cow, box(0.07, 0.115, 0.06), mat(0x1f2430), -0.03, 0.13, 0.01);
    add(cow, box(0.08, 0.08, 0.08), mat(0xf8fafc), 0.13, 0.16, 0);
    add(cow, box(0.03, 0.03, 0.03), mat(0xf1d3b5), 0.15, 0.19, 0.03);
    add(cow, box(0.03, 0.03, 0.03), mat(0xf1d3b5), 0.15, 0.19, -0.03);
    for (const [x, z] of [[-0.07, -0.04], [0.07, -0.04], [-0.07, 0.04], [0.07, 0.04]]) add(cow, box(0.025, 0.08, 0.025), mat(0xe7e5e4), x, 0.04, z);
    cow.position.set(0.17, 0.02, 0.14);
    cow.rotation.y = 0.7;
    g.add(cow);
  }
  return { group: g, heads: [], height: 0.5 };
}

// ---------------------------------------------------------------------------
// The aliens. Model +Z faces whatever they are about to attack.
// ---------------------------------------------------------------------------

/** 克洛伊: a big purple eye-thing on a crown of tentacles. */
function chloe(): Model {
  const g = new THREE.Group();
  const skin = mat(0x7c3aed, { emissive: 0x4c1d95, glow: 0.55, rough: 0.35 });
  add(g, sph(0.34, 18), skin, 0, 0.66, 0).scale.set(1, 1.2, 1);
  const eye = glow(0x4ade80, 1.8);
  add(g, sph(0.05, 8), eye, -0.12, 0.72, 0.28);
  add(g, sph(0.05, 8), eye, 0.12, 0.72, 0.28);
  add(g, sph(0.04, 8), eye, 0, 0.86, 0.27);
  add(g, sph(0.018, 6), mat(0x111827), -0.12, 0.72, 0.325);
  add(g, sph(0.018, 6), mat(0x111827), 0.12, 0.72, 0.325);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(g, cyl(0.018, 0.036, 0.44, 6), skin, Math.cos(a) * 0.2, 0.3, Math.sin(a) * 0.2, [Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45]);
  }
  add(g, torus(0.48, 0.014), glow(0xa78bfa, 1.5), 0, 0.06, 0, [Math.PI / 2, 0, 0]);
  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(0.56, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.13, depthWrite: false }),
  );
  aura.position.y = 0.62;
  g.add(aura);
  g.userData.aura = aura;
  return { group: g, heads: [], height: 1.15 };
}

/**
 * 奎德, the spider queen: eight two-jointed legs, a bloated abdomen with a
 * glowing mark, and four pairs of eyes. Scaled down it is one of her small spiders.
 */
function spider(scale: number): Model {
  const queen = scale > 0.5;
  const g = new THREE.Group();
  const chitin = mat(0x241631, { rough: 0.45, metal: 0.2 });
  const shell = mat(0x3b2150, { rough: 0.4, metal: 0.15, emissive: 0x1b0b26, glow: 0.6 });
  const mark = glow(0xe879f9, queen ? 1.5 : 0.9);
  // A small chest up front, a big abdomen behind it.
  add(g, sph(0.2), shell, 0, 0.3, 0.16).scale.set(1, 0.8, 1.1);
  add(g, sph(0.3), chitin, 0, 0.36, -0.24).scale.set(1, 0.85, 1.2);
  add(g, octa(0.1), mark, 0, 0.6, -0.24).scale.set(0.7, 0.18, 1.4);
  // The head, with its eyes and fangs.
  add(g, sph(0.12), chitin, 0, 0.26, 0.38);
  const eye = glow(0xff2d55, 2.2);
  for (const [x, y, z] of [[-0.035, 0.3, 0.49], [0.035, 0.3, 0.49], [-0.078, 0.27, 0.46], [0.078, 0.27, 0.46]]) add(g, sph(0.017, 6), eye, x, y, z);
  const fang = mat(0xeadfc8, { rough: 0.4 });
  add(g, cone(0.022, 0.09, 6), fang, -0.04, 0.2, 0.45, [Math.PI, 0, 0]);
  add(g, cone(0.022, 0.09, 6), fang, 0.04, 0.2, 0.45, [Math.PI, 0, 0]);
  // Eight legs in four pairs: up and out from the body, then down to the ground.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = 0.3 - i * 0.2;
      const lift = i === 1 || i === 2 ? 0.06 : 0;
      const hip: [number, number, number] = [side * 0.14, 0.32, z];
      const knee: [number, number, number] = [side * (0.4 + lift), 0.58 + lift, z + (1.5 - i) * 0.12];
      const foot: [number, number, number] = [side * (0.54 + lift), 0, z + (1.5 - i) * 0.2];
      limb(g, hip, knee, 0.022, chitin);
      limb(g, knee, foot, 0.014, chitin);
    }
  }
  if (queen) add(g, torus(0.56, 0.012), glow(0xe879f9, 1.3), 0, 0.03, 0, [Math.PI / 2, 0, 0]);
  g.scale.setScalar(scale);
  return { group: g, heads: [], height: 0.72 * scale };
}

/** 牛美菱: a little girl with twin tails and a wand. */
function girl(): Model {
  const g = new THREE.Group();
  const skin = mat(0xffe3cf, { rough: 0.7 });
  const dress = mat(0xe11d48, { rough: 0.6 });
  const blouse = mat(0xfdf2f8, { rough: 0.7 });
  const hair = mat(0x2b2340, { rough: 0.5 });
  const dark = mat(0x1f2430);
  const pink = glow(0xfb7185, 1.8);
  // Skirt with a frill, blouse, ribbon, arms.
  add(g, cone(0.19, 0.3, 14), dress, 0, 0.19, 0);
  add(g, cyl(0.2, 0.2, 0.022, 14), blouse, 0, 0.045, 0);
  add(g, cyl(0.085, 0.1, 0.17, 10), blouse, 0, 0.41, 0);
  add(g, box(0.11, 0.05, 0.03), dress, 0, 0.44, 0.09);
  add(g, cap(0.028, 0.1), skin, -0.125, 0.4, 0.02, [0, 0, 0.5]);
  add(g, cap(0.028, 0.1), skin, 0.125, 0.4, 0.02, [0, 0, -0.5]);
  // Head and face, looking towards +Z.
  add(g, sph(0.145, 16), skin, 0, 0.62, 0);
  add(g, sph(0.022, 8), dark, -0.052, 0.625, 0.13);
  add(g, sph(0.022, 8), dark, 0.052, 0.625, 0.13);
  add(g, sph(0.024, 8), mat(0xfb7185, { opacity: 0.75 }), -0.092, 0.585, 0.104);
  add(g, sph(0.024, 8), mat(0xfb7185, { opacity: 0.75 }), 0.092, 0.585, 0.104);
  // Hair: a cap swept back off the face, and a fringe across the brow.
  const capGeo = new THREE.SphereGeometry(0.158, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58);
  add(g, capGeo, hair, 0, 0.62, 0, [-0.75, 0, 0]);
  add(g, box(0.23, 0.05, 0.07), hair, 0, 0.73, 0.09);
  // Twin tails, each tied with a bow.
  for (const side of [-1, 1]) {
    add(g, sph(0.032, 8), glow(0xfde047, 1.2), side * 0.165, 0.69, -0.04);
    add(g, cyl(0.03, 0.066, 0.44, 8), hair, side * 0.21, 0.47, -0.06, [0.1, 0, side * 0.18]);
    add(g, sph(0.035, 8), hair, side * 0.252, 0.26, -0.085);
  }
  // The wand she fights with, from four tiles away.
  add(g, cyl(0.012, 0.016, 0.56, 6), mat(0xfbbf24, { metal: 0.6, rough: 0.3 }), 0.2, 0.5, 0.07, [0.25, 0, -0.18]);
  add(g, sph(0.045, 10), pink, 0.25, 0.79, 0);
  add(g, torus(0.075, 0.011), glow(0xfb7185, 1.3), 0.25, 0.79, 0, [Math.PI / 2, 0, 0]);
  return { group: g, heads: [], height: 0.9 };
}

/** 神坦: a tank the size of a barn, two turrets and all. */
function giantTank(): Model {
  const g = new THREE.Group();
  const armour = mat(0x3a3f4c, { rough: 0.5, metal: 0.35 });
  const plate = mat(0x24272f, { rough: 0.6, metal: 0.3 });
  const steel = mat(GUNMETAL, { metal: 0.6, rough: 0.4 });
  const trim = glow(0xff3b30, 1.7);
  // Tracks, with the road wheels showing, and armoured skirts over them.
  for (const side of [-1, 1]) {
    add(g, box(0.2, 0.26, 1.02), mat(TREAD), side * 0.44, 0.14, 0);
    for (let i = 0; i < 5; i++) add(g, cyl(0.075, 0.075, 0.215, 10), mat(0x4a5262, { metal: 0.5 }), side * 0.44, 0.1, -0.4 + i * 0.2, [0, 0, Math.PI / 2]);
    add(g, box(0.03, 0.13, 1.0), plate, side * 0.555, 0.27, 0);
  }
  // Hull with a sloped nose and a stripe along its top edge.
  add(g, box(0.66, 0.22, 0.9), armour, 0, 0.36, -0.03);
  add(g, box(0.66, 0.2, 0.2), armour, 0, 0.33, 0.46, [0.7, 0, 0]);
  add(g, box(0.68, 0.045, 0.92), mat(0x9f1239, { rough: 0.5 }), 0, 0.475, -0.03);
  add(g, box(0.3, 0.05, 0.05), mat(HAZARD), 0, 0.29, 0.55);
  // Exhausts at the back.
  for (const x of [-0.18, 0.18]) add(g, cyl(0.045, 0.045, 0.2, 8), plate, x, 0.56, -0.44);
  // The big turret and its cannon, with a muzzle brake.
  const main = new THREE.Group();
  add(main, box(0.5, 0.2, 0.56), armour, 0, 0.1, -0.04);
  add(main, box(0.54, 0.04, 0.6), plate, 0, 0, -0.04);
  add(main, cyl(0.2, 0.24, 0.1, 14), plate, 0, 0.22, -0.06);
  add(main, cyl(0.055, 0.065, 0.98, 10), steel, 0, 0.1, 0.72, [Math.PI / 2, 0, 0]);
  add(main, cyl(0.082, 0.082, 0.13, 10), plate, 0, 0.1, 1.16, [Math.PI / 2, 0, 0]);
  add(main, sph(0.028, 8), trim, 0.2, 0.24, 0.1);
  main.position.set(0, 0.52, 0.1);
  g.add(main);
  // A smaller turret over the engine deck.
  const sub = new THREE.Group();
  add(sub, box(0.26, 0.1, 0.26), armour, 0, 0.05, 0);
  add(sub, cyl(0.024, 0.024, 0.5, 8), steel, 0, 0.06, 0.36, [Math.PI / 2, 0, 0]);
  sub.position.set(0, 0.64, -0.32);
  g.add(sub);
  add(g, cyl(0.008, 0.008, 0.5, 6), mat(STEEL, { metal: 0.6 }), -0.22, 0.9, -0.42);
  add(g, sph(0.03, 8), trim, -0.22, 1.16, -0.42);
  return { group: g, heads: [main, sub], height: 1.0 };
}

/** 鬼魅: a white sheet of a ghost, with a trail of wisps. */
function ghost(): Model {
  const g = new THREE.Group();
  const ecto = mat(0xf8fafc, { emissive: 0xcbd5f5, glow: 0.6, rough: 0.6, opacity: 0.82 });
  // Round on top, hanging in points below.
  add(g, sph(0.24, 18), ecto, 0, 0.5, 0);
  add(g, cone(0.24, 0.34, 10), ecto, 0, 0.2, 0, [Math.PI, 0, 0]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    add(g, sph(0.07, 8), ecto, Math.cos(a) * 0.17, 0.06 + (i % 2) * 0.03, Math.sin(a) * 0.17);
  }
  // A surprised face.
  const dark = mat(0x1e1b4b);
  add(g, sph(0.038, 8), dark, -0.085, 0.56, 0.222).scale.set(1, 1.5, 0.6);
  add(g, sph(0.038, 8), dark, 0.085, 0.56, 0.222).scale.set(1, 1.5, 0.6);
  add(g, sph(0.04, 8), dark, 0, 0.43, 0.236).scale.set(1, 1.2, 0.6);
  // Wisps trailing behind.
  const wisp = mat(0xe0e7ff, { emissive: 0xa5b4fc, glow: 0.9, opacity: 0.5 });
  add(g, sph(0.06, 8), wisp, 0.16, 0.3, -0.26);
  add(g, sph(0.045, 8), wisp, -0.2, 0.2, -0.32);
  add(g, sph(0.03, 8), wisp, 0.05, 0.12, -0.4);
  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xe0e7ff, transparent: true, opacity: 0.12, depthWrite: false }),
  );
  aura.position.y = 0.45;
  g.add(aura);
  g.userData.aura = aura;
  return { group: g, heads: [], height: 0.82 };
}

/** The model of whichever alien turned up. */
export function buildAlien(key: AlienKey): Model {
  switch (key) {
    case 'chloe':
      return chloe();
    case 'kuide':
      return spider(1);
    case 'meiling':
      return girl();
    case 'shentan':
      return giantTank();
    case 'guimei':
      return ghost();
  }
}

/** One of 奎德's small spiders. */
export function buildSpiderling(): Model {
  return spider(0.38);
}
