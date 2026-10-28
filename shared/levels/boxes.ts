// Box collision for levels built of axis-aligned boxes (docs/levels.md "Collision cost", docs/levels/datacenter.md
// "Collision"): floors and low things are stood on, tall ones push a mover's circle out, and the undersides of slabs,
// beams and lintels are the ceiling. The boxes sit in a uniform xz grid built once from the layout; a query tests only
// the cells under the mover's circle. Deterministic (plain arithmetic, a fixed order): it runs in shared/sim.ts on the
// client and the server alike. Node type stripping rules; no three.js.
import type { Box, Mover } from '../levels.ts';

/** Uniform grid over the boxes' xz footprints: cell i lists the indices of the boxes overlapping it. */
export type BoxGrid = {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  cells: Int32Array[];
  boxes: readonly Box[];
  /** Per box, the last query that met it (dedupes boxes spanning several cells without a Set). */
  stamp: Int32Array;
  query: number;
};

/** Bucket `boxes` by the `cell`-sized squares their footprints overlap. */
export function boxGrid(boxes: readonly Box[], cell = 2): BoxGrid {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b[0]); x1 = Math.max(x1, b[1]);
    z0 = Math.min(z0, b[4]); z1 = Math.max(z1, b[5]);
  }
  if (!boxes.length) x0 = x1 = z0 = z1 = 0;
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  const lists: number[][] = Array.from({ length: nx * nz }, () => []);
  boxes.forEach((b, i) => {
    const ia = clampI(Math.floor((b[0] - x0) / cell), nx), ib = clampI(Math.floor((b[1] - x0) / cell), nx);
    const ja = clampI(Math.floor((b[4] - z0) / cell), nz), jb = clampI(Math.floor((b[5] - z0) / cell), nz);
    for (let j = ja; j <= jb; j++) for (let k = ia; k <= ib; k++) lists[j * nx + k].push(i);
  });
  return { x0, z0, cell, nx, nz, cells: lists.map((l) => Int32Array.from(l)), boxes, stamp: new Int32Array(boxes.length), query: 0 };
}

const clampI = (i: number, n: number) => (i < 0 ? 0 : i >= n ? n - 1 : i);

/** Indices of the boxes that may touch a circle of radius r at (x, z), into `out` (cleared first). */
export function boxesNear(g: BoxGrid, x: number, z: number, r: number, out: number[]): number[] {
  out.length = 0;
  const q = ++g.query;
  const ia = clampI(Math.floor((x - r - g.x0) / g.cell), g.nx), ib = clampI(Math.floor((x + r - g.x0) / g.cell), g.nx);
  const ja = clampI(Math.floor((z - r - g.z0) / g.cell), g.nz), jb = clampI(Math.floor((z + r - g.z0) / g.cell), g.nz);
  for (let j = ja; j <= jb; j++) {
    for (let k = ia; k <= ib; k++) {
      const list = g.cells[j * g.nx + k];
      for (let n = 0; n < list.length; n++) {
        const i = list[n];
        if (g.stamp[i] === q) continue;
        g.stamp[i] = q;
        out.push(i);
      }
    }
  }
  // Grid order depends on where the query starts; sort so the pushes always come in the same order.
  out.sort((a, b) => a - b);
  return out;
}

const near: number[] = [];
const SKIN = 1e-4;

/**
 * Push mover `c` (a circle of `radius`, feet at `y`, `height` tall) out of the tall boxes it overlaps, absorbing its
 * velocity into them; a box whose top is at most `stepUp` above the feet (now or a tick ago) is stood on instead.
 * Returns the highest such support top under the circle, or -Infinity.
 */
export function collideBoxes(g: BoxGrid, c: Mover, y: number, prevY: number, radius: number, height: number, stepUp: number): number {
  let support = -Infinity;
  const feet = Math.max(y, prevY);
  // Twice: pushed out of one box into a corner's other one, the second pass settles it.
  for (let pass = 0; pass < 2; pass++) {
    boxesNear(g, c.x, c.z, radius, near);
    for (let n = 0; n < near.length; n++) {
      const b = g.boxes[near[n]];
      if (b[3] <= y - 0.05 && pass === 1) continue; // under the feet: only the support pass needs it
      // Over the head (now, or a tick ago: a slab, beam or lintel the head comes up under is the ceiling's, not a wall to
      // be pushed out of sideways; ceilingBoxes stops the jump), or far under the feet.
      if (b[2] >= Math.min(y, prevY) + height - 0.05 || b[3] <= y - stepUp - 0.05) continue;
      // Nearest point of the footprint to the centre.
      const px = c.x < b[0] ? b[0] : c.x > b[1] ? b[1] : c.x;
      const pz = c.z < b[4] ? b[4] : c.z > b[5] ? b[5] : c.z;
      let ex = c.x - px, ez = c.z - pz;
      const d2 = ex * ex + ez * ez;
      if (d2 >= radius * radius) continue;
      if (b[3] <= feet + stepUp) {
        if (b[3] > support) support = b[3]; // low enough: stood on
        continue;
      }
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        ex /= d;
        ez /= d;
        c.x = px + ex * (radius + SKIN);
        c.z = pz + ez * (radius + SKIN);
      } else {
        // The centre is inside the footprint: out by the shortest way.
        const l = c.x - b[0], r = b[1] - c.x, f = c.z - b[4], k = b[5] - c.z;
        const m = Math.min(l, r, f, k);
        if (m === l) { ex = -1; ez = 0; c.x = b[0] - radius - SKIN; }
        else if (m === r) { ex = 1; ez = 0; c.x = b[1] + radius + SKIN; }
        else if (m === f) { ex = 0; ez = -1; c.z = b[4] - radius - SKIN; }
        else { ex = 0; ez = 1; c.z = b[5] + radius + SKIN; }
      }
      const vn = c.vx * ex + c.vz * ez;
      if (vn < 0) {
        c.vx -= vn * ex;
        c.vz -= vn * ez;
      }
    }
  }
  return support;
}

/** Lowest feet height under the boxes over a mover at (x, z) whose head was under them a tick ago (prevY): a box's
 *  underside minus the height. Infinity: nothing overhead. */
export function ceilingBoxes(g: BoxGrid, x: number, z: number, prevY: number, height: number, radius: number): number {
  let ceil = Infinity;
  boxesNear(g, x, z, radius, near);
  for (let n = 0; n < near.length; n++) {
    const b = g.boxes[near[n]];
    if (b[2] < prevY + height - 0.05) continue; // not over the head (a wall beside it, the floor)
    const px = x < b[0] ? b[0] : x > b[1] ? b[1] : x;
    const pz = z < b[4] ? b[4] : z > b[5] ? b[5] : z;
    if ((x - px) ** 2 + (z - pz) ** 2 >= radius * radius) continue;
    ceil = Math.min(ceil, b[2] - height);
  }
  return ceil;
}

/** The highest box top at or under feet that were at prevY (+ a step), right under the point (x, z); -Infinity if none. */
export function groundBoxes(g: BoxGrid, x: number, z: number, prevY: number, stepUp: number): number {
  let top = -Infinity;
  boxesNear(g, x, z, 0, near);
  for (let n = 0; n < near.length; n++) {
    const b = g.boxes[near[n]];
    if (x < b[0] || x > b[1] || z < b[4] || z > b[5] || b[3] > prevY + stepUp) continue;
    if (b[3] > top) top = b[3];
  }
  return top;
}
