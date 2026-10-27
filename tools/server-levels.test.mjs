// Levels on the real world server (docs/levels.md): ?spawn=datacenter moves a player in once loaded, through the same
// move as a door ('level'); someone in the desert no longer sees them in snapshots (interest by level) and they see
// only each other; a drop inside is refused; the debug menu's way out brings them back to the desert.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/protocol.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(condition, ms = 5000) {
  const end = performance.now() + ms;
  while (!condition()) { if (performance.now() > end) throw new Error('condition timed out'); await sleep(10); }
}

test('a level: moved in on ready, seen only by those in it, refused drops, moved back out', { timeout: 30_000 }, async (t) => {
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
  const join_ = async (name, spawn) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); peers.push(ws);
    const messages = [];
    ws.on('message', (raw) => messages.push(JSON.parse(String(raw))));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, browserId: randomUUID(), name, ...(spawn ? { spawn } : {}) }));
    await until(() => messages.some((m) => m.t === 'welcome'));
    ws.send(JSON.stringify({ t: 'ready' }));
    const id = messages.find((m) => m.t === 'welcome').id;
    const snap = () => messages.findLast((m) => m.t === 'snap');
    const sees = (other) => !!snap()?.players.some((p) => p[0] === other);
    return { ws, messages, id, snap, sees };
  };
  const outside = await join_('Outside');
  const inside = await join_('Inside', 'datacenter');
  await until(() => inside.messages.some((m) => m.t === 'level'));
  const moved = inside.messages.find((m) => m.t === 'level');
  assert.equal(moved.level, 1);
  assert.equal(moved.state.level, 1);
  await until(() => inside.snap()?.state.level === 1);
  await sleep(300);
  assert.ok(!outside.sees(inside.id), 'the desert must not see someone in the datacenter');
  assert.ok(!inside.sees(outside.id), 'the datacenter must not see someone in the desert');
  // A second one in there sees the first.
  const other = await join_('Other', 'datacenter');
  await until(() => other.snap()?.state.level === 1 && other.sees(inside.id));
  // Drops are refused inside (the things lying about are the desert's).
  inside.ws.send(JSON.stringify({ t: 'drop', box: 'bag', slot: 0 }));
  await until(() => inside.messages.some((m) => m.t === 'notice'));
  // Out again, the debug menu's way: back in the desert, seen from outside.
  inside.ws.send(JSON.stringify({ t: 'debugLevel', key: 'desert' }));
  await until(() => inside.messages.filter((m) => m.t === 'level').length === 2);
  await until(() => inside.snap()?.state.level === 0);
  await until(() => outside.sees(inside.id), 8000);
  assert.equal(child.exitCode, null, output);
});
