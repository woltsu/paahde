// The runner (shared/runner.ts) as drawn: runner.glb's rigid parts hung on a rig (per leg: hip roll -> thigh pitch ->
// shin pitch; the head on a yaw/pitch neck), the legs put on feet the gait plants in the world by two-bone IK, knees
// bending backwards.
//
// Gait: one stride clock (`t`, strides) shared by the four legs, each a fixed offset along it: a trot (diagonal pairs,
// FL+RR then FR+RL) blending into a transverse gallop (the hind pair, then the front pair, each foot a beat after its
// partner, then a moment in the air) between RUNNER_TROT and RUNNER_GALLOP. A leg stands for the first `duty` of its
// cycle, its foot planted, and swings for the rest, landing where its rest spot will be half a stance later (Raibert's
// rule), so the feet keep up at any speed without sliding. Strides come quicker as it goes faster, so a stance never
// asks a leg to reach further than it can. Stopped, it steps until every foot stands at its rest spot; then the clock
// stops.
//
// The jaws flex idly, open slowly and snap shut while it stares, gape and chatter while it runs hot (`alert`).
// Dead, it lies with its nose in the sand, jaws slack, but its wreck can wake (`lunge`): head reared, eyes flickering,
// jaws drawn back wide, then snapped shut.
// The body rides standY over the ground, pitched and rolled to the ground under its feet, bobbing with the stride
// (twice a stride trotting; galloping, a rocking pitch), crouching lower the faster it goes, leaning into turns and
// forward as it speeds up. The head looks at what it's given (`look`) or about, its eyes pulsing.
//
// `Prowl` moves one about (client-side, for show: the models lab's), `Runners` draws the server's (server/runners.ts).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  R_CHARGE, RP_CORE, RP_EYES, RP_VENT_L, RP_VENT_R, RUNNER, RUNNER_GALLOP, RUNNER_SPRINT, RUNNER_TROT, RUNNER_WAKE_MS, RUNNER_WALK, type RunnerKind, WRECK_MAW,
} from '../../shared/runner.ts';
import type { RunnerFrame } from './botFrames';

/** Its wreck's jaws drawn back this long (s) before they snap. */
const WAKE_S = RUNNER_WAKE_MS / 1000;

const PARTS = ['Runner_Body', 'Runner_BodyArmed', 'Runner_ArmBase', 'Runner_ArmUpper', 'Runner_ArmFore', 'Runner_GunMount', 'Runner_Rifle', 'Runner_Head', 'Runner_JawL', 'Runner_JawR', 'Runner_HipL', 'Runner_HipR', 'Runner_ThighL', 'Runner_ThighR', 'Runner_ShinL', 'Runner_ShinR'] as const;
type PartName = (typeof PARTS)[number];

let parts: Record<PartName, THREE.Object3D> | null = null;
let loading: Promise<void> | null = null;

/** Loads runner.glb once; `Runner`s can be made after. */
export function loadRunner(): Promise<void> {
  return (loading ??= new GLTFLoader().loadAsync('./models/runner.glb').then(
    (gltf) => {
      const got = {} as Record<PartName, THREE.Object3D>;
      for (const k of PARTS) {
        const o = gltf.scene.getObjectByName(k);
        if (!o) throw new Error(`runner.glb has no ${k}`);
        o.removeFromParent();
        o.position.set(0, 0, 0);
        o.quaternion.identity();
        got[k] = o;
      }
      parts = got;
    },
    (e) => console.warn('runner: model failed', e),
  ));
}

