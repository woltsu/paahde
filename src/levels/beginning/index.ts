// The beginning as a stage (src/levels/stage.ts, docs/levels/tutorial.md): the last datacenter in orbit, built from its
// layout (shared/levels/beginning.ts) with the datacenter's materials, racks, light pool and environment
// (src/levels/boxLevel.ts, src/levels/datacenter/). What moves is read off the player's gates (PlayerState.gates, set by the
// server): the doors slide open, the hall's lights go out row by row. Built on the first visit and kept.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { BEGINNING, beginningLevel } from '../../../shared/levels/beginning.ts';
import { zoneAt } from '../../../shared/levels/datacenter.ts';
import type { Post } from '../../post.ts';
import { setLevelShade } from '../../world/materialLighting.ts';
import { buildBoxLevel, type BoxLevel } from '../boxLevel.ts';
import type { Stage, StageFrame } from '../stage.ts';
import { bakeDataSliced, bakeMaps } from '../datacenter/bake.ts';
import { makeMaterials } from '../datacenter/materials.ts';
import { DATACENTER_ENV, DATACENTER_POST, datacenterEnvironment } from '../datacenter/environment.ts';
import { DatacenterAmbience } from '../datacenter/ambience.ts';

/** A door's panel slides up into its lintel this fast (s): collision is gone at once (docs/levels/tutorial.md). */
const DOOR_S = 0.4;

export class BeginningStage implements Stage {
  readonly level = beginningLevel.id;
  readonly root = new THREE.Group();
  readonly ready = Promise.resolve();
  readonly ambience = new DatacenterAmbience();
  private box: BoxLevel;
  private background = new THREE.Color(DATACENTER_ENV.background);
  /** Where the hall's strips are dark up to (z): the strip shader's cut. */
  private stripCut = uniform(-1000);
  /** Each gated door: its mesh, its bit and how far open (0..1). */
  private doors: { mesh: THREE.Mesh; bit: number; open: number; h: number }[] = [];

  static async build(): Promise<BeginningStage> {
    return new BeginningStage(await bakeDataSliced(BEGINNING));
  }

  private constructor(bake: Awaited<ReturnType<typeof bakeDataSliced>>) {
    const L = BEGINNING;
    this.root.name = 'beginning';
    this.root.visible = false;
    const maps = bakeMaps(L, bake);
    const hall = L.zones.hall;
    this.box = buildBoxLevel(L, this.root, makeMaterials(maps, { z0: hall[4], cut: this.stripCut }), DATACENTER_ENV.ambient);
    for (const [i, mesh] of this.box.gated) {
      const b = L.boxes[i];
      if (b.gate! > 0) this.doors.push({ mesh, bit: b.gate!, open: 0, h: b.b[3] - b.b[2] });
    }
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
    const cam = f.camera.position, gates = f.me.gates ?? 0;
    for (const d of this.doors) {
      const want = gates & d.bit ? 1 : 0;
      if (d.open === want) continue;
      d.open = want ? Math.min(1, d.open + f.dt / DOOR_S) : 0;
      d.mesh.position.y = d.open * (d.h - 0.05);
      d.mesh.updateMatrixWorld();
    }
    const zone = zoneAt(BEGINNING, cam.x, cam.z);
    this.box.pool.update(f.dt, cam, zone);
    this.ambience.update(f.dt, cam, null);
  }
}
