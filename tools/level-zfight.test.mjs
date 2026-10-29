// Z-fighting in the box-built levels (docs/levels.md "Z-fighting"): two drawn boxes whose faces lie in one plane, facing
// the same way and overlapping, flicker (the depth buffer can't tell them apart: bunk posts flush with the bed's side,
// a blanket ending where the bed ends, stripes flush with the door's edge). Faces that meet back to back (a box standing
// on another, a box against a wall) are fine: one of the two is always culled. A face hidden inside another drawn box
// (in a wall, under the floor) or facing out of the rooms (the shell's outside) is fine too.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../shared/levels.ts'; // (first: the registry's import order)
import { BEGINNING } from '../shared/levels/beginning.ts';
import { DATACENTER } from '../shared/levels/datacenter.ts';

/** Same plane closer than this (m) counts as one plane: at a few metres the depth buffer can't split them either. */
const PLANE = 0.001;
/** An overlap thinner than this (m) is an edge touching, not a shared area. */
const AREA = 0.002;

/** What a layout draws as boxes: its drawn boxes (gated ones too: their stage draws them) and its racks (instanced
 *  0.6 × 2.0 × 1.2 m, front along z: src/levels/boxLevel.ts). */
function drawnBoxes(L) {
  const out = [];
  L.boxes.forEach((b, i) => { if (b.use !== 'collide') out.push({ b: b.b, what: `${b.mat} #${i} [${b.b.map((v) => +v.toFixed(3)).join(', ')}]` }); });
  for (const r of L.racks) out.push({ b: [r.x - 0.3, r.x + 0.3, 0, 2, r.z - 0.6, r.z + 0.6], what: `rack at ${r.x.toFixed(2)}, ${r.z.toFixed(2)}` });
  return out;
}

const inside = (b, p) => p[0] > b[0] && p[0] < b[1] && p[1] > b[2] && p[1] < b[3] && p[2] > b[4] && p[2] < b[5];

const within = (b, p) => p[0] >= b[0] && p[0] <= b[1] && p[1] >= b[2] && p[1] <= b[3] && p[2] >= b[4] && p[2] <= b[5];

/** Pairs of same-facing coplanar faces that overlap where you can see them. */
export function zFights(L) {
  const boxes = drawnBoxes(L), found = [];
  // Where a camera can be: the zones (the rooms' interiors). Outside them (the shell's outer faces) nothing is seen.
  const air = Object.values(L.zones);
  for (let a = 0; a < boxes.length; a++) {
    for (let c = a + 1; c < boxes.length; c++) {
      const A = boxes[a].b, C = boxes[c].b;
      for (let axis = 0; axis < 3; axis++) {
        for (const side of [0, 1]) {
          if (Math.abs(A[axis * 2 + side] - C[axis * 2 + side]) > PLANE) continue;
          // The overlap of the two faces on the other two axes.
          const [u, v] = [0, 1, 2].filter((k) => k !== axis);
          const u0 = Math.max(A[u * 2], C[u * 2]), u1 = Math.min(A[u * 2 + 1], C[u * 2 + 1]);
          const v0 = Math.max(A[v * 2], C[v * 2]), v1 = Math.min(A[v * 2 + 1], C[v * 2 + 1]);
          if (u1 - u0 < AREA || v1 - v0 < AREA) continue;
          // Seen from in front of it at its middle, or is that inside something else drawn?
          const p = [0, 0, 0];
          p[axis] = A[axis * 2 + side] + (side ? 1 : -1) * 0.003;
          p[u] = (u0 + u1) / 2;
          p[v] = (v0 + v1) / 2;
          if (!air.some((z) => within(z, p)) || boxes.some((o, k) => k !== a && k !== c && inside(o.b, p))) continue;
          found.push(`${boxes[a].what} and ${boxes[c].what}: ${'xyz'[axis]}${side ? '+' : '-'} faces at ${A[axis * 2 + side].toFixed(3)}`);
        }
      }
    }
  }
  return found;
}

for (const [name, L] of [['the beginning', BEGINNING], ['the datacenter', DATACENTER]]) {
  test(`${name}: no two drawn boxes share a face plane facing the same way`, () => {
    const f = zFights(L);
    assert.deepEqual(f, [], `${f.length} z-fighting face pairs:\n${f.join('\n')}`);
  });
}
