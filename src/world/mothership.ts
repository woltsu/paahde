// The mothership in the sky (docs/mothership.md): a wheel station ~12,000 km across in a geosynchronous orbit
// (shared/mothership.ts says where it is, from the time of day), so it's in the sky all day and all night, biggest and
// lowest in the south at midnight.
//
// After the classic wheel stations of 1970s–80s space art: a great segmented ring on spokes and fine cables, spinning
// round a central hub column; a saucer and cone under the hub with an antenna, a mast and a big dish on top, golden
// solar panels on arms and tanks clustered round the hub's top. Silvery, plated, a few dim portholes, no coloured
// lights. Its axis leans (shared/mothership.ts), so from the desert the ring is a slanting ellipse; the hub turns its
// panels to the sun.
//
// Drawn in a pass of its own: its little scene (the model, the sunlight it sees, the glow off the desert below it)
// rendered each frame, when it's in view, into a target a little under the screen's resolution (it's 40,000 km off,
// through the air: never razor sharp) with a camera turned like the player's but standing at its centre (no
// parallax). The sky dome (sky.ts) then lays that picture over the stars, under the air: stars, sun and moon behind
// it are covered by it, the sky's glow is in front of it, and a haze veil keeps it from looking pasted on. So by day
// it shows pale through the sky the way the moon does and by night it's a dim sunlit shape blotting out stars. The
// depth buffer stays at 1 there, as for all sky (post.ts tells sky from ground by it), and the ground covers it.
//
// The model is made here in code (prisms, a torus, rods, sphere caps), in units of its size (about 1 end to end):
// +y the spin axis (mast and dish), the ring in the xz plane, +x towards the sun (for the hub).
import * as THREE from 'three/webgpu';
import { abs, float, floor, fract, max, mix, mx_cell_noise_float, positionLocal, screenUV, smoothstep, step, texture, uniform, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mothershipAt, newMothership } from '../../shared/mothership.ts';
import { nightLevel, sandStorm, sunDirection } from './env.ts';

type N = Node<'vec3'>;
type F = Node<'float'>;

/** How far off the station is drawn in its own pass (any distance does: only its angle shows). */
const DRAW_AT = 1000;
/** Sunlight on it, unfiltered by air (the desert's noon sun is ~3.9); kept low so it doesn't outshine the sky. */
const SPACE_SUN = 2.0;
/** Light that gets through the air to us at its best (the rest is the veil: the sky's glow lies in front of it). */
const VEIL = 0.5;
/** Its picture's resolution, as a share of the screen's: a touch soft, as through 40,000 km of air. */
const RES = 0.6;
/** The ring's spin (rad per real second): 1 g at its ~5,000 km radius is a turn in ~142 min of game time (~178 s real). */
const RING_SPIN = (2 * Math.PI) / 178;

const tex = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
/** 1 while the picture is fresh and on screen (else the sky doesn't read it). */
const shipOn = uniform(0);
/** Haze and dust between us and it (0..1), and its reddening low over the horizon. */
const shipClear = uniform(1);
const shipLow = uniform(0);

const pic = texture(tex.texture, screenUV);
/** How much of the sky behind (stars, sun, moon) it covers at a pixel: 0..1. */
export const shipCover: F = pic.a.mul(shipOn).mul(shipClear);
/** Its light reaching the ground at a pixel (linear HDR), veiled, reddened and dimmed low over the horizon. */
export const shipLight: N = pic.rgb.mul(mix(vec3(1), vec3(1.0, 0.55, 0.3), shipLow)).mul(shipOn).mul(shipClear).mul(VEIL);

// --- Materials -----------------------------------------------------------------------------------------------------
const cell = (p: N, k: number): F => mx_cell_noise_float(floor(p.mul(k)));

/** Silvery plated metal: each panel a slightly different grey (reads as structure a few pixels per panel). */
function metal(r: number, g: number, b: number, rough = 0.45) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: 0.3, side: THREE.DoubleSide });
  const p = positionLocal as unknown as N;
  m.colorNode = vec3(r, g, b).mul(cell(p, 140).mul(0.12).add(0.88));
  return m;
}

/** The ring's hull, with a row of portholes round its middle: dim, warm, only some lit. */
function ringMetal() {
  const m = metal(0.8, 0.79, 0.76);
  const p = positionLocal as unknown as N;
  const row = smoothstep(0.004, 0.002, abs(p.y)); // the ring lies in xz: y is across the tube
  const lit = step(0.7, cell(p, 260)).mul(step(0.5, fract(p.x.add(p.z).mul(380))));
  m.emissiveNode = vec3(1.0, 0.72, 0.42).mul(row.mul(lit).mul(mix(float(0.02), float(0.35), nightLevel)));
  return m;
}

/** Solar panels: dull gold cells in a darker grid. */
function solar() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.45, side: THREE.DoubleSide });
  const p = positionLocal as unknown as N;
  const g = max(step(0.88, fract(p.y.mul(110))), step(0.9, fract(p.z.mul(70))));
  m.colorNode = mix(vec3(0.36, 0.3, 0.15).mul(cell(p, 50).mul(0.3).add(0.7)), vec3(0.18, 0.16, 0.12), g);
  return m;
}

