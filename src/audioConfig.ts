// Every sample the game plays, how loud each is, and the sound events that play them: the one place to swap a sound
// for another, rebalance a sample against its set or tune an event's level. The audio workbench (src/audioBench.ts,
// ?debug, F3 → Sound) plays any of these through the game's own audio graph at a spot round you and edits the trims
// and gains live; its "Copy edits" gives the changes to paste back in here.
//
// SAMPLES: one entry per file in public/audio/ (tools/audio-config.test.mjs keeps the two in step and checks `lufs`).
// - `file`: under public/audio/. Levelled files sit near −23 LUFS integrated, true peak ≤ −1 dBTP (docs/audio.md).
// - `lufs`: the file's measured integrated loudness (ffmpeg ebur128), for reference; `trim` (dB) is the loudness
//   adjustment applied wherever it plays, to even it out with its set without re-encoding the file (0: as it is).
// - `slices`: a sprite of `count` sounds, each `len` s long from its slot's start (`{ id, slice }` names one of them;
//   the bare id is any of them, picked at random).
// - `loop`: music, the loop region (s) of a song.
//
// EVENTS: one entry per thing that happens in the game that plays samples (several places may share one). The code
// in `by` plays it by id, reading the entry every time (so an edit from the workbench is heard at once).
// - `samples`: picked at random, never the same one twice running.
// - `gain`: linear level at full slider volume (1 is the sample at its loudness; the gains in docs/audio.md).
// - `pitch`: playback rate (lower: deeper, longer); `vary`: ± that fraction of it at random each time;
//   `jitter`: ± that fraction of the level at random.
// - `route`, how it reaches the ears (src/audio.ts, src/acoustics.ts):
//   - 'direct': straight to the effects bus, centred and dry (only you hear it: a pickup, teardown's metal);
//   - 'placed': src/acoustics.ts `placed` at a spot in the world (late, duller and more reverb with distance, HRTF,
//     echoes): full level within `ref` m, out of earshot past `hear` m. Played with no spot it's yours: dry, centred;
//   - 'panned': left/right panning and a 1/d fall-off from `ref` m out to `hear` m, by the module's own code;
//   - 'music': the music bus, under the music slider and never muffled.
// Synthesised sounds (wind, engines, guardians, guns' whines) are made in code and are not listed here.

export type Route = 'direct' | 'placed' | 'panned' | 'music';

export interface SampleDef {
  file: string;
  /** Measured integrated loudness of the file (LUFS). */
  lufs: number;
  /** Loudness adjustment (dB) wherever it plays. */
  trim: number;
  slices?: { count: number; len: number };
  loop?: [number, number];
  /** Where it came from, briefly (the full credit is in public/credits.txt). */
  from: string;
}

