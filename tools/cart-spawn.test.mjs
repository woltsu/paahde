// Waking up by your cart (docs/cart.md "Spawn", server/world.ts homeOf, shared/cart.ts campWakeSpot): your own cart,
// unfolded and built (level ≥ 1), is where you come back after dying, on the sand beside it, clear of its capsules and
// under no canvas, facing it. Packed, or at level 0, or with no free spot by it, it's your bedroll, else your pod as
// before; someone else's cart is never your spawn. In a real lab world.
// Run with: node --test tools/cart-spawn.test.mjs
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { campWakeSpot, canopyRig, cartCapsules, cartToWorld } from '../shared/cart.ts';
import { CART_TABLE } from '../shared/tables.ts';
import { LAB_SPAWN } from '../shared/lab.ts';
import { PROTOCOL_VERSION } from '../shared/protocol.ts';
import { canvasYAt } from '../shared/tarp.ts';
import { CROUCH, FORWARD, PLAYER_RADIUS, quantizeYaw } from '../shared/sim.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(condition, ms = 6000, what = 'condition') {
  const end = performance.now() + ms;
  while (!condition()) { if (performance.now() > end) throw new Error(`${what} timed out`); await sleep(10); }
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

class Client {
  constructor(port, name) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.name = name;
    this.browserId = randomUUID();
    this.messages = [];
    this.seq = 1;
    this.ws.on('message', (raw) => this.messages.push(JSON.parse(String(raw))));
  }
  async join() {
    await new Promise((r) => this.ws.once('open', r));
    this.ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, browserId: this.browserId, name: this.name }));
    await until(() => this.messages.some((m) => m.t === 'welcome'), 6000, 'welcome');
    this.id = this.messages.find((m) => m.t === 'welcome').id;
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
  async walkTo(x, z, near = 0.3) {
    for (let i = 0; i < 1500 && Math.hypot(x - this.state.x, z - this.state.z) > near; i++) {
      const d = Math.hypot(x - this.state.x, z - this.state.z);
      await this.input(FORWARD | (d < 2.5 ? CROUCH : 0), Math.atan2(-(x - this.state.x), -(z - this.state.z)));
    }
    for (let i = 0; i < 20; i++) await this.input(0, this.state.facing);
    assert.ok(Math.hypot(x - this.state.x, z - this.state.z) < near + 0.6, `${this.name} walked to ${x}, ${z}`);
  }
  /** Send `m`; the notice it got back within a moment, if any. */
  async answer(m, box = 'bag') {
    const n = this.messages.length;
    this.send(m);
    await until(() => this.messages.slice(n).some((x) => (x.t === 'items' && x.box === box) || x.t === 'notice' || x.t === 'vehicles'), 3000, `answer to ${m.t}`);
    await sleep(100);
    return this.messages.slice(n).find((x) => x.t === 'notice')?.text;
  }
  /** Killed (the debug menu's hit, the lab's armour broken first), then back on our feet: where the first snapshot after the respawn has us. */
  async dieAndWake() {
    const n = this.messages.length;
    // (The lab's armour takes the first blows: hit until it's broken.)
    const died = () => this.messages.slice(n).some((m) => m.t === 'died');
    for (let i = 0; i < 120 && !died(); i++) {
      this.send({ t: 'debugHit' });
      await sleep(250);
    }
    assert.ok(died(), `${this.name} died`);
    await until(() => this.messages.slice(n).some((m) => m.t === 'respawn'), 15000, `${this.name} respawned`);
    this.woke = this.messages.slice(n).find((m) => m.t === 'respawn');
    const at = this.messages.length;
    await until(() => this.messages.slice(at).some((m) => m.t === 'snap'), 3000, 'a snapshot after');
    return this.messages.slice(at).find((m) => m.t === 'snap').state;
  }
  slotOf(kind) { return this.items('bag').findIndex((it) => it?.kind === kind); }
}

