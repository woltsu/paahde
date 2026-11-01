// The radio towers (shared/towers.ts, docs/radiotowers.md): huge abandoned telecom towers, a triangular steel lattice
// tapering to the top deck 120 m up, drum-covered dishes two thirds up, panel antennas round the top deck, the mast with
// its aviation lamp over them and the radio's cabinet at the foot. Built here in code from the same numbers the physics
// collides with.
//
// Every tower's frame (lattice, decks, rails, ladder, mast) is the same geometry, shared; what differs per tower (the
// dishes and panels still hanging, the big dish slack or turning, the lamp, the cabinet's lamps) is its own. Drawn from
// TOWER_DRAW_R; its details (ladder, dishes, panels, cabinet) from DETAIL_R. Far off the lattice's members are widened to
// about a pixel (a vertex shader push along their normals by distance), so the tower still stands on the horizon as a
// thin dark spike, as a real one does; its lamp is scaled up with distance likewise, so it blinks from kilometres.
import * as THREE from 'three/webgpu';
import { color, float, max, mix, modelWorldMatrix, normalLocal, positionLocal, smoothstep, step, uniform, vec4 } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CABINET, DECKS, DISH_DECK, deckRadius, LADDER, LAMP_Y, LEG_DIRS, legRadius, MAST_R, RAIL, TOP_DECK, TOWER, towersNear,
  type Tower,
} from '../../shared/towers.ts';

/** Towers this close to the camera are drawn (m); their details within DETAIL_R. Dropped a little further. */
const TOWER_DRAW_R = 7000, DETAIL_R = 2200, DROP_SLACK = 200;
/** The members' widening with distance: at least this much radius per metre away (about a pixel's width). */
const WIDEN = 0.00055;
/** The lamp: its radius, and its least size per metre away. */
const LAMP_R = 0.35, LAMP_PER_M = 0.0016;

const mat = (hex: number, roughness: number, metalness: number) => new THREE.MeshStandardNodeMaterial({ color: hex, roughness, metalness });

/** A member (open cylinder) from a to b. */
function member(a: THREE.Vector3, b: THREE.Vector3, r: number, sides = 5): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** A box from x0..x1, y0..y1, z0..z1. */
const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
  new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

/** Leg i's point at height y (tower-local: x along the first leg, z across it). */
function legAt(i: number, y: number): THREE.Vector3 {
  const R = legRadius(y), [a, b] = LEG_DIRS[i];
  return new THREE.Vector3(a * R, y, b * R);
}

/** The height of the beams under deck k's grating (they carry it). */
const deckBeamY = (k: number) => DECKS[k] - 0.19;

/** The bays' levels up the lattice: tall at the foot, shorter towards the top. A level near a deck moves to just
 *  under it, so the girt there carries the deck (the legs end under the top deck). */
function bayLevels(): number[] {
  const ys = [0];
  for (let y = 0; y < TOWER.height - 1;) {
    y = Math.min(TOWER.height, y + Math.max(4.5, 10 - y * 0.05));
    if (TOWER.height - y < 3) y = TOWER.height;
    ys.push(y);
  }
  return ys.map((y) => {
    const k = DECKS.findIndex((d) => Math.abs(d - y) < 3);
    return k < 0 ? y : deckBeamY(k);
  });
}

