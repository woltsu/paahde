// Explosions, and what the heavy guns do where their beams stop (shared/rifle.ts; src/rifle.ts fires them, for everyone
// near). Purely visual; the damage is the server's.
// - `explode`: one explosion, everything about it tuned by a BlastSpec (`blastSpec(strength)`: the strength is the
//   fireball's radius in metres, the rest follows it by rough scaling laws; `BLASTS` has the ones the game sets off:
//   the blaster's burst, a guardian's bolt, missiles, bombs, crashes). A volumetric fireball (src/world/fireball.ts)
//   that burns white to red and leaves rising smoke, a shock ring along the surface struck, the shots' one light
//   (src/world/zaps.ts `light`: no light is added), sparks, hot debris streaming smoke, smoke that hangs about, sand
//   thrown up all round on the dunes (src/tyreDust.ts), a scorch where it hit the ground or a wall, and the view
//   shaken by how near it is.
// - The blaster's burst (`blaster`), sized to BLAST_R.
// - The graviton pistol's end point: a black hole with a violet halo that swells for an instant and then caves in on
//   itself, sucking violet motes in from all round, and a violet ring breaking outward as it closes.
// - The piercer's slug: at the muzzle a quick pale shock ring, the brake's smoke and the sand kicked up under a low
//   barrel; where it stops, punched through a walker's plate, sparks out of both sides and a spray of molten metal
//   (most of it blown on through), a puff of sand on the dunes, sparks, dust and a small scorch on rock and concrete.
// All the view by how near they are (`shake`, read by src/camera.ts `rumble` through main.ts).
//
// Pools, made once (no materials per shot): RINGS, SCORCHES and HOLES meshes each with its own uniforms, the fireballs'
// (fireball.ts), instanced sprite pools for the motes, the molten metal and the debris' hot heads, and a list of the debris in flight.
import * as THREE from 'three/webgpu';
import { abs, dot, float, length, mx_noise_float, normalView, positionGeometry, positionViewDirection, pow, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { BLAST_R } from '../../shared/rifle.ts';
import { heightAt } from '../../shared/terrain.ts';
import { groundAt } from '../ground.ts';
import { tyreDust } from '../tyreDust.ts';
import { fireballs, type FireballLook } from './fireball.ts';
import { SpritePool, zaps } from './zaps.ts';

const RINGS = 8, SCORCHES = 12, HOLES = 3, MOTES = 256, MOLTEN = 160, EMBERS = 128;
/** The shock ring: out to a blaster burst's reach in RING_S (bigger rings take longer, by the root of their size). */
const RING_S = 0.32;
/** A scorch: there SCORCH_S s, fading over the last SCORCH_FADE. */
const SCORCH_S = 25, SCORCH_FADE = 6;
/** The graviton's hole: swells to HOLE_R m in HOLE_GROW s, then caves in by HOLE_S. */
const HOLE_R = 1.6, HOLE_GROW = 0.08, HOLE_S = 0.5;
/** The view shakes within SHAKE_NEAR m at full (× the burst's `shake`), fading to nothing at SHAKE_FAR m (further for
 *  bigger explosions: BlastSpec `felt`). */
const SHAKE_NEAR = 4, SHAKE_FAR = 40;
/** Debris falls at GRAVITY and puffs smoke every TRAIL_S s while it flies. */
const GRAVITY = 9.8, TRAIL_S = 0.05;

/**
 * One explosion, all of it. Made by `blastSpec(strength)`, which sizes everything from the fireball's radius; any
 * field can be set over that. The fireball's own look (radius, burn and smoke times, heat, soot, rise, tint) is
 * fireball.ts FireballLook.
 */
export type BlastSpec = FireballLook & {
  /** The shock ring's reach along the surface (m; 0: none). */
  ring: number;
  /** Sparks thrown; hot pieces flung out on arcs, trailing smoke. */
  sparks: number; debris: number;
  /** Smoke left hanging about (× the usual for its size and soot). */
  linger: number;
  /** Sand thrown up on the dunes (1: a blaster's). */
  sand: number;
  /** The scorch's radius (m; 0: none). */
  scorch: number;
  /** The light: intensity at first, its reach (m), how long it dies away over (s). */
  light: number; reach: number; lightS: number;
  /** How hard it shakes the view when near (0..1), and how far off it's still felt (m). */
  shake: number; felt: number;
};

/**
 * An explosion of `strength`: its fireball's radius (m). A real fireball's size and how long it burns both go as the
 * cube root of its yield; here the burn time goes as the square root of the size (small ones would flash by too fast
 * to read otherwise), and everything round it scales with the size.
 */
export function blastSpec(strength: number, o: Partial<BlastSpec> = {}): BlastSpec {
  const r = Math.max(0.3, strength), fire = 0.42 * Math.sqrt(r);
  return {
    r, fire, smoke: fire * 2.2, heat: 1, soot: 0.5, rise: 0.7 * Math.sqrt(r), tint: new THREE.Color(1, 1, 1),
    ring: r * 1.4, sparks: Math.min(140, Math.round(12 * r)), debris: Math.min(10, Math.floor(r / 2)), linger: 1,
    sand: r / 3.4, scorch: r * 0.4, light: 200 * r, reach: 8 * r, lightS: fire * 0.8,
    shake: Math.min(1, r / 4), felt: SHAKE_FAR * Math.max(1, r / 3.4),
    ...o,
  };
}

/** The explosions the game sets off (src/rifle.ts, src/guardians.ts, src/world/colossus.ts, src/world/carrier.ts). */
export const BLASTS = {
  /** The blaster's burst: hot and quick, yellow-white, little smoke; its ring is the burst's reach. */
  blaster: blastSpec(BLAST_R * 0.75, { tint: new THREE.Color(1, 0.95, 0.85), soot: 0.3, ring: BLAST_R * 1.05, shake: 0.9, debris: 0, scorch: 1.5 }),
  /** A guardian's laser bolt bursting: redder (the bolt's colour), smokier; on the sand, and in the air or on a wall. */
  bolt: blastSpec(4.5, { tint: new THREE.Color(1.15, 0.72, 0.55), soot: 0.55, debris: 3 }),
  boltAir: blastSpec(3.2, { tint: new THREE.Color(1.15, 0.72, 0.55), soot: 0.4, debris: 0 }),
  /** A missile (the guardians' and the worm's, shared/missiles.ts BLAST_R; the colossus'): a big, dirty fireball. */
  missile: blastSpec(6.5, { soot: 0.8, debris: 5 }),
  /** The hive carrier's bombs. */
  bomb: blastSpec(7.5, { soot: 0.75, debris: 6 }),
  /** A jet nosing into the sand, the harvester going up: huge, oily, burning long. */
  crash: blastSpec(13, { soot: 0.9, heat: 1.2, debris: 10, sand: 2 }),
} satisfies Record<string, BlastSpec>;

const c3 = (u: unknown) => u as Node<'vec3'>;
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3(), _s = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);
const ball = new THREE.IcosahedronGeometry(1, 3);
const quad = new THREE.PlaneGeometry(2, 2);

