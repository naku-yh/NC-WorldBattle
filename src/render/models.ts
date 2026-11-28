import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AlienKey, BuildingKey, CityKind, MinionKind, ResourceKey, UnitKey } from '../game/types';

/** A part that moves by itself, just for show. */
export interface Motion {
  part: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  /** Radians a second: how fast it turns, or with `swing` how fast it rocks. */
  speed: number;
  /** Rock this far either side of where it started, instead of going round and round. */
  swing?: number;
  /** Where in its swing it starts, in radians. */
  phase?: number;
}

/** A chimney mouth, in the model's own coordinates. */
export interface Vent {
  at: [number, number, number];
  kind: 'steam' | 'smoke';
}

export interface Model {
  group: THREE.Group;
  /** Turret heads that swing towards whatever is being shot at. */
  heads: THREE.Group[];
  /** Rough top of the model; the health bar floats above it. */
  height: number;
  /** Height of the solid body a click should hit. Falls back to `height`; thin masts and cranes above it stay unclickable. */
  hitH?: number;
  motion?: Motion[];
  /** Lit parts, dark while the building has no power. */
  lamps?: THREE.MeshStandardMaterial[];
  vents?: Vent[];
  /** Where a flag planted on it stands, in the model's own coordinates: on the roof itself, masts and chimneys aside. */
  flagAt?: [number, number, number];
}

export interface TruckModel {
  group: THREE.Group;
  cargo: THREE.Mesh;
}

