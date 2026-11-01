// The mothership in the sky (docs/mothership.md): a mega-structure ~12,000 km long in a geosynchronous orbit
// (shared/mothership.ts says where it is, from the time of day), so it's in the sky all day and all night, biggest and
// lowest in the south at midnight.
//
// Drawn in a pass of its own: its little scene (the model, the sunlight it sees, the glow off the desert below it)
// rendered each frame, when it's in view, into a target the size of the screen with a camera turned like the player's
// but standing at its centre (the ship is ~40,000 km off: no parallax). The sky dome (sky.ts) then lays that picture
// over the stars, under the air: stars, sun and moon behind it are covered by it, the sky's glow is in front of it.
// So by day its lit side shows pale through the blue the way the moon does and its shadowed side vanishes, and by
// night it's a bright sunlit shape blotting out the stars, with its own lights. The depth buffer stays at 1 there, as
// for all sky (post.ts tells sky from ground by it), and anything on the ground covers it.
//
// The model is made here in code (boxes, prisms, fins, a torus: at 15–23° across the sky, a few pixels per feature), in
// local units with the ship 1 long: +z the nose, −y the belly (it faces the planet), x its side.
import * as THREE from 'three/webgpu';
import { abs, float, floor, fract, mix, mx_cell_noise_float, positionLocal, screenUV, sin, smoothstep, step, texture, uniform, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mothershipAt, newMothership } from '../../shared/mothership.ts';
import { nightLevel, sandStorm, sunDirection, time } from './env.ts';

type N = Node<'vec3'>;
type F = Node<'float'>;

/** How far off the ship is drawn in its own pass (any distance does: only its angle shows). */
const DRAW_AT = 1000;
/** Sunlight on the ship, unfiltered by air (the desert's noon sun is ~3.9). */
const SPACE_SUN = 3.2;
/** The ring's spin (rad per real second): a 1 g ring ~5,800 km across turns in ~57 min of game time (~71 s real). */
const RING_SPIN = (2 * Math.PI) / 71;

const tex = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
/** 1 while the ship's picture is fresh and on screen (else the sky doesn't read it). */
const shipOn = uniform(0);
/** Haze and dust between us and the ship (0..1), and its reddening low over the horizon. */
const shipClear = uniform(1);
const shipLow = uniform(0);

const pic = texture(tex.texture, screenUV);
/** How much of the sky behind (stars, sun, moon) the ship covers at a pixel: 0..1. */
export const shipCover: F = pic.a.mul(shipOn).mul(shipClear);
/** The ship's light reaching the ground at a pixel (linear HDR), reddened and dimmed low over the horizon. */
export const shipLight: N = pic.rgb.mul(mix(vec3(1), vec3(1.0, 0.55, 0.3), shipLow)).mul(shipOn).mul(shipClear);

// --- Materials -----------------------------------------------------------------------------------------------------
const cell = (p: N, k: number): F => mx_cell_noise_float(floor(p.mul(k)));

/** Window lights in a plated surface: rows of lit and dark runs, decks across the ship, warm with a few cool. `density`:
 *  share of lit cells. Brighter by night (they're always on; daylight drowns them). */
function windows(p: N, density: number): N {
  const row = smoothstep(0.3, 0.45, abs(fract(p.z.mul(300)).sub(0.5)));
  const lit = step(1 - density, cell(p.mul(vec3(1, 1, 0.3)), 240));
  const tint = mix(vec3(1.0, 0.7, 0.4), vec3(0.62, 0.8, 1.0), step(0.85, cell(p, 37)));
  const flicker = sin(time.mul(0.3).add(cell(p, 11).mul(40))).mul(0.15).add(0.85);
  return tint.mul(row.mul(lit).mul(flicker).mul(mix(float(0.3), float(1.8), nightLevel)));
}

/** Gunmetal hull, plated: each panel a slightly different grey (reads as structure a few pixels per panel). */
function hullMaterial(tone: number, lights = 0) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.35 });
  const p = positionLocal as unknown as N;
  m.colorNode = vec3(0.42, 0.41, 0.4).mul(tone).mul(cell(p, 110).mul(0.4).add(0.6));
  if (lights) m.emissiveNode = windows(p, lights);
  return m;
}

