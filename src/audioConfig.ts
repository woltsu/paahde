// Every sound the game plays, how loud each is, and the sound events that play them: the one place to swap a sound
// for another, rebalance a sound against its set or tune an event's level. The audio workbench (src/audioBench.ts,
// ?debug, F3 → "Audio workbench") plays any of these through the game's own audio graph at a spot round you and edits
// the trims and gains live; its "Copy edits" gives the changes to paste back in here.
//
// A sound is a sample (a file, SAMPLES) or a synth (made in code, SYNTHS); both make their sound into a node from a
// given time and say how long it lasts (src/sounds.ts), so an event plays either the same way and may mix them. Both
// have a `trim` (dB): the loudness adjustment wherever the sound plays (0: as it is).
//
// SAMPLES: one entry per file in public/audio/ (tools/audio-config.test.mjs keeps the two in step and checks `lufs`).
// - `file`: under public/audio/. Levelled files sit near −23 LUFS integrated, true peak ≤ −1 dBTP (docs/audio.md).
// - `lufs`: the file's measured integrated loudness (ffmpeg ebur128), for reference; `trim` (dB) is the loudness
//   adjustment applied wherever it plays, to even it out with its set without re-encoding the file (0: as it is).
// - `slices`: a sprite of `count` sounds, each `len` s long from its slot's start (`{ id, slice }` names one of them;
//   the bare id is any of them, picked at random).
// - `loop`: music, the loop region (s) of a song.
//
// SYNTHS: one entry per sound made in code: what it is and which module makes it, registering it with
// `defineSynth(id, …)` (src/sounds.ts; the test checks each is). A synth's level is unity-ish within itself; its
// event's gain sets it in the mix (calibrated in the full mix, docs/audio.md).
//
// EVENTS: one entry per thing that happens in the game that plays a sound (several places may share one). The code
// in `by` plays it by id, reading the entry every time (so an edit from the workbench is heard at once).
// - `sounds`: samples and synths, picked at random, never the same one twice running.
// - `gain`: linear level at full slider volume (1 is the sound at its loudness; the gains in docs/audio.md).
// - `pitch`: playback rate (lower: deeper, longer; a synth reads it as it likes); `vary`: ± that fraction of it at
//   random each time; `jitter`: ± that fraction of the level at random.
// - `arg`: what a synth is told to make (a variant: 'sand', 'metal'; or a length): the event's own, unless the code
//   playing it passes one.
// - `warning`: placed on the protected warning bus, ducking the rest a moment (src/audio.ts `protectWarning`).
// - `route`, how it reaches the ears (src/audio.ts, src/acoustics.ts):
//   - 'direct': straight to the effects bus, centred and dry (only you hear it: a pickup, teardown's metal);
//   - 'placed': src/acoustics.ts `placed` at a spot in the world (late, duller and more reverb with distance, HRTF,
//     echoes): full level within `ref` m, out of earshot past `hear` m. Played with no spot it's yours: dry, centred;
//   - 'spatial': a plain Web Audio panner at the spot (equal-power, 1/d from `ref`, none past `hear` if given): no
//     delay, air or reverb, for small or close sounds (a crawler's feet, a guardian's horn). Played with no spot: direct;
//   - 'panned': left/right panning and a 1/d fall-off from `ref` m out to `hear` m, by the module's own code;
//   - 'music': the music bus, under the music slider and never muffled.
// Continuous sounds driven every frame (wind, engines, drones' buzz, the grinder) are not events yet: the levels' beds
// are in BEDS (below); the rest still keep their levels in their own modules.

export type Route = 'direct' | 'placed' | 'spatial' | 'panned' | 'music';

export interface SoundDef {
  /** Loudness adjustment (dB) wherever it plays. */
  trim: number;
}

export interface SampleDef extends SoundDef {
  file: string;
  /** Measured integrated loudness of the file (LUFS). */
  lufs: number;
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
  // The beginning's ring hall (src/levels/beginning/hallSound.ts): a bed, its whole length looped (gapless encode).
  'space-hall-ambience': { file: 'space-hall-ambience.mp3', lufs: -23.5, trim: 0, from: 'Veikko Suhonen, for dadajam' },
  // The net terminals (src/world/terminalSound.ts): a loop at the nearest one, its whole length (gapless encode).
  'terminal': { file: 'terminal.mp3', lufs: -23.5, trim: 0, from: 'Veikko Suhonen, for dadajam' },
  'combat-drums': { file: 'combat-drums.mp3', lufs: -23.4, trim: 0, loop: [0, 1333418 / 44100], from: 'harrisonlace, Cinematic drum loop Ares 127 (CC0)' },
  // Levelled hotter, to stand out over the guns. Bars of 1.6 s: the intro and part A, then part B loops.
  'epic-battle': { file: 'epic-battle.mp3', lufs: -20.0, trim: 0, loop: [9 * 1.6, 1764000 / 44100], from: 'Veikko Suhonen, for dadajam' },
  'death': { file: 'death.mp3', lufs: -23.2, trim: 0, loop: [0, 421707 / 44100], from: 'Veikko Suhonen, for dadajam' },
} satisfies Record<string, SampleDef>;

