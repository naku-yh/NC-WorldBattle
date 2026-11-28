import * as THREE from 'three';
import { ALIENS, BUILDINGS, SPIDERLING, UNITS } from '../game/data';
import { alienById, buildingById, canStillAct, spiderById, statsOf, unitById } from '../game/engine';
import { DEPOT_LOCAL, supplyRoute, tilesOf, toLocal, toWorld, zoneSize } from '../game/board';
import type { AlienState, Building, GameEvent, GameState, PlayerState, Pt, Spiderling, Unit } from '../game/types';
import { ShieldDome } from './dome';
import { Floaters, Fx } from './fx';
import { buildAlien, buildBuilding, buildNode, buildSpiderling, buildTruck, buildUnit, cargoMaterial, scrap, type Model, type TruckModel } from './models';
import { Plumes, type Steam } from './plumes';
import { HIGHLIGHT, Scene, worldOf } from './scene';

type Kind = 'unit' | 'building' | 'alien' | 'spider';
interface Ref {
  kind: Kind;
  id: number;
}
interface PendingHit {
  amount: number;
  lethal: boolean;
  shown: boolean;
}

const keyOf = (r: Ref): string => `${r.kind}:${r.id}`;
/** Aliens and spiders are drawn in their own colours, on the board and in the effects. */
const tintOf = (hex: string): number => parseInt(hex.slice(1), 16);
const SPIDER_TINT = 0xe879f9;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const facing = new THREE.Quaternion();
/**
 * Turns `part`, which hangs inside `root`, to face the camera. The root is
 * itself turned (a unit faces where it is heading), so the part has to take
 * that turn out first: otherwise a mark over a unit would swing round with it
 * and end up edge-on, a sliver instead of a triangle.
 */
function faceCamera(part: THREE.Object3D, root: THREE.Object3D, camQ: THREE.Quaternion): void {
  part.quaternion.copy(facing.copy(root.quaternion).invert().multiply(camQ));
}
/** Height of the invisible box that catches mouse clicks for a model. */
const hitH = (m: Model): number => Math.max(0.45, m.hitH ?? m.height) + 0.25;
/** Shortest-path angle interpolation. */
function turn(current: number, target: number, k: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + d * k;
}

const HIT_MAT = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

/** A triangle in the xy-plane, so wide at `top` and meeting at `tip` below. */
function triangle(half: number, top: number, tip: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-half, top);
  shape.lineTo(half, top);
  shape.lineTo(0, tip);
  shape.closePath();
  return shape;
}

// The mark over whatever is selected: a green triangle pointing down at it, edged in dark so that
// it reads against grass and against concrete alike. One shape for everyone; only where it hangs differs.
const MARK_EDGE = new THREE.ShapeGeometry(triangle(0.15, 0.022, -0.185));
const MARK_FILL = new THREE.ShapeGeometry(triangle(0.12, 0.0, -0.15));
const MARK_EDGE_MAT = new THREE.MeshBasicMaterial({ color: 0x052e12, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
const MARK_FILL_MAT = new THREE.MeshBasicMaterial({ color: 0x4ade80, depthTest: false, depthWrite: false, side: THREE.DoubleSide });

/** The selection mark, hanging from an entity's root. It starts hidden; the frame loop places it. */
function selectionMark(): THREE.Group {
  const g = new THREE.Group();
  const edge = new THREE.Mesh(MARK_EDGE, MARK_EDGE_MAT);
  edge.renderOrder = 92;
  const fill = new THREE.Mesh(MARK_FILL, MARK_FILL_MAT);
  fill.renderOrder = 93;
  g.add(edge, fill);
  g.visible = false;
  return g;
}

/** How high the circle of a weapon's reach lies above the board: over the tile highlights and their outlines, like the selection ring. */
const REACH_Y = 0.1;
/** The reach of a unit or gun belonging to the player whose turn it is, and of everyone else's. */
const OWN_REACH = 0xf5b83d;
const FOE_REACH = 0xef4444;

/**
 * The circle drawn on the ground round whatever is selected or looked at,
 * showing how far its weapon reaches: a faint wash over the ground inside it
 * and a bright band on the rim. The circle is only drawn again when its radius
 * changes; it follows its unit round the board every frame.
 */
class ReachRing {
  readonly group = new THREE.Group();
  private wash = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.06, depthWrite: false });
  private ink = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92, depthWrite: false });
  private inside = new THREE.Mesh(new THREE.BufferGeometry(), this.wash);
  private band = new THREE.Mesh(new THREE.BufferGeometry(), this.ink);
  private radius = 0;

  constructor() {
    for (const m of [this.inside, this.band]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 4;
      this.group.add(m);
    }
    this.group.position.y = REACH_Y;
    this.group.visible = false;
  }

  /** Puts the circle up, `r` world units across from the middle, in the colour of whose reach it is; `null` takes it down. */
  set(r: number | null, color: number): void {
    if (r === null) {
      this.group.visible = false;
      this.radius = 0;
      return;
    }
    this.group.visible = true;
    this.wash.color.setHex(color);
    this.ink.color.setHex(color);
    if (r === this.radius) return;
    this.radius = r;
    this.inside.geometry.dispose();
    this.band.geometry.dispose();
    this.inside.geometry = new THREE.CircleGeometry(r, 96);
    this.band.geometry = new THREE.RingGeometry(r - 0.045, r + 0.045, 128);
  }

  /** The band breathes, slowly, so that the eye finds it on grass and on concrete alike. */
  tick(clock: number): void {
    if (this.group.visible) this.ink.opacity = 0.8 + Math.sin(clock * 2.6) * 0.16;
  }

  dispose(): void {
    this.inside.geometry.dispose();
    this.band.geometry.dispose();
    this.wash.dispose();
    this.ink.dispose();
  }
}

