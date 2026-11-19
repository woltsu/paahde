// Put a binary STL (Z up, mm: tools/models/stl.mjs) on a cylindrical stand, for printing:
//   node tools/models/stand.mjs <in.stl> [out.stl=<in>-stand.stl] [margin=0.15] [height]
// The stand is centred under the footprint (whatever is within FOOT mm of the lowest point: the soles, the wheels;
// not a rifle held out in front), its radius the footprint's plus `margin` of it plus RIM mm, and `height` mm
// thick (default 4% of the model's height, at least 4 mm). Its top is SINK mm above the lowest point, so the model
// stands sunk into it and the two print as one.
import { readFileSync, writeFileSync } from 'node:fs';

const FOOT = 50, RIM = 10, SINK = 2, SEGMENTS = 128;
const [inp, out = inp?.replace(/\.stl$/i, '') + '-stand.stl', margin = '0.15', height] = process.argv.slice(2);
if (!inp) throw new Error('usage: node tools/models/stand.mjs <in.stl> [out.stl] [margin] [height]');

const src = readFileSync(inp);
const n = src.readUInt32LE(80);
if (src.length !== 84 + 50 * n) throw new Error(`${inp}: not a binary STL`);
const vert = (t, k, c) => src.readFloatLE(84 + 50 * t + 12 + k * 12 + c * 4);

let zMin = Infinity, zMax = -Infinity;
for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
  const z = vert(t, k, 2);
  zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
}
// The footprint: its box gives the centre, its farthest point from that the radius.
const foot = [];
for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) if (vert(t, k, 2) < zMin + FOOT) foot.push([vert(t, k, 0), vert(t, k, 1)]);
const cx = (Math.min(...foot.map((p) => p[0])) + Math.max(...foot.map((p) => p[0]))) / 2;
const cy = (Math.min(...foot.map((p) => p[1])) + Math.max(...foot.map((p) => p[1]))) / 2;
const reach = Math.max(...foot.map(([x, y]) => Math.hypot(x - cx, y - cy)));
const r = reach * (1 + Number(margin)) + RIM;
const h = height ? Number(height) : Math.max(4, 0.04 * (zMax - zMin));
const top = zMin + SINK, bottom = top - h;

// The cylinder: a fan on top and bottom, a quad strip round the side (outward normals, counter-clockwise).
const tris = [];
const ring = (i, z) => [cx + r * Math.cos((2 * Math.PI * i) / SEGMENTS), cy + r * Math.sin((2 * Math.PI * i) / SEGMENTS), z];
for (let i = 0; i < SEGMENTS; i++) {
  const [a0, a1, b0, b1] = [ring(i, top), ring(i + 1, top), ring(i, bottom), ring(i + 1, bottom)];
  tris.push([[cx, cy, top], a0, a1], [[cx, cy, bottom], b1, b0], [b0, b1, a1], [b0, a1, a0]);
}

const buf = Buffer.alloc(84 + 50 * (n + tris.length));
src.copy(buf, 0, 0, 84 + 50 * n);
buf.writeUInt32LE(n + tris.length, 80);
tris.forEach(([a, b, c], j) => {
  const u = b.map((x, i) => x - a[i]), v = c.map((x, i) => x - a[i]);
  const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...nrm) || 1;
  const off = 84 + 50 * (n + j);
  [nrm.map((x) => x / len), a, b, c].forEach((p, k) => p.forEach((x, i) => buf.writeFloatLE(x, off + k * 12 + i * 4)));
});
writeFileSync(out, buf);
console.log(`${out}: stand ⌀${(2 * r).toFixed(0)} × ${h.toFixed(1)} mm under (${cx.toFixed(0)}, ${cy.toFixed(0)}), top at z ${top.toFixed(1)}`);
