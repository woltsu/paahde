# The cart: a camp you tow

Design for the portable base (November 2026). Instead of building workbenches, dismantling tables and chests where
you stand, the world has a **cart**: one two-wheeled scrap trailer, everyone's, towed behind anyone's bike or quad.
Parked, it unfolds into the camp, and it is upgraded level by level. It replaces the wrench-built workbench, dismantling table and
chest. Grid buildings (windmill, battery station, power pole, beacon, light pole, electric well) stay wrench builds,
and so does the hand-made tarp.

## Levels

| Level | Unfolded it adds | Earned by |
|---|---|---|
| 0 | a lidded box on the bed: storage (`cargo<id>`, the chest's size), going wherever the cart goes | it stands by the first pod from the world's start |
| 1 Shade | a canopy on two poles over the cart (a tarp rig, `shared/tarp.ts`) | upgrade with the wrench: cloth + scrap |
| 2 Workshop | fold-out sides: a workbench on one side, a dismantling table on the other | upgrade with the wrench: scrap + cloth |

No level 3 for now. Towing slows the bike a little (below, "Towing"), the same whatever the level.

The level is the cart item's own state: an `ItemData` field (`shared/items.ts`), never a column. Upgrades cost base
materials like a building does (`shared/tables.ts` BUILD_TABLE / `shared/crafting.ts` BUILDS): with the wrench in hand
by the cart, the build menu (`src/buildMenu.ts`) offers the next level; choosing it spends the materials on the
cart. A level is never given back (the cart can't be taken down).

## One per world, everyone's

The world has one cart, nobody's. It stands, already usable at level 0, by the first crashed pod from the world's first
start (`server/vehicles.ts` `settleCart`, by where the home quad lies; in the lab by its spawn). Anyone tows it with
any bike or quad they ride, lets it go, unfolds, packs and upgrades it, uses its box and, unfolded, its benches. Its
levels are built once for the whole world (the pods' kit, once per world too, pays for them), and unfolded and built
it's where everyone wakes. No owner, no `mine`, no colour of anyone's.

It flies a rag: a torn strip of rust-red cloth (one fixed colour, `RAG_COLOR`, against the teal box and the khaki
canopy), sun-faded and dusty, knotted round the back left stabiliser's sleeve (the corner post), and a worn hand-painted
stripe of the same down the box's lid (`src/world/carts.ts`, drawn in code over the model). The rag hangs behind the
post, clear of the benches, the canopy and the lid; it stirs in the wind (`windSpeed`, `windDir`) and streams back a
little when towed. Parked, the cart is on everyone's locator bar (a box on a wheel with its tongue, in a neutral bone
colour, `cartTargets`), except while it stands linked to a bike of yours (the bike marks both).

Until November 2026 every player had a cart of their own (a grant laid it out by their pod on their first join; only
its owner towed, unfolded, packed and upgraded it, and it flew its owner's colour). Those worlds keep one: below, "As
built: one cart per world".

## States

- **Hitched:** packed and following a bike. Nothing on it is usable.
- **Parked, packed:** standing still. F opens its box.
- **Unfolded:** standing still, its level's pieces out (canopy, benches). Anyone on foot looking at it unfolds it
  with the cart key (the rotate key: R, the d-pad's left; "R Unfold" / "R Pack" under the crosshair) and packs it with
  the same key. Unfolding needs ground flat enough (a tilt check like the tarp's) and refuses while it's linked to a
  bike or quad. Unhitching leaves it packed. Packing refuses while a machine is on its table or a dismantling job runs.
  Backing the bike up to it unfolded packs and hitches it in one go (refused, so not hitched, while packing is).
  Getting off with it still linked keeps it packed. What's in the box rides along.
- **Spawn:** the cart, unfolded **and built** (level ≥ 1: upgraded with the wrench at least once; the level-0 cart the
  world starts with never is) is everyone's camp: after dying you wake on the sand beside it, facing it (shared/cart.ts
  `isCamp`, `campWakeSpot`; server/world.ts `homeOf`, `VehicleServer.camp`). Unfolding it is making camp. Otherwise
  (packed, linked to a bike, being towed, level 0, or no free spot by it) it's your bedroll, else your pod, as before. A camp beats a
  bedroll (simple and predictable; "most recently chosen wins" would need a time on both and they'd fight). The spot:
  the first free one of a few round the unfolded footprint (from the footprint's size, so it follows the model), by the
  tongue either side, then beside the benches, then behind: free is on the desert's sand about the cart's height, not a
  rock or a slip face, no shelter, no canvas over it (the canopy, a tarp), nothing to be pushed out of (the level's
  collide: the cart's capsules, what's built, scrap) for a body a little wider than a player's (`clearToWake`). The
  respawn message's `facing` turns the camera to the cart. No text: you just wake there. The bedroll's lantern and the locator's home still show the bedroll.

## Towing (netcode: `docs/netcode.md`)

The cart moves with a player, so towing is in `shared/sim.ts`, deterministic:

- `PlayerState.tow`: the cart being towed (0 none), like `bike`; `PlayerState.hitch`: the cart's heading (absolute,
  same convention as `heading`). Its pose is derived: the hitch point H is behind the bike's centre; the axle sits
  `TOW_LENGTH` behind H along the cart's heading. Each tick the axle follows H (new axle = H − L · unit(H − old axle)),
  which also handles reversing; the angle between bike and cart is clamped (no jackknife past ~100°). It collides
  with nothing while towed (first version).
- Towing is felt: the engine pulls 10% less and tops out 12% lower, the sand drags 0.4 m/s² more (`shared/sim.ts`
  `TOW_*`), so it levels off 11–15% slower (`bikeCruise(q, towing)`, which `src/engineSound.ts` gears by). Space
  still lifts a small wheelie but letting go doesn't hop; the bike still flies off a crest at speed, and the cart with it.
- Drawn, the cart hangs from the bike's tow ball (`shared/cartHang.ts`): its coupler pinned to the ball where the bike
  is drawn (nose, wheelie, lean and all), pitched about it, falling and landing on its own (below, "As built: towing").
- Hitching: ride a bike or the quad slowly backwards up to the parked cart's tongue (unfolded, it packs first); once the
  rear is close enough, the server hitches it (as `mount()` puts you on a bike: the server sets the state, the
  client reconciles). No key, no text.
- The cart stays linked to the bike (`Vehicle.hitched`: the bike's vehicle id): get off and both park, the cart behind;
  whoever gets on it next is towing it. Unhitch: anyone on foot, F on the cart's tongue.
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
so code unfolds a node by setting the rotation below times t ∈ [0, 1] (a quaternion slerped from identity), or for a
slide its position plus the offset times t. Pivots in cart coordinates (y up, metres); all nodes are children of the
root `cart` except the nested ones. The quaternions and slides are printed by every run of the script
(`unfold <node>: ...`) and copied into `src/world/carts.ts` `FOLD`.

| Node | Pivot (x, y, z) | Unfolded | |
|---|---|---|---|
| `body` | (0, 0, 0) | — | bed (deck top 0.88), frame, axle, the box (x ±0.42, z −0.75 .. 0.50, top 1.30), end boards |
| `wheel_l` / `wheel_r` | (∓0.60, 0.36, 0) | spun: forward is `rotation.x -= d / 0.36` | radius 0.36, the bike's balloon tyres |
| `tongue` | (0, 0.79, −1.1) | — | A-frame; child empty `coupler` at (0, 0.54, −2.40) |
| `stand` (in `tongue`) | (0, 0.50, −2.0) | `rotation.x = +90°` | packed lying back under the tongue; down, its foot on the ground |
| `lid` | (0, 1.32, −0.76) | `rotation.x = −100°` | hinged on the box's front edge (tongue side), opens from the rear |
| `pole_a` | (−0.56, 0.93, −0.98) | quaternion (−0.82143, −0.22266, 0, 0.52504) | front left, packed lying back along the bed; swung up raked ~30° out forward and left; the work lamp's clamp on it |
| `pole_a_top` (in `pole_a`) | as `pole_a` | `position.z += 1.3649` (a slide) | its top section run out; tip empty `pole_a_tip` (−0.56, 0.93, 0.82) → (−1.30, 3.66, −2.40) |
| `lamp_a` (in `pole_a`) | (−0.56, 1.005, 0.52) | quaternion (−0.57567, −0.01238, 0, 0.81759) | the work lamp's bent arm, packed along the pole on a lug, swung out over the workbench; bulb empty `lamp_a_bulb` → (−1.22, 2.10, −0.40) |
| `pole_b`, `pole_b_top`, `lamp_b` | (0.56, 0.93, 0.98), (0.56, 1.005, −0.52) | quaternion (0.82143, −0.22266, 0, 0.52504); `position.z −= 1.3649`; quaternion (0.57567, −0.01238, 0, 0.81759) | rear right, the mirror: tip `pole_b_tip` → (1.30, 3.66, 2.40), its lamp over the dismantling table, `lamp_b_bulb` → (1.22, 2.10, 0.40) |
| `side_l` | (−0.68, 0.88, 0) | `rotation.z = +90°` | workbench; folds out level with the deck |
| `leaf_l` (in `side_l`) | (−0.715, 1.23, 0) | `position += (0.02, 0.55, 0)` (a slide, `side_l`'s frame) | the leaf nested under the side's top slides out of its outer edge and up flush |
| `leg_l` (in `leaf_l`) | (−0.75, 1.46, 0) | `rotation.z = −90°` (relative to `leaf_l`) | trestle under the leaf's outer edge, packed flat on the wall's outside |
| `side_r`, `leaf_r`, `leg_r` | (0.68, 0.88, 0), (0.715, 1.23, 0), (0.75, 1.46, 0) | `rotation.z = −90°`; `position += (−0.02, 0.55, 0)`; `rotation.z = +90°` | dismantling table, its leaf with the hazard stripes and the bolt tray |
| `legs` | (0, 0, 0) | `position.y = −0.46` (a slide) | four stabilisers at (±0.50, z ±1.145), feet down to the ground |

The bulbs' material is `Bulb`: code gives each cart its own, glowing while its lamps are lit.

Unfolded, both bench tops are at y 0.88 (flush with the deck), |x| 0.68 .. 1.88 (1.2 m deep: the side's 0.65 and its
leaf's 0.55), z −1.08 .. 1.08, their trestles' feet on the ground at |x| ≈ 1.83, z ±0.98: the camp is 3.76 × 2.2 m.
The workbench's tools sit in the middle of its depth, the table's middle is clear. Packed, the sides are the cart's
walls (top 1.53), so hiding them below level 2 leaves the bed open-sided; packed it is the same size as before
(1.67 m wide over everything).

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
- Server: `settleCart` (the world's cart at its start, by the first pod; the lab's by the spawn: `shared/lootRoll.ts`
  `cartSpot`; until one cart per world `arriveCart` laid out each player's on join, grant `cart`), `tryHitch` (after
  every step, server/world.ts `offBike`), `unhitch` (message `unhitch`), `mount` tows the cart linked to the vehicle got
  on (until one cart per world: only its owner's; anyone else's was let go), `release` parks the towed cart at `towedPose` of the state it got off in.
- The client draws a towed cart from the tower's state: ours from the prediction (`net.view` interpolates `hitch`),
  others' from their pose tuple (indices 12, 13: `tow`, `hitch`). The stand swings down (`rotation.x` +90°, the table
  above) while it's not linked to a bike. `src/world/carts.ts` loads `cart.glb`, falling back to a stand-in built in code
  to the same contract if it fails to load (a coupler not at z = −TOW_LENGTH is warned about in the console).
- Not yet: a rattle (`src/cartSound.ts`), speech.

## As built: towing (November 2026)

Fixes for "the cart doesn't fly with the bike" and "it sometimes looks unattached". The causes: the cart was posed
from the sim's flat hitch point with its height taken from the sand under its own axle and tilted about that axle, so
its coupler sat at sand + 0.54 wherever the bike was (the bike in the air, pitched along a slope or the flight, in a
wheelie, leaning: all moved the bike's rear and none moved the coupler); and the hitch point (0.95 m behind the bike's
centre) was inside the rear tyre (its back is 1.05 m behind), with no tow ball drawn.

- `HITCH_BACK` is 1.15 m and `HITCH_Y` 0.54 (the coupler's height, so a level cart behind a level bike). `src/bike.ts`
  draws a tow bar there while towing (struts from the rack round the outside of the rear tyre, a cross bar, the ball)
  and `hitchAt()` gives the ball's world position from the same transform the bike is drawn with.
- `src/main.ts` hands `CartView` each tower's drawn ball (`Tower.at`) and the bike's drawn pitch, after `ride()` has
  drawn the bikes: ours from the prediction (`net.view`, the smoothing offset included), others' from their
  interpolated poses, through the same code.
- `shared/cartHang.ts` (no three.js; `tools/cart-tow.test.mjs`): yaw is the sim's `hitch`; the pitch about the coupler
  comes from the axle's own height and vertical speed: it falls at the sim's gravity (25 m/s²), the sand holds it up
  under its wheels (a bounce of 25% past 3 m/s into the sand), and the coupler lets it pitch at most 0.6 rad off the
  bike's line, which yanks it up when the bike rises sharply. Leaving a crest it keeps the climb rate the ramp gave it,
  so it flies with the bike and lands on its wheels. On the sand it rolls to the slope under its two wheels. The
  object's position is then the ball minus the turned coupler, so the coupler is on the ball by construction. Purely
  drawn: the server never needs it, and the axle's horizontal place stays within cm of `towedPose`.
- A towed cart is drawn however far its bike is (no bike without its cart at the view distance's edge).
- Its two wheels lay tyre tracks as the bike does (`src/footprints.ts` `TyreTrack`, shared with `src/bike.ts`): from
  under each drawn wheel's hub, broken while that wheel is off the sand (flying, more than 5 cm up) or on the mudflat.
  The tyre pool holds 4096 strips (was 1024), so three tracks still last the 90 s fade at a cruise; a print sends only
  its own slots to the GPU. On a curve they run inside the bike's, as a trailer's do.
- Rolling smoothly (a follow-up: it bounced a little up hills). The cause: every frame the sand pushing the axle up was
  taken as a landing (the bounce fired whenever the ground's climb rate rose by 3 m/s within a frame, more often at
  uneven frame times), and with its height re-solved from free fall each frame at the frame's own length it left and
  caught the sand over and over (158 times on a minute's drive over the dunes). Now it steps at a fixed 1/120 s (the
  ball and the bike's pitch interpolated across the frame, so it moves the same at 30, 60, 144 fps or jittery frames);
  rolling, its wheels stay on the sand unless free fall would leave it by more than 7.5 mm in a step, the same margin
  that takes the bike off a crest (`BIKE_LAUNCH_EPS`, so the cart leaves the sand where the bike would and rolls over
  ripples); the bounce only on a landing from the air; the pitch that puts the wheels on the sand solved exactly
  (fixed-point steps, bisection where they stall on steep slopes). Same drive: it left the sand once, 46 mm.
- Parked still linked (got off with it): the parked bike (`src/world/vehicles.ts`) draws its tow bar, and `src/main.ts`
  hangs the cart from that bar's ball the same way (`VehicleView.ball`), so getting on and off moves nothing but the
  bike's own lean onto its stand. The server already parks it to the hitch geometry (`release`: `towedPose` of the
  state it got off in), so its stored place (collision, unfolding, F at the tongue) is within mm of the drawing.
- Checked in headless Chrome, own and a remote bot's cart, towing, hard turns, reversing to the 100° limit, a
  wheelie, a crest launch: the coupler-to-ball distance stayed under 1e-13 m every frame.

## Phases

1. Cart and towing, level 0 with its box: sim, server, drawing, hitching. Tests: towing deterministic (server and client
   step the same), hitch / unhitch / park with the bike, the box.
2. Unfold / pack, upgrades with the wrench, level 1 shade.
3. Level 2 workshop; the benches and chest out of the build menu; the starter kit, the beginning, econsim.

## As built (phase 2, November 2026)

- **Unfold / pack:** message `unfoldCart {id, open}` (server/vehicles.ts `unfold`): anyone (owner only, until one cart per world), on foot, in reach,
  parked; unfolding refused while linked (`TEXT.notice.unhitchFirst`) or where the sand rises more than `CART_TILT`
  0.4 m across the unfolded footprint (`unfoldError`: |x| 1.33, |z| 1.15 and the tongue's tip; `tooSteep`). The client
  sends it from the rotate key looking at the unlinked cart (src/main.ts `foldPrompt`; not with a placeable or the
  wrench in hand, which turn their preview with that key). `Vehicle.open` is persisted (`db.openVehicle`) and goes out
  with the vehicles list. `tryHitch` packs an open cart before hitching it (`pack`), skipping it while
  `VehicleServer.packBlocked(id)` returns a reason: **phase 3 sets that hook** (a machine on its table, a job running)
  and `unfold(…, false)` refuses with the same reason.
- **Upgrades:** `shared/tables.ts` `CART_TABLE` (1 shade: cloth 3 + scrap 4, a tarp's canvas plus poles and
  stabilisers; 2 workshop: scrap 12 + wiring 1, the two benches' scrap less the frame they share with the cart),
  `shared/crafting.ts` `CART_UPGRADES`. With the wrench in hand by the parked cart (packed or open) the build menu
  shows its next level first (`TEXT.cartLevels`, the cart's icon, what the bag has); picking it sends `upgradeCart {id}`
  (server/vehicles.ts `upgrade`: reach, wrench in the bag, level < `CART_MAX_LEVEL` 2, else
  `TEXT.notice.fullyBuilt`; materials used up in the same transaction as `ItemData.level` is set on the item in
  `veh<id>`, else `missingMaterials`). Never given back. Level 2 draws the sides and benches only; they aren't benches yet.
- **Drawing (src/world/carts.ts):** `FOLD` is the table above: every hinge node turns from its rest pose by its
  unfolded rotation (`legs` slides) × an eased share of its level's own 0..1 clock, `UNFOLD_S` 1.5 s each way (lid
  0–0.5, stabilisers 0–0.4, poles 0.35–1; sides 0–0.6, their trestles 0.5–1), so a level raised while unfolded unfolds
  just its new pieces. From level 1 the cart is levelled as its stabilisers come down (its slope tilt eased out). The
  canopy appears once the poles are up. `src/cartSound.ts`: synthesised hinge creaks, scrap clanks and a knock
  (`renderCartFold`), positional, through `audio.out`.
- **Canopy (shared/cart.ts `canopyRig`):** a tarp rig (shared/tarp.ts, now any heading and shape: `rigFrame(cx, cz, a,
  b)` with the frame's inverse, so `canvasYAt` and everything after it take a parallelogram) from the pole tips
  (cart space (∓0.56, 2.67, ∓0.98): 6 cm under the tips) to two low corners 2.0 m out to either side of the axle at
  1.95 m (over a head: no head boxes needed), sag 0.07 m, a line from each low corner to a stake 0.8 m further out, no
  poles of its own. Levelled at the cart's `y`. `setCarts` (called by `setVehicles`, so server and client have the same)
  hands the rigs of open level ≥ 1 carts to `setCanopyRigs`: the sim's `tarpGround`/`tarpCeiling`/`tarpSlope`, the shade
  (shared/shade.ts reads `tarpRigs()` now, tarps and canopies alike), the camera boom (src/camera.ts) and the drawing
  (src/world/tarps.ts `rigModel`, the billow) all use it. Standing on the deck, your head is through the canvas (it's
  2.2–2.7 m up); you can't jump onto the deck from under it (the canvas stops the head).
- **Solid:** every parked cart is capsules in world space (`cartCapsules`, `setCartCapsules` in shared/capsules.ts
  alongside the placed things): the bed with the wheels (r 0.7, top 0.88; packed at level 2, its walls, 1.53), the box
  (top 1.30) and, unfolded at level 2, a bench each side (centre x ±1.005, r 0.325, z ±1.08, top 0.88, flush with the
  deck). The tongue is low enough to step over and isn't solid. Towed carts collide with nothing.
- **For phase 3:** the benches in world space: `cartToWorld(v, ±1.005, 0)` is each bench's middle (x < 0 the workbench
  `side_l`, x > 0 the dismantling table `side_r`), tops at `v.y + 0.88`, 0.65 × 2.16 m, along the cart's heading
  (`v.heading`, forward (−sin, −cos)); only while `v.open && v.level >= 2 && parked(v)`.
- **Tests:** `tools/cart.test.mjs` adds the canopy shading a point at noon and the sim landing a player on its canvas
  (none packed), walking into a parked cart's side, and in the lab: someone else unfolds and packs it (until one cart per world: a stranger couldn't), the upgrade
  refused without materials, spending them and raising the level, refused past 2; unfold, pack; backing up to it
  unfolded packs and hitches it; linked, it won't unfold; unhitched it stays packed until unfolded.
- **Econ:** `npm run econ` unchanged vs main (the simulator doesn't upgrade carts yet; phase 3 adds `CART_TABLE` to its
  goals when the cart replaces the benches). Note level 2 takes wiring, which the beginning only gets from the pod's
  machines: phase 3's starter kit must pay for it.
- **Not checked yet:** a towed cart and the unfolded canopy in a browser (headless Chrome couldn't render the game while
  the machine was busy). The sound measured −23.6 LUFS, −9.2 dBTP.

## As built (phase 3, November 2026)

- **The workshop:** `shared/cart.ts` keeps the carts that are workshops now (`isWorkshop`: parked, open, level ≥ 2;
  `cartWorkshops()`, set by `setCarts`, so server and clients agree) and the benches' size (`CART_DECK_Y` 0.88,
  `CART_BENCH_X` 1.005, `CART_BENCH_HX` 0.325, `CART_BENCH_HZ` 1.08; the capsules use them too). `shared/stations.ts`
  `stations()` lists each one's two sides: the workbench (x < 0, id `cartwork<id>`) and the dismantling table (x > 0,
  `cart<id>`). A station's look-target box is now oriented (centre, half sizes, `yaw` as a heading; `stationLocal`),
  so `stationReach` (the server's reach and height check) and `stationTarget` (the crosshair) work at any heading; the
  placed ones have yaw 0 and the boxes they had. Packed, hitched or below level 2, the sides aren't stations.
- **Tables:** `shared/crash.ts` `Table` has `yaw` (no `placed` any more); `isTableId` takes `bench<n>` and `cart<n>`;
  `tableById`, server/crash.ts jobs and `bench_jobs` work by the session id, so a cart's job is saved and comes back
  like a placed table's. `onTable` tests a point against the turned top; `src/world/crash.ts` `Bench` stands the machine
  on its middle turned with the table, and its ground (where pieces fall) is the turned top.
- **Packing:** `server/world.ts` sets `vehicleSrv.packBlocked`: while the cart's table has a job (a machine on it, worked
  or not) packing and so pack-and-hitch are refused with `TEXT.notice.benchInUse` ("Bench in use", reused). Scrapping
  the machine frees it.
- **Anyone** may use the sides (the stations don't look at owners), and pack it (until one cart per world: only the
  owner).
- **The build menu:** the workbench, dismantling bench and chest moved from `BUILD_TABLE` to `RETIRED_BUILD_TABLE`,
  so `BUILDS` (the menu, the `build` message, server/placed.ts `build`) no longer has them. `isBuildable` (taken down
  with the wrench, never carried) covers both, and `buildCost` reads both, so ones standing in older worlds still work
  and give back what they took. Their `PLACEABLES`, models and code stay.
- **The beginning:** level 2 costs scrap 12 + cloth 1 (was wiring 1: a new player's only wiring is in the pod's console
  and power box, which need the table first; cloth, the table's tarp for the parts as the old dismantling bench had, is
  in the kit already, so this needed no new kit entry or code). The pods' kit is scrap 22, cloth 9 (wrench 3 scrap; level
  1 cloth 3 + scrap 4; level 2 scrap 12 + cloth 1; tarp cloth 3 + scrap 2; bedroll cloth 2 + scrap 1), plus the
  console and power box. Texts: the machine hint (`TEXT.hints.machine`, "Take it apart on the cart's workshop table.")
  and the first carried machine's line (`TEXT.speech.machineBench`, "I can't take this apart by hand. That cart could do
  with a proper table.").
- **Econ** (`npm run econ -- --base origin/main`, 200 worlds): the simulator's goals are the wrench, `cart1`, `cart2`
  (as buildings from `CART_UPGRADES`; its workbench and table are the workshop) in place of the benches and the chest,
  which it still plans against older commits. Progression unchanged within noise (won 255 → 247 min, 99% → 100%); the
  motorcycle 7 → 9 min (the workshop wants 22 scrap picked up before the table, the benches 14); `made:cart1`/`cart2`
  at 7 min.
- **Tests:** `tools/cart.test.mjs`: the sides as stations and a table at four headings (crosshair, `onTable`), none
  packed, at level 1 or towed; the build menu without the three and old ones' costs back; the kit paying exactly; in
  the lab, with an old workbench, table and chest seeded in its database: crafting at the old bench, the kit alone
  making the wrench, both levels, a tarp and a bedroll, the console and power box refused on the packed cart, then
  stripped step by step on the unfolded one (packing refused with each on it), wiring and a battery out, a bearing
  hammered at the cart's bench, crafting refused once packed, and the old three taken down into their materials.

## As built: a bigger camp, the canopy put up, work lamps (November 2026)

From play: the unfolded cart was cramped, the canopy popped in and looked like the hand tarp's patched rag, standing on
the deck put your head through it (phase 2's note), and the workshop was dark at night.

- **Bigger (the model's contract above):** each side's **leaf** (`leaf_l`, `leaf_r`), nested under the side's top
  packed, slides 0.55 m out of its outer edge and 2 cm up flush once the side is down; the trestle hangs under the
  leaf's edge now. Benches 1.2 m deep, |x| 0.68 .. 1.88: the camp is 3.76 × 2.2 m (was 2.66 × 2.2, 1.41× the
  footprint). Packed it's the same (1.67 m wide). `shared/cart.ts`: `CART_BENCH_X` 1.28, `CART_BENCH_HX` 0.6 (so the
  stations, `tableById`'s table at 1.2 × 2.16 and the machine on its middle follow), each bench two capsules side by
  side (r 0.3), the tilt check's footprint |x| 1.88 (`OPEN_HX`).
- **Canopy:** the poles swing up raked ~30° out past the deck's ends (a quaternion turn each), their top sections
  (`pole_a_top`, `pole_b_top`) slide out 1.36 m: tips at (∓1.30, 3.66, ∓2.40). `canopyRig`: high corners 6 cm under
  them (3.60), low corners at (∓3.8, 2.4, ±0.7) (front right, rear left), sag 0.07, a line from every corner to a stake
  (the low ones 1.2 m further out, the tips' 1.6 m beyond them). It covers the whole camp and a person working at either
  bench's middle (|x| 2.3, over 2.6 m there), and over the deck it's at least 2.83 m, so a head clears it standing on
  the deck (tested). The tarp's lowest is 2.4 m: no head boxes needed.
- **Put up visibly (src/world/carts.ts, on the level-1 clock):** stabilisers 0–0.35, poles 0.25–0.65, tops 0.5–0.8; the
  canvas, rolled and strapped across the deck behind the box while packed (`CANOPY_ROLL`, also while towed), is hauled
  from the roll's ends to the drawn tips (0.6–0.85: up first, then out, a sagging furled strip), then spread (0.8–1):
  its low corners travel out to their stakes, its lines go from slack (hanging to the sand) to taut, the billow comes in
  (a `taut` attribute in the canvas shader, 1 for tarps). `shared/cart.ts` `canopyRising` is that rig (drawn only); at
  the end it is `canopyRig`. Packing runs it backwards. `src/world/tarps.ts` `CanopyModel` refills the canvas grid in
  place while it moves.
- **Sim and shade:** `canopyUp(v)`: the canvas is solid and shades only once it's up. The server sets `Vehicle.pitching`
  on unfolding (or on reaching level 1 unfolded) and clears it `UNFOLD_S` later (`VehicleServer.pitch`; never stored),
  so server and clients agree from the vehicles list, no clocks.
- **Its look:** a canvas style of its own (`CanvasStyle` 'canopy'): one khaki colour (0x9c8c5c, between the teal box
  and the rust), four even panels with straight seams and a fainter middle one, a dark bound hem, a square
  reinforcement at each corner with a metal grommet where the line ties. The hand tarp keeps its patched look.
- **Work lamps (level 2):** `lamp_a`, `lamp_b`: a caged bulb under a teal dish on a bent arm, clamped to each pole
  (folded along it packed, swung out over its bench, 0.5–0.9 of the level-2 clock), bulbs 1.2 m over the benches. Lit
  while the cart is a workshop (parked, unfolded, level 2, fully out) and it's dusk to dawn (`shared/power.ts`
  `darkAt`, the light poles' rule; no power needed): its bulbs glow (bloom) and stutter on over ~0.7 s, and each puts
  a warm shadowless spot down onto its bench's middle through the light poles' pool (`CartView.lamps` →
  `PlacedView.updateLamps` → `PoleLamps.setLamps`: the nearest 4 of poles and lamps get the slots; no new lights).
- **Tests:** the canopy covers the camp, clears a head on the deck, shades nothing while `pitching`; the benches at the
  new size at four headings; the lab walks moved out past the leaves. Checked in headless Chrome: the unfold at level 2
  in frames, from ~6 and ~8 m, under the canopy, a person beside the table, packing, and at night with a machine on
  the table.
- **Note:** the shadowless spots light the sand through the benches (as the light poles do through anything).

## As built: one cart per world (November 2026)

From play: a cart each split the camp. The pods' kit (once per world) built the first player's cart; whoever came later
had a bare one of their own, nothing to build it with, and a camp nobody else could wake at, tow or pack.

- **One, nobody's:** `server/vehicles.ts` `settleCart`, called by server/world.ts at the world's start once the crash
  tables and the loot are up, before anyone is in: a world without a cart gets one, level 0, by the first pod
  (`shared/lootRoll.ts` `cartSpot(0, …)`; the lab's by its spawn; src `'world'`). No per-player arrival, no `cart` grant
  (old grants stay in the table, unread), no owner (carts never go in the owner map, so never in `mine`), no
  `Vehicle.color` (`recolor` gone).
- **Anyone's vehicle:** `tryHitch(rider, s)` hitches whichever parked cart any bike or quad backs up to; `mount` tows
  the cart linked to whatever is got on; `unhitch`, `unfold`, `upgrade` (`cartBy`: in reach, on foot, parked) check no
  owner. The quad rides on the bike's sim (`shared/sim.ts` `stepBike`: the towing slowdown, no hop, `towHitch`) and has
  its own tow ball in its model at `HITCH_BACK`, `HITCH_Y` (`tools/blender/quadbike.py`, `src/quad.ts` `hitchAt`; parked,
  `VehicleView.ball`), so the cart's towing geometry, hang (`shared/cartHang.ts`) and tyre tracks were already the same
  for it. A quad passenger changes nothing (they're carried, the rider's state tows).
- **Respawn:** `VehicleServer.camp()` (the world's cart, `isCamp`) for everyone in `homeOf`, the same free-spot search
  and fallbacks.
- **Migration, once** (`oneCart`, setting `one_cart`): the cart kept is the highest level, then the one with the most
  stacks in its box, then the oldest; it stays where it stands, its owner cleared. Every other cart's box goes into its
  box (plain stacks top up what's there first, items with parts or data go in whole into a free spot), and the machine
  on its table comes off whole into it too (`CrashServer.takeBench`, the job and its progress cleared, as
  server/bunkerGone.ts gave back the bunker table's: the parts already taken were given out). Whatever doesn't fit lies
  on the sand behind the kept cart, one item at a time in rows 0.45 m apart from 2.4 m back (`LootServer.dropItem`,
  kept as dropped loot). The others' item and cargo boxes are emptied and their rows deleted (`db.deleteVehicle`). Their
  levels are gone, no refunds. Logged as `one cart: kept cart <id> …`.
- **Look:** the rag and the lid stripe stay, in one fixed faded rust red (`src/world/carts.ts` `RAG_COLOR` 0xb4472a,
  sun-faded as before): a mark on the camp that reads against the teal box and the khaki canopy. The locator bar shows
  the parked cart to everyone in a neutral bone colour (`src/world/vehicles.ts` `cartTargets`, 0xd8cdb4), except while
  it's linked to a bike of yours; `ownVehicleTargets` is bikes only.
- **Text:** the hint and speech no longer say "your cart" / "my cart"; `TEXT.notice.notYours` stays for bedrolls.
- **Starter kit / econ:** unchanged. The kit was already once per world and pays exactly for the wrench, both levels, a
  tarp and a bedroll; the levels are now once per world too, so a later joiner finds the cart (built, if someone has),
  wakes by it, and needs only a wrench of their own (3 scrap from the piles) to build grid things. `npm run econ --
  --base origin/main`: no significant change (the simulator plays one player per world, who built the one cart anyway).
- **Tests:** `tools/cart.test.mjs`: one cart in the lab, nobody's, no colour; a second player gets on the bike it's
  linked to and tows it, lets it go; someone else unfolds and packs it, and upgrades it (fully built); a second player
  backs the quad up to it and tows it, a passenger on the back, the cart parked on the quad's ball, the first player
  tows it on the quad next; a seeded world with three carts keeps the level-2 one with the fullest box, its wiring
  topped up, and lays the rest (cloth 20, wiring 3, the console off the other table, scrap 10) behind it.
  `tools/cart-spawn.test.mjs`: someone who came later wakes beside the camp too. `tools/cart-tow.test.mjs`: the quad
  tows bit for bit as the bike does.
