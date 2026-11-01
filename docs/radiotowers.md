# Radio towers: giants you climb and bring back

Design for the abandoned radio towers (November 2026). Here and there in the desert stands a huge, dead telecom tower.
You see one from far off and ride to it. You climb it to the top, and you find it's missing parts. Fit them, give it
power, and it comes alive: its lamp blinks and a radio starts **muttering** through the static. Nothing tells you any of this: the tower
looks broken, the empty mounts look empty, and once it's alive it hums, blinks and crackles.

## The look

After the reference photo (a self-supporting lattice tower): three galvanised steel legs tapering to the top, X-braced
in bays, a ladder in a safety cage up one leg, round microwave dishes in a cluster two thirds up, tall white panel
antennas in a ring near the top on a platform, a mast with a red aviation lamp above it all, and an equipment cabinet
at its foot. Stylised the way the rest of the desert is (`docs/look.md`): sun-bleached, sand-scoured grey steel, a few
rust streaks, dishes pale and dusty, some hanging by one bolt, a torn cable whipping in the wind.

### They have to feel big

The photo's tower is ~40 m. Ours are about three times that, and everything about them says so:

- **Height:** ~120 m to the top platform, ~140 m to the lamp. Taller than the solar farm's 132 m tower, the tallest
  thing anyone builds. A few are shorter (80–100 m) so the tall ones read as tall.
- **Footprint:** a ~16 m triangle at the base: each leg a big tube (~0.6 m) on a concrete pier, bays ~8 m tall at the
  foot getting shorter towards the top. Walking in under it, the legs and bracing go up out of sight.
- **On high ground:** each sits on the highest point near its cell's spot (a mesa top, a big dune's crest), so its
  silhouette stands against the sky from 5+ km. Seen from the pods, one or two are on the horizon.
- **Dishes the size of a car:** 2.5–3 m across, so from the ground they look like dishes and up close they're huge.
- **Sound:** guy-less lattice in the wind: a low moan through the bracing, cables slapping, a creak that grows with
  height (`windSpeed`). From the top the wind is loud and the desert far below.
- **Sway at the top:** a slow camera sway on the top platform in strong wind (view only, not the sim).
- **Distance view:** the silhouette from 6 km, like the farm tower (one cheap merged mesh + the dishes as dots); the
  full lattice from ~1.5 km; the cabinet, ladder and parts close up.

## Where

Placed like the solar farms (`shared/solarfarms.ts`): a seeded grid of cells, each holding at most one.

- One per 1.8 km cell, ~40% of cells: a few within 3 km of the start, more further out. None within ~800 m of the
  origin (`ORIGIN`), off the solar farms (`solarWithin`), off canyon floors and mud flats (by biome property: a new
  `towers` weight in `BIOMES`, not by naming biomes).
- In the cell it climbs to the highest ground within ~150 m of its seeded spot (a few `heightAt` samples), then pads
  the ground under the legs flat (a small `withTowerPad` in `baseHeight`, like `withSolarPad`); rocks, scrap, crash
  sites and shelters keep off its reach.
- Deterministic from the seed: client and server both know where every tower is and what it's missing. What's been
  fitted since is server state (below).

## Climbing (in `shared/sim.ts`: `docs/netcode.md`)

The ladder moves the player, so it's in the sim, deterministic:

- **Ladder:** a vertical strip on one leg's inside face (`towerLadder(x, z)`: the nearest tower's ladder, if any,
  within reach). Walking into it while facing it (FORWARD, facing within ~60° of it) puts you on it:
  `PlayerState.climb` = 1 + the tower's index (0 = not climbing). On it: no gravity; FORWARD goes up, BACK down
  (`CLIMB_SPEED` ~2.4 m/s: the 120 m climb takes about a minute, long enough to feel it), left/right nothing, crouch
  slides down fast. JUMP lets go, pushing you off backwards. Leaving the ladder's top or bottom puts you on the ground or
  a platform.
- **Platforms:** three (a rest deck at ~40 m, the dish deck at ~80 m, the top deck at ~120 m) with a hatch where the
  ladder comes through. They're ground in the desert level (`desertGround` takes `towerGround`, the way it takes
  `tarpGround`), only for feet that were over them, so you stand, walk and crouch on them. A rail round each collides
  (`collideTowers`, capsules) so you don't walk off by accident; you can jump over it.
- **The lattice:** the legs collide, the bracing doesn't (you pass between bays). No climbing the lattice itself, only
  the ladder.
- **Falling:** no fall damage, as everywhere else (decided). Jumping off the top is a long way down and nothing more.
- **Riding:** no bike on the ladder, nor up there.
- **Netcode:** `climb` is in the snapshot for remote players (the climbing pose, hands on rungs: `docs/character.md`,
  every body). Schema version bump. Pose for your own view: hands on the rungs (`docs/viewmodel-hands.md`).

Up there it's also a gas refuge (higher than `GAS_DEPTH`), a lookout and a rifle perch. Those come for free.

## What's missing, and fixing it

