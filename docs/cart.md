# The cart: a camp you tow

Design for the portable base (November 2026). Instead of building workbenches, dismantling tables and chests where
you stand, every player has a **cart**: a two-wheeled scrap trailer they tow behind their bike. Parked, it unfolds
into their camp, and it is upgraded level by level. It replaces the wrench-built workbench, dismantling table and
chest. Grid buildings (windmill, battery station, power pole, beacon, light pole, electric well) stay wrench builds,
and so does the hand-made tarp.

## Levels

| Level | Unfolded it adds | Earned by |
|---|---|---|
| 0 | a lidded box on the bed: storage (`cargo<id>`, the chest's size), going wherever the cart goes | it stands by your pod from the start |
| 1 Shade | a canopy on two poles over the cart (a tarp rig, `shared/tarp.ts`) | upgrade with the wrench: cloth + scrap |
| 2 Workshop | fold-out sides: a workbench on one side, a dismantling table on the other | upgrade with the wrench: scrap + wiring |

No level 3 for now. Towing doesn't slow the bike (yet), whatever the level.

The level is the cart item's own state: an `ItemData` field (`shared/items.ts`), never a column. Upgrades cost base
materials like a building does (`shared/tables.ts` BUILD_TABLE / `shared/crafting.ts` BUILDS): with the wrench in hand
by your own cart, the build menu (`src/buildMenu.ts`) offers the next level; choosing it spends the materials on the
cart. A level is never given back (the cart can't be taken down).

## Owning

One per player. A new player's cart stands, already usable at level 0, by their pod (the way `server/vehicles.ts`
`arrive()` lays out a player's broken bike; existing players get one by their pod once, a grant). Only its owner tows,
unfolds, packs and upgrades it; anyone may use its box and, unfolded, its benches (everything is shared). The owner is
a browser ID: never sent to other clients (each player is told which cart is `mine`, as with bikes).

## States

- **Hitched:** packed and following a bike. Nothing on it is usable.
- **Parked, packed:** standing still. F opens its box.
- **Unfolded:** standing still, its level's pieces out (canopy, benches). Unfold and Pack are buttons in the cart's
  panel next to the bag (F on it), like the bike's Repair, owner only. Unfolding needs ground flat enough (a tilt check
  like the tarp's) and refuses when hitched. Packing refuses while a machine is on its table or a dismantling job runs.
  What's in the box rides along.

## Towing (netcode: `docs/netcode.md`)

The cart moves with a player, so towing is in `shared/sim.ts`, deterministic:

- `PlayerState.tow`: the cart being towed (0 none), like `bike`; `PlayerState.hitch`: the cart's heading (absolute,
  same convention as `heading`). Its pose is derived: the hitch point H is behind the bike's centre; the axle sits
  `TOW_LENGTH` behind H along the cart's heading. Each tick the axle follows H (new axle = H − L · unit(H − old axle)),
  which also handles reversing; the angle between bike and cart is clamped (no jackknife past ~100°). The cart's
  wheels follow the ground for drawing; it collides with nothing while towed (first version).
- Hitching: ride the bike slowly backwards up to your own parked, packed cart's tongue; once the bike's rear is close
  enough, the server hitches it (as `mount()` puts you on a bike: the server sets the state, the client reconciles).
  No key, no text.
- The cart stays linked to the bike (`Vehicle.hitched`: the bike's vehicle id): get off and both park, the cart behind;
  get back on and you're towing again. Unhitch: on foot, F on the cart's tongue.
- Remote players are drawn with their cart from the pose tuple (`hitch` in it): schema version bump.
- Dying or leaving parks bike and cart where they are, still linked.

## Code

- `shared/vehicles.ts` / `server/vehicles.ts`: the cart is a vehicle kind (`GEAR.cart`, `vehicle: true`, no part
  slots), in the `vehicles` table, with `hitched` and `open` (unfolded) on the `Vehicle`.
- `shared/cart.ts`: dimensions, the towing step's geometry, the tongue's spot, unfold/pack rules, the canopy's tarp
  rig and the benches' boxes from a cart's pose.
- Shade: the canopy is a tarp rig set from the cart's pose (generalise `tarpRig` to any heading), so shade, the solid
  canvas and the billow come from `shared/tarp.ts`, `shared/shade.ts`, `src/world/tarps.ts`.
- Benches: `shared/stations.ts` `stations()` also lists the workbench and dismantling sides of unfolded level-2 carts;
  dismantling sessions keyed per cart; `server/crash.ts` jobs keep working.
- The wrench's build menu drops the workbench, dismantling table and chest. Ones standing in live worlds stay usable
  and give their materials back when taken down; they can't be built again.
- The pods' starter kit (`shared/tables.ts`) pays for levels 1 and 2 instead of the benches, so the beginning still
  goes wrench → workshop → take the pod's machines apart → bike. Check `docs/levels/tutorial.md`, the speech lines,
  `docs/econsim.md` (run `npm run econ`).
- Model: `tools/blender/cart.py` → `public/models/cart.glb` (below); unfolding is animated in code by turning its
  hinge nodes; `src/world/carts.ts` draws carts, `src/cartSound.ts` its rattle and the unfold.

### The model's contract (`public/models/cart.glb`)

Origin on the ground under the axle's middle; forward (towards the tongue) is −Z, as the bike's; metres. About 1.5 m
wide over the wheels, a 2.2 m bed, the tongue reaching 1.3 m ahead of the bed with its coupler at its tip
(node `coupler`, its position read by code). Nodes, each pivoted at its hinge:

- `body` (bed, frame, axle), `wheel_l`, `wheel_r` (centred on the axle, spun by code), `tongue`, `stand` (a jack
  under the tongue, swung down when parked unhitched)
- `lid` (the box's lid, opens upwards about its back edge)
- `pole_a`, `pole_b`: the canopy's poles, folded flat along the bed packed, swung up unfolded (the canvas is drawn by
  code between their tips: empties `pole_a_tip`, `pole_b_tip`)
- `side_l` with the workbench on its inner face, `side_r` with the dismantling table: hinged at the bed's bottom
  edges, upright packed (the cart's walls), folded down to horizontal unfolded, legs `leg_l`, `leg_r` under them
- `legs`: the corner stabilisers let down unfolded

Pieces of a level not reached are hidden by code. Stylised scrap, `docs/look.md`; the benches reuse
`tools/blender/stationkit.py`.

As built (`tools/blender/cart.py`, whose header has the details): exported **packed**, every node's rotation identity,
so code unfolds a node by setting the rotation (for `legs`, the position) below, times t ∈ [0, 1]. Pivots in cart
coordinates (y up, metres); all nodes are children of the root `cart` except the nested ones.

| Node | Pivot (x, y, z) | Unfolded | |
|---|---|---|---|
| `body` | (0, 0, 0) | — | bed (deck top 0.88), frame, axle, the box (x ±0.42, z −0.75 .. 0.50, top 1.30), end boards |
| `wheel_l` / `wheel_r` | (∓0.60, 0.36, 0) | spun: forward is `rotation.x -= d / 0.36` | radius 0.36, the bike's balloon tyres |
| `tongue` | (0, 0.79, −1.1) | — | A-frame; child empty `coupler` at (0, 0.54, −2.40) |
| `stand` (in `tongue`) | (0, 0.50, −2.0) | `rotation.x = +90°` | packed lying back under the tongue; down, its foot on the ground |
| `lid` | (0, 1.32, −0.76) | `rotation.x = −100°` | hinged on the box's front edge (tongue side), opens from the rear |
| `pole_a` | (−0.56, 0.93, −0.98) | `rotation.x = −90°` | front left; tip empty `pole_a_tip` (−0.56, 0.93, 0.82) → (−0.56, 2.73, −0.98) |
| `pole_b` | (0.56, 0.93, 0.98) | `rotation.x = +90°` | rear right; tip empty `pole_b_tip` (0.56, 0.93, −0.82) → (0.56, 2.73, 0.98) |
| `side_l` | (−0.68, 0.88, 0) | `rotation.z = +90°` | workbench; folds out level with the deck |
| `leg_l` (in `side_l`) | (−0.73, 1.48, 0) | `rotation.z = −90°` (relative to `side_l`) | trestle, packed flat on the wall's outside |
| `side_r` | (0.68, 0.88, 0) | `rotation.z = −90°` | dismantling table |
| `leg_r` (in `side_r`) | (0.73, 1.48, 0) | `rotation.z = +90°` (relative to `side_r`) | |
| `legs` | (0, 0, 0) | `position.y = −0.46` (a slide) | four stabilisers at (±0.50, z ±1.145), feet down to the ground |

Unfolded, both bench tops are at y 0.88 (flush with the deck), |x| 0.68 .. 1.33 (0.65 m deep), z −1.08 .. 1.08, their
trestles' feet on the ground at |x| ≈ 1.30, z ±0.98. The workbench's tools sit near its outer edge, the table's middle
is clear. Packed, the sides are the cart's walls (top 1.53), so hiding them below level 2 leaves the bed open-sided.

## As built (phase 1, November 2026)

- `shared/cart.ts`: `TOW_LENGTH` 2.4 m (axle to coupler), `HITCH_BACK` 0.95 m (bike centre to hitch point), `HITCH_MAX`
  100°, hitching within `HITCH_REACH` 0.8 m going backwards 0.3–3 m/s (`backingUpTo`; standing still, as after getting
  on beside it, doesn't hitch). `towHitch` is the step, `towedPose`/`cartAxle` the pose, `couplerOf`, `atTongue`,
  `cartTarget` (bed or tongue under the crosshair), `cartLevel`, `CART_LEVEL_NODES` (level 1: `pole_a`, `pole_b`, their
  tips, `legs`; level 2: `side_l`, `side_r`, `leg_l`, `leg_r`).
- `Vehicle` gets `hitched` (bike id), `open` and `level` (from the item, for drawing); columns `hitched`, `open`. A
  towed cart has `rider` set to the tower's public id, like a ridden bike, so it's not `parked` and its box is shut.
- The cart's item box `veh<id>` isn't listed open (no parts to fit); its box `cargo<id>` is CHEST_COLS × CHEST_ROWS,
  labelled with the cart's name.
- Server: `arriveCart` (grant `cart`, every join; the lab too, by the spawn: `shared/lootRoll.ts` `cartSpot`),
  `tryHitch` (after every step, server/world.ts `offBike`), `unhitch` (message `unhitch`), `mount` tows a linked cart of
  the rider's own and lets anyone else's go, `release` parks the towed cart at `towedPose` of the state it got off in.
- The client draws a towed cart from the tower's state: ours from the prediction (`net.view` interpolates `hitch`),
  others' from their pose tuple (indices 12, 13: `tow`, `hitch`). The stand swings down (`rotation.x` +90°, the table
  above) while it's not linked to a bike. `src/world/carts.ts` loads `cart.glb`, falling back to a stand-in built in code
  to the same contract if it fails to load (a coupler not at z = −TOW_LENGTH is warned about in the console).
- Not yet: the cart on the locator bar, a rattle (`src/cartSound.ts`), speech.

## Phases

1. Cart and towing, level 0 with its box: sim, server, drawing, hitching. Tests: towing deterministic (server and client
   step the same), hitch / unhitch / park with the bike, the box.
2. Unfold / pack, upgrades with the wrench, level 1 shade.
3. Level 2 workshop; the benches and chest out of the build menu; the starter kit, the beginning, econsim.
