// A soft metal latch when you pick up a piece of scrap (played locally, as soon as you ask; only you hear it).
//
// public/audio/pickup.mp3 is the main hit of a latch recording (see public/credits.txt), trimmed to 1.26 s
// and levelled to −23 LUFS. Its event (`pickup`, src/audioConfig.ts) keeps it quiet: about as loud as your own
// footsteps.
import { play } from './samples';

class PickupSound {
  play() {
    play('pickup');
  }
}

export const pickupSound = new PickupSound();
