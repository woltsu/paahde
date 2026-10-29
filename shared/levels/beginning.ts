// The beginning (docs/levels/tutorial.md): the last datacenter in orbit, falling, played once per player per world before
// the desert. One linear walk, eight rooms along +z, each asking for one thing the desert needs: the quarters (walk), a
// corridor under a fallen cable tray (crouch), a server hall (sprint), the collapsed aisle with a fallen rack and a gap in
// the floor (jump, air jump; the sub-floor under it has a way back up), the control room with its dead cabinet (take it
// apart: the relay), the bay corridor with a blast door coming down (slide), the pod bay (the relay in the pod's panel,
// F at the hatch: the ride down).
//
// Built of boxes like the datacenter (shared/levels/datacenter.ts: its types, materials and racks), with gated solids:
// the doors are boxes that collide while their bit in PlayerState.gates is clear, set only by the server
// (server/tutorial.ts) when you reach a trigger or do the thing. Some bits move nothing and only tell the client how far
// you are (the blast door coming down, the hall's lights going out). Pure data, no three.js, Node type stripping rules.
import { STEP_UP, inBox, type Box, type Level, type LevelDoor, type LevelPoint } from '../levels.ts';
import { boxGrid, ceilingBoxes, collideBoxes, groundBoxes, solidNear, type BoxGrid } from './boxes.ts';
import { mulberry32 } from '../noise.ts';
import type { BoxUse, Fixture, LevelBox, LevelLayout, LevelMat, Rack } from './datacenter.ts';

export type BeginningZone = 'quarters' | 'corridor' | 'hall' | 'aisle' | 'sub' | 'control' | 'bay' | 'pod';

/** The bits of PlayerState.gates here. Solids: QUARTERS and CONTROL open doors, SHUT closes the blast door behind you. The
 *  rest move nothing (the client's set pieces and the server's order of things). */
export const GATE = {
  /** The quarters' door slid open (you came near it). */
  quarters: 1,
  /** The relay is out of the cabinet: its interlock let go, the door to the bay corridor is open. */
  control: 2,
  /** Into the bay corridor: the blast door at its end has started down. */
  blast: 4,
  /** Past the blast door: it is down behind you. */
  shut: 8,
  /** The relay is in the pod's panel. */
  powered: 16,
  /** In the pod, going down. */
  launch: 32,
  /** The big jolt in the hall: its lights go out behind you, row by row. */
  lights: 64,
  /** Into the hall: the cleaning cart crosses in front of you (its progress: CART_TICKS, counted by the sim). */
  cart: 128,
} as const;

/** The rooms' interiors (x0, x1, z0, z1, ceiling) along the walk; walls 0.3 m, slabs 0.3 m. */
const T = 0.3;
const R = {
  quarters: { x: 3, z0: 0, z1: 8, h: 2.6 },
  corridor: { x: 1.2, z0: 8.3, z1: 24, h: 2.6 },
  hall: { x: 6, z0: 24.3, z1: 44, h: 4.2 },
  aisle: { x: 2.5, z0: 44.3, z1: 64, h: 5.0 },
  control: { x: 3, z0: 64.3, z1: 72, h: 3.0 },
  bay: { x: 1.2, z0: 72.3, z1: 92, h: 2.6 },
  pod: { x: 5, z0: 92.3, z1: 104, h: 5.0 },
} as const;

/** The fallen tray across the corridor: crouch under it (its underside over CROUCH_HEIGHT, under a standing head). */
export const TRAY = { z0: 15, z1: 15.6, y0: 1.15, y1: 1.4 };
/** The rack fallen across the collapsed aisle, wall rack to wall rack (|x| < `x`): jump onto it, over. */
export const FALLEN = { x: 1.9, z0: 47, z1: 48.2, h: 0.9 };
/** The gap where the aisle's floor dropped into the sub-floor: too far for one jump, not for the air jump. */
export const GAP = { z0: 54, z1: 60.5, floor: -2.4 };
/** The blast door at the end of the bay corridor: its edge stops at `y0`, over a crouch or a slide, under a head. */
export const BLAST = { z0: 88.6, z1: 89.0, y0: 1.1 };
/** The window in the pod bay's east wall, the only one. */
export const WINDOW = { x: R.pod.x, z0: 96, z1: 102, y0: 1, y1: 3.6 };
/** The control cabinet lying on its back in the control room, taken apart in place (server/tutorial.ts). */
export const CABINET = { x: 1.4, z: 68.2, yaw: 0, kind: 'control_cabinet' as const };
/** The last pod, lying across the bay, its hatch towards you (pod.glb's Pod at full size, its axis along x, its nose to
 *  -x: `yaw` turns the model's hatch side, -x, to -z). `hatch`: where F reaches it; `hull`: what you bump into. */
