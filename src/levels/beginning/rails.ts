// The ring hall's overhead rails and their carriages (docs/levels/ring.md "Overhead rails"): two tracks, each a pair of
// I-beams hung from the ceiling on rods, all the way round the ring between the light bands, with bridge cranes running
// under them (carriages.ts moves them): two end trucks rolling on the beams' bottom flanges, twin girders between them,
// a hoist under the girders and on its cables a hook with a rack or a container, or nothing, swinging as they speed up
// and slow down. In the ring frame (shared/ring.ts): the rails bent all the way round like the shell (ring.ts), each
// carriage placed whole by the rigid ring motion at its own z. Instanced: a handful of draw calls for all of them.
// Out of reach (30 m up), so no collision; nothing here is in the sim.
import * as THREE from 'three/webgpu';
import { attribute, color, float, fract, hash, instanceIndex, smoothstep, uniform } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CREW_BLOCK, TERMINAL } from '../../../shared/levels/beginning.ts';
import { RING, ringMatrix } from '../../../shared/ring.ts';
import { boxGeometry } from '../boxLevel.ts';
import { CABLE, Carriages, RAILS, TRACKS, wrapZ, type Load } from './carriages.ts';
import { geometry, sheet, type Parts } from './ring.ts';

const Y = RAILS.y, H = RING.height, HALF = RAILS.span / 2;
/** The I-beam: its flanges' half width and thickness, the web's half width (m). */
const FLANGE = 0.16, FT = 0.04, WEB = 0.02;
/** Hangers (and the ties across a track's two rails) this far apart round the ring (m); rails bent in strips this long. */
const HANG = 10, STRIP = 4;
/** Where the hoist hangs its cables (the trolley's underside) and how far under the cable's end a load's top is (m). */
const PIVOT = Y - 1.6, SPREADER = 0.8;

const YELLOW = 0xc99a1e, DARK = 0x2b2f35, GREY = 0x5a6068, BLACK = 0x16181b;
type B = [number, number, number, number, number, number];

