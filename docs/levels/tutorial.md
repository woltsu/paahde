# Level: the beginning (the last datacenter)

A short first level, played once per player per world, before the desert: you wake aboard the last datacenter still in
orbit as it starts to fall, find your way through it to an escape pod, and come down in the pod that lies crashed at
the spawn. It is the game's tutorial, made under the game's rule against tutorials (CLAUDE.md "Game design & text"):
no instructions, no objective markers, no rule text. The building is laid out so the next thing to do is the only
way forward, and the world tells the rest (light, sound, what moves, the character's own short lines).

Built on the levels architecture (`docs/levels.md`) and the datacenter's parts (`docs/levels/datacenter.md`: materials,
racks, light pool, environment profile, ambience). Read both, and the code as built, first. Nothing here is built yet.

## The story it tells

The prologue (`TEXT.prologue`) already says it: the rain stopped, the cities sent their machines out for water, the
cities are gone, *the datacenters came falling down from orbit*. This is the last of them coming down.

- You are its custodian: a person kept aboard to do what the machines can't (change a fan, pull a jammed board). The
  crew quarters have bunks for twelve and one made bed. Nobody else has been here for a long time.
- The datacenter still runs, perfectly, and doesn't care about you. Racks blink, fans roar, a cleaning cart does its
  rounds. When the orbit finally goes, it doesn't evacuate you; it goes on working until it hits the air.
- The way out is the pod bay, the last pod in it. Through the bay's one window the planet turns below, orange, no
  clouds. That is the only window in the level, and the first look at the desert.
- The pod comes down where the game begins. The crashed pod at the spawn is the one you rode. Nothing says so; the
  pod's orange band and the bay's are the same paint.

Never told in words: who built it, what it computes, why you were there. Things to find, not to read: the empty
bunks, a child's drawing of rain taped to a locker, a rack row labelled with city names, a wall plaque with a
water-drop logo (the same logo is on the machines out in the desert, `tools/blender/` decals).

## Shape

One linear walk, ~4–6 minutes, ~120 m of corridor and halls, eight beats. Each beat teaches one thing the desert
needs and shows one thing about the story. The level is quiet at first and gets louder: the fall is the clock, but
there is **no timer and no failing**. You can't die in it, it waits for you, and the rumble grows only as you move
on (it is driven by your progress, not by time).

```
 [1 quarters]──[2 corridor]──[3 server hall]──[4 collapsed aisle]──[5 control room]──[6 sub-floor]──[7 bay corridor]──[8 pod bay]
  wake          crouch        walk, sprint      jump, air jump        take apart          (fall back in)   slide           the pod, the window
```