export const runnerLoaded = () => parts !== null;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const frac = (x: number) => x - Math.floor(x);
const ease = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Legs in order FL, FR, RL, RR (L is +X: the body's left). Phase offsets along the stride, trotting and galloping. */
const LEGS = [{ side: 1, front: true }, { side: -1, front: true }, { side: 1, front: false }, { side: -1, front: false }] as const;
const TROT = [0, 0.5, 0.5, 0];
const GALLOP = [0.5, 0.6, 0, 0.1];
/** Fraction of a stride a foot is down: walking, trotting, galloping. */
const DUTY_WALK = 0.62, DUTY_TROT = 0.5, DUTY_GALLOP = 0.32;
/** A foot's rest spot sits this far forward of its hip (m), so it stands a little splayed. */
const REST_FWD = [0.06, 0.06, -0.04, -0.04];
/** World size over model size (shared/runner.ts): the IK works in the body's (model) frame, lengths in the world × S. */
const S = RUNNER.scale;
/** The gun arm's wrist (y, z from the shoulder, model units): carried, the gun borne over the back; raised, high to
 *  aim. Both keep the elbow well below the wrist, so the forearm comes up to the gun's pylon from below, steeply enough
 *  to take up the body's bounce (held steady) without swinging into the gun. A shot every
 *  FIRE_S while on target. */
const CARRY = [0.6, 0.05] as const, AIM = [0.75, 0.2] as const;
const FIRE_S = 2.4;
/** Firing, the gun slams back along its rails in RECOIL_BACK s, stays there till RECOIL_HOLD and is home by RECOIL_HOME. */
const RECOIL_BACK = 0.04, RECOIL_HOLD = 0.12, RECOIL_HOME = 0.7;
/** The gun is never pitched up past the forearm's line by more than -FOREARM_CLEAR (rad): further, the forearm would
 *  swing up into its belly (which sits 0.065 over the pivot; the forearm is 0.04 thick either side of its line, and
 *  0.55 long: sin(0.04) * 0.55 + 0.04 < 0.065). */
const FOREARM_CLEAR = -0.03;

/** Shoulder and elbow elevations (rad, up from level) putting the gun arm's wrist at (y, z) from the shoulder (model
 *  units, the base's frame), elbow up and behind. */
function armIk(y: number, z: number): [number, number] {
  const L1 = RUNNER.arm.upper, L2 = RUNNER.arm.fore;
  const d = Math.max(Math.abs(L1 - L2) + 0.02, Math.min(L1 + L2 - 1e-3, Math.hypot(y, z)));
  const up = Math.atan2(y, z) + Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
  return [up, Math.atan2(y - L1 * Math.sin(up), z - L1 * Math.cos(up))];
}
/** Stopped, a foot further than this (m) from its rest spot steps to it. */
const SETTLE = 0.1 * S;

type Leg = {
  side: 1 | -1;
  /** Socket in the body frame. */
  sx: number; sz: number;
  hip: THREE.Object3D; thigh: THREE.Object3D; shin: THREE.Object3D;
  /** The claw's tip (world). */
  foot: THREE.Vector3;
  from: THREE.Vector3;
  /** Swing progress 0..1, -1 planted; its duration (s); the stride it was taken in (one swing per stride). */
  s: number; dur: number; cycle: number;
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Vector3(), _d = new THREE.Vector3(), _sh = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _e = new THREE.Euler();

export type Ground = (x: number, z: number) => number;

/** A hit box in a part's frame (model units): min, max, and the weak point it is (RP_*, shared/runner.ts), -1 armour. */
type HitBox = { min: readonly [number, number, number]; max: readonly [number, number, number]; i: number };
/** The hull, and the glowing vents on its flanks (tools/blender/runner.py skirts). */
const BODY_BOXES: readonly HitBox[] = [
  { min: [-0.33, -0.23, -1.05], max: [0.33, 0.25, 1.05], i: -1 },
  { min: [0.24, -0.1, -0.3], max: [0.4, 0.1, 0.3], i: RP_VENT_L },
  { min: [-0.4, -0.1, -0.3], max: [-0.24, 0.1, 0.3], i: RP_VENT_R },
];
/** The head (neck frame) and the eye cluster on its brow. */
const HEAD_BOXES: readonly HitBox[] = [
  { min: [-0.2, -0.13, -0.05], max: [0.2, 0.14, 0.6], i: -1 },
  { min: [-0.17, -0.04, 0.3], max: [0.17, 0.11, 0.56], i: RP_EYES },
];
/** The armed one's gun (slide frame): its housing and the power core at its back. */
const GUN_BOXES: readonly HitBox[] = [
  { min: [-0.27, 0.05, -0.86], max: [0.27, 0.33, 1.25], i: -1 },
  { min: [-0.09, 0.12, -0.9], max: [0.09, 0.26, -0.78], i: RP_CORE },
];
/** A weak point counts if the shot gets to it no more than this (world m) past the armour round it. */
const WEAK_FIRST = 0.25;
const _inv = new THREE.Matrix4(), _ro = new THREE.Vector3(), _rd = new THREE.Vector3(), _hn = new THREE.Vector3();

/** Where the ray o + t·d (local frame; t in world metres) enters box b, before `max`: t, its face's normal into `n`;
 *  -1 if it doesn't (from inside: 0). */
function slab(b: HitBox, o: THREE.Vector3, d: THREE.Vector3, max: number, n: THREE.Vector3): number {
  let t0 = 0, t1 = max, axis = -1, sign = 0;
  for (let k = 0; k < 3; k++) {
    const ok = k === 0 ? o.x : k === 1 ? o.y : o.z, dk = k === 0 ? d.x : k === 1 ? d.y : d.z;
    if (Math.abs(dk) < 1e-12) {
      if (ok < b.min[k] || ok > b.max[k]) return -1;
      continue;
    }
    let a = (b.min[k] - ok) / dk, c = (b.max[k] - ok) / dk, s = -1;
    if (a > c) ([a, c] = [c, a]), (s = 1);
    if (a > t0) (t0 = a), (axis = k), (sign = s);
    t1 = Math.min(t1, c);
    if (t0 > t1) return -1;
  }
  n.set(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
  return t0;
}

export class Runner {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private neck = new THREE.Group();
  /** The jaws' hinges (left, right) and how far open they are (rad). */
  private jaws: THREE.Group[] = [];
  private gape = 0;
  private legs: Leg[] = [];
  private eyes: THREE.MeshStandardMaterial[] = [];
  /** The armed one's gun arm (null on a plain one): joints, the gun's mount at the wrist (`rifle`) with the gun on it
   *  (`slide`, sliding back along the mount's rails as it fires), the glowing coils. */
  private arm: { base: THREE.Group; upper: THREE.Group; fore: THREE.Group; rifle: THREE.Group; slide: THREE.Group } | null = null;
  private coils: THREE.MeshStandardMaterial[] = [];
  /** Arm: how far raised to aim (0 carried .. 1), the gun's heading and pitch (world), and when it last fired (s). */
  private raise = 0; private gunYaw = 0; private aimPitch = 0; private firedAt = -1e9;
  /** The gun's steady frame (see `gun`): its heading. */
  private steadyOn = false; private steadyYaw = 0;
  /** The armed one holds its gun steady while it runs (false: the gun rides the body; the models lab's ?runner=stab). */
  stabilize = true;
  private x = 0; private z = 0; private yaw = 0;
  private vx = 0; private vz = 0; private yawRate = 0; private accel = 0;
  private y = 0; private pitch = 0; private roll = 0;
  private headYaw = 0; private headPitch = 0;
  /** Stride clock (strides) and how fast it runs (strides/s). */
  private t = 0; private freq = 0;
  private placed = false;
  private seed = Math.random() * 100;
  /** 0..1: how hot its eyes burn (hunting). */
  alert = 0;
  /** The gun fires by itself every FIRE_S on target (the show's); off, only on `fire()` (the server's), its coils
   *  charging while `charging`. */
  auto = true;
  charging = false;
  private chargeLevel = 0;
  /** Its last bite (s, `now` / 1000): the jaws snap shut. Its wreck's last waking (s): the jaws drawn back. */
  private snapAt = -1e9;
  private lungeAt = -1e9;
  /** Seconds since it died (0 alive): it slumps down on its legs, its eyes going out. */
  dead = 0;
  /** A foot came down at (x, y, z), the body going `speed` m/s. */
  onFootfall: ((x: number, y: number, z: number, speed: number) => void) | null = null;

  private ground: Ground;

  readonly kind: RunnerKind;

  constructor(ground: Ground, kind: RunnerKind = 'plain') {
    this.ground = ground;
    this.kind = kind;
    if (!parts) throw new Error('runner: loadRunner() first');
    const p = parts;
    const mount = (o: THREE.Object3D) => {
      const c = o.clone();
      c.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.name === 'RunnerEye') {
          // Its own, to pulse.
          const e = mat.clone();
          e.userData.base = mat.emissiveIntensity;
          mesh.material = e;
          this.eyes.push(e);
        } else if (mat.name === 'RunnerGunGlow') {
          const e = mat.clone();
          e.userData.base = mat.emissiveIntensity;
          mesh.material = e;
          this.coils.push(e);
        }
      });
      return c;
    };
    this.root.add(this.body);
    this.body.add(mount(kind === 'armed' ? p.Runner_BodyArmed : p.Runner_Body));
    if (kind === 'armed') {
      const A = RUNNER.arm;
      const base = new THREE.Group(), upper = new THREE.Group(), fore = new THREE.Group(), rifle = new THREE.Group(), slide = new THREE.Group();
      base.position.set(...A.mount);
      base.add(mount(p.Runner_ArmBase));
      upper.position.set(...A.shoulder);
      upper.add(mount(p.Runner_ArmUpper));
      fore.position.set(0, 0, A.upper);
      fore.add(mount(p.Runner_ArmFore));
      rifle.position.set(0, 0, A.fore);
      rifle.add(mount(p.Runner_GunMount));
      slide.add(mount(p.Runner_Rifle));
      rifle.add(slide);
      fore.add(rifle);
      upper.add(fore);
      base.add(upper);
      this.body.add(base);
      this.arm = { base, upper, fore, rifle, slide };
    }
    this.neck.position.set(...RUNNER.neck);
    this.neck.rotation.order = 'YXZ';
    this.neck.add(mount(p.Runner_Head));
    for (const side of [1, -1]) {
      const jaw = new THREE.Group();
      jaw.position.set(side * RUNNER.jaw[0], RUNNER.jaw[1], RUNNER.jaw[2]);
      jaw.add(mount(side > 0 ? p.Runner_JawL : p.Runner_JawR));
      this.neck.add(jaw);
      this.jaws.push(jaw);
    }
    this.body.add(this.neck);
    for (const { side, front } of LEGS) {
      const sx = side * RUNNER.sockX, sz = (front ? 1 : -1) * RUNNER.sockZ;
      const hip = new THREE.Group(), thigh = new THREE.Group(), shin = new THREE.Group();
      const s = side > 0 ? 'L' : 'R';
      hip.position.set(sx, RUNNER.sockY, sz);
      hip.add(mount(p[`Runner_Hip${s}`]));
      thigh.position.set(side * RUNNER.hipOut, 0, 0);
      thigh.add(mount(p[`Runner_Thigh${s}`]));
      shin.position.set(0, -RUNNER.thigh, 0);
      shin.add(mount(p[`Runner_Shin${s}`]));
      hip.add(thigh);
      thigh.add(shin);
      this.body.add(hip);
      this.legs.push({ side, sx, sz, hip, thigh, shin, foot: new THREE.Vector3(), from: new THREE.Vector3(), s: -1, dur: 0, cycle: -1 });
    }
    this.body.rotation.order = 'YXZ';
    this.body.scale.setScalar(S);
  }

  /** The body's centre (world), as last drawn. */
  get position(): THREE.Vector3 {
    return this.body.position;
  }

  /** Puts it standing at (x, z) facing `yaw` (+Z forward), feet at rest. */
  place(x: number, z: number, yaw: number) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.vx = this.vz = this.yawRate = this.accel = 0;
    this.legs.forEach((leg, i) => {
      this.rest(i, 0, leg.foot);
      leg.s = -1;
    });
    this.y = this.ground(x, z) + RUNNER.standY * S;
    this.placed = true;
  }

  /** Leg i's rest spot (world, on the ground), `lead` s ahead along its velocity, into `out`. */
  private rest(i: number, lead: number, out: THREE.Vector3) {
    const leg = this.legs[i];
    const lx = (leg.sx + leg.side * RUNNER.hipOut) * S, lz = (leg.sz + REST_FWD[i]) * S;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    // Ahead, no further than a leg can take in a stride.
    const lv = Math.min(1, (0.9 * S) / Math.max(1e-6, Math.hypot(this.vx, this.vz) * lead));
    out.x = this.x + lx * c + lz * s + this.vx * lead * lv;
    out.z = this.z - lx * s + lz * c + this.vz * lead * lv;
    out.y = this.ground(out.x, out.z);
    return out;
  }

  /** Per frame: where it now is and faces (moved by its driver), what it looks at (null: about), the time (ms). */
  update(dt: number, x: number, z: number, yaw: number, look: THREE.Vector3 | null, now: number) {
    if (dt <= 0) return;
    if (!this.placed || Math.hypot(x - this.x, z - this.z) > 5 * S) this.place(x, z, yaw);
    // Velocity from how it moved, a little smoothed (the driver's steps can be uneven).
    const speed0 = Math.hypot(this.vx, this.vz);
    this.vx = ease(this.vx, (x - this.x) / dt, 20, dt);
    this.vz = ease(this.vz, (z - this.z) / dt, 20, dt);
    this.yawRate = ease(this.yawRate, wrap(yaw - this.yaw) / dt, 10, dt);
    this.x = x; this.z = z; this.yaw = yaw;
    const speed = Math.hypot(this.vx, this.vz);
    this.accel = ease(this.accel, (speed - speed0) / dt, 6, dt);
    // Dead, its feet stay where they stood.
    if (this.dead <= 0) this.step(dt, speed);
    this.pose(dt, speed, this.dead > 0 ? null : look, now);
  }

  private step(dt: number, speed: number) {
    const g = smooth(RUNNER_TROT, RUNNER_GALLOP, speed);
    const duty = lerp(lerp(DUTY_WALK, DUTY_TROT, smooth(0.5, RUNNER_TROT, speed)), DUTY_GALLOP, g);
    // A stance covers this much ground (m), and no more: strides quicken with speed.
    const stance = S * Math.min(1.0, 0.45 + 0.035 * speed);
    let freq: number;
    if (speed > 0.15) freq = Math.max(1.4, (speed * duty) / stance);
    else {
      // Stopped: on until every foot is down at its rest spot.
      const unsettled = this.legs.some((leg, i) => leg.s >= 0 || this.rest(i, 0, _v).distanceTo(leg.foot) > SETTLE);
      freq = unsettled ? 1.8 : 0;
    }
    this.freq = freq;
    this.t += freq * dt;
    this.legs.forEach((leg, i) => {
      const at = this.t + lerp(TROT[i], GALLOP[i], g);
      const p = frac(at), cycle = Math.floor(at);
      if (leg.s < 0 && p >= duty && cycle !== leg.cycle && freq > 0) {
        leg.s = 0;
        leg.cycle = cycle;
        leg.dur = (1 - duty) / freq;
        leg.from.copy(leg.foot);
      }
      if (leg.s < 0) return;
      leg.s = Math.min(1, leg.s + dt / leg.dur);
      // Landing where the rest spot will be half a stance on.
      const left = (1 - leg.s) * leg.dur;
      this.rest(i, left + (freq > 0 ? (0.5 * duty) / freq : 0), _v);
      const e = leg.s * leg.s * (3 - 2 * leg.s);
      const span = Math.hypot(_v.x - leg.from.x, _v.z - leg.from.z);
      leg.foot.lerpVectors(leg.from, _v, e);
      // Up and over: higher for a longer stride, the claw snatched up early and set down late.
      leg.foot.y += Math.sin(Math.PI * Math.pow(leg.s, 0.7)) * S * Math.min(0.32, 0.07 + (0.22 * span) / S);
      if (leg.s >= 1) {
        leg.s = -1;
        leg.foot.copy(_v);
        this.onFootfall?.(_v.x, _v.y, _v.z, speed);
      }
    });
  }

  private pose(dt: number, speed: number, look: THREE.Vector3 | null, now: number) {
    const R = RUNNER, g = smooth(RUNNER_TROT, RUNNER_GALLOP, speed), moving = smooth(0.2, 2, speed);
    // The ground under it: front and back, left and right, from the feet's rest spots.
    let front = 0, back = 0, left = 0, right = 0;
    this.legs.forEach((leg, i) => {
      const h = this.rest(i, 0, _w).y;
      if (i < 2) front += h / 2; else back += h / 2;
      if (leg.side > 0) left += h / 2; else right += h / 2;
    });
    const under = (front + back) / 2;
    // The stride's bob: trotting, down as each pair lands (twice a stride); galloping, a heave and a rocking pitch.
    const ph = this.t * Math.PI * 2;
    const bob = S * (-0.035 * Math.cos(2 * ph) * moving * (1 - g) + 0.06 * Math.sin(ph) * g);
    const rock = 0.07 * Math.sin(ph + 1.3) * g;
    const crouch = S * (0.06 * moving + 0.08 * g);
    // Dead: down on its belly, rolled a little onto its side, its nose in the sand.
    const fall = smooth(0, 0.9, this.dead);
    this.y = ease(this.y, lerp(under + R.standY * S - crouch, under + 0.75, fall), this.dead > 0 ? 6 : 12, dt);
    const slope = Math.atan2(front - back, 2 * R.sockZ * S);
    const tilt = Math.atan2(left - right, 2 * (R.sockX + R.hipOut) * S);
    const lean = Math.max(-0.12, Math.min(0.12, this.accel * 0.02));
    const bank = Math.max(-0.22, Math.min(0.22, -this.yawRate * speed * 0.025));
    this.pitch = ease(this.pitch, -slope + lean + 0.04 * g + 0.12 * fall, 8, dt);
    this.roll = ease(this.roll, tilt + bank + 0.3 * fall * (this.seed > 50 ? 1 : -1), 8, dt);
    this.body.position.set(this.x, this.y + bob, this.z);
    this.body.rotation.set(this.pitch + rock, this.yaw, this.roll);
    this.body.updateWorldMatrix(true, false);
    for (const leg of this.legs) this.reach(leg);

    // The head: on what it watches, or about (less as it runs, nose down as it runs flat out), steadied against the rock.
    let hy: number, hp: number;
    // Its wreck waking: the head rears off the sand as the jaws draw back, and drives down as they snap.
    const wake = now / 1000 - this.lungeAt, waking = this.dead > 0 && wake >= 0 && wake < WAKE_S, bit = now / 1000 - this.snapAt < 0.3;
    if (this.dead > 0) {
      hy = 0;
      hp = waking ? -0.4 * smooth(0, 0.4, wake) : bit ? 0.5 : 0.3;
    } else if (look) {
      _v.copy(look);
      this.body.worldToLocal(_v).sub(_q.set(...R.neck));
      hy = Math.max(-1.1, Math.min(1.1, Math.atan2(_v.x, _v.z)));
      hp = Math.max(-0.5, Math.min(0.6, -Math.atan2(_v.y, Math.hypot(_v.x, _v.z))));
    } else {
      const k = now / 1000 + this.seed;
      hy = 0.7 * Math.sin(k * 0.7) * Math.sin(k * 0.31) * (1 - smooth(1, 4, speed));
      hp = 0.18 + 0.12 * Math.sin(k * 1.1) * (1 - moving) + 0.15 * g;
    }
    this.headYaw = ease(this.headYaw, hy, look ? 7 : 3, dt);
    this.headPitch = ease(this.headPitch, hp - rock * 0.8, this.dead > 0 && bit ? 30 : 7, dt);
    this.neck.rotation.set(this.headPitch, this.headYaw, 0);

    // The jaws: flexing idly; staring at you, slowly opening wide and snapping shut; running hot, agape and chattering.
    const k = now / 1000 + this.seed;
    const snap = frac(k / 2.6), wide = snap < 0.85 ? 0.85 * smooth(0, 0.85, snap) : 0;
    let gape = this.alert > 0 ? 0.55 + 0.12 * Math.sin(k * 40) : look ? 0.04 + wide : 0.08 + 0.07 * Math.sin(k * 1.3) * Math.sin(k * 0.45);
    // Dead: slack; its wreck waking, drawn back wide. A bite: shut, held a moment.
    if (this.dead > 0) gape = waking ? 0.95 : 0.3 * fall;
    if (bit) gape = 0;
    // Shutting is a snap, opening a slow spread.
    this.gape = ease(this.gape, gape, gape < this.gape ? 30 : 6, dt);
    this.jaws[0].rotation.y = this.gape;
    this.jaws[1].rotation.y = -this.gape;

    if (this.arm) this.gun(dt, look, now);

    // Dead, the eyes go out; its wreck waking, they flicker back on till the snap.
    const flicker = waking || bit ? 0.6 + 0.4 * Math.sin(now / 23 + this.seed) * Math.sin(now / 61) : 0;
    const pulse = Math.max((0.75 + 0.25 * Math.sin(now / 170 + this.seed)) * (1 - smooth(0, 1.5, this.dead)), flicker);
    for (const e of this.eyes) e.emissiveIntensity = (e.userData.base as number) * pulse * (1 + 1.5 * this.alert);
  }

  /**
   * The gun arm. Going about, it bears the gun low over its back, level and forward. Staring at something
   * (`look`), it raises the gun high, the base turning to it and the gun pitched onto it, and once on target fires
   * every FIRE_S: the coils brighten as it charges, the gun slams back along the rails of its mount (no kick up: the
   * mount takes it), the muzzle flares, and the buffers ease it forward again.
   *
   * Stabilised (`stabilize`, the default), the gun holds still in the world while the body bounces under it, like a
   * tank's gun or a hen's head: where it should be is worked out in a steady frame that follows the runner's path and
   * the lie of the ground but not its stride (no bob, rock, bank or tilt; its heading smoothed), and the arm reaches for that from the
   * body as it is (`steady`). Otherwise the arm is fixed in the body's frame and the gun rides every bounce (`locked`).
   */
  private gun(dt: number, look: THREE.Vector3 | null, now: number) {
    const A = RUNNER.arm;
    // The steady frame: on its path at the body's height over the ground (`y`: following the terrain, but without the
    // stride's bob, rock, bank or tilt, which are only put on the body as it is drawn), its heading smoothed.
    if (!this.steadyOn) {
      this.steadyOn = true;
      this.steadyYaw = this.gunYaw = this.yaw;
    }
    this.steadyYaw += wrap(this.yaw - this.steadyYaw) * (1 - Math.exp(-6 * dt));
    const c = Math.cos(this.steadyYaw), s = Math.sin(this.steadyYaw);
    const mx = A.mount[0] * S, mz = A.mount[2] * S;
    _sh.set(this.x + mx * c + mz * s, this.y + (A.mount[1] + A.shoulder[1]) * S, this.z - mx * s + mz * c);
    const wy = lerp(CARRY[0], AIM[0], this.raise), wz = lerp(CARRY[1], AIM[1], this.raise);
    // What it aims at, as a heading and elevation in the world: its target, or ahead and level.
    let yaw = this.steadyYaw, pitch = 0;
    if (look) {
      const dx = look.x - _sh.x, dz = look.z - _sh.z;
      yaw = Math.atan2(dx, dz);
      pitch = Math.max(-0.6, Math.min(0.4, Math.atan2(look.y - (_sh.y + wy * S), Math.hypot(dx, dz) - wz * S)));
    }
    this.raise = ease(this.raise, look ? 1 : 0, look ? 2.2 : 3, dt);
    const turn = (look ? 2.5 : 6) * dt;
    this.gunYaw += Math.max(-turn, Math.min(turn, wrap(yaw - this.gunYaw)));
    this.aimPitch += Math.max(-3 * dt, Math.min(3 * dt, pitch - this.aimPitch));
    // Firing: on target and raised, every FIRE_S.
    const t = now / 1000, on = look && this.raise > 0.9 && Math.abs(wrap(yaw - this.gunYaw)) < 0.06 && Math.abs(pitch - this.aimPitch) < 0.06;
    if (this.auto && on && t - this.firedAt > FIRE_S) this.firedAt = t;
    // The recoil: back along the rails in RECOIL_BACK, held a moment, eased home by the buffers by RECOIL_HOME (s).
    const since = t - this.firedAt;
    const back = since < RECOIL_BACK ? since / RECOIL_BACK : 1 - smooth(RECOIL_HOLD, RECOIL_HOME, since);
    const flash = Math.max(0, 1 - since / 0.15);
    const elev = (look ? this.aimPitch : 0) * this.raise;
    if (this.stabilize) this.steady(wy, wz, elev);
    else this.locked(wy, wz, elev);
    this.arm!.slide.position.z = -A.recoil * back;
    // The coils: a low glow, building through the last second before a shot, a flare as it fires.
    this.chargeLevel = this.charging && this.dead <= 0 ? Math.min(1, this.chargeLevel + dt) : 0;
    const charge = this.auto ? (on ? smooth(FIRE_S - 1, FIRE_S, t - this.firedAt) : 0) : smooth(0, 1, this.chargeLevel);
    for (const m of this.coils) m.emissiveIntensity = (m.userData.base as number) * (0.5 + 2.5 * charge + 10 * flash);
  }

  /** Stabilised: the wrist reaches for where the steady frame puts it (_sh: its shoulder, in the world), and the gun
   *  is turned at the wrist to the heading and elevation wanted in the world, whatever the forearm's doing. */
  private steady(wy: number, wz: number, elev: number) {
    const A = RUNNER.arm, arm = this.arm!;
    const gs = Math.sin(this.gunYaw), gc = Math.cos(this.gunYaw);
    // The wrist where the steady frame wants it, then seen from the body as it is now (bobbing, rocking, tilted).
    _w.set(_sh.x + gs * wz * S, _sh.y + wy * S, _sh.z + gc * wz * S);
    this.body.worldToLocal(_w).sub(_q.set(...A.mount));
    // The base turns to the gun's heading as the body sees it; the arm reaches in that plane (what's off to the side,
    // a roll's worth, it can't: the wrist takes up the turn).
    this.body.getWorldQuaternion(_qa).invert();
    _d.set(gs, 0, gc).applyQuaternion(_qa);
    const b = Math.atan2(_d.x, _d.z), sb = Math.sin(b), cb = Math.cos(b);
    const [up, fore] = armIk(_w.y - A.shoulder[1], _w.x * sb + _w.z * cb);
    arm.base.rotation.set(0, b, 0);
    arm.upper.rotation.set(-up, 0, 0);
    arm.fore.rotation.set(-(fore - up), 0, 0);
    // The gun: what's left of the wanted world turn after the forearm's, never pitched up past the forearm.
    arm.fore.updateWorldMatrix(true, false);
    arm.fore.getWorldQuaternion(_qb);
    _d.set(0, 0, 1).applyQuaternion(_qb);
    const e = Math.min(Math.asin(Math.max(-1, Math.min(1, _d.y))) - FOREARM_CLEAR, elev);
    _qc.setFromEuler(_e.set(-e, this.gunYaw, 0, 'YXZ'));
    arm.rifle.quaternion.copy(_qb.invert().multiply(_qc));
  }

  /** Not stabilised: the arm's pose fixed in the body's frame, the gun riding every bounce. */
  private locked(wy: number, wz: number, elev: number) {
    const arm = this.arm!;
    const [up, fore] = armIk(wy, wz);
    arm.base.rotation.set(0, wrap(this.gunYaw - this.yaw), 0);
    arm.upper.rotation.set(-up, 0, 0);
    arm.fore.rotation.set(-(fore - up), 0, 0);
    // three.js Rx: + turns +Z down, so an elevation is a negative angle. Never pitched up past the forearm.
    arm.rifle.rotation.set(-(Math.min(fore - FOREARM_CLEAR, elev) - fore), 0, 0);
  }

  /** Fires the gun now (`now` ms, as given to update): the recoil and the flash. */
  fire(now: number) {
    this.firedAt = now / 1000;
    this.chargeLevel = 0;
  }

  /** Bites now (`now` ms, as given to update): its jaws snap shut. */
  snap(now: number) {
    this.snapAt = now / 1000;
  }

  /** Its wreck wakes now (`now` ms, as given to update): the jaws draw back for RUNNER_WAKE_MS (then `snap`). */
  lunge(now: number) {
    this.lungeAt = now / 1000;
  }

  /**
   * What a shot from `o` along unit `d` meets of it within `max` m, as drawn: a weak point (index RP_*, shared/runner.ts)
   * or its armour (-1): the hull, the head, the armed one's gun. A weak point the shot reaches before (or within
   * WEAK_FIRST m behind) the armour round it takes the hit. Not the legs.
   */
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number, broken: number): { index: number; dist: number; normal: THREE.Vector3 } | null {
    let best: { index: number; dist: number; normal: THREE.Vector3 } | null = null;
    const test = (obj: THREE.Object3D, boxes: readonly HitBox[]) => {
      obj.updateWorldMatrix(true, false);
      _inv.copy(obj.matrixWorld).invert();
      _ro.copy(o).applyMatrix4(_inv);
      _rd.copy(o).add(d).applyMatrix4(_inv).sub(_ro);
      let weak = -1, weakAt = Infinity, armour = Infinity;
      const wn = new THREE.Vector3(), an = new THREE.Vector3();
      for (const b of boxes) {
        if (b.i >= 0 && broken & (1 << b.i)) continue;
        const t = slab(b, _ro, _rd, best ? best.dist : max, _hn);
        if (t < 0) continue;
        if (b.i >= 0 && t < weakAt) (weakAt = t), (weak = b.i), wn.copy(_hn);
        if (b.i < 0 && t < armour) (armour = t), an.copy(_hn);
      }
      const t = weak >= 0 && weakAt < armour + WEAK_FIRST ? weakAt : armour;
      if (t === Infinity || (best && t >= best.dist)) return;
      const n = (t === weakAt && weak >= 0 ? wn : an).transformDirection(obj.matrixWorld);
      best = { index: t === weakAt && weak >= 0 ? weak : -1, dist: t, normal: n };
    };
    test(this.body, BODY_BOXES);
    test(this.neck, HEAD_BOXES);
    if (this.arm) test(this.arm.slide, GUN_BOXES);
    return best;
  }

  /** The gun (the part that slides back as it fires), for looking at; null on a plain one. */
  get gunObject(): THREE.Object3D | null {
    return this.arm?.slide ?? null;
  }

  /** The muzzle (world), into `out`. */
  muzzle(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.arm) return null;
    this.arm.slide.updateWorldMatrix(true, false);
    return out.set(...RUNNER.arm.muzzle).applyMatrix4(this.arm.slide.matrixWorld);
  }

  /** Hip roll, thigh and knee for leg `leg` to put its claw on its foot: the hip rolls the leg's plane through the
   *  foot, then two-bone IK in it, knee back. */
  private reach(leg: Leg) {
    const R = RUNNER;
    _v.copy(leg.foot);
    this.body.worldToLocal(_v);
    const dx = _v.x - leg.sx, dy = _v.y - R.sockY, dz = _v.z - leg.sz;
    // Roll: the plane R.hipOut out from the socket's axis (on its side) passes through the foot.
    const h = leg.side * R.hipOut, r = Math.hypot(dx, dy);
    const down = Math.sqrt(Math.max(1e-4, r * r - h * h));
    const roll = Math.max(-0.6, Math.min(0.6, Math.atan2(dx, -dy) - Math.atan2(h, down)));
    leg.hip.rotation.set(0, 0, roll);
    // The foot in the thigh joint's frame (its pitch plane is Y-Z).
    const c = Math.cos(roll), s = Math.sin(roll);
    const ty = -dx * s + dy * c, tz = dz;
    const L1 = R.thigh, L2 = R.shin;
    const d = Math.min(L1 + L2 - 1e-3, Math.max(Math.abs(L1 - L2) + 0.05, Math.hypot(ty, tz)));
    const at = Math.atan2(-tz, -ty);
    const a1 = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
    const t1 = at + a1;
    const ky = -L1 * Math.cos(t1), kz = -L1 * Math.sin(t1);
    leg.thigh.rotation.set(t1, 0, 0);
    leg.shin.rotation.set(Math.atan2(-(tz - kz), -(ty - ky)) - t1, 0, 0);
  }

  dispose() {
    this.root.removeFromParent();
    for (const e of this.eyes) e.dispose();
  }
}

