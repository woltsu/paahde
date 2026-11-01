// Carts (shared/cart.ts, docs/cart.md) in the world: parked where they stand (shared/vehicles.ts), or towed behind a
// bike: pointing the way the tower's state says (PlayerState.hitch: our own predicted state, or a remote player's
// interpolated pose, which carries `tow` and `hitch`), hung from their bike's tow ball where it's drawn
// (shared/cartHang.ts), so it flies, lands and pitches with the bike and never comes off it. The model is public/models/cart.glb (tools/blender/cart.py) to
// the node contract in docs/cart.md; until it's there (or if it fails to load) a stand-in built here with the same
// nodes and pivots, so swapping the glb in changes nothing else. The wheels spin with the ground covered, the stand
// under the tongue swings down when it's let go of the bike (no `hitched`), and the pieces of a level not reached
// (shared/cart.ts CART_LEVEL_NODES) are hidden. Unfolded (Vehicle.open) its hinge nodes turn out over UNFOLD_S, each
// level's on its own clock (FOLD: docs/cart.md's table), so a level raised while it's out unfolds its new pieces; from
// level 1 it's levelled on its stabilisers and, once the poles are up, the canopy (shared/cart.ts canopyRig) is drawn
// by src/world/tarps.ts, as the sim and the shade have it. Unfolding and packing are heard (src/cartSound.ts).
// Each cart wears its owner's colour (Vehicle.color), dyed down by the sun: a torn strip of cloth knotted round its
// back left corner post that hangs and stirs in the wind (streaming back a little towed), and a worn hand-painted stripe
// down the box's lid. (From a way off, your own is on the locator bar.)
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CART_HALF_TRACK, CART_LEVEL_NODES, CART_WHEEL_R, canopyRig, COUPLER_Y, hitchPoint, HITCH_Y, isCart, TOW_LENGTH, towedPose, UNFOLD_S } from '../../shared/cart.ts';
import { hangCart, newHang, turned, type Hang } from '../../shared/cartHang.ts';
import { biome } from '../../shared/biomes.ts';
import { cartSound } from '../cartSound';
import { windDir } from './env.ts';
import { TyreTrack } from '../footprints.ts';
import { rigModel } from './tarps.ts';
import { slopeAt } from '../../shared/sim.ts';
import { heightAt } from '../../shared/terrain.ts';
import { parked, type Vehicle } from '../../shared/vehicles.ts';

/** Drawn within this distance (m). */
const VIEW = 350;
/** The stand swung down onto the ground while it's not linked to a bike (rad about its pivot's x; the model's rest pose,
 *  packed, has it lying back under the tongue: docs/cart.md). */
const STAND_DOWN = Math.PI / 2;
/** How fast the stand swings (per s). */
const STAND_RATE = 4;
/** A cart whose tower drops out of sight for a moment (the state and the vehicles list arrive apart) stays where it
 *  was last drawn this long (s), then is hidden. */
const HOLD_S = 0.6;
/** The corner post the rag is knotted round: the back left stabiliser's sleeve (cart coordinates, tools/blender/cart.py
 *  STAB_X, STAB_Z; 84 mm square, its top at 0.94 m), and the knot's height on it. */
const POST = { x: -0.5, z: 1.145, half: 0.042, knot: 0.88 };
/** The rag: two ends hanging off the knot at the post's back, a long one and a short one: where each is tied (x, y, z),
 *  how long (m) and wide, in segments (a chain that hangs, swings and is blown). */
const RAGS = [
  { x: -0.505, y: 0.875, z: 1.2, len: 0.46, w: 0.095, segs: 5 },
  { x: -0.47, y: 0.885, z: 1.2, len: 0.14, w: 0.06, segs: 2 },
];
/** It never goes through what's in front of it: behind the post (its back face at z 1.187) and, under this height, the
 *  packed stabiliser's foot plate (reaching z 1.215); never into the sand under the cart. */
const RAG_BACK = 1.2, FOOT = { y: 0.5, z: 1.228 }, RAG_FLOOR = 0.06;
/** How hard the air pushes the cloth (per m/s of air through it), and the most air it feels (m/s): a rag streams back
 *  a little towed, not straight out. */
