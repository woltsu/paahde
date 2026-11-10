// The beginning as a stage (src/levels/stage.ts, docs/levels/tutorial.md): the last datacenter in orbit, built from its
// layout (shared/levels/beginning.ts) with the datacenter's materials, racks, light pool and environment
// (src/levels/boxLevel.ts, src/levels/datacenter/), aboard a spinning ring (docs/levels/ring.md): the root holds the ring
// (the layout bent onto it, the shell all round: ring.ts) and is turned each frame so the ring under the camera sits at
// the camera's flat place, its up (towards the axis) on +y. The player and everything common stay in the flat frame.
// What moves is read off the player's gates (PlayerState.gates, set by the server): the doors slide open, the deck
// jolts, the cart crosses, the blast door comes down; the fall rumbles harder the further you get (the beat, never a clock); the station's screens say how
// it is going; the pod rides down. All client-only: nothing here is in the sim. Built on the first visit and kept.
import * as THREE from 'three/webgpu';
import { color, densityFogFactor, float, fog } from 'three/tsl';
import { BEGINNING, CABIN_LIGHT, CABINET, GAP, GATE, POD, TRAY, beatAt, beginningLevel } from '../../../shared/levels/beginning.ts';
import { CABINET_DONE, CABINET_GONE, CABINET_ID, CABINET_LEVEL, CABINET_SEED, RELAY, RELAY_INDEX } from '../../../shared/levels/beginningCabinet.ts';
import { CRASH_REACH } from '../../../shared/crash.ts';
import { hasItem, type Slots } from '../../../shared/items.ts';
import { inBox } from '../../../shared/levels.ts';
import { junkSpec } from '../../../shared/salvage.ts';
import type { PlayerState } from '../../../shared/sim.ts';
import { TEXT } from '../../../shared/text.ts';
import { buildJunk, lowestOffset, settle, type Junk } from '../../teardown/junk.ts';
import type { SiteLink, WorkSite } from '../../teardown/teardown.ts';
import { fastForward } from '../../world/crash.ts';
import type { SiteMsg } from '../../net.ts';
import { zoneAt } from '../../../shared/levels/datacenter.ts';
import type { Post } from '../../post.ts';
import { setLevelShade } from '../../world/materialLighting.ts';
import { buildBoxLevel, ringAnchor, type BoxLevel } from '../boxLevel.ts';
import { ringMatrixInverse } from '../../../shared/ring.ts';
import { RingShell } from './ring.ts';
import type { Stage, StageFrame } from '../stage.ts';
import { bakeDataSliced, bakeMaps } from '../datacenter/bake.ts';
import { makeMaterials } from '../datacenter/materials.ts';
import { DATACENTER_ENV, DATACENTER_POST, datacenterEnvironment } from '../datacenter/environment.ts';
import { DatacenterAmbience } from '../datacenter/ambience.ts';
import { Pod } from './pod.ts';
import { Props } from './props.ts';
import { FallSound } from './sound.ts';
import { HallSound } from './hallSound.ts';
import { OpenRacks } from './rackDetail.ts';
import { play } from '../../sounds.ts';
import { Ride } from './ride.ts';
import { StuckHints } from './stuck.ts';

/** How hard it shakes at each beat (0..1, × the comfort motion setting in src/camera.ts): it grows as you go. */
const RUMBLE = [0.04, 0.1, 0.16, 0.26, 0.3, 0.3, 0.45, 0.55];

/** The hall's haze: what makes it read as huge (the deck is out of sight in it before the ceiling hides it). */
const HAZE = fog(color(0x2c333d), densityFogFactor(float(0.0042)));

/** A door's panel slides up into its lintel this fast (s): collision is gone at once (docs/levels/tutorial.md). */
const DOOR_S = 0.4;

export class BeginningStage implements Stage {
  readonly level = beginningLevel.id;
  readonly root = new THREE.Group();
  readonly ready = Promise.resolve();
  /** The datacenter's bed at the beginning's own levels (BEDS.beginning in src/audioConfig.ts): under the hall's
   *  recording and the fall, its cooling units an even rumble all along the ring. */
  readonly ambience = new DatacenterAmbience('beginning', () => 1);
  readonly fall = new FallSound();
  /** The ring hall's own bed (a recording, looped quietly). */
  readonly hall = new HallSound();
  /** How hard it shakes now (src/camera.ts rumble). */
  rumble = 0;
  private props: Props;
  /** The last pod: the relay's ghost in its panel, its cover shutting, its hatch swinging open. */
  private pod: Pod;
  /** The pod cabin's light, by its index in the layout's fixtures. */
  private cabinLight: number;
  /** The relay in the bag (its ghost shows where it goes). */
  private carrying = false;
  private ride = new Ride();
  private stuck = new StuckHints();
  /** The gates as of last frame (null: none yet since entering): a bit set since is seen happen. */
  private was: number | null = null;
  /** The hall's jolt, fading (s left). */
  private jolt = 0;
  private box: BoxLevel;
  /** The racks you've opened (only those get their insides modelled). */
  private racks: OpenRacks;
  private background = new THREE.Color(DATACENTER_ENV.background);
  /** The dead cabinet (shared/levels/beginningCabinet.ts), taken apart in the real disassembly mode. */
  private cabinet: Junk;
  /** Each gated door: its mesh, its bit and how far open (0..1). */
  private doors: { mesh: THREE.Mesh; bit: number; open: number; h: number }[] = [];

