// Survival: the heat meter and the canteen. Server-authoritative (server/water.ts) and not part of
// shared/sim.ts, since it never moves the player; the client only draws it (src/water.ts).
//
// Heat builds up: the hotter it feels (shared/temperature.ts: air temperature by time of day, plus the
// sun's bonus, or the shade's chill, capped in a shelter), the faster, from nothing at COMFORT_TEMP up a
// quadratic curve. Below COMFORT_TEMP (a shelter, shade by day, nights) you cool off by yourself. Sips from the water bottle
// (found broken and repaired, shared/gear.ts) bring it down; a pump or an electric well refills it. A full meter is heatstroke:
// the view fades out (src/water.ts `fainting`) and STROKE_S later you die, unless a sip brings it back down first.

/** Full heat meter: heatstroke. */
export const HEAT_MAX = 100;
/** Heatstroke kills after this long (s) with the meter full... */
export const STROKE_S = 5;
/** ...and wears off this many seconds per second once it is below full again. */
export const STROKE_RECOVER = 1;
/** Heat neither builds nor fades at this felt temperature (°C). */
export const COMFORT_TEMP = 30;
/** At this felt temperature (°C; full sun, early afternoon)... */
export const HOT_TEMP = 54;
/** ...an empty meter fills in this long walking (s). */
export const HOT_FULL_BAR_S = 60;
/** Build-up grows with (felt − COMFORT_TEMP) to this power: partial shade builds little. */
export const HEAT_POWER = 2;
/** Build-up multiplier while sprinting. */
export const SPRINT_HEAT = 1.5;
/** Cooling off: this many °C under COMFORT_TEMP (or more)... */
export const COOL_RANGE = 8;
/** ...empties a full meter in this long (s); less cool, slower. A shelter (22 °C) is full speed. */
export const COOL_FULL_BAR_S = 40;
/** How much heat one sip takes off. How many sips the bottle holds depends on its parts (shared/gear.ts canteenSips). */
export const SIP_COOL = 25;
/** How long one sip and one refill take on the client (the Drink / Fill animation lengths). */
export const DRINK_MS = 1200;
export const FILL_MS = 1500;
/** Server: minimum time between two sips / two refills (a little under the animations, for lag). */
export const DRINK_COOLDOWN_MS = 1000;
export const FILL_COOLDOWN_MS = 1200;
/** Server: how far beyond the pump's reach (shared/shelters.ts PUMP_REACH) a refill is still accepted (m), for lag. */
export const FILL_SLACK = 1;
/** Above this the HUD pulses and the screen edges glow with heat. */
export const HEAT_HIGH = 80;

/** Heat gained per second at felt temperature `temp` (°C); negative when cooling off. */
export function heatPerSecond(temp: number, sprinting: boolean): number {
  if (temp < COMFORT_TEMP) return (-Math.min(1, (COMFORT_TEMP - temp) / COOL_RANGE) * HEAT_MAX) / COOL_FULL_BAR_S;
  const k = Math.pow((temp - COMFORT_TEMP) / (HOT_TEMP - COMFORT_TEMP), HEAT_POWER);
  return (k * HEAT_MAX * (sprinting ? SPRINT_HEAT : 1)) / HOT_FULL_BAR_S;
}

// A newcomer's first minutes in the desert (from waking by their pod, server/world.ts): the heat is real, the meter
// climbs and the screen glows, but slower, and for a while it stops short of heatstroke, so the first noon teaches
// shade (the pod's own shadow is a couple of metres off its hatch) instead of killing. It eases into the full desert
// over ARRIVAL_EASE_S; it only slows the build-up, never the cooling.
/** How long the ease lasts after arriving (s of wall clock). */
export const ARRIVAL_EASE_S = 8 * 60;
/** Build-up multiplier on arrival, rising linearly to 1 at ARRIVAL_EASE_S. */
export const ARRIVAL_RATE = 0.3;
/** The meter's ceiling on arrival (under HEAT_MAX: no heatstroke), rising linearly to HEAT_MAX at ARRIVAL_EASE_S. */
export const ARRIVAL_CEILING = 88;

/** The ease `sinceS` seconds after arriving: the build-up's multiplier and the meter's ceiling (1 and HEAT_MAX once it
 *  is over, or before arriving at all). */
export function arrivalEase(sinceS: number): { rate: number; ceiling: number } {
  if (!(sinceS >= 0) || sinceS >= ARRIVAL_EASE_S) return { rate: 1, ceiling: HEAT_MAX };
  const f = sinceS / ARRIVAL_EASE_S;
  return { rate: ARRIVAL_RATE + (1 - ARRIVAL_RATE) * f, ceiling: ARRIVAL_CEILING + (HEAT_MAX - ARRIVAL_CEILING) * f };
}