/** The dunes' normal at (x, z). */
export function sandNormal(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(heightAt(x - 1, z) - heightAt(x + 1, z), 2, heightAt(x, z - 1) - heightAt(x, z + 1)).normalize();
}

type Slot = { mesh: THREE.Object3D; fade: { value: number }; age: number; life: number; size: number };
type Debris = { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; puff: number; size: number };

/** Where on the sprite's disc: 0 centre .. 1 edge. */
const disc = () => length(uv().sub(0.5)).mul(2);
/** Facing the camera 1 .. edge-on 0. */
const facing = () => abs(dot(normalView, positionViewDirection));

class Blasts {
  readonly root = new THREE.Group();
  /** How hard the view shakes now, 0..1 (src/camera.ts `rumble`, through main.ts). */
  shake = 0;
  private camera: THREE.Camera | null = null;
  private rings: (Slot & { color: { value: THREE.Color } })[] = [];
  private scorches: Slot[] = [];
  private holes: (Slot & { rim: THREE.Mesh; ring: boolean; at: THREE.Vector3; normal: THREE.Vector3 })[] = [];
  private motes: SpritePool;
  private molten: SpritePool;
  /** Hot debris flung out: a glowing head (embers) and a smoke trail. */
  private embers: SpritePool;
  private debris: Debris[] = [];

