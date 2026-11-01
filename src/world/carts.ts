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
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CART_HALF_TRACK, CART_LEVEL_NODES, CART_WHEEL_R, canopyRig, COUPLER_Y, hitchPoint, HITCH_Y, isCart, TOW_LENGTH, towedPose, UNFOLD_S } from '../../shared/cart.ts';
import { hangCart, newHang, turned, type Hang } from '../../shared/cartHang.ts';
import { biome } from '../../shared/biomes.ts';
import { cartSound } from '../cartSound';
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
};

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

const tmpSlope = { gx: 0, gz: 0 };

export class CartView {
  private group = new THREE.Group();
  private shown = new Map<number, Shown>();

  constructor(scene: THREE.Object3D) {
    scene.add(this.group);
    loadCart();
  }

  /** Every frame: the carts in `list` near `me`, parked or towed by one of `towers` (us first, then the others). */
  update(dt: number, list: readonly Vehicle[], towers: readonly Tower[], me: { x: number; z: number }) {
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
      if (!s) this.shown.set(v.id, (s = this.build()));
      if (t || parked(v)) s.lostS = 0;
      if (t) this.tow(s, t, dt);
      else if (pose !== s.last) {
        s.hang.ay = NaN;
        for (const tr of s.tracks) tr.break();
        this.place(s, pose);
      }
      this.pieces(s, v, dt, !!t);
    }
    for (const [id, s] of this.shown) {
      if (seen.has(id)) continue;
      this.group.remove(s.obj);
      this.dropCanopy(s);
      this.shown.delete(id);
    }
  }

  private build(): Shown {
    const obj = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.rotation.order = 'YXZ';
    obj.add(tilt);
    this.group.add(obj);
    const s: Shown = { obj, tilt, model: null, level: -1, wheels: [], stand: null, standAngle: 0, last: null, lostS: 0, spin: 0,
      coupler: new THREE.Vector3(0, COUPLER_Y, -TOW_LENGTH), hang: newHang(), slopeX: 0, slopeZ: 0,
      fold: [0, 0, 0], want: undefined, nodes: [], canopy: null, canopyKey: '', tracks: [new TyreTrack(), new TyreTrack()] };
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
}
