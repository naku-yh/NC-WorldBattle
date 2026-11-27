import * as THREE from 'three';
import { ALIENS, SPIDERLING, UNITS } from '../game/data';
import { alienById, buildingById, spiderById, unitById } from '../game/engine';
import { DEPOT_LOCAL, supplyRoute, tilesOf, toLocal, toWorld, zoneSize } from '../game/board';
import type { AlienState, Building, GameEvent, GameState, PlayerState, Pt, Spiderling, Unit } from '../game/types';
import { Floaters, Fx } from './fx';
import { buildAlien, buildBuilding, buildNode, buildSpiderling, buildTruck, buildUnit, cargoMaterial, type Model, type TruckModel } from './models';
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

/** Little health bar that always faces the camera. */
class HpBar {
  readonly group = new THREE.Group();
  ratio = 1;
  private fill: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private w: number;

  constructor(w: number) {
    this.w = w;
    const geo = new THREE.PlaneGeometry(1, 1);
    const bg = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0b0f16, transparent: true, opacity: 0.82, depthTest: false, depthWrite: false }));
    bg.scale.set(w, 0.075, 1);
    bg.renderOrder = 90;
    this.mat = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    this.fill = new THREE.Mesh(geo, this.mat);
    this.fill.renderOrder = 91;
    this.group.add(bg, this.fill);
    this.set(1);
  }

  set(ratio: number): void {
    const r = clamp(ratio, 0, 1);
    this.ratio = r;
    const fw = this.w - 0.03;
    this.fill.scale.set(Math.max(0.02, fw * r), 0.048, 1);
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
  group: THREE.Group;
  level: number;
  powered: boolean;
}

let gridTex: THREE.CanvasTexture | null = null;
/** Faint grid for the defense net's walls. */
function netTexture(): THREE.CanvasTexture {
  if (!gridTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 3;
    for (const p of [0, 32, 64]) {
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, 64);
      g.stroke();
      g.beginPath();
      g.moveTo(0, p);
      g.lineTo(64, p);
      g.stroke();
    }
    gridTex = new THREE.CanvasTexture(c);
    gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
    gridTex.repeat.set(8, 1.6);
  }
  return gridTex;
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
  private state: GameState | null = null;
  private waiters: Array<() => void> = [];
  private wasIdle = true;
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
    scene.dynamic.add(this.fx.group);
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
    for (const v of this.views.values()) this.scene.dynamic.remove(v.root);
    this.views.clear();
    this.pickables = [];
    this.trucks.clear();
    this.moving = this.popping = this.trucking = 0;
    for (const net of this.nets.values()) this.scene.dynamic.remove(net.group);
    this.nets.clear();
    this.fx.clear();
    this.floaters.clear();
    this.selected = null;
    this.scene.buildBoard(s);
    this.scene.setHighlights([]);
    for (const node of s.nodes) {
      const model = buildNode(node.resource);
      model.group.position.copy(worldOf(node.x, node.y, s.boardSize));
      const corner = s.corners[node.corner];
      model.group.rotation.y = Math.atan2(corner.dx, -corner.dy);
      this.scene.dynamic.add(model.group);
    }
    this.reconcile(s);
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
    hp.group.visible = false;
    root.add(hp.group);
    const h = hitH(model);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(hitW, h, hitD), HIT_MAT);
    hit.position.y = h / 2;
    hit.userData.key = key;
    root.add(hit);
    if (pop) root.scale.setScalar(0.01);
    this.scene.dynamic.add(root);
    this.pickables.push(hit);
    const v: View = { key, kind, id, root, model, hp, hit, path: [], speed: 6, heading: 0, aim: null, aimT: 0, hover: 0, phase: Math.random() * 6.28, pop: pop ? 0 : 1 };
    if (pop) this.popping++;
    this.views.set(key, v);
    return v;
  }

  private remove(v: View): void {
    this.scene.dynamic.remove(v.root);
    this.pickables = this.pickables.filter((p) => p !== v.hit);
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
    v.heading = this.buildingYaw(b, owner, s);
    v.root.rotation.y = v.heading;
    v.hp.set(b.hp / b.maxHp);
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
    if (b.key === 'defenseNet') this.syncNets(s);
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

  /** Four glowing walls around a player's home zone. */
  private addNet(owner: PlayerState, s: GameState): void {
    const old = this.nets.get(owner.id);
    if (old) this.scene.dynamic.remove(old.group);
    const b = owner.buildings.find((x) => x.key === 'defenseNet')!;
    const level = b.level;
    const powered = b.powered;
    const color = powered ? this.colorOf(s, owner.id) : 0x6b7280;
    const c = s.corners[owner.corner];
    const a = worldOf(c.ox, c.oy, s.boardSize);
    const size = zoneSize(owner);
    const z = worldOf(c.ox + (size - 1) * c.dx, c.oy + (size - 1) * c.dy, s.boardSize);
    const minX = Math.min(a.x, z.x) - 0.5;
    const maxX = Math.max(a.x, z.x) + 0.5;
    const minZ = Math.min(a.z, z.z) - 0.5;
    const maxZ = Math.max(a.z, z.z) + 0.5;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const h = level === 2 ? 1.5 : 1.05;
    const g = new THREE.Group();
    const wall = new THREE.MeshBasicMaterial({
      color,
      map: netTexture(),
      transparent: true,
      opacity: powered ? (level === 2 ? 0.34 : 0.24) : 0.07,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (const [x, zz, w, ry] of [
      [(minX + maxX) / 2, minZ, width, 0],
      [(minX + maxX) / 2, maxZ, width, 0],
      [minX, (minZ + maxZ) / 2, depth, Math.PI / 2],
      [maxX, (minZ + maxZ) / 2, depth, Math.PI / 2],
    ]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wall);
      m.position.set(x, h / 2, zz);
      m.rotation.y = ry;
      g.add(m);
    }
    const edge = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: powered ? 0.9 : 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const zz of [minZ, maxZ]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(width, 0.035, 0.035), edge);
      e.position.set((minX + maxX) / 2, h, zz);
      g.add(e);
    }
    for (const x of [minX, maxX]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, depth), edge);
      e.position.set(x, h, (minZ + maxZ) / 2);
      g.add(e);
    }
    this.scene.dynamic.add(g);
    this.nets.set(owner.id, { group: g, level, powered });
  }

  private syncNets(s: GameState): void {
    for (const p of s.players) {
      const b = p.buildings.find((x) => x.key === 'defenseNet');
      const cur = this.nets.get(p.id);
      if (!b) {
        if (cur) {
          this.scene.dynamic.remove(cur.group);
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
        this.scene.dynamic.remove(t.model.group);
      }
      while ((this.trucks.get(p.id)?.length ?? 0) < p.trucks) this.addTruck(p.id, s);
    }
    this.syncNets(s);
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
          // Its force field has to stretch to the new boundary.
          const net = this.nets.get(e.player);
          if (net) {
            this.scene.dynamic.remove(net.group);
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
      for (const part of v.model.spin ?? []) part.rotation.y += dt * 1.1;
      for (const head of v.model.heads) {
        let want = 0;
        if (v.aim) want = Math.atan2(v.aim.x - v.root.position.x, v.aim.z - v.root.position.z) - v.root.rotation.y;
        head.rotation.y = turn(head.rotation.y, want, k * 1.4);
      }
      if (v.aim && (v.aimT -= dt) <= 0) v.aim = null;
      v.hp.group.visible = v.hp.ratio < 1 || v.key === this.selected;
      if (v.hp.group.visible) v.hp.group.quaternion.copy(camQ);
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
