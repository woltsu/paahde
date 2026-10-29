// The beginning's sound over the datacenter's bed (src/levels/datacenter/ambience.ts): the fall, a low roar and the
// structure groaning that grow with how far you are (the beat, not time: docs/levels/tutorial.md), a jolt's boom; the
// station's chime in the bay corridor, over and over; the pod opening (its relay, cover, hatch); in the pod going down,
// the roar all the way up. Synthesised, no
// samples; through the shared ambience bed (src/audio.ts: master gain and limiter), every gain ramped. Levelled offline
// like the datacenter's (docs/audio.md "The beginning's fall"): `?debug` exposes `dbg.fall` (buildFall) to repeat it.
import { audio } from '../../audio.ts';

/** The roar at full (the ride) at volume 1 (× the master slider, 0.4 by default). */
export const ROAR = 0.55;
/** The chime's two notes' peak. */
const CHIME = 0.05;
/** A time constant for every level change (s). */
const EASE = 0.5;

/** The pod opening (src/levels/beginning/pod.ts): each at `when`. */
export type PodCue = 'click' | 'clunk' | 'wake' | 'hiss' | 'thud';
export type Fall = { roar: GainNode; groan: GainNode; boom: (when: number, size: number) => void; chime: (when: number) => void;
  pod: (cue: PodCue, when: number) => void; stop: () => void };
/** The pod's sounds' peaks (docs/audio.md "The beginning's fall"). */
const POD_LEVEL = { click: 0.55, clunk: 1.2, wake: 0.1, hiss: 0.22, servo: 0.12, thud: 1.1 };

/** Brown noise, `seconds` long (it loops under a lowpass). */
function brown(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0, seed = 0x51ab3c7d;
  for (let i = 0; i < n; i++) {
    const w = ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.5;
  }
  return buf;
}

/** The graph on any context (the game's, or an OfflineAudioContext to measure it), into `dest`; silent until set. */
export function buildFall(ctx: BaseAudioContext, dest: AudioNode): Fall {
  const loop = (buf: AudioBuffer) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  };
  // The roar: the hull in the thinning air, low and broad, its level breathing slowly.
  const roar = ctx.createGain();
  roar.gain.value = 0;
  roar.connect(dest);
  const noise = loop(brown(ctx, 7));
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 160;
  const breath = ctx.createGain();
  breath.gain.value = 0.8;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.23;
  const depth = ctx.createGain();
  depth.gain.value = 0.25;
  lfo.connect(depth).connect(breath.gain);
  lfo.start();
  noise.connect(lp).connect(breath).connect(roar);
  // The groan: the frame flexing, a slow band of noise that wanders in pitch.
  const groan = ctx.createGain();
  groan.gain.value = 0;
  groan.connect(dest);
  const gn = loop(brown(ctx, 5));
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 70;
  bp.Q.value = 6;
  const wander = ctx.createOscillator();
  wander.frequency.value = 0.07;
  const wd = ctx.createGain();
  wd.gain.value = 25;
  wander.connect(wd).connect(bp.frequency);
  wander.start();
  gn.connect(bp).connect(groan);
  const hit = brown(ctx, 2);
  /** A jolt: a short low boom (`size` 0..1). */
  const boom = (when: number, size: number) => {
    const s = ctx.createBufferSource();
    s.buffer = hit;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 110;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(0.9 * size, when + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.8);
    s.connect(f).connect(g).connect(dest);
    s.start(when);
    s.stop(when + 2);
  };
  /** The station's chime: two soft notes down a fourth. */
  const chime = (when: number) => {
    for (const [f, at] of [[880, 0], [659.3, 0.42]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when + at);
      g.gain.linearRampToValueAtTime(CHIME, when + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + at + 1.1);
      o.connect(g).connect(dest);
      o.start(when + at);
      o.stop(when + at + 1.2);
    }
  };
  const white = (() => {
    const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let seed = 0x2f6b1a93;
    for (let i = 0; i < n; i++) d[i] = ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    return buf;
  })();
  /** A burst of `buf` through a filter, its gain shaped attack, then decay (s). */
  const burst = (buf: AudioBuffer, when: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    s.connect(f).connect(g).connect(dest);
    s.start(when);
    s.stop(when + attack + decay + 0.05);
    return f;
  };
  /** A tone gliding `f0` to `f1`, shaped as a burst. */
  const tone = (when: number, type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(f1, when + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    o.connect(g).connect(dest);
    o.start(when);
    o.stop(when + attack + decay + 0.05);
  };
  /** The pod opening: the relay clicking home, the cover shutting, the pod waking (a chirp up), the seal's hiss with the
   *  hatch's motor under it, the hatch coming down on its stops. */
  const pod = (cue: PodCue, when: number) => {
    const L = POD_LEVEL;
    if (cue === 'click') {
      burst(white, when, 'highpass', 2500, 0.7, L.click, 0.002, 0.04);
      tone(when, 'triangle', 1900, 1500, L.click * 0.3, 0.002, 0.06);
    } else if (cue === 'clunk') {
      burst(hit, when, 'lowpass', 420, 0.8, L.clunk, 0.004, 0.22);
      tone(when, 'sine', 150, 80, L.clunk * 0.5, 0.004, 0.18);
      burst(white, when + 0.01, 'bandpass', 1800, 2, L.click * 0.5, 0.002, 0.05);
    } else if (cue === 'wake') {
      tone(when, 'sine', 420, 880, L.wake, 0.03, 0.3);
      tone(when + 0.16, 'sine', 660, 1320, L.wake * 0.8, 0.03, 0.4);
    } else if (cue === 'hiss') {
      const f = burst(white, when, 'bandpass', 4200, 0.9, L.hiss, 0.03, 1.3);
      f.frequency.setValueAtTime(5200, when);
      f.frequency.exponentialRampToValueAtTime(2400, when + 1.3);
      // The hatch's motor, all the way down (pod.ts HATCH).
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(70, when + 0.08);
      o.frequency.linearRampToValueAtTime(95, when + 0.8);
      o.frequency.linearRampToValueAtTime(60, when + 1.55);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when + 0.08);
      g.gain.linearRampToValueAtTime(L.servo, when + 0.35);
      g.gain.setValueAtTime(L.servo, when + 1.3);
      g.gain.linearRampToValueAtTime(0.0001, when + 1.6);
      o.connect(lp).connect(g).connect(dest);
      o.start(when + 0.08);
      o.stop(when + 1.7);
    } else {
      burst(hit, when, 'lowpass', 260, 0.7, L.thud, 0.005, 0.5);
      burst(white, when, 'bandpass', 900, 1.5, L.click * 0.4, 0.003, 0.12);
    }
  };
  const stop = () => {
    noise.stop();
    gn.stop();
    lfo.stop();
    wander.stop();
    roar.disconnect();
    groan.disconnect();
  };
  return { roar, groan, boom, chime, pod, stop };
}

