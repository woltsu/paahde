// The beginning as a stage (src/levels/stage.ts, docs/levels/tutorial.md): the last datacenter in orbit, built from its
// layout (shared/levels/beginning.ts) with the datacenter's materials, racks, light pool and environment
// (src/levels/boxLevel.ts, src/levels/datacenter/). What moves is read off the player's gates (PlayerState.gates, set by the
// server): the doors slide open, the hall's lights go out row by row behind you after its jolt, the cart crosses, the blast
// door comes down; the fall rumbles harder the further you get (the beat, never a clock); the station's screens say how
// it is going; the pod rides down. All client-only: nothing here is in the sim. Built on the first visit and kept.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { BEGINNING, CABIN_LIGHT, CABINET, GAP, GATE, POD, TRAY, beatAt, beginningLevel } from '../../../shared/levels/beginning.ts';
import { CABINET_GONE, CABINET_ID, CABINET_LEVEL, CABINET_SEED, RELAY, RELAY_INDEX } from '../../../shared/levels/beginningCabinet.ts';
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
import { buildBoxLevel, type BoxLevel } from '../boxLevel.ts';
import type { Stage, StageFrame } from '../stage.ts';
import { bakeDataSliced, bakeMaps } from '../datacenter/bake.ts';
import { makeMaterials } from '../datacenter/materials.ts';
import { DATACENTER_ENV, DATACENTER_POST, datacenterEnvironment } from '../datacenter/environment.ts';
import { DatacenterAmbience } from '../datacenter/ambience.ts';
import { Pod } from './pod.ts';
import { Props } from './props.ts';
import { FallSound } from './sound.ts';
import { Ride } from './ride.ts';
import { StuckHints } from './stuck.ts';

/** How hard it shakes at each beat (0..1, × the comfort motion setting in src/camera.ts): it grows as you go. */
const RUMBLE = [0.04, 0.1, 0.16, 0.26, 0.3, 0.3, 0.45, 0.55];
/** The hall's lights go out behind you this fast (m/s), this far behind you (m). */
const OUT_SPEED = 7;
const OUT_BEHIND = 3;

/** A door's panel slides up into its lintel this fast (s): collision is gone at once (docs/levels/tutorial.md). */
const DOOR_S = 0.4;

export class BeginningStage implements Stage {
  readonly level = beginningLevel.id;
  readonly root = new THREE.Group();
  readonly ready = Promise.resolve();
  readonly ambience = new DatacenterAmbience();
  readonly fall = new FallSound();
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
  /** The hall's fixtures (indices into the layout's) and where the dark has come to. */
  private hallLights: number[] = [];
  private cut = -1000;
  private box: BoxLevel;
  private background = new THREE.Color(DATACENTER_ENV.background);
  /** Where the hall's strips are dark up to (z): the strip shader's cut. */
  private stripCut = uniform(-1000);
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
    const maps = bakeMaps(L, bake);
    const hall = L.zones.hall;
    const mats = makeMaterials(maps, { z0: hall[4], cut: this.stripCut });
    this.box = buildBoxLevel(L, this.root, mats, DATACENTER_ENV.ambient);
    this.props = new Props(mats);
    this.root.add(this.props.group);
    this.pod = new Pod({
      click: () => this.fall.pod('click'), clunk: () => this.fall.pod('clunk'), wake: () => this.fall.pod('wake'),
      hiss: () => this.fall.pod('hiss'), thud: () => this.fall.pod('thud'),
    });
    this.root.add(this.pod.group);
    // The pod cabin's light: dark till its hatch is down.
    this.cabinLight = L.fixtures.findIndex((f) => f.pos[0] === CABIN_LIGHT.x && f.pos[1] === CABIN_LIGHT.y && f.pos[2] === CABIN_LIGHT.z);
    this.box.pool.weight[this.cabinLight] = 0;
    L.fixtures.forEach((f, i) => { if (f.zone === 'hall' && f.role === 'main') this.hallLights.push(i); });
    // The cabinet lies on its back on the floor, everything but its relay long gone.
    this.cabinet = buildJunk(CABINET.kind, CABINET_SEED, CABINET_LEVEL);
    this.cabinet.root.rotation.y = CABINET.yaw;
    this.cabinet.root.position.set(CABINET.x, 0, CABINET.z);
    fastForward(this.cabinet, [], CABINET_GONE);
    this.root.add(this.cabinet.root);
    this.root.updateMatrixWorld(true);
    const off = this.cabinet.fixed ? null : lowestOffset(this.cabinet.root);
    if (off !== null) this.cabinet.root.position.y += off;
    settle(this.cabinet.root);
    for (const [i, mesh] of this.box.gated) {
      const b = L.boxes[i];
      if (b.gate! > 0) this.doors.push({ mesh, bit: b.gate!, open: 0, h: b.b[3] - b.b[2] });
    }
    this.root.updateMatrixWorld(true);
  }

  enter(scene: THREE.Scene, post: Post) {
    this.root.visible = true;
    scene.background = this.background;
    scene.fogNode = null;
    scene.environmentNode = datacenterEnvironment;
    post.setProfile(DATACENTER_POST);
    setLevelShade(DATACENTER_ENV.handShade);
    this.ambience.start();
    this.fall.start();
    this.was = null;
  }

  leave(_scene: THREE.Scene) {
    this.root.visible = false;
    this.ambience.stop();
    this.fall.stop();
    this.stuck.clear();
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
   *  has swung open, F gets in. */
  interact(me: PlayerState, bag: Slots | undefined) {
    this.carrying = !!bag && hasItem(bag, RELAY);
    if (me.level !== this.level || !inBox(POD.hatch, me.x, me.y, me.z) || me.gates & GATE.launch) return null;
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
    const me = f.me, beat = beatAt(me.x, me.y, me.z), hall = BEGINNING.zones.hall;
    // The jolt in the hall: a boom, the view thrown about, the lights behind you going out row by row.
    if (fresh && now & GATE.lights) {
      this.jolt = 1.6;
      this.fall.jolt(1);
      this.cut = hall[4];
    }
    this.jolt = Math.max(0, this.jolt - f.dt);
    if (gates & GATE.lights) {
      const to = Math.min(hall[5], Math.max(hall[4], me.z - OUT_BEHIND));
      this.cut = fresh && this.cut > -1000 ? Math.min(to, this.cut + OUT_SPEED * f.dt) : to;
      if (this.cut < hall[4]) this.cut = hall[4];
    }
    this.stripCut.value = gates & GATE.lights ? this.cut : -1000;
    for (const i of this.hallLights) this.box.pool.weight[i] = BEGINNING.fixtures[i].pos[2] < this.stripCut.value ? 0 : 1;
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
    this.fall.update(f.dt, this.rumble, beat === 6);
  }
}