export type SampleId = keyof typeof SAMPLES;

export interface SynthDef extends SoundDef {
  /** What it sounds like, briefly. */
  what: string;
  /** The module that makes it (`defineSynth`). */
  by: string;
}

const GUN = 'src/gunSound.ts', RIFLE = 'src/rifleSound.ts', GUARDIAN = 'src/guardianSound.ts';

export const SYNTHS = {
  // Bosses
  'drone-launch': { trim: 0, what: "a carrier's gun drone out of the bay: a heavy latch letting go", by: 'src/carrierSound.ts' },
  'drone-aim': { trim: 0, what: 'a gun drone aiming for arg s: a whine climbing to the shot, pulsing faster', by: 'src/carrierSound.ts' },
  'drone-shot': { trim: 0, what: "a gun drone's shot: a sharp crack and a falling zap", by: 'src/carrierSound.ts' },
  'worm-tell': { trim: 0, what: 'the sand shivering before the worm bursts out, arg s from now: a swelling roar of low noise', by: 'src/wormSound.ts' },
  'worm-howl': { trim: 0, what: 'the worm bursting out: a long descending howl of metal (under a boom)', by: 'src/wormSound.ts' },
  'colossus-foot': { trim: 0, what: "the colossus's foot landing: a sub boom, a long rumble, iron joints clanking (arg 'big': the stomp, a crack)", by: 'src/colossusSound.ts' },
  'colossus-lift': { trim: 0, what: "a foot lifting: hydraulics venting, a sigh of steam (arg 'big': longer)", by: 'src/colossusSound.ts' },
  'colossus-tell': { trim: 0, what: 'the big stomp held overhead for arg s: a steam shriek rising, a servo groan', by: 'src/colossusSound.ts' },
  'colossus-charge': { trim: 0, what: "an arm pointing a hand volley, arg s till it fires: a servo groan, the palm's whine rising", by: 'src/colossusSound.ts' },
  'colossus-klaxon': { trim: 0, what: 'the shoulder pods opening, arg s till the first launch: a two-tone klaxon', by: 'src/colossusSound.ts' },
  'colossus-launch': { trim: 0, what: 'a missile leaving its pod: a cough, then a tearing roar fading as it climbs', by: 'src/colossusSound.ts' },
  'colossus-incoming': { trim: 0, what: 'a missile coming down in arg s: a whistle falling in pitch', by: 'src/colossusSound.ts' },
  'colossus-dying': { trim: 0, what: 'the furnace dying: a long falling groan', by: 'src/colossusSound.ts' },
  'colossus-collapse': { trim: 0, what: 'the colossus hitting the sand: a deep boom, a long rumble, debris clanking down', by: 'src/colossusSound.ts' },
  'queen-stab': { trim: 0, what: "the queen's foot stabbing in: steel into sand, a scrape, the spike ringing", by: 'src/queenSound.ts' },
  'queen-chitter': { trim: 0, what: 'the queen seeing someone: a big, slow rattle of clicks', by: 'src/queenSound.ts' },
  'queen-screech': { trim: 0, what: 'the queen rearing up: a driven metallic shriek over a hiss, for about arg s', by: 'src/queenSound.ts' },
  'queen-birth': { trim: 0, what: 'the sac opening over arg s: a groan of steam, a quickening scrabble inside', by: 'src/queenSound.ts' },
  'brood-drop': { trim: 0, what: 'a spiderling hitting the sand', by: 'src/queenSound.ts' },
  'brood-skitter': { trim: 0, what: 'spiderlings running: a few dry claw ticks', by: 'src/queenSound.ts' },
  'brood-crouch': { trim: 0, what: 'a spiderling crouching to spring: a sharp rising rattle', by: 'src/queenSound.ts' },
  'brood-pop': { trim: 0, what: 'a spiderling running down: a servo whine dying and a snap', by: 'src/queenSound.ts' },
  // Gear and the world's warnings
  'storm-pips': { trim: 0, what: "a storm on its way: three short pips like a wrist alarm", by: 'src/storm.ts' },
  'receiver-tick': { trim: 0, what: "the receiver's tick: a short sine at arg Hz (higher the nearer the signal)", by: 'src/receiver.ts' },
  'receiver-sweep': { trim: 0, what: 'the signal going out: a rising sweep with a warble', by: 'src/receiver.ts' },
  'shield-hit': { trim: 0, what: "a blow on the shield: a glassy ring (pitched by arg, the plate's tier) and a low thump", by: 'src/shieldFx.ts' },
  'shield-break': { trim: 0, what: 'the shield breaking: a crack, the ring and the thump', by: 'src/shieldFx.ts' },
  'jam-lost': { trim: 0, what: "the jammer's target dropping out: a falling chirp", by: 'src/jammer.ts' },
  // Interface, voice, body
  'plop': { trim: 0, what: 'an item moved in the inventory: a quick dropping sine, arg of them in a rising run', by: 'src/uiSound.ts' },
  'no-room': { trim: 0, what: 'no room for it: two soft low bonks, the second a fourth down', by: 'src/uiSound.ts' },
  'blip': { trim: 0, what: 'a letter of a subtitle typing out: a short soft beep (vowels a touch higher; arg: the letter)', by: 'src/speechSound.ts' },
  'rung': { trim: 0, what: "a hand (arg 'hand') or boot landing on a ladder's steel rung: a knock and a short ring", by: 'src/climbSound.ts' },
  // Guardians, crawlers, drones
  'footfall': { trim: 0, what: 'a heavy foot coming down: a thump, rumble and sand, the joints clanking', by: GUARDIAN },
  'boom': { trim: 0, what: "a bolt's or missile's blast: a footfall's boom twice over", by: GUARDIAN },
  'crawler-tick': { trim: 0, what: "a crawler's foot: a dry little tick of claw on sand", by: GUARDIAN },
  'crawler-rattle': { trim: 0, what: 'a crawler crouching to lunge: a dry rattle quickening to the spring in arg s', by: GUARDIAN },
  'crawler-chitter': { trim: 0, what: "a crawler going for you: a rattling chitter (arg 'bite': a snap of mandibles)", by: GUARDIAN },
  'cannon-charge': { trim: 0, what: "a guardian's cannon charging: a rising whine over arg s", by: GUARDIAN },
  'guardian-horn': { trim: 0, what: 'a guardian starting to hunt you: a low brass chord swelling and fading', by: GUARDIAN },
  'lock-chirp': { trim: 0, what: 'a drone locking on to you: two short rising chirps', by: GUARDIAN },
  // The rifle and what it does
  'rifle-charge': { trim: 0, what: 'the cell whining back up over arg s, then a click', by: RIFLE },
  'beam-impact': { trim: 0, what: "where the beam struck: arg 'sand' (a hiss), 'metal' (a ping), 'glass' (a weak point shattering, fizzing)", by: RIFLE },
  'swish': { trim: 0, what: 'a short swish of air: something thrown', by: RIFLE },
  'clank': { trim: 0, what: 'thrown junk striking a drone: a heavy clank', by: RIFLE },
  'leg-fail': { trim: 0, what: "a walker's leg giving out: a servo winding down, a clunk (arg 'light': a crawler's)", by: RIFLE },
  'hull-slam': { trim: 0, what: "a hull hitting the sand, plates clattering after (arg 'light': a small one)", by: RIFLE },
  // Heavy guns
  'graviton-shot': { trim: 0, what: 'a deep sub-bass drop under a high tearing shimmer', by: GUN },
  'graviton-impact': { trim: 0, what: 'a rushing inhale stopped dead, a thud and a ringing low hum', by: GUN },
  'piercer-shot': { trim: 0, what: 'a supersonic crack, a thump, ringing rails and a long rolling echo', by: GUN },
  'piercer-impact': { trim: 0, what: "the slug stopping: arg 'enemy' (a clang on plate), 'sand' (a thud), 'hard' (a crack)", by: GUN },
  'piercer-charge': { trim: 0, what: 'capacitors winding up over arg s, then the slug sliding in with a clack', by: GUN },
  'blaster-charge': { trim: 0, what: 'the heavy cell grinding back up over arg s, then a heavy latch', by: GUN },
} satisfies Record<string, SynthDef>;

