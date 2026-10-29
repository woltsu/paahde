// A newcomer's first minutes in the desert (shared/water.ts arrivalEase, server/water.ts tickHeat): landed by the pod
// at noon and standing in full sun, they get hot (the meter climbs past the glow) but don't die of it within five
// minutes; someone long here in the same spot does within about a minute; the ease is over after ARRIVAL_EASE_S and
// never slows cooling off; and the pod's own shadow, a step from the hatch, cools you off at noon.
import assert from 'node:assert/strict';
import test from 'node:test';

const { newHeat, tickHeat } = await import('../server/water.ts');
const { spawnPoint, spawnState } = await import('../shared/sim.ts');
const { sunOnBody } = await import('../shared/shade.ts');
const { ARRIVAL_EASE_S, HEAT_HIGH, HEAT_MAX } = await import('../shared/water.ts');

const NOON = 0.5;
const DT = 0.05;
const around = { casters: [], self: -1 };

/** Stand at `s` from wall-clock `t0` (ms) for `seconds` at time of day `tod`: when they died (s), or null; the peak. */
function stand(heat, s, tod, t0, seconds) {
  let peak = heat.heat;
  for (let i = 1; i <= seconds / DT; i++) {
    if (tickHeat(heat, DT, s, 0, tod, 0, t0 + i * DT * 1000, around) === 'died') return { died: i * DT, peak };
    peak = Math.max(peak, heat.heat);
  }
  return { died: null, peak };
}

const pod = spawnPoint(0);
const atHatch = spawnState(pod.x, pod.z);

test('the hatch is in the sun at noon (this test means something)', () => {
  assert.ok(sunOnBody(atHatch.x, atHatch.y, atHatch.z, false, NOON, [], -1) > 0.9);
});

test('freshly landed at noon in full sun: hot, but alive after five minutes', () => {
  const t0 = 1_000_000_000_000;
  const heat = newHeat();
  heat.arrivedAt = t0;
  const r = stand(heat, atHatch, NOON, t0, 5 * 60);
  assert.equal(r.died, null, `died ${r.died} s after landing`);
  assert.ok(r.peak > HEAT_HIGH, `never got really hot (${r.peak.toFixed(1)}): the heat should still be felt`);
});

test('long here, the same noon kills within about a minute', () => {
  const t0 = 1_000_000_000_000;
  const r = stand(newHeat(), atHatch, NOON, t0, 5 * 60);
  assert.ok(r.died !== null && r.died < 90, `died after ${r.died} s`);
});

test('the ease is over after ARRIVAL_EASE_S: full noon again', () => {
  const t0 = 1_000_000_000_000;
  const heat = newHeat();
  heat.arrivedAt = t0 - ARRIVAL_EASE_S * 1000;
  const r = stand(heat, atHatch, NOON, t0, 5 * 60);
  assert.ok(r.died !== null && r.died < 90, `died after ${r.died} s`);
});

test('the ease never slows cooling off, and the pod shades a step from its hatch', () => {
  // Find shade within a few metres of the hatch at noon (the pod's shadow).
  let shady = null;
  for (let r = 1; r <= 5 && !shady; r += 0.5) {
    for (let a = 0; a < 16 && !shady; a++) {
      const s = spawnState(pod.x + Math.cos((a * Math.PI) / 8) * r, pod.z + Math.sin((a * Math.PI) / 8) * r);
      if (sunOnBody(s.x, s.y, s.z, false, NOON, [], -1) < 0.1) shady = s;
    }
  }
  assert.ok(shady, 'no shade within 5 m of the hatch at noon');
  const t0 = 1_000_000_000_000;
  const eased = newHeat(HEAT_MAX * 0.8), plain = newHeat(HEAT_MAX * 0.8);
  eased.arrivedAt = t0;
  stand(eased, shady, NOON, t0, 20);
  stand(plain, shady, NOON, t0, 20);
  assert.ok(eased.heat < HEAT_MAX * 0.8 - 20, `didn't cool off in the pod's shade (${eased.heat.toFixed(1)})`);
  assert.equal(eased.heat, plain.heat);
});
