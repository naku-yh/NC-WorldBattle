import * as THREE from 'three';
import type { AttackStyle } from '../game/types';

interface Shot {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  style: AttackStyle;
  onHit: () => void;
}

interface Timer {
  at: number;
  fn: () => void;
}

interface Flash {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  from: number;
  to: number;
}

interface Beam {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  mat: THREE.MeshBasicMaterial;
}

interface ShotSpec {
  color: number;
  /** Tiles per second. */
  speed: number;
  arc: number;
  size: number;
  trail: number | null;
  sparks: number;
  sparkColor: number;
  flash: number;
}

const SPECS: Record<AttackStyle, ShotSpec> = {
  bullet: { color: 0xffe08a, speed: 34, arc: 0.02, size: 0.5, trail: null, sparks: 5, sparkColor: 0xfde68a, flash: 0.25 },
  shell: { color: 0xffb347, speed: 17, arc: 0.05, size: 0.9, trail: 0xff9a3c, sparks: 14, sparkColor: 0xfb923c, flash: 0.6 },
  laser: { color: 0x67e8f9, speed: 60, arc: 0, size: 0.6, trail: null, sparks: 10, sparkColor: 0xa5f3fc, flash: 0.5 },
  missile: { color: 0xf1f5f9, speed: 9, arc: 1.1, size: 0.9, trail: 0xfb923c, sparks: 22, sparkColor: 0xfdba74, flash: 0.9 },
  flak: { color: 0xe2e8f0, speed: 15, arc: 0.7, size: 0.6, trail: null, sparks: 9, sparkColor: 0xe0f2fe, flash: 0.4 },
  bomb: { color: 0xfca5a5, speed: 11, arc: 0.1, size: 1.1, trail: 0xf87171, sparks: 26, sparkColor: 0xfdba74, flash: 1.1 },
  alien: { color: 0xc084fc, speed: 10, arc: 0.4, size: 1.2, trail: 0xa78bfa, sparks: 18, sparkColor: 0x86efac, flash: 0.9 },
};

const CAP = 900;
const SHOT_GEO = new THREE.SphereGeometry(0.05, 8, 6);
const FLASH_GEO = new THREE.SphereGeometry(0.5, 10, 8);
const basics = new Map<number, THREE.MeshBasicMaterial>();
const basic = (color: number): THREE.MeshBasicMaterial => {
  let m = basics.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    basics.set(color, m);
  }
  return m;
};

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** Projectiles, lasers, sparks and flashes. Purely cosmetic. */
export class Fx {
  readonly group = new THREE.Group();
  /** Timers, shots and beams still running; the director waits for this to reach 0. */
  pending = 0;
  private now = 0;
  private shots: Shot[] = [];
  private timers: Timer[] = [];
  private flashes: Flash[] = [];
  private beams: Beam[] = [];
  private points: THREE.Points;
  private pos = new Float32Array(CAP * 3).fill(-999);
  private vel = new Float32Array(CAP * 3);
  private col = new Float32Array(CAP * 3);
  private fade = new Float32Array(CAP * 3);
  private life = new Float32Array(CAP);
  private next = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.17, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  clear(): void {
    for (const s of this.shots) this.group.remove(s.mesh);
    for (const f of this.flashes) this.group.remove(f.mesh);
    for (const b of this.beams) this.group.remove(b.mesh);
    this.shots = [];
    this.timers = [];
    this.flashes = [];
    this.beams = [];
    this.pending = 0;
    this.pos.fill(-999);
    this.col.fill(0);
    this.life.fill(0);
  }

  /** Run `fn` after `sec` seconds of animation time. */
  after(sec: number, fn: () => void): void {
    this.timers.push({ at: this.now + sec, fn });
    this.pending++;
  }

