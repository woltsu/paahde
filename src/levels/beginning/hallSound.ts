// The ring hall's bed (docs/levels/ring.md): "Space hall ambience" (public/audio/space-hall-ambience.mp3, by Veikko
// Suhonen) looped whole and quietly under the datacenter's fans and the fall, for as long as you're aboard. Played through
// its event (src/audioConfig.ts 'beginning.hall': its level is there), its source set to loop; faded in and out.
import { audio } from '../../audio.ts';
import { event, sampleId } from '../../audioConfig.ts';
import { loadSample, play, type Voice } from '../../sounds.ts';

/** Fade in and out (s, a time constant). */
const FADE = 1.2;

export class HallSound {
  private voice: Voice | null = null;
  private on = false;

  /** Aboard: start the loop as soon as audio runs and the file is in. */
  start() {
    this.on = true;
    this.tryStart();
  }

  /** Off the level: fade it out. */
  stop() {
    this.on = false;
    this.voice?.stop(FADE / 3);
    this.voice = null;
  }

  /** Every frame (audio may start, or the file arrive, after we came aboard). */
  update() {
    if (this.on && !this.voice) this.tryStart();
  }

  private loading = false;

  private tryStart() {
    const ctx = audio.ctx;
    if (!ctx || !audio.running || this.loading) return;
    const id = sampleId(event('beginning.hall').sounds[0]);
    this.loading = true;
    void loadSample(id).then((buf) => {
      this.loading = false;
      if (!buf || !this.on || this.voice) return;
      const v = play('beginning.hall');
      if (!v?.src) return;
      v.src.loop = true; // (the whole file: its encode is gapless)
      // From silence, no click.
      const level = v.gain.gain.value, now = ctx.currentTime;
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(0, now);
      v.gain.gain.setTargetAtTime(level, now, FADE);
      this.voice = v;
    });
  }
}
