import { viewCull } from './world/viewCull';
import { buildingBox, cargoBox, towerBox, vehicleBox } from '../shared/boxes.ts';
import * as THREE from 'three/webgpu';
import { BACK, DT, FORWARD, GRAB, isSlipFace, JUMP, quantizeYaw } from '../shared/sim.ts';
import { EYE_HEIGHT, quantizePitch } from '../shared/dig.ts';
import { moveOf } from '../shared/effects.ts';
import { scrapTarget } from '../shared/scrap.ts';
import { allBeaten } from '../shared/bosses.ts';
import { BENCH, CALM, LAB, TEST, WORLD_ID } from '../shared/world.ts';
import { bedTarget, EMPTY, GROWN, SPROUTS } from '../shared/garden.ts';
import { BEDROLL, bedLit, isPlaceable, placed } from '../shared/placed.ts';
import { stationTarget } from '../shared/stations.ts';
import { isTableId } from '../shared/crash.ts';
import { FirstPersonCamera } from './camera';
import { addCrosshair } from './crosshair';
import { ShieldFx } from './shieldFx';
import { InventoryHud, itemLabel } from './inventory';
import { stormAt } from '../shared/storm.ts';
import { addItem, debrisItem, SCRAP } from '../shared/items.ts';
import { isBound, kbd } from './bindings';
import { readInput, takePickup, ui } from './input';
import { pollPad } from './gamepad';
import { LocatorBar } from './locator';
import { Menu } from './menu';
import { StatsGraph } from './statsGraph';
import { getBrowserId, Net } from './net';
import { Lives } from './lives';
import { landing, rememberWorld, victory } from './landing';
import { refused } from './lobby';
import { myLook as storedLook } from './profile';
import { bodyScale, unpackLook } from '../shared/look.ts';
import { loadScavenger, ScavengerModel } from './models/scavenger';
import { Avatar } from './players';
import { Bike } from './bike';
import { Quad } from './quad';
import { Post } from './post';
import * as env from './world/env';
import { Wiring } from './wiring';
import { wires } from '../shared/wires.ts';
import { Placer } from './placing';
import { CrashSound } from './crashSound';
import { listen } from './echo';
import { tickEchoBus } from './acoustics';
import { coreCrashSites, crashSitesNear, debrisTarget } from '../shared/crashsites.ts';
import { CRASH_KINDS } from '../shared/crashKinds.ts';
import { clockText } from './world/dayNight';
import { DebugMenu } from './debugMenu.ts';
import { FlyCam } from './flyCam';
import { ArtBench } from './artBench';
import { wind } from './world/wind';
import { WindSound } from './windSound';
import { EngineSound } from './engineSound';
import { drinkSound } from './drinkSound';
import { grinderSound } from './grinderSound';
import { footsteps } from './footsteps';
import { bikeLandSound } from './bikeLandSound';
import { cartSound } from './cartSound';
import { music } from './music';
import { uiSound } from './uiSound';
import { slideSound } from './slideSound';
import { audio } from './audio';
import { heightAt } from '../shared/terrain.ts';
import { biome } from '../shared/biomes.ts';
import { indoors, inShelter } from '../shared/shelters.ts';
import { waterAt, WELL, wellAt, wellSpec } from '../shared/wells.ts';
import { wellSound } from './wellSound';
import { towerSound } from './towerSound';
import { pickupSound } from './pickupSound';
import { DynamicResolution } from './resolution';
import { graphics, onGraphics } from './graphics';
import { autoGraphicsFrame } from './autoGraphics';
import { PERF_RUN, perf } from './perf';
import { statsPref } from './options';
import { playerHands, Survival } from './water';
import { StormFx } from './storm';
import { VortexFx } from './vortex';
import { vorticesNear, type Vortex } from '../shared/vortex.ts';
import { VortexSound } from './vortexSound';
import { GasFx } from './gas';
import { Speech } from './speech';
import { ViewModel } from './viewmodel';
import { Telescope } from './telescope';
import { Rifle } from './rifle';
import { Jammer } from './jammer';
import { Grinder } from './grinder';
import { Receiver } from './receiver';
import { BossBar } from './bossBar';
import { Thrower } from './throw';
import { Mace } from './mace';
import { zaps } from './world/zaps';
import { blasts } from './world/blasts';
import { BenchMenu } from './benchMenu';
import { BuildMenu } from './buildMenu';
import { machinesAt } from '../shared/crash.ts';
import { LAB_LOOK } from '../shared/lab.ts';
import { junkSpec, SALVAGE } from '../shared/salvage.ts';
import { bagShape, equipped, isBuilding, locatorRange, quality, repaired, spyglassZoom, stormWarnS } from '../shared/gear.ts';
import { carriedGear, gearTiers, wornGear } from '../shared/gearBits.ts';
import { lootPrompt } from './world/loot';
import { cartTargets, ownVehicleTargets } from './world/vehicles';
import { parked, vehicles, vehicleTarget, pillionTarget } from '../shared/vehicles.ts';
import { cartTarget } from '../shared/cart.ts';
import { WRENCH } from '../shared/crafting.ts';
import type { Tower } from './world/carts';
import { corpseTargets } from './world/corpses';
import { corpsesNear } from '../shared/corpse.ts';
import { openBoxes, TOWER_REACH_SPOT } from '../shared/storage.ts';
import { climbingOn, DECK_STEP, GRAB_REACH, SPOT_ITEMS, SPOTS, spotNear, TOWER, towersNear } from '../shared/towers.ts';
import { darkAt, windSpeed } from '../shared/power.ts';
import { Chat } from './chat';
import { nameGate } from './name';
import { prologue } from './prologue';
import { tools } from './input';
import { Trophies } from './world/trophies';
import { nearPod } from '../shared/podSpot.ts';
import { isTrophy, trophyFree } from '../shared/trophies.ts';
import { update } from './update';
import { registerPooledLights } from './world/pooledLight.ts';
import { initializeRenderer, showReload } from './recovery.ts';
import { LOADING_FRAME_MS, slice } from './yield';
import { Warmup } from './warmup';
import { DesertStage } from './levels/desert';
import { StageSwitch, type Stage } from './levels/stage';
import { doorAt, level } from '../shared/levels.ts';
import { setGround } from './ground.ts';
import { BED, buildBed } from './levels/datacenter/ambience';
import { datacenterLevel } from '../shared/levels/datacenter.ts';
import { beginningLevel } from '../shared/levels/beginning.ts';
import type { Storm } from '../shared/storm.ts';
import type { Gas } from '../shared/gas.ts';
import { TEXT } from '../shared/text.ts';