const RAG_DRAG = 0.65, RAG_AIR = 15;
/** Moved within this distance (m): further off it's a speck. */
const RAG_NEAR = 70;
/** The colour while the server hasn't said whose it is (an older server): undyed cloth. */
const NO_COLOR = 0xb8a88a;
/** Sun-bleached and dusty: the owner's colour dyed down, towards this dust. */
const DUST = new THREE.Color(0xa69a86);

const DEG = Math.PI / 180;
/** Each hinge node unfolded (docs/cart.md "As built"): its level, the share [from, to] of that level's unfolding it
 *  moves in, and where it goes (a rotation about x or z from its rest pose, rad, or `legs`' slide down, m). */
const FOLD: { name: string; level: number; from: number; to: number; rx?: number; rz?: number; dy?: number }[] = [
  { name: 'lid', level: 0, from: 0, to: 0.5, rx: -100 * DEG },
  { name: 'legs', level: 1, from: 0, to: 0.4, dy: -0.46 },
  { name: 'pole_a', level: 1, from: 0.35, to: 1, rx: -90 * DEG },
  { name: 'pole_b', level: 1, from: 0.35, to: 1, rx: 90 * DEG },
  { name: 'side_l', level: 2, from: 0, to: 0.6, rz: 90 * DEG },
  { name: 'side_r', level: 2, from: 0, to: 0.6, rz: -90 * DEG },
  { name: 'leg_l', level: 2, from: 0.5, to: 1, rz: -90 * DEG },
  { name: 'leg_r', level: 2, from: 0.5, to: 1, rz: 90 * DEG },
];
const ease = (t: number, a = 0, b = 1) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** Who's towing: an id, where they are and their bike's heading, and the cart's (PlayerState.hitch); `at`, the tow ball
 *  where their bike is drawn (src/bike.ts hitchAt) and `pitch`, the bike's drawn pitch, when it is drawn. */
export type Tower = { id: number; tow: number; x: number; y: number; z: number; heading: number; hitch: number;
  at?: { x: number; y: number; z: number }; pitch?: number };

type Pose = { x: number; y: number; z: number; heading: number };
type Shown = {
  obj: THREE.Group; tilt: THREE.Group; model: THREE.Object3D | null; level: number;
  wheels: THREE.Object3D[]; stand: THREE.Object3D | null; standAngle: number;
  last: Pose | null; lostS: number; spin: number;
  /** The coupler in the model's frame (its `coupler` node). */
  coupler: THREE.Vector3;
  /** Towed: how it hangs from the tow ball (reset while it isn't towed). */
  hang: Hang;
  /** Parked: the sand's tilt under it along and across (rad), eased out as it's levelled on its stabilisers. */
  slopeX: number; slopeZ: number;
  /** Each level's unfolding, 0 packed .. 1 out; what it's heading for (undefined: not seen yet). */
  fold: number[]; want: number[] | undefined;
  nodes: { n: THREE.Object3D; f: (typeof FOLD)[number]; y0: number }[];
  canopy: THREE.Group | null; canopyKey: string;
  /** Towed: the two wheels' tyre tracks (left, right). */
  tracks: [TyreTrack, TyreTrack];
  /** The owner's colour: the rag's dye and the lid's paint (its own materials), and the colour now. */
  cloth: THREE.MeshStandardNodeMaterial; paint: THREE.MeshStandardNodeMaterial; color: number;
  /** The rag's ends (each its own geometry, moved each frame), a phase for its flutter, and where the cart was and how
   *  fast it went (world, for the air through the rag and its jolts). */
  rags: Rag[]; wave: number; was: THREE.Vector3 | null; vel: THREE.Vector3;
};
/** One end of the rag: a chain of points (the cart's frame) and where they were (Verlet), its cut (each row's width and
 *  the torn hem's teeth), and its strip of cloth. */
type Rag = { spec: (typeof RAGS)[number]; p: THREE.Vector3[]; q: THREE.Vector3[]; widths: number[]; teeth: number[]; geo: THREE.BufferGeometry };

let template: Promise<THREE.Object3D> | undefined;
/** The cart model (shared by every clone): the glb if it loads, else the stand-in. */
function loadCart(): Promise<THREE.Object3D> {
  return (template ??= new GLTFLoader().loadAsync('./models/cart.glb').then((g) => {
    const c = g.scene.getObjectByName('coupler');
    if (c) {
      const p = c.getWorldPosition(new THREE.Vector3());
      if (Math.abs(p.z + TOW_LENGTH) > 0.05) console.warn(`cart.glb: coupler at z ${p.z.toFixed(2)}, the towing has ${-TOW_LENGTH} (shared/cart.ts TOW_LENGTH)`);
    }
    return g.scene as THREE.Object3D;
  }, () => standIn()));
}