/** The lattice: legs, a girt round each bay's top, X bracing on each face; the frames under the decks. */
function latticeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ys = bayLevels();
  for (let k = 0; k + 1 < ys.length; k++) {
    const y0 = ys[k], y1 = ys[k + 1];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      parts.push(member(legAt(i, y0 - (k ? 0 : 0.6)), legAt(i, y1), TOWER.legR * (1 - 0.35 * (y0 / TOWER.height)), 6));
      parts.push(member(legAt(i, y1), legAt(j, y1), 0.09));
      parts.push(member(legAt(i, y0), legAt(j, y1), 0.07));
      parts.push(member(legAt(j, y0), legAt(i, y1), 0.07));
    }
  }
  // Under each deck (its girt is the bay level there): a beam out from each leg to the deck's corner with a knee brace
  // up to it from the leg, beams along the deck's edges, and one out from each girt's middle to the edge's middle (a
  // knee to it from the girt below where the deck reaches far, the top deck's ring). Under the top deck, three beams
  // from the legs' tops carry the mast's foot.
  DECKS.forEach((_, k) => {
    const y = deckBeamY(k), R = deckRadius(k), top = k === TOP_DECK;
    const corner = (i: number) => new THREE.Vector3(LEG_DIRS[i][0] * R, y, LEG_DIRS[i][1] * R);
    const below = ys.filter((v) => v < y - 2).pop() ?? 0;
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3, leg = legAt(i, y), c = corner(i);
      parts.push(member(leg, c, 0.08));
      parts.push(member(legAt(i, y - (top ? 3.2 : 2)), c, 0.06));
      parts.push(member(c, corner(j), 0.07));
      const edgeMid = c.clone().add(corner(j)).multiplyScalar(0.5);
      parts.push(member(leg.clone().add(legAt(j, y)).multiplyScalar(0.5), edgeMid, 0.07));
      if (top) parts.push(member(legAt(i, below).add(legAt(j, below)).multiplyScalar(0.5), edgeMid, 0.06));
      if (top) parts.push(member(leg, new THREE.Vector3(0, y, 0), 0.09));
    }
  });
  // Concrete piers are their own mesh; the mast: a tube in bands (the shader paints them), a lightning rod.
  return mergeGeometries(parts);
}

/** A deck's grating: its triangle (circumradius R) with the hatch cut where the ladder comes through, or a solid
 *  triangle with no hatch (the top deck's roof over the mast's foot has none either: the ladder ends at it). */
function deckGeometry(k: number): THREE.BufferGeometry {
  const R = deckRadius(k), s = new THREE.Shape();
  LEG_DIRS.forEach(([a, b], i) => (i ? s.lineTo(a * R, b * R) : s.moveTo(a * R, b * R)));
  s.closePath();
  const h = new THREE.Path(), { at, half } = LADDER;
  h.moveTo(at - half, -half);
  h.lineTo(at + half, -half);
  h.lineTo(at + half, half);
  h.lineTo(at - half, half);
  h.closePath();
  s.holes.push(h);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
  // Shape (a, b) -> local (a, -0.12..0, b).
  g.rotateX(Math.PI / 2);
  g.translate(0, DECKS[k], 0);
  return g;
}

/** A deck's rails: a top and a mid rail along its edges, posts every couple of metres. */
function railGeometry(k: number): THREE.BufferGeometry {
  const R = deckRadius(k), y = DECKS[k], parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const [a0, b0] = LEG_DIRS[i], [a1, b1] = LEG_DIRS[(i + 1) % 3];
    const p = new THREE.Vector3(a0 * R, y, b0 * R), q = new THREE.Vector3(a1 * R, y, b1 * R);
    for (const h of [RAIL.h, RAIL.h / 2]) parts.push(member(p.clone().setY(y + h), q.clone().setY(y + h), RAIL.r, 4));
    const n = Math.ceil(p.distanceTo(q) / 2);
    for (let s = 0; s < n; s++) {
      const m = p.clone().lerp(q, s / n);
      parts.push(member(m, m.clone().setY(y + RAIL.h), RAIL.r, 4));
    }
  }
  return mergeGeometries(parts);
}

