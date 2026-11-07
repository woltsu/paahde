// The beginning (docs/levels/tutorial.md): the last datacenter in orbit, falling, played once per player per world before
// the desert. Aboard a spinning ring station (docs/levels/ring.md, shared/ring.ts): one vast hall that runs all the way
// round it, the walk along it (+z, against the spin) from the crew block to the pod terminal, two buildings standing
// across the hall wall to wall. Each stretch asks for one thing the desert needs: the quarters (walk), the corridor under
// a fallen cable tray (crouch), the deck between rows of racks (sprint), a fallen gantry and a trench across the deck
// (jump, air jump; the service level under it has ways back up), the dead cabinet at the terminal's door (take it apart:
// the relay), the bay corridor with a blast door coming down (slide), the pod bay (the relay in the pod's panel, F at the
// hatch: the ride down).
//
// The level's frame is the ring's cylindrical one: z is arc length along the deck, x along the axis, y height towards the
// axis, so spin gravity is -y and the hall is boxes like any level (the client bends them onto the ring). Built of boxes
// like the datacenter (shared/levels/datacenter.ts: its types, materials and racks), with gated solids: the doors are boxes
// that collide while their bit in PlayerState.gates is clear, set only by the server (server/tutorial.ts) when you reach a
// trigger or do the thing. Some bits move nothing and only tell the client how far you are (the blast door coming down,
// the deck's lights going out). Pure data, no three.js, Node type stripping rules.
import { STEP_UP, inBox, type Box, type Level, type LevelDoor, type LevelPoint } from '../levels.ts';
import { boxGrid, ceilingBoxes, collideBoxes, groundBoxes, solidNear, type BoxGrid } from './boxes.ts';
import { mulberry32 } from '../noise.ts';
import { RING, SPIN, ribBoxes, ribsIn } from '../ring.ts';
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
  /** The big jolt on the deck: its lights go out behind you, row by row. */
  lights: 64,
  /** Out onto the deck: the cleaning cart crosses in front of you (its progress: CART_TICKS, counted by the sim). */
  cart: 128,
} as const;

/** The ring's hall (shared/ring.ts): the deck is y = 0, the side walls x = ±X (the hull), the ceiling y = H. */
const X = RING.width / 2, H = RING.height;
/** The two buildings standing across the hall wall to wall, `top` high: the crew block you wake in (the quarters and the
 *  corridor) and the pod terminal at the deck's far end (the bay corridor and the pod bay). */
export const CREW_BLOCK = { z0: -2.6, z1: 24.3, top: 8 };
/** How much further round the ring than the rack fields' first 120 m everything past them lies: they run 600 m (the
 *  hall's size and its curve show over a long walk). */
const FAR = 480;
export const TERMINAL = { z0: FAR + 190, z1: FAR + 222.6, top: 8 };

/** The rooms' interiors (x0, x1, z0, z1, ceiling) along the walk; walls 0.3 m, slabs 0.3 m. The hall, the aisle and the
 *  control area are the open deck between the buildings (no walls but the hull's). */
const T = 0.3;
const R = {
  quarters: { x: 3, z0: 0, z1: 8, h: 2.6 },
  corridor: { x: 1.2, z0: 8.3, z1: 24, h: 2.6 },
  hall: { x: X, z0: CREW_BLOCK.z1, z1: FAR + 155, h: H },
  aisle: { x: X, z0: FAR + 155, z1: FAR + 180, h: H },
  control: { x: X, z0: FAR + 180, z1: TERMINAL.z0, h: H },
  bay: { x: 1.2, z0: TERMINAL.z0 + T, z1: FAR + 210, h: 2.6 },
  pod: { x: 5, z0: FAR + 210.3, z1: FAR + 222, h: 5.0 },
} as const;

/** The deck's central lane (|x| < LANE): the rack fields stand either side of it. */
export const LANE = 6;
/** The fallen tray across the corridor: crouch under it (its underside over CROUCH_HEIGHT, under a standing head). */
export const TRAY = { z0: 15, z1: 15.6, y0: 1.15, y1: 1.4 };
/** The cable gantry fallen across the hall, wall to wall (|x| < `x`): jump onto it, over. */
export const FALLEN = { x: X, z0: FAR + 158, z1: FAR + 159.2, h: 0.9 };
/** The trench where the deck's plates dropped into the service level, wall to wall: too far for one jump, not for the
 *  air jump (8 m: going against the spin you are lighter, and a walking jump carries 6.5 m; the air jump 10.4). */