async function lab(t) {
  const dir = await mkdtemp(join(tmpdir(), 'paahde-cartspawn-'));
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

/** Standing at `s` beside cart `v`: out of its capsules (a body's radius), under none of its canopy, facing it. */
function besideCart(s, v) {
  const d = Math.hypot(s.x - v.x, s.z - v.z);
  assert.ok(d > 1.5 && d < 3.5, `woke ${d.toFixed(2)} m from the cart`);
  for (const c of cartCapsules(v)) {
    let t = (s.x - c.x) * c.ax + (s.z - c.z) * c.az;
    t = Math.max(-c.half, Math.min(c.half, t));
    const gap = Math.hypot(s.x - c.x - c.ax * t, s.z - c.z - c.az * t) - c.r - PLAYER_RADIUS;
    assert.ok(gap > 0, `in one of its capsules (${gap.toFixed(2)} m)`);
  }
  assert.ok(Number.isNaN(canvasYAt(canopyRig(v), s.x, s.z)), 'under its canopy');
  const want = Math.atan2(s.x - v.x, s.z - v.z);
  assert.ok(Math.abs(wrap(s.facing - want)) < 0.05, `facing the cart (${s.facing.toFixed(2)} vs ${want.toFixed(2)})`);
  assert.equal(s.level, 0, 'on the desert');
}

test('campWakeSpot: the first free spot round it, out past the unfolded footprint, facing it; null with none free', () => {
  for (const heading of [0, 1, 2.5, -2]) {
    const v = { id: 1, kind: 'cart', x: 10, y: 3, z: -4, heading, up: true, parts: [], open: true, level: 2 };
    const first = campWakeSpot(v, () => true);
    const tongueSide = cartToWorld(v, 0, -3);
    assert.ok(Math.hypot(first.x - tongueSide.x, first.z - tongueSide.z) < Math.hypot(first.x - cartToWorld(v, 0, 3).x, first.z - cartToWorld(v, 0, 3).z), 'by the tongue first');
    let seen = 0;
    const last = campWakeSpot(v, () => ++seen > 6);
    assert.ok(last && seen === 7, 'tries them in turn');
    for (const s of [first, last]) besideCart({ ...s, level: 0 }, v);
    assert.equal(campWakeSpot(v, () => false), null);
  }
});

test('your own unfolded, built cart is where you wake: level 0 or packed it\'s the bedroll, under a tarp with no free spot too; never someone else\'s', { timeout: 240_000 }, async (t) => {
  const { port, peers, output } = await lab(t);
  const me = new Client(port, 'Camper'); peers.push(me);
  await me.join();
  const cartId = me.vehicles.mine.find((id) => me.vehicle(id).kind === 'cart');
  const cart0 = me.vehicle(cartId);
  assert.equal(cart0.level, 0);

  // Room in the lab's full bag: a few things into the cart's box.
  const by = cartToWorld(cart0, 2.2, 0.7);
  await me.walkTo(by.x, by.z, 0.4);
  for (let k = 0; k < 8; k++) {
    const fi = me.items('bag').findIndex((it, i) => i >= 5 && it && !['wrench', 'bedroll', 'tarp', 'cloth', 'scrap'].includes(it.kind));
    if (fi < 0) break;
    await me.answer({ t: 'move', from: 'bag', fi, to: `cargo${cartId}`, ti: -1 });
  }

  // A bedroll laid on the far side of where we start from the cart: our spawn point.
  const away = Math.atan2(LAB_SPAWN.x - cart0.x, LAB_SPAWN.z - cart0.z);
  const stand = { x: LAB_SPAWN.x + Math.sin(away) * 4, z: LAB_SPAWN.z + Math.cos(away) * 4 };
  await me.walkTo(stand.x, stand.z, 0.4);
  await me.answer({ t: 'debugGive', kind: 'bedroll' });
  const bed = { x: stand.x + Math.sin(away) * 2, z: stand.z + Math.cos(away) * 2 };
  const n = me.messages.length;
  assert.equal(await me.answer({ t: 'place', slot: me.slotOf('bedroll'), x: bed.x, z: bed.z, rot: 0 }), undefined, 'laid the bedroll');
  await until(() => me.messages.slice(n).some((m) => m.t === 'spawn' && m.id !== null), 3000, 'our spawn point');
  const atBed = (s) => Math.hypot(s.x - bed.x, s.z - bed.z) < 2;

  // Unfolded at level 0: not built yet, so the bedroll.
  await me.walkTo(by.x, by.z, 0.4);
  assert.equal(await me.answer({ t: 'unfoldCart', id: cartId, open: true }), undefined);
  await until(() => me.vehicle(cartId).open === true, 3000, 'unfolded');
  let s = await me.dieAndWake();
  assert.ok(atBed(s), `a level-0 cart isn't a camp: woke at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`);

  // Built (level 1), still unfolded: we wake beside it, clear of it, facing it.
  await me.walkTo(by.x, by.z, 0.4);
  await me.answer({ t: 'debugGive', kind: 'wrench' });
  for (const spec of CART_TABLE[1]) await me.answer({ t: 'debugGive', kind: spec.kinds[0], n: spec.n });
  assert.equal(await me.answer({ t: 'upgradeCart', id: cartId }), undefined);
  await until(() => me.vehicle(cartId).level === 1, 3000, 'level 1');
  s = await me.dieAndWake();
  besideCart(s, me.vehicle(cartId));
  assert.ok(Math.abs(wrap(me.woke.facing - s.facing)) < 1e-3, 'the camera told to face it');

  // Someone else's unfolded cart is never their spawn: they come back at their own pod (the lab's start).
  const other = new Client(port, 'Neighbour'); peers.push(other);
  await other.join();
  await other.walkTo(by.x, by.z, 0.5);
  const os = await other.dieAndWake();
  assert.ok(Math.hypot(os.x - LAB_SPAWN.x, os.z - LAB_SPAWN.z) < 1.5, `they woke at ${os.x.toFixed(1)}, ${os.z.toFixed(1)}, not by our cart`);

  // Packed: the bedroll again.
  assert.equal(await me.answer({ t: 'unfoldCart', id: cartId, open: false }), undefined);
  await until(() => me.vehicle(cartId).open === false, 3000, 'packed');
  s = await me.dieAndWake();
  assert.ok(atBed(s), 'packed, the bedroll');
  assert.equal(me.woke.facing, undefined, 'the camera left as it was');

  // Unfolded again, under a tarp put up over it: no spot by it is clear of canvas, so the bedroll.
  await me.walkTo(by.x, by.z, 0.4);
  assert.equal(await me.answer({ t: 'unfoldCart', id: cartId, open: true }), undefined);
  await until(() => me.vehicle(cartId).open === true, 3000, 'unfolded again');
  await me.answer({ t: 'debugGive', kind: 'tarp' });
  const cart = me.vehicle(cartId);
  assert.equal(await me.answer({ t: 'place', slot: me.slotOf('tarp'), x: cart.x, z: cart.z, rot: 0 }), undefined, 'a tarp over the cart');
  s = await me.dieAndWake();
  assert.ok(atBed(s), `no free spot: the bedroll (woke at ${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
  assert.equal(me.ws.readyState, WebSocket.OPEN, output());
});
