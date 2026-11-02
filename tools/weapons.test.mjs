// The guns against everything that can be shot (shared/rifle.ts GUNS, bites; shared/enemies.ts armor): the walkers',
// the harvester's and the bosses' plate turns every gun but the graviton pistol, which kills anything it touches; a
// guardian's weak point takes two hits (cracked, then broken) but one of the blaster; the blaster's burst hurts the
// thin-skinned things and the weak points round where its beam stopped, never a plated hull. The enemies' servers
// directly, then the blaster through a real world server's 'fire' (server/world.ts onFire).
// Run with: node --test tools/weapons.test.mjs
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { BODY_H, CRAWLER, GUARDIAN, KINDS } from '../shared/guardians.ts';
import { CORE_HP, CORES, harvesterAt, harvesterPose, SPEED, toWorld } from '../shared/harvester.ts';
import { SP_DIE, SP_DROP } from '../shared/queen.ts';
import { BLAST_R, BLASTER, blastDamage, DRONE_HP, GRAVITON, GUARDIAN_POINT_HP, GUNS, HULL_HP, PIERCER, PISTOL, RIFLE } from '../shared/rifle.ts';
import { FORWARD, JUMP, SLIDE, spawnState, step, WALK_SPEED } from '../shared/sim.ts';
import { ORIGIN } from '../shared/origin.ts';
import { PROTOCOL_VERSION } from '../shared/protocol.ts';
import { EYE_HEIGHT } from '../shared/dig.ts';
import { solarFarmsNear } from '../shared/solarfarms.ts';
import { heightAt } from '../shared/terrain.ts';
import { BossServer } from '../server/bosses.ts';
import { GuardianServer } from '../server/guardians.ts';
import { HarvesterServer } from '../server/harvesters.ts';
import { NestServer } from '../server/nests.ts';
import { Tracks } from '../server/tracks.ts';

const rifle = GUNS[RIFLE], pistol = GUNS[PISTOL], blaster = GUNS[BLASTER], graviton = GUNS[GRAVITON], piercer = GUNS[PIERCER];
const dmg = (gun) => (d) => blastDamage(gun, d);
const by = { id: 1, x: ORIGIN.x, y: 0, z: ORIGIN.z, safe: false };
const NOW = 100_000;

/** The first live guardian, and a shot at its body from 40 m off: (x, y, z) to (ex, ey, ez). */
function aimAt(g) {
  const ey = heightAt(g.x, g.z) + BODY_H * KINDS[g.kind].scale;
  return [g.x + 40, ey + 5, g.z, g.x, ey, g.z];
}
const guardianOf = (s) => s.guardians.find((g) => g.kind === GUARDIAN && g.deadAt < 0);

test("a rifle or pistol shot on a guardian's plate does nothing; the graviton pistol's kills it", () => {
  const s = new GuardianServer(), g = guardianOf(s);
  for (const gun of [rifle, pistol, blaster]) {
    const r = s.shoot(by, ...aimAt(g), g.id, -1, NOW, gun);
    assert.equal(r.hit, false, 'turned by the plate');
    assert.equal(r.seen, true, 'but it ended on it');
  }
  assert.equal(g.broken, 0);
  assert.equal(g.deadAt, -1);
  const r = s.shoot(by, ...aimAt(g), g.id, -1, NOW, graviton);
  assert.ok(r.hit && r.kill, 'one body hit of the graviton pistol');
  assert.equal(g.broken, (1 << g.points) - 1, 'every point broken');
});

test("a guardian's weak point takes two rifle hits, cracked in between; one of the blaster", () => {
  const s = new GuardianServer(), g = guardianOf(s);
  const crackedMask = () => s.msg(NOW, 1, g.x, g.z).g[13];
  let r = s.shoot(by, ...aimAt(g), g.id, 0, NOW, rifle);
  assert.ok(r.hit && !r.kill, 'the first hit counts');
  assert.equal(g.broken & 1, 0, 'but the point holds');
  assert.equal(crackedMask(), 1, "cracked, in 'bots'");
  r = s.shoot(by, ...aimAt(g), g.id, 0, NOW, pistol);
  assert.ok(r.hit);
  assert.equal(g.broken & 1, 1, 'the second breaks it');
  assert.equal(crackedMask(), 0, 'broken is no longer cracked');
  assert.equal(s.shoot(by, ...aimAt(g), g.id, 0, NOW, rifle).hit, false, 'a broken point takes no more');
  r = s.shoot(by, ...aimAt(g), g.id, 1, NOW, blaster);
  assert.equal(g.broken & 2, 2, 'one blaster shot breaks one');
  // The rest by the rifle: GUARDIAN_POINT_HP each, the last a kill.
  let kill = null;
  for (let i = 2; i < g.points; i++) for (let k = 0; k < GUARDIAN_POINT_HP; k++) kill = s.shoot(by, ...aimAt(g), g.id, i, NOW, rifle).kill ?? kill;
  assert.ok(kill && g.deadAt >= 0, 'all broken: dead');
});