export const GAP = { z0: FAR + 166, z1: FAR + 174, floor: -2.4 };
/** The ladders of fallen trays up out of the trench, at these x (each: a tray to jump onto, a higher one, the deck). */
export const LADDERS = [-22, 0, 22];
/** The blast door at the end of the bay corridor: its edge stops at `y0`, over a crouch or a slide, under a head. */
export const BLAST = { z0: FAR + 206.6, z1: FAR + 207.0, y0: 1.1 };
/** The window in the pod bay's floor, the only one: under the deck is the hull, and under the hull, space. */
export const WINDOW = { x0: 2.6, x1: 4.6, z0: FAR + 211, z1: FAR + 221 };
/** The dead control cabinet lying on its back on the deck by the terminal's door, taken apart in place (server/tutorial.ts). */
export const CABINET = { x: 1.4, z: FAR + 186.2, yaw: 0, kind: 'control_cabinet' as const };
/** The last pod, lying across the bay, its hatch towards you (pod.glb's Pod at full size, its axis along x, its nose to
 *  -x: `yaw` turns the model's hatch side, -x, to -z). `hatch`: where F reaches it; `hull`: what you bump into. */
export const POD = {
  x: 0, z: FAR + 218.2, yaw: -Math.PI / 2,
  hatch: [-1.0, 1.0, 0, 2.6, FAR + 214.8, FAR + 216.7] as Box,
  hull: [-1.8, 2.0, 0, 2.5, FAR + 217.0, FAR + 219.5] as Box,
};
/** From the relay going into the pod's panel to its hatch lying open (ms): the panel's cover shuts, the pod wakes, the
 *  hatch swings down (src/levels/beginning/pod.ts plays it). F gets in only after (server/tutorial.ts). */
export const POD_OPEN_MS = 3200;
/** The pod cabin's light (src/levels/beginning/cabin.ts: under its dome, towards the hatch), a fixture of the bay's light
 *  pool that the stage keeps dark until the hatch is down. */
export const CABIN_LIGHT = { x: POD.x - 0.13, y: 2.05, z: POD.z - 0.45, color: 0xffc98e, intensity: 3.6, range: 2.4 };
/** The quarters' bunk you wake on, made (the other eleven are stripped). */
export const BUNK = { x: 2.55, z0: 0.5, z1: 2.5 };

/** The cleaning cart: parked at the west edge of the deck's lane between its first two rows of racks until GATE.cart,
 *  then across the lane along x to park at its east edge, `ticks` sim ticks (6 s) on the way. A solid that moves (`hx`,
 *  `hz`: its half footprint, `h` its height): where it is is a pure function of your gates, which step() advances a tick
 *  at a time (beginningLevel.tick), so the client predicts it exactly as the server has it. */
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
  { box: [-X, X, -0.5, 4, CREW_BLOCK.z1, CREW_BLOCK.z1 + 2.7], bit: GATE.cart },
  { box: [-X, X, -0.5, 4, 32.5, 34.5], bit: GATE.lights },
  { box: [-R.bay.x, R.bay.x, -0.5, 2.6, R.bay.z0, R.bay.z0 + 2.7], bit: GATE.blast },
  { box: [-R.bay.x, R.bay.x, -0.5, 2.6, BLAST.z1 + 0.8, R.bay.z1], bit: GATE.shut },
];

/** The beats (docs/levels/tutorial.md "Shape"), in order: 0 waking ... 7 the pod bay. */
export const BEATS = ['wake', 'crouch', 'sprint', 'jump', 'cabinet', 'sub', 'slide', 'pod'] as const;
export type Beat = (typeof BEATS)[number];

/** Which beat (x, y, z) is in: the room or stretch of deck, the trench's floor by its height. */
export function beatAt(x: number, y: number, z: number): number {
  if (y < -0.5) return 5;
  if (z < R.quarters.z1) return 0;
  if (z < R.corridor.z1) return 1;
  if (z < R.hall.z1) return 2;
  if (z < R.aisle.z1) return 3;
  if (z < R.bay.z0) return 4;
  if (z < R.bay.z1) return 6;
  return 7;
}

/** Where each beat starts, and the gates the ones before it opened (the debug menu's "Go to beat": server/world.ts). The
 *  sub-floor's is down in it. */
