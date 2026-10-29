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
import { collideSolar, solarCeiling } from './solarfarms.ts';
import { collideCrash } from './crashsites.ts';
import { collideMachines } from './machineBoxes.ts';
import { collideJetWrecks } from './jetcrash.ts';
import { collideScrap } from './scrap.ts';
import { collidePods } from './pods.ts';
import { heightAt } from './terrain.ts';
import { datacenterLevel } from './levels/datacenter.ts';
import { beginningLevel } from './levels/beginning.ts';
import { collideEntrance, entrance, solidEntrance } from './levels/entrance.ts';

export const DESERT = 0;
/** Things whose top is at most this far above the feet are stepped onto instead of blocking (shared/sim.ts re-exports
 *  it; here so a level's collision can use it without importing the sim). */
export const STEP_UP = 0.35;
/** 0 the desert, 1.. the registry below: small, one byte on the wire. */
export type LevelId = number;

/** Axis-aligned box in a level's frame (m). */
export type Box = readonly [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number];
/** A mover the collision pushes out of solids: its position and the velocity that is absorbed into what it hits. */
export type Mover = { x: number; z: number; vx: number; vz: number };
/** A place in a level and the way you face there (radians, as PlayerState.facing). */
export type LevelPoint = { x: number; y: number; z: number; facing: number };
/** A way between levels: F in `trigger` takes you to level `to` (at one of its spawns; out to the desert, in front of the
 *  desert's door that leads back here). `arrive`: where you come out at this door, on its outside (the y is the ground's
 *  there at the time). */
export type LevelDoor = { trigger: Box; to: LevelId; arrive?: { x: number; z: number; facing: number } };

export type Level = {
  id: LevelId;
  /** 'desert', 'datacenter': for URLs (?spawn=), the debug menu and logs. */
  key: string;
  /** Ground under feet that were at prevY, at (x, z); -Infinity for none. `gates`: the mover's PlayerState.gates (a level's
   *  gated solids, below; 0 where it is not a player's: every door shut). */
  ground(x: number, z: number, prevY: number, gates?: number): number;
  /** Push a mover out of the level's solids (it may stand on the low ones): the highest support top, or -Infinity.
   *  (prevX, prevZ): where it was a tick ago. */
  collide(c: Mover, y: number, prevY: number, radius: number, height: number, stepUp: number, prevX: number, prevZ: number, gates?: number): number;
  /** Lowest ceiling over (x, z) for a mover of this height (jumping into a roof). */
  ceiling(x: number, z: number, prevY: number, height: number, radius: number, gates?: number): number;
  /** Is one of its solids within r of (x, y, z)? The third-person camera's boom pulls in short of them (src/camera.ts). In
   *  the desert only what isn't sand or a shelter (the camera has those already): the datacenter's entrance block. */
  solid(x: number, y: number, z: number, r: number, gates?: number): boolean;
  /** Hard flat floors: no sand slopes, slip faces or rock walls in the sim (shared/sim.ts reads the terrain only when not). */
  flat: boolean;
  /** Nothing in the level leaves this: a mover outside it is put back at the first spawn. Null: no bounds (the desert). */
  bounds: Box | null;
  spawns: readonly LevelPoint[];
  /** Its doors (computed on first use: the desert's is placed from the world seed). */
  doors(): readonly LevelDoor[];
  /** A roof overhead everywhere: music, speech, hand shade, no wind (its own reverb: not yet, docs/levels.md). */
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
  /** One for each player: nobody else is ever seen in it, and nobody outside sees who is in it (server/world.ts interest). */
  private: boolean;
  /** Things can hurt and kill you here (server/world.ts hurt and die refuse in a level without). */
  mortal: boolean;
  /** Crouched or sliding you are CROUCH_HEIGHT tall (shared/sim.ts), short enough to pass under its low things, and stay
   *  crouched while there is no room to stand. The desert's solids are built for a standing height: there you never are. */
  crouchUnder: boolean;
  /** The Esc menu offers to leave it straight for the desert (the beginning: server/tutorial.ts). */
  skippable: boolean;
  /** A player's gates after a tick here (shared/sim.ts step): what moves on its own once the server has set it going (the
   *  beginning's cleaning cart counts its ticks in them), so it is a function of state and predicted like the rest. */
  tick?: (gates: number) => number;
};

