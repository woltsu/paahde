// Baked maps for a box-built level (docs/levels/datacenter.md "Baked AO and light map"), computed on the client when the
// stage is built, deterministic, no downloads:
// - bake (RGBA half float, linear, 0.1 m over the bounds): r floor contact AO (the footprints of the boxes standing on the
//   floor, blurred), g ceiling contact AO (the boxes touching the ceiling), b far light (diffuse light on the floor from
//   every point fixture inside its range, blocked by what stands between: what the light pool doesn't light any more)
// - tiles (one byte per 0.6 m floor tile, nearest): 255 (1 to the shader) where a tile is perforated (the cold aisles).
import * as THREE from 'three/webgpu';
import type { LevelLayout as Layout } from '../../../shared/levels/datacenter.ts';

export const TEXEL = 0.1;
export const TILE = 0.6;

export type BakeData = { nx: number; nz: number; x0: number; z0: number; ao: Float32Array; ceil: Float32Array; far: Float32Array; tiles: Uint8Array; tnx: number; tnz: number };

/** The maps as numbers (pure: tools can check them in Node). */
export function bakeData(L: Layout<string>): BakeData {
  const steps = bakeSteps(L);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** The same, giving the page a turn every few ms (built ahead while walking up to the door: no 60 ms frame). */
export async function bakeDataSliced(L: Layout<string>, budgetMs = 4): Promise<BakeData> {
  const steps = bakeSteps(L);
  let since = performance.now();
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    if (performance.now() - since > budgetMs) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      since = performance.now();
    }
  }
}

/** The work, in steps (each yield is a place to pause). */
function* bakeSteps(L: Layout<string>): Generator<void, BakeData> {
  const [x0, x1, , , z0, z1] = L.bounds;
  const nx = Math.ceil((x1 - x0) / TEXEL), nz = Math.ceil((z1 - z0) / TEXEL);
  const solid = L.boxes.filter((b) => b.use !== 'draw');
  const raster = (pick: (b: (typeof solid)[number]) => boolean) => {
    const m = new Float32Array(nx * nz);
    for (const s of solid) {
      if (!pick(s)) continue;
      const b = s.b;
      const ia = Math.max(0, Math.floor((b[0] - x0) / TEXEL)), ib = Math.min(nx - 1, Math.ceil((b[1] - x0) / TEXEL) - 1);
      const ja = Math.max(0, Math.floor((b[4] - z0) / TEXEL)), jb = Math.min(nz - 1, Math.ceil((b[5] - z0) / TEXEL) - 1);
      for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) m[j * nx + i] = 1;
    }
    return m;
  };
  // Floor AO: whatever stands on the floor (not the floor slabs themselves), blurred twice ~0.35 m.
  const standing = raster((s) => s.b[2] <= 0.05 && s.b[3] > 0.3 && s.mat !== 'floor');
  yield;
  blur(standing, nx, nz, 3);
  yield;
  blur(standing, nx, nz, 3);
  yield;
  const ao = standing.map((v) => 1 - 0.5 * v);
  // Ceiling AO: the walls and beams meeting it.
  const hanging = raster((s) => (s.mat === 'wall' || (s.mat === 'ceiling' && s.b[3] - s.b[2] < 1 && s.b[2] > 3.5 && s.b[2] < 4.1)));
  blur(hanging, nx, nz, 3);
  yield;
  blur(hanging, nx, nz, 3);
  yield;
  const ceil = hanging.map((v) => 1 - 0.55 * v);

  // Heights of what stands, for the far light's shadow test: the tallest solid top per texel below 3 m (not the ceilings).
  const tall = new Float32Array(nx * nz);
  for (const { b } of solid) {
    if (b[2] > 0.05 || b[3] <= 0.05) continue;
    const top = Math.min(b[3], 3.6);
    const ia = Math.max(0, Math.floor((b[0] - x0) / TEXEL)), ib = Math.min(nx - 1, Math.ceil((b[1] - x0) / TEXEL) - 1);
    const ja = Math.max(0, Math.floor((b[4] - z0) / TEXEL)), jb = Math.min(nz - 1, Math.ceil((b[5] - z0) / TEXEL) - 1);
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) tall[j * nx + i] = Math.max(tall[j * nx + i], top);
  }
  const far = new Float32Array(nx * nz);
  const STEP = 0.35;
  for (const f of L.fixtures) {
    if (f.kind !== 'point' || f.role !== 'main') continue;
    yield;
    const [fx, fy, fz] = f.pos, R = f.range;
    const ia = Math.max(0, Math.floor((fx - R - x0) / TEXEL)), ib = Math.min(nx - 1, Math.ceil((fx + R - x0) / TEXEL));
    const ja = Math.max(0, Math.floor((fz - R - z0) / TEXEL)), jb = Math.min(nz - 1, Math.ceil((fz + R - z0) / TEXEL));
    for (let j = ja; j <= jb; j++) {
      for (let i = ia; i <= ib; i++) {
        const k = j * nx + i;
        if (tall[k] > 0.05) continue; // under something standing: never seen
        const x = x0 + (i + 0.5) * TEXEL, z = z0 + (j + 0.5) * TEXEL;
        const dx = x - fx, dz = z - fz, h = Math.hypot(dx, dz), d = Math.hypot(h, fy);
        if (d >= R) continue;
        // three's range window, cos at the floor, distance decay.
        const win = Math.max(0, 1 - (d / R) ** 4) ** 2;
        let lit = (f.intensity * (fy / d) * win) / Math.max(d, 0.5) ** f.decay;
        // March from the floor towards the fixture: blocked where something stands above the sightline.
        for (let t = STEP; t < h; t += STEP) {
          const sx = x - (dx / h) * t, sz = z - (dz / h) * t;
          const si = Math.floor((sx - x0) / TEXEL), sj = Math.floor((sz - z0) / TEXEL);
          if (si < 0 || sj < 0 || si >= nx || sj >= nz) break;
          if (tall[sj * nx + si] > (fy * t) / h) { lit = 0; break; }
        }
        far[k] += lit;
      }
    }
  }
  let max = 0;
  for (const v of far) max = Math.max(max, v);
  if (max > 0) for (let k = 0; k < far.length; k++) far[k] /= max;

  // Perforated tiles: the cold aisles' (z between two rows whose fronts face each other), not the cross aisle.
  const tnx = Math.ceil((x1 - x0) / TILE), tnz = Math.ceil((z1 - z0) / TILE);
  const tiles = new Uint8Array(tnx * tnz);
  const rows = L.boxes.filter((b) => b.mat === 'rack').map((b) => b.b);
  const fronts = new Map<number, number>(); // row z0 → the face, from the racks
  for (const r of L.racks) fronts.set(Math.round((r.z - 0.6) * 10), r.face);
  for (let j = 0; j < tnz; j++) {
    for (let i = 0; i < tnx; i++) {
      const x = x0 + (i + 0.5) * TILE, z = z0 + (j + 0.5) * TILE;
      if (Math.abs(x) < 1.2 || Math.abs(x) > 9.6) continue;
      // Between a row facing +z (south of it) and one facing -z (north of it).
      const south = rows.find((b) => b[5] <= z && z - b[5] < 1.85 && fronts.get(Math.round(b[4] * 10)) === 1);
      const north = rows.find((b) => b[4] >= z && b[4] - z < 1.85 && fronts.get(Math.round(b[4] * 10)) === -1);
      if (south && north) tiles[j * tnx + i] = 255; // (normalised: the shader reads 1)
    }
  }
  return { nx, nz, x0, z0, ao, ceil, far, tiles, tnx, tnz };
}

