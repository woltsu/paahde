# Gameplay test scenarios: world-state snapshots

A scenario is a snapshot of the whole test world, loaded in place of it to play one situation through again and again.
Dev server only (`npm run dev`), in the test world only (`?w=test`).

## Using them

- In the test world, open the debug menu (F3) and switch its header from **Debug** to **Scenarios**. Elsewhere the view
  just offers to go there.
- **Load** replaces the whole world with the snapshot and you play its protagonist: where they stood and faced, what they
  carried and wore, their health, the slot in hand, under your own name. Everyone in the world is sent off (close code
  4012) and their pages reload into it. Load again to retry: the snapshot's live state is given once, when you are first
  back in, so a reload or a second tab afterwards finds the world as it has gone on.
- **Save** keeps the world as it is now as `scenarios/<id>.json`, you its protagonist (an id of `a-z`, `0-9` and `-`,
  `SNAPSHOT_ID_RE` in shared/world.ts; a label and a line on what it's for). Everything is written to the database first,
  as on the way out (server/world.ts `flushAll`; a ridden bike where it is, its rider still on). Saving an id that exists overwrites it. Commit the file to share it.

## What a snapshot holds

- **The database, every table and row** (`server/snapshot.ts` `dumpDb`): players, bags and boxes, equipment, terrain
  digs, scrap and loot, crash-site progress, placed things, vehicles, power, corpses, settings (lives, bosses beaten,
  where bosses stand). That is everything a server restart keeps. Loading empties every table and writes the snapshot's
  rows in one transaction, matching columns by name (a column added since gets its default, one dropped is ignored),
  then ends the world process without saving: the next one is built from the rows, as after any restart. As it stops
  taking anything (`frozen`) the process tells server/index.ts it is closing, and a connection that comes meanwhile (the
  pages reloading) waits for it to exit and goes to the next one.
- **The live state a restart would lose** (`LiveState` in `server/world.ts`): the time of day (the clock is set to it),
  the weather (storms, gas, summoned vortices, whether random weather is off, when the next ones come), every walker
  (guardians and crawlers, with their homes, damage, timers and whom they hunt), and the protagonist's facing, health
  and hand. Server-clock times are moved to the new process's clock.
- **Not held:** drones, jets, bosses' fights in progress, harvesters, missiles and bolts in flight, night packs (their
  crawlers come back as summoned ones). They start afresh. The seeded sand vortices follow the wall clock.

## Browser IDs and names

Browser IDs are secret credentials and snapshots are checked in. A dump replaces every UUID in every row with a
placeholder: the saver's with `PROTAGONIST` (`00000000-0000-4000-8000-000000000001`), which becomes the loader's browser
ID, anyone else's with `…000000000002`, `…3` and so on (offline players in the loaded world). Players' names are theirs
too: every `name` column (players, obituaries) is replaced, the saver's with `Protagonist` (`PROTAGONIST_NAME`; the
loader plays under their own), the others' with `Player <n>` for placeholder n, and the same name the same everywhere (a
name in an obituary whose player is gone gets a number of its own). `tools/snapshot.test.mjs` fails on any other UUID or
name in `scenarios/`.

## Making one

Play it into place and Save. What the debug menu can't do (a spot, an exact time, an enemy at an exact place) can be
edited in the file, which is plain JSON with one row a line:

- the protagonist's row in `tables.players` (`x`, `z`; the height comes from the sand), `live.saver.facing` (the sim's:
  0 looks towards -z, π towards +z), `live.tod` (0..1);
- a walker in `live.walkers.walkers`: `x`, `z`, `yaw`; `home` `{ "id": -1, "x": …, "z": … }` makes it patrol round
  that spot (gone once nobody is within 450 m of it); `feet: null` plants its feet where it stands; `guardUntil`
  (server-clock ms, against `live.savedNow`) keeps it standing that long.

`scenarios/piercer-guardian.json` was made that way: saved after giving the piercer, bottle, spyglass and backpack
(worn) by the debug menu, then the protagonist moved to (-873, 777) facing +z with the evening sun at their back, the
time set to 17:31, and the guardian the menu had brought moved 300 m ahead, onto a rise 12 m up (a clear line of
sight), standing a minute before it patrols.

## The test world

`?w=test` (`TEST_WORLD` / `TEST` in shared/world.ts) is a dev-only world like the lab and the bench: the server only has
it with `--lab` (`npm run dev:server`), the browser only in Vite's dev mode, and the snapshot messages do nothing
anywhere else. It's the real desert from the fixed seed of the id `test` (a snapshot's rows are about that layout), with
everything happening in it, endless lives and no beginning.
