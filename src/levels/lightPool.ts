// A level's fixed light pool (docs/levels/datacenter.md "Lighting"): the active stage's lights are the scene's only
// lights and every lit material pays for every one of them, so a level has a fixed number (6 point lights and 1
// shadow-casting spot), handed each frame to the fixtures nearest the camera. The count never changes, so the shaders
// never rebuild as you walk; an idle slot (intensity 0) skips its lighting (src/world/pooledLight.ts). Everything else
// is emissive or baked.
import * as THREE from 'three/webgpu';
import { PooledPointLight, PooledSpotLight } from '../world/pooledLight.ts';
import type { Vec3 } from '../../shared/levels/datacenter.ts';

/** What the pool needs of a fixture (the layout's, shared/levels/). */
export type PoolFixture = {
  kind: 'point' | 'spot';
  pos: Vec3;
  angle?: number;
  penumbra?: number;
  color: number;
  intensity: number;
  range: number;
  decay: number;
  zone: string;
};

export const POINT_SLOTS = 6;
/** A fixture this far from the camera (m) is fully on, at FADE_OUT off; another zone counts ZONE_PENALTY m further. */
const FADE_IN = 6;
const FADE_OUT = 10;
const ZONE_PENALTY = 4;
/** A better fixture takes a busy slot only when it beats the worst one by this much (m). */
const HYSTERESIS = 1.5;
/** How fast a slot's weight follows its target (1/s): ~0.4 s. */
const EASE = 6;

type Slot = { light: PooledPointLight | PooledSpotLight; fixture: number; w: number; drain: boolean };

export class LightPool {
  readonly points: PooledPointLight[] = [];
  readonly spot: PooledSpotLight;
  /** All of them, in the stage's root (the spot's target too). */
  readonly lights: THREE.Light[] = [];
  /** × every fixture's intensity (a power cut, later; the bench). */
  scale = 1;
  private pointFixtures: number[] = [];
  private spotFixtures: number[] = [];
  private slots: Slot[] = [];
  private spotSlot: Slot;
  private score: Float32Array;
  private target: Float32Array;
  private fixtures: readonly PoolFixture[];

  constructor(fixtures: readonly PoolFixture[], root: THREE.Object3D, shadowMap = 1024) {
    this.fixtures = fixtures;
    fixtures.forEach((f, i) => (f.kind === 'point' ? this.pointFixtures : this.spotFixtures).push(i));
    this.score = new Float32Array(fixtures.length);
    this.target = new Float32Array(fixtures.length);
    for (let i = 0; i < POINT_SLOTS; i++) {
      const l = new PooledPointLight(0xffffff, 0, 9, 1.5);
      l.castShadow = false;
      this.points.push(l);
      this.slots.push({ light: l, fixture: -1, w: 0, drain: false });
      root.add(l);
    }
    const spot = (this.spot = new PooledSpotLight(0xffffff, 0, 10, 0.95, 0.5, 1.5));
    spot.castShadow = true;
    spot.shadow.mapSize.set(shadowMap, shadowMap);
    spot.shadow.bias = -0.0005;
    spot.shadow.normalBias = 0.02;
    spot.shadow.camera.near = 0.2;
    root.add(spot, spot.target);
    this.spotSlot = { light: spot, fixture: -1, w: 0, drain: false };
    this.lights.push(...this.points, spot);
  }

  /** Hand the pool to the fixtures round the camera; `zone` is the camera's (or null in a doorway). */
  update(dt: number, cam: THREE.Vector3, zone: string | null) {
    const f = this.fixtures;
    for (let i = 0; i < f.length; i++) {
      const p = f[i].pos;
      const d = Math.hypot(cam.x - p[0], cam.y - p[1], cam.z - p[2]) + (zone !== null && f[i].zone !== zone ? ZONE_PENALTY : 0);
      this.score[i] = d;
      this.target[i] = 1 - THREE.MathUtils.smoothstep(d, FADE_IN, FADE_OUT);
    }
    this.assign(this.slots, this.pointFixtures, dt);
    this.assign([this.spotSlot], this.spotFixtures, dt);
  }

  private assign(slots: Slot[], candidates: number[], dt: number) {
    const k = 1 - Math.exp(-dt * EASE);
    // A light is never moved while visible: a slot only takes a new fixture once drained.
    for (const s of slots) {
      const t = s.fixture < 0 || s.drain ? 0 : this.target[s.fixture];
      s.w += (t - s.w) * k;
      if (s.w < 0.01 && (s.drain || s.fixture < 0 || this.target[s.fixture] === 0)) {
        s.fixture = -1;
        s.drain = false;
        s.w = 0;
      }
    }
    const held = new Set(slots.map((s) => s.fixture));
    const free = candidates.filter((i) => !held.has(i) && this.target[i] > 0).sort((a, b) => this.score[a] - this.score[b]);
    for (const i of free) {
      const empty = slots.find((s) => s.fixture < 0);
      if (empty) {
        empty.fixture = i;
        empty.w = 0;
        this.place(empty);
        continue;
      }
      // All busy: drain the worst one if this fixture is clearly better (it fades out, and is free next time).
      let worst: Slot | null = null;
      for (const s of slots) if (!s.drain && (!worst || this.score[s.fixture] > this.score[worst.fixture])) worst = s;
      if (worst && this.score[i] + HYSTERESIS < this.score[worst.fixture]) worst.drain = true;
      break;
    }
    for (const s of slots) s.light.intensity = s.fixture < 0 ? 0 : this.fixtures[s.fixture].intensity * s.w * this.scale;
  }

  /** Move a drained slot's light to its new fixture (it is at zero: nothing pops). */
  private place(s: Slot) {
    const f = this.fixtures[s.fixture], l = s.light;
    l.position.set(f.pos[0], f.pos[1], f.pos[2]);
    l.color.setHex(f.color);
    l.distance = f.range;
    l.decay = f.decay;
    if (l instanceof PooledSpotLight) {
      l.angle = f.angle ?? 0.95;
      l.penumbra = f.penumbra ?? 0.5;
      l.target.position.set(f.pos[0], 0, f.pos[2]);
      l.target.updateMatrixWorld();
    }
    l.updateMatrixWorld();
  }
}