export type SynthId = keyof typeof SYNTHS;
export type SoundId = SampleId | SynthId;
export type SoundRef = SoundId | { id: SampleId; slice: number };

export interface EventDef {
  sounds: SoundRef[];
  gain: number;
  pitch?: number;
  vary?: number;
  jitter?: number;
  route: Route;
  ref?: number;
  hear?: number;
  warning?: boolean;
  arg?: number | string;
  /** What plays it. */
  by: string;
}

const LASERS: SoundRef[] = ['laser-1', 'laser-2', 'laser-3'];
const FIREWORKS: SoundRef[] = ['firework-1', 'firework-2', 'firework-3', 'firework-4'];
/** The rifle's level (calibrated in the full mix, docs/audio.md) × the pulse samples' own lift. */
const SHOT = 0.3 * 1.3;
/** Firework bursts: full level within 35 m, heard 600 m off, a little off pitch each time. */
const BURST = { sounds: FIREWORKS, vary: 0.08, route: 'placed', ref: 35, hear: 600 } as const;

export const EVENTS = {
  // Guns (src/rifleSound.ts): the pulses, lower for heavier guns.
  'rifle.shot': { sounds: LASERS, gain: SHOT, vary: 0.04, route: 'placed', ref: 15, hear: 600, by: 'src/rifleSound.ts shot' },
  'pistol.shot': { sounds: LASERS, gain: SHOT * 0.75, pitch: 1.35, vary: 0.04, route: 'placed', ref: 15, hear: 600, by: 'src/rifleSound.ts shot (pistol)' },
  'blaster.shot': { sounds: LASERS, gain: SHOT * 1.5, pitch: 0.68, vary: 0.04, route: 'placed', ref: 20, hear: 700, by: 'src/rifleSound.ts blaster' },
  'cannon.shot': { sounds: LASERS, gain: 1.4, pitch: 0.5, vary: 0.05, route: 'placed', ref: 40, hear: 500, by: 'src/rifleSound.ts cannon (a guardian\'s)' },
  // Guardians, crawlers, drones (src/guardianSound.ts). A footfall's level × the foot's weight (the code passes it);
  // the gains are the full-mix calibration with simultaneous shots and blasts (docs/audio.md).
  'guardian.footfall': { sounds: ['footfall'], gain: 0.7, route: 'placed', ref: 12, hear: 500, by: 'src/guardianSound.ts footfall (walkers; shots hitting drones, jets, harvesters)' },
  'blast.boom': { sounds: ['boom'], gain: 0.7, route: 'placed', ref: 12, hear: 500, by: 'src/guardianSound.ts boom (bolts, missiles, crashes)' },
  'crawler.tick': { sounds: ['crawler-tick'], gain: 0.12, route: 'spatial', ref: 3, hear: 30, by: 'src/guardianSound.ts tick' },
  // The warning to move: on the protected bus, so it carries over the fight. arg: seconds to the spring.
  'crawler.rattle': { sounds: ['crawler-rattle'], gain: 0.12, route: 'placed', ref: 4, hear: 40, warning: true, arg: 0.6, by: 'src/guardianSound.ts rattle' },
  'crawler.chitter': { sounds: ['crawler-chitter'], gain: 0.05, route: 'spatial', ref: 4, by: 'src/guardianSound.ts chitter' },
  'crawler.bite': { sounds: ['crawler-chitter'], gain: 0.1, route: 'spatial', ref: 4, arg: 'bite', by: 'src/guardianSound.ts chitter (bite)' },
  'cannon.charge': { sounds: ['cannon-charge'], gain: 0.035, route: 'spatial', ref: 30, arg: 1.5, by: 'src/guardianSound.ts charge (arg: seconds)' },
  'guardian.horn': { sounds: ['guardian-horn'], gain: 0.22, route: 'spatial', ref: 60, by: 'src/guardianSound.ts horn' },
  'drone.lockOn': { sounds: ['lock-chirp'], gain: 0.07, route: 'direct', by: 'src/guardianSound.ts chirp' },
  // The carrier's gun drones (src/carrierSound.ts): set against the searchlight drones' buzz and a walker's charge
  // (the whine like a cannon's charge, the crack a short one-shot).
  'carrier.launch': { sounds: ['drone-launch'], gain: 0.12, route: 'spatial', ref: 40, by: 'src/carrierSound.ts launch' },
  'carrier.aim': { sounds: ['drone-aim'], gain: 0.035, route: 'spatial', ref: 18, arg: 1, by: 'src/carrierSound.ts aim (arg: seconds)' },
  'carrier.droneShot': { sounds: ['drone-shot'], gain: 0.14, route: 'spatial', ref: 20, by: 'src/carrierSound.ts shot' },
  // The worm (src/wormSound.ts; its breach and plunge also boom, blast.boom). Set against the guardians' footfalls.
  'worm.tell': { sounds: ['worm-tell'], gain: 0.9, route: 'placed', ref: 20, hear: 700, warning: true, arg: 1.72, by: 'src/wormSound.ts tell (arg: seconds to the breach)' },
  'worm.breach': { sounds: ['worm-howl'], gain: 0.5, route: 'placed', ref: 30, hear: 1500, by: 'src/wormSound.ts breach' },
  // The colossus (src/colossusSound.ts). A footfall's level × the foot's weight (to 1.5, the code passes it); the big
  // stomp's also hull-slams. The salvo and the volley set by ear against the tell and the footfalls.
  'colossus.footfall': { sounds: ['colossus-foot'], gain: 1.5, route: 'placed', ref: 25, hear: 1500, by: 'src/colossusSound.ts footfall' },
  'colossus.stomp': { sounds: ['colossus-foot'], gain: 1.5, route: 'placed', ref: 25, hear: 1500, arg: 'big', by: 'src/colossusSound.ts footfall (the big stomp)' },
  'colossus.lift': { sounds: ['colossus-lift'], gain: 0.12, route: 'placed', ref: 20, hear: 500, by: 'src/colossusSound.ts lift' },
  'colossus.liftBig': { sounds: ['colossus-lift'], gain: 0.24, route: 'placed', ref: 20, hear: 500, arg: 'big', by: 'src/colossusSound.ts lift (the big stomp)' },
  'colossus.tell': { sounds: ['colossus-tell'], gain: 0.35, route: 'placed', ref: 30, hear: 900, warning: true, arg: 2, by: 'src/colossusSound.ts tell (arg: seconds)' },
  'colossus.charge': { sounds: ['colossus-charge'], gain: 0.2, route: 'placed', ref: 30, hear: 1000, warning: true, arg: 1.5, by: 'src/colossusSound.ts charge (arg: seconds)' },
  'colossus.klaxon': { sounds: ['colossus-klaxon'], gain: 0.22, route: 'placed', ref: 40, hear: 1200, arg: 2, by: 'src/colossusSound.ts klaxon (arg: seconds)' },
  'colossus.launch': { sounds: ['colossus-launch'], gain: 0.5, route: 'placed', ref: 30, hear: 1500, by: 'src/colossusSound.ts launch' },
  'colossus.incoming': { sounds: ['colossus-incoming'], gain: 0.18, route: 'placed', ref: 20, hear: 400, arg: 1.5, by: 'src/colossusSound.ts incoming (arg: seconds)' },
  'colossus.dying': { sounds: ['colossus-dying'], gain: 0.6, route: 'placed', ref: 40, hear: 1500, by: 'src/colossusSound.ts dying' },
  'colossus.collapse': { sounds: ['colossus-collapse'], gain: 1.5 * 1.4, route: 'placed', ref: 40, hear: 2000, by: 'src/colossusSound.ts collapse' },
  // The brood queen and her spiderlings (src/queenSound.ts). Set against the guardians' (a footfall at 12 m ≈ −22
  // LUFS): a stab within 15 m a little under that, the screech poking above it briefly. A stab's level × its weight,
  // the skitter's × how many run (the code passes them).
  'queen.stab': { sounds: ['queen-stab'], gain: 0.5, route: 'placed', ref: 15, hear: 600, by: 'src/queenSound.ts stab' },
  'queen.chitter': { sounds: ['queen-chitter'], gain: 0.3, route: 'placed', ref: 30, hear: 700, by: 'src/queenSound.ts chitter' },
  'queen.screech': { sounds: ['queen-screech'], gain: 0.35, route: 'placed', ref: 40, hear: 1500, warning: true, arg: 1.1, by: 'src/queenSound.ts screech (arg: seconds)' },
  'queen.birth': { sounds: ['queen-birth'], gain: 0.3, route: 'placed', ref: 30, hear: 700, arg: 2.5, by: 'src/queenSound.ts birth (arg: seconds)' },
  'brood.drop': { sounds: ['brood-drop'], gain: 0.25, route: 'placed', ref: 6, hear: 90, by: 'src/queenSound.ts drop' },
  'brood.skitter': { sounds: ['brood-skitter'], gain: 0.25 * 0.5, route: 'placed', ref: 6, hear: 90, by: 'src/queenSound.ts skitter' },
  'brood.crouch': { sounds: ['brood-crouch'], gain: 0.25 * 1.3, route: 'placed', ref: 6, hear: 90, by: 'src/queenSound.ts crouch' },
  'brood.pop': { sounds: ['brood-pop'], gain: 0.25, route: 'placed', ref: 6, hear: 90, by: 'src/queenSound.ts pop' },
  // The rifle's synths (src/rifleSound.ts). Yours only; arg: seconds to charge.
  'rifle.charge': { sounds: ['rifle-charge'], gain: 0.035, route: 'direct', arg: 0.5, by: 'src/rifleSound.ts recharge' },
  'beam.sand': { sounds: ['beam-impact'], gain: 1.2, route: 'placed', ref: 4, hear: 400, arg: 'sand', by: 'src/rifleSound.ts impact' },
  'beam.metal': { sounds: ['beam-impact'], gain: 1.2, route: 'placed', ref: 10, hear: 400, arg: 'metal', by: 'src/rifleSound.ts impact' },
  'beam.glass': { sounds: ['beam-impact'], gain: 1.2, route: 'placed', ref: 10, hear: 400, arg: 'glass', by: 'src/rifleSound.ts impact (a weak point)' },
  'throw.swish': { sounds: ['swish'], gain: 0.6, route: 'placed', ref: 4, hear: 80, by: 'src/rifleSound.ts swish (src/throw.ts)' },
  'throw.clank': { sounds: ['clank'], gain: 1.2, route: 'placed', ref: 12, hear: 400, by: 'src/rifleSound.ts clank' },
  'legFail.heavy': { sounds: ['leg-fail'], gain: 1.8, route: 'placed', ref: 14, hear: 500, by: 'src/rifleSound.ts fail (a guardian)' },
  'legFail.light': { sounds: ['leg-fail'], gain: 1.8 * 0.4, route: 'placed', ref: 3, hear: 60, arg: 'light', by: 'src/rifleSound.ts fail (a crawler)' },
  'slam.heavy': { sounds: ['hull-slam'], gain: 1.8 * 1.4, route: 'placed', ref: 16, hear: 800, by: 'src/rifleSound.ts slam (a guardian, a jet, a harvester, a carrier)' },
  'slam.light': { sounds: ['hull-slam'], gain: 1.8 * 0.45, route: 'placed', ref: 3, hear: 80, arg: 'light', by: 'src/rifleSound.ts slam (a crawler, a drone, a plane\'s piece)' },
  // Heavy guns (src/gunSound.ts), synthesised; levels from the `blaster`, `graviton`, `piercer` captures (docs/audio.md).
  'graviton.shot': { sounds: ['graviton-shot'], gain: 0.2, route: 'placed', ref: 15, hear: 700, by: 'src/gunSound.ts gravitonShot' },
  'graviton.impact': { sounds: ['graviton-impact'], gain: 0.33, route: 'placed', ref: 18, hear: 600, by: 'src/gunSound.ts gravitonImpact' },
  'piercer.shot': { sounds: ['piercer-shot'], gain: 0.37, route: 'placed', ref: 20, hear: 1200, by: 'src/gunSound.ts piercerShot' },
  'piercer.impact': { sounds: ['piercer-impact'], gain: 0.5, route: 'placed', ref: 12, hear: 600, arg: 'enemy', by: 'src/gunSound.ts piercerImpact (arg: what it hit)' },
  // Yours only; arg: seconds to charge (the gun's cooldown).
  'piercer.charge': { sounds: ['piercer-charge'], gain: 0.005, route: 'direct', arg: 3, by: 'src/gunSound.ts piercerCharge' },
  'blaster.charge': { sounds: ['blaster-charge'], gain: 0.012, route: 'direct', arg: 2, by: 'src/gunSound.ts recharge' },
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
  'footstep.sand': { sounds: ['footsteps'], gain: 0.2, vary: 0.08, jitter: 0.15, route: 'panned', ref: 2.5, hear: 30, by: 'src/footsteps.ts step' },
  'footstep.concrete': { sounds: ['footsteps-concrete'], gain: 0.45, vary: 0.08, jitter: 0.15, route: 'panned', ref: 2.5, hear: 30, by: 'src/footsteps.ts step (in shelters)' },
  // Gear and warnings, yours only. The storm's pips: at the default volume a burst peaks at −27.5 LUFS momentary.
  'storm.warning': { sounds: ['storm-pips'], gain: 0.5, route: 'direct', by: 'src/storm.ts beep' },
  'receiver.tick': { sounds: ['receiver-tick'], gain: 0.13, route: 'direct', arg: 1000, by: 'src/receiver.ts tick (arg: Hz)' },
  'receiver.sweep': { sounds: ['receiver-sweep'], gain: 0.12, route: 'direct', by: 'src/receiver.ts sweep' },
  // The shield's parts balanced within (−24.7 LUFS together at the wearer, Space-grade); the code passes the level (1 at
  // the wearer, less further off) and the plate's tier.
  'shield.hit': { sounds: ['shield-hit'], gain: 1, route: 'direct', arg: 2, by: 'src/shieldFx.ts sound' },
  'shield.break': { sounds: ['shield-break'], gain: 1, route: 'direct', arg: 2, by: 'src/shieldFx.ts sound (it breaks)' },
  'jammer.lost': { sounds: ['jam-lost'], gain: 0.12, route: 'direct', by: 'src/jammer.ts chirp' },
  // Interface and voice, yours only; levels measured offline (src/uiSound.ts, src/speechSound.ts).
  'ui.plop': { sounds: ['plop'], gain: 0.2, vary: 0.06, route: 'direct', arg: 1, by: 'src/uiSound.ts plop (arg: items moved)' },
  'ui.full': { sounds: ['no-room'], gain: 0.18, route: 'direct', by: 'src/uiSound.ts full' },
  'speech.blip': { sounds: ['blip'], gain: 0.045, vary: 0.06, route: 'direct', arg: 'a', by: 'src/speechSound.ts blip (arg: the letter)' },
  // A ladder's rungs: yours head-locked, others' placed (src/climbSound.ts); the knocks' levels are in the synth.
  'climb.hand': { sounds: ['rung'], gain: 1, vary: 0.06, route: 'spatial', ref: 2.5, hear: 30, arg: 'hand', by: 'src/climbSound.ts land' },
  'climb.foot': { sounds: ['rung'], gain: 1, vary: 0.06, route: 'spatial', ref: 2.5, hear: 30, arg: 'foot', by: 'src/climbSound.ts land' },
  'pickup': { sounds: ['pickup'], gain: 0.2, vary: 0.06, jitter: 0.1, route: 'direct', by: 'src/pickupSound.ts' },
  // Yours dry and centred; another player's placed (`ref`, `hear`).
  'drink.gulps': { sounds: ['drink'], gain: 0.7, vary: 0.04, route: 'placed', ref: 1.5, hear: 30, by: 'src/drinkSound.ts drink' },
  'drink.sigh': { sounds: ['sigh'], gain: 0.4, vary: 0.04, route: 'direct', by: 'src/drinkSound.ts done' },
  'well.pour': { sounds: ['fill'], gain: 0.5, route: 'placed', ref: 1.5, hear: 30, by: 'src/drinkSound.ts fill' },
  'teardown.tink': { sounds: [{ id: 'teardown-clang', slice: 0 }], gain: 0.25, vary: 0.1, jitter: 0.15, route: 'direct', by: 'src/teardownSound.ts hit' },
  'teardown.clink': { sounds: [{ id: 'teardown-clang', slice: 1 }], gain: 0.35, vary: 0.1, jitter: 0.15, route: 'direct', by: 'src/teardownSound.ts hit' },
  'teardown.soft': { sounds: [{ id: 'teardown-clang', slice: 2 }], gain: 0.5, vary: 0.1, jitter: 0.15, route: 'direct', by: 'src/teardownSound.ts hit' },
  'teardown.clang': { sounds: [{ id: 'teardown-clang', slice: 3 }], gain: 0.4, vary: 0.1, jitter: 0.15, route: 'direct', by: 'src/teardownSound.ts hit' },
  'teardown.bolt': { sounds: ['teardown-bolt'], gain: 0.35, vary: 0.08, route: 'direct', by: 'src/teardownSound.ts turn (rings while you circle)' },
  // Vehicles: how rough the landing was filters it (src/bikeLandSound.ts).
  'bike.land': { sounds: ['bike-crash'], gain: 0.45, vary: 0.05, jitter: 0.1, route: 'panned', ref: 4, hear: 60, by: 'src/bikeLandSound.ts play' },
  // Music (src/music.ts states; the landing page plays the ambience too, src/landing.ts).
  'music.ambient': { sounds: ['desert-ambience'], gain: 0.45, route: 'music', by: 'src/music.ts (out on the surface, sunrise), src/landing.ts' },
  'music.combat': { sounds: ['combat-drums'], gain: 0.55, route: 'music', by: 'src/music.ts (something is after you)' },
  'music.epic': { sounds: ['epic-battle'], gain: 0.7, route: 'music', by: 'src/music.ts (a boss, a guardian close by)' },
  'music.death': { sounds: ['death'], gain: 0.55, route: 'music', by: 'src/music.ts (you died)' },
  // A server rack's door aboard the ring (src/levels/beginning/rackDetail.ts): its latch, lower opening than shutting.
  'rack.open': { sounds: ['pickup'], gain: 0.22, pitch: 0.7, vary: 0.05, route: 'direct', by: 'src/levels/beginning/index.ts (OpenRacks)' },
  'rack.shut': { sounds: ['pickup'], gain: 0.28, pitch: 0.85, vary: 0.05, route: 'direct', by: 'src/levels/beginning/index.ts (OpenRacks)' },
  // Level beds, looped while you're in the level.
  'beginning.hall': { sounds: ['space-hall-ambience'], gain: 0.3, route: 'direct', by: 'src/levels/beginning/hallSound.ts (the ring hall, quiet under everything)' },
  // Props' loops, at the nearest one in earshot.
  'terminal.hum': { sounds: ['terminal'], gain: 0.25, route: 'spatial', ref: 1.5, hear: 12, by: 'src/world/terminalSound.ts (the nearest net terminal, quiet: full within 1.5 m, gone by 12 m)' },
} satisfies Record<string, EventDef>;