/** The ladder up the column (rungs on the side towards the axis), its cage hoops and straps. */
function ladderGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const { at, half } = LADDER, x = at - half + 0.05, top = TOWER.height + 1.1, w = 0.22;
  for (const z of [-w, w]) parts.push(member(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, top, z), 0.03, 4));
  for (let y = 0.3; y < top; y += 0.3) parts.push(box(x - 0.02, x + 0.02, y - 0.015, y + 0.015, -w, w));
  parts.push(member(new THREE.Vector3(x, top, -w), new THREE.Vector3(x, top, w), 0.03, 4)); // the grab bar over the top
  // At each deck a cleat under the hatch's edge holds each rail.
  for (const d of DECKS) for (const z of [-w, w]) parts.push(box(at - half - 0.07, x + 0.03, d - 0.4, d - 0.12, z - 0.04, z + 0.04));
  // The cage: hoops every 1.2 m from 2.4 m up, round the back from rail to rail; five straps up its length; no hoops
  // where it passes a deck. Hoop angle th (from +a, towards +b) is at (at + rho cos th, rho sin th).
  const rho = Math.hypot(at - x, w), th0 = Math.PI - Math.atan2(w, at - x), arc = 2 * th0;
  const hoop = new THREE.TorusGeometry(rho, 0.022, 3, 14, arc).rotateX(Math.PI / 2).rotateY(th0);
  const hoopYs: number[] = [];
  for (let y = 2.4; y < top; y += 1.2) if (!DECKS.some((d) => y > d - 1.2 && y < d + 2)) hoopYs.push(y);
  for (const y of hoopYs) parts.push(hoop.clone().translate(at, y, 0));
  const lastHoop = hoopYs[hoopYs.length - 1];
  for (let i = 1; i <= 5; i++) {
    const th = -th0 + (i / 6) * arc, sx = at + Math.cos(th) * rho, sz = Math.sin(th) * rho;
    parts.push(box(sx - 0.025, sx + 0.025, 2.4, lastHoop, sz - 0.025, sz + 0.025));
  }
  // Stand-off struts tie the cage to the legs at about each bay's level: one from each leg to the hoop there (to the
  // cage's back from the first leg, to its sides from the others).
  const ends = [new THREE.Vector3(at + rho, 0, 0), new THREE.Vector3(at, 0, rho), new THREE.Vector3(at, 0, -rho)];
  for (const yb of bayLevels().slice(1)) {
    const y = hoopYs.reduce((b, h) => (Math.abs(h - yb) < Math.abs(b - yb) ? h : b), hoopYs[0]);
    if (Math.abs(y - yb) > 1 || DECKS.some((d) => Math.abs(d - y) < 4)) continue;
    for (let i = 0; i < 3; i++) parts.push(member(legAt(i, y), ends[i].clone().setY(y), 0.045, 4));
  }
  return mergeGeometries(parts);
}

/** A drum-covered dish (a radome over a dish, as on the reference), facing +Z, radius r. */
function dishGeometry(r: number): THREE.BufferGeometry {
  const drum = new THREE.CylinderGeometry(r, r * 0.97, r * 0.42, 24, 1, false).rotateX(Math.PI / 2);
  const dome = new THREE.SphereGeometry(r * 1.6, 24, 4, 0, Math.PI * 2, 0, 0.67).rotateX(Math.PI / 2).translate(0, 0, r * 0.21 - r * 1.6 * Math.cos(0.67));
  const mount = box(-0.12, 0.12, -r * 0.6, r * 0.6, -r * 0.5, -r * 0.2);
  return mergeGeometries([drum.toNonIndexed(), dome.toNonIndexed(), mount.toNonIndexed()]);
}

/** A drum dish on a leg: its middle this far out from the leg's axis; its mount pipe this far out, the stand-off arms
 *  to it this far over and under the dish's middle. */
const DISH = { r: 1.3, out: 1.1, pipe: 0.39, arm: 0.6 };
/** The panels on the top deck's rail: their mount pipes' and their backs' distance out from the deck's edge, the lower
 *  and upper clamps' heights over the deck (the panel's foot is 0.3 m under the lower). */
const PANEL = { pipe: 0.09, back: 0.27, clamp: 0.5, clamp2: 2.6 };
/** The big dish: on a boom out from the second leg this far over the dish deck, its turntable this far out from the
 *  leg's axis, its elevation pin this far over the turntable. */
const BIG = { r: 1.7, y: 3, out: 2.1, pin: 0.4 };

/** A transform as a matrix: at p, turned `yaw` round the vertical (local +Z to (sin yaw, cos yaw)). */
const placed = (p: THREE.Vector3, yaw: number) => new THREE.Matrix4().makeRotationY(yaw).setPosition(p);

type Shown = {
  tower: Tower;
  frame: THREE.Group;
  detail: THREE.Group | null;
  lamp: THREE.Mesh;
  lampOn: ReturnType<typeof uniform<'float'>>;
  /** The big dish's elevation pivot (its slot is the motor): slack, it tips back. */
  bigDish: THREE.Object3D | null;
  /** The big dish's yoke on its turntable (turns it round), and its rest heading. */
  bigYaw: THREE.Object3D | null;
  bigYaw0: number;
  cabinetLit: ReturnType<typeof uniform<'float'>>;
  dishAim: number;
};