export const BEAT_STARTS: readonly (LevelPoint & { gates: number })[] = [
  { x: 1.6, y: 0, z: 1.6, facing: Math.PI, gates: 0 },
  { x: 0, y: 0, z: 9.5, facing: Math.PI, gates: GATE.quarters },
  { x: 0, y: 0, z: 25.5, facing: Math.PI, gates: GATE.quarters },
  { x: 0, y: 0, z: FAR + 152, facing: Math.PI, gates: GATE.quarters | CART_CROSSED | GATE.lights },
  { x: 0, y: 0, z: FAR + 181, facing: Math.PI, gates: GATE.quarters | CART_CROSSED | GATE.lights },
  { x: 0, y: GAP.floor, z: FAR + 169.5, facing: 0, gates: GATE.quarters | CART_CROSSED | GATE.lights },
  { x: 0, y: 0, z: FAR + 193.5, facing: Math.PI, gates: GATE.quarters | CART_CROSSED | GATE.lights | GATE.control | GATE.blast },
  { x: 0, y: 0, z: FAR + 211.5, facing: Math.PI, gates: GATE.quarters | CART_CROSSED | GATE.lights | GATE.control | GATE.blast | GATE.shut },
];

/** The station's screens: where they hang (facing the walk, -z), the words by how far you are (TEXT.tutorial.screens). */
export const SCREENS: readonly { x: number; y: number; z: number; face: 1 | -1 }[] = [
  { x: -1.19, y: 1.7, z: 11, face: 1 }, { x: 1.19, y: 1.7, z: 19, face: -1 },
  { x: -1.19, y: 1.7, z: FAR + 198, face: 1 }, { x: 1.19, y: 1.7, z: FAR + 204, face: -1 },
];

/** The deck's rows of racks: either side of the lane, in islands of `per` racks with gaps between, a row every `pitch` m
 *  from `z0` to `z1`, the lamp posts on the lane's edges between them. */
