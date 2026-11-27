import * as THREE from 'three';

/** How round the dome's foot is: 2 is a circle, 4 a rounded square that hugs the base zone's own square and still covers its corners. */
const SQUARENESS = 4;
/** The dome's height as a share of half the zone's width: tall enough to clear the grand base, low enough to see the base under it. */
const STEEPNESS = 0.8;
/** Room between the zone's edge and the dome's foot. */
const MARGIN = 0.35;
/** The colour of gilded glass. */
const GOLD = 0xf2c14e;
/** The colour of glass with no current in it. */
const DARK = 0x6b7280;

/** Where the dome's foot reaches on the bearing `theta`: `half` along the axes, about a fifth further out at the corners. */
function reach(theta: number, half: number): number {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  return half / Math.pow(Math.pow(c, SQUARENESS) + Math.pow(s, SQUARENESS), 1 / SQUARENESS);
}

/** A point on the dome: `phi` is the angle down from the crown, `theta` the bearing. */
function onDome(theta: number, phi: number, half: number, out: THREE.Vector3): THREE.Vector3 {
  const r = reach(theta, half) * Math.sin(phi);
  return out.set(r * Math.cos(theta), half * STEEPNESS * Math.cos(phi), r * Math.sin(theta));
}

/**
 * The dome itself: rings from the crown down to the foot, with the normal at
 * every point found from two tangents so the glass shades smoothly round the
 * corners and across the seam. Also carries each point's place on the unit
 * sphere (for the lattice) and its height (0 at the foot, 1 at the crown).
 */
