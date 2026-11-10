# Code map

Where each system lives, file by file, grouped by area. CLAUDE.md has the short version; this is the detail. The
numbers here are a snapshot to orient you: the code is the truth, so check it before relying on one, and fix this file
when you find it stale.

## Core

- `shared/sim.ts` — deterministic movement/physics, run by **both** client and server (docs/netcode.md)
- `shared/protocol.ts` — WebSocket message types
- `src/main.ts` — entry: renderer, scene, fixed-step game loop
- `src/net.ts` — client netcode (prediction, reconciliation, interpolation, reconnect)
- `src/input.ts` — keyboard → input bitmask
- `src/gamepad.ts` — gamepad (third-person shooter layout): presses the keys bound to each action as synthetic key
  events, so rebinding and every key reader just work; right stick → `FirstPersonCamera.look`; layout in its header. In
  the inventory a drawn cursor (`src/padCursor.ts`) sends synthetic pointer events, so it works as with the mouse.
  `src/uiNavigation.ts` handles keyboard and controller focus, sliders, back actions and controller text entry on
  the landing page and all menus; `src/uiFocus.ts` chooses neighbours from their screen bounds at any UI scale.
  `src/padMap.ts` — the pad's buttons (read by the pad code and by the hints). Control hints:
  `src/bindings.ts` `kbd`/`ctl`/`hintKeys` name keys or pad buttons for the device last used (docs/text.md)
- `src/uiScale.ts` — the menus' and inventory's size: `--ui`, from the window's size times Options → Interface size,
  taken as CSS `zoom` by the panels it lists. In a zoomed panel write `calc(100vw / var(--ui))` for viewport units,
  and convert pointer px to `left`/`top` with `uiScale()`
- `src/comfort.ts` — validated, persisted camera/input and readability settings: independent mouse/stick axes,
  inverted look, FOV, motion, glare/grain, HUD and subtitle presentation; edited in `src/options.ts`.

- `desktop/` — the desktop app (Electron; docs/desktop.md): the web build in a window, the first step towards Steam.
  `desktop/update.mjs` keeps its game files at the server's build, from `dist/manifest.json` (`tools/manifest.ts`).
  `src/desktop.ts` — the game server's address when the page isn't served by it (`PAGE_URL`). Built by
  `.github/workflows/desktop.yml`

## Levels (docs/levels.md)

- `shared/levels.ts` — `Level` (ground, solids, ceiling, bounds, spawns, `doors()` and its properties: `indoors`,
  `climate`, `weather`, `enemies`, `building`, `things`, `private`, `mortal`, `crouchUnder`, `skippable`, `tick`; ground,
  collide and ceiling take the player's `gates`), the `LEVELS` registry, `level(id)`; `desertLevel` wraps the
  desert's ground and collisions. `PlayerState.level` (`shared/sim.ts`) says which one a player is in; only the server
  changes it. `players.level`/`y` in the DB. `doorAt`, `desertArrival`: the doors between levels
- `src/ground.ts` — `groundAt`/`onFlat`: the client's ground for its own checks and effects, the sand in the desert or a
  level's floor (never the desert's heightfield at a level's x, z)
- `shared/levels/datacenter.ts` — the datacenter's layout (boxes with `use` both/collide/draw, racks, fixtures, zones,
  spawns, its exit's trigger; seeded, docs/levels/datacenter.md) and its `Level`; `shared/levels/boxes.ts` — box collision for
  box-built levels (support, push-out, ceiling, ground) over a 2 m grid, gated boxes (`BoxGrid.gate`: solid while a
  `PlayerState.gates` bit is clear, or once one is set). `tools/levels.test.mjs`: spawns clear and away from
  doors, doors reachable, walls closed, walks never jump, walls stop, jumps under every ceiling go straight up;
  `tools/server-levels.test.mjs` (real world server): `?spawn=datacenter`, interest by level, a refused drop's notice
  and bag, out by the exit and in by the entrance walked to, F twice not bouncing, rejoining inside, looks re-sent to
  two who move together
- Server level gate (`server/world.ts`): `outside`/`hunted` feed weather and the hunters only the players their level
  lets in; `IN_LEVEL` is what a player in a level without the world's `things` may send; `moveTo` is the one move between
  levels (a door, `?spawn=datacenter`, F3 → Go to level), told to the client as `'level'`; snapshots by level.
  `shared/temperature.ts` `felt` for a level's climate
- `src/levels/stage.ts` — `Stage`: what the client draws for one level, one root per stage in the one scene; the
  active stage owns fog, environment, background and the post profile (`Post.setProfile`, `src/post.ts` `PostProfile`),
  and its root's lights are the scene's only lights. `StageSwitch`: the fade, building on the first visit, waiting
  for the stage to arrive (`Stage.arrive`: the desert's terrain and dune shadows round the landing spot), the
  compile behind the black (src/warmup.ts)
- `src/levels/desert.ts` — the desert stage: sky, terrain, pods, shelters, crash sites, walkers, bosses, loot ...
  built into its root (moved out of `src/main.ts`), and their per-frame updates
- `src/levels/datacenter/` — the datacenter stage: `index.ts` (boxes merged per material, instanced racks, the pool, its
  enter/leave), `materials.ts` (procedural TSL concrete, racks with LEDs, strips), `bake.ts` (contact AO and far-light
  maps), `environment.ts` (environment node, post profile), `ambience.ts` (synthesised fans, hum, units, chatter)
- `shared/levels/entrance.ts` — the datacenter's door in the desert: a concrete block placed from the world seed a
  walk from the pods, solid in `desertLevel`, its trigger (F, `TEXT.prompt.open(TEXT.places.steelDoor)`) and where
  you come out; `src/world/entrance.ts` draws it and plays the muffled hum by distance
- `src/levels/lightPool.ts` — a level's fixed light pool (6 `PooledPointLight` + 1 shadowing `PooledSpotLight`,
  `src/world/pooledLight.ts`) handed to the fixtures nearest the camera, never moved while lit; per-fixture `weight`
  (lights out without a shader rebuild). `src/levels/boxLevel.ts` — any box-built layout into a stage's root (boxes
  merged per material, gated boxes as their own meshes, instanced racks, the pool, a hemisphere fill)
