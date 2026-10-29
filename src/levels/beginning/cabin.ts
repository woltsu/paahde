// The last pod's cabin (docs/levels/tutorial.md "The pod"), seen through its open hatch: a cramped one-person capsule
// fitted inside pod.glb's hull (podHull.ts), in the pod's own frame. A curved inner shell with ribs and two end
// bulkheads, a deck, a padded acceleration couch facing the hatch with its harness, a little instrument panel on an arm
// at the nose end (a screen like the station's, lit buttons, switches), an overhead dome light and two light strips,
// grab bars, cable runs with their clamps, a locker and an extinguisher on the rear bulkhead. The hatch's opening gets
// its jamb (the hull's thickness) and dark backing round it where pod.ts cut the core away.
//
// Built in code from boxes, cylinders and arcs, merged per material with vertex colours (five draw calls and the screen);
// everything stays inside the shell's radius (SHELL), so nothing pokes through the hull from any side. Its lamps' glow
// follows `setLit`; what lights it is the bay's pooled light CABIN_LIGHT (shared/levels/beginning.ts: under the dome,
// towards the hatch, so the far side falls darker), weighted by src/levels/beginning/index.ts.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEXT } from '../../../shared/text.ts';
import { sign } from './props.ts';
import { AXIS_Y, CORE, HATCH_A0, HATCH_A1, HATCH_Y0, HATCH_Y1, radiusAt } from './podHull.ts';

/** The inner shell's radius: inside the core (≥ 1.15 over the cabin's length) everywhere. */
export const SHELL = 1.12;
/** The cabin's ends (z): the rear bulkhead (before the service ring) and the nose bulkhead. */
const ZR = -0.64, ZN = 0.86;
/** The opening (z) and its edges (angles). */
const ZO0 = -HATCH_Y1, ZO1 = -HATCH_Y0, A0 = HATCH_A0, A1 = HATCH_A1;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

type Mat = 'paint' | 'metal' | 'pad' | 'lamp' | 'panel';

const C = {
  shell: 0xa9a7a0, bulkhead: 0x868a90, rib: 0x5d636b, deck: 0x3a3e44, tread: 0x26292d, jamb: 0x41454c, backing: 0x1c1e21,
  frame: 0x464b52, pad: 0x9a5530, padDark: 0x6e3a20, webbing: 0x2a2d32, buckle: 0xc0c4c9, housing: 0x2d3136,
  brass: 0xb59a52, locker: 0xa29f97, red: 0xb3342b, lamp: 0xfff0d2, cableA: 0x1d1f22, cableB: 0x8e2b23, cableC: 0x2d527d,
};

/** Geometry gathered per material: position, normal and a colour per vertex. */
class Kit {
  private parts = new Map<Mat, THREE.BufferGeometry[]>();

  add(mat: Mat, geo: THREE.BufferGeometry, color: number, m?: THREE.Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (m) g.applyMatrix4(m);
    const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
  }

  box(mat: Mat, color: number, w: number, h: number, d: number, m: THREE.Matrix4) {
    this.add(mat, new THREE.BoxGeometry(w, h, d), color, m);
  }

  /** A rod of radius `r` from `a` to `b`. */
  rod(mat: Mat, color: number, a: THREE.Vector3, b: THREE.Vector3, r: number, segs = 8) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    this.add(mat, new THREE.CylinderGeometry(r, r, len, segs), color, m);
  }

  /** A flat strap `w` wide, `t` thick from `a` to `b`, its face towards `face`. */
  strap(mat: Mat, color: number, a: THREE.Vector3, b: THREE.Vector3, w: number, t: number, face: THREE.Vector3) {
    const y = new THREE.Vector3().subVectors(b, a), len = y.length();
    y.normalize();
    const z = face.clone().addScaledVector(y, -face.dot(y)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
    const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(a.clone().add(b).multiplyScalar(0.5));
    this.box(mat, color, w, len, t, m);
  }

  meshes(materials: Record<Mat, THREE.Material>): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list), materials[mat]);
      mesh.castShadow = false;
      mesh.receiveShadow = mat !== 'lamp' && mat !== 'panel';
      out.push(mesh);
    }
    return out;
  }

  /** The furthest any vertex lies from the axis between the bulkheads (it must stay inside the shell). */
  reach(): number {
    let far = 0;
    for (const list of this.parts.values()) for (const g of list) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) far = Math.max(far, Math.hypot(p.getX(i), p.getY(i) - AXIS_Y));
    }
    return far;
  }
}

