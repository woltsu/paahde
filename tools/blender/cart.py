"""The cart (docs/cart.md): a two-wheeled scrap trailer towed behind the sand bike, that unfolds into a camp.

    tools/blender/run.sh -b --python tools/blender/cart.py                        # writes public/models/cart.glb
    tools/blender/run.sh -b --python tools/blender/cart.py -- --preview out.png   # also out_packed*.png, out_open*.png

Exported in the PACKED pose: the sides upright as the cart's walls, the canopy poles flat along the bed, the lid shut,
the stand up, the corner legs up. Every node's rotation is identity and scale 1 in that pose, so code unfolds a node by
setting its rotation (or, for `legs`, its position) to the table below times t ∈ [0, 1].

Game coordinates (three.js, as the glb loads): metres, +Y up, forward (towards the tongue) −Z as the bike's, the right
side +X. The origin is on the ground under the middle of the axle. 1.46 m over the tyres (1.52 over the hub nuts, 1.64
over everything packed), a 2.2 m bed (z −1.1 .. 1.1, its deck at DECK = 0.88 m), the tongue reaching 1.3 m ahead of it:
z −2.42 .. 1.22 overall, 1.71 m tall packed. The pivots below are cart coordinates (a child's glTF translation is
relative to its parent, whose rotation is identity packed).

Nodes (all children of the root `cart`, except where nested), each with its origin at its hinge pivot (cart coordinates):

    node        pivot (x, y, z)            axis   unfolded                  notes
    body        (0, 0, 0)                  -      -                         bed, frame, axle, the box, hinge brackets
    wheel_l     (-0.60, 0.36, 0)           X      spun by code              rolling forward is rotation.x -= d / 0.36
    wheel_r     (0.60, 0.36, 0)            X      spun by code
    tongue      (0, 0.79, -1.1)            X      - (fixed)                 A-frame to the coupler
      coupler   (0, 0.54, -2.40)  empty           -                         the tip: where the bike's hitch holds it
      stand     (0, 0.50, -2.0)            X      rotation.x = +90°         jack: packed lying back (+Z) under the
                                                                            tongue, down it stands on its foot plate
    lid         (0, 1.32, -0.76)           X      rotation.x = -100°        hinged on the box's front edge (towards the
                                                                            tongue), opens upwards from the rear
    pole_a      (-0.56, 0.93, -0.98)       X      rotation.x = -90°         front left; packed lying back (+Z) along
      pole_a_tip  packed (-0.56, 0.93, 0.82), unfolded (-0.56, 2.73, -0.98)  the bed's left edge
    pole_b      (0.56, 0.93, 0.98)         X      rotation.x = +90°         rear right; packed lying forward (-Z)
      pole_b_tip  packed (0.56, 0.93, -0.82), unfolded (0.56, 2.73, 0.98)
    side_l      (-0.68, 0.88, 0)           Z      rotation.z = +90°         workbench on its inner face; folds out
      leg_l     (-0.73, 1.48, 0)           Z      rotation.z = -90°         (relative to side_l) trestle under its
                                                                            outer edge, packed flat on the wall's
                                                                            outside, hanging down from its top
    side_r      (0.68, 0.88, 0)            Z      rotation.z = -90°         dismantling table on its inner face
      leg_r     (0.73, 1.48, 0)            Z      rotation.z = +90°         (relative to side_r)
    legs        (0, 0, 0)                  -      position.y = -0.46        the four corner stabilisers (x ±0.50, z ±1.145,
                                                                            on the end boards' outsides) slide down out
                                                                            of their sleeves until their feet touch the
                                                                            ground (a slide, not a turn)

Unfolded, both benches lie level with the deck: their tops at y = 0.88, reaching from |x| = 0.68 to 1.33 (0.65 m deep)
over z −1.08 .. 1.08, held at their outer edge by the trestle legs (feet on the ground at |x| ≈ 1.30, z ±0.98).
The canopy's poles stand 1.8 m over their hinges, tips at 2.73 m on the bed's diagonal (front left, rear right).

Materials are the stationkit ones (tools/blender/stationkit.py) and the bike's tyre/rim colours (tools/blender/
sandbike.py); src/world/glbMaterial.ts turns them into node materials. Output is deterministic.
"""

import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import stationkit as kit  # noqa: E402  (its builders and materials; runs nothing on import)

G = kit.G
ROOT = kit.ROOT

# ---------------------------------------------------------------------------------------------------- layout
WHEEL_R = 0.36           # overall radius, knobs included (= axle height)
CARCASS_R = 0.325
RIM_R = 0.15
TYRE_W = 0.26
WHEEL_X = 0.60           # wheel centres; outer faces at ±0.73
DECK = 0.88              # the deck's top (and the unfolded benches' tops)
HX, HZ = 0.68, 1.1       # the bed's half width and half length
SIDE_H, SIDE_T, SIDE_Z = 0.65, 0.05, 1.08  # the side panels: height (= unfolded depth), thickness, half length
LEG_L = DECK - SIDE_T    # trestle legs: from the folded bench's underside to the ground
LEGS_DROP = 0.46         # the corner stabilisers' travel (packed, their feet hang this high)
STAB_X, STAB_Z = 0.50, HZ + 0.045  # the stabilisers, on the outside of the end boards
BOX_X, BOX_Z0, BOX_Z1, BOX_TOP = 0.42, -0.75, 0.50, 1.30
LID_PIVOT = (0, 1.32, BOX_Z0 - 0.01)
POLE_X, POLE_Y, POLE_Z, POLE_L = 0.56, 0.93, 0.98, 1.8
TONGUE_PIVOT = (0, 0.79, -HZ)
COUPLER = (0, 0.54, -HZ - 1.3)
STAND_PIVOT = (0, 0.50, -2.0)