  /** F at the hatch (src/net.ts tutorial). */
  private hatch: () => void;

  static async build(hatch: () => void): Promise<BeginningStage> {
    return new BeginningStage(await bakeDataSliced(BEGINNING), hatch);
  }

  private constructor(bake: Awaited<ReturnType<typeof bakeDataSliced>>, hatch: () => void) {
    this.hatch = hatch;
    const L = BEGINNING;
    this.root.name = 'beginning';
    this.root.visible = false;
    this.root.matrixAutoUpdate = false;
    const maps = bakeMaps(L, bake);
    const mats = makeMaterials(maps, undefined, { fog: true, rackH: L.rackH });
    this.box = buildBoxLevel(L, this.root, mats, DATACENTER_ENV.ambient, true);
    this.root.add(new RingShell().group);
    this.racks = new OpenRacks(this.root, this.box.racks, L.racks, L.rackH ?? 2, (opening) => play(opening ? 'rack.open' : 'rack.shut'));
    this.props = new Props(mats);
    // Each prop onto the ring whole, at its own z (the space dome stays round the camera).
    this.props.group.updateMatrixWorld(true);
    const box3 = new THREE.Box3(), c = new THREE.Vector3();
    for (const child of [...this.props.group.children]) {
      if (child.userData.camera) continue;
      box3.setFromObject(child).getCenter(c);
      this.props.group.add(ringAnchor(c.z, child));
    }
    this.root.add(this.props.group);
    this.pod = new Pod({
      click: () => this.fall.pod('click'), clunk: () => this.fall.pod('clunk'), wake: () => this.fall.pod('wake'),
      hiss: () => this.fall.pod('hiss'), thud: () => this.fall.pod('thud'),
    });
    this.root.add(ringAnchor(POD.z, this.pod.group));
    // The pod cabin's light: dark till its hatch is down.
    this.cabinLight = L.fixtures.findIndex((f) => f.pos[0] === CABIN_LIGHT.x && f.pos[1] === CABIN_LIGHT.y && f.pos[2] === CABIN_LIGHT.z);
    this.box.pool.weight[this.cabinLight] = 0;
    // The cabinet lies on its back on the floor, everything but its relay long gone (and what held only that).
    this.cabinet = buildJunk(CABINET.kind, CABINET_SEED, CABINET_LEVEL);
    this.cabinet.root.rotation.y = CABINET.yaw;
    this.cabinet.root.position.set(CABINET.x, 0, CABINET.z);
    fastForward(this.cabinet, CABINET_DONE, CABINET_GONE);
    this.root.add(this.cabinet.root);
    this.root.updateMatrixWorld(true);
    const off = this.cabinet.fixed ? null : lowestOffset(this.cabinet.root);
    if (off !== null) this.cabinet.root.position.y += off;
    settle(this.cabinet.root);
    this.root.add(ringAnchor(CABINET.z, this.cabinet.root));
    for (const [i, mesh] of this.box.gated) {
      const b = L.boxes[i];
      if (b.gate! > 0) this.doors.push({ mesh, bit: b.gate!, open: 0, h: b.b[3] - b.b[2] });
    }
    this.root.updateMatrixWorld(true);
  }

  enter(scene: THREE.Scene, post: Post) {
    this.root.visible = true;
    scene.background = this.background;
    scene.fogNode = HAZE;
    scene.environmentNode = datacenterEnvironment;
    post.setProfile(DATACENTER_POST);
    setLevelShade(DATACENTER_ENV.handShade);
    this.ambience.start();
    this.fall.start();
    this.hall.start();
    this.was = null;
  }

  leave(_scene: THREE.Scene) {
    this.root.visible = false;
    this.ambience.stop();
    this.fall.stop();
    this.hall.stop();
    this.stuck.clear();
    this.racks.clear();
    this.rumble = 0;
  }

  gone() {
    this.ride.landed(); // (down in the desert, drawn round us: the dust clears over it)
  }

  workSite(me: PlayerState, link: (id: string) => SiteLink): WorkSite | null {
    if (Math.hypot(me.x - CABINET.x, me.z - CABINET.z) > CRASH_REACH || Math.abs(me.y) > 1) return null;
    const junk = this.cabinet;
    return { id: CABINET_ID, kind: CABINET.kind, label: junkSpec(CABINET.kind).label, junk, x: CABINET.x, z: CABINET.z, ground: () => 0, radius: 5, movable: false, link: link(CABINET_ID) };
  }

  /** The cabinet's own messages: the disassembly mode (main.ts) animates them while it works on it; this keeps nothing. */
  site(m: SiteMsg): boolean {
    return 'id' in m && m.id === CABINET_ID;
  }

