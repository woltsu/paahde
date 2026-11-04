// The runner: a four-legged hunting robot far bigger than a horse, with great insect jaws (bigger than a crawler, far smaller than a guardian),
// laid out like Boston Dynamics' Spot (a long body, a hip at each corner, every knee bending backwards) but built to
// frighten. Model: tools/blender/runner.py -> public/models/runner.glb; rig, gait and look: src/world/runner.ts.
//
// The armed variant carries a heavy rail gun on a robotic arm on its back, held under its belly at its balance
// point: borne level over its back as it goes, raised high to track you when it stops to stare, kicking back with a
// flash at the muzzle now and then (no shots yet).
//
// Work in progress: so far it is only drawn. It walks and runs about in the models lab (models-lab.html?runner) and,
// summoned from the debug menu (Spawn -> Runner), prowls round you in the desert, seen by you alone. No server side,
// hunting, damage or loot yet (and so no shared/enemies.ts entry).

/** Rig lengths (body frame: +Z forward, Y up) in the model's units, which must match tools/blender/runner.py; in the
 *  world everything is `scale` times that. */
export const RUNNER = {
  /** The model is drawn this many times its built size (hips ~2.3 m, ~5.4 m long, jaws ~1.5 m). */
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
   *  in the base, upper arm and forearm lengths, the gun's muzzle from the wrist (its balance point, under its belly). */
  arm: { mount: [0, 0.21, -0.05] as const, shoulder: [0, 0.17, 0] as const, upper: 0.6, fore: 0.55, muzzle: [0, 0.2, 1.23] as const },
};

/** Two kinds: the plain runner, and one carrying a rail gun on a robotic arm on its back. */
export type RunnerKind = 'plain' | 'armed';

/** Speeds (m/s): a prowling walk, a trot, a flat-out sprint (a player runs 7.5, slides 15: it outruns both). The gait
 *  (src/world/runner.ts) goes from trot to gallop between TROT and GALLOP. */
export const RUNNER_WALK = 3, RUNNER_TROT = 7, RUNNER_GALLOP = 10, RUNNER_SPRINT = 16;
