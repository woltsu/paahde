// The cart (shared/cart.ts, docs/cart.md phase 1): towing is in the shared sim and deterministic (the server's step and
// the client's replay from the state it is sent agree); in a real world, your own cart stands by you, backing the bike up
// to it hitches it, getting off parks both still linked, getting back on tows it again, F at its tongue on foot lets it
// go, its box keeps what's in it wherever it went, and nobody else can tow it or let it go. Phase 2: parked it's solid;
// unfolded at level 1 its canopy shades and holds you up like a tarp's; its owner unfolds and packs it (the cart key),
// not while it's linked to a bike, and backing up to it unfolded packs and hitches it; the wrench raises its level from
// the bag's materials, only its owner's, never past 2. Phase 3: unfolded at level 2 its sides are a workbench and a
// dismantling table (at any heading), packing is refused with a machine on the table, the wrench no longer builds the
// benches or the chest (old ones still work and come down into their materials), and the pods' kit pays for the
// beginning: wrench, the cart's two levels, a tarp and a bedroll, then the pod's machines taken apart on the cart.
// Run with: node --test tools/cart.test.mjs
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { canopyRig, cartAxle, cartToWorld, couplerOf, HITCH_BACK, HITCH_MAX, hitchPoint, TOW_LENGTH, towedPose } from '../shared/cart.ts';
import { CART_TABLE, HAND_TABLE, POD_LOOT, RETIRED_BUILD_TABLE } from '../shared/tables.ts';
import { BUILDS, buildCost, isBuildable } from '../shared/crafting.ts';
import { onTable, tableById } from '../shared/crash.ts';
import { quantizePitch } from '../shared/dig.ts';
import { machineParts } from '../shared/machine.ts';
import { partAllowed, stepAllowed, stepList } from '../shared/machineSteps.ts';
import { setPlaced } from '../shared/placed.ts';
import { stations, stationTarget } from '../shared/stations.ts';
import { openDb } from '../server/db.ts';
import { LAB_SPAWN } from '../shared/lab.ts';
import { inSun, sunDirection } from '../shared/shade.ts';
import { canvasYAt } from '../shared/tarp.ts';
import { heightAt } from '../shared/terrain.ts';
import { setVehicles } from '../shared/vehicles.ts';
import { PROTOCOL_VERSION } from '../shared/protocol.ts';
import { BACK, BIKE, CROUCH, FORWARD, LEFT, quantizeYaw, RIGHT, spawnState, step } from '../shared/sim.ts';
import { TEXT } from '../shared/text.ts';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** What the server does to a state before sending it (server/world.ts round). */
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const sent = (s) => JSON.parse(JSON.stringify({ ...s, x: r4(s.x), y: r4(s.y), z: r4(s.z), vx: r4(s.vx), vy: r4(s.vy), vz: r4(s.vz),
  facing: r4(s.facing), heading: r4(s.heading), nose: r4(s.nose), noseSpin: r4(s.noseSpin), hitch: r4(s.hitch) }));

/** A minute of riding with a cart: throttle, turns both ways, braking and reversing with the bars over. */
const script = (t) => (t % 600 < 240 ? FORWARD | (t % 120 < 50 ? LEFT : t % 120 > 80 ? RIGHT : 0)
  : t % 600 < 300 ? 0 : t % 600 < 420 ? BACK | (t % 80 < 40 ? LEFT : RIGHT) : BACK);

function ride(s, ticks, from = 0, each) {
  for (let t = from; t < from + ticks; t++) {
    s = step(s, script(t), quantizeYaw(s.heading));
    each?.(s);
  }
  return s;
}

const towing = () => ({ ...spawnState(3000, 3000), riding: true, bike: 1, heading: 0.4, tow: 7, hitch: 0.4 });

test('towing is deterministic: the same inputs step the same, and a replay from the sent state follows the server', () => {
  const a = ride(towing(), 1800), b = ride(towing(), 1800);
  assert.deepEqual(a, b, 'bit for bit the same');
  assert.equal(a.tow, 7);
  // The client's reconciliation: the server's state as sent (rounded, through JSON), replayed with the same inputs.
  const server = ride(towing(), 600);
  const exact = ride(server, 120, 600), replay = ride(sent(server), 120, 600);
  for (const k of ['x', 'z', 'heading', 'hitch']) assert.ok(Math.abs(exact[k] - replay[k]) < 1e-3, `${k}: ${exact[k]} vs ${replay[k]}`);
});

test('the axle follows the hitch point at the tongue\'s length, never past the jackknife limit, reversing too', () => {
  let s = towing(), most = 0, moved = 0;
  const start = towedPose(s);
  ride(s, 1800, 0, (n) => {
    const h = hitchPoint(n.x, n.z, n.heading), a = cartAxle(n.x, n.z, n.heading, n.hitch);
    assert.ok(Math.abs(Math.hypot(h.x - a.x, h.z - a.z) - TOW_LENGTH) < 1e-9);
    most = Math.max(most, Math.abs(wrap(n.hitch - n.heading)));
    moved = Math.max(moved, Math.hypot(a.x - start.x, a.z - start.z));
    s = n;
  });
  assert.ok(most <= HITCH_MAX + 1e-9, `swung ${most}`);
  assert.ok(most > 0.3, 'it swings out in the turns');
  assert.ok(moved > 20, 'it came along');
  // Straight backwards from in line: it stays in line (the axle pushed back the way it points).
  let r = { ...towing(), heading: 0, hitch: 0 };
  for (let t = 0; t < 120; t++) r = step(r, BACK, quantizeYaw(0));
  assert.ok(r.z > towing().z + 1, 'reversed');
  assert.ok(Math.abs(wrap(r.hitch - r.heading)) < 1e-6, 'still in line');
  // Off the bike: towing stops; the cart's heading stays in the state (it's parked from it, server/vehicles.ts release).
  const off = step({ ...s, bikeHeld: false, grounded: true }, BIKE, quantizeYaw(s.heading));
  assert.equal(off.riding, false);
  assert.equal(off.tow, 0);
  assert.equal(off.hitch, s.hitch);
});

