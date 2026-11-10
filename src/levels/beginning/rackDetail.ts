// Openable racks aboard the ring (the beginning's deck): F at a rack's front opens its door on what's inside. The hall's
// thousands of racks stay one instanced mesh (src/levels/boxLevel.ts) with their insides painted on the door by the rack
// shader; only a rack you open gets a model of its own: cabinet, rails, its door on hinges, and the modules in it
// (1U and 2U servers with vents or drive bays, 4U storage, blanking plates, a top-of-rack switch with its port lights,
// gaps where something was pulled), each with blinking status LEDs, a PDU and a cable bundle down the side. Its instance
// is hidden meanwhile (scaled to nothing) and comes back when the door is shut or you walk away. At most MAX are open;
// each is built on opening (a few dozen boxes merged into five meshes) and freed after. Client-only: the door has no
// collision and nothing is sent (the level is private).
import * as THREE from 'three/webgpu';
import { abs, attribute, color, float, fract, fwidth, max, min, mix, normalGeometry, positionGeometry, select, smoothstep, step, time, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Rack } from '../../../shared/levels/datacenter.ts';
import type { PlayerState } from '../../../shared/sim.ts';

type F = Node<'float'>;

/** Most racks open at once (the farthest shuts when one more opens). */
const MAX = 6;
/** Walk this far from an open rack and it shuts (m). */
const FORGET = 25;
/** Reach to a rack's front (m), and how squarely you must face it (cos of the angle). */
const REACH = 1.5;
const FACING = 0.6;
/** The door's swing (rad) and how long it takes (s). */
const SWING = 1.95;
const SWING_S = 0.7;
/** One rack unit (m). */
const U = 0.04445;