export const POD = {
  x: 0, z: 100.2, yaw: -Math.PI / 2,
  hatch: [-1.0, 1.0, 0, 2.6, 96.8, 98.7] as Box,
  hull: [-1.8, 2.0, 0, 2.5, 99.0, 101.5] as Box,
};
/** From the relay going into the pod's panel to its hatch lying open (ms): the panel's cover shuts, the pod wakes, the
 *  hatch swings down (src/levels/beginning/pod.ts plays it). F gets in only after (server/tutorial.ts). */
export const POD_OPEN_MS = 3200;
/** The quarters' bunk you wake on, made (the other eleven are stripped). */
export const BUNK = { x: 2.55, z0: 0.5, z1: 2.5 };

/** The cleaning cart: parked at the west end of the hall's middle cross-aisle (between the second and third rows of
 *  racks) until GATE.cart, then across it along x to park at the east end, `ticks` sim ticks (6 s) on the way. A solid
 *  that moves (`hx`, `hz`: its half footprint, `h` its height): where it is is a pure function of your gates, which
 *  step() advances a tick at a time (beginningLevel.tick), so the client predicts it exactly as the server has it. Each
 *  end leaves more than a body's width to the wall (it never pins you there) and the lane misses the racks. */
export const CART = { z: 33.4, x0: -4.8, x1: 4.8, ticks: 360, hx: 0.45, hz: 0.3, h: 1.05 };
/** Where in PlayerState.gates the cart's ticks are counted (9 bits, well above the GATE bits). */
const CART_SHIFT = 20, CART_MASK = 0x1ff << CART_SHIFT;
/** The cart's ticks on its run so far, out of CART.ticks. */
export const cartTicks = (gates: number) => (gates & CART_MASK) >>> CART_SHIFT;
/** The gates of a cart that has crossed (GATE.cart and every tick: the debug beats after the hall). */
export const CART_CROSSED = GATE.cart | (CART.ticks << CART_SHIFT);
/** The cart's x for these gates: eased off and to a stop. */
export function cartX(gates: number): number {
  const t = Math.min(1, cartTicks(gates) / CART.ticks), e = t * t * (3 - 2 * t);
  return CART.x0 + (CART.x1 - CART.x0) * e;
}

/** Trigger boxes (the server sets the bit when you are in one). */
export const TRIGGERS: readonly { box: Box; bit: number }[] = [
  { box: [-1.6, 1.6, -0.5, 2.6, 5.4, 8], bit: GATE.quarters },
  { box: [-R.hall.x, R.hall.x, -0.5, 4, 24.3, 27], bit: GATE.cart },
  { box: [-R.hall.x, R.hall.x, -0.5, 4, 32.5, 34.5], bit: GATE.lights },
  { box: [-R.bay.x, R.bay.x, -0.5, 2.6, 72.3, 75], bit: GATE.blast },
  { box: [-R.bay.x, R.bay.x, -0.5, 2.6, BLAST.z1 + 0.8, R.bay.z1], bit: GATE.shut },
];

/** The beats (docs/levels/tutorial.md "Shape"), in order: 0 waking ... 7 the pod bay. */
export const BEATS = ['wake', 'crouch', 'sprint', 'jump', 'cabinet', 'sub', 'slide', 'pod'] as const;
export type Beat = (typeof BEATS)[number];

