# Gameplay test scenarios

A fixed set-up to play one situation through again and again: where you stand, what you carry, the time of day, the
weather and the enemies round you. For the dev server only (`npm run dev`).

## Using them

- Open the debug menu (F3, with `debug` in the URL), switch the header from **Debug** to **Scenarios**, press
  **Start**. From any other world it goes to the test world first (`?w=test&debug&scenario=<id>`) and starts the
  scenario once you're in; in the test world it starts at once. Start again to retry.
- **Start empties your bag and equipment** (in the test world, the only place it runs) and fills them as the scenario
  says; the first hotbar item is in hand. Health, heat and water are reset (a full bottle).
- The time of day moves the test world's **shared clock** (everyone in it sees it). Weather `clear` turns random storms
  off (the debug menu's "Disable weather") and clears the ones blowing; the seeded sand vortices still roam far off.
- Enemies placed by a scenario go when you start another one, or once nobody is within 450 m of where they stand
  (like a summoned crawler pack). A killed one isn't replaced.
- The rest of the desert keeps going: the world's own guardians, drones at night, jets and crawler packs.

## The test world

`?w=test` (`TEST_WORLD` / `TEST` in shared/world.ts) is a dev-only world like the lab and the bench: the server only has
it with `--lab` (`npm run dev:server`), the browser only in Vite's dev mode. It's the real desert from the fixed seed of
the id `test`, with everything happening in it, endless lives and no beginning (new players start by their pod). Its
database is `data/worlds/test.db`; delete it for a fresh world (the layout comes from the seed, not the database).

## Adding one

Add an entry to `SCENARIOS` in `shared/scenarios.ts`:

- `at`: a place in the test world's seed (x, z in m) and `facing` (the sim's: 0 looks towards -z, π towards +z).
  Find open, flat sand away from crash sites with a clear line to where the enemies go: `tools/scenarios.test.mjs`
  checks every scenario's line of sight, and a quick script importing `shared/terrain.ts` (`heightAt`) and
  `shared/crashsites.ts` with `WORLD_ID=test` finds candidates. Mind the sun: at evening it sets towards -z.
- `tod` (0..1), `weather`, `hotbar` (up to five; gear with a `tier` comes repaired with parts of it), `bag`
  (equippable gear goes on), `enemies` (`dist` m away, `bearing` turned from straight ahead; `standS` seconds standing
  guard before it patrols; `hunting` to have it come at once), `noHeat`.
- Only guardians can be placed so far. Another kind wants a placing method in its server module (like
  `GuardianServer.stage`/`unstage`) and a branch in `server/world.ts` `onScenario`.
- Run `node --test tools/scenarios.test.mjs`.
