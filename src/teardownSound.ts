// Metal sounds while taking a machine apart (src/teardown/): a tink per click on a screw, clinks as fasteners come
// off, a clang as a cover drops, and a metal ring while you circle a big bolt round. Played locally; steps finished
// by other players at a shared site are heard too, a little quieter.
//
// public/audio/teardown-clang.mp3 is a sprite of four hits sliced from a clings-and-clangs recording (see
// public/credits.txt), one per slot, each starting at its slot start: a small tink, a clink, a softer
// clink and a big clang. Each is levelled to about −23..−26 LUFS (true peak ≤ −1 dBTP).
// public/audio/teardown-bolt.mp3 is the first second of a hose being rung round a metal pipe, about −26 LUFS.
// Their levels are the events' (teardown.*) in src/audioConfig.ts.
import { audio } from './audio';
import { event } from './audioConfig';
import { play, playSample, sampleBuffer, spread, type Voice } from './sounds';

export type Hit = 'tink' | 'clink' | 'soft' | 'clang';
/** The ring fades out once the pointer has stopped circling for this long (s). */
const BOLT_IDLE = 0.12;

class TeardownSound {
  private ring: { voice: Voice; t0: number } | null = null;
  private idle: ReturnType<typeof setTimeout> | undefined;

  /** One metal hit; `level` scales it (remote players' steps are quieter). */
  hit(kind: Hit, level = 1) {
    play(`teardown.${kind}`, null, null, { level });
  }

  /** The pointer is circling a bolt: keep the ring going (restarting it as it runs out), fading once it stops. */
  turn() {
    const ctx = audio.ctx, buf = sampleBuffer('teardown-bolt');
    if (!ctx || !buf || !audio.running) return;
    const now = ctx.currentTime;
    clearTimeout(this.idle);
    if (this.ring && now - this.ring.t0 < buf.duration - 0.25) {
      this.idle = setTimeout(() => this.stop(), BOLT_IDLE * 1000);
      return;
    }
    this.stop();
    const e = event('teardown.bolt');
    const voice = playSample(e.sounds[0], { route: e.route, level: e.gain, rate: (e.pitch ?? 1) * spread(e.vary) });
    if (!voice) return;
    // Fade in (no click).
    const level = voice.gain.gain.value;
    voice.gain.gain.value = 0;
    voice.gain.gain.setTargetAtTime(level, now, 0.01);
    const ring = { voice, t0: now };
    voice.src.addEventListener('ended', () => {
      if (this.ring === ring) this.ring = null;
    });
    this.ring = ring;
    this.idle = setTimeout(() => this.stop(), BOLT_IDLE * 1000);
  }

  /** Fade out the bolt ring. */
  stop() {
    clearTimeout(this.idle);
    const r = this.ring;
    if (!r) return;
    this.ring = null;
    r.voice.stop(0.03);
  }
}

export const teardownSound = new TeardownSound();
