// The sample bank and the player for sound events (src/audioConfig.ts): every sample an event plays is fetched and
// decoded once, when audio starts (music loads its own, src/music.ts, keeping only two songs decoded); `play` plays
// an event the way its entry says, `playSample` one sample by a given route (the audio workbench, and modules whose
// sound is more than a one-shot: they set up the rest themselves on the voice it returns).
// Entries are read on every play, so edits from the workbench (src/audioBench.ts) are heard at once.
import { audio } from './audio';
import { placed, type P } from './acoustics';
import { EVENTS, event, sample, sampleId, sampleUrl, trimGain, type EventId, type Route, type SampleId, type SampleRef } from './audioConfig';

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
    if (e.route !== 'music') for (const r of e.samples) void loadSample(sampleId(r));
  }
});

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

export interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** Context time it starts (later than now for a far placed sound: the speed of sound). */
  t: number;
  /** Fade it out over about `tau` × 5 s. */
  stop(tau?: number): void;
}

export interface SampleOptions {
  route: Route;
  /** Level (× the sample's trim). */
  level: number;
  /** Playback rate. */
  rate?: number;
  /** Where it is and the ears ('placed', 'panned'); no `at`: your own. */
  at?: P | null;
  ear?: P | null;
  ref?: number;
  hear?: number;
  /** Which slice of a sprite (a bare id picks one, not the last); `key` keeps the last pick apart per use. */
  slice?: number;
  key?: string;
}

/** One sample by `route`. Null when audio isn't running, the sample is still loading or it's out of earshot. */
export function playSample(r: SampleRef, o: SampleOptions): Voice | null {
  const ctx = audio.ctx;
  if (!ctx || !audio.running) return null;
  const id = sampleId(r), buf = sampleBuffer(id);
  if (!buf) return null;
  const def = sample(id), rate = Math.max(0.05, o.rate ?? 1);
  let offset = 0, len = buf.duration;
  if (def.slices) {
    const k = typeof r !== 'string' ? r.slice : o.slice ?? pickIndex(`${o.key ?? id}#slice`, def.slices.count);
    offset = Math.min(buf.duration, k * def.slices.len);
    len = Math.min(def.slices.len, buf.duration - offset);
  }
  let level = o.level * trimGain(id), out: AudioNode | null, t = ctx.currentTime;
  const at = o.at ?? null, ear = o.ear ?? null;
  const pan = o.route === 'panned' && at && ear ? ctx.createStereoPanner() : null;
  if (o.route === 'placed') {
    const s = placed(at, ear, level, o.ref ?? 15, o.hear ?? 600, { duration: len / rate + 0.1 });
    if (!s) return null;
    out = s.input;
    t = s.t;
    level = 1;
  } else if (o.route === 'music') out = audio.music;
  else {
    out = audio.out;
    if (pan && at && ear) {
      // As src/footsteps.ts: full within `ref`, 1/d out, faded to nothing over the last sixth of `hear`.
      const dx = at.x - ear.x, dz = at.z - ear.z, d = Math.hypot(dx, dz), ref = o.ref ?? 2.5, hear = o.hear ?? 30;
      if (d > hear) return null;
      level *= Math.min(1, ref / d) * Math.min(1, (hear - d) / (hear / 6));
      pan.pan.value = panOf(ctx, dx, dz, ref);
    }
  }
  if (!out) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const gain = ctx.createGain();
  gain.gain.value = level;
  src.connect(gain);
  if (pan) gain.connect(pan).connect(out);
  else gain.connect(out);
  if (def.slices) src.start(t, offset, len);
  else src.start(t);
  src.onended = () => gain.disconnect();
  return {
    src, gain, t,
    stop(tau = 0.03) {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, tau);
      try { src.stop(now + tau * 7); } catch { /* not started yet */ }
    },
  };
}

export interface PlayOptions {
  /** × the event's gain and pitch. */
  level?: number;
  pitch?: number;
  /** In place of the event's (the workbench). */
  route?: Route;
}

/** A sound event at `at`, heard from `ear` (none: yours), as its entry in src/audioConfig.ts says. */
export function play(id: EventId, at: P | null = null, ear: P | null = null, o: PlayOptions = {}): Voice | null {
  const e = event(id);
  const r = e.samples[pickIndex(id, e.samples.length)];
  return playSample(r, {
    route: o.route ?? e.route, at, ear, ref: e.ref, hear: e.hear, key: id,
    level: e.gain * (o.level ?? 1) * spread(e.jitter),
    rate: (e.pitch ?? 1) * (o.pitch ?? 1) * spread(e.vary),
  });
}
