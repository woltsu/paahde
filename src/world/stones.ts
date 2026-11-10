// Loose stones: draws the pebbles, cobbles, boulders and fallen blocks that shared/stones.ts lays out (and the sim
// collides with). The meshes are made here, a few variants per shape (STONE_SHAPES), from a seeded noise so every
// client draws the same stones: an icosphere pushed into the shape's profile (a dome; a rounded block; a slab),
// lumped by noise and cut flat by a few planes for the faces it broke along, its foot squashed into a skirt that sinks
// into the sand. Unit size: radius 1 across, 1 tall; each instance is scaled to its stone's radii and height.
//
// Coloured by the terrain's own rock uniforms (src/world/sandMaterial.ts `sand.rockDark`, `rockLight`, `varnish`), so
// they follow the look tuner: paler and darker sandstone mottling, the desert varnish dark on their tops and sides
// (where the sun and dew have worked on them), darker towards the sand where they meet it. Each stone gets its own tint.
//
// Two sets of instanced meshes: the small stones (drawn out to SMALL_CELLS, shadow only in the nearest cascade) and
// the big ones (out to BIG_CELLS, in the first three). Rebuilt when the player crosses into another cell, the ground
// under them is dug, or more cells' stones have been laid out; cells are laid out a few per frame (GEN_PER_FRAME) so
// riding fast doesn't hitch.
import * as THREE from 'three/webgpu';
import { attribute, mix } from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { cellKey } from '../../shared/cellCache.ts';
import { mulberry32 } from '../../shared/noise.ts';
import { BLOCK, ROUND, SLAB, STONE_CELL, STONE_SHAPES, stoneFoot, stonesIn, type Stone } from '../../shared/stones.ts';
import { EDIT_CELL, EDIT_CHUNK, edits } from '../../shared/terrain.ts';
import { sand } from './sandMaterial.ts';
import { lodLayer, SHADOW_LOD_FIRST } from './shadowLod.ts';

/** Cells drawn round the player's in each direction: small stones (~110 m), big ones (~240 m). */
const SMALL_CELLS = 3, BIG_CELLS = 7;
/** A stone this wide (m, its long radius) or more is big. */
const BIG_R = 0.55;
/** Cells laid out per frame at most (each ~0.3 ms). */
const GEN_PER_FRAME = 3;
const SMALL_CAP = 4096, BIG_CAP = 2048;

// --- Meshes ---------------------------------------------------------------------------------------

/** Seeded 3D value noise (client only: a mesh's looks needn't agree bit for bit across engines). */
function noise3(rand: () => number) {
  const P = new Float32Array(512);
  for (let i = 0; i < 512; i++) P[i] = rand();
  const h = (x: number, y: number, z: number) => P[((x * 73) ^ (y * 151) ^ (z * 283)) & 511];
  const f = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number, z: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = f(x - ix), fy = f(y - iy), fz = f(z - iz);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(h(ix, iy, iz), h(ix + 1, iy, iz), fx), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), fx), fy),
      l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), fx), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), fx), fy), fz);
  };
}

