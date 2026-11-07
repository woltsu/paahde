// The runners (shared/runner.ts, server/runners.ts): one comes for someone out in the open, stalks them, then charges
// and bites (or, armed, shoots from afar); a late step aside makes it miss; its eyes or both flank vents kill it, its
// hull's plate turns the rifle.
// Run with: node --test tools/runner.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { ORIGIN } from '../shared/origin.ts';
import { heightAt } from '../shared/terrain.ts';
import { lineOfSight } from '../shared/guardians.ts';
import { GUNS, PIERCER, RIFLE } from '../shared/rifle.ts';
import {
  JAW_REACH, R_CHARGE, R_DEAD, R_LEAVE, R_RECOVER, R_STALK, RP_EYES, RP_VENT_L, RP_VENT_R, RUNNER_BODY_Y, RUNNER_POINTS,
  RUNNER_STRIDE,
} from '../shared/runner.ts';
import { BOT_DELAY_MS } from '../shared/guardians.ts';
import { KEEP_OUT, RunnerServer } from '../server/runners.ts';
import { Tracks } from '../server/tracks.ts';

/** A flat open spot out in the desert, with a clear view 60 m round it. */
function flatSpot() {
  for (let i = 0; i < 400; i++) {
    const a = i * 2.39996, d = 600 + i * 7;
    const x = ORIGIN.x + Math.sin(a) * d, z = ORIGIN.z + Math.cos(a) * d, y = heightAt(x, z);
    let ok = true;
    for (let k = 0; k < 16 && ok; k++) {
      const b = (k / 16) * Math.PI * 2;
      for (const r of [20, 40, 60]) {
        const px = x + Math.sin(b) * r, pz = z + Math.cos(b) * r;
        if (Math.abs(heightAt(px, pz) - y) > 2 || !lineOfSight(px, heightAt(px, pz) + 2.4, pz, x, y + 1.1, z)) ok = false;
      }
    }
    if (ok) return { x, y, z };
  }
  throw new Error('no flat spot');
}
const spot = flatSpot();
const player = () => ({ id: 1, x: spot.x, y: spot.y, z: spot.z, safe: false });
const vel = () => new Tracks({ k: (dt) => 1 - Math.exp(-dt * 6), jump: 25, onJump: 'keep' });

/** Ticks at 10 Hz for `s` seconds (`step(p, r, t)` each tick first, stopping when it returns true); returns the bites,
 *  the bolts fired. */
function run(rs, ps, clock, s, step = () => false) {
  const v = vel();
  let bites = 0, bolts = 0;
  for (let i = 0; i < s * 10; i++) {
    clock.now += 100;
    if (step(clock.now)) break;
    for (const p of ps) p.y = heightAt(p.x, p.z);
    v.update(clock.now, 0.1, ps);
    const mauled = [];
    rs.tick(0.1, clock.now, ps, [], v, mauled, () => bolts++);
    bites += mauled.length;
  }
  return { bites, bolts };
}

/** Where a runner's weak point i is now (as the server reckons it; as drawn once it has stood still a moment). */
function pointOf(r, i) {
  const q = RUNNER_POINTS[i], c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  return { x: r.x + q.x * c + q.z * s, y: heightAt(r.x, r.z) + RUNNER_BODY_Y + q.y, z: r.z - q.x * s + q.z * c };
}

test('a plain runner stalks someone standing in the open, then charges and bites them', () => {
  const rs = new RunnerServer(1e12), clock = { now: 1000 }, p = player();
  rs.summon('plain', p, clock.now);
  const r = rs.runners[0];
  let stalked = false, charged = false;
  const { bites } = run(rs, [p], clock, 40, () => {
    stalked ||= r.st === R_STALK;
    charged ||= r.st === R_CHARGE;
    return false;
  });
  assert.ok(stalked && charged, 'it stalked and charged');
  assert.ok(bites > 0, 'and bit them');
  assert.ok(r.snapAt > 0, 'its jaws snapped (sent to clients)');
});

test('stepping aside as its jaws come (as drawn) makes it miss and overshoot', () => {
  let dodged = 0;
  for (let k = 0; k < 6; k++) {
    const rs = new RunnerServer(1e12), clock = { now: 1000 }, p = player();
    rs.summon('plain', p, clock.now);
    const r = rs.runners[0];
    let side = null, missed = false, bit = false;
    // Wait for a charge to get going, then dodge when the drawn jaws are 6 m off, at a run (7.5 m/s), for 0.8 s.
    const hist = [];
    let dodgeUntil = 0;
    const res = run(rs, [p], clock, 40, (now) => {
      hist.push([now, r.x, r.z, r.yaw]);
      const drawn = hist.find((h) => h[0] >= now - BOT_DELAY_MS) ?? hist[0];
      const jx = drawn[1] + Math.sin(drawn[3]) * JAW_REACH, jz = drawn[2] + Math.cos(drawn[3]) * JAW_REACH;
      if (r.st === R_CHARGE && side === null && Math.hypot(jx - p.x, jz - p.z) < 6) {
        side = [Math.cos(r.yaw), -Math.sin(r.yaw)];
        dodgeUntil = now + 800;
      }
      if (side && now < dodgeUntil) {
        p.x += side[0] * 0.75;
        p.z += side[1] * 0.75;
      }
      if (side && r.st === R_RECOVER) {
        missed = r.snapAt === 0;
        bit = r.snapAt > 0;
        return true;
      }
      return false;
    });
    if (side && missed && !bit && res.bites === 0) dodged++;
  }
  assert.ok(dodged >= 5, `a late sidestep dodges the charge (${dodged} of 6)`);
});