test("a crawler's flank point still breaks at one rifle hit; a blaster burst in the sand under it kills it", () => {
  const s = new GuardianServer(), p = { ...by, x: ORIGIN.x + 600, z: ORIGIN.z + 600 };
  s.summon('crawlers', p, NOW);
  const [a, b] = s.guardians.filter((g) => g.kind === CRAWLER);
  const r = s.shoot(by, ...aimAt(a), a.id, 0, NOW, rifle);
  assert.ok(r.hit);
  assert.equal(a.broken, 1, 'one hit');
  assert.equal(s.shoot(by, ...aimAt(a), a.id, -1, NOW, rifle).hit, false, 'its plate turns the rifle');
  const burst = s.burst(by, b.x, heightAt(b.x, b.z), b.z, BLAST_R, dmg(blaster), NOW);
  assert.ok(burst.hit);
  assert.ok(b.deadAt >= 0, 'both flanks within the burst: dead');
  assert.ok(burst.kills.length >= 1, 'a kill (with any of its pack close by)');
});

test("a blaster burst at a guardian's knee breaks it, at the rim only cracks it, its hull takes nothing", () => {
  const s = new GuardianServer(), g = guardianOf(s), at = { x: 0, y: 0, z: 0 };
  s.pointAt(g, 0, at);
  // The knee as the server reckons it is up the leg, out from the body.
  const sc = KINDS[GUARDIAN].scale, ground = heightAt(g.x, g.z);
  assert.ok(at.y > ground + 10 * sc && at.y < ground + 40 * sc, `the knee is up the leg (${(at.y - ground).toFixed(1)} m)`);
  assert.ok(Math.hypot(at.x - g.x, at.z - g.z) > 4, 'out from the body');
  let r = s.burst(by, at.x + 3.5, at.y, at.z, BLAST_R, dmg(blaster), NOW);
  assert.ok(r.hit, 'the rim reached it');
  assert.equal(g.broken & 1, 0, 'cracked only');
  assert.equal(s.msg(NOW, 1, g.x, g.z).g[13] & 1, 1);
  r = s.burst(by, at.x, at.y, at.z, BLAST_R, dmg(blaster), NOW);
  assert.equal(g.broken & 1, 1, 'right on it: broken');
  // On its back, far from every point: nothing.
  const top = heightAt(g.x, g.z) + BODY_H * sc + 3;
  const before = g.broken;
  r = s.burst(by, g.x, top, g.z, BLAST_R, dmg(blaster), NOW);
  assert.equal(r.hit, false);
  assert.equal(g.broken, before);
});

test('drones: two rifle or pistol hits bring one down, one of the blaster; a burst beside one downs it', () => {
  const s = new GuardianServer(), p = { ...by, x: ORIGIN.x + 600, z: ORIGIN.z + 600 };
  for (let i = 0; i < 4; i++) s.summon('drone', p, NOW);
  const ds = s.drones.drones;
  assert.equal(ds.length, 4);
  const shot = (d, gun) => s.shootDrone(d.x + 30, d.y, d.z, d.x, d.y, d.z, d.id, NOW, 1, gun);
  for (const [d, gun] of [[ds[0], rifle], [ds[1], pistol]]) {
    assert.ok(shot(d, gun));
    assert.equal(d.downAt, -1, 'one hit holds');
    assert.ok(shot(d, gun));
    assert.ok(d.downAt >= 0, `DRONE_HP (${DRONE_HP}) hits down it`);
  }
  assert.ok(shot(ds[2], blaster));
  assert.ok(ds[2].downAt >= 0, 'one blaster hit');
  const d = ds[3];
  assert.equal(s.drones.burst(d.x + 2, d.y - 3, d.z, BLAST_R, dmg(blaster), NOW, 1), 1);
  assert.ok(d.downAt >= 0, 'a burst beside it');
});