// --- Model ---------------------------------------------------------------------------------------------------------
/** A prism along y (the axis), its middle at y. */
const col = (r: number, len: number, y: number, seg = 16, r2 = r, open = false) => new THREE.CylinderGeometry(r2, r, len, seg, 1, open).translate(0, y, 0);
/** A rod from a to b. */
const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), 5, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
};
/** A dish: a shallow sphere cap of radius r, its bottom at the origin, opening along +y (drawn two-sided). */
const dish = (r: number) => new THREE.SphereGeometry(r * 1.6, 20, 6, 0, Math.PI * 2, Math.PI - 0.68, 0.68).translate(0, r * 1.6, 0);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const RING_R = 0.42;

function buildStation(): { station: THREE.Group; ring: THREE.Group } {
  const station = new THREE.Group();
  const silver: THREE.BufferGeometry[] = [], grey: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [];
  const red: THREE.BufferGeometry[] = [], gold: THREE.BufferGeometry[] = [], white: THREE.BufferGeometry[] = [];

  // The hub column, its collars, a red band, and the drum the ring turns on.
  silver.push(col(0.055, 0.48, 0.02, 12));
  for (const y of [-0.17, -0.1, 0.09, 0.16, 0.23]) grey.push(col(0.062, 0.014, y, 12));
  red.push(col(0.0565, 0.012, 0.125, 12));
  grey.push(col(0.085, 0.07, 0, 16));
  // Under the hub: a cone out to a saucer, a cone back in, an antenna with two small dishes.
  grey.push(col(0.16, 0.05, -0.245, 20, 0.055));
  dark.push(col(0.165, 0.022, -0.281, 24));
  grey.push(col(0.035, 0.08, -0.332, 20, 0.16));
  dark.push(rod(V(0, -0.37, 0), V(0, -0.52, 0), 0.006));
  for (const s of [-1, 1]) {
    dark.push(rod(V(0, -0.49, 0), V(s * 0.035, -0.5, 0), 0.003));
    white.push(dish(0.022).rotateZ(s * 2.2).translate(s * 0.04, -0.505, 0));
  }
  // On top: a platform, tanks round it (one rust red), a narrower column, a lattice mast and the big dish.
  grey.push(col(0.095, 0.016, 0.27, 20));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4, r = 0.075 + (i % 2) * 0.012, s = 0.02 + ((i * 37) % 5) * 0.003;
    (i === 2 ? red : white).push(new THREE.SphereGeometry(s, 10, 6).translate(Math.cos(a) * r, 0.29 + s * 0.6, Math.sin(a) * r));
  }
  white.push(new THREE.CapsuleGeometry(0.018, 0.07, 4, 10).rotateZ(Math.PI / 2).translate(-0.02, 0.3, 0.1));
  silver.push(col(0.034, 0.13, 0.34, 10));
  for (const y of [0.31, 0.37]) grey.push(col(0.04, 0.01, y, 10));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    dark.push(rod(V(Math.cos(a) * 0.014, 0.4, Math.sin(a) * 0.014), V(Math.cos(a) * 0.006, 0.58, Math.sin(a) * 0.006), 0.0025));
  }
  for (const y of [0.44, 0.49, 0.54]) dark.push(col(0.013, 0.004, y, 6));
  white.push(dish(0.11).rotateZ(-1.0).translate(0.03, 0.6, 0));
  dark.push(rod(V(0.03, 0.6, 0), V(0.1, 0.65, 0), 0.003));
  // Solar panels: two arms each side (along z, square to the sun), the panels on them facing the sun (+x).
  for (const s of [-1, 1]) for (const y of [0.2, 0.3]) {
    dark.push(rod(V(0, y, s * 0.05), V(0, y, s * 0.3), 0.004));
    for (const z of [0.12, 0.23]) gold.push(new THREE.BoxGeometry(0.003, 0.07, 0.1).translate(0.004, y, s * z));
    white.push(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 10).rotateX(Math.PI / 2).translate(0, y + 0.012, s * 0.07));
  }
  // Cables from the hub's top and bottom out to the ring, the painting's fine rigging.
  const cables: THREE.BufferGeometry[] = [];

  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, into: THREE.Object3D) => {
    const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
    mesh.frustumCulled = false;
    into.add(mesh);
  };
  add(silver, metal(0.8, 0.79, 0.76), station);
  add(grey, metal(0.55, 0.54, 0.52), station);
  add(dark, metal(0.22, 0.22, 0.22, 0.6), station);
  add(red, metal(0.5, 0.1, 0.07, 0.6), station);
  add(gold, solar(), station);
  add(white, metal(0.88, 0.87, 0.84, 0.35), station);

  // The ring (spins about y): a segmented torus with collars, flat plates on its rim, a red band, four spokes and the
  // cables.
  const ring = new THREE.Group();
  const hull: THREE.BufferGeometry[] = [new THREE.TorusGeometry(RING_R, 0.028, 10, 128).rotateX(Math.PI / 2)];
  const ringGrey: THREE.BufferGeometry[] = [], ringRed: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 32; i++)
    ringGrey.push(new THREE.TorusGeometry(RING_R, 0.031, 8, 3, 0.02).rotateZ((i / 32) * Math.PI * 2).rotateX(Math.PI / 2));
  ringRed.push(new THREE.TorusGeometry(RING_R, 0.0295, 8, 4, 0.035).rotateZ(2.1).rotateX(Math.PI / 2));
  for (const a of [0.5, 2.6, 4.4]) {
    const plate = new THREE.BoxGeometry(0.012, 0.055, 0.09).translate(RING_R + 0.04, 0.005, 0);
    ringGrey.push(plate.rotateY(a));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const out = V(Math.cos(a), 0, Math.sin(a));
    ringGrey.push(rod(out.clone().multiplyScalar(0.085), out.clone().multiplyScalar(RING_R - 0.02), 0.009));
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rim = V(Math.cos(a) * RING_R, 0, Math.sin(a) * RING_R);
    cables.push(rod(V(0, 0.19, 0), rim, 0.0012), rod(V(0, -0.16, 0), rim, 0.0012));
  }
  add(hull, ringMetal(), ring);
  add(ringGrey, metal(0.6, 0.59, 0.57), ring);
  add(ringRed, metal(0.5, 0.1, 0.07, 0.6), ring);
  add(cables, metal(0.4, 0.4, 0.4, 0.7), ring);
  station.add(ring);
  return { station, ring };
}

