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

/** The bays' levels up the lattice: tall at the foot, shorter towards the top. */
function bayLevels(): number[] {
  const ys = [0];
  for (let y = 0; y < TOWER.height - 1;) {
    y = Math.min(TOWER.height, y + Math.max(4.5, 10 - y * 0.05));
    if (TOWER.height - y < 3) y = TOWER.height;
    ys.push(y);
  }
  return ys;
}

/** The lattice: legs, a girt round each bay's top, X bracing on each face; and the mast over it. */
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
  const { at, half } = LADDER, x = at - half + 0.05, top = TOWER.height + 1.1;
  for (const z of [-0.22, 0.22]) parts.push(member(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, top, z), 0.03, 4));
  for (let y = 0.3; y < top; y += 0.3) parts.push(box(x - 0.02, x + 0.02, y - 0.015, y + 0.015, -0.22, 0.22));
  // The cage: hoops every 1.2 m from 2.4 m up, five straps up its length; none where it passes a deck.
  const hoop = new THREE.TorusGeometry(half - 0.02, 0.022, 3, 12, Math.PI * 1.4).rotateX(Math.PI / 2).rotateY(Math.PI * 0.3);
  for (let y = 2.4; y < top; y += 1.2) {
    if (DECKS.some((d) => y > d - 1.2 && y < d + 2)) continue;
    parts.push(hoop.clone().translate(at, y, 0));
  }
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * 0.3 - Math.PI / 2 + (i / 4) * Math.PI * 1.4 - Math.PI * 0.2;
    const sx = at + Math.cos(a) * (half - 0.02), sz = -Math.sin(a) * (half - 0.02);
    parts.push(box(sx - 0.02, sx + 0.02, 2.4, top - 1, sz - 0.04, sz + 0.04));
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

type Shown = {
  tower: Tower;
  frame: THREE.Group;
  detail: THREE.Group | null;
  lamp: THREE.Mesh;
  lampOn: ReturnType<typeof uniform<'float'>>;
  /** The big dish's pivot (its slot is the motor): slack, it hangs face down. */
  bigDish: THREE.Object3D | null;
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
    const mastGeo = mergeGeometries([
      new THREE.CylinderGeometry(MAST_R * 0.7, MAST_R, TOWER.mast, 8, 1, true).translate(0, TOWER.height + TOWER.mast / 2, 0),
      new THREE.CylinderGeometry(0.015, 0.03, 3, 4, 1, true).translate(0, LAMP_Y + 1.8, 0),
    ]);
    // The cabinet: a steel box, its door on the +a face standing open, a sunshade over it; the boxes on the decks.
    const { at, hw, hd, h } = CABINET;
    const cabinet = mergeGeometries([
      box(at - hd, at + hd, 0, h, -hw, hw),
      box(at - hd - 0.1, at + hd + 0.25, h + 0.25, h + 0.3, -hw - 0.15, hw + 0.15),
      box(at + hd, at + hd + 0.05, 0.1, h - 0.1, -hw, -hw + 0.06), // hinge side
      box(at + hd, at + hd + 0.04, 0.12, h - 0.15, -hw - 1.1, -hw), // the door, swung back
    ].map((g) => g.toNonIndexed()));
    const jbox = (a: number, y: number) => box(a - 0.2, a, y + 0.6, y + 1.5, -0.45, 0.45);
    const boxes = mergeGeometries([jbox(-legRadius(DECKS[DISH_DECK]) / 2 - 1.1, DECKS[DISH_DECK]), jbox(-legRadius(TOWER.height) / 2 - 2.6, TOWER.height)].map((g) => g.toNonIndexed()));
    this.geo = {
      lattice: latticeGeometry(),
      decks: mergeGeometries(DECKS.map((_, k) => deckGeometry(k).toNonIndexed())),
      rails: mergeGeometries(DECKS.map((_, k) => railGeometry(k))),
      ladder: ladderGeometry(),
      piers: mergeGeometries(piers),
      mast: mastGeo,
      dish: dishGeometry(1.3),
      bigDish: dishGeometry(1.7),
      panel: box(-0.18, 0.18, -1.4, 1.4, -0.07, 0.07),
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
  private buildFrame(t: Tower): Omit<Shown, 'detail' | 'bigDish' | 'dishAim'> {
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
    // Dishes in the drum covers, on the legs round the dish deck, facing out; some gone, some hanging off one bolt.
    for (let i = 0; i < 7; i++) {
      if (r() < 0.25) continue;
      const leg = i % 3, y = DECKS[DISH_DECK] - 12 + r() * 10 + (i > 3 ? 4 : 0);
      const p = legAt(leg, y), [a, b] = LEG_DIRS[leg];
      const turn = Math.atan2(a, b) + (r() - 0.5) * 1.6;
      const d = add(this.geo.dish, this.mats.dish);
      d.position.set(p.x + Math.sin(turn) * 1.1, y, p.z + Math.cos(turn) * 1.1);
      d.rotation.set(0, turn, 0);
      if (r() < 0.25) d.rotation.set(0.9 + r() * 0.5, turn, (r() - 0.5) * 0.8); // hanging
    }
    // The big dish on the dish deck: its pivot turns it (alive), or it hangs slack, face down.
    const pivot = new THREE.Group();
    const R = deckRadius(DISH_DECK) / 2;
    pivot.position.set(-R - 0.6, DECKS[DISH_DECK] + 2.4, 0);
    const big = add(this.geo.bigDish, this.mats.dish, pivot);
    big.position.z = 0.9;
    g.add(pivot);
    // Panel antennas round the top deck's rail, three to a face; some gone, some tilted.
    const RT = deckRadius(TOP_DECK);
    for (let i = 0; i < 3; i++) {
      const [a0, b0] = LEG_DIRS[i], [a1, b1] = LEG_DIRS[(i + 1) % 3];
      const nx = (a0 + a1) / 2, nz = (b0 + b1) / 2, nl = Math.hypot(nx, nz);
      for (let k = 0; k < 3; k++) {
        if (r() < 0.2) continue;
        const u = 0.3 + 0.2 * k, x = (a0 + (a1 - a0) * u) * RT, z = (b0 + (b1 - b0) * u) * RT;
        const p = add(this.geo.panel, this.mats.panel);
        p.position.set(x + (nx / nl) * 0.15, TOWER.height + 1.6, z + (nz / nl) * 0.15);
        p.rotation.set(r() < 0.2 ? (r() - 0.5) * 0.9 : 0, Math.atan2(nx, nz), 0);
      }
    }
    g.position.copy(s.frame.position);
    g.rotation.copy(s.frame.rotation);
    s.bigDish = pivot;
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
          s = { ...this.buildFrame(t), detail: null, bigDish: null, dishAim: 0 };
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
      if (s.bigDish) {
        // Alive: up and slowly searching round; else slack, its motor gone or nothing to drive it.
        const slack = !alive;
        const pitch = slack ? -1.25 : 0.15 * Math.sin(this.time * 0.07 + s.tower.seed * 9);
        s.dishAim += alive ? dt * 0.05 : 0;
        const k = 1 - Math.exp(-dt * 0.6);
        s.bigDish.rotation.x += (pitch - s.bigDish.rotation.x) * k;
        s.bigDish.rotation.y = alive ? Math.sin(s.dishAim) * 1.2 : s.bigDish.rotation.y;
        s.bigDish.updateMatrixWorld(true);
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
  }
}