test('its eyes (from the front) or both flank vents kill it; the rifle bounces off its plate, the piercer goes through', () => {
  const rifle = GUNS[RIFLE], piercer = GUNS[PIERCER];
  const by = player();
  const fresh = () => {
    const rs = new RunnerServer(1e12), clock = { now: 1000 };
    rs.spawn('plain', by, clock.now, 40);
    run(rs, [{ ...by, safe: true }], clock, 1);
    return { rs, r: rs.runners[0], now: clock.now };
  };
  {
    const { rs, r, now } = fresh();
    const e = pointOf(r, RP_EYES);
    assert.equal(rs.shoot(by, e.x, e.y, e.z, r.id, RP_EYES, now, rifle).kill, null);
    assert.equal(rs.shoot(by, e.x, e.y, e.z, r.id, RP_EYES, now, rifle).kill, null);
    const k = rs.shoot(by, e.x, e.y, e.z, r.id, RP_EYES, now, rifle).kill;
    assert.ok(k, 'three rifle hits in the eyes');
    assert.equal(r.st, R_DEAD);
    assert.equal(rs.shoot(by, e.x, e.y, e.z, r.id, RP_EYES, now, rifle).hit, false, 'dead is dead');
  }
  {
    const { rs, r, now } = fresh();
    const a = pointOf(r, RP_VENT_L), b = pointOf(r, RP_VENT_R);
    for (let i = 0; i < 2; i++) assert.equal(rs.shoot(by, a.x, a.y, a.z, r.id, RP_VENT_L, now, rifle).kill, null);
    assert.equal(rs.shoot(by, b.x, b.y, b.z, r.id, RP_VENT_R, now, rifle).kill, null, 'one vent out: still alive');
    assert.ok(rs.shoot(by, b.x, b.y, b.z, r.id, RP_VENT_R, now, rifle).kill, 'both vents out');
  }
  {
    const { rs, r, now } = fresh();
    const e = pointOf(r, RP_EYES);
    assert.equal(rs.shoot(by, e.x + 10, e.y, e.z + 10, r.id, RP_EYES, now, rifle).hit, false, 'a shot that ended nowhere near');
    const h = { x: r.x, y: heightAt(r.x, r.z) + RUNNER_BODY_Y, z: r.z };
    const plate = rs.shoot(by, h.x, h.y, h.z, r.id, -1, now, rifle);
    assert.equal(plate.hit, false);
    assert.equal(plate.seen, true, 'the rifle rang off its plate');
    let kill = null;
    for (let i = 0; i < 3 && !kill; i++) kill = rs.shoot(by, h.x, h.y, h.z, r.id, -1, now, piercer).kill;
    assert.ok(kill, 'three piercer slugs through its hull');
  }
});

test('the armed one keeps its distance and shoots; it gives up on someone gone indoors', () => {
  const rs = new RunnerServer(1e12), clock = { now: 1000 }, p = player();
  rs.summon('armed', p, clock.now);
  const r = rs.runners[0];
  let closest = Infinity;
  const { bolts, bites } = run(rs, [p], clock, 30, () => {
    if (clock.now > 6000) closest = Math.min(closest, Math.hypot(r.x - p.x, r.z - p.z));
    return false;
  });
  assert.ok(bolts > 0, `it fired (${bolts})`);
  assert.equal(bites, 0, 'and never came in to bite someone standing still');
  assert.ok(closest > 20, `it kept off (${closest.toFixed(1)} m at the closest)`);
  // Safe (as indoors or just respawned): it loses them and leaves.
  const hidden = { ...p, safe: true };
  run(rs, [hidden], clock, 12);
  assert.equal(r.st, R_LEAVE, 'it gave up');
  assert.equal(r.prey, -1);
});

test('they come for someone out in the open, never at the start, and go when nobody is about', () => {
  const rs = new RunnerServer(0), clock = { now: 1000 };
  const home = { id: 2, x: ORIGIN.x, y: heightAt(ORIGIN.x, ORIGIN.z), z: ORIGIN.z, safe: false };
  run(rs, [home], clock, 60 * 15);
  assert.equal(rs.runners.length, 0, 'none for someone by the start');
  const out = player();
  assert.ok(Math.hypot(out.x - ORIGIN.x, out.z - ORIGIN.z) > KEEP_OUT);
  run(rs, [out], clock, 60 * 12, () => rs.runners.length > 0);
  assert.equal(rs.runners.length, 1, 'one came for someone out in the open');
  const r = rs.runners[0], d = Math.hypot(r.x - out.x, r.z - out.z);
  assert.ok(d > 150 && d < 320, `from some way off (${d.toFixed(0)} m)`);
  const msg = rs.msg(clock.now, out.id, out.x, out.z);
  assert.equal(msg.length, RUNNER_STRIDE, 'sent to them');
  run(rs, [home], clock, 1);
  assert.equal(rs.runners.length, 0, 'gone with nobody near');
});
