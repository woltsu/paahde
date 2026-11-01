// Tarps (shared/tarp.ts, shared/placed.ts TARP): a patched sand-coloured canvas stretched as a diamond between two
// scavenged poles (a dark pipe, and a rusty one spliced from two lengths and lashed), its other corners pulled low to
// stakes, each pole held by two guy lines. Built here in code from the rig the server's shade uses, so what you see
// shading you is what cools you. Each tarp is three meshes: the canvas, the poles and stakes (vertex colours), the guy
// lines (no shadow: they're thinner than a shadow texel). Their materials are shared by every tarp; the geometry is
// each one's own (each stands on its own sand), a few hundred triangles.
//
// The canvas moves in the wind on the GPU: a 12×12 grid pushed in and out along its normal in the vertex shader by
// waves running downwind (env.ts windDir), pinned at its four corners, with a slow billow that breathes with the gusts.
// Taut, it moves less than a loose sheet would. How hard is `TARP_WIND`, the shared wind (shared/power.ts windSpeed,
// the windmills' wind: gusts, the day, storms), set every frame by src/world/placed.ts. The shading normal follows the
// waves (the surface's tangents, from the geometry, bent by the waves' slope), so the folds catch the low sun. The
// cloth's seams, patches and corner reinforcements are painted in the fragment shader from its uv.
import * as THREE from 'three/webgpu';
import { abs, attribute, color, cos, dot, faceDirection, Fn, float, max, min, mix, normalLocal, positionLocal, positionWorld, renderGroup, sin, smoothstep, step, uniform, uv, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasAt, edgeUV, skirtAt, tarpRig, type TarpRig, type Vec } from '../../shared/tarp.ts';
import { heightAt } from '../../shared/terrain.ts';
import { nightLevel, sunColor, time, windDir } from './env.ts';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;
/** Grid cells along each side of the canvas. */
const N = 12;
/** The wind on the tarps (m/s), shared/power.ts windSpeed. */
export const TARP_WIND = uniform(4);

/** Sun-bleached canvas, greyer than the sand, a dusty hem and seams; its patches (a bleached offcut, a darker sack); dark and rusty pipe poles;
 *  hemp-brown rope; rebar stakes. */
const CANVAS = 0xa88a66, HEM = 0x6b543e, PATCH_LIGHT = 0xc6b190, PATCH_DARK = 0x7f6145;
const POLE = 0x2e2824, RUST = 0x5a3524, CAP = 0x46403a, ROPE = 0x6b5843, STAKE = 0x3d342c;

/** A cart's canopy (style 'canopy'): one clean khaki canvas sewn from even panels, a bound hem, neat corner patches
 *  with a grommet at each tie (src/world/carts.ts). */
const CANOPY = 0x9c8c5c, CANOPY_SEAM = 0x7e7049, CANOPY_HEM = 0x564a30, CANOPY_PATCH = 0x8a7b4f, GROMMET = 0xb9b2a0;

const canvasMats: Partial<Record<CanvasStyle, THREE.MeshStandardNodeMaterial>> = {};
/** The nearest lit cart work lamps (src/world/carts.ts sets them every frame): each bulb's world position and how bright
 *  (0 off); a canopy's underside takes a little warm light from them, falling off with distance. */
export const canopyLamps = [0, 1].map(() => uniform(new THREE.Vector4()).setGroup(renderGroup));
const LAMP_GLOW = 0xffb066;
let rigMat: THREE.MeshStandardNodeMaterial | null = null;
let ropeMat: THREE.MeshStandardNodeMaterial | null = null;

// How free a canvas point is: 0 where it's tied (a corner), ~1 mid-way between them.
const free = Fn(([q]: [V2]) => smoothstep(0, 0.45, min(q, vec2(1).sub(q)).length()));
/** The waves alone (m) at local position p: two running downwind and a slow billow that breathes with the gusts. */
const waves = Fn(([p, seed]: [V3, F]) => {
  const v = TARP_WIND;
  const amp = min(float(0.012).add(v.mul(0.006)), 0.18);
  const speed = float(1.4).add(v.mul(0.16));
  const along = dot(p.xz, windDir);
  const across = dot(p.xz, vec2(windDir.y, windDir.x.negate()));
  const t = time.mul(speed);
  const w1 = sin(along.mul(1.3).sub(t.mul(2.1)).add(seed));
  const w2 = sin(along.mul(2.6).add(across.mul(1.1)).sub(t.mul(3.3)).add(seed.mul(1.7))).mul(0.45);
  const w3 = cos(across.mul(0.9).add(t.mul(0.6)).add(seed.mul(0.6))).mul(0.3);
  const bulge = min(v.mul(0.006), 0.1).mul(sin(time.mul(0.7).add(seed)));
  return amp.mul(w1.add(w2).add(w3)).add(bulge);
});
/** The canvas's lift (m, along its normal) at canvas point q (uv) and local position p, times `taut`. */
const canvasLift = (q: V2, p: V3, seed: F, taut: F) => (free(q) as F).mul(waves(p, seed) as F).mul(taut);