/** A surface of triangles, each wound to face its given normal. */
class Surface {
  pos: number[] = [];
  nor: number[] = [];

  tri(p: THREE.Vector3[], n: THREE.Vector3[]) {
    const f = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
    const want = n[0].clone().add(n[1]).add(n[2]);
    const order = f.dot(want) >= 0 ? [0, 1, 2] : [0, 2, 1];
    for (const i of order) {
      this.pos.push(p[i].x, p[i].y, p[i].z);
      this.nor.push(n[i].x, n[i].y, n[i].z);
    }
  }

  quad(p: THREE.Vector3[], n: THREE.Vector3[]) {
    this.tri([p[0], p[1], p[2]], [n[0], n[1], n[2]]);
    this.tri([p[0], p[2], p[3]], [n[0], n[2], n[3]]);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    return g;
  }
}

const at = (a: number, r: number, z: number) => new THREE.Vector3(Math.cos(a) * r, AXIS_Y + Math.sin(a) * r, z);
const radial = (a: number, s = 1) => new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, 0);

/** Part of a cylinder round the axis, radius `r` (or `r(z)`), facing in (or out). */
function arc(r: number | ((z: number) => number), a0: number, a1: number, z0: number, z1: number, inward: boolean, segs: number) {
  const s = new Surface(), R = typeof r === 'number' ? () => r : r, k = inward ? -1 : 1;
  for (let i = 0; i < segs; i++) {
    const aa = a0 + ((a1 - a0) * i) / segs, ab = a0 + ((a1 - a0) * (i + 1)) / segs;
    s.quad([at(aa, R(z0), z0), at(ab, R(z0), z0), at(ab, R(z1), z1), at(aa, R(z1), z1)], [radial(aa, k), radial(ab, k), radial(ab, k), radial(aa, k)]);
  }
  return s.geometry();
}

/** A ring sector across the axis at `z` (radii r0..r1, or r1(a)), facing `nz` (±1). */
function sector(r0: number, r1: number, a0: number, a1: number, z: number, nz: number, segs: number) {
  const s = new Surface(), n = new THREE.Vector3(0, 0, nz);
  for (let i = 0; i < segs; i++) {
    const aa = a0 + ((a1 - a0) * i) / segs, ab = a0 + ((a1 - a0) * (i + 1)) / segs;
    if (r0 === 0) s.tri([at(aa, 0, z), at(aa, r1, z), at(ab, r1, z)], [n, n, n]);
    else s.quad([at(aa, r0, z), at(aa, r1, z), at(ab, r1, z), at(ab, r0, z)], [n, n, n, n]);
  }
  return s.geometry();
}

/** A frame on the shell at angle `a`, axial `z`, radius `r`: +z in towards the axis, +y up round the shell, +x along -z. */
function shellFrame(a: number, z: number, r: number): THREE.Matrix4 {
  const up = new THREE.Vector3(Math.sin(a), -Math.cos(a), 0), inn = radial(a, -1);
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), up, inn).setPosition(at(a, r, z));
}