export class Towers {
  private group = new THREE.Group();
  private shown = new Map<number, Shown>();
  private lastScan = new THREE.Vector3(Infinity, 0, 0);
  private alive: ReadonlySet<number> = new Set();
  private camPos = uniform(new THREE.Vector3());
  private time = 0;
  private mats: Record<'steel' | 'grate' | 'concrete' | 'mast' | 'dish' | 'panel' | 'cabinet' | 'dark', THREE.Material>;
  private geo: {
    lattice: THREE.BufferGeometry; decks: THREE.BufferGeometry; rails: THREE.BufferGeometry; ladder: THREE.BufferGeometry;
    piers: THREE.BufferGeometry; mast: THREE.BufferGeometry; dish: THREE.BufferGeometry; bigDish: THREE.BufferGeometry;
    panel: THREE.BufferGeometry; cabinet: THREE.BufferGeometry; boxes: THREE.BufferGeometry; lamp: THREE.BufferGeometry;
  };

  constructor(root: THREE.Object3D) {
    this.group.name = 'towers';
    root.add(this.group);
    // Sun-bleached galvanised steel, darker and rust-streaked low down where the sand scours it.
    const steel = mat(0x8f8b84, 0.62, 0.55);
    const y = positionLocal.y;
    steel.colorNode = mix(color(0x6b5546), color(0x9a958c), smoothstep(0, 18, y));
    // Far off the members widen to about a pixel, along their normals by the vertex's distance from the camera (the
    // main camera's, a uniform, so the shadow pass widens them the same).
    const widen = (m: THREE.MeshStandardNodeMaterial, base: number) => {
      const d = this.camPos.distance(modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz);
      m.positionNode = positionLocal.add(normalLocal.mul(max(float(0), d.mul(WIDEN).sub(base))));
    };
    widen(steel, 0.07);
    const mast = mat(0xd8d0c2, 0.6, 0.3);
    // Aviation bands: red and white, seven of them up the mast.
    const band = step(0.5, positionLocal.y.sub(TOWER.height).div(TOWER.mast / 7).fract());
    mast.colorNode = mix(color(0xd9d1c3), color(0xa54a32), band);
    widen(mast, MAST_R);
    this.mats = {
      steel,
      grate: mat(0x77726a, 0.75, 0.5),
      concrete: mat(0xa89a86, 0.95, 0),
      mast,
      dish: mat(0xd6cfc0, 0.7, 0.05),
      panel: mat(0xdcd6ca, 0.65, 0.05),
      cabinet: mat(0x8c8a80, 0.7, 0.4),
      dark: mat(0x1d1a17, 0.9, 0),
    };
    const piers = LEG_DIRS.map((_, i) => {
      const p = legAt(i, 0);
      return new THREE.CylinderGeometry(0.75, 0.9, 1.6, 8).translate(p.x, -0.4, p.z);
    });
    // The mast stands on a flange bolted to the top deck, three gussets round its foot.
    const gussets = [0, 1, 2].map((i) => box(-0.025, 0.025, 0, 0.7, MAST_R - 0.03, MAST_R + 0.32).rotateY((i * Math.PI * 2) / 3 + Math.PI / 3).translate(0, TOWER.height, 0));
    const mastGeo = mergeGeometries([
      new THREE.CylinderGeometry(MAST_R * 0.7, MAST_R, TOWER.mast, 8, 1, true).translate(0, TOWER.height + TOWER.mast / 2, 0),
      new THREE.CylinderGeometry(0.015, 0.03, 3, 4, 1, true).translate(0, LAMP_Y + 1.8, 0),
      new THREE.CylinderGeometry(0.62, 0.62, 0.1, 10).translate(0, TOWER.height + 0.05, 0),
      ...gussets,
    ].map((g) => g.toNonIndexed()));
    // The cabinet: a steel box, its door on the +a face standing open, a sunshade on four short posts over it; the
    // boxes on the decks, each against the rail on the deck's far side from the ladder, standing on two feet.
    const { at, hw, hd, h } = CABINET;
    const post = (a: number, b: number) => box(a - 0.03, a + 0.03, h, h + 0.25, b - 0.03, b + 0.03);
    const cabinet = mergeGeometries([
      box(at - hd, at + hd, 0, h, -hw, hw),
      box(at - hd - 0.1, at + hd + 0.25, h + 0.25, h + 0.3, -hw - 0.15, hw + 0.15),
      ...[-1, 1].flatMap((sa) => [-1, 1].map((sb) => post(at + sa * (hd - 0.06), sb * (hw - 0.06)))),
      box(at + hd, at + hd + 0.05, 0.1, h - 0.1, -hw, -hw + 0.06), // hinge side
      box(at + hd, at + hd + 0.04, 0.12, h - 0.15, -hw - 1.1, -hw), // the door, swung back
    ].map((g) => g.toNonIndexed()));
    const jbox = (k: number) => {
      const y = DECKS[k], a = -deckRadius(k) / 2 + RAIL.r; // against the rail (the deck's edge, its inradius)
      return [
        box(a, a + 0.24, y + 0.35, y + 1.25, -0.45, 0.45),
        ...[-0.35, 0.35].map((b) => box(a + 0.05, a + 0.19, y, y + 0.35, b - 0.04, b + 0.04)),
      ];
    };
    const boxes = mergeGeometries([...jbox(DISH_DECK), ...jbox(TOP_DECK)].map((g) => g.toNonIndexed()));
    this.geo = {
      lattice: latticeGeometry(),
      decks: mergeGeometries(DECKS.map((_, k) => deckGeometry(k).toNonIndexed())),
      rails: mergeGeometries(DECKS.map((_, k) => railGeometry(k))),
      ladder: ladderGeometry(),
      piers: mergeGeometries(piers),
      mast: mastGeo,
      dish: dishGeometry(1.3),
      bigDish: dishGeometry(1.7),
      // A panel from its lower clamp (its pivot, on its back): 2.8 m tall, facing +Z.
      panel: box(-0.18, 0.18, -PANEL.clamp, 2.8 - PANEL.clamp, 0, 0.14),
      cabinet,
      boxes,
      lamp: new THREE.SphereGeometry(LAMP_R, 10, 6),
    };
  }

