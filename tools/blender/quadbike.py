"""Scavenged desert quad ("sand quad"), exported as a glTF binary with animatable parts.

    tools/blender/run.sh -b --python tools/blender/quadbike.py                         # writes public/models/quadbike.glb
    tools/blender/run.sh -b --python tools/blender/quadbike.py -- --preview out.png    # also renders out.png, out_side.png, out_rear.png

The sand bike's (tools/blender/sandbike.py) bigger sibling, built from the same junk and painted from the same pots:
four balloon tyres (paddles at the back, knobs in front), a bare tube frame with a pipe bull bar, the same finned
single in the middle under a faded teal tank, the exhaust along the right to a dented can under the rear rack, a long
flat seat any body can sit on, wide footboards that rise at the front into a toe ramp up to the front fenders
(mismatched: one cream, one teal; the rear ones rust and orange), a rolled tarp on the front rack and a jerry can on
the rear one. The headlight sits in a pod on the bars and turns with them.

Blender is Z-up and the quad faces Blender +Y; the glTF exporter (Y-up) turns that into three.js -Z, so in the game
its FRONT points along -Z and its right side along +X. Units are metres; the origin is on the ground, midway between
the front and rear axles.

Node hierarchy (all node rotations are identity, scale 1):
    Quadbike             empty at the origin
      Body               frame, engine, tank, seat, footboards, fenders, racks, A-arms, swingarm (origin at ground)
      RearAxle           origin at the rear axle; both rear wheels, sprocket and disc on one solid axle; spin about local X
      SteerFL, SteerFR   the front hubs' knuckles, origin on the kingpin; steer by rotating about local Z (three.js Y)
        WheelFL, WheelFR origin at the front axle; spin about local X
      Handlebar          origin at the top of the steering column; steer by rotating about STEER_AXIS
Rolling forward (towards three.js -Z) is a negative rotation about X: wheel.rotation.x -= distance / radius.

Rider contact points (src/quad.ts, in three.js coordinates) are printed at the end of a build: the seat, the
grips in the Handlebar node's frame, and where the ankles go on the footboards and up the toe ramp.

Output is deterministic (fixed seeds, no Blender randomness).
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sandbike as sb  # noqa: E402  (its builders, materials, export and preview; runs nothing on import)

Rng, MeshBuilder, Y90, X90 = sb.Rng, sb.MeshBuilder, sb.Y90, sb.X90

# ----------------------------------------------------------------------------------------------- layout
# Blender coordinates: +X right, +Y forward, +Z up.
WHEELBASE = 1.22
TRACK_X = 0.44            # wheel centres, front and rear (outer faces at ±0.58 at the back)
FRONT = dict(r=0.30, carcass=0.27, rim=0.13, w=0.21)
REAR = dict(r=0.32, carcass=0.29, rim=0.14, w=0.27)
FRONT_Y, REAR_Y = WHEELBASE / 2, -WHEELBASE / 2
KING_X = 0.33             # the kingpins (the front wheels steer about these, vertical)
RAKE = math.radians(20)
STEER_AXIS = Vector((0, -math.sin(RAKE), math.cos(RAKE)))  # up the column, its top leaning back to the rider
PIVOT = Vector((0, 0.36, 0.92))                             # top of the column (the Handlebar node)
COLUMN_BOT = PIVOT - STEER_AXIS * ((PIVOT.z - 0.42) / math.cos(RAKE))
SEAT_TOP = 0.82
SEAT_Y = (-0.76, 0.06)
SEAT_W = 0.34
TANK_Y = (0.08, 0.36)
BOARD_Z = 0.28            # the footboards' top
BOARD_X = (0.19, 0.40)
BOARD_Y = (-0.30, -0.02)  # the flat part; the toe ramp rises from its front edge
RAMP = math.radians(35)
RAMP_TOP = 0.50
RAMP_LEN = (RAMP_TOP - BOARD_Z) / math.sin(RAMP)
ANKLE = 0.09              # an ankle's height over the sole


# ------------------------------------------------------------------------------------------------ wheels

def build_wheel(mb, axle, t, paddles, rng, front, side):
    """Balloon tyre (lathed) + treads + a dished steel rim, centred on `axle`; `side` -1/+1 puts the hub outwards."""
    w, r, carcass, rim = t['w'], t['r'], t['carcass'], t['rim']
    h = w / 2
    profile = [
        (-h * 0.72, rim + 0.01), (-h, rim + 0.055), (-h * 0.92, carcass - 0.03), (-h * 0.45, carcass),
        (h * 0.45, carcass), (h * 0.92, carcass - 0.03), (h, rim + 0.055), (h * 0.72, rim + 0.01),
    ]
    mb.lathe(profile, 16, axle, 'tyre')
    depth = r - carcass + 0.012
    for i in range(paddles):
        a = 2 * math.pi * i / paddles
        d = Vector((0, math.cos(a), math.sin(a)))
        if front:
            for sx in ((-0.5, 0.5) if i % 2 == 0 else (0.0,)):
                c = axle + Vector((sx * w * 0.62, 0, 0)) + d * (carcass + depth / 2 - 0.012)
                mb.box((w * 0.34, 0.065, depth), c, 'tyre_side', rot=(a - math.pi / 2, 0, 0))
        else:
            c = axle + d * (carcass + depth / 2 - 0.012)
            # Chevroned the other way on each side, so both rear paddles throw the sand back and out.
            mb.box((w * 1.04, 0.045, depth), c, 'tyre_side', rot=(a - math.pi / 2 + 0.25, 0, side * 0.12))
    # Rim: a painted drum, the outer face dished in round a hub with four lug nuts; a rust patch on the outside.
    mb.cyl(rim + 0.012, rim + 0.012, w * 0.74, 14, axle, 'rim', rot=Y90)
    face = axle + Vector((side * (w * 0.37 + 0.01), 0, 0))
    mb.cyl(rim * 0.62, rim * 0.62, 0.02, 12, face, 'rust_dark', rot=Y90)
    mb.cyl(0.055, 0.045, 0.05, 8, face + Vector((side * 0.02, 0, 0)), 'hub', rot=(0, side * math.pi / 2, 0))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        mb.box((0.02, 0.022, 0.022), face + Vector((side * 0.012, math.cos(a) * 0.07, math.sin(a) * 0.07)), 'steel')
    mb.box((0.012, 0.11, 0.07), face + Vector((side * 0.006, 0.06, -0.075)), 'rust', rot=(0.5, 0, 0))
    del rng


def build_knuckle(mb, side):
    """A front hub's upright on the kingpin, its stub axle and brake drum, and the steering arm back to the tie rod."""
    k = Vector((side * KING_X, FRONT_Y, FRONT['r']))
    mb.tube(k - Vector((0, 0, 0.12)), k + Vector((0, 0, 0.12)), 0.026, 'frame', 6)
    mb.box((0.05, 0.07, 0.07), k, 'rust_dark')
    mb.tube(k, Vector((side * (TRACK_X - 0.05), FRONT_Y, FRONT['r'])), 0.022, 'steel', 6)
    mb.cyl(0.085, 0.085, 0.04, 12, k + Vector((side * 0.05, 0, 0)), 'engine_dark', rot=Y90)  # brake drum
    mb.tube(k + Vector((0, 0, -0.05)), k + Vector((-side * 0.03, -0.11, -0.05)), 0.014, 'steel', 5)  # steering arm


