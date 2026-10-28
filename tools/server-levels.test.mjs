// Levels on the real world server (docs/levels.md): ?spawn=datacenter moves a player in once loaded, through the same
// move as a door ('level'); someone in the desert no longer sees them in snapshots (interest by level) and they see only
// each other; a drop inside is refused (the notice, the bag sent back); F at the exit (walked to) brings them out in
// front of the desert's door, and F there (walked to) takes them back in; leaving and coming back while inside puts
// them back where they stood in it.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';

// The lab world, as the server runs it (its entrance is placed by its seed: computed here the same way).
process.env.WORLD_ID = 'lab';
process.env.DADAJAM_LAB = '1';
const { PROTOCOL_VERSION } = await import('../shared/protocol.ts');
const { FORWARD, quantizeYaw } = await import('../shared/sim.ts');
const { entrance } = await import('../shared/levels/entrance.ts');
const { TEXT } = await import('../shared/text.ts');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(condition, ms = 5000) {
  const end = performance.now() + ms;
  while (!condition()) { if (performance.now() > end) throw new Error('condition timed out'); await sleep(10); }
}

test('a level: moved in on ready, seen only by those in it, refused drops, out and in by its doors, rejoined inside', { timeout: 40_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'paahde-levels-'));
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
  const join_ = async (name, spawn, browserId = randomUUID()) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); peers.push(ws);
    const messages = [];
    ws.on('message', (raw) => messages.push(JSON.parse(String(raw))));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, browserId, name, ...(spawn ? { spawn } : {}) }));
    await until(() => messages.some((m) => m.t === 'welcome'));
    ws.send(JSON.stringify({ t: 'ready' }));
    const welcome = messages.find((m) => m.t === 'welcome');
    const snap = () => messages.findLast((m) => m.t === 'snap');
    const sees = (other) => !!snap()?.players.some((p) => p[0] === other);
    let seq = 0;
    /** Walk with the camera at `yaw` for `ms`, then stand. */
    const walk = async (yaw, ms) => {
      const end = performance.now() + ms;
      while (performance.now() < end) { ws.send(JSON.stringify({ t: 'input', seq: ++seq, input: FORWARD, yaw: quantizeYaw(yaw), pitch: 32768 })); await sleep(16); }
      for (let i = 0; i < 20; i++) { ws.send(JSON.stringify({ t: 'input', seq: ++seq, input: 0, yaw: quantizeYaw(yaw), pitch: 32768 })); await sleep(16); }
      await until(() => snap()?.ack >= seq);
    };
    return { ws, messages, id: welcome.id, welcome, browserId, snap, sees, walk };
  };
  const levelMsgs = (p) => p.messages.filter((m) => m.t === 'level');

  const outside = await join_('Outside');
  const inside = await join_('Inside', 'datacenter');
  await until(() => levelMsgs(inside).length === 1);
  assert.equal(levelMsgs(inside)[0].level, 1);
  assert.equal(levelMsgs(inside)[0].state.level, 1);
  await until(() => inside.snap()?.state.level === 1);
  await sleep(300);
  assert.ok(!outside.sees(inside.id), 'the desert must not see someone in the datacenter');
  assert.ok(!inside.sees(outside.id), 'the datacenter must not see someone in the desert');
  const other = await join_('Other', 'datacenter');
  await until(() => other.snap()?.state.level === 1 && other.sees(inside.id));
  // A drop inside: refused with its notice, and the bag sent back as it is.
  const before = inside.messages.length;
  inside.ws.send(JSON.stringify({ t: 'drop', box: 'bag', slot: 0 }));
  await until(() => inside.messages.slice(before).some((m) => m.t === 'notice'));
  assert.equal(inside.messages.slice(before).find((m) => m.t === 'notice').text, TEXT.notice.cantDropHere);
  await until(() => inside.messages.slice(before).some((m) => m.t === 'items' && m.box === 'bag'));

  // Out by the exit: from the spawn, walk to the steel door (yaw 0 looks down -z) and press F.
  await sleep(1100); // (no second move within a second of one: server/world.ts MOVE_GAP_MS)
  await inside.walk(0, 250);
  inside.ws.send(JSON.stringify({ t: 'enter' }));
  await until(() => levelMsgs(inside).length === 2);
  const out = levelMsgs(inside)[1].state, e = entrance();
  assert.equal(out.level, 0);
  assert.ok(Math.hypot(out.x - e.out.x, out.z - e.out.z) < 1e-3, `came out at ${out.x},${out.z}, not ${e.out.x},${e.out.z}`);
  await until(() => outside.sees(inside.id), 8000);
  // Pressed again at once: nothing (a door's F twice doesn't bounce you back).
  inside.ws.send(JSON.stringify({ t: 'enter' }));
  await sleep(400);
  assert.equal(levelMsgs(inside).length, 2);
  // In again by the desert's door: turn to it, walk up, F.
  await sleep(800);
  await inside.walk(e.out.facing + Math.PI, 150);
  inside.ws.send(JSON.stringify({ t: 'enter' }));
  await until(() => levelMsgs(inside).length === 3);
  assert.equal(levelMsgs(inside)[2].state.level, 1);
  await until(() => inside.snap()?.state.level === 1);
  // The one already in there comes with their whole look again (the client forgot it on the move: src/net.ts teleport).
  const moved = inside.messages.indexOf(levelMsgs(inside)[2]);
  await until(() => inside.messages.slice(moved).some((m) => m.t === 'snap' && m.appearance?.some((a) => a.id === other.id)));
  const stood = inside.snap().state;

  // Gone and back while inside: in the datacenter where they stood, feet on its floor.
  inside.ws.close();
  await sleep(300);
  const back = await join_('Inside', undefined, inside.browserId);
  assert.equal(back.welcome.state.level, 1);
  assert.ok(Math.abs(back.welcome.state.y - stood.y) < 1e-3 && Math.hypot(back.welcome.state.x - stood.x, back.welcome.state.z - stood.z) < 0.05);
  // Two going out together: each gets the other's whole look again after the move.
  await until(() => back.sees(other.id));
  await sleep(1100);
  for (const p of [back, other]) p.ws.send(JSON.stringify({ t: 'debugLevel', key: 'desert' }));
  await until(() => levelMsgs(back).length === 1 && levelMsgs(other).length === 2);
  const after = back.messages.indexOf(levelMsgs(back)[0]);
  await until(() => back.messages.slice(after).some((m) => m.t === 'snap' && m.appearance?.some((a) => a.id === other.id)));
  assert.equal(child.exitCode, null, output);
});