/** A unit stone of `profile`, variant `v`: radius 1 in x and z (x its long axis), 1 tall above y = 0, a skirt below. */
function stoneGeometry(profile: number, v: number): THREE.BufferGeometry {
  const rand = mulberry32(0x5703e + profile * 7919 + v * 104729);
  const n = noise3(rand);
  const round = profile === ROUND;
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, round ? 4 : 3);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  // Planes it broke along: a few facets on a boulder, many on a block, mostly the edges of a slab.
  const cuts: [number, number, number, number][] = [];
  const m = round ? 1 + Math.floor(rand() * 3) : profile === BLOCK ? 6 + Math.floor(rand() * 4) : 4 + Math.floor(rand() * 3);
  for (let i = 0; i < m; i++) {
    const a = rand() * Math.PI * 2;
    const up = profile === SLAB ? (rand() - 0.5) * 0.5 : (rand() - 0.25) * 1.4;
    const l = Math.hypot(1, up);
    cuts.push([Math.cos(a) / l, up / l, Math.sin(a) / l, round ? 0.82 + 0.1 * rand() : 0.68 + 0.2 * rand()]);
  }
  const e = profile === BLOCK ? 0.55 : profile === SLAB ? 0.45 : 1; // rounded box: |p|^e per axis
  const amp = round ? 0.16 : 0.08;
  const p = geo.attributes.position as THREE.BufferAttribute;
  const q = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    q.set(p.getX(i), p.getY(i), p.getZ(i));
    if (e !== 1) q.set(Math.sign(q.x) * Math.abs(q.x) ** e, Math.sign(q.y) * Math.abs(q.y) ** e, Math.sign(q.z) * Math.abs(q.z) ** e);
    // Lumps: two octaves, coarse and fine.
    const w = n(q.x * 1.6 + 3, q.y * 1.6, q.z * 1.6) * 0.7 + n(q.x * 4.3, q.y * 4.3 + 7, q.z * 4.3) * 0.3;
    q.multiplyScalar(1 + amp * (2 * w - 1));
    for (const [cx, cy, cz, d] of cuts) {
      const s = q.x * cx + q.y * cy + q.z * cz - d;
      if (s > 0) q.set(q.x - s * cx, q.y - s * cy, q.z - s * cz);
    }
    if (q.y < 0) q.y *= 0.45; // the foot: a shallow skirt into the sand
    p.setXYZ(i, q.x, q.y, q.z);
  }
  // Normalise: radius 1 across (the hitbox's ellipse, shared/stones.ts), 1 tall.
  let rMax = 0, yMax = 0;
  for (let i = 0; i < p.count; i++) {
    rMax = Math.max(rMax, Math.hypot(p.getX(i), p.getZ(i)));
    yMax = Math.max(yMax, p.getY(i));
  }
  geo.scale(1 / rMax, 1 / yMax, 1 / rMax);
  // Faceted stones get hard edges; boulders stay smooth.
  if (!round) geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  // Per vertex: x paler/darker sandstone, y desert varnish, z darkening at its foot (where it meets the sand).
  const pos = geo.attributes.position as THREE.BufferAttribute, nor = geo.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const mottle = n(x * 3.1 + 11, y * 3.1, z * 3.1) * 0.6 + n(x * 9 + 5, y * 9, z * 9 + 2) * 0.4;
    const varnish = Math.max(0, Math.min(1, (nor.getY(i) + 0.2) * 0.8)) * (0.25 + 0.5 * n(x * 2 + 9, y * 5, z * 2));
    const foot = 0.45 + 0.55 * Math.max(0, Math.min(1, (y + 0.05) / 0.35));
    col.set([0.2 + 0.65 * mottle, varnish, foot], i * 3);
  }
  geo.setAttribute('stone', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

function stoneMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const s = attribute('stone', 'vec3');
  const c3 = (u: unknown) => u as THREE.Node<'vec3'>; // (the colour uniforms, as vec3s)
  const rock = mix(c3(sand.rockDark), c3(sand.rockLight), s.x);
  m.colorNode = mix(rock, c3(sand.varnish), s.y).mul(s.z);
  return m;
}

// --- Drawing -------------------------------------------------------------------------------------

type Batch = { mesh: THREE.InstancedMesh; count: number; cap: number };

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

export class Stones {
  private group = new THREE.Group();
  /** Per STONE_SHAPES index, per variant: the small batch and the big batch. */
  private small: Batch[][] = [];
  private big: Batch[][] = [];
  private cellX = NaN;
  private cellZ = NaN;
  private dirty = true;
  /** Cells already laid out (stonesIn caches them; this is only so a frame lays out a few at most). */
  private known = new Set<number>();

