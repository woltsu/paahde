// Playtest: "pressing Repair doesn't do anything". Beside a broken bike with every part fitted and loot lying in reach
// (the pod's kit), the vehicle's repair view (which shows no ground) kept no loot as "last drawn", so the inventory
// saw the loot as new every frame and redrew, replacing the Repair button between press and release: the click never
// landed. The open inventory now keeps everything in reach as one key (shared/storage.ts reachKey), shown or not.
// Run with: node --test tools/bike-repair.test.mjs
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
import { FORWARD, YAW_STEPS } from '../shared/sim.ts';
import { lootNear, openBoxes, reachKey } from '../shared/storage.ts';
import { heightAt } from '../shared/terrain.ts';
import { setVehicles } from '../shared/vehicles.ts';

test('beside a broken bike, loot in reach is no change from frame to frame; picking it up is', () => {
  const y = heightAt(2, 0);
  setVehicles([{ id: 1, kind: 'motorcycle', x: 0, y: heightAt(0, 0), z: 0, heading: 0, up: false, parts: ['motor_scrap', 'battery_scrap', 'bearing_scrap'] }]);
  const s = { x: 2, y, z: 0, riding: false };
  assert.ok(openBoxes(s).includes('veh1'));
  const loot = new Map([[7, { id: 7, kind: 'scrap', n: 1, x: 2.5, z: 0.5 }], [9, { id: 9, kind: 'cloth', n: 1, x: 1.5, z: -0.5 }]]);
  assert.equal(lootNear(s, loot.values()).length, 2, 'the loot lies in reach');
  // What the repair view draws from (its own ground panel left out) is what the next frame sees.
  const drawn = reachKey(s, loot.values());
  for (let frame = 0; frame < 60; frame++) assert.equal(reachKey(s, loot.values()), drawn);
  loot.delete(7);
  assert.notEqual(reachKey(s, loot.values()), drawn, 'loot picked up meanwhile redraws');
  setVehicles([]);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(condition, ms = 6000, what = 'condition') {
  const end = performance.now() + ms;
  while (!condition()) { if (performance.now() > end) throw new Error(`${what} timed out`); await sleep(10); }
}

test('Repair beside a broken bike with every slot filled stands it up, theirs', { timeout: 60_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'paahde-bike-'));
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
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); peers.push(ws);
  const messages = [];
  ws.on('message', (raw) => messages.push(JSON.parse(String(raw))));
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, browserId: randomUUID(), name: 'Rider' }));
  await until(() => messages.some((m) => m.t === 'welcome'), 6000, 'welcome');
  const welcome = messages.find((m) => m.t === 'welcome');
  const snap = () => messages.findLast((m) => m.t === 'snap');
  ws.send(JSON.stringify({ t: 'ready' }));
  await until(() => snap()?.players.some((p) => (Array.isArray(p) ? p[0] : p.id) === welcome.id), 6000, 'ready');
  const state = () => snap().state;
  const list = () => messages.findLast((m) => m.t === 'vehicles').list;
  const bike = list().find((v) => !v.up); // the home bike (shared/lootRoll.ts homeBikeSpot)
  assert.ok(bike, 'a broken bike lies in the lab');

  // Walk up to it.
  let seq = 1;
  for (let i = 0; i < 900 && Math.hypot(bike.x - state().x, bike.z - state().z) > 2.5; i++) {
    const yaw = Math.atan2(-(bike.x - state().x), -(bike.z - state().z));
    ws.send(JSON.stringify({ t: 'input', seq: seq++, input: FORWARD, yaw: ((Math.round((yaw / (2 * Math.PI)) * YAW_STEPS) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS, pitch: 0 }));
    await sleep(1000 / 60);
  }
  ws.send(JSON.stringify({ t: 'input', seq: seq++, input: 0, yaw: 0, pitch: 0 }));
  await sleep(300);
  assert.ok(Math.hypot(bike.x - state().x, bike.z - state().z) <= 2.6, 'walked up to the bike');

  // Room in the lab's full bag, then each missing part into its slot.
  const box = `veh${bike.id}`;
  const slots = () => messages.findLast((m) => m.t === 'items' && m.box === box)?.slots;
  const bag = () => messages.findLast((m) => m.t === 'items' && m.box === 'bag')?.slots ?? [];
  const answered = async (send, box_) => {
    const n = messages.length;
    ws.send(JSON.stringify(send));
    await until(() => messages.slice(n).some((m) => m.t === 'items' && m.box === box_), 6000, send.t);
  };
  for (const k of ['receiver_carrier', 'receiver_queen', 'receiver_colossus']) {
    await answered({ t: 'drop', box: 'bag', slot: bag().findIndex((x) => x?.kind === k) }, 'bag');
  }
  for (const [i, s] of GEAR.motorcycle.slots.entries()) {
    if (slots()[0].parts?.[i]) continue;
    const kind = partKind(s.part, 'scrap');
    await answered({ t: 'debugGive', kind }, 'bag');
    await answered({ t: 'fit', from: 'bag', fi: bag().findIndex((x) => x?.kind === kind), slot: i, at: box }, box);
  }
  assert.ok(slots()[0].parts.every(Boolean), 'every part fitted');

  const n = messages.length;
  ws.send(JSON.stringify({ t: 'repairVehicle', id: bike.id }));
  await until(() => list().find((v) => v.id === bike.id).up, 3000, 'standing up');
  assert.ok(!messages.slice(n).some((m) => m.t === 'notice'), 'not refused');
  assert.ok(messages.findLast((m) => m.t === 'vehicles').mine.includes(bike.id), 'theirs');
  assert.ok(messages.slice(n).some((m) => m.t === 'items' && m.box === `cargo${bike.id}`), 'its cargo opens');

  // The debug menu's bike (it used to be refused as a bad message, closing the connection).
  const count = list().length;
  ws.send(JSON.stringify({ t: 'debugBike', working: false }));
  await until(() => list().length === count + 1, 3000, 'debug bike');
  assert.equal(ws.readyState, WebSocket.OPEN, output);
});