  /** The towers alive now (server/towers.ts). */
  setAlive(alive: ReadonlySet<number>) {
    this.alive = alive;
  }

  /** The frame (the same for every tower) and its lamp. */
  private buildFrame(t: Tower): Omit<Shown, 'detail' | 'bigDish' | 'bigYaw' | 'bigYaw0' | 'dishAim'> {
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    add(this.geo.lattice, this.mats.steel);
    add(this.geo.mast, this.mats.mast);
    add(this.geo.decks, this.mats.grate);
    add(this.geo.rails, this.mats.grate, false);
    add(this.geo.piers, this.mats.concrete);
    const lampOn = uniform(0);
    const lampMat = mat(0x3a1410, 0.4, 0);
    lampMat.emissiveNode = color(1, 0.12, 0.05).mul(lampOn.mul(14));
    const lamp = add(this.geo.lamp, lampMat, false);
    lamp.position.y = LAMP_Y;
    lamp.matrixAutoUpdate = true;
    const cabinetLit = uniform(0);
    g.position.set(t.x, t.y, t.z);
    g.rotation.y = Math.atan2(-t.uz, t.ux);
    g.updateMatrixWorld(true);
    g.traverse((o) => (o.matrixAutoUpdate = o === lamp));
    return { tower: t, frame: g, lamp, lampOn, cabinetLit };
  }