const cartAt = (x, z, heading, extra) => ({ id: 1, kind: 'cart', x, y: heightAt(x, z), z, heading, up: true, parts: [], level: 0, open: false, ...extra });

test('unfolded at level 1, its canopy shades a point under it at noon, and the sim stands you on the canvas', () => {
  const v = cartAt(3200, 3100, 0.7, { level: 1, open: true });
  const r = canopyRig(v);
  // A chest-high point whose ray to the noon sun passes through the canopy's middle.
  const d = sunDirection(0.5), cy = canvasYAt(r, v.x, v.z), py = v.y + 1.2, t = (cy - py) / d.y;
  const px = v.x - d.x * t, pz = v.z - d.z * t;
  setVehicles([{ ...v, open: false }]);
  assert.ok(inSun(px, py, pz, 0.5), 'in the sun while it is packed');
  setVehicles([v]);
  assert.ok(!inSun(px, py, pz, 0.5), 'in its shade unfolded');
  // Dropped onto the canvas beside the poles, over a low corner's side: it lands on it.
  const at = cartToWorld(v, 1.2, 0), c = canvasYAt(r, at.x, at.z);
  assert.ok(c > v.y + 1.9, `the canvas is over a head there (${c - v.y})`);
  let s = { ...spawnState(at.x, at.z, c + 0.6), grounded: false };
  for (let i = 0; i < 60 && !s.grounded; i++) s = step(s, 0, quantizeYaw(0));
  assert.ok(s.grounded && Math.abs(s.y - c) < 0.05, `landed on the canvas: ${s.y} vs ${c}`);
  // Packed, the same drop goes through to the sand.
  setVehicles([{ ...v, open: false }]);
  s = { ...spawnState(at.x, at.z, c + 0.6), grounded: false };
  for (let i = 0; i < 120 && !s.grounded; i++) s = step(s, 0, quantizeYaw(0));
  assert.ok(s.y < v.y + 0.5, 'no canvas packed');
  setVehicles([]);
});

test('a parked cart is solid: walking into its side stops at it', () => {
  const v = cartAt(3300, 3100, 1.1);
  setVehicles([v]);
  const from = cartToWorld(v, -2.5, 0), to = cartToWorld(v, 2.5, 0);
  const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  let s = spawnState(from.x, from.z);
  for (let i = 0; i < 90; i++) s = step(s, FORWARD, quantizeYaw(yaw));
  const lx = (s.x - v.x) * Math.cos(v.heading) - (s.z - v.z) * Math.sin(v.heading);
  assert.ok(lx < -0.9, `stopped beside it (${lx})`);
  setVehicles([]);
});

// ---- A real world (the lab) ------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(condition, ms = 6000, what = 'condition') {
  const end = performance.now() + ms;
  while (!condition()) { if (performance.now() > end) throw new Error(`${what} timed out`); await sleep(10); }
}

class Client {
  constructor(port, name, color) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.name = name;
    this.color = color;
    this.browserId = randomUUID();
    this.messages = [];
    this.seq = 1;
    this.ws.on('message', (raw) => this.messages.push(JSON.parse(String(raw))));
  }
  async join() {
    await new Promise((r) => this.ws.once('open', r));
    this.ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, browserId: this.browserId, name: this.name, color: this.color }));
    await until(() => this.messages.some((m) => m.t === 'welcome'), 6000, 'welcome');
    this.id = this.messages.find((m) => m.t === 'welcome').id;
    this.welcomeColor = this.messages.find((m) => m.t === 'welcome').color;
    this.send({ t: 'ready' });
    await until(() => this.snap()?.players.some((p) => p[0] === this.id), 6000, 'ready');
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  snap() { return this.messages.findLast((m) => m.t === 'snap'); }
  get state() { return this.snap().state; }
  get vehicles() { return this.messages.findLast((m) => m.t === 'vehicles'); }
  vehicle(id) { return this.vehicles.list.find((v) => v.id === id); }
  items(box) { return this.messages.findLast((m) => m.t === 'items' && m.box === box)?.slots; }
  async input(bits, yaw) {
    this.send({ t: 'input', seq: this.seq++, input: bits, yaw: quantizeYaw(yaw), pitch: 32768 });
    await sleep(1000 / 60);
  }
  /** Walk to (x, z), stopping within `near` m. */
  async walkTo(x, z, near = 0.3) {
    for (let i = 0; i < 1500 && Math.hypot(x - this.state.x, z - this.state.z) > near; i++) {
      const d = Math.hypot(x - this.state.x, z - this.state.z);
      await this.input(FORWARD | (d < 2.5 ? CROUCH : 0), Math.atan2(-(x - this.state.x), -(z - this.state.z)));
    }
    for (let i = 0; i < 20; i++) await this.input(0, this.state.facing);
    assert.ok(Math.hypot(x - this.state.x, z - this.state.z) < near + 0.6, `${this.name} walked to ${x}, ${z}`);
  }
  async notice(send) {
    const n = this.messages.length;
    this.send(send);
    await until(() => this.messages.slice(n).some((m) => m.t === 'notice'), 3000, `notice for ${send.t}`);
    return this.messages.slice(n).find((m) => m.t === 'notice').text;
  }
}