/** three's TSL `hash` (pcg, src/nodes/math/Hash.js) in JS: what the rack shader picks a rack's door and fill by. */
export function tslHash(seed: number): number {
  let s = Math.trunc(seed) >>> 0;
  s = (Math.imul(s, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return (((w >>> 22) ^ w) >>> 0) / 4294967296;
}

/** A merged set of boxes with a colour and a front-face pattern each (`pat`: 0 plain, 1 vent slots, 2 drive bays,
 *  3 switch ports), or an LED's colour and blink seed. */
class Boxes {
  pos: number[] = []; nor: number[] = []; col: number[] = []; pat: number[] = []; idx: number[] = [];
  add(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: THREE.Color, pat = 0) {
    const F: [number[], number[][]][] = [
      [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
      [[-1, 0, 0], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]],
      [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
      [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    ];
    for (const [n, q] of F) {
      const b = this.pos.length / 3;
      for (const v of q) {
        this.pos.push(v[0], v[1], v[2]);
        this.nor.push(n[0], n[1], n[2]);
        this.col.push(c.r, c.g, c.b);
        this.pat.push(pat);
      }
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('pat', new THREE.Float32BufferAttribute(this.pat, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Thin lines every `pitch` along `c`, faded to their average where they'd shimmer. */
function lines(c: F, pitch: number, width: number): F {
  const f = fract(c.div(pitch));
  const e = min(f, f.oneMinus()).mul(pitch);
  const line = float(1).sub(smoothstep(width, float(width).add(fwidth(e)), e));
  return mix(line, float((2 * width) / pitch), smoothstep(pitch * 0.2, pitch * 0.5, fwidth(c)));
}

type Mats = { shell: THREE.Material; parts: THREE.Material; leds: THREE.Material; door: Record<'perforated' | 'glass' | 'blank', THREE.Material> };

function makeMats(): Mats {
  const std = (hex: number, rough: number, metal = 0) => new THREE.MeshStandardNodeMaterial({ color: hex, roughness: rough, metalness: metal });
  const shell = std(0xffffff, 0.5, 0.3);
  shell.vertexColors = true;
  // Modules: their colour, and on their fronts the pattern their kind has.
  const parts = std(0xffffff, 0.45, 0.4);
  parts.vertexColors = true;
  {
    const p = positionGeometry, pat = attribute('pat', 'float') as unknown as F;
    const front = step(0.5, normalGeometry.z);
    const vent = lines(p.y, 0.006, 0.0015).mul(step(abs(p.x), 0.17));
    const bays = max(lines(p.x, 0.055, 0.003), lines(p.y, U, 0.002)).mul(step(abs(p.x), 0.2));
    const ports = step(0.4, fract(p.x.div(0.016))).mul(step(abs(p.y.sub(p.y.div(U).floor().mul(U)).sub(U * 0.5)), 0.006)).mul(step(abs(p.x), 0.19));
    const shade = select(pat.lessThan(0.5), float(0), select(pat.lessThan(1.5), vent, select(pat.lessThan(2.5), bays, ports)));
    parts.colorNode = attribute('color', 'vec3').mul(float(1).sub(shade.mul(front).mul(0.75)));
    // The aisle's light reaching in (the pool's few lights don't light every opened rack): a dim fill, stronger on the
    // fronts, falling off deeper in.
    parts.emissiveNode = (parts.colorNode as unknown as Node<'vec3'>).mul(front.mul(0.5).add(0.08).mul(smoothstep(-0.4, 0.5, p.z)));
  }
  // LEDs: their colour, blinking each at its own rate and phase (seeded by where it is).
  const leds = new THREE.MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.3 });
  {
    const p = positionGeometry;
    const seed = fract(p.x.mul(91.7).add(p.y.mul(57.3)).sin().mul(43758.5));
    const rate = mix(float(0.6), float(8), fract(seed.mul(7.1)));
    const on = step(fract(time.mul(rate).add(seed.mul(13))), mix(float(0.35), float(0.97), fract(seed.mul(3.3))));
    leds.colorNode = color(0x000000);
    leds.emissiveNode = attribute('color', 'vec3').mul(on.mul(0.85).add(0.15)).mul(5);
  }
  // Doors: perforated (dots of light through it, from the inside), smoked glass, or blank.
  const perforated = std(0x1b1d21, 0.5, 0.3);
  {
    const p = positionGeometry;
    const holes = lines(p.x, 0.008, 0.0016).mul(lines(p.y, 0.008, 0.0016));
    perforated.colorNode = mix(color(0x1b1d21), color(0x050506), holes.mul(4).min(1));
  }
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0x0a0c10, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.45, depthWrite: false });
  const blank = std(0x24272c, 0.45, 0.3);
  // (Seen from both sides: swung open, its inside faces you.)
  for (const m of [perforated, glass, blank]) m.side = THREE.DoubleSide;
  return { shell, parts, leds, door: { perforated, glass, blank } };
}

/** One open rack: its model in the rack's own frame (origin at its foot, front +z), the door on a hinge. */
class Detail {
  readonly group = new THREE.Group();
  readonly hinge = new THREE.Group();
  /** 0 shut .. 1 open, and where it's going. */
  open = 0;
  want = 1;
  private disposables: THREE.BufferGeometry[] = [];

  readonly index: number;

  constructor(index: number, matrix: THREE.Matrix4, h: number, mats: Mats) {
    this.index = index;
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(matrix);
    this.group.name = `rack-open-${index}`;
    const v = tslHash(index + 0.5), fill = tslHash(index + 7.5) * 0.6 + 0.3;
    const kind = v < 0.75 ? 'perforated' : v < 0.9 ? 'glass' : 'blank';
    let seed = (index * 2654435761) >>> 0;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const C = (hex: number) => new THREE.Color(hex);

    // The cabinet: sides, roof, plinth, back; the inside darker. Four rails at the front and back.
    const shell = new Boxes();
    const coat = C(0x1d1f23), inside = C(0x0b0c0e), rail = C(0x7d8288);
    shell.add(-0.3, -0.28, 0, h, -0.6, 0.58, coat);
    shell.add(0.28, 0.3, 0, h, -0.6, 0.58, coat);
    shell.add(-0.28, 0.28, h - 0.025, h, -0.6, 0.58, coat);
    shell.add(-0.28, 0.28, 0, 0.06, -0.6, 0.58, coat);
    shell.add(-0.28, 0.28, 0.06, h - 0.025, -0.6, -0.58, inside);
    for (const x of [-0.25, 0.235]) for (const [z0, z1] of [[0.5, 0.52], [-0.47, -0.45]]) shell.add(x, x + 0.015, 0.06, h - 0.025, z0, z1, rail);
    // A PDU down the back left, a cable bundle down the front right between the rail and the side.
    shell.add(-0.275, -0.255, 0.1, h - 0.1, -0.55, -0.5, C(0x2a2d31));
    shell.add(0.252, 0.276, 0.08, h - 0.05, 0.1, 0.4, C(0x15171a));

    // The modules, bottom to top, then the switch at the top.
    const parts = new Boxes(), leds = new Boxes();
    const green = C(0x39ff6a), amber = C(0xffb020), blue = C(0x3a8bff);
    const led = (x: number, y: number, c: THREE.Color) => leds.add(x - 0.0022, x + 0.0022, y - 0.0022, y + 0.0022, 0.5, 0.503, c);
    const top = h - 0.12 - U;
    let y = 0.1;
    while (y + U <= top) {
      const r = rand();
      const n = r < 0.4 ? 1 : r < 0.72 ? 2 : r < 0.8 ? 4 : r < 0.9 ? 1 : 1;
      if (y + n * U > top) break;
      const y0 = y + 0.0012, y1 = y + n * U - 0.0012;
      if (r >= 0.9 || rand() > fill + 0.25) {
        // A gap where something was pulled, or a blanking plate.
        if (r < 0.95) parts.add(-0.235, 0.235, y0, y1, 0.49, 0.5, C(0x2c2f34));
        y += n * U;
        continue;
      }
      const storage = n === 4, body = r < 0.4 ? C(0x767c84) : storage ? C(0x4e545c) : C(0x8a9098);
      // The chassis, its front bezel (ears onto the rails), its pattern.
      parts.add(-0.222, 0.222, y0, y1, -0.42, 0.485, C(0x2a2d31));
      parts.add(-0.24, 0.24, y0, y1, 0.485, 0.5, body, storage || n === 2 ? 2 : 1);
      // Status lights: power steady-ish and activity, on the right; drive lights along the bays.
      led(0.215, y + U * 0.5, green);
      led(0.205, y + U * 0.5, rand() < 0.85 ? green : amber);
      if (n >= 2) for (let k = 0; k < (storage ? 12 : 6); k++) led(-0.17 + (k % 6) * 0.055 + 0.02, y + U * (0.5 + Math.floor(k / 6) * 2), rand() < 0.9 ? green : amber);
      y += n * U;
    }
    // The top-of-rack switch: ports along it, each with its link light.
    const sy = h - 0.12 - U;
    parts.add(-0.222, 0.222, sy + 0.0012, sy + U - 0.0012, -0.3, 0.485, C(0x2a2d31));
    parts.add(-0.24, 0.24, sy + 0.0012, sy + U - 0.0012, 0.485, 0.5, C(0x6a7078), 3);
    for (let k = 0; k < 24; k++) if (rand() < 0.8) led(-0.184 + k * 0.016, sy + U * 0.85, rand() < 0.8 ? green : rand() < 0.5 ? amber : blue);

    // The door, hung on the left (seen from the front) at the front edge: a frame round its panel, a handle.
    this.hinge.position.set(-0.3, 0, 0.6);
    const frame = new Boxes();
    frame.add(0, 0.03, 0.02, h - 0.02, -0.02, 0, coat);
    frame.add(0.57, 0.6, 0.02, h - 0.02, -0.02, 0, coat);
    frame.add(0.03, 0.57, 0.02, 0.06, -0.02, 0, coat);
    frame.add(0.03, 0.57, h - 0.06, h - 0.02, -0.02, 0, coat);
    frame.add(0.515, 0.53, 0.9, 1.08, 0, 0.02, C(0x5a5f66));
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.54, h - 0.12).translate(0.3, h / 2, -0.01), mats.door[kind]);
    this.disposables.push(panel.geometry);

    const meshes: [THREE.BufferGeometry, THREE.Material, THREE.Object3D][] = [
      [shell.geometry(), mats.shell, this.group], [parts.geometry(), mats.parts, this.group], [leds.geometry(), mats.leds, this.group],
      [frame.geometry(), mats.shell, this.hinge],
    ];
    for (const [g, m, to] of meshes) {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = mesh.receiveShadow = true;
      to.add(mesh);
      this.disposables.push(g);
    }
    panel.castShadow = kind !== 'glass';
    this.hinge.add(panel);
    this.group.add(this.hinge);
  }

  /** Swing towards `want`; true while it moves. */
  step(dt: number): boolean {
    const was = this.open;
    this.open = this.want > this.open ? Math.min(1, this.open + dt / SWING_S) : Math.max(0, this.open - dt / SWING_S);
    const e = this.open * this.open * (3 - 2 * this.open);
    this.hinge.rotation.y = -SWING * e;
    this.group.updateMatrixWorld(true);
    return this.open !== was;
  }

  dispose() {
    this.group.removeFromParent();
    for (const g of this.disposables) g.dispose();
  }
}

/** The open racks of a box-built level: which one you're at, opening and shutting them, giving their instances back. */
export class OpenRacks {
  private open = new Map<number, Detail>();
  private mats = makeMats();
  private saved = new Map<number, THREE.Matrix4>();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  private root: THREE.Object3D;
  private mesh: THREE.InstancedMesh;
  private racks: readonly Rack[];
  private h: number;
  private sound: (opening: boolean) => void;

  /** `mesh`: the level's instanced racks (instance i is `racks[i]`), `h` their height; `sound` on a door opening or shutting. */
  constructor(root: THREE.Object3D, mesh: THREE.InstancedMesh, racks: readonly Rack[], h: number, sound: (opening: boolean) => void) {
    this.root = root;
    this.mesh = mesh;
    this.racks = racks;
    this.h = h;
    this.sound = sound;
  }

  /** The rack whose front you stand at, facing it (its index), or null. */
  at(me: PlayerState): number | null {
    const fx = -Math.sin(me.facing), fz = -Math.cos(me.facing);
    let best: number | null = null, bestD = REACH;
    for (let i = 0; i < this.racks.length; i++) {
      const r = this.racks[i];
      if (Math.abs(r.z - me.z) > 2.5 || Math.abs(r.x - me.x) > 1.5) continue;
      // In front of its door (on its face's side), within reach of the door's middle, looking at it.
      if ((me.z - r.z) * r.face < 0.6) continue;
      const px = r.x, pz = r.z + r.face * 0.6, dx = px - me.x, dz = pz - me.z, d = Math.hypot(dx, dz);
      if (d >= bestD || (d > 0.05 && (dx * fx + dz * fz) / d < FACING)) continue;
      best = i;
      bestD = d;
    }
    return best;
  }

  isOpen(i: number): boolean {
    const d = this.open.get(i);
    return !!d && d.want === 1;
  }

  toggle(i: number) {
    const d = this.open.get(i);
    if (d) {
      d.want = d.want === 1 ? 0 : 1;
      this.sound(d.want === 1);
      return;
    }
    if (this.open.size >= MAX) {
      // Room for one more: the one longest open goes.
      const first = this.open.keys().next().value!;
      this.shut(first);
    }
    const m = new THREE.Matrix4();
    this.mesh.getMatrixAt(i, m);
    this.saved.set(i, m.clone());
    const detail = new Detail(i, m, this.h, this.mats);
    this.root.add(detail.group);
    detail.step(0);
    this.open.set(i, detail);
    this.mesh.setMatrixAt(i, this.hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.sound(true);
  }

  /** Every frame: doors swing; a shut door, or a rack left behind, gives its instance back. */
  update(dt: number, me: { x: number; z: number }) {
    for (const [i, d] of this.open) {
      const r = this.racks[i];
      if (Math.hypot(r.x - me.x, r.z - me.z) > FORGET) d.want = 0;
      d.step(dt);
      if (d.want === 0 && d.open === 0) this.shut(i);
    }
  }

  private shut(i: number) {
    const d = this.open.get(i);
    if (!d) return;
    d.dispose();
    this.open.delete(i);
    this.mesh.setMatrixAt(i, this.saved.get(i)!);
    this.saved.delete(i);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Shut them all at once (leaving the level). */
  clear() {
    for (const i of [...this.open.keys()]) this.shut(i);
  }
}