test('a blaster shot into the sand among spiderlings kills those near; the rifle and pistol as before', () => {
  const farm = solarFarmsNear(ORIGIN.x, ORIGIN.z, 8000)[0];
  const n = new NestServer(), v = new Tracks({ k: (dt) => 1 - Math.exp(-dt * 6), jump: 25, onJump: 'keep' });
  const p = { id: 1, x: farm.x + 300, y: farm.y, z: farm.z, safe: false };
  v.update(1000, 0.1, [p]);
  n.tick(0.1, 1000, [p], [p], new Map(), v);
  const lings = n.all[0].lings;
  // Three down on the sand round a spot, one further off.
  const cx = farm.x + 100, cz = farm.z;
  const place = (l, dx, dz) => Object.assign(l, { st: SP_DROP, x: cx + dx, z: cz + dz });
  const near = [place(lings[0], 0.5, 0), place(lings[1], -1.2, 0.8), place(lings[2], 0.3, -1.5)];
  const far = place(lings[3], 9, 0);
  const r = n.burst(cx, heightAt(cx, cz), cz, BLAST_R, dmg(blaster), 2000);
  assert.equal(r.kills.length, 3, 'all three near it');
  assert.ok(near.every((l) => l.st === SP_DIE));
  assert.notEqual(far.st, SP_DIE, 'not one 9 m off');
  // The rifle kills one in one, the pistol in two.
  const a = place(lings[4], 20, 0), b = place(lings[5], 30, 0);
  assert.ok(n.shoot(a.x, heightAt(a.x, a.z), a.z, a.id, 2000, rifle).kill);
  assert.equal(n.shoot(b.x, heightAt(b.x, b.z), b.z, b.id, 2000, pistol).kill, null);
  assert.ok(n.shoot(b.x, heightAt(b.x, b.z), b.z, b.id, 2000, pistol).kill);
});

/** A harvester crawling a straight route, 100 m along it now. */
function harvester() {
  const s = new HarvesterServer(0), pts = [];
  for (let i = 0; i < 40; i++) pts.push(ORIGIN.x + 2000, ORIGIN.z + 2000 + i * 20);
  const start = NOW - (100 / SPEED) * 1000;
  s.harvesters.push({ id: 1, pts, pace: [{ t: start, s: 0, v: SPEED, a: 0, to: SPEED }], start, end: 0, cores: CORES.map(() => 0), charging: false });
  const pose = harvesterPose();
  assert.ok(harvesterAt(s.harvesters[0], NOW, pose));
  return { s, h: s.harvesters[0], pose };
}

test("a blaster burst does not hurt a harvester's hull, only its cores; the graviton pistol kills it through the hull", () => {
  const { s, h, pose } = harvester();
  const hull = { x: pose.x, y: pose.y + 10, z: pose.z };
  for (const gun of [rifle, blaster, piercer]) {
    const r = s.shoot(pose.x + 30, pose.z, hull.x, hull.y, hull.z, h.id, -1, NOW, gun);
    assert.equal(r.hit, false);
    assert.equal(r.seen, true);
  }
  assert.equal(s.burst(hull.x, hull.y, hull.z, BLAST_R, dmg(blaster), NOW).hit, false, 'the burst on its back hurts nothing');
  assert.deepEqual(h.cores, CORES.map(() => 0));
  // In its maw, at a core: that core takes the whole burst.
  const c = toWorld(pose, CORES[0].x, CORES[0].y, CORES[0].z, { x: 0, y: 0, z: 0 });
  assert.ok(s.burst(c.x, c.y, c.z, BLAST_R, dmg(blaster), NOW).hit);
  assert.equal(h.cores[0], blaster.damage);
  assert.ok(h.cores[0] < CORE_HP && !h.down);
  // A hull hit ending off the hull counts for nothing, on it kills.
  assert.equal(s.shoot(pose.x + 30, pose.z, hull.x + 80, hull.y, hull.z, h.id, -1, NOW, graviton).hit, false);
  const r = s.shoot(pose.x + 30, pose.z, hull.x, hull.y, hull.z, h.id, -1, NOW, graviton);
  assert.ok(r.hit && r.kill && h.down);
});

test("the piercer goes through a walker's plate: a guardian's hull in three hits, a crawler's in one, a weak point in one", () => {
  const s = new GuardianServer(), g = guardianOf(s);
  assert.equal(HULL_HP[GUARDIAN] / piercer.damage, 3);
  for (let k = 1; k < 3; k++) {
    const r = s.shoot(by, ...aimAt(g), g.id, -1, NOW, piercer);
    assert.ok(r.hit && !r.kill, `hull hit ${k} bites`);
    assert.equal(g.broken, 0, 'the weak points untouched');
  }
  const r = s.shoot(by, ...aimAt(g), g.id, -1, NOW, piercer);
  assert.ok(r.hit && r.kill && g.deadAt >= 0, 'the third kills it');
  // Another guardian: a weak point breaks at one piercer hit.
  const g2 = guardianOf(s);
  s.shoot(by, ...aimAt(g2), g2.id, 0, NOW, piercer);
  assert.equal(g2.broken & 1, 1);
  // A crawler: one body hit.
  const p = { ...by, x: ORIGIN.x + 600, z: ORIGIN.z + 600 };
  s.summon('crawlers', p, NOW);
  const c = s.guardians.find((o) => o.kind === CRAWLER && o.deadAt < 0);
  const rc = s.shoot(by, ...aimAt(c), c.id, -1, NOW, piercer);
  assert.ok(rc.hit && rc.kill, 'a crawler dies of one');
});