/** A model to the node contract (docs/cart.md), built from boxes and cylinders: origin on the ground under the axle's
 *  middle, forward -z, each node pivoted at its hinge. */
function standIn(): THREE.Object3D {
  const mat = (color: number, roughness = 0.85, metalness = 0.3) => new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
  const metal = mat(0x7d5a43), dark = mat(0x3a332d, 0.7, 0.5), wood = mat(0x8a7255, 0.95, 0), rubber = mat(0x1f1d1b, 0.95, 0);
  const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    return b;
  };
  const node = (name: string, x = 0, y = 0, z = 0, ...kids: THREE.Object3D[]) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    if (kids.length) g.add(...kids); // (an empty node: add() with nothing complains)
    return g;
  };
  const root = new THREE.Group();
  const R = CART_WHEEL_R;
  // The bed (2.2 m) on its frame, the axle, and the lidded box on it.
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, CART_HALF_TRACK * 2, 8), dark);
  axle.rotation.z = Math.PI / 2;
  axle.position.y = R;
  root.add(node('body', 0, 0, 0,
    box(1.3, 0.08, 2.2, wood, 0, 0.56, 0),
    box(0.08, 0.14, 2.2, metal, -0.62, 0.5, 0), box(0.08, 0.14, 2.2, metal, 0.62, 0.5, 0),
    box(1.3, 0.14, 0.08, metal, 0, 0.5, -1.1), box(1.3, 0.14, 0.08, metal, 0, 0.5, 1.1),
    axle,
    box(1.1, 0.42, 1.1, metal, 0, 0.81, 0.35),
  ));
  // The box's lid, hinged along its back edge.
  root.add(node('lid', 0, 1.02, 0.9, box(1.14, 0.05, 1.14, metal, 0, 0.025, -0.55)));
  for (const [name, x] of [['wheel_l', -CART_HALF_TRACK], ['wheel_r', CART_HALF_TRACK]] as const) {
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.16, 18), rubber);
    tyre.rotation.z = Math.PI / 2;
    const hub = box(0.18, 0.12, 0.12, metal);
    root.add(node(name, x, R, 0, tyre, hub));
  }
  // The tongue from the bed's front to the coupler at its tip; the stand under it.
  const tongueLen = TOW_LENGTH - 1.1;
  root.add(node('tongue', 0, 0.48, -1.1, box(0.09, 0.09, tongueLen, metal, 0, 0, -tongueLen / 2)));
  const coupler = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), dark);
  root.add(node('coupler', 0, 0.48, -TOW_LENGTH, coupler));
  root.add(node('stand', 0, 0.48, -2.0, box(0.05, 0.05, 0.46, dark, 0, 0, 0.23), box(0.16, 0.16, 0.03, dark, 0, 0, 0.46))); // (lying back)
  // A level's pieces (hidden until it's reached): the canopy's poles folded along the bed, the fold-out sides upright
  // as walls with their legs, the corner stabilisers.
  for (const [name, x] of [['pole_a', -0.55], ['pole_b', 0.55]] as const) {
    root.add(node(name, x, 0.64, 1.0, box(0.04, 0.04, 2.0, wood, 0, 0, -1.0), node(`${name}_tip`, 0, 0, -2.0)));
  }
  for (const [name, leg, x] of [['side_l', 'leg_l', -0.66], ['side_r', 'leg_r', 0.66]] as const) {
    root.add(node(name, x, 0.56, 0, box(0.04, 0.5, 2.1, wood, 0, 0.25, 0)));
    root.add(node(leg, x, 0.56, 0, box(0.04, 0.04, 0.5, dark, 0, 0, 0)));
  }
  root.add(node('legs', 0, 0.5, 0, ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.05, 0.3, 0.05, dark, sx * 0.6, -0.15, sz * 1.0)))));
  return root;
}