- The beginning (docs/levels/tutorial.md, aboard a ring station: docs/levels/ring.md): `shared/ring.ts` — the ring's
  frame (`RING` radius/width/height, `toRing`, `dirToRing`, `ringMatrix`/`ringMatrixInverse`, the spin `SPIN` (Coriolis:
  `Level.spin` in `shared/sim.ts`), the ribs). `shared/levels/beginning.ts` — its layout (the crew block and the pod
  terminal across the ring's hall, the open deck between with rack fields, gantry and trench, gated doors,
  triggers, `GATE` bits, `BEAT_STARTS`, `beatAt`, the cleaning cart's moving solid `CART`/`cartX`) and its `Level` (private, immortal, crouch-under, skippable, no doors);
  `shared/levels/beginningCabinet.ts` — the dead control cabinet (fixed seed, only its relay left: `tut_relay`,
  `shared/items.ts` `levelOnly`); `server/tutorial.ts` — trigger bits, each player's cabinet session (never saved), the
  pod's panel and the ride down (`RIDE_MS`), `BEGINNING_DONE`; `server/world.ts` starts new players there, `finishBeginning`
  (the ride, the Esc menu's skip), strips level items on any move out, refuses hurt/die where `!mortal`, hides private
  levels' players. `src/levels/beginning/` — its stage (`index.ts`: doors, lights out, rumble, the cabinet's work site, the
  hatch's F; the root turned round the camera onto the ring), `ring.ts` (the ring's shell: deck, walls, ceiling, ribs and
  their material, all the way round), `rackDetail.ts` (openable racks: F at one's front swings its door open on a
  model of its insides, built only for the racks opened, at most 20, its instance hidden meanwhile), `props.ts` (screens, cart, fallen gantry, blast door, the floor window's frame and
  glass, drawing, plaque, city labels), `pod.ts` (the pod: the relay's ghost in its junction box, the cover shutting, the hatch cut out of pod.glb
  and swung open), `cabin.ts` (the pod's cabin seen through the hatch, lit by the pool's `CABIN_LIGHT`), `podHull.ts`
  (pod.py's hull profile and hatch, in three's frame), `planet.ts` (space: a camera-centred TSL dome with the stars, Milky Way, sun and the analytic planet),
  `sound.ts` (the fall's roar, groan, jolt, chime; the pod's click, clunk, chirp, hiss, thud), `ride.ts` (the dust card
  on the way down), `stuck.ts` (key hints after
  8 s stuck, once per world). `src/levels/boxLevel.ts` bends a box layout onto the ring (`buildBoxLevel(..., ring)`,
  `boxGeometry(..., bend)`, `ringAnchor`); box geometry carries its flat `lpos`/`lnor`, which the datacenter's materials
  read. Tests: `tools/ring.test.mjs` (the frame, the rigid motions, Coriolis), `tools/beginning.test.mjs` (the walk with `step()`, the obstacles, the cabinet and
  hatch rules), `tools/server-beginning.test.mjs` (new players start there alone and unhurt, the ride, skip, the grant), `tools/level-zfight.test.mjs` (no
  coplanar same-facing drawn boxes in any box-built layout: docs/levels.md "Building with boxes")

## Worlds, server and players

- `shared/world.ts` — worlds: each game is its own world at its own URL (`?w=<id>`, made on the landing page,
  `src/landing.ts`), with a seed from its id, its own players and DB (`data/worlds/<id>.db`; the old world is
  `?w=main`), and 10 shared lives (`src/lives.ts`; +10 per boss kind beaten); at 0 the game is over. Games are public
  (in the main menu's browser) or private (link or code), with a max of players and maybe a password
  (`server/registry.ts`, `data/registry.db`); a game's URL opens its lobby first (`src/lobby.ts`)
- `shared/look.ts` — a player's look: the piece in each slot of the scavenger (hood, eyes, mask, scarf, cape, shoulder,
  gloves, boots), the dyes of the robe, hood and wraps and the body (human, dwarf, gnome: `bodyScale`, docs/character.md), packed in one number. Chosen on the main menu's Character view
  (`src/lookView.ts`, its own little renderer), kept in the browser (`src/profile.ts`), sent in `hello`, relayed in
  `PlayerSnap.look`; drawn by `src/models/scavenger.ts` `setLook` (the chosen pieces merged with the body, one mesh per
  material; the pieces are meshes in scavenger.glb, `tools/models/scavenger.py` LOOK_MESH; the dyed cloth is baked pale)
- `shared/names.ts` — names others see (game names, player names): allowed characters and the slur/swear filter
  (`obscenity` + our list), checked on the client as typed and by the server. Your name and colour are chosen in a
  game's lobby (`src/profile.ts`, remembered by the browser as the default), sent in `hello`; a name is required (server
  closes 4422). They're fixed per game after the first join (`server/world.ts` `join` keeps the stored ones)
- `server/index.ts` — front server: static files, `POST /api/worlds` (make a game), `GET /api/browse` (public games),
  `GET /api/worlds/<id>` (lobby), `POST /api/worlds/<id>/key` (password -> key), `POST /api/worlds/mine` (the landing
  page's list of worlds this browser joined, kept in localStorage by `src/landing.ts`, with your name and play time
  there), passes `/ws?w=<id>&k=<key>` through to the world's process (4403 locked, 4429 full)
- `server/world.ts` — authoritative game server for one world (forked per world, exits when empty); `server/db.ts` —
  SQLite; `server/scrap.ts` — scrap pickups, respawn
- `shared/pods.ts` — the crashed escape pod(s) players arrive in (new players and the dead without a bedroll appear
  beside the hatch of "their" pod, `podOf(browserId)`: `podSpawn`, `spawnPoint(n)` in shared/sim.ts): each pod in the
  world (`podPlaces`), collision (`collidePods`), shade casters, the water tap on each hull (`atPodTap`, through
  shared/wells.ts `waterAt`), its equipment bay torn half out of its right flank (`podSites`, ids `pod:<n>`, through
  shared/crash.ts: kind `pod_bay`, a large machine worked where it lies, built by shared/machineBuilders.ts `podBay`;
  `POD_MACHINE_SPOT`; spent once scrapped, `POD_WRECK`): the quad's battery and bearing and the first wiring
  (shared/tables.ts COMPONENT_LOOT `pod_bay`), and loot spots (`POD_LOOT`, server/loot.ts: scrap and cloth only, kept
  whole; an older kit's surplus, the old console and power box, cleared on load). The old `pod_console` / `pod_powerbox`
  carried machines still exist for old worlds' bags (models `tools/blender/finds.py`,
  on the bench `podConsole` / `podPowerbox` in shared/machineBuilders.ts). The pods' spots (a cluster picked per world 37–67 m from the origin), the keep-clear
  that hugs each hull (`nearPod`), the layout's keep-off (`onPodGround`) and the furrows in the terrain:
  `shared/podSpot.ts`; model `tools/blender/pod.py` → `public/models/pod.glb` + generated `shared/podModel.ts` (one
  model in four poses, a drogue chute behind one); drawn by `src/world/pods.ts`. Old worlds: `server/podsLanded.ts`
  (once: things in a pod's way moved out, the first bike by the pods, the gone pump shelter's things back on the sand)
- Bedrolls (`bedroll`, shared/placed.ts) and spawn points — each player has at most one spawn point, a bedroll
  (anyone's), where they wake up after dying (`homeOf` in server/world.ts; none: where players arrive; their own
  unfolded, built cart comes first: docs/cart.md "Spawn"). Laying a
  bedroll makes it yours; F on one toggles it (`spawnToggle`, server/placed.ts `toggleSpawn`; `spawns` table, browser
  IDs server-side only). Only a bedroll's owner picks it up; taking one up clears it for whoever slept there. Each
  player alone is told theirs (`spawn` message): a lantern by its pillow (src/world/placed.ts), the locator's home
- `shared/lab.ts` — the dev test lab (`?w=lab`, `LAB` in shared/world.ts: flat floor at y 0, no desert or events; laid out
  from its own spot `LAB_AT`, world (0, 0), you start at `LAB_SPAWN`; layout of the machine sites `lab:<n>`, pickups and plates); drawn by `src/world/labPlates.ts`, pickups via `server/loot.ts`