# -------------------------------------------------------------------------------------------- handlebar

def build_handlebar(mb, rng):
    """Steering column, a tall bent bar with taped grips, the headlight pod, a gauge and a cut-jug hand guard."""
    u = STEER_AXIS
    fwd = Vector((0, math.cos(RAKE), math.sin(RAKE)))
    mb.tube(COLUMN_BOT, PIVOT + u * 0.02, 0.026, 'steel', 6)
    mb.box((0.14, 0.07, 0.05), PIVOT, 'rust_dark', rot=(RAKE, 0, 0))                   # bar clamp
    riser_top = PIVOT + Vector((0, -0.03, 0.07))
    for sx in (-1, 1):
        mb.tube(PIVOT + Vector((sx * 0.04, 0, 0.02)), riser_top + Vector((sx * 0.05, 0, 0)), 0.018, 'steel', 6)
    bar = [Vector((-0.44, riser_top.y - 0.13, riser_top.z + 0.06)),
           Vector((-0.25, riser_top.y - 0.03, riser_top.z + 0.02)),
           Vector((0.0, riser_top.y, riser_top.z)),
           Vector((0.25, riser_top.y - 0.03, riser_top.z + 0.02)),
           Vector((0.44, riser_top.y - 0.13, riser_top.z + 0.06))]
    mb.sweep(bar, 0.016, 'steel', segs=6)
    mb.tube(bar[1] + Vector((0, 0, 0.0)), bar[3], 0.011, 'steel', 5)                   # crossbar brace
    grips = []
    for sx in (-1, 1):
        a, b = bar[0 if sx < 0 else 4], bar[1 if sx < 0 else 3]
        d = (a - b).normalized()
        mb.tube(a - d * 0.12, a + d * 0.015, 0.025, 'grip', 7)
        mb.tube(a - d * 0.09, a - d * 0.06, 0.027, 'tape', 7)                           # tape wrap
        mb.tube(a - d * 0.14 + Vector((0, 0.03, 0)), a - d * 0.03 + Vector((0, 0.09, -0.02)), 0.008, 'steel', 4)
        grips.append(a - d * 0.055)
    # Hand guard on the left only: half a plastic jug, bolted on.
    g = bar[0] + Vector((0.06, 0.07, 0.0))
    guard = mb.box((0.14, 0.02, 0.1), g, 'cream', rot=(0.2, 0, -0.5), taper=(0.7, 1))
    mb.jitter(guard, rng, 0.004)
    # Headlight pod in front of the clamp, a gauge on top, a red pad on the crossbar.
    pod = riser_top + fwd * 0.1 + Vector((0, 0, -0.04))
    mb.box((0.22, 0.13, 0.12), pod, 'teal_dark', rot=(RAKE * 0.5, 0, 0), taper=(0.85, 0.8))
    lamp_c = pod + Vector((0, 0.07, 0.0))
    mb.cyl(0.07, 0.06, 0.06, 10, lamp_c, 'rust', rot=(-math.pi / 2, 0, 0))
    mb.cyl(0.058, 0.058, 0.02, 10, lamp_c + Vector((0, 0.03, 0)), 'lamp', rot=(-math.pi / 2, 0, 0))
    mb.tube(lamp_c + Vector((-0.07, 0.045, 0.0)), lamp_c + Vector((0.07, 0.045, 0.0)), 0.006, 'steel', 4)  # wire guard
    mb.cyl(0.035, 0.035, 0.03, 8, riser_top + Vector((0.07, 0.01, 0.03)), 'engine_dark', rot=(0.5, 0, 0))   # gauge
    mb.box((0.17, 0.04, 0.035), (bar[1] + bar[3]) / 2 + Vector((0, 0, 0.02)), 'red')
    return grips, lamp_c + Vector((0, 0.04, 0))


