// Levels: places other than the desert, in the same world (docs/levels.md). A player is in exactly one level at a time
// (PlayerState.level, shared/sim.ts); each level has its own coordinate frame, ground, solids and look. The desert is
// level 0 and a Level too: desertLevel wraps what shared/sim.ts did before there were levels, unchanged.
//
// Read a level by its properties (indoors, climate, weather, enemies, building, things), never by asking which one it is,
// as with BIOMES in shared/biomes.ts. Only the server changes a player's level (a teleport: server/world.ts moveTo).
//
// Node type stripping rules (no enums); no three.js. This module must not import shared/sim.ts (sim imports it).
import { collideOutdoor } from './capsules.ts';
import { collideShelter, sandHidden, shelterCeiling } from './shelters.ts';
import { collideCrash } from './crashsites.ts';
import { collideMachines } from './machineBoxes.ts';
import { collideJetWrecks } from './jetcrash.ts';
import { collideScrap } from './scrap.ts';
import { collidePods } from './pods.ts';
import { heightAt } from './terrain.ts';
import { datacenterLevel } from './levels/datacenter.ts';

export const DESERT = 0;
/** 0 the desert, 1.. the registry below: small, one byte on the wire. */
export type LevelId = number;

/** Axis-aligned box in a level's frame (m). */
export type Box = readonly [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number];
/** A mover the collision pushes out of solids: its position and the velocity that is absorbed into what it hits. */
export type Mover = { x: number; z: number; vx: number; vz: number };
/** A place in a level and the way you face there (radians, as PlayerState.facing). */
export type LevelPoint = { x: number; y: number; z: number; facing: number };

export type Level = {
  id: LevelId;
  /** 'desert', 'datacenter': for URLs (?spawn=), the debug menu and logs. */
  key: string;
  /** Ground under feet that were at prevY, at (x, z); -Infinity for none. */
  ground(x: number, z: number, prevY: number): number;
  /** Push a mover out of the level's solids (it may stand on the low ones): the highest support top, or -Infinity.
   *  (prevX, prevZ): where it was a tick ago. */
  collide(c: Mover, y: number, prevY: number, radius: number, height: number, stepUp: number, prevX: number, prevZ: number): number;
  /** Lowest ceiling over (x, z) for a mover of this height (jumping into a roof). */
  ceiling(x: number, z: number, prevY: number, height: number, radius: number): number;
  /** Hard flat floors: no sand slopes, slip faces or rock walls in the sim (shared/sim.ts reads the terrain only when not). */
  flat: boolean;
  /** Nothing in the level leaves this: a mover outside it is put back at the first spawn. Null: no bounds (the desert). */
  bounds: Box | null;
  spawns: readonly LevelPoint[];
  /** Ways out: F in one of these boxes takes you back out to the desert, at the entrance you came in by (server/world.ts;
   *  docs/levels.md had each exit name its destination, but the entrance is placed per world, so the server pairs them). */
  exits: readonly Box[];
  /** A roof overhead everywhere: music, speech, hand shade, reverb, no wind. */
  indoors: boolean;
  /** null: the desert's sun and clock heat you; else a fixed felt temperature (°C). */
  climate: { tempC: number } | null;
  /** Storms, gas fronts and sand vortices reach it. */
  weather: boolean;
  /** Walkers, drones, jets, harvesters and bosses hunt in it. */
  enemies: boolean;
  /** The wrench may place things here. */
  building: boolean;
  /** The world's things lie here: scrap, crash sites, loot, packs, chests, buildings, vehicles (the desert's layout and the
   *  tables of things lying about, which have no level yet: docs/levels.md phase 5). */
  things: boolean;
};

/** The sand's height as ground for feet that were at `prevY`: none inside a shelter's entrance and rooms. */
function sandAt(x: number, z: number, prevY: number): number {
  return sandHidden(x, z, prevY) ? -Infinity : heightAt(x, z);
}

/** The desert: the dunes, scrap, crash sites, machines, downed jets, the pods, the shelters and what is built outside. */
export const desertLevel: Level = {
  id: DESERT,
  key: 'desert',
  ground: sandAt,
  collide(c, y, prevY, radius, height, stepUp, prevX, prevZ) {
    // Low pieces become the ground, tall ones push you out (the order is the sim's from before levels).
    const scrapTop = Math.max(collideScrap(c, y, prevY, radius, stepUp), collideCrash(c, y, prevY, radius, stepUp),
      collideMachines(c, y, prevY, radius, stepUp), collideJetWrecks(c, y, prevY, radius, stepUp), collidePods(c, y, prevY, radius, stepUp));
    const builtTop = Math.max(collideShelter(c, y, prevY, radius, height, stepUp, prevX, prevZ),
      collideOutdoor(c, y, prevY, radius, height, stepUp));
    return Math.max(scrapTop, builtTop);
  },
  ceiling: shelterCeiling,
  flat: false,
  bounds: null,
  spawns: [],
  exits: [],
  indoors: false,
  climate: null,
  weather: true,
  enemies: true,
  building: true,
  things: true,
};

export const LEVELS: readonly Level[] = [desertLevel, datacenterLevel];
/** The level with this id; an unknown id is the desert. */
export const level = (id: LevelId): Level => LEVELS[id] ?? desertLevel;
/** A level by its key ('datacenter'), or undefined. */
export const levelByKey = (key: string): Level | undefined => LEVELS.find((l) => l.key === key);

/** Is (x, y, z) inside box b? */
export const inBox = (b: Box, x: number, y: number, z: number) => x >= b[0] && x <= b[1] && y >= b[2] && y <= b[3] && z >= b[4] && z <= b[5];
