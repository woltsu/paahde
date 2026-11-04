// Synthesised interface sounds, played locally (synths defined here, played by their events ui.plop and ui.full in
// src/audioConfig.ts, which hold their levels):
// - plop: an item picked up or put down in the inventory, or moved between boxes; moving many at once plops
//   once per item in a quick run. A sine that drops from ~520 Hz to 160 Hz over a few tens of ms under a 3 ms
//   attack and a 35 ms decay. Rendered offline (same envelope) at volume 1: one plop peaks at −32 LUFS momentary,
//   −14 dBTP; a run of twelve about −26.
// - full: no room for an item (bag full, doesn't fit). Two soft low bonks, the second a fourth down, each a
//   few odd harmonics (rounded triangle) with a 45 ms decay: −29 LUFS momentary, −16 dBTP; a bit over the plop.
import { defineSynth, play } from './sounds';

/** Each plop of a run is this much quieter, so a long run doesn't stack up loud. */
const RUN_GAIN = 0.7;
/** Seconds between plops in a run, and the most plops a run plays. */
const RUN_GAP = 0.06;
const RUN_MAX = 20;
/** Pitch rises by this ratio per plop of a run. */
const RUN_RISE = 1.03;

const runOf = (arg: number | string | undefined) => Math.max(1, Math.min(RUN_MAX, Math.round(Number(arg) || 1)));

function one(ctx: BaseAudioContext, out: AudioNode, t: number, f0: number, peak: number) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.setTargetAtTime(160, t, 0.025);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.003);
  gain.gain.setTargetAtTime(0, t + 0.003, 0.035);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + 0.25);
  osc.onended = () => gain.disconnect();
}

// arg plops in a quick run, each a little higher; `rate` detunes the whole run.
defineSynth('plop', {
  length: (o) => 0.26 + (runOf(o.arg) - 1) * RUN_GAP,
  voice(ctx, out, t, o) {
    const count = runOf(o.arg);
    for (let k = 0; k < count; k++) one(ctx, out, t + 0.005 + k * RUN_GAP, 520 * o.rate * RUN_RISE ** k, count > 1 ? RUN_GAIN : 1);
  },
});

const waves = new WeakMap<BaseAudioContext, PeriodicWave>();
function bonk(ctx: BaseAudioContext, out: AudioNode, t: number, f: number) {
  let wave = waves.get(ctx);
  if (!wave) waves.set(ctx, (wave = ctx.createPeriodicWave([0, 0, 0, 0, 0, 0], [0, 1, 0, 1 / 9, 0, 1 / 25], { disableNormalization: true })));
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(wave);
  osc.frequency.value = f;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(1, t + 0.004);
  gain.gain.setTargetAtTime(0, t + 0.004, 0.045);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + 0.3);
  osc.onended = () => gain.disconnect();
}

// No room: two soft low bonks, the second a fourth down.
defineSynth('no-room', {
  length: 0.42,
  voice(ctx, out, t) {
    bonk(ctx, out, t + 0.005, 233);
    bonk(ctx, out, t + 0.115, 175);
  },
});

class UiSound {
  /** `n` plops in a quick run (one per item moved). */
  plop(n = 1) {
    if (n >= 1) play('ui.plop', null, null, { arg: n });
  }

  /** No room for it. */
  full() {
    play('ui.full');
  }
}

export const uiSound = new UiSound();