UNFOLD = {  # node: (game axis, degrees) — or ('ty', metres) for a slide
    'stand': ('x', 90), 'lid': ('x', -100), 'pole_a': ('x', -90), 'pole_b': ('x', 90),
    'side_l': ('z', 90), 'leg_l': ('z', -90), 'side_r': ('z', -90), 'leg_r': ('z', 90),
    'legs': ('ty', -LEGS_DROP),
}

EXTRA_MATERIALS = {  # name: (sRGB hex, roughness, metallic), the bike's colours
    'Tyre': (0x2b2420, 0.95, 0.0),
    'TyreSide': (0x3a302a, 0.95, 0.0),
    'Rim': (0xc0782e, 0.6, 0.3),
    'Teal': (0x3f8a84, 0.7, 0.15),
    'Cream': (0xd8c49a, 0.8, 0.05),
}


def make_extra_materials():
    for name, (hx, rough, metal) in EXTRA_MATERIALS.items():
        m = bpy.data.materials.new(name)
        rgb = kit.hex_rgb(hx)
        m.diffuse_color = (*rgb, 1)
        m.use_nodes = True
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = (*rgb, 1)
        b.inputs['Roughness'].default_value = rough
        b.inputs['Metallic'].default_value = metal
        m.use_backface_culling = True


def game_rot(axis, deg):
    """Rotation about a game axis (three.js convention), as a Blender matrix (G is a proper rotation)."""
    a = math.radians(deg)
    if axis == 'x':
        return Matrix.Rotation(a, 4, 'X')
    if axis == 'z':
        return Matrix.Rotation(-a, 4, 'Y')  # game +Z = Blender -Y
    return Matrix.Rotation(a, 4, 'Z')


def unfold_matrix(name, pivot):
    """The node's unfolded transform about its pivot (game coordinates), in Blender world space."""
    axis, v = UNFOLD[name]
    if axis == 'ty':
        return Matrix.Translation(G(0, v, 0))
    p = G(*pivot)
    return Matrix.Translation(p) @ game_rot(axis, v) @ Matrix.Translation(-p)


# ---------------------------------------------------------------------------------------------- mesh helpers

def rbox(mb, c, size, ang, mat):
    """Box centred on game point c, size (sx, sy, sz), turned `ang` about the game X axis (knobs on a wheel)."""
    sx, sy, sz = size
    ca, sa = math.cos(ang), math.sin(ang)
    pts = []
    for dy, dz in ((-sy / 2, -sz / 2), (sy / 2, -sz / 2), (sy / 2, sz / 2), (-sy / 2, sz / 2)):
        pts.append((c[0] - sx / 2, c[1] + dy * ca - dz * sa, c[2] + dy * sa + dz * ca))
    mb.prism(pts, (sx, 0, 0), mat)


def lathe_x(mb, profile, segs, c, mat):
    """Closed (axial offset, radius) profile revolved about the game X axis through c."""
    rings = []
    for i in range(segs):
        a = 2 * math.pi * (i + 0.5) / segs
        rings.append([mb.bm.verts.new(G(c[0] + x, c[1] + math.cos(a) * r, c[2] + math.sin(a) * r)) for x, r in profile])
    idx = mb.mi(mat)
    n = len(profile)
    for i in range(segs):
        r0, r1 = rings[i], rings[(i + 1) % segs]
        for k in range(n):
            j = (k + 1) % n
            f = mb.bm.faces.new([r0[k], r1[k], r1[j], r0[j]])
            f.material_index = idx


def bx(mb, xa, xb, y0, y1, z0, z1, mat):
    mb.box(min(xa, xb), max(xa, xb), y0, y1, z0, z1, mat)


def node(name, mb, pivot, parent, chain=()):
    """Object `name` from builder mb, origin at the game point `pivot` (packed). Geometry built in the unfolded pose is
    folded back first: `chain` is [(node name, its packed pivot), ...] from the outermost hinge in."""
    obj = mb.build(name)
    if chain:
        m = Matrix.Identity(4)
        for n, p in chain:
            m = m @ unfold_matrix(n, p)
        obj.data.transform(m.inverted())
    p = G(*pivot)
    obj.data.transform(Matrix.Translation(-p))
    obj.parent = parent
    obj.location = p - (parent.matrix_world.translation if parent else Vector())
    bpy.context.view_layer.update()
    return obj


def empty(name, pos, parent):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.08
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = G(*pos) - parent.matrix_world.translation
    bpy.context.view_layer.update()
    return e


# ---------------------------------------------------------------------------------------------------- wheels