- `server/snapshot.ts` — world-state snapshots, the gameplay test scenarios (docs/scenarios.md): debug menu → Scenarios
  in the dev-only test world (`?w=test`, `TEST` in shared/world.ts: the real desert from a fixed seed, endless lives, no
  beginning). Save dumps every table (browser IDs as placeholders) and the live state (`LiveState` in server/world.ts:
  time of day, `StormServer`/`GuardianServer` `snapshot()`, the protagonist's facing, health, hand) to
  `scenarios/<id>.json`; Load writes the rows back and ends the world process, the next one takes the live state
  (`restore()`); `tools/snapshot.test.mjs`
- `src/artBench.ts` — the art-style bench (`?w=bench`): the desert from a fixed seed with no events, fixed camera shots
  at set times of day (`[` `]`), a panel tuning the global look live (tone, grade, bloom, light, sky palette keys,
  haze, sand/rock/mud colours; hold `\` for the defaults), exported as JSON or a diff naming where each default lives
- `shared/ragdoll.ts` — dying: you lie where you fell for `DOWN_MS` (input ignored, third-person camera) as a
  Verlet ragdoll (`src/models/ragdoll.ts`) thrown by the killing blast's push (`blastPush`), then respawn
- `shared/corpse.ts` — dying leaves the bag past the hotbar in a pack where you fell (shared box `corpse<id>`,
  take-only, 30 min); `server/corpses.ts` makes/expires them, `src/world/corpses.ts` draws the bundle and rag flag

## Terrain and biomes

- `shared/rocks.ts` — rock formations (mesas, buttes, pillar fields, carved hills, jagged peaks, boulders; now and then a
  giant) placed by a rockiness noise, the kind by a regional style noise; part of `baseHeight` (max with the dunes).
  Steep rock is a wall in `step()`, craters stop at rock, `rock` attribute paints them in `src/world/sandMaterial.ts`
- `shared/stones.ts` — loose stones and boulders (props, not heightfield): per 32 m cell, thinned to `stoniness` (only by rock:
  `rockFoot` talus in shared/rocks.ts, canyon wall feet, bare rock, plus a biome's `stones`; open sand has none, deep
  sand buries them). Hitbox: an ellipse, a wall below its shoulder and ground above (`collideStones`
  in `desertLevel.collide`), boulders stop shots (`addShotSolid` in shared/terrain.ts). Procedural meshes, instanced, in
  `src/world/stones.ts` (coloured by the sand shader's rock uniforms). Test: `tools/stones.test.mjs`.
- `shared/canyons.ts` — canyons: Grand Canyon-scale gorges (8–14 km long, 220–400 m under the dune floor, up to
  ~1.5 km rim to rim, terraced walls, buttes, side canyons) cut through a raised sandstone tableland, open at their
  ends; part of `baseHeight` (`ground` in shared/terrain.ts: the tableland adds rock, the gorge cuts to bare rock walls
  over a sandy floor with dried mud, its floor rocks from `canyonRockHeight` in shared/rocks.ts; `rockTop` for the
  rock). A biome (`CANYON` in shared/biomes.ts, weight `canyonCover`). Walls and rock tint follow the rock column
  `shared/strata.ts` (formations by height: colour and hardness, cliff or slope), shaded in `src/world/sandMaterial.ts`
- `shared/biomes.ts` — biomes: kinds of country met further out the further you go, one common concept: each is an
  entry in `BIOMES` (in order of precedence: earlier ones claim the land first) with its placement (`place`, weight
  0..1) and its properties (`groundHeat`, `haze`, `empty`...; new per-biome things like finds or enemies go there).
  Read them with `biome(id, x, z)`, `biomeAt` or `blend` (a property mixed by weight). Biomes so far: canyons
  (`shared/canyons.ts`, first) and mud flats (dried lake beds: noise blobs (`blobs`) — no dunes (`duneHeight`), next to
  no rocks (`rockiness`), cracked clay via the per-vertex `mud` attribute in `src/world/sandMaterial.ts`, hotter by
  day). Noise primitives and the seeded PRNG (`mulberry32`) in `shared/noise.ts`; per-cell layouts (rocks, canyons) are
  cached with `cellCache` (`shared/cellCache.ts`, bounded for the server)
- `shared/scrap.ts` — deterministic scrap-pile layout + hitboxes (collided in `step()`, drawn by `src/world/scrap.ts`);
  pieces give one of the two basic materials, `scrap` or `cloth` (shared/items.ts `SCRAP`/`CLOTH`)
- `shared/shelters.ts` — small empty bunkers (small/deep/long) scattered mostly in rocky country: placement, pad,
  collision, pumps (`atWater`), stash spots, `indoors()`/`sandHidden()`; none within 350 m of the origin; drawn by
  `src/world/shelters.ts`
- `shared/solarfarms.ts` — solar farms: old power towers with rings of heliostats far out (none within 2.3 km of the
  origin), on a graded pad (`withSolarPad`) the rocks, shelters, crash sites, scrap and wrecks keep off (`solarWithin`);
  collision of posts, tower and shed (`collideSolar`), the mirrors as a ceiling (`solarCeiling`) and as shade
  (shared/shade.ts), stash spots (`solarLootSpot`, `SOLAR_STASHES`); no crawlers: a nest of spiderlings on the mirrors
  by the tower (`shared/nest.ts` perches and numbers, `server/nests.ts`, ticked by server/guardians.ts, 'bots' `n`);
  drawn by `src/world/solarfarms.ts` (instanced field tiles, the receiver glowing at the hour the farm froze)
- `shared/towers.ts` — radio towers (docs/radiotowers.md): 120 m lattice telecom towers on high ground, one per 1.8 km
  cell (none within 800 m of the origin, at least 800 m apart, off the biomes with `towers: false`, `empty` ones and the
  solar farms), on a pad (`withTowerPad`) the shelters, crash sites, scrap and wrecks keep off (`towerWithin`). Legs,
  mast, deck rails and cabinet collide (`collideTowers`), the three decks are desert ground (`towerGround`), the ladder is
  the desert's `Level.ladder` (`towerLadder`: where a climber hangs on it; F grabs it, `PlayerState.climb`, shared/sim.ts
  `stepClimb`; the body's hands and feet rung by rung in src/models/scavenger.ts `climbLadder` from
  src/models/climbCycle.ts, the clank of each in src/climbSound.ts), legs and cabinet stop
  shots (`towerSolid`). Three fixtures where parts are fitted (`SPOTS`, `SPOT_ITEMS`: the radio at the cabinet, the dish
  drive on the dish deck, the antenna feed on the top deck), each gear (`fixture`, shared/gear.ts) in a box of its own
  (`twr<tower×4+spot>`, shared/boxes.ts `towerBox`); `server/towers.ts` makes them as players come near
  (shared/lootRoll.ts `towerParts`), says which towers are alive ('towers': all whole and the radio's battery charged)
  and drains that battery (`TOWER_W`). Drawn by `src/world/towers.ts` (the frame shared by every tower, its members
  widened with distance; lamp, big dish and cabinet lamps follow `alive`); heard by `src/towerSound.ts` (the wind in the
  lattice, the cabinet's hum, the radio muttering, also through a receiver or jammer in hand); two drones keep each
  (server/drones.ts `keepTowers`). F3: To radio tower, Fix radio tower

## Weather and survival

- `shared/mothership.ts` — the mothership's geosynchronous orbit and attitude from the time of day (`docs/mothership.md`); drawn by
  `src/world/mothership.ts` in its own pass, laid into the sky dome (`src/world/sky.ts`) between the air and the stars
- `shared/sun.ts` — day clock + sun elevation (client sky and server heat); `shared/water.ts` — thirst/canteen; where
  it fills: `shared/wells.ts` `waterAt` (a pump, or a running electric well); `arrivalEase`: a newcomer's first
  minutes by the pod build heat slower and stop short of heatstroke (`Heat.arrivedAt`, set in server/world.ts)
- `shared/health.ts` — health (`HEALTH_MAX`), apart from heat: blows go through `hurt` in server/world.ts (a shield
  takes each one whole), heatstroke, choking and vortices take it all (`die`); server-side only for now
- Dying on the client: `src/water.ts` times it (grey `deathGrade` in `src/post.ts`, muffle `audio.setMuffled`, the
  fade to black and back in after the server's `respawn`); under the black `src/deathDust.ts` shows a hint
  (`TEXT.deathHints`) on a dust screen
- `src/dustScreen.ts` — dust screen: blown sand on the dark with a script of text cards (`DustScript`: prose, title,
  caption lines with timings; optional loading bar), drawn in a worker (`src/dustScreenWorker.ts`), sand on the GPU
  (`src/dustScreenGpu.ts`) or in 2D, text by `src/dustScreenRunner.ts`; the loading cover's prologue
  (`src/prologue.ts`) and the death hint are scripts for it
- `shared/temperature.ts` — air/felt °C by time of day (drives thirst); `shared/shade.ts` — sun ray march (shade;
  counts huts, wrecks, players and bikes, built tarps)
  tuning, drained and validated in `server/water.ts`, HUD + `playerHands` in `src/water.ts`
- `shared/storm.ts` — local sandstorms (path, strength, warning) and rare world-wide storm fronts (mega-storms: choke
  you in the open, `sheltered` = a shelter or the lee of rock; death tally in server/world.ts); scheduled by
  `server/storm.ts`, heat in `server/water.ts`, beep/banner/locator in `src/storm.ts`, dust columns and the front's wall
  in `src/post.ts`
- `shared/gas.ts` — poison gas (night weather, scheduled with the storms in `server/storm.ts`): a low cloud creeping
  in, rising to `GAS_DEPTH` over the dune floor (`duneFloor`, shared/dunes.ts), so climb a big dune or rock; it fills
  shelters; chokes in `GAS_S` (`gassed` in server/world.ts); no effect on electronics. Client `src/gas.ts`, drawn in
  `src/post.ts`
- `shared/vortex.ts` — sand vortices: a seeded field over the whole desert (3 km squares, some with a vortex circling
  inside for ever on the wall clock, none near the pods), found near a point with `vorticesNear` (the server's
  `StormServer.vorticesNear` adds the debug menu's summoned ones; the clock's zero comes with the storms); faster heading
  downwind; the drag (`vortexPull`, fed to `step()` like the storm's push), death in the core (thrown high,
  server/world.ts), drones dragged in and torn apart (server/drones.ts `whirl`). Client `src/vortex.ts` (wind, grit) and
  `src/vortexSound.ts` (its roar), drawn in `src/post.ts` (its own reduced-resolution pass, the nearest one). Debug
  menu: summon one, go to one

## Home, buildings and power

There is no starting base: players arrive in the crashed pods (shared/pods.ts, above) and build what they need, anywhere.
Everything built is shared, and anyone can take a building down.

- `shared/origin.ts` — the world's origin (`ORIGIN`, picked per seed: where the first bunker stood), which the layout is
  measured from (site levels, the scrap fields, the pods' spots, keep-outs round the start, the flying wing's odds); it
  stays put so every world keeps its layout. `originClear` is the ground round it the layout keeps clear
- `shared/capsules.ts` — vertical capsule collision (`collideCapsules`, the arch/vault helpers the shelters use) and the
  grid of 16 m cells holding everything put up (`setPlacedCapsules`, `collideOutdoor`, `overPlaced`: never dug), in
  world coordinates
- `server/bunkerGone.ts` — once per world (settings `bunker_gone`): what was kept in the old bunker comes out (its chests
  into new chests by the spawn, the machine on its table, repair slots back to the bags, things on its floor back to
  their owners or moved out onto the sand, players and vehicles in it to the spawn)
- Buildings — the windmill, the battery station, the power pole, the beacon, the light pole and the well, anywhere on
  the sand: put up with the wrench (made by hand; right mouse with it in
  hand opens the build menu, `src/buildMenu.ts`, placing in `src/placing.ts`)
  from base materials only (scrap, cloth, wiring: `shared/tables.ts` BUILD_TABLE, `shared/crafting.ts` BUILDS), used up
  as it goes up and all given back when it's dismantled (G with the wrench); never carried as items. The workbench, the
  dismantling bench and the chest are no longer built (the cart's workshop and box replaced them, docs/cart.md); ones
  standing in older worlds still work and come down into what they took (`RETIRED_BUILD_TABLE`; `isBuildable` covers
  both, `buildCost`). The windmill and
  station are gear with part slots and quality (`shared/gear.ts` `built`), standing with their slots empty (bearings
  and motor, batteries fitted after), placed via `shared/placed.ts` (`sand` kinds: `gap` between them,
  `STRUCTURE_GAP` from the shelters' huts, `POD_GAP` (0.8 m) off a crashed pod's hull (`nearPod`); where it goes by where you stand, `placeFloor`: the `floor` kinds also on a shelter's room floor,
  `shelterRoomClear` in shared/shelters.ts; collision in shared/capsules.ts); while standing, the item is in box
  `bld<id>`, whose parts are swapped in place (F, `src/inventory.ts` `part:<box>`); drawn by `src/world/placed.ts` (lit
  by the sky or a shelter's fill, by where it stands; materials `src/world/glbMaterial.ts`), models
  `tools/blender/placeables.py`
- Net terminals (docs/terminals.md), reusable client-only dressing. `src/world/netTerminal.ts`: `NetTerminal` (an old
  CRT terminal and keyboard in two kinds, `TERMINALS`: `console` (default), a 1970s video terminal in shiny dark metal,
  keyboard deck and monitor one body, a black hood round a big screen, `public/models/terminal_console.glb`; `compact`, a
  small beige CRT on a plinth, `public/models/terminal.glb`; both from `tools/blender/terminal.py`; `.object` where it
  stands, screen toward +Z, `.update(dt, eye)` each frame; `lit` for indoor lights; `.program` / `.text`) and
  `TerminalScreen` (only the bulged glass, for any other model's screen). The screen draws a `TerminalText` grid
  (`src/world/terminalText.ts`: teletype `write` and screen-style `print`/`setLines`, a cursor, `version`; helpers `fit`,
  `bar`, `wrap`, `typewriter`; tested by `tools/terminal-text.test.mjs`) that a `TerminalProgram` writes each awake frame;
  the default, `src/world/codeStream.ts`, streams the game's own code (a script this page loaded, re-fetched from cache,
  chosen by `seed`; bursts, pauses, slow typed lines). Drawn through a TSL CRT (phosphor `tint`, white by default; halo,
  scanlines, barrel) under black glossy glass (lit: sun highlight, sky reflection, a faint glare), the text in a pixel
  `face` (`FACES`: `vt220` "Glass TTY VT220", public domain, the default; `vt100`), a glyph to a cell on its own pixel
  grid at a whole `scale` (console 80 x 24 at 1, compact 56 x 21 at 2), redrawn only on change; the phosphor blooms
  (`src/post.ts` `glowsHot`). Asleep beyond 16 m. Its quiet loop: `src/world/terminalSound.ts` (event `terminal.hum` at
  the nearest terminal in 12 m, fed by each `update`). One of each kind stands in the lab (`shared/lab.ts`
  `LAB_TERMINALS`, `src/world/labPlates.ts` `addLabTerminals`; the compact runs `labBoard`, the example program)
- Work stations — `shared/stations.ts` `stations()`: the two sides of every unfolded level-2 cart (`shared/cart.ts`
  `cartWorkshops`, the workbench x < 0, the table x > 0) and the placed ones still standing from before the cart
  (shared/placed.ts `WORKBENCH`, `TABLE`, `CHEST`; models `tools/blender/stations.py` with the builders in
  `tools/blender/stationkit.py`, which also makes the shelters' hand pump, `public/models/pump.glb`); each an oriented
  look-target box (`yaw`, `stationLocal`, `stationReach`, `stationTarget`). Any workbench opens the repair slot
  ('bench', each player's own) and its recipes, any dismantling table takes carried machines apart (shared/crash.ts
  `tables()`, turned by `yaw`, `onTable`; a session per table, `cart<vehicle id>` or `bench<placed id>`; server/crash.ts
  keeps a job per table, `bench_jobs`; a cart with one doesn't pack or hitch: `packBlocked` in server/world.ts); a chest is box `store<placed id>` (CHEST_COLS × CHEST_ROWS, shared). A table with a machine on it or a
  chest with anything in it can't be taken down (server/world.ts onUnplace)
- Vehicles — `shared/vehicles.ts` (the list, reach, `vehicleTarget`), `server/vehicles.ts` (`vehicles` table: broken
  the quad by the pods and motorcycles at the crash sites, repair, `mount`/`release`, `mine` per player), drawn by
  `src/world/vehicles.ts` (parked) and `src/bike.ts` (ridden). The quad (`GEAR.quad`, the one broken by the pods, HOME_BIKE: rides
  like the bike, `PlayerState.quad`): `tools/blender/quadbike.py` → `public/models/quadbike.glb`, drawn ridden by `src/quad.ts`
  (`RidePose.perch`/`climb`/`toe`: short legs go up its toe ramp) and parked by `src/world/vehicles.ts`; it takes a
  passenger: F on one being ridden (`pillionTarget`) → server `board`/`unboard`, `PlayerState.pillion` (the rider's id;
  `step` doesn't move them, server/world.ts `carryPassengers` puts them where the rider is each tick, `pillionOff`
  beside it), drawn on its back by `Quad.passenger()` (src/main.ts `pillion`); test `tools/quad-pillion.test.mjs`; lab
  `models-lab.html?ride=quad&pillion&body=0,1,2&turn=6`. The cart (docs/cart.md): one per world, everyone's, a
  vehicle kind (`GEAR.cart`, no part slots, its level `ItemData.level` in box `veh<id>`, its box `cargo<id>` chest size)
  — `shared/cart.ts` (dimensions, `TOW_LENGTH`/`HITCH_BACK`/`HITCH_MAX`, `towHitch` the towing step, `towedPose`,
  `couplerOf`, `backingUpTo`, `cartTarget`, `CART_LEVEL_NODES`); towing in `shared/sim.ts` (`PlayerState.tow`/`hitch`,
  `stepBike`: the bike's and the quad's alike, the quad's tow ball in its model), poses carry them (`shared/network.ts`);
  server: `settleCart` (at the world's start: one by the first pod in a new world; `oneCart` once, setting `one_cart`,
  left one of the per-player carts of older worlds, the others' boxes and table machines merged into it, the rest dropped
  behind it), `tryHitch` (anyone, backing a bike or quad up, each tick from server/world.ts offBike), `unhitch`, `Vehicle.hitched`/`open` (columns);
  drawn by `src/world/carts.ts` (`public/models/cart.glb` or a stand-in with the same nodes). Phase 2: `unfold`
  (message `unfoldCart`, the rotate key looking at the unlinked cart, src/main.ts), `upgrade` (`upgradeCart`, the
  wrench's build menu by the cart; no owner checks; `shared/tables.ts` `CART_TABLE`, `shared/crafting.ts` `CART_UPGRADES`), `tryHitch`
  packs an open cart (hook `packBlocked`); `shared/cart.ts` `unfoldError` (tilt), `canopyRig` (a tarp rig: shade, solid
  canvas, billow), `cartCapsules` (parked carts are solid), `setCarts` (from `setVehicles`), `cartToWorld`; the hinge
  animation table `FOLD` in `src/world/carts.ts`, the sound `src/cartSound.ts`. Phase 3: level 2's sides are the
  workshop (above, Work stations); the pods' kit pays for the wrench and both levels. Test `tools/cart.test.mjs`.
  The cart unfolded at level ≥ 1 is where everyone wakes after dying, ahead of a bedroll (`shared/cart.ts` `isCamp`,
  `campWakeSpot`; `VehicleServer.camp`; server/world.ts `homeOf`/`clearToWake`; the respawn's `facing` turns the
  camera to it, `net.onFace`). Test `tools/cart-spawn.test.mjs`.
  The bigger camp: the sides' leaves slide out (benches 1.2 m deep, camp 3.76 × 2.2 m), the poles rake out with
  telescoping tops, the canopy is put up visibly (`shared/cart.ts` `canopyRising`, drawn by `src/world/tarps.ts`
  `CanopyModel` in the canopy's own clean canvas style; it shades and is solid once `Vehicle.pitching` is cleared,
  `canopyUp`), and level 2's work lamps light the benches dusk to dawn (`CartView.lamps`, borrowing `PoleLamps`' pool).
  It flies a faded rust-red rag (`RAG_COLOR`): torn, knotted round its back left corner post, swinging in the wind (a
  small Verlet chain), and a worn painted stripe of it on the lid (`src/world/carts.ts`); parked, it's on everyone's
  locator bar in a neutral colour (`src/world/vehicles.ts` `cartTargets`, shape `cart`)
- `shared/garden.ts` — plant beds (stages, look target), owned by `server/garden.ts`; beds and UV lamps are placed
  things that stand on a shelter's floor only (not crafted for now)
- `shared/trophies.ts` — the bosses' trophies, buildings like the others (kinds `trophy_<boss>`, `TROPHY_PLACEABLES` in
  shared/placed.ts, no cost in shared/crafting.ts BUILDS): in the wrench's build menu once their kind is beaten and while
  not up (`trophyFree`: one per kind per world, checked in server/world.ts onBuild); anyone takes one down with the wrench
  and it's back in the menu. Footprint and boxes from the model's real shape (`POSTS`, recentred: `CENTRE`). Models made
  from the bosses' glbs by `src/world/trophies.ts` and handed to src/world/placed.ts (`provide`). Winning doesn't need
  them standing
- Beacons (`beacon_light`, shared/placed.ts `BEACON`) — a lamp on a mast that shines a column of light into the sky, a
  marker: built with the wrench like the others (scrap, wiring), `MAX_BEACONS` of their own; one battery slot. Powered like a load on the grid (shared/power.ts `BEACON_W`, `draw`;
  server/power.ts): wired, it runs on the windmills, then on every battery on its grid (and the grid charges its battery);
  alone, its own battery runs flat (a Scrap one ~2 real hours). Dark without power (`PowerState.lit`). R in view of one
  cycles its colour (`BEACON_COLORS`, 8; src/placing.ts, `beaconColor` message), kept in its item's ItemData `color`.
  Model made in code and every beam in one instanced draw (a camera-facing quad per beam that widens with distance):
  `src/world/beacons.ts`
- Light poles (`light_pole`, shared/placed.ts `LIGHT_POLE`) — a 5.6 m mast with a floodlight on an arm that lights the
  sand round it at night: built with the wrench (scrap, wiring), one battery slot, powered like a beacon but only from
  dusk to dawn (shared/power.ts `LIGHT_POLE_W`, `poleDark`; server/power.ts puts it in `PowerState.lit`). Model made in
  code; the light is a pool of shadowless spot lights put in the scene at startup and handed to the lit poles nearest
  the camera (src/world/lightPoles.ts `PoleLamps`, src/world/pooledLight.ts; the carts' work lamps join the same pool
  through `setLamps`, `shared/power.ts` `darkAt`)
- Tarps (`tarp`, shared/placed.ts `TARP`) — shade you put up: a patched canvas diamond stretched tight between two
  leaning scavenged poles (5.0 and 5.5 m) at opposite corners, the other two corners pulled down to 1.5 m and staked, a
  taut saddle (3.2 m in the middle); made by hand (no wrench: shared/tables.ts HAND_TABLE, 3 cloth, 2 scrap), put down
  from the hotbar and picked back up whole with G like a bedroll; four turns (R: which way the low sides face, ±Z by
  default, towards the sun's rise and set). The poles collide, and the canvas's low corners' tips (`tarpBoxes`); you
  walk in under it from any side (bedrolls, chests, benches fit under: `shelteredBy`). The canvas is solid to the sim:
  the desert level's ground and ceiling (`tarpGround`, `tarpCeiling`, set from the placed list by `setTarpRigs`): a jump
  from under it stops at it, you land and stand on it from above, and slide off where it's steeper than SLIP_TAN
  (`tarpSlope`, shared/sim.ts); the camera stays on its side of the canvas. The rig (corners each over its own sand,
  poles, guy lines) and the canvas's shape (`canvasAt`, `canvasYAt`) are `shared/tarp.ts`, used by `shared/shade.ts`
  (`tarpTris`: a 4×4 grid of the canvas; the middle is shade 9:00–17:30 with the low sides to the sun) and by
  `src/world/tarps.ts` (model made in code; seams, patches and corners painted from its uv; the canvas billows in
  `windSpeed` in a TSL vertex shader)
- Electric wells (`well`, `shared/wells.ts`) — a borehole with a submersible pump, water at home: built with the wrench
  (scrap, wiring), gear with three slots (motor, valve, relay: `GEAR.well`), wired to a grid. Its control box is a small
  load all the time (`WELL_IDLE_W`, lamp lit); it runs (`PowerState.wells`, `setWellsOn`) while its grid could give the
  pump `wellSpec().watts` right now (wind left over, or a bottle's worth in the batteries), and each bottle filled
  takes that out of them (server/power.ts `pump`). The canteen fills at its spigot (`waterAt`: a pump or a running
  well, the fill time by the parts; server/water.ts `fill`, src/water.ts); no water table, it goes wherever a building
  can. Drawn with its lamp, wet patch and drip in `src/world/placed.ts`, hum and pump in `src/wellSound.ts`; the
  character remarks on a dry one (`src/speechLines.ts` `well.dry`). Model `tools/blender/well.py`
- `shared/power.ts` — electricity, somewhat realistic in game time (`GAME_SPEED`: a game day is 30 real min): the
  shared wind (`windSpeed`: day cycle, weather, gusts, storms), windmill output (½ρAv³·Cp·η by bearings/motor,
  furling) and rotor speed, battery stations (per-battery kWh by tier, a Scrap battery = a car battery, 0.6 kWh; coils
  = the charger) and charging; `server/power.ts` runs each grid (what is wired together) each second, keeps each
  battery's charge live and saves it in the battery itself (its ItemData `charge`, fitted in the station), catches up the time the world slept; the panel shows W / kWh (`src/inventory.ts`),
  cells' lamps the charge
- `shared/wires.ts` — power lines: connectors (`CONNECTORS`, a socket ~3.2 m up on each electric thing; the power
  pole, scrap, is one up at 4.5 m), a wire per wiring coil (used up; its tier is its reach, `COIL_REACH`), `grids()`;
  strung with a coil in hand, click a connector then another, right-click cancels (`src/wiring.ts`); `server/wires.ts`
  (`wires` table), drawn by `src/world/wires.ts`

## Loot, items and gear

- `shared/tables.ts` — every loot table and crafting recipe (machine/wreck yields, world finds, caches, kill drops,
  workbench recipes, HAND_TABLE (made by hand anywhere: the wrench), BUILD_TABLE, BOSS_SPOILS, HARVESTER_SPOILS) as plain data; tune drops and recipes there.
  `shared/lootRoll.ts` — the dice that roll them in the world (caches, stashes, finds and where they lie,
  kill/jet/harvester/boss drops), shared by the server and the economy simulator (`tools/econsim`, docs/econsim.md)
- Item data — one item's own state (`ItemData` in `shared/items.ts`: a battery's `charge`, a shield's `worn`), one
  JSON `data` column; it goes wherever the item goes, and items with any never stack. Fitted parts keep theirs in
  `data.fitted` (`partAt` / `setPart`)
- `server/itemMigrations.ts` — items saved by older versions made current as their box loads (`migrateBox`);
  `server/grants.ts` — one-off gifts to players from before a change (the backpack, the rifle)
- `server/items.ts` — item stacks in boxes (bag, equipment, workbench, bike, chests: `shared/items.ts`,
  `shared/storage.ts`), Tab overlay in `src/inventory.ts`. Box ids and each kind's traits (own or shared, grows,
  fitted, take-only) are in `shared/boxes.ts` (`BOX_KINDS`); what depends on the world (size, label, shape) is a
  `Record<BoxKind, ...>` in `shared/storage.ts` and `shared/gear.ts`, so a new kind of box is added in those places
- `shared/effects.ts` — gear effects: modifiers an item puts on whoever has it, in hand (`held`) or anywhere in the bag
  (`carried`). `EFFECTS` (each one's tone bad/neutral/good, its `TEXT.effects` label, and its movement modifiers:
  `speed`, `noJump`, `noSlide`), `ITEM_EFFECTS` (kind → its effects: the piercer is `bulky` in hand). The server sets
  shared/sim.ts `PlayerState.effects` (a bit per effect) each tick from bag and hand (server/world.ts simulate:
  `effectsOf`); step() reads it on foot through `moveOf`; the snapshot carries it to prediction. Shown as chips in the
  item tooltip (src/inventory.ts `effectChips`). A new effect: an entry in `EFFECTS` (and in `moveOf` if it changes
  something new), named on items in `ITEM_EFFECTS`.
- `shared/gear.ts` — gear found broken and repaired with parts at the workbench (part slots, quality, what each does);
  `shared/moves.ts` the move and repair rules for client and server (tryMove, fitPart, unfitPart, boxShape);
  `shared/gearBits.ts` what others see worn and carried (wornGear, carriedGear, gearTiers); `shared/loot.ts` + `server/loot.ts` — finds and caches in the world, drawn
  by `src/world/loot.ts`. Every model of gear shows its tier (quality rounded down: rust → as made → polished brass →
  pale with a cyan sheen), `src/tierLook.ts` `applyTier`; others see it via `PlayerSnap.tiers` (`gearTiers`). The
  shield plate (Armor slot) takes one killing blow, then breaks (`shielded` in server/world.ts, `src/shieldFx.ts`)

## Crash sites and machines

- `shared/crashsites.ts` — deterministic crash-site layout + hitboxes; sites have a level by distance from the origin
  (`SiteLevel`: 0 scrap fields with starter machines/gear, 1 crawlers, 2 guardians + rarest parts; outposts are level 1
  sites among the scrap fields, 1–2 crawlers, loot in between: `LootLevel`) that picks their wrecks, machines
  (`LEVEL_KINDS`, shared/crash.ts), finds (server/loot.ts) and walkers (`shared/crashKinds.ts` is generated by
  `tools/blender/crashsites.py`); drawn by `src/world/crashsites.ts`, heard via `src/crashSound.ts`. Each site holds
  machines to take apart (`machines`): `shared/crash.ts` gives them ids/kinds, `server/crash.ts` sessions and spent
  sites (`crash_spent`) and visited ones (`crash_visited`: something picked up there, its smoke stops), `src/world/crash.ts` + `src/teardown/` the disassembly (what comes off flies into the root of the stage the machine is
  in: the desert's or a level's; a step's marker shows only once its `after` steps are done, so in a code-built machine
  (`shared/machineBuilders.ts`) everything under a lid or cover lists the lid's holds (`k.bay(...).holds`) in its `after`).
  The machine pipeline: docs/machines.md

## Enemies

- `shared/enemies.ts` — the registry of everything a player can destroy and loot (crawlers, guardians, drones, jets,
  the harvester, the bosses): how many come at once, where they're met, what one leaves (`drops`: the server's kill
  drops go through it) and rough fight odds by weapon (read by the economy simulator; tune them there)
- `shared/guardians.ts` — walkers (rare giant guardians with cannons, player-sized crawlers at crash sites and in
  small packs roaming the open by night) + night
  searchlight drones (constants, beam test; `lineOfSight`, what guardians, drones and the carrier see by: the sand and
  shared/terrain.ts `shotSolid`, so a hut, solar shed or radio tower hides you); walkers, bolts (bursting on the sand or
  a wall, `shotGround`; the burst's blast only on those it sees) and missiles simulated in `server/guardians.ts`, which ticks
  the drones (`server/drones.ts`; their beams call the guardians, `alert`), what both share in `server/bots.ts`; legs
  are client IK in `src/world/guardians.ts`, bolts `src/world/bolts.ts`, drones `src/world/drones.ts`, glue/sound/shake
  in `src/guardians.ts`, `src/guardianSound.ts`
- `shared/runner.ts` — the runner: a four-legged hunting robot after Spot, far bigger than a horse, with great hinged insect jaws, and an armed variant (a heavy rail gun on a robotic arm on its back, `RunnerKind`, held steady in the world by the arm's IK as it runs); rig numbers
  shared with its model `tools/blender/runner.py` (-> `runner.glb`), its speeds, turn rates, weak points (`RUNNER_POINTS`, `RP_*`), states (`R_*`)
  and its 'bots' `r` layout (`RUNNER_STRIDE`). Its AI is `server/runners.ts` (`RunnerServer`, owned and ticked by
  `server/guardians.ts`: sent for someone out in the open, stalks, charges and bites (committed within `COMMIT_R`: a late
  sidestep dodges) or, armed, shoots the guardians' bolts from afar; hits checked against where it was drawn); drawn
  from `runnersAt` (`src/world/botFrames.ts`) by `Runners` in `src/world/runner.ts` (`Runner`: rig, IK, trot/gallop gait,
  `fire`, `snap`, the death slump, `raycast` hit boxes; `Prowl` moves one about for show), glue/sound in `src/guardians.ts`
  `updateRunners`; seen in the models lab (`models-lab.html?runner`, `src/models/runnerLab.ts`); docs/runner.md
- `shared/jets.ts` — fixed-wing drones: high fast flyovers (straight or big circles), day and night; 3 rifle hits and
  it glides down; scheduled by `server/jets.ts`, drawn by `src/world/jets.ts`, roar in `src/guardianSound.ts`
  (`jets`). Two kinds (`JetKind`, shared/jetbreak.ts): the fixed-wing drone (MQ-9-like, 18 m span, no engine: its
  wreck drops parts, `DRONE_JET_SPOILS`, `tools/blender/machines/dronejet.py` -> `dronejet.glb` +
  `shared/dronejetpieces.ts`) and the stealth flying wing (`tools/blender/machines/plane.py` -> `jet.glb` +
  `shared/jetpieces.ts`); the wing's odds grow with the distance from the origin, 0 to 80% at 10 km (`WING_ODDS`,
  server/jets.ts). Down, it comes apart on impact (`shared/jetbreak.ts`: each piece (`PIECES_OF[kind]`) flies,
  tumbles, bounces and settles on the sand, splashing it; deterministic, so the server and every client run the same),
  and when they lie still a permanent crash site is made (`shared/jetcrash.ts`, `server/jetcrash.ts`, in the world's
  DB, pieces solid via their own capsules): each of the wing's engines (80% tear off, 30% of those are wrecked in the
  landing) is a `jet:<n>:<k>` machine to take apart (the turbofan; jet engines hardly lie anywhere else)
- `shared/harvester.ts` — the harvester: a building-sized tracked monolith of the mud flats, rising out of the mud and
  crawling a route that keeps to the flat (pose is math on the route, its pace stretches and the server clock); ignores
  everyone but whoever it sees ahead (a wedge), whom it turns towards, charges and runs over; killed only by shooting
  the three cores in its maw; brain `server/harvesters.ts`, view `src/world/harvesters.ts`, sound
  `src/harvesterSound.ts`, model `tools/blender/harvester.py`, spoils `shared/tables.ts` HARVESTER_SPOILS

## Bosses

- `shared/bosses.ts` — bosses (one-of-a-kind giants with health, weak points to shoot that regrow, HUD bar
  `src/bossBar.ts`): called with receivers (gear: uranium cell + an enemy's part, `RECEIVERS`/`RELICS`; `onCall` in
  server/world.ts, needle `src/receiver.ts`) or F3; every kind beaten wins the world (`beaten` in server/world.ts,
  trophies `src/world/trophies.ts`). `server/bosses.ts` spawns and ticks one brain per kind, `src/bosses.ts`
  interpolates them and handles the weak points; spoils in `shared/tables.ts` BOSS_SPOILS. Shared by the brains:
  delayed blasts (`server/blasts.ts`: due, blast, ball, column) and players' smoothed velocities (`server/tracks.ts`
  Tracks, also the crawler packs')
- Each kind follows one pattern: numbers in `shared/<kind>.ts`, brain `server/<kind>.ts`, view `src/world/<kind>.ts`
  (built on `src/world/bossParts.ts`), sound `src/<kind>Sound.ts`, model `tools/blender/<kind>.py`. The kinds:
  - worm — 200 m, swims through the sand, bursts out under prey, charges half out of it, or flies a huge arc firing
    missiles from its back; Terraria-style head steering, segments follow its path
  - carrier — the hive carrier: huge four-fan drone that bombs from its belly, fan hubs are its weak points
  - queen — the brood queen: giant eight-legged spider (gait, rear-and-slam numbers); the server steps the feet and
    simulates the spiderlings it drops from its sac (their hunt `server/brood.ts`, shared with the solar farms' nests;
    drawn by `src/world/brood.ts`, a small queen in its palette, also the nests'); leg IK in the view
  - colossus — 67 m biped (rig sizes, gait, stomps, snapshot layout); the server has the feet, footprint craters, big
    stomp and fall furrow; leg IK and the death topple in the view

## Weapons and tools

- `shared/rifle.ts` — the guns (`GUNS`: the laser rifle, the cheaper one-handed laser pistol, the heavy blaster whose
  beam bursts where it stops, the long, heavy piercer whose slug goes through the walkers' plate, and the never-found
  graviton pistol; gear found broken and repaired, shared/gear.ts; model `tools/models/pistol.py`), armour (`bites`:
  a hull's plate, shared/enemies.ts `armor`, turns every gun but the piercer (the walkers' plate, wearing their hull:
  `HULL_HP`) and the graviton pistol, which kills anything it touches; weak points and thin-skinned things are always
  hurt), the piercer's bulk in hand (a gear effect, shared/effects.ts), the walkers'
  red weak points (a guardian's take `GUARDIAN_POINT_HP` hits, cracked and blinking after the first; all broken: it
  dies), drone hits and the burst's `blastDamage`; aim, sway, recoil, scope and the hitscan in `src/rifle.ts`,
  beam/sparks/smoke `src/world/zaps.ts`, sounds `src/rifleSound.ts`, targets, cracks and the collapse in
  `src/world/guardians.ts`; `onFire` (server/world.ts) checks the shot, hands the gun to the struck enemy's `shoot`
  (server/guardians.ts, drones.ts, jets.ts, harvesters.ts, nests.ts, bosses.ts) and sets off the blaster's `burst`
  in each of them (`GuardianServer.pointAt`: the weak points where the server reckons them); tests
  `tools/weapons.test.mjs`
- Each gun's crosshair: `src/reticle.ts` (`Reticle`, one SVG glyph per gun drawn over a dark halo: pistol brackets,
  rifle fine cross, blaster burst ring with a drop bar, piercer rails with a penetrator and three capacitor chevrons,
  graviton void with orbiting motes); it opens with the hip cone and fills back in with the recharge through three
  custom properties (`--g`, `--q`, `--rot`), flashes white on a hit (src/rifle.ts `strike`); the plain dot
  (src/crosshair.ts) shows when no gun is in hand. The scopes' reticles (rifle duplex, piercer ranging chevron) are
  `SCOPE` in src/rifle.ts
- The heavy guns as fired: their feel (`FEEL` in `src/rifle.ts`: raise time, sway, kick, view jolt, shake, zoom punch,
  pad rumble); their beams are `zaps.beam` kinds (`BEAMS` in `src/world/zaps.ts`, pooled per kind); the blaster's
  burst (`BLASTS.blaster`) and the graviton's caving-in end point in `src/world/blasts.ts` (pooled; lit through
  `zaps.light`, the shots' one light; `blasts.shake` shakes the view via src/camera.ts `rumble`); sounds
  `src/gunSound.ts` (levels in docs/audio.md, the `blaster`/`graviton`/`piercer` scenarios of `tools/audio-bench.ts`)
- The piercer as fired and carried: `FEEL.piercer` (`wander`/`settle`: steady braced, wandering on the move), its
  lingering ionised trail (`BEAMS.piercer` `trail`), the muzzle blast and the punch-through with molten metal
  (`blasts.piercerMuzzle`, `blasts.piercer`), crack/roll, plate clang and capacitor whine (`gunSound.piercer*`); the
  weight in hand is presentation only: a slow deep camera plod (`ViewPose.slow`, `heave` on a jump that can't happen,
  src/camera.ts) and heavy footsteps (`footsteps.step` `heavy`, from src/players.ts's held item: `weighsDown`)
- Explosions: `blasts.explode` / `explodeOnSand` (`src/world/blasts.ts`), each tuned by a `BlastSpec` made by
  `blastSpec(strength)` (the fireball's radius in m; burn time, rise, ring, sparks, debris, smoke, sand, scorch, light
  and shake follow it, any field can be set over it); `BLASTS` has the game's: blaster, guardian bolt (sand / air),
  missile (guardians', worm's, colossus'), carrier bomb, crash (jets, the harvester). The fireball itself is
  raymarched (`src/world/fireball.ts`: noise-displaced ball, blackbody glow by temperature, sun-shadowed soot, clipped
  to the surface struck; steps by the sand detail setting). The hot parts (the fire's glow but not its smoke, ring,
  sparks, embers, molten metal, plasma, the graviton's halo and motes) also write a `hot` scene target
  (`glowsHot` in `src/post.ts`) that the bloom adds past its threshold (`hotBloom`), so they glow without the sand blooming
- `shared/jammer.ts` — the jammer (gear, found broken and repaired): hold it 3.5 s on a jet or drone in its cone and it
  glides down whole; the lock is added up by `onJam` (server/world.ts), aimed and heard in `src/jammer.ts`, model
  `src/models/jammer.ts`
- `shared/throw.ts` — thrown scrap (any scrap item in hand, use button): flown and struck against drones in
  `server/throws.ts`, lands as loot; drawn and thrown in `src/throw.ts`
- `shared/knockback.ts` — knockback: every weapon's push (`PUSH`), what it does to each enemy by its `mass`
  (shared/enemies.ts); applied by the server to walkers and drones (server/guardians.ts `knock`, server/drones.ts `hurt`),
  our own hits shown at once by `src/world/shoves.ts`
- `shared/mace.ts` — the scrap mace (a two-handed club made by hand from scrap): a wide stroke, two blows break a
  crawler's flank lenses; swung and tested against the walkers as drawn in `src/mace.ts`, held and swung in the hands'
  MaceIdle / MaceSwing clips on `MaceMount` (tools/models/hands.py) and by the avatar (`MACE`, `MACE_STROKE` in
  src/models/scavenger.ts), model `src/models/mace.ts`, checked by `onSwing` (server/world.ts) and `GuardianServer.smash`
- `tools/models/blaster.py`, `tools/models/graviton.py` — the blaster's and the graviton pistol's models
  (public/models/blaster.glb, 1.11 m, a 75 mm wide receiver; graviton.glb; src/models/outfit.ts `GUN_MODELS`): held in the hands' Blaster* / Graviton*
  clips on `BlasterMount` / `GravitonMount` (src/viewmodel.ts, muzzle from the `<Gun>Muzzle` markers), by the avatar
  (`BLASTER` / `PISTOL` in src/models/scavenger.ts GUN_HOLD), on the sand (src/world/loot.ts), icons by
  tools/blender/finds.py
- `tools/models/piercer.py` — the piercer's model (public/models/piercer.glb, 1.76 m, `GUN_MODELS`): an open-rail
  anti-materiel rifle with a scope. Both it and the blaster are modelled at their numbers and then scaled up (`SCALE`)
  about the receiver's floor, all but the grip, trigger and guard; hands.py fits the hands to `HANDS` (as built); held in the hands' Piercer* clips on `PiercerMount` (src/viewmodel.ts, `PiercerMuzzle`), by the
  avatar (`PIERCER` in GUN_HOLD), on the sand (src/world/loot.ts), icon by tools/blender/finds.py
- `tools/models/hands.py` — first-person hands + held-item clips (docs/viewmodel-hands.md)
- `tools/blender/icons.py`, `tools/icons/` — inventory icons for what has no Blender model of its own (scrap, cloth, the
  wrench, the carried machines, dumped from their three.js models); every icon's look and size: `docs/icons.md`

## Text and speech

- `shared/text.ts` — every player-visible text (`TEXT`): names of things, prompts, notices, menus, hints, step labels,
  speech; rules in `docs/text.md`
- `src/speech.ts`, `src/speechLines.ts` — the character's subtitled remarks: engine + when each line is said (event,
  condition, once/again; the words are in `TEXT.speech`); guidelines in `docs/speech.md`

## Audio and measurement

- `src/audio.ts` — shared audio context, volume buses, warning ducking, finite-sample guard and post-limiter capture;
  `src/audioWorklet.js`, `src/limiterKernel.mjs` — stereo-linked look-ahead limiter with intersample peak detection
- `src/acoustics.ts` — placed sounds, distance/air filtering, shared reverbs and echoes; `src/audioBudget.ts` bounds
  transient voices/echoes, and `src/obstruction.ts` caches conservative line-of-sight attenuation
- `src/audioConfig.ts` — every sound: samples (file, measured LUFS, trim dB, slices, loop) and synths (what, which
  module defines it, trim), and every sound event (sounds, gain, pitch/spread, route, reach, warning, arg, what plays
  it): swap or rebalance sounds here; `tools/audio-config.test.mjs` keeps it in step with `public/audio/`, the synths
  defined and the code. `src/sounds.ts` — the sample bank, `defineSynth`, and `play(event, at, ear, { level, arg })`
  for either kind (`playSound`, `playSample` for one sound by a route)
- `src/audioBench.ts` — the audio workbench (?debug: F3 → "Audio workbench", opening on the left): any event, sample or synth played from a spot
  round you through the game's graph, trims and gains edited live, "Copy edits" for the config
- `tools/audio-bench.html`, `tools/audio-bench.ts`, `tools/audio-measure.mjs` — real browser sound graphs captured
  after the limiter, measured by FFmpeg; scenarios, target levels and recorded results in `docs/audio.md`

## Rendering and performance

- `src/world/heightShadow.ts` (dune shadows from the heightfield, not the shadow maps), `src/world/cascades.ts`
  (cached cascades: redrawn only when needed; they hold only things: players, wrecks, the pods, bosses),
  `src/world/shadowLod.ts` (small casters left out of far cascades): see `docs/perf.md`
- `src/perf.ts`, `tools/perf.ts` — CPU/GPU frame timing (stats graphs, User Timing for traces) and the automated
  benchmark run (`npm run perf`: waits for the game to be playable, walks a route, writes JSON + a Chrome trace to
  `data/perf/`); `tools/trace-report.py` reads Chrome performance traces; read `docs/perf.md`
- `tools/bench/` — the CI benchmarks (`npm run bench`, `.github/workflows/bench.yml`): world generation, physics and the
  enemies in Node (`cases/`), the world server under bot load (`server.ts`, `serverHook.ts`), two commits in turns and compared (`stats.ts`); read `docs/bench.md`
- `src/telemetry.ts`, `server/telemetry.ts` — stall tracing to `data/telemetry.jsonl` (docs/netcode.md "Telemetry");
  read it with `node tools/telemetry.ts` (digest + HTML report, or `tail`)
