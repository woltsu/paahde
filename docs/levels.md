# Levels: places other than the desert

Design for rendering and running a level that is not the desert: no terrain, no sky, no sun, no haze, no weather.
The first one is an indoor datacenter (its own design: `docs/levels/datacenter.md`). Phases 1–4 are built (October
2026); "As built" below lists where the code differs from this plan, which otherwise still describes it.

## What a level is

A **level** is a place with its own coordinate frame, ground, solids, lights and look, in the **same world** (same
world process, same DB, same lives, same bag) as the desert. A world always has the desert (level 0) and may have
others. A player is in exactly one level at a time; the level is part of their simulation state.

```ts
// shared/levels.ts
export const DESERT = 0;
export type LevelId = number; // 0 desert, 1.. the registry below; small, fits the snapshot as one byte

export type Box = readonly [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number];

export type Level = {
  id: LevelId;
  key: string;                      // 'datacenter': for URLs (?level=), the DB, debug
  /** Ground under feet that were at prevY, at local (x, z); -Infinity for none. */
  ground(x: number, z: number, prevY: number): number;
  /** Collide a mover with the level's solids (shared/sim.ts contract: returns the highest support top or -Infinity). */
  collide(p: { x: number; z: number; vx: number; vz: number }, y: number, prevY: number, radius: number, height: number, stepUp: number): number;
  /** Lowest ceiling over (x, z) for a mover of this height (jumping into the ceiling). */
  ceiling(x: number, z: number, prevY: number, height: number, radius: number): number;
  /** Is a solid within r of (x, y, z)? The third-person camera's boom pulls in short of it (src/camera.ts, src/ground.ts solidAt). */
  solid(x: number, y: number, z: number, r: number, gates?: number): boolean;
  bounds: Box;                      // nothing in the level leaves this; a mover outside it is put back at a spawn
  spawns: readonly { x: number; y: number; z: number; facing: number }[];
  /** Ways out: F in one takes you to `to` (a level and a point in it). The layout gives the trigger boxes
   *  (`LevelLayout.exits` in docs/levels/datacenter.md); the `Level` pairs each with where it leads. */
  exits: readonly { box: Box; to: { level: LevelId; x: number; y: number; z: number; facing: number } }[];
  /** World-facing properties, read by property, never by asking `level === X` (as BIOMES in shared/biomes.ts). */
  indoors: boolean;                 // music, speech, hand shade, reverb, no wind
  climate: { tempC: number } | null; // null: the desert's sun and clock; else a fixed felt temperature (no heatstroke at 22 °C)
  weather: boolean;                 // storms, gas fronts, vortices reach it
  enemies: boolean;                 // walkers, drones, bosses, jets
  building: boolean;                // the wrench may place things here
};
export const LEVELS: readonly Level[] = [desertLevel, datacenterLevel];
export const level = (id: LevelId) => LEVELS[id] ?? LEVELS[DESERT];
```

The desert is a `Level` too: `desertLevel` wraps what `shared/sim.ts` already does (`sandAt`, `collideScrap`, ...,
`collideShelter`). Its properties are the defaults today's code assumes: outdoors, the sun's climate, weather, enemies,
building. So level 0 changes no behaviour.

### Why a field, not a far-away place in the desert's coordinates

The other way is a pocket: put the datacenter 3 km under the origin, or 200 km out, and switch on position. It needs no
protocol change, but it leaks everywhere. Most of the world is asked by `(x, z)` only: `shelterAt`, `collidePods`,
scrap, the shade ray, storms, gas, vortices, guardians' aggro range, the 27 callers of `indoors()`. A pocket under the
desert would meet all of them, and one far out loses float32 precision on the GPU (no camera-relative rendering; at
200 km a vertex is ~1.5 cm). An explicit `level` keeps each level's coordinates small and its own, and one gate (below)
keeps the desert's systems out.

A separate world process per level (a different `?w=`) was also rejected: the bag, lives, bedroll and the people you
play with are per world, and the datacenter should be somewhere you go, not another game.

## Simulation and netcode (`docs/netcode.md` rules hold)