// BEDS: the continuous synthesised beds of the levels, each part's level (linear, at volume 1, × the master slider; 1
// is the part as built). Read every frame by the modules in `by`, so a change here (or live, `dbg.beds` with ?debug) is
// heard at once. Measured offline: docs/audio.md "The datacenter's bed", "The beginning's fall".
// - a datacenter bed (src/levels/datacenter/ambience.ts): `level` the whole bed; `fans` the air (filtered pink noise),
//   `hum` the mains hum, `units` the cooling units' slow-beating rumble (in the datacenter: louder by the north wall),
//   `ups` the UPS room's transformer (only in there), `chatter` the disk-seek ticks' peak (all × `level`).
// - the fall (src/levels/beginning/sound.ts): `roar` and `groan` at full rumble (they grow with the beat, all the way
//   in the ride), `boom` a jolt's peak, `chime` the station's two notes' peak, `pod` the pod opening's sounds' peaks.
export interface DcBedDef { level: number; fans: number; hum: number; units: number; ups: number; chatter: number; by: string }
export interface FallDef { roar: number; groan: number; boom: number; chime: number; pod: Record<'click' | 'clunk' | 'wake' | 'hiss' | 'servo' | 'thud', number>; by: string }

export const BEDS: { datacenter: DcBedDef; beginning: DcBedDef; fall: FallDef } = {
  datacenter: { level: 0.34, fans: 1, hum: 0.05, units: 1.1, ups: 1.3, chatter: 0.25, by: 'src/levels/datacenter/index.ts; at its door, low-passed: src/world/entrance.ts' },
  // Aboard the ring the fans sit under the hall's recording ('beginning.hall'): quieter, the units an even rumble.
  beginning: { level: 0.17, fans: 0.4, hum: 0.05, units: 0.3, ups: 0, chatter: 0.25, by: 'src/levels/beginning/index.ts' },
  fall: {
    roar: 0.55, groan: 0.33, boom: 0.9, chime: 0.05,
    pod: { click: 0.55, clunk: 1.2, wake: 0.1, hiss: 0.22, servo: 0.12, thud: 1.1 },
    by: 'src/levels/beginning/sound.ts',
  },
};

export type EventId = keyof typeof EVENTS;

/** An entry, by id (typed as the common shape). */
export const sample = (id: SampleId): SampleDef => SAMPLES[id];
export const synth = (id: SynthId): SynthDef => SYNTHS[id];
export const event = (id: EventId): EventDef => EVENTS[id];
export const isSample = (id: SoundId): id is SampleId => id in SAMPLES;
export const isSynth = (id: SoundId): id is SynthId => id in SYNTHS;
export const sound = (id: SoundId): SoundDef => (isSample(id) ? SAMPLES[id] : SYNTHS[id]);
export const soundId = (r: SoundRef): SoundId => (typeof r === 'string' ? r : r.id);
/** A reference that must be a sample (a module that plays its event's file itself). */
export const sampleId = (r: SoundRef): SampleId => {
  const id = soundId(r);
  if (!isSample(id)) throw new Error(`${id} is not a sample`);
  return id;
};
/** A sound's trim (dB) as a gain. */
export const trimGain = (id: SoundId) => 10 ** (sound(id).trim / 20);
/** A sample's URL (relative: served under /dadajam/). */
export const sampleUrl = (id: SampleId) => `./audio/${SAMPLES[id].file}`;
