// The last pod in the beginning's bay (docs/levels/tutorial.md beat 8): pod.glb's Pod at full size, lying across the bay
// with its hatch towards you, and the two things it does, read off the player's gates (set by the server, never in the
// sim). While you carry the relay and it isn't in, a ghost of it breathes in the open junction box beside the hatch: that
// is where it goes. Once it is in (GATE.powered) the relay seats, the box's cover swings shut, the pod wakes (its lamp
// green, a chirp), the seal lets go with a hiss and the hatch swings down on its lower hinge until it lies open as a ramp,
// the cabin lit behind it; F then gets in (src/levels/beginning/index.ts, server/tutorial.ts: not before POD_OPEN_MS).
// Seen already done (a reconnect, a late load), it is simply so.
//
// pod.glb has its hatch modelled blown open (tools/blender/pod.py: the desert's crashed pod) and merged into the hull, so
// the hatch's triangles are found here by the transform pod.py hangs it open with, cut out into their own meshes shut, and
// swung on the same hinge. The constants below are pod.py's (HATCH_A, HATCH_HALF_A, HATCH_Y, AXIS_Z, NOSE, BARREL).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CABINET, GATE, POD, POD_OPEN_MS } from '../../../shared/levels/beginning.ts';
import { CABINET_LEVEL, CABINET_SEED, RELAY_INDEX } from '../../../shared/levels/beginningCabinet.ts';
import { machineParts } from '../../../shared/machine.ts';
import { loadPart } from '../../teardown/junk.ts';

// ---- pod.py's hull, in three.js's frame (blender (x, y, z) is three (x, z, -y): the axis along z, the nose +z) -------

const PROFILE: [number, number][] = [[-1.86, 0.0], [-1.85, 0.26], [-1.79, 0.5], [-1.66, 0.76], [-1.44, 1.0], [-1.12, 1.15],
  [-0.72, 1.22], [-0.12, 1.25], [0.42, 1.24], [0.68, 1.21]];
const AXIS_Y = 1.2;
const DEG = Math.PI / 180;
const HATCH_A = 196 * DEG, HATCH_HALF = 24 * DEG, HATCH_Y0 = -0.62, HATCH_Y1 = 0.36;
/** How far pod.py swings the hatch open (rad, about +z through its lower hinge). */
const OPEN = 1.75;

/** The hull's radius at pod.py's axial `y` (three's -z). */
function radiusAt(y: number): number {
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [y0, r0] = PROFILE[i], [y1, r1] = PROFILE[i + 1];
    if (y0 <= y && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return y > 0 ? PROFILE[PROFILE.length - 1][1] : 0;
}
/** The point on the hull at angle `a` round the axis (pod.py's: from +x towards +y here), axial `y`, `out` off it. */
function onHull(a: number, y: number, out = 0): THREE.Vector3 {
  const r = radiusAt(y) + out;
  return new THREE.Vector3(Math.cos(a) * r, AXIS_Y + Math.sin(a) * r, -y);
}
/** A frame on the hull at (a, y): +z out of it, +y up round it, +x along the axis towards the nose. */
function hullFrame(a: number, y: number, out = 0): THREE.Matrix4 {
  const n = new THREE.Vector3(Math.cos(a), Math.sin(a), 0), up = new THREE.Vector3(Math.sin(a), -Math.cos(a), 0);
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), up, n).setPosition(onHull(a, y, out));
}
/** The hatch's hinge line (through this point, along z). */
const HINGE = onHull(HATCH_A + HATCH_HALF, 0);

/** Is (x, y, z), swung back shut, on the hatch (its skin, its inner face, its wheel boss)? */
function onHatch(x: number, y: number, z: number): boolean {
  const c = Math.cos(-OPEN), s = Math.sin(-OPEN), dx = x - HINGE.x, dy = y - HINGE.y;
  const ux = HINGE.x + dx * c - dy * s, uy = HINGE.y + dx * s + dy * c;
  const ay = -z, a = (Math.atan2(uy - AXIS_Y, ux) + 2 * Math.PI) % (2 * Math.PI), r = Math.hypot(ux, uy - AXIS_Y), R = radiusAt(ay);
  return a > HATCH_A - HATCH_HALF - 0.06 && a < HATCH_A + HATCH_HALF + 0.06 && ay > HATCH_Y0 - 0.02 && ay < HATCH_Y1 + 0.02
    && r > R - 0.16 && r < R + 0.04;
}