- `PlayerState.level: LevelId` (default 0). `step()` reads it once at the top and takes ground, collision and ceiling
  from `level(s.level)` instead of calling the desert's functions directly. The desert's branch is today's code moved
  behind `desertLevel`, unchanged, so the desert's prediction and the bench numbers stay the same. The bike is
  desert-only for now: `riding` is dropped on entering a level with `!outdoors` (see "Getting in and out").
- **Only the server changes `level`.** It never changes inside `step()`, and no input bit asks for it; inputs stay a
  bitmask. A change is a teleport: the server sets `p.state = spawnState in the new level`, clears queued inputs and
  sends `{ t: 'level', level, state }`. The client treats it as `respawn` does now (`src/net.ts` "take the next
  reconciliation as a teleport"): the prediction buffer is dropped, no smoothing offset, and the stage is switched
  (below) behind a short fade.
- **Snapshots.** `PlayerSnap` carries `level` (it is in `PlayerState`). The server sends each client only the remotes
  in its own level (interest by level: less traffic, and the client never has to hide anyone). Remotes that leave your
  level vanish from your snapshots, as when someone disconnects; entering, you get them in the next snapshot.
- **Collision cost.** Level solids are axis-aligned boxes in the level's frame (no rotation, unlike shelters), from the
  shared layout (`LevelBox` with `use: 'both' | 'collide' | 'draw'`: the sim reads all but `'draw'`; the datacenter has
  ~90, one per rack run, not per rack). They sit in a uniform 2 m grid of box indices built once at import; a collide
  call tests the cells under the mover's swept circle. Add a `tools/bench/cases/` case for it.
- **Protocol bump.** `PlayerState` grows a field: bump the protocol number, so old clients reload (`net.onIncompatible`).

## The server: one gate for the desert's systems

`server/world.ts` loops over `players.values()` 36 times. Most of those feed desert systems. Rather than teaching every
system about levels, the world keeps two views:

```ts
const inLevel = (p: Player, pred: (l: Level) => boolean) => pred(level(p.state.level));
// in the tick:
const outside = active.filter((p) => inLevel(p, (l) => l.weather));   // storms.tick, gas, vortices
const hunted  = active.filter((p) => inLevel(p, (l) => l.enemies));   // jets.tick, bosses.engaged, tickBots' list
```

- `heat(p)`: with `level.climate` set, the felt temperature is `climate.tempC` (shared/temperature.ts gets a
  `felt(level, ...)` entry); thirst still runs, slower in the cool. No sun, no shade ray.
- Storms, gas, vortices, jets, walkers, drones, bosses: given only `outside` / `hunted`. A boss chasing you loses you
  at the door, like losing a walker in a bunker today. Blasts and throws (`server/blasts.ts`, `server/throws.ts`)
  carry the level they were made in and hit only movers in it.
- **Things lying about** (`dropped`, `world_loot`, `corpses`, `placed`, `vehicles` tables): their positions are in
  some level's frame, so each table gets a `level INTEGER NOT NULL DEFAULT 0` column (where something *is*, like `x`,
  not the item's own state, so the "Item state" rule in CLAUDE.md is not broken). Every `...Near(x, z)` query and
  every message listing them takes the level. Old rows are the desert's. Phase 1 can avoid most of this: drops,
  corpses and building are refused indoors (`building: false`, and dying indoors leaves the pack at the door you came
  in by). Phase 2 lifts that table by table.
- **Persistence.** `players` gets `level` and `y` (today only `x, z` are saved and `y` is `heightAt`; that's wrong in a
  level with floors). `homeOf(p)` and `respawn` stay desert-only: dying anywhere wakes you at your bedroll or pod.
- **Spawn & `?spawn=`.** A dev `?spawn=datacenter` (and the debug menu, F3 → "Go to level") asks the server to move
  you, through the same path as an exit, so the transition is what gets tested.

## The client: stages

Today everything is one `THREE.Scene` with the desert in it: the sky sets `scene.fogNode`, `scene.environmentNode`,
the hemisphere light and the CSM sun; ~25 desert modules take `scene` and `scene.add` into it; `main.ts` updates them
all every frame. A level needs the opposite of nearly all of that.

**One scene, one root per stage, and a stage owns the scene-level state while it is active.**

```ts
// src/levels/stage.ts
export interface Stage {
  readonly level: LevelId;
  readonly root: THREE.Group;               // everything that belongs only to this level
  /** Took over the scene: set fog, environment, background, exposure, the post profile; show root. */
  enter(scene: THREE.Scene, post: Post): void;
  /** Gave it back: hide root, put nothing back (the next stage's enter sets everything). */
  leave(scene: THREE.Scene): void;
  /** Per-frame work while active (the desert's: terrain, sky, sand, dust, crash sites ...). */
  update(frame: StageFrame): void;
  /** Built and warmed up (src/warmup.ts) before the first enter. */
  readonly ready: Promise<void>;
}
```

- **The desert stage** (`src/levels/desert.ts`) is a move, not a rewrite: `main.ts`'s `new Sky(scene)`,
  `new Terrain(scene)`, pods, shelters, scrap, crash sites, dust, blown sand, machines, wrecks, guardians, bosses, and
  their per-frame `update` calls move into it, built with its `root` where they took `scene` today (their type is
  `THREE.Object3D`'s `add`, so most need no change beyond the parameter type). `Sky`'s scene-level settings (fog,
  environment, background) move from its constructor to `enter`. Its sun, hemisphere light and CSM live under `root`.
- **What stays common**, in the scene itself and drawn in every level: the own body and remotes (`Avatar`), the
  view model (hands), held items, shield and zap effects, thrown things, the crosshair and HUD, loot and dropped items
  (filtered by level once phase 2 gives them one), and audio.
- **Lights.** A hidden root's lights are not collected by the renderer, so **the active stage's lights are the scene's
  only lights.** Avatars, hands and items lit with the default (scene) lights are lit by the datacenter's lamps there,
  without a `lightsNode` per material. The flip side: every lit material pays for every light in the active stage. So
  a level keeps a **fixed light pool** (6 point lights + at most 1 shadow-casting `PooledSpotLight`), handed each
  frame to the fixtures nearest the camera with a distance fade. The count never changes, so no shader rebuilds as you
  walk. A zero-intensity `PooledSpotLight` skips its shader work (`src/world/pooledLight.ts`); point lights need the
  same wrapper (`PooledPointLight`, new), or an idle slot still costs every lit pixel. Everything else is emissive.
  Shelters keep their own `lightsNode` (they are part of the desert).
- **Material lighting.** `materialLighting.ts`'s `desertEnvironment` becomes the desert stage's
  `scene.environmentNode`; a level gives its own (`envProfile` in its design: a low, cool concrete gradient).
  `handShade` reads `level.indoors` as it reads `indoors()` now.
- **Shadows.** The CSM belongs to the desert's sun: `leave` calls `csm.setEnabled(false)` and `heights.setEnabled(false)`,
  `enter` restores them from the graphics options. The datacenter casts with its one pooled spot light at most.
- **Post profile.** `Post` gets `setProfile(p: PostProfile)` with uniforms (not node rebuilds, so switching costs no
  compile): `heatHaze`, `sunGlare` (glare, flares, sun-visibility taps, eye adaptation to the sun), `dust` (storms,
  front, vortex, gas, grit), `bloom`, `exposure`, `grade` (the desert's amber grade vs. a level's own), `ao`. The
  datacenter: haze, glare and dust 0; bloom low (LEDs and fixtures bloom a little); AO on (GTAO from depth works
  indoors); a cool, slightly desaturated grade. The volumetric passes already skip their marches at strength 0 (as with
  no vortex out); check each in `docs/perf.md`'s terms before relying on it.
- **Audio.** The stage chooses the bed: the desert's `WindSound` is silent when `!outdoors`; a level has its own
  ambience (datacenter: fan roar and hum, `docs/levels/datacenter.md`), through the master gain (`src/audio.ts`),
  levelled per `docs/audio.md`. `src/acoustics.ts`/`src/echo.ts` take the level's reverb (a hall, not the open sand).
  `music.update({ indoors })` reads `level.indoors`.
- **Main loop.** `main.ts` keeps `stage: Stage` (the active one) and calls `stage.update(...)` where it now calls the
  desert's updates one by one. When the player is in the datacenter the terrain does not stream, the sky does not
  update and the sand does not blow: the indoor level's frame is cheap, which also leaves room for its lights.

### Switching stages

1. Server sends `{ t: 'level', level, state }`.
2. Client fades to black (the death fade's overlay, ~250 ms), drops prediction, `desert.leave()`, `dc.enter()`,
   places the camera, fades back in. Stages are built lazily on the first visit and kept: the datacenter's meshes are
   small; the desert's terrain chunk cache stays (it is the expensive one to rebuild).
3. The first visit pays for compiling the level's materials. `Warmup` (src/warmup.ts) compiles the stage's root behind
   the fade (`renderer.compileAsync(root, camera)`); a prefetch when you come near an entrance hides it entirely.
   The desert is never warmed twice: its pipelines stay cached.

## Getting in and out

An entrance is a desert thing, in the desert's layout: a door in a bunker, or a hatch at a crash site, placed by the
same seeded layout code as shelters (one per world to start, at a fixed distance from the pods, `shared/levels.ts`
`entrances()`). F at it, `TEXT.prompt.enter(label)`, sends `{ t: 'enter', at }`; the server checks reach and moves you
(on the bike: off it, the bike stays parked at the door). Inside, the level's `exits` work the same way back. No text
explains it: the door is a door, and the hum gets louder as you come near.

## Files

| New | What |
|---|---|
| `shared/levels.ts` | `Level` type, `LEVELS` registry, `level(id)`, `desertLevel`, entrances |
| `shared/levels/datacenter.ts` | the datacenter's layout (boxes, fixtures, spawns, exits) and its `Level` (`docs/levels/datacenter.md`) |
| `shared/levels/boxes.ts` | box collision for levels (sweep, support, ceiling, broad-phase grid), shared by every box-built level |
| `src/levels/stage.ts` | `Stage`, `PostProfile`, `StageFrame`, the switch with its fade |
| `src/levels/desert.ts` | the desert stage (moved out of `main.ts`) |
| `src/levels/datacenter/` | the datacenter stage: builder, materials, light pool, ambience |
| `src/levels/lightPool.ts` | the fixed light pool any level uses (scoring, fade, hand-over rules: docs/levels/datacenter.md "Lighting") |
| `tools/levels.test.mjs` | each level: spawns clear, every exit reachable from a spawn (flood fill on a 0.25 m grid with the player's radius), bounds closed, no box overlaps a spawn |

| Changed | How |
|---|---|
| `shared/sim.ts` | `PlayerState.level`; `step()` takes ground/collision/ceiling from `level(s.level)` |
| `shared/protocol.ts` | `level` messages, `enter`, protocol bump |
| `server/world.ts` | the gate (`outside`, `hunted`), level on save/load, the move, interest by level in `broadcast` |
| `server/db.ts` | `players.level`, `players.y` (phase 2: `level` on dropped, world_loot, corpses, placed, vehicles) |
| `src/net.ts` | the `level` message as a teleport |
| `src/main.ts` | the stage instead of the desert's modules |
| `src/post.ts` | `setProfile` uniforms |
| `src/world/pooledLight.ts` | `PooledPointLight`, as `PooledSpotLight` |
| `src/world/sky.ts` | scene-level settings into `enter`; CSM on/off |
| `shared/temperature.ts`, `server/water.ts` | `climate` |
| `src/music.ts`, `src/speech.ts`, `src/world/materialLighting.ts`, `src/windSound.ts`, `src/acoustics.ts` | `level.indoors` |
| `docs/codemap.md`, `docs/netcode.md`, CLAUDE.md | the new layout and rules (below) |

## Phases

Each phase is a push to `main` that leaves the game working.

1. **Stages, no new level.** Move the desert into `src/levels/desert.ts` behind `Stage`; `Post.setProfile`; sky's
   scene settings into `enter`. No behaviour change; `npm run bench` and `npm run perf` should show none.
2. **Levels in the sim.** `shared/levels.ts` with `desertLevel` only; `PlayerState.level`; `step()` through it;
   `players.level`/`y`. Still nothing new to see. `tools/bike-slopes.test.mjs` and the netcode tests unchanged.
3. **The datacenter, dev only.** Its layout and `Level`, its stage, the light pool, `?spawn=datacenter` and F3 →
   "Go to level"; the server gate. Drops, corpses and building refused inside. `tools/levels.test.mjs`.
4. **The way in.** The entrance in the desert, F to enter and leave, the fade, the prefetch, the ambience.
5. **Things in levels.** `level` on the item and placed tables; loot inside (racks as salvage, `shared/enemies.ts` if
   they're destroyable; `npm run econ` after).

## Rules (in CLAUDE.md since phase 2)

- Anything that moves a player reads ground and solids through `level(s.level)` in `shared/sim.ts`, never the desert's
  functions directly.
- Desert systems (weather, enemies, heat) take players through the server's level gate, by property (`weather`,
  `enemies`, `climate`), never `level === DATACENTER`.
- A level's lights come from its light pool; a stage never adds lights to the scene outside its root.

## As built (phases 1–4) and where it differs

- **`Level`** (`shared/levels.ts`) has `flat` (hard floors: the sim skips the terrain's slopes, slip faces and rock walls,
  and the sand's height for "on scrap") and `things` (the world's things lie here: the desert's layout, loot, packs,
  chests, buildings, vehicles; false in a level until phase 5). `collide` also gets the mover's previous x, z (the
  shelters need them). `bounds` is null for the desert. Instead of `exits`, every level (the desert too) has `doors()`:
  `{ trigger, to, arrive? }`, F in a trigger takes you to level `to` (at a spawn; out to the desert, at `arrive` of the
  desert's door that leads back: `desertArrival`). The desert's door is the datacenter's entrance, placed per world, so
  doors are computed on first use. Doors are found by `doorAt(level, x, y, z, slack)`, never by asking which level it is.
  `STEP_UP` lives in `shared/levels.ts` (the sim re-exports it) so a level's collision can use it.
- **Collision** (`shared/levels/boxes.ts`): a box whose underside was over the head a tick ago is the ceiling's
  (`ceilingBoxes`), never a wall to push out of: jumping into a slab, beam or lintel only stops the jump. (It used to
  throw you sideways, often out of bounds and back to a spawn.)
- **Doors and moves**: spawns lie clear of every door's trigger and the server's slack round it (an F pressed twice
  doesn't bounce you back out), and `moveTo` takes no second move within a second of one (`MOVE_GAP_MS`; each saves).
  A move forgets the appearances sent to the mover (the client forgets them too). A saved row in a level that no longer
  exists comes out at the desert's door. Nothing can be placed at the entrance, its trigger or where you come out.
- **The sim** ignores storm, vortex pull and walker feet where the level has no `weather`/`enemies`, drops `riding` on a
  flat level, and puts a mover outside a level's bounds back at its first spawn (deterministic, no server message).
- **Server gate**: `outside` and `hunted` as planned; besides, a player in a level without `things` may only send what
  can't reach the desert's things through shared coordinates (`IN_LEVEL` in `server/world.ts`: input, chat, inventory
  moves between the bag and equipment, shots and swings without targets, drinking, doors, debug); the rest is refused
  (a drop with "Can't drop here"). `openBoxes` (`shared/storage.ts`) gives only the bag and equipment there. Dying in a
  level leaves the pack at the desert door. Terrain chunks only stream to players in the desert. Zaps, swings and shield
  breaks go to the same level only.
- **One move** (`moveTo`): the door both ways, `?spawn=datacenter` (on ready) and F3 → Go to level. A respawn (always
  in the desert) is seen by the client as a level change in the next snapshot and switches the stage too.
- **Client switch** (`StageSwitch` in `src/levels/stage.ts`): nothing is drawn from the teleport until the new stage
  is in (the canvas holds the last frame under the 250 ms fade), so there is no frame of the old stage seen from the
  new place. A fade of its own (`#levelFade`), not the death fade's. The camera turns to the state's facing on the
  teleport (`net.onTeleport`). A stage that can't be had (none for that level, or its code failed to load) is not
  asked for again for 10 s, and a failed load offers a reload; it never loops fades. A stage is updated only while it
  is the level we're in; the clock (`Sky.tickClock`) and the wind tick in every level. The client's own ground checks
  (camera, ragdolls, shots, blows, thrown junk, sparks, the spyglass, sound occlusion, the fly camera) go through
  `src/ground.ts` `groundAt`, the floor in a flat level, never the desert's heightfield there. The third-person camera's boom
  is stepped out and stops 0.2 m short of the level's solids (`Level.solid` through `src/ground.ts` `solidAt`, with the
  player's gates: a shut door stops it, an open one doesn't); in the desert the sand, shelters, tarps and the datacenter's
  block. (Built things, scrap and machines are not tested yet.) The Web Audio listener
  follows the camera everywhere (`CrashSound.update`, its beacons only where the desert's things are). A storm's dust
  at the eye drops at once in a level without weather (`StormFx.calm`). The desert's post profile is kept as it was on
  leaving (the art bench's tuning survives a visit). Faded-out ambience beds stop their sources.
- **Prefetch** builds the stage (geometry, the bake a few ms at a time: `bakeDataSliced`) within 60 m of a door; compiling still happens behind the fade on
  the first visit (a hidden root's lights aren't in the scene, so the level's pipelines can't be compiled ahead
  without entering it). The first entry measured ~0.3 s from F to the new stage on an M2 Pro (WebGPU) once built.
- **Shadows**: the desert's CSM and dune heightfield are not switched off on leave: their light is under the hidden
  root, so they are neither updated nor drawn, and toggling them reallocates maps (a hitch on every return).
- **Post profile** has no `dust`: the weather's dust follows the weather systems, which a level without `weather` feeds
  nothing (`main.ts` passes them empty lists, and the marches skip at strength 0). `sunGlare` also skips the CPU sun
  ray against the dunes. `exposure` is what the eye adapts to (it eases over ~1.5 s, as the sun adaptation does).
- **Audio**: the desert wind fades out (`WindSound.setSilent`) where `indoors`; music and speech read `level.indoors`;
  footsteps take the concrete set and no prints are left on a flat level (`Avatar.levelFloor`). Not done: the level's
  own reverb in `src/acoustics.ts`/`src/echo.ts` (they still read the desert's walls round the listener's x, z).
- **Entrance**: a squat concrete block with a steel door and an amber lamp (`shared/levels/entrance.ts`,
  `src/world/entrance.ts`), axis-aligned, its door towards the pods, 90–140 m from them; its prompt reuses
  `TEXT.prompt.open` with `TEXT.places.steelDoor`. The hum near it is the datacenter's own bed low-passed by distance.

## The contract grew with the beginning (docs/levels/tutorial.md, October 2026)

- **`private`**: one copy per player. The server sends no one else in it (interest: `seenBy`), and nobody sees in;
  zaps, swings and shield breaks stay with the player (`sameNear`).
- **`mortal`**: false, `hurt` and `die` refuse (the beginning). **`skippable`**: the Esc menu offers to leave for the
  desert. **`crouchUnder`**: crouched or sliding you are `CROUCH_HEIGHT` (1 m) tall in collision and ceiling (shared/sim.ts),
  and with no room to stand over you, you stay crouched; false in the desert and the datacenter (nothing changes there).
- **Gated solids**: `ground`, `collide` and `ceiling` take the mover's `PlayerState.gates`; a box-built level gives
  boxes a gate mask (`LevelBox.gate`, `BoxGrid.gate`): > 0 solid while the bits are clear (a door), < 0 solid once they
  are set (a door shut behind you). Only the server sets bits (no input asks), so `step()` stays a function of state and
  input; `gates` comes in the next reconciliation like `level`, is saved with the player (`players.gates`) and is a
  spawn's own on any move (0 from every spawn).
- **Level items**: an item with `levelOnly: <level key>` (`shared/items.ts`) is taken out of the bag on any move out of
  that level, and on joining anywhere else.
- **Machines in a level**: a stage may offer its own work site (`Stage.workSite`, the beginning's cabinet), with its own
  messages (`Stage.site`); the server routes them before the `IN_LEVEL` gate (server/tutorial.ts).

## Open questions

- **The lab** (`?w=lab`) is a flat level in all but name: ~20 scattered `if (LAB)` in `shared/` (terrain, rocks,
  canyons, sun, scrap, wrecks, crash sites, pods). Once levels exist it could be one, which would remove them. Not part
  of this work.
- **Remote players' bikes at the door**: a parked bike is a desert vehicle; fine. A bike inside a level is not planned.
- **Seeing out / in**: no level shows another (no portals). The door is opaque, and the fade covers the cut.
- **More than one instance** (each world's datacenter is one shared place; per-party copies would need an instance id
  next to `level`). Not needed yet.
