// The radio towers' sounds (shared/towers.ts, docs/radiotowers.md), synthesised, through the shared output (src/audio.ts:
// master gain and limiter):
// - the wind in the lattice, at any tower: a low hollow moan through the bracing and a thin whistle off the cables, two
//   resonant noise bands sliding with the wind (shared/power.ts windSpeed), louder the higher you are on it and gone a
//   little way off;
// - a live one's cabinet: a faint mains hum at its foot;
// - a live one's radio: someone muttering through static, never quite words. Noise and a buzzy voice through two
//   formant filters that jump syllable by syllable, in phrases with pauses between and a tone now and then, then a
//   telephone band and a little clipping. Heard from the cabinet, and from the decks' junction boxes; and through a
//   receiver or jammer in your hand anywhere within DEVICE_R of a live tower, head-locked, the static thicker the
//   further off and the worse the tower's parts.
//
// Levels (measured offline: radioGraph rendered in headless Chrome's OfflineAudioContext at the default volume, ffmpeg
// ebur128): the muttering at REF −31 LUFS integrated, about speech heard across a room (the static adds under 1 LU);
// the lattice's wind −32 LUFS at the top in full wind (14 m/s), a quarter of that in a fresh breeze; true peak
// ≤ −18 dBTP.
import { audio } from './audio';
import { CABINET, DECKS, LAMP_Y, TOWER, towersNear, towerToWorld, type Tower } from '../shared/towers.ts';

type P = { x: number; y: number; z: number };

/** The muttering: full within REF (m) of where it comes from, 1/d past it, silent past HEAR. */
const REF = 3;
const HEAR = 40;
/** Through a receiver or jammer: any live tower within this (m). */
export const DEVICE_R = 1000;
/** The lattice's wind: heard within this of the tower's axis (m). */
const WIND_R = 45;
/** Levels: the voice, the static under it (at its thinnest and its thickest), the hum, the lattice's wind at full. */
const VOICE = 0.5;
const STATIC_MIN = 0.05, STATIC_MAX = 0.35;
const HUM = 0.05;
export const LATTICE = 0.22;
/** The radio's own level, after its clipping: sets where it sits in the mix (measured, above). */
const RADIO = 0.2;

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

const gainOf = (ctx: BaseAudioContext, v: number) => {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
};
const filter = (ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.7) => {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
};
function looped(ctx: BaseAudioContext, stop: (() => void)[], offset: number) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  src.start(ctx.currentTime, offset);
  stop.push(() => src.stop());
  return src;
}

/** A radio's sound graph into `out`: the voice (silent until `mutter` schedules it) and the static (`hiss`). */
export type Radio = {
  out: GainNode; hiss: GainNode; env: GainNode; f1: BiquadFilterNode; f2: BiquadFilterNode; pitch: OscillatorNode;
  beep: GainNode; stop: (() => void)[];
  /** Scheduled up to (the context's time). */
  until: number;
};

