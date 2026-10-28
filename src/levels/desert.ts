// The desert as a stage (src/levels/stage.ts, docs/levels.md): what main.ts used to build into the scene and update one
// by one, built into this stage's root instead. Its sun (and the CSM), hemisphere light, headlights and lamps are under
// the root, so they light the scene only while the desert is the stage. What it updates every frame (terrain streaming,
// the sky, blowing sand, crash sites ...) is not run at all while another level is the stage.
import * as THREE from 'three/webgpu';
import { LAB } from '../../shared/world.ts';
import { overShelter, sheltersNear } from '../../shared/shelters.ts';
import { DESERT_POST, type Post } from '../post.ts';
import { slice } from '../yield.ts';
import { footprints, streaks, tyreprints } from '../footprints.ts';
import { tyreDust } from '../tyreDust.ts';
import { addHeadlights } from '../bike.ts';
import { BlownSand } from '../blownSand.ts';
import { GuardianFx } from '../guardians.ts';
import { BossFx } from '../bosses.ts';
import { TeardownView } from '../teardown/teardown.ts';
import { Sky } from '../world/sky.ts';
import { Terrain } from '../world/terrain.ts';
import { addLabPlates } from '../world/labPlates.ts';
import { labFloor } from '../world/sandMaterial.ts';
import { PodsView } from '../world/pods.ts';
import { Shelters } from '../world/shelters.ts';
import { SolarFarms } from '../world/solarfarms.ts';
import { PlacedView } from '../world/placed.ts';
import { glbMaterial } from '../world/glbMaterial.ts';
import { WireView } from '../world/wires.ts';
import { Scrap } from '../world/scrap.ts';
import { CrashSites } from '../world/crashsites.ts';
import { Dust } from '../world/dust.ts';
import { MachineSites } from '../world/crash.ts';
import { Wrecks } from '../world/wrecks.ts';
import { LootView } from '../world/loot.ts';
import { VehicleView } from '../world/vehicles.ts';
import { CorpseView } from '../world/corpses.ts';
import { EntranceView } from '../world/entrance.ts';
import { setLevelShade } from '../world/materialLighting.ts';
import type { Stage, StageFrame } from './stage.ts';

export class DesertStage implements Stage {
  readonly level = 0;
  readonly root = new THREE.Group();
  readonly ready = Promise.resolve();
  sky!: Sky;
  terrain!: Terrain;
  pods!: PodsView;
  shelters!: Shelters;
  /** Old solar power towers and their heliostat fields, far out. */
  solarFarms!: SolarFarms;
  /** Plant beds, UV lamps, the buildings, the work stations and the chests: in the shelters and out on the sand. */
  placedView!: PlacedView;
  /** The power lines between them (shared/wires.ts). */
  wireView!: WireView;
  scrap!: Scrap;
  crashSites!: CrashSites;
  dust!: Dust;
  blownSand!: BlownSand;
  /** Wrecked machinery to take apart (not the crashed spacecraft above), and the disassembly table job. */
  machines!: MachineSites;
  /** Salvage wrecks out in the desert, carried home to the disassembly table. */
  wrecks!: Wrecks;
  /** The giant walkers around the crash sites, and the night drones. */
  guardianFx!: GuardianFx;
  /** The worm, carrier, colossus and queen (shared/bosses.ts). */
  bossFx!: BossFx;
  /** F at a machine site: the character walks up and the disassembly controls take over. */
  teardown!: TeardownView;
  /** Things lying about (loot, standing and lying motorcycles, packs): the desert's until levels have their own. */
  lootView!: LootView;
  vehicleView!: VehicleView;
  corpseView!: CorpseView;
  /** The datacenter's door (shared/levels/entrance.ts), and its hum. */
  entrance!: EntranceView;
  private undergroundFrame = 0;
  /** Its post profile: DESERT_POST, then as it was when it last left (the art bench's tuning survives a visit inside). */
  private profile = DESERT_POST;
  private post: Post | null = null;