def build_wheel(sx):
    """Balloon tyre with chunky staggered knobs, an orange rim drum and a hub (the bike's front tyre, a bit fatter)."""
    mb = kit.MB()
    c = (sx * WHEEL_X, WHEEL_R, 0)
    h = TYRE_W / 2
    profile = [(-h * 0.72, RIM_R + 0.01), (-h, RIM_R + 0.06), (-h * 0.9, CARCASS_R - 0.03), (-h * 0.45, CARCASS_R),
               (h * 0.45, CARCASS_R), (h * 0.9, CARCASS_R - 0.03), (h, RIM_R + 0.06), (h * 0.72, RIM_R + 0.01)]
    lathe_x(mb, profile, 16, c, 'Tyre')
    depth = WHEEL_R - CARCASS_R + 0.012
    for i in range(14):
        a = 2 * math.pi * i / 14
        r = CARCASS_R + depth / 2 - 0.012
        for off in ((-0.5, 0.5) if i % 2 == 0 else (0.0,)):
            p = (c[0] + off * TYRE_W * 0.62, c[1] + math.cos(a) * r, c[2] + math.sin(a) * r)
            rbox(mb, p, (TYRE_W * 0.34, depth, 0.075), a, 'TyreSide')
    mb.cyl((c[0] - h * 0.74, c[1], 0), (c[0] + h * 0.74, c[1], 0), RIM_R + 0.012, 'Rim', seg=14)
    out = c[0] + sx * (h * 0.74)
    mb.cyl((out, c[1], 0), (out + sx * 0.05, c[1], 0), 0.07, 'Steel', r1=0.055, seg=8)
    for k in range(5):  # wheel nuts
        a = 2 * math.pi * k / 5
        y, z = c[1] + math.cos(a) * 0.045, math.sin(a) * 0.045
        mb.cyl((out + sx * 0.05, y, z), (out + sx * 0.065, y, z), 0.01, 'Iron', seg=6)
    bx(mb, out, out + sx * 0.012, c[1] - 0.12, c[1] - 0.04, 0.03, 0.14, 'Rust')  # a patched rim section
    return mb


# ------------------------------------------------------------------------------------------------------ body

