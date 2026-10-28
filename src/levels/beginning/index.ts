// The beginning as a stage (src/levels/stage.ts, docs/levels/tutorial.md): the last datacenter in orbit, built from its
// layout (shared/levels/beginning.ts) with the datacenter's materials, racks, light pool and environment
// (src/levels/boxLevel.ts, src/levels/datacenter/). What moves is read off the player's gates (PlayerState.gates, set by the
// server): the doors slide open, the hall's lights go out row by row. Built on the first visit and kept.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { BEGINNING, CABINET, GATE, POD, beatAt, beginningLevel } from '../../../shared/levels/beginning.ts';
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

/** A door's panel slides up into its lintel this fast (s): collision is gone at once (docs/levels/tutorial.md). */
const DOOR_S = 0.4;

export class BeginningStage implements Stage {
  readonly level = beginningLevel.id;
  readonly root = new THREE.Group();
  readonly ready = Promise.resolve();
  readonly ambience = new DatacenterAmbience();
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
    this.box = buildBoxLevel(L, this.root, makeMaterials(maps, { z0: hall[4], cut: this.stripCut }), DATACENTER_ENV.ambient);
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
  }

  enter(scene: THREE.Scene, post: Post) {
    this.root.visible = true;
    scene.background = this.background;
    scene.fogNode = null;
    scene.environmentNode = datacenterEnvironment;
    post.setProfile(DATACENTER_POST);
    setLevelShade(DATACENTER_ENV.handShade);
    this.ambience.start();
  }

  leave(_scene: THREE.Scene) {
    this.root.visible = false;
    this.ambience.stop();
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

  /** At the pod's hatch: its panel dark until the relay is in (F puts it in, if it's in the bag), then F gets in. */
  interact(me: PlayerState, bag: Slots | undefined) {
    if (me.level !== this.level || !inBox(POD.hatch, me.x, me.y, me.z) || me.gates & GATE.launch) return null;
    const act = this.hatch;
    if (me.gates & GATE.powered) return { prompt: TEXT.prompt.getIn, act };
    return bag && hasItem(bag, RELAY) ? { prompt: TEXT.prompt.place(TEXT.parts.relay), act } : null;
  }

  beat(me: PlayerState) {
    return beatAt(me.x, me.y, me.z);
  }

  frozen(me: PlayerState) {
    return me.level === this.level && (me.gates & GATE.launch) !== 0;
  }

  update(f: StageFrame) {
    const cam = f.camera.position, gates = f.me.gates ?? 0;
    // Back after a reconnect with the relay already out: it's gone from the cabinet too.
    const relay = this.cabinet.slots.find((s) => s.index === RELAY_INDEX);
    if (gates & GATE.control && relay && !relay.taken) fastForward(this.cabinet, [], [RELAY_INDEX]);
    for (const d of this.doors) {
      const want = gates & d.bit ? 1 : 0;
      if (d.open === want) continue;
      d.open = want ? Math.min(1, d.open + f.dt / DOOR_S) : 0;
      d.mesh.position.y = d.open * (d.h - 0.05);
      d.mesh.updateMatrixWorld();
    }
    const zone = zoneAt(BEGINNING, cam.x, cam.z);
    this.box.pool.update(f.dt, cam, zone);
    this.ambience.update(f.dt, cam, null);
  }
}
