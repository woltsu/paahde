# The runner

The runner is an enemy that hunts players out in the open desert. The server (`server/runners.ts`) owns where each one
is and what it does; clients draw it from the 'bots' message (its model, rig, gait and animations are client-side).
This page covers both: how it hunts and fights (first), and what the view needs and does. Numbers are in **world metres**
unless marked *model units*: the model is built at half size and drawn at `RUNNER.scale` = 2.

See it: `models-lab.html?runner` (four at once), `?runner=prowl`, `?runner=armed`, `?runner=16` (follow one at
16 m/s), `?runner=stab` (gun stabilisation side by side); those are drawn only, driven by the show's `Prowl`. In game
(`?debug`, F3): Spawn → **Runner** / **Runner (rifle)**: one 45 m from you, hunting you (the server's, everyone sees it).

## How it hunts (server/runners.ts)

- **Meeting one:** every 5–11 min (`GAP_MIN_MS..GAP_MAX_MS`; the first 2–5 min in) one is sent for someone out in the
  open desert past `KEEP_OUT` (250 m) from the start, day or night, a third of them armed (`ARMED_ODDS`); at most two
  out. It comes from 220–300 m off at a trot (a gallop when far), and once it sees them (`SIGHT` 110 m, line of sight
  from its eyes to their chest) it hunts them.
- **Stalking:** legs like the show's driver: a sprint a third to two thirds of a lap round them (via a point halfway
  round, so it never cuts across them), a prowl to a spot a little in or out, a stop to stare (jaws snapping), on a
  ring 24–38 m out.
- **Charging (plain):** after `STALK_MS` (6–11 s) it charges flat out (16 m/s) at where they'll be (led by their way,
  up to 0.5 s). Within `COMMIT_R` (14 m) it **commits**: no more turning. Its jaws bite whoever they pass within
  `BITE_R` (1.4 m) of **where clients draw them** (`BOT_DELAY_MS` behind), so a step aside as you see it come (the
  jaws ~6 m off on your screen) makes it miss by ~2 m. One bite kills (`hurt(.., 'runner', KILL)`). A bite or a miss
  and it pulls up (`R_RECOVER`, ~1 s), turns and comes again, three charges, then stalks a while.
- **Shooting (armed):** it keeps 45–75 m off (`KEEP_MIN..KEEP_MAX`). It goes to a spot on its ring, stops, raises the
  gun (`GUN_RAISE_MS`), charges it (`GUN_CHARGE_MS`, clients whine) and fires a guardian's bolt at your chest every
  `GUN_FIRE_MS` while it sees you within `FIRE_R` (110 m), 2–3 shots, then sprints round to another spot. The bolts
  are the guardians' (`server/guardians.ts` bolts, 'shot' with `r`): sidestep them; a hit or a blast kills ('laser').
- **Close in:** anyone within `CLOSE_R` (9 m) of either kind is charged at once.
- **Giving up:** lost from sight for 8 s, further than 260 m, after 150 s, or once you're indoors or dead: it trots off
  (`R_LEAVE`). Gone with nobody within 700 m. A storm front's static seizes it where it stands.
- **Weak points** (`RUNNER_POINTS`, the 'fire' `ri`): the **eye cluster** (3 rifle hits, from the front, as it charges
  you), the **flank vents** (2 each, side on, as it circles you), and the armed one's **gun core** at the back of its
  gun (2: the gun goes quiet and it charges instead). Eyes out, or both vents, and it dies. Its hull is a walker's plate
  (`ARMOR.plate`): the rifle and pistol only ring off it (and anger it), the piercer takes 3 slugs, the graviton pistol
  one. The blaster's burst hurts weak points within its radius. Any hit turns it on the shooter.
- **Hits are checked** against where it was over the last second (its history: as clients drew it): a weak point within
  1.6 m (the gun core 2.6 m, it swings about on the arm), the hull within its box.
- **Death and loot:** it slumps where it fell (lying `WRECK_MS`, 90 s) and leaves its spoils (`shared/enemies.ts`
  runner, `shared/lootRoll.ts` `runnerDrops`, `shared/tables.ts` `RUNNER_SPOILS`, `RUNNER_GUN_SPOILS`): drive parts,
  the armed one's gun parts maybe, a servo heart now and then, a broken receiver rarely, two wiring.
- **Tests:** `tools/runner.test.mjs` (bite, dodge, weak points vs plate, the armed one shooting and giving up, spawning).

## Sync and the view