/**
 * Stone-coloured stand-ins for the materials a spent unit is shown in: one
 * per material, shared the way the materials themselves are. Each keeps a
 * shade of how light or dark the colour it stands in for was, so that a tank
 * in stone is still a tank and not one grey lump.
 */
const stone = new WeakMap<THREE.Material, THREE.Material>();
function stoneOf(m: THREE.Material): THREE.Material {
  let s = stone.get(m);
  if (!s) {
    if (m instanceof THREE.MeshStandardMaterial) {
      const hex = m.color.getHex();
      const tone = (0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.1144 * (hex & 255)) / 255;
      const grey = Math.round(255 * (0.26 + 0.5 * tone));
      const copy = m.clone();
      copy.color.setHex((grey << 16) | (grey << 8) | grey);
      copy.emissive.setHex(0x000000);
      // Nothing left to gleam: dull and unmetallic, like carved stone.
      copy.roughness = 0.92;
      copy.metalness = 0.02;
      copy.envMapIntensity = 0.25;
      s = copy;
    } else s = m;
    stone.set(m, s);
  }
  return s;
}

/**
 * Little health bar that always faces the camera: what is left, in green, amber
 * or red, over what is gone in dark red, inside a pale frame. The three layers
 * must all be drawn in the same pass and in that order. The fill used to be the
 * only opaque one of them, which meant it was drawn first and the translucent
 * backing was laid over it: whatever was left of the health, the bar read as a
 * dark smudge.
 */
class HpBar {
  readonly group = new THREE.Group();
  ratio = 1;
  private fill: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private w: number;

  /** How tall the bar is; the fill leaves a margin inside it. */
  private static readonly h = 0.1;

  constructor(w: number) {
    this.w = w;
    // The plane and every ink belong to this one entity (see `scrap`).
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.userData.owned = true;
    const layer = (color: number, opacity: number, order: number, width: number, height: number): THREE.Mesh => {
      const ink = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
      ink.userData.owned = true;
      const mesh = new THREE.Mesh(geo, ink);
      mesh.scale.set(width, height, 1);
      mesh.renderOrder = order;
      this.group.add(mesh);
      return mesh;
    };
    const h = HpBar.h;
    // The frame stands a little proud all round, so that the bar reads against a dark hull and against pale concrete alike.
    layer(0xe6ecf5, 0.85, 90, w + 0.03, h + 0.03);
    layer(0x7f1d1d, 0.96, 91, w, h);
    this.fill = layer(0x4ade80, 1, 92, w - 0.022, h - 0.036);
    this.mat = this.fill.material as THREE.MeshBasicMaterial;
    this.set(1);
  }

  set(ratio: number): void {
    const r = clamp(ratio, 0, 1);
    this.ratio = r;
    const fw = this.w - 0.022;
    this.fill.scale.x = Math.max(0.02, fw * r);
    this.fill.position.x = (-fw * (1 - r)) / 2;
    this.mat.color.setHex(r > 0.55 ? 0x4ade80 : r > 0.28 ? 0xfacc15 : 0xf87171);
  }
}

interface View {
  key: string;
  kind: Kind;
  id: number;
  root: THREE.Group;
  model: Model;
  hp: HpBar;
  /** The green triangle over it while it is the selection. */
  mark: THREE.Group;
  hit: THREE.Mesh;
  path: THREE.Vector3[];
  speed: number;
  heading: number;
  aim: THREE.Vector3 | null;
  aimT: number;
  /** Hover height for things that fly. */
  hover: number;
  phase: number;
  pop: number;
  /** Whose building it is, for the glass over their base. */
  owner?: number;
  /** Shown in stone: it has nothing left to do in the turn being played. */
  spent: boolean;
  /** The chimneys, if it has any. */
  steam?: Steam;
}

interface TruckView {
  model: TruckModel;
  home: THREE.Vector3;
  /** Where it parks, in zone-local coordinates. */
  slot: Pt;
  path: THREE.Vector3[];
  at: number;
  /** Index in `path` of the resource node, where the truck stops to load. */
  node: number;
  wait: number;
  /** The current wait is the loading stop (as opposed to the start stagger). */
  loading: boolean;
  loaded: boolean;
  heading: number;
  /** Heading while parked. */
  park: number;
}

interface NetView {
  dome: ShieldDome;
  level: number;
  powered: boolean;
}

/** The four tiles trucks park on, derived from the shared depot position. */
const DEPOT_TILES: Array<[number, number]> = [
  [DEPOT_LOCAL.u, DEPOT_LOCAL.v],
  [DEPOT_LOCAL.u + 1, DEPOT_LOCAL.v],
  [DEPOT_LOCAL.u, DEPOT_LOCAL.v + 1],
  [DEPOT_LOCAL.u + 1, DEPOT_LOCAL.v + 1],
];

/**
 * Turns game state into 3D objects and plays back game events. It never
 * changes the state: everything here is cosmetic and can lag a little behind.
 */
export class GameView {
  selected: string | null = null;
  /** Playback speed for animations; matches the AI pace setting. */
  timeScale = 1;
  onSelectedGone: () => void = () => {};
  onFrame: (dt: number) => void = () => {};

