// Building a level made of boxes (shared/levels/datacenter.ts LevelLayout: the datacenter, the beginning) into a stage's
// root (docs/levels/datacenter.md "Client builder"): the layout's boxes merged into one mesh per material, the racks one
// instanced mesh, a hemisphere fill and the fixed light pool. A gated box (a door the server opens) is a mesh of its own,
// so its stage can slide it away.
import * as THREE from 'three/webgpu';
import type { LevelBox, LevelLayout, LevelMat } from '../../shared/levels/datacenter.ts';
import { LightPool } from './lightPool.ts';
import type { BakeMaps } from './datacenter/bake.ts';

/** The materials that cast the pool's shadow; racks do too (the concrete casts nothing). */
const CASTS = new Set<LevelMat>(['equipment']);

export type BoxLevel = {
  pool: LightPool;
  /** Each gated box's mesh, by its index in the layout's boxes. */
  gated: Map<number, THREE.Mesh>;
  racks: THREE.InstancedMesh;
};

/** Build `L` into `root` with these materials (src/levels/datacenter/materials.ts makeMaterials). */
export function buildBoxLevel<Z extends string>(L: LevelLayout<Z>, root: THREE.Group, mats: Record<LevelMat, THREE.Material>,
  ambient: { sky: number; ground: number; intensity: number }): BoxLevel {
  const byMat = new Map<LevelMat, LevelBox<Z>[]>();
  const gated = new Map<number, THREE.Mesh>();
  L.boxes.forEach((b, i) => {
    if (b.use === 'collide' && !b.gate) return;
    if (b.gate) {
      if (b.use === 'collide') return; // (drawn by its stage: the blast door)
      const m = new THREE.Mesh(boxGeometry([b], L.ceilings), mats[b.mat]);
      m.name = `box-${b.mat}-${i}`;
      m.castShadow = m.receiveShadow = true;
      gated.set(i, m);
      root.add(m);
      return;
    }
    let list = byMat.get(b.mat);
    if (!list) byMat.set(b.mat, (list = []));
    list.push(b);
  });
  for (const [mat, list] of byMat) {
    const mesh = new THREE.Mesh(boxGeometry(list, L.ceilings), mats[mat]);
    mesh.name = `${L.id}-${mat}`;
    mesh.receiveShadow = mat !== 'strip' && mat !== 'downlight' && mat !== 'emergency';
    mesh.castShadow = CASTS.has(mat);
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
  // The racks: one 12-triangle box per rack, origin at the bottom centre, front = +z, turned for rows facing -z.
  const rack = new THREE.BoxGeometry(0.6, 2.0, 1.2).translate(0, 1, 0);
  const racks = new THREE.InstancedMesh(rack, mats.rack, Math.max(1, L.racks.length));
  racks.count = L.racks.length;
  const m4 = new THREE.Matrix4();
  L.racks.forEach((r, i) => racks.setMatrixAt(i, m4.makeRotationY(r.face === 1 ? 0 : Math.PI).setPosition(r.x, 0, r.z)));
  racks.instanceMatrix.needsUpdate = true;
  racks.castShadow = racks.receiveShadow = true;
  racks.name = `${L.id}-racks`;
  racks.computeBoundingSphere();
  root.add(racks);
  root.add(new THREE.HemisphereLight(ambient.sky, ambient.ground, ambient.intensity));
  const pool = new LightPool(L.fixtures, root);
  root.updateMatrixWorld(true);
  return { pool, gated, racks };
}

/** Boxes merged into one geometry: positions in the level frame, axis-aligned normals, and each box's zone's ceiling
 *  height (`ceilH`, the walls' contact shade under it). */
export function boxGeometry(list: readonly { b: readonly number[]; zone: string }[], ceilings: Record<string, number>): THREE.BufferGeometry {
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

export type { BakeMaps };