def build_body():
    mb = kit.MB()
    # Deck: patched plates over the frame, flush with the benches when they're down.
    plates = ((-HZ, -0.35, 'Steel'), (-0.35, 0.3, 'Rust'), (0.3, HZ, 'Steel'))
    for z0, z1, mat in plates:
        bx(mb, -HX, HX, DECK - 0.04, DECK, z0, z1, mat)
    bx(mb, -0.3, 0.05, DECK, DECK + 0.006, 0.82, 1.02, 'Cream')  # a patch plate at the rear
    # Frame: two rails, cross members, an edge band round the deck.
    for sx in (-1, 1):
        bx(mb, sx * 0.36, sx * 0.44, 0.74, DECK - 0.04, -HZ, HZ, 'Iron')
        bx(mb, sx * (HX - 0.03), sx * HX, DECK - 0.1, DECK - 0.04, -HZ, HZ, 'Iron')
    for z in (-HZ + 0.03, -0.55, 0.0, 0.55, HZ - 0.03):
        bx(mb, -HX + 0.03, HX - 0.03, 0.77, DECK - 0.04, z - 0.03, z + 0.03, 'Iron')
    # Axle, leaf springs and their shackles.
    mb.cyl((-WHEEL_X + 0.06, WHEEL_R, 0), (WHEEL_X - 0.06, WHEEL_R, 0), 0.035, 'Iron', seg=8)
    for sx in (-1, 1):
        x = sx * 0.40
        mb.beam((x, 0.71, -0.45), (x, 0.62, 0.0), 0.05, 'Steel')
        mb.beam((x, 0.62, 0.0), (x, 0.71, 0.45), 0.05, 'Steel')
        mb.beam((x, 0.66, -0.3), (x, 0.6, 0.0), 0.04, 'Iron')
        mb.beam((x, 0.6, 0.0), (x, 0.66, 0.3), 0.04, 'Iron')
        bx(mb, x - 0.035, x + 0.035, WHEEL_R - 0.05, 0.62, -0.05, 0.05, 'Iron')  # saddle on the axle
        for z in (-0.45, 0.45):
            bx(mb, x - 0.03, x + 0.03, 0.68, 0.76, z - 0.03, z + 0.03, 'Iron')
    # The stabilisers' sleeves at the corners (the posts are `legs`).
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = sx * STAB_X, sz * STAB_Z
            bx(mb, x - 0.042, x + 0.042, 0.42, DECK + 0.06, z - 0.042, z + 0.042, 'Iron')
            bx(mb, x - 0.03, x + 0.03, 0.74, 0.8, min(z, sz * HZ), max(z, sz * HZ), 'Iron')  # bolted to the frame
            bx(mb, x - 0.046, x + 0.046, 0.42, 0.46, z - 0.046, z + 0.046, 'Steel')  # collar
    # End boards: a taller one at the front, a low tailgate with a hazard plate and reflectors.
    bx(mb, -HX, HX, DECK, DECK + 0.30, -HZ, -HZ + 0.04, 'Rust')
    bx(mb, -HX, HX, DECK + 0.26, DECK + 0.30, -HZ - 0.01, -HZ + 0.05, 'Iron')
    bx(mb, -HX, HX, DECK, DECK + 0.18, HZ - 0.04, HZ, 'Steel')
    bx(mb, -HX, HX, DECK + 0.14, DECK + 0.18, HZ - 0.05, HZ + 0.01, 'Iron')
    for k in range(6):
        x = -0.3 + k * 0.12
        bx(mb, x - 0.03, x + 0.03, DECK + 0.03, DECK + 0.12, HZ, HZ + 0.008, 'Hazard' if k % 2 == 0 else 'Iron')
    for sx in (-1, 1):
        mb.cyl((sx * 0.62, DECK - 0.07, HZ), (sx * 0.62, DECK - 0.07, HZ + 0.02), 0.035, 'Rim', seg=8)
    # The box: teal steel walls with iron corners, a dark floor inside, on the deck.
    t = 0.035
    y0, y1 = DECK, BOX_TOP
    bx(mb, -BOX_X, BOX_X, y0, y1, BOX_Z0, BOX_Z0 + t, 'Teal')
    bx(mb, -BOX_X, BOX_X, y0, y1, BOX_Z1 - t, BOX_Z1, 'Teal')
    for sx in (-1, 1):
        bx(mb, sx * BOX_X, sx * (BOX_X - t), y0, y1, BOX_Z0 + t, BOX_Z1 - t, 'Teal')
    bx(mb, -BOX_X + t, BOX_X - t, y0, y0 + 0.1, BOX_Z0 + t, BOX_Z1 - t, 'WoodDark')
    for sx in (-1, 1):
        for z in (BOX_Z0, BOX_Z1):
            zi = z + (0.06 if z < 0 else -0.06)
            bx(mb, sx * (BOX_X + 0.008), sx * (BOX_X - 0.06), y0, y1 - 0.01, min(z, zi) - 0.008, max(z, zi) + 0.008,
               'Iron')
        bx(mb, sx * (BOX_X + 0.006), sx * (BOX_X - 0.01), y0 + 0.16, y0 + 0.22, BOX_Z0 + 0.06, BOX_Z1 - 0.06, 'Iron')
    bx(mb, -0.22, 0.12, y0 + 0.12, y0 + 0.3, BOX_Z1, BOX_Z1 + 0.006, 'Rust')  # dent patch on the back
    # Strap rails the poles' hinges sit on, and the hinge brackets.
    for sx, sz in ((-1, -1), (1, 1)):
        x, z = sx * POLE_X, sz * POLE_Z
        for dx in (-0.045, 0.035):
            bx(mb, x + dx, x + dx + 0.012, DECK, POLE_Y + 0.035, z - 0.04, z + 0.04, 'Iron')
        mb.cyl((x - 0.05, POLE_Y, z), (x + 0.05, POLE_Y, z), 0.012, 'Steel', seg=6)
    # Rests the folded poles lie in, near their tips.
    for sx, z in ((-1, 0.62), (1, -0.62)):
        x = sx * POLE_X
        bx(mb, x - 0.05, x - 0.035, DECK, POLE_Y, z - 0.03, z + 0.03, 'Iron')
        bx(mb, x + 0.035, x + 0.05, DECK, POLE_Y, z - 0.03, z + 0.03, 'Iron')
    # The sides' hinge knuckles on the deck's edges (the others are on the sides).
    for sx in (-1, 1):
        for k in range(0, 10, 2):
            z = -1.0 + 0.2 * k
            mb.cyl((sx * HX, DECK, z), (sx * HX, DECK, z + 0.18), 0.022, 'Steel', seg=8)
    # The lid's hinge knuckles.
    for x in (-0.36, 0.24):
        mb.cyl((x, LID_PIVOT[1], LID_PIVOT[2]), (x + 0.12, LID_PIVOT[1], LID_PIVOT[2]), 0.018, 'Steel', seg=6)
    return mb


def build_legs():
    """The four corner stabilisers' posts and feet (slid up into their sleeves, packed)."""
    mb = kit.MB()
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = sx * STAB_X, sz * STAB_Z
            bx(mb, x - 0.028, x + 0.028, LEGS_DROP, DECK + 0.12, z - 0.028, z + 0.028, 'Steel')
            bx(mb, x - 0.07, x + 0.07, LEGS_DROP, LEGS_DROP + 0.025, z - 0.07, z + 0.07, 'Iron')  # foot
            bx(mb, x - 0.036, x + 0.036, DECK + 0.12, DECK + 0.15, z - 0.036, z + 0.036, 'Iron')  # cap
            mb.cyl((x, DECK + 0.15, z), (x, DECK + 0.19, z), 0.012, 'Steel', seg=6)  # crank
            mb.cyl((x, DECK + 0.19, z), (x + sx * 0.09, DECK + 0.19, z), 0.012, 'Hazard', seg=6)
    return mb


