// The quad by the pods carries a passenger (shared/sim.ts PlayerState.pillion, server/world.ts carryPassengers): in the
// dev lab, one player stands the home quad up and rides it, a second gets on behind them, is carried as it drives, gets
// off with the bike key, gets on again, and is put down beside it when the rider gets off.
// Run with: node --test tools/quad-pillion.test.mjs
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { GEAR } from '../shared/gear.ts';
import { partKind } from '../shared/items.ts';
import { PROTOCOL_VERSION } from '../shared/protocol.ts';
import { BIKE, FORWARD, YAW_STEPS } from '../shared/sim.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(condition, ms = 6000, what = 'condition') {
  const end = performance.now() + ms;
  while (!condition()) { if (performance.now() > end) throw new Error(`${what} timed out`); await sleep(10); }
}
const yawQ = (yaw) => ((Math.round((yaw / (2 * Math.PI)) * YAW_STEPS) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;

test('a second player rides on the back of the quad, carried with it, and gets off', { timeout: 90_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'paahde-quad-'));
  const child = fork(new URL('../server/world.ts', import.meta.url), {
    env: { ...process.env, WORLD_ID: 'lab', DADAJAM_LAB: '1', DB_PATH: join(dir, 'world.db'), TELEMETRY_PATH: join(dir, 'trace.jsonl') },
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.on('data', (s) => { output += s; }); child.stderr.on('data', (s) => { output += s; });
  const peers = [];
  t.after(async () => {
    peers.forEach((ws) => ws.terminate());
    if (child.exitCode === null && child.signalCode === null) await new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); });
    await rm(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timeout: ${output}`)), 8000);
    child.on('message', (m) => { if (m.t === 'port') { clearTimeout(timer); resolve(m.port); } });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`world exited ${code}: ${output}`)); });
  });

  async function join_(name) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); peers.push(ws);
    const messages = [];
    ws.on('message', (raw) => messages.push(JSON.parse(String(raw))));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, browserId: randomUUID(), name }));
    await until(() => messages.some((m) => m.t === 'welcome'), 6000, 'welcome');
    const id = messages.find((m) => m.t === 'welcome').id;
    const snap = () => messages.findLast((m) => m.t === 'snap');
    ws.send(JSON.stringify({ t: 'ready' }));
    await until(() => snap()?.players.some((p) => (Array.isArray(p) ? p[0] : p.id) === id), 6000, 'ready');
    let seq = 1;
    const c = {
      ws, id, messages,
      state: () => snap().state,
      list: () => messages.findLast((m) => m.t === 'vehicles').list,
      input: (input, yaw = 0) => ws.send(JSON.stringify({ t: 'input', seq: seq++, input, yaw: yawQ(yaw), pitch: 0 })),
      /** Hold `input` for `ticks` (60 a second). */
      async hold(input, ticks, yaw = 0) {
        for (let i = 0; i < ticks; i++) { c.input(input, yaw); await sleep(1000 / 60); }
      },
      async walkTo(x, z, near) {
        for (let i = 0; i < 1200 && Math.hypot(x - c.state().x, z - c.state().z) > near; i++) {
          c.input(FORWARD, Math.atan2(-(x - c.state().x), -(z - c.state().z)));
          await sleep(1000 / 60);
        }
        c.input(0);
        await sleep(300);
      },
    };
    return c;
  }

  const a = await join_('Rider');
  const quad = a.list().find((v) => v.kind === 'quad');
  assert.ok(quad, 'the quad lies by the spawn');
  assert.ok(!quad.up, 'broken');
  await a.walkTo(quad.x, quad.z, 2.2);

  // Every part fitted, stood up, and on.
  const box = `veh${quad.id}`;
  const slots = () => a.messages.findLast((m) => m.t === 'items' && m.box === box)?.slots;
  const bag = () => a.messages.findLast((m) => m.t === 'items' && m.box === 'bag')?.slots ?? [];
  const answered = async (send, box_) => {
    const n = a.messages.length;
    a.ws.send(JSON.stringify(send));
    await until(() => a.messages.slice(n).some((m) => m.t === 'items' && m.box === box_), 6000, send.t);
  };
  for (const k of ['receiver_carrier', 'receiver_queen', 'receiver_colossus']) {
    const i = bag().findIndex((x) => x?.kind === k);
    if (i >= 0) await answered({ t: 'drop', box: 'bag', slot: i }, 'bag');
  }
  for (const [i, s] of GEAR.quad.slots.entries()) {
    if (slots()[0].parts?.[i]) continue;
    const kind = partKind(s.part, 'scrap');
    await answered({ t: 'debugGive', kind }, 'bag');
    await answered({ t: 'fit', from: 'bag', fi: bag().findIndex((x) => x?.kind === kind), slot: i, at: box }, box);
  }
  a.ws.send(JSON.stringify({ t: 'repairVehicle', id: quad.id }));
  await until(() => a.list().find((v) => v.id === quad.id).up, 3000, 'standing up');
  a.ws.send(JSON.stringify({ t: 'mount', id: quad.id }));
  await until(() => a.state().riding, 3000, 'riding');
  assert.equal(a.state().quad, true, 'riding a quad');

  // Someone else walks up and gets on behind.
  const b = await join_('Passenger');
  const at = a.state();
  await b.walkTo(at.x, at.z, 1.8);
  b.ws.send(JSON.stringify({ t: 'mount', id: quad.id }));
  await until(() => b.state().pillion === a.id, 3000, `on the back: ${JSON.stringify(b.messages.findLast((m) => m.t === 'notice'))}`);
  assert.equal(b.list().find((v) => v.id === quad.id).passenger, b.id, 'the quad has its passenger');
  assert.ok(b.messages.findLast((m) => m.t === 'snap').players.some((p) => p[0] === a.id && p[9] & 64), 'others see a quad');

  // The rider drives off: the passenger goes with it.
  await a.hold(FORWARD, 90, a.state().heading);
  a.input(0, a.state().heading);
  await sleep(400);
  assert.ok(Math.hypot(a.state().x - at.x, a.state().z - at.z) > 2, 'the quad moved');
  assert.ok(Math.hypot(a.state().x - b.state().x, a.state().z - b.state().z) < 0.5, 'the passenger with it');
  assert.ok(b.messages.findLast((m) => m.t === 'snap').players.some((p) => p[0] === b.id && p[14] === a.id), 'drawn on its back');

  // The bike key gets the passenger off, beside it; and on again.
  await b.hold(BIKE, 3);
  b.input(0);
  await until(() => !b.state().pillion, 3000, 'off');
  await until(() => b.list().find((v) => v.id === quad.id).passenger === undefined, 3000, 'seat free');
  b.ws.send(JSON.stringify({ t: 'mount', id: quad.id }));
  await until(() => b.state().pillion === a.id, 3000, 'on again');

  // The rider gets off: the passenger is put down too.
  await sleep(200);
  await a.hold(BIKE, 3, a.state().heading);
  a.input(0);
  await until(() => !a.state().riding, 3000, 'rider off');
  await until(() => !b.state().pillion, 3000, 'passenger off with them');
  assert.equal(a.list().find((v) => v.id === quad.id).passenger, undefined);

  // The debug menu's quads: a working one and a broken one in front of you.
  const count = a.list().length;
  a.ws.send(JSON.stringify({ t: 'debugBike', working: true, quad: true }));
  a.ws.send(JSON.stringify({ t: 'debugBike', working: false, quad: true }));
  await until(() => a.list().length === count + 2, 3000, 'debug quads');
  const spawned = a.list().slice(-2);
  assert.deepEqual(spawned.map((v) => [v.kind, v.up]), [['quad', true], ['quad', false]]);
  assert.equal(a.ws.readyState, WebSocket.OPEN, output);
});