  /** The ladder, dishes, panels, cabinet and boxes; damaged by the tower's seed. */
  private buildDetail(s: Shown): THREE.Group {
    const t = s.tower, g = new THREE.Group();
    let seed = (Math.floor(t.seed * 4294967296) ^ t.id) >>> 0;
    const r = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = g) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    add(this.geo.ladder, this.mats.grate);
    add(this.geo.cabinet, this.mats.cabinet);
    add(this.geo.boxes, this.mats.cabinet);
    // The cabinet's lamps: three small dots on its door frame, lit while the tower is alive.
    const litMat = mat(0x1a2a1a, 0.5, 0);
    litMat.emissiveNode = color(0.3, 1, 0.4).mul(s.cabinetLit.mul(6));
    for (let i = 0; i < 3; i++) {
      const dot = add(new THREE.SphereGeometry(0.035, 6, 4), litMat);
      dot.position.set(CABINET.at + CABINET.hd + 0.02, CABINET.h - 0.25, -0.3 + i * 0.15);
    }
    // The steel the dishes and panels hang on (this tower's own, merged): pieces built in a local frame, then placed.
    const mounts: THREE.BufferGeometry[] = [];
    const mount = (m: THREE.Matrix4, ...geos: THREE.BufferGeometry[]) => geos.forEach((geo) => mounts.push(geo.toNonIndexed().applyMatrix4(m)));
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    // Dishes in the drum covers on the legs under the dish deck, in rows (three to a row, one to a leg), each on a
    // pipe held out from its leg by two arms, facing out; some gone (the pipe left), some hanging off the upper arm,
    // swung round on it.
    for (let i = 0; i < 7; i++) {
      const gone = r() < 0.25;
      const leg = i % 3, y = DECKS[DISH_DECK] - 3.4 - Math.floor(i / 3) * 3 - r() * 0.5;
      const [a, b] = LEG_DIRS[leg], off = (r() - 0.5) * 1.0, turn = Math.atan2(a, b) + off;
      const hang = !gone && r() < 0.25;
      const m = placed(legAt(leg, y), turn), { r: dr, out, pipe, arm } = DISH;
      mount(m, member(V(0, -dr * 0.65, pipe), V(0, dr * 0.65, pipe), 0.06, 5), member(V(0, arm, 0), V(0, arm, pipe), 0.05, 4));
      if (!hang) mount(m, member(V(0, -arm, 0), V(0, -arm, pipe), 0.05, 4));
      if (gone) continue;
      if (!hang) {
        add(this.geo.dish, this.mats.dish).applyMatrix4(m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, out)));
        continue;
      }
      // Hanging off the upper arm's clamp: swung round the pipe away from the lattice's faces, drooping a little.
      const pivot = new THREE.Group();
      pivot.position.copy(V(0, arm, pipe).applyMatrix4(m));
      pivot.rotation.order = 'YXZ';
      pivot.rotation.set(0.1 + r() * 0.2, turn - Math.sign(off || 1) * (0.8 + r() * 0.4), (r() - 0.5) * 0.5);
      add(this.geo.dish, this.mats.dish, pivot).position.set(0, -arm, out - pipe);
      g.add(pivot);
    }
    // The big dish over the dish deck: on a turntable at the end of a boom from the second leg, a knee brace under it
    // from the leg at the deck. Its yoke turns it round, its pin tips it: alive it searches, slack it tips back.
    const bigLeg = 1, [ba, bb] = LEG_DIRS[bigLeg], yawBig = Math.atan2(ba, bb), by = DECKS[DISH_DECK] + BIG.y;
    const foot = legAt(bigLeg, by), table = foot.clone().add(V(ba * BIG.out, 0, bb * BIG.out));
    mount(new THREE.Matrix4(),
      member(foot, table, 0.1, 6), member(legAt(bigLeg, DECKS[DISH_DECK] + 0.3), table.clone().setY(by - 0.08), 0.07, 5),
      new THREE.CylinderGeometry(0.3, 0.3, 0.15, 10).translate(table.x, by + 0.075, table.z));
    const yoke = new THREE.Group();
    yoke.position.set(table.x, by + 0.15, table.z);
    yoke.rotation.y = yawBig;
    add(mergeGeometries([
      box(-0.22, 0.22, 0, 0.08, -0.18, 0.18), box(-0.22, -0.14, 0, BIG.pin + 0.1, -0.12, 0.12), box(0.14, 0.22, 0, BIG.pin + 0.1, -0.12, 0.12),
      new THREE.CylinderGeometry(0.07, 0.07, 0.6, 6).rotateZ(Math.PI / 2).translate(0, BIG.pin, 0),
    ].map((geo) => geo.toNonIndexed())), this.mats.grate, yoke);
    const pivot = new THREE.Group();
    pivot.position.y = BIG.pin;
    add(this.geo.bigDish, this.mats.dish, pivot).position.z = 0.9;
    yoke.add(pivot);
    g.add(yoke);
    // Panel antennas round the top deck's rail, three to a face, each clamped to a pipe that's clamped to the rail;
    // some gone (the pipe left), some tipped out off a broken upper clamp.
    const RT = deckRadius(TOP_DECK);
    for (let i = 0; i < 3; i++) {
      const [a0, b0] = LEG_DIRS[i], [a1, b1] = LEG_DIRS[(i + 1) % 3];
      const nx = (a0 + a1) / 2, nz = (b0 + b1) / 2, yawN = Math.atan2(nx, nz);
      for (let k = 0; k < 3; k++) {
        const gone = r() < 0.2;
        const u = 0.3 + 0.2 * k, edge = V((a0 + (a1 - a0) * u) * RT, TOWER.height, (b0 + (b1 - b0) * u) * RT);
        const tilt = !gone && r() < 0.2 ? 0.15 + r() * 0.3 : 0;
        const m = placed(edge, yawN), clamp = (y: number) => box(-0.05, 0.05, y - 0.04, y + 0.04, PANEL.pipe - 0.03, PANEL.back);
        mount(m, member(V(0, -0.35, PANEL.pipe), V(0, 3.1, PANEL.pipe), 0.04, 5), clamp(PANEL.clamp));
        if (!tilt && !gone) mount(m, clamp(PANEL.clamp2));
        if (gone) continue;
        const p = add(this.geo.panel, this.mats.panel);
        p.position.copy(V(0, PANEL.clamp, PANEL.back).applyMatrix4(m));
        p.rotation.order = 'YXZ';
        p.rotation.set(tilt, yawN, 0);
      }
    }
    add(mergeGeometries(mounts), this.mats.grate);
    g.position.copy(s.frame.position);
    g.rotation.copy(s.frame.rotation);
    s.bigDish = pivot;
    s.bigYaw = yoke;
    s.bigYaw0 = yawBig;
    return g;
  }

  update(cam: THREE.Vector3, dt: number) {
    this.camPos.value.copy(cam);
    this.time += dt;
    if (cam.distanceToSquared(this.lastScan) > 60 * 60) {
      this.lastScan.copy(cam);
      const near = towersNear(cam.x, cam.z, TOWER_DRAW_R + DROP_SLACK);
      for (const t of near) {
        const d = Math.hypot(t.x - cam.x, t.z - cam.z);
        let s = this.shown.get(t.id);
        if (!s && d < TOWER_DRAW_R) {
          s = { ...this.buildFrame(t), detail: null, bigDish: null, bigYaw: null, bigYaw0: 0, dishAim: 0 };
          this.group.add(s.frame);
          this.shown.set(t.id, s);
        }
        if (!s) continue;
        if (!s.detail && d < DETAIL_R) this.group.add((s.detail = this.buildDetail(s)));
        else if (s.detail && d > DETAIL_R + DROP_SLACK) this.dropDetail(s);
        // Shadows only near: a 140 m lattice in every cascade costs.
        for (const o of s.frame.children) o.castShadow = d < 900 && o !== s.lamp && (o as THREE.Mesh).geometry !== this.geo.rails;
      }
      for (const [id, s] of this.shown) {
        if (near.some((t) => t.id === id)) continue;
        this.group.remove(s.frame);
        this.dropDetail(s);
        this.shown.delete(id);
      }
    }
    for (const s of this.shown.values()) {
      const alive = this.alive.has(s.tower.id);
      // The lamp: a slow blink, alive; scaled up with distance so it shows from far off.
      const d = cam.distanceTo(s.frame.position) + LAMP_Y;
      s.lamp.scale.setScalar(Math.max(1, (d * LAMP_PER_M) / LAMP_R));
      s.lamp.updateMatrix();
      s.lamp.updateMatrixWorld();
      const phase = (this.time + s.tower.seed * 7) % 2.2;
      s.lampOn.value = alive ? (phase < 0.9 ? 1 : 0) : 0;
      s.cabinetLit.value = alive ? 1 : 0;
      if (s.bigDish && s.bigYaw) {
        // Alive: up and slowly searching round; else slack, its motor gone or nothing to drive it.
        const slack = !alive;
        const pitch = slack ? -1.25 : 0.15 * Math.sin(this.time * 0.07 + s.tower.seed * 9);
        s.dishAim += alive ? dt * 0.05 : 0;
        const k = 1 - Math.exp(-dt * 0.6);
        s.bigDish.rotation.x += (pitch - s.bigDish.rotation.x) * k;
        if (alive) s.bigYaw.rotation.y = s.bigYaw0 + Math.sin(s.dishAim) * 0.7;
        s.bigYaw.updateMatrixWorld(true);
      }
    }
  }

  private dropDetail(s: Shown) {
    if (!s.detail) return;
    this.group.remove(s.detail);
    s.detail.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !Object.values(this.geo).includes(m.geometry)) m.geometry.dispose();
    });
    s.detail = null;
    s.bigDish = null;
    s.bigYaw = null;
  }
}