export function radioGraph(ctx: BaseAudioContext, out: AudioNode): Radio {
  const stop: (() => void)[] = [];
  const master = gainOf(ctx, 1);
  master.connect(gainOf(ctx, RADIO)).connect(out);
  // The radio's band: a telephone's, and a soft clip for the cheap speaker.
  const band = filter(ctx, 'highpass', 320, 0.8);
  const top = filter(ctx, 'lowpass', 2900, 0.9);
  const clip = ctx.createWaveShaper();
  const curve = new Float32Array(257);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / 128 - 1) * 2.2;
    curve[i] = Math.tanh(x) / Math.tanh(2.2);
  }
  clip.curve = curve;
  band.connect(top).connect(clip).connect(master);
  // The voice: a buzzy fold (a sawtooth with breath in it) through two formants, under a syllable envelope.
  const pitch = ctx.createOscillator();
  pitch.type = 'sawtooth';
  pitch.frequency.value = 125;
  pitch.start();
  stop.push(() => pitch.stop());
  const breath = looped(ctx, stop, 0.9);
  const src = gainOf(ctx, 1);
  pitch.connect(gainOf(ctx, 0.35)).connect(src);
  breath.connect(gainOf(ctx, 0.25)).connect(src);
  const f1 = filter(ctx, 'bandpass', 600, 5), f2 = filter(ctx, 'bandpass', 1500, 7);
  const env = gainOf(ctx, 0);
  src.connect(f1).connect(gainOf(ctx, 1)).connect(env);
  src.connect(f2).connect(gainOf(ctx, 0.7)).connect(env);
  env.connect(gainOf(ctx, VOICE * 3)).connect(band);
  // The static: hiss over the band, crackling (a fast, uneven waver).
  const hissSrc = looped(ctx, stop, 0.2);
  const hiss = gainOf(ctx, STATIC_MIN);
  const crackle = gainOf(ctx, 0.7);
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 13.7;
  lfo.start();
  stop.push(() => lfo.stop());
  lfo.connect(gainOf(ctx, 0.3)).connect(crackle.gain);
  hissSrc.connect(filter(ctx, 'bandpass', 2200, 0.5)).connect(crackle).connect(hiss).connect(master);
  // A tone now and then, as off an old beacon.
  const tone = ctx.createOscillator();
  tone.frequency.value = 1020;
  tone.start();
  stop.push(() => tone.stop());
  const beep = gainOf(ctx, 0);
  tone.connect(beep).connect(band);
  return { out: master, hiss, env, f1, f2, pitch, beep, stop, until: ctx.currentTime };
}

/** Schedule the muttering on `r` from its `until` on to past `to` (the context's time): phrases of syllables with
 *  pauses between, now and then a tone. `rand`: 0..1. */
export function mutter(r: Radio, to: number, rand: () => number) {
  let t = Math.max(r.until, 0);
  while (t < to) {
    if (rand() < 0.12) {
      // A tone or two, then quiet.
      for (let k = 0, n = 1 + Math.floor(rand() * 3); k < n; k++) {
        r.beep.gain.setTargetAtTime(0.12, t, 0.005);
        r.beep.gain.setTargetAtTime(0, t + 0.22, 0.01);
        t += 0.45;
      }
      t += 0.8 + rand() * 1.5;
      continue;
    }
    // A phrase: its pitch drifts and falls at the end.
    const n = 3 + Math.floor(rand() * 8), base = 105 + rand() * 45;
    for (let k = 0; k < n; k++) {
      const len = 0.08 + rand() * 0.16, last = k === n - 1;
      r.f1.frequency.setTargetAtTime(330 + rand() * 520, t, 0.02);
      r.f2.frequency.setTargetAtTime(950 + rand() * 1400, t, 0.025);
      r.pitch.frequency.setTargetAtTime(base * (last ? 0.82 : 0.95 + rand() * 0.15), t, 0.05);
      const peak = 0.55 + rand() * 0.45;
      r.env.gain.setTargetAtTime(peak, t, 0.012);
      r.env.gain.setTargetAtTime(rand() < 0.3 ? 0 : peak * 0.25, t + len * 0.7, 0.025);
      t += len + (rand() < 0.15 ? 0.06 : 0);
    }
    r.env.gain.setTargetAtTime(0, t, 0.03);
    t += 0.35 + rand() * (rand() < 0.2 ? 3 : 1.4);
  }
  r.until = t;
}

/** The wind in the lattice: a moan and a whistle, two resonant bands; `level` and `wind` (m/s) set in update. */
type Lattice = { out: GainNode; moan: BiquadFilterNode; whistle: BiquadFilterNode; stop: (() => void)[] };
export function latticeGraph(ctx: BaseAudioContext, out: AudioNode): Lattice {
  const stop: (() => void)[] = [];
  const g = gainOf(ctx, 0);
  g.connect(out);
  const src = looped(ctx, stop, 1.7);
  const moan = filter(ctx, 'bandpass', 180, 14), whistle = filter(ctx, 'bandpass', 1900, 22);
  // Gusts: the moan swells and sinks slowly.
  const swell = gainOf(ctx, 0.6), lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  lfo.start();
  stop.push(() => lfo.stop());
  lfo.connect(gainOf(ctx, 0.4)).connect(swell.gain);
  src.connect(moan).connect(gainOf(ctx, 3)).connect(swell).connect(g);
  src.connect(whistle).connect(gainOf(ctx, 1.2)).connect(g);
  return { out: g, moan, whistle, stop };
}