/** The fall in the game: built on entering, faded by `set`, stopped once faded out after leaving. */
export class FallSound {
  private fall: Fall | null = null;
  private on = false;
  private chimeIn = 2;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;

  start() {
    this.on = true;
    clearTimeout(this.stopTimer);
    audio.onStart((ctx) => {
      if (audio.ambience) this.fall ??= buildFall(ctx, audio.ambience);
    });
  }

  stop() {
    this.on = false;
    const ctx = audio.ctx, f = this.fall;
    if (f && ctx) {
      f.roar.gain.setTargetAtTime(0, ctx.currentTime, EASE);
      f.groan.gain.setTargetAtTime(0, ctx.currentTime, EASE);
    }
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => {
      if (this.on || !this.fall) return;
      this.fall.stop();
      this.fall = null;
    }, EASE * 6000);
  }

  /** `rumble` 0..1 (the beat, the ride); `chiming`: in the bay corridor. */
  update(dt: number, rumble: number, chiming: boolean) {
    const ctx = audio.ctx, f = this.fall;
    if (!ctx || !f || !this.on || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    f.roar.gain.setTargetAtTime(ROAR * rumble * rumble, now, EASE);
    f.groan.gain.setTargetAtTime(ROAR * 0.6 * rumble, now, EASE);
    if (chiming && (this.chimeIn -= dt) <= 0) {
      this.chimeIn = 5;
      f.chime(now + 0.05);
    }
  }

  /** The pod opening (src/levels/beginning/pod.ts). */
  pod(cue: PodCue) {
    const ctx = audio.ctx;
    if (ctx && this.fall && ctx.state === 'running') this.fall.pod(cue, ctx.currentTime + 0.01);
  }

  /** A jolt (the hall's lights going out). */
  jolt(size = 1) {
    const ctx = audio.ctx;
    if (ctx && this.fall && ctx.state === 'running') this.fall.boom(ctx.currentTime + 0.02, size);
  }
}