# ------------------------------------------------------------------------------------------------- body

def ramp_point(s, x):
    """A point on the toe ramp's surface, s metres up it from the board's front edge."""
    return Vector((x, BOARD_Y[1] + s * math.cos(RAMP), BOARD_Z + s * math.sin(RAMP)))


def build_body(mb, rng):
    # Frame: two lower rails from the bull bar back and up to the rear rack, two upper rails under the tank and seat,
    # uprights and cross tubes between them.
    for sx in (-1, 1):
        x = sx * 0.13
        mb.sweep([Vector((x, 0.86, 0.26)), Vector((x, 0.5, 0.2)), Vector((x, -0.3, 0.22)), Vector((x, -0.62, 0.42)),
                  Vector((sx * 0.15, -0.9, 0.7))], 0.024, 'frame', segs=6)
        mb.sweep([Vector((x, 0.62, 0.62)), Vector((x, 0.4, 0.7)), Vector((x, 0.0, 0.7)), Vector((sx * 0.15, -0.9, 0.74))],
                 0.022, 'frame', segs=6)
        mb.tube(Vector((x, 0.62, 0.62)), Vector((x, 0.72, 0.24)), 0.02, 'frame', 6)    # front upright
        mb.tube(Vector((x, -0.2, 0.7)), Vector((x, -0.1, 0.22)), 0.018, 'frame', 6)    # mid upright
    for y, z in ((0.86, 0.26), (0.62, 0.62), (0.3, 0.2), (-0.62, 0.42), (-0.9, 0.72)):
        mb.tube(Vector((-0.14, y, z)), Vector((0.14, y, z)), 0.018, 'frame', 6)
    skid = mb.box((0.3, 0.9, 0.022), (0, 0.15, 0.185), 'rust', rot=(0.02, 0, 0))
    mb.jitter(skid, rng, 0.006)

    # Bull bar: a bent pipe hoop out front with a cross bar, a rope tied round it.
    hoop = [Vector((-0.13, 0.86, 0.26)), Vector((-0.26, 0.98, 0.28)), Vector((-0.26, 1.0, 0.55)), Vector((-0.15, 0.96, 0.62)),
            Vector((0.15, 0.96, 0.62)), Vector((0.26, 1.0, 0.55)), Vector((0.26, 0.98, 0.28)), Vector((0.13, 0.86, 0.26))]
    mb.sweep(hoop, 0.026, 'rust_dark', segs=6)
    mb.tube(Vector((-0.26, 0.995, 0.42)), Vector((0.26, 0.995, 0.42)), 0.02, 'rust_dark', 6)
    mb.tube(Vector((-0.2, 1.0, 0.42)), Vector((-0.16, 1.0, 0.42)), 0.032, 'tape', 6)

    # Column bearing on the frame (the column itself turns with the Handlebar).
    mb.tube(COLUMN_BOT + STEER_AXIS * 0.02, COLUMN_BOT + STEER_AXIS * 0.12, 0.04, 'frame', 8)
    mb.tube(COLUMN_BOT + STEER_AXIS * 0.08, Vector((0, 0.62, 0.62)), 0.02, 'frame', 6)
    mb.tube(Vector((0, PIVOT.y + 0.02, PIVOT.z - 0.2)), Vector((0, 0.42, 0.7)), 0.02, 'frame', 6)  # upper bearing strut

    # Front suspension: a lower and an upper A-arm to each kingpin, a coil-over up to the frame, the tie rod.
    for sx in (-1, 1):
        k = Vector((sx * KING_X, FRONT_Y, FRONT['r']))
        for dz, z0 in ((-0.11, 0.24), (0.11, 0.42)):
            end = k + Vector((0, 0, dz))
            for y0 in (FRONT_Y - 0.1, FRONT_Y + 0.1):
                mb.tube(Vector((sx * 0.13, y0, z0)), end, 0.014, 'rust_dark', 5)
        top = k + Vector((0, 0, 0.11))
        sh_a, sh_b = top + Vector((-sx * 0.06, -0.02, 0)), Vector((sx * 0.14, FRONT_Y - 0.04, 0.66))
        mb.tube(sh_a, sh_b, 0.016, 'steel', 6)
        mb.tube(sh_a.lerp(sh_b, 0.25), sh_a.lerp(sh_b, 0.85), 0.035, 'spring', 8)
        mb.tube(Vector((sx * (KING_X - 0.03), FRONT_Y - 0.11, FRONT['r'] - 0.05)), COLUMN_BOT + Vector((sx * 0.03, 0, -0.02)),
                0.011, 'steel', 5)

    # Rear: a wide swingarm from the pivot behind the engine to the axle carriers, a monoshock up to the seat frame.
    piv = Vector((0, -0.18, 0.34))
    mb.tube(piv - Vector((0.14, 0, 0)), piv + Vector((0.14, 0, 0)), 0.03, 'steel', 8)
    for sx in (-1, 1):
        c = Vector((sx * 0.2, REAR_Y, REAR['r']))
        mb.sweep([piv + Vector((sx * 0.12, 0, 0)), Vector((sx * 0.18, -0.4, 0.34)), c], 0.03, 'rust_dark', segs=5)
        mb.box((0.06, 0.12, 0.1), c, 'frame')
    sh_a, sh_b = Vector((0, -0.42, 0.36)), Vector((0, -0.3, 0.68))
    mb.tube(sh_a, sh_b, 0.02, 'steel', 6)
    mb.tube(sh_a.lerp(sh_b, 0.2), sh_a.lerp(sh_b, 0.85), 0.04, 'spring', 8)

    # Engine: crankcase low in the middle, the finned barrel leaning forward, head, side covers, carb and filter.
    mb.box((0.24, 0.34, 0.2), (0, 0.04, 0.32), 'engine', taper=(1, 0.85))
    mb.cyl(0.1, 0.1, 0.05, 10, (-0.135, 0.0, 0.32), 'engine_dark', rot=Y90)
    mb.cyl(0.065, 0.065, 0.04, 8, (0.13, 0.08, 0.31), 'engine', rot=Y90)
    tilt = (-0.3, 0, 0)
    axis = Vector((0, math.sin(0.3), math.cos(0.3)))
    base = Vector((0, 0.1, 0.42))
    mb.box((0.14, 0.14, 0.2), base + axis * 0.1, 'engine_dark', rot=tilt)
    for k in range(4):
        mb.box((0.22 - k * 0.006, 0.2 - k * 0.006, 0.014), base + axis * (0.03 + k * 0.045), 'engine', rot=tilt)
    head_c = base + axis * 0.22
    mb.box((0.2, 0.18, 0.06), head_c, 'engine', rot=tilt)
    mb.box((0.15, 0.13, 0.035), head_c + axis * 0.045, 'red', rot=tilt)
    carb = Vector((0, -0.06, 0.55))
    mb.tube(head_c + Vector((0, -0.08, -0.02)), carb, 0.028, 'steel', 6)
    filt = mb.cyl(0.07, 0.07, 0.12, 9, carb + Vector((-0.08, -0.05, -0.02)), 'tape', rot=(0, 1.2, 0.5))
    mb.jitter(filt, rng, 0.006)
    mb.sweep([head_c + axis * 0.06 + Vector((0, -0.06, 0.02)), Vector((-0.09, -0.02, 0.62)), Vector((-0.11, -0.1, 0.62))],
             0.006, 'red', segs=4)
    # Chain on the left, back to the axle's sprocket.
    for (y0, z0), (y1, z1) in (((0.0, 0.37), (REAR_Y, REAR['r'] + 0.1)), ((0.0, 0.27), (REAR_Y, REAR['r'] - 0.1))):
        mb.tube(Vector((-0.16, y0, z0)), Vector((-0.16, y1, z1)), 0.009, 'grip', 4)

    # Exhaust: out of the head, round the right side under the seat, back to a dented can under the rear rack.
    port = head_c + Vector((0.03, 0.08, -0.02))
    mb.sweep([port, port + Vector((0.08, 0.04, -0.03)), Vector((0.17, 0.08, 0.5)), Vector((0.18, -0.2, 0.6)),
              Vector((0.2, -0.48, 0.66))], 0.028, 'exhaust', segs=7)
    muf_a, muf_b = Vector((0.2, -0.46, 0.67)), Vector((0.22, -0.86, 0.7))
    muffler = mb.tube(muf_a, muf_b, 0.068, 'steel', 9, r2=0.06)
    mb.dent(muffler, muf_a.lerp(muf_b, 0.4) + Vector((0.06, 0, 0.03)), 0.09, 0.02)
    mb.tube(muf_b, muf_b + (muf_b - muf_a).normalized() * 0.06, 0.028, 'rust_dark', 7)
    for t in (0.2, 0.8):
        mb.tube(muf_a.lerp(muf_b, t - 0.02), muf_a.lerp(muf_b, t + 0.02), 0.073, 'rust_dark', 9)

    # Fuel tank: the bike's faded teal, a squat box over the frame between the seat and the bars; patch plates, rivets.
    ty0, ty1 = TANK_Y
    tank = mb.box((0.32, ty1 - ty0, 0.2), (0, (ty0 + ty1) / 2, 0.78), 'teal', rot=(-0.08, 0, 0), taper=(0.8, 0.8))
    mb.dent(tank, (0.16, 0.2, 0.78), 0.1, 0.02)
    mb.jitter(tank, rng, 0.004)
    mb.box((0.34, 0.1, 0.06), (0, ty1 - 0.02, 0.69), 'teal_dark')
    mb.box((0.015, 0.12, 0.09), (-0.15, 0.2, 0.77), 'rust', rot=(0.1, 0.15, 0.2))
    for p in ((-0.16, 0.15, 0.73), (-0.16, 0.25, 0.8), (0.155, 0.12, 0.76)):
        mb.box((0.012, 0.015, 0.015), p, 'steel')
    mb.cyl(0.04, 0.035, 0.03, 8, (0, 0.25, 0.89), 'steel')

    # Seat: one long flat slab, wide enough to slide about on; taped where it split, a strap across the back.
    sy0, sy1 = SEAT_Y
    seat = mb.box((SEAT_W, sy1 - sy0, 0.12), (0, (sy0 + sy1) / 2, SEAT_TOP - 0.06), 'seat', taper=(0.9, 0.98))
    mb.jitter(seat, rng, 0.004)
    mb.box((SEAT_W + 0.006, 0.07, 0.122), (0, -0.36, SEAT_TOP - 0.06), 'tape', rot=(0, 0, 0.05))
    mb.box((0.12, 0.05, 0.122), (-0.06, -0.1, SEAT_TOP - 0.056), 'tape', rot=(0, 0, 0.5))
    mb.box((SEAT_W + 0.02, 0.035, 0.13), (0, -0.66, SEAT_TOP - 0.06), 'red')
    mb.box((SEAT_W * 0.8, 0.1, 0.06), (0, sy1 + 0.01, SEAT_TOP - 0.1), 'seat', rot=(-0.5, 0, 0))   # nose onto the tank

    # Footboards: dark steel plates with weld-bead treads, rising at the front up a toe ramp under the front fender
    # and at the back up a heel guard to the rear fender; an outer lip on each.
    bx0, bx1 = BOARD_X
    for sx in (-1, 1):
        cx, w = sx * (bx0 + bx1) / 2, bx1 - bx0
        by0, by1 = BOARD_Y
        mb.box((w, by1 - by0, 0.02), (cx, (by0 + by1) / 2, BOARD_Z - 0.01), 'frame')
        mid = ramp_point(RAMP_LEN / 2, cx) - Vector((0, -math.sin(RAMP), math.cos(RAMP))) * 0.01
        mb.box((w, RAMP_LEN, 0.02), mid, 'frame', rot=(RAMP, 0, 0))
        for k in range(4):                                            # treads on the flat
            mb.box((w * 0.8, 0.012, 0.008), (cx, by0 + 0.04 + k * 0.065, BOARD_Z + 0.004), 'steel')
        for k in range(3):                                            # ...and up the ramp
            mb.box((w * 0.8, 0.012, 0.008), ramp_point(0.07 + k * 0.1, cx) + Vector((0, 0, 0.004)), 'steel',
                   rot=(RAMP, 0, 0))
        heel = mb.box((w, 0.02, 0.18), (cx, by0 - 0.01, BOARD_Z + 0.08), 'frame', rot=(-0.25, 0, 0))
        mb.jitter(heel, rng, 0.003)
        lip_x = sx * (bx1 + 0.005)
        mb.sweep([Vector((lip_x, by0, BOARD_Z + 0.015)), Vector((lip_x, by1, BOARD_Z + 0.015)),
                  ramp_point(RAMP_LEN, lip_x) + Vector((0, 0, 0.015))], 0.012, 'rust_dark', segs=4)
        for y in (by0 + 0.05, by1 - 0.02):                            # brackets to the lower rail
            mb.tube(Vector((sx * 0.13, y, 0.22)), Vector((sx * bx1, y, BOARD_Z - 0.02)), 0.012, 'frame', 5)
    mb.box((0.012, 0.12, 0.09), (bx1 + 0.012, -0.16, BOARD_Z + 0.03), 'rust', rot=(0, 0.3, 0.1))  # patch, right

    # Fenders: mismatched plastic over the front (cream left, teal right), rusty sheet over the back (rust, orange).
    for sx, mat in ((-1, 'cream'), (1, 'teal_dark')):
        c = Vector((0, FRONT_Y, FRONT['r']))
        f = mb.arc_band(c, FRONT['r'] + 0.04, FRONT['r'] + 0.055, FRONT['w'] + 0.14, 15, 168, 8, mat, x=sx * TRACK_X)
        mb.dent(f, c + Vector((sx * TRACK_X, 0.15, 0.32)), 0.12, 0.012)
        # The fender's skirt down to the ramp's top, and its inner wall over the A-arms.
        mb.box((FRONT['w'] + 0.1, 0.12, 0.015), ramp_point(RAMP_LEN + 0.02, sx * TRACK_X * 0.82), mat, rot=(RAMP + 0.6, 0, 0))
    mb.box((0.03, 0.1, 0.08), (-TRACK_X, FRONT_Y + 0.2, 0.62), 'red', rot=(0.5, 0, 0))           # number roundel
    for sx, mat in ((-1, 'rust'), (1, 'rim')):
        c = Vector((0, REAR_Y, REAR['r']))
        f = mb.arc_band(c, REAR['r'] + 0.04, REAR['r'] + 0.055, REAR['w'] + 0.1, 15, 165, 8, mat, x=sx * TRACK_X)
        mb.dent(f, c + Vector((sx * TRACK_X, -0.2, 0.33)), 0.12, 0.015)
        mb.box((REAR['w'] + 0.04, 0.02, 0.2), (sx * TRACK_X, REAR_Y - REAR['r'] - 0.06, 0.32), 'grip', rot=(0.2, 0, 0))  # mud flap
        mb.tube(Vector((sx * 0.14, -0.4, 0.7)), Vector((sx * TRACK_X, -0.42, REAR['r'] + 0.36)), 0.012, 'frame', 5)  # stay

    # Front rack over the fenders, a rolled tarp strapped on it.
    rz = 0.74
    for sx in (-1, 1):
        mb.tube(Vector((sx * 0.13, 0.62, 0.62)), Vector((sx * 0.38, 0.5, rz)), 0.013, 'steel', 5)
        mb.tube(Vector((sx * 0.38, 0.5, rz)), Vector((sx * 0.38, 0.9, rz)), 0.013, 'steel', 5)
        mb.tube(Vector((sx * 0.38, 0.9, rz)), Vector((sx * 0.2, 0.96, 0.6)), 0.012, 'steel', 5)
    for y in (0.5, 0.7, 0.9):
        mb.tube(Vector((-0.38, y, rz)), Vector((0.38, y, rz)), 0.011, 'steel', 5)
    roll = mb.cyl(0.09, 0.09, 0.62, 10, (0, 0.72, rz + 0.1), 'olive', rot=Y90)
    mb.jitter(roll, rng, 0.008)
    for x in (-0.18, 0.18):
        mb.cyl(0.095, 0.095, 0.035, 10, (x, 0.72, rz + 0.1), 'red', rot=Y90)

    # Rear rack with a jerry can and a coil of rope; tail light; a tow ball under it.
    rz, ry0, ry1 = 0.8, -0.6, -0.98
    for sx in (-1, 1):
        mb.tube(Vector((sx * 0.15, -0.9, 0.72)), Vector((sx * 0.38, ry1, rz)), 0.013, 'steel', 5)
        mb.tube(Vector((sx * 0.38, ry0, rz)), Vector((sx * 0.38, ry1, rz)), 0.013, 'steel', 5)
        mb.tube(Vector((sx * 0.38, ry0, rz)), Vector((sx * 0.15, -0.5, 0.72)), 0.012, 'steel', 5)
    for y in (ry0, -0.79, ry1):
        mb.tube(Vector((-0.38, y, rz)), Vector((0.38, y, rz)), 0.011, 'steel', 5)
    can_c = Vector((0.12, -0.9, rz + 0.13))  # at the back of the rack: a passenger's back is in front of it
    can = mb.box((0.17, 0.3, 0.24), can_c, 'olive', rot=(0, 0, 0.08))
    mb.dent(can, can_c + Vector((0.09, 0.05, 0.03)), 0.08, 0.015)
    mb.box((0.06, 0.04, 0.05), can_c + Vector((0, 0.12, 0.13)), 'olive')
    mb.box((0.04, 0.12, 0.03), can_c + Vector((0, 0.0, 0.135)), 'olive')
    for dy in (0.07, -0.08):
        mb.box((0.19, 0.035, 0.26), can_c + Vector((0, dy, -0.005)), 'red', rot=(0, 0, 0.08))
    for k in range(3):                                                # a coil of rope
        r, z = 0.1 - k * 0.01, rz + 0.03 + k * 0.035
        mb.sweep([Vector((-0.2 + math.cos(a) * r, -0.86 + math.sin(a) * r, z + 0.01 * math.sin(3 * a)))
                  for a in (2 * math.pi * i / 12 for i in range(13))], 0.018, 'tape', segs=5)
    mb.box((0.12, 0.04, 0.05), (0, -1.0, 0.7), 'tail', rot=(0.4, 0, 0))
    # The tow ball where the cart's coupler hangs (shared/cart.ts HITCH_BACK, HITCH_Y), on a tongue off the frame.
    mb.tube(Vector((0, -0.9, 0.7)), Vector((0, -1.1, 0.5)), 0.022, 'steel', 6)
    mb.tube(Vector((0, -0.62, 0.42)), Vector((0, -1.1, 0.5)), 0.02, 'steel', 6)
    mb.cyl(0.045, 0.045, 0.07, 8, (0, -1.15, 0.54), 'steel')

    # A passenger's grab handles: a bent loop either side of the back of the seat (src/quad.ts PILLION_GRIP).
    for sx in (-1, 1):
        mb.sweep([Vector((sx * 0.15, -0.32, 0.7)), Vector((sx * 0.24, -0.37, 0.84)), Vector((sx * 0.24, -0.57, 0.84)),
                  Vector((sx * 0.15, -0.62, 0.7))], 0.014, 'steel', segs=5)
        mb.tube(Vector((sx * 0.24, -0.41, 0.84)), Vector((sx * 0.24, -0.53, 0.84)), 0.022, 'grip', 7)