/** A lab world in a child process; `seed(dbPath)` may set its database up first. */
async function lab(t, seed) {
  const dir = await mkdtemp(join(tmpdir(), 'paahde-cart-'));
  if (seed) await seed(join(dir, 'world.db'));
  const child = fork(new URL('../server/world.ts', import.meta.url), {
    env: { ...process.env, WORLD_ID: 'lab', DADAJAM_LAB: '1', DB_PATH: join(dir, 'world.db'), TELEMETRY_PATH: join(dir, 'trace.jsonl') },
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.on('data', (s) => { output += s; }); child.stderr.on('data', (s) => { output += s; });
  const peers = [];
  t.after(async () => {
    peers.forEach((c) => c.ws.terminate());
    if (child.exitCode === null && child.signalCode === null) await new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); });
    await rm(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timeout: ${output}`)), 8000);
    child.on('message', (m) => { if (m.t === 'port') { clearTimeout(timer); resolve(m.port); } });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`world exited ${code}: ${output}`)); });
  });
  return { port, peers, output: () => output };
}

test('a cart of your own: hitch by backing up, park and remount still linked, unhitch at the tongue, the box rides along, nobody else tows it', { timeout: 120_000 }, async (t) => {
  const { port, peers, output } = await lab(t);
  const me = new Client(port, 'Hauler', 0x2a9d8f); peers.push(me);
  await me.join();

  // Our cart stands near, ours (and only told as ours: no owners in the list).
  const carts = me.vehicles.list.filter((v) => v.kind === 'cart');
  const cartId = me.vehicles.mine.find((id) => me.vehicle(id).kind === 'cart');
  assert.ok(cartId, 'a cart of our own');
  assert.ok(!JSON.stringify(me.vehicles).includes('owner'), 'no owners sent');
  assert.equal(me.vehicle(cartId).color, 0x2a9d8f, 'in our colour');
  const cart0 = me.vehicle(cartId);
  assert.equal(carts.length, 1);
  assert.equal(cart0.level, 0);
  assert.equal(cart0.hitched, undefined);
  const box = `cargo${cartId}`;
  assert.equal(me.items(box)?.length, 80, 'its box, a chest\'s size');

  // Something in its box, from the lab's full bag.
  await me.walkTo(cart0.x + 1.5, cart0.z, 0.5);
  const bag = me.items('bag');
  const fi = bag.findIndex((x, i) => i >= 5 && x);
  const kind = bag[fi].kind;
  let n = me.messages.length;
  me.send({ t: 'move', from: 'bag', fi, to: box, ti: 0 });
  await until(() => me.messages.slice(n).some((m) => m.t === 'items' && m.box === box), 3000, 'stowed');
  assert.equal(me.items(box)[0]?.kind, kind, 'in the box');

  // Stand where a bike spawned 3 m ahead of us (the debug menu's) has its hitch point 1 m ahead of the coupler, facing
  // away from the cart, and get on it.
  const c = cart0.heading, fx = -Math.sin(c), fz = -Math.cos(c), cp = couplerOf(cart0);
  const at = { x: cp.x + fx * (HITCH_BACK + 1 - 3), z: cp.z + fz * (HITCH_BACK + 1 - 3) };
  await me.walkTo(at.x, at.z, 0.15);
  for (let i = 0; i < 10; i++) await me.input(0, c);
  const count = me.vehicles.list.length;
  me.send({ t: 'debugBike', working: true });
  await until(() => me.vehicles.list.length === count + 1, 3000, 'a bike');
  const bikeId = me.vehicles.list.at(-1).id;
  me.send({ t: 'mount', id: bikeId });
  await until(() => me.state.riding, 3000, 'on the bike');
  assert.equal(me.state.tow, 0, 'not towing yet');
  const towed = () => me.state.tow === cartId;

  // Back slowly up to the coupler: it hitches.
  for (let i = 0; i < 400 && !towed(); i++) {
    const s = me.state, vf = -s.vx * Math.sin(s.heading) - s.vz * Math.cos(s.heading);
    await me.input(vf > -1.2 ? BACK : 0, s.heading);
  }
  assert.ok(towed(), 'hitched by backing up');
  await until(() => me.vehicle(cartId).hitched === bikeId && me.vehicle(cartId).rider === me.id, 3000, 'linked, towed');
  // Remote poses carry the tow (shared/network.ts), so others draw it.
  assert.equal(me.snap().players.find((p) => p[0] === me.id)[12], cartId);

  // Ride off with it.
  for (let i = 0; i < 90; i++) await me.input(FORWARD, me.state.heading);
  const pulled = towedPose(me.state);
  assert.ok(Math.hypot(pulled.x - cart0.x, pulled.z - cart0.z) > 3, 'it came along');
  assert.ok(towed());
  n = me.messages.length;
  me.send({ t: 'move', from: 'bag', fi: me.items('bag').findIndex((x, i) => i >= 5 && x), to: box, ti: 40 });
  await sleep(300);
  assert.ok(!me.messages.slice(n).some((m) => m.t === 'items' && m.box === box && m.slots[40]), 'nothing goes in while it\'s towed');

  // Get off: both park, the cart behind the bike, still linked.
  const getOff = async () => {
    await me.input(0, me.state.heading);
    await me.input(BIKE, me.state.heading);
    await me.input(0, me.state.heading);
    await until(() => !me.state.riding && me.vehicle(bikeId).rider === undefined && me.vehicle(cartId).rider === undefined, 3000, 'parked');
  };
  await getOff();
  assert.equal(me.state.tow, 0);
  const bike1 = me.vehicle(bikeId), cart1 = me.vehicle(cartId);
  assert.equal(cart1.hitched, bikeId, 'still linked');
  const behind = cartAxle(bike1.x, bike1.z, bike1.heading, cart1.heading);
  assert.ok(Math.hypot(behind.x - cart1.x, behind.z - cart1.z) < 1e-3, 'parked behind the bike');
  // Its coupler on the parked bike's tow ball (shared/cart.ts hitchPoint), as drawn and as it collides and unfolds.
  const ball = hitchPoint(bike1.x, bike1.z, bike1.heading), cpl = couplerOf(cart1);
  assert.ok(Math.hypot(ball.x - cpl.x, ball.z - cpl.z) < 0.03, `coupler ${Math.hypot(ball.x - cpl.x, ball.z - cpl.z).toFixed(3)} m off the parked bike's ball`);
  assert.ok(Math.hypot(cart1.x - cart0.x, cart1.z - cart0.z) > 3, 'where it was taken');
  assert.equal(me.items(box)[0]?.kind, kind, 'the box kept it');

  // Back on: towing again at once.
  me.send({ t: 'mount', id: bikeId });
  await until(() => me.state.riding && towed(), 3000, 'towing again');
  assert.ok(Math.abs(me.state.hitch - cart1.heading) < 1e-3);
  await getOff();

  // Someone else: it isn't theirs to let go, or to tow.
  const other = new Client(port, 'Stranger'); peers.push(other);
  await other.join();
  assert.ok(!other.vehicles.mine.includes(cartId), 'not theirs');
  assert.equal(other.vehicle(cartId).color, 0x2a9d8f, 'they see it in our colour');
  assert.ok(!JSON.stringify(other.vehicles).includes(me.browserId), 'never our browser ID');
  assert.equal(other.vehicles.list.find((v) => v.kind === 'cart' && v.id !== cartId)?.color, other.welcomeColor, 'theirs in theirs');
  await other.walkTo(cart1.x + 1.2, cart1.z + 1.2, 0.5);
  assert.equal(await other.notice({ t: 'unhitch', id: cartId }), TEXT.notice.notYours);
  assert.equal(other.vehicle(cartId).hitched, bikeId);

  // Ours: let go at the tongue, on foot.
  await me.walkTo(couplerOf(cart1).x + 0.6, couplerOf(cart1).z, 0.4);
  me.send({ t: 'unhitch', id: cartId });
  await until(() => me.vehicle(cartId).hitched === undefined, 3000, 'unhitched');
  me.send({ t: 'mount', id: bikeId }); // (in reach of the bike still)
  await until(() => me.state.riding, 3000, 'on the bike');
  assert.equal(me.state.tow, 0, 'getting on doesn\'t take it along');
  await getOff();

  // They get on our bike and back it up to our cart: it stays put.
  const b = me.vehicle(bikeId);
  await other.walkTo(b.x + Math.cos(b.heading) * 1.5, b.z - Math.sin(b.heading) * 1.5, 0.5);
  other.send({ t: 'mount', id: bikeId });
  await until(() => other.state.riding, 3000, 'they got on');
  for (let i = 0; i < 90; i++) {
    const s = other.state, vf = -s.vx * Math.sin(s.heading) - s.vz * Math.cos(s.heading);
    await other.input(vf > -1.2 ? BACK : 0, s.heading);
  }
  assert.equal(other.state.tow, 0, 'not towed by someone else');
  assert.equal(other.vehicle(cartId).rider, undefined);
  assert.equal(other.vehicle(cartId).hitched, undefined);
  assert.equal(me.ws.readyState, WebSocket.OPEN, output());
});

test('unfold and pack (owner only, not while linked), backing up to it unfolded packs and hitches it, the wrench raises its level from the bag', { timeout: 120_000 }, async (t) => {
  const { port, peers, output } = await lab(t);
  const me = new Client(port, 'Owner'); peers.push(me);
  await me.join();
  const cartId = me.vehicles.mine.find((id) => me.vehicle(id).kind === 'cart');
  const cart0 = me.vehicle(cartId);
  assert.equal(cart0.open, false, 'it stands packed');
  const side = cartToWorld(cart0, 1.9, 0);
  await me.walkTo(side.x, side.z, 0.4);
  const count = (kind) => me.items('bag').reduce((n, it) => n + (it?.kind === kind ? it.n : 0), 0);
  /** Send `m` and wait for the bag or a notice: the notice's text, if one came. */
  const answer = async (m) => {
    const n = me.messages.length;
    me.send(m);
    await until(() => me.messages.slice(n).some((x) => (x.t === 'items' && x.box === 'bag') || x.t === 'notice'), 3000, `answer to ${m.t}`);
    await sleep(80);
    return me.messages.slice(n).find((x) => x.t === 'notice')?.text;
  };

  // Someone else: not theirs to unfold or build on.
  const other = new Client(port, 'Stranger'); peers.push(other);
  await other.join();
  const far = cartToWorld(cart0, -1.9, 0);
  await other.walkTo(far.x, far.z, 0.4);
  assert.equal(await other.notice({ t: 'unfoldCart', id: cartId, open: true }), TEXT.notice.notYours);
  other.send({ t: 'debugGive', kind: 'wrench' });
  await sleep(200);
  assert.equal(await other.notice({ t: 'upgradeCart', id: cartId }), TEXT.notice.notYours);
  assert.equal(other.vehicle(cartId).open, false);

  // Upgrades: everything but the wrench out of the lab's full bag into the cart's box first (the materials too:
  // refused), then the materials given.
  if (!count('wrench')) await answer({ t: 'debugGive', kind: 'wrench' });
  const box = `cargo${cartId}`;
  for (let k = 0; k < 60; k++) {
    const fi = me.items('bag').findIndex((it) => it && it.kind !== 'wrench');
    if (fi < 0) break;
    const n = me.messages.length;
    me.send({ t: 'move', from: 'bag', fi, to: box, ti: -1 });
    await until(() => me.messages.slice(n).some((m) => m.t === 'items' && m.box === 'bag'), 3000, 'stowed');
  }
  for (const kind of ['cloth', 'scrap', 'wiring']) assert.equal(count(kind), 0, `no ${kind} left`);
  assert.equal(await answer({ t: 'upgradeCart', id: cartId }), TEXT.notice.missingMaterials);
  assert.equal(me.vehicle(cartId).level, 0);
  const need = (level, kind) => CART_TABLE[level].find((s) => s.kinds?.includes(kind))?.n ?? 0;
  assert.equal(need(2, 'wiring'), 0, 'level 2 takes no wiring (the beginning gets its first off the table it makes)');
  await answer({ t: 'debugGive', kind: 'cloth', n: need(1, 'cloth') });
  await answer({ t: 'debugGive', kind: 'scrap', n: need(1, 'scrap') + need(2, 'scrap') });
  assert.equal(await answer({ t: 'upgradeCart', id: cartId }), undefined);
  await until(() => me.vehicle(cartId).level === 1, 3000, 'level 1');
  assert.equal(count('cloth'), 0, 'its cloth spent');
  assert.equal(count('scrap'), need(2, 'scrap'), 'its scrap spent');
  assert.equal(await answer({ t: 'upgradeCart', id: cartId }), TEXT.notice.missingMaterials, 'level 2 wants its cloth');
  await answer({ t: 'debugGive', kind: 'cloth', n: need(2, 'cloth') });
  assert.equal(await answer({ t: 'upgradeCart', id: cartId }), undefined);
  await until(() => me.vehicle(cartId).level === 2, 3000, 'level 2');
  assert.equal(count('scrap') + count('cloth'), 0);
  await answer({ t: 'debugGive', kind: 'scrap', n: 40 });
  assert.equal(await answer({ t: 'upgradeCart', id: cartId }), TEXT.notice.fullyBuilt, 'no level 3');
  assert.equal(count('scrap'), 40, 'nothing spent');

  // Unfold, pack, unfold again.
  me.send({ t: 'unfoldCart', id: cartId, open: true });
  await until(() => me.vehicle(cartId).open === true, 3000, 'unfolded');
  me.send({ t: 'unfoldCart', id: cartId, open: false });
  await until(() => me.vehicle(cartId).open === false, 3000, 'packed');
  me.send({ t: 'unfoldCart', id: cartId, open: true });
  await until(() => me.vehicle(cartId).open === true, 3000, 'unfolded again');

  // A bike 3 m ahead of a spot whose hitch point is 1 m ahead of the coupler; back up: packed and hitched in one go.
  const c = cart0.heading, fx = -Math.sin(c), fz = -Math.cos(c), cp = couplerOf(cart0);
  await me.walkTo(cp.x + fx * (HITCH_BACK + 1 - 3), cp.z + fz * (HITCH_BACK + 1 - 3), 0.15);
  for (let i = 0; i < 10; i++) await me.input(0, c);
  const n0 = me.vehicles.list.length;
  me.send({ t: 'debugBike', working: true });
  await until(() => me.vehicles.list.length === n0 + 1, 3000, 'a bike');
  const bikeId = me.vehicles.list.at(-1).id;
  me.send({ t: 'mount', id: bikeId });
  await until(() => me.state.riding, 3000, 'on the bike');
  for (let i = 0; i < 400 && me.state.tow !== cartId; i++) {
    const s = me.state, vf = -s.vx * Math.sin(s.heading) - s.vz * Math.cos(s.heading);
    await me.input(vf > -1.2 ? BACK : 0, s.heading);
  }
  assert.equal(me.state.tow, cartId, 'hitched by backing up');
  await until(() => me.vehicle(cartId).open === false && me.vehicle(cartId).hitched === bikeId, 3000, 'packed and linked');

  // Off the bike, still linked: it stays packed and doesn't unfold.
  await me.input(0, me.state.heading);
  await me.input(BIKE, me.state.heading);
  await me.input(0, me.state.heading);
  await until(() => !me.state.riding && me.vehicle(cartId).rider === undefined, 3000, 'parked');
  const cart1 = me.vehicle(cartId);
  assert.equal(cart1.open, false);
  const by = cartToWorld(cart1, 1.9, 0);
  await me.walkTo(by.x, by.z, 0.4);
  assert.equal(await me.notice({ t: 'unfoldCart', id: cartId, open: true }), TEXT.notice.unhitchFirst);
  // Let go at the tongue: it stays packed until it's unfolded.
  await me.walkTo(couplerOf(cart1).x + 0.6, couplerOf(cart1).z, 0.4);
  me.send({ t: 'unhitch', id: cartId });
  await until(() => me.vehicle(cartId).hitched === undefined, 3000, 'unhitched');
  assert.equal(me.vehicle(cartId).open, false, 'unhitching leaves it packed');
  me.send({ t: 'unfoldCart', id: cartId, open: true });
  await until(() => me.vehicle(cartId).open === true, 3000, 'unfolded after unhitching');
  assert.equal(me.ws.readyState, WebSocket.OPEN, output());
});

// ---- Phase 3: the workshop, the build menu, the beginning ----------------------------------------------------------------

test('unfolded at level 2, a parked cart\'s sides are a workbench (left) and a dismantling table (right) at any heading', () => {
  for (const heading of [0, 0.7, 2.4, -1.9]) {
    const v = cartAt(3400, 3100, heading, { id: 7, level: 2, open: true });
    setVehicles([v]);
    const list = stations().filter((s) => s.cart === 7);
    assert.deepEqual(list.map((s) => s.kind).sort(), ['disassembly', 'workbench']);
    const bench = list.find((s) => s.kind === 'workbench'), table = list.find((s) => s.kind === 'disassembly');
    const l = cartToWorld(v, -1.005, 0), r = cartToWorld(v, 1.005, 0);
    assert.ok(Math.hypot(bench.x - l.x, bench.z - l.z) < 1e-9 && Math.hypot(table.x - r.x, table.z - r.z) < 1e-9);
    assert.ok(Math.abs(table.y1 - (v.y + 0.88)) < 1e-9, 'flush with the deck');
    // Its session table, turned with the cart: a point along it is on it, one off its outer edge isn't.
    const t = tableById('cart7');
    assert.ok(t && Math.abs(t.yaw - heading) < 1e-9 && Math.abs(t.w - 0.65) < 1e-9 && Math.abs(t.d - 2.16) < 1e-9);
    const along = cartToWorld(v, 1.005, 0.95), off = cartToWorld(v, 1.45, 0.95);
    assert.ok(onTable(t, along.x, along.z) && !onTable(t, off.x, off.z));
    // Looked at from either side, a bit along it: the crosshair finds that side (an oriented box, not the world's axes).
    for (const [sx, kind] of [[-1, 'workbench'], [1, 'disassembly']]) {
      const at = cartToWorld(v, sx * 2.2, 0.6), aim = cartToWorld(v, sx * 1.0, 0.8);
      const feet = { x: at.x, y: v.y, z: at.z };
      const yaw = Math.atan2(-(aim.x - at.x), -(aim.z - at.z));
      const pitch = Math.atan2(v.y + 0.7 - (v.y + 1.65), Math.hypot(aim.x - at.x, aim.z - at.z));
      assert.equal(stationTarget(feet, quantizeYaw(yaw), quantizePitch(pitch))?.kind, kind, `heading ${heading}: ${kind}`);
      // Looking past its end along the cart's length: no station.
      const past = cartToWorld(v, sx * 1.0, 3.5);
      const yaw2 = Math.atan2(-(past.x - at.x), -(past.z - at.z));
      assert.equal(stationTarget(feet, quantizeYaw(yaw2), quantizePitch(pitch))?.kind, undefined, 'nothing past its end');
    }
  }
  // Not a workshop packed, below level 2, or towed.
  for (const extra of [{ open: false }, { level: 1 }, { rider: 3 }]) {
    setVehicles([cartAt(3400, 3100, 0.3, { id: 7, level: 2, open: true, ...extra })]);
    assert.equal(stations().filter((s) => s.cart === 7).length, 0, JSON.stringify(extra));
    assert.equal(tableById('cart7'), undefined);
  }
  setVehicles([]);
});

test('the wrench no longer builds the workbench, dismantling table or chest; standing ones still work and give their materials back', () => {
  for (const kind of ['workbench', 'dismantle_bench', 'storage_chest']) {
    assert.ok(!(kind in BUILDS), `${kind} not in the build menu`);
    assert.ok(isBuildable(kind), `${kind} still comes down with the wrench`);
    assert.deepEqual(buildCost(kind), RETIRED_BUILD_TABLE[kind].map((s) => ({ kind: s.kinds[0], n: s.n })));
  }
  for (const kind of ['windmill', 'battery_station', 'power_pole', 'beacon_light', 'light_pole', 'well']) assert.ok(kind in BUILDS, kind);
  setPlaced([{ id: 41, kind: 'workbench', x: 3500, y: heightAt(3500, 3100), z: 3100, rot: 1 }, { id: 42, kind: 'dismantle_bench', x: 3510, y: heightAt(3510, 3100), z: 3100, rot: 0 }]);
  assert.deepEqual(stations().map((s) => [s.kind, s.placed]), [['workbench', 41], ['disassembly', 42]]);
  assert.ok(tableById('bench42'));
  setPlaced([]);
});

test('the pods\' kit pays for the wrench, the cart\'s levels 1 and 2, a tarp and a bedroll, with no wiring needed', () => {
  const want = {};
  for (const specs of [HAND_TABLE.wrench, CART_TABLE[1], CART_TABLE[2], HAND_TABLE.tarp, HAND_TABLE.bedroll]) {
    for (const s of specs) want[s.kinds[0]] = (want[s.kinds[0]] ?? 0) + s.n;
  }
  assert.equal(want.wiring, undefined, 'nothing before the table needs wiring');
  assert.deepEqual(Object.keys(want).sort(), ['cloth', 'scrap']);
  assert.equal(POD_LOOT.kit.scrap, want.scrap);
  assert.equal(POD_LOOT.kit.cloth, want.cloth);
  assert.ok(POD_LOOT.kit.pod_console && POD_LOOT.kit.pod_powerbox);
});

/** A lab world whose database has an old workbench, dismantling table and chest standing by the spawn. */
const OLD = { workbench: { x: -7, z: 2 }, dismantle_bench: { x: -7, z: -3 }, storage_chest: { x: -7, z: 6 } };
const withOldBenches = (path) => {
  const db = openDb(path);
  for (const [kind, o] of Object.entries(OLD)) db.insertPlaced(kind, LAB_SPAWN.x + o.x, heightAt(LAB_SPAWN.x + o.x, LAB_SPAWN.z + o.z), LAB_SPAWN.z + o.z, 0, '');
  db.close();
};

test('the beginning with the pods\' kit: wrench, cart shade, cart workshop, a tarp and a bedroll; the pod\'s machines taken apart on the cart; packing refused while one is on it', { timeout: 180_000 }, async (t) => {
  const { port, peers, output } = await lab(t, withOldBenches);
  const me = new Client(port, 'Newcomer'); peers.push(me);
  await me.join();
  const cartId = me.vehicles.mine.find((id) => me.vehicle(id).kind === 'cart');
  const cart0 = me.vehicle(cartId);
  const count = (kind) => me.items('bag').reduce((n, it) => n + (it?.kind === kind ? it.n : 0), 0);
  const has = (pred) => me.items('bag').some((it) => it && pred(it.kind));
  const answer = async (m, box = 'bag') => {
    const n = me.messages.length;
    me.send(m);
    await until(() => me.messages.slice(n).some((x) => (x.t === 'items' && x.box === box) || x.t === 'notice'), 3000, `answer to ${m.t}`);
    await sleep(80);
    return me.messages.slice(n).find((x) => x.t === 'notice')?.text;
  };

  // Our bag (the lab's, full) emptied into the cart's box: from here on only what we're given.
  // Round the cart by its front (clear of the tongue) to its side sx (−1 left, the workbench; +1 right, the table).
  let side = 0;
  const go = async (lx, lz) => { const p = cartToWorld(cart0, lx, lz); await me.walkTo(p.x, p.z, 0.4); };
  const toSide = async (sx) => {
    if (side && side !== sx) { await go(side * 2.4, -4.2); await go(sx * 2.4, -4.2); }
    await go(sx * 1.9, 0.3);
    side = sx;
  };
  // (The old benches stand west of the spawn: the cart's side facing them is the way there and back.)
  const west = cartToWorld(cart0, 1, 0).x < cart0.x ? 1 : -1;
  await toSide(1);
  const box = `cargo${cartId}`;
  for (let k = 0; k < 80; k++) {
    const fi = me.items('bag').findIndex(Boolean);
    if (fi < 0) break;
    const n = me.messages.length;
    me.send({ t: 'move', from: 'bag', fi, to: box, ti: -1 });
    await until(() => me.messages.slice(n).some((m) => m.t === 'items' && m.box === 'bag'), 3000, 'stowed');
  }
  assert.ok(!me.items('bag').some(Boolean), 'an empty bag');
  // The old benches still work: crafting at the old workbench, and the wrench takes them down into their materials.
  const old = (kind) => me.messages.findLast((m) => m.t === 'placed')?.list?.find((p) => p.kind === kind);
  await until(() => old('workbench'), 3000, 'the old benches');
  const wb = old('workbench');
  await me.walkTo(wb.x + 1.6, wb.z, 0.3);
  await answer({ t: 'debugGive', kind: 'scrap', n: 3 });
  assert.equal(count('scrap'), 3);
  const gears = count('gear_scrap');
  assert.equal(await answer({ t: 'craft', recipe: 'gear_scrap' }), undefined, 'crafted at the old workbench');
  assert.equal(count('gear_scrap'), gears + 1);

  // Back at the cart, only the kit.
  side = 0;
  await toSide(west);
  for (const [kind, n] of Object.entries(POD_LOOT.kit)) await answer({ t: 'debugGive', kind, n });
  assert.equal(count('scrap'), POD_LOOT.kit.scrap);

  // The order: the wrench by hand, the cart's shade and workshop with it, the tarp and the bedroll by hand.
  assert.equal(await answer({ t: 'craft', recipe: 'wrench' }), undefined);
  assert.equal(count('wrench'), 1);
  assert.equal(await answer({ t: 'upgradeCart', id: cartId }), undefined);
  await until(() => me.vehicle(cartId).level === 1, 3000, 'level 1');
  assert.equal(await answer({ t: 'upgradeCart', id: cartId }), undefined);
  await until(() => me.vehicle(cartId).level === 2, 3000, 'level 2');
  assert.equal(await answer({ t: 'craft', recipe: 'tarp' }), undefined);
  assert.equal(await answer({ t: 'craft', recipe: 'bedroll' }), undefined);
  assert.equal(count('scrap') + count('cloth'), 0, 'the kit spent exactly');
  assert.ok(count('tarp') && count('bedroll'));

  // Packed, the workshop isn't a table yet: a machine can't go on it.
  const at = `cart${cartId}`;
  me.send({ t: 'crashUse', kind: 'pod_console', at });
  await until(() => me.messages.some((m) => m.t === 'bench' && m.id === at), 3000, 'refused');
  assert.equal(me.messages.findLast((m) => m.t === 'bench' && m.id === at).job, null);
  assert.equal(count('pod_console'), 1, 'still in the bag');

  // Unfolded: the pod's console and power box taken apart on its table, every step and part.
  me.send({ t: 'unfoldCart', id: cartId, open: true });
  await until(() => me.vehicle(cartId).open === true, 3000, 'unfolded');
  const strip = async (kind) => {
    me.send({ t: 'crashUse', kind, at });
    await until(() => me.messages.findLast((m) => m.t === 'bench' && m.id === at)?.job?.kind === kind, 3000, `${kind} on the table`);
    const job = me.messages.findLast((m) => m.t === 'bench' && m.id === at).job;
    assert.equal(count(kind), 0, 'off the bag');
    // A machine on it: the cart doesn't pack, nor hitch.
    assert.equal(await me.notice({ t: 'unfoldCart', id: cartId, open: false }), TEXT.notice.benchInUse);
    assert.equal(me.vehicle(cartId).open, true);
    me.send({ t: 'siteJoin', id: at });
    await until(() => me.messages.some((m) => m.t === 'siteState' && m.id === at), 3000, 'joined');
    const rules = stepList(kind, job.seed, 1), done = new Set();
    for (let more = true; more;) {
      more = false;
      for (let i = 0; i < rules.list.length; i++) {
        if (!stepAllowed(rules, done, i)) continue;
        me.send({ t: 'siteDone', id: at, i });
        done.add(i);
        more = true;
      }
    }
    await sleep(200);
    const parts = machineParts(kind, job.seed);
    for (let i = 0; i < parts.length; i++) {
      assert.ok(partAllowed(rules, done, i));
      const n = me.messages.length;
      me.send({ t: 'siteTake', id: at, i });
      await until(() => me.messages.slice(n).some((m) => m.t === 'siteTook' && m.i === i), 3000, `part ${i}`);
      assert.ok(me.messages.slice(n).find((m) => m.t === 'siteTook' && m.i === i).ok);
    }
    // The bare frame scrapped: the table is free.
    const scrap = count('scrap');
    me.send({ t: 'benchScrap', at });
    await until(() => me.messages.findLast((m) => m.t === 'bench' && m.id === at)?.job === null, 3000, 'the table free');
    await until(() => count('scrap') > scrap, 3000, 'the frame\'s scrap');
  };
  await strip('pod_console');
  await strip('pod_powerbox');
  assert.ok(count('wiring') >= 1, 'the first wiring');
  assert.ok(has((k) => k.startsWith('battery_')), 'the bike\'s battery');

  // At the cart's workbench side: the bike's bearing hammered out of the frames' scrap.
  await toSide(-1);
  assert.ok(count('scrap') >= 2, `scrap for a bearing (${count('scrap')})`);
  assert.equal(await answer({ t: 'craft', recipe: 'bearing_scrap' }), undefined, 'crafted at the cart\'s workbench');
  assert.ok(has((k) => k === 'bearing_scrap'));

  // Free again, it packs: the stations go, and crafting there is refused.
  me.send({ t: 'unfoldCart', id: cartId, open: false });
  await until(() => me.vehicle(cartId).open === false, 3000, 'packed');
  await answer({ t: 'debugGive', kind: 'scrap', n: 2 });
  assert.equal(await answer({ t: 'craft', recipe: 'bearing_scrap' }), TEXT.notice.tooFar, 'no workbench packed');

  // The old benches come down with the wrench into what they took (the chest is empty).
  await toSide(west);
  for (const kind of ['workbench', 'dismantle_bench', 'storage_chest']) {
    const q = old(kind);
    await me.walkTo(q.x + 1.8, q.z, 0.3);
    const before = Object.fromEntries(RETIRED_BUILD_TABLE[kind].map((s) => [s.kinds[0], count(s.kinds[0])]));
    assert.equal(await answer({ t: 'unplace', id: q.id }), undefined, `${kind} taken down`);
    for (const s of RETIRED_BUILD_TABLE[kind]) assert.equal(count(s.kinds[0]), before[s.kinds[0]] + s.n, `${kind}: ${s.kinds[0]} back`);
  }
  assert.equal(me.ws.readyState, WebSocket.OPEN, output());
});
