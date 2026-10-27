# Level: the datacenter

Art and environment design for the first indoor level: a plain concrete datacenter with rows of server racks. No sky, sun,
terrain, fog or haze. This doc is the art side; the engine side (entering/leaving, the per-world process, the scene swap)
is in the integration doc. Shared layout in `shared/levels/datacenter.ts`, client build in `src/levels/datacenter/`.

## The one-line version

A cold, humming hall: dark racks in long rows under cool white light strips, green and amber LEDs blinking behind
perforated doors, a dark ceiling, sealed grey floor. The opposite of the desert: cool, flat, ordered, man-made.

## Palette (sRGB, approximate)

| Role | Colour | Notes |
|---|---|---|
| Light strips, main light | `#eef3ff` | ~6500 K, a touch blue. Never warm. |
| Emergency / exit | `#ff7a1a` amber, `#ff2a1a` red | Few and small: the only warm light. |
| Floor (sealed slab, tiles) | `#5e5f5d` → `#74746f` | Neutral grey, glossy patches. |
| Walls (painted block) | `#a7a9a8`, dado band `#5d6266` | Lower 1.2 m darker. |
| Ceiling, beams | `#26282b` | Dark, so the strips pop. |
| Rack powder coat | `#1b1d21` → `#24272c` | Near black, never pure black. |
| Rack interior behind holes | `#0b0c0e` | |
| LEDs | green `#39ff6a`, amber `#ffb020`, blue `#3a8bff`, red `#ff3030` | ~82 / 13 / 4 / 1 %. |
| Equipment (cooling units, UPS) | `#d6d8d4` | Off-white, the only light-coloured objects. |
| Floor paint | yellow `#e8c020`; hazard yellow/black | |
| Galvanised steel (trays, frames) | `#9a9fa3` | metalness 0.8. |

## Layout

Local frame: metres, +y up, floor top at y = 0, the hall door on the hall's south wall at x = 0. Walls 0.3 m, slabs 0.3 m.
No raised floor: one flat slab at y = 0 everywhere (no steps, no ramps; `STEP_UP` is 0.35). The floor shader draws a
0.6 m tile grid with perforated tiles in the cold aisles, which reads as a raised floor.

```
 z=28.3 ┌──────────────────────────────────────────────────┐
        │ [CRAC]     [CRAC]    ▣    [CRAC]     [CRAC]      │ 27.1  back aisle 23.4–27.1
        │ ▣                                          ▣     │ 25.5  pillars (▣)
        │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓  :  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓            │ row 8   22.2–23.4  faces -z
        │ ·············· cold ··············         │       20.4–22.2
        │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓  :  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓            │ row 7   19.2–20.4  faces +z
        │                 hot                          │       18.0–19.2
        │ ▓▓▓▓ ...   (8 rows, 2 blocks of 14)    ▓▓▓▓  │
        │ ▣ ·············· cold ·············· ▣     │ 15.9  pillars in the perimeter aisle
        │ ...                                          │
        │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓  :  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓            ├──────────┐ z=10.3
        │ ▣ ·············· cold ·············· ▣     │  UPS     │
        │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓  :  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓            │  room    │ x 12.3–18.3
        │        perimeter aisle (z 0–3.0)            ═ door     │ z 3.0–4.4
        └───────────────────┐ door ┌──────────────────┴──────────┘ z=-0.3 / 1.7
          x=-12.3           │ vest │ door 1.8 wide, 2.4 high       x=18.6
                            │ ibule│ x -3..3, z -5.3..-0.3
                            └─exit─┘ z=-5.6
```

**Main hall.** Interior x [-12, 12], z [0, 28] (24 × 28 m), ceiling soffit at 4.2 m. Downstand beams along x over the
pillar lines, y [3.7, 4.2], 0.4 m wide. Pillars 0.5 × 0.5 m at x = ±10.8, z ∈ {5.1, 15.9, 25.5}, plus one at (0, 25.5)
to end the view down the cross aisle. Nothing stands in the cross aisle itself, so the first view from the door is the
whole 28 m vista.

**Rack rows.** Racks 0.6 (w, along x) × 1.2 (d, along z) × 2.0 (h) m. Each row is two blocks of 14 slots either side of
a 2.4 m cross aisle: block x ∈ [1.2, 9.6] and mirrored. Perimeter aisle |x| ∈ [9.6, 12]: 2.4 m, pillars leave 0.95 m each
side. Eight rows from z = 3.0, alternating faces so fronts meet in cold aisles (1.8 m) and backs in hot aisles (1.2 m):