# ------------------------------------------------------------------------------------------------ build

def build():
    root = bpy.data.objects.new('Quadbike', None)
    bpy.context.scene.collection.objects.link(root)

    mb = MeshBuilder()
    build_body(mb, Rng(31))
    body = make('Body', mb, (0, 0, 0), root)

    mb = MeshBuilder()
    rear_axle = Vector((0, REAR_Y, REAR['r']))
    mb.tube(rear_axle - Vector((TRACK_X, 0, 0)), rear_axle + Vector((TRACK_X, 0, 0)), 0.024, 'steel', 6)
    mb.cyl(0.1, 0.1, 0.015, 12, rear_axle + Vector((-0.16, 0, 0)), 'steel', rot=Y90)        # sprocket
    mb.cyl(0.11, 0.11, 0.008, 14, rear_axle + Vector((0.27, 0, 0)), 'hub', rot=Y90)          # brake disc
    for sx, seed in ((-1, 41), (1, 43)):
        build_wheel(mb, rear_axle + Vector((sx * TRACK_X, 0, 0)), REAR, 14, Rng(seed), False, sx)
    rear = make('RearAxle', mb, rear_axle, root)

    objs = [body, rear]
    for sx, n, seed in ((-1, 'L', 47), (1, 'R', 53)):
        mb = MeshBuilder()
        build_knuckle(mb, sx)
        knuckle = make(f'SteerF{n}', mb, (sx * KING_X, FRONT_Y, FRONT['r']), root)
        mb = MeshBuilder()
        build_wheel(mb, Vector((sx * TRACK_X, FRONT_Y, FRONT['r'])), FRONT, 12, Rng(seed), True, sx)
        wheel = make(f'WheelF{n}', mb, (sx * TRACK_X, FRONT_Y, FRONT['r']), knuckle)
        objs += [knuckle, wheel]

    mb = MeshBuilder()
    grips, lamp = build_handlebar(mb, Rng(59))
    bars = make('Handlebar', mb, PIVOT, root)
    objs.append(bars)
    return root, objs, grips, lamp