/** Seeded dice (mulberry32): each cart's rag is torn and its stripe painted the same way for everyone. */
function dice(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hsl = { h: 0, s: 0, l: 0 };
/** `hex` as dyed cloth or paint after a long time in the sun: `sat` of its saturation left, `dust` of the way to dust. */
function faded(hex: number, sat: number, dust: number, out: THREE.Color): THREE.Color {
  out.setHex(hex).getHSL(hsl);
  out.setHSL(hsl.h, hsl.s * sat, Math.min(0.46, hsl.l));
  return out.lerp(DUST, dust);
}

/** Columns across the rag (3 strips of cloth side by side: the hem torn unevenly across them). */
const RAG_COLS = 4;

/** One end of the rag: hanging straight down from its knot, torn by `rand`. */
function newRag(spec: (typeof RAGS)[number], rand: () => number): Rag {
  const n = spec.segs + 1, seg = spec.len / spec.segs;
  const p = Array.from({ length: n }, (_, i) => new THREE.Vector3(spec.x, spec.y - i * seg, spec.z + 0.004 * i));
  // Frayed sides: each row a little narrower or wider, thinning down; the hem's teeth hang on unevenly (m past the
  // last row).
  const widths = Array.from({ length: n }, (_, i) => spec.w * (i === 0 ? 0.8 : 0.78 + 0.3 * rand()) * (1 - (0.25 * i) / n));
  const teeth = Array.from({ length: RAG_COLS }, () => (rand() - 0.25) * 0.09 * (spec.len / 0.46));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * RAG_COLS * 3), 3));
  // Grimy where it's knotted, bleached and dusty towards the hem, each strip its own shade.
  const col = new Float32Array(n * RAG_COLS * 3);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < RAG_COLS; j++) {
      const u = i / (n - 1), k = 0.72 + 0.22 * u + 0.08 * (rand() - 0.5), dust = 0.08 * u;
      col.set([k + dust, k + dust * 0.9, k + dust * 0.6], (i * RAG_COLS + j) * 3);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const index: number[] = [];
  for (let i = 0; i < spec.segs; i++) {
    for (let j = 0; j < RAG_COLS - 1; j++) {
      const a = i * RAG_COLS + j, b = a + RAG_COLS;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  g.setIndex(index);
  const r: Rag = { spec, p, q: p.map((v) => v.clone()), widths, teeth, geo: g };
  shapeRag(r, 0, 0);
  return r;
}

const tv = new THREE.Vector3(), av = new THREE.Vector3(), fv = new THREE.Vector3();

/** The rag's strip of cloth along its chain, each row across it turned a little (up to `twist` rad, rippling at phase
 *  `wave`) about the way it hangs. */
function shapeRag(r: Rag, wave: number, twist: number) {
  const a = r.geo.getAttribute('position') as THREE.BufferAttribute, n = r.p.length;
  for (let i = 0; i < n; i++) {
    tv.subVectors(r.p[Math.min(n - 1, i + 1)], r.p[Math.max(0, i - 1)]).normalize();
    const tw = twist * (i / (n - 1)) * Math.sin(wave * 0.9 + i * 0.8);
    av.set(Math.cos(tw), 0, Math.sin(tw));
    av.addScaledVector(tv, -av.dot(tv)).normalize();
    for (let j = 0; j < RAG_COLS; j++) {
      fv.copy(r.p[i]).addScaledVector(av, (j / (RAG_COLS - 1) - 0.5) * r.widths[i]);
      if (i === n - 1) fv.addScaledVector(tv, r.teeth[j]);
      a.setXYZ(i * RAG_COLS + j, fv.x, fv.y, fv.z);
    }
  }
  a.needsUpdate = true;
  r.geo.computeVertexNormals();
  r.geo.computeBoundingSphere();
}

const GRAVITY = 9.8;
const vel = new THREE.Vector3(), push = new THREE.Vector3(), step = new THREE.Vector3();

/** The rag over `dt` (s): hanging from its knot, blown by `wind` (the cart's frame: the air through it, m/s), pulled
 *  against `jolt` (the cart's frame: its acceleration plus gravity's lift, m/s²; at rest (0, 9.8, 0)), fluttering at
 *  phase `wave`; kept out of the post, the packed foot plate and the sand. */
function swing(r: Rag, dt: number, wind: THREE.Vector3, jolt: THREE.Vector3, wave: number) {
  const n = r.p.length, seg = r.spec.len / r.spec.segs;
  const subs = Math.min(4, Math.ceil(dt / (1 / 90))), h = dt / subs;
  if (h <= 0) return;
  const speed = Math.min(RAG_AIR, wind.length());
  for (let k = 0; k < subs; k++) {
    for (let i = 1; i < n; i++) {
      const p = r.p[i], q = r.q[i];
      step.subVectors(p, q).multiplyScalar(0.985); // (damped: cloth)
      // The air through it (less as it moves with it), a flutter that grows with the wind, gravity, the jolts.
      vel.copy(step).divideScalar(h);
      push.copy(wind).setLength(speed).sub(vel).multiplyScalar(RAG_DRAG).sub(jolt);
      const fl = (0.5 + speed * 0.35) * (i / (n - 1));
      push.x += fl * Math.sin(wave * 7.3 + i * 1.9) * 0.9;
      push.z += fl * Math.sin(wave * 5.1 + i * 2.7) * 0.6;
      q.copy(p);
      p.add(step).addScaledVector(push, h * h);
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < n; i++) {
        const a = r.p[i - 1], b = r.p[i];
        step.subVectors(b, a);
        const d = step.length() || 1e-6, c = (d - seg) / d;
        if (i === 1) b.addScaledVector(step, -c);
        else {
          a.addScaledVector(step, c / 2);
          b.addScaledVector(step, -c / 2);
        }
      }
      for (let i = 1; i < n; i++) {
        const p = r.p[i], back = p.y < FOOT.y ? FOOT.z : RAG_BACK;
        if (p.z < back && Math.abs(p.x - POST.x) < 0.14) p.z = back;
        if (p.y < RAG_FLOOR) p.y = RAG_FLOOR;
      }
    }
  }
}

/** Two geometries joined into one (position and normal, unindexed). */
function joined(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const na = a.index ? a.toNonIndexed() : a, nb = b.index ? b.toNonIndexed() : b;
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal']) {
    const x = na.getAttribute(k).array as Float32Array, y = nb.getAttribute(k).array as Float32Array;
    const out = new Float32Array(x.length + y.length);
    out.set(x);
    out.set(y, x.length);
    g.setAttribute(k, new THREE.BufferAttribute(out, 3));
  }
  return g;
}
/** The knot round the post: a wrap of the cloth, a little askew, and the lump of the knot at its back, where the ends
 *  hang from (every cart's). */