/**
 * Moves a runner about a centre (the player it prowls round), for show: now a walk to a spot nearby, now a sprint in
 * a wide arc round the centre, now a stop to stare. Not the sim's: Math.random, frame time.
 */
export class Prowl {
  speed = 0;
  /** Standing to stare at the centre. */
  staring = false;
  private tx = 0; private tz = 0; private want = 0; private until = 0; private turn = 2.6;

  x: number; z: number; yaw: number;

  constructor(x: number, z: number, yaw: number) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
  }

  private pick(cx: number, cz: number, now: number) {
    const r = Math.random(), from = Math.atan2(this.x - cx, this.z - cz);
    this.staring = false;
    if (Math.hypot(this.x - cx, this.z - cz) > 55 || r < 0.35) {
      // A sprint, round the centre: a third to two thirds of a lap, either way.
      const a = from + (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random() * 2);
      const d = 22 + Math.random() * 16;
      this.set(cx + Math.sin(a) * d, cz + Math.cos(a) * d, RUNNER_SPRINT * (0.7 + 0.3 * Math.random()), 1.8);
    } else if (r < 0.55) {
      this.staring = true;
      this.want = 0;
      this.until = now + 1500 + Math.random() * 2500;
    } else {
      // A prowl to a spot not far off, a little in or out.
      const a = from + (Math.random() - 0.5) * 1.6;
      const d = 11 + Math.random() * 12;
      this.set(cx + Math.sin(a) * d, cz + Math.cos(a) * d, RUNNER_WALK + Math.random() * (RUNNER_TROT - RUNNER_WALK), 2.6);
    }
  }

  private set(x: number, z: number, want: number, turn: number) {
    this.tx = x;
    this.tz = z;
    this.want = want;
    this.turn = turn;
    this.until = Infinity;
  }

  update(dt: number, cx: number, cz: number, now: number) {
    const dx = this.tx - this.x, dz = this.tz - this.z, dist = Math.hypot(dx, dz);
    if (now > this.until || (!this.staring && (dist < 1.5 || this.want === 0))) this.pick(cx, cz, now);
    let target = 0;
    if (this.staring) {
      // Turning to face the centre where it stands.
      const err = wrap(Math.atan2(cx - this.x, cz - this.z) - this.yaw);
      this.yaw += Math.max(-1.5 * dt, Math.min(1.5 * dt, err));
    } else {
      const err = wrap(Math.atan2(dx, dz) - this.yaw);
      this.yaw += Math.max(-this.turn * dt, Math.min(this.turn * dt, err));
      // Slowing to turn when facing away, and to stop at the spot.
      target = Math.min(this.want * Math.max(0.15, Math.cos(err)), Math.sqrt(2 * 5 * dist));
    }
    this.speed += Math.max(-8 * dt, Math.min(6 * dt, target - this.speed));
    this.x += Math.sin(this.yaw) * this.speed * dt;
    this.z += Math.cos(this.yaw) * this.speed * dt;
  }
}