/** Cut the hatch out of the pod's meshes, shut: a group on its hinge (rotation.z 0 shut, OPEN as modelled). */
function cutHatch(pod: THREE.Object3D): THREE.Group {
  const hinge = new THREE.Group();
  hinge.position.set(HINGE.x, HINGE.y, 0);
  const inner = new THREE.Group();
  inner.position.set(-HINGE.x, -HINGE.y, 0);
  hinge.add(inner);
  const shut = new THREE.Matrix4().makeTranslation(HINGE.x, HINGE.y, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(-OPEN)).multiply(new THREE.Matrix4().makeTranslation(-HINGE.x, -HINGE.y, 0));
  const meshes: THREE.Mesh[] = [];
  pod.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const m of meshes) {
    const g = m.geometry, index = g.index, pos = g.attributes.position;
    if (!index) continue;
    const on = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) on[i] = onHatch(pos.getX(i), pos.getY(i), pos.getZ(i)) ? 1 : 0;
    const keep: number[] = [], cut: number[] = [];
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
      (on[a] && on[b] && on[c] ? cut : keep).push(a, b, c);
    }
    if (!cut.length) continue;
    const hg = g.clone();
    hg.setIndex(cut);
    hg.applyMatrix4(shut);
    g.setIndex(keep);
    const hm = new THREE.Mesh(hg, m.material);
    hm.castShadow = hm.receiveShadow = true;
    m.updateMatrix();
    hm.applyMatrix4(m.matrix);
    inner.add(hm);
  }
  return hinge;
}

// ---- the timeline after the relay goes in (s): POD_OPEN_MS covers it ---------------------------------------------------

const SEAT_S = 0.25;
const COVER = [0.4, 1.0] as const;
const WAKE_S = 1.15;
const HATCH = [1.55, 3.05] as const;
const DONE_S = POD_OPEN_MS / 1000;
/** The junction box's cover hanging open (rad about its bottom hinge: out and down, the socket open to the eye). */
const COVER_OPEN = 1.95;

const smooth = (u: number) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };
const easeInOut = (u: number) => { const t = Math.min(1, Math.max(0, u)); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };

/** What the pod sounds like as it opens (src/levels/beginning/sound.ts). */
export type PodSounds = { click(): void; clunk(): void; wake(): void; hiss(): void; thud(): void };

/** A soft round glow (additive planes: the ghost's halo, the lit cabin). */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function additive(color: number, map: THREE.Texture | null): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ color, map, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  m.fog = false;
  return m;
}

export class Pod {
  readonly group = new THREE.Group();
  /** The hatch on its hinge, once loaded. */
  private hatch: THREE.Group | null = null;
  private cover = new THREE.Group();
  private relay = new THREE.Group();
  private ghost = new THREE.Group();
  private ghostMat = additive(0x6fdcff, null);
  private halo: THREE.Mesh;
  private lamp = new THREE.MeshBasicNodeMaterial({ color: 0x3a0c08 });
  private cabin: THREE.Mesh;
  /** Seconds since the relay went in (-1: not yet; past DONE_S: open). */
  private since = -1;
  private sounds: PodSounds;