  constructor() {
    this.root.name = 'Blasts';
    this.root.add(fireballs.root);
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
      this.scorches.push({ mesh, fade, age: 1, life: SCORCH_S, size: 1 });
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
    // The debris' heads: small orange-white points, dulling as they cool.
    this.embers = new SpritePool(EMBERS, (m, d) => {
      m.colorNode = vec3(4, 1.6, 0.4).mul(d.x);
      m.opacityNode = float(1).sub(smoothstep(0.1, 1, disc()));
      m.scaleNode = vec2(d.y, d.y);
    }, true);
    this.root.add(this.motes.sprite, this.embers.sprite);
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

  /** The camera the shake is measured from (and the fireballs know when it's inside one). */
  setCamera(camera: THREE.Camera) {
    this.camera = camera;
    fireballs.setCamera(camera);
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

  private shakeFrom(x: number, y: number, z: number, k: number, far = SHAKE_FAR) {
    if (!this.camera) return;
    const d = this.camera.getWorldPosition(_v).distanceTo(_n.set(x, y, z));
    const near = 1 - Math.min(1, Math.max(0, (d - SHAKE_NEAR) / (far - SHAKE_NEAR)));
    this.shake = Math.min(1, Math.max(this.shake, k * near * near));
  }

  /**
   * An explosion at (x, y, z) on a surface facing (nx, ny, nz), as `spec` says. `on`: what it struck (the sand throws
   * up dust; the sand and walls keep a scorch and clip the fireball to their plane; an enemy, or nothing, in the air,
   * neither).
   */
  explode(x: number, y: number, z: number, nx: number, ny: number, nz: number, on: 'sand' | 'hard' | 'enemy' | 'air', spec: BlastSpec) {
    const n = _b.set(nx, ny, nz).normalize();
    const flat = on === 'sand' || on === 'hard';
    fireballs.fire(x, y, z, flat ? n : null, spec);
    if (spec.ring > 0) {
      const r = this.take(this.rings);
      r.color.value.setRGB(2.4, 1.3, 0.55).multiplyScalar(spec.heat);
      r.life = RING_S * Math.sqrt(spec.ring / BLAST_R);
      r.size = spec.ring;
      this.flat(r.mesh, x, y, z, flat ? n : UP, 0.15);
    }
    const up = spec.r * 0.4;
    zaps.light(x + n.x * up, y + n.y * up, z + n.z * up, 0xffa050, spec.light * spec.heat, spec.reach, spec.lightS);
    zaps.burst(x, y, z, n.x, n.y, n.z, spec.sparks, spec.r / 1.2);
    // Smoke hanging about once the fireball has gone: about its size, rising slowly; more of it the sootier.
    const puffs = Math.round(spec.linger * (2 + spec.r * 1.2) * (0.3 + spec.soot));
    for (let i = 0; i < puffs; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * spec.r * 0.6;
      zaps.puff(x + Math.cos(a) * s, y + spec.r * (0.3 + Math.random() * 0.8), z + Math.sin(a) * s, spec.r * (0.45 + Math.random() * 0.4), spec.rise * 0.6);
    }
    // Hot pieces flung out and up off the surface, each streaming smoke as it arcs down.
    for (let i = 0; i < spec.debris; i++) {
      _s.randomDirection();
      if (_s.dot(n) < 0) _s.addScaledVector(n, -2 * _s.dot(n));
      _s.addScaledVector(n, 1.1).normalize();
      const v = (7 + Math.random() * 7) * Math.sqrt(spec.r / 4);
      this.debris.push({
        x, y, z, vx: _s.x * v, vy: _s.y * v, vz: _s.z * v, age: 0, life: 0.8 + Math.random() * 1.2, puff: 0,
        size: (0.25 + Math.random() * 0.25) * Math.sqrt(spec.r / 4),
      });
    }
    if (on === 'sand' && spec.sand > 0) {
      // A ring of sand thrown out and up, and a column of it in the middle.
      const k = Math.sqrt(spec.sand), ring = Math.round(18 * k), col = Math.round(6 * k);
      for (let i = 0; i < ring; i++) {
        const a = (i / ring) * Math.PI * 2 + Math.random() * 0.3, v = (4 + Math.random() * 5) * k;
        tyreDust.emit(x, y + 0.2, z, Math.cos(a) * v, (1.5 + Math.random() * 3) * k, Math.sin(a) * v, (0.9 + Math.random() * 0.9) * k, 2.5 + Math.random() * 2);
      }
      for (let i = 0; i < col; i++) tyreDust.emit(x, y + 0.3, z, (Math.random() - 0.5) * 2, (5 + Math.random() * 6) * k, (Math.random() - 0.5) * 2, (1.2 + Math.random()) * k, 3 + Math.random() * 2);
    }
    if (flat && spec.scorch > 0) {
      const s = this.take(this.scorches);
      s.size = spec.scorch * (0.8 + Math.random() * 0.4);
      this.flat(s.mesh, x, y, z, n, on === 'sand' ? 0.04 : 0.02);
    }
    this.shakeFrom(x, y, z, spec.shake, spec.felt);
  }

  /** An explosion on the dunes at (x, y, z) (flat on the sand's slope there), as `spec` says. */
  explodeOnSand(x: number, y: number, z: number, spec: BlastSpec) {
    const n = sandNormal(x, z, _n);
    this.explode(x, y, z, n.x, n.y, n.z, 'sand', spec);
  }

  /** The blaster's burst at (x, y, z) on a surface facing (nx, ny, nz) (`explode`, BLASTS.blaster). */
  blaster(x: number, y: number, z: number, nx: number, ny: number, nz: number, on: 'sand' | 'hard' | 'enemy' | 'air') {
    this.explode(x, y, z, nx, ny, nz, on, BLASTS.blaster);
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
    fireballs.update(dt);
    this.updateDebris(dt);
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

  private updateDebris(dt: number) {
    this.debris = this.debris.filter((d) => {
      d.age += dt;
      d.vy -= GRAVITY * dt;
      const k = Math.exp(-dt * 0.4);
      d.vx *= k;
      d.vz *= k;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      const t = d.age / d.life;
      if (t >= 1 || (d.vy < 0 && d.y < heightAt(d.x, d.z))) return false;
      // Smoke behind it, thickening as it cools; its head a short-lived ember where it is now.
      d.puff += dt;
      if (d.puff >= TRAIL_S) {
        d.puff -= TRAIL_S;
        zaps.puff(d.x, d.y, d.z, 0.07 + t * 0.12, 0.3); // (smoke swells about five times over its life)
        this.embers.add(d.x, d.y, d.z, 0, 0, 0, d.size * (1.4 - t), 0.12);
      }
      return true;
    });
    const em = this.embers;
    em.update(dt, (i, t) => {
      em.data[i * 2] = 1 - t;
      em.data[i * 2 + 1] = em.size[i];
    });
  }
}

export const blasts = new Blasts();
