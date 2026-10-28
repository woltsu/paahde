// The datacenter's door out in the desert (shared/levels/entrance.ts): a weathered concrete block half sunk in the sand,
// a steel door in one face under a small amber lamp. No text says what it is: the door is a door, and the hum of the
// fans inside (the datacenter's own bed, src/levels/datacenter/ambience.ts, muffled through the concrete) grows as you
// come near.
import * as THREE from 'three/webgpu';
import { color, float, mix, mx_fractal_noise_float, mx_noise_float, positionWorld, smoothstep, step, vec3 } from 'three/tsl';
import { BLOCK, DOOR, entrance } from '../../shared/levels/entrance.ts';
import { audio } from '../audio.ts';
import { BED, buildBed, type DcBed } from '../levels/datacenter/ambience.ts';

/** The hum is heard from this far (m), and how loud it is at the door (× the bed inside). */
const HEAR_R = 45;
const AT_DOOR = 0.45;

export class EntranceView {
  readonly group = new THREE.Group();
  private bed: DcBed | null = null;
  private lp: BiquadFilterNode | null = null;
  private quietSince = 0;

  constructor(root: THREE.Object3D) {
    const e = entrance();
    const H = BLOCK.half;
    this.group.name = 'entrance';
    const concrete = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
    {
      const p = positionWorld;
      const stain = mx_fractal_noise_float(vec3(p.x.mul(0.6), p.y.mul(1.4), p.z.mul(0.6)), 3, 2, 0.5).mul(0.5).add(0.5);
      // Sand banked up its foot, a darker band where the rain never was.
      const foot = smoothstep(e.y + 0.6, e.y - 0.1, p.y);
      concrete.colorNode = mix(mix(color(0x8a8378), color(0x6f6a62), stain), color(0xb07a48), foot.mul(0.6));
    }
    const block = new THREE.Mesh(new THREE.BoxGeometry(2 * H, BLOCK.height + BLOCK.sunk, 2 * H), concrete);
    block.position.set(e.x, e.y + (BLOCK.height - BLOCK.sunk) / 2, e.z);
    block.castShadow = block.receiveShadow = true;
    this.group.add(block);
    // The door on the face (+2 cm proud), a steel frame round it, the lamp over it.
    const steel = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.6 });
    steel.colorNode = color(0x4a5258).mul(mx_noise_float(vec3(positionWorld.mul(3))).mul(0.08).add(0.95))
      .mul(float(1).sub(step(0.985, mx_noise_float(vec3(positionWorld.mul(40)))).mul(0.3)));
    const along = e.dx !== 0; // the face is across x
    const face = (w: number, h: number, d: number) => new THREE.BoxGeometry(along ? d : w, h, along ? w : d);
    const door = new THREE.Mesh(face(2 * DOOR.half, DOOR.height, 0.06), steel);
    door.position.set(e.x + e.dx * (H + 0.02), e.y + DOOR.height / 2, e.z + e.dz * (H + 0.02));
    door.castShadow = true;
    this.group.add(door);
    const frame = new THREE.Mesh(face(2 * DOOR.half + 0.16, DOOR.height + 0.08, 0.03), steel);
    frame.position.set(e.x + e.dx * (H + 0.005), e.y + (DOOR.height + 0.08) / 2, e.z + e.dz * (H + 0.005));
    this.group.add(frame);
    const lampM = new THREE.MeshStandardNodeMaterial({ roughness: 0.4 });
    lampM.colorNode = color(0x3a2a20);
    lampM.emissiveNode = color(0xff7a1a).mul(2.5);
    const lamp = new THREE.Mesh(face(0.3, 0.1, 0.12), lampM);
    lamp.position.set(e.x + e.dx * (H + 0.06), e.y + DOOR.height + 0.3, e.z + e.dz * (H + 0.06));
    this.group.add(lamp);
    this.group.traverse((o) => (o.matrixAutoUpdate = false, o.updateMatrix()));
    root.add(this.group);
  }

  /** How far the listener is from the door (m). */
  distance(at: { x: number; z: number }): number {
    const e = entrance();
    return Math.hypot(at.x - (e.x + e.dx * BLOCK.half), at.z - (e.z + e.dz * BLOCK.half));
  }

  /** Gone from the desert (into a level): fade the hum out and stop it. */
  silence() {
    const ctx = audio.ctx, bed = this.bed, lp = this.lp;
    if (!ctx || !bed) return;
    bed.out.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    this.bed = this.lp = null;
    setTimeout(() => { bed.stop(); lp?.disconnect(); }, 1500);
  }

  /** The hum through the concrete, by the listener's distance; off (ramped) when `on` is false. */
  update(listener: { x: number; z: number }, on: boolean) {
    const ctx = audio.ctx;
    if (!ctx || !audio.ambience || ctx.state !== 'running') return;
    const d = this.distance(listener);
    if (!this.bed) {
      if (!on || d > HEAR_R) return;
      const lp = (this.lp = ctx.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      lp.connect(audio.ambience);
      this.bed = buildBed(ctx, lp);
      this.quietSince = ctx.currentTime;
    }
    const k = on ? Math.max(0, 1 - d / HEAR_R) : 0;
    this.bed.out.gain.setTargetAtTime(BED * AT_DOOR * k * k, ctx.currentTime, 0.3);
    this.lp!.frequency.setTargetAtTime(300 + 900 * k * k, ctx.currentTime, 0.3);
    // Out of earshot a while (faded out): its sources stop; coming near again builds it anew.
    if (k > 0) this.quietSince = ctx.currentTime;
    else if (ctx.currentTime - this.quietSince > 3) {
      this.bed.stop();
      this.lp!.disconnect();
      this.bed = null;
      this.lp = null;
    }
  }
}
