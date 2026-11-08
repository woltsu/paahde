"""The net terminal (src/world/netTerminal.ts): an old beige mainframe terminal, CRT and keyboard, for anywhere a
console stands (a station, a bunker, the lab). Its screen is not in the model: src/world/netTerminal.ts puts its own
bulged glass in the bezel's opening (`TERMINAL_SCREEN` there; SCREEN here matches) and streams code on it.

    blender -b --python tools/blender/terminal.py                       # model
    blender -b --python tools/blender/terminal.py -- --preview out.png  # also a perspective preview render

Writes public/models/terminal.glb, one object `terminal`, with the helpers of tools/blender/placeables.py and
tools/blender/items.py.

A deep CRT housing on a plinth: the front block with a raised bezel round the tube's dark recess (a badge, two knobs and
a power lamp on its deep bottom bar, vent slots on top), the tube's tapered back with its rear plate; in front a wedge
keyboard (main keys, a brown function row, a numpad, the space bar) and its cable round to the plinth.

Blender is Z-up; the glTF exporter converts to Y-up, game +Z (the screen's facing) = Blender -Y. Units are metres,
origin at the footprint's centre on the floor. Output is deterministic.
"""

import math
import os
import sys

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
}

# The screen's opening (src/world/netTerminal.ts TERMINAL_SCREEN: glTF centre (0, SCREEN_Z, front), size W x H).
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
    # The tube's dark recess behind the opening (the glass is the game's: TERMINAL_SCREEN).
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
    d = term.dimensions
    print(f'{term.name}: tris={it.tri_count(term)} size={d.x:.3f} x {d.y:.3f} x {d.z:.3f} m')

    if preview:
        scene = bpy.context.scene
        it.setup_render(scene, 128, 128)
        cam = scene.camera
        scene.render.resolution_x, scene.render.resolution_y = 1200, 1000
        scene.render.film_transparent = False
        scene.render.use_freestyle = False
        bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
        bpy.context.active_object.data.materials.append(it.make_material('ground', 0xc2a27a, 0, 0.95, 0))
        # A stand-in for the game's glass, so the opening reads.
        bpy.ops.mesh.primitive_plane_add(size=1, location=(0, FRONT - 0.013, SCREEN_Z), rotation=(math.pi / 2, 0, 0))
        g = bpy.context.active_object
        g.scale = (SCREEN_W, SCREEN_H, 1)
        g.data.materials.append(it.make_material('glass_stand_in', 0x103a1c, 0, 0.2, 1.5))
        cam.data.type = 'PERSP'
        cam.data.lens = 35
        cam.data.clip_end = 100
        it.aim(cam, Vector((0, 0, 0.22)), 1.6)
        scene.render.filepath = os.path.abspath(preview)
        bpy.ops.render.render(write_still=True)


main()
