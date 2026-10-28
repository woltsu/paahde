// The datacenter as a stage (src/levels/stage.ts, docs/levels/datacenter.md "Client builder"): its layout built into the
// stage's root (src/levels/boxLevel.ts: boxes merged per material, racks instanced, the light pool, a hemisphere fill).
// Built on the first visit (or when you come near the door) and kept.
import * as THREE from 'three/webgpu';
import { DATACENTER, datacenterLevel, zoneAt } from '../../../shared/levels/datacenter.ts';
import type { Post } from '../../post.ts';
import { setLevelShade } from '../../world/materialLighting.ts';
import type { LightPool } from '../lightPool.ts';
import { buildBoxLevel } from '../boxLevel.ts';
import type { Stage, StageFrame } from '../stage.ts';
import { bakeDataSliced, bakeMaps, type BakeData, type BakeMaps } from './bake.ts';
import { makeMaterials } from './materials.ts';
import { DATACENTER_ENV, DATACENTER_POST, datacenterEnvironment } from './environment.ts';
import { DatacenterAmbience } from './ambience.ts';

export class DatacenterStage implements Stage {
  readonly level = datacenterLevel.id;
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  readonly pool: LightPool;
  readonly ambience = new DatacenterAmbience();
  private maps: BakeMaps;
  private background = new THREE.Color(DATACENTER_ENV.background);

  /** Built a little at a time (the bake is the slow part: src/levels/datacenter/bake.ts bakeDataSliced). */
  static async build(): Promise<DatacenterStage> {
    return new DatacenterStage(await bakeDataSliced(DATACENTER));
  }

  private constructor(bake: BakeData) {
    const L = DATACENTER;
    this.root.name = 'datacenter';
    this.root.visible = false;
    this.maps = bakeMaps(L, bake);
    this.pool = buildBoxLevel(L, this.root, makeMaterials(this.maps), DATACENTER_ENV.ambient).pool;
    this.ready = Promise.resolve();
  }

  enter(scene: THREE.Scene, post: Post) {
    this.root.visible = true;
    scene.background = this.background;
    scene.fogNode = null;
    scene.environmentNode = datacenterEnvironment;
    post.setProfile(DATACENTER_POST);
    setLevelShade(DATACENTER_ENV.handShade);
    this.ambience.start();
  }

  leave(_scene: THREE.Scene) {
    this.root.visible = false;
    this.ambience.stop();
  }

  update(f: StageFrame) {
    const cam = f.camera.position;
    this.pool.update(f.dt, cam, zoneAt(DATACENTER, cam.x, cam.z));
    this.ambience.update(f.dt, cam, zoneAt(DATACENTER, cam.x, cam.z));
  }
}