/** Drawn and heard within this far (m). */
const SHOW_R = 500;

/**
 * The runners as the server has them (server/runners.ts, 'bots' `r`: src/world/botFrames.ts runnersAt), each drawn by
 * a `Runner`: its path, what it stares at, hot (alert) while it charges, its gun raised, charged and fired on the
 * server's word (fire), its jaws snapping on a bite, slumping when it dies. The rifle tests shots against them
 * (raycast).
 */
export class Runners {
  private views = new Map<number, { view: Runner; frame: RunnerFrame; dead: boolean; snap: number; lunge: number; biteAt: number }>();
  private look = new THREE.Vector3();
  private scene: THREE.Object3D;
  private ground: Ground;
  /** A foot came down (x, y, z), the body going `speed` m/s. */
  onFootfall: (x: number, y: number, z: number, speed: number) => void = () => {};
  /** It bit someone (its jaws' tips at x, y, z), or its wreck snapped its jaws. */
  onSnap: (x: number, y: number, z: number) => void = () => {};
  /** Its wreck woke, its jaws (x, y, z) drawn back to snap in `s` seconds. */
  onLunge: (x: number, y: number, z: number, s: number) => void = () => {};
  /** It died, its body at (x, y, z). */
  onDeath: (x: number, y: number, z: number) => void = () => {};

