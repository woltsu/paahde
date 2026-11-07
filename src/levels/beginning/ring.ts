// The ring's shell (docs/levels/ring.md): the hall's deck, side walls and ceiling as true cylinders and annuli all the
// way round the station (3.1 km), and its ribs, in the ring frame (shared/ring.ts). Collision for them is the layout's
// ('shell' boxes, shared/levels/beginning.ts); this only draws them. The deck is cut away where the two buildings stand
// (their rooms have floors of their own) and over the trench.
//
// One material, procedural in the flat frame (`lpos`, `lnor`: x along the axis, y towards it, z round the ring): deck
// plates with seams and the lane's paint; wall panels, a dark dado and a row of amber beacons; ceiling panels with long
// light bands round the ring. The bands light the hall: the pool's few lights can't, so what they would throw on the
// deck and walls is emissive here, and it goes out with them (the lights going out row by row: `cut`).
import * as THREE from 'three/webgpu';
import { abs, attribute, color, float, floor, fract, fwidth, hash, length, max, min, mix, mx_noise_float, select, smoothstep, step, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { RING, ribBoxes, ribsIn } from '../../../shared/ring.ts';
import { CREW_BLOCK, GAP, LANE, TERMINAL } from '../../../shared/levels/beginning.ts';
import { dirToRing, toRing } from '../../../shared/ring.ts';
import { boxGeometry } from '../boxLevel.ts';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const X = RING.width / 2, H = RING.height, R = RING.radius;
/** How far a strip of the shell runs round the ring (m). */
const STEP = 2;
/** The ceiling's light bands: their centres across the hall (x) and half width, and the fixtures they're made of (m). */
const BANDS = [-26, -10, 10, 26], BAND_HALF = 1.2, FIXTURE = 6;
/** Behind the lights' cut, what the bands threw on the deck and walls fades out over this far (m): no hard edge. */
const FADE = 40;

/** A sheet of the shell: `at(u, s)` the flat point of (u across it, s round the ring), `n` its flat normal; u over
 *  [u0, u1] in `nu` steps, s over [s0, s1]. Positions and normals bent onto the ring, the flat ones kept. */
function sheet(out: Parts, at: (u: number, s: number) => [number, number, number], n: [number, number, number], u0: number, u1: number, nu: number, s0: number, s1: number) {
  const ns = Math.max(1, Math.ceil((s1 - s0) / STEP));
  const base = out.lpos.length / 3;
  const p = [0, 0, 0], d = [0, 0, 0];
  for (let j = 0; j <= ns; j++) {
    const s = s0 + ((s1 - s0) * j) / ns;
    for (let i = 0; i <= nu; i++) {
      const f = at(u0 + ((u1 - u0) * i) / nu, s);
      out.lpos.push(f[0], f[1], f[2]);
      out.lnor.push(n[0], n[1], n[2]);
      toRing(f[0], f[1], f[2], p);
      dirToRing(n[0], n[1], n[2], f[2], d);
      out.pos.push(p[0], p[1], p[2]);
      out.nor.push(d[0], d[1], d[2]);
    }
  }
  // Wound to face the normal: test the first quad's flat cross product.
  const a = at(u0, s0), b = at(u1, s0), c = at(u0, s1);
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
  const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
  const row = nu + 1;
  for (let j = 0; j < ns; j++) {
    for (let i = 0; i < nu; i++) {
      const k = base + j * row + i;
      if (flip) out.idx.push(k, k + row, k + 1, k + 1, k + row, k + row + 1);
      else out.idx.push(k, k + 1, k + row, k + 1, k + row + 1, k + row);
    }
  }
}

type Parts = { pos: number[]; nor: number[]; lpos: number[]; lnor: number[]; idx: number[] };

function geometry(parts: Parts): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(parts.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(parts.nor, 3));
  g.setAttribute('lpos', new THREE.Float32BufferAttribute(parts.lpos, 3));
  g.setAttribute('lnor', new THREE.Float32BufferAttribute(parts.lnor, 3));
  g.setIndex(parts.idx);
  g.computeBoundingSphere();
  return g;
}

/** Thin seams every `pitch` along `c`, faded to their average where they'd shimmer. */
function seams(c: F, pitch: number, width: number): F {
  const f = fract(c.div(pitch));
  const e = min(f, f.oneMinus()).mul(pitch);
  const line = float(1).sub(smoothstep(width, float(width).add(fwidth(e)), e));
  return mix(line, float((2 * width) / pitch), smoothstep(pitch * 0.15, pitch * 0.4, fwidth(c)));
}

export class RingShell {
  readonly group = new THREE.Group();