/** Boxes (x0, x1, y0, y1, z0, z1) with a colour each, merged into one geometry (position, normal, colour). */
function boxes(list: [B, number][]): THREE.BufferGeometry {
  const c = new THREE.Color();
  return mergeGeometries(list.map(([b, hex]) => {
    const g = new THREE.BoxGeometry(b[1] - b[0], b[3] - b[2], b[5] - b[4]).translate((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2);
    g.deleteAttribute('uv');
    c.set(hex);
    const n = g.getAttribute('position').count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }))!;
}

/** A carriage's frame in its own flat frame (x from its track's centre, y over the deck, z from its place on the ring):
 *  the end trucks round the rails' bottom flanges, the girders, the trolley and its hoist. */
function frameGeometry() {
  const list: [B, number][] = [];
  for (const sx of [-1, 1]) {
    const rx = sx * HALF;
    list.push([[rx - 0.3, rx + 0.3, Y - 0.55, Y - 0.06, -1.4, 1.4], YELLOW]); // the truck
    for (const zc of [-0.9, 0.9]) {
      // A bogie: side plates either side of the flange, wheels on it either side of the web.
      list.push([[rx - 0.27, rx - 0.21, Y - 0.1, Y + 0.3, zc - 0.25, zc + 0.25], DARK], [[rx + 0.21, rx + 0.27, Y - 0.1, Y + 0.3, zc - 0.25, zc + 0.25], DARK]);
      list.push([[rx - 0.14, rx - 0.04, Y + FT + 0.002, Y + 0.22, zc - 0.14, zc + 0.14], BLACK], [[rx + 0.04, rx + 0.14, Y + FT + 0.002, Y + 0.22, zc - 0.14, zc + 0.14], BLACK]);
    }
    for (const sz of [-1, 1]) list.push([[rx - 0.12, rx + 0.12, Y - 0.42, Y - 0.18, sz > 0 ? 1.4 : -1.55, sz > 0 ? 1.55 : -1.4], BLACK]); // buffers
  }
  for (const zc of [-0.75, 0.75]) list.push([[-HALF + 0.25, HALF - 0.25, Y - 1.0, Y - 0.5, zc - 0.15, zc + 0.15], YELLOW]); // girders
  list.push([[-0.65, 0.65, PIVOT, Y - 1.0, -0.55, 0.55], DARK]); // the trolley
  for (const x of [-0.4, 0.4]) for (const sz of [-1, 1]) list.push([[x - 0.1, x + 0.1, Y - 1.05, Y - 0.92, sz > 0 ? 0.55 : -0.62, sz > 0 ? 0.62 : -0.55], BLACK]);
  list.push([[-0.9, 0.9, Y - 1.45, Y - 1.15, -0.25, 0.25], GREY]); // the hoist's drum
  list.push([[0.9, 1.25, Y - 1.5, Y - 1.1, -0.2, 0.2], YELLOW]); // its motor
  return boxes(list);
}

/** What glows on a carriage, by kind: the amber beacons under the trucks' ends, the work lamp under the trolley. */
function beaconGeometry() {
  const list: [B, number][] = [];
  for (const rx of [-HALF, HALF]) for (const sz of [-1, 1]) list.push([[rx - 0.06, rx + 0.06, Y - 0.67, Y - 0.53, sz * 1.1 - 0.07, sz * 1.1 + 0.07], 0xffffff]);
  return boxes(list);
}
function lampGeometry() {
  return boxes([[[-0.25, 0.25, PIVOT - 0.03, PIVOT + 0.02, 0.25, 0.45], 0xffffff], [[-0.25, 0.25, PIVOT - 0.03, PIVOT + 0.02, -0.45, -0.25], 0xffffff]]);
}

/** The cables: two falls from the hoist, a unit long (y −1..0), stretched to their length. */
function cableGeometry() {
  return boxes([[[-0.14, -0.11, -1, 0, -0.015, 0.015], BLACK], [[0.11, 0.14, -1, 0, -0.015, 0.015], BLACK]]);
}

/** The hook block and the spreader beam along the ring under it (top at the cables' end). */
function hookGeometry() {
  return boxes([
    [[-0.22, 0.22, -0.45, 0, -0.12, 0.12], YELLOW],
    [[-0.04, 0.04, -0.7, -0.45, -0.04, 0.04], DARK],
    [[-0.06, 0.06, -SPREADER, -0.7, -0.62, 0.62], DARK],
  ]);
}

/** The loads, their tops at the spreader's underside: a rack on its straps, a container with yellow corner posts. */
function loadGeometry(load: Exclude<Load, 'none'>) {
  const straps: [B, number][] = [-0.5, 0.5].map((z) => [[-0.02, 0.02, -0.26, 0.01, z - 0.02, z + 0.02], GREY]);
  if (load === 'rack') {
    return boxes([
      ...straps,
      [[-0.3, 0.3, -2.65, -0.25, -0.6, 0.6], 0x1d2024],
      [[-0.27, 0.27, -2.6, -0.3, 0.6, 0.615], 0x3a3f46], // its door
      [[-0.27, 0.27, -2.6, -0.3, -0.615, -0.6], 0x30343a],
    ]);
  }
  const list: [B, number][] = [...straps, [[-0.9, 0.9, -1.5, -0.25, -0.7, 0.7], 0x3d5a73]];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) list.push([[sx * 0.84 - 0.06, sx * 0.84 + 0.06, -1.55, -0.21, sz * 0.66 - 0.06, sz * 0.66 + 0.06], YELLOW]);
  return boxes(list);
}

/** The rails and their hangers, all the way round, bent onto the ring. */
function railGeometry(): THREE.BufferGeometry[] {
  // The whole ring, its seam opposite the level (as the shell's).
  const mid = (CREW_BLOCK.z0 + TERMINAL.z1) / 2, S0 = mid - Math.PI * RING.radius, S1 = mid + Math.PI * RING.radius;
  const parts: Parts = { pos: [], nor: [], lpos: [], lnor: [], idx: [] };
  const rect = (x0: number, x1: number, y0: number, y1: number, ends: boolean) => {
    if (ends) {
      sheet(parts, (u, s) => [u, y0, s], [0, -1, 0], x0, x1, 1, S0, S1, STRIP);
      sheet(parts, (u, s) => [u, y1, s], [0, 1, 0], x0, x1, 1, S0, S1, STRIP);
    }
    sheet(parts, (u, s) => [x0, u, s], [-1, 0, 0], y0, y1, 1, S0, S1, STRIP);
    sheet(parts, (u, s) => [x1, u, s], [1, 0, 0], y0, y1, 1, S0, S1, STRIP);
  };
  const hangers: { b: number[]; zone: string }[] = [];
  for (const t of TRACKS) {
    for (const rx of [t.x - HALF, t.x + HALF]) {
      rect(rx - FLANGE, rx + FLANGE, Y, Y + FT, true);
      rect(rx - WEB, rx + WEB, Y + FT, Y + RAILS.h - FT, false);
      rect(rx - FLANGE, rx + FLANGE, Y + RAILS.h - FT, Y + RAILS.h, true);
    }
    for (let s = Math.ceil(S0 / HANG) * HANG; s < S1; s += HANG) {
      for (const rx of [t.x - HALF, t.x + HALF]) hangers.push({ b: [rx - 0.03, rx + 0.03, Y + RAILS.h - 0.02, H, s - 0.03, s + 0.03], zone: 'hall' });
      hangers.push({ b: [t.x - HALF, t.x + HALF, Y + RAILS.h + 0.02, Y + RAILS.h + 0.12, s - 0.04, s + 0.04], zone: 'hall' }); // the tie
    }
  }
  return [geometry(parts), boxGeometry(hangers, { hall: H }, true)];
}

