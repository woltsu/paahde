// The beginning on the real world server (docs/levels/tutorial.md, server/tutorial.ts): a new player starts in it, alone
// (two new players never see each other, and nobody in the desert sees them); nothing hurts in it; the relay goes into the
// pod's panel, F at the hatch rides the pod down and lands them beside their pod in the desert, granted for good (a new
// row in this world still skips it); the Esc menu's skip does the same and takes back the level's items; a returning
// player and a dev spawn never see it.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import WebSocket from 'ws';

process.env.WORLD_ID = 'begintest';
const { PROTOCOL_VERSION } = await import('../shared/protocol.ts');
const { FORWARD, quantizeYaw, spawnPoint } = await import('../shared/sim.ts');
const { beginningLevel, GATE } = await import('../shared/levels/beginning.ts');
const { podOf } = await import('../shared/pods.ts');
const { RIDE_MS } = await import('../server/tutorial.ts');

const B = beginningLevel.id;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(condition, ms = 5000) {
  const end = performance.now() + ms;
  while (!condition()) { if (performance.now() > end) throw new Error('condition timed out'); await sleep(10); }
}

test('the beginning: new players start in it alone and unhurt, ride the pod down or skip, and never see it again', { timeout: 60_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'paahde-beginning-'));
  const dbPath = join(dir, 'world.db');
  const child = fork(new URL('../server/world.ts', import.meta.url), {
    env: { ...process.env, WORLD_ID: 'begintest', DADAJAM_LAB: '', DB_PATH: dbPath, TELEMETRY_PATH: join(dir, 'trace.jsonl') },
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
    const timer = setTimeout(() => reject(new Error(`startup timeout: ${output}`)), 10000);
    child.on('message', (m) => { if (m.t === 'port') { clearTimeout(timer); resolve(m.port); } });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`world exited ${code}: ${output}`)); });
  });
  const join_ = async (name, spawn, browserId = randomUUID()) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); peers.push(ws);
    const messages = [];
    ws.on('message', (raw) => messages.push(JSON.parse(String(raw))));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, browserId, name, ...(spawn ? { spawn } : {}) }));
    await until(() => messages.some((m) => m.t === 'welcome'), 10000);
    ws.send(JSON.stringify({ t: 'ready' }));
    const welcome = messages.find((m) => m.t === 'welcome');
    const snap = () => messages.findLast((m) => m.t === 'snap');
    const sees = (other) => !!snap()?.players.some((p) => p[0] === other);
    const bag = () => messages.findLast((m) => m.t === 'items' && m.box === 'bag')?.slots ?? [];
    const send = (m) => ws.send(JSON.stringify(m));
    let seq = 0;
    const walk = async (yaw, ms) => {
      const end = performance.now() + ms;
      while (performance.now() < end) { send({ t: 'input', seq: ++seq, input: FORWARD, yaw: quantizeYaw(yaw), pitch: 32768 }); await sleep(16); }
      for (let i = 0; i < 20; i++) { send({ t: 'input', seq: ++seq, input: 0, yaw: quantizeYaw(yaw), pitch: 32768 }); await sleep(16); }
      await until(() => snap()?.ack >= seq);
    };
    return { ws, messages, id: welcome.id, welcome, browserId, snap, sees, bag, send, walk };
  };
  const levelMsgs = (p) => p.messages.filter((m) => m.t === 'level');

  // Already playing here before (a dev spawn: the beginning is skipped), in the desert.
  const old = await join_('Old', 'pod');
  assert.equal(old.welcome.state.level, 0);
  // Two new players: each in their own beginning, seeing nobody, seen by nobody.
  const a = await join_('NewA');
  const b = await join_('NewB');
  assert.equal(a.welcome.state.level, B);
  assert.equal(b.welcome.state.level, B);
  assert.equal(a.welcome.state.gates, 0);
  await until(() => a.snap() && b.snap() && old.snap());
  await sleep(400);
  assert.ok(!a.sees(b.id) && !b.sees(a.id), 'two in their beginnings saw each other');
  assert.ok(!old.sees(a.id) && !a.sees(old.id), 'the desert and the beginning saw each other');
  // Nothing hurts here.
  a.send({ t: 'debugHit' });
  await sleep(300);
  assert.ok(!a.messages.some((m) => m.t === 'died'), 'died in the beginning');
  // A trigger: walking to the quarters' door opens it (the server's bit, in the next snapshot).
  await a.walk(Math.PI, 800);
  await until(() => (a.snap().state.gates & GATE.quarters) !== 0);

  // The pod bay (the debug menu's beat), the relay in the bag: walk to the hatch; F puts it in, F again rides down.
  await sleep(1100);
  a.send({ t: 'debugLevel', key: 'beginning:7' });
  await until(() => levelMsgs(a).length === 1);
  a.send({ t: 'debugGive', kind: 'tut_relay', n: 1 });
  await until(() => a.bag().some((it) => it?.kind === 'tut_relay'));
  await a.walk(Math.PI, 600);
  a.send({ t: 'tutorial', what: 'hatch' });
  await until(() => (a.snap().state.gates & GATE.powered) !== 0);
  await until(() => !a.bag().some((it) => it?.kind === 'tut_relay'));
  a.send({ t: 'tutorial', what: 'hatch' });
  await until(() => (a.snap().state.gates & GATE.launch) !== 0);
  const launched = performance.now();
  await until(() => levelMsgs(a).length === 2, RIDE_MS + 3000);
  assert.ok(performance.now() - launched > RIDE_MS - 500, 'landed before the ride was over');
  const landed = levelMsgs(a)[1].state, pod = spawnPoint(podOf(a.browserId));
  assert.equal(landed.level, 0);
  assert.equal(landed.gates, 0);
  assert.ok(Math.hypot(landed.x - pod.x, landed.z - pod.z) < 1e-3, `landed at ${landed.x},${landed.z}, not the pod ${pod.x},${pod.z}`);
  await until(() => old.sees(a.id), 8000);

  // Skip from the Esc menu: out at the pod, the level's relay taken back.
  b.send({ t: 'debugGive', kind: 'tut_relay', n: 1 });
  await until(() => b.bag().some((it) => it?.kind === 'tut_relay'));
  await sleep(1100);
  b.send({ t: 'tutorial', what: 'skip' });
  await until(() => levelMsgs(b).length === 1);
  assert.equal(levelMsgs(b)[0].state.level, 0);
  await until(() => !b.bag().some((it) => it?.kind === 'tut_relay'));
  assert.ok(!b.bag().some((it) => it?.kind === 'tut_relay'), 'the relay left the beginning');

  // Back again: in the desert (a saved position), and even with no row in this world, the grant keeps them out of it.
  a.ws.close();
  await sleep(300);
  const back = await join_('NewA', undefined, a.browserId);
  assert.equal(back.welcome.state.level, 0);
  back.ws.close();
  b.ws.close();
  await sleep(300);
  const db = new DatabaseSync(dbPath);
  db.prepare('DELETE FROM players WHERE id IN (?, ?)').run(a.browserId, b.browserId);
  db.close();
  for (const [p, name] of [[a, 'NewA'], [b, 'NewB']]) {
    const again = await join_(name, undefined, p.browserId);
    assert.equal(again.welcome.state.level, 0, `${name} back in the beginning`);
  }
  assert.equal(child.exitCode, null, output);
});
