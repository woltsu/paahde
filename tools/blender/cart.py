"""The cart (docs/cart.md): a two-wheeled scrap trailer towed behind the sand bike, that unfolds into a camp.

    tools/blender/run.sh -b --python tools/blender/cart.py                        # writes public/models/cart.glb
    tools/blender/run.sh -b --python tools/blender/cart.py -- --preview out.png   # also out_packed*.png, out_open*.png

Exported in the PACKED pose: the sides upright as the cart's walls (their leaves nested in them), the canopy poles flat
along the bed (their top sections run in, the work lamps folded along them), the lid shut, the stand up, the corner legs
up. Every node's rotation is identity and scale 1 in that pose, so code unfolds a node by setting its rotation to the
table below times t ∈ [0, 1] (a quaternion turn slerped from identity), or for a slide its position plus the offset
times t. The quaternions and slides are printed on every run ("unfold <node>: ...") for src/world/carts.ts FOLD.

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
    pole_a      (-0.56, 0.93, -0.98)       q      (-0.82143, -0.22266, 0, 0.52504)  front left; packed lying back (+Z)
                                                                            along the bed's left edge; unfolded raked
                                                                            out forward and left (+Z to (-0.24, 0.86,
                                                                            -0.45)), the lamp's clamp on it
      pole_a_top (pivot as pole_a)         slide  position.z += 1.3649      its top section run out
        pole_a_tip  packed (-0.56, 0.93, 0.82), unfolded (-1.30, 3.66, -2.40)
      lamp_a    (-0.56, 1.005, 0.52)       q      (-0.57567, -0.01238, 0, 0.81759)  (relative to pole_a) the work
                                                                            lamp's bent arm, packed lying back along
                                                                            the pole on a lug over it, swung out over
                                                                            the workbench
        lamp_a_bulb  packed (-0.62, 1.15, -0.83), unfolded (-1.22, 2.10, -0.40): the bulb's middle
    pole_b      (0.56, 0.93, 0.98)         q      (0.82143, -0.22266, 0, 0.52504)  rear right, its mirror (packed
      pole_b_top                           slide  position.z -= 1.3649      lying forward, -Z)
        pole_b_tip  packed (0.56, 0.93, -0.82), unfolded (1.30, 3.66, 2.40)
      lamp_b    (0.56, 1.005, -0.52)       q      (0.57567, -0.01238, 0, 0.81759)  over the dismantling table
        lamp_b_bulb  packed (0.62, 1.15, 0.83), unfolded (1.22, 2.10, 0.40)
    side_l      (-0.68, 0.88, 0)           Z      rotation.z = +90°         workbench on its inner face; folds out
      leaf_l    (-0.715, 1.23, 0)          slide  position += (0.02, 0.55, 0)  (in side_l's frame) the leaf nested
                                                                            under its top slides out of its outer edge
                                                                            and up flush with it
        leg_l   (-0.75, 1.46, 0)           Z      rotation.z = -90°         (relative to leaf_l) trestle under the
                                                                            leaf's outer edge, packed flat on the
                                                                            wall's outside, hanging down from its top
    side_r      (0.68, 0.88, 0)            Z      rotation.z = -90°         dismantling table on its inner face
      leaf_r    (0.715, 1.23, 0)           slide  position += (-0.02, 0.55, 0)  hazard stripes and the bolt tray on
        leg_r   (0.75, 1.46, 0)            Z      rotation.z = +90°         its outer edge
    legs        (0, 0, 0)                  -      position.y = -0.46        the four corner stabilisers (x ±0.50, z ±1.145,
                                                                            on the end boards' outsides) slide down out
                                                                            of their sleeves until their feet touch the
                                                                            ground (a slide, not a turn)

Unfolded, both benches lie level with the deck: their tops at y = 0.88, reaching from |x| = 0.68 to 1.88 (1.2 m deep:
the side's 0.65 and the leaf's 0.55) over z −1.08 .. 1.08, held at their outer edge by the trestle legs (feet on the
ground at |x| ≈ 1.83, z ±0.98): the unfolded camp is 3.76 × 2.2 m (was 2.66 × 2.2). The canopy's poles, 3.16 m with
their top sections out, stand raked ~30° out past the deck's ends, tips at (±1.30, 3.66, ±2.40) (front left, rear
right): the canopy (shared/cart.ts canopyRig) is tied 6 cm under them. Packed, everything is as before (1.67 m wide).

Materials are the stationkit ones (tools/blender/stationkit.py) and the bike's tyre/rim colours (tools/blender/
sandbike.py); src/world/glbMaterial.ts turns them into node materials. Output is deterministic.
"""