def build_lid():
    mb = kit.MB()
    z0, z1 = BOX_Z0 - 0.02, BOX_Z1 + 0.02
    bx(mb, -BOX_X - 0.02, BOX_X + 0.02, BOX_TOP, BOX_TOP + 0.05, z0, z1, 'Teal')
    for x in (-0.25, 0.25):
        bx(mb, x - 0.035, x + 0.035, BOX_TOP + 0.05, BOX_TOP + 0.06, z0 + 0.02, z1, 'Iron')  # bands
    bx(mb, -0.12, 0.16, BOX_TOP + 0.05, BOX_TOP + 0.056, -0.1, 0.2, 'Rust')  # patch
    for x in (-0.24, 0.12):  # its knuckles between the body's
        mb.cyl((x, LID_PIVOT[1], LID_PIVOT[2]), (x + 0.12, LID_PIVOT[1], LID_PIVOT[2]), 0.018, 'Steel', seg=6)
    # Handle and hasp on the rear edge.
    bx(mb, -0.14, 0.14, BOX_TOP + 0.01, BOX_TOP + 0.04, z1, z1 + 0.04, 'Iron')
    bx(mb, -0.04, 0.04, BOX_TOP - 0.1, BOX_TOP + 0.03, z1, z1 + 0.015, 'Hazard')
    return mb


def build_pole(sx, sz):
    """A scavenged pipe in two lengths with a sleeve over the joint, lying from its hinge along the bed."""
    mb = kit.MB()
    x, z0 = sx * POLE_X, sz * POLE_Z
    z1 = z0 - sz * POLE_L
    zj = z0 - sz * POLE_L * 0.55
    mb.cyl((x, POLE_Y, z0 + sz * 0.025), (x, POLE_Y, zj), 0.026, 'Steel', seg=8)
    mb.cyl((x, POLE_Y, zj), (x, POLE_Y, z1), 0.022, 'Iron', seg=8)
    mb.cyl((x, POLE_Y, zj + sz * 0.07), (x, POLE_Y, zj - sz * 0.07), 0.032, 'Rust', seg=8)
    mb.cyl((x, POLE_Y, z1 + sz * 0.04), (x, POLE_Y, z1 - sz * 0.01), 0.03, 'Hazard', seg=8)  # cap at the tip
    # Hinge eye at the foot.
    mb.cyl((x - 0.03, POLE_Y, z0), (x + 0.03, POLE_Y, z0), 0.03, 'Iron', seg=8)
    return mb


def build_tongue():
    mb = kit.MB()
    tip = (0, 0.55, -2.2)
    for sx in (-1, 1):
        mb.beam((sx * 0.40, 0.79, -HZ + 0.02), (sx * 0.04, tip[1], tip[2]), 0.06, 'Iron')
    def bar_at(z):  # the A-frame bars' x and y at z
        f = (z - (-HZ + 0.02)) / (tip[2] - (-HZ + 0.02))
        return 0.40 + (0.04 - 0.40) * f, 0.79 + (tip[1] - 0.79) * f
    for z in (-1.45, -1.9):
        x, y = bar_at(z)
        bx(mb, -x, x, y - 0.025, y + 0.025, z - 0.025, z + 0.025, 'Iron')
    # Coupler head and its eye at the tip.
    bx(mb, -0.055, 0.055, 0.50, 0.58, -2.30, -2.14, 'Steel')
    cz, r = COUPLER[2] + 0.045, 0.045
    pts = [(math.sin(2 * math.pi * k / 8) * r, cz + math.cos(2 * math.pi * k / 8) * r) for k in range(8)]
    for k in range(8):
        a, b = pts[k], pts[(k + 1) % 8]
        mb.beam((a[0], COUPLER[1], a[1]), (b[0], COUPLER[1], b[1]), 0.026, 'Iron')
    bx(mb, -0.012, 0.012, 0.525, 0.555, -2.32, -2.29, 'Iron')
    # The stand's bracket under the bars.
    x, y = bar_at(STAND_PIVOT[2])
    for sx in (-1, 1):
        bx(mb, sx * 0.032, sx * 0.045, STAND_PIVOT[1] - 0.04, y, STAND_PIVOT[2] - 0.04, STAND_PIVOT[2] + 0.04, 'Iron')
    # A jerry can strapped on the A-frame.
    x, y = bar_at(-1.4)
    bx(mb, -0.1, 0.1, y + 0.02, y + 0.32, -1.52, -1.3, 'PumpPaint')
    bx(mb, -0.03, 0.03, y + 0.32, y + 0.37, -1.36, -1.32, 'Iron')  # spout
    bx(mb, -0.07, 0.03, y + 0.32, y + 0.345, -1.48, -1.4, 'Iron')  # handle
    bx(mb, -0.105, 0.105, y + 0.12, y + 0.15, -1.525, -1.295, 'Rust')  # the strap
    return mb


def build_stand():
    """Built standing (unfolded): a jack post with a crank, on a foot plate."""
    mb = kit.MB()
    x, y, z = STAND_PIVOT
    mb.cyl((0, y + 0.02, z), (0, 0.08, z), 0.03, 'Steel', seg=8)
    mb.cyl((0, 0.22, z), (0, 0.025, z), 0.022, 'Iron', seg=8)
    bx(mb, -0.08, 0.08, 0.0, 0.025, z - 0.08, z + 0.08, 'Iron')
    mb.cyl((-0.03, y, z), (0.03, y, z), 0.028, 'Iron', seg=8)  # eye on the pivot
    mb.cyl((0.03, y - 0.06, z), (0.12, y - 0.06, z), 0.01, 'Steel', seg=6)  # crank
    mb.cyl((0.12, y - 0.06, z), (0.12, y - 0.06, z + 0.07), 0.014, 'Hazard', seg=6)
    return mb