/** Which beat (x, y, z) is in: the room, the sub-floor by its height. */
export function beatAt(x: number, y: number, z: number): number {
  if (y < -0.5) return 5;
  if (z < R.quarters.z1) return 0;
  if (z < R.corridor.z1) return 1;
  if (z < R.hall.z1) return 2;
  if (z < R.aisle.z1) return 3;
  if (z < R.control.z1) return 4;
  if (z < R.bay.z1) return 6;
  return 7;
}

/** Where each beat starts, and the gates the ones before it opened (the debug menu's "Go to beat": server/world.ts). The
 *  sub-floor's is down in it. */
export const BEAT_STARTS: readonly (LevelPoint & { gates: number })[] = [
  { x: 1.6, y: 0, z: 1.6, facing: Math.PI, gates: 0 },
  { x: 0, y: 0, z: 9.5, facing: Math.PI, gates: GATE.quarters },
  { x: 0, y: 0, z: 25.5, facing: Math.PI, gates: GATE.quarters },
  { x: 0, y: 0, z: 45.5, facing: Math.PI, gates: GATE.quarters | CART_CROSSED | GATE.lights },
  { x: 0, y: 0, z: 65.5, facing: Math.PI, gates: GATE.quarters | CART_CROSSED | GATE.lights },
  { x: 0, y: GAP.floor, z: 57.5, facing: 0, gates: GATE.quarters | CART_CROSSED | GATE.lights },
  { x: 0, y: 0, z: 75.5, facing: Math.PI, gates: GATE.quarters | CART_CROSSED | GATE.lights | GATE.control | GATE.blast },
  { x: 0, y: 0, z: 93.5, facing: Math.PI, gates: GATE.quarters | CART_CROSSED | GATE.lights | GATE.control | GATE.blast | GATE.shut },
];

/** The station's screens: where they hang (facing the walk, -z), the words by how far you are (TEXT.tutorial.screens). */
export const SCREENS: readonly { x: number; y: number; z: number; face: 1 | -1 }[] = [
  { x: -1.19, y: 1.7, z: 11, face: 1 }, { x: 1.19, y: 1.7, z: 19, face: -1 },
  { x: -2.99, y: 1.6, z: 67, face: 1 }, { x: -1.19, y: 1.7, z: 80, face: 1 }, { x: 1.19, y: 1.7, z: 86, face: -1 },
];

const MAIN = 0xeef3ff, AMBER = 0xff7a1a, RED = 0xff2a1a, PLANET = 0xff9a50;