'bots' `r` (`RUNNER_STRIDE`, shared/runner.ts): id, kind, x, z, yaw, state, hunt (2: you), look and its point, gun
(-1 carried, 0 raised, 1 charging), broken, dead (s), snap (its last bite). `runnersAt` (src/world/botFrames.ts)
interpolates it `BOT_DELAY_MS` behind like the walkers; `Runners` (src/world/runner.ts) drives a `Runner` per one:
`alert` while charging, `look` while it stares, aims or charges, `charging` for the coils, `fire()` on the 'shot',
`snap()` on a new bite, `dead` for the slump (body down onto its belly, rolled, eyes out, jaws slack). The rifle tests
shots against `Runner.raycast` (boxes: hull, head, eyes, vents, gun housing and core; a weak point counts reached no
more than 0.25 m past the armour round it). `GuardianFx.updateRunners` (src/guardians.ts) does the rest: aggro
('runner' speech), combat, kills, the gun's whine and shot, bites, deaths, footfalls and dust.

## What it is

A four-legged hunting robot far bigger than a horse, laid out like Boston Dynamics' Spot (a long box body, a hip at
each corner, every knee bending backwards) and built to frighten:

- an armoured hull with blade fins down the spine and glowing red vents on its flanks;
- a low scowling head with **eight red eyes** in a spider's cluster;
- two great hinged **insect jaws**: curved pincers with a big tooth at the root, serrated inside, tips crossing in
  front of the snout;
- bladed, spurred shins ending in claws; two red-tipped antennae at the tail.

Bigger than a crawler (a player-sized spider), nothing like a guardian (hips ~20 m).

**Two kinds** (`RunnerKind`, shared/runner.ts):

- `'plain'`: as above.
- `'armed'`: the same body with a turret ring on its back (where the middle spine blades were) and a **robotic arm**
  carrying a heavy **rail gun**. The gun is a broad flat armoured housing with heat-sink fins and a glowing core,
  capacitor pods ringed with coils down its flanks, and twin rails ahead with a glowing channel between them. It is
  held at its balance point on a rail mount under its belly.

## Dimensions (world, standing on level ground)

| | |
|---|---|
| Body centre height | 2.3 m |
| Hull | ~4.1 m long, ~1.3 m wide, ~0.9 m deep |
| Top of spine fins | ~3.2 m |
| Head | pivot at ~2.4 m, ~2.0 m ahead of the body centre; eyes ~2.3–2.5 m up, facing forward and a little down |
| Jaws | ~1.5 m each, hinged on the cheeks; tips ~4.1 m ahead of the body centre when shut |
| Overall length | ~5.2 m (rear of the hull to the snout), ~6.2 m to the jaw tips, ~6.9 m counting the tail antennae |
| Stance | feet at rest ±1.0 m to the sides, ~1.5 m ahead and behind the centre (~2 m wide, ~3 m long footprint) |
| Legs | thigh 1.44 m, shin 1.56 m (claw tip to knee) |
| Armed: gun | ~4.2 m long, ~1.0 m wide; its pivot (the wrist) ~4.3 m up when carried, ~4.6 m when aiming; muzzle ~5 m up when aiming |

