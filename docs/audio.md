# Audio levels and repeatable full-mix measurements

The project targets about **−23 LUFS integrated (±2)** for a representative mix at the default master volume
of **0.4**, with **true peak no higher than −1 dBTP**. Quiet exploration and ambience remain quieter than combat;
the target is not a requirement to make every background bed or short passage equally loud. Both volume controls
only attenuate their reference level (1.0).

The measurement definitions come from [ITU-R BS.1770-5](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I) and
[EBU R 128](https://tech.ebu.ch/docs/r/r128.pdf). The project's ±2 LU tolerance is its own working tolerance.
[EBU Tech 3343](https://tech.ebu.ch/docs/tech/tech3343.pdf) explains the distinction between programme loudness,
short-term variation and true-peak headroom. Our meter is FFmpeg's
[`ebur128` filter](https://ffmpeg.org/ffmpeg-filters.html#ebur128), with reconstructed true-peak measurement enabled.

## Running the measurement

Start Vite, then run the browser capture tool; no game server or graphics renderer is needed:

```sh
npx vite --host 127.0.0.1 --port 5179
node tools/audio-measure.mjs --base http://127.0.0.1:5179/ --out /tmp/paahde-audio
```

Chrome and FFmpeg must be installed. Pass `--chrome <path>` if Chrome is not at a usual location. The runner uses
an isolated browser profile, starts audio with an actual CDP mouse press, captures the real graph after the master
limiter and closes its own browser. System speaker output is muted; the recorded samples precede device volume.
Keep the source tree stable during a run, or serve Vite with `server.hmr: false` so edits do not reload a capture.

Defaults are four scenarios, each at master volume 0.4 and 1, with music volume 1. A fresh page and fixed random
seed are used for each capture. After 3.5 seconds of settling, the tool records 20 seconds of stereo float32 PCM.
It writes WAV files, the FFmpeg meter output and `report.json` with browser version, source revision, dirty-tree
status, voice/echo pressure and any browser errors. It also measures equal-duration concatenations of the chosen
scenarios; these are a comparison fixture, not a measured distribution of players' time.

```sh
# Isolate the actual source graphs to find what dominates a mix.
node tools/audio-measure.mjs --scenarios combat --volumes 0.4 --seconds 8 \
  --components 'music;shots;steps;booms;tells;drones;crawler' --out /tmp/paahde-components

# Measure an existing capture directly.
ffmpeg -i /tmp/paahde-audio/combat-0_4.wav -af ebur128=peak=true -f null -
```

Commas combine components; semicolons start separate captures. Valid components are `ambience`, `music`, `shots`,
`steps`, `booms`, `tells`, `drones` and `crawler`. `--seconds` accepts 1–60, and `--volumes` accepts values above
zero through one. Measurements with intentionally disabled components are diagnostic, not full mixes.

## Scenarios and results, 25 October 2026

The fixture stands at a fixed generated spawn. Exploration uses an 8 m/s regional wind and ambient music;
storm uses 23 m/s wind and the game's storm music policy (silence). Combat adds a local rifle shot every 0.4 s,
a walker footfall every 1.2 s at about 23 m, a blast every 2.7 s at about 36 m, a worm warning every 6 s at
about 38 m, one drone and epic music. Multiplayer adds three remote shooters at 25–65 m, three drones and storm
wind. The final combat captures also include a nearby crawler's lunge warning (`LUNGE_WIND_MS`, 500 ms then) every 5 s.

Measured with Chrome 156 on macOS, 48 kHz PCM and FFmpeg 9.0.2:

| Scenario | Default 0.4: LUFS | Default: dBTP | Reference 1: LUFS | Reference: dBTP |
| --- | ---: | ---: | ---: | ---: |
| Exploration | −35.0 | −15.9 | −27.2 | −7.9 |
| Storm | −37.0 | −26.3 | −29.1 | −18.1 |
| Combat, calibrated | −23.7 | −6.6 | −16.0 | −2.6 |
| Multiplayer, calibrated | −22.0 | −7.0 | −14.4 | −2.2 |

Exploration and storm were captured before the combat-only gain changes; their source levels are unchanged.
The reference-volume rows check peak headroom; the integrated loudness target applies at the default volume.
No browser/worklet errors were reported. AudioContext reported 5.33 ms base latency and 32 ms output latency on
this machine; these are device/context reports, not an end-to-end input-to-sound latency measurement.

Before calibration, the default combat and multiplayer mixes measured **−18.5 and −16.5 LUFS**. Isolating the
graphs identified continuous rifle fire (−19.6 LUFS alone) and repeated footfalls (−22.4) as the dominant sources;
music was −28.6, blasts −25.5 and drones −32.5. Shot gain changed from 0.75 to 0.3 and footfall gain from 1.4 to
0.7 (blasts use those footfalls). Music, ambience and warning levels were not boosted. These gains are in
`src/rifleSound.ts` and `src/guardianSound.ts`.

The first and calibrated capture sets are `/tmp/dadajam-audio-20261025` and
`/tmp/dadajam-audio-calibrated-20261025` on the review machine. They are local artifacts, not repository assets;
use the command above to regenerate them. The six-source isolation set is
`/tmp/dadajam-audio-components2-20261025`.

## Samples, events and the workbench

Every sample file and every sound event that plays one is in `src/audioConfig.ts`: a sample's measured loudness
(`lufs`) and `trim` (dB, applied wherever it plays), an event's samples, `gain`, pitch and spread, route and reach.
Swap an event's sound or rebalance a sample there, not in the module that plays it. `npm test`
(`tools/audio-config.test.mjs`) checks every file in `public/audio/` is listed, every `lufs` against ffmpeg, and that
no code loads a sample by file name. Synthesised sounds (wind, engines, guardians, the guns' whines) keep their
levels in their own modules.

The audio workbench (`?debug`, F3 → Sound → Audio workbench, `src/audioBench.ts`) plays any event or sample through
the real graph (placement, reverb, echoes, buses, limiter) from a spot round you, and edits trims and event fields
live; "Copy edits" lists the changes to carry into the config. Listening there is for balancing a sound against its
set and its neighbours; the full-mix numbers below still come from the capture tool.

## Routing, headroom and budgets

`src/audio.ts` owns the master gain, compressor, finite-sample guard and final AudioWorklet limiter. The limiter
(`src/limiterKernel.mjs`) is stereo-linked, uses four-phase reconstruction to detect intersample peaks, looks
ahead about 4 ms and reserves a −1.5 dB ceiling. Pre-calibration stress captures at reference volume reached
**−1.5 dBTP**; the calibrated captures above stay lower. `tools/audio-limiter.test.mjs` also exercises impulses,
overload, non-finite input and quiet stereo preservation. If the worklet is unavailable, the compressor fallback
still plays audio, but that fallback is not covered by the measured ceiling; the capture tool rejects it.

Important one-shots use the protected warning bus and briefly attenuate competing effects, music and ambience.
Crawler lunge rattles and worm tells participate in that path. Shared desert/canyon reverb always returns to the
effects bus, even if the first sound in a context is a warning; its direct warning remains protected.

`src/audioBudget.ts` bounds transient voices and discrete echoes. Reservations for rifle/pistol shots, cannons,
fireworks, footfalls and crawler warnings follow their actual source lifetimes; echo reservations add their travel
delay. Keeping a completed half-second shot reserved for eight seconds falsely exhausted the budget: the original
multiplayer fixture reached 80 voices and dropped 28 reservations. The calibrated fixture peaked at **15 voices,
zero drops** (solo: 8). The fixture site produced no discrete rock echoes, so this is not an echo-saturation test.
Routing and source-lifetime regressions are checked in `tools/acoustics-routing.test.mjs` and
`tools/rifle-audio.test.mjs`; priority/expiry and shelter obstruction have separate audio tests.

## The datacenter's bed (28 October 2026)

The datacenter (docs/levels/datacenter.md) is a synthesised bed, `src/levels/datacenter/ambience.ts` `buildBed`, built on
any `BaseAudioContext`. It was levelled by rendering 20 s of it offline in Chrome (`OfflineAudioContext`, 48 kHz, mono
into the BS.1770 K-weighting as two `IIRFilterNode`s, 400 ms blocks, absolute and relative gating, +3 dB for the two
equal channels it plays on), at master volume 0.4, chatter every 4 s. With `?debug` the page exposes `dbg.dcBed`
(`buildBed`, `BED`) to repeat it. Results with `BED` 0.34: −29.9 LUFS mid-hall, −28.4 by the cooling units, −29.2 in
the UPS room; sample peak −9.3 dBFS at volume 1. This is the bed alone, not the captured post-limiter mix; footsteps and
music add to it. Near the desert door the same bed plays low-passed, at most 0.45 of that level.

## The beginning's fall (28 October 2026)

The beginning (docs/levels/tutorial.md) plays the datacenter's bed and over it `src/levels/beginning/sound.ts`
`buildFall`: a low roar and a groan set by how far you are (`rumble`, the beat; `ROAR × rumble²` and `ROAR × 0.6 ×
rumble`), a boom at the hall's jolt, a two-note chime every 5 s in the bay corridor. Measured as the datacenter's bed was
(offline, 48 kHz, K-weighted, gated, +3 dB for the two channels; `?debug` `dbg.fall()` loads it), at master volume 0.4,
the fall alone: −48.6 LUFS at rumble 0.3 (the control room), −38.9 at 0.55 with the chime (the bay corridor), −29.5 at
1 (the ride down); sample peak −8.2 dBFS at volume 1 with the boom and a chime. Aboard, the datacenter's bed plays
6 dB down (`BED × 0.5`, about −36: at full level it drowned the station; 1 November 2026), so the ride sums to about
−28.6: under the −23 target, a bed and not a scene.

The pod opening (`pod(cue)`: the relay's click, the cover's clunk, the wake chirp, the seal's hiss over the hatch's
motor, the hatch's thud; src/levels/beginning/pod.ts times them over 3.2 s), the five cues alone, rendered the same way:
−31.1 LUFS integrated over 4.5 s at master volume 0.4, momentary at most −28.0 (the clunk and the hiss), true peak
−11.2 dBTP (−3.3 at volume 1). One-shots a little over the bay's bed, as foley should be.

## The heavy guns (2 November 2026)

`src/gunSound.ts` (the blaster's shot, burst and recharge; the graviton pistol's shot and impact) was levelled with the
capture tool above: two scenarios in `tools/audio-bench.ts`, `blaster` and `graviton`, are the combat fixture with
that gun fired at its cooldown (1.4 s, 0.6 s) in place of the rifle, every shot striking 25 m off (the blaster's burst
on sand, its recharge whine running). Chrome on macOS, 48 kHz, `--seconds 20` (isolations 12):

| Capture | Default 0.4: LUFS | Default: dBTP | Reference 1: LUFS | Reference: dBTP |
| --- | ---: | ---: | ---: | ---: |
| Combat (rifle), for comparison | −23.8 | −7.1 | −16.0 | −2.5 |
| Blaster, full mix | −23.9 | −6.2 | −16.2 | −2.3 |
| Graviton, full mix | −22.8 | −9.1 | −15.1 | −2.8 |
| Blaster's sounds alone (`--components shots`) | −25.2 | −10.1 | | |
| Graviton's sounds alone | −25.0 | −12.3 | | |

The first gains (`LEVEL` in src/gunSound.ts about 2.8× today's) put the blaster's sounds alone at −16.0 LUFS (−1.8
dBTP, the limiter working) and the full mix at −17.3; they were brought down to sit at about the rifle fire's share
(−27.7 alone at 2.5 shots/s) plus the few dB a heavier, slower gun earns. Peak voices 9 (blaster) and 13 (graviton),
no drops. Captures: `/tmp/a73d-audio-3`, `/tmp/a73d-audio-c3` (local).

Since 4 November 2026 the blaster's shot is the rifle's laser pulse pitched down (src/rifleSound.ts `blaster`,
`BLASTER_PITCH` 0.68, `BLASTER_GAIN`) and its bolt's burst is a missile's explosion (`gunSound.explosion`: the bolt
boom and a low firework), so the table's blaster rows predate that; the levels were set from the rifle's and the
missile's calibrated ones and not yet re-captured.

## The piercer (3 November 2026)

`src/gunSound.ts` piercerShot (crack, thump, ringing rails, a rolling echo of nine ever duller taps over a 3 s
rumble), piercerImpact (here on plate, 25 m off) and piercerCharge (the whine through the 2.6 s reload, the clack)
were levelled with the `piercer` scenario of `tools/audio-bench.ts` (combat with the piercer fired at its cooldown).
Chrome on macOS, `--seconds 20` (isolation 12):

| Capture | Default 0.4: LUFS | Default: dBTP | Reference 1: LUFS | Reference: dBTP |
| --- | ---: | ---: | ---: | ---: |
| Combat (rifle), for comparison | −23.8 | −7.8 | −16.1 | −1.8 |
| Blaster, for comparison | −23.9 | −6.8 | −16.2 | −2.5 |
| Piercer, full mix | −24.3 | −6.5 | −16.7 | −1.5 |
| Piercer's sounds alone (`--components shots`) | −25.8 | −6.4 | | |

The first gains (shot 0.14, impact 0.2) put its sounds alone at −35.5 LUFS: a short loud crack every 2.6 s gated out
by the quiet between. The roll and rumble were raised (the tail now falls from about −23 to −43 LUFS momentary over a
second instead of a third of one) and the gains set to 0.37 and 0.5, the whine lowered to 0.005 (it had sat over the
tail). Peak voices 9, no drops. Captures: `/tmp/piercer-audio-5`, `/tmp/piercer-audio-c5` (local).

Note: Vite's dev watcher ignores `.claude/**`, so a capture served from an agent worktree runs stale code after an
edit; restart Vite between gain changes there.

## Limits of these numbers

These are scripted scenes using the game's actual sound entry points, not recordings of a complete multiplayer
session. They do not cover every boss attack, every distance/enclosure, a large simultaneous warning burst,
vehicle/teardown/water/UI sounds, real network timing or every audio device/browser. Source load timing and
real-time scheduling introduce small variations even with a fixed random seed. Eight-second isolated captures
identify dominant contributors; their loudness ranges are too short to characterize a whole play session.

For another sound or mix change, repeat these captures, inspect true peaks, and listen in representative play.
Add the affected encounter to the fixture when it could produce a new loudest combination. Preserve the quiet
desert and warning audibility instead of normalizing every scene independently to the same number.