// Models are built from primitives; geometry and materials are shared so a
// hundred units cost no more than a handful of draw setups, and whatever
// stands still in a model is baked into one mesh per material (see `bake`).
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
/** The top half of a sphere, standing on y = 0. */
const dome = (r: number, seg = 18): THREE.BufferGeometry =>
  cached(`h${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, Math.floor(seg / 2)), 0, Math.PI * 2, 0, Math.PI / 2));
/** A cooling tower: wide at the foot, pinched above half-way, flaring at the lip. Open at the top. */
const tower = (foot: number, lip: number, h: number): THREE.BufferGeometry =>
  cached(`w${foot},${lip},${h}`, () => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector2(foot * (1 - t) + lip * t - Math.sin(t * Math.PI) * foot * 0.34, t * h));
    }
    return new THREE.LatheGeometry(pts, 18);
  });

/** A prism `d` deep with a triangular cross-section `w` wide and `h` high: a gabled roof with its ridge along z. */
const gable = (w: number, h: number, d: number): THREE.BufferGeometry =>
  cached(`g${w},${h},${d}`, () => {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(0, h);
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
  });

/** Half a cylinder: the arch of a hangar roof. Its axis runs along y until the mesh is turned. */
const arch = (r: number, len: number): THREE.BufferGeometry => cached(`a${r},${len}`, () => new THREE.CylinderGeometry(r, r, len, 20, 1, false, 0, Math.PI));

/** The upper half of a ring, standing in the xy-plane: a rib over an arch. */
const hoop = (r: number, t: number): THREE.BufferGeometry => cached(`q${r},${t}`, () => new THREE.TorusGeometry(r, t, 6, 20, Math.PI));

/** A saw-tooth for a factory roof: a right triangle `w` wide and `h` high, its upright face towards +x, `d` deep. */
const tooth = (w: number, h: number, d: number): THREE.BufferGeometry =>
  cached(`s${w},${h},${d}`, () => {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(w / 2, h);
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
  });

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
// Baking
// ---------------------------------------------------------------------------

/**
 * Bakes whatever stands still under `root` into one mesh per material, so a
 * model can carry as much detail as it likes and still cost a few draws. What
 * moves or changes by itself is left alone: a group flagged `live` (a turret
 * head, a radar) is baked on its own, and anything flagged `keep` is not
 * touched. With `ownLamps`, every lit material is copied for this model alone
 * and returned, so its lights can be put out without darkening anyone else's.
 */
export function bake(root: THREE.Object3D, ownLamps: boolean): THREE.MeshStandardMaterial[] {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const taken: THREE.Mesh[] = [];
  const inner: THREE.Object3D[] = [];
  const collect = (node: THREE.Object3D): void => {
    for (const child of node.children) {
      if (child.userData.keep) continue;
      if (child.userData.live) inner.push(child);
      else if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const material = mesh.material as THREE.Material;
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
        const list = batches.get(material);
        if (list) list.push(geo);
        else batches.set(material, [geo]);
        taken.push(mesh);
      } else collect(child);
    }
  };
  collect(root);
  const lamps: THREE.MeshStandardMaterial[] = [];
  for (const [material, geos] of batches) {
    // A lit material is copied for this model alone, so its lights can be put out without darkening anyone else's.
    const std = material instanceof THREE.MeshStandardMaterial ? material : null;
    const own = ownLamps && std && std.emissive.getHex() !== 0 ? std.clone() : null;
    if (own && std) {
      // How bright it burns when the power is on, for putting it out and lighting it again.
      own.userData.glow = std.emissiveIntensity;
      own.userData.owned = true;
      lamps.push(own);
    }
    const merged = mergeGeometries(geos, false)!;
    merged.userData.owned = true;
    const mesh = new THREE.Mesh(merged, own ?? material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  for (const mesh of taken) mesh.removeFromParent();
  for (const live of inner) bake(live, ownLamps);
  return lamps;
}

/**
 * Lets go of what `bake` made for a model that is leaving the board: the
 * geometry it merged and any material it copied. The primitives and materials
 * the models share are not marked as owned, and so are never touched.
 */
export function scrap(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry?.userData.owned) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | undefined;
    if (material?.userData.owned) material.dispose();
  });
}

/** A finished unit, alien or node: its still parts baked. */
function done<T extends Model | TruckModel>(m: T): T {
  bake(m.group, false);
  return m;
}

/** A finished building: baked, and its lights listed so the view can put them out when the power goes. */
function lit(m: Model): Model {
  const lamps = bake(m.group, true);
  if (lamps.length) m.lamps = lamps;
  return m;
}

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
  const tread = mat(TREAD);
  add(g, box(w, h, l), mat(color, { rough: 0.55, metal: 0.3 }), 0, 0.17, 0);
  add(g, box(0.1, 0.14, l + 0.03), tread, -(w / 2 + 0.045), 0.09, 0);
  add(g, box(0.1, 0.14, l + 0.03), tread, w / 2 + 0.045, 0.09, 0);
  // Road wheels showing along the track, and a fender over it.
  for (const side of [-1, 1]) {
    add(g, box(0.12, 0.02, l + 0.06), mat(shade(color, 0.7), { metal: 0.3 }), side * (w / 2 + 0.045), 0.17, 0);
    for (let i = 0; i < 4; i++) add(g, cyl(0.04, 0.04, 0.108, 10), mat(GUNMETAL, { metal: 0.5 }), side * (w / 2 + 0.045), 0.07, -0.2 + i * 0.135, [0, 0, Math.PI / 2]);
  }
  add(g, box(w * 0.55, 0.025, l * 0.45), mat(shade(color, 0.65)), 0, 0.17 + h / 2 + 0.012, -0.08);
  // Headlamps on the glacis.
  add(g, sph(0.016, 6), glow(0xfff1c4, 1.3), -w * 0.32, 0.2, l / 2 + 0.004);
  add(g, sph(0.016, 6), glow(0xfff1c4, 1.3), w * 0.32, 0.2, l / 2 + 0.004);
  return g;
}

function gun(len: number, r: number): THREE.Mesh {
  const m = new THREE.Mesh(cyl(r, r, len, 8), mat(GUNMETAL, { rough: 0.4, metal: 0.6 }));
  m.rotation.x = Math.PI / 2;
  m.position.set(0, 0.05, len / 2 + 0.1);
  m.castShadow = true;
  return m;
}

function turretHead(color: number, barrels: 0 | 1 | 2, len: number, r: number, domeShape = false, extras?: (h: THREE.Group) => void): THREE.Group {
  const h = new THREE.Group();
  h.userData.live = true;
  if (domeShape) add(h, cyl(0.13, 0.17, 0.13, 14), mat(shade(color, 0.82), { rough: 0.45, metal: 0.3 }), 0, 0.05, 0);
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
  // Wingtip lights: red to port, green to starboard.
  add(g, sph(0.018, 6), glow(0xff5a5a, 1.8), -0.35, 0.012, 0.09);
  add(g, sph(0.018, 6), glow(0x4ade80, 1.8), 0.35, 0.012, 0.09);
  const engine = mat(0xffb27a, { emissive: 0xf97316, glow: 1.6 });
  add(g, cyl(0.028, 0.028, 0.05, 8), engine, -0.03, 0, -0.2, [Math.PI / 2, 0, 0]);
  add(g, cyl(0.028, 0.028, 0.05, 8), engine, 0.03, 0, -0.2, [Math.PI / 2, 0, 0]);
  return { group: g, heads: [], height: 0.16 };
}

/** A special-forces soldier: broader, in a visored helmet, with a long rifle. */
function commando(color: number): Model {
  const g = new THREE.Group();
  const dark = shade(color, 0.5);
  add(g, cap(0.09, 0.2), mat(color), 0, 0.22, 0);
  add(g, box(0.2, 0.1, 0.14), mat(dark), 0, 0.3, -0.02); // shoulders
  add(g, sph(0.088), mat(dark), 0, 0.41, 0); // helmet
  add(g, box(0.14, 0.03, 0.02), glow(0x7dd3fc, 1.2), 0, 0.41, 0.082); // visor
  add(g, box(0.19, 0.05, 0.13), mat(shade(color, 0.7)), 0, 0.29, -0.01); // pack
  add(g, box(0.028, 0.028, 0.36), mat(DARK), 0.08, 0.27, 0.13);
  add(g, box(0.04, 0.05, 0.1), mat(GUNMETAL, { metal: 0.6 }), 0.08, 0.3, 0.2);
  add(g, box(0.06, 0.06, 0.05), mat(DARK), 0.08, 0.24, 0.03); // magazine
  add(g, box(0.045, 0.16, 0.045), mat(dark), -0.055, 0.08, 0);
  add(g, box(0.045, 0.16, 0.045), mat(dark), 0.055, 0.08, 0);
  return { group: g, heads: [], height: 0.5 };
}

/** A walking battle mech: an armoured torso on two legs, a gun on each arm and a visored head. The torso turns towards what it shoots at. */
function mech(color: number): Model {
  const g = new THREE.Group();
  const plate = mat(color, { rough: 0.5, metal: 0.35 });
  const dark = mat(shade(color, 0.55), { metal: 0.4 });
  for (const side of [-1, 1]) {
    add(g, box(0.1, 0.22, 0.12), dark, side * 0.11, 0.36, 0); // thigh
    add(g, box(0.085, 0.24, 0.1), plate, side * 0.11, 0.14, 0.01); // shin
    add(g, box(0.12, 0.045, 0.2), mat(TREAD), side * 0.11, 0.022, 0.03); // foot
  }
  add(g, box(0.2, 0.08, 0.14), dark, 0, 0.49, 0); // hips
  const h = new THREE.Group();
  h.userData.live = true;
  add(h, box(0.3, 0.24, 0.2), plate, 0, 0.13, 0);
  add(h, box(0.22, 0.06, 0.02), glow(0x7dd3fc, 1.1), 0, 0.16, 0.101); // chest lights
  add(h, sph(0.075), dark, 0, 0.31, 0.02);
  add(h, box(0.12, 0.03, 0.02), glow(0xfca5a5, 1.3), 0, 0.31, 0.094); // visor
  for (const side of [-1, 1]) {
    add(h, box(0.07, 0.16, 0.09), plate, side * 0.2, 0.2, 0); // shoulder
    add(h, cyl(0.028, 0.028, 0.34, 8), mat(GUNMETAL, { metal: 0.6, rough: 0.4 }), side * 0.2, 0.14, 0.2, [Math.PI / 2, 0, 0]); // gun
  }
  h.position.y = 0.53;
  g.add(h);
  return done({ group: g, heads: [h], height: 0.9 });
}

/** A bomber: wider and heavier than a fighter, an engine on each wing and a glass nose. */
function bomber(color: number): Model {
  const g = new THREE.Group();
  const skin = mat(color, { rough: 0.42, metal: 0.4 });
  add(g, cap(0.085, 0.46), skin, 0, 0, 0, [Math.PI / 2, 0, 0]);
  add(g, cone(0.085, 0.14, 10), mat(0xd6efff, { emissive: 0x38bdf8, glow: 0.5, rough: 0.1 }), 0, 0, 0.39, [Math.PI / 2, 0, 0]);
  add(g, box(0.82, 0.025, 0.24), skin, 0, 0, 0.02);
  add(g, box(0.3, 0.02, 0.12), mat(shade(color, 0.85)), 0, 0.01, -0.26); // tail plane
  add(g, box(0.02, 0.2, 0.16), mat(shade(color, 0.6)), 0, 0.1, -0.3); // fin
  const engine = mat(0xffb27a, { emissive: 0xf97316, glow: 1.6 });
  for (const x of [-0.27, 0.27]) {
    add(g, cyl(0.05, 0.055, 0.22, 10), mat(shade(color, 0.7), { metal: 0.4 }), x, -0.005, 0.1, [Math.PI / 2, 0, 0]);
    add(g, cyl(0.035, 0.035, 0.03, 8), engine, x, -0.005, -0.02, [Math.PI / 2, 0, 0]);
  }
  add(g, box(0.1, 0.03, 0.2), mat(DARK), 0, -0.085, 0.02); // bomb bay
  return { group: g, heads: [], height: 0.22 };
}

export function buildUnit(key: UnitKey, color: number): Model {
  switch (key) {
    case 'truck':
      return { group: buildTruck(color).group, heads: [], height: 0.3 };
    case 'infantry':
      return done(soldier(color, 'infantry'));
    case 'sniper':
      return done(soldier(color, 'sniper'));
    case 'atSoldier':
      return done(soldier(color, 'at'));
    case 'specOps':
      return done(commando(color));
    case 'mech':
      return mech(color);
    case 'tank': {
      const g = tankBody(color);
      const h = turretHead(color, 1, 0.4, 0.022, false, (head) => {
        add(head, cyl(0.038, 0.038, 0.03, 8), mat(GUNMETAL, { metal: 0.5 }), 0, 0.05, 0.47, [Math.PI / 2, 0, 0]); // muzzle brake
        add(head, cyl(0.022, 0.022, 0.14, 8), mat(DARK), -0.06, 0.14, -0.1, [0, 0, Math.PI / 2]); // spent casings
      });
      h.position.y = 0.27;
      g.add(h);
      return done({ group: g, heads: [h], height: 0.42 });
    }
    case 'twinTank': {
      const g = tankBody(color, 0.5, 0.62);
      const h = turretHead(color, 2, 0.46, 0.02, false, (head) => {
        add(head, box(0.19, 0.07, 0.1), mat(shade(color, 0.6), { metal: 0.3 }), 0, 0.05, 0.16); // sleeve round both barrels
        add(head, box(0.3, 0.035, 0.06), mat(shade(color, 0.55)), 0, 0.135, -0.16); // bustle rack
      });
      h.position.y = 0.27;
      g.add(h);
      return done({ group: g, heads: [h], height: 0.42 });
    }
    case 'aaTank': {
      const g = tankBody(color, 0.48, 0.58);
      const h = new THREE.Group();
      h.userData.live = true;
      add(h, box(0.3, 0.07, 0.3), mat(shade(color, 0.82), { metal: 0.3 }), 0, 0.03, 0);
      for (const o of [-0.055, 0.055]) add(h, cyl(0.02, 0.02, 0.46, 8), mat(GUNMETAL, { metal: 0.6, rough: 0.4 }), o, 0.2, 0.18, [Math.PI / 2 - 0.75, 0, 0]);
      add(h, box(0.17, 0.13, 0.02), mat(GUNMETAL, { metal: 0.5 }), 0, 0.15, -0.14, [-0.3, 0, 0]);
      // A little range-finder dish on the mount.
      add(h, cyl(0.05, 0.012, 0.02, 10), mat(STEEL, { metal: 0.5 }), 0.14, 0.11, -0.04, [Math.PI / 2 - 0.5, 0, 0]);
      h.position.y = 0.25;
      g.add(h);
      return done({ group: g, heads: [h], height: 0.44 });
    }
    case 'missileTank': {
      const g = tankBody(color, 0.5, 0.6, 0.16);
      const h = new THREE.Group();
      h.userData.live = true;
      add(h, box(0.29, 0.13, 0.36), mat(shade(color, 0.82), { metal: 0.3 }), 0, 0.07, -0.03);
      for (const o of [-0.068, 0.068]) {
        add(h, cyl(0.036, 0.036, 0.3, 8), mat(0xe5e7eb, { rough: 0.4 }), o, 0.08, 0.2, [Math.PI / 2 - 0.18, 0, 0]);
        add(h, cone(0.036, 0.08, 8), mat(0xef4444), o, 0.135, 0.387, [Math.PI / 2 - 0.18, 0, 0]);
        // Fins at the tail.
        for (const side of [-1, 1]) add(h, box(0.004, 0.05, 0.05), mat(0x9ca3af, { metal: 0.5 }), o + side * 0.036, 0.045, 0.08, [Math.PI / 2 - 0.18, 0, 0]);
      }
      h.position.y = 0.27;
      g.add(h);
      return done({ group: g, heads: [h], height: 0.44 });
    }
    case 'laserTank': {
      const g = tankBody(color);
      const h = new THREE.Group();
      h.userData.live = true;
      const lens = glow(0x67e8f9, 1.5);
      // A low dome with a focusing barrel lying along it, ringed by coils, and the emitter at its tip.
      add(h, cyl(0.13, 0.17, 0.06, 16), mat(shade(color, 0.82), { rough: 0.45, metal: 0.3 }), 0, 0.02, 0);
      add(h, dome(0.125, 16), mat(shade(color, 1.05), { rough: 0.3, metal: 0.35 }), 0, 0.05, 0);
      add(h, cyl(0.026, 0.032, 0.36, 10), mat(GUNMETAL, { metal: 0.6, rough: 0.4 }), 0, 0.085, 0.25, [Math.PI / 2, 0, 0]);
      for (const z of [0.17, 0.235, 0.3]) add(h, torus(0.048, 0.011), lens, 0, 0.085, z);
      add(h, cyl(0.05, 0.038, 0.05, 10), mat(GUNMETAL, { metal: 0.6 }), 0, 0.085, 0.395, [Math.PI / 2, 0, 0]);
      add(h, octa(0.04), lens, 0, 0.085, 0.445);
      // Power cells along the hull's shoulders, glowing faintly.
      add(g, cyl(0.03, 0.03, 0.2, 8), lens, -0.13, 0.27, -0.1, [Math.PI / 2, 0, 0]);
      add(g, cyl(0.03, 0.03, 0.2, 8), lens, 0.13, 0.27, -0.1, [Math.PI / 2, 0, 0]);
      h.position.y = 0.27;
      g.add(h);
      return done({ group: g, heads: [h], height: 0.46 });
    }
    case 'apocalypse': {
      const g = tankBody(shade(color, 0.75), 0.62, 0.78, 0.2);
      add(g, box(0.68, 0.06, 0.26), mat(shade(color, 0.5)), 0, 0.31, -0.3);
      add(g, box(0.68, 0.06, 0.1), mat(HAZARD), 0, 0.285, 0.4);
      const front = turretHead(color, 1, 0.56, 0.03, false, (head) => {
        add(head, cyl(0.045, 0.045, 0.05, 8), mat(GUNMETAL, { metal: 0.5 }), 0, 0.05, 0.61, [Math.PI / 2, 0, 0]);
      });
      front.position.set(0, 0.35, 0.14);
      const rear = turretHead(color, 1, 0.46, 0.028, false, (head) => {
        add(head, cyl(0.042, 0.042, 0.05, 8), mat(GUNMETAL, { metal: 0.5 }), 0, 0.05, 0.51, [Math.PI / 2, 0, 0]);
      });
      rear.position.set(0, 0.52, -0.17);
      g.add(front, rear);
      return done({ group: g, heads: [front, rear], height: 0.64 });
    }
    case 'fighter':
      return done(fighter(color));
    case 'bomber':
      return done(bomber(color));
  }
}

export function buildTruck(color: number): TruckModel {
  const g = new THREE.Group();
  const skin = mat(color, { rough: 0.5, metal: 0.25 });
  add(g, box(0.2, 0.13, 0.18), skin, 0, 0.19, 0.2);
  add(g, box(0.18, 0.06, 0.03), mat(0xa9c6dc, { rough: 0.15, metal: 0.3 }), 0, 0.215, 0.292);
  // Bumper and headlamps.
  add(g, box(0.22, 0.03, 0.02), mat(GUNMETAL, { metal: 0.5 }), 0, 0.13, 0.295);
  add(g, sph(0.014, 6), glow(0xfff1c4, 1.4), -0.07, 0.17, 0.296);
  add(g, sph(0.014, 6), glow(0xfff1c4, 1.4), 0.07, 0.17, 0.296);
  const bed = mat(shade(color, 0.55));
  add(g, box(0.24, 0.04, 0.32), bed, 0, 0.135, -0.06);
  add(g, box(0.02, 0.07, 0.32), bed, -0.11, 0.19, -0.06);
  add(g, box(0.02, 0.07, 0.32), bed, 0.11, 0.19, -0.06);
  add(g, box(0.24, 0.07, 0.02), bed, 0, 0.19, -0.21);
  for (const x of [-0.125, 0.125]) for (const z of [0.2, -0.04, -0.17]) add(g, cyl(0.045, 0.045, 0.035, 10), mat(TREAD), x, 0.045, z, [0, 0, Math.PI / 2]);
  const cargo = add(g, box(0.19, 0.09, 0.27), mat(0x9ca3af), 0, 0.2, -0.06);
  cargo.userData.keep = true;
  cargo.visible = false;
  bake(g, false);
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

const CONCRETE = 0x39404d;
const WINDOW = 0xffe2a0;

function slab(g: THREE.Group, w: number, d: number, color = 0x4b5563): void {
  add(g, box(w, 0.06, d), mat(color, { rough: 0.9 }), 0, 0.03, 0);
}

/** A low kerb round a slab, so its edge reads from above. The run along the front can be left out. */
function kerb(g: THREE.Group, w: number, d: number, material: THREE.Material, front = true): void {
  const t = 0.04;
  if (front) add(g, box(w, 0.045, t), material, 0, 0.07, (d - t) / 2);
  add(g, box(w, 0.045, t), material, 0, 0.07, -(d - t) / 2);
  add(g, box(t, 0.045, d - 2 * t), material, (w - t) / 2, 0.07, 0);
  add(g, box(t, 0.045, d - 2 * t), material, -(w - t) / 2, 0.07, 0);
}

/** A row of windows along the wall at `z`, lit from inside and cut by mullions. */
function windowBand(g: THREE.Group, z: number, y: number, w: number, h: number, x = 0, color = WINDOW): void {
  const out = Math.sign(z);
  add(g, box(w, h, 0.016), mat(DARK), x, y, z);
  add(g, box(w - 0.024, h - 0.02, 0.01), glow(color, 1.15), x, y, z + out * 0.007);
  const n = Math.max(1, Math.round(w / 0.13));
  for (let i = 1; i < n; i++) add(g, box(0.016, h, 0.014), mat(DARK), x - w / 2 + (i * w) / n, y, z + out * 0.009);
}

/** The same, along a side wall at `x`. */
function windowBandSide(g: THREE.Group, x: number, y: number, d: number, h: number, z = 0, color = WINDOW): void {
  const out = Math.sign(x);
  add(g, box(0.016, h, d), mat(DARK), x, y, z);
  add(g, box(0.01, h - 0.02, d - 0.024), glow(color, 1.15), x + out * 0.007, y, z);
  const n = Math.max(1, Math.round(d / 0.13));
  for (let i = 1; i < n; i++) add(g, box(0.014, h, 0.016), mat(DARK), x + out * 0.009, y, z - d / 2 + (i * d) / n);
}

/** Alternating blocks of warning paint in a strip `w` wide, lying along x. */
function hazard(g: THREE.Group, y: number, w: number, x = 0, z = 0, d = 0.03): void {
  const n = Math.max(2, Math.round(w / 0.07));
  for (let i = 0; i < n; i++) add(g, box(w / n - 0.008, 0.016, d), mat(i % 2 ? DARK : HAZARD, { rough: 0.6 }), x - w / 2 + ((i + 0.5) * w) / n, y, z);
}

/** A stack of supply crates. */
function crates(g: THREE.Group, x: number, z: number, n = 3): void {
  const wood = mat(0x9a7449, { rough: 0.9 });
  const strap = mat(0x6f5533);
  const s = 0.11;
  const spots: Array<[number, number, number]> = [
    [0, 0, 0],
    [s + 0.012, 0.012, 0],
    [s / 2 + 0.006, 0.006, s + 0.012],
  ];
  for (let i = 0; i < n; i++) {
    const [dx, dz, y] = spots[i % 3];
    const cy = 0.06 + s / 2 + y;
    add(g, box(s, s, s), wood, x + dx, cy, z + dz, [0, (i * 0.21) % 0.4 - 0.1, 0]);
    add(g, box(s + 0.006, 0.014, s + 0.006), strap, x + dx, cy, z + dz);
  }
}

/** A row of sandbags along x. */
function sandbags(g: THREE.Group, x0: number, x1: number, z: number): void {
  const bag = mat(0xb8a276, { rough: 1 });
  const n = Math.max(2, Math.round((x1 - x0) / 0.1));
  for (let i = 0; i < n; i++) {
    const m = add(g, cap(0.03, 0.045), bag, x0 + ((i + 0.5) * (x1 - x0)) / n, 0.085, z, [0, 0, Math.PI / 2]);
    m.scale.set(0.8, 1, 0.75);
  }
}

function flag(g: THREE.Group, color: number, x: number, y: number, z: number): void {
  const pole = mat(STEEL, { metal: 0.6 });
  add(g, cyl(0.012, 0.012, 0.8, 6), pole, x, y + 0.4, z);
  add(g, sph(0.018, 6), mat(0xf2c14e, { metal: 0.8, rough: 0.3 }), x, y + 0.81, z);
  add(g, box(0.26, 0.16, 0.012), mat(color, { rough: 0.6 }), x + 0.14, y + 0.7, z);
}

/** A mast with a warning light on top. */
function mast(g: THREE.Group, x: number, y: number, z: number, h: number, color = 0xff5a5a): void {
  add(g, cyl(0.012, 0.012, h, 6), mat(STEEL, { metal: 0.6 }), x, y + h / 2, z);
  add(g, sph(0.04, 8), glow(color, 1.6), x, y + h, z);
}

function glow(color: number, intensity = 1.2): THREE.MeshStandardMaterial {
  return mat(color, { emissive: color, glow: intensity, rough: 0.3 });
}

/** A dish on a short post, looking up and forwards. Put it in a `live` group to have it sweep. */
function dish(part: THREE.Group, r: number, material: THREE.Material, x: number, y: number, z: number): void {
  add(part, cyl(0.012, 0.012, r * 1.6, 6), mat(GUNMETAL), x, y + r * 0.8, z);
  add(part, cyl(r, r * 0.25, r * 0.35, 12), material, x, y + r * 1.7, z + r * 0.25, [Math.PI / 2 - 0.6, 0, 0]);
  add(part, sph(0.014, 6), glow(0x7dd3fc, 1.6), x, y + r * 1.85, z + r * 0.5);
}

/** A roof extractor fan: a squat drum with a three-bladed rotor turning on top. */
function fan(g: THREE.Group, x: number, y: number, z: number): Motion {
  add(g, cyl(0.085, 0.1, 0.05, 12), mat(GUNMETAL), x, y, z);
  const rotor = new THREE.Group();
  rotor.userData.live = true;
  rotor.position.set(x, y + 0.035, z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    add(rotor, box(0.028, 0.006, 0.07), mat(STEEL, { metal: 0.5 }), Math.sin(a) * 0.045, 0, Math.cos(a) * 0.045, [0, a, 0.35]);
  }
  add(rotor, cyl(0.018, 0.018, 0.02, 8), mat(DARK), 0, 0.004, 0);
  g.add(rotor);
  return { part: rotor, axis: 'y', speed: 9 };
}

/** A barrel drum, standing upright. */
function drum(g: THREE.Group, x: number, z: number, color: number): void {
  add(g, cyl(0.05, 0.05, 0.13, 12), mat(color, { rough: 0.55, metal: 0.3 }), x, 0.125, z);
  add(g, cyl(0.052, 0.052, 0.012, 12), mat(shade(color, 0.7), { metal: 0.4 }), x, 0.09, z);
  add(g, cyl(0.052, 0.052, 0.012, 12), mat(shade(color, 0.7), { metal: 0.4 }), x, 0.16, z);
}

/** The military base: a keep under a radar dome, four corner bastions, a gate and a mast. */
function base(color: number): Model {
  const g = new THREE.Group();
  const steel = mat(STEEL, { metal: 0.25, rough: 0.55 });
  const trim = mat(GUNMETAL, { metal: 0.4, rough: 0.5 });
  const dark = mat(DARK);
  slab(g, 1.9, 1.9, CONCRETE);
  kerb(g, 1.86, 1.86, trim);
  // The keep: a block with a coloured band, proud ribs and lit windows.
  add(g, box(1.2, 0.5, 1.2), steel, 0, 0.31, 0);
  add(g, box(1.26, 0.07, 1.26), mat(color, { rough: 0.5 }), 0, 0.3, 0);
  for (const s of [-1, 1]) {
    for (const o of [-0.44, -0.15, 0.15, 0.44]) {
      add(g, box(0.035, 0.2, 0.025), trim, o, 0.42, s * 0.612);
      add(g, box(0.025, 0.2, 0.035), trim, s * 0.612, 0.42, o);
    }
    windowBandSide(g, s * 0.612, 0.17, 0.8, 0.05);
  }
  windowBand(g, -0.612, 0.17, 0.8, 0.05);
  // The gate: a dark mouth under a striped lintel, with a lamp over it. It stands proud of the band it overlaps.
  add(g, box(0.5, 0.3, 0.03), dark, 0, 0.2, 0.622);
  hazard(g, 0.38, 0.52, 0, 0.625, 0.02);
  add(g, sph(0.022, 6), glow(0xffe9a8, 1.5), 0, 0.46, 0.63);
  // The radar dome, with a lip and a seam, and a small dish beside it that sweeps.
  add(g, dome(0.42), mat(shade(color, 1.15), { rough: 0.35, metal: 0.2 }), 0, 0.56, 0);
  add(g, torus(0.42, 0.018), trim, 0, 0.57, 0, [Math.PI / 2, 0, 0]);
  add(g, torus(0.337, 0.008), trim, 0, 0.81, 0, [Math.PI / 2, 0, 0]);
  const sweep = new THREE.Group();
  sweep.userData.live = true;
  sweep.position.set(-0.42, 0.56, 0.38);
  dish(sweep, 0.08, steel, 0, 0, 0);
  g.add(sweep);
  // Four corner bastions, each with a light on top.
  for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
    add(g, box(0.15, 0.34, 0.15), trim, x, 0.2, z);
    add(g, box(0.19, 0.03, 0.19), steel, x, 0.385, z);
    add(g, sph(0.045, 8), glow(color, 1.4), x, 0.42, z);
  }
  // Roof clutter: air boxes and a mast with a beacon.
  add(g, box(0.14, 0.08, 0.1), trim, 0.36, 0.6, -0.3);
  add(g, box(0.1, 0.06, 0.14), trim, -0.36, 0.59, -0.34);
  mast(g, 0.45, 0.56, 0.45, 0.5);
  crates(g, 0.5, 0.74, 2);
  flag(g, color, -0.6, 0.06, -0.6);
  return lit({ group: g, heads: [], height: 1.05, hitH: 1.0, motion: [{ part: sweep, axis: 'y', speed: 0.9 }] });
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
  slab(g, 1.9, 1.9, 0x4a5262);
  kerb(g, 1.86, 1.86, gold);
  // The keep, with a gold cornice and an emblem over the gate.
  add(g, box(1.2, 0.56, 1.2), steel, 0, 0.34, 0);
  add(g, box(1.26, 0.08, 1.26), mat(color, { rough: 0.5 }), 0, 0.3, 0);
  add(g, box(1.24, 0.03, 1.24), gold, 0, 0.635, 0);
  add(g, box(0.56, 0.34, 0.03), mat(DARK), 0, 0.24, 0.622);
  hazard(g, 0.44, 0.6, 0, 0.63, 0.02);
  add(g, octa(0.1), glow(0xf2c14e, 0.9), 0, 0.53, 0.63).scale.set(1, 1, 0.3);
  for (const s of [-1, 1]) {
    windowBandSide(g, s * 0.615, 0.2, 0.8, 0.07, 0, 0xbfe3ff);
    windowBandSide(g, s * 0.615, 0.46, 0.8, 0.05, 0, WINDOW);
  }
  windowBand(g, -0.615, 0.45, 0.9, 0.09, 0, WINDOW);
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
  mast(g, 0.16, 1.38, -0.14, 0.44);
  const radar = new THREE.Group();
  radar.userData.live = true;
  radar.position.set(-0.2, 1.46, 0.18);
  add(radar, cyl(0.02, 0.026, 0.2, 6), mat(GUNMETAL), 0, 0.1, 0);
  add(radar, box(0.36, 0.17, 0.03), mat(0xdfe6f2, { metal: 0.4 }), 0, 0.29, 0, [0.5, 0, 0]);
  add(radar, sph(0.02, 6), glow(0x7dd3fc, 1.6), 0, 0.36, 0.07);
  g.add(radar);
  flag(g, color, -0.6, 0.06, -0.6);
  flag(g, color, 0.6, 0.06, -0.6);
  return lit({ group: g, heads: [], height: 1.95, hitH: 1.65, motion: [{ part: radar, axis: 'y', speed: 1.1 }] });
}

/** The power plant: a hall beside two cooling towers that breathe steam, a transformer yard and a lit bolt on the wall. */
function powerPlant(color: number): Model {
  const g = new THREE.Group();
  const steel = mat(0x64748b, { metal: 0.3, rough: 0.6 });
  const trim = mat(GUNMETAL, { metal: 0.4, rough: 0.5 });
  const concrete = mat(0x8d99aa, { rough: 0.85 });
  slab(g, 0.86, 0.86, CONCRETE);
  kerb(g, 0.82, 0.82, trim);
  add(g, box(0.68, 0.26, 0.68), steel, 0, 0.19, 0);
  add(g, box(0.72, 0.05, 0.72), mat(color, { rough: 0.5 }), 0, 0.2, 0);
  windowBand(g, 0.345, 0.16, 0.3, 0.05, -0.17);
  // Two cooling towers, pinched at the waist and ringed at the lip.
  add(g, tower(0.19, 0.15, 0.52), concrete, -0.16, 0.3, -0.08);
  add(g, torus(0.15, 0.012), trim, -0.16, 0.82, -0.08, [Math.PI / 2, 0, 0]);
  add(g, cyl(0.13, 0.13, 0.004, 18), mat(0x1f2430), -0.16, 0.805, -0.08);
  add(g, tower(0.13, 0.1, 0.36), mat(0xa3aebd, { rough: 0.8 }), 0.22, 0.3, 0.22);
  add(g, cyl(0.085, 0.085, 0.004, 16), mat(0x1f2430), 0.22, 0.645, 0.22);
  add(g, cyl(0.02, 0.02, 0.2, 6), trim, -0.16, 0.34, 0.22, [Math.PI / 2, 0, 0]);
  // The transformer yard: a tank with insulators on top, and a cable off it.
  add(g, box(0.2, 0.12, 0.15), trim, 0.2, 0.38, -0.26);
  for (const x of [0.13, 0.2, 0.27]) add(g, cyl(0.014, 0.014, 0.08, 6), mat(0xdfe6f2), x, 0.48, -0.26);
  limb(g, [0.27, 0.52, -0.26], [0.4, 0.1, -0.4], 0.005, trim);
  // The bolt on the wall, and a lamp under the eave.
  add(g, box(0.055, 0.22, 0.03), glow(0xfacc15, 1.4), 0.18, 0.4, -0.35, [0, 0, 0.45]);
  add(g, sph(0.02, 6), glow(WINDOW, 1.4), 0.26, 0.29, 0.35);
  drum(g, -0.38, 0.37, 0x4b5545);
  return lit({
    group: g,
    heads: [],
    height: 0.9,
    hitH: 0.85,
    vents: [
      { at: [-0.16, 0.84, -0.08], kind: 'steam' },
      { at: [0.22, 0.68, 0.22], kind: 'steam' },
    ],
  });
}

/** The processing plant: a saw-tooth roof glazed with skylights, a smoking chimney, a loading dock and its crates. */
function factory(color: number): Model {
  const g = new THREE.Group();
  const wall = mat(0x8d8275, { rough: 0.8 });
  const roof = mat(0x6f665b);
  const trim = mat(GUNMETAL);
  slab(g, 0.86, 0.86, CONCRETE);
  kerb(g, 0.82, 0.82, trim);
  add(g, box(0.8, 0.26, 0.6), wall, 0, 0.19, 0);
  add(g, box(0.84, 0.06, 0.62), mat(color, { rough: 0.5 }), 0, 0.11, 0);
  // Three teeth of the roof, each with a glazed upright face.
  const sky = glow(0xbfe3ff, 0.9);
  for (let i = 0; i < 3; i++) {
    const x = -0.267 + i * 0.267;
    add(g, tooth(0.26, 0.1, 0.6), roof, x, 0.32, 0);
    add(g, box(0.012, 0.09, 0.56), sky, x + 0.128, 0.37, 0);
  }
  add(g, box(0.8, 0.02, 0.04), trim, 0, 0.33, 0.31);
  add(g, box(0.8, 0.02, 0.04), trim, 0, 0.33, -0.31);
  // The chimney, with a rim and a ladder up its side.
  add(g, cyl(0.045, 0.062, 0.44, 10), trim, 0.3, 0.54, -0.2);
  add(g, cyl(0.055, 0.05, 0.03, 10), mat(0x3a4150), 0.3, 0.775, -0.2);
  // The roller door, a step and the crates waiting on it.
  add(g, box(0.24, 0.17, 0.02), mat(DARK), -0.14, 0.23, 0.305);
  for (let i = 0; i < 5; i++) add(g, box(0.22, 0.008, 0.012), mat(0x3a4150), -0.14, 0.155 + i * 0.035, 0.312);
  add(g, sph(0.018, 6), glow(WINDOW, 1.4), -0.02, 0.3, 0.31);
  windowBand(g, 0.305, 0.23, 0.2, 0.06, 0.2);
  hazard(g, 0.065, 0.3, -0.14, 0.36);
  crates(g, 0.26, 0.3, 2);
  drum(g, -0.36, -0.36, 0x8a5a2b);
  return lit({ group: g, heads: [], height: 0.8, hitH: 0.5, vents: [{ at: [0.3, 0.8, -0.2], kind: 'smoke' }] });
}

/** The barracks: a long hut under a gabled roof, three doors with lamps, sandbags along the front and a flag. */
function barracks(color: number): Model {
  const g = new THREE.Group();
  const wall = mat(0x5f6b3c, { rough: 0.8 });
  const roof = mat(0x465030);
  const trim = mat(GUNMETAL);
  slab(g, 1.84, 0.86, CONCRETE);
  kerb(g, 1.8, 0.82, trim, false);
  add(g, box(1.76, 0.3, 0.62), wall, 0, 0.21, 0);
  add(g, box(1.78, 0.06, 0.63), mat(color, { rough: 0.5 }), 0, 0.095, 0);
  add(g, gable(0.72, 0.2, 1.8), roof, 0, 0.36, 0, [0, Math.PI / 2, 0]);
  add(g, box(1.82, 0.025, 0.05), trim, 0, 0.565, 0);
  // Doors with a lamp over each, and a window between them.
  for (const x of [-0.55, 0, 0.55]) {
    add(g, box(0.17, 0.17, 0.02), mat(DARK), x, 0.215, 0.315);
    add(g, box(0.2, 0.02, 0.03), trim, x, 0.31, 0.318);
    add(g, sph(0.02, 6), glow(0xfde68a, 1.4), x, 0.345, 0.32);
  }
  windowBand(g, 0.315, 0.2, 0.2, 0.07, -0.28);
  windowBand(g, 0.315, 0.2, 0.2, 0.07, 0.28);
  windowBand(g, -0.315, 0.2, 1.4, 0.06);
  sandbags(g, -0.82, -0.2, 0.37);
  sandbags(g, 0.2, 0.82, 0.37);
  crates(g, -0.74, -0.66, 2);
  drum(g, 0.74, -0.66, 0x4b5545);
  flag(g, color, 0.82, 0.06, -0.22);
  return lit({ group: g, heads: [], height: 0.6, hitH: 0.56 });
}

/** The war factory: a hangar under an arch, a striped roller door, roof fans, a gantry crane and plate stock. */
function warFactory(color: number): Model {
  const g = new THREE.Group();
  const wall = mat(0x4a5261, { metal: 0.3, rough: 0.6 });
  const trim = mat(GUNMETAL, { metal: 0.4, rough: 0.5 });
  const plate = mat(0x3a4150, { metal: 0.4, rough: 0.55 });
  const motion: Motion[] = [];
  slab(g, 1.86, 1.6, CONCRETE);
  kerb(g, 1.82, 1.56, trim);
  add(g, box(1.76, 0.52, 1.5), wall, 0, 0.32, 0);
  add(g, box(1.8, 0.08, 1.54), mat(color, { rough: 0.5 }), 0, 0.54, 0);
  // The arch over the top, ribs across it, and three fans along the crown.
  add(g, arch(0.75, 1.74), plate, 0, 0.58, 0, [0, 0, Math.PI / 2]).scale.set(0.44, 1, 1);
  for (const x of [-0.66, -0.22, 0.22, 0.66]) add(g, hoop(0.75, 0.014), trim, x, 0.58, 0, [0, Math.PI / 2, 0]).scale.set(1, 0.44, 1);
  for (const x of [-0.5, 0, 0.5]) motion.push(fan(g, x, 0.905, 0));
  // The roller door in a striped frame, lit from above.
  add(g, box(0.9, 0.44, 0.03), mat(0x151a22), 0, 0.28, 0.755);
  for (let i = 0; i < 5; i++) add(g, box(0.9, 0.02, 0.035), plate, 0, 0.1 + i * 0.09, 0.762);
  for (const s of [-1, 1]) {
    add(g, box(0.07, 0.46, 0.04), mat(HAZARD, { rough: 0.6 }), s * 0.485, 0.29, 0.76);
    add(g, sph(0.022, 6), glow(0xfde68a, 1.5), s * 0.36, 0.53, 0.77);
  }
  hazard(g, 0.535, 1.04, 0, 0.76, 0.035);
  windowBandSide(g, 0.885, 0.42, 1.1, 0.07);
  windowBandSide(g, -0.885, 0.42, 1.1, 0.07);
  windowBand(g, -0.755, 0.4, 1.2, 0.07);
  // The gantry crane: a post, a jib with a tie, and a hook on a cable.
  const yellow = mat(HAZARD, { rough: 0.55, metal: 0.2 });
  add(g, box(0.08, 0.56, 0.08), yellow, 0.74, 0.88, -0.62);
  add(g, box(0.6, 0.07, 0.08), yellow, 0.48, 1.13, -0.62);
  limb(g, [0.74, 1.14, -0.62], [0.24, 1.16, -0.62], 0.01, trim);
  add(g, cyl(0.008, 0.008, 0.3, 6), trim, 0.24, 0.95, -0.62);
  add(g, box(0.05, 0.06, 0.04), trim, 0.24, 0.78, -0.62);
  // Plate stock and a drum on the apron in front of the door.
  for (let i = 0; i < 4; i++) add(g, box(0.24, 0.012, 0.18), mat(STEEL, { metal: 0.5, rough: 0.4 }), -0.68, 0.068 + i * 0.014, 0.83, [0, 0.05 * i, 0]);
  drum(g, 0.7, 0.83, 0x8a5a2b);
  drum(g, -0.68, -0.83, 0x4b5545);
  drum(g, 0.7, -0.83, 0x8a5a2b);
  return lit({ group: g, heads: [], height: 1.2, hitH: 0.85, motion });
}

/** The airfield: a marked runway with edge lights, a hangar, a control tower whose radar turns, a windsock and fuel tanks. */
function airport(color: number): Model {
  const g = new THREE.Group();
  const steel = mat(0x7c8494, { metal: 0.3, rough: 0.5 });
  const trim = mat(GUNMETAL, { metal: 0.4, rough: 0.5 });
  const paint = mat(0xe5e7eb, { rough: 0.8 });
  slab(g, 1.9, 1.9, 0x30363f);
  kerb(g, 1.86, 1.86, trim);
  // Centre line and threshold bars.
  // The strip starts clear of the hangar and runs to the near edge.
  for (let i = 0; i < 5; i++) add(g, box(0.06, 0.012, 0.2), paint, -0.25, 0.066, -0.12 + i * 0.2);
  for (const z of [-0.28, 0.8]) add(g, box(1.0, 0.012, 0.04), mat(0xf59e0b, { rough: 0.8 }), -0.25, 0.066, z);
  // Edge lights down both sides of it.
  const lamp = glow(0x7dd3fc, 1.7);
  for (let i = 0; i < 5; i++) {
    for (const x of [-0.78, 0.28]) add(g, cyl(0.012, 0.012, 0.03, 6), trim, x, 0.075, -0.26 + i * 0.26);
    for (const x of [-0.78, 0.28]) add(g, sph(0.018, 6), lamp, x, 0.1, -0.26 + i * 0.26);
  }
  // The hangar: a box under an arch, with a dark mouth and lit windows.
  add(g, box(0.62, 0.26, 0.5), steel, -0.6, 0.19, -0.6);
  add(g, arch(0.31, 0.62), mat(0x9aa3b2, { metal: 0.3, rough: 0.5 }), -0.6, 0.32, -0.6, [0, 0, Math.PI / 2]);
  add(g, box(0.44, 0.22, 0.02), mat(DARK), -0.6, 0.17, -0.345);
  for (let i = 0; i < 4; i++) add(g, box(0.42, 0.012, 0.012), mat(0x3a4150), -0.6, 0.09 + i * 0.05, -0.338);
  add(g, box(0.62, 0.035, 0.04), mat(color, { rough: 0.5 }), -0.6, 0.3, -0.34);
  windowBandSide(g, -0.915, 0.2, 0.3, 0.05, -0.6);
  // The control tower: a shaft, a glazed cab, a radar that goes round and a beacon.
  add(g, cyl(0.07, 0.095, 0.5, 10), mat(0xa3aebd), 0.72, 0.31, -0.72);
  add(g, cyl(0.13, 0.11, 0.03, 12), trim, 0.72, 0.575, -0.72);
  add(g, cyl(0.125, 0.125, 0.13, 12), glow(0xbfe3ff, 0.8), 0.72, 0.655, -0.72);
  add(g, cyl(0.14, 0.13, 0.05, 12), mat(color, { rough: 0.5 }), 0.72, 0.745, -0.72);
  for (let i = 0; i < 6; i++) add(g, box(0.014, 0.13, 0.014), trim, 0.72 + Math.sin((i / 6) * Math.PI * 2) * 0.126, 0.655, -0.72 + Math.cos((i / 6) * Math.PI * 2) * 0.126);
  const radar = new THREE.Group();
  radar.userData.live = true;
  radar.position.set(0.72, 0.77, -0.72);
  add(radar, cyl(0.012, 0.012, 0.16, 6), trim, 0, 0.08, 0);
  add(radar, box(0.3, 0.08, 0.025), mat(0xdfe6f2, { metal: 0.4 }), 0, 0.18, 0, [0.2, 0, 0]);
  add(radar, sph(0.025, 6), glow(0xff5a5a, 1.8), 0, 0.23, 0);
  g.add(radar);
  // Fuel tanks on saddles, and the pipe that feeds the hangar.
  for (const z of [0.22, 0.5]) {
    add(g, cyl(0.1, 0.1, 0.26, 14), mat(0xb8c2d0, { rough: 0.35, metal: 0.5 }), 0.66, 0.2, z, [Math.PI / 2, 0, 0]);
    for (const dz of [-0.08, 0.08]) add(g, box(0.16, 0.08, 0.03), trim, 0.66, 0.1, z + dz);
    add(g, box(0.1, 0.012, 0.2), mat(color, { rough: 0.5 }), 0.66, 0.3, z);
  }
  // The windsock: a pole and a striped cone.
  add(g, cyl(0.01, 0.01, 0.36, 6), trim, 0.76, 0.24, 0.82);
  add(g, cone(0.042, 0.2, 8), mat(0xf97316), 0.85, 0.39, 0.82, [0, 0, -Math.PI / 2 - 0.15]);
  add(g, torus(0.03, 0.008), paint, 0.95, 0.405, 0.82, [0, Math.PI / 2, 0]);
  crates(g, -0.1, 0.9, 2);
  return lit({ group: g, heads: [], height: 1.0, hitH: 0.5, motion: [{ part: radar, axis: 'y', speed: 1.4 }] });
}

/** The gun turret: a stepped pedestal on a painted ring, and a head with a recoil sleeve and a brake at the muzzle. */
function turret(color: number, level: number): Model {
  const heavy = level >= 2;
  const g = new THREE.Group();
  const trim = mat(GUNMETAL, { metal: 0.4, rough: 0.5 });
  const len = heavy ? 0.56 : 0.46;
  add(g, box(0.74, 0.05, 0.74), mat(shade(color, 0.5), { rough: 0.9 }), 0, 0.025, 0);
  add(g, cyl(0.31, 0.33, 0.012, 24), mat(HAZARD, { rough: 0.6 }), 0, 0.052, 0);
  add(g, cyl(0.26, 0.3, 0.1, 14), trim, 0, 0.1, 0);
  add(g, cyl(0.19, 0.22, 0.06, 14), mat(shade(color, 0.6), { metal: 0.3 }), 0, 0.17, 0);
  add(g, box(0.14, 0.1, 0.1), mat(0x4b5545, { rough: 0.7 }), 0.27, 0.11, -0.2);
  const h = turretHead(color, heavy ? 2 : 1, len, heavy ? 0.026 : 0.024, false, (head) => {
    if (heavy) {
      add(head, box(0.2, 0.085, 0.12), mat(shade(color, 0.6), { metal: 0.3 }), 0, 0.05, 0.17);
      for (const o of [-0.05, 0.05]) add(head, cyl(0.038, 0.038, 0.04, 8), trim, o, 0.05, len + 0.07, [Math.PI / 2, 0, 0]);
      add(head, box(0.2, 0.1, 0.12), mat(HAZARD), 0, 0.14, -0.2);
    } else {
      add(head, cyl(0.042, 0.042, 0.12, 8), mat(shade(color, 0.6), { metal: 0.3 }), 0, 0.05, 0.17, [Math.PI / 2, 0, 0]);
      add(head, cyl(0.036, 0.036, 0.04, 8), trim, 0, 0.05, len + 0.07, [Math.PI / 2, 0, 0]);
      add(head, box(0.3, 0.03, 0.06), mat(shade(color, 0.55)), 0, 0.13, -0.16);
    }
    add(head, sph(0.02, 6), glow(0xffe9a8, 1.5), 0.1, 0.14, -0.08);
  });
  h.scale.setScalar(heavy ? 1.25 : 1);
  h.position.y = 0.2;
  g.add(h);
  return lit({ group: g, heads: [h], height: heavy ? 0.5 : 0.42 });
}

/** The anti-aircraft gun: a pedestal, a twin-barrelled head that aims high, and a range-finder that turns beside it. */
function aaGun(color: number, level: number): Model {
  const stinger = level >= 2;
  const g = new THREE.Group();
  const trim = mat(GUNMETAL, { metal: 0.4, rough: 0.5 });
  const steel = mat(GUNMETAL, { metal: 0.6, rough: 0.4 });
  add(g, box(0.74, 0.05, 0.74), mat(shade(color, 0.5), { rough: 0.9 }), 0, 0.025, 0);
  add(g, cyl(0.26, 0.31, 0.1, 14), trim, 0, 0.09, 0);
  add(g, cyl(0.27, 0.27, 0.012, 20), mat(HAZARD, { rough: 0.6 }), 0, 0.146, 0);
  add(g, box(0.08, 0.03, 0.08), trim, -0.17, 0.165, -0.14);
  add(g, box(0.08, 0.06, 0.02), trim, -0.17, 0.2, -0.18);
  const finder = new THREE.Group();
  finder.userData.live = true;
  finder.position.set(0.18, 0.14, -0.17);
  dish(finder, 0.06, mat(0xdfe6f2, { metal: 0.4 }), 0, 0, 0);
  g.add(finder);
  const h = new THREE.Group();
  h.userData.live = true;
  if (stinger) {
    add(h, box(0.2, 0.14, 0.22), mat(shade(color, 0.7), { metal: 0.3 }), 0, 0.02, -0.04);
    add(h, box(0.3, 0.16, 0.3), mat(0x4b5545, { metal: 0.3 }), 0, 0.14, 0.1, [Math.PI / 2 - 0.5, 0, 0]);
    for (const [x, y] of [[-0.07, 0.19], [0.07, 0.19], [-0.07, 0.28], [0.07, 0.28]]) {
      add(h, cyl(0.032, 0.032, 0.34, 8), mat(0x3f4639), x, y, 0.16, [Math.PI / 2 - 0.5, 0, 0]);
    }
  } else {
    add(h, box(0.2, 0.12, 0.2), mat(shade(color, 0.7), { metal: 0.3 }), 0, 0.04, -0.02);
    for (const o of [-0.05, 0.05]) {
      add(h, cyl(0.02, 0.02, 0.56, 8), steel, o, 0.26, 0.13, [Math.PI / 2 - 1.0, 0, 0]);
      add(h, cyl(0.03, 0.03, 0.04, 8), trim, o, 0.48, 0.22, [Math.PI / 2 - 1.0, 0, 0]);
    }
    // A drum magazine and a shoulder rest.
    add(h, cyl(0.06, 0.06, 0.1, 10), mat(0x4b5545), -0.13, 0.1, 0.04, [0, 0, Math.PI / 2]);
    add(h, box(0.14, 0.1, 0.1), mat(DARK), 0, 0.03, -0.2);
  }
  add(h, sph(0.016, 6), glow(0x7dd3fc, 1.6), 0.13, 0.1, 0.04);
  h.position.y = 0.17;
  g.add(h);
  return lit({ group: g, heads: [h], height: stinger ? 0.5 : 0.48, motion: [{ part: finder, axis: 'y', speed: 2.2 }] });
}

export function buildBuilding(key: BuildingKey, level: number, color: number): Model | null {
  switch (key) {
    case 'hq':
      return level >= 2 ? grandBase(color) : base(color);
    case 'powerPlant':
      return powerPlant(color);
    case 'factory':
      return factory(color);
    case 'barracks':
      return barracks(color);
    case 'warFactory':
      return warFactory(color);
    case 'airport':
      return airport(color);
    case 'turret':
      return turret(color, level);
    case 'aaGun':
      return aaGun(color, level);
    default:
      // The defense net is drawn as a force field by the view, not as a model.
      return null;
  }
}

// ---------------------------------------------------------------------------
// The houses and towers of the larger maps
// ---------------------------------------------------------------------------

/** A one-storey house: rendered walls under a tiled roof, a door, two lit windows and a chimney. */
function house(): Model {
  const g = new THREE.Group();
  const wall = mat(0xd9c7a3, { rough: 0.9 });
  const glass = glow(0xffe2a0, 0.55);
  add(g, box(0.8, 0.04, 0.8), mat(0x9c9484, { rough: 0.95 }), 0, 0.02, 0); // path and yard
  add(g, box(0.66, 0.34, 0.56), wall, 0, 0.21, 0);
  add(g, box(0.76, 0.05, 0.66), mat(0xb08968, { rough: 0.9 }), 0, 0.405, 0); // eaves
  add(g, gable(0.74, 0.24, 0.6), mat(0xa14d3a, { rough: 0.85 }), 0, 0.43, 0);
  add(g, box(0.14, 0.22, 0.02), mat(DARK), 0, 0.15, 0.285); // door
  add(g, box(0.16, 0.13, 0.016), mat(DARK), -0.2, 0.27, 0.285);
  add(g, box(0.136, 0.11, 0.01), glass, -0.2, 0.27, 0.293);
  add(g, box(0.16, 0.13, 0.016), mat(DARK), 0.2, 0.27, 0.285);
  add(g, box(0.136, 0.11, 0.01), glass, 0.2, 0.27, 0.293);
  add(g, box(0.08, 0.18, 0.08), mat(0x8a6552, { rough: 0.9 }), 0.2, 0.57, -0.12); // chimney
  // The flag goes on the ridge, at its front end, clear of the chimney.
  return lit({ group: g, heads: [], height: 0.68, flagAt: [0, 0.67, 0.18] });
}

/** A tower: six storeys of lit glass between concrete floors, a lift room on the roof and a mast with a beacon. */
function towerBlock(): Model {
  const g = new THREE.Group();
  const stone = mat(0xb9bec8, { rough: 0.85 });
  const glass = glow(0xbfe3ff, 0.5);
  add(g, box(0.8, 0.06, 0.8), mat(0x8b8f98, { rough: 0.95 }), 0, 0.03, 0);
  for (let i = 0; i < 6; i++) {
    add(g, box(0.62, 0.1, 0.62), stone, 0, 0.11 + i * 0.2, 0);
    add(g, box(0.6, 0.1, 0.6), glass, 0, 0.21 + i * 0.2, 0);
  }
  add(g, box(0.66, 0.05, 0.66), stone, 0, 1.315, 0); // roof slab
  add(g, box(0.26, 0.14, 0.22), mat(0x9aa0aa, { rough: 0.9 }), 0, 1.41, -0.1); // lift room
  mast(g, 0, 1.33, 0.2, 0.36);
  add(g, box(0.16, 0.2, 0.02), mat(DARK), 0, 0.16, 0.312); // doorway
  // The flag stands on the roof slab, front right, clear of the lift room and of the mast.
  return lit({ group: g, heads: [], height: 1.74, hitH: 1.4, flagAt: [0.24, 1.34, 0.22] });
}

/** One of the buildings that stand about the larger maps, for soldiers to move into. */
export function buildCity(kind: CityKind): Model {
  return kind === 'house' ? house() : towerBlock();
}

/** A flag on its pole, to fly over a building whose soldiers hold it. The pole stands at the group's origin. */
export function buildFlag(color: number): THREE.Group {
  const g = new THREE.Group();
  flag(g, color, 0, 0, 0);
  return g;
}

// ---------------------------------------------------------------------------
// Resource nodes
// ---------------------------------------------------------------------------

const NODE_COLORS: Record<ResourceKey, number> = { ore: 0xfbbf24, oil: 0xf97316, meat: 0xfb7185 };
const IRON = mat(0x737d8f, { rough: 0.85, metal: 0.3 });
const IRON_D = mat(0x69738a, { rough: 0.9, metal: 0.25 });
const IRON_L = mat(0x818b9d, { rough: 0.85, metal: 0.3 });
const WOOD = mat(0x8b5a2b, { rough: 0.9 });
const WOOD_D = mat(0x6b4423, { rough: 0.9 });

/** A cow: a white body under black patches, on four legs, with a tuft on its tail. */
function cow(g: THREE.Group, x: number, z: number, heading: number): void {
  const hide = mat(0xf8fafc, { rough: 0.8 });
  const patch = mat(0x1f2430, { rough: 0.8 });
  const hoof = mat(0xe7e5e4);
  const c = new THREE.Group();
  add(c, box(0.2, 0.11, 0.12), hide, 0, 0.13, 0);
  // The patches are slabs lying a few millimetres proud of the hide. A patch flush with the body
  // fights it for the same depth, and shimmers as soon as the eye moves.
  add(c, box(0.08, 0.07, 0.014), patch, -0.04, 0.13, 0.062);
  add(c, box(0.055, 0.06, 0.014), patch, 0.05, 0.135, -0.062);
  add(c, box(0.06, 0.014, 0.075), patch, 0.05, 0.183, 0);
  add(c, box(0.08, 0.08, 0.08), hide, 0.13, 0.17, 0);
  add(c, box(0.035, 0.035, 0.035), mat(0xf1d3b5), 0.155, 0.195, 0.03);
  add(c, box(0.035, 0.035, 0.035), mat(0xf1d3b5), 0.155, 0.195, -0.03);
  add(c, box(0.05, 0.04, 0.07), mat(0xf1c9b0), 0.17, 0.15, 0); // muzzle
  add(c, box(0.03, 0.02, 0.06), hide, 0.11, 0.22, 0); // ears
  add(c, cyl(0.008, 0.008, 0.12, 5), patch, -0.105, 0.12, 0, [0, 0, 0.25]); // tail
  for (const [lx, lz] of [[-0.07, -0.04], [0.07, -0.04], [-0.07, 0.04], [0.07, 0.04]]) add(c, box(0.025, 0.08, 0.025), hoof, lx, 0.04, lz);
  c.position.set(x, 0.03, z);
  c.rotation.y = heading;
  g.add(c);
}

const STRAW = 0xd9b85c;
/** A hay bale lying on its side, its axis along z. */
function bale(g: THREE.Group, x: number, z: number, y = 0.09): void {
  add(g, cyl(0.07, 0.07, 0.16, 12), mat(STRAW, { rough: 1 }), x, y, z, [Math.PI / 2, 0, 0]);
  add(g, cyl(0.072, 0.072, 0.012, 12), WOOD_D, x, y, z, [Math.PI / 2, 0, 0]);
}

/** A paddock fence along one side of the tile: posts and two rails, from (x0, z0) to (x1, z1). */
function fence(g: THREE.Group, x0: number, z0: number, x1: number, z1: number): void {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.16));
  for (let i = 0; i <= n; i++) add(g, box(0.025, 0.17, 0.025), WOOD, x0 + ((x1 - x0) * i) / n, 0.085, z0 + ((z1 - z0) * i) / n);
  const len = Math.hypot(x1 - x0, z1 - z0);
  const heading = Math.atan2(x1 - x0, z1 - z0);
  for (const y of [0.07, 0.13]) add(g, box(0.018, 0.018, len), WOOD_D, (x0 + x1) / 2, y, (z0 + z1) / 2, [0, heading, 0]);
}

export function buildNode(res: ResourceKey): Model {
  const g = new THREE.Group();
  const trim = mat(GUNMETAL, { metal: 0.4, rough: 0.5 });
  const motion: Motion[] = [];
  if (res === 'ore') {
    // A mine: ore-rich rock with crystals in it, a timber headframe over the entrance at the back, and a cart on rails running out of it.
    add(g, cyl(0.46, 0.46, 0.02, 20), mat(0x6b5a44, { rough: 1 }), 0, 0.01, 0);
    add(g, dodeca(0.2), IRON, -0.24, 0.17, 0.04);
    add(g, dodeca(0.15), IRON_L, 0.24, 0.13, 0.14);
    add(g, dodeca(0.12), IRON_D, 0.22, 0.1, -0.22);
    add(g, dodeca(0.09), IRON_D, -0.2, 0.1, 0.3);
    const crystal = glow(NODE_COLORS.ore, 0.55);
    for (const [x, y, z] of [[-0.22, 0.3, 0.06], [0.28, 0.2, 0.16], [0.24, 0.17, -0.28], [-0.26, 0.14, 0.3], [-0.34, 0.12, -0.08]]) {
      add(g, octa(0.055), crystal, x, y, z).scale.set(0.7, 1.4, 0.7);
    }
    // The adit: a dark doorway in a timber frame.
    add(g, box(0.3, 0.26, 0.05), mat(DARK), 0, 0.14, -0.4);
    for (const x of [-0.18, 0.18]) add(g, box(0.04, 0.3, 0.04), WOOD, x, 0.15, -0.37);
    add(g, box(0.42, 0.045, 0.045), WOOD, 0, 0.315, -0.37);
    add(g, box(0.42, 0.012, 0.04), WOOD_D, 0, 0.345, -0.37);
    // Rails running out of it, sleepers under them, and a cart of ore.
    for (const x of [-0.06, 0.06]) add(g, box(0.012, 0.012, 0.62), mat(STEEL, { metal: 0.6, rough: 0.4 }), x, 0.03, -0.04);
    for (let i = 0; i < 5; i++) add(g, box(0.2, 0.012, 0.03), WOOD_D, 0, 0.022, -0.3 + i * 0.13);
    add(g, box(0.16, 0.08, 0.12), mat(0x5b6678, { metal: 0.4, rough: 0.6 }), 0, 0.085, 0.2);
    add(g, dodeca(0.045), IRON_L, -0.03, 0.13, 0.19);
    add(g, dodeca(0.04), IRON, 0.04, 0.13, 0.22);
    for (const x of [-0.08, 0.08]) for (const z of [0.16, 0.24]) add(g, cyl(0.022, 0.022, 0.012, 8), mat(TREAD), x, 0.035, z, [0, 0, Math.PI / 2]);
    // A lamp over the entrance and a pick leaning on the frame.
    add(g, sph(0.02, 6), glow(0xfde68a, 1.4), 0, 0.29, -0.35);
    limb(g, [0.2, 0.02, -0.34], [0.3, 0.34, -0.37], 0.008, WOOD_D);
    add(g, box(0.12, 0.02, 0.02), mat(STEEL, { metal: 0.6 }), 0.3, 0.35, -0.37, [0, 0, 0.2]);
  } else if (res === 'oil') {
    // An oil field: a black pool, a nodding pump jack over the wellhead, a lattice derrick and a stock tank.
    const orange = mat(0xea580c, { rough: 0.55, metal: 0.2 });
    const steel = mat(GUNMETAL, { metal: 0.5, rough: 0.5 });
    add(g, cyl(0.45, 0.45, 0.03, 24), mat(0x12151c, { rough: 0.12, metal: 0.2 }), 0, 0.015, 0);
    add(g, cyl(0.27, 0.27, 0.012, 20), mat(0x1e2635, { rough: 0.05, metal: 0.3 }), 0.06, 0.035, 0.04);
    add(g, cyl(0.09, 0.09, 0.008, 16), mat(0x2b3650, { rough: 0.04, metal: 0.35 }), -0.14, 0.042, 0.02);
    // The pump jack: an A-frame on a base plate, the gearbox and motor, and the walking beam on the crown.
    add(g, box(0.32, 0.035, 0.24), steel, -0.12, 0.037, 0.06);
    for (const [dx, dz] of [[-0.1, -0.09], [-0.1, 0.09], [0.08, -0.09], [0.08, 0.09]]) limb(g, [-0.12 + dx, 0.05, 0.06 + dz], [-0.12, 0.44, 0.06], 0.013, orange);
    add(g, box(0.1, 0.1, 0.12), steel, -0.12, 0.13, 0.06);
    add(g, cyl(0.032, 0.032, 0.12, 8), orange, -0.12, 0.13, 0.18, [Math.PI / 2, 0, 0]);
    const beam = new THREE.Group();
    beam.userData.live = true;
    beam.position.set(-0.12, 0.46, 0.06);
    add(beam, box(0.5, 0.035, 0.04), orange, 0, 0, 0);
    add(beam, box(0.06, 0.15, 0.05), orange, 0.25, -0.045, 0);
    add(beam, cyl(0.01, 0.01, 0.3, 6), steel, 0.27, -0.22, 0);
    add(beam, box(0.06, 0.13, 0.03), orange, -0.2, -0.06, 0.03);
    add(beam, cyl(0.065, 0.065, 0.03, 12), steel, -0.2, -0.13, 0, [Math.PI / 2, 0, 0]);
    g.add(beam);
    motion.push({ part: beam, axis: 'z', speed: 1.7, swing: 0.17 });
    // The wellhead it nods over, and the flow line running off to the tank.
    add(g, cyl(0.04, 0.05, 0.12, 8), steel, 0.15, 0.08, 0.06);
    add(g, cyl(0.052, 0.052, 0.02, 8), trim, 0.15, 0.11, 0.06);
    add(g, cyl(0.014, 0.014, 0.3, 6), steel, 0.15, 0.05, -0.12, [Math.PI / 2, 0, 0]);
    // The derrick: four legs drawn in to a crown, with braces at two levels.
    const foot: Array<[number, number]> = [[-0.1, -0.1], [-0.1, 0.1], [0.1, -0.1], [0.1, 0.1]];
    for (const [dx, dz] of foot) limb(g, [0.22 + dx, 0, -0.22 + dz], [0.22, 0.66, -0.22], 0.009, orange);
    for (const [y, r] of [[0.22, 0.068], [0.44, 0.035]]) {
      for (let i = 0; i < 4; i++) {
        const a = foot[i];
        const b = foot[(i + 1) % 4];
        limb(g, [0.22 + (a[0] * r) / 0.1, y, -0.22 + (a[1] * r) / 0.1], [0.22 + (b[0] * r) / 0.1, y, -0.22 + (b[1] * r) / 0.1], 0.006, orange);
      }
    }
    add(g, box(0.05, 0.04, 0.05), steel, 0.22, 0.68, -0.22);
    // The stock tank, with a ladder up its side.
    add(g, cyl(0.1, 0.1, 0.2, 16), mat(0x9aa6b6, { rough: 0.5, metal: 0.4 }), -0.22, 0.1, -0.24);
    add(g, dome(0.1, 16), mat(0xb8c2d0, { rough: 0.45, metal: 0.4 }), -0.22, 0.2, -0.24);
    add(g, torus(0.1, 0.01), trim, -0.22, 0.2, -0.24, [Math.PI / 2, 0, 0]);
    for (const dx of [-0.018, 0.018]) add(g, box(0.006, 0.22, 0.006), trim, -0.22 + dx, 0.11, -0.14);
    for (let i = 0; i < 5; i++) add(g, box(0.04, 0.005, 0.006), trim, -0.22, 0.03 + i * 0.042, -0.14);
    add(g, sph(0.022, 6), glow(0xfde68a, 1.6), 0.22, 0.72, -0.22);
  } else {
    // A ranch: a barn, a wind pump, a fenced paddock with hay, a trough and the herd.
    add(g, cyl(0.46, 0.46, 0.02, 20), mat(0x7fb24a, { rough: 1 }), 0, 0.01, 0);
    const red = mat(0xb91c1c, { rough: 0.7 });
    add(g, box(0.3, 0.2, 0.24), red, -0.14, 0.12, -0.14);
    add(g, gable(0.3, 0.12, 0.26), mat(0x6b1d1d), -0.14, 0.22, -0.14);
    add(g, box(0.1, 0.12, 0.012), mat(0x5b1414), -0.14, 0.08, -0.013);
    add(g, box(0.04, 0.04, 0.012), mat(0xf8fafc), -0.14, 0.25, -0.013); // the hayloft door
    add(g, octa(0.03), glow(0xfde68a, 1.2), -0.14, 0.29, -0.013).scale.set(1, 1, 0.3); // the barn star
    // The wind pump: a four-legged tower, a rotor of eight sails and a tail vane.
    const steel = mat(0x8d99aa, { metal: 0.5, rough: 0.5 });
    const px = 0.18;
    const pz = -0.16;
    for (const [dx, dz] of [[-0.075, -0.075], [-0.075, 0.075], [0.075, -0.075], [0.075, 0.075]]) limb(g, [px + dx, 0.02, pz + dz], [px, 0.5, pz], 0.008, steel);
    for (const [y, r] of [[0.18, 0.048], [0.34, 0.023]]) {
      const c: Array<[number, number]> = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
      for (let i = 0; i < 4; i++) limb(g, [px + c[i][0] * r, y, pz + c[i][1] * r], [px + c[(i + 1) % 4][0] * r, y, pz + c[(i + 1) % 4][1] * r], 0.004, steel);
    }
    add(g, cyl(0.03, 0.03, 0.1, 8), trim, px, 0.55, pz, [Math.PI / 2, 0, 0]);
    const rotor = new THREE.Group();
    rotor.userData.live = true;
    rotor.position.set(px, 0.55, pz + 0.07);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      add(rotor, box(0.022, 0.1, 0.004), steel, -Math.sin(a) * 0.1, Math.cos(a) * 0.1, 0, [0, 0, a]);
    }
    add(rotor, cyl(0.022, 0.022, 0.03, 8), trim, 0, 0, 0, [Math.PI / 2, 0, 0]);
    g.add(rotor);
    motion.push({ part: rotor, axis: 'z', speed: 2.4 });
    add(g, box(0.14, 0.09, 0.006), mat(0xb91c1c, { rough: 0.7 }), px, 0.57, pz - 0.1);
    add(g, cyl(0.008, 0.008, 0.1, 5), trim, px, 0.55, pz - 0.07, [Math.PI / 2, 0, 0]);
    // The paddock: fenced on three sides, a trough by the gate, hay in the corner.
    fence(g, -0.4, 0.42, 0.42, 0.42);
    fence(g, 0.42, 0.42, 0.42, -0.4);
    fence(g, -0.4, 0.42, -0.4, 0.06);
    add(g, box(0.18, 0.05, 0.06), WOOD_D, 0.12, 0.045, 0.36);
    add(g, box(0.15, 0.01, 0.04), mat(0x3b82f6, { rough: 0.1, metal: 0.2 }), 0.12, 0.062, 0.36);
    bale(g, 0.16, -0.24);
    bale(g, 0.32, -0.24);
    bale(g, 0.24, -0.24, 0.2);
    cow(g, 0.12, 0.12, 0.7);
    cow(g, -0.08, 0.2, -0.5);
  }
  return done({ group: g, heads: [], height: 0.5, motion });
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
  aura.userData.keep = true;
  aura.geometry.userData.owned = true;
  (aura.material as THREE.Material).userData.owned = true;
  g.add(aura);
  g.userData.aura = aura;
  return done({ group: g, heads: [], height: 1.15 });
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
  return done({ group: g, heads: [], height: 0.72 * scale });
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
  return done({ group: g, heads: [], height: 0.9 });
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
  main.userData.live = true;
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
  sub.userData.live = true;
  add(sub, box(0.26, 0.1, 0.26), armour, 0, 0.05, 0);
  add(sub, cyl(0.024, 0.024, 0.5, 8), steel, 0, 0.06, 0.36, [Math.PI / 2, 0, 0]);
  sub.position.set(0, 0.64, -0.32);
  g.add(sub);
  add(g, cyl(0.008, 0.008, 0.5, 6), mat(STEEL, { metal: 0.6 }), -0.22, 0.9, -0.42);
  add(g, sph(0.03, 8), trim, -0.22, 1.16, -0.42);
  return done({ group: g, heads: [main, sub], height: 1.0 });
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
  aura.userData.keep = true;
  aura.geometry.userData.owned = true;
  (aura.material as THREE.Material).userData.owned = true;
  g.add(aura);
  g.userData.aura = aura;
  return done({ group: g, heads: [], height: 0.82 });
}

/** The model of whichever alien turned up, in whichever shape it is in. */
export function buildAlien(key: AlienKey, form = 1): Model {
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
    case 'tuolong':
      return form === 2 ? dragon() : dinosaur();
    case 'zecan':
      return rockGiant(form === 2 ? 0.62 : 1);
    case 'yaqian':
      return goddess();
  }
}

/** One of the aliens' small fry: a spider 奎德 hatched, or a skeleton 雅千 raised. */
export function buildMinion(kind: MinionKind): Model {
  return kind === 'skeleton' ? skeleton() : spider(0.38);
}

/** 拓龙 as it first shows itself: a green dinosaur up on two legs, its jaws towards +Z. */
function dinosaur(): Model {
  const g = new THREE.Group();
  const skin = mat(0x22a55a, { rough: 0.55 });
  const belly = mat(0xa7e08f, { rough: 0.7 });
  const dark = mat(0x15803d, { rough: 0.6 });
  const claw = mat(0xf3f4d8, { rough: 0.5 });
  const eye = glow(0xfde047, 1.8);
  // Legs: a thick thigh, a shin, and a foot with three claws.
  for (const side of [-1, 1]) {
    add(g, cap(0.085, 0.14), skin, side * 0.16, 0.34, -0.08, [0.3, 0, side * 0.1]);
    limb(g, [side * 0.2, 0.26, -0.02], [side * 0.21, 0.07, 0.08], 0.045, skin);
    add(g, box(0.12, 0.05, 0.24), skin, side * 0.21, 0.035, 0.14);
    for (const t of [-0.04, 0, 0.04]) add(g, cone(0.015, 0.07, 5), claw, side * 0.21 + t, 0.03, 0.29, [Math.PI / 2, 0, 0]);
  }
  // Heavy at the hips, lighter at the chest, pale underneath.
  add(g, sph(0.24, 14), skin, 0, 0.5, -0.1).scale.set(1, 0.9, 1.35);
  add(g, sph(0.18, 12), skin, 0, 0.63, 0.2).scale.set(0.95, 1, 1.1);
  add(g, sph(0.15, 12), belly, 0, 0.5, 0.14).scale.set(0.9, 0.9, 1.25);
  // The tail, in three lengths, tapering away behind.
  add(g, cone(0.13, 0.5, 8), skin, 0, 0.42, -0.52, [-Math.PI / 2 - 0.28, 0, 0]);
  add(g, cone(0.075, 0.45, 8), skin, 0, 0.3, -0.88, [-Math.PI / 2 - 0.12, 0, 0]);
  add(g, cone(0.04, 0.3, 8), dark, 0, 0.24, -1.16, [-Math.PI / 2, 0, 0]);
  // Little arms, claws at the ready.
  for (const side of [-1, 1]) {
    limb(g, [side * 0.15, 0.63, 0.26], [side * 0.21, 0.5, 0.4], 0.028, skin);
    for (const t of [-0.02, 0.02]) add(g, cone(0.01, 0.05, 5), claw, side * 0.21 + t, 0.48, 0.44, [Math.PI / 2, 0, 0]);
  }
  // The head on a short neck: long jaws, a row of teeth, an eye on each side.
  limb(g, [0, 0.7, 0.26], [0, 0.86, 0.42], 0.085, skin);
  add(g, sph(0.13, 12), skin, 0, 0.9, 0.48).scale.set(1, 0.9, 1.15);
  add(g, box(0.16, 0.07, 0.32), skin, 0, 0.87, 0.66);
  add(g, box(0.13, 0.045, 0.28), belly, 0, 0.8, 0.65);
  for (let i = 0; i < 4; i++) for (const side of [-1, 1]) add(g, cone(0.013, 0.04, 4), claw, side * 0.06, 0.83, 0.58 + i * 0.06, [Math.PI, 0, 0]);
  for (const side of [-1, 1]) {
    add(g, sph(0.032, 8), eye, side * 0.1, 0.95, 0.57);
    add(g, sph(0.014, 6), mat(0x111827), side * 0.122, 0.95, 0.585);
    add(g, sph(0.012, 6), dark, side * 0.045, 0.905, 0.81);
  }
  // Plates down its back.
  for (let i = 0; i < 5; i++) add(g, cone(0.05 - i * 0.005, 0.1 - i * 0.01, 4), dark, 0, 0.84 - i * 0.085, 0.2 - i * 0.16, [-0.3, 0.44, 0]);
  add(g, torus(0.6, 0.014), glow(0x22c55e, 1.4), 0, 0.04, 0, [Math.PI / 2, 0, 0]);
  return done({ group: g, heads: [], height: 1.1 });
}

/** A wing's membrane: a triangle with its root along z, from `front` to `back`, sweeping out to `reach` on side `side`. */
const sail = (reach: number, front: number, back: number, side: number): THREE.BufferGeometry =>
  cached(`m${reach},${front},${back},${side}`, () => {
    const s = new THREE.Shape();
    s.moveTo(0, front);
    s.lineTo(side * reach, back + 0.08);
    s.lineTo(0, back);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: false }).translate(0, 0, -0.007).rotateX(Math.PI / 2);
  });

/**
 * 拓龙 once its first shape has gone down: a black dragon hanging in the air
 * on beating wings, fire in its jaws. The wings swing at the shoulders.
 */
function dragon(): Model {
  const g = new THREE.Group();
  const scale = mat(0x15161c, { rough: 0.4, metal: 0.35, emissive: 0x1c0a0a, glow: 0.7 });
  const membrane = mat(0x5b1f2c, { rough: 0.5, metal: 0.15, emissive: 0x991b1b, glow: 0.8, opacity: 0.94 });
  const spine = mat(0x3b3b47, { rough: 0.4, metal: 0.4 });
  const fire = glow(0xff6b35, 2.4);
  const motion: Motion[] = [];
  // Wings: the bones and the skin between them, spread about the shoulder and held a little raised.
  for (const side of [-1, 1]) {
    const w = new THREE.Group();
    w.userData.live = true;
    add(w, sail(0.86, 0.14, -0.3, side), membrane);
    add(w, sail(0.5, -0.2, -0.56, side), membrane);
    add(w, sail(0.24, -0.36, -0.62, side), membrane);
    limb(w, [0, 0.015, 0.14], [side * 0.86, 0.015, -0.22], 0.028, scale);
    limb(w, [0, 0.015, 0.02], [side * 0.5, 0.015, -0.48], 0.02, scale);
    limb(w, [0, 0.015, -0.1], [side * 0.24, 0.015, -0.6], 0.018, scale);
    w.position.set(side * 0.13, 0.52, 0);
    // Raised at rest, so that they show from above as much as from the side.
    w.rotation.z = side * 0.24;
    g.add(w);
    // The two beat as one: the same swing, read mirrored on the other side.
    motion.push({ part: w, axis: 'z', speed: 3.6, swing: 0.36, phase: side > 0 ? 0 : Math.PI });
  }
  // Body, chest, a long neck and the head with its jaws of fire.
  add(g, sph(0.2, 14), scale, 0, 0.5, -0.08).scale.set(1, 0.85, 1.7);
  add(g, sph(0.15, 12), scale, 0, 0.56, 0.32);
  limb(g, [0, 0.58, 0.38], [0, 0.88, 0.64], 0.07, scale);
  add(g, sph(0.12, 12), scale, 0, 0.96, 0.74).scale.set(1, 0.85, 1.35);
  add(g, box(0.13, 0.05, 0.24), scale, 0, 0.9, 0.94);
  add(g, sph(0.04, 8), fire, 0, 0.93, 1.05);
  for (const side of [-1, 1]) {
    add(g, sph(0.028, 8), glow(0xff2d55, 2.4), side * 0.085, 1.02, 0.82);
    add(g, cone(0.018, 0.15, 6), spine, side * 0.05, 1.08, 0.6, [-2.5, 0, side * 0.3]);
  }
  // The tail, and a fin at the end of it.
  add(g, cone(0.12, 0.55, 8), scale, 0, 0.44, -0.66, [-Math.PI / 2 - 0.1, 0, 0]);
  add(g, cone(0.06, 0.5, 8), scale, 0, 0.32, -1.1, [-Math.PI / 2 - 0.05, 0, 0]);
  add(g, sail(0.16, 0.1, -0.14, 1), membrane, 0.0, 0.28, -1.34, [0, 0, 0]).scale.set(1, 1, 1);
  // Legs tucked up under it.
  for (const side of [-1, 1]) {
    limb(g, [side * 0.13, 0.42, 0.1], [side * 0.22, 0.2, 0.2], 0.04, scale);
    add(g, sph(0.05, 8), spine, side * 0.22, 0.18, 0.22);
  }
  // Spines along its back.
  for (let i = 0; i < 6; i++) add(g, cone(0.03, 0.09, 4), spine, 0, 0.72 - Math.abs(i - 2) * 0.03, 0.3 - i * 0.17, [-0.25, 0.44, 0]);
  return done({ group: g, heads: [], height: 1.2, motion });
}

/** 泽参: a giant heaped up out of boulders, with fire in its cracks. Scaled down it is one of the small ones. */
function rockGiant(scale: number): Model {
  const g = new THREE.Group();
  const rock = mat(0x74736a, { rough: 0.95, metal: 0.02 });
  const rockD = mat(0x54534d, { rough: 0.95 });
  const rockL = mat(0x8f8e84, { rough: 0.9 });
  const magma = glow(0xff8a3d, 1.7);
  const eye = glow(0xffd166, 2.2);
  // Squat legs.
  for (const side of [-1, 1]) {
    add(g, dodeca(0.15), rockD, side * 0.2, 0.2, 0).scale.set(0.9, 1.15, 0.9);
    add(g, box(0.22, 0.1, 0.3), rockD, side * 0.2, 0.05, 0.05);
  }
  // The torso, a heap of boulders broad at the shoulders.
  add(g, dodeca(0.34), rock, 0, 0.58, 0).scale.set(1.15, 1, 0.82);
  add(g, dodeca(0.2), rockL, -0.19, 0.74, 0.1);
  add(g, dodeca(0.18), rockL, 0.21, 0.72, 0.1);
  add(g, dodeca(0.15), rockD, 0.02, 0.5, 0.22);
  // Fire showing through the cracks.
  add(g, box(0.022, 0.24, 0.022), magma, -0.09, 0.6, 0.29, [0, 0, 0.35]);
  add(g, box(0.022, 0.17, 0.022), magma, 0.1, 0.54, 0.29, [0, 0, -0.3]);
  add(g, box(0.022, 0.022, 0.2), magma, 0.0, 0.68, 0.24);
  // Arms like tree trunks, down to the ground, ending in boulders.
  for (const side of [-1, 1]) {
    add(g, dodeca(0.15), rockD, side * 0.45, 0.68, 0).scale.set(1, 1.2, 1);
    add(g, dodeca(0.12), rock, side * 0.51, 0.4, 0.05).scale.set(0.9, 1.5, 0.9);
    add(g, dodeca(0.18), rockL, side * 0.53, 0.16, 0.12);
  }
  // A small head sunk between the shoulders.
  add(g, dodeca(0.12), rockD, 0, 0.93, 0.08);
  for (const side of [-1, 1]) add(g, sph(0.024, 6), eye, side * 0.052, 0.95, 0.18);
  add(g, torus(0.66, 0.014), glow(0xff8a3d, 1.1), 0, 0.04, 0, [Math.PI / 2, 0, 0]);
  g.scale.setScalar(scale);
  return done({ group: g, heads: [], height: 1.08 * scale });
}

/** 雅千: a goddess in white, hanging in the air inside a ball of light, a halo over her head. */
function goddess(): Model {
  const g = new THREE.Group();
  const robe = mat(0xf8fafc, { emissive: 0xcbd5f5, glow: 0.5, rough: 0.5 });
  const skin = mat(0xffe9d6, { rough: 0.6 });
  const hair = mat(0xeef2ff, { emissive: 0xa5b4fc, glow: 0.7, rough: 0.4 });
  const gold = mat(0xfbbf24, { metal: 0.7, rough: 0.3, emissive: 0xb45309, glow: 0.7 });
  // The robe falling away under her, a belt, a sash of gold.
  add(g, cone(0.21, 0.64, 16), robe, 0, 0.42, 0);
  add(g, cyl(0.078, 0.095, 0.22, 10), robe, 0, 0.84, 0);
  add(g, torus(0.105, 0.014), gold, 0, 0.76, 0, [Math.PI / 2, 0, 0]);
  // Arms held out a little, the hands open.
  for (const side of [-1, 1]) {
    add(g, cap(0.026, 0.16), robe, side * 0.125, 0.87, 0.02, [0, 0, side * 1.05]);
    add(g, sph(0.03, 8), skin, side * 0.215, 0.93, 0.02);
  }
  // Head and face, hair drawn up and falling down her back.
  add(g, sph(0.12, 16), skin, 0, 1.08, 0);
  for (const side of [-1, 1]) add(g, sph(0.017, 8), mat(0x4c1d95), side * 0.045, 1.09, 0.106);
  const capGeo = new THREE.SphereGeometry(0.133, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
  add(g, capGeo, hair, 0, 1.09, -0.01, [-0.35, 0, 0]);
  add(g, sph(0.052, 8), hair, 0, 1.2, -0.03);
  add(g, cyl(0.05, 0.09, 0.52, 8), hair, 0, 0.86, -0.13, [0.12, 0, 0]);
  // Wings of light, and the halo.
  for (const side of [-1, 1]) add(g, cone(0.1, 0.52, 4), mat(0xffffff, { emissive: 0xe0e7ff, glow: 1, opacity: 0.4 }), side * 0.22, 0.84, -0.12, [0, 0, side * 2.25]).scale.set(1, 1, 0.22);
  add(g, torus(0.21, 0.012), glow(0xffffff, 1.6), 0, 1.33, 0, [Math.PI / 2, 0, 0]);
  // The shield itself: a ball of white light round the whole of her.
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(0.66, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.17, depthWrite: false }),
  );
  shield.position.y = 0.76;
  shield.userData.keep = true;
  shield.geometry.userData.owned = true;
  (shield.material as THREE.Material).userData.owned = true;
  g.add(shield);
  g.userData.aura = shield;
  return done({ group: g, heads: [], height: 1.42 });
}

/** One of 雅千's skeletons: a small figure of bone with a rusty blade. */
function skeleton(): Model {
  const g = new THREE.Group();
  const bone = mat(0xe7e5d8, { rough: 0.6 });
  const dark = mat(0x1f2430);
  // Rib cage and spine, a skull with hollow eyes.
  add(g, cyl(0.014, 0.014, 0.2, 6), bone, 0, 0.31, 0);
  for (let i = 0; i < 3; i++) add(g, torus(0.045, 0.008), bone, 0, 0.27 + i * 0.035, 0, [Math.PI / 2, 0, 0]);
  add(g, sph(0.06, 10), bone, 0, 0.47, 0);
  add(g, box(0.055, 0.028, 0.04), bone, 0, 0.42, 0.025);
  for (const side of [-1, 1]) add(g, sph(0.016, 6), dark, side * 0.025, 0.475, 0.05);
  // Legs and arms, and a blade in one hand.
  for (const side of [-1, 1]) {
    limb(g, [side * 0.03, 0.22, 0], [side * 0.055, 0.01, 0.02], 0.012, bone);
    limb(g, [side * 0.045, 0.38, 0], [side * 0.085, 0.27, 0.05], 0.01, bone);
  }
  add(g, box(0.02, 0.02, 0.2), mat(0x9aa2b1, { metal: 0.6, rough: 0.4 }), 0.1, 0.25, 0.14, [0.25, 0, 0]);
  return done({ group: g, heads: [], height: 0.55 });
}
