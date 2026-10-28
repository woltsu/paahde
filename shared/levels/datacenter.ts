// The datacenter (docs/levels/datacenter.md): a plain concrete hall of server racks, a vestibule you arrive in and a
// UPS room off the side. Its layout is data here, shared by the sim (collision: every box but the 'draw' ones), the
// client's builder (src/levels/datacenter/: every box but the 'collide' ones, the racks instanced) and the server (exits).
// Pure data, seeded (mulberry32), no three.js, Node type stripping rules. The rack list's order is part of the look
// (the shader hashes the instance index): keep the generator's loop order stable.
import { mulberry32 } from '../noise.ts';
import { DESERT, STEP_UP, type Box, type Level, type LevelDoor, type LevelPoint } from '../levels.ts';
import { boxGrid, ceilingBoxes, collideBoxes, groundBoxes } from './boxes.ts';

export type Vec3 = [number, number, number];
export type ZoneId = 'hall' | 'vestibule' | 'ups';
export type LevelMat = 'floor' | 'wall' | 'pillar' | 'ceiling' | 'steel' | 'tray' | 'cable' | 'equipment'
  | 'door' | 'strip' | 'downlight' | 'emergency' | 'paint' | 'hazard' | 'rack';
/** 'both': collides and is drawn; 'collide': collision only (the rack runs: the instanced racks draw them); 'draw': visual only. */
export type BoxUse = 'both' | 'collide' | 'draw';
export type LevelBox = { b: Box; mat: LevelMat; zone: ZoneId; use: BoxUse };
/** One rack: bottom-centre position; face +1 = front towards +z. Variant 0 perforated, 1 glass, 2 network. */
export type Rack = { x: number; z: number; face: 1 | -1; variant: 0 | 1 | 2 };
export type Fixture = {
  kind: 'point' | 'spot';
  role: 'main' | 'emergency';
  pos: Vec3;
  /** Spot only: cone half-angle (rad) and penumbra 0..1; they point straight down. */
  angle?: number;
  penumbra?: number;
  color: number;
  intensity: number;
  range: number;
  decay: number;
  castsShadow: boolean;
  zone: ZoneId;
};
export type LevelLayout = {
  id: 'datacenter';
  bounds: Box;
  /** Interiors, for "which zone am I in" (fixture scoring, audio). */
  zones: Record<ZoneId, Box>;
  /** Each zone's ceiling height (the walls' contact shade). */
  ceilings: Record<ZoneId, number>;
  boxes: LevelBox[];
  racks: Rack[];
  fixtures: Fixture[];
  spawns: LevelPoint[];
  /** Trigger volumes in front of the exit door: F in one leaves (server/world.ts). */
  exits: Box[];
};

export const DC = {
  hallX: 12, hallZ: 28, hallH: 4.2, wall: 0.3, slab: 0.3,
  rack: { w: 0.6, d: 1.2, h: 2.0 }, crossAisle: 1.2 /* half width */, perBlock: 14,
  rowZ0: 3.0, rows: 8, cold: 1.8, hot: 1.2, emptyChance: 0.06,
  tray: { y0: 2.4, y1: 2.55, w: 0.45 }, stripY: 3.6,
  vest: { x: 3, z0: -5.3, z1: -0.3, h: 3.0 },
  ups: { x0: 12.3, x1: 18.3, z0: 2, z1: 10, h: 3.4, door0: 3.0, door1: 4.4, doorH: 2.3 },
  hallDoor: { x: 0.9, h: 2.4 },
} as const;

const MAIN = 0xeef3ff, AMBER = 0xff7a1a;