/** The sand's height as ground for feet that were at `prevY`: none inside a shelter's entrance and rooms. */
function sandAt(x: number, z: number, prevY: number): number {
  return sandHidden(x, z, prevY) ? -Infinity : heightAt(x, z);
}

/** The desert: the dunes, scrap, crash sites, machines, downed jets, the pods, the shelters, the solar farms, what is built
 *  outside and the datacenter's door (shared/levels/entrance.ts). */
export const desertLevel: Level = {
  id: DESERT,
  key: 'desert',
  ground: sandAt,
  collide(c, y, prevY, radius, height, stepUp, prevX, prevZ) {
    // Low pieces become the ground, tall ones push you out (the order is the sim's from before levels).
    const scrapTop = Math.max(collideScrap(c, y, prevY, radius, stepUp), collideCrash(c, y, prevY, radius, stepUp),
      collideMachines(c, y, prevY, radius, stepUp), collideJetWrecks(c, y, prevY, radius, stepUp), collidePods(c, y, prevY, radius, stepUp));
    const builtTop = Math.max(collideShelter(c, y, prevY, radius, height, stepUp, prevX, prevZ),
      collideOutdoor(c, y, prevY, radius, height, stepUp), collideEntrance(c, y, prevY, radius, height, stepUp),
      collideSolar(c, y, prevY, radius, height, stepUp));
    return Math.max(scrapTop, builtTop);
  },
  // Under a shelter's roof or a solar farm's mirror.
  ceiling: (x, z, prevY, height, radius) => Math.min(shelterCeiling(x, z, prevY, height, radius), solarCeiling(x, z, prevY, height)),
  solid: solidEntrance,
  flat: false,
  bounds: null,
  spawns: [],
  doors: () => entranceDoors(),
  indoors: false,
  climate: null,
  weather: true,
  enemies: true,
  building: true,
  things: true,
  private: false,
  mortal: true,
  crouchUnder: false,
  skippable: false,
};

let desertDoors: LevelDoor[] | null = null;
/** The desert's doors: the datacenter's entrance. */
function entranceDoors(): readonly LevelDoor[] {
  if (desertDoors) return desertDoors;
  const e = entrance();
  return (desertDoors = [{ trigger: e.trigger, to: datacenterLevel.id, arrive: e.out }]);
}

export const LEVELS: readonly Level[] = [desertLevel, datacenterLevel, beginningLevel];

/** The door of `from` that `s` stands at (within `slack` m of its trigger), or undefined. */
export function doorAt(from: Level, x: number, y: number, z: number, slack = 0): LevelDoor | undefined {
  const e = slack;
  return from.doors().find((d) => {
    const b = d.trigger;
    return inBox([b[0] - e, b[1] + e, b[2] - e, b[3] + e, b[4] - e, b[5] + e], x, y, z);
  });
}

/** Where a player leaving level `from` comes out in the desert: in front of the desert's door that leads to it. */
export function desertArrival(from: LevelId): { x: number; z: number; facing: number } | undefined {
  return desertLevel.doors().find((d) => d.to === from)?.arrive;
}
/** The level with this id; an unknown id is the desert. */
export const level = (id: LevelId): Level => LEVELS[id] ?? desertLevel;
/** A level by its key ('datacenter'), or undefined. */
export const levelByKey = (key: string): Level | undefined => LEVELS.find((l) => l.key === key);

/** Is (x, y, z) inside box b? */
export const inBox = (b: Box, x: number, y: number, z: number) => x >= b[0] && x <= b[1] && y >= b[2] && y <= b[3] && z >= b[4] && z <= b[5];
