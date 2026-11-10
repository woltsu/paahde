# The beginning aboard the ring (plan, November 2026)

A redesign of the beginning's environment (`docs/levels/tutorial.md`): the same walk and the same lessons (look, walk,
crouch, sprint, jump, air jump, take a machine apart, slide, the pod), but no longer a string of small rooms. It
happens in one **vast open hall inside a spinning ring station**: the deck curves up ahead of you and behind you into
the haze, the ceiling curves with it, and the side walls are giant curved bands. Gravity is the spin's: it points out
from the station's axis, and "up" is always towards the axis.

Read `docs/levels.md` (the level contract), `docs/levels/tutorial.md` (the beats, gates, server side) and
`docs/netcode.md` first. Everything there still holds; this changes the place, and adds the ring's frame.

## The station

| | |
|---|---|
| Radius (axis to deck) | **500 m** (`RING.radius`, one constant: "see how it feels") |
| Hall | 70 m wide (along the axis), 36 m from deck to ceiling (60 at first); it runs all the way round (3.14 km) |
| Spin | ω = √(g/R) for the game's own gravity (25 m/s²): 0.224 rad/s, a turn every 28 s |
| Sight line | the ceiling hides the deck beyond √(2RH) ≈ 245 m: the floor rises ~60 m into the haze there |

Seen from the deck: a floor that bends up into a wall of haze both ways, a ceiling that bends down to meet it, side
walls that are 60 m bands curving away, and portal ribs every 30 m (columns up both walls, a beam across the ceiling)
that make the curve legible. Light comes from long bands in the ceiling running round the ring; rack fields stand on
the deck in islands; dust and haze give the depth.

## The key decision: simulate in the ring's own coordinates

**The sim is not changed into 3D vector gravity.** It keeps its flat level frame, read as the ring's cylindrical
coordinates:

- `z` is **arc length along the deck** (round the ring), `x` is **along the axis** (across the hall), `y` is
  **height above the deck** (towards the axis: r = R − y).
- In those coordinates spin gravity *is* `-y`, the deck is `y = 0`, the side walls are `x = ±35`, the ceiling is
  `y = 60`, and every bulkhead (a radial wall) is `z = const`. All of them are boxes. Collision, ground, ceilings,
  gates, the cart, crouching and the box grid are unchanged.
- So `step()` stays deterministic and exactly predicted (docs/netcode.md), and nothing in the netcode, the protocol,
  the server or the bench changes. The alternative (a real 3D up vector per player, collision against cylinders,
  quaternions in the snapshot) would rewrite the sim for one level and break every invariant the netcode relies on.

What the flat frame leaves out of real spin gravity, and how it's handled:

1. **Coriolis** (the real thing you'd feel): in a rotating frame, a = −2 ω × v. With the hall's axis along x and the
   spin running towards −z (so the walk, +z, goes against the spin):
   - airborne, rising makes you drift along the spin and falling against it: `vz += 2Ω·vy·dt`
   - moving along the ring changes your weight: `vy += −2Ω·vz·dt` (against the spin you're lighter, with it heavier)
   with Ω = −ω (signed: the spin's direction). At a sprint (11 m/s) that's ±20 % of g; a full jump drifts ~0.35 m.
   **It goes in the sim** as a level property `spin` (Ω, rad/s; 0 or absent everywhere else), applied only in the air
   (on the deck the floor takes the vertical part, and on the ground vy is 0). Deterministic: no clock, no randomness.
   The gaps are tuned with it on; `RING.coriolis` scales it (0 turns it off) if it plays badly.
2. **The radial metric**: an arc at height y is (R − y)/R as long as the deck's. At head height that's 0.4 %; at the
   rack tops 0.4 %; ignored (nothing you walk on is more than a few metres up).

## Rendering: the ring is drawn round the camera

The player, their hands, held items, sparks, thrown things and the camera all live in the flat frame (the common
scene, unchanged). The stage's root holds the **ring**: geometry in true ring coordinates (the axis along x through
(0, R, 0)), mapped from the flat frame by

```
ring(x, y, z) = (x, R − (R − y)·cos θ, (R − y)·sin θ),  θ = z / R
```

Each frame the stage sets `root.matrix` to the rigid motion that takes the ring point under the camera back to the
camera's flat position, with the ring's local "up" (towards the axis) on +y: a turn about the axis by the camera's θ
and a shift along z. Near the camera the ring and the flat frame agree to d²/2R (5 m: 2.5 cm, 10 m: 10 cm), so the
player's body and everything common sit right on the curved deck around them, and far away the deck rises, exactly as
it would. **The camera's up is always +y, which is always towards the axis; gravity is always −y, always outward.**
No material, shadow pass or post effect needs to know (positions, normals and distances are those of a true ring).

How each kind of thing gets onto the ring:

- **Box geometry** (`boxGeometry`, the layout's boxes): faces split along z into ≤ 2 m strips, every vertex mapped by
  `ring()` and every normal turned by θ. The flat position and normal go along as attributes (`lpos`, `lnor`), and the
  datacenter's materials read those instead of `positionLocal`/`normalLocal` (the bake, tiles, strips' cut, face UVs:
  all in the level's flat frame, as before).
- **Small rigid things** (racks, props, the cart, doors, the pod, the cabinet): placed whole by the rigid ring motion at
  their own z (`ringMatrix(z)`), exact at that z, a few mm off at their ends. Their own animation (a door sliding up,
  the cart rolling along x) runs in their flat local frame, unchanged.
- **Lights**: the light pool places each fixture's light at `ring(pos)` (and a spot's target below it). Scoring by
  distance stays in the flat frame.
- **The shell** (deck, side walls, ceiling, ribs, ceiling light bands): its own geometry, built directly as cylinders
  and annuli all the way round, with its own TSL material (`src/levels/beginning/ring.ts`): deck plates and lane paint,
  wall panels, light bands, and the bands' light pooled on the deck (analytic, emissive: the pool's six lights can't
  light a 3 km hall). A cool haze by distance (`scene.fogNode`) is what makes it read as huge.
- **Space** (the pod bay's window): the dome turns with the station (θ of the camera plus ω·t), so stars and the planet
  wheel past once every 28 s.

## The walk, re-laid on the deck

Same beats, gates, triggers and server (`server/tutorial.ts`), new places (z is along the ring, walking +z):

```
 [crew block]                         [the deck: open hall]                                         [pod terminal]
  1 quarters ─ 2 corridor (crouch) ─▶ 3 rack fields, the cart, lights out (sprint) ─ 4 fallen beam (jump)
                                       ─ trench across the deck (air jump; 6 its floor, the way back up)
                                       ─ 5 the cabinet at the terminal's shut door ─▶ 7 bay corridor (slide) ─ 8 pod bay
```

1. **Quarters** and **2. the corridor** stay as they are, inside the *crew block*: a building standing on the deck.
   The corridor's door opens out of its face onto the deck: the reveal, the hall's whole curve in front of you.
3. **The deck** (~180 m): islands of rack rows either side of a broad central lane, the cleaning cart crossing it, the
   lamp posts and ceiling bands going out behind you after the jolt. Open: you can wander between the rack fields.
4. **The fallen gantry**: a cable gantry down across the whole hall (jump onto it, over). Then **the trench**: a
   strip of deck plates dropped into the service level, wall to wall, too wide for one jump. **6.** Its floor runs the
   hall's width; a ladder of fallen trays leads back up.
5. **The pod terminal**: a building across the hall's far end, its door shut; the dead cabinet lies on the deck in
   front of it. The relay out opens the door.
7. **Bay corridor** and **8. pod bay** inside the terminal, as now.

The deck's walkable stretch is closed by the two buildings and by **safety fences** from their sides to the side walls
(4 m mesh: you see through them, the hall goes on round). Beyond them the shell and its dressing go on all the way
round. Bounds stay a box round the walkable stretch.

## Phases

1. **The ring's frame and physics.** `shared/ring.ts` (constants, `ring()`, `ringMatrix()`, ω); `Level.spin` and
   Coriolis in `step()`; the new layout (crew block, deck, gantry, trench, terminal, fences) with every gate, trigger
   and beat as before; tests re-walked (`tools/beginning.test.mjs`, levels, z-fight, server). The walk tuned for
   Coriolis.
2. **Rendering the ring.** Stage root turned round the camera; bent box geometry with flat attributes; rigid
   placement of racks, props, pod and cabinet; the light pool on the ring; the shell and its material; haze.
3. **The look.** Ribs, ceiling bands and lights going out along them, rack fields beyond the fences, the window on
   wheeling space, sound of a big hall (the level's reverb), speech line for the reveal. `docs/levels/tutorial.md`
   "As built" updated, devlog, codemap.

## Open questions

- Is 500 m right? It's one constant; at 500 m the curve is strong (the deck rises 25 m in 160 m). 1 km would read
  calmer and ~1.4× further before the ceiling hides it.
- Coriolis in a first level: it's authentic and small, but a jump that drifts may read as a bug before it reads as
  physics. Phase 1 keeps it on at full strength; turn `RING.coriolis` down after playing.
- The far ring: dressing beyond the fences is instanced racks and the shell; nothing there is reachable.

## As built (phases 1 and 2, November 2026)

- **Physics**: `shared/ring.ts` and `Level.spin` (`SPIN × RING.coriolis`, −0.224 rad/s); Coriolis in `step()` only
  while airborne. Measured, a walking single jump carries 5.6 m without it, 6.5 m against the spin, 5.1 m with it; the
  air jump 9.1 / 10.4 / 9.0 m. So the trench is **8 m** (6.5 before). `tools/ring.test.mjs`.
- **Layout** (`shared/levels/beginning.ts`): the crew block (z −2.6..24.3) and the pod terminal (190..222.6) are
  buildings 8 m tall wall to wall across the hall, so no fences were needed: you see the deck go on over their roofs.
  The deck between: 27 rows of racks in four islands a side of the 12 m lane, lamp posts on the lane's edges (every
  third a shadowing spot), the cart's lane between the first two rows, the fallen gantry at 158, the trench 166..174
  with three tray ladders, the dead cabinet in front of the terminal's door. The quarters, corridor, bay corridor and pod
  bay are the old rooms. The hull (side walls, ceiling, deck plates, the ribs' columns) is `'shell'` collision drawn by
  the stage. The pod bay's window is **in its floor** (only the hull's outside is space: a wall window looked into the
  terminal); the planet is down there (`planet.ts` `PLANET_DIR`).
- **Rendering**: as planned. Box geometry is cut into ≤ 2 m strips along z and bent; the materials read `lpos`/`lnor`;
  racks, gated doors, props (each child at its own z), the pod and the cabinet hang from `ringAnchor`s; the light pool
  places lights by a mapping (`LightPool` `at`). The shell is one mesh round the whole ring (deck cut under the
  buildings and over the trench) plus the ribs every 30 m, with a density haze (`HAZE` in the stage). The bake takes a
  coarser texel here (`LevelLayout.bakeTexel` 0.25 m). Seen in the browser: the deck rises into the haze ahead, the
  terminal stands on the far curve with the deck going on over its roof, the ceiling's bands converge.
- **Not yet** (phase 3): space doesn't wheel with the spin (the dome is still fixed: a turn every 28 s would show the
  planet a fifth of the time); the far ring has no racks beyond the buildings; no reveal speech line; the hall's
  reverb; the hall's lights going out only darken the lamp posts and the ceiling bands over the walk's stretch.

**Longer deck, softer lights-out (November 2026):** the rack fields run 600 m (133 rows; `FALLEN`, `GAP`, the terminal
and everything after moved `FAR` = 480 m on), so the walk spans ~80° of the ring and the curve shows over it; ~80 s on
foot. The deck's lights going out after the jolt trailed 3 m behind you with a hard step, which read as a bug: the cut
now trails 30 m back (`OUT_BEHIND`), the ceiling's bands go out a whole 6 m fixture at a time, and what they threw on
the deck and walls fades over 40 m behind the cut (`FADE` in `src/levels/beginning/ring.ts`).

**Structure instead of lamp posts (November 2026):** the lights-out is gone for now (the jolt keeps its boom and
shake; `GATE.lights` still marks it), and so are the lamp posts. The ceiling is 36 m (`RING.height`; the deck now
leaves sight ~190 m ahead). Over the racks: a tray on struts over every row with its cables, a spine tray along every
island tying its rows together, a light strip under each spine over every aisle (the lane-side islands' are the pool's
lights, every sixth a shadowing spot). Every 90 m from 60 (`GANTRIES`, at ribs that fall in an aisle) a gantry crosses
the hall at 17 m (`GANTRY.y`): a grated deck between the rib's columns and out to the hull past them, rails, a truss
under it, lamps hung beneath; eight pillars (at the lane's edges and in the gaps between islands, solid, hazard-banded)
carry it, tied at 9 m (across the lane too), with a cable riser up each from a cross tray over the spines. The fallen
gantry's work lamps and two floods on the terminal's face light the far end.

**Openable racks (November 2026):** F at a deck rack's front opens its door (`TEXT.prompt.open(TEXT.places.rack)`,
again to shut it). The hall's racks stay one instanced mesh; only an opened rack gets a model of its own
(`src/levels/beginning/rackDetail.ts`): the cabinet and its four rails, the door on its hinge (perforated, smoked glass
or blank, the same pick the rack shader makes: `tslHash` is TSL's `hash` in JS), and its modules, seeded per rack:
1U and 2U servers with vents or drive bays, 4U storage, blanking plates, gaps, the top-of-rack switch with its port
lights, blinking status LEDs, a PDU and a cable bundle; a dim fill on their fronts stands in for the aisle's light. Its
instance is scaled to nothing meanwhile and comes back when the door has shut, or once you are 25 m off. At most six
are open (opening a seventh shuts the oldest at once); each is a few dozen boxes merged into five meshes, built on
opening and freed after. Client-only: the door has no collision and nothing is sent (the level is private). Sounds:
`rack.open`, `rack.shut` (the latch sample, pitched).