| Row | z | Front faces | Then |
|---|---|---|---|
| 1 | 3.0–4.2 | +z | cold 4.2–6.0 |
| 2 | 6.0–7.2 | -z | hot 7.2–8.4 |
| 3 | 8.4–9.6 | +z | cold 9.6–11.4 |
| 4 | 11.4–12.6 | -z | hot 12.6–13.8 |
| 5 | 13.8–15.0 | +z | cold 15.0–16.8 |
| 6 | 16.8–18.0 | -z | hot 18.0–19.2 |
| 7 | 19.2–20.4 | +z | cold 20.4–22.2 |
| 8 | 22.2–23.4 | -z | back aisle 23.4–27.1 |

224 slots; the seeded generator leaves ~6 % empty (never an end slot), so ~210 racks. A 1.2 m hot aisle leaves 0.5 m
round a 0.35 m player; two players can't pass in one, which is fine (it pushes them round). Cable trays (ladder type,
0.45 m wide) run over every row at y [2.40, 2.55], hung from the ceiling by rods every 1.8 m; some carry a yellow fibre
duct. Four cooling units (CRAC) 2.4 × 0.9 × 2.0 m stand against the north wall, x centres ±3.0, ±8.4, z [27.1, 28].

**Vestibule** (where players arrive). Interior x [-3, 3], z [-5.3, -0.3], ceiling 3.0 m. A closed steel door in the
south wall (the way out; its trigger is the integration's), the open doorway into the hall (x [-0.9, 0.9], 2.4 m high,
steel frame, hazard stripes on the hall side). One card reader by the hall door with a red LED, a bench-height cabinet.

**UPS room** (the side room). Interior x [12.3, 18.3], z [2, 10], ceiling 3.4 m, door in the hall's east wall at
z [3.0, 4.4], 2.3 m high. Two UPS cabinets 1.6 × 1.0 × 2.0 m on the north wall, a row of six battery cabinets
1.0 × 0.8 × 1.8 m along the east wall, a wall switch panel. It's the one room lit amber-heavy: the "you shouldn't be in
here" corner, and a natural place for loot or a power switch later.

**Spawns.** Four in the vestibule, 2 × 2 at x = ±0.8, z ∈ {-3.6, -2.4}, all facing +z (towards the hall door).

**Bounds.** x [-12.3, 18.6], y [-0.3, 4.5], z [-5.6, 28.3].

## Collision

Every box in the layout has a `use`: `'both'` (collides and is drawn), `'collide'` (collision only) or `'draw'` (visual
only). The server reads `use !== 'draw'`; the client draws `use !== 'collide'`.

- **Solid:** floor slabs (one per zone), ceiling slabs (for jumps), walls as segments round each opening plus a lintel
  over it, pillars, beams, CRAC and UPS/battery cabinets, and **one box per contiguous rack run** (`'collide'`: the
  instanced racks draw it). A run ends at a gap left by an empty slot.
- **Visual only:** trays, rods, cable bundles, light strips, door frames, floor paint, the exit door panel (the wall
  behind it is solid), the card reader, switch panel.
- Nothing visual sticks out more than 2 cm past its collision box below 2.2 m, so players never clip into a rack door.