  constructor(scene: THREE.Object3D, ground: Ground) {
    this.scene = scene;
    this.ground = ground;
  }

  /** Every frame: the runners as drawn now (`frames`), `now` ms (performance.now), seen from `focus`. */
  update(frames: readonly RunnerFrame[], dt: number, now: number, focus: { x: number; z: number }) {
    if (frames.length && !parts) void loadRunner();
    if (!parts) return;
    const seen = new Set<number>();
    for (const f of frames) {
      if (Math.hypot(f.x - focus.x, f.z - focus.z) > SHOW_R) continue;
      seen.add(f.id);
      let v = this.views.get(f.id);
      if (!v) {
        const view = new Runner(this.ground, f.armed ? 'armed' : 'plain');
        view.auto = false;
        view.place(f.x, f.z, f.yaw);
        view.onFootfall = (x, y, z, speed) => this.onFootfall(x, y, z, speed);
        this.scene.add(view.root);
        // One already dead (we just came by): no death throes.
        v = { view, frame: f, dead: f.dead > 0, snap: f.snap, lunge: f.lunge, biteAt: 0 };
        this.views.set(f.id, v);
      }
      v.frame = f;
      const view = v.view;
      view.alert = f.st === R_CHARGE ? 1 : 0;
      view.charging = f.gun === 1;
      view.dead = f.dead;
      if (f.snap && f.snap !== v.snap) {
        v.snap = f.snap;
        view.snap(now);
        this.onSnap(f.x + Math.sin(f.yaw) * 4, this.ground(f.x, f.z) + 1.6, f.z + Math.cos(f.yaw) * 4);
      }
      // Its wreck: drawing its jaws back, snapping them RUNNER_WAKE_MS on (when the server bites).
      const mx = f.x + Math.sin(f.yaw) * WRECK_MAW, mz = f.z + Math.cos(f.yaw) * WRECK_MAW;
      if (f.lunge && f.lunge !== v.lunge) {
        v.lunge = f.lunge;
        v.biteAt = now + RUNNER_WAKE_MS;
        view.lunge(now);
        this.onLunge(mx, this.ground(mx, mz) + 1, mz, WAKE_S);
      }
      if (v.biteAt && now >= v.biteAt) {
        v.biteAt = 0;
        view.snap(now);
        this.onSnap(mx, this.ground(mx, mz) + 1, mz);
      }
      if (f.dead > 0 && !v.dead) {
        v.dead = true;
        this.onDeath(f.x, this.ground(f.x, f.z) + 2, f.z);
      }
      view.update(dt, f.x, f.z, f.yaw, f.look ? this.look.set(f.look.x, f.look.y, f.look.z) : null, now);
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      v.view.dispose();
      this.views.delete(id);
    }
  }

  /** Runner `id` fires its gun now: where its muzzle is (into `out`), or null if it isn't drawn. */
  fire(id: number, now: number, out: THREE.Vector3): THREE.Vector3 | null {
    const v = this.views.get(id);
    if (!v) return null;
    v.view.fire(now);
    return v.view.muzzle(out);
  }

  /** The nearest live runner a shot from `o` along unit `d` meets within `max` m (src/rifle.ts). */
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): { runner: number; index: number; dist: number; normal: THREE.Vector3 } | null {
    let best: { runner: number; index: number; dist: number; normal: THREE.Vector3 } | null = null;
    for (const [id, v] of this.views) {
      if (v.frame.dead > 0) continue;
      const h = v.view.raycast(o, d, best ? best.dist : max, v.frame.broken);
      if (h && (!best || h.dist < best.dist)) best = { runner: id, ...h };
    }
    return best;
  }
}