  constructor(scene: THREE.Object3D) {
    scene.add(this.group);
    const material = stoneMaterial();
    STONE_SHAPES.forEach((K, k) => {
      this.small[k] = [];
      this.big[k] = [];
      for (let v = 0; v < K.variants; v++) {
        const geo = stoneGeometry(K.profile, v);
        this.small[k][v] = this.batch(geo, material, SMALL_CAP, false);
        this.big[k][v] = this.batch(geo, material, BIG_CAP, true);
      }
    });
    const prev = edits.onChange;
    edits.onChange = (cx, cz) => {
      prev?.(cx, cz);
      // Re-seat stones only if the edited chunk is within the drawn area.
      const span = EDIT_CHUNK * EDIT_CELL;
      const mx = Math.floor(((cx + 0.5) * span) / STONE_CELL), mz = Math.floor(((cz + 0.5) * span) / STONE_CELL);
      if (Math.abs(mx - this.cellX) <= BIG_CELLS + 1 && Math.abs(mz - this.cellZ) <= BIG_CELLS + 1) this.dirty = true;
    };
  }

  private batch(geo: THREE.BufferGeometry, material: THREE.Material, cap: number, big: boolean): Batch {
    const mesh = new THREE.InstancedMesh(geo, material, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    // Shadows (src/world/shadowLod.ts): the small ones only in the nearest cascade, the big in the next two as well.
    mesh.userData.lodBig = true;
    if (big) for (let i = SHADOW_LOD_FIRST; i < 3; i++) mesh.layers.enable(lodLayer(i));
    this.group.add(mesh);
    return { mesh, count: 0, cap };
  }

  /** Called every frame with the local player's position. */
  update(focus: THREE.Vector3) {
    const cx = Math.floor(focus.x / STONE_CELL), cz = Math.floor(focus.z / STONE_CELL);
    if (cx !== this.cellX || cz !== this.cellZ) {
      this.cellX = cx;
      this.cellZ = cz;
      this.dirty = true;
      if (this.known.size > 20000) this.known.clear();
    }
    // Lay out a few more cells in view, nearest first (rings out from the player's).
    let budget = GEN_PER_FRAME;
    for (let d = 0; d <= BIG_CELLS && budget > 0; d++) {
      for (let iz = cz - d; iz <= cz + d && budget > 0; iz++) {
        for (let ix = cx - d; ix <= cx + d && budget > 0; ix++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== d) continue;
          const k = cellKey(ix, iz);
          if (this.known.has(k)) continue;
          stonesIn(ix, iz);
          this.known.add(k);
          budget--;
          this.dirty = true;
        }
      }
    }
    if (!this.dirty) return;
    this.dirty = false;
    for (const l of [this.small, this.big]) for (const bs of l) for (const b of bs) b.count = 0;
    for (let iz = cz - BIG_CELLS; iz <= cz + BIG_CELLS; iz++) {
      for (let ix = cx - BIG_CELLS; ix <= cx + BIG_CELLS; ix++) {
        if (!this.known.has(cellKey(ix, iz))) continue;
        const near = Math.abs(ix - cx) <= SMALL_CELLS && Math.abs(iz - cz) <= SMALL_CELLS;
        for (const st of stonesIn(ix, iz)) {
          if (st.rx >= BIG_R) this.place(this.big[st.shape][st.variant], st);
          else if (near) this.place(this.small[st.shape][st.variant], st);
        }
      }
    }
    for (const l of [this.small, this.big]) for (const bs of l) for (const b of bs) {
      b.mesh.count = b.count;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.instanceColor!.needsUpdate = true;
      b.mesh.computeBoundingSphere(); // for frustum culling of the whole batch
    }
  }

  private place(b: Batch, st: Stone) {
    if (b.count >= b.cap) return;
    // Local +X (its long axis) to (ax, az).
    _q.setFromAxisAngle(_up, Math.atan2(-st.az, st.ax));
    _p.set(st.x, stoneFoot(st), st.z);
    _m.compose(_p, _q, _s.set(st.rx, st.h, st.rz));
    b.mesh.setMatrixAt(b.count, _m);
    // Its own tint: lighter or darker, a little redder or greyer.
    const l = 0.82 + 0.36 * st.tint, w = (st.tint * 7.3) % 1;
    b.mesh.setColorAt(b.count, _c.setRGB(l * (1.02 + 0.06 * w), l, l * (0.98 - 0.08 * w)));
    b.count++;
  }
}
