import * as THREE from 'three';

export type VentKind = 'steam' | 'smoke';

/** A chimney's say over its own plume: the view switches it with the building's power and silences it when the building goes. */
export interface Steam {
  set(on: boolean): void;
  silence(): void;
}

/** What one kind of plume is like: how it looks, how fast it rises and spreads, how long it lasts, and how often the chimney breathes. */
const KIND: Record<VentKind, { tint: number; rise: number; size: number; spread: number; life: number; opacity: number; every: number }> = {
  steam: { tint: 0xeef3f7, rise: 0.4, size: 0.07, spread: 3.6, life: 2.3, opacity: 0.38, every: 0.4 },
  smoke: { tint: 0x2a2f3a, rise: 0.32, size: 0.045, spread: 3.9, life: 2.7, opacity: 0.5, every: 0.46 },
};

/** A light breeze, so plumes lean as they rise. */
const WIND = new THREE.Vector2(0.09, 0.04);
/** The most puffs there can be at once. */
const CAP = 480;

const tint = new THREE.Color();
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aTint;
  attribute float aSeed;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vTint;
  varying float vSeed;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    // A puff's size is in world units: how wide that is on screen depends on how far away it is.
    gl_PointSize = min(160.0, aSize * 2.0 * uScale / max(0.1, -mvPosition.z));
    vAlpha = aAlpha;
    vTint = aTint;
    vSeed = aSeed;
  }
`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vTint;
  varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    // A soft disc with an uneven edge, so it reads as a puff rather than a dot.
    float a = smoothstep(0.5, 0.1, length(c)) * (0.82 + 0.18 * sin(atan(c.y, c.x) * 5.0 + vSeed * 6.2831)) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vTint, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface Vent {
  at: () => THREE.Vector3;
  kind: VentKind;
  on: boolean;
  /** Time since the last puff. */
  t: number;
}

/**
 * Steam and smoke over every chimney on the board, as one cloud of points
 * and so one draw. Purely cosmetic: nothing in the rules knows it is here.
 */
export class Plumes {
  readonly points: THREE.Points;
  private vents: Vent[] = [];
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private pos = new Float32Array(CAP * 3);
  private vel = new Float32Array(CAP * 3);
  private tint = new Float32Array(CAP * 3);
  private age = new Float32Array(CAP);
  private life = new Float32Array(CAP);
  private base = new Float32Array(CAP);
  private spread = new Float32Array(CAP);
  private peak = new Float32Array(CAP);
  private size = new Float32Array(CAP);
  private alpha = new Float32Array(CAP);
  private seed = new Float32Array(CAP);
  private next = 0;

  constructor() {
    const attr = (array: Float32Array, size: number): THREE.BufferAttribute => new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', attr(this.pos, 3));
    this.geo.setAttribute('aSize', attr(this.size, 1));
    this.geo.setAttribute('aAlpha', attr(this.alpha, 1));
    this.geo.setAttribute('aTint', attr(this.tint, 3));
    this.geo.setAttribute('aSeed', attr(this.seed, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 1000 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  /** A chimney that breathes from now on. `at` gives its mouth in world coordinates. */
  vent(at: () => THREE.Vector3, kind: VentKind): Steam {
    const v: Vent = { at, kind, on: true, t: 0.05 };
    this.vents.push(v);
    return {
      set: (on) => {
        v.on = on;
      },
      silence: () => {
        const i = this.vents.indexOf(v);
        if (i >= 0) this.vents.splice(i, 1);
      },
    };
  }

  /** Every chimney gone, as when another match is put on screen. The puffs already in the air thin out by themselves. */
  clear(): void {
    this.vents = [];
  }

  /** `viewHeight` is the picture's height in device pixels, which is what point sizes are measured in. */
  update(dt: number, camera: THREE.PerspectiveCamera, viewHeight: number): void {
    for (const v of this.vents) {
      if (!v.on) continue;
      v.t += dt;
      const every = KIND[v.kind].every;
      while (v.t >= every) {
        v.t -= every;
        this.puff(v);
      }
    }
    for (let k = 0; k < CAP; k++) {
      if (this.life[k] <= 0) continue;
      const i = k * 3;
      this.age[k] += dt;
      const u = this.age[k] / this.life[k];
      if (u >= 1) {
        this.life[k] = 0;
        this.alpha[k] = 0;
        continue;
      }
      // Rises, wanders a little on the way up, and leans into the breeze as it spreads.
      this.pos[i] += (this.vel[i] + Math.sin(this.age[k] * 1.7 + this.seed[k] * 6.28) * 0.05 + WIND.x * u) * dt;
      this.pos[i + 1] += this.vel[i + 1] * dt;
      this.pos[i + 2] += (this.vel[i + 2] + Math.cos(this.age[k] * 1.3 + this.seed[k] * 6.28) * 0.05 + WIND.y * u) * dt;
      this.size[k] = this.base[k] * (1 + u * this.spread[k]);
      // Fades in as it leaves the chimney and out again as it thins.
      this.alpha[k] = Math.pow(Math.sin(Math.PI * u), 0.7) * this.peak[k];
    }
    for (const name of ['position', 'aSize', 'aAlpha', 'aTint', 'aSeed']) this.geo.attributes[name].needsUpdate = true;
    this.mat.uniforms.uScale.value = viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  private puff(v: Vent): void {
    const spec = KIND[v.kind];
    const at = v.at();
    // The next slot round: with far more slots than puffs, it is always a free one.
    const k = this.next;
    this.next = (this.next + 1) % CAP;
    const i = k * 3;
    this.pos[i] = at.x + rnd(-0.012, 0.012);
    this.pos[i + 1] = at.y;
    this.pos[i + 2] = at.z + rnd(-0.012, 0.012);
    this.vel[i] = rnd(-0.025, 0.025);
    this.vel[i + 1] = spec.rise * rnd(0.85, 1.15);
    this.vel[i + 2] = rnd(-0.025, 0.025);
    this.age[k] = 0;
    this.life[k] = spec.life * rnd(0.8, 1.2);
    this.base[k] = spec.size * rnd(0.85, 1.15);
    this.spread[k] = spec.spread;
    this.size[k] = this.base[k];
    this.peak[k] = spec.opacity;
    this.alpha[k] = 0;
    this.seed[k] = Math.random();
    tint.setHex(spec.tint);
    this.tint[i] = tint.r;
    this.tint[i + 1] = tint.g;
    this.tint[i + 2] = tint.b;
  }
}
