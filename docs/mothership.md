# The mothership

A mega-structure in orbit, always in the desert's sky. For now it's only seen. **The end goal is to bring it down**
(not built yet; see "Later").

## What you see

- A ship ~12,000 km long (a continent's size): a long hexagonal hull with a knife prow, built over with a city of
  blocks (the servers), a great habitat ring spinning round its middle, swept heat vanes at the stern that glow like
  embers at night, three engine bells glowing blue, hangar mouths lit on its belly, and blinking nav lights.
- **It never sets.** Lowest (~15° up), nearest and biggest (~23° long) due south at midnight, right over the dunes
  you're looking at. Through the morning it swings east and climbs, shrinking and slowing, to ~67° up and ~15° long at
  noon, then comes back down the west through the evening. The same loop every day. (The moon, drawn big, is 4°.)
- By night it's sunlit (it passes just clear of the planet's shadow at midnight), a bright shape blotting out the
  stars, with its windows lit. By day it shows pale through the sky like a daytime moon, its shadowed side lost in the
  blue. Low down it reddens and fades into the haze; sandstorms hide it.
- Its belly always faces the planet (nadir-pointing), so you see it turn as it goes round.

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
- Also returned: its attitude (nose along the flight, belly to the planet's centre), sunlight (planet's cylindrical
  shadow with a red atmospheric rim; never reached with these numbers) and how much sunlit desert it sees (planetshine).

Test: `tools/mothership.test.mjs` (always above the horizon, always sunlit, biggest and southmost at midnight, a real
orbit that repeats daily).

## Drawing (`src/world/mothership.ts`)

- The model is built in code (boxes, hexagonal prisms, extruded vanes, a torus; ~10 draw calls), in units of its
  length. Node materials: plated gunmetal with window lights (cell noise), ember vanes, unlit lamps past the bloom
  threshold.
- Its own little scene (the model, a directional light from `sunDirection` at space strength, a dim orange one from
  below for planetshine), rendered each frame **only when it's in view** into a screen-sized HDR target with a camera
  turned like the player's but at the origin (no parallax at 40,000 km).
- The sky dome (`src/world/sky.ts`) composites it physically: `skyAir + (stars + sun + moon + night sky) × (1 − cover)
  + ship × clearness`. The air's glow (`skyAir` in `src/world/env.ts`, `skyRadiance` without the stars) is in front of
  it, everything in space behind it. The depth buffer stays at 1 there, as for any sky (post.ts tells sky by it), and
  the ground covers it.
- The ring spins at 1 g for its radius (~57 game minutes a turn, ~71 s real).

## Later: bringing it down

The end goal. Not designed yet; whatever brings it down, the pieces are in place:

- `mothershipAt` is shared, so the server knows where it is and can take over its orbit (a deorbit burn, an orbit
  decaying day by day, a piece breaking off) and send it to the clients.
- Ideas to decide: what the players do to bring it down (the radio towers' signal, `docs/radiotowers.md`, is a
  natural link), whether all of it falls or a piece does (12,000 km wouldn't leave a desert), what the fall looks
  like (it lowers and grows night by night, then re-entry glow, then impact), and what's left (a wreck to go into: a
  level, `docs/levels.md`).