  /** At the pod's hatch: its panel dark until the relay is in (F puts it in, if it's in the bag), then, once the hatch
   *  has swung open, F gets in. At a rack's front on the deck: F opens its door, or shuts it (rackDetail.ts). */
  interact(me: PlayerState, bag: Slots | undefined) {
    this.carrying = !!bag && hasItem(bag, RELAY);
    if (me.level !== this.level || me.gates & GATE.launch) return null;
    if (!inBox(POD.hatch, me.x, me.y, me.z)) {
      // A rack's door, in front of it.
      const i = me.y < 0.5 && me.y > -0.5 ? this.racks.at(me) : null;
      if (i === null) return null;
      return { prompt: this.racks.isOpen(i) ? TEXT.prompt.shut(TEXT.places.rack) : TEXT.prompt.open(TEXT.places.rack), act: () => this.racks.toggle(i) };
    }
    const act = this.hatch;
    if (me.gates & GATE.powered) return this.pod.open ? { prompt: TEXT.prompt.getIn, act } : null;
    return bag && hasItem(bag, RELAY) ? { prompt: TEXT.prompt.place(TEXT.parts.relay), act } : null;
  }

  beat(me: PlayerState) {
    const n = beatAt(me.x, me.y, me.z);
    const near = n === 1 && me.z > TRAY.z0 - 3 && me.z < TRAY.z0 ? 'tray' as const
      : n === 3 && me.z > GAP.z0 - 3 && me.z < GAP.z0 ? 'gap' as const
        : n === 4 && Math.hypot(me.x - CABINET.x, me.z - CABINET.z) < 3 ? 'cabinet' as const
          : n === 7 && me.x > 2 ? 'window' as const : null;
    return { n, near };
  }

  frozen(me: PlayerState) {
    return me.level === this.level && (me.gates & GATE.launch) !== 0;
  }

  update(f: StageFrame) {
    const cam = f.camera.position, gates = f.me.gates ?? 0;
    // The ring turned round the camera: the ring under it at its flat place, up towards the axis.
    this.root.matrix.fromArray(ringMatrixInverse(cam.z));
    this.root.matrixWorldNeedsUpdate = true;
    // Back after a reconnect with the relay already out: it's gone from the cabinet too.
    const relay = this.cabinet.slots.find((s) => s.index === RELAY_INDEX);
    if (gates & GATE.control && relay && !relay.taken) fastForward(this.cabinet, [], [RELAY_INDEX]);
    // What has happened since the last frame (on the first one after entering, nothing: it was so already).
    const fresh = this.was !== null, now = gates & ~(this.was ?? gates);
    this.was = gates;
    for (const d of this.doors) {
      const want = gates & d.bit ? 1 : 0;
      // (The control room's door stands a hand's width open, dead.)
      const ajar = d.bit === GATE.control ? 0.1 : 0;
      if (d.open === want && d.mesh.position.y >= ajar) continue;
      d.open = want ? Math.min(1, d.open + f.dt / DOOR_S) : 0;
      d.mesh.position.y = Math.max(ajar, d.open * (d.h - 0.05));
      d.mesh.updateMatrixWorld();
    }
    const me = f.me, beat = beatAt(me.x, me.y, me.z);
    // The jolt on the deck: a boom, the view thrown about.
    if (fresh && now & GATE.lights) {
      this.jolt = 1.6;
      this.fall.jolt(1);
    }
    this.jolt = Math.max(0, this.jolt - f.dt);
    // The pod: in it, down.
    if (now & GATE.launch || (gates & GATE.launch && this.ride.t < 0)) this.ride.start();
    const riding = this.ride.update(f.dt);
    this.rumble = Math.max(RUMBLE[beat] ?? 0, this.jolt > 0 ? Math.min(1, this.jolt) * 0.9 : 0, riding);
    // The lights shudder with it.
    const flick = this.jolt > 0 || riding > 0 ? 0.35 * this.rumble * (0.5 + 0.5 * Math.sin(f.time * 37) * Math.sin(f.time * 11.3)) : 0;
    this.box.pool.scale = (riding > 0 ? 0.6 : 1) - flick;
    const cabinOn = this.box.pool.points.some((l) => l.intensity > 0 && l.position.x === CABIN_LIGHT.x && l.position.y === CABIN_LIGHT.y && l.position.z === CABIN_LIGHT.z);
    this.pod.update(f.dt, f.time, gates, this.carrying, fresh, cabinOn);
    this.box.pool.weight[this.cabinLight] = this.pod.light;
    this.props.update(f.dt, beat, gates, (gates & GATE.blast) !== 0, (gates & GATE.shut) !== 0, fresh);
    this.stuck.update(f.dt, me, riding === 0);
    const zone = zoneAt(BEGINNING, cam.x, cam.z);
    this.box.pool.update(f.dt, cam, zone);
    this.ambience.update(f.dt, cam, null);
    this.hall.update();
    this.racks.update(f.dt, me);
    this.fall.update(f.dt, this.rumble, beat === 6);
  }
}