# --------------------------------------------------------------------------------------------- sides & benches

def side_panel(mb, s, top_mats):
    """The side panel in its unfolded pose (horizontal, its top level with the deck) on side s (±1)."""
    x0, x1 = HX, HX + SIDE_H
    yb, yt = DECK - SIDE_T, DECK
    zz = SIDE_Z
    fr = 0.04
    bx(mb, s * x0, s * (x0 + fr), yb, yt, -zz, zz, 'Iron')
    bx(mb, s * (x1 - fr), s * x1, yb, yt, -zz, zz, 'Iron')
    for sz in (-1, 1):
        bx(mb, s * (x0 + fr), s * (x1 - fr), yb, yt, min(sz * zz, sz * (zz - fr)), max(sz * zz, sz * (zz - fr)),
           'Iron')
    # Skin on the underside (the cart's outside, packed): mismatched plates, a couple of patches.
    bx(mb, s * (x0 + fr), s * (x1 - fr), yb, yb + 0.02, -zz + fr, -0.2, 'Rust')
    bx(mb, s * (x0 + fr), s * (x1 - fr), yb, yb + 0.02, -0.2, zz - fr, 'Steel' if s > 0 else 'Rust')
    bx(mb, s * (x0 + 0.12), s * (x0 + 0.42), yb - 0.006, yb, 0.25, 0.62, 'Cream' if s < 0 else 'Rust')
    bx(mb, s * (x0 + 0.3), s * (x0 + 0.55), yb - 0.006, yb, -0.75, -0.45, 'Steel')
    for k in range(5):
        z = -1.0 + 0.2 * (2 * k + 1)
        mb.cyl((s * HX, DECK, z), (s * HX, DECK, z + 0.18), 0.022, 'Steel', seg=8)
    top_mats(mb, s, x0 + fr, x1 - fr, yb + 0.02, yt, zz - fr)


def workbench_top(mb, s, xa, xb, y0, y1, zz):
    """Planks along the panel, tools near the outer edge (packed, they hang high on the wall, clear of the box)."""
    w = (xb - xa) / 3
    for k in range(3):
        bx(mb, s * (xa + k * w), s * (xa + (k + 1) * w - 0.004), y0, y1, -zz, zz, 'Wood' if k != 1 else 'WoodDark')
    top = y1
    xo = HX + SIDE_H  # the outer edge
    # Bench vise bolted on the outer edge, jaws up.
    vz = -0.62
    bx(mb, s * (xo - 0.2), s * (xo + 0.04), top, top + 0.08, vz - 0.09, vz + 0.09, 'Teal')
    bx(mb, s * (xo - 0.2), s * (xo - 0.14), top + 0.08, top + 0.17, vz - 0.09, vz + 0.09, 'Teal')
    bx(mb, s * (xo - 0.04), s * (xo + 0.02), top + 0.08, top + 0.17, vz - 0.09, vz + 0.09, 'Teal')
    mb.cyl((s * (xo + 0.02), top + 0.04, vz), (s * (xo + 0.16), top + 0.04, vz), 0.014, 'Steel', seg=6)
    mb.cyl((s * (xo + 0.16), top + 0.04, vz - 0.09), (s * (xo + 0.16), top + 0.04, vz + 0.09), 0.011, 'Steel', seg=6)
    # A crate of parts, a hammer, a wrench, a coil of wire, a can of bolts.
    bx(mb, s * (xo - 0.33), s * (xo - 0.07), top, top + 0.14, 0.48, 0.86, 'Rust')
    bx(mb, s * (xo - 0.31), s * (xo - 0.09), top + 0.1, top + 0.15, 0.5, 0.84, 'Steel')
    mb.beam((s * (xo - 0.3), top + 0.02, -0.25), (s * (xo - 0.1), top + 0.02, 0.05), 0.03, 'WoodDark')
    bx(mb, s * (xo - 0.12), s * (xo - 0.04), top, top + 0.05, 0.0, 0.12, 'Iron')
    mb.beam((s * (xo - 0.33), top + 0.012, 0.18), (s * (xo - 0.12), top + 0.012, 0.32), 0.024, 'Steel')
    mb.cyl((s * (xo - 0.25), top, -0.95), (s * (xo - 0.25), top + 0.05, -0.95), 0.09, 'Rust', seg=12)
    mb.cyl((s * (xo - 0.25), top + 0.05, -0.95), (s * (xo - 0.25), top + 0.052, -0.95), 0.045, 'Iron', seg=10)
    mb.cyl((s * (xo - 0.12), top, -0.32), (s * (xo - 0.12), top + 0.1, -0.32), 0.045, 'Teal', seg=8)


