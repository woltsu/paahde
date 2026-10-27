// The solar farms (shared/solarfarms.ts): old power towers ringed by heliostats, far out in the desert. Built here from
// the same layout the physics collides with. The tower (shared geometry, its receiver's glow its own) is drawn from
// TOWER_DRAW_R away, a landmark over the dunes; the heliostat field and the shed from FIELD_DRAW_R.
//
// The field is cut into TILES × TILES tiles, each three instanced meshes (posts, the mirrors' frames with their drives,
// the mirror panels), so the camera and the shadow cascades cull them a tile at a time. Only the posts and the frames
// cast shadows (a frame is the whole mirror's outline); the panels are mirror-finished metal, dusted to the sand's colour
// in places, reflecting the sky (the desert's environment). The receiver glows when the sun comes round to where it
// stood when the farm froze (the hour its mirrors still aim for).
import * as THREE from 'three/webgpu';
import { abs, atan, cameraPosition, color, float, max, mix, normalWorld, positionLocal, positionWorld, reflect, sin, smoothstep, uniform, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BROKEN, farmLayout, FIELD, HELIO, SHED, solarFarmsNear, STOWED, TOWER, type Heliostat, type SolarFarm,
} from '../../shared/solarfarms.ts';
import { skyRadiance, sunDirection } from './env.ts';

/** Towers this close to the camera are drawn (m); their fields and sheds within FIELD_DRAW_R. Dropped a little further. */
const TOWER_DRAW_R = 5800, FIELD_DRAW_R = 2400, DROP_SLACK = 200;
/** Tiles across the field (each way). */
const TILES = 4;
const TILE = (2 * (FIELD.r1 + HELIO.hw)) / TILES;
/** How near the sun has to come to the hour the farm froze for its receiver to glow (dot of the two directions). */
const GLOW_FROM = 0.95, GLOW_FULL = 0.998;

const mat = (hex: number, roughness: number, metalness: number) => new THREE.MeshStandardNodeMaterial({ color: hex, roughness, metalness });

/** Weathered concrete: stained darker towards the sand, faint pour lines. */
function concrete(hex: number): THREE.MeshStandardNodeMaterial {
  const m = mat(hex, 0.95, 0);
  const y = positionLocal.y;
  m.colorNode = color(hex).mul(mix(float(0.7), float(1), smoothstep(0, 14, y))).mul(sin(y.mul(2.1)).mul(0.035).add(0.965));
  return m;
}

/** Mirror glass: the sky it faces (the desert's environment is too dim for a near-perfect mirror), seen along the
 *  reflected view ray, on top of a polished metal finish whose colour carries the dust (the instances' colours). */
function mirror(): THREE.MeshStandardNodeMaterial {
  const m = mat(0xdfe3e6, 0.12, 0.9);
  const r = reflect(positionWorld.sub(cameraPosition).normalize(), normalWorld);
  m.emissiveNode = skyRadiance(vec3(r.x, max(r.y, 0.03), r.z)).mul(0.5);
  return m;
}

/** A box from x0..x1, y0..y1, z0..z1. */
const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
  new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

type Glow = ReturnType<typeof uniform<'float'>>;
type Shown = { farm: SolarFarm; tower: THREE.Group; recv: THREE.Material; field: THREE.Group | null; glow: Glow };

export class SolarFarms {
  private group = new THREE.Group();
  private shown = new Map<number, Shown>();
  private lastScan = new THREE.Vector3(Infinity, 0, 0);
  private mats = {
    concrete: concrete(0xb3a089),
    steel: mat(0x5f5650, 0.55, 0.6),
    rust: mat(0x6e4a36, 0.8, 0.4),
    post: mat(0x8d8478, 0.65, 0.45),
    dark: mat(0x1c1714, 0.9, 0),
    mirror: mirror(),
  };
  private geo: {
    shaft: THREE.BufferGeometry; crown: THREE.BufferGeometry; recv: THREE.BufferGeometry; rails: THREE.BufferGeometry;
    door: THREE.BufferGeometry; post: THREE.BufferGeometry; frame: THREE.BufferGeometry; panel: THREE.BufferGeometry;
  };