Each tower is gear with part slots (`GEAR.tower` in `shared/gear.ts`), but it isn't built or carried: it stands in the
world, and its fitted parts are kept in a shared box per tower (`twr<n>` in `shared/boxes.ts` / `shared/storage.ts`),
saved in the world DB like a building's `bld<id>`. Parts go in and out with `partAt`/`setPart` and keep their data.

The slots are spread over the tower, so fixing it means climbing it:

| Where | Slot | What it is |
|---|---|---|
| Cabinet at the foot | `relay` | the radio's switching |
| Cabinet at the foot | `compute` | the receiver's board |
| Cabinet at the foot | `battery` | power when it isn't on a grid |
| Dish deck, ~80 m | `motor` | the dish's drive (the big dish that hangs slack, aimed at the sand) |
| Top deck, ~120 m | `coil` | the antennas' feed: wiring run back up the mast |

- Only parts the game already has, so the econ simulator just sees new uses for them (`npm run econ` all the same).
- F at each place opens the slots there (the cabinet's door, the dish deck's junction box, the top deck's feed box),
  like a building's parts panel (`src/inventory.ts` `part:<box>`). You carry the part up yourself.
- Each world's towers are missing different things: the seed says which slots start empty (one to all five) and what
  tier the rest hold. Nearer towers miss less.
- What you see: an empty slot shows (the cabinet hangs open and dark; the slack dish hangs pointing down; the feed
  box's cables hang loose). Fitted, the dish swings up and turns to its bearing; the cabinet's lamps come on.
- **Power:** its own battery, or wired to a grid (a connector on the cabinet: `shared/wires.ts` `CONNECTORS`), drawn as
  a load (`TOWER_W` in `shared/power.ts`, server/power.ts), like a beacon. No power, no signal.
- Anyone can fix a tower or take its parts back out (everything is shared). Taking a part out kills the signal.

## The signal (placeholder for now)

A tower with every slot filled and power on is **alive**:

- **Seen:** the red aviation lamp at the top blinks (day and night; at night from kilometres, everyone sees it). The
  big dish swings up and turns slowly, searching.
- **Heard:** the cabinet hums, and a radio mutters through the static: voices you can't make out, a few words' worth
  of babble, pauses, a tone now and then. Heard near the cabinet and on the decks, and through a receiver or jammer in
  your hand within ~1 km of the tower. The worse the fitted parts, the more static over it. Synthesised (formant-filtered
  noise bursts with a speech-like rhythm through a band-pass "radio" filter), levelled per `docs/audio.md`.
- **Nothing more yet.** The signal doesn't point anywhere or lead to loot (decided: the muttering is enough for now).
  Later it could carry something: a bearing to a place, a hint, the bosses.

## Drones

A couple of searchlight drones keep each tower (`server/drones.ts`): two circling the mast, there like a site's when
someone comes within ~500 m of the tower. Shot down, they **stay down**: no refill (unlike a site's, `REFILL_MS`) while
anyone is still near. Once everyone has left (beyond ~700 m), the tower's drones come back on the next visit. Kept in
memory like the site drones; nothing saved. Climbing the ladder with drones about is the danger (you can't shoot while
climbing).

## Code (following the solar farms' and buildings' patterns)

- `shared/towers.ts`: placement (cells, high ground, pad), the shape (legs, decks, ladder, slot spots, dish bearing),
  `towersNear`, `towerLadder`, `towerGround`, `collideTowers`, `withTowerPad`.
- `shared/sim.ts`: `PlayerState.climb`, the ladder in `step()`, the decks via `shared/levels.ts`' desert ground.
- `shared/gear.ts` `GEAR.tower`; `shared/boxes.ts` / `shared/storage.ts` box kind `twr`; `shared/power.ts` `TOWER_W`.
- `server/towers.ts`: the slots' boxes, alive or not (power from `server/power.ts`). `shared/protocol.ts`: which
  towers are alive. `server/drones.ts`: the towers' drones (no refill while anyone is near).
- `src/world/towers.ts`: the lattice (instanced bays, one far silhouette mesh), dishes, panels, cabinet, the lamp (an
  emissive blink, no real light), the slack and fitted states. `src/towerSound.ts`: the wind in the lattice, the
  cabinet's hum, the radio muttering (synthesised, `docs/audio.md` levels).
- Model: `tools/blender/tower.py` for the dishes, panels, cabinet and ladder cage; the lattice made in code
  (repeated bays).
- Text: none needed beyond the parts panel's existing labels. Maybe a speech line or two (`docs/speech.md`): the
  first time under one ("Long way up."), when the muttering first comes through.
- F3: "Go to radio tower", "Fix nearest tower".
- Test: `tools/towers.test.mjs`: climb up and down, stand on the decks, jump off; fit every slot, wire it, it's alive;
  take a part out, it's dead; the drones stay down until everyone has left.

## Order

1. The towers standing (placement, pad, model, distance view, sound in the lattice).
2. Climbing and the decks.
3. The slots and fixing; power; the lamp and the dish coming alive; the radio muttering.
4. The drones.

## Later

- What the signal carries (a place to go, a locker, a link to the bosses' uranium).