const knotGeo = joined(
  new THREE.BoxGeometry(POST.half * 2 + 0.014, 0.045, POST.half * 2 + 0.014).rotateZ(0.14).translate(POST.x, POST.knot, POST.z),
  new THREE.IcosahedronGeometry(0.026, 0).scale(1.25, 0.85, 0.8).rotateZ(0.5).translate(POST.x - 0.012, POST.knot - 0.006, POST.z + POST.half + 0.01),
);

/** A stripe painted by hand down the middle of the lid (on its top, as a child of the `lid` node so it opens with it),
 *  sized from the lid as loaded: a little crooked, its edges and ends ragged, chipped here and there and worn patchy,
 *  each point laid on whatever it's painted over (dropped onto the lid). */
function paintLid(model: THREE.Object3D, paint: THREE.Material, rand: () => number) {
  const lid = model.getObjectByName('lid');
  if (!lid) return;
  model.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(lid);
  if (b.isEmpty()) return;
  const at = lid.getWorldPosition(new THREE.Vector3()); // (packed, every node's rotation is identity: docs/cart.md)
  const w = Math.min(0.15, (b.max.x - b.min.x) * 0.2), d = (b.max.z - b.min.z) * 0.84;
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  const rows = 12, cols = 3, lean = (rand() - 0.5) * 0.05;
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
  const pos: number[] = [], col: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const u = i / rows, z = cz - d / 2 + d * u + (i === 0 || i === rows ? (rand() - 0.5) * 0.06 : 0);
    const mid = cx + lean * (u - 0.5) + 0.006 * Math.sin(u * 9 + rand());
    for (let j = 0; j <= cols; j++) {
      const v = j / cols, x = mid + (v - 0.5) * w + (j === 0 || j === cols ? (rand() - 0.5) * 0.018 : 0);
      ray.set(from.set(x, b.max.y + 0.1, z), down);
      const hit = ray.intersectObject(lid, true)[0];
      pos.push(x - at.x, (hit ? hit.point.y : b.max.y) + 0.0015 - at.y, z - at.z);
      const k = 0.78 + 0.22 * rand();
      col.push(k, k, k * 0.96);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const edge = j === 0 || j === cols - 1 || i === 0 || i === rows - 1;
      if (edge && rand() < 0.09) continue; // (chipped off)
      const a = i * (cols + 1) + j, c = a + cols + 1;
      index.push(a, c, a + 1, a + 1, c, c + 1); // (facing up)
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  const stripe = new THREE.Mesh(g, paint);
  stripe.receiveShadow = true;
  stripe.userData.own = true; // (its geometry is this cart's: disposed with it)
  lid.add(stripe);
}

const tmpSlope = { gx: 0, gz: 0 };

export class CartView {
  private group = new THREE.Group();
  private shown = new Map<number, Shown>();

  constructor(scene: THREE.Object3D) {
    scene.add(this.group);
    loadCart();
  }

  /** Every frame: the carts in `list` near `me`, parked or towed by one of `towers` (us first, then the others), their
   *  rags in a wind of `wind` m/s (shared/power.ts windSpeed) blowing the way env.ts windDir has it. */
  update(dt: number, list: readonly Vehicle[], towers: readonly Tower[], me: { x: number; z: number }, wind = 4) {
    const seen = new Set<number>();
    for (const v of list) {
      if (!isCart(v)) continue;
      const t = towers.find((o) => o.tow === v.id);
      let pose: Pose | null = null;
      if (t) {
        const p = towedPose(t);
        pose = { x: p.x, y: heightAt(p.x, p.z), z: p.z, heading: p.heading }; // (for the view distance; tow() poses it)
      } else if (parked(v)) pose = { x: v.x, y: v.y, z: v.z, heading: v.heading };
      const s0 = this.shown.get(v.id);
      if (!pose && s0?.last && s0.lostS < HOLD_S) {
        s0.lostS += dt;
        pose = s0.last;
      }
      // (A towed one goes wherever its bike is drawn, however far: never a bike without its cart.)
      if (!pose || (!t && Math.hypot(pose.x - me.x, pose.z - me.z) > VIEW)) continue;
      seen.add(v.id);
      let s = s0;
      if (!s) this.shown.set(v.id, (s = this.build(v.id)));
      if (t || parked(v)) s.lostS = 0;
      if (t) this.tow(s, t, dt);
      else if (pose !== s.last) {
        s.hang.ay = NaN;
        for (const tr of s.tracks) tr.break();
        this.place(s, pose);
      }
      this.pieces(s, v, dt, !!t);
      this.rag(s, v, dt, wind, !!t, Math.hypot(pose.x - me.x, pose.z - me.z) < RAG_NEAR);
    }
    for (const [id, s] of this.shown) {
      if (seen.has(id)) continue;
      this.group.remove(s.obj);
      this.dropCanopy(s);
      for (const r of s.rags) r.geo.dispose();
      s.model?.traverse((o) => o.userData.own && (o as THREE.Mesh).geometry.dispose());
      s.cloth.dispose();
      s.paint.dispose();
      this.shown.delete(id);
    }
  }

  private build(id: number): Shown {
    const obj = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.rotation.order = 'YXZ';
    obj.add(tilt);
    this.group.add(obj);
    // Cloth and paint: matte, lit like the rest of the cart, shaded by their vertex colours (grime, wear).
    const cloth = new THREE.MeshStandardNodeMaterial({ color: NO_COLOR, roughness: 1, metalness: 0, side: THREE.DoubleSide, vertexColors: true });
    const paint = new THREE.MeshStandardNodeMaterial({ color: NO_COLOR, roughness: 0.9, metalness: 0, vertexColors: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const rand = dice(id * 2654435761);
    const s: Shown = { obj, tilt, model: null, level: -1, wheels: [], stand: null, standAngle: 0, last: null, lostS: 0, spin: 0,
      coupler: new THREE.Vector3(0, COUPLER_Y, -TOW_LENGTH), hang: newHang(), slopeX: 0, slopeZ: 0,
      fold: [0, 0, 0], want: undefined, nodes: [], canopy: null, canopyKey: '', tracks: [new TyreTrack(), new TyreTrack()],
      cloth, paint, color: -1, rags: RAGS.map((r) => newRag(r, rand)), wave: rand() * 50, was: null, vel: new THREE.Vector3() };
    // The rag knotted round the corner post, in the cart's frame (the model's: it sits in `tilt` unmoved).
    const knot = new THREE.Mesh(knotGeo, cloth);
    knot.castShadow = true;
    tilt.add(knot);
    for (const r of s.rags) {
      const m = new THREE.Mesh(r.geo, cloth);
      m.castShadow = true;
      m.frustumCulled = false; // (it moves: its bounds are refreshed only near)
      tilt.add(m);
    }
    loadCart().then((t) => {
      const m = t.clone(true);
      m.traverse((o) => {
        o.castShadow = o.receiveShadow = true;
        o.userData.shared = true; // its geometry is every cart's: never disposed
      });
      s.model = m;
      s.wheels = ['wheel_l', 'wheel_r'].flatMap((n) => m.getObjectByName(n) ?? []);
      s.stand = m.getObjectByName('stand') ?? null;
      const c = m.getObjectByName('coupler');
      if (c) {
        m.updateMatrixWorld(true);
        c.getWorldPosition(s.coupler);
      }
      s.nodes = FOLD.flatMap((f) => {
        const n = m.getObjectByName(f.name);
        return n ? [{ n, f, y0: n.position.y }] : [];
      });
      s.level = -1;
      paintLid(m, paint, dice(id * 40503 + 7));
      tilt.add(m);
    }, () => {});
    return s;
  }

  /** Parked: standing on the sand at `p`, along the slope and across it. */
  private place(s: Shown, p: Pose) {
    this.roll(s, p);
    s.obj.position.set(p.x, p.y, p.z);
    s.obj.rotation.y = p.heading;
    const g = slopeAt(p.x, p.z, tmpSlope);
    s.slopeX = Math.atan(-g.gx * Math.sin(p.heading) - g.gz * Math.cos(p.heading));
    s.slopeZ = Math.atan(g.gx * Math.cos(p.heading) - g.gz * Math.sin(p.heading));
  }

  private dropCanopy(s: Shown) {
    if (!s.canopy) return;
    this.group.remove(s.canopy);
    s.canopy.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    s.canopy = null;
    s.canopyKey = '';
  }

  /** The wheels roll with the ground the axle covers along its heading. */
  private roll(s: Shown, p: Pose) {
    if (s.last) {
      const d = -(p.x - s.last.x) * Math.sin(p.heading) - (p.z - s.last.z) * Math.cos(p.heading);
      if (Math.abs(d) < 5) s.spin -= d / CART_WHEEL_R;
    }
    s.last = p;
    for (const w of s.wheels) w.rotation.x = s.spin;
  }

  /** Towed by `t`: hung from its tow ball (the coupler exactly on it), heading t.hitch, pitched about the coupler, falling
   *  and landing on its own (shared/cartHang.ts). */
  private tow(s: Shown, t: Tower, dt: number) {
    let H = t.at;
    if (!H) {
      const h = hitchPoint(t.x, t.z, t.heading);
      H = { x: h.x, y: t.y + HITCH_Y, z: h.z };
    }
    const g = hangCart(s.hang, H, t.hitch, t.pitch ?? 0, t.heading, s.coupler, dt, heightAt);
    s.obj.position.set(g.x, g.y, g.z);
    s.obj.rotation.y = g.psi;
    s.tilt.rotation.x = g.phi;
    s.tilt.rotation.z = g.roll;
    this.roll(s, { x: g.axle.x, y: g.axle.y - CART_WHEEL_R, z: g.axle.z, heading: g.psi });
    // Tyre tracks, as the bike's (src/bike.ts): from under each wheel's hub while it's on the sand.
    for (let i = 0; i < 2; i++) {
      const c = turned({ x: (i ? 1 : -1) * CART_HALF_TRACK, y: CART_WHEEL_R, z: 0 }, g.psi, g.phi, g.roll);
      const x = g.x + c.x, z = g.z + c.z;
      if (g.y + c.y - CART_WHEEL_R > heightAt(x, z) + 0.05 || biome('mudflat', x, z) > 0.5) s.tracks[i].break();
      else s.tracks[i].to(x, z);
    }
  }

  /** The stand and the level's pieces: unfolding, each level's pieces out while it's open and reached (a change heard,
   *  not on first sight); parked, levelled on its stabilisers as they come down; the canopy once the poles are up. */
  private pieces(s: Shown, v: Vehicle, dt: number, towed: boolean) {
    const down = v.hitched !== undefined ? 0 : STAND_DOWN;
    s.standAngle += (down - s.standAngle) * Math.min(1, dt * STAND_RATE);
    if (s.stand) s.stand.rotation.x = s.standAngle;
    const level = v.level ?? 0;
    const want = [0, 1, 2].map((l) => (v.open && level >= l ? 1 : 0));
    if (s.want && want.some((w, l) => w !== s.want![l])) cartSound.play(v.x, v.z, !v.open);
    if (!s.want) s.fold = [...want];
    s.want = want;
    for (let l = 0; l < 3; l++) {
      const d = want[l] - s.fold[l];
      s.fold[l] += Math.sign(d) * Math.min(Math.abs(d), dt / UNFOLD_S);
    }
    for (const { n, f, y0 } of s.nodes) {
      const t = ease(s.fold[f.level], f.from, f.to);
      if (f.rx !== undefined) n.rotation.x = f.rx * t;
      if (f.rz !== undefined) n.rotation.z = f.rz * t;
      if (f.dy !== undefined) n.position.y = y0 + f.dy * t;
    }
    if (!towed) {
      const lift = 1 - ease(s.fold[1], 0, 0.4);
      s.tilt.rotation.x = lift * s.slopeX;
      s.tilt.rotation.z = lift * s.slopeZ;
    }
    // The canopy, once its poles are up.
    const key = v.open && level >= 1 && s.fold[1] >= 1 ? `${v.x},${v.y},${v.z},${v.heading}` : '';
    if (key !== s.canopyKey) {
      this.dropCanopy(s);
      s.canopyKey = key;
      if (key) this.group.add((s.canopy = rigModel(canopyRig(v), { x: v.x, y: v.y, z: v.z }, v.id)));
    }
    if (s.model && s.level !== level) {
      s.level = level;
      for (const [name, at] of Object.entries(CART_LEVEL_NODES)) {
        const n = s.model.getObjectByName(name);
        if (n) n.visible = level >= at;
      }
    }
  }

  /** The owner's colour, sun-faded, and the rag (near): stirring in the wind parked, streaming back a little towed,
   *  shaken by the bumps. */
  private rag(s: Shown, v: Vehicle, dt: number, wind: number, towed: boolean, near: boolean) {
    const color = v.color ?? NO_COLOR;
    if (color !== s.color) {
      s.color = color;
      faded(color, 0.5, 0.26, s.cloth.color);
      faded(color, 0.6, 0.2, s.paint.color);
    }
    const pos = s.obj.getWorldPosition(wp);
    if (!near || dt <= 0) {
      s.was = null;
      return;
    }
    // The cart's own speed and jolts (towed; a jump when it's first seen or put somewhere new is none).
    jolt.set(0, 0, 0);
    if (s.was && towed && pos.distanceTo(s.was) < 3) {
      const v1 = air.subVectors(pos, s.was).divideScalar(dt);
      jolt.subVectors(v1, s.vel).divideScalar(dt).clampLength(0, 25);
      s.vel.lerp(v1, Math.min(1, dt * 20));
    } else s.vel.set(0, 0, 0);
    s.was = (s.was ?? new THREE.Vector3()).copy(pos);
    // The air through the rag (the wind less the cart's speed) and what it feels pulling it (gravity, and the cart's
    // jolts backwards), into the cart's frame (`tilt`).
    air.set(windDir.value.x * wind, 0, windDir.value.y * wind).sub(s.vel);
    jolt.y += GRAVITY;
    s.tilt.getWorldQuaternion(turn).invert();
    air.applyQuaternion(turn);
    jolt.applyQuaternion(turn);
    s.wave += dt;
    const twist = Math.min(0.9, 0.25 + air.length() * 0.05);
    for (const r of s.rags) {
      swing(r, Math.min(dt, 1 / 20), air, jolt, s.wave);
      shapeRag(r, s.wave * 3, twist);
    }
  }
}

const wp = new THREE.Vector3(), air = new THREE.Vector3(), jolt = new THREE.Vector3(), turn = new THREE.Quaternion();
