// What the heavy guns do where their beams stop (shared/rifle.ts; src/rifle.ts fires them, for everyone near). Purely
// visual; the damage is the server's.
// - The blaster's burst, sized to BLAST_R: a white-hot fireball going orange and red as it swells, a shock ring out to
//   the burst's reach along the surface struck, the shots' one light (src/world/zaps.ts `light`: no light is added),
//   sparks and smoke, sand thrown up all round on the dunes (src/tyreDust.ts), and a scorch left where it hit the
//   ground or a wall.
// - The graviton pistol's end point: a black hole with a violet halo that swells for an instant and then caves in on
//   itself, sucking violet motes in from all round, and a violet ring breaking outward as it closes.
// - The piercer's slug: at the muzzle a quick pale shock ring, the brake's smoke and the sand kicked up under a low
//   barrel; where it stops, punched through a walker's plate, sparks out of both sides and a spray of molten metal
//   (most of it blown on through), a puff of sand on the dunes, sparks, dust and a small scorch on rock and concrete.
// They shake the view by how near they are (`shake`, read by src/camera.ts `rumble` through main.ts).
//
// Pools, made once (no materials per shot): FIREBALLS, RINGS, SCORCHES and HOLES meshes each with its own uniforms,
// and instanced sprite pools for the motes and the molten metal.
import * as THREE from 'three/webgpu';
import { abs, dot, float, length, mix, mx_noise_float, normalView, positionGeometry, positionViewDirection, pow, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { BLAST_R } from '../../shared/rifle.ts';
import { tyreDust } from '../tyreDust.ts';
import { groundAt } from '../ground.ts';
import { SpritePool, zaps } from './zaps.ts';

const FIREBALLS = 4, RINGS = 6, SCORCHES = 10, HOLES = 3, MOTES = 256, MOLTEN = 160;
/** The fireball: lives FIRE_S, swells to FIRE_R m across (radius). */
const FIRE_S = 0.55, FIRE_R = BLAST_R * 0.7;
/** The shock ring: out to the burst's reach in RING_S. */
const RING_S = 0.32;
/** A scorch: SCORCH_R m across (radius), there SCORCH_S s, fading over the last SCORCH_FADE. */
const SCORCH_R = 1.5, SCORCH_S = 25, SCORCH_FADE = 6;
/** The graviton's hole: swells to HOLE_R m in HOLE_GROW s, then caves in by HOLE_S. */
const HOLE_R = 1.6, HOLE_GROW = 0.08, HOLE_S = 0.5;
/** The view shakes within SHAKE_NEAR m at full (× the burst's `shake`), fading to nothing at SHAKE_FAR m. */
const SHAKE_NEAR = 4, SHAKE_FAR = 40;

const c3 = (u: unknown) => u as Node<'vec3'>;
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const ball = new THREE.IcosahedronGeometry(1, 3);
const quad = new THREE.PlaneGeometry(2, 2);

type Slot = { mesh: THREE.Object3D; fade: { value: number }; age: number; life: number; size: number };

/** Where on the sprite's disc: 0 centre .. 1 edge. */
const disc = () => length(uv().sub(0.5)).mul(2);
/** Facing the camera 1 .. edge-on 0. */
const facing = () => abs(dot(normalView, positionViewDirection));

class Blasts {
  readonly root = new THREE.Group();
  /** How hard the view shakes now, 0..1 (src/camera.ts `rumble`, through main.ts). */
  shake = 0;
  private camera: THREE.Camera | null = null;
  private fires: (Slot & { heat: { value: number } })[] = [];
  private rings: (Slot & { color: { value: THREE.Color } })[] = [];
  private scorches: Slot[] = [];
  private holes: (Slot & { rim: THREE.Mesh; ring: boolean; at: THREE.Vector3; normal: THREE.Vector3 })[] = [];
  private motes: SpritePool;
  private molten: SpritePool;

  constructor() {
    this.root.name = 'Blasts';
    for (let i = 0; i < FIREBALLS; i++) {
      // Lumpy, churning, white-hot inside and orange to dark red at the rim; going redder as it cools (`heat`).
      const fade = uniform(0), heat = uniform(1), seed = i * 7.3;
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      m.positionNode = positionGeometry.mul(mx_noise_float(positionGeometry.mul(1.8).add(seed)).mul(0.35).add(1));
      const churn = mx_noise_float(positionGeometry.mul(3.2).add(vec3(seed, heat.mul(-3), seed * 0.5))).mul(0.5).add(0.5);
      const f = facing();
      const hot = vec3(9, 6, 2.6), warm = vec3(2.6, 0.75, 0.12), cold = vec3(0.6, 0.08, 0.02);
      m.colorNode = mix(mix(cold, warm, heat), hot, pow(f, float(2)).mul(heat).mul(churn.add(0.3)));
      m.opacityNode = smoothstep(0.05, 0.6, f).mul(churn.mul(0.7).add(0.45)).mul(fade);
      const mesh = new THREE.Mesh(ball, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.root.add(mesh);
      this.fires.push({ mesh, fade, heat, age: 1, life: FIRE_S, size: FIRE_R });
    }
    for (let i = 0; i < RINGS; i++) {
      // A thin bright band at the edge of a flat disc, a little lumpy, flat on the surface struck.
      const fade = uniform(0), color = uniform(new THREE.Color());
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const d = disc().add(mx_noise_float(vec3(uv().mul(9), i)).mul(0.04));
      m.colorNode = c3(color);
      m.opacityNode = smoothstep(0.6, 0.94, d).mul(float(1).sub(smoothstep(0.94, 1, d))).mul(fade);
      const mesh = new THREE.Mesh(quad, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.root.add(mesh);
      this.rings.push({ mesh, fade, color, age: 1, life: RING_S, size: BLAST_R });
    }
    for (let i = 0; i < SCORCHES; i++) {
      // Soot: dark in the middle, a ragged edge.
      const fade = uniform(0);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const d = disc().add(mx_noise_float(vec3(uv().mul(5), i * 3.1)).mul(0.3));
      m.colorNode = vec3(0.025, 0.02, 0.016);
      m.opacityNode = float(1).sub(smoothstep(0.25, 0.95, d)).mul(0.8).mul(fade);
      const mesh = new THREE.Mesh(quad, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.scorches.push({ mesh, fade, age: 1, life: SCORCH_S, size: SCORCH_R });
    }
    for (let i = 0; i < HOLES; i++) {
      // A black ball, softly edged, in a violet halo that flickers like something bent around it.
      const fade = uniform(0), seed = i * 5.1;
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      m.colorNode = vec3(0.006, 0, 0.014);
      m.opacityNode = smoothstep(0.1, 0.6, facing()).mul(fade);
      const mesh = new THREE.Mesh(ball, m);
      mesh.renderOrder = 3;
      const rm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const flicker = mx_noise_float(positionGeometry.mul(4).add(vec3(seed, fade.mul(23), 0))).mul(0.6).add(0.8);
      rm.colorNode = vec3(1.6, 0.35, 4.2);
      rm.opacityNode = pow(float(1).sub(facing()), float(2.5)).mul(flicker).mul(fade);
      const rim = new THREE.Mesh(ball, rm);
      rim.renderOrder = 2;
      const g = new THREE.Group();
      g.add(rim, mesh);
      g.visible = false;
      g.traverse((o) => (o.frustumCulled = false));
      this.root.add(g);
      this.holes.push({ mesh: g, rim, fade, age: 1, life: HOLE_S, size: HOLE_R, ring: false, at: new THREE.Vector3(), normal: new THREE.Vector3() });
    }
    // Motes falling into the hole: violet sparks, brightest as they arrive.
    this.motes = new SpritePool(MOTES, (m, d) => {
      const r = disc();
      m.colorNode = vec3(1.4, 0.4, 3.6).mul(d.x);
      m.opacityNode = float(1).sub(smoothstep(0.1, 1, r));
      m.scaleNode = vec2(d.y, d.y);
    }, true);
    this.root.add(this.motes.sprite);
    // Molten metal torn out by the piercer's slug: white-yellow drops cooling to orange and dull red, lying glowing a
    // moment where they land.
    this.molten = new SpritePool(MOLTEN, (m, d) => {
      const r = disc(), heat = d.x;
      m.colorNode = vec3(6, 3.4, 1.2).mul(heat.mul(heat).mul(heat)).add(vec3(2.2, 0.55, 0.08).mul(heat));
      m.opacityNode = float(1).sub(smoothstep(0.25, 1, r)).mul(smoothstep(0, 0.12, heat));
      m.scaleNode = vec2(d.y, d.y);
    }, true);
    this.root.add(this.molten.sprite);
  }

  /** The camera the shake is measured from. */
  setCamera(camera: THREE.Camera) {
    this.camera = camera;
  }

  private take<T extends Slot>(pool: T[]): T {
    let best = pool[0];
    for (const s of pool) if (s.age / s.life > best.age / best.life) best = s;
    best.age = 0;
    best.mesh.visible = true;
    return best;
  }

  /** Lay `mesh` flat on the surface at (x, y, z) facing (nx, ny, nz), `lift` m off it. */
  private flat(mesh: THREE.Object3D, x: number, y: number, z: number, n: THREE.Vector3, lift: number) {
    mesh.position.set(x, y, z).addScaledVector(n, lift);
    mesh.quaternion.setFromUnitVectors(Z, n);
    mesh.rotateZ(Math.random() * Math.PI * 2);
  }

  private shakeFrom(x: number, y: number, z: number, k: number) {
    if (!this.camera) return;
    const d = this.camera.getWorldPosition(_v).distanceTo(_n.set(x, y, z));
    const near = 1 - Math.min(1, Math.max(0, (d - SHAKE_NEAR) / (SHAKE_FAR - SHAKE_NEAR)));
    this.shake = Math.min(1, Math.max(this.shake, k * near * near));
  }

  /**
   * The blaster's burst at (x, y, z) on a surface facing (nx, ny, nz). `on`: what it struck (the sand throws up dust,
   * the sand and walls keep a scorch; nothing, in the air at the beam's reach, still bursts).
   */
  blaster(x: number, y: number, z: number, nx: number, ny: number, nz: number, on: 'sand' | 'hard' | 'enemy' | 'air') {
    const n = _b.set(nx, ny, nz).normalize();
    const f = this.take(this.fires);
    f.mesh.position.set(x, y, z).addScaledVector(n, 0.5);
    f.mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    const r = this.take(this.rings);
    r.color.value.setRGB(2.4, 1.3, 0.55);
    r.life = RING_S;
    r.size = BLAST_R * 1.05;
    this.flat(r.mesh, x, y, z, on === 'air' || on === 'enemy' ? _v.set(0, 1, 0) : n, 0.15);
    zaps.light(x + n.x * 1.2, y + n.y * 1.2, z + n.z * 1.2, 0xffa050, 700, BLAST_R * 6, 0.4);
    zaps.burst(x, y, z, n.x, n.y, n.z, 44, 3);
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 1.6;
      zaps.puff(x + Math.cos(a) * s, y + 0.4 + Math.random(), z + Math.sin(a) * s, 1.4 + Math.random() * 1.2, 1.5 + Math.random() * 1.5);
    }
    if (on === 'sand') {
      // A ring of sand thrown out and up, and a column of it in the middle.
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3, v = 4 + Math.random() * 5;
        tyreDust.emit(x, y + 0.2, z, Math.cos(a) * v, 1.5 + Math.random() * 3, Math.sin(a) * v, 0.9 + Math.random() * 0.9, 2.5 + Math.random() * 2);
      }
      for (let i = 0; i < 6; i++) tyreDust.emit(x, y + 0.3, z, (Math.random() - 0.5) * 2, 5 + Math.random() * 6, (Math.random() - 0.5) * 2, 1.2 + Math.random(), 3 + Math.random() * 2);
    }
    if (on === 'sand' || on === 'hard') {
      const s = this.take(this.scorches);
      s.size = SCORCH_R * (0.8 + Math.random() * 0.4);
      this.flat(s.mesh, x, y, z, n, on === 'sand' ? 0.04 : 0.02);
    }
    this.shakeFrom(x, y, z, 0.9);
  }

  /** The graviton beam's end at (x, y, z), off a surface facing (nx, ny, nz). */
  graviton(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
    const n = _b.set(nx, ny, nz).normalize();
    const h = this.take(this.holes);
    h.at.set(x, y, z).addScaledVector(n, 0.4);
    h.normal.copy(n);
    h.ring = false;
    h.mesh.position.copy(h.at);
    h.mesh.scale.setScalar(0.01);
    zaps.light(h.at.x, h.at.y, h.at.z, 0x9a5cff, 260, 18, HOLE_S);
    // Motes from all round, arriving as it closes.
    for (let i = 0; i < 40; i++) {
      _v.randomDirection();
      const r = 2.5 + Math.random() * 2.5, life = HOLE_S * (0.6 + Math.random() * 0.4);
      this.motes.add(h.at.x + _v.x * r, h.at.y + _v.y * r, h.at.z + _v.z * r, -_v.x * r / life, -_v.y * r / life, -_v.z * r / life, 0.05 + Math.random() * 0.08, life);
    }
    this.shakeFrom(x, y, z, 0.5);
  }

  /**
   * The piercer going off at its muzzle (x, y, z), fired along (dx, dy, dz): a quick pale shock ring round the barrel,
   * the brake's smoke thrown out to the sides, and the sand under it kicked up when the muzzle is low over it.
   * `drawn`: the gun is drawn there (not looking through the scope, where ring and smoke would blind you).
   */
  piercerMuzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number, drawn: boolean) {
    const d = _b.set(dx, dy, dz).normalize();
    if (drawn) {
      const r = this.take(this.rings);
      r.color.value.setRGB(1.2, 1.6, 2.4);
      r.life = 0.14;
      r.size = 0.9;
      this.flat(r.mesh, x, y, z, d, 0.25);
      // Out of the brake's ports, left and right of the barrel.
      _n.set(-d.z, 0, d.x).normalize();
      for (const side of [-1, 1]) for (let i = 0; i < 2; i++) {
        zaps.puff(x + _n.x * side * 0.2 + d.x * 0.1, y + 0.05, z + _n.z * side * 0.2 + d.z * 0.1, 0.25 + Math.random() * 0.2, 0.6);
      }
    }
    const g = groundAt(x, z, y);
    if (y - g < 1.8) {
      // The blast off the sand: a low ring of dust round where the barrel points down to.
      const k = 1 - (y - g) / 1.8;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.random() * 0.5, v = (2 + Math.random() * 2.5) * k;
        tyreDust.emit(x + d.x * 0.6, g + 0.1, z + d.z * 0.6, Math.cos(a) * v + d.x * 2, 0.4 + Math.random() * 0.8, Math.sin(a) * v + d.z * 2, 0.5 + Math.random() * 0.4, 1.5 + Math.random());
      }
    }
  }

  /**
   * Where the piercer's slug stopped, at (x, y, z) on a surface facing (nx, ny, nz), having come along (dx, dy, dz).
   * `on`: a walker's plate punched through (sparks back out of the hole and out the far side, a spray of molten metal,
   * a white flash), the sand (a puff and a spurt of it), or rock or concrete (sparks and dust). Nothing in the air.
   */
  piercer(x: number, y: number, z: number, nx: number, ny: number, nz: number, dx: number, dy: number, dz: number, on: 'sand' | 'hard' | 'enemy') {
    const n = _b.set(nx, ny, nz).normalize();
    if (on === 'enemy') {
      zaps.light(x + n.x * 0.5, y + n.y * 0.5, z + n.z * 0.5, 0xd8e8ff, 420, 16, 0.18);
      zaps.burst(x, y, z, n.x, n.y, n.z, 30, 2);
      zaps.burst(x, y, z, dx, dy, dz, 24, 2.5); // through and out the other side
      for (let i = 0; i < 26; i++) {
        // Most of it blown on through, the rest back out of the hole.
        const through = i < 17, s = (through ? 7 : 4) + Math.random() * 7;
        const ax = through ? dx : n.x, ay = through ? dy : n.y, az = through ? dz : n.z;
        this.molten.add(x, y, z, (ax + (Math.random() - 0.5) * 0.9) * s, (ay + (Math.random() - 0.3) * 0.9) * s, (az + (Math.random() - 0.5) * 0.9) * s,
          0.05 + Math.random() * 0.07, 1.2 + Math.random() * 1.4);
      }
      zaps.puff(x, y, z, 0.8, 1.2);
      this.shakeFrom(x, y, z, 0.2);
    } else if (on === 'sand') {
      zaps.burst(x, y + 0.05, z, n.x, n.y, n.z, 6);
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 2.5;
        tyreDust.emit(x, y + 0.1, z, Math.cos(a) * v + dx * 2, 2 + Math.random() * 4, Math.sin(a) * v + dz * 2, 0.5 + Math.random() * 0.6, 1.8 + Math.random() * 1.5);
      }
      for (let i = 0; i < 3; i++) tyreDust.emit(x, y + 0.2, z, (Math.random() - 0.5), 5 + Math.random() * 4, (Math.random() - 0.5), 0.7 + Math.random() * 0.4, 2 + Math.random());
    } else {
      zaps.light(x + n.x * 0.4, y + n.y * 0.4, z + n.z * 0.4, 0xd8e8ff, 200, 10, 0.12);
      zaps.burst(x, y, z, n.x, n.y, n.z, 26, 1.8);
      for (let i = 0; i < 5; i++) tyreDust.emit(x + n.x * 0.2, y + n.y * 0.2, z + n.z * 0.2, (n.x + Math.random() - 0.5) * 2, (n.y + Math.random()) * 2, (n.z + Math.random() - 0.5) * 2, 0.4 + Math.random() * 0.4, 1.5 + Math.random());
      const s = this.take(this.scorches);
      s.size = 0.25;
      this.flat(s.mesh, x, y, z, n, 0.02);
    }
  }

  /** Every frame (after the shots of this frame). */
  update(dt: number) {
    this.shake *= Math.exp(-dt * 4.5);
    if (this.shake < 1e-3) this.shake = 0;
    for (const f of this.fires) {
      if (!f.mesh.visible) continue;
      const t = (f.age += dt) / f.life;
      if (t >= 1) {
        f.mesh.visible = false;
        continue;
      }
      f.mesh.scale.setScalar(f.size * (0.25 + 0.75 * (1 - Math.exp(-t * 9))));
      f.heat.value = Math.max(0, 1 - t * 1.3);
      f.fade.value = Math.min(1, (1 - t) * 2.2);
      f.mesh.position.y += dt * 1.2 * t; // the hot gas starts to rise
    }
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      const t = (r.age += dt) / r.life;
      if (t >= 1) {
        r.mesh.visible = false;
        continue;
      }
      r.mesh.scale.setScalar(r.size * (0.15 + 0.85 * (1 - (1 - t) * (1 - t))));
      r.fade.value = (1 - t) * (1 - t);
    }
    for (const s of this.scorches) {
      if (!s.mesh.visible) continue;
      const t = (s.age += dt);
      if (t >= s.life) {
        s.mesh.visible = false;
        continue;
      }
      s.mesh.scale.setScalar(s.size * Math.min(1, 0.6 + t * 4));
      s.fade.value = Math.min(1, (s.life - t) / SCORCH_FADE);
    }
    for (const h of this.holes) {
      if (!h.mesh.visible) continue;
      const age = (h.age += dt);
      if (age >= h.life) {
        h.mesh.visible = false;
        continue;
      }
      // Swells at once, holds, then caves in faster and faster.
      const grow = Math.min(1, age / HOLE_GROW);
      const cave = Math.max(0, (age - HOLE_GROW) / (h.life - HOLE_GROW));
      const r = h.size * (1 - Math.pow(1 - grow, 3)) * (1 - cave * cave * cave);
      h.mesh.scale.setScalar(Math.max(0.01, r));
      h.rim.scale.setScalar(1.35 + 0.15 * Math.sin(age * 40));
      h.fade.value = Math.min(1, (1 - cave) * 3);
      if (!h.ring && cave > 0.85) {
        h.ring = true;
        const g = this.take(this.rings);
        g.color.value.setRGB(1.5, 0.45, 3.6);
        g.life = 0.4;
        g.size = 6;
        this.flat(g.mesh, h.at.x, h.at.y, h.at.z, h.normal, 0);
        zaps.light(h.at.x, h.at.y, h.at.z, 0xb080ff, 420, 24, 0.25);
        this.shakeFrom(h.at.x, h.at.y, h.at.z, 0.6);
      }
    }
    const mp = this.motes;
    mp.update(dt, (i, t) => {
      const v = i * 3;
      mp.pos[v] += mp.vel[v] * dt;
      mp.pos[v + 1] += mp.vel[v + 1] * dt;
      mp.pos[v + 2] += mp.vel[v + 2] * dt;
      mp.data[i * 2] = Math.min(1, t * 3) * (1 - t * t * 0.5);
      mp.data[i * 2 + 1] = mp.size[i];
    });
    const ml = this.molten;
    ml.update(dt, (i, t) => {
      const v = i * 3;
      const g = groundAt(ml.pos[v], ml.pos[v + 2], ml.pos[v + 1]);
      if (ml.pos[v + 1] > g + 0.01) {
        ml.vel[v + 1] -= 9.8 * dt;
        const k = Math.exp(-dt * 0.8);
        ml.vel[v] *= k;
        ml.vel[v + 2] *= k;
        ml.pos[v] += ml.vel[v] * dt;
        ml.pos[v + 1] = Math.max(g, ml.pos[v + 1] + ml.vel[v + 1] * dt);
        ml.pos[v + 2] += ml.vel[v + 2] * dt;
      } else ml.pos[v + 1] = g + 0.01; // landed: lies glowing in the sand
      ml.data[i * 2] = (1 - t) * (1 - 0.3 * t);
      ml.data[i * 2 + 1] = ml.size[i] * (1 - 0.4 * t);
    });
  }
}

export const blasts = new Blasts();