/** Heat vanes: the servers' heat, dumped to space. Pale by day, an ember glow by night, hottest by the hull. */
function vaneMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0.1 });
  const p = positionLocal as unknown as N;
  const r = p.x.mul(p.x).add(p.y.mul(p.y)).sqrt();
  const ribs = smoothstep(0.25, 0.5, abs(fract(r.mul(70)).sub(0.5)));
  m.colorNode = vec3(0.4, 0.39, 0.38).mul(ribs.mul(0.3).add(0.7));
  const heat = smoothstep(0.3, 0.06, r);
  m.emissiveNode = vec3(1.0, 0.28, 0.06).mul(ribs.mul(0.5).add(0.5)).mul(heat.mul(heat).mul(1.2).add(0.05)).mul(mix(float(0.3), float(1), nightLevel));
  return m;
}

/** Lamps (nav lights, beacons, the engines' glow, hangar mouths): unlit colour, past the bloom threshold. `blink`: period
 *  (s), 0 = steady. */
function lampMaterial(color: THREE.Color, k: number, blink = 0, phase = 0) {
  const m = new THREE.MeshBasicNodeMaterial();
  const on: F = blink ? step(0.85, fract(time.div(blink).add(phase))) : float(1);
  m.colorNode = vec3(color.r, color.g, color.b).mul(k).mul(on);
  return m;
}

// --- Model ---------------------------------------------------------------------------------------------------------
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
/** A prism along z (`seg` sides; 6 = the hull's hexagon, flat faces up and down). */
const tube = (r: number, len: number, z: number, seg = 12) =>
  new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2).rotateZ(seg === 6 ? Math.PI / 6 : 0).translate(0, 0, z);
/** A frustum along z from radius r0 (aft end) to r1 (fore end), its middle at z. */
const cone = (r0: number, r1: number, len: number, z: number, seg = 16, open = true) =>
  new THREE.CylinderGeometry(r1, r0, len, seg, 1, open).rotateX(Math.PI / 2).rotateZ(seg === 6 ? Math.PI / 6 : 0).translate(0, 0, z);

/** Hull radius at z: a long hexagonal body, a knife prow, a flared stern. */
const HULL_R = 0.05;
const HULL_FORE = 0.24, HULL_AFT = -0.36;