const FIELD = { z0: 30, z1: FAR + 150, pitch: 4.5, per: 8, gap: 2, islands: 4 };

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
  /** The shadowing spot in its disc, the disc flush with the ceiling at `ceil` (never floating under it). */
  const spot = (zone: BeginningZone, x: number, ceil: number, z: number, intensity = 6) => {
    fixtures.push({ kind: 'spot', role: 'main', pos: [x, ceil - 0.1, z], angle: 0.95, penumbra: 0.5, color: MAIN, intensity, range: 10, decay: 1.5, castsShadow: true, zone });
    add('downlight', zone, 'draw', x - 0.2, x + 0.2, ceil - 0.05, ceil, z - 0.2, z + 0.2);
  };
  /** A light strip across x at z, flush with the ceiling at `ceil`. */
  const strip = (zone: BeginningZone, x0: number, x1: number, ceil: number, z: number) =>
    add('strip', zone, 'draw', x0, x1, ceil - 0.06, ceil, z - 0.06, z + 0.06);
  /** A lamp post on the deck at (x, z), `h` high, its arm reaching `reach` m along x to a lamp head (lit underneath) with
   *  its light just below: a point light, or the shadowing spot. */
  const post = (zone: BeginningZone, x: number, z: number, h: number, reach: number, light: 'point' | 'spot', intensity = 4) => {
    add('steel', zone, 'both', x - 0.07, x + 0.07, 0, h, z - 0.07, z + 0.07);
    const x0 = Math.min(x, x + reach) - 0.05, x1 = Math.max(x, x + reach) + 0.05;
    add('steel', zone, 'draw', x0, x1, h, h + 0.08, z - 0.05, z + 0.05);
    const lx = x + reach;
    add('downlight', zone, 'draw', lx - 0.25, lx + 0.25, h - 0.1, h, z - 0.15, z + 0.15);
    if (light === 'spot') {
      fixtures.push({ kind: 'spot', role: 'main', pos: [lx, h - 0.15, z], angle: 0.95, penumbra: 0.5, color: MAIN, intensity: intensity * 1.6, range: 12, decay: 1.5, castsShadow: true, zone });
    } else point('main', zone, lx, h - 0.2, z, MAIN, intensity, 11);
  };
  const top = 5.3; // the dividers inside a building rise to its tallest room's ceiling slab

  // --- The hull round the deck: its side walls, ceiling and deck plates (drawn by the ring's shell, src/levels/beginning/
  // ring.ts: collision only here), the deck broken by the trench.
  const C0 = CREW_BLOCK.z0, Z1 = TERMINAL.z1;
  add('shell', 'hall', 'collide', -X - T, -X, -3, H + T, C0, Z1);
  add('shell', 'hall', 'collide', X, X + T, -3, H + T, C0, Z1);
  add('shell', 'hall', 'collide', -X, X, H, H + T, C0, Z1);
  add('shell', 'hall', 'collide', -X, X, -T, 0, CREW_BLOCK.z1, GAP.z0);
  add('shell', 'hall', 'collide', -X, X, -T, 0, GAP.z1, TERMINAL.z0);
  // The ribs' columns standing on the deck between the buildings (their beams are out of reach).
  for (const s of ribsIn(CREW_BLOCK.z1, TERMINAL.z0)) for (const b of ribBoxes(s).slice(0, 2)) add('shell', 'hall', 'collide', ...b);

  // --- The crew block: a building across the hall, its rooms inside (the space between them and its skin is shut in).
  /** A building's roof, wall to wall (its faces are walls and room dividers: below). */
  const roof = (zone: BeginningZone, b: { z0: number; z1: number; top: number }) => add('pillar', zone, 'both', -X, X, b.top, b.top + 0.4, b.z0, b.z1);
  roof('quarters', CREW_BLOCK);
  add('wall', 'quarters', 'both', -X, X, -T, CREW_BLOCK.top, CREW_BLOCK.z0, CREW_BLOCK.z0 + T); // its back

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

  // --- 2. The corridor: the cable tray down across it, its cut end sparking. Its end is the crew block's face, wall to
  // wall, and its door opens onto the deck.
  const C = R.corridor;
  room('corridor', C);
  add('tray', 'corridor', 'both', -C.x, C.x, TRAY.y0, TRAY.y1, TRAY.z0, TRAY.z1);
  add('cable', 'corridor', 'draw', -0.9, 0.7, TRAY.y1, TRAY.y1 + 0.08, TRAY.z0 + 0.1, TRAY.z0 + 0.3);
  add('steel', 'corridor', 'draw', 0.9, 0.92, TRAY.y1, C.h, TRAY.z0 + 0.25, TRAY.z0 + 0.27); // the one rod still holding it
  for (const z of [12, 20]) point('main', 'corridor', 0, C.h - 0.2, z, MAIN, 2.2, 7);
  for (const z of [10, 13, 18, 22]) strip('corridor', -0.6, 0.6, C.h, z);
  divider('corridor', C.z1, X - T, CREW_BLOCK.top, 0.9, 2.4);
  point('emergency', 'hall', 0, 2.75, C.z1 + 0.45, AMBER, 1.2, 6); // the lamp over the door, on the deck side
  add('emergency', 'hall', 'draw', -0.15, 0.15, 2.6, 2.7, C.z1 + T, C.z1 + T + 0.12);

  // --- 3. The deck: rows of racks in islands either side of the lane, the lamp posts along its edges going out row by
  // row behind you (src/levels/beginning: the pool's weights).
  const rowStep = FIELD.per * 0.6 + FIELD.gap;
  for (let k = 0, z0 = FIELD.z0; z0 + 1.2 <= FIELD.z1; k++, z0 += FIELD.pitch) {
    const face: 1 | -1 = k % 2 === 0 ? 1 : -1, z1 = z0 + 1.2, zc = z0 + 0.6;
    for (const side of [-1, 1]) {
      for (let j = 0; j < FIELD.islands; j++) {
        const a = LANE + j * rowStep, b = a + FIELD.per * 0.6;
        const [xa, xb] = side < 0 ? [-b, -a] : [a, b];
        add('rack', 'hall', 'collide', xa, xb, 0, 2.0, z0, z1);
        for (let i = 0; i < FIELD.per; i++) {
          const v = rand();
          racks.push({ x: xa + (i + 0.5) * 0.6, z: zc, face, variant: v < 0.75 ? 0 : v < 0.9 ? 1 : 2 });
        }
        add('paint', 'hall', 'draw', xa - 0.38, xb + 0.38, 0, 0.003, z0 - 0.38, z0 - 0.3);
        add('paint', 'hall', 'draw', xa - 0.38, xb + 0.38, 0, 0.003, z1 + 0.3, z1 + 0.38);
      }
    }
    // The lamp posts between this row and the next, one each side of the lane (every third a shadowing spot).
    const zl = z0 + 2.85;
    if (zl < FIELD.z1) for (const side of [-1, 1]) post('hall', side * (LANE - 0.4), zl, 4.2, -side * 1.2, k % 3 === 1 && side > 0 ? 'spot' : 'point');
  }

  // --- 4. The fallen gantry across the hall (drawn: src/levels/beginning/props.ts), then the trench wall to wall. Its
  // floor is the service level; trays fallen in it make ladders back up.
  add('tray', 'aisle', 'collide', -FALLEN.x, FALLEN.x, 0, FALLEN.h, FALLEN.z0, FALLEN.z1);
  for (const z of [FAR + 156, FAR + 163]) for (const side of [-1, 1]) post('aisle', side * (LANE - 0.4), z, 4.2, -side * 1.2, 'point', 3.5);
  point('emergency', 'aisle', 0, 1.0, (GAP.z0 + GAP.z1) / 2, AMBER, 1.6, 8); // a work lamp fallen in, lighting it from below
  // The trench's lips: the deck plates' cut edges (their tops a hair under the deck: the shell draws the deck).
  add('floor', 'aisle', 'draw', -X, X, -T, -0.004, GAP.z0 - 0.3, GAP.z0);
  add('floor', 'aisle', 'draw', -X, X, -T, -0.004, GAP.z1, GAP.z1 + 0.3);
  // --- 6. The service level under it.
  add('floor', 'sub', 'both', -X, X, GAP.floor - T, GAP.floor, GAP.z0 - 0.4, GAP.z1 + 0.4);
  add('wall', 'sub', 'both', -X, X, GAP.floor - T, -T, GAP.z0 - 0.4 - T, GAP.z0 - 0.4);
  add('wall', 'sub', 'both', -X, X, GAP.floor - T, -T, GAP.z1 + 0.4, GAP.z1 + 0.4 + T);
  for (const side of [-1, 1]) add('wall', 'sub', 'draw', side < 0 ? -X - T : X, side < 0 ? -X : X + T, GAP.floor - T, 0, GAP.z0 - 0.4, GAP.z1 + 0.4); // the hull below the deck
  for (const lx of LADDERS) {
    add('tray', 'sub', 'both', lx + 1.3, lx + 2.5, GAP.floor, -1.6, GAP.z0, GAP.z0 + 0.8);
    add('tray', 'sub', 'both', lx - 1.5, lx + 1.3, GAP.floor, -0.8, GAP.z0, GAP.z0 + 0.8);
  }
  add('cable', 'sub', 'draw', -12.2, 9.8, GAP.floor, GAP.floor + 0.08, FAR + 168, FAR + 168.3);
  add('cable', 'sub', 'draw', -2.3, -1.9, GAP.floor, GAP.floor + 0.3, FAR + 170.4, FAR + 171.4); // the custodian's bag
  point('main', 'sub', -2.0, GAP.floor + 0.4, 170.9, 0xffd9a0, 1.4, 6); // its torch, lying on, lighting the dust

  // --- 5. The terminal's door, shut, and the dead cabinet on its back on the deck in front of it; the station's console
  // against the terminal's face, printing for nobody.
  roof('control', TERMINAL);
  add('wall', 'control', 'both', -X, X, -T, TERMINAL.top, TERMINAL.z1 - T, TERMINAL.z1);
  add('equipment', 'control', 'both', -4.2, -3.4, 0, 1.0, FAR + 185, TERMINAL.z0 - 0.01); // the console
  add('equipment', 'control', 'collide', CABINET.x - 0.7, CABINET.x + 0.7, 0, 0.5, CABINET.z - 0.65, CABINET.z + 0.65); // the cabinet (drawn by the disassembly)
  post('control', -2.4, FAR + 183.5, 4.2, 1.2, 'point', 3);
  post('control', 3.6, FAR + 185, 4.2, -1.2, 'spot', 4);
  point('emergency', 'control', 0, 2.5, TERMINAL.z0 - 0.4, RED, 1.2, 5);
  divider('control', TERMINAL.z0, X - T, TERMINAL.top, 0.6, 2.1, GATE.control);

  // --- 7. The bay corridor: amber light, the blast door at its end (its edge is solid from the start, the drawn door
  // comes down to meet it; once you are past, it shuts).
  const B = R.bay;
  room('bay', B);
  add('door', 'bay', 'collide', -B.x, B.x, BLAST.y0, B.h, BLAST.z0, BLAST.z1);
  add('door', 'bay', 'collide', -B.x, B.x, 0, BLAST.y0, BLAST.z0, BLAST.z1, -GATE.shut);
  add('hazard', 'bay', 'draw', -B.x, B.x, 0, 0.003, BLAST.z0 - 0.6, BLAST.z1 + 0.6);
  for (const z of [FAR + 194, FAR + 201, FAR + 208.5]) point('emergency', 'bay', 0, B.h - 0.2, z, AMBER, 1.4, 7);
  for (const z of [FAR + 192, FAR + 197, FAR + 202]) strip('bay', -0.5, 0.5, B.h, z);
  divider('bay', B.z1, R.pod.x, top, 0.9, 2.4);

  // --- 8. The pod bay: six empty cradles, one pod, the window in the floor (space under it: the hull's outside).
  const P = R.pod, W = WINDOW;
  add('floor', 'pod', 'both', -P.x - T, W.x0, -T, 0, P.z0, P.z1);
  add('floor', 'pod', 'both', W.x1, P.x + T, -T, 0, P.z0, P.z1);
  add('floor', 'pod', 'both', W.x0, W.x1, -T, 0, P.z0, W.z0);
  add('floor', 'pod', 'both', W.x0, W.x1, -T, 0, W.z1, P.z1);
  add('steel', 'pod', 'collide', W.x0, W.x1, -T, 0, W.z0, W.z1); // the glass you stand on (drawn: src/levels/beginning)
  add('ceiling', 'pod', 'both', -P.x - T, P.x + T, P.h, P.h + T, P.z0, P.z1);
  add('wall', 'pod', 'both', -P.x - T, -P.x, -T, P.h + T, P.z0, P.z1);
  add('wall', 'pod', 'both', P.x, P.x + T, -T, P.h + T, P.z0, P.z1);
  divider('pod', P.z1, P.x, top, 0, 0);
  for (let i = 0; i < 6; i++) add('steel', 'pod', 'both', -P.x + 0.2, -P.x + 1.6, 0, 0.3, FAR + 211 + i * 1.8, FAR + 212.2 + i * 1.8);
  add('equipment', 'pod', 'collide', ...POD.hull); // the pod (drawn: pod.glb)
  for (const [x, z] of [[-3, FAR + 213.5], [3, FAR + 213.5], [-3, FAR + 219.5]]) point('main', 'pod', x, P.h - 0.5, z, MAIN, 3, 9);
  point('main', 'pod', W.x0 + 1, 0.6, FAR + 216, PLANET, 1.2, 6); // the planet's weak orange up through the window
  point('emergency', 'pod', 0, 2.7, P.z0 + 0.4, AMBER, 0.8, 4);
  point('emergency', 'pod', CABIN_LIGHT.x, CABIN_LIGHT.y, CABIN_LIGHT.z, CABIN_LIGHT.color, CABIN_LIGHT.intensity, CABIN_LIGHT.range);
  spot('pod', 0, P.h, FAR + 215.5);
  for (const z of [FAR + 212, FAR + 216, FAR + 220]) strip('pod', -3, 3, P.h, z);

  const zones = Object.fromEntries((Object.keys(R) as (keyof typeof R)[]).map((k) => {
    const r = R[k];
    return [k, [-r.x, r.x, 0, r.h, r.z0, r.z1] as Box];
  })) as Record<BeginningZone, Box>;
  zones.sub = [-X, X, GAP.floor, 0, GAP.z0 - 0.4, GAP.z1 + 0.4];
  const ceilings = { quarters: R.quarters.h, corridor: R.corridor.h, hall: H, aisle: H, sub: 0, control: H, bay: R.bay.h, pod: R.pod.h };

  return {
    id: 'beginning',
    bounds: [-X - T, X + T, GAP.floor - T, H + T, CREW_BLOCK.z0, TERMINAL.z1],
    zones, ceilings, boxes, racks, fixtures,
    // Waking on the made bunk: standing up beside it, facing the door (yaw π looks down +z).
    spawns: [{ x: BUNK.x - 0.95, y: 0, z: 1.6, facing: Math.PI }],
    exits: [POD.hatch],
    // The far-light bake only lights the rooms (the deck is the shell's): coarse over the long level.
    bakeTexel: 0.25,
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
  // The ring's spin: Coriolis in the air (shared/sim.ts).
  spin: SPIN * RING.coriolis,
  // The cart on its run (CART): a tick further each tick once it has set off.
  tick: (gates) => (gates & GATE.cart && cartTicks(gates) < CART.ticks ? gates + (1 << CART_SHIFT) : gates),
};