import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

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
POLE_X, POLE_Y, POLE_Z, POLE_L = 0.56, 0.93, 0.98, 1.8  # hinges; the lower section's length
# Unfolded, each pole stands raked out to its tip (cart coordinates; pole_b's, pole_a's is it turned half round): the
# canopy's high corners out past the deck's ends, so the canvas covers the unfolded camp and clears a head on the deck.
POLE_TIP = (1.3, 3.66, 2.4)
_d = Vector(POLE_TIP) - Vector((POLE_X, POLE_Y, POLE_Z))
POLE_FULL = _d.length                # hinge to tip, the top section run out
POLE_DIR = tuple(_d.normalized())
POLE_EXT = POLE_FULL - POLE_L        # how far the top section slides out of the lower one
TOP_L = POLE_L - 0.12                # the top section, nested in the lower one packed
TONGUE_PIVOT = (0, 0.79, -HZ)
COUPLER = (0, 0.54, -HZ - 1.3)
STAND_PIVOT = (0, 0.50, -2.0)
# The leaves: a board nested in each side panel under its top that slides out of its outer edge once the side is down
# (LEAF_OUT), rising flush with the top (LEAF_RISE); the trestle hangs under the leaf's outer edge.
LEAF_W, LEAF_T, LEAF_OUT, LEAF_RISE, LEAF_Z = 0.6, 0.03, 0.55, 0.02, 1.0
OUTER = HX + SIDE_H + LEAF_OUT       # the unfolded bench's outer edge (|x| 1.88)
# The work lamps (level 2): a caged bulb on a bent arm clamped to each pole, swung out over its bench (pole_a's over the
# workbench, pole_b's over the table). LAMP_AT: the clamp's distance up the pole from its hinge; LAMP_BULB: pole_b's
# bulb unfolded (cart coordinates; pole_a's is it turned half round).
LAMP_AT, LAMP_BULB = 1.5, (1.22, 2.1, 0.4)
LAMP_HANG = 0.16                     # the bulb hangs this far under the arm's end


def neg(v):
    return tuple(-c for c in v)


# pole_b's lamp unfolded (game Vectors): the clamp on the pole and the arm's end (its pivot, on a lug out to the cart's
# side of the clamp packed, is set once the pole's turn is known, below).
LAMP_CLAMP = Vector((POLE_X, POLE_Y, POLE_Z)) + Vector(POLE_DIR) * LAMP_AT
LAMP_END = Vector(LAMP_BULB) + Vector((0, LAMP_HANG, 0))
LAMP_LUG = 0.075

UNFOLD = {  # node: (game axis, degrees); ('ty', metres) or ('t', (x, y, z)) a slide in the parent's frame; ('q', (u, v))
    #         the shortest turn taking game vector u to v (three.js Quaternion.setFromUnitVectors)
    'stand': ('x', 90), 'lid': ('x', -100),
    'pole_a': ('q', ((0, 0, 1), (-POLE_DIR[0], POLE_DIR[1], -POLE_DIR[2]))), 'pole_b': ('q', ((0, 0, -1), POLE_DIR)),
    'pole_a_top': ('t', (0, 0, POLE_EXT)), 'pole_b_top': ('t', (0, 0, -POLE_EXT)),
    'side_l': ('z', 90), 'leg_l': ('z', -90), 'side_r': ('z', -90), 'leg_r': ('z', 90),
    'leaf_l': ('t', (LEAF_RISE, LEAF_OUT, 0)), 'leaf_r': ('t', (-LEAF_RISE, LEAF_OUT, 0)),
    'legs': ('ty', -LEGS_DROP),
}

