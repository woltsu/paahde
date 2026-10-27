// A stage is what the client draws for one level (docs/levels.md "The client: stages"): one scene, one root per stage,
// and the active stage owns the scene-level state (fog, environment, background, the post profile) while it is active.
// A hidden root's lights are not collected by the renderer, so the active stage's lights are the scene's only lights:
// avatars, hands and held items (in the scene itself, common to every stage) are lit by whatever level they are in.
import type * as THREE from 'three/webgpu';
import type { Post } from '../post.ts';

export type { PostProfile } from '../post.ts';

/** What a stage's per-frame update gets. */
export type StageFrame = {
  dt: number;
  /** Page time (s): the pods' and lamps' animations. */
  time: number;
  /** The local player's (or the fly camera's) position, in the level's frame. */
  focus: THREE.Vector3;
  camera: THREE.PerspectiveCamera;
  /** Shared wall clock (Net.worldTime): the time of day. */
  worldTime: number;
  /** The server's clock (Net.serverTime, ms). */
  serverTime: number;
};

export interface Stage {
  /** The level it draws (0 the desert). */
  readonly level: number;
  /** Everything that belongs only to this level, lights included. */
  readonly root: THREE.Group;
  /** Took over the scene: set fog, environment, background, the post profile; show root. */
  enter(scene: THREE.Scene, post: Post): void;
  /** Gave it back: hide root, put nothing back (the next stage's enter sets everything). */
  leave(scene: THREE.Scene): void;
  /** Per-frame work while active. */
  update(frame: StageFrame): void;
  /** Built (and, for a level, its materials compiled) before the first enter. */
  readonly ready: Promise<void>;
}