function domeGeometry(half: number): THREE.BufferGeometry {
  const around = 72;
  const down = 30;
  const positions: number[] = [];
  const normals: number[] = [];
  const sphere: number[] = [];
  const heights: number[] = [];
  const index: number[] = [];
  const p = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const along = new THREE.Vector3();
  const down3 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e = 1e-3;
  for (let j = 0; j <= down; j++) {
    const phi = (j / down) * (Math.PI / 2);
    for (let i = 0; i <= around; i++) {
      const theta = (i / around) * Math.PI * 2;
      onDome(theta, phi, half, p);
      // The tangent along the bearing is undefined at the crown itself: take it a hair below.
      const ph = Math.max(phi, e);
      onDome(theta + e, ph, half, a);
      onDome(theta - e, ph, half, b);
      along.subVectors(a, b);
      onDome(theta, ph + e, half, a);
      onDome(theta, Math.max(ph - e, 0), half, b);
      down3.subVectors(a, b);
      n.crossVectors(along, down3).normalize();
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
      sphere.push(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      heights.push(Math.cos(phi));
    }
  }
  for (let j = 0; j < down; j++) {
    for (let i = 0; i < around; i++) {
      const upper = j * (around + 1) + i;
      const lower = upper + around + 1;
      index.push(upper, lower, upper + 1, upper + 1, lower, lower + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aSphere', new THREE.Float32BufferAttribute(sphere, 3));
  geo.setAttribute('aHeight', new THREE.Float32BufferAttribute(heights, 1));
  geo.setIndex(index);
  return geo;
}

const VERT = /* glsl */ `
  attribute vec3 aSphere;
  attribute float aHeight;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vSphere;
  varying float vHeight;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vSphere = aSphere;
    vHeight = aHeight;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uGold;
  uniform float uGoldShare;
  uniform float uTime;
  /** 1 while the net has power, a fraction while it is dark. */
  uniform float uPower;
  uniform float uLevel;
  uniform vec3 uHit;
  uniform float uHitT;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vSphere;
  varying float vHeight;
  #include <fog_pars_fragment>

  /** 1 on the line that closes every cell of x, 0 elsewhere; w is the line's share of a cell. */
  float line(float x, float w) {
    float f = abs(fract(x) - 0.5);
    float aa = fwidth(x) * 1.2 + 1e-4;
    return 1.0 - smoothstep(0.5 - w - aa, 0.5 - w + aa, f);
  }

  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 N = normalize(vNormal);
    // The far side of the dome is seen from inside, so its outward normal points away from the eye:
    // turn it round, and let that side count for a little less than the glass in front.
    float facing = dot(N, V);
    float side = facing < 0.0 ? -0.5 : 1.0;
    N *= sign(side);
    // Bright along the rim where the eye grazes the glass, clear where it looks straight through.
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4) * abs(side);
    float body = 0.45 + 0.55 * rim;

    // A lattice of meridians and rings in the dome's own coordinates, creeping round very slowly.
    float lon = atan(vSphere.z, vSphere.x) / 6.2831853 + 0.5 + uTime * 0.012;
    float lat = acos(clamp(vSphere.y, -1.0, 1.0)) / 1.5707963;
    float lattice = max(line(lon * (14.0 + 4.0 * uLevel), 0.05), line(lat * (8.0 + uLevel) - uTime * 0.1, 0.05));

    // A ring of light climbing from the foot to the crown every few seconds.
    float scan = fract(uTime * 0.13);
    float band = exp(-pow((vHeight - scan) * 10.0, 2.0)) * smoothstep(0.0, 0.1, scan) * (1.0 - smoothstep(0.82, 1.0, scan));

    // A ripple racing out over the glass from where a shot landed.
    float ripple = 0.0;
    if (uHitT < 1.6) ripple = exp(-pow((distance(vWorld, uHit) - uHitT * 7.0) * 2.6, 2.0)) * exp(-uHitT * 2.2);

    // A line of light where the glass meets the ground.
    float foot = 1.0 - smoothstep(0.0, 0.035, vHeight);

    vec3 tint = mix(uColor, uGold, uGoldShare);
    float glow = 0.9 * rim + 0.9 * lattice * body + 0.5 * band + 1.1 * ripple + 0.8 * foot;
    float white = 0.1 * rim + 0.3 * ripple + 0.16 * band + 0.3 * foot;
    float alpha = 0.03 + 0.42 * rim + 0.5 * lattice * body + 0.15 * band + 0.75 * ripple + 0.6 * foot;

    gl_FragColor = vec4((tint * glow + vec3(white)) * uPower, clamp(alpha * uPower, 0.0, 0.92));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * The glass over a base: one hemisphere on a rounded-square foot, see-through
 * where the eye looks straight at it and bright along its rim, with a lattice
 * that creeps round, a ring of light that climbs it, and a ripple wherever a
 * shot lands on something underneath. The higher the net's rung, the denser
 * the lattice; the top three rungs are gilded. With no power the glass goes dark and grey.
 */
export class ShieldDome {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly color: number;
  private clock = Math.random() * 60;

  /** `size` is the zone's width in tiles; the dome stands on the ground at `at`. */
  constructor(color: number, level: number, powered: boolean, size: number, at: THREE.Vector3) {
    this.color = color;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uGold: { value: new THREE.Color(GOLD) },
        uGoldShare: { value: 0 },
        uTime: { value: this.clock },
        uPower: { value: 1 },
        uLevel: { value: level },
        uHit: { value: new THREE.Vector3() },
        uHitT: { value: 99 },
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(domeGeometry(size / 2 + MARGIN), this.mat);
    // After the water, which is always outside a dome, so the dome tints it when it is seen through the glass.
    this.mesh.renderOrder = 3;
    this.group.add(this.mesh);
    this.group.position.set(at.x, 0.02, at.z);
    this.setLevel(level, powered);
  }

  /** A new rung, or the power coming or going. */
  setLevel(level: number, powered: boolean): void {
    const u = this.mat.uniforms;
    u.uLevel.value = level;
    u.uPower.value = powered ? 1 : 0.22;
    u.uGoldShare.value = level >= 5 ? 0.55 : level >= 4 ? 0.4 : level >= 3 ? 0.16 : 0;
    // Without power the glass is grey: the player's colour comes back with the current.
    (u.uColor.value as THREE.Color).setHex(powered ? this.color : DARK);
  }

  /** Something under the dome was struck, at `world`. */
  hit(world: THREE.Vector3): void {
    (this.mat.uniforms.uHit.value as THREE.Vector3).copy(world);
    this.mat.uniforms.uHitT.value = 0;
  }

  tick(dt: number): void {
    this.clock += dt;
    const u = this.mat.uniforms;
    u.uTime.value = this.clock;
    u.uHitT.value = (u.uHitT.value as number) + dt;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