def table_top(mb, s, xa, xb, y0, y1, zz):
    """Steel slats across a plate, the middle left clear for a machine; hazard stripes, a vise and a bolt tray on the
    outer edge."""
    bx(mb, s * xa, s * xb, y0, y0 + 0.01, -zz, zz, 'Iron')
    n = 13
    for k in range(n):
        z = -zz + 0.04 + k * (2 * zz - 0.08) / (n - 1)
        bx(mb, s * xa, s * xb, y0 + 0.01, y1, z - 0.04, z + 0.04, 'Steel')
    xo = HX + SIDE_H
    for k in range(10):
        z = -0.95 + k * 0.21
        bx(mb, s * xo, s * (xo + 0.008), y1 - 0.045, y1 - 0.005, z - 0.05, z + 0.05, 'Hazard')
    top = y1
    vz = 0.86
    bx(mb, s * (xo - 0.18), s * (xo + 0.04), top, top + 0.08, vz - 0.08, vz + 0.08, 'PumpPaint')
    bx(mb, s * (xo - 0.18), s * (xo - 0.12), top + 0.08, top + 0.16, vz - 0.08, vz + 0.08, 'PumpPaint')
    bx(mb, s * (xo - 0.04), s * (xo + 0.02), top + 0.08, top + 0.16, vz - 0.08, vz + 0.08, 'PumpPaint')
    mb.cyl((s * (xo + 0.02), top + 0.04, vz), (s * (xo + 0.15), top + 0.04, vz), 0.014, 'Steel', seg=6)
    # Bolt tray hung on the outer edge.
    tz = -0.55
    bx(mb, s * (xo + 0.008), s * (xo + 0.02), DECK - 0.14, DECK - 0.02, tz - 0.16, tz + 0.16, 'Iron')
    bx(mb, s * (xo + 0.02), s * (xo + 0.18), DECK - 0.14, DECK - 0.125, tz - 0.16, tz + 0.16, 'Steel')
    bx(mb, s * (xo + 0.165), s * (xo + 0.18), DECK - 0.125, DECK - 0.07, tz - 0.16, tz + 0.16, 'Steel')
    for z in (tz - 0.16, tz + 0.16):
        bx(mb, s * (xo + 0.02), s * (xo + 0.18), DECK - 0.125, DECK - 0.07, z - 0.008, z + 0.008, 'Steel')
    for dx, dz in ((0.06, -0.08), (0.1, 0.03), (0.13, -0.02), (0.07, 0.09)):
        mb.cyl((s * (xo + dx), DECK - 0.125, tz + dz), (s * (xo + dx), DECK - 0.105, tz + dz), 0.014, 'Iron', seg=6)
    # Clamps along the hinge edge to hold a machine down.
    for z in (-0.5, 0.5):
        bx(mb, s * (HX + 0.05), s * (HX + 0.11), top, top + 0.03, z - 0.05, z + 0.05, 'Hazard')


def build_side(s):
    mb = kit.MB()
    side_panel(mb, s, workbench_top if s < 0 else table_top)
    return mb


def build_leg(s):
    """Trestle under the folded bench's outer edge (built unfolded: standing on the ground)."""
    mb = kit.MB()
    x0, x1 = HX + SIDE_H - 0.05, HX + SIDE_H - 0.01
    yt = DECK - SIDE_T
    for z in (-0.98, 0.98):
        bx(mb, s * x0, s * x1, 0.02, yt, z - 0.025, z + 0.025, 'Iron')
        bx(mb, s * (x0 - 0.04), s * (x1 + 0.04), 0.0, 0.02, z - 0.06, z + 0.06, 'Iron')  # foot
    bx(mb, s * x0, s * x1, 0.36, 0.40, -0.955, 0.955, 'Steel')  # cross bar
    mb.beam((s * (x0 + 0.02), 0.40, -0.9), (s * (x0 + 0.02), yt - 0.04, -0.3), 0.025, 'Steel')  # brace
    mb.cyl((s * x0, yt - 0.02, -1.0), (s * x0, yt - 0.02, 1.0), 0.016, 'Steel', seg=6)  # its hinge pin
    return mb


# --------------------------------------------------------------------------------------------------- assemble

def build():
    root = bpy.data.objects.new('cart', None)
    bpy.context.scene.collection.objects.link(root)
    n = {}
    n['body'] = node('body', build_body(), (0, 0, 0), root)
    n['wheel_l'] = node('wheel_l', build_wheel(-1), (-WHEEL_X, WHEEL_R, 0), root)
    n['wheel_r'] = node('wheel_r', build_wheel(1), (WHEEL_X, WHEEL_R, 0), root)
    n['tongue'] = node('tongue', build_tongue(), TONGUE_PIVOT, root)
    n['coupler'] = empty('coupler', COUPLER, n['tongue'])
    n['stand'] = node('stand', build_stand(), STAND_PIVOT, n['tongue'], chain=[('stand', STAND_PIVOT)])
    n['lid'] = node('lid', build_lid(), LID_PIVOT, root)
    for name, sx, sz in (('pole_a', -1, -1), ('pole_b', 1, 1)):
        piv = (sx * POLE_X, POLE_Y, sz * POLE_Z)
        n[name] = node(name, build_pole(sx, sz), piv, root)
        n[name + '_tip'] = empty(name + '_tip', (sx * POLE_X, POLE_Y, sz * POLE_Z - sz * POLE_L), n[name])
    for name, s in (('l', -1), ('r', 1)):
        sp = (s * HX, DECK, 0)
        lp = (s * (HX + SIDE_T), DECK + SIDE_H - 0.05, 0)
        n['side_' + name] = node('side_' + name, build_side(s), sp, root, chain=[('side_' + name, sp)])
        n['leg_' + name] = node('leg_' + name, build_leg(s), lp, n['side_' + name],
                                chain=[('side_' + name, sp), ('leg_' + name, lp)])
    n['legs'] = node('legs', build_legs(), (0, 0, 0), root)
    return root, n


