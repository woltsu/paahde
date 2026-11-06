# The runner: handoff for its AI and server side

The runner is a new enemy, so far **only drawn on the client**. It has a model, rig, gait and animations, and a
client-side "prowl" driver for show. It has no server simulation, sync, hunting, attacks, damage, death, sounds or
loot. This page is what someone building those needs to know about what exists. Numbers are in **world metres**
unless marked *model units*: the model is built at half size and drawn at `RUNNER.scale` = 2.

See it: `models-lab.html?runner` (four at once), `?runner=prowl`, `?runner=armed`, `?runner=16` (follow one at
16 m/s), `?runner=stab` (gun stabilisation side by side). In game (`?debug`, F3): Spawn → **Runner** /
**Runner (rifle)**. These are local only, seen by you alone, and do nothing.

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
  - **Fire:** once raised and within ~3.5° in heading and pitch, it fires **every 2.4 s**. The coils charge up through
    the last second, then the gun slams back 0.34 m along its rails in 0.04 s, holds, and buffers ease it home by
    0.7 s. The muzzle flares for 0.15 s. There is no projectile, sound or damage: this is a placeholder cadence the
    view runs by itself.
  - **Stabilisation:** while running, the arm keeps the gun level and still in the world: gun pitch level in 100% of
    frames galloping, roll 0°, height bounce 0.03 m against the body's ~0.1 m. It's two-bone IK to a steady frame,
    with the wrist taking up the remaining rotation. The arm is planar, so in hard turns the gun leans aside a little
    with the body.
  - `Runner.muzzle(out)` gives the muzzle's world position (for spawning a bolt or a flash); `gunObject` the moving gun.
- **Not animated yet:** death or breaking apart (guardians have a leg-by-leg collapse to borrow from), hit reactions,
  attacks with the jaws (a lunge or bite), and footfall events for dust, shake and sound (guardians fire `onFootfall`;
  the runner's gait knows exactly when each foot lands but doesn't report it).

## What the server side will need to add

Today nothing about runners exists on the server. The project's patterns for this (see docs/netcode.md,
shared/guardians.ts, server/guardians.ts):

- **Brain and sync:** the server owns where each runner is and what it does. Send clients a path to draw from (like
  the walkers' 'bots' frames, drawn `BOT_DELAY_MS` behind): position, heading, the `look` target (or the player id it
  stares at), `alert`, kind, and dead/alive. The gait, head, jaws and gun animation need nothing more.
- **The gun's shots** should be server events: the view should fire on a server event (replace its own 2.4 s cadence
  with a `fire()` call), take the muzzle from `muzzle()`, and spawn the bolt. Bolts exist for guardians
  (src/world/bolts.ts, shared/guardians.ts `BOLT_SPEED`, blasts in `BLASTS`).
- **Melee:** the jaws suggest a bite or lunge (the crawler's crouch-and-lunge is a pattern to reuse); the jaws'
  snapping while staring already reads as a warning.
- **Damage and weak points:** none are modelled. The game's convention is red glowing weak points (shared/rifle.ts,
  src/world/guardians.ts). Natural candidates: the eye cluster, the flank vents, the armed one's coils or rear core.
- **Registry and loot:** an entry in `shared/enemies.ts` (how many, where they're met, drops, fight odds, read by the
  economy simulator, `npm run econ`); drops via `shared/lootRoll.ts` and `shared/tables.ts`.
- **Sound:** none yet. Footfalls, the jaws' clack, the gun's charge and shot go through `src/audioConfig.ts` events
  (docs/audio.md).
- **Levels:** desert only today; anything else reads the ground through `level(...)` (docs/levels.md).

## Where it all is

| | |
|---|---|
| shared/runner.ts | rig numbers (`RUNNER`, model units), speeds, `RunnerKind` |
| src/world/runner.ts | `Runner` (rig, IK, gait, head, jaws, gun arm), `Prowl` (the show's driver), `Runners` + `summonRunner` (the debug menu's) |
| src/models/runnerLab.ts | the models lab's runners |
| tools/blender/runner.py | the model → public/models/runner.glb (one node per part, the pivots documented at its top; `--preview <dir>` renders PNGs) |
| src/guardians.ts | hosts `Runners` (`GuardianFx.runners`) |

Cost: ~5.7k triangles plain, ~7.7k armed, 16 rigid parts (no skinning), all casting shadows; no LOD yet.