| # | Room | Teaches | How the world asks for it | The story beat |
|---|------|---------|---------------------------|----------------|
| 1 | Crew quarters (6 × 8 m, low ceiling) | look, walk | You wake on the one made bunk under a red alarm light; the door slides open as you come near it | Eleven stripped bunks, lockers open, a drawing of rain |
| 2 | Corridor (2.4 m wide) | crouch | A cable tray has come down across it at 1.1 m; sparks off the cut end light the gap under it | Screens along it show one word, the station's state (below) |
| 3 | Server hall (the datacenter's hall, smaller: 4 rows) | walk, sprint | Long cold aisle to the far door; the lights go out row by row behind you after a big jolt | Everything still running; the cleaning cart crosses in front of you and on, it doesn't stop |
| 4 | Collapsed aisle | jump, air jump | A rack has fallen across the aisle (jump onto it, over); further on the floor tiles have dropped into the sub-floor: a gap too wide for one jump, fine with the air jump | The rack rows here are labelled with city names |
| 5 | Control room | interact (F), taking a machine apart, the bag | The door to the bay is shut and its control cabinet is dead (sparking, door half open a hand's width). F at the cabinet opens the disassembly mode; the panel's last step is the relay, taken into the bag. With the relay gone the cabinet's interlock lets go and the door opens | The station's own console, still printing status for nobody |
| 6 | Sub-floor (only if you fell into the gap in 4) | there's always a way back | A ladder of cable trays and a cold-air duct back up to the aisle | Dust, old cables, a custodian's bag with a torch in it |
| 7 | Bay corridor (long, down a slight ramp) | slide | A blast door closing slowly from the top at the end: run and slide under it (it stops at 0.8 m and stays there, so a crouch-walk gets under too, more slowly) | The station's voice: a chime and a recorded "please" in a language nobody speaks any more, over and over |
| 8 | Pod bay | F on the pod, the relay used | Eleven empty pod cradles, one pod. Its hatch panel is dark: the relay from 5 goes in (F at the panel with it in the bag; it is used up). Then F at the hatch to get in | The window: the planet, orange, turning |

Then the pod: the hatch shuts, the camera stays in the pod's seat for ~3 s of shaking and roar, the screen goes to a
dust screen (`src/dustScreen.ts`, the prologue's and the death hint's), one caption card, and you wake beside the
crashed pod in the desert with the game's first line (`TEXT.speech.start`) as now.

### The station's screens

The only words in the level, and few: the screens along the walls show one word or two, in capitals, the station's
state, changing as you go: `NOMINAL`, then `ORBIT DECAY`, then `ATTITUDE LOST`, then `ENTRY`. No numbers, no countdown.
They are world text, so they go in `TEXT.tutorial.screens` like everything else.

### What the character says

`TEXT.speech.tutorial`, through `src/speechLines.ts`, once each (docs/speech.md: one short first-person sentence when
something matters, pointing at what to do without explaining rules):

- waking: "That's not the usual alarm."
- at the fallen tray: "Under it, then."
- the lights going out in the hall: "Not good. Not good at all."
- at the gap: "I can make that."
- at the dead cabinet: "The door's dead. Its relay must be the trouble."
- with the relay: "This should wake the pod up."
- at the window: "So that's where we're going."
- getting in the pod: "Come on, come on."

### Control hints

The world asks first; a key only if it doesn't work. If you stand at a beat's obstacle for 8 s without doing the
thing, the one key for it appears, terse, at the bottom of the screen, through `src/bindings.ts` (`ctl`/`hintKeys`,
`TEXT.tutorial.stuck.crouch(k)` and so on), and goes as soon as you do it. Never shown again in that world. This is
the "can't be played without it" case: a new player can't guess that there is an air jump.

## What it must not do

- **Cost lives.** `level.mortal: false`: nothing in it hurts (the server's `hurt` refuses damage in an immortal
  level), and there is nothing that could kill. Thirst and heat don't run (`climate: { tempC: 20 }`).
- **Change the economy.** What you take in it is used in it: the relay is the cabinet's only part kept (its other
  steps give nothing), and it's used at the pod. The custodian's bag in 6 has nothing you keep (the torch lights the
  sub-floor while you're in it and stays). Leaving, the server takes back anything of the level's still in the bag.
  So the desert start is as now; `npm run econ` must show no change.
- **Show anyone else.** It is private: one per player, no remotes, and other players never see you while you're in it.
- **Hold up friends.** Esc menu → `TEXT.menu.skipBeginning` takes you straight to the pod in the desert. Players who
  join a world where they've played before never see it again (a grant, below).

## How it's built

### Instances and per-player state

The datacenter (docs/levels.md) is one shared place per world. This one is one per player: a level property
`private: true`. The server's interest by level already keeps snapshots apart; `private` keeps everyone in it out of
each other's (two players in the same private level never see each other, even though their coordinates coincide).

What changes as you go (doors, the cabinet, the hatch panel) must be the same in your prediction as on the server, or
you'd rubber-band against a door the server has opened. So it lives in the player's own state:

```ts
// shared/sim.ts
export type PlayerState = { ...; level: LevelId; gates: number }; // gates: a bit per opened door/obstacle in this level
```

- A `Level` may have **gated solids**: boxes that collide only while their bit in `s.gates` is clear (the doors, the
  blast door's lower half once you're past it, the dead hatch). `collide()` reads `s.gates`, so `step()` stays a pure
  function of state and input.
- **Only the server sets bits**, on server events (you reached a trigger box, finished the cabinet's relay step, used
  the relay at the panel), and they reach the client with the next reconciliation, as `level` does. No input bit.
- Doors that open as you approach (1) are a trigger: the server sets the bit when you're in the trigger box; the door
  animates open on the client from the bit flip (cosmetic; collision is gone at once, the panel slides away in 0.4 s,
  so you can't walk into a half-open door that doesn't collide).
- `gates` resets to 0 on any level change. Progress through the level is `gates` plus the beat index the server keeps
  for the speech and rumble (`server/tutorial.ts`); a reconnect mid-level puts you back at the start of the beat you
  were in (the level is short; no need to save more than `level`, position and `gates`, which `players` saves).

### The cabinet

A machine site like any other (`shared/crash.ts` machine kinds: `control_cabinet` exists and has the look), with id
`tut:cabinet`, taken apart in place with the real disassembly mode, so the player learns the real thing. Its loot is
fixed (not rolled), and only the relay step gives an item: a level item `tut_relay` (shared/items.ts, `levelOnly:
'beginning'`, never in a loot table, stripped on leaving). The site is private too: its progress is per player (keyed by
the player, or reset when they leave), not world state. Check how `server/crash.ts` keeps site progress; the cleanest is a
site id per player (`tut:cabinet:<public id>`) so nothing else in the machine code changes.

### Set pieces (client-only, from progress)

- **Rumble:** camera shake, a low roar, and light flicker, scaled by the beat. Cosmetic: never in the sim, so the
  prediction is untouched. The camera shake respects the comfort options (`src/comfort.ts` motion setting: reduced
  motion → no shake, only sound).
- **Lights out (3):** the hall's fixture rows switch off behind you, through the light pool's per-fixture weights (no
  shader rebuilds).
- **The cleaning cart (3):** a kinematic prop on a fixed path, not a mover: it never blocks you (it passes in front of
  you on a cross aisle when you trigger it, and is gone).
- **The blast door (7):** descends from the top on a fixed curve from the moment you enter the corridor's trigger; its
  collision is a gated solid at 0.8 m from the start (the visual comes down to meet it), so the sim never sees a moving
  solid.
- **The window (8):** the planet is a big emissive disc with a TSL orange-planet shader (limb darkening, a thin hot
  atmosphere rim, slow rotation), far behind a glass pane in the level's root. No sky, no sun light: it lights nothing
  but itself and a weak orange fill pooled light by the window.
- **The ride down:** in the pod's seat (the pod's interior is a small model built for this, or the camera inside the
  existing `pod.glb` with its hatch shut), shake and roar growing, then the dust screen.

### Getting to the desert

The pod launch is the level's exit: the server moves you to `DESERT` at your pod's spawn (`podSpawn`), with `gates` 0,
marks the grant, and you wake there as a new player does now. The same path serves Esc → skip.

### Who goes through it

- On joining a world, a player with no `beginning_done` grant (`server/db.ts` grants, as `arrival_bike` in
  server/vehicles.ts) and no saved position starts in the level instead of at the pod. Players with a saved position in
  this world (everyone already playing when this ships) never see it.
- Not in the lab or the bench. `?spawn=beginning` starts there every time (dev), `?spawn=pod` skips it.
- Dying in the desert never brings you back to it.

## Files

| New | What |
|---|---|
| `shared/levels/beginning.ts` | the layout (rooms, boxes, gated solids, triggers, fixtures, the cabinet's spot, the pod), its `Level` |
| `server/tutorial.ts` | per-player progress: triggers, gate bits, the beat, the relay, the launch, the grant, skip |
| `src/levels/beginning/` | its stage: the rooms (reusing the datacenter's materials, racks and light pool), set pieces, planet window, pod ride |
| `tools/beginning.test.mjs` | the walk: from the bunk to the pod reachable with every gate open in order, blocked while each is shut; nothing can harm; the relay is the only item it gives and the pod takes it |

| Changed | How |
|---|---|
| `shared/levels.ts` | `private`, `mortal` properties; gated solids in the `Level` collision contract |
| `shared/sim.ts` | `PlayerState.gates`; collision passes it to the level |
| `shared/items.ts` | `tut_relay` (level-only) |
| `shared/text.ts` | `TEXT.tutorial` (screens, stuck hints, the caption card), `TEXT.speech.tutorial`, `TEXT.menu.skipBeginning` |
| `server/world.ts` | start new players in it, `hurt` refuses in immortal levels, the move out |
| `src/speechLines.ts`, `src/menu.ts`, `src/dustScreen.ts` (a script for the ride) | as above |
| `tools/econsim/` | only if it needs to know (it should not: the level is net zero); run `npm run econ -- --base origin/main` |

## Phases

1. The layout and its `Level` with gated solids and `PlayerState.gates`; dev `?spawn=beginning`; walk it with every
   gate open. Test the walk.
2. The server's progress: triggers, doors, the blast door, the cabinet (real disassembly mode), the relay, the pod and
   the move to the desert. The grant; new players start here; skip.
3. The look and the telling: rooms dressed, set pieces, screens, speech, stuck hints, the window, the ride down, the
   dust-screen card, ambience. `docs/speech.md` and `docs/text.md` checks on every line.

## Open questions

- A pod interior model, or the camera inside `pod.glb` with the hatch closed? The latter is cheaper and reads fine with
  the shaking and the dark.
- Whether a returning player in a *new* world should see it again (as written: yes, once per world, with skip). Once
  per browser would be kinder to regulars; the profile (`src/profile.ts`) could remember it.
- The datacenter in the desert (docs/levels.md phase 4): story-wise it is one of the fallen ones. Its dressing can
  echo this one (the same water-drop logo, the city names) so going in later feels like going back.