def unfold(n):
    """Preview only: put every hinged node in its unfolded pose (local rotations / the legs' slide)."""
    for name, (axis, v) in UNFOLD.items():
        o = n[name]
        if axis == 'ty':
            o.location.z += v  # game Y = Blender Z
        else:
            o.rotation_euler = game_rot(axis, v).to_euler()
    bpy.context.view_layer.update()


def bounds(objs):
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    # Blender → game: x, y = z, z = -y
    return (lo.x, hi.x), (lo.z, hi.z), (-hi.y, -lo.y)


def fmt(b):
    return ' '.join(f'{a}[{lo:.3f}, {hi:.3f}]' for a, (lo, hi) in zip('xyz', b))


def render(path, shots):
    scene = bpy.context.scene
    cam = scene.camera
    for suffix, target, offset, lens in shots:
        cam.data.lens = lens
        cam.location = target + offset
        cam.rotation_euler = (-offset).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = path.replace('.png', suffix + '.png')
        bpy.ops.render.render(write_still=True)


def setup_scene():
    scene = bpy.context.scene
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x, scene.render.resolution_y = 1400, 900
    scene.view_settings.view_transform = 'Standard'
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    m = bpy.data.materials.new('ground')
    m.use_nodes = True
    m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*kit.hex_rgb(0xd9a066), 1)
    bpy.context.active_object.data.materials.append(m)
    world = scene.world or bpy.data.worlds.new('world')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.75, 0.45, 0.25, 1)
    bg.inputs['Strength'].default_value = 0.7
    for name, energy, rot in (('key', 4.0, (55, 0, 35)), ('fill', 1.0, (70, 0, -120))):
        data = bpy.data.lights.new(name, 'SUN')
        data.energy = energy
        data.angle = math.radians(3)
        light = bpy.data.objects.new(name, data)
        light.rotation_euler = tuple(math.radians(a) for a in rot)
        scene.collection.objects.link(light)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.clip_start = 0.05
    scene.collection.objects.link(cam)
    scene.camera = cam


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'models', 'cart.glb'))
    ap.add_argument('--preview', default=None, help='render PNG previews, packed and unfolded')
    args = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    kit.make_materials()
    make_extra_materials()
    root, n = build()
    meshes = [o for o in n.values() if o.type == 'MESH']
    kit.export([root] + list(n.values()), args.out)
    total = 0
    for name, o in n.items():
        w = o.matrix_world.translation
        t = kit.tri_count(o) if o.type == 'MESH' else 0
        total += t
        print(f'{name}: tris={t} at game ({w.x:.3f}, {w.z:.3f}, {-w.y:.3f})')
    mats = {m.name for o in meshes for m in o.data.materials}
    print(f'total tris={total} materials={len(mats)} {sorted(mats)}')
    print('packed', fmt(bounds(meshes)))
    print('wheels', fmt(bounds([n['wheel_l'], n['wheel_r']])))

    unfold(n)
    for k in ('side_l', 'side_r', 'leg_l', 'leg_r', 'stand', 'lid', 'legs'):
        print(f'unfolded {k}:', fmt(bounds([n[k]])))
    for k in ('pole_a_tip', 'pole_b_tip', 'coupler'):
        w = n[k].matrix_world.translation
        print(f'unfolded {k}: game ({w.x:.3f}, {w.z:.3f}, {-w.y:.3f})')
    print('unfolded all', fmt(bounds(meshes)))

    if args.preview:
        path = os.path.abspath(args.preview)
        setup_scene()
        t = Vector((0, 0, 0.9))
        shots_open = [
            ('_open', t, Vector((4.2, 4.0, 2.6)), 32),          # front right 3/4 (Blender +Y is the front)
            ('_open_rear', t, Vector((-3.6, -4.6, 2.4)), 32),   # rear left 3/4
            ('_open_side', t, Vector((0.6, -0.4, 6.0)), 28),    # from above
            ('_open_end', Vector((0, 0, 0.7)), Vector((0, -5.5, 0.6)), 35),  # from behind, low: legs on the ground
        ]
        render(path, shots_open)
        for name, o in n.items():  # back to packed
            if o.type == 'MESH':
                o.rotation_euler = (0, 0, 0)
        n['legs'].location.z -= UNFOLD['legs'][1]
        bpy.context.view_layer.update()
        shots_packed = [
            ('_packed', t, Vector((4.2, 4.0, 2.2)), 32),
            ('_packed_rear', t, Vector((-3.6, -4.6, 2.6)), 32),
            ('_packed_side', Vector((0, -0.6, 0.6)), Vector((6.5, 0, 0.5)), 30),
        ]
        render(path, shots_packed)


main()
