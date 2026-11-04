// The sound bank and the player for sound events (src/audioConfig.ts).
//
// A sound is a sample or a synth, and the player treats them alike: each makes its sound into a node from a given
// context time and says how long it lasts. A sample is a file, fetched and decoded once when audio starts (music
// loads its own, src/music.ts, keeping only two songs decoded). A synth is code, registered by the module that owns
// it with `defineSynth(id, { length, voice })` under its SYNTHS id; `voice` builds it on any context (so it can also be
// rendered offline and measured) at unity-ish level, and the event's gain sets it in the mix.
//
// `play(event, at, ear)` plays an event the way its entry says: a sound picked from it, its gain, trim, pitch and
// spread, routed directly, placed in the world (src/acoustics.ts), panned or onto the music bus, on the warning bus if
// it says so. `playSound` plays one sound by a given route (the workbench, and modules that set up more on the voice
// it returns). Entries are read on every play, so edits from the workbench (src/audioBench.ts) are heard at once.
import { audio } from './audio';
import { placed, type P } from './acoustics';
import { EVENTS, event, isSynth, sample, sampleUrl, soundId, trimGain, type EventId, type Route, type SampleId, type SoundRef, type SynthId } from './audioConfig';

// ---- synths ----

/** What a synth is asked to make: its playback rate (the event's pitch × spread: 1 is as made; a synth reads it as it
 *  likes) and its argument (a variant, or a length: the event's, or what the code playing it passed). */
export interface Make {
  rate: number;
  arg?: number | string;
}

export interface Synth {
  /** How long it sounds (s): what the voice budget reserves, and when the voice is done. */
  length: number | ((o: Make) => number);
  /** Make it into `out` from context time `t`. */
  voice(ctx: BaseAudioContext, out: AudioNode, t: number, o: Make): void;
}

const synths = new Map<SynthId, Synth>();

/** Register a synth under its SYNTHS id (src/audioConfig.ts); the module that makes it does, when it loads. */
export function defineSynth(id: SynthId, s: Synth) {
  synths.set(id, s);
}

export const synthDefined = (id: SynthId) => synths.has(id);

const warned = new Set<string>();
const warnOnce = (what: string) => {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(what);
};

// ---- samples ----

const bufs = new Map<SampleId, AudioBuffer>();
const loading = new Map<SampleId, Promise<AudioBuffer | null>>();

/** Fetch and decode a sample, once (null if it failed: tried again next time it's asked for). */
export function loadSample(id: SampleId): Promise<AudioBuffer | null> {
  const have = bufs.get(id);
  if (have) return Promise.resolve(have);
  const ctx = audio.ctx;
  if (!ctx) return Promise.resolve(null);
  let p = loading.get(id);
  if (!p) {
    p = fetch(sampleUrl(id))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((d) => ctx.decodeAudioData(d))
      .then((b) => { bufs.set(id, b); return b; }, (e) => { console.warn('sound failed to load', id, e); return null; })
      .finally(() => loading.delete(id));
    loading.set(id, p);
  }
  return p;
}

/** A decoded sample, or null while it loads (asking starts the load). */
export function sampleBuffer(id: SampleId): AudioBuffer | null {
  const b = bufs.get(id);
  if (!b) void loadSample(id);
  return b ?? null;
}

// Every sample an event plays, but music (src/music.ts loads songs as their state comes).
audio.onStart(() => {
  for (const id of Object.keys(EVENTS) as EventId[]) {
    const e = event(id);
    if (e.route === 'music') continue;
    for (const r of e.sounds) {
      const s = soundId(r);
      if (!isSynth(s)) void loadSample(s);
    }
  }
});

// ---- either ----

/** The last pick per key, so the same one doesn't play twice running. */
const lastPick = new Map<string, number>();
export function pickIndex(key: string, n: number) {
  if (n < 2) return 0;
  const last = lastPick.get(key) ?? -1;
  let i = Math.floor(Math.random() * (last < 0 ? n : n - 1));
  if (last >= 0 && i >= last) i++;
  lastPick.set(key, i);
  return i;
}