export function beginningLayout(): LevelLayout<BeginningZone> {
  const rand = mulberry32(7);
  const boxes: LevelBox<BeginningZone>[] = [], racks: Rack[] = [], fixtures: Fixture<BeginningZone>[] = [];
  const add = (mat: LevelMat, zone: BeginningZone, use: BoxUse, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, gate = 0) =>
    boxes.push({ b: [x0, x1, y0, y1, z0, z1], mat, zone, use, ...(gate ? { gate } : {}) });

  /** A room's floor, ceiling and side walls (its end walls are the dividers between rooms). */
  const room = (zone: BeginningZone, r: { x: number; z0: number; z1: number; h: number }, floor = true, wallFrom = -T) => {
    if (floor) add('floor', zone, 'both', -r.x - T, r.x + T, -T, 0, r.z0, r.z1);
    add('ceiling', zone, 'both', -r.x - T, r.x + T, r.h, r.h + T, r.z0, r.z1);
    add('wall', zone, 'both', -r.x - T, -r.x, wallFrom, r.h + T, r.z0, r.z1);
    add('wall', zone, 'both', r.x, r.x + T, wallFrom, r.h + T, r.z0, r.z1);
  };
  /** The wall at z..z+T between two rooms, `half` wide either side, up to `top`, with an opening |x| < `door` up to `dh`
   *  (no opening: door 0). A gated door fills its opening while its bit is clear. */
  const divider = (zone: BeginningZone, z: number, half: number, top: number, door: number, dh: number, gate = 0) => {
    if (!door) return add('wall', zone, 'both', -half - T, half + T, -T, top, z, z + T);
    add('wall', zone, 'both', -half - T, -door, -T, top, z, z + T);
    add('wall', zone, 'both', door, half + T, -T, top, z, z + T);
    add('wall', zone, 'both', -door, door, dh, top, z, z + T); // lintel
    add('floor', zone, 'both', -door, door, -T, 0, z, z + T); // the threshold
    // Frames on both faces.
    for (const f of [z - 0.04, z + T]) {
      add('steel', zone, 'draw', -door - 0.08, -door, 0, dh, f, f + 0.04);
      add('steel', zone, 'draw', door, door + 0.08, 0, dh, f, f + 0.04);
      add('steel', zone, 'draw', -door - 0.08, door + 0.08, dh, dh + 0.08, f, f + 0.04);
    }
    if (gate) add('door', zone, 'both', -door, door, 0, dh, z + 0.1, z + 0.2, gate);
  };
  const point = (role: Fixture['role'], zone: BeginningZone, x: number, y: number, z: number, color: number, intensity: number, range: number) =>
    fixtures.push({ kind: 'point', role, pos: [x, y, z], color, intensity, range, decay: 1.5, castsShadow: false, zone });
  /** A thin steel rod from `y` up into the ceiling at `ceil` (what a light or a tray hangs from). */
  const rod = (zone: BeginningZone, x: number, y: number, ceil: number, z: number) => add('steel', zone, 'draw', x - 0.012, x + 0.012, y, ceil, z - 0.012, z + 0.012);
  /** The shadowing spot in its disc, the disc flush with the ceiling at `ceil` (never floating under it). */
  const spot = (zone: BeginningZone, x: number, ceil: number, z: number, intensity = 6) => {
    fixtures.push({ kind: 'spot', role: 'main', pos: [x, ceil - 0.1, z], angle: 0.95, penumbra: 0.5, color: MAIN, intensity, range: 10, decay: 1.5, castsShadow: true, zone });
    add('downlight', zone, 'draw', x - 0.2, x + 0.2, ceil - 0.05, ceil, z - 0.2, z + 0.2);
  };
  /** A light strip across x at z: flush with the ceiling at `ceil`, or hung `drop` m under it on two rods. */
  const strip = (zone: BeginningZone, x0: number, x1: number, ceil: number, z: number, drop = 0) => {
    const y = ceil - drop - 0.06;
    add('strip', zone, 'draw', x0, x1, y, y + 0.06, z - 0.06, z + 0.06);
    if (drop > 0) for (const x of [x0 + 0.15, x1 - 0.15]) rod(zone, x, y + 0.06, ceil, z);
  };
  const top = 5.3; // the dividers rise to the tallest room's ceiling slab

  // --- 1. Crew quarters: twelve bunks in six frames (two high) along the side walls, one made; lockers on the back wall.
  const Q = R.quarters;
  room('quarters', Q);
  divider('quarters', Q.z0 - T, Q.x, top, 0, 0);
  for (const side of [-1, 1]) {
    for (const [z0, z1] of [[0.5, 2.5], [3, 5], [5.5, 7.5]]) {
      const xa = side < 0 ? -Q.x : Q.x - 0.9, xb = xa + 0.9;
      // The posts stand at the corners; the bed and the upper frame sit 1 cm inside their outline, so no face of one
      // lies in a post's face (coplanar faces flicker: docs/levels.md "Z-fighting").
      add('equipment', 'quarters', 'both', xa + 0.01, xb - 0.01, 0, 0.45, z0 + 0.01, z1 - 0.01); // the lower bed (solid: you don't walk over it)
      add('steel', 'quarters', 'draw', xa + 0.01, xb - 0.01, 1.3, 1.36, z0 + 0.01, z1 - 0.01); // the upper one's frame
      for (const [px, pz] of [[xa, z0], [xb - 0.05, z0], [xa, z1 - 0.05], [xb - 0.05, z1 - 0.05]]) add('steel', 'quarters', 'draw', px, px + 0.05, 0, 1.9, pz, pz + 0.05);
    }
  }
  // The one made bed: a blanket on it (the others are bare frames: the 'equipment' slab reads as a stripped mattress).
  add('cable', 'quarters', 'draw', BUNK.x - 0.4, BUNK.x + 0.38, 0.45, 0.55, BUNK.z0 + 0.4, BUNK.z1 - 0.07); // (clear of the posts)
  for (let i = 0; i < 6; i++) add('equipment', 'quarters', 'both', -2.4 + i * 0.8, -1.7 + i * 0.8, 0, 1.9, Q.z0, Q.z0 + 0.45); // lockers
  point('emergency', 'quarters', 0, Q.h - 0.15, 3.5, RED, 1.6, 7); // the alarm light over the room
  spot('quarters', 0, Q.h, 4.6, 2.5);
  strip('quarters', -1.2, 1.2, Q.h, 4);
  divider('quarters', Q.z1, Q.x, top, 0.6, 2.1, GATE.quarters);

  // --- 2. The corridor: the cable tray down across it, its cut end sparking.
  const C = R.corridor;
  room('corridor', C);
  add('tray', 'corridor', 'both', -C.x, C.x, TRAY.y0, TRAY.y1, TRAY.z0, TRAY.z1);
  add('cable', 'corridor', 'draw', -0.9, 0.7, TRAY.y1, TRAY.y1 + 0.08, TRAY.z0 + 0.1, TRAY.z0 + 0.3);
  add('steel', 'corridor', 'draw', 0.9, 0.92, TRAY.y1, C.h, TRAY.z0 + 0.25, TRAY.z0 + 0.27); // the one rod still holding it
  for (const z of [12, 20]) point('main', 'corridor', 0, C.h - 0.2, z, MAIN, 2.2, 7);
  for (const z of [10, 13, 18, 22]) strip('corridor', -0.6, 0.6, C.h, z);
  divider('corridor', C.z1, R.hall.x, top, 0.9, 2.4);

  // --- 3. The server hall: four rows either side of the long aisle up the middle.
  const H = R.hall;
  room('hall', H);
  const rowZ = [26, 30.5, 35, 39.5];
  rowZ.forEach((z0, r) => {
    const face: 1 | -1 = r % 2 === 0 ? 1 : -1, z1 = z0 + 1.2, zc = z0 + 0.6;
    for (const side of [-1, 1]) {
      const xa = side < 0 ? -5.4 : 1.2, xb = xa + 4.2;
      add('rack', 'hall', 'collide', xa, xb, 0, 2.0, z0, z1);
      for (let i = 0; i < 7; i++) {
        const v = rand();
        racks.push({ x: side * (1.2 + (i + 0.5) * 0.6), z: zc, face, variant: v < 0.75 ? 0 : v < 0.9 ? 1 : 2 });
      }
      add('tray', 'hall', 'draw', xa, xb, 2.4, 2.55, zc - 0.22, zc + 0.22);
      // Hung on trapezes: a bar under it, a rod either side up into the ceiling.
      for (const x of [xa + 0.3, (xa + xb) / 2, xb - 0.3]) {
        add('steel', 'hall', 'draw', x - 0.02, x + 0.02, 2.37, 2.4, zc - 0.27, zc + 0.27);
        for (const dz of [-0.25, 0.25]) rod('hall', x, 2.4, H.h, zc + dz);
      }
      add('paint', 'hall', 'draw', xa - 0.38, xb + 0.38, 0, 0.003, z0 - 0.38, z0 - 0.3);
      add('paint', 'hall', 'draw', xa - 0.38, xb + 0.38, 0, 0.003, z1 + 0.3, z1 + 0.38);
    }
    // One row of lights per row of racks: they go out row by row (src/levels/beginning: the pool's weights).
    for (const x of [-3.3, 3.3]) point('main', 'hall', x, 3.5, z0 + 2.4, MAIN, 4, 9);
    strip('hall', -5.6, -1.0, H.h, z0 + 2.4, 0.54);
    strip('hall', 1.0, 5.6, H.h, z0 + 2.4, 0.54);
  });
  spot('hall', 0, H.h, 29);
  spot('hall', 0, H.h, 38);
  point('emergency', 'hall', 0, 2.7, H.z1 - 0.4, AMBER, 0.8, 4);
  divider('hall', H.z1, H.x, top, 0.9, 2.4);

  // --- 4. The collapsed aisle: racks along both walls labelled with city names, one fallen across it, then the floor
  // gone into the sub-floor. The walls go down to the sub-floor.
  const A = R.aisle;
  room('aisle', A, false, GAP.floor - T);
  add('floor', 'aisle', 'both', -A.x - T, A.x + T, -T, 0, A.z0, GAP.z0);
  add('floor', 'aisle', 'both', -A.x - T, A.x + T, -T, 0, GAP.z1, A.z1);
  for (const [z0, z1] of [[A.z0 + 0.3, GAP.z0 - 0.6], [GAP.z1 + 0.6, A.z1 - 0.3]]) {
    for (const side of [-1, 1]) {
      const xa = side < 0 ? -A.x : A.x - 0.6, n = Math.floor((z1 - z0) / 1.2 + 1e-6);
      // As long as the racks drawn in it (a whole number of them: no solid sliver past the last one).
      add('rack', 'aisle', 'collide', xa, xa + 0.6, 0, 2.0, z0, z0 + n * 1.2);
      // Racks turned side-on: their side panels to the aisle (the rack shader's sides are plain powder coat).
      for (let i = 0; i < n; i++) racks.push({ x: xa + 0.3, z: z0 + 0.6 + i * 1.2, face: side < 0 ? 1 : -1, variant: 2 });
    }
  }
  add('rack', 'aisle', 'collide', -FALLEN.x, FALLEN.x, 0, FALLEN.h, FALLEN.z0, FALLEN.z1); // (drawn: src/levels/beginning/props.ts)
  for (const z of [50, 62.5]) point('main', 'aisle', 0, A.h - 0.6, z, MAIN, 3.5, 10);
  point('emergency', 'aisle', 0, 2.6, (GAP.z0 + GAP.z1) / 2, AMBER, 1.2, 6);
  for (const z of [46, 51, 62]) strip('aisle', -1.5, 1.5, A.h, z);
  spot('aisle', 0, A.h, 45.6);

  // --- 6. The sub-floor under the gap: dust, old cables, a custodian's bag; a ladder of fallen trays back up (each a
  // jump), then a jump to the aisle's floor.
  add('floor', 'sub', 'both', -A.x - T, A.x + T, GAP.floor - T, GAP.floor, GAP.z0 - 0.4, GAP.z1 + 0.4);
  add('wall', 'sub', 'both', -A.x, A.x, GAP.floor - T, -T, GAP.z0 - 0.4 - T, GAP.z0 - 0.4);
  add('wall', 'sub', 'both', -A.x, A.x, GAP.floor - T, -T, GAP.z1 + 0.4, GAP.z1 + 0.4 + T);
  add('tray', 'sub', 'both', 1.3, A.x, GAP.floor, -1.6, GAP.z0, GAP.z0 + 0.8);
  add('tray', 'sub', 'both', -1.5, 1.3, GAP.floor, -0.8, GAP.z0, GAP.z0 + 0.8);
  add('cable', 'sub', 'draw', -2.2, 1.8, GAP.floor, GAP.floor + 0.08, 56, 56.3);
  add('cable', 'sub', 'draw', -2.3, -1.9, GAP.floor, GAP.floor + 0.3, 58.4, 59.4); // the bag
  point('main', 'sub', -2.0, GAP.floor + 0.4, 58.9, 0xffd9a0, 1.4, 6); // its torch, lying on, lighting the dust
  const ceilings = { quarters: Q.h, corridor: C.h, hall: H.h, aisle: A.h, sub: 0, control: R.control.h, bay: R.bay.h, pod: R.pod.h };
  divider('aisle', A.z1, A.x, top, 0.9, 2.4);

  // --- 5. The control room: the station's console printing for nobody, the dead cabinet on its back, the door to the
  // bay corridor shut (a hand's width open, drawn: src/levels/beginning).
  const K = R.control;
  room('control', K);
  add('equipment', 'control', 'both', -K.x, -K.x + 0.8, 0, 1.0, 65.5, 70.5); // the console
  add('equipment', 'control', 'collide', CABINET.x - 0.7, CABINET.x + 0.7, 0, 0.5, CABINET.z - 0.65, CABINET.z + 0.65); // the cabinet (drawn by the disassembly)
  point('main', 'control', 0, K.h - 0.2, 66, MAIN, 2, 7);
  point('emergency', 'control', 0, 2.5, K.z1 - 0.4, RED, 1, 4);
  spot('control', CABINET.x, K.h, CABINET.z, 5);
  strip('control', -1.5, 1.5, K.h, 66);
  divider('control', K.z1, K.x, top, 0.6, 2.1, GATE.control);

  // --- 7. The bay corridor: amber light, the blast door at its end (its edge is solid from the start, the drawn door
  // comes down to meet it; once you are past, it shuts).
  const B = R.bay;
  room('bay', B);
  add('door', 'bay', 'collide', -B.x, B.x, BLAST.y0, B.h, BLAST.z0, BLAST.z1);
  add('door', 'bay', 'collide', -B.x, B.x, 0, BLAST.y0, BLAST.z0, BLAST.z1, -GATE.shut);
  add('hazard', 'bay', 'draw', -B.x, B.x, 0, 0.003, BLAST.z0 - 0.6, BLAST.z1 + 0.6);
  for (const z of [76, 83, 90.5]) point('emergency', 'bay', 0, B.h - 0.2, z, AMBER, 1.4, 7);
  for (const z of [74, 79, 84]) strip('bay', -0.5, 0.5, B.h, z);
  divider('bay', B.z1, R.pod.x, top, 0.9, 2.4);

  // --- 8. The pod bay: eleven empty cradles, one pod, the window.
  const P = R.pod;
  add('floor', 'pod', 'both', -P.x - T, P.x + T, -T, 0, P.z0, P.z1);
  add('ceiling', 'pod', 'both', -P.x - T, P.x + T, P.h, P.h + T, P.z0, P.z1);
  add('wall', 'pod', 'both', -P.x - T, -P.x, -T, P.h + T, P.z0, P.z1);
  add('wall', 'pod', 'both', P.x, P.x + T, -T, P.h + T, P.z0, WINDOW.z0); // the east wall round the window
  add('wall', 'pod', 'both', P.x, P.x + T, -T, P.h + T, WINDOW.z1, P.z1);
  add('wall', 'pod', 'both', P.x, P.x + T, -T, WINDOW.y0, WINDOW.z0, WINDOW.z1);
  add('wall', 'pod', 'both', P.x, P.x + T, WINDOW.y1, P.h + T, WINDOW.z0, WINDOW.z1);
  add('steel', 'pod', 'collide', P.x, P.x + T, WINDOW.y0, WINDOW.y1, WINDOW.z0, WINDOW.z1); // the pane (drawn: src/levels/beginning)
  divider('pod', P.z1, P.x, top, 0, 0);
  for (let i = 0; i < 6; i++) add('steel', 'pod', 'both', -P.x + 0.2, -P.x + 1.6, 0, 0.3, 93 + i * 1.8, 94.2 + i * 1.8);
  for (let i = 0; i < 5; i++) add('steel', 'pod', 'both', P.x - 1.6, P.x - 0.2, 0, 0.3, 93.4 + i * 2.1, 94.6 + i * 2.1);
  add('equipment', 'pod', 'collide', ...POD.hull); // the pod (drawn: pod.glb)
  for (const [x, z] of [[-3, 95.5], [3, 95.5], [-3, 101.5]]) point('main', 'pod', x, P.h - 0.5, z, MAIN, 3, 9);
  point('main', 'pod', P.x - 0.6, 2.4, 99, PLANET, 1.2, 6); // the planet's weak orange by the window
  point('emergency', 'pod', 0, 2.7, P.z0 + 0.4, AMBER, 0.8, 4);
  spot('pod', 0, P.h, 97.5);
  for (const z of [94, 98, 102]) strip('pod', -3, 3, P.h, z);

  const zones = Object.fromEntries((Object.keys(R) as (keyof typeof R)[]).map((k) => {
    const r = R[k];
    return [k, [-r.x, r.x, 0, r.h, r.z0, r.z1] as Box];
  })) as Record<BeginningZone, Box>;
  zones.sub = [-A.x, A.x, GAP.floor, 0, GAP.z0 - 0.4, GAP.z1 + 0.4];
  zones.aisle = [-A.x, A.x, 0, A.h, A.z0, A.z1];

  return {
    id: 'beginning',
    bounds: [-H.x - T, H.x + T, GAP.floor - T, top + T, Q.z0 - T, P.z1 + T],
    zones, ceilings, boxes, racks, fixtures,
    // Waking on the made bunk: standing up beside it, facing the door (yaw π looks down +z).
    spawns: [{ x: BUNK.x - 0.95, y: 0, z: 1.6, facing: Math.PI }],
    exits: [POD.hatch],
  };
}

