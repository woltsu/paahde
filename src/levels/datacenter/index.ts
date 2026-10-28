// The datacenter as a stage (src/levels/stage.ts, docs/levels/datacenter.md "Client builder"): the layout's boxes
// merged into one mesh per material, the racks one instanced mesh, the fixed light pool and a hemisphere fill, all in
// the stage's root. Built on the first visit (or when you come near the door) and kept.
import * as THREE from 'three/webgpu';
import { DATACENTER, datacenterLevel, zoneAt, type LevelBox, type LevelMat } from '../../../shared/levels/datacenter.ts';
import type { Post } from '../../post.ts';
import { setLevelShade } from '../../world/materialLighting.ts';
import { LightPool } from '../lightPool.ts';
import type { Stage, StageFrame } from '../stage.ts';
import { bakeDataSliced, bakeMaps, type BakeData, type BakeMaps } from './bake.ts';
import { makeMaterials } from './materials.ts';
import { DATACENTER_ENV, DATACENTER_POST, datacenterEnvironment } from './environment.ts';
import { DatacenterAmbience } from './ambience.ts';

/** The materials that receive the pool's shadow; equipment and racks cast it (the concrete casts nothing). */
const CASTS = new Set<LevelMat>(['equipment']);

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
    const mats = makeMaterials(this.maps);
    const byMat = new Map<LevelMat, LevelBox[]>();
    for (const b of L.boxes) {
      if (b.use === 'collide') continue;
      let list = byMat.get(b.mat);
      if (!list) byMat.set(b.mat, (list = []));
      list.push(b);
    }
    for (const [mat, list] of byMat) {
      const mesh = new THREE.Mesh(boxGeometry(list, L.ceilings), mats[mat]);
      mesh.name = `dc-${mat}`;
      mesh.receiveShadow = mat !== 'strip' && mat !== 'downlight' && mat !== 'emergency';
      mesh.castShadow = CASTS.has(mat);
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
    }
    // The racks: one 12-triangle box per rack, origin at the bottom centre, front = +z, turned for rows facing -z.
    const rack = new THREE.BoxGeometry(0.6, 2.0, 1.2).translate(0, 1, 0);
    const racks = new THREE.InstancedMesh(rack, mats.rack, L.racks.length);
    const m4 = new THREE.Matrix4();
    L.racks.forEach((r, i) => racks.setMatrixAt(i, m4.makeRotationY(r.face === 1 ? 0 : Math.PI).setPosition(r.x, 0, r.z)));
    racks.instanceMatrix.needsUpdate = true;
    racks.castShadow = racks.receiveShadow = true;
    racks.name = 'dc-racks';
    racks.computeBoundingSphere();
    this.root.add(racks);
    const a = DATACENTER_ENV.ambient;
    this.root.add(new THREE.HemisphereLight(a.sky, a.ground, a.intensity));
    this.pool = new LightPool(L.fixtures, this.root);
    this.root.updateMatrixWorld(true);
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

/** Boxes merged into one geometry: positions in the level frame, axis-aligned normals, and each box's zone's ceiling
 *  height (`ceilH`, the walls' contact shade under it). */
function boxGeometry(list: LevelBox[], ceilings: Record<string, number>): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], ceil: number[] = [], idx: number[] = [];
  // Each face: its normal and its four corners as (x, y, z) picks of the box's min (0) or max (1).
  const FACES: [number[], number[][]][] = [
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
    [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
    [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
    [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
    [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
  ];
  for (const { b, zone } of list) {
    const xs = [b[0], b[1]], ys = [b[2], b[3]], zs = [b[4], b[5]];
    for (const [n, corners] of FACES) {
      const base = pos.length / 3;
      for (const c of corners) {
        pos.push(xs[c[0]], ys[c[1]], zs[c[2]]);
        nor.push(n[0], n[1], n[2]);
        ceil.push(ceilings[zone]);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('ceilH', new THREE.Float32BufferAttribute(ceil, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