export function datacenterLayout(seed = 1): LevelLayout {
  const rand = mulberry32(seed);
  const boxes: LevelBox[] = [], racks: Rack[] = [], fixtures: Fixture[] = [];
  const add = (mat: LevelMat, zone: ZoneId, use: BoxUse, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
    boxes.push({ b: [x0, x1, y0, y1, z0, z1], mat, zone, use });
  const { wall: t, slab: s, hallX: X, hallZ: Z, hallH: H, vest: V, ups: U, hallDoor: D } = DC;

  // --- The hall's shell: floor, ceiling, walls split round the two doors (lintels over them).
  add('floor', 'hall', 'both', -X - t, X + t, -s, 0, -t, Z + t);
  add('ceiling', 'hall', 'both', -X - t, X + t, H, H + s, -t, Z + t);
  add('wall', 'hall', 'both', -X - t, -D.x, -s, H + s, -t, 0); // south, either side of the hall door
  add('wall', 'hall', 'both', D.x, X + t, -s, H + s, -t, 0);
  add('wall', 'hall', 'both', -D.x, D.x, D.h, H + s, -t, 0); // lintel
  add('wall', 'hall', 'both', -X - t, X + t, -s, H + s, Z, Z + t); // north
  add('wall', 'hall', 'both', -X - t, -X, -s, H + s, 0, Z); // west
  add('wall', 'hall', 'both', X, X + t, -s, H + s, 0, U.door0); // east, round the UPS room's door
  add('wall', 'hall', 'both', X, X + t, -s, H + s, U.door1, Z);
  add('wall', 'hall', 'both', X, X + t, U.doorH, H + s, U.door0, U.door1);
  // Downstand beams over the pillar lines, the pillars (one more at the end of the cross aisle).
  for (const z of [5.1, 15.9, 25.5]) add('ceiling', 'hall', 'both', -X, X, 3.7, H, z - 0.2, z + 0.2);
  for (const [x, z] of [[-10.8, 5.1], [10.8, 5.1], [-10.8, 15.9], [10.8, 15.9], [-10.8, 25.5], [10.8, 25.5], [0, 25.5]]) {
    add('pillar', 'hall', 'both', x - 0.25, x + 0.25, 0, 3.7, z - 0.25, z + 0.25);
  }
  // Cooling units against the north wall.
  for (const x of [-8.4, -3.0, 3.0, 8.4]) add('equipment', 'hall', 'both', x - 1.2, x + 1.2, 0, 2.0, Z - 0.9, Z);

  // --- Rack rows: two blocks of slots either side of the cross aisle; a run of racks is one collision box, ended by
  // an empty slot (never an end one). Trays over every row, hung on rods; floor paint round each block.
  let z: number = DC.rowZ0;
  const aisles: number[] = [1.5]; // strip lines: the south perimeter aisle, then the middle of every aisle
  for (let r = 0; r < DC.rows; r++) {
    const face: 1 | -1 = r % 2 === 0 ? 1 : -1, z0 = z, z1 = z + DC.rack.d, zc = (z0 + z1) / 2;
    for (const side of [-1, 1]) {
      let run: number[] = [];
      const flush = () => {
        if (!run.length) return;
        const xs = run.flatMap((i) => [side * (DC.crossAisle + i * DC.rack.w), side * (DC.crossAisle + (i + 1) * DC.rack.w)]);
        add('rack', 'hall', 'collide', Math.min(...xs), Math.max(...xs), 0, DC.rack.h, z0, z1);
        run = [];
      };
      for (let i = 0; i < DC.perBlock; i++) {
        const end = i === 0 || i === DC.perBlock - 1;
        if (!end && rand() < DC.emptyChance) { flush(); continue; }
        const v = rand();
        racks.push({ x: side * (DC.crossAisle + (i + 0.5) * DC.rack.w), z: zc, face, variant: v < 0.75 ? 0 : v < 0.9 ? 1 : 2 });
        run.push(i);
      }
      flush();
      const xa = side < 0 ? -DC.crossAisle - DC.perBlock * DC.rack.w : DC.crossAisle;
      const xb = xa + DC.perBlock * DC.rack.w;
      add('tray', 'hall', 'draw', xa, xb, DC.tray.y0, DC.tray.y1, zc - DC.tray.w / 2, zc + DC.tray.w / 2);
      if (rand() < 0.5) add('cable', 'hall', 'draw', xa + 0.3, xb - 0.3, DC.tray.y1, DC.tray.y1 + 0.08, zc - 0.12, zc + 0.02);
      for (let x = xa + 0.3; x < xb; x += 1.8) {
        add('steel', 'hall', 'draw', x - 0.01, x + 0.01, DC.tray.y1, 3.7, zc - DC.tray.w / 2 - 0.02, zc - DC.tray.w / 2);
        add('steel', 'hall', 'draw', x - 0.01, x + 0.01, DC.tray.y1, 3.7, zc + DC.tray.w / 2, zc + DC.tray.w / 2 + 0.02);
      }
      // Yellow lines 0.3 m off the block, 8 cm wide.
      const o = 0.3, w = 0.08;
      add('paint', 'hall', 'draw', xa - o - w, xb + o + w, 0, 0.003, z0 - o - w, z0 - o);
      add('paint', 'hall', 'draw', xa - o - w, xb + o + w, 0, 0.003, z1 + o, z1 + o + w);
    }
    const next = z1 + (r === DC.rows - 1 ? 0 : face === 1 ? DC.cold : DC.hot);
    aisles.push(r === DC.rows - 1 ? 25.3 : (z1 + next) / 2);
    z = next;
  }
  // Light strips under the ceiling over every aisle, the cross aisle left to the downlights.
  for (const az of aisles) {
    add('strip', 'hall', 'draw', -X + 0.4, -1.0, DC.stripY, DC.stripY + 0.06, az - 0.06, az + 0.06);
    add('strip', 'hall', 'draw', 1.0, X - 0.4, DC.stripY, DC.stripY + 0.06, az - 0.06, az + 0.06);
  }
  // Hazard bands inside both doors of the hall, steel frames round them.
  add('hazard', 'hall', 'draw', -1.2, 1.2, 0, 0.003, 0, 0.6);
  add('hazard', 'ups', 'draw', U.x0, U.x0 + 0.6, 0, 0.003, U.door0 - 0.2, U.door1 + 0.2);
  add('steel', 'hall', 'draw', -D.x - 0.08, -D.x, 0, D.h, 0, 0.04);
  add('steel', 'hall', 'draw', D.x, D.x + 0.08, 0, D.h, 0, 0.04);
  add('steel', 'hall', 'draw', -D.x - 0.08, D.x + 0.08, D.h, D.h + 0.08, 0, 0.04);
  add('steel', 'hall', 'draw', X - 0.04, X, 0, U.doorH, U.door0 - 0.08, U.door0);
  add('steel', 'hall', 'draw', X - 0.04, X, 0, U.doorH, U.door1, U.door1 + 0.08);
  add('steel', 'hall', 'draw', X - 0.04, X, U.doorH, U.doorH + 0.08, U.door0 - 0.08, U.door1 + 0.08);

  // --- The vestibule: where you arrive, the closed steel door out in its south wall.
  add('floor', 'vestibule', 'both', -V.x - t, V.x + t, -s, 0, V.z0 - t, V.z1);
  add('ceiling', 'vestibule', 'both', -V.x - t, V.x + t, V.h, V.h + s, V.z0 - t, V.z1);
  add('wall', 'vestibule', 'both', -V.x - t, -V.x, -s, V.h + s, V.z0 - t, V.z1);
  add('wall', 'vestibule', 'both', V.x, V.x + t, -s, V.h + s, V.z0 - t, V.z1);
  add('wall', 'vestibule', 'both', -V.x - t, V.x + t, -s, V.h + s, V.z0 - t, V.z0);
  add('door', 'vestibule', 'draw', -0.9, 0.9, 0, 2.2, V.z0, V.z0 + 0.02); // the exit, its wall behind it solid
  add('steel', 'vestibule', 'draw', -0.98, 0.98, 2.2, 2.28, V.z0, V.z0 + 0.04);
  add('hazard', 'vestibule', 'draw', -1.2, 1.2, 0, 0.003, V.z0, V.z0 + 0.6);
  add('equipment', 'vestibule', 'both', 2.2, V.x, 0, 0.9, -4.6, -3.4); // a bench-height cabinet
  add('equipment', 'vestibule', 'draw', 1.05, 1.17, 1.2, 1.36, -0.32, -0.3); // the card reader by the hall door
  add('strip', 'vestibule', 'draw', -1.5, 1.5, V.h - 0.06, V.h, -2.86, -2.74);

  // --- The UPS room, through the hall's east wall: UPS cabinets on the north wall, batteries along the east one.
  add('floor', 'ups', 'both', U.x0, U.x1 + t, -s, 0, U.z0 - t, U.z1 + t);
  add('ceiling', 'ups', 'both', U.x0, U.x1 + t, U.h, U.h + s, U.z0 - t, U.z1 + t);
  add('wall', 'ups', 'both', U.x1, U.x1 + t, -s, U.h + s, U.z0 - t, U.z1 + t);
  add('wall', 'ups', 'both', U.x0, U.x1 + t, -s, U.h + s, U.z0 - t, U.z0);
  add('wall', 'ups', 'both', U.x0, U.x1 + t, -s, U.h + s, U.z1, U.z1 + t);
  for (const x of [14.0, 16.4]) add('equipment', 'ups', 'both', x - 0.8, x + 0.8, 0, 2.0, U.z1 - 1.0, U.z1);
  for (let i = 0; i < 6; i++) add('equipment', 'ups', 'both', U.x1 - 0.8, U.x1, 0, 1.8, 2.6 + i, 3.6 + i);
  add('equipment', 'ups', 'draw', U.x0 + 0.02, U.x0 + 0.06, 1.0, 1.8, 6.2, 7.4); // the switch panel
  add('strip', 'ups', 'draw', 13.0, 17.6, U.h - 0.06, U.h, 5.94, 6.06);

  // --- Lights (docs/levels/datacenter.md "Lighting"): point fixtures under the strips, downlights that cast.
  const point = (role: Fixture['role'], zone: ZoneId, x: number, y: number, zz: number, color: number, intensity: number, range: number) =>
    fixtures.push({ kind: 'point', role, pos: [x, y, zz], color, intensity, range, decay: 1.5, castsShadow: false, zone });
  for (const x of [-5.4, 5.4]) for (const zz of [5.1, 10.5, 15.9, 21.3, 25.5]) point('main', 'hall', x, 3.5, zz, MAIN, 4, 9);
  for (const x of [-10.8, 10.8]) for (const zz of [1.5, 10.5, 21.3]) point('main', 'hall', x, 3.5, zz, MAIN, 4, 9);
  point('main', 'vestibule', 0, 2.8, -2.8, MAIN, 2, 6);
  point('main', 'ups', 14, 3.2, 6, MAIN, 2.5, 6);
  point('main', 'ups', 16.8, 3.2, 6, MAIN, 2.5, 6);
  point('emergency', 'hall', 0, 2.7, 0.4, AMBER, 0.8, 4);
  point('emergency', 'vestibule', 0, 2.7, -0.6, AMBER, 0.8, 4);
  point('emergency', 'vestibule', 0, 2.5, V.z0 + 0.3, AMBER, 0.8, 4);
  point('emergency', 'ups', U.x0 + 0.4, 2.6, (U.door0 + U.door1) / 2, AMBER, 0.8, 4);
  const spot = (zone: ZoneId, x: number, y: number, zz: number) => {
    fixtures.push({ kind: 'spot', role: 'main', pos: [x, y, zz], angle: 0.95, penumbra: 0.5, color: MAIN, intensity: 6, range: 10, decay: 1.5, castsShadow: true, zone });
    add('downlight', zone, 'draw', x - 0.2, x + 0.2, y + 0.02, y + 0.06, zz - 0.2, zz + 0.2);
  };
  for (const zz of [1.5, 10.5, 19.5]) spot('hall', 0, H - 0.3, zz);
  spot('vestibule', 0, V.h - 0.1, -1.5);
  spot('ups', 15.3, U.h - 0.1, 3.7);
  for (const f of fixtures) if (f.role === 'emergency') add('emergency', f.zone, 'draw', f.pos[0] - 0.15, f.pos[0] + 0.15, f.pos[1] + 0.02, f.pos[1] + 0.1, f.pos[2] - 0.05, f.pos[2] + 0.05);

  // Four spawns in the vestibule, facing the hall door (+z: yaw π), clear of the exit's trigger and the server's slack
  // round it (an F pressed twice must not take you straight back out).
  const spawns: LevelPoint[] = [];
  for (const zz of [-2.6, -1.5]) for (const x of [-0.8, 0.8]) spawns.push({ x, y: 0, z: zz, facing: Math.PI });

  return {
    id: 'datacenter',
    bounds: [-X - t, U.x1 + t, -s, H + s, V.z0 - t, Z + t],
    zones: { hall: [-X, X, 0, H, 0, Z], vestibule: [-V.x, V.x, 0, V.h, V.z0, V.z1], ups: [U.x0, U.x1, 0, U.h, U.z0, U.z1] },
    ceilings: { hall: H, vestibule: V.h, ups: U.h },
    boxes, racks, fixtures, spawns,
    exits: [[-1.2, 1.2, -0.5, 2.6, V.z0, V.z0 + 1.1]],
  };
}

/** The level everyone plays: a fixed seed, so the server and every client agree. */
export const DATACENTER = datacenterLayout(1);

/** Which zone (x, z) is in, or null in a doorway or outside. */
export function zoneAt(L: LevelLayout, x: number, z: number): ZoneId | null {
  for (const id of ['hall', 'vestibule', 'ups'] as const) {
    const b = L.zones[id];
    if (x >= b[0] && x <= b[1] && z >= b[4] && z <= b[5]) return id;
  }
  return null;
}

/** The exit door's trigger leads out to the desert (in front of its entrance: shared/levels.ts desertArrival). Made on
 *  first use: shared/levels.ts imports this module, so its values aren't there yet while this one loads. */
let doors: LevelDoor[] | null = null;

const solids = boxGrid(DATACENTER.boxes.filter((b) => b.use !== 'draw').map((b) => b.b));

/** The datacenter as a Level (shared/levels.ts): cool, still air, no sun, nothing from the desert reaches in. */
export const datacenterLevel: Level = {
  id: 1,
  key: 'datacenter',
  // The floors are boxes too: they are stood on through collide, so under a point there is only what's below it.
  ground: (x, z, prevY) => groundBoxes(solids, x, z, prevY, STEP_UP),
  collide: (c, y, prevY, radius, height, stepUp) => collideBoxes(solids, c, y, prevY, radius, height, stepUp),
  ceiling: (x, z, prevY, height, radius) => ceilingBoxes(solids, x, z, prevY, height, radius),
  flat: true,
  bounds: DATACENTER.bounds,
  spawns: DATACENTER.spawns,
  doors: () => (doors ??= DATACENTER.exits.map((trigger) => ({ trigger, to: DESERT }))),
  indoors: true,
  climate: { tempC: 22 },
  weather: false,
  enemies: false,
  building: false,
  things: false,
};