const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export class Cabin {
  readonly group = new THREE.Group();
  private lamp = new THREE.MeshBasicMaterial({ vertexColors: true });
  private panel = new THREE.MeshBasicMaterial({ vertexColors: true });
  /** Its geometry, waiting for `show` to be given materials. */
  private kits: Kit[];

  constructor() {
    const k = new Kit(), edge = new Kit(); // (edge: the jamb and backing, out to the hull's panels)

    // The shell: all round but the opening, and over and under it past its ends; ribs at both ends and across the middle.
    k.add('paint', arc(SHELL, A1, A0 + TAU, ZR, ZN, true, 44), C.shell);
    k.add('paint', arc(SHELL, A0, A1, ZR, ZO0, true, 8), C.shell);
    k.add('paint', arc(SHELL, A0, A1, ZO1, ZN, true, 8), C.shell);
    k.add('paint', sector(0, SHELL, 0, TAU, ZR, 1, 40), C.bulkhead);
    k.add('paint', sector(0, SHELL, 0, TAU, ZN, -1, 40), C.bulkhead);
    const rib = (z: number, from: number, len: number) =>
      k.add('metal', new THREE.TorusGeometry(SHELL - 0.025, 0.02, 6, 56, len), C.rib, M(0, AXIS_Y, z, 0, 0, from));
    rib(ZR + 0.06, 0, TAU);
    rib(ZN - 0.06, 0, TAU);
    rib((ZO0 + ZO1) / 2, A1 + 0.03, TAU - (A1 - A0) - 0.06);

    // The opening's jamb (the hull's thickness, shell to panels) and dark backing round it where the core was cut away.
    const outer = (z: number) => radiusAt(-z) - 0.004;
    const jamb = new Surface();
    for (const [a, side] of [[A0, 1], [A1, -1]] as const) {
      const n = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(side); // into the opening
      jamb.quad([at(a, SHELL, ZO0), at(a, outer(ZO0), ZO0), at(a, outer(ZO1), ZO1), at(a, SHELL, ZO1)], [n, n, n, n]);
    }
    for (const [z, nz] of [[ZO0, 1], [ZO1, -1]] as const) {
      const n = new THREE.Vector3(0, 0, nz), segs = 8;
      for (let i = 0; i < segs; i++) {
        const aa = A0 + ((A1 - A0) * i) / segs, ab = A0 + ((A1 - A0) * (i + 1)) / segs;
        jamb.quad([at(aa, SHELL, z), at(aa, outer(z), z), at(ab, outer(z), z), at(ab, SHELL, z)], [n, n, n, n]);
      }
    }
    edge.add('metal', jamb.geometry(), C.jamb);
    const core = (z: number) => radiusAt(-z) - CORE - 0.006;
    edge.add('paint', arc(core, 148 * DEG, A0, -0.45, 0.75, false, 4), C.backing);
    edge.add('paint', arc(core, A1, 244 * DEG, -0.45, 0.75, false, 4), C.backing);
    edge.add('paint', arc(core, A0, A1, -0.45, ZO0, false, 6), C.backing);
    edge.add('paint', arc(core, A0, A1, ZO1, 0.75, false, 6), C.backing);

    // The deck, a step down from the sill, with treads.
    k.box('metal', C.deck, 1.4, 0.045, ZN - ZR - 0.04, M(0, 0.3575, (ZR + ZN) / 2));
    for (let i = 0; i < 5; i++) k.box('metal', C.tread, 1.2, 0.006, 0.03, M(-0.05, 0.383, ZR + 0.2 + i * 0.28));

    // The couch: a pedestal, a seat pan tilted back, a reclined back with a headrest, quilted pads, armrests, the harness.
    k.box('metal', C.frame, 0.34, 0.2, 0.36, M(0.32, 0.48, 0.13));
    const seatTilt = -0.12, seat = M(0.3, 0.6, 0.13, 0, 0, seatTilt);
    k.box('metal', C.frame, 0.56, 0.05, 0.64, seat);
    for (let i = 0; i < 3; i++) k.box('pad', C.pad, 0.52, 0.08, 0.195, seat.clone().multiply(M(0, 0.065, -0.205 + i * 0.205)));
    const lean = 0.42, base = V(0.58, 0.6, 0.13), u = V(Math.sin(lean), Math.cos(lean), 0), fwd = V(-Math.cos(lean), Math.sin(lean), 0);
    const back = (along: number, out: number, z = 0.13) => base.clone().addScaledVector(u, along).addScaledVector(fwd, out).setZ(z);
    const backM = (along: number, out: number) => new THREE.Matrix4().compose(back(along, out), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -lean)), V(1, 1, 1));
    k.box('metal', C.frame, 0.06, 0.8, 0.64, backM(0.4, 0));
    k.box('metal', C.frame, 0.06, 0.16, 0.34, backM(0.89, 0));
    for (let i = 0; i < 3; i++) k.box('pad', C.pad, 0.06, 0.245, 0.58, backM(0.13 + i * 0.26, 0.06));
    k.box('pad', C.padDark, 0.06, 0.14, 0.3, backM(0.89, 0.06));
    for (const z of [-0.215, 0.475]) {
      k.box('metal', C.frame, 0.46, 0.04, 0.05, M(0.3, 0.82, z));
      k.box('pad', C.padDark, 0.4, 0.03, 0.045, M(0.28, 0.855, z));
      k.box('metal', C.frame, 0.04, 0.22, 0.04, M(0.46, 0.7, z));
    }
    // The harness: shoulder straps over the pads, down to the buckle on the lap, the lap belt and the crotch strap.
    const seatTop = (x: number) => 0.6 + 0.025 + 0.08 + 0.01 - (x - 0.3) * Math.tan(-seatTilt);
    const buckle = V(0.27, seatTop(0.27) + 0.012, 0.13), face = fwd.clone();
    for (const s of [-1, 1]) {
      const top = back(0.74, 0.098, 0.13 + s * 0.12), low = back(0.08, 0.098, 0.13 + s * 0.07);
      k.strap('pad', C.webbing, top, low, 0.05, 0.01, face);
      k.strap('pad', C.webbing, low, buckle.clone().setZ(0.13 + s * 0.03), 0.05, 0.01, V(0, 1, 0));
      k.strap('pad', C.webbing, V(0.4, seatTop(0.4), 0.13 + s * 0.3), buckle.clone().setZ(0.13 + s * 0.04), 0.05, 0.01, V(0, 1, 0));
      k.strap('pad', C.webbing, back(0.9, 0.098, 0.13 + s * 0.12), top, 0.05, 0.01, face);
    }
    k.strap('pad', C.webbing, V(0.04, seatTop(0.04), 0.13), buckle, 0.05, 0.01, V(0, 1, 0));
    k.add('metal', new THREE.CylinderGeometry(0.045, 0.045, 0.02, 12), C.buckle, M(buckle.x, buckle.y + 0.006, buckle.z));

    // The nose end: a low cabinet against the bulkhead (vents, a ledge) and over it the instrument panel, its face turned
    // a little to the couch and the hatch.
    k.box('paint', C.locker, 0.62, 0.6, 0.18, M(0.16, 0.69, ZN - 0.09));
    k.box('metal', C.frame, 0.66, 0.035, 0.22, M(0.16, 1.0, ZN - 0.11));
    for (let i = 0; i < 4; i++) k.box('metal', C.backing, 0.4, 0.016, 0.006, M(0.16, 0.5 + i * 0.05, ZN - 0.182));
    const holder = new THREE.Object3D();
    holder.position.set(0.16, 1.3, ZN - 0.075);
    holder.lookAt(-0.35, 1.12, 0.0);
    holder.updateMatrix();
    const P = holder.matrix, inP = (m: THREE.Matrix4) => P.clone().multiply(m);
    k.box('metal', C.housing, 0.56, 0.36, 0.07, P);
    k.box('metal', C.frame, 0.6, 0.02, 0.09, inP(M(0, 0.185, 0.005)));
    const lit = [0x3ee07c, 0x3ee07c, 0xffb43c, 0x48d6ff, 0xff4a3a, 0x3ee07c, 0xffb43c, 0x3ee07c];
    lit.forEach((c, i) => k.box('panel', c, 0.032, 0.024, 0.012, inP(M(0.08 + (i % 4) * 0.045, 0.07 - Math.floor(i / 4) * 0.045, 0.041))));
    for (let i = 0; i < 5; i++) k.box('panel', 0xffc35a, 0.012, 0.012, 0.01, inP(M(-0.2 + i * 0.03, -0.11, 0.04)));
    for (let i = 0; i < 3; i++) {
      k.box('metal', C.frame, 0.03, 0.03, 0.01, inP(M(0.09 + i * 0.05, -0.09, 0.04)));
      k.add('metal', new THREE.CylinderGeometry(0.005, 0.005, 0.035, 6), C.buckle, inP(M(0.09 + i * 0.05, -0.085, 0.055, 1.1)));
    }
    const screen = sign(TEXT.tutorial.screens.entry, 0.24, 0.13, '#9fe8ff', '#06121a', 1.4).mesh;
    screen.applyMatrix4(inP(M(-0.12, 0.05, 0.046)));
    this.group.add(screen);

    // The dome light overhead in its ring, the two light strips (in their housings, split round the middle rib).
    const domeAt = V(-0.05, AXIS_Y + SHELL - 0.04, 0.13);
    k.add('lamp', new THREE.SphereGeometry(0.1, 16, 6, 0, TAU, 0, Math.PI / 2), C.lamp, M(domeAt.x, domeAt.y, domeAt.z, Math.PI));
    k.add('metal', new THREE.TorusGeometry(0.105, 0.014, 6, 24), C.frame, M(domeAt.x, domeAt.y, domeAt.z, Math.PI / 2));
    for (const a of [60 * DEG, 122 * DEG]) {
      for (const [z0, z1] of [[ZR + 0.12, 0.07], [0.19, ZN - 0.12]]) {
        const zm = (z0 + z1) / 2, len = z1 - z0;
        k.box('metal', C.frame, len, 0.05, 0.016, shellFrame(a, zm, SHELL - 0.009));
        k.box('lamp', C.lamp, len - 0.02, 0.026, 0.01, shellFrame(a, zm, SHELL - 0.02));
      }
    }

    // Grab bars: along the top of the opening inside, and up the nose bulkhead beside it.
    const barA = 158 * DEG, barR = SHELL - 0.075;
    k.rod('metal', C.brass, at(barA, barR, -0.26), at(barA, barR, 0.52), 0.016);
    for (const z of [-0.24, 0.5]) k.rod('metal', C.brass, at(barA, barR, z), at(barA, SHELL - 0.002, z), 0.011);
    k.rod('metal', C.brass, V(-0.72, 0.9, ZN - 0.07), V(-0.72, 1.5, ZN - 0.07), 0.016);
    for (const y of [0.92, 1.48]) k.rod('metal', C.brass, V(-0.72, y, ZN - 0.07), V(-0.72, y, ZN + 0.002), 0.011);

    // Cable runs: low behind the couch and high over the opening, clamped; a bundle up the rear bulkhead.
    const run = (a: number, r: number, rad: number, c: number) => k.rod('metal', c, at(a, r, ZR - 0.003), at(a, r, ZN + 0.003), rad, 6);
    run(336 * DEG, SHELL - 0.035, 0.02, C.cableA);
    run(343 * DEG, SHELL - 0.03, 0.015, C.cableB);
    run(349 * DEG, SHELL - 0.028, 0.013, C.cableC);
    run(136 * DEG, SHELL - 0.03, 0.016, C.cableA);
    run(141 * DEG, SHELL - 0.028, 0.012, C.cableC);
    for (const z of [-0.36, 0.13, 0.6]) {
      k.box('metal', C.frame, 0.035, 0.16, 0.05, shellFrame(342 * DEG, z, SHELL - 0.03));
      k.box('metal', C.frame, 0.035, 0.12, 0.045, shellFrame(138 * DEG, z, SHELL - 0.028));
    }
    for (const [x, rad, c] of [[0.56, 0.02, C.cableA], [0.61, 0.015, C.cableB], [0.65, 0.013, C.cableA]] as const) {
      k.rod('metal', c, V(x, 0.38, ZR + 0.03), V(x, 1.95, ZR + 0.03), rad, 6);
    }
    for (const y of [0.8, 1.5]) k.box('metal', C.frame, 0.16, 0.035, 0.05, M(0.61, y, ZR + 0.03));

    // The rear bulkhead: a locker with its handle, an extinguisher in its bracket.
    k.box('paint', C.locker, 0.5, 0.56, 0.04, M(-0.14, 1.36, ZR + 0.02));
    k.box('metal', C.frame, 0.14, 0.025, 0.025, M(-0.14, 1.2, ZR + 0.05));
    k.box('paint', C.jamb, 0.46, 0.012, 0.006, M(-0.14, 1.55, ZR + 0.043));
    k.add('paint', new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12), C.red, M(-0.5, 0.78, ZR + 0.07));
    k.add('metal', new THREE.CylinderGeometry(0.018, 0.018, 0.06, 8), C.housing, M(-0.5, 0.96, ZR + 0.07));
    k.box('metal', C.frame, 0.12, 0.03, 0.05, M(-0.5, 0.82, ZR + 0.025));

    if (k.reach() > SHELL + 1e-3) console.warn('beginning: the pod cabin reaches', k.reach().toFixed(3), 'past its shell', SHELL);
    this.kits = [k, edge];
    this.setLit(0);
  }

  /** Into the scene, once its pooled light is lit (pod.ts: from the cover shutting, behind the shut hatch): a material
   *  first drawn while that light's slot stood at zero never took it up (made with the stage, the cabin stayed unlit). */
  show() {
    if (!this.kits.length) return;
    const materials: Record<Mat, THREE.Material> = {
      paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.08 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55 }),
      pad: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
      lamp: this.lamp,
      panel: this.panel,
    };
    for (const kit of this.kits) for (const mesh of kit.meshes(materials)) this.group.add(mesh);
    this.kits = [];
  }

  /** How lit its lamps are (0..1); the panel glows a little before them. */
  setLit(level: number) {
    this.lamp.color.setScalar(0.08 + 1.4 * level);
    this.panel.color.setScalar(0.35 + 0.9 * level);
  }
}