  emit(at: THREE.Vector3, color: number, count: number, speed: number, life = 0.6): void {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const k = this.next;
      this.next = (this.next + 1) % CAP;
      const i = k * 3;
      this.pos[i] = at.x;
      this.pos[i + 1] = at.y;
      this.pos[i + 2] = at.z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(rnd(-1, 1));
      const s = speed * rnd(0.35, 1);
      this.vel[i] = Math.sin(phi) * Math.cos(theta) * s;
      this.vel[i + 1] = Math.abs(Math.cos(phi)) * s + speed * 0.25;
      this.vel[i + 2] = Math.sin(phi) * Math.sin(theta) * s;
      const l = life * rnd(0.6, 1.2);
      this.life[k] = l;
      this.col[i] = c.r;
      this.col[i + 1] = c.g;
      this.col[i + 2] = c.b;
      this.fade[i] = c.r / l;
      this.fade[i + 1] = c.g / l;
      this.fade[i + 2] = c.b / l;
    }
  }

  flash(at: THREE.Vector3, color: number, size: number, dur = 0.22): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(FLASH_GEO, mat);
    mesh.position.copy(at);
    mesh.scale.setScalar(0.1);
    this.group.add(mesh);
    this.flashes.push({ mesh, t: 0, dur, from: 0.1, to: size });
  }

  private beam(from: THREE.Vector3, to: THREE.Vector3, color: number, dur: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, from.distanceTo(to), 6, 1, true), mat);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    this.group.add(mesh);
    this.beams.push({ mesh, t: 0, dur, mat });
    this.pending++;
  }

  private burst(at: THREE.Vector3, spec: ShotSpec): void {
    this.emit(at, spec.sparkColor, spec.sparks, 3.2 + spec.flash * 2.2, 0.55);
    this.emit(at, 0xfff3c4, Math.ceil(spec.sparks / 3), 1.4, 0.3);
    this.flash(at, spec.color, spec.flash);
  }

  fire(from: THREE.Vector3, to: THREE.Vector3, style: AttackStyle, onHit: () => void): void {
    const spec = SPECS[style];
    if (style === 'laser') {
      this.beam(from, to, spec.color, 0.17);
      this.after(0.09, () => {
        this.burst(to, spec);
        onHit();
      });
      return;
    }
    const mesh = new THREE.Mesh(SHOT_GEO, basic(spec.color));
    mesh.scale.setScalar(spec.size);
    mesh.position.copy(from);
    this.group.add(mesh);
    const dur = clamp(from.distanceTo(to) / spec.speed, 0.09, 0.55);
    this.shots.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur, arc: spec.arc, style, onHit });
    this.pending++;
    if (style === 'shell' || style === 'bullet' || style === 'alien') this.flash(from, spec.color, spec.flash * 0.5, 0.12);
  }

  /** A unit or building going up. */
  explode(at: THREE.Vector3, size: number): void {
    this.emit(at, 0xffa94d, Math.round(18 * size), 3 + size * 2.4, 0.75);
    this.emit(at, 0xff6b35, Math.round(12 * size), 2.2, 0.9);
    this.emit(at, 0xfff7cc, Math.round(8 * size), 1.2, 0.35);
    this.flash(at, 0xffc46b, 1.3 * size, 0.4);
    this.after(0.12, () => this.emit(at, 0xff8a3d, Math.round(10 * size), 1.6, 0.8));
  }

  /** Something teleporting in from above. */
  warp(at: THREE.Vector3, color: number): void {
    const top = at.clone().setY(9);
    this.beam(top, at, color, 0.7);
    this.after(0.35, () => {
      this.flash(at, color, 3.2, 0.6);
      this.emit(at, color, 40, 4.5, 1);
    });
  }

  update(dt: number): void {
    this.now += dt;
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.now);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > this.now);
        for (const t of due) {
          this.pending--;
          t.fn();
        }
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      const u = Math.min(1, s.t / s.dur);
      s.mesh.position.lerpVectors(s.from, s.to, u);
      s.mesh.position.y += s.arc * 4 * u * (1 - u);
      const spec = SPECS[s.style];
      if (spec.trail !== null) this.emit(s.mesh.position, spec.trail, 1, 0.35, 0.28);
      if (u >= 1) {
        this.group.remove(s.mesh);
        this.shots.splice(i, 1);
        this.burst(s.to, spec);
        this.pending--;
        s.onHit();
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      f.mesh.scale.setScalar(f.from + (f.to - f.from) * u);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - u);
      if (u >= 1) {
        this.group.remove(f.mesh);
        (f.mesh.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
      }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      const u = Math.min(1, b.t / b.dur);
      b.mat.opacity = 0.95 * (1 - u);
      b.mesh.scale.x = b.mesh.scale.z = 1 + u * 0.8;
      if (u >= 1) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mat.dispose();
        this.beams.splice(i, 1);
        this.pending--;
      }
    }
    for (let k = 0; k < CAP; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      const i = k * 3;
      if (this.life[k] <= 0) {
        this.pos[i + 1] = -999;
        this.col[i] = this.col[i + 1] = this.col[i + 2] = 0;
        continue;
      }
      this.pos[i] += this.vel[i] * dt;
      this.pos[i + 1] += this.vel[i + 1] * dt;
      this.pos[i + 2] += this.vel[i + 2] * dt;
      this.vel[i + 1] -= 7 * dt;
      const drag = Math.max(0, 1 - 1.6 * dt);
      this.vel[i] *= drag;
      this.vel[i + 2] *= drag;
      this.col[i] = Math.max(0, this.col[i] - this.fade[i] * dt);
      this.col[i + 1] = Math.max(0, this.col[i + 1] - this.fade[i + 1] * dt);
      this.col[i + 2] = Math.max(0, this.col[i + 2] - this.fade[i + 2] * dt);
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
}

/** Damage numbers that float up from whatever was hit. */
export class Floaters {
  private items: Array<{ el: HTMLElement; world: THREE.Vector3; t: number }> = [];
  private v = new THREE.Vector3();

  constructor(
    private layer: HTMLElement,
    private camera: THREE.Camera,
  ) {}

  text(str: string, world: THREE.Vector3, cls = ''): void {
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = str;
    this.layer.append(el);
    this.items.push({ el, world: world.clone(), t: 0 });
  }

  clear(): void {
    for (const it of this.items) it.el.remove();
    this.items = [];
  }

  update(dt: number): void {
    const w = this.layer.clientWidth;
    const h = this.layer.clientHeight;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      this.v.copy(it.world).project(this.camera);
      const x = ((this.v.x + 1) / 2) * w;
      const y = ((1 - this.v.y) / 2) * h - it.t * 46;
      it.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${Math.max(0.6, 1.25 - it.t).toFixed(2)})`;
      it.el.style.opacity = String(Math.max(0, 1 - it.t / 1.15));
      if (it.t > 1.15) {
        it.el.remove();
        this.items.splice(i, 1);
      }
    }
  }
}