/** Separable box blur of radius r texels, in place. */
function blur(m: Float32Array, nx: number, nz: number, r: number) {
  const tmp = new Float32Array(m.length);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const a = i + k; if (a >= 0 && a < nx) { s += m[j * nx + a]; n++; } }
      tmp[j * nx + i] = s / n;
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const b = j + k; if (b >= 0 && b < nz) { s += tmp[b * nx + i]; n++; } }
      m[j * nx + i] = s / n;
    }
  }
}

export type BakeMaps = { bake: THREE.DataTexture; tiles: THREE.DataTexture; min: THREE.Vector2; size: THREE.Vector2; tileSize: THREE.Vector2 };

/** The maps as textures, sampled at (xz - min) / size. */
export function bakeMaps(L: Layout<string>, d: BakeData = bakeData(L)): BakeMaps {
  const rgba = new Uint16Array(d.nx * d.nz * 4);
  for (let k = 0; k < d.nx * d.nz; k++) {
    rgba[k * 4] = THREE.DataUtils.toHalfFloat(d.ao[k]);
    rgba[k * 4 + 1] = THREE.DataUtils.toHalfFloat(d.ceil[k]);
    rgba[k * 4 + 2] = THREE.DataUtils.toHalfFloat(d.far[k]);
    rgba[k * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const bake = new THREE.DataTexture(rgba, d.nx, d.nz, THREE.RGBAFormat, THREE.HalfFloatType);
  bake.minFilter = bake.magFilter = THREE.LinearFilter;
  bake.wrapS = bake.wrapT = THREE.ClampToEdgeWrapping;
  bake.needsUpdate = true;
  const tiles = new THREE.DataTexture(d.tiles, d.tnx, d.tnz, THREE.RedFormat, THREE.UnsignedByteType);
  tiles.minFilter = tiles.magFilter = THREE.NearestFilter;
  tiles.needsUpdate = true;
  return {
    bake, tiles,
    min: new THREE.Vector2(d.x0, d.z0),
    size: new THREE.Vector2(d.nx * TEXEL, d.nz * TEXEL),
    tileSize: new THREE.Vector2(d.tnx * TILE, d.tnz * TILE),
  };
}
