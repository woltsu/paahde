// The character's voice as visual-novel blips: one short soft beep per letter as a subtitle types out
// (src/speech.ts), played locally. A rounded square (fundamental plus a little 3rd harmonic, so it's friendly
// rather than a pure test tone) around 330 Hz, each blip a few percent off at random (its event's `vary`) and dipping
// slightly in pitch, under a 4 ms attack and a 22 ms decay. Rendered offline (same envelope) at volume 1, a line
// typing at 28 letters/s measures −38 LUFS integrated over the typing, −26 dBTP: under the plop (src/uiSound.ts),
// present but quiet. Its level is the event speech.blip's (src/audioConfig.ts).
import { defineSynth, play } from './sounds';

/** Base pitch (Hz). */
const PITCH = 330;

const waves = new WeakMap<BaseAudioContext, PeriodicWave>();

// One blip for the letter arg (vowels a touch higher, so a line has a little tune).
defineSynth('blip', {
  length: 0.16,
  voice(ctx, out, t0, o) {
    let wave = waves.get(ctx);
    if (!wave) waves.set(ctx, (wave = ctx.createPeriodicWave([0, 0, 0, 0], [0, 1, 0, 0.18], { disableNormalization: true })));
    const vowel = /[aeiouyäöå]/i.test(String(o.arg ?? '')) ? 1.06 : 1;
    const f = PITCH * vowel * o.rate, t = t0 + 0.005;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.linearRampToValueAtTime(f * 0.94, t + 0.05);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.004);
    gain.gain.setTargetAtTime(0, t + 0.004, 0.022);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 0.15);
    osc.onended = () => gain.disconnect();
  },
});

class SpeechSound {
  /** One blip, for the letter `ch`. */
  blip(ch: string) {
    play('speech.blip', null, null, { arg: ch });
  }
}

export const speechSound = new SpeechSound();