export const SAMPLES = {
  // Weapons
  'laser-1': { file: 'laser-1.mp3', lufs: -18.5, trim: 0, from: 'Defunct3, Pulse laser (CC0)' },
  'laser-2': { file: 'laser-2.mp3', lufs: -18.5, trim: 0, from: 'Defunct3, Pulse laser (CC0)' },
  'laser-3': { file: 'laser-3.mp3', lufs: -19.9, trim: 0, from: 'Defunct3, Pulse laser (CC0)' },
  'firework-1': { file: 'firework-1.mp3', lufs: -22.1, trim: 0, from: 'TB0Y298, Firework Explosion (CC BY 4.0)' },
  'firework-2': { file: 'firework-2.mp3', lufs: -24.0, trim: 0, from: 'TB0Y298, Firework Explosion 2 (CC BY 4.0)' },
  'firework-3': { file: 'firework-3.mp3', lufs: -26.7, trim: 0, from: 'TB0Y298, Firework Explosion 3 (CC BY 4.0)' },
  'firework-4': { file: 'firework-4.mp3', lufs: -23.5, trim: 0, from: 'TB0Y298, Firework Explosion 4 (CC BY 4.0)' },
  // Explosions, not played yet
  'explosion-1': { file: 'explosion-1.mp3', lufs: -22.6, trim: 0, from: 'qubodup, Explosive (CC0): crack and rumble' },
  'explosion-2': { file: 'explosion-2.mp3', lufs: -23.0, trim: 0, from: 'qubodup, Explosive (CC0): crack and rumble' },
  'explosion-3': { file: 'explosion-3.mp3', lufs: -22.9, trim: 0, from: 'qubodup, Explosive (CC0): crack and long rumble' },
  'explosion-beefy-1': { file: 'explosion-beefy-1.mp3', lufs: -23.0, trim: 0, from: 'SamsterBirdies, Beefy Explosions (CC0)' },
  'explosion-beefy-2': { file: 'explosion-beefy-2.mp3', lufs: -23.0, trim: 0, from: 'SamsterBirdies, Beefy Explosions (CC0)' },
  'explosion-beefy-3': { file: 'explosion-beefy-3.mp3', lufs: -23.0, trim: 0, from: 'SamsterBirdies, Beefy Explosions (CC0)' },
  'explosion-beefy-4': { file: 'explosion-beefy-4.mp3', lufs: -23.0, trim: 0, from: 'SamsterBirdies, Beefy Explosions (CC0)' },
  'explosion-gun-1': { file: 'explosion-gun-1.mp3', lufs: -22.9, trim: 0, from: 'SamsterBirdies, Explosion / Gun (CC0): short, punchy' },
  'explosion-gun-2': { file: 'explosion-gun-2.mp3', lufs: -23.0, trim: 0, from: 'SamsterBirdies, Explosion / Gun - 2 (CC0): short, punchy' },
  'explosion-scifi': { file: 'explosion-scifi.mp3', lufs: -23.0, trim: 0, from: 'Anomaex, Sci-Fi Explosion 2 (CC0)' },
  'explosion-astronomical': { file: 'explosion-astronomical.mp3', lufs: -23.0, trim: 0, from: 'SamsterBirdies, Astronomical Explosion (CC0): a 10 s roar' },
  // Body and hands
  'footsteps': { file: 'footsteps.mp3', lufs: -23.5, trim: 0, slices: { count: 8, len: 0.4 }, from: 'a walk on a gravel trail (Pixabay)' },
  // Only peak-normalised (−30.5 LUFS): its event's gain makes up for it.
  'footsteps-concrete': { file: 'footsteps-concrete.mp3', lufs: -30.5, trim: 0, slices: { count: 10, len: 0.4 }, from: 'footsteps on concrete' },
  'pickup': { file: 'pickup.mp3', lufs: -23.6, trim: 0, from: 'a metal latch' },
  // Peak-limited, not levelled (−29.1 LUFS).
  'drink': { file: 'drink.mp3', lufs: -29.1, trim: 0, from: 'SilverIllusionist, Liquid Drink (CC BY 4.0): three gulps' },
  'sigh': { file: 'sigh.mp3', lufs: -23.4, trim: 0, from: 'SilverIllusionist, Liquid Drink (CC BY 4.0): the sigh' },
  'fill': { file: 'fill.mp3', lufs: -25.6, trim: 0, from: 'Lastered, Bottle Filling (CC BY 4.0)' },
  // Four hits: a small tink, a clink, a softer clink and a big clang.
  'teardown-clang': { file: 'teardown-clang.mp3', lufs: -23.9, trim: 0, slices: { count: 4, len: 0.6 }, from: 'clings and clangs' },
  'teardown-bolt': { file: 'teardown-bolt.mp3', lufs: -25.9, trim: 0, from: 'a hose rung round a metal pipe' },
  // Vehicles
  'bike-crash': { file: 'bike-crash.mp3', lufs: -23.5, trim: 0, from: 'mixed for the game from CC0 sounds' },
  // Music (src/music.ts): 44.1 kHz, loop ends are exact sample counts.
  'desert-ambience': { file: 'desert-ambience.mp3', lufs: -23.4, trim: 0, loop: [0, 112], from: 'Veikko Suhonen, for dadajam' },
  'combat-drums': { file: 'combat-drums.mp3', lufs: -23.4, trim: 0, loop: [0, 1333418 / 44100], from: 'harrisonlace, Cinematic drum loop Ares 127 (CC0)' },
  // Levelled hotter, to stand out over the guns. Bars of 1.6 s: the intro and part A, then part B loops.
  'epic-battle': { file: 'epic-battle.mp3', lufs: -20.0, trim: 0, loop: [9 * 1.6, 1764000 / 44100], from: 'Veikko Suhonen, for dadajam' },
  'death': { file: 'death.mp3', lufs: -23.2, trim: 0, loop: [0, 421707 / 44100], from: 'Veikko Suhonen, for dadajam' },
} satisfies Record<string, SampleDef>;

