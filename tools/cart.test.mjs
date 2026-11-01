// The cart (shared/cart.ts, docs/cart.md phase 1): towing is in the shared sim and deterministic (the server's step and
// the client's replay from the state it is sent agree); in a real world, your own cart stands by you, backing the bike up
// to it hitches it, getting off parks both still linked, getting back on tows it again, F at its tongue on foot lets it
// go, its box keeps what's in it wherever it went, and nobody else can tow it or let it go. Phase 2: parked it's solid;
// unfolded at level 1 its canopy shades and holds you up like a tarp's; its owner unfolds and packs it (the cart key),
// not while it's linked to a bike, and backing up to it unfolded packs and hitches it; the wrench raises its level from
// the bag's materials, only its owner's, never past 2.
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
import { CART_TABLE } from '../shared/tables.ts';
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

async function lab(t) {
  const dir = await mkdtemp(join(tmpdir(), 'paahde-cart-'));
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
  await answer({ t: 'debugGive', kind: 'cloth', n: need(1, 'cloth') + 1 });
  await answer({ t: 'debugGive', kind: 'scrap', n: need(1, 'scrap') + need(2, 'scrap') });
  assert.equal(await answer({ t: 'upgradeCart', id: cartId }), undefined);
  await until(() => me.vehicle(cartId).level === 1, 3000, 'level 1');
  assert.equal(count('cloth'), 1, 'its cloth spent');
  assert.equal(count('scrap'), need(2, 'scrap'), 'its scrap spent');
  assert.equal(await answer({ t: 'upgradeCart', id: cartId }), TEXT.notice.missingMaterials, 'level 2 wants wiring');
  await answer({ t: 'debugGive', kind: 'wiring', n: need(2, 'wiring') });
  assert.equal(await answer({ t: 'upgradeCart', id: cartId }), undefined);
  await until(() => me.vehicle(cartId).level === 2, 3000, 'level 2');
  assert.equal(count('scrap') + count('wiring'), 0);
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
