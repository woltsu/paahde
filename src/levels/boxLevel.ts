// Building a level made of boxes (shared/levels/datacenter.ts LevelLayout: the datacenter, the beginning) into a stage's
// root (docs/levels/datacenter.md "Client builder"): the layout's boxes merged into one mesh per material, the racks one
// instanced mesh, a hemisphere fill and the fixed light pool. A gated box (a door the server opens) is a mesh of its own,
// so its stage can slide it away.
//
// On a ring (`ring`: the beginning, docs/levels/ring.md) the level's flat frame is the ring's cylindrical one: the merged
// boxes are bent onto it (split into strips along z, every vertex and normal mapped by shared/ring.ts), the racks, the
// gated boxes and the lights are placed whole by the ring's rigid motion at their own z, and the stage turns its root
// round the camera each frame. Every box geometry carries its flat position and normal (`lpos`, `lnor`): the materials
// read those, so their patterns, bakes and cuts are the level's whatever the mesh is bent to.
import * as THREE from 'three/webgpu';
import type { LevelBox, LevelLayout, LevelMat } from '../../shared/levels/datacenter.ts';
import { dirToRing, ringMatrix, toRing } from '../../shared/ring.ts';
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

/** A group that puts flat-frame content onto the ring at arc length z (shared/ring.ts ringMatrix): what it holds keeps
 *  its own flat coordinates and animation. */
export function ringAnchor(z: number, child?: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  g.matrix.fromArray(ringMatrix(z));
  g.name = `ring@${z.toFixed(1)}`;
  if (child) g.add(child);
  return g;
}

/** Build `L` into `root` with these materials (src/levels/datacenter/materials.ts makeMaterials); `ring`: onto the ring. */
export function buildBoxLevel<Z extends string>(L: LevelLayout<Z>, root: THREE.Group, mats: Record<LevelMat, THREE.Material>,
  ambient: { sky: number; ground: number; intensity: number }, ring = false): BoxLevel {
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
      root.add(ring ? ringAnchor((b.b[4] + b.b[5]) / 2, m) : m);
      return;
    }
    let list = byMat.get(b.mat);
    if (!list) byMat.set(b.mat, (list = []));
    list.push(b);
  });
  for (const [mat, list] of byMat) {
    const mesh = new THREE.Mesh(boxGeometry(list, L.ceilings, ring), mats[mat]);
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
  const onRing = new THREE.Matrix4();
  L.racks.forEach((r, i) => {
    m4.makeRotationY(r.face === 1 ? 0 : Math.PI).setPosition(r.x, 0, r.z);
    if (ring) m4.premultiply(onRing.fromArray(ringMatrix(r.z)));
    racks.setMatrixAt(i, m4);
  });
  racks.instanceMatrix.needsUpdate = true;
  racks.castShadow = racks.receiveShadow = true;
  racks.name = `${L.id}-racks`;
  racks.computeBoundingSphere();
  root.add(racks);
  root.add(new THREE.HemisphereLight(ambient.sky, ambient.ground, ambient.intensity));
  const pool = new LightPool(L.fixtures, root, 1024, ring ? (p, out) => out.fromArray(toRing(p[0], p[1], p[2])) : undefined);
  root.updateMatrixWorld(true);
  return { pool, gated, racks };
}

/** The longest a bent face runs along z (m): the strips it is cut into follow the ring's curve to 1 mm at 500 m. */
const BEND_STEP = 2;

/** Boxes merged into one geometry: positions in the level frame, axis-aligned normals, and each box's zone's ceiling
 *  height (`ceilH`, the walls' contact shade under it); the same flat position and normal again as `lpos`, `lnor` (what
 *  the materials read). `bend`: positions and normals mapped onto the ring (shared/ring.ts), faces cut along z first. */
export function boxGeometry(list: readonly { b: readonly number[]; zone: string }[], ceilings: Record<string, number>, bend = false): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], lpos: number[] = [], lnor: number[] = [], ceil: number[] = [], idx: number[] = [];
  const p3 = [0, 0, 0], n3 = [0, 0, 0];
  const vertex = (x: number, y: number, z: number, n: number[], ch: number) => {
    lpos.push(x, y, z);
    lnor.push(n[0], n[1], n[2]);
    ceil.push(ch);
    if (!bend) {
      pos.push(x, y, z);
      nor.push(n[0], n[1], n[2]);
      return;
    }
    toRing(x, y, z, p3);
    dirToRing(n[0], n[1], n[2], z, n3);
    pos.push(p3[0], p3[1], p3[2]);
    nor.push(n3[0], n3[1], n3[2]);
  };
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
    const xs = [b[0], b[1]], ys = [b[2], b[3]], zs = [b[4], b[5]], ch = ceilings[zone];
    const strips = bend ? Math.max(1, Math.ceil((b[5] - b[4]) / BEND_STEP)) : 1;
    for (const [n, corners] of FACES) {
      const c = corners.map((k) => [xs[k[0]], ys[k[1]], zs[k[2]]]);
      // The quad's two edges along z (a ±z face has none: one strip): 0→3 and 1→2, or 0→1 and 3→2.
      const along = c[0][2] !== c[3][2] ? [[0, 3], [1, 2]] : c[0][2] !== c[1][2] ? [[0, 1], [3, 2]] : null;
      const n_ = along ? strips : 1;
      for (let k = 0; k < n_; k++) {
        const base = lpos.length / 3;
        let q = c;
        if (along) {
          const lerp = (e: number[], t: number) => c[e[0]].map((v, i) => v + (c[e[1]][i] - v) * t);
          const [e0, e1] = along, t0 = k / n_, t1 = (k + 1) / n_;
          const a0 = lerp(e0, t0), a1 = lerp(e0, t1), b0 = lerp(e1, t0), b1 = lerp(e1, t1);
          // Back in the corners' order: the edge's start at its corner, its end at the one it runs to.
          q = [];
          q[e0[0]] = a0; q[e0[1]] = a1; q[e1[0]] = b0; q[e1[1]] = b1;
        }
        for (const v of q) vertex(v[0], v[1], v[2], n, ch);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('lpos', new THREE.Float32BufferAttribute(lpos, 3));
  g.setAttribute('lnor', new THREE.Float32BufferAttribute(lnor, 3));
  g.setAttribute('ceilH', new THREE.Float32BufferAttribute(ceil, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export type { BakeMaps };
