// The ground for the client's own checks and effects (the camera, ragdolls, shots and blows landing, sparks and smoke,
// thrown junk, the spyglass's line of sight, sound occlusion): the sand's height in the desert; in a level with flat
// floors (shared/levels.ts `flat`), the floor under (x, z) at about the height the local player stands at. The desert's
// heightfield means nothing in a level's frame (at the datacenter's x, z it is a dune 9-19 m over its roof).
import { heightAt } from '../shared/terrain.ts';
import { DESERT, level, type Level } from '../shared/levels.ts';

let L: Level = level(DESERT);
/** Where the local player's feet are (main.ts, each frame): a level's floors are looked up from about there. */
let refY = 0;
/** The local player's PlayerState.gates: which of a level's gated solids (doors) are in the way for us. */
let myGates = 0;

/** main.ts, each frame: the level we're in, our feet and our gates. */
export function setGround(id: number, feetY: number, gates = 0) {
  L = level(id);
  refY = feetY;
  myGates = gates;
}

/** Is one of the level's solids within r of (x, y, z) (Level.solid: the third-person camera's boom)? */
export const solidAt = (x: number, y: number, z: number, r: number) => L.solid(x, y, z, r, myGates);

/** In a level with flat floors: no sand, no slopes, no shelters (their x, z are the desert's). */
export const onFlat = () => L.flat;

/** The ground's height under (x, z); in a level, the highest floor at or under `y` (+ a step), else far below. */
export function groundAt(x: number, z: number, y = refY + 1): number {
  if (!L.flat) return heightAt(x, z);
  const g = L.ground(x, z, y);
  return g === -Infinity ? y - 100 : g;
}
