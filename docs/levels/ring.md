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
| Hall | 70 m wide (along the axis), 60 m from deck to ceiling; it runs all the way round (3.14 km) |
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
