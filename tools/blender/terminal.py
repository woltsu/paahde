"""The net terminals (src/world/netTerminal.ts): old beige terminals, CRT and keyboard, for anywhere a console stands
(a station, a bunker, the lab), in two kinds. Their screens are not in the models: src/world/netTerminal.ts puts its
own bulged glass in each opening (`TERMINALS[kind].screen` there; the SCREEN constants here match) and streams code on it.

    blender -b --python tools/blender/terminal.py                       # models
    blender -b --python tools/blender/terminal.py -- --preview out.png  # also a perspective preview render of both

Writes public/models/terminal_console.glb (object `terminal_console`, the console kind) and public/models/terminal.glb
(object `terminal`, the compact kind), with the helpers of tools/blender/placeables.py and tools/blender/items.py.

The console: a 1970s video terminal, wide and low: a beige housing with a flat top and its back sloping down, a dark hood
round the big screen (a flat lip, then sloping in to the tube), beige brow, cheeks and chin round the hood, an accent
stripe and a plate of lamps on the chin, vents on the back's slope and a groove along each side; in front a low beige
keyboard slab with a dark key well (main block, numpad, space bar, a few accent keys, a row of status lamps).

The compact: a deep CRT housing on a plinth: the front block with a raised bezel round the tube's dark recess (a badge, two knobs and
a power lamp on its deep bottom bar, vent slots on top), the tube's tapered back with its rear plate; in front a wedge
keyboard (main keys, a brown function row, a numpad, the space bar) and its cable round to the plinth.

Blender is Z-up; the glTF exporter converts to Y-up, game +Z (the screen's facing) = Blender -Y. Units are metres,
origin at the footprint's centre on the floor. Output is deterministic.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import items as it  # noqa: E402
import placeables as pl  # noqa: E402  (helpers only: it runs nothing on import)

MATERIALS = {
    'case_beige': (0xc8bb98, 0.0, 0.55, 0),
    'case_beige_dark': (0xa29372, 0.0, 0.6, 0),
    'case_shadow': (0x5c5446, 0.0, 0.7, 0),
    'tube_black': (0x0d0f0e, 0.0, 0.25, 0),
    'key_cream': (0xd9cfb2, 0.0, 0.5, 0),
    'key_brown': (0x6e5c48, 0.0, 0.5, 0),
    'EmitLamp': (0x7dff8a, 0.0, 0.4, 3),
    'EmitLampRed': (0xff5a3c, 0.0, 0.4, 3),
    'hood_dark': (0x2a2522, 0.0, 0.45, 0),
    'key_dark': (0x3b3733, 0.0, 0.5, 0),
    'key_accent': (0xd9772e, 0.0, 0.45, 0),
    'accent': (0xc8692a, 0.1, 0.45, 0),
}

# The console's screen (src/world/netTerminal.ts TERMINALS.console.screen: glTF centre (0, C_SCREEN_Z, front), W x H).
C_SCREEN_W, C_SCREEN_H, C_SCREEN_Z = 0.42, 0.315, 0.32
C_HW = 0.31          # the housing's half width
C_FRONT = -0.06      # the housing's front face (Blender y), behind the hood
C_LIP = -0.125       # the hood's and the frame's front (glTF z 0.125)
C_TUBE = -0.069      # the tube's face (glTF z 0.069)
C_TOP = 0.58
C_HOOD = (0.25, 0.11, 0.53)  # the hood's half width, bottom, top
C_KB = (-0.42, -0.15)  # the keyboard's front and back edge (Blender y)
C_KB_HW = 0.33
C_KB_H = (0.04, 0.072)  # its height at the front and back

# The screen's opening (src/world/netTerminal.ts TERMINALS.compact.screen: glTF centre (0, SCREEN_Z, front), size W x H).
SCREEN_W, SCREEN_H, SCREEN_Z = 0.30, 0.225, 0.27
FRONT = -0.06        # the housing's front face (Blender y; glTF z 0.06)
BASE = 0.05          # the plinth's top, the housing's floor
TOP = 0.45           # the housing's top
HW = 0.23            # the housing's half width
BEZEL = 0.036        # how far the bezel stands proud of the housing
KB = (-0.33, -0.13)  # the keyboard's front and back edge (Blender y)
KB_HW = 0.23
KB_H = (0.022, 0.05)  # its height at the front and back


def chamfered(cx, cz, hw, hh, c, y):
    """A rectangle in the x-z plane at depth y with its corners cut by c: 8 points round."""
    return [(cx + x, y, cz + z) for x, z in (
        (-hw + c, -hh), (hw - c, -hh), (hw, -hh + c), (hw, hh - c),
        (hw - c, hh), (-hw + c, hh), (-hw, hh - c), (-hw, -hh + c))]


def rounded(cx, cz, hw, hh, r, y, n=4):
    """A rounded rectangle in the x-z plane at depth y, corners of radius r in n steps: 4 (n + 1) points round."""
    pts = []
    for sx, sz, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oz = cx + sx * (hw - r), cz + sz * (hh - r)
        for j in range(n + 1):
            a = math.radians(a0 + 90 * j / n)
            pts.append((ox + r * math.cos(a), y, oz + r * math.sin(a)))
    return pts


def ring_solid(mb, rings, mat):
    """A closed solid through a cycle of rings (the same point count each): a frame, a hood."""
    vs = [[mb.bm.verts.new(p) for p in ring] for ring in rings]
    n = len(vs[0])
    for a, b in zip(vs, vs[1:] + vs[:1]):
        for j in range(n):
            k = (j + 1) % n
            mb.bm.faces.new((a[j], b[j], b[k], a[k]))
    return mb._place([v for r in vs for v in r], mat, (0, 0, 0), (0, 0, 0))


def rounded_loft(mb, sections, mat, r):
    """mb.loft with its edges rounded by r."""
    v = mb.loft(sections, mat)
    edges = list({e for vv in v for e in vv.link_edges})
    bmesh.ops.bevel(mb.bm, geom=v + edges, offset=r, segments=2, affect='EDGES', profile=0.5)


def build_console(mb, rng):
    # The housing: the side profile (flat top, the back sloping down) run across, its edges rounded.
    prof = [(C_FRONT, 0.0), (0.44, 0.0), (0.47, 0.24), (0.33, C_TOP), (C_FRONT, C_TOP)]
    rounded_loft(mb, [[(x, y, z) for y, z in prof] for x in (-C_HW, C_HW)], 'case_beige', 0.02)
    # Vents on the back's slope; a groove and an accent line along each side.
    tilt = math.atan2(0.14, C_TOP - 0.24)
    for k in range(8):
        t = 0.25 + k * 0.07
        y, z = 0.47 + (0.33 - 0.47) * t, 0.24 + (C_TOP - 0.24) * t
        mb.box((0.4, 0.012, 0.004), (0, y + 0.0016, z + 0.0006), 'case_shadow', rot=(tilt, 0, 0))
    for sx in (-1, 1):
        mb.box((0.004, 0.42, 0.012), (sx * (C_HW + 0.0005), 0.15, 0.36), 'case_shadow')
        mb.box((0.004, 0.42, 0.006), (sx * (C_HW + 0.0005), 0.15, 0.08), 'accent')

    # The beige frame round the hood: brow, chin, cheeks, from the housing's face (sunk 2 mm) out to the lip.
    hw, hb, ht = C_HOOD
    d = C_FRONT + 0.002 - C_LIP
    yc = (C_FRONT + 0.002 + C_LIP) / 2
    mb.box((2 * C_HW, d, C_TOP - ht), (0, yc, (ht + C_TOP) / 2), 'case_beige', bevel=0.012)
    mb.box((2 * C_HW, d, hb), (0, yc, hb / 2), 'case_beige', bevel=0.012)
    for sx in (-1, 1):
        mb.box((C_HW - hw, d, ht - hb), (sx * (C_HW + hw) / 2, yc, (hb + ht) / 2), 'case_beige', bevel=0.006)
    # The hood: its flat lip a little proud of the frame, sloping in to the tube; the tube's dark face behind.
    cz, hh = (hb + ht) / 2, (ht - hb) / 2
    ring_solid(mb, [rounded(0, cz, hw + 0.004, hh + 0.004, 0.05, C_LIP - 0.003),
                    rounded(0, cz, hw - 0.016, hh - 0.016, 0.04, C_LIP - 0.004),
                    rounded(0, C_SCREEN_Z, C_SCREEN_W / 2 + 0.008, C_SCREEN_H / 2 + 0.008, 0.03, C_TUBE),
                    rounded(0, cz, hw + 0.004, hh + 0.004, 0.05, C_TUBE)], 'hood_dark')
    mb.box((2 * hw - 0.02, 0.012, 2 * hh - 0.02), (0, C_TUBE + 0.005, cz), 'tube_black')
    # The chin: an accent stripe across, a dark plate on the right with its lamps, a knob on the left.
    yf = C_LIP - 0.001
    mb.box((2 * C_HW - 0.06, 0.003, 0.008), (0, yf, hb - 0.03), 'accent')
    mb.box((0.14, 0.004, 0.04), (0.19, yf, hb - 0.068), 'hood_dark', bevel=0.003)
    for k, m in enumerate(('EmitLamp', 'EmitLamp', 'EmitLampRed')):
        mb.box((0.016, 0.004, 0.008), (0.16 + k * 0.03, yf - 0.002, hb - 0.068), m)
    mb.cyl(0.014, 0.012, 0.016, 14, (-0.24, yf - 0.006, hb - 0.065), 'plastic_black', rot=it.X90)

    # The keyboard: a low beige slab, rising to the back, with a dark key well.
    (y0, y1), (h0, h1) = C_KB, C_KB_H
    mb.loft([[(x, y0, 0), (x, y1, 0), (x, y1, h1), (x, y0, h0)] for x in (-C_KB_HW, C_KB_HW)], 'case_beige')
    slope = math.atan2(h1 - h0, y1 - y0)
    top = lambda y: h0 + (y - y0) * (h1 - h0) / (y1 - y0)  # noqa: E731
    wy = (y0 + y1) / 2 - 0.005
    mb.box((2 * C_KB_HW - 0.07, y1 - y0 - 0.06, 0.006), (0, wy, top(wy) + 0.001), 'hood_dark', rot=(slope, 0, 0))

    def key(x, y, w, mat, dd=0.031):
        mb.box((w, dd, 0.014), (x, y, top(y) + 0.006), mat, rot=(slope, 0, 0), bevel=0.0025)

    step, row0 = 0.036, y0 + 0.075
    accents = ((0, 0), (2, 11), (3, 11))
    for r in range(4):  # the main block, each row offset a little
        for c in range(12):
            key(-0.29 + 0.009 * r + c * step, row0 + r * 0.037, 0.031, 'key_accent' if (r, c) in accents else 'key_dark')
    for r in range(4):  # the numpad
        for c in range(3):
            key(0.185 + c * step, row0 + r * 0.037, 0.031, 'key_dark')
    key(-0.09, row0 - 0.037, 0.22, 'key_dark')  # the space bar
    for k in range(6):  # the status lamps behind the keys
        m = 'EmitLampRed' if k == 1 else ('EmitLamp' if k in (0, 3) else 'case_shadow')
        y = row0 + 4 * 0.037 - 0.008
        mb.box((0.016, 0.008, 0.004), (-0.26 + k * 0.035, y, top(y) + 0.004), m, rot=(slope, 0, 0))
    # Its cable, out of the back and in under the housing.
    it.wire(mb, [(0.25, y1 + 0.002, 0.03), (0.27, y1 + 0.03, 0.006), (0.25, C_FRONT + 0.05, 0.004)], 0.006, 6, 'cable')


def build_terminal(mb, rng):
    # The plinth under the housing, a shadow gap under its lip.
    mb.box((0.36, 0.3, BASE - 0.008), (0, 0.13, (BASE - 0.008) / 2), 'case_beige_dark', bevel=0.01)
    mb.box((0.33, 0.27, 0.01), (0, 0.13, BASE - 0.006), 'case_shadow')
    # The front block.
    depth = 0.19
    mb.box((2 * HW, depth, TOP - BASE), (0, FRONT + depth / 2, (TOP + BASE) / 2), 'case_beige', bevel=0.022)
    # The tube's back: a tapered loft to the rear plate, a little low (the neck), and the plate with its vents.
    back0, back1 = FRONT + depth - 0.01, 0.34
    mb.loft([chamfered(0, 0.25, HW - 0.012, 0.19, 0.04, back0), chamfered(0, 0.225, 0.14, 0.115, 0.03, back1)],
            'case_beige')
    mb.box((0.25, 0.012, 0.2), (0, back1 + 0.004, 0.225), 'case_beige_dark', bevel=0.004)
    for k in range(6):
        mb.box((0.17, 0.004, 0.008), (0, back1 + 0.0105, 0.165 + k * 0.024), 'case_shadow')
    # Vent slots across the top's back half.
    for k in range(7):
        mb.box((0.26, 0.009, 0.002), (0, FRONT + 0.09 + k * 0.014, TOP + 0.0004), 'case_shadow')

    # The bezel: a raised frame round the opening, its bottom bar deep (badge, knobs, lamp).
    ox, ow = SCREEN_W / 2 + 0.01, 0.045
    zb, zt = SCREEN_Z - SCREEN_H / 2 - 0.01, SCREEN_Z + SCREEN_H / 2 + 0.01
    z0, z1 = BASE + 0.025, TOP - 0.02
    yb = FRONT + 0.002 - BEZEL / 2  # sunk 2 mm into the housing: never coplanar with its face
    for (sx, sz, cx, cz) in (
            (2 * (ox + ow), z1 - zt, 0, (zt + z1) / 2),
            (2 * (ox + ow), zb - z0, 0, (z0 + zb) / 2),
            (ow, zt - zb, -(ox + ow / 2), SCREEN_Z),
            (ow, zt - zb, ox + ow / 2, SCREEN_Z)):
        mb.box((sx, BEZEL, sz), (cx, yb, cz), 'case_beige', bevel=0.006)
    # The tube's dark recess behind the opening (the glass is the game's: TERMINALS.compact.screen).
    mb.box((2 * ox + 0.01, 0.014, zt - zb + 0.01), (0, FRONT - 0.005, SCREEN_Z), 'tube_black')
    yf = FRONT + 0.002 - BEZEL  # the bezel's face
    mb.box((0.075, 0.004, 0.02), (-0.12, yf - 0.001, (z0 + zb) / 2), 'label')
    mb.box((0.03, 0.004, 0.006), (-0.035, yf - 0.001, (z0 + zb) / 2), 'case_beige_dark')
    for x in (0.07, 0.105):
        mb.cyl(0.011, 0.01, 0.014, 12, (x, yf - 0.006, (z0 + zb) / 2), 'plastic_black', rot=it.X90)
    mb.cyl(0.006, 0.006, 0.004, 10, (0.15, yf - 0.001, (z0 + zb) / 2), 'case_shadow', rot=it.X90)

    # The keyboard: a wedge, rising to the back.
    (y0, y1), (h0, h1) = KB, KB_H
    mb.loft([[(x, y0, 0), (x, y1, 0), (x, y1, h1), (x, y0, h0)] for x in (-KB_HW, KB_HW)], 'case_beige')
    slope = math.atan2(h1 - h0, y1 - y0)
    top = lambda y: h0 + (y - y0) * (h1 - h0) / (y1 - y0)  # noqa: E731

    def key(x, y, w, mat, d=0.03):
        mb.box((w, d, 0.012), (x, y, top(y) + 0.003), mat, rot=(slope, 0, 0), bevel=0.002)

    step, row0 = 0.032, y0 + 0.05
    for r in range(4):  # the main block, each row offset a little
        for c in range(10):
            key(-0.2 + 0.008 * r + c * step, row0 + r * 0.034, 0.028, 'key_cream')
    for c in range(10):  # the function row
        key(-0.2 + c * step, row0 + 4 * 0.034 + 0.002, 0.028, 'key_brown', d=0.022)
    for r in range(4):  # the numpad
        for c in range(3):
            key(0.148 + c * step, row0 + r * 0.034, 0.028, 'key_brown')
    # The space bar in front of the main block.
    key(-0.06, y0 + 0.017, 0.17, 'key_cream', d=0.026)
    # Its cable from the back, round the side and in under the plinth.
    it.wire(mb, [(0.17, y1 + 0.002, 0.02), (0.2, y1 + 0.03, 0.006), (0.21, FRONT + 0.04, 0.006),
                 (0.19, 0.06, 0.008), (0.175, 0.1, 0.02)], 0.005, 6, 'cable')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    preview = argv[argv.index('--preview') + 1] if '--preview' in argv else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name, spec in {**it.MATERIALS, **pl.MATERIALS, **MATERIALS}.items():
        it.make_material(name, *spec)
    out = os.path.join(it.ROOT, 'public', 'models')
    term = pl.build('terminal', build_terminal, 31)
    pl.export([term], os.path.join(out, 'terminal.glb'))
    console = pl.build('terminal_console', build_console, 32)
    pl.export([console], os.path.join(out, 'terminal_console.glb'))
    for o in (console, term):
        d = o.dimensions
        print(f'{o.name}: tris={it.tri_count(o)} size={d.x:.3f} x {d.y:.3f} x {d.z:.3f} m')

    if preview:
        scene = bpy.context.scene
        it.setup_render(scene, 128, 128)
        cam = scene.camera
        scene.render.resolution_x, scene.render.resolution_y = 1200, 1000
        scene.render.film_transparent = False
        scene.render.use_freestyle = False
        bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
        bpy.context.active_object.data.materials.append(it.make_material('ground', 0xc2a27a, 0, 0.95, 0))
        # Stand-ins for the game's glass, so the openings read; the compact beside the console.
        term.location = (-0.8, 0.1, 0)
        glass = it.make_material('glass_stand_in', 0x103a1c, 0, 0.2, 1.5)
        for x, y, z, w, h in ((-0.8, 0.1 + FRONT - 0.013, SCREEN_Z, SCREEN_W, SCREEN_H),
                              (0, C_TUBE - 0.002, C_SCREEN_Z, C_SCREEN_W, C_SCREEN_H)):
            bpy.ops.mesh.primitive_plane_add(size=1, location=(x, y, z), rotation=(math.pi / 2, 0, 0))
            g = bpy.context.active_object
            g.scale = (w, h, 1)
            g.data.materials.append(glass)
        cam.data.type = 'PERSP'
        cam.data.lens = 35
        cam.data.clip_end = 100
        it.aim(cam, Vector((-0.35, 0, 0.28)), 2.6)
        if '--close' in argv:  # the console from its front left, close
            cam.location = Vector((-0.7, -1.3, 0.75))
            cam.rotation_euler = (Vector((0, -0.1, 0.25)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.abspath(preview)
        bpy.ops.render.render(write_still=True)


main()