/** How a canvas is painted: the hand-made tarp's patched cloth, or a cart canopy's clean sewn one. */
export type CanvasStyle = 'tarp' | 'canopy';

/** The canvas material: the waves in the vertex shader (times the `taut` attribute: none while it's still being put
 *  up), the hem darker, the underside lit a little through the cloth. */
function canvasMaterial(style: CanvasStyle = 'tarp') {
  const had = canvasMats[style];
  if (had) return had;
  const m = new THREE.MeshStandardNodeMaterial({ color: style === 'canopy' ? CANOPY : CANVAS, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const seed = attribute('seed', 'float') as F;
  const taut = attribute('taut', 'float') as F;
  const tu = attribute('tanU', 'vec3') as V3, tv = attribute('tanV', 'vec3') as V3;
  const nrm = attribute('normal', 'vec3') as V3;
  const lift = (q: V2, p: V3) => canvasLift(q, p, seed, taut);
  m.positionNode = Fn(() => {
    const q = uv(), p = positionLocal;
    const e = 1 / N;
    const h = lift(q, p);
    // Out along the normal; the slope along each grid direction from a step there (the tangents are the step's length on
    // the canvas) bends the normal.
    const hu = lift(q.add(vec2(e, 0)), p.add(tu.mul(e))).sub(h);
    const hv = lift(q.add(vec2(0, e)), p.add(tv.mul(e))).sub(h);
    const du = tu.mul(e).add(nrm.mul(hu)), dv = tv.mul(e).add(nrm.mul(hv));
    normalLocal.assign(dv.cross(du).normalize());
    return p.add(nrm.mul(h));
  })();
  const q = uv();
  const edge = min(min(q.x, q.y), min(q.x.oneMinus(), q.y.oneMinus()));
  const corner = min(q, vec2(1).sub(q));
  if (style === 'canopy') {
    // Sewn from four even panels (straight seams across v, a fainter one down the middle), a bound hem round the edge, a
    // square reinforcement doubled over each corner with a metal grommet in it where the line ties on.
    const panel = abs(q.y.mul(4).sub(q.y.mul(4).add(0.5).floor())).div(4); // distance to the nearest quarter line
    const mid = abs(q.x.sub(0.5));
    let c: V3 = color(CANOPY) as unknown as V3;
    const cornerBox = max(corner.x, corner.y);
    c = mix(c, color(CANOPY_PATCH) as unknown as V3, step(cornerBox, 0.075));
    c = mix(c, color(CANOPY_SEAM) as unknown as V3, max(step(panel, 0.0035), step(mid, 0.0025).mul(0.6)));
    c = mix(c, color(CANOPY_HEM) as unknown as V3, smoothstep(0.016, 0.022, edge).oneMinus());
    const g = corner.sub(vec2(0.034)).length();
    c = mix(c, color(GROMMET) as unknown as V3, step(g, 0.016).mul(step(0.008, g)));
    c = mix(c, color(0x2a241a) as unknown as V3, step(g, 0.008));
    m.colorNode = c;
    const under = faceDirection.mul(-0.5).add(0.5);
    // The work lamps under it light the cloth over them: the underside, most right above a bulb, nothing past ~2.4 m.
    let lamp = float(0) as F;
    for (const l of canopyLamps) {
      const d = (l.xyz as unknown as V3).sub(positionWorld as unknown as V3);
      const r2 = dot(d, d);
      lamp = lamp.add((l.w as unknown as F).div(r2.mul(6).add(1)).mul(smoothstep(1, 5.8, r2).oneMinus())); // (gone by 2.4 m)
    }
    m.emissiveNode = (sunColor as unknown as V3).mul(c).mul(under.mul(0.1).add(0.015)).mul(max(float(1).sub(nightLevel), 0))
      .add(c.mul(color(LAMP_GLOW) as unknown as V3).mul(lamp.mul(under)));
    canvasMats[style] = m;
    return m;
  }
  // The cloth: stitched from three widths (seams across v), a hem round the edge, the corners doubled where the lines
  // pull, two patches sewn on (a bleached offcut, a darker bit of sack), their stitching darker.
  const seam = min(abs(q.y.sub(0.35)), abs(q.y.sub(0.67)));
  const patch = (x0: number, x1: number, y0: number, y1: number) => {
    const d = min(min(q.x.sub(x0), float(x1).sub(q.x)), min(q.y.sub(y0), float(y1).sub(q.y)));
    return [step(0, d), step(0, d).mul(step(d, 0.004))] as const;
  };
  const [p1, s1] = patch(0.2, 0.36, 0.5, 0.62), [p2, s2] = patch(0.62, 0.74, 0.16, 0.3);
  let c: V3 = color(CANVAS) as unknown as V3;
  c = mix(c, color(PATCH_LIGHT) as unknown as V3, p1);
  c = mix(c, color(PATCH_DARK) as unknown as V3, p2);
  const dark = max(max(s1, s2), max(step(seam, 0.003).mul(0.7), step(corner.x.add(corner.y), 0.13).mul(0.55)));
  c = mix(c, color(HEM) as unknown as V3, max(dark, smoothstep(0.012, 0.03, edge).oneMinus()));
  m.colorNode = c;
  // Underneath, the sun glows through the cloth (stronger by day, none at night); on top a touch of it.
  const under = faceDirection.mul(-0.5).add(0.5);
  m.emissiveNode = (sunColor as unknown as V3).mul(c).mul(under.mul(0.1).add(0.015)).mul(max(float(1).sub(nightLevel), 0));
  canvasMats[style] = m;
  return m;
}

let skirtMat: THREE.MeshStandardNodeMaterial | null = null;
let skirtRollMat: THREE.MeshStandardNodeMaterial | null = null;

/** A canopy's drop edges (shared/tarp.ts skirtAt): the canopy's khaki, a stitched line where each is sewn to the hem, a
 *  bound hem along the bottom and down the ends, the canvas's seams carried down it (its panel seams on the two edges
 *  they cross, the middle one on the others). In the wind each follows the hem it hangs from (the canvas's own lift
 *  there) and sways out and in, most at the bottom. uv: x along the edge, y down it (0 at the top). */
function skirtMaterial() {
  if (skirtMat) return skirtMat;
  const m = new THREE.MeshStandardNodeMaterial({ color: CANOPY, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const seed = attribute('seed', 'float') as F, taut = attribute('taut', 'float') as F, kind = attribute('kind', 'float') as F;
  const cuv = attribute('cuv', 'vec2') as V2, cnrm = attribute('cnrm', 'vec3') as V3, nrm = attribute('normal', 'vec3') as V3;
  const q = uv();
  m.positionNode = Fn(() => {
    const p = positionLocal;
    const hem = canvasLift(cuv, p, seed, taut);
    const sway = (waves(p, seed.add(1.3)) as F).mul(q.y).mul(1.3).mul(taut);
    return p.add(cnrm.mul(hem)).add(nrm.mul(sway));
  })();
  const quarter = abs(q.x.mul(4).sub(q.x.mul(4).add(0.5).floor())).div(4);
  const seam = mix(step(abs(q.x.sub(0.5)), 0.0025).mul(0.6), step(quarter, 0.0035), kind);
  let c: V3 = color(CANOPY) as unknown as V3;
  c = mix(c, color(CANOPY_SEAM) as unknown as V3, max(seam.mul(step(q.y, 0.86)), step(abs(q.y.sub(0.07)), 0.02).mul(0.8)));
  c = mix(c, color(CANOPY_HEM) as unknown as V3, max(step(0.86, q.y), step(min(q.x, q.x.oneMinus()), 0.005)));
  m.colorNode = c;
  const under = faceDirection.mul(-0.5).add(0.5);
  m.emissiveNode = (sunColor as unknown as V3).mul(c).mul(under.mul(0.1).add(0.015)).mul(max(float(1).sub(nightLevel), 0));
  return (skirtMat = m);
}

/** Cells along each drop edge. */
const SKIRT_N = 12;

/** A canopy's four drop edges as one grid (an edge after another, SKIRT_N cells along, one down), filled by fillSkirt. */
function skirtGeometry(seed: number): THREE.BufferGeometry {
  const n = SKIRT_N + 1, count = 4 * n * 2;
  const uvs = new Float32Array(count * 2), cuv = new Float32Array(count * 2), kind = new Float32Array(count);
  const idx: number[] = [];
  for (let e = 0; e < 4; e++) {
    for (let i = 0; i < n; i++) {
      const w = i / SKIRT_N, [u, v] = edgeUV(e, w);
      for (let k = 0; k < 2; k++) {
        const j = (e * n + i) * 2 + k;
        uvs.set([w, k], j * 2);
        cuv.set([u, v], j * 2);
        kind[j] = e & 1;
      }
      if (i < SKIRT_N) {
        const a = (e * n + i) * 2;
        idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('cnrm', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('cuv', new THREE.BufferAttribute(cuv, 2));
  g.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
  g.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(count).fill(seed), 1));
  g.setAttribute('taut', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
  g.setIndex(idx);
  return g;
}

/** Fill the drop edges from rig `r` (relative to `o`), `depth` deep: each column's top on the canvas's hem, its bottom
 *  straight under it; their normals level, out from the canopy's middle, and the canvas's (up) normal at each top (the
 *  wind moves them with the hem). */
function fillSkirt(g: THREE.BufferGeometry, r: TarpRig, o: Vec, depth: number) {
  const n = SKIRT_N + 1;
  const pos = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
  const nor = (g.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
  const cn = (g.getAttribute('cnrm') as THREE.BufferAttribute).array as Float32Array;
  const a: Vec = { x: 0, y: 0, z: 0 }, b: Vec = { x: 0, y: 0, z: 0 }, c: Vec = { x: 0, y: 0, z: 0 }, d: Vec = { x: 0, y: 0, z: 0 };
  const h = 1e-3;
  for (let e = 0; e < 4; e++) {
    for (let i = 0; i < n; i++) {
      const w = i / SKIRT_N, [u, v] = edgeUV(e, w);
      skirtAt(r, e, w, a);
      skirtAt(r, e, Math.min(1, w + h), b);
      skirtAt(r, e, Math.max(0, w - h), c);
      // Out, level: across the edge, away from the middle.
      let nx = b.z - c.z, nz = -(b.x - c.x);
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      if (nx * (a.x - r.cx) + nz * (a.z - r.cz) < 0) (nx = -nx), (nz = -nz);
      // The canvas's normal there, up.
      canvasAt(r, Math.min(1, u + h), v, b);
      canvasAt(r, Math.max(0, u - h), v, c);
      const ux = b.x - c.x, uy = b.y - c.y, uz = b.z - c.z;
      canvasAt(r, u, Math.min(1, v + h), d);
      canvasAt(r, u, Math.max(0, v - h), b);
      const vx = d.x - b.x, vy = d.y - b.y, vz = d.z - b.z;
      let cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const cl = Math.hypot(cx, cy, cz) || 1;
      if (cy < 0) (cx = -cx), (cy = -cy), (cz = -cz);
      for (let k = 0; k < 2; k++) {
        const j = ((e * n + i) * 2 + k) * 3;
        pos.set([a.x - o.x, a.y - o.y - k * depth, a.z - o.z], j);
        nor.set([nx, 0, nz], j);
        cn.set([cx / cl, cy / cl, cz / cl], j);
      }
    }
  }
  for (const name of ['position', 'normal', 'cnrm']) g.getAttribute(name).needsUpdate = true;
  g.computeBoundingSphere();
  g.boundingSphere!.radius += 0.4;
}

function rigMaterial() {
  return (rigMat ??= new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.3 }));
}
function ropeMaterial() {
  return (ropeMat ??= new THREE.MeshStandardNodeMaterial({ color: ROPE, roughness: 1, metalness: 0 }));
}

/** Fill a canvas grid's positions (relative to `o`) and its tangents along u and v (for the wind's normal) from rig `r`;
 *  its normals after. */
function fillCanvas(g: THREE.BufferGeometry, r: TarpRig, o: Vec) {
  const n = N + 1;
  const pos = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
  const tu = (g.getAttribute('tanU') as THREE.BufferAttribute).array as Float32Array;
  const tv = (g.getAttribute('tanV') as THREE.BufferAttribute).array as Float32Array;
  const a: Vec = { x: 0, y: 0, z: 0 }, b: Vec = { x: 0, y: 0, z: 0 }, c: Vec = { x: 0, y: 0, z: 0 };
  const d = 1e-3;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / N, v = j / N, k = j * n + i;
      canvasAt(r, u, v, a);
      pos.set([a.x - o.x, a.y - o.y, a.z - o.z], k * 3);
      // d(position)/du and /dv, per unit of u and v.
      canvasAt(r, Math.min(1, u + d), v, b);
      canvasAt(r, Math.max(0, u - d), v, c);
      const su = Math.min(1, u + d) - Math.max(0, u - d);
      tu.set([(b.x - c.x) / su, (b.y - c.y) / su, (b.z - c.z) / su], k * 3);
      canvasAt(r, u, Math.min(1, v + d), b);
      canvasAt(r, u, Math.max(0, v - d), c);
      const sv = Math.min(1, v + d) - Math.max(0, v - d);
      tv.set([(b.x - c.x) / sv, (b.y - c.y) / sv, (b.z - c.z) / sv], k * 3);
    }
  }
  for (const name of ['position', 'tanU', 'tanV']) g.getAttribute(name).needsUpdate = true;
  g.computeVertexNormals();
}

/** The canvas grid, relative to `o`: positions, uvs, the tangents along u and v (for the wind's normal), a seed, and
 *  how taut it is (1: the wind's full billow). */
function canvasGeometry(r: TarpRig, o: Vec, seed: number): THREE.BufferGeometry {
  const n = N + 1;
  const uvs = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) uvs.set([i / N, j / N], (j * n + i) * 2);
  // Wound so the front face looks up (v before u). Each cell is split along the square's diagonals (pole to pole, low
  // corner to low corner), the saddle's lines of symmetry, so it bends evenly either side.
  const idx: number[] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * n + i;
      if (i < N / 2 === j < N / 2) idx.push(k, k + n, k + n + 1, k, k + n + 1, k + 1);
      else idx.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('tanU', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
  g.setAttribute('tanV', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
  g.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(n * n).fill(seed), 1));
  g.setAttribute('taut', new THREE.BufferAttribute(new Float32Array(n * n).fill(1), 1));
  g.setIndex(idx);
  fillCanvas(g, r, o);
  // The waves lift it: room for them in the bounds (culling, shadows).
  g.computeBoundingSphere();
  g.boundingSphere!.radius += 0.3;
  return g;
}

/** A cylinder of radius r from a to b (relative to o), `sides` round, in colour `hex` (vertex colours) or none. */
function rod(a: Vec, b: Vec, o: Vec, r0: number, r1: number, sides: number, hex?: number): THREE.BufferGeometry {
  const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate((a.x + b.x) / 2 - o.x, (a.y + b.y) / 2 - o.y, (a.z + b.z) / 2 - o.z);
  return colour(g, hex);
}

const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

function colour(g: THREE.BufferGeometry, hex?: number): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  if (hex === undefined) return out;
  const c = new THREE.Color(hex), n = out.getAttribute('position').count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** A tarp at (x, y, z) turned `rot` (y: what shared/placed.ts placedY says it stands on), as a group placed there.
 *  `id` varies its waves; `flat` stands it on level ground at y (the icon). */
export function tarpModel(x: number, y: number, z: number, rot: number, id = 0, flat = false): THREE.Group {
  return rigModel(flat ? tarpRig(x, z, rot, () => y) : tarpRig(x, z, rot), { x, y, z }, id);
}

/** Any rig (a tarp's, a cart's canopy: shared/cart.ts canopyRig) as a group placed at `o`, the geometry relative to it:
 *  the canvas, its poles (a canopy has none: the cart's are its model's) and its lines. `id` varies its waves. */
export function rigModel(r: TarpRig, o: Vec, id = 0): THREE.Group {
  const canvas = new THREE.Mesh(canvasGeometry(r, o, (id * 2.399) % (2 * Math.PI)), canvasMaterial());
  canvas.name = 'tarp_canvas';
  canvas.castShadow = canvas.receiveShadow = true;
  const rig: THREE.BufferGeometry[] = [], ropes: THREE.BufferGeometry[] = [];
  // The poles: one dark pipe; the other two rusty lengths spliced with a sleeve and lashed. A cap on each, the canvas's
  // corner tied round it under the cap.
  r.poles.forEach((p, i) => {
    if (i === 0) rig.push(rod(p.foot, p.top, o, 0.05, 0.038, 6, POLE));
    else {
      const mid = lerp(p.foot, p.top, 0.52);
      rig.push(rod(p.foot, mid, o, 0.052, 0.048, 6, RUST), rod(mid, p.top, o, 0.042, 0.036, 6, POLE));
      rig.push(rod(lerp(p.foot, p.top, 0.47), lerp(p.foot, p.top, 0.57), o, 0.066, 0.066, 6, ROPE));
    }
    rig.push(rod({ ...p.top, y: p.top.y - 0.03 }, { ...p.top, y: p.top.y + 0.04 }, o, 0.052, 0.052, 6, CAP));
    rig.push(rod({ ...p.top, y: p.top.y - 0.2 }, { ...p.top, y: p.top.y - 0.1 }, o, 0.055, 0.055, 5, ROPE));
  });
  for (const gy of r.guys) {
    // The line, and a stake leaning back from it, driven into the sand.
    ropes.push(rod(gy.from, gy.stake, o, 0.011, 0.011, 3));
    const dx = gy.stake.x - gy.from.x, dz = gy.stake.z - gy.from.z, l = Math.hypot(dx, dz) || 1;
    const top = { x: gy.stake.x + (dx / l) * 0.08, y: gy.stake.y + 0.24, z: gy.stake.z + (dz / l) * 0.08 };
    rig.push(rod({ ...gy.stake, y: gy.stake.y - 0.1 }, top, o, 0.016, 0.022, 4, STAKE));
  }
  const grp = new THREE.Group();
  grp.position.set(o.x, o.y, o.z);
  grp.add(canvas);
  if (rig.length) {
    const body = new THREE.Mesh(mergeGeometries(rig.map((g) => (g.deleteAttribute('uv'), g))), rigMaterial());
    body.name = 'tarp_rig';
    body.castShadow = body.receiveShadow = true;
    grp.add(body);
  }
  if (ropes.length) {
    const lines = new THREE.Mesh(mergeGeometries(ropes.map((g) => (g.deleteAttribute('uv'), g))), ropeMaterial());
    lines.name = 'tarp_lines';
    lines.castShadow = false;
    lines.receiveShadow = true;
    grp.add(lines);
  }
  return grp;
}

/** Points along each of a canopy's lines; sides round. */
const ROPE_N = 16, ROPE_SIDES = 3, ROPE_R = 0.011;
/** A line's slack (its length over the straight distance, less one) as it's paid out, and once it's pulled taut. */
const ROPE_SLACK = 0.1, ROPE_TAUT = 0.0015;
const tmpT = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpU = new THREE.Vector3();

/** A line hanging from `a` to `b` with `slack` (its length over the distance between them, less one), as ROPE_N + 1
 *  points into `out` (world): a parabola that sags as deep as that length gives, never under the sand. */
function hang(a: Vec, b: Vec, slack: number, out: Vec[]) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, dist = Math.hypot(dx, dy, dz);
  const sag = dist * Math.sqrt((3 * slack) / 8);
  for (let i = 0; i <= ROPE_N; i++) {
    const t = i / ROPE_N, p = out[i];
    p.x = a.x + dx * t;
    p.z = a.z + dz * t;
    p.y = Math.max(a.y + dy * t - 4 * sag * t * (1 - t), heightAt(p.x, p.z) + ROPE_R);
  }
}

/** A canopy's lines as one mesh: ROPE_N segments each, ROPE_SIDES round, refilled by fillLine. */
function linesGeometry(count: number): THREE.BufferGeometry {
  const ring = ROPE_SIDES, per = (ROPE_N + 1) * ring, idx: number[] = [];
  for (let l = 0; l < count; l++) {
    for (let i = 0; i < ROPE_N; i++) {
      for (let k = 0; k < ring; k++) {
        const a = l * per + i * ring + k, b = l * per + i * ring + ((k + 1) % ring);
        idx.push(a, b, a + ring, b, b + ring, a + ring);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * per * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * per * 3), 3));
  g.setIndex(idx);
  return g;
}

/** Fill line `l` of a lines mesh from its points `pts` (world; relative to `o`), or squash it to nothing (`pts` null). */
function fillLine(g: THREE.BufferGeometry, l: number, pts: Vec[] | null, o: Vec) {
  const ring = ROPE_SIDES, per = (ROPE_N + 1) * ring;
  const pos = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
  const nor = (g.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
  for (let i = 0; i <= ROPE_N; i++) {
    const j = (l * per + i * ring) * 3;
    if (!pts) {
      pos.fill(0, j, j + ring * 3);
      continue;
    }
    const p = pts[i], q = pts[Math.min(ROPE_N, i + 1)], r = pts[Math.max(0, i - 1)];
    tmpT.set(q.x - r.x, q.y - r.y, q.z - r.z).normalize();
    tmpS.set(0, 1, 0).cross(tmpT);
    if (tmpS.lengthSq() < 1e-8) tmpS.set(1, 0, 0);
    tmpS.normalize();
    tmpU.copy(tmpT).cross(tmpS);
    for (let k = 0; k < ring; k++) {
      const an = (k / ring) * 2 * Math.PI, c = Math.cos(an), s = Math.sin(an);
      const nx = tmpS.x * c + tmpU.x * s, ny = tmpS.y * c + tmpU.y * s, nz = tmpS.z * c + tmpU.z * s;
      pos.set([p.x - o.x + nx * ROPE_R, p.y - o.y + ny * ROPE_R, p.z - o.z + nz * ROPE_R], j + k * 3);
      nor.set([nx, ny, nz], j + k * 3);
    }
  }
}

/** A cart's canopy (shared/cart.ts canopyRig), drawn so it can be put up: the canvas (the canopy's clean style) refilled
 *  from whatever rig it has at the moment, its drop edges let down last, and its lines paid out one by one once their
 *  corners are near their places: each line's end carried from its tie out to its stake (driven in as it gets there),
 *  the line hanging slack in a smooth sag behind it, then pulled taut. Packing runs it backwards. `final` is the rig it
 *  ends as (the stakes'); `id` varies its waves. */
export class CanopyModel {
  readonly group = new THREE.Group();
  private canvas: THREE.Mesh;
  /** The drop edges, and their rolls along the hems until they're let down (rebuilt while they unroll). */
  private skirt: THREE.Mesh;
  private rolls: THREE.Mesh;
  private lines: THREE.Mesh;
  private stakes: THREE.Mesh[] = [];
  private pts: Vec[] = Array.from({ length: ROPE_N + 1 }, () => ({ x: 0, y: 0, z: 0 }));
  private o: Vec;

  constructor(final: TarpRig, o: Vec, id = 0) {
    this.o = o;
    this.group.position.set(o.x, o.y, o.z);
    this.canvas = new THREE.Mesh(canvasGeometry(final, o, (id * 2.399) % (2 * Math.PI)), canvasMaterial('canopy'));
    this.canvas.name = 'canopy_canvas';
    this.canvas.castShadow = this.canvas.receiveShadow = true;
    this.canvas.frustumCulled = false; // (it moves while it's put up: its bounds are the finished one's)
    this.skirt = new THREE.Mesh(skirtGeometry((id * 2.399) % (2 * Math.PI)), skirtMaterial());
    this.skirt.name = 'canopy_skirt';
    this.skirt.castShadow = this.skirt.receiveShadow = true;
    this.skirt.frustumCulled = false;
    skirtRollMat ??= new THREE.MeshStandardNodeMaterial({ color: CANOPY_PATCH, roughness: 1, metalness: 0 });
    this.rolls = new THREE.Mesh(new THREE.BufferGeometry(), skirtRollMat);
    this.rolls.name = 'canopy_skirt_rolls';
    this.rolls.castShadow = this.rolls.receiveShadow = true;
    this.rolls.frustumCulled = false;
    this.lines = new THREE.Mesh(linesGeometry(final.guys.length), ropeMaterial());
    this.lines.name = 'canopy_lines';
    this.lines.receiveShadow = true;
    this.lines.frustumCulled = false;
    // Each stake leaning back from its line, a mesh of its own (it's driven in as its line gets there).
    for (const gy of final.guys) {
      const dx = gy.stake.x - gy.from.x, dz = gy.stake.z - gy.from.z, l = Math.hypot(dx, dz) || 1;
      const top = { x: gy.stake.x + (dx / l) * 0.08, y: gy.stake.y + 0.24, z: gy.stake.z + (dz / l) * 0.08 };
      const g = rod({ ...gy.stake, y: gy.stake.y - 0.1 }, top, gy.stake, 0.016, 0.022, 4, STAKE);
      g.deleteAttribute('uv');
      const m = new THREE.Mesh(g, rigMaterial());
      m.castShadow = m.receiveShadow = true;
      this.stakes.push(m);
    }
    this.group.add(this.canvas, this.skirt, this.rolls, this.lines, ...this.stakes);
    this.set(final, final, 1);
  }

  /** The canvas as rig `r` has it, `taut` 0 (being put up: no billow) .. 1 (up). Its drop edges hang `r.skirt` deep:
   *  short of `final`'s, the rest is still rolled up at their hems (a roll along each edge, thinner as it's let down).
   *  `pay[i]` 0..1: how far line i (`final.guys`' order) is paid out from its tie in `r` to `final`'s stake (0: coiled
   *  at the tie, unseen; 1: tied off and taut). */
  set(r: TarpRig, final: TarpRig, taut: number, pay: readonly number[] = [1, 1, 1, 1]) {
    for (const g of [this.canvas.geometry, this.skirt.geometry]) {
      const t = g.getAttribute('taut') as THREE.BufferAttribute;
      (t.array as Float32Array).fill(taut);
      t.needsUpdate = true;
    }
    fillCanvas(this.canvas.geometry, r, this.o);
    const full = final.skirt ?? 0, depth = Math.min(full, r.skirt ?? 0);
    this.skirt.visible = depth > 0.01;
    if (this.skirt.visible) fillSkirt(this.skirt.geometry, r, this.o, depth);
    const rolled = full > 0 ? 1 - depth / full : 0;
    this.rolls.geometry.dispose();
    this.rolls.visible = rolled > 0.01;
    this.rolls.geometry = this.rolls.visible ? this.rollGeometry(r, depth, 0.012 + 0.03 * Math.sqrt(rolled)) : new THREE.BufferGeometry();
    const o = this.o, g = this.lines.geometry;
    final.guys.forEach((gy, i) => {
      const from = r.guys[i]?.from ?? gy.from, p = Math.min(1, Math.max(0, pay[i] ?? 1));
      // Its stake, driven in from a hand over the sand as the line's end gets there.
      const drive = Math.min(1, Math.max(0, (p - 0.7) / 0.25)), m = this.stakes[i];
      m.visible = drive > 0;
      m.position.set(gy.stake.x - o.x, gy.stake.y - o.y + (1 - drive) * 0.28, gy.stake.z - o.z);
      if (p <= 0.001) return fillLine(g, i, null, o);
      // The line's end: carried from the tie to where it's tied off near the stake's top (there at p = 0.85), then the
      // slack taken up.
      const tie = { x: gy.stake.x, y: gy.stake.y + 0.18, z: gy.stake.z };
      const k = Math.min(1, p / 0.85), e = 1 - (1 - k) * (1 - k);
      const end = { x: from.x + (tie.x - from.x) * e, y: from.y + (tie.y - from.y) * e, z: from.z + (tie.z - from.z) * e };
      const tight = Math.max(0, (p - 0.85) / 0.15);
      hang(from, end, ROPE_TAUT + (ROPE_SLACK - ROPE_TAUT) * (1 - tight * tight * (3 - 2 * tight)), this.pts);
      fillLine(g, i, this.pts, o);
    });
    for (const name of ['position', 'normal']) g.getAttribute(name).needsUpdate = true;
  }

  /** A roll of radius `rad` along each edge, its top `depth` under the hem (relative to the model's origin). */
  private rollGeometry(r: TarpRig, depth: number, rad: number): THREE.BufferGeometry {
    const o = this.o, tubes: THREE.BufferGeometry[] = [];
    for (let e = 0; e < 4; e++) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const p = skirtAt(r, e, i / 8);
        pts.push(new THREE.Vector3(p.x - o.x, p.y - o.y - depth - rad * 0.7, p.z - o.z));
      }
      tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, rad, 6, false));
    }
    const g = mergeGeometries(tubes);
    for (const t of tubes) t.dispose();
    return g;
  }

  dispose() {
    this.group.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g) g.dispose();
    });
  }
}