// --- The pass ------------------------------------------------------------------------------------------------------
export class Mothership {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, DRAW_AT * 0.4, DRAW_AT * 1.6);
  private station: THREE.Group;
  private ring: THREE.Group;
  private sun = new THREE.DirectionalLight(0xffffff, SPACE_SUN);
  /** Light off the desert below. */
  private shine = new THREE.DirectionalLight(new THREE.Color(1.0, 0.62, 0.36), 0);
  private state = newMothership();
  private size = new THREE.Vector2();
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private basis = new THREE.Matrix4();
  private vx = new THREE.Vector3();
  private vy = new THREE.Vector3();
  private vz = new THREE.Vector3();

  constructor() {
    const { station, ring } = buildStation();
    this.station = station;
    this.ring = ring;
    this.scene.add(station, this.sun, this.sun.target, this.shine, this.shine.target, new THREE.AmbientLight(0x8890a0, 0.04));
  }

  /** Where it is now (time of day) and its picture for this frame, as `camera` sees the sky. */
  update(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera, tod: number, unixMs: number) {
    const s = mothershipAt(tod, this.state);
    const scale = DRAW_AT * s.angle;
    this.station.position.set(s.dir.x, s.dir.y, s.dir.z).multiplyScalar(DRAW_AT);
    this.station.scale.setScalar(scale);
    // Attitude: y the spin axis, x the sun's way square to it (the hub turns its panels to the sun).
    const y = this.vy.set(s.axis.x, s.axis.y, s.axis.z);
    const x = this.vx.copy(sunDirection.value).addScaledVector(y, -sunDirection.value.dot(y)).normalize();
    const z = this.vz.crossVectors(x, y);
    this.station.quaternion.setFromRotationMatrix(this.basis.makeBasis(x, y, z));
    this.ring.rotation.y = -((unixMs / 1000) * RING_SPIN) % (Math.PI * 2);
    this.station.updateMatrixWorld(true);

    // Sunlight (reddened in the shadow's rim) and the desert's glow from below.
    this.sun.position.copy(sunDirection.value).multiplyScalar(DRAW_AT * 2).add(this.station.position);
    this.sun.target.position.copy(this.station.position);
    this.sun.color.setRGB(1, 1 - s.red * 0.6, 1 - s.red * 0.85);
    this.sun.intensity = SPACE_SUN * s.sunlit;
    this.shine.position.set(s.belly.x, s.belly.y, s.belly.z).multiplyScalar(DRAW_AT).add(this.station.position);
    this.shine.target.position.copy(this.station.position);
    this.shine.intensity = 0.25 * s.planetshine;

    // Air between: it fades into the haze down at the horizon, and dust storms hide it.
    shipClear.value = THREE.MathUtils.smoothstep(s.dir.y, -0.01, 0.1) * (1 - 0.75 * sandStorm.value);
    shipLow.value = 1 - THREE.MathUtils.smoothstep(s.dir.y, 0.05, 0.4);

    // Only drawn when some of it is in view.
    const cam = this.camera;
    cam.quaternion.copy(camera.quaternion);
    cam.fov = camera.fov;
    cam.aspect = camera.aspect;
    cam.zoom = camera.zoom;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    this.sphere.set(this.station.position, scale * 0.75);
    if (shipClear.value <= 0 || !this.frustum.intersectsSphere(this.sphere)) {
      shipOn.value = 0;
      return;
    }
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.round(this.size.x * RES)), h = Math.max(1, Math.round(this.size.y * RES));
    if (tex.width !== w || tex.height !== h) tex.setSize(w, h);
    const previous = renderer.getRenderTarget();
    const clear = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(tex);
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clear, alpha);
    shipOn.value = 1;
  }
}