// WebGPURenderer uses WebGPU when available and falls back to WebGL2 otherwise.
// powerPreference asks for the discrete GPU (eGPU, laptop dGPU) over the integrated one when there is a choice.
perf.milestone('main-start');
// GPU timestamp queries (src/perf.ts) are only set up when stats were on at load, or for a benchmark run: they cost a readback a frame.
const gpuTimes = statsPref() || PERF_RUN;
const renderer = new THREE.WebGPURenderer({ antialias: graphics.antialias, powerPreference: 'high-performance', trackTimestamp: gpuTimes });
registerPooledLights(renderer);
// (the stats line counts a whole frame: the shadow passes, the scene and the post passes, not just the last render call, which is a full-screen quad)
renderer.info.autoReset = false;
const resolution = new DynamicResolution(renderer); // sets the pixel ratio, then keeps it near 60 fps
resolution.setScale(graphics.resScale);
resolution.setDynamic(graphics.dynamicRes);
resolution.setTargetFps(graphics.fpsLimit || 60);
resolution.setMin(graphics.minRes);
onGraphics((g, changed) => {
  if (changed === 'resScale') resolution.setScale(g.resScale);
  if (changed === 'dynamicRes') resolution.setDynamic(g.dynamicRes);
  if (changed === 'minRes') resolution.setMin(g.minRes);
  if (changed === 'fpsLimit') resolution.setTargetFps(g.fpsLimit || 60);
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const orbit = new FirstPersonCamera(renderer.domElement);
await slice();
const fly = new FlyCam(renderer.domElement); // F3 → Fly camera, for shooting video
// The desert (src/levels/desert.ts): the terrain, sky, sun, pods, shelters, crash sites, walkers, bosses ..., all under
// its root. Other levels are stages too, built on the first visit; the active one owns the scene's look and lights.
const desert = await DesertStage.build(scene, orbit.camera, renderer.domElement);
const { cartView, sky, terrain, placedView, wireView, scrap, crashSites, dust, blownSand, machines, wrecks, guardianFx, bossFx, teardown, lootView, vehicleView, corpseView } = desert;
sky.renderer = renderer;
const crashSound = new CrashSound();
await slice();
const post = new Post(renderer, scene, orbit.camera);
await slice();
/** The stage being drawn (src/levels/stage.ts): the desert's until a level change. */
let stage: Stage = desert;
stage.enter(scene, post);
const viewmodel = new ViewModel(orbit, scene); // first-person hands, parented to the camera
await slice();

const windSound = new WindSound();
await slice();
const engineSound = new EngineSound();
await slice();
const storm = new StormFx();
const vortexFx = new VortexFx();
const vortexSound = new VortexSound();
const nearVortices: Vortex[] = [];
/** What a level without weather is fed instead (shared/levels.ts): the volumes then fade to nothing. */
const NO_STORMS: Storm[] = [];
const NO_GAS: Gas[] = [];
const NO_VORTICES: Vortex[] = [];
const gas = new GasFx();
await slice();
machines.busy = () => teardown.current?.id;
viewCull.camera = orbit.camera;
// Debug handle for screenshots/tuning from the console: open with ?debug.
if (location.search.includes('debug')) {
  // crash: every crash site's id, centre, wreck kind and its machines (shared/crashsites.ts, shared/crash.ts).
  const crash = coreCrashSites().map((s) => ({ id: s.id, x: Math.round(s.x), z: Math.round(s.z), kind: s.pieces[0].kind, pieces: s.pieces.length, machines: machinesAt(s).map((m) => m.kind) }));
  Object.assign(window, { dbg: { orbit, sky, post, scene, renderer, env, terrain, scrap, wind, blownSand, dust, windSound, storm, gas, fly, viewmodel, crashSites, crashSound, crash, playerHands, machines, wrecks, teardown, placedView, guardianFx, bossFx } });
}

const net = new Net(getBrowserId());
const lives = new Lives();
/** The boss kinds beaten (shared/bosses.ts bossBit mask), from the server. */
let beatenNow = 0;
net.onLives = (n, beaten) => {
  if (!CALM && !TEST) rememberWorld(WORLD_ID);
  lives.set(n, beaten);
  beatenNow = beaten;
  if (allBeaten(beaten)) victory(WORLD_ID);
};
net.onEnded = (why) => (why === 'over' || why === 'missing' ? landing(why) : refused(why));
net.onIncompatible = () => { audio.suspendForRecovery(); showReload(TEXT.recovery.update); };
net.onScrapGot = (n, dropped) => teardown.gotScrap(n, dropped);
if (location.search.includes('debug')) Object.assign((window as unknown as { dbg: object }).dbg, { net });
// Machine progress (large sites and the disassembly table), from the server: every machine is kept up to date,
// and the one being worked on gets it through the disassembly mode, animated.
net.onSite = (m) => {
  const cur = teardown.current;
  // A machine of the level's own (the beginning's cabinet) is its stage's; the rest the desert's.
  if (!stage.site?.(m)) machines.apply(m, cur?.id ?? null);
  // Someone scrapped the table's machine while we work on it (a finished one stays open until we leave).
  if (m.t === 'bench' && !m.job && cur?.id === m.id) teardown.end();
  if (m.t === 'siteTook' && cur?.id === m.id) {
    teardown.applyTook(m.i, m.ok, m.reason);
  }
  if (!cur || m.t === 'sites' || m.t === 'bench' || m.t === 'siteReset' || m.t === 'siteTook' || m.t === 'siteRolls' || cur.id !== m.id) return;
  if (m.t === 'siteState') {
    for (const i of m.done) teardown.applyDone(i, true);
    for (const i of m.taken) teardown.applyTake(i, false);
  } else if (m.t === 'siteDone') teardown.applyDone(m.i);
  else teardown.applyTake(m.i, m.by === net.id);
};
// Scrap the machine on the disassembly table, finished or not (what is still on it is destroyed and pays more), if the scrap fits in the bag.
const scrapBench = (at: string) => {
  const n = machines.tableMenu(at, net.boxes.bag).scrap;
  if (!addItem([...(net.boxes.bag ?? [])], SCRAP, n, () => 0, bagShape(net.boxes.equip))) return false;
  net.benchScrap(at);
  pickupSound.play();
  hud.toast(TEXT.notice.got(n, itemLabel(SCRAP)));
  return true;
};
const benchMenu = new BenchMenu(renderer.domElement);
const buildMenu = new BuildMenu(renderer.domElement); // the wrench's (src/placing.ts)
// The bosses' trophies (shared/trophies.ts): in the menu once won and while not up; their models are made from the bosses'.
const trophies = new Trophies((kind, obj) => placedView.provide(kind, obj));
buildMenu.available = (kind) => {
  if (!isTrophy(kind)) return true;
  const free = trophyFree(kind, beatenNow, placed);
  if (free) trophies.need(kind); // (for the preview)
  return free;
};
new DebugMenu(() => sky.day.tod, (tod) => net.shareTimeOfDay(tod), () => net.resetSharedTime(), (front) => net.summonStorm(front), (tier) => net.debugGear(tier), () => net.debugHit(), (what) => net.summonBot(what),
  (all) => (all ? net.labReset() : net.labReset(machines.nearestLab(net.me.x, net.me.z)?.site.id)),
  (off) => net.debugHeat(off),
  (off) => net.debugWeather(off),
  fly, () => fly.start(orbit.camera, orbit.yaw, orbit.pitch),
  (kind, n, tier) => net.debugGive(kind, n, tier),
  (working, quad) => net.debugBike(working, quad),
  (key) => net.debugLevel(key),
  net);
// The art-style bench (?w=bench, dev only): fixed shots and the look panel (src/artBench.ts).
const artBench = BENCH ? new ArtBench({ fly, camera: orbit.camera, day: sky.day, post, blownSand, startFly: () => fly.start(orbit.camera, orbit.yaw, orbit.pitch) }) : null;
new Chat(net);
const names = nameGate(net, renderer.domElement);
// New builds wait for a quiet moment to reload (src/update.ts).
update.busy = () => fly.active || guardianFx.combat || bossFx.combat || net.me.riding || teardown.active || !!net.down;
const shieldFx = new ShieldFx(scene, () => orbit.camera.position, () => net.id, (m) => guardianFx.jolt(m));
net.onShieldBreak = (m) => shieldFx.play(m);
addCrosshair();
loadScavenger().catch((e) => console.warn('scavenger model failed to load; keeping placeholders', e));
// Dark until the player model has loaded, so the first frames show no placeholder bodies; after 30 s, whatever has loaded.
const cover = document.getElementById('cover')!; // in index.html, so it is up before this script has loaded
// The bar: every model and texture through three's default loading manager (never runs backwards as more loads
// are queued), then the shaders being built (src/warmup.ts) for the last stretch.
const LOADS_SHARE = 0.6;
let coverP = 0;
let warmP = 0;
const coverProgress = () => prologue.progress(LOADS_SHARE * coverP + (1 - LOADS_SHARE) * warmP);
THREE.DefaultLoadingManager.onProgress = (_url, done, total) => {
  coverP = Math.max(coverP, done / total);
  coverProgress();
};
let loaded = false;
let coverFrames = 0; // frames drawn behind the cover once loaded (lets shaders compile)
let bodyLoaded = false;
let coverTimedOut = false;
Promise.allSettled([loadScavenger(), viewmodel.ready]).then(() => (bodyLoaded = true));
setTimeout(() => (coverTimedOut = true), 30_000);
// What you wear (shared/look.ts), chosen on the main menu (src/lookView.ts); others get it with your 'hello'.
const myLook = storedLook();
orbit.stride = bodyScale(unpackLook(myLook)).stride;
const me = new Avatar(0xffffff);
if (location.search.includes('debug')) Object.assign((window as unknown as { dbg: object }).dbg, { me });
me.setShadowOnly(true); // first person: your body casts a shadow but is not drawn
let bodyHidden = true;
const myModel = new ScavengerModel();
myModel.ready.then(() => me.setModel(myModel, net.color), () => myModel.dispose());
scene.add(me.root);
const remotes = new Map<number, Avatar>();
// Sand bikes and quads, one per riding player (keyed by their id, 0 for us): drawn here, simulated in shared/sim.ts.
const bikes = new Map<number, Bike | Quad>();
let lastHeading = NaN;
/** Last frame's input bits (a press, not a hold). */
let lastInput = 0;
/** Draw player `id`'s bike (or quad) while they ride, with `avatar` seated on it, and drop it when they get off.
 *  False when not riding: then the caller updates the avatar on foot. */
function ride(id: number, avatar: Avatar, p: { riding: boolean; pitch?: number; bike: number; quad?: boolean } & Parameters<Bike['update']>[0], dt: number): boolean {
  let bike = bikes.get(id);
  if (bike && (!p.riding || bike instanceof Quad !== !!p.quad)) {
    bike.dispose();
    bikes.delete(id);
    avatar.root.rotation.set(0, avatar.root.rotation.y, 0);
    bike = undefined;
  }
  if (!p.riding) return false;
  if (!bike) bikes.set(id, (bike = p.quad ? new Quad(scene) : new Bike(scene)));
  bike.setTier(Math.max(0, Math.min(3, Math.floor(p.bike - 1 + 1e-6)))); // PlayerState.bike: 1 + its quality
  bike.update(p, dt);
  bike.seat(avatar.root);
  avatar.update({ x: p.x, y: p.y, z: p.z, facing: p.heading, speed: 0, grounded: true, pitch: p.pitch, ride: bike.rider() }, dt);
  return true;
}
/** Seat `avatar` on the back of the quad drawn under rider `driver` (its key in `bikes`: 0 for us), as its passenger.
 *  False if that quad isn't drawn: then the caller updates the avatar where its pose says. */
function pillion(driver: number, avatar: Avatar, pitch: number, dt: number): boolean {
  const quad = bikes.get(driver);
  if (!(quad instanceof Quad)) return false;
  quad.seat(avatar.root);
  avatar.update({ x: quad.root.position.x, y: quad.root.position.y, z: quad.root.position.z, facing: quad.root.rotation.y, speed: 0, grounded: true, pitch, ride: quad.passenger() }, dt);
  return true;
}
/** Player `id` towing cart `tow` (src/world/carts.ts), their bike drawn as bikes.get(`bike`). */
function tower(id: number, bike: number, tow: number, x: number, y: number, z: number, heading: number, hitch: number): Tower {
  const b = bikes.get(bike);
  const t: Tower = { id, tow, x, y, z, heading, hitch };
  if (b) {
    const at = b.hitchAt(new THREE.Vector3());
    t.at = { x: at.x, y: at.y, z: at.z };
    t.pitch = b.drawnPitch;
  }
  return t;
}
const eye = new THREE.Vector3();
const RIDE_EYE_AHEAD = 0.15;
// On a ladder the same, less: the rungs are close (shared/towers.ts CLIMB_D).
const LADDER_EYE_AHEAD = 0.1;
const locator = new LocatorBar();
const hud = new InventoryHud(net, renderer.domElement);
const survival = new Survival(net);
// Back in a loaded world-state snapshot (debug menu → Scenarios, server/snapshot.ts): the slot its protagonist held.
net.onSnapshot = (slot) => survival.take(slot);
survival.wheelBusy = () => fly.active;
const speech = new Speech();
// Once the first thing said on arriving is read, how to look in the bag.
speech.onSaid = (id, showS) => { if (id === 'start') setTimeout(() => hud.oneTimeHint('inventory'), showS * 1000); };
guardianFx.onAggro = (kind) => speech.event('aggro', kind);
guardianFx.onKill = (kind) => speech.event('killed', kind);
bossFx.onKill = () => speech.event('killed', 'boss');
/** The find last looked at, so the character remarks on it once per look (src/speechLines.ts 'see'). */
let seenFind: number | null = null;
/** The vehicle (id and whether it works) we last looked at, for the speech. */
let seenVehicle: string | null = null;
/** The machine or wreck last in reach ('near'), and the item ids in the bag at the last frame ('got'; null until the
 *  bag first arrives: what we log in with is old news). */
let seenSite: string | null = null;
let bagIds: Set<number> | null = null;
const menu = new Menu(renderer.domElement, (v) => post.setAoIntensity(v));
menu.onSkip = () => net.tutorial('skip');
const telescope = new Telescope(orbit);
if (location.search.includes('debug')) Object.assign((window as unknown as { dbg: object }).dbg, { telescope });
const grinder = new Grinder(scene, orbit.camera, [me.root]);
const jammer = new Jammer(orbit, net, guardianFx.jets, guardianFx.drones);
const receiver = new Receiver(orbit, net);
const bossBar = new BossBar();
if (location.search.includes('debug')) Object.assign((window as unknown as { dbg: object }).dbg, { jammer });
// The beam starts at the drawn gun: the first-person one, or in third person the one in the body's hand.
const rifle = new Rifle(orbit, net, guardianFx.guardians, guardianFx.drones, guardianFx.jets, guardianFx.harvesters,
  (out) => viewmodel.muzzle(out) ?? (orbit.showBody && me.muzzle(out) ? out : null));
rifle.nest = guardianFx.nest;
rifle.remoteMuzzle = (id, out) => (remotes.get(id)?.muzzle(out) ? out : null);
scene.add(zaps.root);
zaps.setCamera(orbit.camera);
scene.add(blasts.root);
blasts.setCamera(orbit.camera);
const thrower = new Thrower(scene, orbit, net, scrap);
thrower.piece = () => viewmodel.scrapPiece(); // the piece in flight is the one drawn in the hand
const mace = new Mace(orbit, net, guardianFx.guardians);
mace.nest = guardianFx.nest;
mace.onSwung = (by) => (by === net.id ? me : remotes.get(by))?.swing(); // the stroke on the avatar
if (location.search.includes('debug')) Object.assign((window as unknown as { dbg: object }).dbg, { rifle, zaps, blasts });
net.onSpawn = () => placedView.setSpawn(net.spawn?.id ?? null);
net.onPlaced = () => {
  for (const p of placed) if (isTrophy(p.kind)) trophies.need(p.kind);
  placedView.sync(placed, net.garden);
  wireView.sync(wires);
};
net.onVehicles = () => hud.vehiclesChanged();
net.onTowers = () => desert.towers.setAlive(net.towersAlive);
net.onPower = () => {
  placedView.setPower(net.power);
  hud.powerChanged();
};
net.onNotice = (text) => {
  if (text === TEXT.notice.bagFull) { // the server refused a find (server/world.ts)
    uiSound.full();
    speech.event('bagFull', undefined);
  }
  hud.toast(text);
};
/** At an electric well that doesn't run (shared/wells.ts), and why: its pump's parts, or its power. */
function dryWell(m: { x: number; y: number; z: number }): 'parts' | 'power' | null {
  if (waterAt(m.x, m.y, m.z)) return null;
  const w = wellAt(m.x, m.y, m.z, 0, placed, true);
  return w ? (wellSpec(w.parts) ? 'power' : 'parts') : null;
}

function bagFull() {
  hud.toast(TEXT.notice.bagFull);
  uiSound.full();
  speech.event('bagFull', undefined);
}
const placer = new Placer(net, placedView, buildMenu);
// The cart key (the rotate key, R / d-pad ←, free when nothing's being put down): the cart in view (anyone's) unfolds or packs.
let cartKey = false;
addEventListener('keydown', (e) => {
  if (!ui.inventoryOpen && !e.repeat && !e.ctrlKey && !e.metaKey && isBound('rotate', e.code)) cartKey = true;
});
const wiring = new Wiring(net, wireView);

window.addEventListener('resize', () => {
  orbit.resize();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const graphicsReady = await initializeRenderer(renderer, () => { net.stop(); audio.suspendForRecovery(); });
const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
// which GPU the browser actually gave us (shown in the stats line, so "integrated or not" can be read off it)
const gpuInfo = (renderer.backend as unknown as { device?: { adapterInfo?: { vendor?: string; architecture?: string; description?: string } } }).device?.adapterInfo;
const gpuName = gpuInfo ? (gpuInfo.description || [gpuInfo.vendor, gpuInfo.architecture].filter(Boolean).join(' ')) : '';
const backendText = gpuName ? `${backend} ${gpuName}` : backend;
perf.gpuTracked = gpuTimes && !!(renderer.backend as { trackTimestamp?: boolean }).trackTimestamp;
perf.describe({ backend, gpu: gpuName, gpuTimestamps: perf.gpuTracked, world: WORLD_ID });
sky.heights.init(renderer); // (before any material samples the dune-shadow grids: src/world/heightShadow.ts)
perf.milestone('renderer-ready');
perf.scene = scene;
if (PERF_RUN) Object.assign(window, { __dbg: { renderer, sky, net, terrain, scene, THREE, heightAt, audio } }); // (tools/perf.ts --eval)
perf.onDone = () => {
  // (for the pictures tools/perf.ts takes: look away from the sun, a little down, where the shadows fall; `&pview=<m>` lifts the camera
  // that high above the player, on the fly camera, without the HUD, to see the shadows over a wide stretch)
  const l = sky.heights.light.value;
  orbit.yaw = Math.atan2(l.x, l.z) + (new URLSearchParams(location.search).get('pface') === 'sun' ? Math.PI : 0); // (`&pface=sun`: into the sun)
  orbit.pitch = -0.12;
  const lift = Number(new URLSearchParams(location.search).get('pview'));
  if (lift > 0) {
    fly.start(orbit.camera, orbit.yaw, orbit.pitch);
    fly.setClean(true);
    const pitch = Number(new URLSearchParams(location.search).get('ppitch')); // (degrees down; default a gentle look over the land)
    fly.place(new THREE.Vector3(net.me.x, net.me.y + lift, net.me.z), orbit.yaw, pitch ? (-pitch * Math.PI) / 180 : -Math.atan2(lift, lift * 6));
  }
};
perf.setTod = (tod) => net.shareTimeOfDay(tod);
perf.player = () => ({ x: net.me.x, z: net.me.z, down: survival.dead || net.down !== null, heat: survival.heatLevel });
perf.cascades = () => sky.csm.lights.map((l) => l.shadow!.camera);

const timer = new THREE.Timer();
const focus = new THREE.Vector3();
let accumulator = 0;
let lastLoadFrame = 0;
let warmed = false;
let warming = false;
/** Resolves when the GPU has finished what was sent so far (WebGPU), else after a moment. */
const gpuIdle = (): Promise<void> => {
  const queue = (renderer.backend as unknown as { device?: GPUDevice }).device?.queue;
  return queue ? queue.onSubmittedWorkDone() : new Promise((r) => setTimeout(r, 40));
};
const warm = new Warmup([scene, orbit.camera], () => post.render(), renderer.backend);
// Levels (src/levels/stage.ts): when the server puts us in another level (net.me.level changes: a door, a respawn, the
// debug menu), the view fades to black, the stage is built on the first visit (its materials compiled behind the black,
// src/warmup.ts) and swapped in, and the view fades back. While it runs nothing is drawn: the last frame stays under the fade.
const levels = new StageSwitch(scene, post, desert, async (id) => {
  if (id === beginningLevel.id) {
    const { BeginningStage } = await import('./levels/beginning/index.ts');
    return BeginningStage.build(() => net.tutorial('hatch'));
  }
  if (id !== datacenterLevel.id) return null;
  const { DatacenterStage } = await import('./levels/datacenter/index.ts');
  return DatacenterStage.build(); // (a slice at a time: it may be built ahead while walking up to its door)
}, async () => {
  const w = new Warmup([scene, orbit.camera], () => post.render(), renderer.backend);
  await w.run(gpuIdle);
}, (s) => (stage = s));
// Through a door you face the way it leads (the state the server put us in), before the next tick turns us back.
net.onTeleport = (state) => {
  orbit.yaw = state.facing;
  orbit.pitch = 0;
};
net.onFace = (facing) => {
  orbit.yaw = facing;
  orbit.pitch = 0;
};
levels.onBroken = () => { audio.suspendForRecovery(); showReload(TEXT.recovery.update); };
if (location.search.includes('debug')) Object.assign((window as unknown as { dbg: object }).dbg, { levels, dcBed: { buildBed, BED }, fall: () => import('./levels/beginning/sound.ts') });
terrain.loading = true;
let joined = false; // until the first welcome, net.me is the default spawn, not our saved position
// ?spawn=crash / field: once joined, turn to face the machine or the scrap field we were put next to.
const spawnAt = new URLSearchParams(location.search).get('spawn');
let faceCrash = spawnAt === 'crash' || spawnAt === 'field' || LAB;
const statsGraph = new StatsGraph();

/** When the next frame is due, with the FPS target (Options → Graphics): frames before it are skipped. */
let nextFrameAt = 0;
renderer.setAnimationLoop((time) => {
  if (!graphicsReady()) { void renderer.setAnimationLoop(null); return; }
  if (graphics.fpsLimit) {
    const every = 1000 / graphics.fpsLimit;
    if (time < nextFrameAt - 1) return;
    nextFrameAt = time - nextFrameAt > every ? time + every : nextFrameAt + every; // keeps the average on target; no catching up after a stall
  }
  perf.frameStart();
  net.telemetry.frame(performance.now());
  timer.update(time);
  const frameDt = Math.min(timer.getDelta(), 0.25);
  if (!joined && !net.connected) {
    return;
  }
  if (!joined) {
    prologue.joined();
    // Joined inside a level (a new player's beginning): facing the way its spawn faces. The desert's terrain is first
    // streamed on the way out, so its materials are compiled then, behind the switch's cover.
    if (!level(net.me.level).things) {
      orbit.yaw = net.me.facing;
      levels.warmAgain(desert.level);
    }
  }
  joined = true;
  artBench?.frame(frameDt); // (from the first frame on, so the world streams in round the shot behind the loading screen)
  perf.milestone('joined');
  // Once the models and terrain are in, draw real frames a few materials at a time (src/warmup.ts): the first full
  // frame would take seconds to build every shader and freeze the page. Nothing else is drawn until that is done.
  // (Joined inside a level, a new player's beginning above all, the desert's terrain isn't streamed: nothing to wait for.)
  const modelsIn = bodyLoaded && (terrain.built || !level(net.me.level).things);
  if (modelsIn) perf.milestone('models-in');
  loaded ||= coverTimedOut || warmed;
  if (loaded) perf.milestone('loaded');
  // Behind the loading screen, draw at about 15 fps so the page has time for the game on it (src/yield.ts).
  if (!loaded && time - lastLoadFrame < LOADING_FRAME_MS) return;
  lastLoadFrame = time;
  if (loaded && prologue.told() && coverFrames < 3 && ++coverFrames === 3) {
    cover.style.opacity = '0';
    setTimeout(() => (prologue.stop(), cover.remove(), perf.milestone('cover-gone')), 500);
    names.loaded();
  }
  if (faceCrash) {
    faceCrash = false;
    const near = crashSitesNear(net.me.x, net.me.z, 200);
    const site = LAB ? LAB_LOOK : spawnAt === 'field' ? near.find((s) => s.level === 0) : near.find((s) => s.level > 0)?.machines[0];
    if (site) orbit.yaw = Math.atan2(-(site.x - net.me.x), -(site.z - net.me.z));
  }
  resolution.update(frameDt);

  // Fixed-step simulation: identical DT on client and server keeps prediction in agreement.
  accumulator += frameDt;
  teardown.watch(net.me); // walking far enough away from a machine ends the disassembly
  // Flying the camera, the body stands where it was, facing the way it did.
  if (fly.active) {
    orbit.yaw = fly.heldYaw;
    orbit.pitch = fly.heldPitch;
  }
  pollPad(frameDt, orbit, renderer.domElement, net.boxes.bag);
  const input = !net.isReady || fly.active || stage.frozen?.(net.me) ? 0 : readInput(); // standing still until named (or in the pod going down)
  // (F at a ladder is one press: its bit goes out on the frame's first tick only, or it would grab and let go at once.)
  for (let once = input; accumulator >= DT; once &= ~GRAB) {
    net.tick(once, quantizeYaw(orbit.yaw), quantizePitch(orbit.pitch));
    accumulator -= DT;
  }

  const others = net.frame(frameDt);
  // The level we're in (shared/levels.ts): what of the desert's goes on here is read off its properties.
  const L = level(net.me.level);
  if (joined && loaded) levels.follow(net.me.level);
  me.levelFloor = L.flat;
  menu.skippable = L.skippable;
  setGround(net.me.level, net.me.y, net.me.gates);
  for (const a of remotes.values()) a.levelFloor = L.flat;
  // The gun raised (or just fired), or the spyglass: others see it shouldered, or at the eye (src/models/scavenger.ts).
  const aiming = playerHands.aim > 0.5 || playerHands.looking;
  net.setHands(playerHands.held, playerHands.drinking, playerHands.filling, aiming, playerHands.grinding);

  me.setColor(net.color);
  me.setLook(myLook);
  const s = net.me;
  // Drawn between the last two ticks (the leftover accumulator), so motion is even at any frame rate.
  const v = net.view(accumulator / DT);
  // On the back of a quad: whoever rides it, as we see them (their quad is drawn from their pose).
  const driver = s.pillion ? others.find((o) => o.id === s.pillion && o.riding) : undefined;
  // On the bike (or the back of the quad) the camera turns with it; the mouse still looks around on top.
  const rideHeading = s.riding ? v.heading : driver ? driver.facing : NaN;
  if (Number.isFinite(rideHeading) && Number.isFinite(lastHeading)) orbit.yaw += Math.atan2(Math.sin(rideHeading - lastHeading), Math.cos(rideHeading - lastHeading));
  lastHeading = rideHeading;
  // What's in hand (the selected hotbar slot) and worn (shared/gear.ts): drawn on the body, and sets what the tools can do.
  const inHand = tools.slot >= 0 ? net.boxes.bag?.[tools.slot] : null;
  me.setOutfit(inHand?.kind ?? null, wornGear(net.boxes.equip) | carriedGear(net.boxes.bag, tools.slot), gearTiers(net.boxes.equip, net.boxes.bag, tools.slot));
  const riding = ride(0, me, { ...s, x: v.x, y: v.y, z: v.z, heading: v.heading, nose: v.nose, pitch: orbit.pitch }, frameDt);
  if (!riding && !driver) {
    me.update(
      { x: v.x, y: v.y, z: v.z, facing: v.facing, speed: Math.hypot(s.vx, s.vz), vx: s.vx, vz: s.vz, grounded: s.grounded, powerSlide: s.sliding, crouching: s.crouching,
      pitch: orbit.pitch, drinking: playerHands.drinking, aiming: aiming || net.justFired(net.id), down: net.down,
      look: orbit.freeYaw, climb: s.climb },
      frameDt,
    );
  }

  const seen = new Set<number>();
  for (const r of others) {
    seen.add(r.id);
    let avatar = remotes.get(r.id);
    if (!avatar) {
      const a = (avatar = new Avatar(r.color));
      a.remote = true;
      remotes.set(r.id, a);
      scene.add(a.root);
      // Placeholder until the rigged scavenger has loaded, then swap it in.
      const model = new ScavengerModel(r.color);
      model.ready.then(
        () => (remotes.get(r.id) === a ? a.setModel(model, r.color) : model.dispose()),
        () => model.dispose(),
      );
    }
    avatar.setLabel(net.names.get(r.id) || `#${r.id}`, r.color);
    avatar.showLabel(!(fly.active && fly.clean));
    avatar.setLook(r.look);
    avatar.setOutfit(r.item, r.gear, r.tiers);
    if (!ride(r.id, avatar, { ...r, heading: r.facing }, frameDt) && !r.pillion) {
      avatar.update({ ...r, sliding: undefined, powerSlide: r.sliding, crouching: r.crouching }, frameDt);
    }
  }
  // Passengers last, on the back of the quads just drawn under their riders.
  for (const r of others) {
    const avatar = r.pillion ? remotes.get(r.id) : undefined;
    if (avatar && !pillion(r.pillion === net.id ? 0 : r.pillion, avatar, r.pitch, frameDt)) {
      avatar.update({ ...r, sliding: undefined, powerSlide: r.sliding, crouching: r.crouching }, frameDt);
    }
  }
  const backSeat = !!driver && pillion(driver.id, me, orbit.pitch, frameDt);
  if (driver && !backSeat) me.update({ x: v.x, y: v.y, z: v.z, facing: v.facing, speed: 0, grounded: true, pitch: orbit.pitch }, frameDt);
  for (const [id, avatar] of remotes) {
    if (!seen.has(id)) {
      avatar.dispose();
      remotes.delete(id);
      bikes.get(id)?.dispose();
      bikes.delete(id);
    }
  }

  // Riding, the eye is the rider's (it leans and tucks with them), moved forward over the bars so the
  // shoulders and hood are behind it in first person: you see your hands on the grips. The camera adds EYE_HEIGHT.
  // On the back of a quad the same, looking past the rider's shoulder.
  if ((riding || backSeat) && me.eye(eye)) focus.set(eye.x - Math.sin(rideHeading) * RIDE_EYE_AHEAD, eye.y - EYE_HEIGHT, eye.z - Math.cos(rideHeading) * RIDE_EYE_AHEAD);
  else if (riding) focus.set(v.x, v.y, v.z);
  // On a ladder, the eye is the climber's too (leaning in to the rungs): your hands on them in front of you.
  // (Moved forward of the head, towards the rungs, so the shoulders and hood are behind it.)
  else if (s.climb && me.eye(eye)) {
    const f = climbingOn(v.x, v.y, v.z)?.facing ?? v.facing;
    focus.set(eye.x - Math.sin(f) * LADDER_EYE_AHEAD, eye.y - EYE_HEIGHT, eye.z - Math.cos(f) * LADDER_EYE_AHEAD);
  }
  // Dead: the camera backs off to third person and follows the body as it falls (the pivot a little above it).
  else if (me.downAt(focus)) focus.y += 0.5 - EYE_HEIGHT;
  else focus.copy(me.root.position);
  if (orbit.down !== (net.down !== null)) {
    document.body.classList.toggle('down', (orbit.down = net.down !== null));
    if (!orbit.down) {
      speech.event('respawn', undefined);
      gas.respawned();
    }
  }
  telescope.update(frameDt, spyglassZoom(Math.max(0, quality(inHand))));
  const hands = !s.riding && !s.pillion && !s.climb && !net.down && !fly.active; // the tools work (not with both hands on a ladder)
  const fire = rifle.update(frameDt, { speed: Math.hypot(s.vx, s.vz), grounded: s.grounded, crouching: !!(s.crouching || s.sliding) }, hands);
  viewCull.begin();
  if (L.things) {
    lootView.update(frameDt, net.loot, focus);
    vehicleView.update(vehicles, net.myVehicles, focus, (id) => (id === net.id ? net.me.riding : others.find((o) => o.id === id)?.riding ?? false));
    // Carts (shared/cart.ts): ours where our prediction has it, others' from their poses, each hung from its bike's tow
    // ball where that bike was just drawn (ride() above), so it never comes off it.
    const towers: Tower[] = others.flatMap((o) => (o.tow ? [tower(o.id, o.id, o.tow, o.x, o.y, o.z, o.facing, o.hitch)] : []));
    if (s.tow) towers.unshift(tower(net.id, 0, s.tow, v.x, v.y, v.z, v.heading, v.hitch));
    // Parked still linked (got off with it): hung the same way from the parked bike's tow ball, so nothing jumps.
    for (const c of vehicles) {
      if (c.kind !== 'cart' || c.hitched === undefined || !parked(c)) continue;
      const b = vehicleView.ball(c.hitched);
      if (b) towers.push({ id: -c.id, tow: c.id, x: c.x, y: c.y, z: c.z, heading: b.heading, hitch: c.heading, at: b.at, pitch: b.pitch });
    }
    cartView.update(frameDt, vehicles, towers, focus, windSpeed(net.worldTime(), stormAt(net.storms, focus.x, focus.z, net.serverTime())), darkAt(sky.day.tod));
  }
  shieldFx.update(frameDt, (id) => (id === net.id ? me.root.position : others.find((o) => o.id === id) ?? null));
  if (L.things) corpseView.update(frameDt, focus);
  orbit.rumble = Math.max(stage.level === net.me.level ? (stage.rumble ?? 0) : 0, blasts.shake); // and bursts nearby (src/world/blasts.ts)
  orbit.update({ x: focus.x, y: focus.y, z: focus.z, vx: s.vx, vy: s.vy, vz: s.vz, grounded: s.grounded, sliding: s.sliding, crouching: s.crouching, riding: s.riding || backSeat, heading: backSeat ? rideHeading : v.heading, lean: bikes.get(backSeat ? driver!.id : 0)?.leanAngle, short: L.crouchUnder,
    ladder: s.climb ? climbingOn(v.x, v.y, v.z)?.facing : undefined, slow: moveOf(s.effects).speed }, frameDt);
  // Jump pressed when gear effects won't let you (shared/effects.ts: the piercer in hand): the knees give a little, no more.
  if (!moveOf(s.effects).jump && s.grounded && !s.riding && input & JUMP && !(lastInput & JUMP)) orbit.heave();
  lastInput = input;
  bossFx.update(net, frameDt, orbit.camera);
  bossBar.update(frameDt, bossFx.bar);
  guardianFx.update(net, frameDt, orbit.camera, focus);
  rifle.afterCamera(fire); // the aim's sway and recoil on the view, and the shot, against the walkers as just drawn
  telescope.afterCamera(frameDt, others);
  // Flying, the camera leaves the body and the world streams in around it instead.
  if (fly.active) {
    fly.update(frameDt, orbit.camera);
    focus.copy(fly.pos);
  }
  thrower.update(frameDt, hands && L.things); // (thrown scrap lands as loot: the desert's, docs/levels.md phase 5)
  mace.update(hands);
  grinder.update(frameDt, hands);
  jammer.update(frameDt, hands && !storm.toolsDown); // dead in a storm's static (storm.update is later: last frame's)
  jammer.others(others, orbit.camera.position); // others' jammers: their static
  receiver.update(frameDt, inHand, hands, storm.toolsDown);
  // T: third person. On the bike the body is drawn in first person too (hands on the bars), minus the head; on a ladder
  // too (hands on the rungs), and on the back of a quad (on its grab handles).
  const holding = riding || backSeat || !!s.climb;
  const bodyShown = orbit.showBody || holding || fly.active;
  if (bodyShown === bodyHidden) me.setShadowOnly((bodyHidden = !bodyShown));
  me.setHeadless(holding && !orbit.showBody && !fly.active);
  viewmodel.root.visible = bodyHidden;
  viewmodel.setColor(net.color);
  viewmodel.update(frameDt, { speed: Math.hypot(s.vx, s.vz), grounded: s.grounded, sliding: s.sliding });
  zaps.update(frameDt); // after the gun is drawn: your beam starts at its muzzle
  blasts.update(frameDt);
  // Before the wind: the storm sets how hard it blows here.
  const belt = equipped(net.boxes.equip, 'belt');
  storm.update(frameDt, L.weather ? net.storms : NO_STORMS, net.serverTime(), orbit.camera.position, net.me, belt ? stormWarnS(quality(belt)) : 0, survival.dead || net.down !== null);
  if (!L.weather) storm.calm();
  // The sand vortices near enough to see (shared/vortex.ts: they roam the whole desert).
  const vortices = L.weather ? vorticesNear(orbit.camera.position.x, orbit.camera.position.z, 5000, net.vortexZero, net.vortices, nearVortices) : NO_VORTICES;
  vortexFx.update(frameDt, vortices, net.serverTime(), orbit.camera.position);
  vortexSound.update(frameDt, vortices, net.serverTime(), orbit.camera.position, orbit.viewYaw);
  gas.update(frameDt, L.weather ? net.gas : NO_GAS, net.serverTime(), orbit.camera.position, net.me, survival.dead || net.down !== null);
  // The locator comes with the wrist computer; a better one shows players further away.
  const wrist = equipped(net.boxes.equip, 'wrist');
  const range = wrist ? locatorRange(quality(wrist)) : 0;
  locator.lost = storm.toolsDown || !wrist;
  locator.bedroll = net.spawn;
  telescope.bedroll = net.spawn;
  survival.toolsDown = storm.toolsDown;
  locator.update(orbit.camera, orbit.viewYaw, orbit.pitch + orbit.freePitch, focus, [...others.filter((o) => Math.hypot(o.x - focus.x, o.z - focus.z) < range), ...(L.things ? [...wrecks.targets(focus.x, focus.z), ...corpseTargets(), ...ownVehicleTargets(net.myVehicles, net.color), ...cartTargets(net.myVehicles)] : [])]);
  // The clock and the wind go on in any level; a stage updates only while it is the one we are in (during the fade the
  // drawn one isn't: the desert mustn't stream terrain round the datacenter's x, z, nor the other way round).
  sky.tickClock(frameDt, net.worldTime());
  wind.update(net.serverTime() / 1000);
  if (stage.level === net.me.level) stage.update({ dt: frameDt, time: time / 1000, focus, camera: orbit.camera, worldTime: net.worldTime(), serverTime: net.serverTime(), me: net.me });
  windSound.setSilent(L.indoors);
  windSound.update(frameDt, orbit.camera.position, orbit.viewYaw, s);
  // Sand hissing under you: a speed slide, or (softer) slipping down a slip face on your feet.
  const ownSpeed = Math.hypot(s.vx, s.vz);
  slideSound.update(frameDt, !s.grounded || s.riding || net.down ? 0 : s.sliding ? 1 : ownSpeed > 2 && !L.flat && isSlipFace(s.x, s.z) ? 0.5 : 0, ownSpeed);
  engineSound.update(frameDt, s.riding, s.grounded, Math.hypot(s.vx, s.vz), s.riding && (input & (FORWARD | BACK)) !== 0, s.bike, !!s.tow);
  engineSound.updateRemotes(frameDt, others, orbit.camera.position, s);
  drinkSound.remotes(others, orbit.camera.position);
  grinderSound.remotes(frameDt, others, orbit.camera.position);
  footsteps.listener(orbit.camera.position, orbit.viewYaw);
  bikeLandSound.listener(orbit.camera.position, orbit.viewYaw);
  cartSound.listener(orbit.camera.position, orbit.viewYaw);
  audio.setMuffled(survival.dead); // the world goes dull while you lie dead; the music doesn't
  const cam = orbit.camera.position;
  music.update(frameDt, {
    indoors: L.indoors || indoors(cam.x, cam.y, cam.z),
    sandstorm: storm.level > 0.3,
    epic: L.enemies && (guardianFx.epic || bossFx.combat),
    combat: L.enemies && guardianFx.combat,
    dead: survival.dead,
    // The sun coming up: from 2° under the horizon to 8° over it (about a minute).
    sunrise: sky.day.tod < 0.5 && sky.day.elevation > -0.035 && sky.day.elevation < 0.14,
  });
  crashSound.update(orbit.camera.position, orbit.viewYaw, orbit.camera.quaternion, L.things); // (the audio listener too)
  listen(orbit.camera.position);
  tickEchoBus();
  if (L.things) {
    placedView.update(frameDt, net.worldTime(), (x, z) => stormAt(net.storms, x, z, net.serverTime()), survival.fillingWell);
    placedView.updateLamps(orbit.camera.position, cartView.lamps);
  }
  const ear = orbit.camera.position;
  wellSound.update(L.things ? placedView.nearestWell(ear, 30) : null, ear, survival.fillingWell !== null);
  // The radio towers (src/towerSound.ts): the wind in the lattice, a live one's radio muttering, also through a receiver
  // or jammer in hand. How clearly it hears: its fixtures' mean quality (shared/gear.ts).
  towerSound.update(ear, net.towersAlive, playerHands.held === 'jammer' || playerHands.held === 'receiver',
    windSpeed(net.worldTime(), stormAt(net.storms, ear.x, ear.z, net.serverTime())),
    (id) => SPOTS.reduce((a, _, i) => a + Math.max(0, quality(net.boxes[towerBox(id, i)]?.[0])), 0) / (SPOTS.length * 3), L.things);
  // What F can reach: the desert's stations, beds, scrap, machines, loot, chests, bikes, only where its things are.
  const here = net.connected && L.things;
  // F: use the work station in view, else tend the plant bed in view (planted beds can't be touched
  // while they grow), else pick up scrap, else (canteen out, at the pump) fill the canteen.
  const station = here ? stationTarget(net.me, quantizeYaw(orbit.yaw), quantizePitch(orbit.pitch)) : null;
  // Placing from the hotbar, building with the wrench and G to pick placed things up (src/placing.ts); its prompt goes after F's.
  const placing = placer.update(survival.slot, net.me, quantizeYaw(orbit.yaw), quantizePitch(orbit.pitch), L.building, (t) => hud.toast(t));
  // A building in view (the windmill, the battery station): F opens it next to the bag, to swap its parts. At a running
  // well's tap with the water bottle out, F fills the bottle instead (src/water.ts).
  const atTap = playerHands.held === 'canteen' && placing.target?.kind === WELL && !!waterAt(net.me.x, net.me.y, net.me.z);
  const building = !station && placing.target && isBuilding(placing.target.kind) && !atTap ? placing.target : null;
  const buildingPrompt = building ? TEXT.prompt.open(itemLabel(building.kind)) : null;
  // Where a radio tower's fixture is fitted (shared/towers.ts SPOTS: its cabinet, the dish deck's and the top deck's
  // boxes): F opens it next to the bag, to fit its parts.
  const spot = here && !net.down && !station && !building ? spotNear(s.x, s.y, s.z, TOWER_REACH_SPOT) : null;
  const fixture = spot && net.boxes[towerBox(spot.t.id, spot.i)] ? towerBox(spot.t.id, spot.i) : null;
  const fixturePrompt = fixture && spot ? TEXT.prompt.open(itemLabel(SPOT_ITEMS[spot.i])) : null;
  // A bedroll in view (anyone's): F makes it where we wake up after dying, or stops that (net.spawn).
  const roll = !station && placing.target?.kind === BEDROLL ? placing.target : null;
  const rollPrompt = roll ? (net.spawn?.id === roll.id ? TEXT.prompt.dontSleepHere : TEXT.prompt.sleepHere) : null;
  // A motorcycle in view (shared/vehicles.ts): F repairs a broken one (its part slots next to the bag), gets on a
  // working one, or opens its cargo from the back. On the bike, F gets off.
  // A quad someone rides, its back seat free: F gets on behind them. On its back, F gets off.
  const onBike = s.riding || !!s.pillion;
  const vehicle = here && !net.down && !onBike && !station && !building
    ? vehicleTarget(net.me, orbit.yaw, orbit.pitch) : null;
  const backOf = here && !net.down && !onBike && !station && !building && !vehicle
    ? pillionTarget(net.me, orbit.yaw, orbit.pitch, (id) => {
      const o = others.find((q) => q.id === id && q.riding);
      return o ? { x: o.x, y: o.y, z: o.z, heading: o.facing } : null;
    }) : null;
  const ridePrompt = backOf ? TEXT.prompt.getOn : !vehicle ? null : !vehicle.v.up ? TEXT.prompt.repair(itemLabel(vehicle.v.kind))
    : vehicle.rear ? TEXT.prompt.open(TEXT.boxes.cargo) : TEXT.prompt.getOn;
  // The cart (shared/cart.ts, anyone's): F on its tongue, linked to a bike or quad, lets it go; anywhere else on it opens
  // its box.
  const cart = here && !net.down && !onBike && !station && !building && !vehicle
    ? cartTarget(net.me, orbit.yaw, orbit.pitch, vehicles) : null;
  const unhitch = !!cart && cart.tongue && cart.v.hitched !== undefined;
  const cartPrompt = !cart ? null : unhitch ? TEXT.prompt.unhitch : net.boxes[cargoBox(cart.v.id)] ? TEXT.prompt.open(itemLabel(cart.v.kind)) : null;
  // The cart, let go of the bike: the cart key unfolds it, or packs it again (server/vehicles.ts unfold). Not with
  // something in hand that the same key turns (a placeable, the wrench).
  const heldKind = (net.boxes.bag ?? [])[survival.slot]?.kind;
  const folding = !!cart && cart.v.hitched === undefined && !(heldKind && (isPlaceable(heldKind) || heldKind === WRENCH));
  const foldPrompt = folding ? `${kbd('rotate')}${cart!.v.open ? TEXT.prompt.pack : TEXT.prompt.unfold}` : null;
  if (cartKey && folding) net.unfoldCart(cart!.v.id, !cart!.v.open);
  cartKey = false;
  const bed = here && !station ? bedTarget(net.me, quantizeYaw(orbit.yaw), quantizePitch(orbit.pitch), placed) : null;
  const bedState = bed ? net.garden.get(bed.id) : undefined;
  const bedStage = bed ? (bedState?.stage ?? EMPTY) : -1;
  const tend = bedStage === EMPTY ? TEXT.prompt.plantSeeds : bedStage === GROWN ? TEXT.prompt.harvest : null;
  // Sprouts grow only under a UV lamp (shared/garden.ts).
  const growing = bedStage === SPROUTS && bed ? (bedLit(bed) ? `<span>${Math.round((bedState?.grow ?? 0) * 100)}%</span>` : `<span class="bad">${TEXT.prompt.needsUvLamp}</span>`) : null;
  const target = here && !station && !bed ? scrapTarget(net.me, quantizeYaw(orbit.yaw), quantizePitch(orbit.pitch)) : null;
  // Debris at the crash sites (hull plates, pipes, ...) is picked up as what it gives: scrap or cloth (shared/items.ts debrisItem).
  const debris = here && !station && !bed && !target ? debrisTarget(net.me, quantizeYaw(orbit.yaw), quantizePitch(orbit.pitch)) : null;
  const debrisPrompt = debris ? TEXT.prompt.pickUp(itemLabel(debrisItem(CRASH_KINDS[debris.kind].node))) : null;
  const find = here && !station && !bed && !target && !debris ? lootView.target(net.me, orbit.yaw) : null;
  const findPrompt = find ? lootPrompt(find, itemLabel) : null;
  // Machines at the crash sites: a small one is picked up (it goes in the bag); a large one is taken apart where
  // it lies. A carried one is taken apart on a dismantling bench.
  const nearSite = here && !station && !bed && !target && !debris && !find ? machines.nearest(net.me.x, net.me.z) : null;
  const small = nearSite ? junkSpec(nearSite.site.kind).carry && !nearSite.site.lab : false;
  // A small one is picked up with F; a big one starts its disassembly by itself when you come close (src/teardown).
  const site = small ? nearSite : null;
  if (nearSite && !small && !teardown.active) teardown.begin(machines.workSite(nearSite, net.siteLink(nearSite.site.id)));
  // A machine of the level's own (the beginning's cabinet): the same, in its frame.
  const levelSite = !teardown.active && net.connected && !net.down && stage.level === net.me.level ? stage.workSite?.(net.me, (id) => net.siteLink(id)) : null;
  if (levelSite) teardown.begin(levelSite);
  // A machine on the disassembly table is worked like a big one: it starts by itself when you stand at the table.
  if (!teardown.active && !benchMenu.isOpen && here) {
    const b = machines.benchNear(net.me.x, net.me.z, 3.5);
    const job = b?.site(net.siteLink(b.id), () => scrapBench(b.id));
    if (job) teardown.begin(job);
  }
  // Its frame was scrapped (by us or someone else) while we work on it: it is gone.
  if (teardown.current && !isTableId(teardown.current.id) && machines.isSpent(teardown.current.id)) teardown.end();
  // Close to a machine that is not being worked (a small one to carry home): its steps and parts, as when working it.
  teardown.setNear(site?.junk ? { label: junkSpec(site.site.kind).label, steps: site.junk.steps.filter((s) => !s.done).length, parts: site.junk.slots.filter((s) => !s.taken).length, scrap: false } : null);
  // Salvage wrecks (src/world/wrecks.ts) are always carried home.
  const wreck = here && !station && !bed && !target && !debris && !site ? wrecks.nearest(net.me.x, net.me.z) : null;
  const sitePrompt = site ? (small ? TEXT.prompt.pickUp(junkSpec(site.site.kind).label) : TEXT.prompt.disassemble(junkSpec(site.site.kind).label))
    : wreck ? TEXT.prompt.pickUp(SALVAGE[wreck.kind].label) : null;
  const tableAt = station?.kind === 'disassembly' ? station.id : null;
  const table = tableAt ? machines.tableMenu(tableAt, net.boxes.bag) : null;
  const use = !station ? null : station.kind === 'workbench' ? TEXT.prompt.useWorkbench : TEXT.prompt.useTable;
  // A dead player's pack (shared/corpse.ts) lying here: F opens it next to the bag, like a chest.
  const pack = here && !net.down && !station && !bed && !target && !debris && !find && !site && !wreck
    && corpsesNear(net.me).some((b) => net.boxes[b]);
  // A chest in reach (shared/storage.ts): F opens it next to the bag.
  const chest = here && !net.down && !station && !bed && !target && !debris && !find && !site && !wreck && !pack
    && openBoxes(net.me).some((b) => b.startsWith('store') && net.boxes[b]);
  const packPrompt = pack ? TEXT.prompt.openPack : chest ? TEXT.prompt.openChest : null;
  // A piece that came off a machine and lies by you can be picked up to be turned and taken apart in the hands; F again sets it down.
  const pieceHere = teardown.active && !teardown.holding ? teardown.pieceNear(net.me) : null;
  const piecePrompt = teardown.holding ? TEXT.prompt.putDown : pieceHere ? TEXT.prompt.pickUp(pieceHere.label) : null;
  // A level's door (Level.doors: the datacenter's entrance out in the desert, its exit inside): F goes through, even on
  // the bike (it stays parked at the door). No text says where it leads.
  const door = net.connected && !net.down ? doorAt(L, s.x, s.y, s.z) : undefined;
  const atDoor = door !== undefined;
  const doorPrompt = atDoor ? TEXT.prompt.open(TEXT.places.steelDoor) : null;
  // Near the door the level's stage is built ahead, so going in only has to compile it (behind the fade).
  for (const d of L.doors()) if (Math.hypot(s.x - (d.trigger[0] + d.trigger[1]) / 2, s.z - (d.trigger[4] + d.trigger[5]) / 2) < 60) levels.prefetch(d.to);
  // What the level asks F for first (the beginning's pod hatch).
  const levelAct = net.connected && !net.down && stage.level === net.me.level ? (stage.interact?.(net.me, net.boxes.bag) ?? null) : null;
  // A radio tower's ladder (shared/towers.ts): F grabs it in reach; on it, F steps off at a deck or its foot, or lets go
  // (shared/sim.ts GRAB). On it, that's all F does.
  const climbing = !!s.climb;
  const ladder = here && !net.down && !onBike && (climbing || !use) ? L.ladder?.(s.x, s.y, s.z, climbing ? 0.3 : GRAB_REACH) ?? null : null;
  const ladderPrompt = !ladder ? null : !climbing ? TEXT.prompt.climb
    : ladder.decks.some((d) => Math.abs(d - s.y) < DECK_STEP) || s.y <= ladder.bottom + DECK_STEP ? TEXT.prompt.stepOff : TEXT.prompt.letGo;
  const fPrompt = climbing ? ladderPrompt : levelAct?.prompt ?? doorPrompt ?? piecePrompt ?? use ?? buildingPrompt ?? fixturePrompt ?? ladderPrompt ?? rollPrompt ?? ridePrompt ?? cartPrompt ?? tend ?? target ?? debrisPrompt ?? findPrompt ?? sitePrompt ?? packPrompt;
  // A wiring coil in hand: stringing power lines between connectors (src/wiring.ts).
  const wirePrompt = wiring.update(survival.slot, net.me, quantizeYaw(orbit.yaw), quantizePitch(orbit.pitch), !net.down && !fly.active, (t) => hud.toast(t));
  const extra = [growing, wirePrompt, placing.prompt, foldPrompt].filter(Boolean).join(' ');
  hud.setTarget(fPrompt && extra && typeof fPrompt === 'string' ? `${kbd('interact')}${fPrompt} ${extra}` : (fPrompt ?? (extra || null)));
  const interact = takePickup() && !fly.active;
  if (interact && ladderPrompt && (climbing || fPrompt === ladderPrompt)) tools.grab = true;
  else if (interact && levelAct) levelAct.act();
  else if (interact && atDoor) net.enter();
  else if (interact && onBike) tools.getOff = true; // (src/input.ts: the bike key's input, one tick)
  else if (interact && piecePrompt) {
    if (teardown.holding) teardown.putDown();
    else teardown.hold(pieceHere!.piece);
  } else if (interact) {
    if (use) {
      if (station!.kind === 'workbench') hud.open();
      else if (table && (table.job || table.kinds.length)) {
        benchMenu.open({
          job: table.job,
          kinds: table.kinds,
          place: (kind) => net.crashUse(tableAt!, kind),
          scrap: () => (teardown.current?.id === tableAt ? teardown.scrap() : scrapBench(tableAt!)),
        });
      } else hud.toast(TEXT.notice.nothingToTakeApart);
    } else if (building) hud.open(buildingBox(building.id));
    else if (fixture) hud.open(fixture);
    else if (roll) net.spawnToggle(roll.id);
    else if (backOf) net.mount(backOf.id);
    else if (vehicle) {
      if (!vehicle.v.up) hud.open(vehicleBox(vehicle.v.id));
      else if (vehicle.rear) hud.open(cargoBox(vehicle.v.id));
      else net.mount(vehicle.v.id);
    }
    else if (cartPrompt && cart) {
      if (unhitch) net.unhitch(cart.v.id);
      else hud.open(cargoBox(cart.v.id));
    }
    else if (tend && bed) net.tend(bed.id);
    else if (target) {
      if (net.pickup(target)) pickupSound.play();
      else bagFull();
    } else if (debris) {
      if (net.debrisTake(debris)) pickupSound.play();
      else bagFull();
    } else if (find) {
      if (net.lootTake(find.id)) pickupSound.play();
      else bagFull();
    } else if (site) {
      net.crashTake(site.site.id);
    } else if (wreck) net.crashTake(wreck.id);
    else if (pack || chest) hud.open();
  }
  const targeted = levelAct !== null || doorPrompt !== null || piecePrompt !== null || use !== null || buildingPrompt !== null || fixturePrompt !== null || ladderPrompt !== null || rollPrompt !== null || ridePrompt !== null || cartPrompt !== null || tend !== null || target !== null || debrisPrompt !== null || findPrompt !== null || sitePrompt !== null || packPrompt !== null;
  survival.update(frameDt, net.me, targeted, interact && !targeted, clockText(sky.day.tod));
  const w = net.water;
  const m = net.me;
  speech.update(frameDt, { day: sky.day.elevation > 0, indoors: L.indoors || indoors(m.x, m.y, m.z), shelter: L.things && inShelter(m.x, m.y, m.z),
    atPump: L.things && !!waterAt(m.x, m.y, m.z), dryWell: L.things ? dryWell(m) : null, mudflat: L.things && biome('mudflat', m.x, m.z) > 0.7, heat: survival.heatLevel, rising: w.rising, shade: w.shade, sips: w.sips, maxSips: w.maxSips,
    storm: storm.level, stormWarning: storm.warning, frontComing: storm.frontComing, choking: storm.choking, lee: storm.lee, gasComing: gas.coming, gassed: gas.gassing, riding: s.riding, boss: bossFx.combat,
    bag: net.boxes.bag ?? [], dead: survival.dead || net.down !== null, atPod: L.things && nearPod(m.x, m.z, 4),
    underTower: L.things && towersNear(m.x, m.z, 14).some((t) => m.y < t.y + 3),
    towerTop: L.things && towersNear(m.x, m.z, 8).some((t) => m.y > t.y + TOWER.height - 0.5), towerVoice: towerSound.hearing,
    beat: stage.level === m.level && stage.beat ? { ...stage.beat(m), gates: m.gates } : null });
  const vehicleKey = vehicle ? `${vehicle.v.id}:${vehicle.v.up}` : null;
  if (vehicleKey !== seenVehicle) {
    seenVehicle = vehicleKey;
    if (vehicle) speech.event('vehicle', vehicle.v);
  }
  if ((find?.id ?? null) !== seenFind) {
    seenFind = find?.id ?? null;
    if (find) speech.event('see', find);
  }
  const nearKey = site ? `m${site.site.id}` : wreck ? `w${wreck.id}` : null;
  if (nearKey !== seenSite) {
    seenSite = nearKey;
    if (site) speech.event('near', { kind: site.site.kind, carry: small });
    else if (wreck) speech.event('near', { kind: wreck.kind, carry: true });
  }
  if (net.boxes.bag) {
    for (const it of net.boxes.bag) if (it && bagIds && !bagIds.has(it.id)) speech.event('got', it);
    bagIds = new Set(net.boxes.bag.flatMap((it) => (it ? [it.id] : [])));
  }
  hud.update(net.me);

  const ri = renderer.info.render as { drawCalls?: number; calls?: number; triangles: number };
  statsGraph.visible = menu.statsOn;
  perf.collect = menu.statsOn || PERF_RUN;
  statsGraph.frame(ri.drawCalls ?? ri.calls ?? 0, ri.triangles / 1000, graphics.dynamicRes ? resolution.ratio : undefined, perf.last.cpu, perf.gpuTracked ? (perf.last.gpu ?? undefined) : undefined);
  if (menu.statsOn) {
    statsGraph.info([
      ...(graphics.dynamicRes ? [] : [`${resolution.ratio.toFixed(2)}x`]), // (adaptive: the scale line shows it)
      clockText(sky.day.tod), backendText, net.status, net.telemetry.text(), `${others.length + (net.connected ? 1 : 0)} online`, `build ${__BUILD_SHA__}`,
    ]);
  }
  teardown.update(frameDt);
  if (loaded && levels.drawing) {
    warm.finish();
    terrain.loading = false;
    renderer.info.reset();
    perf.submitStart();
    post.render();
    perf.submitEnd(renderer);
  } else if (warming) {
    warmP = warm.progress;
    coverProgress();
  } else if (modelsIn) {
    // Everything sliceable is in: build the first frame's shaders, post passes included, a few materials per round
    // (src/warmup.ts) while the prologue on the loading screen keeps going.
    warming = true;
    perf.milestone('warmup-start');
    warm.run(gpuIdle).then(() => {
      coverP = warmP = 1;
      coverProgress();
      warmed = true;
      perf.milestone('warmed');
    });
  }
  if (PERF_RUN || BENCH) document.getElementById('name')?.querySelector<HTMLElement>('.skip')?.click(); // (a benchmark, or the art bench, answers the name box itself)
  perf.frameEnd(ri.drawCalls ?? ri.calls ?? 0, ri.triangles / 1000, resolution.ratio, loaded && coverFrames >= 3 && !document.getElementById('cover') && !document.getElementById('name'), frameDt, (rad) => (orbit.yaw += rad));
  autoGraphicsFrame(frameDt, perf.last.cpu, resolution.ratio / Math.min(devicePixelRatio, graphics.resScale), resolution.pixelBound,
    loaded && coverFrames >= 3 && !document.hidden && !menu.open && !net.down && net.isReady && !document.getElementById('cover'));
});