function buildShip(): { ship: THREE.Group; ring: THREE.Group } {
  const ship = new THREE.Group();
  const hull: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [], blocks: THREE.BufferGeometry[] = [];
  const vanes: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [], bays: THREE.BufferGeometry[] = [];

  // The body: hexagonal hull, a long prow tapering to a point, the stern flaring out to the engine block.
  hull.push(tube(HULL_R, HULL_FORE - HULL_AFT, (HULL_FORE + HULL_AFT) / 2, 6));
  hull.push(cone(HULL_R, 0.004, 0.27, HULL_FORE + 0.135, 6, false));
  hull.push(cone(0.075, HULL_R, 0.05, HULL_AFT - 0.025, 6, false));
  dark.push(tube(0.06, 0.05, -0.425, 12));
  // Collars where the sections meet.
  for (const z of [-0.3, -0.17, 0.1, 0.2]) dark.push(tube(HULL_R + 0.008, 0.01, z, 6));

  // The city: blocks stacked on every face of the hull, fore and aft of the ring, some towering. A fixed layout.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const district = (z0: number, z1: number, rows: number, taper = 1) => {
    for (let i = 0; i < rows; i++) {
      const t = (i + 0.5) / rows;
      const z = z0 + t * (z1 - z0);
      const len = ((z1 - z0) / rows) * (0.75 + rnd() * 0.2);
      for (let face = 0; face < 6; face++) {
        const ang = (face / 6) * Math.PI * 2;
        for (const across of [-0.016, 0.016]) {
          if (rnd() < 0.18) continue;
          const h = (0.008 + rnd() * rnd() * 0.04) * (1 - taper * t * 0.5);
          const w = 0.014 + rnd() * 0.012;
          const base = HULL_R * Math.cos(Math.PI / 6);
          blocks.push(new THREE.BoxGeometry(w, h, len).translate(across, base + h / 2, 0).rotateZ(ang).translate(0, 0, z));
        }
      }
    }
  };
  district(0.05, 0.22, 10, 0.6);
  district(-0.33, -0.06, 14, 0);
  // The bridge: a tall tower on the back (+y), aft of the ring.
  blocks.push(box(0.02, 0.07, 0.04, 0, HULL_R + 0.035, -0.12), box(0.05, 0.012, 0.03, 0, HULL_R + 0.07, -0.12));
  // The belly (towards the planet): hangar mouths, lit, where whatever comes down from it will come out.
  for (const z of [-0.28, -0.22, -0.16]) {
    dark.push(box(0.05, 0.012, 0.035, 0, -HULL_R - 0.004, z));
    bays.push(box(0.04, 0.002, 0.026, 0, -HULL_R - 0.0105, z));
  }

  // Heat vanes: four great swept fins at the stern in an X, and a smaller four by the prow.
  const vane = (rIn: number, rOut: number, zIn: number, sweep: number, chord: number, chordTip: number, ang: number) => {
    const s = new THREE.Shape();
    s.moveTo(rIn, zIn);
    s.lineTo(rOut, zIn - sweep);
    s.lineTo(rOut, zIn - sweep - chordTip);
    s.lineTo(rIn, zIn - chord);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false }).translate(0, 0, -0.002);
    vanes.push(g.rotateX(Math.PI / 2).rotateZ(ang));
  };
  for (const a of [1, 3, 5, 7]) vane(HULL_R, 0.3, -0.16, 0.16, 0.18, 0.05, (a / 8) * Math.PI * 2);
  for (const a of [1, 3, 5, 7]) vane(HULL_R, 0.12, 0.2, 0.05, 0.08, 0.025, (a / 8) * Math.PI * 2);

  // Engines: three bells and their glow.
  for (const a of [0, 1, 2]) {
    const ang = (a / 3) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(ang) * 0.032, y = Math.sin(ang) * 0.032;
    dark.push(cone(0.026, 0.014, 0.05, -0.47, 12).translate(x, y, 0));
    glow.push(new THREE.CircleGeometry(0.022, 12).rotateY(Math.PI).translate(x, y, -0.49));
  }

  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, into: THREE.Object3D = ship) => {
    const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
    mesh.frustumCulled = false;
    into.add(mesh);
  };
  add(hull, hullMaterial(1, 0.12));
  add(dark, hullMaterial(0.5));
  add(blocks, hullMaterial(0.75, 0.4));
  add(vanes, vaneMaterial());
  add(glow, lampMaterial(new THREE.Color(0.45, 0.65, 1.0), 8));
  add(bays, lampMaterial(new THREE.Color(1.0, 0.85, 0.6), 3));

  // The ring: a habitat torus round the middle on six spokes, spinning, face-on to the planet (its axis is the belly's),
  // so from the desert it's a great halo round the ship.
  const ring = new THREE.Group();
  ring.position.z = -0.02;
  const ringHull: THREE.BufferGeometry[] = [new THREE.TorusGeometry(0.24, 0.016, 8, 96), new THREE.TorusGeometry(0.24, 0.022, 4, 12, 0.14)];
  for (let a = 1; a < 6; a++) ringHull.push(new THREE.TorusGeometry(0.24, 0.021, 4, 12, 0.12).rotateZ((a / 6) * Math.PI * 2 + 0.3));
  for (let a = 0; a < 6; a++) ringHull.push(box(0.008, 0.18, 0.006, 0, 0.15, 0).rotateZ((a / 6) * Math.PI * 2 + Math.PI / 6));
  ringHull.push(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 12).rotateX(Math.PI / 2));
  add(ringHull, hullMaterial(0.85, 0.15), ring);
  // Its windows: a lit band round the inside of the torus.
  add([new THREE.TorusGeometry(0.224, 0.004, 4, 160)], hullMaterial(0.6, 0.6), ring);
  ring.rotation.x = Math.PI / 2;
  ship.add(ring);

  // Nav lights: red to port, green to starboard on the vane tips, white strobes on the prow and stern, red beacons.
  const lamp = (c: THREE.Color, k: number, x: number, y: number, z: number, blink = 0, phase = 0) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 4), lampMaterial(c, k, blink, phase));
    m.position.set(x, y, z);
    m.frustumCulled = false;
    ship.add(m);
  };
  const tip = 0.3 * Math.SQRT1_2;
  lamp(new THREE.Color(1, 0.1, 0.05), 30, -tip, tip, -0.34, 1.6, 0);
  lamp(new THREE.Color(1, 0.1, 0.05), 30, -tip, -tip, -0.34, 1.6, 0);
  lamp(new THREE.Color(0.1, 1, 0.2), 30, tip, tip, -0.34, 1.6, 0);
  lamp(new THREE.Color(0.1, 1, 0.2), 30, tip, -tip, -0.34, 1.6, 0);
  lamp(new THREE.Color(1, 1, 1), 60, 0, 0, 0.51, 1.1, 0.3);
  lamp(new THREE.Color(1, 1, 1), 60, 0, 0, -0.5, 1.1, 0.8);
  lamp(new THREE.Color(1, 0.2, 0.1), 40, 0, HULL_R + 0.08, -0.12, 2.4, 0.5);
  for (let i = 0; i < 6; i++) lamp(new THREE.Color(1, 0.25, 0.1), 25, 0, -HULL_R - 0.006, -0.34 + i * 0.1, 3.0, i * 0.08);
  return { ship, ring };
}