  private fx = new Fx();
  private floaters: Floaters;
  private views = new Map<string, View>();
  private pickables: THREE.Mesh[] = [];
  private nets = new Map<number, NetView>();
  private trucks = new Map<number, TruckView[]>();
  /** The resource nodes, which belong to the board rather than to any entity. */
  private nodeGroups: THREE.Group[] = [];
  /** Every model on the board with a part that moves for show: radars, fans, the pump jack, the wind pump. */
  private animated: Array<{ root: THREE.Object3D; model: Model }> = [];
  /** Where each swinging part sits when it is at rest. */
  private rests = new WeakMap<object, number>();
  private plumes = new Plumes();
  private mouth = new THREE.Vector3();
  private state: GameState | null = null;
  private waiters: Array<() => void> = [];
  private wasIdle = true;
  /** True while no move or fight was playing out at the end of the last frame. */
  private wasStill = true;
  /** The unit, gun or alien whose reach is ringed on the board: the selection, or whatever is being looked at. */
  private reachRef: Ref | null = null;
  private reach = new ReachRing();
  private moving = 0;
  private popping = 0;
  private trucking = 0;
  private clock = 0;
  private last = 0;
  private raf = 0;

  constructor(
    private scene: Scene,
    floaterLayer: HTMLElement,
  ) {
    scene.dynamic.add(this.fx.group, this.plumes.points);
    // The reach circle lies on the board itself, so it goes with the board rather than with any entity.
    scene.overlay.add(this.reach.group);
    this.floaters = new Floaters(floaterLayer, scene.camera);
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** True while a move or a fight is still being played out; input is held off meanwhile. */
  get busy(): boolean {
    return this.fx.pending > 0 || this.moving > 0 || this.popping > 0;
  }

  /** True once nothing at all is left to animate, trucks included. */
  get settled(): boolean {
    return !this.busy && this.trucking === 0;
  }

  whenIdle(): Promise<void> {
    return this.settled ? Promise.resolve() : new Promise((resolve) => this.waiters.push(resolve));
  }

  // -----------------------------------------------------------------------
  // Building the scene
  // -----------------------------------------------------------------------

  /** Throws the old scene away and draws `s` as it stands. */
  load(s: GameState): void {
    this.state = s;
    // Whatever stood on the last board goes with it. This runs for every board that is put on, the title
    // screen's included, so a thing left here would stay for the rest of the session.
    for (const v of this.views.values()) this.drop(v.root);
    this.views.clear();
    this.pickables = [];
    for (const list of this.trucks.values()) for (const t of list) this.drop(t.model.group);
    this.trucks.clear();
    for (const node of this.nodeGroups) this.drop(node);
    this.nodeGroups = [];
    for (const net of this.nets.values()) {
      this.scene.dynamic.remove(net.dome.group);
      net.dome.dispose();
    }
    this.nets.clear();
    this.animated = [];
    this.plumes.clear();
    this.moving = this.popping = this.trucking = 0;
    this.fx.clear();
    this.floaters.clear();
    this.selected = null;
    this.reachRef = null;
    this.reach.set(null, 0);
    this.scene.buildBoard(s);
    this.scene.setHighlights([]);
    for (const node of s.nodes) {
      const model = buildNode(node.resource);
      model.group.position.copy(worldOf(node.x, node.y, s.boardSize));
      const corner = s.corners[node.corner];
      model.group.rotation.y = Math.atan2(corner.dx, -corner.dy);
      this.scene.dynamic.add(model.group);
      this.nodeGroups.push(model.group);
      if (model.motion?.length) this.animated.push({ root: model.group, model });
    }
    this.reconcile(s);
    // A file read back may be half-way through a turn, with units in it that have already done their bit.
    this.syncSpent(s);
  }

  private colorOf(s: GameState, pid: number): number {
    return parseInt(s.players[pid].color.slice(1), 16);
  }

  private create(kind: Kind, id: number, model: Model, at: THREE.Vector3, hitW: number, hitD: number, pop: boolean): View {
    const key = `${kind}:${id}`;
    const root = new THREE.Group();
    root.position.copy(at);
    root.add(model.group);
    const hp = new HpBar(kind === 'building' || kind === 'alien' ? 0.9 : 0.5);
    hp.group.position.y = model.height + 0.24;
    // For whatever has been hurt. The selection has its own mark: a bar over a unit at full health only read as a dark smudge.
    hp.group.visible = false;
    root.add(hp.group);
    const mark = selectionMark();
    root.add(mark);
    const h = hitH(model);
    // The box that catches clicks is this entity's own: it goes with the model (see `scrap`).
    const hitGeo = new THREE.BoxGeometry(hitW, h, hitD);
    hitGeo.userData.owned = true;
    const hit = new THREE.Mesh(hitGeo, HIT_MAT);
    hit.position.y = h / 2;
    hit.userData.key = key;
    root.add(hit);
    if (pop) root.scale.setScalar(0.01);
    this.scene.dynamic.add(root);
    this.pickables.push(hit);
    const v: View = { key, kind, id, root, model, hp, hit, mark, path: [], speed: 6, heading: 0, aim: null, aimT: 0, hover: 0, phase: Math.random() * 6.28, pop: pop ? 0 : 1, spent: false };
    if (model.motion?.length) this.animated.push({ root, model });
    if (pop) this.popping++;
    this.views.set(key, v);
    return v;
  }

  /** Takes a model off the board for good, and lets go of what it alone owned on the card. */
  private drop(root: THREE.Object3D): void {
    this.scene.dynamic.remove(root);
    scrap(root);
  }

  private remove(v: View): void {
    this.drop(v.root);
    this.pickables = this.pickables.filter((p) => p !== v.hit);
    this.animated = this.animated.filter((a) => a.root !== v.root);
    v.steam?.silence();
    this.views.delete(v.key);
    if (this.selected === v.key) {
      this.selected = null;
      this.onSelectedGone();
    }
  }

  private addUnit(u: Unit, s: GameState, pop: boolean): void {
    const model = buildUnit(u.key, this.colorOf(s, u.owner));
    const at = worldOf(u.x, u.y, s.boardSize);
    const v = this.create('unit', u.id, model, at, 0.74, 0.74, pop);
    const def = UNITS[u.key];
    const air = def.unitClass === 'air';
    v.hover = air ? 1.05 : 0;
    v.hit.position.y = v.hover + hitH(model) / 2;
    v.speed = def.move * 1.6 + 2;
    v.heading = Math.atan2(-at.x, -at.z);
    v.root.rotation.y = v.heading;
    v.hp.set(u.hp / def.hp);
  }

  private buildingYaw(b: Building, owner: PlayerState, s: GameState): number {
    const c = s.corners[owner.corner];
    // Rectangular footprints stay square to the grid; only the doors turn.
    return b.w !== b.h ? (c.dy === 1 ? 0 : Math.PI) : Math.atan2(c.dx, -c.dy);
  }

  private addBuilding(b: Building, owner: PlayerState, s: GameState, pop: boolean): View | null {
    const model = buildBuilding(b.key, b.level, this.colorOf(s, owner.id));
    if (!model) return null;
    const at = worldOf(b.x + (b.w - 1) / 2, b.y + (b.h - 1) / 2, s.boardSize);
    const v = this.create('building', b.id, model, at, b.w * 0.96, b.h * 0.96, pop);
    v.owner = owner.id;
    v.heading = this.buildingYaw(b, owner, s);
    v.root.rotation.y = v.heading;
    v.hp.set(b.hp / b.maxHp);
    if (model.vents?.length) {
      // One plume per chimney mouth, switched together with the building's power.
      const mouths = model.vents.map((vent) =>
        this.plumes.vent(
          () => {
            // The root may have moved since the picture was last drawn: ask it where the mouth is now.
            v.root.updateWorldMatrix(true, false);
            return v.root.localToWorld(this.mouth.set(vent.at[0], vent.at[1], vent.at[2]));
          },
          vent.kind,
        ),
      );
      v.steam = {
        set: (on) => mouths.forEach((m) => m.set(on)),
        silence: () => mouths.forEach((m) => m.silence()),
      };
    }
    this.setPower(v, b.powered);
    return v;
  }

  private upgrade(b: Building, owner: PlayerState, s: GameState): void {
    const old = this.views.get(`building:${b.id}`);
    if (!old) return;
    this.remove(old);
    const v = this.addBuilding(b, owner, s, false);
    if (v) {
      v.pop = 0.5;
      this.popping++;
    }
  }

  /** Lit windows, beacons and chimneys follow the building's power: dark and still while it has none. */
  private setPower(v: View, on: boolean): void {
    for (const lamp of v.model.lamps ?? []) lamp.emissiveIntensity = on ? (lamp.userData.glow as number | undefined) ?? 1 : 0;
    v.steam?.set(on);
  }

  private syncPower(s: GameState): void {
    for (const v of this.views.values()) {
      if (v.kind !== 'building') continue;
      const hit = buildingById(s, v.id);
      if (hit) this.setPower(v, hit.building.powered);
    }
  }

  private addAlien(a: AlienState, s: GameState, pop: boolean): View {
    const def = ALIENS[a.key];
    const model = buildAlien(a.key);
    const at = worldOf(a.x, a.y, s.boardSize);
    const reach = a.key === 'shentan' ? 1.1 : 0.9;
    const v = this.create('alien', a.id, model, at, reach, reach, pop);
    v.speed = def.move * 1.6 + 2;
    v.heading = Math.PI;
    v.root.rotation.y = Math.PI;
    // The ghost never quite touches the ground, and Chloe drifts a little above it.
    v.hover = def.teleports ? 0.22 : a.key === 'chloe' ? 0.08 : 0;
    v.hit.position.y = v.hover + hitH(model) / 2;
    v.hp.set(a.hp / def.hp);
    v.hp.group.visible = a.hp < def.hp;
    return v;
  }

  private addSpider(b: Spiderling, s: GameState, pop: boolean): View {
    const model = buildSpiderling();
    const v = this.create('spider', b.id, model, worldOf(b.x, b.y, s.boardSize), 0.36, 0.36, pop);
    v.speed = SPIDERLING.move * 1.6 + 2;
    v.heading = Math.PI;
    v.root.rotation.y = Math.PI;
    v.hit.position.y = hitH(model) / 2;
    v.hp.set(b.hp / SPIDERLING.hp);
    v.hp.group.visible = false;
    return v;
  }

  /** A dome of glass over a player's whole home zone: the defense net as the eye sees it. */
  private addNet(owner: PlayerState, s: GameState): void {
    const old = this.nets.get(owner.id);
    if (old) {
      this.scene.dynamic.remove(old.dome.group);
      old.dome.dispose();
    }
    const b = owner.buildings.find((x) => x.key === 'defenseNet')!;
    const c = s.corners[owner.corner];
    const size = zoneSize(owner);
    // The middle of the zone: the centre of the tile half-way in from each of its edges.
    const mid = worldOf(c.ox + ((size - 1) / 2) * c.dx, c.oy + ((size - 1) / 2) * c.dy, s.boardSize);
    const dome = new ShieldDome(this.colorOf(s, owner.id), b.level, b.powered, size, mid);
    this.scene.dynamic.add(dome.group);
    this.nets.set(owner.id, { dome, level: b.level, powered: b.powered });
  }

  private syncNets(s: GameState): void {
    for (const p of s.players) {
      const b = p.buildings.find((x) => x.key === 'defenseNet');
      const cur = this.nets.get(p.id);
      if (!b) {
        if (cur) {
          this.scene.dynamic.remove(cur.dome.group);
          cur.dome.dispose();
          this.nets.delete(p.id);
        }
        continue;
      }
      if (!cur || cur.level !== b.level || cur.powered !== b.powered) this.addNet(p, s);
    }
  }

  private addTruck(pid: number, s: GameState): void {
    const list = this.trucks.get(pid) ?? [];
    const owner = s.players[pid];
    const model = buildTruck(this.colorOf(s, pid));
    model.group.scale.setScalar(0.78);
    const k = list.length % 16;
    const [tu, tv] = DEPOT_TILES[Math.floor(k / 4)];
    const su = (k % 2) * 2 - 1;
    const sv = (Math.floor(k / 2) % 2) * 2 - 1;
    // Everything about the parking spot is worked out in the zone's own
    // coordinates and only then moved onto the board.
    const slot = { x: tu + su * 0.22, y: tv + sv * 0.22 };
    const c = s.corners[owner.corner];
    const parked = toWorld(c, slot.x, slot.y);
    const home = worldOf(parked.x, parked.y, s.boardSize);
    model.group.position.copy(home);
    const heading = c.dx > 0 ? Math.PI / 2 : -Math.PI / 2;
    model.group.rotation.y = heading;
    this.scene.dynamic.add(model.group);
    list.push({ model, home, slot, path: [], at: 0, node: 0, wait: 0, loading: false, loaded: false, heading, park: heading });
    this.trucks.set(pid, list);
  }

  /** Trucks roll out along the supply lane, load up, and come back. */
  private sendTrucks(e: Extract<GameEvent, { type: 'harvest' }>, s: GameState): void {
    const p = s.players[e.player];
    const node = s.nodes.find((nd) => nd.corner === p.corner && nd.resource === e.resource);
    if (!node) return;
    const c = s.corners[p.corner];
    const list = this.trucks.get(e.player) ?? [];
    const idle = list.filter((t) => !t.path.length && t.wait <= 0).slice(0, 3);
    idle.forEach((t, i) => {
      // Out along the lane to the node and straight back: the node is the half-way stop.
      const out = supplyRoute(c, t.slot, toLocal(c, node.x, node.y)).map((q) => worldOf(q.x, q.y, s.boardSize));
      t.path = [...out, t.home.clone()];
      t.at = 0;
      t.node = (out.length - 1) / 2;
      t.wait = 0.05 + i * 0.2;
      t.loading = false;
      t.model.cargo.material = cargoMaterial(e.resource);
      t.loaded = false;
      this.trucking++;
    });
    this.floaters.text(`+${e.amount}`, worldOf(node.x, node.y, s.boardSize).setY(0.9), 'gain');
  }

  /** Safety net: make the scene match the state exactly. Runs whenever the animation queue drains. */
  private reconcile(s: GameState): void {
    const alive = new Set<string>();
    for (const p of s.players) {
      for (const b of p.buildings) {
        if (b.key === 'defenseNet') continue;
        const k = `building:${b.id}`;
        alive.add(k);
        if (!this.views.has(k)) this.addBuilding(b, p, s, false);
      }
      for (const u of p.units) {
        const k = `unit:${u.id}`;
        alive.add(k);
        if (!this.views.has(k)) this.addUnit(u, s, false);
      }
      // addTruck owns the list, so always re-read it rather than holding a copy.
      while ((this.trucks.get(p.id)?.length ?? 0) > p.trucks) {
        const t = this.trucks.get(p.id)!.pop()!;
        this.drop(t.model.group);
      }
      while ((this.trucks.get(p.id)?.length ?? 0) < p.trucks) this.addTruck(p.id, s);
    }
    this.syncNets(s);
    this.syncPower(s);
    for (const a of s.aliens) {
      const k = `alien:${a.id}`;
      alive.add(k);
      if (!this.views.has(k)) this.addAlien(a, s, false);
    }
    for (const b of s.brood) {
      const k = `spider:${b.id}`;
      alive.add(k);
      if (!this.views.has(k)) this.addSpider(b, s, false);
    }
    for (const [k, v] of [...this.views]) if (!alive.has(k)) this.remove(v);
  }

  // -----------------------------------------------------------------------
  // Playing events
  // -----------------------------------------------------------------------

  handle(events: GameEvent[], s: GameState): void {
    this.state = s;
    // Pair every shot with the damage it dealt. A strike always reports its
    // damage right after the attack, so first-in matches first-out per target.
    const open = new Map<string, Array<Extract<GameEvent, { type: 'attack' }>>>();
    const hits = new Map<Extract<GameEvent, { type: 'attack' }>, PendingHit>();
    const lastHit = new Map<string, PendingHit>();
    for (const e of events) {
      if (e.type === 'attack') {
        const k = keyOf(e.target);
        open.set(k, [...(open.get(k) ?? []), e]);
      } else if (e.type === 'damage') {
        const q = open.get(keyOf(e.target));
        const a = q?.shift();
        if (a) {
          const h = { amount: e.amount, lethal: false, shown: false };
          hits.set(a, h);
          lastHit.set(keyOf(e.target), h);
        }
      } else if (e.type === 'destroyed') {
        const h = lastHit.get(keyOf(e.target));
        if (h) h.lethal = true;
      }
    }

    for (const e of events) {
      switch (e.type) {
        case 'build': {
          const hit = buildingById(s, e.buildingId);
          if (hit) this.addBuilding(hit.building, hit.owner, s, true);
          break;
        }
        case 'upgrade': {
          const hit = buildingById(s, e.buildingId);
          if (hit) this.upgrade(hit.building, hit.owner, s);
          break;
        }
        case 'produce':
          if (e.unitKey === 'truck') this.addTruck(e.player, s);
          else {
            const hit = unitById(s, e.unitId);
            if (hit) this.addUnit(hit.unit, s, true);
          }
          break;
        case 'move': {
          const v = this.mover(e.unitId);
          if (v) {
            v.path = e.path.map((p) => worldOf(p.x, p.y, s.boardSize));
            this.moving++;
          }
          break;
        }
        case 'attack':
          this.animateAttack(e, s, hits.get(e));
          break;
        case 'alienSpawn': {
          const a = alienById(s, e.id);
          if (a) this.addAlien(a, s, true);
          this.fx.warp(worldOf(e.x, e.y, s.boardSize), tintOf(ALIENS[e.key].color));
          break;
        }
        case 'warp': {
          const v = this.views.get(keyOf(e.target));
          const tint = e.target.kind === 'alien' ? tintOf(ALIENS[alienById(s, e.target.id)?.key ?? 'chloe'].color) : SPIDER_TINT;
          this.fx.warp(worldOf(e.from.x, e.from.y, s.boardSize), tint);
          this.fx.warp(worldOf(e.to.x, e.to.y, s.boardSize), tint);
          if (v) {
            // Gone from one place before it is seen in the other.
            v.path = [];
            v.root.position.copy(worldOf(e.to.x, e.to.y, s.boardSize)).setY(v.hover);
            v.pop = 0.35;
          }
          break;
        }
        case 'hatch': {
          for (const id of e.ids) {
            const b = spiderById(s, id);
            if (b) this.addSpider(b, s, true);
          }
          break;
        }
        case 'expand': {
          // The base has claimed the ring round it: the ground there has been levelled and coloured.
          this.scene.buildBoard(s);
          // Its dome has to stretch to the new boundary, which the sync at the end of `handle` sees to.
          const net = this.nets.get(e.player);
          if (net) {
            this.scene.dynamic.remove(net.dome.group);
            net.dome.dispose();
            this.nets.delete(e.player);
          }
          break;
        }
        case 'harvest':
          this.sendTrucks(e, s);
          break;
        default:
          break;
      }
    }
    // A new building may have taken the last of the power, or a burnt one given some back. And the
    // dome is not an entity with a model of its own, so nothing else would put it up when the net
    // is built or raised a rung while the picture happens to be still.
    this.syncPower(s);
    this.syncNets(s);
    // A turn that has just ended takes the stone off at once; the ground a unit has arrived on may reach further or less far.
    this.syncSpent(s);
    this.syncReach();
  }

  // -----------------------------------------------------------------------
  // Spent units, and the reach of a weapon
  // -----------------------------------------------------------------------

  /** Shows a unit in its own colours again, or all in stone. The model's materials are swapped rather than changed: they are shared with every other model of the kind. */
  private setSpent(v: View, on: boolean): void {
    if (v.spent === on) return;
    v.spent = on;
    v.model.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (on) {
        mesh.userData.paint = mesh.material;
        mesh.material = stoneOf(mesh.material as THREE.Material);
      } else if (mesh.userData.paint) {
        mesh.material = mesh.userData.paint;
        delete mesh.userData.paint;
      }
    });
  }

  /**
   * Turns to stone whatever has nothing left to do in the turn being played,
   * and only in that turn: the moment the turn ends the stone comes off, even
   * though the unit's orders only come back when its owner's next turn begins.
   * A unit that has only just finished is left in its colours until its own
   * move or shot has played out.
   */
  private syncSpent(s: GameState): void {
    const turn = s.phase === 'player' ? s.currentPlayer : -1;
    for (const v of this.views.values()) {
      if (v.kind !== 'unit') continue;
      const hit = unitById(s, v.id);
      const done = !!hit && hit.owner.id === turn && !canStillAct(hit.unit);
      if (done && !v.spent && this.busy) continue;
      this.setSpent(v, done);
    }
  }

  /** Whose reach to ring on the board: the selection, or whatever is being looked at. Whatever has no weapon gets no circle. */
  showReach(ref: Ref | null): void {
    this.reachRef = ref;
    this.syncReach();
  }

  /** Draws the reach circle as things stand: the weapon's range for a radius, in the colour of the side it is on. */
  private syncReach(): void {
    const s = this.state;
    const ref = this.reachRef;
    let range = 0;
    let own = false;
    if (s && ref) {
      if (ref.kind === 'unit') {
        const hit = unitById(s, ref.id);
        if (hit) {
          range = statsOf(s, hit.unit).range;
          own = hit.owner.id === s.currentPlayer && s.phase === 'player';
        }
      } else if (ref.kind === 'building') {
        const hit = buildingById(s, ref.id);
        if (hit) {
          range = BUILDINGS[hit.building.key].levels[hit.building.level - 1].range;
          own = hit.owner.id === s.currentPlayer && s.phase === 'player';
        }
      } else if (ref.kind === 'alien') range = ALIENS[alienById(s, ref.id)?.key ?? 'chloe'].range;
      else range = SPIDERLING.range;
    }
    // A weapon reaches every tile whose centre is within its range, counted tile by tile. So the circle
    // runs just outside the farthest of those tiles along the four sides of it.
    this.reach.set(range > 0 ? range + 0.5 : null, own ? OWN_REACH : FOE_REACH);
  }

  private ratioOf(r: Ref): number {
    const s = this.state!;
    if (r.kind === 'alien') {
      const a = alienById(s, r.id);
      return a ? a.hp / ALIENS[a.key].hp : 0;
    }
    if (r.kind === 'spider') {
      const b = spiderById(s, r.id);
      return b ? b.hp / SPIDERLING.hp : 0;
    }
    if (r.kind === 'unit') {
      const hit = unitById(s, r.id);
      return hit ? hit.unit.hp / UNITS[hit.unit.key].hp : 0;
    }
    const hit = buildingById(s, r.id);
    return hit ? hit.building.hp / hit.building.maxHp : 0;
  }

  private isAlive(r: Ref): boolean {
    const s = this.state!;
    if (r.kind === 'alien') return alienById(s, r.id) !== null;
    if (r.kind === 'spider') return spiderById(s, r.id) !== null;
    return r.kind === 'unit' ? unitById(s, r.id) !== null : buildingById(s, r.id) !== null;
  }

  /** Whatever can walk: a unit, an alien or a spider. Their ids never overlap. */
  private mover(id: number): View | null {
    return this.views.get(`unit:${id}`) ?? this.views.get(`alien:${id}`) ?? this.views.get(`spider:${id}`) ?? null;
  }

  private animateAttack(e: Extract<GameEvent, { type: 'attack' }>, s: GameState, hit: PendingHit | undefined): void {
    const n = s.boardSize;
    const src = this.views.get(keyOf(e.source));
    const dst = this.views.get(keyOf(e.target));
    const from = worldOf(e.from.x, e.from.y, n);
    const to = worldOf(e.to.x, e.to.y, n);
    from.y += (src?.hover ?? 0) + (src ? src.model.height * 0.62 : 0.3);
    to.y += (dst?.hover ?? 0) + (dst ? dst.model.height * 0.5 : 0.3);
    if (src && src.model.heads.length) {
      src.aim = to.clone();
      src.aimT = 1.5;
    }
    const target = e.target;
    const land = (): void => {
      if (!hit) return;
      if (!hit.shown) {
        hit.shown = true;
        this.floaters.text(hit.amount > 0 ? `-${hit.amount}` : '格挡', to.clone().setY(to.y + 0.35), hit.amount > 0 ? 'dmg' : 'block');
        // The glass over the owner's base, if they have one, takes the blow.
        const struck = this.views.get(keyOf(target));
        const net = struck?.owner === undefined ? undefined : this.nets.get(struck.owner);
        if (net?.powered) net.dome.hit(to);
      }
      const v = this.views.get(keyOf(target));
      if (!v) return;
      if (hit.lethal || !this.isAlive(target)) {
        this.fx.explode(v.root.position.clone().setY(v.hover + v.model.height * 0.4), v.kind === 'alien' ? 1.9 : v.kind === 'building' ? 1.3 : v.kind === 'spider' ? 0.4 : 0.75);
        this.remove(v);
      } else {
        v.hp.set(this.ratioOf(target));
        v.hp.group.visible = true;
      }
    };
    const flight = clamp(from.distanceTo(to) / 16, 0.1, 0.42);
    for (let i = 0; i < e.shots; i++) {
      const last = i === e.shots - 1;
      this.fx.after(0.05 + i * Math.min(0.2, flight * 0.75), () => this.fx.fire(from, to, e.style, last ? land : () => undefined));
    }
  }

  // -----------------------------------------------------------------------
  // Input support
  // -----------------------------------------------------------------------

  pick(clientX: number, clientY: number): { view: View | null; tile: Pt | null } {
    const canvas = this.scene.canvas;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.scene.camera);
    // Units are small, so let them win against a building whose click box
    // they happen to stand in front of.
    let best: { view: View; score: number } | null = null;
    for (const hit of ray.intersectObjects(this.pickables, false)) {
      const v = this.views.get(hit.object.userData.key as string);
      if (!v) continue;
      const score = hit.distance - (v.kind === 'building' ? 0 : 0.6);
      if (!best || score < best.score) best = { view: v, score };
    }
    const view = best ? best.view : null;
    return { view, tile: this.scene.tileAt(clientX, clientY) };
  }

  view(ref: Ref): View | null {
    return this.views.get(keyOf(ref)) ?? null;
  }

  tilesOf(ref: Ref): Pt[] {
    const s = this.state;
    if (!s) return [];
    if (ref.kind === 'alien' || ref.kind === 'spider') {
      const thing = ref.kind === 'alien' ? alienById(s, ref.id) : spiderById(s, ref.id);
      return thing ? [{ x: thing.x, y: thing.y }] : [];
    }
    if (ref.kind === 'unit') {
      const hit = unitById(s, ref.id);
      return hit ? [{ x: hit.unit.x, y: hit.unit.y }] : [];
    }
    const hit = buildingById(s, ref.id);
    return hit ? tilesOf(hit.building) : [];
  }

  highlight(move: Pt[], targets: Ref[]): void {
    const tiles: Array<Pt & { color: number }> = move.map((m) => ({ ...m, color: HIGHLIGHT.move }));
    const seen = new Set(move.map((m) => `${m.x},${m.y}`));
    for (const t of targets) {
      for (const p of this.tilesOf(t)) {
        const k = `${p.x},${p.y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        tiles.push({ ...p, color: HIGHLIGHT.attack });
      }
    }
    this.scene.setHighlights(tiles);
  }

  /** Plain coloured squares, e.g. everywhere a building could be put. */
  highlightTiles(tiles: Pt[], color: number): void {
    this.scene.setHighlights(tiles.map((t) => ({ ...t, color })));
  }

  setHover(tile: Pt | null): void {
    this.scene.setHover(tile);
  }

  // -----------------------------------------------------------------------
  // Frame loop
  // -----------------------------------------------------------------------

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000)) * this.timeScale;
    this.last = now;
    this.clock += dt;
    this.tick(dt);
    this.floaters.update(dt);
    this.plumes.update(dt, this.scene.camera, this.scene.renderer.domElement.height);
    this.scene.render();
    this.onFrame(dt);
  };

  private tick(dt: number): void {
    const camQ = this.scene.camera.quaternion;
    const k = 1 - Math.exp(-dt * 11);
    let moving = 0;
    let popping = 0;
    for (const v of this.views.values()) {
      if (v.pop < 1) {
        v.pop = Math.min(1, v.pop + dt * 3.4);
        const x = v.pop - 1;
        v.root.scale.setScalar(Math.max(0.01, 1 + 2.70158 * x * x * x + 1.70158 * x * x));
        popping++;
      }
      if (v.path.length) {
        moving++;
        const pos = v.root.position;
        const target = v.path[0];
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const dist = Math.hypot(dx, dz);
        const step = v.speed * dt;
        if (dist <= step) {
          pos.x = target.x;
          pos.z = target.z;
          v.path.shift();
        } else {
          pos.x += (dx / dist) * step;
          pos.z += (dz / dist) * step;
          v.heading = Math.atan2(dx, dz);
        }
      }
      v.root.rotation.y = turn(v.root.rotation.y, v.heading, k);
      if (v.hover > 0) v.root.position.y = v.hover + Math.sin(this.clock * 2.2 + v.phase) * 0.05;
      const aura = v.model.group.userData.aura as THREE.Mesh | undefined;
      if (aura) aura.scale.setScalar(1 + Math.sin(this.clock * 3 + v.phase) * 0.07);
      for (const head of v.model.heads) {
        let want = 0;
        if (v.aim) want = Math.atan2(v.aim.x - v.root.position.x, v.aim.z - v.root.position.z) - v.root.rotation.y;
        head.rotation.y = turn(head.rotation.y, want, k * 1.4);
      }
      if (v.aim && (v.aimT -= dt) <= 0) v.aim = null;
      // The health bar is for whatever has been hurt; the mark is for whatever is selected, over its head and
      // a little higher when the bar is showing too. It nods gently, so the eye finds it.
      v.hp.group.visible = v.hp.ratio < 1;
      if (v.hp.group.visible) faceCamera(v.hp.group, v.root, camQ);
      v.mark.visible = v.key === this.selected;
      if (v.mark.visible) {
        const big = v.kind === 'building' || v.kind === 'alien';
        v.mark.position.set(0, v.model.height + (v.hp.group.visible ? 0.51 : 0.29) + Math.sin(this.clock * 4) * 0.025, 0);
        v.mark.scale.setScalar(big ? 1.35 : 1);
        faceCamera(v.mark, v.root, camQ);
      }
    }

    let trucking = 0;
    for (const list of this.trucks.values()) {
      for (const t of list) {
        if (t.wait > 0) {
          trucking++;
          t.wait -= dt;
          // Done loading at the node: move on to the way back.
          if (t.wait <= 0 && t.loading) {
            t.loading = false;
            t.loaded = true;
            t.model.cargo.visible = true;
            t.at++;
          }
          continue;
        }
        if (!t.path.length) continue;
        trucking++;
        const pos = t.model.group.position;
        const target = t.path[t.at];
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const dist = Math.hypot(dx, dz);
        const step = 10 * dt;
        if (dist <= step) {
          pos.copy(target);
          if (t.at === t.node) {
            t.wait = 0.4;
            t.loading = true;
          } else if (++t.at >= t.path.length) {
            // Home again: unload and park facing up the lane.
            t.path = [];
            t.at = 0;
            t.loaded = false;
            t.model.cargo.visible = false;
            t.heading = t.park;
          }
        } else {
          pos.x += (dx / dist) * step;
          pos.z += (dz / dist) * step;
          t.heading = Math.atan2(dx, dz);
        }
        t.model.group.rotation.y = turn(t.model.group.rotation.y, t.heading, k * 1.6);
      }
    }
    this.moving = moving;
    this.popping = popping;
    this.trucking = trucking;

    // Radars going round, fans turning, the pump jack nodding and the wind pump spinning. A part that
    // swings keeps time with where it stands, so two of a kind side by side are never in step.
    for (const { root, model } of this.animated) {
      const place = root.position.x * 0.7 + root.position.z * 0.9;
      for (const m of model.motion ?? []) {
        if (m.swing === undefined) {
          m.part.rotation[m.axis] += dt * m.speed;
          continue;
        }
        let rest = this.rests.get(m);
        if (rest === undefined) {
          rest = m.part.rotation[m.axis];
          this.rests.set(m, rest);
        }
        m.part.rotation[m.axis] = rest + Math.sin(this.clock * m.speed + place + (m.phase ?? 0)) * m.swing;
      }
    }
    for (const net of this.nets.values()) net.dome.tick(dt);

    this.fx.update(dt);
    this.scene.tick(dt);

    const sel = this.selected ? this.views.get(this.selected) : null;
    const ring = this.scene.ring;
    ring.visible = !!sel;
    if (sel) {
      ring.position.set(sel.root.position.x, 0.05, sel.root.position.z);
      const size = sel.kind === 'building' ? 1.5 : sel.kind === 'alien' ? 1.25 : sel.hover > 0 ? 0.8 : 0.62 + Math.sin(this.clock * 5) * 0.06;
      ring.scale.setScalar(size);
    }
    // The reach circle keeps to the heels of whatever it belongs to, a unit on the move included.
    const reach = this.reachRef ? this.views.get(keyOf(this.reachRef)) : null;
    if (reach) this.reach.group.position.set(reach.root.position.x, REACH_Y, reach.root.position.z);
    this.reach.tick(this.clock);

    // Once a move or a shot has played out, whatever finished with it turns to stone.
    const still = !this.busy;
    if (!still) this.wasStill = false;
    else if (!this.wasStill) {
      this.wasStill = true;
      if (this.state) this.syncSpent(this.state);
    }

    const idle = this.settled;
    if (!idle) this.wasIdle = false;
    else if (!this.wasIdle) {
      this.wasIdle = true;
      if (this.state) this.reconcile(this.state);
      const w = this.waiters;
      this.waiters = [];
      for (const fn of w) fn();
    }
  }
}
