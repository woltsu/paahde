// The runner: a four-legged hunting robot far bigger than a horse, with great insect jaws (bigger than a crawler, far smaller than a guardian),
// laid out like Boston Dynamics' Spot (a long body, a hip at each corner, every knee bending backwards) but built to
// frighten. Model: tools/blender/runner.py -> public/models/runner.glb; rig, gait and look: src/world/runner.ts.
//
// The armed variant carries a heavy rail gun on a robotic arm on its back, held under its belly at its balance
// point: borne level over its back as it goes, raised high to track you when it stops to stare.
//
// How it hunts (server/runners.ts, docs/runner.md): now and then one comes for someone out in the open desert, day or
// night. It stalks first: sprinting round them in wide arcs and stopping to stare, jaws snapping. Then the plain one
// charges flat out (RUNNER_SPRINT, faster than you can run or slide) and bites (one bite kills). At full tilt it can't
// turn tight (TURN_SPRINT): step aside at the last moment and it overshoots, brakes and comes round again. The armed
// one keeps its distance (KEEP_MIN..KEEP_MAX), stops, raises its gun and fires the guardians' bolts at you
// (FIRE_MS; sidestep them), and moves on after a few shots; come close and it bites too. Weak points (red, glowing):
// the eye cluster (from the front, as it charges you) and the vents on its flanks (side on, as it circles); break the
// eyes or both vents and it dies. The armed one's gun has its power core at the back: break it and the gun goes
// quiet. Its hull is a walker's plate (shared/enemies.ts). Downed, it isn't done: go near its head and the wreck draws
// its jaws back and snaps them shut (RUNNER_WAKE_MS). Drawn from the 'bots' message (`r`, RUNNER_STRIDE).

/** Rig lengths (body frame: +Z forward, Y up) in the model's units, which must match tools/blender/runner.py; in the
 *  world everything is `scale` times that. */
export const RUNNER = {
  /** The model is drawn this many times its built size (body centre 2.3 m up, ~5.2 m hull to snout, jaws ~1.5 m; docs/runner.md). */
  scale: 2.0,
  /** Hip sockets at (±sockX, sockY, ±sockZ) from the body's centre: each hip rolls (abduction) about Z through it. */
  sockX: 0.31, sockY: -0.02, sockZ: 0.7,
  /** The thigh's pitch joint, out from the socket along the hip's X (mirrored on the right). */
  hipOut: 0.2,
  /** Hip joint to knee, knee to the claw's tip. */
  thigh: 0.72, shin: 0.78,
  /** The head's pivot (yaw, then pitch). */
  neck: [0, 0.07, 1.0] as const,
  /** The left jaw's hinge in the head (it swings about Y; the right one's is mirrored). */
  jaw: [0.13, -0.06, 0.34] as const,
  /** The body's centre over level ground, standing (model units). */
  standY: 1.15,
  /** The armed runner's gun arm: a turret base yawing on its back at `mount`, the shoulder's pitch axis at `shoulder`
   *  in the base, upper arm and forearm lengths, the gun's muzzle from the wrist (its balance point, under its belly),
   *  how far the gun slides back on its mount's rails as it fires. */
  arm: { mount: [0, 0.21, -0.05] as const, shoulder: [0, 0.17, 0] as const, upper: 0.6, fore: 0.55, muzzle: [0, 0.2, 1.23] as const, recoil: 0.17 },
};

/** Two kinds: the plain runner, and one carrying a rail gun on a robotic arm on its back. */
export type RunnerKind = 'plain' | 'armed';

/** Speeds (m/s): a prowling walk, a trot, a flat-out sprint (a player runs 7.5, slides 15: it outruns both). The gait
 *  (src/world/runner.ts) goes from trot to gallop between TROT and GALLOP. */
export const RUNNER_WALK = 3, RUNNER_TROT = 7, RUNNER_GALLOP = 10, RUNNER_SPRINT = 16;

// --- Hunting (server/runners.ts) ---

/** Turn rates (rad/s): walking, flat out, and turning on the spot (the gait looks right within these). Speeding up and
 *  braking (m/s²). */
export const TURN_WALK = 2.6, TURN_SPRINT = 1.8, TURN_STAND = 1.5;
export const RUNNER_ACCEL = 6, RUNNER_BRAKE = 8;
/** Its body's centre over the ground standing (m), and its eyes' height. */
export const RUNNER_BODY_Y = RUNNER.standY * RUNNER.scale;
export const RUNNER_EYE_Y = 2.4;
/** The tips of its shut jaws, ahead of its centre (m): what bites. */
export const JAW_REACH = 4.1;

/** The armed one's gun: raised in GUN_RAISE_MS once it stops to aim, its coils charged GUN_CHARGE_MS before each shot
 *  (clients whine as it does), a shot every GUN_FIRE_MS at most. */
export const GUN_RAISE_MS = 1100, GUN_CHARGE_MS = 1000, GUN_FIRE_MS = 2400;

/** What it's doing ('bots' `r` st): coming to where it was sent; stalking (circling, or stopped to stare); charging
 *  at its prey; pulling up after a charge; the armed one stood aiming; leaving; dead. */
export const R_ROAM = 0, R_STALK = 1, R_CHARGE = 2, R_RECOVER = 3, R_AIM = 4, R_LEAVE = 5, R_DEAD = 6;

/** Its weak points (index in the 'fire' `ri`, bit in `broken`): the eye cluster, the left (+X) and right flank vents,
 *  and the armed one's gun core. Where they are, as the server reckons them: body frame (m, +Z forward, Y up from the
 *  body's centre); the core is the gun's own. Rifle hits each takes. */
export const RP_EYES = 0, RP_VENT_L = 1, RP_VENT_R = 2, RP_CORE = 3;
export const RUNNER_POINTS: readonly { x: number; y: number; z: number; hp: number }[] = [
  { x: 0, y: 0.2, z: 2.9, hp: 3 },
  { x: 0.66, y: 0, z: 0, hp: 2 },
  { x: -0.66, y: 0, z: 0, hp: 2 },
  { x: 0, y: 2.2, z: -1.6, hp: 2 },
];
/** Dead with these broken (bit masks): the eyes, or both vents. */
export const runnerDead = (broken: number) => (broken & (1 << RP_EYES)) !== 0 || (broken & 0b110) === 0b110;

/** Its wreck still bites: someone near its head and it draws its jaws back for this long (ms, as drawn), then snaps
 *  them shut (server/runners.ts `wreck`). Its maw, lying on its belly, is WRECK_MAW m ahead of its centre (between its
 *  head and its jaws' tips). */
export const RUNNER_WAKE_MS = 1000, WRECK_MAW = 3.3;

/** 'bots' `r`, per runner: id, kind (0 plain, 1 armed), x, z, yaw, st (R_*), hunt (0 nobody, 1 someone else, 2 you),
 *  look (0/1) and the point it looks at (x, y, z), gun (-1 carried, 0 raised, 1 charging), broken (bit mask), dead (0
 *  alive, else seconds since), snap (server ms of its last bite, 0 none), lunge (server ms its wreck last began to draw
 *  its jaws back, 0 never). */
export const RUNNER_STRIDE = 16;