  constructor(sounds: PodSounds) {
    this.sounds = sounds;
    this.group.position.set(POD.x, 0.05, POD.z); // (the hull's underside on the floor)
    this.group.rotation.y = POD.yaw;

    // The junction box on the hull beside the hatch, between its frame and the service ring: a socket, its cover
    // propped open, a lamp. The relay goes in it.
    const box = new THREE.Group();
    box.matrixAutoUpdate = false;
    box.matrix.copy(hullFrame(HATCH_A, 0.53));
    const frame = new THREE.MeshStandardNodeMaterial({ color: 0x3a3f46, roughness: 0.55, metalness: 0.5 });
    const back = new THREE.MeshStandardNodeMaterial({ color: 0x121417, roughness: 0.8, metalness: 0.2 });
    const paint = new THREE.MeshStandardNodeMaterial({ color: 0xd9d6cf, roughness: 0.6, metalness: 0.15 });
    const part = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, to: THREE.Object3D = box) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      to.add(mesh);
      return mesh;
    };
    part(0.22, 0.3, 0.012, 0, 0, 0.004, back);
    for (const s of [-1, 1]) {
      part(0.02, 0.32, 0.1, s * 0.12, 0, 0.05, frame);
      part(0.26, 0.02, 0.1, 0, s * 0.16, 0.05, frame);
    }
    const lamp = part(0.035, 0.012, 0.02, 0.07, 0.16, 0.105, this.lamp);
    lamp.castShadow = false;
    this.cover.position.set(0, -0.165, 0.1);
    this.cover.rotation.x = COVER_OPEN;
    part(0.25, 0.31, 0.012, 0, 0.155, 0.006, paint, this.cover);
    part(0.06, 0.025, 0.02, 0, 0.27, 0.02, frame, this.cover); // its latch
    box.add(this.cover);
    // The relay seated, and its ghost (while you carry it and it isn't in), each scaled into the socket once loaded.
    this.relay.visible = this.ghost.visible = false;
    box.add(this.relay, this.ghost);
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.36), additive(0x6fdcff, glowTexture()));
    this.halo.position.z = 0.012;
    this.halo.visible = false;
    box.add(this.halo);
    this.group.add(box);

    // The cabin's light behind the hatch, coming on as it opens (it is shut over it till then).
    this.cabin = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.75), additive(0xffb468, glowTexture()));
    this.cabin.matrixAutoUpdate = false;
    this.cabin.matrix.copy(hullFrame(HATCH_A, (HATCH_Y0 + HATCH_Y1) / 2, -0.03));
    this.cabin.visible = false;
    this.group.add(this.cabin);

    const tier = machineParts(CABINET.kind, CABINET_SEED, CABINET_LEVEL)[RELAY_INDEX].tier;
    loadPart('relay', tier).then((model) => {
      // Up (the part's +y) out of the socket; as big as the socket takes.
      model.rotation.x = Math.PI / 2;
      model.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      model.scale.setScalar(Math.min(0.17 / size.x, 0.24 / size.y, 0.08 / size.z));
      model.position.z = 0.01;
      const ghost = model.clone(true);
      ghost.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = this.ghostMat;
        m.castShadow = false;
        m.renderOrder = 2;
      });
      this.relay.add(model);
      this.ghost.add(ghost);
    }).catch((e) => console.warn('beginning: the relay failed to load', e));

    new GLTFLoader().load('./models/pod.glb', (gltf) => {
      const pod = gltf.scene.getObjectByName('Pod');
      if (!pod) return;
      pod.removeFromParent();
      pod.position.set(0, 0, 0);
      pod.rotation.set(0, 0, 0);
      pod.traverse((o) => { o.castShadow = o.receiveShadow = true; });
      this.hatch = cutHatch(pod);
      pod.add(this.hatch);
      this.group.add(pod);
      this.pose();
    }, undefined, (e) => console.warn('beginning: the pod failed to load', e));
  }

  /** Its hatch lies open: F gets in. */
  get open() {
    return this.since >= DONE_S;
  }

  /** Every frame: `gates` the player's, `carrying` the relay in their bag, `fresh` (not the first frame since entering):
   *  a relay going in now is seen happen, else it is simply in. */
  update(dt: number, time: number, gates: number, carrying: boolean, fresh: boolean) {
    const powered = (gates & GATE.powered) !== 0;
    if (!powered) this.since = -1;
    else if (this.since < 0) this.since = fresh ? 0 : DONE_S;
    else if (this.since < DONE_S) {
      const was = this.since, now = (this.since = Math.min(DONE_S, this.since + dt));
      const at = (t: number) => was < t && now >= t;
      if (at(SEAT_S)) this.sounds.click();
      if (at(COVER[1])) this.sounds.clunk();
      if (at(WAKE_S)) this.sounds.wake();
      if (at(HATCH[0] - 0.08)) this.sounds.hiss();
      if (at(HATCH[1])) this.sounds.thud();
    }
    // The ghost: breathing slowly, the halo with it.
    const ghost = carrying && !powered;
    this.ghost.visible = this.halo.visible = ghost;
    if (ghost) {
      const b = 0.5 + 0.5 * Math.sin(time * 2.6);
      this.ghostMat.opacity = 0.16 + 0.26 * b;
      (this.halo.material as THREE.MeshBasicNodeMaterial).opacity = 0.05 + 0.1 * b;
    }
    this.pose();
  }

  /** Everything where `since` puts it. */
  private pose() {
    const t = this.since, on = t >= 0;
    this.relay.visible = on;
    this.relay.position.z = on ? 0.12 * (1 - smooth(t / SEAT_S)) : 0;
    this.cover.rotation.x = on ? COVER_OPEN * (1 - easeInOut((t - COVER[0]) / (COVER[1] - COVER[0]))) : COVER_OPEN;
    this.lamp.color.setHex(on && t >= WAKE_S ? 0x7dffa8 : 0x3a0c08);
    const swing = on ? easeInOut((t - HATCH[0]) / (HATCH[1] - HATCH[0])) : 0;
    if (this.hatch) this.hatch.rotation.z = OPEN * swing;
    const lit = on ? smooth((t - HATCH[0] - 0.1) / 1.0) : 0;
    this.cabin.visible = lit > 0;
    (this.cabin.material as THREE.MeshBasicNodeMaterial).opacity = 0.28 * lit;
  }
}