EXTRA_MATERIALS = {  # name: (sRGB hex, roughness, metallic), the bike's colours
    'Tyre': (0x2b2420, 0.95, 0.0),
    'TyreSide': (0x3a302a, 0.95, 0.0),
    'Rim': (0xc0782e, 0.6, 0.3),
    'Teal': (0x3f8a84, 0.7, 0.15),
    'Cream': (0xd8c49a, 0.8, 0.05),
    'Bulb': (0xf2e2b8, 0.3, 0.0),  # the work lamps' bulbs: code gives them their glow (src/world/carts.ts)
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


def game_quat(u, v):
    """The shortest turn taking game vector u to v, as a quaternion in game coordinates."""
    return Vector(u).normalized().rotation_difference(Vector(v).normalized())


def blender_quat(q):
    """A game-coordinates quaternion as a Blender one (its axis through G, a proper rotation)."""
    axis, ang = q.to_axis_angle()
    return Quaternion(G(*axis), ang)


def unfold_rot(name):
    """The node's unfolded local turn as a Blender 4x4 matrix (a turn, not a slide)."""
    axis, v = UNFOLD[name]
    if axis == 'q':
        return blender_quat(game_quat(*v)).to_matrix().to_4x4()
    return game_rot(axis, v)


def unfold_matrix(name, pivot):
    """The node's unfolded transform about its pivot (game coordinates), in Blender world space."""
    axis, v = UNFOLD[name]
    if axis == 'ty':
        return Matrix.Translation(G(0, v, 0))
    if axis == 't':
        return Matrix.Translation(G(*v))
    p = G(*pivot)
    return Matrix.Translation(p) @ unfold_rot(name) @ Matrix.Translation(-p)


def packed_of(point, chain):
    """A game point in the unfolded pose taken back to the packed pose through `chain` (as node()'s)."""
    m = Matrix.Identity(4)
    for n, p in chain:
        m = m @ unfold_matrix(n, p)
    w = m.inverted() @ G(*point)
    return (w.x, w.z, -w.y)


def lamp_unfold(pole):
    """The lamp's turn in its pole's packed frame: from lying back along the pole (towards its hinge) to its chord
    unfolded, taken back through the pole's own turn. Sets UNFOLD['lamp_a'/'lamp_b']."""
    q = game_quat(*UNFOLD[pole][1])
    chord = (LAMP_END - LAMP_PIVOT).normalized()
    if pole == 'pole_a':
        chord = Vector((-chord.x, chord.y, -chord.z))
    back = (0, 0, 1) if pole == 'pole_b' else (0, 0, -1)
    return ('q', (back, tuple((q.inverted() @ chord).normalized())))


LAMP_PIVOT = LAMP_CLAMP + game_quat(*UNFOLD['pole_b'][1]) @ Vector((0, LAMP_LUG, 0))
UNFOLD['lamp_a'] = lamp_unfold('pole_a')
UNFOLD['lamp_b'] = lamp_unfold('pole_b')


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
    """A scavenged pipe in two lengths with a sleeve over the joint, lying from its hinge along the bed, a collar at its
    mouth the top section slides out of, and the work lamp's clamp with its lug."""
    mb = kit.MB()
    x, z0 = sx * POLE_X, sz * POLE_Z
    z1 = z0 - sz * POLE_L
    zj = z0 - sz * POLE_L * 0.55
    mb.cyl((x, POLE_Y, z0 + sz * 0.025), (x, POLE_Y, zj), 0.03, 'Steel', seg=8)
    mb.cyl((x, POLE_Y, zj), (x, POLE_Y, z1), 0.027, 'Iron', seg=8)
    mb.cyl((x, POLE_Y, zj + sz * 0.07), (x, POLE_Y, zj - sz * 0.07), 0.036, 'Rust', seg=8)
    mb.cyl((x, POLE_Y, z1 + sz * 0.06), (x, POLE_Y, z1), 0.035, 'Iron', seg=8)  # collar at the mouth
    # Hinge eye at the foot.
    mb.cyl((x - 0.03, POLE_Y, z0), (x + 0.03, POLE_Y, z0), 0.034, 'Iron', seg=8)
    # The lamp's clamp round the pipe and the lug its arm turns on (built where the lamp's pivot is packed).
    name = 'pole_a' if sz < 0 else 'pole_b'
    zc = z0 - sz * LAMP_AT
    mb.cyl((x, POLE_Y, zc + 0.045), (x, POLE_Y, zc - 0.045), 0.038, 'Iron', seg=8)
    piv = Vector(packed_of(lamp_pt(name, LAMP_PIVOT), [(name, (x, POLE_Y, z0))]))
    mb.beam((x, POLE_Y, zc), tuple(piv), 0.03, 'Iron')
    return mb


def build_pole_top(sx, sz):
    """The pole's top section, nested in the lower one packed: a thinner pipe with a hazard cap."""
    mb = kit.MB()
    x, z0 = sx * POLE_X, sz * POLE_Z
    z1 = z0 - sz * POLE_L
    mb.cyl((x, POLE_Y, z1 + sz * TOP_L), (x, POLE_Y, z1), 0.019, 'Steel', seg=8)
    mb.cyl((x, POLE_Y, z1 + sz * 0.03), (x, POLE_Y, z1 - sz * 0.02), 0.03, 'Hazard', seg=8)  # cap at the tip
    return mb


def lamp_pt(pole, p):
    """pole_b's lamp point p, or pole_a's (turned half round about the axle)."""
    return (p[0], p[1], p[2]) if pole == 'pole_b' else (-p[0], p[1], -p[2])


def build_lamp(pole):
    """The work lamp, built unfolded: a bent arm from its lug out over the bench, a teal dish over a caged bulb."""
    mb = kit.MB()
    P = lamp_pt(pole, LAMP_PIVOT)
    end = lamp_pt(pole, LAMP_END)
    bulb = lamp_pt(pole, LAMP_BULB)
    Pv, Ev = Vector(P), Vector(end)
    elbow = tuple(Pv + (Ev - Pv) * 0.6 + Vector((0, 0.16, 0)))
    mb.cyl(P, elbow, 0.017, 'Steel', seg=6)
    mb.cyl(elbow, end, 0.015, 'Rust', seg=6)
    mb.cyl((P[0], P[1] - 0.03, P[2]), (P[0], P[1] + 0.03, P[2]), 0.026, 'Iron', seg=8)  # the knuckle on the lug
    bx, by, bz = bulb
    mb.cyl(end, (bx, by + 0.11, bz), 0.008, 'Tyre', seg=4)  # the flex
    mb.cyl((bx, by + 0.12, bz), (bx, by + 0.06, bz), 0.022, 'Iron', seg=8)  # socket
    mb.cyl((bx, by + 0.085, bz), (bx, by - 0.005, bz), 0.035, 'Teal', r1=0.1, seg=12)  # the dish
    mb.cyl((bx, by + 0.06, bz), (bx, by - 0.045, bz), 0.03, 'Bulb', r1=0.042, seg=10)
    mb.cyl((bx, by - 0.045, bz), (bx, by - 0.07, bz), 0.042, 'Bulb', r1=0.018, seg=10)
    for k in range(4):  # the cage
        a = math.pi / 4 + k * math.pi / 2
        mb.cyl((bx + math.cos(a) * 0.105, by, bz + math.sin(a) * 0.105), (bx + math.cos(a) * 0.02, by - 0.1, bz + math.sin(a) * 0.02),
               0.005, 'Iron', seg=4)
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
    top = y1
    vz = 0.86
    bx(mb, s * (xo - 0.18), s * (xo + 0.04), top, top + 0.08, vz - 0.08, vz + 0.08, 'PumpPaint')
    bx(mb, s * (xo - 0.18), s * (xo - 0.12), top + 0.08, top + 0.16, vz - 0.08, vz + 0.08, 'PumpPaint')
    bx(mb, s * (xo - 0.04), s * (xo + 0.02), top + 0.08, top + 0.16, vz - 0.08, vz + 0.08, 'PumpPaint')
    mb.cyl((s * (xo + 0.02), top + 0.04, vz), (s * (xo + 0.15), top + 0.04, vz), 0.014, 'Steel', seg=6)
    # Clamps along the hinge edge to hold a machine down.
    for z in (-0.5, 0.5):
        bx(mb, s * (HX + 0.05), s * (HX + 0.11), top, top + 0.03, z - 0.05, z + 0.05, 'Hazard')


def build_side(s):
    mb = kit.MB()
    side_panel(mb, s, workbench_top if s < 0 else table_top)
    return mb


def build_leaf(s):
    """The leaf slid out of the side's outer edge (built unfolded): planks on the workbench's, steel slats on the table's,
    an iron edge, and on the table's outer edge its hazard stripes and a bolt tray."""
    mb = kit.MB()
    x0, x1 = OUTER - LEAF_W, OUTER
    y0, y1 = DECK - LEAF_T, DECK
    zz = LEAF_Z
    bx(mb, s * x0, s * (x1 - 0.03), y0, y0 + 0.008, -zz, zz, 'Iron')
    if s < 0:
        w = (x1 - 0.03 - x0) / 3
        for k in range(3):
            bx(mb, s * (x0 + k * w), s * (x0 + (k + 1) * w - 0.004), y0 + 0.008, y1, -zz, zz, 'WoodDark' if k != 1 else 'Wood')
    else:
        n = 12
        for k in range(n):
            z = -zz + 0.04 + k * (2 * zz - 0.08) / (n - 1)
            bx(mb, s * x0, s * (x1 - 0.03), y0 + 0.008, y1, z - 0.04, z + 0.04, 'Steel')
    bx(mb, s * (x1 - 0.03), s * x1, y0 - 0.01, y1, -zz, zz, 'Iron')  # the edge, a pull in its middle
    bx(mb, s * x1, s * (x1 + 0.02), y0 + 0.004, y1 - 0.01, -0.12, 0.12, 'Iron')
    for sz in (-1, 1):
        bx(mb, s * x0, s * x1, y0 - 0.01, y1, min(sz * zz, sz * (zz - 0.03)), max(sz * zz, sz * (zz - 0.03)), 'Iron')
    if s > 0:
        xo = x1
        for k in range(9):
            z = -0.92 + k * 0.23
            if abs(z) > 0.14:
                bx(mb, s * xo, s * (xo + 0.008), y0, y1 - 0.004, z - 0.05, z + 0.05, 'Hazard')
        # Bolt tray hung on the outer edge.
        tz = -0.55
        bx(mb, s * (xo + 0.008), s * (xo + 0.02), DECK - 0.14, DECK - 0.02, tz - 0.16, tz + 0.16, 'Iron')
        bx(mb, s * (xo + 0.02), s * (xo + 0.18), DECK - 0.14, DECK - 0.125, tz - 0.16, tz + 0.16, 'Steel')
        bx(mb, s * (xo + 0.165), s * (xo + 0.18), DECK - 0.125, DECK - 0.07, tz - 0.16, tz + 0.16, 'Steel')
        for z in (tz - 0.16, tz + 0.16):
            bx(mb, s * (xo + 0.02), s * (xo + 0.18), DECK - 0.125, DECK - 0.07, z - 0.008, z + 0.008, 'Steel')
        for dx, dz in ((0.06, -0.08), (0.1, 0.03), (0.13, -0.02), (0.07, 0.09)):
            mb.cyl((s * (xo + dx), DECK - 0.125, tz + dz), (s * (xo + dx), DECK - 0.105, tz + dz), 0.014, 'Iron', seg=6)
    return mb


def build_leg(s):
    """Trestle under the leaf's outer edge (built unfolded: standing on the ground)."""
    mb = kit.MB()
    x0, x1 = OUTER - 0.07, OUTER - 0.03
    yt = DECK - LEAF_T
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
        top = name + '_top'
        n[top] = node(top, build_pole_top(sx, sz), piv, n[name])
        n[name + '_tip'] = empty(name + '_tip', (sx * POLE_X, POLE_Y, sz * POLE_Z - sz * POLE_L), n[top])
        lamp = 'lamp_' + name[-1]
        chain = [(name, piv)]
        lp = packed_of(lamp_pt(name, LAMP_PIVOT), chain)
        chain = chain + [(lamp, lp)]
        n[lamp] = node(lamp, build_lamp(name), lp, n[name], chain=chain)
        n[lamp + '_bulb'] = empty(lamp + '_bulb', packed_of(lamp_pt(name, LAMP_BULB), chain), n[lamp])
    for name, s in (('l', -1), ('r', 1)):
        sp = (s * HX, DECK, 0)
        n['side_' + name] = node('side_' + name, build_side(s), sp, root, chain=[('side_' + name, sp)])
        chain = [('side_' + name, sp), ('leaf_' + name, None)]
        fp = packed_of((s * (OUTER - LEAF_W / 2), DECK - LEAF_T / 2, 0), chain)
        n['leaf_' + name] = node('leaf_' + name, build_leaf(s), fp, n['side_' + name], chain=chain)
        lp = packed_of((s * (OUTER - 0.07), DECK - LEAF_T - 0.02, 0), chain)
        n['leg_' + name] = node('leg_' + name, build_leg(s), lp, n['leaf_' + name], chain=chain + [('leg_' + name, lp)])
    n['legs'] = node('legs', build_legs(), (0, 0, 0), root)
    return root, n


def unfold(n):
    """Preview only: put every hinged node in its unfolded pose (local rotations / the legs' slide)."""
    for name, (axis, v) in UNFOLD.items():
        o = n[name]
        o['packed_loc'] = tuple(o.location)
        if axis == 'ty':
            o.location.z += v  # game Y = Blender Z
        elif axis == 't':
            o.location += G(*v)
        else:
            o.rotation_mode = 'QUATERNION'
            o.rotation_quaternion = unfold_rot(name).to_quaternion()
    bpy.context.view_layer.update()


def pack(n):
    """Preview only: back to the packed pose."""
    for name in UNFOLD:
        o = n[name]
        o.location = Vector(o['packed_loc'])
        o.rotation_quaternion = (1, 0, 0, 0)
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
    for k in ('side_l', 'side_r', 'leaf_l', 'leaf_r', 'leg_l', 'leg_r', 'stand', 'lid', 'legs', 'lamp_a', 'lamp_b'):
        print(f'unfolded {k}:', fmt(bounds([n[k]])))
    for k in ('pole_a_tip', 'pole_b_tip', 'lamp_a_bulb', 'lamp_b_bulb', 'coupler'):
        w = n[k].matrix_world.translation
        print(f'unfolded {k}: game ({w.x:.3f}, {w.z:.3f}, {-w.y:.3f})')
    print('unfolded all', fmt(bounds(meshes)))
    for k, (axis, v) in UNFOLD.items():
        if axis == 'q':
            q = game_quat(*v)
            print(f'unfold {k}: quaternion (x, y, z, w) game ({q.x:.5f}, {q.y:.5f}, {q.z:.5f}, {q.w:.5f})')
        elif axis == 't':
            print(f'unfold {k}: slide game ({v[0]:.4f}, {v[1]:.4f}, {v[2]:.4f})')

    if args.preview:
        path = os.path.abspath(args.preview)
        setup_scene()
        t = Vector((0, 0, 0.9))
        shots_open = [
            ('_open', t + Vector((0, 0, 0.6)), Vector((5.9, 5.6, 3.0)), 32),        # front right 3/4 (Blender +Y is the front)
            ('_open_rear', t + Vector((0, 0, 0.6)), Vector((-5.0, -6.4, 2.8)), 32),  # rear left 3/4
            ('_open_side', t, Vector((0.6, -0.4, 8.5)), 28),    # from above
            ('_open_lamp', Vector((1.25, -0.2, 1.6)), Vector((2.6, -1.8, 0.9)), 30),  # the table's lamp, close
            ('_open_end', Vector((0, 0, 0.7)), Vector((0, -5.5, 0.6)), 35),  # from behind, low: legs on the ground
        ]
        render(path, shots_open)
        pack(n)
        shots_packed = [
            ('_packed', t, Vector((4.2, 4.0, 2.2)), 32),
            ('_packed_rear', t, Vector((-3.6, -4.6, 2.6)), 32),
            ('_packed_side', Vector((0, -0.6, 0.6)), Vector((6.5, 0, 0.5)), 30),
        ]
        render(path, shots_packed)


main()