/** 1 ± `v` at random. */
export const spread = (v = 0) => 1 - v + Math.random() * 2 * v;

/** Left/right pan (−1..1, at most `width`) of a sound `dx`, `dz` m off, by where the Web Audio listener faces
 *  (src/crashSound.ts turns it with the camera); within `near` m it stays centred. */
export function panOf(ctx: AudioContext, dx: number, dz: number, near: number, width = 0.7) {
  const l = ctx.listener, fx = l.forwardX?.value ?? 0, fz = l.forwardZ?.value ?? -1, f = Math.hypot(fx, fz);
  if (f < 1e-3) return 0; // (looking straight up or down)
  const right = (-dx * fz + dz * fx) / f, d = Math.hypot(dx, dz);
  return Math.max(-1, Math.min(1, right / Math.max(d, near))) * width;
}

/** A sound ready to make: how long it lasts, and making it (a sample's source node back, to play with further). */
interface Source {
  length: number;
  make(ctx: AudioContext, out: AudioNode, t: number): AudioBufferSourceNode | null;
}

/** The sound `r` at `rate` (and `arg`, a synth's), or null while a sample loads or a synth isn't defined. */
function source(r: SoundRef, rate: number, o: { arg?: number | string; slice?: number; key?: string }): Source | null {
  const id = soundId(r);
  if (isSynth(id)) {
    const s = synths.get(id);
    if (!s) { warnOnce(`synth ${id} is not defined (defineSynth in ${id}'s module)`); return null; }
    const m: Make = { rate, arg: o.arg };
    return { length: typeof s.length === 'number' ? s.length : s.length(m), make: (ctx, out, t) => (s.voice(ctx, out, t, m), null) };
  }
  const buf = sampleBuffer(id);
  if (!buf) return null;
  const def = sample(id);
  let offset = 0, len = buf.duration;
  if (def.slices) {
    const k = typeof r !== 'string' ? r.slice : o.slice ?? pickIndex(`${o.key ?? id}#slice`, def.slices.count);
    offset = Math.min(buf.duration, k * def.slices.len);
    len = Math.min(def.slices.len, buf.duration - offset);
  }
  return {
    length: len / rate + 0.1,
    make(ctx, out, t) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(out);
      if (def.slices) src.start(t, offset, len);
      else src.start(t);
      return src;
    },
  };
}

export interface Voice {
  gain: GainNode;
  /** Context time it starts (later than now for a far placed sound: the speed of sound), and when it's done. */
  t: number;
  end: number;
  /** A sample's source node (its rate and loop can still be changed); none for a synth. */
  src?: AudioBufferSourceNode;
  /** Fade it out over about `tau` × 5 s. */
  stop(tau?: number): void;
}
export type SampleVoice = Voice & { src: AudioBufferSourceNode };

export interface SoundOptions {
  route: Route;
  /** Level (× the sound's trim). */
  level: number;
  /** Playback rate; a synth's argument. */
  rate?: number;
  arg?: number | string;
  /** Where it is and the ears ('placed', 'panned'); no `at`: your own. */
  at?: P | null;
  ear?: P | null;
  ref?: number;
  hear?: number;
  /** On the protected warning bus. */
  warning?: boolean;
  /** Which slice of a sprite (a bare id picks one, not the last); `key` keeps the last pick apart per use. */
  slice?: number;
  key?: string;
  /** Start this much later (s). */
  delay?: number;
}