/** The level every player has their own copy of (the layout is fixed: every client and the server agree). */
export const BEGINNING = beginningLayout();

const solidList = BEGINNING.boxes.filter((b) => b.use !== 'draw');
const solids = boxGrid(solidList.map((b) => b.b), 2, solidList.map((b) => b.gate ?? 0));

/** The cart's solid: one box moved to where the gates put it before each query (its grid spans the whole run, so every
 *  query near the run finds it). */
const cartBox = [CART.x0 - CART.hx, CART.x1 + CART.hx, 0, CART.h, CART.z - CART.hz, CART.z + CART.hz];
const cart = boxGrid([cartBox as unknown as Box], 2);
function cartAt(gates: number): BoxGrid {
  const x = cartX(gates);
  cartBox[0] = x - CART.hx;
  cartBox[1] = x + CART.hx;
  return cart;
}

/** The trigger bits that (x, y, z) sets (TRIGGERS). */
export function triggersAt(x: number, y: number, z: number): number {
  let bits = 0;
  for (const t of TRIGGERS) if (inBox(t.box, x, y, z)) bits |= t.bit;
  return bits;
}

const NO_DOORS: readonly LevelDoor[] = [];

/** The beginning as a Level (shared/levels.ts): one per player, nothing hurts in it, still air; its one way out is the pod. */
export const beginningLevel: Level = {
  id: 2,
  key: 'beginning',
  ground: (x, z, prevY, gates = 0) => Math.max(groundBoxes(solids, x, z, prevY, STEP_UP, gates), groundBoxes(cartAt(gates), x, z, prevY, STEP_UP)),
  collide: (c, y, prevY, radius, height, stepUp, _px, _pz, gates = 0) => {
    // The cart first: pushed by it, the walls and racks have the last word.
    const onCart = collideBoxes(cartAt(gates), c, y, prevY, radius, height, stepUp);
    return Math.max(onCart, collideBoxes(solids, c, y, prevY, radius, height, stepUp, gates));
  },
  ceiling: (x, z, prevY, height, radius, gates = 0) => ceilingBoxes(solids, x, z, prevY, height, radius, gates),
  solid: (x, y, z, r, gates = 0) => solidNear(solids, x, y, z, r, gates) || solidNear(cartAt(gates), x, y, z, r),
  flat: true,
  bounds: BEGINNING.bounds,
  spawns: BEGINNING.spawns as readonly LevelPoint[],
  // No door: its one way out is the pod's hatch (POD.hatch), and that is the server's (server/tutorial.ts: the relay
  // into its panel first, then the ride down to the desert), never an F that just takes you out.
  doors: () => NO_DOORS,
  indoors: true,
  climate: { tempC: 20 },
  weather: false,
  enemies: false,
  building: false,
  things: false,
  private: true,
  mortal: false,
  crouchUnder: true,
  skippable: true,
  // The cart on its run (CART): a tick further each tick once it has set off.
  tick: (gates) => (gates & GATE.cart && cartTicks(gates) < CART.ticks ? gates + (1 << CART_SHIFT) : gates),
};