def make(name, mb, origin, parent):
    return sb.make_object(name, mb, origin, parent)


def three(v):
    """Blender (x, y, z) -> three.js (x, z, -y)."""
    return f'({v.x:.3f}, {v.z:.3f}, {-v.y:.3f})'


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(sb.ROOT, 'public', 'models', 'quadbike.glb'))
    ap.add_argument('--preview', default=None, help='render PNG previews (3/4, side, rear 3/4)')
    args = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name, spec in sb.MATERIALS.items():
        sb.make_material(name, *spec)

    root, objs, grips, lamp = build()
    bpy.context.view_layer.update()
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    sb.export_glb([root] + objs, args.out)
    total = 0
    for o in objs:
        t = sb.tri_count(o)
        total += t
        w = o.matrix_world.translation
        print(f'{o.name}: tris={t} origin(blender)=({w.x:.3f}, {w.y:.3f}, {w.z:.3f})')
    lo = [min((o.matrix_world @ v.co)[i] for o in objs for v in o.data.vertices) for i in range(3)]
    hi = [max((o.matrix_world @ v.co)[i] for o in objs for v in o.data.vertices) for i in range(3)]
    print(f'total tris={total} bounds x {lo[0]:.3f}..{hi[0]:.3f} y {lo[1]:.3f}..{hi[1]:.3f} z {lo[2]:.3f}..{hi[2]:.3f}')
    # For src/quad.ts (three.js coordinates).
    print(f'three: steer axis {three(STEER_AXIS)} pivot {three(PIVOT)} right grip (Handlebar frame) {three(grips[1] - PIVOT)}')
    print(f'three: lamp (Handlebar frame) {three(lamp - PIVOT)}')
    heel = Vector((0.3, BOARD_Y[1], BOARD_Z)) + Vector((0, math.sin(RAMP), math.cos(RAMP))) * 0  # ramp foot
    up = Vector((0, -math.sin(RAMP), math.cos(RAMP)))  # the ramp's normal
    print(f'three: ankle at the ramp foot {three(heel + up * ANKLE)} up the ramp {three(Vector((0, math.cos(RAMP), math.sin(RAMP))))}')

    if args.preview:
        sb.render_preview(os.path.abspath(args.preview))


main()