Suggested hit volumes (none exist yet): a box or capsule for the hull around the body centre, a sphere for the head,
a thin capsule per leg segment (the rig gives every joint's world position), and for the armed one a box for the gun.
The client knows the posed parts exactly. Guardians handle this the same way: the client tests shots against the drawn
pose (src/world/guardians.ts `raycast`), and the server checks what it can.

## Movement

Speeds (shared/runner.ts):

| | m/s | gait |
|---|---|---|
| `RUNNER_WALK` | 3 | walk (feet down 62% of a stride) |
| `RUNNER_TROT` | 7 | trot (diagonal pairs) |
| `RUNNER_GALLOP` | 10 | trot has become a gallop by here |
| `RUNNER_SPRINT` | 16 | flat-out gallop (outruns a running player, 7.5, and a sliding one, 15) |

The **gait is entirely client-side** and needs nothing from the server but the body's path. Give the view a position
and heading each frame, and it derives velocity, yaw rate and acceleration, and does everything else:

- Feet are planted in the world (no sliding) and step on a stride clock. Strides quicken with speed: about 1.4–1.5
  strides/s walking, ~2.6/s at 16 m/s (each stance covers up to 2 m).
- The body bobs, rocks when galloping, crouches lower at speed, leans into turns and forward when accelerating, and
  pitches and rolls to the ground under its feet.
- Feet follow a `Ground` function `(x, z) => height`. It is the desert's `heightAt` today, so they stand on sand and
  rock but not on wrecks or scrap, and runners aren't level-aware.

What the driver should respect so it looks right (these are what the show driver, `Prowl`, does):

- **Turn rate:** ~2.6 rad/s walking, ~1.8 rad/s sprinting, ~1.5 rad/s turning on the spot. Slow down when facing
  away from where it's going (×cos of the heading error, at least 15%).
- **Acceleration** ≤ 6 m/s², **braking** ≤ 8 m/s², and arriving at a spot at no more than √(2·5·distance).
- **No teleports:** a jump of more than 10 m in one frame re-plants it on the spot (`place`).
- A sprint wants room: at 16 m/s and 1.8 rad/s the tightest circle is ~9 m.

`Prowl` (src/world/runner.ts) is only for show (it uses `Math.random` and frame time, which is not for the server). In
its loop it sprints a third to two thirds of a lap round the player (22–38 m out, 11–16 m/s), stops to stare for
1.5–4 s, or prowls to a spot 11–23 m away at 3–7 m/s. It's a reasonable first idea of its character, not a spec.

## Animations and the state they need

`Runner.update(dt, x, z, yaw, look, now)` per frame, plus two fields. Everything below follows from these:

| Input | Meaning | What it drives |
|---|---|---|
| `x, z, yaw` | the body's path and heading (+Z forward; yaw as `atan2(dx, dz)`) | gait, body motion |
| `look` | a world point it stares at (the player's head), or `null` | head, jaws, the gun |
| `alert` (0..1) | hunting hot (the show sets it while running faster than a trot) | eyes, jaws |
| `stabilize` (armed) | gun held steady in the world (default `true`) | the gun arm |

- **Head:** with `look`, it turns to the target (±63° yaw, −29°..+34° pitch). Without, it scans slowly about, less as
  it runs and nose-down when flat out. It is steadied against the gallop's rock.
- **Eyes:** pulse at ~1 Hz; with `alert` ×2.5 brighter.
- **Jaws:**
  - idle: a slow flex, nearly shut;
  - staring (`look`): open slowly wide (~50°) over ~2.2 s and **snap shut**, every 2.6 s;
  - `alert`: gape (~31°) and **chatter** (±7° at ~6 Hz).

  Shutting is a snap (fast), opening a slow spread.
- **Armed: the gun arm** (all client-side today):
  - **Carry** (no `look`): the gun borne level over its back, pointing along its heading.
  - **Aim** (`look`): the arm raises it high (~1 s), the turret turns to the target (2.5 rad/s), the gun pitches onto
    it (3 rad/s, limits −34°..+23°).
  - **Fire:** in game, on the server's 'shot' (`fire()`), the coils charging while `charging` (the server's gun state
    1); the show's drivers (`auto`, the default) fire once raised and within ~3.5° in heading and pitch, every 2.4 s,
    the coils charging through the last second. The gun slams back 0.34 m along its rails in 0.04 s, holds, and
    buffers ease it home by 0.7 s; the muzzle flares for 0.15 s.
  - **Stabilisation:** while running, the arm keeps the gun level and still in the world: gun pitch level in 100% of
    frames galloping, roll 0°, height bounce 0.03 m against the body's ~0.1 m. It's two-bone IK to a steady frame,
    with the wrist taking up the remaining rotation. The arm is planar, so in hard turns the gun leans aside a little
    with the body.
  - `Runner.muzzle(out)` gives the muzzle's world position (for spawning a bolt or a flash); `gunObject` the moving gun.
- **Bite:** `snap()` shuts the jaws hard and holds them 0.3 s (charging, they gape and chatter: `alert`).
- **Death:** `dead` (seconds) slumps it: the feet stay put, the body sinks onto its belly, nose down, rolled a little,
  the eyes go out and the jaws hang slack. No breaking apart.
- **Footfalls:** `onFootfall(x, y, z, speed)` as each foot lands (thud and dust in `GuardianFx`).
- **Not done yet:** hit reactions, a broken weak point dimming (todo-issues.md), its own sounds (it borrows the
  guardian's and crawler's), steering round wrecks and rocks.

## Where it all is

| | |
|---|---|
| shared/runner.ts | rig numbers (`RUNNER`, model units), speeds, turn rates, weak points, states, the 'bots' layout, `RunnerKind` |
| server/runners.ts | `RunnerServer`: sending them out, the brain, moving, bites, shots, hits (ticked by server/guardians.ts) |
| src/world/runner.ts | `Runner` (rig, IK, gait, head, jaws, gun arm, death, hit boxes), `Prowl` (the show's driver), `Runners` (the server's, drawn) |
| tools/runner.test.mjs | its behaviour |
| src/models/runnerLab.ts | the models lab's runners |
| tools/blender/runner.py | the model → public/models/runner.glb (one node per part, the pivots documented at its top; `--preview <dir>` renders PNGs) |
| src/guardians.ts | hosts `Runners` (`GuardianFx.runners`, `updateRunners`): sound, shake, aggro, kills |

Cost: ~5.7k triangles plain, ~7.7k armed, 16 rigid parts (no skinning), all casting shadows; no LOD yet.
