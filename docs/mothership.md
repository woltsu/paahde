# The mothership

A mega-structure in orbit, always in the desert's sky. For now it's only seen. **The end goal is to bring it down**
(not built yet; see "Later").

## What you see

- A wheel station ~12,000 km across (a continent's size), after the classic wheel stations of 1970s–80s space art: a
  great segmented ring on four lattice spokes (a lift shaft inside each) and fine cables, spinning round a hub column;
  under the hub a ribbed cone out to a saucer and back in to a lattice antenna with two small dishes; on top a railed
  platform with piped tanks, a lattice mast and a big ribbed dish; gold solar panels on truss arms, turned to the sun.
- **Vast through a scope too.** Size is judged by detail, so it has detail at every scale, the way a city does from a
  plane: plating in sections, panels and sub-panels (procedural, each scale fading in only once it's over a pixel, so
  zooming keeps finding more instead of blurring), ~2,000 modules, fins, docking bays, pipe runs and rails on the ring
  and column, lattices you can count the bays of, decks of pinprick windows (resolved only from ~6× zoom; to the naked
  eye just their faint average), and tiny shuttles and tugs drifting between ring and hub or docked, for scale. Zoomed
  in, its picture sharpens to full resolution and shimmers faintly, as through a long column of air.
- **Subtle, not a light show:** silvery and plated, a few dim warm portholes round the ring, no coloured or blinking
  lights. Its light comes through a veil of the sky's glow and its picture is a touch soft (rendered under the
  screen's resolution), as through 40,000 km of air.
- **It never sets.** Lowest (~15° up), nearest and biggest (~23° across) due south at midnight, right over the dunes
  you're looking at. Through the morning it swings east and climbs, shrinking and slowing, to ~67° up and ~15° across
  at noon, then comes back down the west through the evening. The same loop every day. (The moon, drawn big, is 4°.)
- The ring is always a slanting ellipse (0.4–0.5 as tall as it's wide), mast up, its underside to us.
- By night it's sunlit (it passes just clear of the planet's shadow at midnight), a dim shape blotting out stars. By
  day it shows pale through the sky like a daytime moon, its shadowed side lost in the blue. Low down it reddens and
  fades into the haze; sandstorms hide it.

## The orbit (`shared/mothership.ts`)

A real Kepler orbit round an Earth-sized planet, deterministic from the time of day (`mothershipAt(tod)`), plain math
so the server can use it later:

- **Geosynchronous** (semi-major axis 42,164 km, one turn per game day), so its path over the desert repeats daily and
  it never leaves the sky. The game has no year: the sun sits at a fixed declination, so neither does the path drift.
- **Eccentric** (e = 0.25) with perigee at midnight on the desert's meridian: biggest and fastest (Kepler's second law)
  at night, smallest and slowest at noon. Range ~33,000–48,000 km.
- **Inclined** 22°, perigee at its southernmost point. More inclination takes it down into the dunes at midnight;
  20° or less puts it in the planet's shadow at midnight (it would go dark but for its lights).
- Seen from the desert at latitude `LAT` with topocentric parallax (the planet's radius is a sixth of the range).
- **Attitude** held to the orbit (as the ISS flies, turning once a turn: here once a day), the spin axis tipped 55°
  from straight up towards the orbit's north. An axis held still in space (gyroscope-fashion) was tried and dropped:
  the line of sight to it turns right round each day, so the ring would go edge-on twice a day, at night among them.
- Also returned: sunlight (planet's cylindrical shadow with a red atmospheric rim; never reached with these numbers)
  and how much sunlit desert it sees (planetshine).

Test: `tools/mothership.test.mjs` (always above the horizon, always sunlit, biggest and southmost at midnight, a real
orbit that repeats daily, the ring a slanting ellipse all day).

## Drawing (`src/world/mothership.ts`)

- The model is built in code (prisms, tori, rods, lattices, sphere caps; ~128k triangles in 36 draw calls, merged per
  material; seeded, so the same every time), in units of its size. Node materials: multi-scale plating faded by
  `fwidth` (no sparkle), deck windows, two-scale gold solar cells, red paint; the craft are moved each frame.
- Its own little scene (the model, a directional light from `sunDirection` at space strength, a dim orange one from
  below for planetshine), rendered each frame **only when it's in view** into an HDR target at 0.6 of the screen's resolution to the naked
  eye, rising with the zoom (a scope narrows the field of view) to full resolution with a camera
  turned like the player's but at the origin (no parallax at 40,000 km).
- The sky dome (`src/world/sky.ts`) composites it physically: `skyAir + (stars + sun + moon + night sky) × (1 − cover)
  + station × clearness × veil` (veil 0.5: the rest of its light is lost in the air). The air's glow (`skyAir` in `src/world/env.ts`, `skyRadiance` without the stars) is in front of
  it, everything in space behind it. The depth buffer stays at 1 there, as for any sky (post.ts tells sky by it), and
  the ground covers it.
- The ring spins at 1 g for its radius (~142 game minutes a turn, ~3 min real); the hub doesn't.

## Later: bringing it down

The end goal. Not designed yet; whatever brings it down, the pieces are in place:

- `mothershipAt` is shared, so the server knows where it is and can take over its orbit (a deorbit burn, an orbit
  decaying day by day, a piece breaking off) and send it to the clients.
- Ideas to decide: what the players do to bring it down (the radio towers' signal, `docs/radiotowers.md`, is a
  natural link), whether all of it falls or a piece does (12,000 km wouldn't leave a desert), what the fall looks
  like (it lowers and grows night by night, then re-entry glow, then impact), and what's left (a wreck to go into: a
  level, `docs/levels.md`).