  private constructor() {
    this.root.name = 'desert';
  }

  /** Built a slice at a time behind the loading screen (src/yield.ts), in the order main.ts built it. */
  static async build(scene: THREE.Scene, camera: THREE.PerspectiveCamera, canvas: HTMLElement): Promise<DesertStage> {
    const d = new DesertStage();
    const root = d.root;
    scene.add(root);
    d.sky = new Sky(root, scene);
    await slice();
    d.terrain = new Terrain(root);
    if (LAB) {
      labFloor(); // the dev test lab (shared/lab.ts): a plain floor with name plates
      addLabPlates(root);
    }
    await slice();
    await slice();
    d.pods = new PodsView(root); // the crashed pods players arrive in
    await slice();
    d.shelters = new Shelters(root); // small empty bunkers out in the desert
    d.solarFarms = new SolarFarms(root); // old solar power towers, far out
    await slice();
    d.placedView = new PlacedView(root, (mt, where) => glbMaterial(mt, where === 'out' ? null : d.shelters.lit));
    d.wireView = new WireView(root);
    await slice();
    d.scrap = new Scrap(root);
    await slice();
    d.crashSites = new CrashSites(root);
    await slice();
    d.dust = new Dust(root);
    await slice();
    d.blownSand = new BlownSand(root);
    await slice();
    d.machines = new MachineSites(root);
    await slice();
    d.wrecks = new Wrecks(root);
    await slice();
    d.guardianFx = new GuardianFx(root);
    await slice();
    d.bossFx = new BossFx(root, (...a) => d.guardianFx.thump(...a), (s) => d.guardianFx.jolt(s));
    await slice();
    d.teardown = new TeardownView(root, camera, canvas);
    await slice();
    d.lootView = new LootView(root, d.scrap);
    d.vehicleView = new VehicleView(root);
    d.corpseView = new CorpseView(root);
    root.add(footprints.mesh, tyreprints.mesh, streaks.mesh, tyreDust.mesh);
    d.entrance = new EntranceView(root);
    addHeadlights(root);
    return d;
  }

  enter(scene: THREE.Scene, post: Post) {
    this.root.visible = true;
    this.sky.enter(scene);
    this.post = post;
    post.setProfile(this.profile);
    setLevelShade(null); // the hands are shaded by the sun and the shelters (src/world/materialLighting.ts)
  }

  leave(_scene: THREE.Scene) {
    // The sun, its cascades and the dune shadows are under the root: hidden, they are neither updated nor drawn.
    this.root.visible = false;
    if (this.post) this.profile = this.post.liveProfile();
    this.entrance.silence();
  }

  update(f: StageFrame) {
    const { focus, camera } = f;
    this.terrain.update(focus);
    this.scrap.update(focus);
    this.crashSites.update(focus);
    this.pods.update(f.time);
    this.machines.update(focus);
    this.wrecks.update(focus);
    // The terrain casts into the shadow maps only near the underground places it roofs (src/world/heightShadow.ts does the dunes).
    this.terrain.setCasting(overShelter(focus.x, focus.z, 60));
    if (++this.undergroundFrame % 60 === 1) {
      // the rooms the dune shadows must not reach (src/world/heightShadow.ts): the nearest shelters, below their huts' floors
      const near = sheltersNear(focus.x, focus.z, 800).sort((a, b) => Math.hypot(a.x - focus.x, a.z - focus.z) - Math.hypot(b.x - focus.x, b.z - focus.z));
      this.sky.heights.setUnderground(near.slice(0, 4).map((s) => ({ x: s.x, z: s.z, r: 32, top: s.y - 0.3 })));
    }
    this.sky.update(f.dt, focus, camera, f.worldTime);
    if (!LAB) {
      this.blownSand.update(f.dt, focus);
      this.dust.update(f.dt, camera.position);
    }
    tyreDust.update(f.dt);
    this.shelters.update(camera.position);
    this.entrance.update(camera.position, true);
    this.solarFarms.update(camera.position);
  }
}