  constructor(root: THREE.Object3D) {
    root.add(this.group);
    const { r, rTop, shaft, rRecv, recv0, recv1, top } = TOWER;
    // The tower: a flared foot with a collar, the tapering shaft, a platform under the receiver; the crown over it.
    const P = (x: number, y: number) => new THREE.Vector2(x, y);
    const shaftGeo = new THREE.LatheGeometry([
      P(0, -2), P(r + 1.6, -2), P(r + 1.6, 0.12), P(r + 0.5, 0.12), P(r + 0.5, 2.4), P(r, 2.8), P(rTop, shaft - 3),
      P(rTop + 2.4, shaft - 1.2), P(rTop + 2.4, shaft), P(0, shaft),
    ], 40);
    const crownGeo = new THREE.LatheGeometry([
      P(0, recv1), P(rRecv + 0.4, recv1), P(rRecv + 0.4, recv1 + 1.2), P(rRecv - 1.6, recv1 + 2.4), P(3.2, recv1 + 2.6),
      P(3.2, top - 0.6), P(1.2, top), P(0, top),
    ], 32);
    // The receiver: an open drum of tube panels (the stripes are the shader's), dark with soot.
    const recvGeo = new THREE.CylinderGeometry(rRecv, rRecv, recv1 - recv0, 64, 1, true).translate(0, (recv0 + recv1) / 2, 0);
    // Railings round the platform: a top rail and a mid rail.
    const rail = (y: number) => new THREE.TorusGeometry(rTop + 2.3, 0.06, 4, 64).rotateX(Math.PI / 2).translate(0, y, 0);
    const railsGeo = mergeGeometries([rail(shaft + 1.1), rail(shaft + 0.55)]);
    // A steel door in the tower's foot, facing the shed (+X here: turned to the road with the tower).
    const doorGeo = box(r + 0.35, r + 0.6, 0, 3.2, -1.3, 1.3);
    // A heliostat: its post (unit height, scaled to each), its mirror's frame (the whole outline, a truss behind it and the
    // drive at the pivot), and one of the mirror's four panels (local X along the tilt axis, Y up the mirror, Z its face).
    const postGeo = new THREE.CylinderGeometry(HELIO.r * 0.85, HELIO.r * 1.1, 1, 7, 1).translate(0, 0.5, 0);
    const { hw, hh } = HELIO;
    const frameGeo = mergeGeometries([
      box(-hw, hw, -hh, hh, -0.1, -0.03),
      box(-hw, hw, -0.12, 0.12, -0.3, -0.1),
      box(-0.12, 0.12, -hh, hh, -0.3, -0.1),
      box(-0.35, 0.35, -0.35, 0.35, -0.85, -0.3),
    ]);
    const panelGeo = box(-hw / 2 + 0.04, hw / 2 - 0.04, -hh / 2 + 0.04, hh / 2 - 0.04, -0.03, 0);
    this.geo = { shaft: shaftGeo, crown: crownGeo, recv: recvGeo, rails: railsGeo, door: doorGeo, post: postGeo, frame: frameGeo, panel: panelGeo };
  }