/** Lit by what little reaches 30 m up, and a dim fill so they read against the dark ceiling (as the shell's). */
function steel(vertexColors: boolean, hex = 0x4a5058): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: vertexColors ? 0xffffff : hex, vertexColors, roughness: 0.5, metalness: 0.5 });
  const albedo = vertexColors ? (attribute('color', 'vec3') as unknown as ReturnType<typeof color>) : color(hex);
  m.emissiveNode = albedo.mul(0.16);
  return m;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class OverheadRails {
  readonly group = new THREE.Group();
  readonly carriages = new Carriages();
  private frame: THREE.InstancedMesh;
  private beacons: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  private cables: THREE.InstancedMesh;
  private hooks: THREE.InstancedMesh;
  private loads: Partial<Record<Load, THREE.InstancedMesh>> = {};
  private time = uniform(0);
  private m = new THREE.Matrix4();
  private p = new THREE.Matrix4();
  private t = new THREE.Matrix4();
  private s = new THREE.Matrix4();
  private ring: number[] = new Array(16).fill(0);

  constructor() {
    this.group.name = 'overhead-rails';
    const railMat = steel(false);
    for (const g of railGeometry()) {
      const mesh = new THREE.Mesh(g, railMat);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    const n = this.carriages.list.length, painted = steel(true);
    const inst = (g: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
      const mesh = new THREE.InstancedMesh(g, mat, n);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return mesh;
    };
    this.frame = inst(frameGeometry(), painted, 'carriage-frames');
    // The beacons turn (a pulse, each its own phase); the lamps burn.
    const beacon = new THREE.MeshBasicNodeMaterial();
    const phase = fract(this.time.mul(0.9).add(hash(instanceIndex)));
    beacon.colorNode = color(0xff8a3a).mul(smoothstep(0.35, 0.5, phase).mul(smoothstep(0.5, 0.65, phase).oneMinus()).mul(5).add(0.25));
    this.beacons = inst(beaconGeometry(), beacon, 'carriage-beacons');
    const lamp = new THREE.MeshBasicNodeMaterial();
    lamp.colorNode = color(0xfff2d8).mul(float(3));
    this.lamps = inst(lampGeometry(), lamp, 'carriage-lamps');
    this.cables = inst(cableGeometry(), painted, 'carriage-cables');
    this.hooks = inst(hookGeometry(), painted, 'carriage-hooks');
    for (const k of ['rack', 'crate'] as const) {
      const mesh = inst(loadGeometry(k), painted, `carriage-${k}s`);
      this.carriages.list.forEach((c, i) => c.load !== k && mesh.setMatrixAt(i, HIDDEN));
      this.loads[k] = mesh;
    }
    this.place();
  }

  /** Every frame: move them on (only while the stage is up: they wait while you're away) and place them. */
  update(dt: number, time: number) {
    this.carriages.step(dt);
    this.time.value = time;
    this.place();
  }

  private place() {
    const { m, p, t, s } = this;
    this.carriages.list.forEach((c, i) => {
      const z = wrapZ(c.z);
      // On the ring whole at its own z (exact there): the flat frame shifted to the track's centre and to z.
      m.fromArray(ringMatrix(z, this.ring)).multiply(t.makeTranslation(TRACKS[c.track].x, 0, z));
      this.frame.setMatrixAt(i, m);
      this.beacons.setMatrixAt(i, m);
      this.lamps.setMatrixAt(i, m);
      // The cables and what hangs on them, swung about the hoist.
      const len = CABLE + c.drop;
      p.copy(m).multiply(t.makeTranslation(0, PIVOT, 0)).multiply(t.makeRotationX(c.swing));
      this.cables.setMatrixAt(i, s.copy(p).multiply(t.makeScale(1, len, 1)));
      p.multiply(t.makeTranslation(0, -len, 0));
      this.hooks.setMatrixAt(i, p);
      const load = this.loads[c.load];
      if (load) load.setMatrixAt(i, s.copy(p).multiply(t.makeTranslation(0, -SPREADER, 0)));
    });
    for (const mesh of [this.frame, this.beacons, this.lamps, this.cables, this.hooks, ...Object.values(this.loads)]) mesh!.instanceMatrix.needsUpdate = true;
  }
}