/** One sound by `route`. Null when audio isn't running, a sample is still loading or it's out of earshot. */
export function playSound(r: SoundRef, o: SoundOptions): Voice | null {
  const ctx = audio.ctx;
  if (!ctx || !audio.running) return null;
  const id = soundId(r), rate = Math.max(0.05, o.rate ?? 1);
  const s = source(r, rate, o);
  if (!s) return null;
  let level = o.level * trimGain(id), out: AudioNode | null, t = ctx.currentTime + (o.delay ?? 0);
  const at = o.at ?? null, ear = o.ear ?? null;
  const pan = o.route === 'panned' && at && ear ? ctx.createStereoPanner() : null;
  if (o.route === 'placed') {
    const p = placed(at, ear, level, o.ref ?? 15, o.hear ?? 600, { duration: s.length + (o.delay ?? 0), warning: o.warning });
    if (!p) return null;
    out = p.input;
    t = p.t + (o.delay ?? 0);
    level = 1;
  } else if (o.route === 'music') out = audio.music;
  else if (o.route === 'spatial' && at) {
    // A plain Web Audio panner at `at` (the listener follows the camera): equal-power, 1/d from `ref`; nothing past
    // `hear` (from `ear`, or the listener).
    const l = ctx.listener, e = ear ?? { x: l.positionX?.value ?? 0, y: l.positionY?.value ?? 0, z: l.positionZ?.value ?? 0 };
    if (o.hear !== undefined && Math.hypot(at.x - e.x, at.y - e.y, at.z - e.z) > o.hear) return null;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = o.ref ?? 10;
    p.rolloffFactor = 1;
    p.positionX.value = at.x;
    p.positionY.value = at.y;
    p.positionZ.value = at.z;
    p.connect(o.warning ? audio.warning! : audio.out!);
    out = p;
  } else {
    out = o.warning ? audio.warning : audio.out;
    if (o.warning) audio.protectWarning(Math.min(4, s.length));
    if (pan && at && ear) {
      // As src/footsteps.ts: full within `ref`, 1/d out, faded to nothing over the last sixth of `hear`.
      const dx = at.x - ear.x, dz = at.z - ear.z, d = Math.hypot(dx, dz), ref = o.ref ?? 2.5, hear = o.hear ?? 30;
      if (d > hear) return null;
      level *= Math.min(1, ref / d) * Math.min(1, (hear - d) / (hear / 6));
      pan.pan.value = panOf(ctx, dx, dz, ref);
    }
  }
  if (!out) return null;
  const gain = ctx.createGain();
  gain.gain.value = level;
  if (pan) gain.connect(pan).connect(out);
  else gain.connect(out);
  const src = s.make(ctx, gain, t) ?? undefined;
  const end = t + s.length;
  if (src) src.onended = () => gain.disconnect();
  else setTimeout(() => gain.disconnect(), (end - ctx.currentTime + 0.5) * 1000);
  return {
    gain, t, end, src,
    stop(tau = 0.03) {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, tau);
      try { src?.stop(now + tau * 7); } catch { /* not started yet */ }
    },
  };
}

/** One sample by `route` (its voice has its source node). */
export function playSample(r: SoundRef, o: SoundOptions): SampleVoice | null {
  return playSound(r, o) as SampleVoice | null;
}

export interface PlayOptions {
  /** × the event's gain and pitch. */
  level?: number;
  pitch?: number;
  /** A synth's argument, in place of the event's. */
  arg?: number | string;
  /** Start this much later (s). */
  delay?: number;
  /** In place of the event's (the workbench). */
  route?: Route;
}

/** A sound event at `at`, heard from `ear` (none: yours), as its entry in src/audioConfig.ts says. */
export function play(id: EventId, at: P | null = null, ear: P | null = null, o: PlayOptions = {}): Voice | null {
  const e = event(id);
  const r = e.sounds[pickIndex(id, e.sounds.length)];
  return playSound(r, {
    route: o.route ?? e.route, at, ear, ref: e.ref, hear: e.hear, key: id, warning: e.warning,
    arg: o.arg ?? e.arg, delay: o.delay,
    level: e.gain * (o.level ?? 1) * spread(e.jitter),
    rate: (e.pitch ?? 1) * (o.pitch ?? 1) * spread(e.vary),
  });
}