  /** The tower (and its receiver with its own glow), standing at the farm's centre. */
  private buildTower(f: SolarFarm): { g: THREE.Group; recv: THREE.Material; glow: Glow } {
    const g = new THREE.Group();
    const glow = uniform(0);
    const recv = mat(0x3b302a, 0.6, 0.5);
    // Vertical tubes round the drum, and the glow of the light the mirrors still throw at it.
    const tubes = abs(sin(atan(positionLocal.z, positionLocal.x).mul(110)));
    recv.colorNode = color(0x3b302a).mul(tubes.mul(0.45).add(0.55));
    recv.emissiveNode = color(1, 0.62, 0.3).mul(glow.mul(9)).mul(tubes.mul(0.3).add(0.7));
    const add = (geo: THREE.BufferGeometry, m: THREE.Material) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
    };
    add(this.geo.shaft, this.mats.concrete);
    add(this.geo.crown, this.mats.steel);
    add(this.geo.recv, recv);
    add(this.geo.rails, this.mats.steel);
    add(this.geo.door, this.mats.rust);
    g.position.set(f.x, f.y, f.z);
    g.rotation.y = Math.atan2(-f.rz, f.rx);
    this.freeze(g);
    return { g, recv, glow };
  }

  /** The heliostat field, tile by tile, and the shed. */
  private buildField(f: SolarFarm): THREE.Group {
    const g = new THREE.Group();
    const L = farmLayout(f);
    const tiles = new Map<number, Heliostat[]>();
    for (const h of L.helio) {
      const k = Math.floor((h.x + FIELD.r1 + HELIO.hw) / TILE) * TILES + Math.floor((h.z + FIELD.r1 + HELIO.hw) / TILE);
      const l = tiles.get(k);
      if (l) l.push(h);
      else tiles.set(k, [h]);
    }
    const m = new THREE.Matrix4(), basis = new THREE.Matrix4(), off = new THREE.Vector3(), c = new THREE.Color();
    const sand = new THREE.Color(0xd99a5c);
    // Dust and age per heliostat, from where it stands (the same every time it's built).
    const hash = (x: number, z: number) => {
      const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    for (const list of tiles.values()) {
      const mirrors = list.filter((h) => h.panels);
      let panels = 0;
      for (const h of mirrors) for (let q = 0; q < 4; q++) if (h.panels & (1 << q)) panels++;
      const posts = new THREE.InstancedMesh(this.geo.post, this.mats.post, list.length);
      const frames = new THREE.InstancedMesh(this.geo.frame, this.mats.rust, mirrors.length);
      const glass = new THREE.InstancedMesh(this.geo.panel, this.mats.mirror, panels);
      list.forEach((h, i) => {
        // Down into the sand a little, so a dig round it doesn't show it floating.
        m.makeScale(1, h.post + 1.2, 1).setPosition(h.x, -1.2, h.z);
        posts.setMatrixAt(i, m);
      });
      let p = 0;
      mirrors.forEach((h, i) => {
        basis.makeBasis(off.set(h.ux, 0, h.uz), new THREE.Vector3(h.vx, h.vy, h.vz), new THREE.Vector3(h.nx, h.ny, h.nz));
        basis.setPosition(h.x, HELIO.pivot, h.z);
        frames.setMatrixAt(i, basis);
        const dust = hash(h.x, h.z);
        for (let q = 0; q < 4; q++) {
          if (!(h.panels & (1 << q))) continue;
          m.makeTranslation((q & 1 ? 0.5 : -0.5) * HELIO.hw, (q & 2 ? 0.5 : -0.5) * HELIO.hh, 0).premultiply(basis);
          glass.setMatrixAt(p, m);
          // Dusted towards the sand's colour; broken ones grimier, stowed ones (face up) the dustiest.
          const d = 0.15 + 0.5 * dust * dust + (h.state === STOWED ? 0.25 : 0) + 0.1 * hash(h.z + q, h.x);
          c.setRGB(1, 1, 1).lerp(sand, Math.min(0.85, d));
          if (h.state === BROKEN) c.multiplyScalar(0.55);
          glass.setColorAt(p++, c);
        }
      });
      posts.castShadow = frames.castShadow = true;
      posts.receiveShadow = frames.receiveShadow = glass.receiveShadow = true;
      g.add(posts, frames, glass);
    }
    g.add(this.buildShed(f));
    g.position.set(f.x, f.y, f.z);
    this.freeze(g);
    for (const o of g.children) {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) im.computeBoundingSphere();
    }
    return g;
  }

  /** The shed: four broken-topped walls (the roof long gone), a doorway out along the road, a steel frame round it. */
  private buildShed(f: SolarFarm): THREE.Mesh {
    const { at, hw, hd, t, h, door } = SHED, a0 = at - hd, a1 = at + hd;
    const parts: THREE.BufferGeometry[] = [];
    let seed = (f.id * 2654435761) >>> 0;
    const r = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
    // A wall from (along, across) a to b, in pieces of ragged height.
    const wall = (xa: number, za: number, xb: number, zb: number) => {
      const len = Math.hypot(xb - xa, zb - za), n = Math.max(1, Math.round(len / 1.4));
      for (let i = 0; i < n; i++) {
        const u0 = i / n, u1 = (i + 1) / n, top = h - (r() < 0.45 ? r() * 1.4 : r() * 0.25);
        const x0 = xa + (xb - xa) * u0, x1 = xa + (xb - xa) * u1, z0 = za + (zb - za) * u0, z1 = za + (zb - za) * u1;
        parts.push(box(Math.min(x0, x1) - t / 2, Math.max(x0, x1) + t / 2, -0.4, top, Math.min(z0, z1) - t / 2, Math.max(z0, z1) + t / 2));
      }
    };
    wall(a0, -hw, a0, hw);
    wall(a0, -hw, a1, -hw);
    wall(a0, hw, a1, hw);
    wall(a1, -hw, a1, -door);
    wall(a1, door, a1, hw);
    // The lintel over the doorway still holds.
    parts.push(box(a1 - t / 2, a1 + t / 2, 2.4, 2.9, -door - 0.2, door + 0.2));
    const mesh = new THREE.Mesh(mergeGeometries(parts), this.mats.concrete);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.rotation.y = Math.atan2(-f.rz, f.rx);
    return mesh;
  }

  /** A field (and its shed) out of the scene, its instances and the shed's geometry freed. */
  private dropField(s: Shown) {
    if (!s.field) return;
    this.group.remove(s.field);
    for (const o of s.field.children) {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) im.dispose();
      else (o as THREE.Mesh).geometry.dispose();
    }
    s.field = null;
  }

  /** Matrices fixed once: nothing here moves. */
  private freeze(g: THREE.Object3D) {
    g.updateMatrixWorld(true);
    g.traverse((o) => (o.matrixAutoUpdate = false));
  }

  update(cam: THREE.Vector3) {
    if (cam.distanceToSquared(this.lastScan) > 50 * 50) {
      this.lastScan.copy(cam);
      const near = solarFarmsNear(cam.x, cam.z, TOWER_DRAW_R + DROP_SLACK);
      for (const f of near) {
        const d = Math.hypot(f.x - cam.x, f.z - cam.z);
        let s = this.shown.get(f.id);
        if (!s && d < TOWER_DRAW_R) {
          const { g, recv, glow } = this.buildTower(f);
          this.group.add(g);
          this.shown.set(f.id, (s = { farm: f, tower: g, recv, field: null, glow }));
        }
        if (!s) continue;
        if (!s.field && d < FIELD_DRAW_R) this.group.add((s.field = this.buildField(f)));
        else if (s.field && d > FIELD_DRAW_R + DROP_SLACK) this.dropField(s);
      }
      for (const [id, s] of this.shown) {
        if (near.some((f) => f.id === id)) continue;
        this.group.remove(s.tower);
        s.recv.dispose();
        this.dropField(s);
        this.shown.delete(id);
      }
    }
    // The receivers glow while the sun stands where it did when each farm froze.
    const sd = sunDirection.value;
    for (const s of this.shown.values()) {
      const f = s.farm, dot = sd.x * f.sx + sd.y * f.sy + sd.z * f.sz;
      s.glow.value = THREE.MathUtils.smoothstep(dot, GLOW_FROM, GLOW_FULL);
    }
  }
}