  /** `lights`: the deck's lights from `z0` round to `cut` are out (a uniform: the stage moves it, no shader rebuild). */
  constructor(lights: { z0: number; cut: F }) {
    this.group.name = 'ring-shell';
    // The whole ring, its seam opposite the level.
    const mid = (CREW_BLOCK.z0 + TERMINAL.z1) / 2, S0 = mid - Math.PI * R, S1 = mid + Math.PI * R;
    const parts: Parts = { pos: [], nor: [], lpos: [], lnor: [], idx: [] };
    // The deck, but under the buildings and over the trench.
    const cuts = [[CREW_BLOCK.z0, CREW_BLOCK.z1], [GAP.z0, GAP.z1], [TERMINAL.z0, TERMINAL.z1]].sort((a, b) => a[0] - b[0]);
    let from = S0;
    for (const [c0, c1] of cuts) {
      sheet(parts, (u, s) => [u, 0, s], [0, 1, 0], -X, X, 4, from, c0);
      from = c1;
    }
    sheet(parts, (u, s) => [u, 0, s], [0, 1, 0], -X, X, 4, from, S1);
    // The ceiling and the side walls, unbroken.
    sheet(parts, (u, s) => [u, H, s], [0, -1, 0], -X, X, 4, S0, S1);
    sheet(parts, (u, s) => [-X, u, s], [1, 0, 0], 0, H, 3, S0, S1);
    sheet(parts, (u, s) => [X, u, s], [-1, 0, 0], 0, H, 3, S0, S1);
    const shell = new THREE.Mesh(geometry(parts), shellMaterial(lights));
    shell.name = 'ring-hull';
    shell.receiveShadow = true;
    shell.frustumCulled = false;
    this.group.add(shell);
    // The ribs, all round.
    const ribs = ribsIn(S0, S1 - 1).flatMap((s) => ribBoxes(s).map((b) => ({ b, zone: 'hall' })));
    const ribMesh = new THREE.Mesh(boxGeometry(ribs, { hall: H }, true), ribMaterial());
    ribMesh.name = 'ring-ribs';
    ribMesh.receiveShadow = true;
    ribMesh.frustumCulled = false;
    this.group.add(ribMesh);
  }
}

function shellMaterial(lights: { z0: number; cut: F }): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x4a4f55, roughness: 0.6, metalness: 0.2 });
  const LP = attribute('lpos', 'vec3') as unknown as V3, LN = attribute('lnor', 'vec3') as unknown as V3;
  const x = LP.x, y = LP.y, s = LP.z;
  const deck = step(0.5, LN.y), ceil = step(0.5, LN.y.negate()), wall = float(1).sub(deck).sub(ceil);
  // The bands are out from z0 round to the cut (the deck's lights going out behind you), a whole fixture at a time; the
  // light they threw on the deck and walls fades out over FADE behind it, never a hard line.
  const fixture = floor(s.div(FIXTURE)).add(0.5).mul(FIXTURE);
  const bandLit = float(1).sub(step(lights.z0, fixture).mul(step(fixture, lights.cut)));
  const lit = float(1).sub(step(lights.z0, s).mul(smoothstep(lights.cut, lights.cut.sub(FADE), s)));

  // Deck: 2.4 × 1.2 m plates, each its own shade, seams; the lane's edges painted.
  const plate = vec2(floor(x.div(2.4)), floor(s.div(1.2)));
  const tint = hash(plate.x.mul(17.1).add(plate.y.mul(3.7))).mul(0.08);
  const grime = mx_noise_float(vec3(x.mul(0.08), s.mul(0.03), 1)).mul(0.06);
  const deckSeam = max(seams(x, 2.4, 0.008), seams(s, 1.2, 0.008));
  const paint = smoothstep(0.02, 0.0, abs(abs(x).sub(LANE - 0.1)).sub(0.08)).mul(step(fract(s.div(6)), 0.75));
  const deckAlbedo = mix(color(0x4b5056).add(tint).sub(grime).mul(deckSeam.mul(0.45).oneMinus()), color(0xc9a227), paint) as V3;

  // Walls: 4 × 3 m panels, a dark dado, a row of amber beacons every 15 m.
  const wallSeam = max(seams(s, 4, 0.01), seams(y, 3, 0.01));
  const dado = step(y, 2.5);
  const wallAlbedo = mix(color(0x5c6168), color(0x2e3238), dado).mul(wallSeam.mul(0.4).oneMinus()).add(hash(floor(s.div(4)).add(floor(y.div(3)).mul(91))).mul(0.03)) as V3;
  const beacon = float(1).sub(smoothstep(0.18, 0.3, length(vec2(fract(s.div(15)).sub(0.5).mul(15), y.sub(14)))));

  // Ceiling: dark panels, the light bands round the ring (split into 6 m fixtures).
  let band: F = float(0);
  for (const b of BANDS) band = max(band, float(1).sub(smoothstep(BAND_HALF - 0.1, BAND_HALF, abs(x.sub(b)))));
  band = band.mul(seams(s, FIXTURE, 0.15).oneMinus());
  const ceilAlbedo = color(0x1c1f23).mul(max(seams(x, 5, 0.03), seams(s, 6, 0.03)).mul(0.5).oneMinus()) as V3;

  m.colorNode = deckAlbedo.mul(deck).add(wallAlbedo.mul(wall)).add(ceilAlbedo.mul(ceil));
  m.roughnessNode = select(deck.greaterThan(0.5), float(0.45).add(grime.mul(2)), float(0.7));
  m.metalnessNode = select(deck.greaterThan(0.5), float(0.35), float(0.15));
  // What the bands throw on the deck and the walls (brighter up towards them), the bands and beacons themselves.
  const fill = deck.mul(0.16).add(wall.mul(smoothstep(0, H, y).mul(0.1).add(0.03))).mul(lit);
  const own = band.mul(ceil).mul(bandLit).mul(5);
  m.emissiveNode = (m.colorNode as V3).mul(fill).add(color(0xe4ecff).mul(own)).add(color(0xff8a3a).mul(beacon.mul(wall).mul(6)));
  return m;
}

function ribMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x3b4047, roughness: 0.5, metalness: 0.6 });
  const LP = attribute('lpos', 'vec3') as unknown as V3;
  const panel = seams(LP.y, 2.5, 0.015).max(seams(LP.x, 2.5, 0.015));
  m.colorNode = color(0x3b4047).mul(panel.mul(0.35).oneMinus());
  m.emissiveNode = color(0x3b4047).mul(0.06);
  return m;
}