test('the piercer in hand: half speed on foot, no jump, no air jump, no slide', () => {
  const run = (heavy, input, n) => {
    let s = { ...spawnState(), ...(heavy ? { heavy: true } : {}) };
    for (let i = 0; i < n; i++) s = step(s, input, 0);
    return s;
  };
  const light = run(false, FORWARD, 120), heavy = run(true, FORWARD, 120);
  const speed = (s) => Math.hypot(s.vx, s.vz);
  assert.ok(Math.abs(speed(light) - WALK_SPEED) < 0.5, `walks at ${speed(light)}`);
  assert.ok(Math.abs(speed(heavy) - WALK_SPEED / 2) < 0.3, `half speed: ${speed(heavy)}`);
  assert.ok(heavy.heavy, 'step() keeps the flag');
  let s = { ...run(true, FORWARD, 30) };
  const y0 = s.y;
  for (let i = 0; i < 10; i++) s = step(s, FORWARD | JUMP, 0);
  assert.ok(s.grounded && Math.abs(s.y - y0) < 0.6, 'no jump');
  s = run(true, FORWARD, 30);
  for (let i = 0; i < 10; i++) s = step(s, FORWARD | SLIDE, 0);
  assert.equal(s.sliding, false, 'no slide');
  assert.ok(speed(s) <= WALK_SPEED / 2 + 0.3, 'no burst of speed');
  // Without it, the same presses jump and slide.
  s = run(false, FORWARD, 30);
  for (let i = 0; i < 5; i++) s = step(s, FORWARD | JUMP, 0);
  assert.equal(s.grounded, false, 'jumps');
});