Count: ~20 wall segments and lintels, 3 floors, 3 ceilings, 3 beams, 7 pillars, 4 CRAC, 8 UPS-room cabinets,
~40 rack runs: **about 90 solid boxes**. A brute-force AABB test of 90 boxes per player per tick is cheap, but give it a
uniform 2 m grid on the xz plane anyway (built once from the layout, a cell lists the boxes overlapping it; query the
cells under the player's circle). ~16 × 17 cells, most hold 1–4 boxes. The sketch is under "Shared data" below.

## Materials (TSL)

One `MeshStandardNodeMaterial` per material kind, shared by all zones (lights are the scene's, see Lighting), built
from boxes merged per material like `src/world/shelters.ts`. Patterns are procedural from `positionLocal` (the level
frame: merged meshes are not transformed) and, on the instanced racks, `positionGeometry` / `normalGeometry` (the
rack's own frame: three's instance node overwrites `positionLocal` with the instanced position, which is then the level
frame). Box faces are axis-aligned, so a face's 2D coordinates come from its normal, no triplanar needed:

```ts
const faceUV = (p: Node<'vec3'>, n: Node<'vec3'>) =>
  select(abs(n.y).greaterThan(0.5), p.xz, select(abs(n.x).greaterThan(0.5), p.zy, p.xy));
```

**Rule for every fine pattern** (holes, seams, LEDs, louvres): fade it to its average with screen-space size, or it
shimmers and moirés at a few metres. `const detail = float(1).sub(smoothstep(pitch * 0.3, pitch * 0.8, fwidth(coord)))`
and `mix(average, pattern, detail)`.

**Floor (hall, tiled).** Sealed slab, broad stains, fine grit, 0.6 m tile seams, perforated tiles in the cold aisles,
baked AO and far light (below). Roughness varies with the stain so troffer highlights break up.

```ts
const p = positionLocal.xz;
const stain = mx_fractal_noise_float(vec3(p.mul(0.35), 0), 3, 2, 0.5).mul(0.5).add(0.5);
const grit = mx_noise_float(vec3(p.mul(9), 1)).mul(0.5).add(0.5);
const f = fract(p.div(0.6));
const edge = min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus())).mul(0.6);   // m to the nearest seam
const seam = float(1).sub(smoothstep(0.003, float(0.003).add(fwidth(edge)), edge));
const bake = texture(bakeMap, p.sub(BAKE_MIN).div(BAKE_SIZE));                    // r: floor AO, b: far light
const perfTile = texture(tileMap, p.sub(BAKE_MIN).div(BAKE_SIZE)).r;               // 1 in cold-aisle tiles (nearest)
const holes = holePattern(p, 0.025, 0.007).mul(perfTile);                          // 25 mm pitch, 7 mm radius
const albedo = mix(color(0x5e5f5d), color(0x74746f), stain).mul(grit.mul(0.08).add(0.92))
  .mul(seam.mul(0.5).oneMinus()).mul(holes.mul(0.7).oneMinus());
floor.colorNode = albedo.mul(bake.r);
floor.roughnessNode = mix(float(0.28), float(0.6), stain).add(seam.mul(0.3)).add(holes.mul(0.3));
floor.emissiveNode = albedo.mul(bake.b).mul(farLight);                              // see Lighting
```

Vestibule and UPS floors use the same material without tiles (`tileMap` is 0 there).

**Walls.** Painted concrete block, 0.4 × 0.2 m, 8 mm mortar joints offset every other course, a darker dado band below
1.2 m, a vertical contact shade near floor and ceiling. Roughness 0.85.

```ts
const q = faceUV(positionLocal, normalLocal).div(vec2(0.4, 0.2));
const course = floor(q.y);
const b = fract(vec2(q.x.add(course.mod(2).mul(0.5)), q.y));
const joint = float(1).sub(smoothstep(0.02, float(0.02).add(fwidth(b.x)), min(b.x, b.x.oneMinus())).mul(
  smoothstep(0.04, float(0.04).add(fwidth(b.y)), min(b.y, b.y.oneMinus()))));
const blockTint = mx_noise_float(vec3(floor(q.x.add(course.mod(2).mul(0.5))), course, 3)).mul(0.04);
const y = positionLocal.y;
const dado = step(y, 1.2);
const ao = smoothstep(0, 0.5, y).mul(0.45).add(0.55).mul(smoothstep(ceilH, ceilH.sub(0.6), y).mul(0.3).add(0.7));
wall.colorNode = mix(color(0xa7a9a8), color(0x5d6266), dado).add(blockTint).mul(joint.mul(0.25).oneMinus()).mul(ao);
```

`ceilH` is the zone's ceiling height: a per-vertex attribute written when merging (4.2 / 3.0 / 3.4), not a uniform,
so one wall material covers every zone.

**Ceiling and beams.** Dark `#26282b`, roughness 0.95, large faint board-form streaks (`mx_noise_float` stretched 1:20
along x), darkened where walls and beams meet it (bake channel g). Pillars use the wall material without the block joints
(cast concrete: same noise as the floor, `#8f918f`).

**Racks.** One `InstancedMesh` of a 12-triangle box (origin at the bottom centre, front = local +z), one instance per rack,
rotated π for rows facing -z. Per instance: `hash(instanceIndex)` gives the door variant and how full the rack is;
nothing else per instance needs uploading. Faces by `normalGeometry`:

- *Sides and top:* powder coat, `mix(#1b1d21, #24272c, variant)`, roughness 0.45 with orange-peel noise
  (`mx_noise_float` at 300/m, ±0.08 roughness), metalness 0.
- *Front:* a 30 mm solid frame, a handle bar (a lighter 15 × 180 mm strip at the right), the door field inside.
  Variant 0 (75 %): perforated steel, staggered 8 mm pitch, 2.8 mm holes. Variant 1 (15 %): smoked glass: no holes,
  roughness 0.1, the interior and LEDs seen at 50 %. Variant 2 (10 %): blank network rack, solid door, more amber LEDs
  on a patch strip at the top. Through the holes: the interior colour with 1U bezel lines (44.45 mm) and the LEDs.
- *Back:* perforated like variant 0, darker, a few green link LEDs, no fill (cheaper).
- *Floor contact:* the bottom 0.3 m of every face darkens to 0.6 (`smoothstep(0, 0.3, positionGeometry.y)`).

```ts
const holePattern = Fn(([p, pitch, r]: [Node<'vec2'>, number, number]) => {
  const q = p.div(pitch);
  const row = floor(q.y);
  const c = vec2(fract(q.x.add(row.mod(2).mul(0.5))), fract(q.y)).sub(0.5).mul(pitch);
  const d = length(c), aa = fwidth(d);
  const hole = float(1).sub(smoothstep(float(r).sub(aa), float(r).add(aa), d));
  const open = (Math.PI * r * r) / (pitch * pitch);                     // average where holes go sub-pixel
  return mix(float(open), hole, float(1).sub(smoothstep(pitch * 0.25, pitch * 0.6, fwidth(p.x))));
});
```

**Status LEDs.** In the rack front's shader, no geometry. Rows of 1U from y = 0.1 m; each row is "filled" if its seed is
under the rack's fill (0.3–0.9); a filled row has a power LED (steady green) and an activity LED (blinking) at fixed x.
`time` is TSL's built-in timer; `ledPower` is a uniform for power cuts.

```ts
const U = 0.04445, inst = instanceIndex.toFloat();
const yy = positionGeometry.y.sub(0.1), u = floor(yy.div(U));
const s = hash(inst.mul(64).add(u));
const filled = step(s, hash(inst).mul(0.6).add(0.3)).mul(step(u, 41)).mul(step(0, u));
const cell = vec2(positionGeometry.x.sub(-0.21), fract(yy.div(U)).sub(0.5).mul(U));
const r = 0.0015, aa = fwidth(cell.y);
const dot = float(1).sub(smoothstep(float(r).sub(aa), float(r).add(aa), length(cell)));
const rate = mix(0.7, 9, hash(s.add(13)));
const on = step(fract(time.mul(rate).add(s.mul(17))), mix(0.3, 0.95, hash(s.add(3))));
const tint = select(hash(s.add(5)).lessThan(0.82), color(0x39ff6a), select(hash(s.add(5)).lessThan(0.95), color(0xffb020), color(0x3a8bff)));
// far away the dot is sub-pixel: replace it by a dim average glow so the rows still flicker
const far = smoothstep(0.002, 0.006, aa);
const led = tint.mul(mix(dot, float(0.04), far)).mul(on).mul(filled).mul(ledPower).mul(6);
rack.emissiveNode = isFront.select(led.mul(doorSeeThrough), vec3(0));
```

Intensity 6 is over bloom's threshold (2.0, `src/post.ts`), so near LEDs bloom; the far average (6 × 0.04) doesn't.

**Light strips (troffers).** Merged boxes 0.12 × 0.06 m along x; emissive `#eef3ff` × 3.5 on the underside only
(`normalLocal.y < -0.5`), housing `#3a3d41` elsewhere. One strip in eight (seeded) is "tired": 0.6 brightness and a slow
flicker (`step(0.97, hash(floor(time.mul(7)).add(seed)))` dips to 0.2).

**Equipment** (CRAC, UPS, batteries). Off-white, roughness 0.6, horizontal louvres on the front (`fract(y / 0.025)` dark
lines, faded with `fwidth`), a small dark display panel with one green and one amber LED (same LED code, a fixed seed).

**Steel and trays.** Galvanised, metalness 0.8, roughness 0.45, low-frequency mottling. Tray bottoms get ladder rungs
as dark stripes every 0.3 m. Cable bundles: `#15171a`, stripes along the run (`mx_noise_float` stretched 1:50).

**Floor paint.** Thin boxes y [0, 0.003], `polygonOffset` (factor -1, units -4). Yellow lines 0.08 m round each rack
block at 0.3 m off it; hazard bands 0.6 m deep inside both doors: `step(0.5, fract(positionLocal.x.add(positionLocal.z).div(0.2)))`
mixes yellow and `#1a1a1a`. Roughness 0.5.

**Baked AO and light map** (client, at build, deterministic, ~30–60 ms). One `DataTexture`, RGBA `HalfFloatType`, linear,
over the bounds at 0.1 m (310 × 340 texels, ~840 KB):
- r: floor contact AO. Rasterise the footprint of every solid box with y0 ≤ 0.05, blur twice with a 7-texel box filter
  (~0.25 m), `ao = 1 - 0.5 * blurred`. Darkens the floor under rack edges, round pillars, along walls.
- g: ceiling contact AO, same from boxes touching the ceiling (walls, beams).
- b: far light: diffuse irradiance on the floor from every light fixture, `I · cosθ / d^decay` with the fixture's range
  window, tested against the solid boxes' 2D footprints taller than the texel's sightline (a rack row blocks a strip over
  the next aisle). Normalised to max 1; the scale is a uniform. Walls and racks sample it at their own xz times a height
  falloff, so the far end of the hall reads lit.
A second, `RedFormat` `UnsignedByteType`, nearest, one texel per 0.6 m tile: 1 where a tile is perforated.

No downloaded textures. If the procedural concrete looks too clean in the bench, the one texture worth adding is a
512² tiling greyscale stain map for the floor (WebP, ~60 KB), sampled at 4 m and 13 m and multiplied in.

## Lighting

There is no sun, sky or hemisphere: the level's lights are the scene's only lights, so avatars, hands and held items are
lit by them too, and every lit material pays for every real light. So:

- **Fixtures are data** (`shared/levels/datacenter.ts`), as many as the look needs: 28 here.
- **Real lights are a fixed pool** on the client: **6 point lights and 1 shadow-casting spot light**. The count and the
  shader structure never change; the pool is reassigned to the fixtures nearest the camera.
- **Everything else is faked**: emissive strips, LEDs, the baked far-light map, AO, ambient and environment.

**Fixtures.** Point fixtures hang under the strips at y 3.5:
- Hall: x = ±5.4 at every cold aisle centre and the back aisle, z ∈ {5.1, 10.5, 15.9, 21.3, 25.5} (10); x = ±10.8 over the
  perimeter aisle at z ∈ {1.5, 10.5, 21.3} (6). `#eef3ff`, intensity 4, range 9, decay 1.5.
- Vestibule: 1 at (0, 2.8, -2.8), intensity 2, range 6. UPS room: 2 at (14, 3.2, 6) and (16.8, 3.2, 6), intensity 2.5, range 6.
- Emergency, amber `#ff7a1a`, intensity 0.8, range 4: over the hall door (both sides), over the exit door, inside the UPS door (4).
- Shadow spots (`castsShadow`, kind `'spot'`): downlights over the cross aisle at (0, 3.9, z) for z ∈ {1.5, 10.5, 19.5},
  one in the vestibule at (0, 2.9, -1.5), one in the UPS room at (15.3, 3.3, 3.7) (5). Pointing straight down, angle 0.95
  rad, penumbra 0.5, range 10, intensity 6, `#eef3ff`. They are drawn as round downlight discs (emissive × 4).

That's 23 point fixtures and 5 spot fixtures. Fixture density is set so a 10 m circle round the player usually holds
3–5 point fixtures: the pool of 6 has headroom for an emergency light or a doorway.

**Pool assignment** (`update(dt, cameraPos)`, every frame, 28 fixtures, trivially cheap):
1. Score each fixture: `d = distance(camera, fixture) + (zone differs from the camera's zone ? 4 : 0)` (a wall is in the way;
   the 4 m keeps the UPS room's lights from stealing slots from the hall but lets them come up as you near its door).
2. Target weight `t = 1 - smoothstep(6, 10, d)` (full within 6 m, gone at 10 m).
3. Each slot holds one fixture and a displayed weight `w`; `w` eases to its fixture's `t` with
   `w += (t - w) * (1 - exp(-dt * 6))` (~0.4 s). Light intensity = fixture intensity × `w`.
4. A slot is only given a new fixture when its `w` is under 0.01: a light is **never moved while visible**. A slot whose
   fixture has `t = 0` drains; a free slot takes the best-scoring unassigned fixture with `t > 0`.
5. If all slots are busy and an unassigned fixture scores better than the worst assigned one by more than 1.5 m
   (hysteresis), that worst one's target is forced to 0 so it drains and frees its slot.
6. The spot slot does the same over the 5 spot fixtures (one slot: the nearest downlight fades as you walk away from it,
   the next fades in). Hall shadow map 1024², `bias -0.0005`, `normalBias 0.02`, updated every frame (players move);
   casters: racks, players, CRAC; the concrete casts nothing (`castShadow` off on walls, floor, ceiling).

Point lights at zero intensity still run their shader code, so the pool needs a `PooledPointLight` beside the existing
`PooledSpotLight` (`src/world/pooledLight.ts`, the same `If(active)` around `super.setup`). Point lights cast no shadows.

**Far field.** Beyond the pool's radius the floor and walls are lit by the baked map (channel b) through the emissive slot,
cross-faded by the surface's own distance from the camera so near surfaces don't get both:
`farLight = smoothstep(5, 9, distance(positionWorld, cameraPosition)) * bakeScale`. The two fade radii don't match
exactly (the pool fades by fixture distance, the bake by surface distance); with ranges of 9 m and a smooth grid the
mismatch is a soft, slight dip, not a pop. Tune `bakeScale` in the bench so the far end of the hall is as bright as the
near end at a glance.

**Fake AO** (GTAO from the post pass is weak in this low-contrast light): the bake (floor, ceiling), the vertical contact
shade on walls, pillars, racks and equipment, and the dark underside of trays. Keep post AO on (user setting) as extra.

## Environment profile (what the integration sets while in the level)

| Setting | Value | Why |
|---|---|---|
| Ambient | `HemisphereLight(0x9aa6b4, 0x3a3c40, 0.35)` | The only constant fill: cool from above, dim grey from the floor. Counts as one light. |
| Environment (metal reflections) | `datacenterEnvironment` below | Low-frequency, like `desertEnvironment`. |
| Background | `#050607` | Never seen (closed room). |
| Fog, sky, sun disc, flares, veiling glare, heat haze, storm grit | off | |
| Tone mapping | the game's (ACES), exposure 1.15 | Interior is dimmer than the desert; adapt over ~1.5 s on entry. |
| Bloom | strength 0.6, radius 0.3, threshold 2.0 (unchanged) | Strips and near LEDs bloom tight, nothing else. |
| SSAO | follow the user's setting | Baked AO carries the look; post AO adds to it. |
| Hand shade (`handShade`) | 0.8 | Lit, but no sun. |

```ts
const ceilingC = uniform(new THREE.Color(0xc8d4e0).multiplyScalar(0.45));   // strips seen from below
const rackC = uniform(new THREE.Color(0x20242a).multiplyScalar(0.25));       // the horizon: dark racks
const floorC = uniform(new THREE.Color(0x4a4a48).multiplyScalar(0.25));
export const datacenterEnvironment = Fn((builder: THREE.NodeBuilder) => {
  const ctx = builder.context as { getUV?: () => Node<'vec3'>; getTextureLevel?: () => Node<'float'> };
  const dir = ctx.getUV?.() ?? normalWorld;
  const blur = ctx.getTextureLevel?.() ?? float(1);
  const y = mix(dir.y, float(0), blur.mul(0.35));
  return mix(mix(floorC, rackC, smoothstep(-0.4, 0, y)), ceilingC, smoothstep(0.25, 0.8, y));
})();
```

Power out (later): `ledPower` 0, pool intensities × 0, emergency fixtures × 3, hemisphere to 0.08: no recompile.

## Atmosphere, without haze

What sells it is sound, blinking and order, not particles.
- **Bed:** broadband air/fan noise (pink noise low-passed ~4 kHz, slow ±1 dB drift) plus 100 Hz mains hum and its 200 Hz
  harmonic, quiet. Non-positional, the whole hall. About **−30 LUFS** integrated at the default volume (well under the −23
  mix target, like exploration's −35: this is the level's whole soundscape, so a little louder than the desert's bed).
- **Sources (positional):** each CRAC a lower rumble with a slow fan beat (up to −27 LUFS within 2 m); the UPS room a
  louder transformer hum (−26 inside, gone through the wall); now and then a disk-seek chatter or relay click from a
  random rack (short one-shots, may poke above).
- No desert wind indoors. Footsteps take the concrete set; a short room tail (~0.6 s) on steps and shots; measure the mix
  with reverb on, since a tail raises loudness. Ramp every gain on entry/exit (`setTargetAtTime`), through the master
  limiter (`docs/audio.md`).

## Performance budget (integrated GPU, 1080p, 60 fps)

| Item | Budget | How |
|---|---|---|
| Draw calls (scene pass) | ≤ 25 | ~12 merged materials, 1 instanced rack mesh, players. |
| Shadow pass | ≤ 6 draws | One 1024² spot map: racks (1 instanced draw), CRAC, players. |
| Triangles | ≤ 40 k + players | Racks 210 × 12 = 2.5 k; ~800 visual boxes × 12 = 10 k. |
| Real lights | 6 point + 1 spot + 1 hemisphere | Fixed pool; inactive ones skip their shader work. |
| Textures | ~0.9 MB | The bake map and the tile map. |
| Build time | ≤ 100 ms | Box merging + the bake; move the bake to a worker if it isn't. |

The cost that matters is per-pixel: up to 7 lights on procedural materials. Keep each material's noise to 2–3
`mx_noise` calls, put the pattern detail behind the `fwidth` fades, and use no transparency (glass doors are opaque with
a see-through look). Merged meshes are per material over the whole level and stay frustum-culled as one; split the hall
floor and ceiling into 4 quadrants if the profiler shows overdraw from behind walls (unlikely: it's one room). Check with
`npm run perf` in the level against the desert at the same resolution: the level should be cheaper.

## Shared data: `shared/levels/datacenter.ts`

Pure data, no three.js, deterministic (seeded `mulberry32` from `shared/noise.ts`), Node type stripping rules.

```ts
import { mulberry32 } from '../noise.ts';

export type Vec3 = [number, number, number];
/** Axis-aligned box in the level frame: x0, x1, y0, y1, z0, z1 (m). */
export type Box = [number, number, number, number, number, number];
export type ZoneId = 'hall' | 'vestibule' | 'ups';
export type LevelMat = 'floor' | 'wall' | 'pillar' | 'ceiling' | 'steel' | 'tray' | 'cable' | 'equipment'
  | 'door' | 'strip' | 'downlight' | 'emergency' | 'paint' | 'hazard' | 'rack';
/** 'both': collides and is drawn; 'collide': collision only (the rack runs); 'draw': visual only. */
export type BoxUse = 'both' | 'collide' | 'draw';
export interface LevelBox { b: Box; mat: LevelMat; zone: ZoneId; use: BoxUse }
/** One rack: bottom-centre position; face +1 = front towards +z. Variant 0 perforated, 1 glass, 2 network. */
export interface Rack { x: number; z: number; face: 1 | -1; variant: 0 | 1 | 2 }
export interface Fixture {
  kind: 'point' | 'spot';
  role: 'main' | 'emergency';
  pos: Vec3;
  /** Spot only: where it points, cone half-angle (rad), penumbra 0..1. */
  target?: Vec3; angle?: number; penumbra?: number;
  color: number; intensity: number; range: number; decay: number;
  castsShadow: boolean;
  zone: ZoneId;
}
export interface Spawn { pos: Vec3; /** Facing on the ground plane, unit (dx, dz). */ face: [number, number] }
export interface LevelLayout {
  id: 'datacenter';
  bounds: Box;
  zones: Record<ZoneId, Box>;        // interiors, for "which zone am I in" (fixture scoring, audio)
  boxes: LevelBox[];
  racks: Rack[];
  fixtures: Fixture[];
  spawns: Spawn[];
  exits: Box[];                      // trigger volumes in front of the exit door (the integration decides what they do)
}

export const DC = {
  hallX: 12, hallZ: 28, hallH: 4.2, wall: 0.3, slab: 0.3,
  rack: { w: 0.6, d: 1.2, h: 2.0 }, crossAisle: 1.2 /* half width */, perBlock: 14,
  rowZ0: 3.0, rows: 8, cold: 1.8, hot: 1.2, emptyChance: 0.06,
  tray: { y0: 2.4, y1: 2.55, w: 0.45 }, stripY: 3.6,
} as const;

export function datacenterLayout(seed = 1): LevelLayout {
  const rand = mulberry32(seed);
  const boxes: LevelBox[] = [], racks: Rack[] = [], fixtures: Fixture[] = [];
  const add = (mat: LevelMat, zone: ZoneId, use: BoxUse, ...b: Box) => boxes.push({ b, mat, zone, use });
  const { wall: t, slab: s, hallX: X, hallZ: Z, hallH: H } = DC;
  // Hall shell: floor, ceiling, walls split round the two doors (lintels over them).
  add('floor', 'hall', 'both', -X - t, X + t, -s, 0, -t, Z + t);
  add('ceiling', 'hall', 'both', -X - t, X + t, H, H + s, -t, Z + t);
  add('wall', 'hall', 'both', -X - t, -0.9, -s, H + s, -t, 0);
  add('wall', 'hall', 'both', 0.9, X + t, -s, H + s, -t, 0);
  add('wall', 'hall', 'both', -0.9, 0.9, 2.4, H + s, -t, 0);           // lintel
  // ... north and west walls, east wall round the UPS door (z 3.0–4.4, 2.3 high), beams, pillars,
  //     CRAC units, the vestibule and UPS room shells and cabinets, door frames, paint, as in "Layout".
  let z = DC.rowZ0;
  for (let r = 0; r < DC.rows; r++) {
    const face: 1 | -1 = r % 2 === 0 ? 1 : -1, z0 = z, z1 = z + DC.rack.d, zc = (z0 + z1) / 2;
    for (const side of [-1, 1]) {
      let run: number[] = [];
      const flush = () => {
        if (!run.length) return;
        const xs = run.map((i) => side * (DC.crossAisle + i * DC.rack.w));
        const xa = Math.min(...xs, ...xs.map((x) => x + side * DC.rack.w));
        const xb = Math.max(...xs, ...xs.map((x) => x + side * DC.rack.w));
        add('rack', 'hall', 'collide', xa, xb, 0, DC.rack.h, z0, z1);
        run = [];
      };
      for (let i = 0; i < DC.perBlock; i++) {
        const end = i === 0 || i === DC.perBlock - 1;
        if (!end && rand() < DC.emptyChance) { flush(); continue; }
        const v = rand();
        racks.push({ x: side * (DC.crossAisle + (i + 0.5) * DC.rack.w), z: zc, face, variant: v < 0.75 ? 0 : v < 0.9 ? 1 : 2 });
        run.push(i);
      }
      flush();
      // tray over the block, rods every 1.8 m, strips over the next aisle (all 'draw').
    }
    z = z1 + (r === DC.rows - 1 ? 0 : face === 1 ? DC.cold : DC.hot);
  }
  // fixtures and spawns as in "Lighting" and "Layout".
  return { id: 'datacenter', bounds: [-12.3, 18.6, -0.3, 4.5, -5.6, 28.3], zones: { /* ... */ } as LevelLayout['zones'],
    boxes, racks, fixtures, spawns: [], exits: [] };
}

/** The level everyone plays: fixed seed, so server and clients agree. */
export const DATACENTER = datacenterLayout(1);

/** Uniform xz grid over the solid boxes, for collision queries. */
export interface BoxGrid { x0: number; z0: number; cell: number; nx: number; nz: number; cells: number[][]; solid: Box[] }
export function boxGrid(L: LevelLayout, cell = 2): BoxGrid { /* bucket every box with use !== 'draw' by the cells it overlaps */ }
/** Indices into grid.solid of the boxes that may touch a circle of radius r at (x, z). */
export function boxesNear(g: BoxGrid, x: number, z: number, r: number, out: number[]): number[] { /* ... */ }
```

The rack seed per instance is `hash(instanceIndex)` in the shader, so the rack list's order is part of the look: keep
the generator's loop order stable.

## Client builder: `src/levels/datacenter/`

```
src/levels/datacenter/
  index.ts        buildDatacenter(): merges boxes by material, the rack InstancedMesh, the pool, update/dispose
  materials.ts    one function per material (floor, wall, rack, strip, ...) taking the bake textures
  bake.ts         bakeMaps(L): { bake: DataTexture; tiles: DataTexture } (AO r/g, far light b; tile mask)
  lightPool.ts    LightPool: fixed PooledPointLight × 6 + PooledSpotLight × 1, assignment as in "Lighting"
  environment.ts  datacenterEnvironment, DATACENTER_ENV (the profile table as data)
```

```ts
export interface LightPool {
  points: PooledPointLight[];           // 6, always in root
  spot: PooledSpotLight;                 // 1, castShadow, its target in root too
  lights: THREE.Light[];                 // all 7, for the integration's bookkeeping
  update(dt: number, camera: THREE.Vector3, zone: ZoneId | null): void;
}
export interface DatacenterScene {
  root: THREE.Group;
  pool: LightPool;
  update(dt: number, cameraPos: THREE.Vector3): void;   // pool assignment, farLight camera, strip flicker
  dispose(): void;                                     // geometries, materials, textures, shadow map
}

export function buildDatacenter(): DatacenterScene {
  const L = DATACENTER;
  const root = new THREE.Group();
  root.name = 'datacenter';
  const maps = bakeMaps(L);
  const mats = makeMaterials(maps);                    // Record<Exclude<LevelMat, 'rack'>, Material> + rack
  for (const [mat, list] of groupBy(L.boxes.filter((b) => b.use !== 'collide'), (b) => b.mat)) {
    const mesh = new THREE.Mesh(boxGeometry(list), mats[mat]);  // with a ceilH attribute for walls
    mesh.receiveShadow = true;
    mesh.castShadow = mat === 'equipment';
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
  const racks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 2.0, 1.2).translate(0, 1, 0), mats.rack, L.racks.length);
  L.racks.forEach((r, i) => racks.setMatrixAt(i, m4.makeRotationY(r.face === 1 ? 0 : Math.PI).setPosition(r.x, 0, r.z)));
  racks.castShadow = racks.receiveShadow = true;
  root.add(racks);
  const pool = makeLightPool(L.fixtures);
  for (const l of pool.lights) root.add(l);
  root.add(pool.spot.target);
  return {
    root, pool,
    update(dt, cam) { pool.update(dt, cam, zoneAt(L, cam)); },
    dispose() { /* dispose every geometry, material, both textures, pool.spot.shadow.map */ },
  };
}
```

Racks: one instance per rack is 210 matrices (13 KB), set once. The variant from the layout goes in a per-instance
`InstancedBufferAttribute` (one float) if the shader's `hash(instanceIndex)` choice must match the server (it will once
racks hold loot); until then the hash alone is fine. Lights need the root in the scene to get matrices; the integration
adds `root` and so also the pool. Prewarm: compile with all 7 pool lights present at `w = 0` before the first entry
(the shader structure is final from the start).

Bench: a `?w=` dev room or the art bench should load the level alone with the profile applied, to tune `bakeScale`,
exposure, strip and LED intensities.

## Open questions and later

- **Doors:** the exit door is a trigger box for now. A sliding hall door, or cold-aisle containment doors at the row ends,
  would be solid boxes that toggle: shared state, so it goes through the server.
- **Racks as loot:** open a rack door, pull a server, tear it down (`src/teardown/`, `docs/machines.md`); drops through
  `shared/enemies.ts`-style registry and `shared/lootRoll.ts`. Needs a stable rack id (the list index) and the variant as
  data, not a shader hash.
- **Power going out:** the UPS room's switch panel; the profile has a power-out state that changes only uniforms and
  intensities. Fans spin down in the audio, emergency amber takes over.
- **Raised floor for real:** a 0.3 m deck with a ramp would allow floor tiles that lift; costs collision boxes and a ramp in
  `shared/sim.ts`. Not for "basic".
- **Blob shadows** under players, for when the spot slot is on a far downlight.
- **Enemies indoors:** crawlers in the hot aisles would need the same box grid for their movement.
- **More rooms:** a network room (one row, patch panels, more amber) is the next cheap addition; same materials.
