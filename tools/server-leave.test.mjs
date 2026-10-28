// Real WebSocket regression: a player who leaves is out of the world (not seen, so not hittable) at once, not when
// their socket finally finishes closing or the heartbeat gets round to it.
// Run with: node --test tools/server-leave.test.mjs
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect as tcp } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/protocol.ts';

const HEARTBEAT_MS = 200; // the world drops a socket silent for 4 of these

function message(ws, accept, ms = 5000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); ws.off('message', onMessage); ws.off('close', onClose); };
    const onMessage = (data) => {
      const msg = JSON.parse(String(data));
      if (accept(msg)) { cleanup(); resolve(msg); }
    };
    const onClose = (code) => { cleanup(); reject(new Error(`closed before expected message: ${code}`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('message timeout')); }, ms);
    ws.on('message', onMessage); ws.on('close', onClose);
  });
}

/** A masked client frame (RFC 6455): `opcode` 1 text, 8 close. */
function frame(opcode, payload) {
  const mask = randomBytes(4);
  const body = Buffer.from(payload);
  const head = body.length < 126 ? Buffer.from([0x80 | opcode, 0x80 | body.length]) : Buffer.from([0x80 | opcode, 0x80 | 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([head, mask, body.map((b, i) => b ^ mask[i % 4])]);
}

async function startWorld(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dadajam-leave-'));
  const child = fork(new URL('../server/world.ts', import.meta.url), {
    env: { ...process.env, WORLD_ID: 'leave', DB_PATH: join(dir, 'world.db'), HEARTBEAT_MS: String(HEARTBEAT_MS) },
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  const peers = new Set();
  t.after(async () => {
    for (const p of peers) (p.terminate ?? p.destroy).call(p);
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGTERM'); });
    }
    await rm(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`world startup timeout\n${output}`)), 10000);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`world exited ${code}\n${output}`)); });
    child.on('message', (m) => { if (m.t === 'port') { clearTimeout(timer); resolve(m.port); } });
  });
  const join_ = async (options) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, options);
    peers.add(ws);
    ws.on('error', () => {});
    const welcome = message(ws, (m) => m.t === 'welcome');
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, browserId: randomUUID(), name: 'Tester', spawn: 'pod' })));
    const self = await welcome;
    const ready = message(ws, (m) => m.t === 'snap' && m.players.some((p) => (Array.isArray(p) ? p[0] : p.id) === self.id));
    ws.send(JSON.stringify({ t: 'ready' }));
    await ready;
    return ws;
  };
  return { port, peers, join: join_, output: () => output };
}

test('a player whose close frame came is gone at once, though the TCP close lags', { timeout: 20000 }, async (t) => {
  const world = await startWorld(t);
  const observer = await world.join();
  // A raw peer: says hello and ready, then sends its close frame and never closes the connection (as a proxy or a
  // dying browser may), so ws would sit in CLOSING for its 30 s close timeout.
  const raw = tcp({ port: world.port, host: '127.0.0.1', allowHalfOpen: true }); // the server's end won't end ours
  world.peers.add(raw);
  raw.on('error', () => {});
  raw.on('data', () => {});
  await new Promise((resolve) => raw.once('connect', resolve));
  raw.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  raw.write(frame(1, JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, browserId: randomUUID(), name: 'Leaver', spawn: 'pod' })));
  raw.write(frame(1, JSON.stringify({ t: 'ready' })));
  await message(observer, (m) => m.t === 'snap' && m.players.length === 2, 10000);
  const sent = performance.now();
  raw.write(frame(8, Buffer.from([0x03, 0xe8])));
  await message(observer, (m) => m.t === 'snap' && m.players.length === 1, 2000);
  assert.ok(performance.now() - sent < 2000, world.output());
});

test('a player who goes silent (no pongs, no messages) is dropped within a few heartbeats', { timeout: 20000 }, async (t) => {
  const world = await startWorld(t);
  const observer = await world.join();
  const silent = await world.join({ autoPong: false });
  await message(observer, (m) => m.t === 'snap' && m.players.length === 2);
  const closed = new Promise((resolve) => silent.once('close', resolve));
  await message(observer, (m) => m.t === 'snap' && m.players.length === 1, HEARTBEAT_MS * 10);
  await closed;
  // Answering pings is enough to stay (a hidden tab sends no input, but its browser still answers).
  await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS * 8));
  assert.equal(observer.readyState, WebSocket.OPEN, world.output());
});
