// Gulps while you drink from the canteen, a sigh of relief after when you were overheating (heat over
// SIGH_ABOVE when the sip goes down), and the pour while you refill it at the pump. Other players' gulps and pours
// play at them (src/acoustics.ts) when their snapshot's hands say they started (shared/protocol.ts Hands); the
// sigh is yours alone.
//
// Both are cut from SilverIllusionist's "Liquid Drink" (CC BY 4.0, public/credits.txt), mono: drink.mp3 is the
// three gulps (1.07 s, fits in DRINK_MS), peak-limited to −1.6 dBTP (−29 LUFS); sigh.mp3 the sigh after
// (1.02 s), levelled to −23 LUFS. fill.mp3 is the first 1.75 s of Lastered's "Bottle Filling" (CC BY 4.0), the
// pour with its resonance rising as the bottle fills; mono, high-passed at 250 Hz (the recording's hum), faded
// out over its last 0.3 s, −25.6 LUFS, −2.2 dBTP. Their events' gains (drink.gulps, drink.sigh, well.pour in
// src/audioConfig.ts) keep them about as loud as your own footsteps; another player's are placed by the events' `ref`
// and `hear`.
import { FILL_MS } from '../shared/water.ts';
import { audio } from './audio';
import type { P } from './acoustics';
import { event, type EventId } from './audioConfig';
import { playSample, spread, type SampleVoice } from './sounds';

/** Heat (0..HEAT_MAX) above which a finished sip gets the sigh. */
export const SIGH_ABOVE = 50;

const DRINK: EventId = 'drink.gulps';
const SIGH: EventId = 'drink.sigh';
const FILL: EventId = 'well.pour';

/** The pour speeds up by this much over FILL_MS, so it rises in pitch as the bottle fills. */
const FILL_RISE = 0.12;
/** A well's pour plays this much slower or quicker at most; a long one loops this stretch of it (s). */
const FILL_SLOW = 0.85;
const FILL_FAST = 1.25;
const FILL_LOOP: [number, number] = [0.35, 1.35];

class DrinkSound {
  /** The gulps playing now, cut short if you stop drinking. */
  private gulps: SampleVoice | null = null;
  /** Per other player: what their hands were doing last frame, and the sound they're making. */
  private others = new Map<number, { act: 0 | 1 | 2; voice: SampleVoice | null }>();

  /** You started a sip. */
  drink() {
    this.stop();
    this.gulps = this.play(DRINK);
  }

  /** Every frame, with the other players (interpolated) and where the camera is. */
  remotes(players: { id: number; x: number; y: number; z: number; drinking: boolean; filling: boolean }[], ear: P) {
    const ctx = audio.ctx;
    const seen = new Set<number>();
    for (const p of players) {
      seen.add(p.id);
      const act = p.drinking ? 1 : p.filling ? 2 : 0;
      let o = this.others.get(p.id);
      if (!o) this.others.set(p.id, (o = { act: 0, voice: null }));
      if (act === o.act) continue;
      // Stopped (done or let go): a sip's gulps are over by then, a pour's tail is cut short.
      if (o.voice && ctx) this.cut(ctx, o.voice);
      o.voice = null;
      o.act = act;
      if (act) o.voice = this.playAt(act === 1 ? DRINK : FILL, { x: p.x, y: p.y + 1.4, z: p.z }, ear);
    }
    for (const [id, o] of this.others) {
      if (seen.has(id)) continue;
      if (o.voice && ctx) this.cut(ctx, o.voice);
      this.others.delete(id);
    }
  }

  /** You started refilling at a pump, taking `ms` (an electric well's may be slower or quicker, shared/wells.ts): the
   *  pour a little slower or quicker, its middle looped for as long as a slow one needs. */
  fill(ms = FILL_MS) {
    this.stop();
    this.gulps = this.play(FILL);
    const ctx = audio.ctx;
    if (!ctx || !this.gulps) return;
    const src = this.gulps.src;
    src.playbackRate.value = Math.min(FILL_FAST, Math.max(FILL_SLOW, FILL_MS / ms));
    if ((ms / 1000) * src.playbackRate.value > FILL_LOOP[1]) {
      src.loop = true;
      [src.loopStart, src.loopEnd] = FILL_LOOP;
    }
    this.rise(ctx, src, ctx.currentTime, ms);
  }

  /** The refill finished: let the pour's tail play out. */
  filled() {
    if (this.gulps) this.gulps.src.loop = false;
    this.gulps = null;
  }

  /** You let go before the sip went down, or walked off the pump: cut the gulps or the pour. */
  stop() {
    const ctx = audio.ctx;
    if (!ctx || !this.gulps) return;
    this.cut(ctx, this.gulps);
    this.gulps = null;
  }

  private cut(ctx: AudioContext, { src, gain }: SampleVoice) {
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    src.stop(ctx.currentTime + 0.2);
  }

  /** The sip went down; `heat` is the meter before it. */
  done(heat: number) {
    this.gulps = null;
    if (heat > SIGH_ABOVE) this.play(SIGH);
  }

  /** Yours: dry and centred. */
  private play(id: EventId) {
    const e = event(id);
    return playSample(e.sounds[0], { route: 'direct', level: e.gain, rate: (e.pitch ?? 1) * spread(e.vary) });
  }

  /** Another player's sound, at `at`, heard from `ear`; a pour rises like yours. */
  private playAt(id: EventId, at: P, ear: P) {
    const e = event(id), ctx = audio.ctx;
    const v = playSample(e.sounds[0], { route: 'placed', at, ear, ref: e.ref, hear: e.hear, level: e.gain, rate: (e.pitch ?? 1) * spread(e.vary) });
    if (v && ctx && id === FILL) this.rise(ctx, v.src, v.t);
    return v;
  }

  /** Speed the pour up over FILL_MS from `t`. */
  private rise(ctx: AudioContext, src: AudioBufferSourceNode, t: number, ms = FILL_MS) {
    const rate = src.playbackRate;
    rate.setValueAtTime(rate.value, t);
    rate.linearRampToValueAtTime(rate.value + FILL_RISE, t + ms / 1000);
  }
}

export const drinkSound = new DrinkSound();