export type SampleId = keyof typeof SAMPLES;
export type SampleRef = SampleId | { id: SampleId; slice: number };

export interface EventDef {
  samples: SampleRef[];
  gain: number;
  pitch?: number;
  vary?: number;
  jitter?: number;
  route: Route;
  ref?: number;
  hear?: number;
  /** What plays it. */
  by: string;
}

const LASERS: SampleRef[] = ['laser-1', 'laser-2', 'laser-3'];
const FIREWORKS: SampleRef[] = ['firework-1', 'firework-2', 'firework-3', 'firework-4'];
/** The rifle's level (calibrated in the full mix, docs/audio.md) × the pulse samples' own lift. */
const SHOT = 0.3 * 1.3;
/** Firework bursts: full level within 35 m, heard 600 m off, a little off pitch each time. */
const BURST = { samples: FIREWORKS, vary: 0.08, route: 'placed', ref: 35, hear: 600 } as const;

export const EVENTS = {
  // Guns (src/rifleSound.ts): the pulses, lower for heavier guns.
  'rifle.shot': { samples: LASERS, gain: SHOT, vary: 0.04, route: 'placed', ref: 15, hear: 600, by: 'src/rifleSound.ts shot' },
  'pistol.shot': { samples: LASERS, gain: SHOT * 0.75, pitch: 1.35, vary: 0.04, route: 'placed', ref: 15, hear: 600, by: 'src/rifleSound.ts shot (pistol)' },
  'blaster.shot': { samples: LASERS, gain: SHOT * 1.5, pitch: 0.68, vary: 0.04, route: 'placed', ref: 20, hear: 700, by: 'src/rifleSound.ts blaster' },
  'cannon.shot': { samples: LASERS, gain: 1.4, pitch: 0.5, vary: 0.05, route: 'placed', ref: 40, hear: 500, by: 'src/rifleSound.ts cannon (a guardian\'s)' },
  // Bursts: something blowing up, lower and louder the bigger it is.
  'weakPoint.break': { ...BURST, gain: 2, by: 'src/guardians.ts (a guardian\'s), src/bosses.ts (a boss\'s)' },
  'crawler.weakPoint.break': { ...BURST, gain: 2 * 0.4, by: 'src/guardians.ts' },
  'drone.crash': { ...BURST, gain: 2 * 0.5, by: 'src/guardians.ts' },
  'missile.blast': { ...BURST, gain: 2 * 0.7, pitch: 0.8, by: 'src/gunSound.ts explosion (missiles, the blaster\'s bolt)' },
  'harvester.coreOut': { ...BURST, gain: 2 * 0.7, pitch: 0.8, by: 'src/guardians.ts' },
  'harvester.death': { ...BURST, gain: 2, pitch: 0.64, by: 'src/guardians.ts' },
  'jet.crash': { ...BURST, gain: 2, pitch: 0.8, by: 'src/guardians.ts' },
  'boss.death': { ...BURST, gain: 2 * 1.4, pitch: 0.6, by: 'src/bosses.ts' },
  'colossus.missile': { ...BURST, gain: 2, pitch: 0.75, by: 'src/world/colossus.ts blast' },
  'carrier.droneCrash': { ...BURST, gain: 2 * 0.5, pitch: 1.4, by: 'src/world/carrier.ts' },
  'carrier.wreck': { ...BURST, gain: 2 * 1.6, pitch: 0.45, by: 'src/world/carrier.ts' },
  'carrier.bomb': { ...BURST, gain: 2 * 1.1, pitch: 0.7, by: 'src/world/carrier.ts' },
  // Body and hands
  'footstep.sand': { samples: ['footsteps'], gain: 0.2, vary: 0.08, jitter: 0.15, route: 'panned', ref: 2.5, hear: 30, by: 'src/footsteps.ts step' },
  'footstep.concrete': { samples: ['footsteps-concrete'], gain: 0.45, vary: 0.08, jitter: 0.15, route: 'panned', ref: 2.5, hear: 30, by: 'src/footsteps.ts step (in shelters)' },
  'pickup': { samples: ['pickup'], gain: 0.2, vary: 0.06, jitter: 0.1, route: 'direct', by: 'src/pickupSound.ts' },
  // Yours dry and centred; another player's placed (`ref`, `hear`).
  'drink.gulps': { samples: ['drink'], gain: 0.7, vary: 0.04, route: 'placed', ref: 1.5, hear: 30, by: 'src/drinkSound.ts drink' },
  'drink.sigh': { samples: ['sigh'], gain: 0.4, vary: 0.04, route: 'direct', by: 'src/drinkSound.ts done' },
  'well.pour': { samples: ['fill'], gain: 0.5, route: 'placed', ref: 1.5, hear: 30, by: 'src/drinkSound.ts fill' },
  'teardown.tink': { samples: [{ id: 'teardown-clang', slice: 0 }], gain: 0.25, vary: 0.1, jitter: 0.15, route: 'direct', by: 'src/teardownSound.ts hit' },
  'teardown.clink': { samples: [{ id: 'teardown-clang', slice: 1 }], gain: 0.35, vary: 0.1, jitter: 0.15, route: 'direct', by: 'src/teardownSound.ts hit' },
  'teardown.soft': { samples: [{ id: 'teardown-clang', slice: 2 }], gain: 0.5, vary: 0.1, jitter: 0.15, route: 'direct', by: 'src/teardownSound.ts hit' },
  'teardown.clang': { samples: [{ id: 'teardown-clang', slice: 3 }], gain: 0.4, vary: 0.1, jitter: 0.15, route: 'direct', by: 'src/teardownSound.ts hit' },
  'teardown.bolt': { samples: ['teardown-bolt'], gain: 0.35, vary: 0.08, route: 'direct', by: 'src/teardownSound.ts turn (rings while you circle)' },
  // Vehicles: how rough the landing was filters it (src/bikeLandSound.ts).
  'bike.land': { samples: ['bike-crash'], gain: 0.45, vary: 0.05, jitter: 0.1, route: 'panned', ref: 4, hear: 60, by: 'src/bikeLandSound.ts play' },
  // Music (src/music.ts states; the landing page plays the ambience too, src/landing.ts).
  'music.ambient': { samples: ['desert-ambience'], gain: 0.45, route: 'music', by: 'src/music.ts (out on the surface, sunrise), src/landing.ts' },
  'music.combat': { samples: ['combat-drums'], gain: 0.55, route: 'music', by: 'src/music.ts (something is after you)' },
  'music.epic': { samples: ['epic-battle'], gain: 0.7, route: 'music', by: 'src/music.ts (a boss, a guardian close by)' },
  'music.death': { samples: ['death'], gain: 0.55, route: 'music', by: 'src/music.ts (you died)' },
} satisfies Record<string, EventDef>;

export type EventId = keyof typeof EVENTS;

/** An entry, by id (typed as the common shape). */
export const sample = (id: SampleId): SampleDef => SAMPLES[id];
export const event = (id: EventId): EventDef => EVENTS[id];
export const sampleId = (r: SampleRef): SampleId => (typeof r === 'string' ? r : r.id);
/** A sample's trim (dB) as a gain. */
export const trimGain = (id: SampleId) => 10 ** (sample(id).trim / 20);
/** A sample's URL (relative: served under /dadajam/). */
export const sampleUrl = (id: SampleId) => `./audio/${SAMPLES[id].file}`;
