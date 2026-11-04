# Todo issues

Known problems not fixed on the spot (boy-scout rule, `CLAUDE.md`). Anyone, human or agent, adds here and picks from here.

- **Add** one bullet per finding, newest at the bottom: `- [area] what's wrong, where (`file:line`), why it matters. (date, who)`
- **Fix** it, then delete its bullet in the same commit. Fixed means gone; no done-list here.
- **Stale or wrong?** Delete it, and say why in the commit message.
- Keep it terse: one finding per bullet, a sentence or two. Long reasoning goes in the devlog or a doc.

## Open


- [netcode] The server's fire-rate check subtracts a bolt's whole flight (`server/world.ts:1096`): at the blaster's 450 m reach a hacked client may fire every ~0.45 s instead of 2.2 s. Track per-shot fire times (the trigger, not the landing) to close it. (2026-11-04, Claude)
- [weapons] The player's blaster burst (`server/world.ts` `burst`) hurts every drone, spiderling, crawler or walker point within BLAST_R of where the bolt stopped, through a hut's wall too; guardian bolts' blasts now need sight (`lineOfSight`), the player's should likewise. (2026-11-04, Claude)
- [startup] Terrain and shader warm-up run one after the other (`src/main.ts` `modelsIn` waits for `terrain.built`), and the first terrain layout gets only 25 ms per 66 ms loading frame (`src/world/terrain.ts` `LOADING_BUDGET_MS`, `src/yield.ts`): ~1.2 s of CPU takes 2.3–2.9 s. Warming once one chunk per sand material exists, and building terrain in the warm-up's idle gaps (~2 s of waits and rests), could save 2–3 s of an 8–12 s join (docs/perf.md "Startup timeline"). (2026-11-04, Claude)
- [startup] The shader warm-up's batch only grows below `FAST_MS` 60 ms a round (`src/warmup.ts`), but a round is a whole post-processed render plus a GPU wait, so batches stay at 1–4 and 20–40 rounds spend ~2–3 s waiting and resting (`compileWaitMs` + `gpuWaitMs` + `pauseMs`). One big batch measured 4.5 s vs 7.7 s, but as a single 4 s freeze; grow the batch on `buildMs` alone, or keep compiles in flight across rounds. (2026-11-04, Claude)
- [startup] Each distinct material costs ~22 ms of warm-up: the bike's ~18 flat-colour GLB materials (~0.4 s), the barrel built 9 times (one material, once per InstancedMesh, ~0.2 s), scrap GLBs each bringing their own rust/steel/tape copies. A palette/vertex-colour material per model, or sharing materials by name across GLBs, keeps load time flat as content grows. (2026-11-04, Claude)
- [audio] Footsteps and the bike's landing pan by the camera yaw handed to their own `listener()` (`src/footsteps.ts`, `src/bikeLandSound.ts`), while the audio config's generic 'panned' route (`src/samples.ts` `panOf`) reads the Web Audio listener: two ways to do one thing. Move both modules onto `panOf` and drop their `listener()` calls. (2026-11-04, Claude)
- [audio] Continuous synthesised sounds aren't in `src/audioConfig.ts`, so the audio workbench can't play or tune them: wind (`src/windSound.ts`), engines (`src/engineSound.ts`), drones' buzz and missiles'/jets' roar (`src/guardianSound.ts`), the worm's rumble, the carrier's thrum and a falling bomb's whistle (moves with it), the colossus's engine, harvester, tower, well, grinder, slide, cart, jammer static, crash sites, gas and the levels' beds (the beginning's pod and jolts play into its fall). They need a second interface, a voice kept alive and steered each frame (`set(params)`, `stop()`), before they can be events. (2026-11-04, Claude)
- [tools] Every boss/enemy Blender script (`tools/blender/guardians.py`, `colossus.py`, `carrier.py`, `harvester.py`, `queen.py`, `worm.py`, `runner.py`) carries its own copy of the `MB` mesh builder and helpers; fixes have to be made seven times. A shared `tools/blender/mb.py` (scripts add their dir to `sys.path`) would do. (2026-11-04, Claude)
- [lobby] A direct game link (`?w=lab&debug`) opened on an origin with no saved name gets refused with 'name' (4422) and the page reloads over and over, never showing character creation (seen on a second Vite port, `src/lobby.ts` `refused`). (2026-11-04, Claude)