// --- The pass ------------------------------------------------------------------------------------------------------
export class Mothership {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, DRAW_AT * 0.4, DRAW_AT * 1.6);
  private ship: THREE.Group;
  private ring: THREE.Group;
  private sun = new THREE.DirectionalLight(0xffffff, SPACE_SUN);
  /** Light off the desert below, on its belly. */
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
    const { ship, ring } = buildShip();
    this.ship = ship;
    this.ring = ring;
    this.scene.add(ship, this.sun, this.sun.target, this.shine, this.shine.target, new THREE.AmbientLight(0x8890a0, 0.03));
    this.sun.target.position.set(0, 0, 0);
    this.shine.target.position.set(0, 0, 0);
  }

  /** Where it is now (time of day) and its picture for this frame, as `camera` sees the sky. */
  update(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera, tod: number, unixMs: number) {
    const s = mothershipAt(tod, this.state);
    const dir = this.vz.set(s.dir.x, s.dir.y, s.dir.z);
    const scale = DRAW_AT * s.angle;
    this.ship.position.copy(dir).multiplyScalar(DRAW_AT);
    this.ship.scale.setScalar(scale);
    // Attitude: z the nose, −y the belly.
    const z = this.vz.set(s.nose.x, s.nose.y, s.nose.z);
    const y = this.vy.set(-s.belly.x, -s.belly.y, -s.belly.z);
    const x = this.vx.crossVectors(y, z).normalize();
    this.ship.quaternion.setFromRotationMatrix(this.basis.makeBasis(x, y, z));
    this.ship.updateMatrixWorld(true);
    this.ring.rotation.z = ((unixMs / 1000) * RING_SPIN) % (Math.PI * 2); // (about its own axis: it's turned face-down)

    // Sunlight (reddened in the shadow's rim) and the desert's glow from below.
    this.sun.position.copy(sunDirection.value).multiplyScalar(DRAW_AT * 2).add(this.ship.position);
    this.sun.target.position.copy(this.ship.position);
    this.sun.color.setRGB(1, 1 - s.red * 0.6, 1 - s.red * 0.85);
    this.sun.intensity = SPACE_SUN * s.sunlit;
    this.shine.position.set(s.belly.x, s.belly.y, s.belly.z).multiplyScalar(DRAW_AT).add(this.ship.position);
    this.shine.target.position.copy(this.ship.position);
    this.shine.intensity = 0.35 * s.planetshine;

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
    this.sphere.set(this.ship.position, scale * 0.6);
    if (shipClear.value <= 0 || !this.frustum.intersectsSphere(this.sphere)) {
      shipOn.value = 0;
      return;
    }
    renderer.getDrawingBufferSize(this.size);
    if (tex.width !== this.size.x || tex.height !== this.size.y) tex.setSize(this.size.x, this.size.y);
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