const panAt = (ctx: BaseAudioContext, at: P) => {
  const p = ctx.createPanner();
  p.panningModel = 'equalpower';
  p.distanceModel = 'linear';
  p.rolloffFactor = 0; // the level is ours (gain); the panner only places it
  p.positionX.value = at.x;
  p.positionY.value = at.y;
  p.positionZ.value = at.z;
  return p;
};

/** Where a live tower's radio is heard from: its cabinet, and the two decks' junction boxes. */
function speakers(t: Tower): P[] {
  const [cx, cz] = towerToWorld(t, CABINET.at, 0);
  const [dx, dz] = towerToWorld(t, -2.6, 0);
  return [
    { x: t.x + cx, y: t.y + 1.5, z: t.z + cz },
    { x: t.x + dx, y: t.y + DECKS[1] + 1.2, z: t.z + dz },
    { x: t.x + dx, y: t.y + TOWER.height + 1.2, z: t.z + dz },
  ];
}

class TowerSound {
  /** A live tower's radio is heard now (its speakers near, or through what's in hand). */
  hearing = false;
  private radio: (Radio & { pan: PannerNode; id: number }) | null = null;
  private device: Radio | null = null;
  private lattice: (Lattice & { id: number }) | null = null;
  private hum: { g: GainNode; pan: PannerNode; stop: (() => void)[]; id: number } | null = null;
  private seed = 1;
  private rand = () => ((this.seed = (Math.imul(this.seed ^ (this.seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);

  /**
   * Every frame. `ear`: the listener; `alive`: the live towers' ids; `device`: a receiver or jammer is in hand; `wind`:
   * the wind's speed (m/s); `clarity`: how well the nearest live tower hears, 0 (Scrap parts) .. 1 (Space-grade);
   * `on`: the desert's things are where we are (no towers in a level).
   */
  update(ear: P, alive: ReadonlySet<number>, device: boolean, wind: number, clarity: (id: number) => number, on: boolean) {
    const ctx = audio.ctx, out = audio.out;
    if (!ctx || !out || !audio.running) return;
    const near = on ? towersNear(ear.x, ear.z, DEVICE_R) : [];
    const d2 = (t: Tower) => (t.x - ear.x) ** 2 + (t.z - ear.z) ** 2;
    near.sort((a, b) => d2(a) - d2(b));
    const now = ctx.currentTime;
    // The lattice's wind at the nearest tower, if close.
    const t0 = near[0] && d2(near[0]) < WIND_R * WIND_R ? near[0] : null;
    if (this.lattice && this.lattice.id !== t0?.id) this.drop(this.lattice, this.lattice.out), (this.lattice = null);
    if (t0 && !this.lattice) this.lattice = { ...latticeGraph(ctx, out), id: t0.id };
    if (t0 && this.lattice) {
      const up = Math.max(0, Math.min(1, (ear.y - t0.y) / LAMP_Y)), w = Math.min(1, wind / 14);
      const edge = Math.max(0, Math.min(1, (WIND_R - Math.sqrt(d2(t0))) / 15));
      this.lattice.out.gain.setTargetAtTime(LATTICE * edge * w * w * (0.35 + 0.65 * up), now, 0.4);
      this.lattice.moan.frequency.setTargetAtTime(140 + 90 * w + 40 * up, now, 0.8);
      this.lattice.whistle.frequency.setTargetAtTime(1500 + 900 * w, now, 0.6);
    }
    // The nearest live tower: its radio from the nearest of its speakers, its cabinet's hum.
    const live = near.find((t) => alive.has(t.id)) ?? null;
    const spk = live ? speakers(live).sort((a, b) => Math.hypot(a.x - ear.x, a.y - ear.y, a.z - ear.z) - Math.hypot(b.x - ear.x, b.y - ear.y, b.z - ear.z))[0] : null;
    const dSpk = spk ? Math.hypot(spk.x - ear.x, spk.y - ear.y, spk.z - ear.z) : Infinity;
    if (this.radio && (!live || this.radio.id !== live.id || dSpk > HEAR + 5)) this.drop(this.radio, this.radio.out), (this.radio = null);
    if (live && spk && dSpk < HEAR && !this.radio) {
      const pan = panAt(ctx, spk);
      pan.connect(out);
      const r = radioGraph(ctx, pan);
      r.out.gain.value = 0;
      this.radio = { ...r, pan, id: live.id };
    }
    const q = live ? clarity(live.id) : 0;
    if (this.radio && spk) {
      this.radio.pan.positionX.value = spk.x;
      this.radio.pan.positionY.value = spk.y;
      this.radio.pan.positionZ.value = spk.z;
      const edge = Math.max(0, Math.min(1, (HEAR - dSpk) / (HEAR * 0.3)));
      this.radio.out.gain.setTargetAtTime((REF / Math.max(REF, dSpk)) * edge, now, 0.3);
      this.radio.hiss.gain.setTargetAtTime(STATIC_MAX + (STATIC_MIN - STATIC_MAX) * q, now, 0.5);
      if (this.radio.until < now + 1) mutter(this.radio, now + 3, this.rand);
    }
    // The cabinet's hum.
    if (this.hum && (!live || this.hum.id !== live.id)) this.drop(this.hum, this.hum.g), (this.hum = null);
    if (live && !this.hum) {
      const stop: (() => void)[] = [];
      const [cx, cz] = towerToWorld(live, CABINET.at, 0);
      const pan = panAt(ctx, { x: live.x + cx, y: live.y + 1, z: live.z + cz });
      const g = gainOf(ctx, 0);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 100;
      o.start();
      stop.push(() => o.stop());
      o.connect(filter(ctx, 'bandpass', 300, 1.3)).connect(g).connect(pan).connect(out);
      this.hum = { g, pan, stop, id: live.id };
    }
    if (this.hum && live) {
      const [cx, cz] = towerToWorld(live, CABINET.at, 0), d = Math.hypot(live.x + cx - ear.x, live.y + 1 - ear.y, live.z + cz - ear.z);
      this.hum.g.gain.setTargetAtTime(HUM * Math.min(1, 2 / Math.max(0.5, d)) * (d < 25 ? 1 : 0), now, 0.3);
    }
    // Through a receiver or jammer in hand: the live tower within reach, head-locked, thinner the further off.
    // (Not by the tower itself: its own speakers are heard there.)
    const dev = device && live && dSpk > HEAR * 0.5 ? Math.sqrt(d2(live)) : Infinity;
    if (this.device && dev > DEVICE_R) this.drop(this.device, this.device.out), (this.device = null);
    if (dev < DEVICE_R && !this.device) {
      this.device = radioGraph(ctx, out);
      this.device.out.gain.value = 0;
    }
    if (this.device && dev < DEVICE_R) {
      const far = dev / DEVICE_R;
      this.device.out.gain.setTargetAtTime(0.55 * (1 - far * 0.6), now, 0.3);
      this.device.hiss.gain.setTargetAtTime(Math.min(STATIC_MAX * 1.4, STATIC_MAX + (STATIC_MIN - STATIC_MAX) * q + far * 0.25), now, 0.5);
      if (this.device.until < now + 1) mutter(this.device, now + 3, this.rand);
    }
    this.hearing = (!!this.radio && dSpk < HEAR * 0.6) || (!!this.device && dev < DEVICE_R);
  }

  /** Fade a voice out and stop its sources. */
  private drop(v: { stop: (() => void)[] }, g: GainNode) {
    const ctx = audio.ctx;
    if (ctx) g.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    setTimeout(() => v.stop.forEach((f) => f()), 800);
  }
}

export const towerSound = new TowerSound();