test('the graviton pistol kills a boss with one hull hit; nothing else hurts the hull', () => {
  const b = new BossServer(), p = { id: 1, x: ORIGIN.x + 800, y: 0, z: ORIGIN.z, safe: false };
  b.summon('colossus', p, NOW);
  const boss = b.bosses[0], out = { kills: [], craters: [], events: [] };
  const end = [boss.x, boss.y + 2, boss.z];
  const from = [boss.x + 60, boss.y + 10, boss.z];
  for (const gun of [rifle, blaster, piercer]) assert.equal(b.shoot(p, ...from, ...end, boss.id, -1, NOW, out, gun).hit, false);
  const hp = boss.hp;
  assert.equal(boss.hp, hp);
  const r = b.shoot(p, ...from, ...end, boss.id, -1, NOW, out, graviton);
  assert.ok(r.hit && r.kill, 'one hit');
  assert.ok(boss.deadAt >= 0);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(condition, ms = 6000, what = 'condition') {
  const end = performance.now() + ms;
  while (!condition()) { if (performance.now() > end) throw new Error(`${what} timed out`); await sleep(10); }
}

test("through the world server: a blaster shot bursting beside a summoned drone downs it, a 'zap' goes out", { timeout: 60_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'paahde-weapons-'));
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
  const join_ = async (name) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); peers.push(ws);
    const messages = [];
    ws.on('message', (raw) => messages.push(JSON.parse(String(raw))));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, browserId: randomUUID(), name }));
    await until(() => messages.some((m) => m.t === 'welcome'), 6000, 'welcome');
    const id = messages.find((m) => m.t === 'welcome').id;
    ws.send(JSON.stringify({ t: 'ready' }));
    await until(() => messages.findLast((m) => m.t === 'snap')?.players.some((p) => (Array.isArray(p) ? p[0] : p.id) === id), 6000, 'ready');
    return { ws, messages, id };
  };
  const me = await join_('Shooter'), other = await join_('Watcher');
  const send = (m) => me.ws.send(JSON.stringify(m));
  // A working blaster in the bag, in hand.
  send({ t: 'debugGive', kind: BLASTER, tier: 1 });
  await until(() => me.messages.findLast((m) => m.t === 'items' && m.box === 'bag')?.slots?.some((s) => s?.kind === BLASTER), 6000, 'the blaster');
  const bag = () => me.messages.findLast((m) => m.t === 'items' && m.box === 'bag').slots;
  const at = bag().findIndex((s) => s?.kind === BLASTER);
  // Onto the hotbar's first slot (swapped with what was there).
  const seen = me.messages.length;
  send({ t: 'move', from: 'bag', fi: at, to: 'bag', ti: 0 });
  await until(() => me.messages.slice(seen).some((m) => m.t === 'items' && m.box === 'bag' && m.slots[0]?.kind === BLASTER), 6000, 'the blaster on the hotbar');
  send({ t: 'hands', hands: 2, aim: false, slot: 0 });
  send({ t: 'summon', what: 'drone' });
  const drone = () => me.messages.findLast((m) => m.t === 'bots' && m.d.length)?.d;
  await until(() => drone(), 10_000, 'a drone');
  await sleep(300);
  const s = me.messages.findLast((m) => m.t === 'snap').state;
  const [id, x, y, z] = drone();
  // From the eye towards it, stopping 2 m short (a miss, as on a wall beside it), from within its reach.
  const ox = s.x, oy = s.y + EYE_HEIGHT, oz = s.z, len = Math.hypot(x - ox, y - oy, z - oz);
  assert.ok(len < blaster.range, `in reach (${len.toFixed(0)} m)`);
  const k = (len - 2) / len;
  send({ t: 'fire', x: ox, y: oy, z: oz, ex: ox + (x - ox) * k, ey: oy + (y - oy) * k, ez: oz + (z - oz) * k, d: id });
  await until(() => other.messages.some((m) => m.t === 'zap' && m.by === me.id), 6000, "the watcher's 'zap'");
  const zap = other.messages.find((m) => m.t === 'zap');
  assert.equal(zap.gun, BLASTER);
  assert.equal(zap.hit, true);
  await until(() => { const d = drone(); return d && d[0] === id && d[10] > 0; }, 6000, 'the drone downed');

  // A pack of crawlers: a shot into the sand at one, claiming nothing, bursts there and breaks what's near.
  send({ t: 'summon', what: 'crawlers' });
  const crawlers = () => {
    const g = me.messages.findLast((m) => m.t === 'bots' && m.g.some((v, i) => i % 14 === 1 && v === CRAWLER))?.g ?? [];
    const out = [];
    for (let i = 0; i < g.length; i += 14) if (g[i + 1] === CRAWLER) out.push({ id: g[i], x: g[i + 3], z: g[i + 4], broken: g[i + 11], dead: g[i + 12] });
    return out;
  };
  await until(() => crawlers().length > 0, 10_000, 'crawlers');
  await sleep(blaster.cooldown * 2);
  const st = me.messages.findLast((m) => m.t === 'snap').state;
  const c = crawlers().sort((a, b) => Math.hypot(a.x - st.x, a.z - st.z) - Math.hypot(b.x - st.x, b.z - st.z))[0];
  const zaps = other.messages.filter((m) => m.t === 'zap').length;
  // (The lab's floor is flat, level with our feet: its ground, not the desert's heightAt.)
  send({ t: 'fire', x: st.x, y: st.y + EYE_HEIGHT, z: st.z, ex: c.x, ey: st.y, ez: c.z });
  await until(() => other.messages.filter((m) => m.t === 'zap').length > zaps, 6000, 'the second zap');
  assert.equal(other.messages.findLast((m) => m.t === 'zap').hit, true, 'the burst hurt something');
  await until(() => crawlers().some((o) => o.broken || o.dead), 6000, 'a crawler hurt by the burst');

  // The piercer in hand weighs us down (the server's PlayerState.heavy, in the snapshot); another slot, and it's off.
  send({ t: 'debugGive', kind: PIERCER, tier: 1 });
  await until(() => bag().some((s) => s?.kind === PIERCER), 6000, 'the piercer');
  const before = me.messages.length;
  send({ t: 'move', from: 'bag', fi: bag().findIndex((s) => s?.kind === PIERCER), to: 'bag', ti: 1 });
  await until(() => me.messages.slice(before).some((m) => m.t === 'items' && m.box === 'bag' && m.slots[1]?.kind === PIERCER), 6000, 'the piercer on the hotbar');
  const snapState = () => me.messages.findLast((m) => m.t === 'snap').state;
  assert.ok(!snapState().heavy, 'the blaster weighs nothing');
  send({ t: 'hands', hands: 0, aim: false, slot: 1 });
  await until(() => snapState().heavy === true, 6000, 'heavy with the piercer in hand');
  send({ t: 'hands', hands: 0, aim: false, slot: 0 });
  await until(() => !snapState().heavy, 6000, 'light again');
});
