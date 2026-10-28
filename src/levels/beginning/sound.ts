// The beginning's sound over the datacenter's bed (src/levels/datacenter/ambience.ts): the fall, a low roar and the
// structure groaning that grow with how far you are (the beat, not time: docs/levels/tutorial.md), a jolt's boom; the
// station's chime in the bay corridor, over and over; in the pod going down, the roar all the way up. Synthesised, no
// samples; through the shared ambience bed (src/audio.ts: master gain and limiter), every gain ramped. Levelled offline
// like the datacenter's (docs/audio.md "The beginning's fall"): `?debug` exposes `dbg.fall` (buildFall) to repeat it.
import { audio } from '../../audio.ts';

/** The roar at full (the ride) at volume 1 (× the master slider, 0.4 by default). */
export const ROAR = 0.55;
/** The chime's two notes' peak. */
const CHIME = 0.05;
/** A time constant for every level change (s). */
const EASE = 0.5;

export type Fall = { roar: GainNode; groan: GainNode; boom: (when: number, size: number) => void; chime: (when: number) => void; stop: () => void };

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
  const stop = () => {
    noise.stop();
    gn.stop();
    lfo.stop();
    wander.stop();
    roar.disconnect();
    groan.disconnect();
  };
  return { roar, groan, boom, chime, stop };
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

  /** A jolt (the hall's lights going out). */
  jolt(size = 1) {
    const ctx = audio.ctx;
    if (ctx && this.fall && ctx.state === 'running') this.fall.boom(ctx.currentTime + 0.02, size);
  }
}
