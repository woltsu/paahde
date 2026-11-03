# Blaster: the heavy beam gun, after the laser rifle. Someone's industrial cutting laser built into a carbine: a
# boxy receiver in chipped yellow machine paint, a straight polymer stock with a rubber butt pad, a rubber pistol
# grip, a carry handle with the rear sight on top (no scope), a big capacitor drum along the left of the receiver
# with glowing windows, a square cell where the magazine was, and a chunky barrel shroud: steel bands with a glowing
# core and a copper winding showing between them, a ribbed rubber handguard under it, big square heat fins and a
# flared emitter bell with the lens at the front. Thick cables from the capacitor into the shroud, a hazard stripe
# round the shroud. ~1.11 m long, stylised; much heavier and bulkier than the rifle (a 75 mm wide, 125 mm deep
# receiver, a 92 mm shroud).
#
# Used by hands.py (held in both hands of the first-person viewmodel on the empty `BlasterMount`, where the game
# draws public/models/blaster.glb; hands.py only places it). Bake and export blaster.glb:
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/models/blaster.py
#
# Same frames as rifle.py: modelled in the "natural" frame (origin at the middle of the pistol grip, where the fist
# closes, +Y forward along the bore, +Z up, +X the gun's right); build() turns the mesh 180° about Z (FLIP), so in
# glTF the muzzle is +Z, up +Y. Materials are baked into one atlas ('Blaster'), except the emissive 'BlasterGlow'
# (the core between the shroud bands and fins, the lens, the capacitor windows and the cell's charge strip), which
# the game pulses.
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scmats  # noqa: E402
from sclib import V, catmull, circle_profile, cylinder, join, loft, rect_profile, rounded_box, sweep  # noqa: E402
from types import SimpleNamespace  # noqa: E402
from mathutils import Matrix  # noqa: E402
from rifle import aring, glow, lerp_prof, tube, yring  # noqa: E402

FLIP = Matrix.Rotation(math.pi, 4, 'Z')

# Modelled at the numbers below, then the whole gun is scaled by SCALE about PIVOT (the receiver's floor over the grip),
# except what the hand holds (HAND_SIZED: the pistol grip, its cap, the trigger and its guard), which keep their size.
# HANDS holds the as-built numbers hands.py fits the hands to; muzzle_local() / eye_local() give as-built points.
SCALE = 1.18
BZ = 0.100  # bore height above the grip origin
RAKE = 18  # pistol grip rake (deg): its top leans forward
GRIP_R = 0.0145  # radius of the cylinder the hand closes on
GRIP_TOP, GRIP_BOT = 0.048, -0.060  # grip extent along its axis from the origin
REC_Y0, REC_Y1 = -0.112, 0.205  # receiver
REC_Z0, REC_Z1 = 0.044, 0.150
REC_W = 0.064
BUTT_Y = -0.345
SH_Y0, SH_Y1 = 0.205, 0.440  # barrel shroud (bands round the glowing core)
SH_R = 0.039
HG_Y0, HG_Y1 = 0.215, 0.375  # rubber handguard under the shroud
HG_R = 0.025  # handguard radius the support hand closes on (its axis HG_Z, under the bore)
HG_Z = BZ - 0.027
FIN_Y0, FIN_Y1 = 0.448, 0.530
MUZZLE_Y = 0.592
CH_Z = REC_Z1 + 0.034  # carry handle's top
REAR_Y = -0.080  # back face of the rear sight
SIGHT_Z = CH_Z + 0.010  # the sight line: rear notch bottom, front post top
FRONT_Y = 0.418  # front sight post
CAP_R = 0.027
CAP_X, CAP_Z = -REC_W / 2 - CAP_R + 0.006, BZ + 0.004  # capacitor drum along the left side
CAP_Y0, CAP_Y1 = -0.070, 0.160
TN = 16

TRIGGER = ((0, 0.050, REC_Z0 + 0.001), (0, 0.048, REC_Z0 - 0.011), (0, 0.042, REC_Z0 - 0.021))
GRIP_AXIS = V((0, math.sin(math.radians(RAKE)), math.cos(math.radians(RAKE))))  # bottom -> top
PIVOT = V((0, 0, REC_Z0))
HAND_SIZED = {'Grip', 'GripCap', 'Guard', 'Trigger'}


def sc(p):
    """A modelled point as built (natural frame)."""
    return PIVOT + (V(p) - PIVOT) * SCALE


def materials():
    return {
        'paint': scmats.metal('BlasterPaint', '#8a8478', '#4a4136', rough=0.4, dust=0.5, dirt=0.5, scratches=0.6,
                              paint='#d4a020'),
        'steel': scmats.metal('BlasterSteel', '#8e8f8a', '#4c4944', rough=0.34, dust=0.45, dirt=0.9, scratches=0.8),
        'dark': scmats.metal('BlasterDark', '#45474a', '#232120', rough=0.45, dust=0.45, dirt=0.8, scratches=0.6),
        'copper': scmats.metal('BlasterCopper', '#c87a45', '#5e3a22', rough=0.3, dust=0.3, scratches=0.4),
        'poly': scmats.plain('BlasterPoly', '#2e2c29', rough=0.7, dust=0.6),
        'rubber': scmats.plain('BlasterRubber', '#1c1a19', rough=0.88, dust=0.6),
        'stripe': scmats.metal('BlasterStripe', '#2a2826', '#1a1816', rough=0.5, dust=0.6, scratches=0.6, paint='#141312'),
        'red': scmats.plain('BlasterWireRed', '#8a2216', rough=0.55, dust=0.4),
        'black': scmats.plain('BlasterWireBlack', '#1e1c1a', rough=0.5, dust=0.4),
        'glow': glow('BlasterGlow', '#ffa524', 4.0),
    }


# stock side profile: (y, top z, bottom z, half width): straight back from the receiver (in line with the bore, the
# sights up on the carry handle), deepening to a big butt
STOCK = [(REC_Y0 + 0.004, REC_Z1 - 0.012, REC_Z0 + 0.006, 0.0285), (-0.140, REC_Z1 - 0.018, 0.040, 0.0265),
         (-0.200, BZ + 0.024, 0.012, 0.0250), (-0.270, BZ + 0.022, -0.022, 0.0265),
         (-0.320, BZ + 0.022, -0.044, 0.0285), (BUTT_Y + 0.008, BZ + 0.021, -0.050, 0.0295)]


def stock_ring(y, grow=0.0, n=TN):
    top, bot, hw = lerp_prof(STOCK, y)
    return yring(y, 0.0, (top + bot) / 2, hw + grow, (top - bot) / 2 + grow, 3.2, n)


def build_parts(M):
    objs, glows = [], []
    side = V((1, 0, 0))
    # ---- receiver: a tall box with rounded edges, a raised top plate, vents on the right
    rec = []
    for y, top in ((REC_Y0, REC_Z1 - 0.008), (REC_Y0 + 0.008, REC_Z1), (REC_Y1 - 0.012, REC_Z1), (REC_Y1, REC_Z1 - 0.006)):
        rec.append(yring(y, 0, (top + REC_Z0) / 2, REC_W / 2, (top - REC_Z0) / 2, 4.0, 24))
    objs.append(loft('Receiver', rec, M['paint'], cap_start=True, cap_end=True))
    for k in range(4):  # vent slots on the right
        objs.append(rounded_box('Vent', (REC_W / 2 + 0.0002, 0.075 + 0.026 * k, BZ + 0.012), (0.003, 0.010, 0.042),
                                M['dark'], bevel=0.001, segments=1))
    lo, hi = REC_Z0 + 0.014, REC_Z1 - 0.014
    for y, z in ((-0.095, lo), (0.188, lo), (0.188, hi), (-0.095, hi), (0.040, REC_Z0 + 0.012)):
        for sx in (1, -1):
            objs.append(cylinder('Bolt', (sx * REC_W / 2, y, z), (sx * (REC_W / 2 + 0.002), y, z), 0.0040, M['steel'], n=6))
    objs.append(rounded_box('TopPlate', (0, 0.045, REC_Z1 + 0.002), (REC_W - 0.010, 0.27, 0.006), M['dark'], bevel=0.002,
                            segments=1))
    # charging lever on the right
    objs.append(rounded_box('Lever', (REC_W / 2 + 0.007, 0.150, REC_Z1 - 0.024), (0.012, 0.034, 0.015), M['steel'],
                            bevel=0.003, segments=1))
    # ---- carry handle: two posts and a bridge, the rear sight ears on its back, the front post on the shroud
    for y in (-0.064, 0.120):
        objs.append(rounded_box('HandlePost', (0, y, (REC_Z1 + CH_Z) / 2), (0.024, 0.026, CH_Z - REC_Z1 + 0.004),
                                M['dark'], bevel=0.003, segments=1))
    br = [V((0, y, z)) for y, z in ((-0.076, CH_Z - 0.008), (-0.050, CH_Z - 0.002), (0.0, CH_Z), (0.100, CH_Z),
                                    (0.132, CH_Z - 0.008))]
    objs.append(sweep('Handle', catmull(br, 3), rect_profile(0.026, 0.016, 0.005), M['dark'], up_fn=lambda i: V((1, 0, 0))))
    for sx in (1, -1):
        objs.append(rounded_box('RearSight', (sx * 0.0068, REAR_Y + 0.008, (CH_Z + SIGHT_Z + 0.006) / 2),
                                (0.0060, 0.014, SIGHT_Z + 0.006 - CH_Z + 0.004), M['dark'], bevel=0.0012, segments=1))
    objs.append(rounded_box('RearBase', (0, REAR_Y + 0.008, (CH_Z + SIGHT_Z) / 2), (0.020, 0.014, SIGHT_Z - CH_Z + 0.002),
                            M['dark'], bevel=0.0012, segments=1))
    ft = BZ + SH_R
    objs.append(rounded_box('FrontBase', (0, FRONT_Y, ft + 0.006), (0.020, 0.018, 0.014), M['dark'], bevel=0.002, segments=1))
    objs.append(rounded_box('FrontPost', (0, FRONT_Y, (ft + SIGHT_Z) / 2 + 0.003), (0.0034, 0.008, SIGHT_Z - ft - 0.006),
                            M['dark'], bevel=0.0008, segments=1))
    for sx in (1, -1):  # ears guarding the post
        objs.append(rounded_box('FrontEar', (sx * 0.0085, FRONT_Y, (ft + SIGHT_Z) / 2 + 0.002), (0.003, 0.014,
                                SIGHT_Z - ft - 0.002), M['dark'], bevel=0.001, segments=1))
    # ---- stock (polymer), cheek riser, rubber butt pad, a sling loop
    ys = [REC_Y0 - 0.002, -0.140, -0.170, -0.200, -0.235, -0.270, -0.300, -0.320, BUTT_Y + 0.008]
    objs.append(loft('Stock', [stock_ring(y) for y in ys], M['poly'], cap_start=True))
    objs.append(loft('ButtPad', [stock_ring(BUTT_Y + 0.009, 0.0012), stock_ring(BUTT_Y + 0.002, 0.0018),
                                 stock_ring(BUTT_Y - 0.004, 0.0010), stock_ring(BUTT_Y - 0.006, -0.004)],
                     M['rubber'], cap_end=True))
    objs.append(rounded_box('Cheek', (0, -0.255, BZ + 0.026), (0.042, 0.090, 0.010), M['rubber'], bevel=0.003, segments=1))
    objs.append(loft('StockBand', [stock_ring(y, g) for y, g in ((-0.150, 0.0), (-0.152, 0.0016), (-0.170, 0.0016),
                                                                   (-0.172, 0.0))], M['paint'], closed=True))
    # ---- pistol grip (rubber), along GRIP_AXIS, finger swells at the front
    gr = []
    for t, rx, ry in ((GRIP_TOP + 0.004, 0.0128, 0.0168), (GRIP_TOP - 0.004, 0.0132, 0.0170), (0.03, 0.0132, 0.0168),
                      (0.0, 0.0134, 0.0172), (-0.03, 0.0137, 0.0178), (GRIP_BOT + 0.006, 0.0140, 0.0184),
                      (GRIP_BOT, 0.0128, 0.0170)):
        gr.append(aring(GRIP_AXIS * t, -GRIP_AXIS, side, rx, ry, 2.4, 14))
    objs.append(loft('Grip', gr, M['rubber'], cap_start=True, cap_end=True))
    objs.append(loft('GripCap', [aring(GRIP_AXIS * (GRIP_BOT + 0.001), -GRIP_AXIS, side, 0.0142, 0.0186, 2.4, 14),
                                 aring(GRIP_AXIS * (GRIP_BOT - 0.005), -GRIP_AXIS, side, 0.0112, 0.0150, 2.4, 14)],
                     M['dark'], cap_end=True))
    # ---- trigger guard + trigger
    tg = [V((0, 0.010, REC_Z0 - 0.001)), V((0, 0.013, REC_Z0 - 0.024)), V((0, 0.036, REC_Z0 - 0.034)),
          V((0, 0.068, REC_Z0 - 0.030)), V((0, 0.080, REC_Z0 - 0.004))]
    objs.append(sweep('Guard', catmull(tg, 3), rect_profile(0.012, 0.0036), M['dark'], up_fn=lambda i: V((1, 0, 0))))
    objs.append(sweep('Trigger', catmull([V(p) for p in TRIGGER], 3), rect_profile(0.006, 0.0035, 0.001), M['steel'],
                      up_fn=lambda i: V((1, 0, 0))))
    # ---- cell: a square block where the magazine was, a charge strip down each side
    cy0, cy1, cz1 = 0.105, 0.184, REC_Z0 - 0.078
    objs.append(rounded_box('Cell', (0, (cy0 + cy1) / 2 + 0.004, (REC_Z0 + 0.004 + cz1) / 2), (0.056, cy1 - cy0,
                            REC_Z0 + 0.004 - cz1), M['paint'], bevel=0.005, segments=2,
                            rot=Matrix.Rotation(math.radians(-8), 3, 'X')))
    objs.append(rounded_box('CellFoot', (0, (cy0 + cy1) / 2 + 0.013, cz1 - 0.001), (0.059, cy1 - cy0 + 0.004, 0.009),
                            M['rubber'], bevel=0.003, segments=1, rot=Matrix.Rotation(math.radians(-8), 3, 'X')))
    for sx in (1, -1):
        glows.append(rounded_box('CellGlow', (sx * 0.0282, (cy0 + cy1) / 2 + 0.008, (REC_Z0 + cz1) / 2 - 0.002),
                                 (0.0014, 0.010, 0.046), M['glow'], bevel=0.0005, segments=1,
                                 rot=Matrix.Rotation(math.radians(-8), 3, 'X')))
    objs.append(rounded_box('Latch', (0, cy1 + 0.010, REC_Z0 - 0.004), (0.026, 0.012, 0.010), M['steel'], bevel=0.002,
                            segments=1))
    # ---- capacitor drum along the left: copper end caps, steel bands, glowing windows between
    cz = CAP_Z
    objs.append(cylinder('CapBody', (CAP_X, CAP_Y0, cz), (CAP_X, CAP_Y1, cz), CAP_R * 0.86, M['dark'], n=16))
    nwin = 4
    seg = (CAP_Y1 - CAP_Y0 - 0.030) / nwin
    for k in range(nwin + 1):
        y = CAP_Y0 + 0.015 + seg * k
        objs.append(cylinder('CapBand', (CAP_X, y - 0.009, cz), (CAP_X, y + 0.009, cz), CAP_R, M['steel'], n=16,
                             rings_extra=[(0.15, 1.04), (0.85, 1.04)]))
        if k < nwin:
            glows.append(cylinder('CapWindow', (CAP_X, y + 0.009, cz), (CAP_X, y + seg - 0.009, cz), CAP_R * 0.93, M['glow'],
                                  n=16, cap=False))
    for y0, y1 in ((CAP_Y0 - 0.010, CAP_Y0), (CAP_Y1, CAP_Y1 + 0.010)):
        objs.append(cylinder('CapCap', (CAP_X, y0, cz), (CAP_X, y1, cz), CAP_R * 1.06, M['copper'], n=16,
                             rings_extra=[(0.5, 1.0)]))
    for y in (-0.030, 0.120):  # straps holding it to the receiver
        objs.append(rounded_box('CapStrap', (CAP_X + 0.012, y, cz), (0.028, 0.014, CAP_R * 2 + 0.006), M['paint'],
                                bevel=0.003, segments=1))
    objs.append(cylinder('CapTerminal', (CAP_X, CAP_Y1 + 0.010, cz), (CAP_X, CAP_Y1 + 0.024, cz), 0.0075, M['copper'], n=8))
    # ---- barrel shroud: steel bands round the glowing core, a copper winding between them, a hazard stripe
    glows.append(tube('Core', [(SH_Y0 - 0.004, SH_R - 0.007), (FIN_Y1 + 0.004, SH_R - 0.007)], M['glow'], n=14, cz=BZ,
                      cap0=False, cap1=False))
    nb = 5
    gap = 0.012
    band = (SH_Y1 - SH_Y0 - gap * (nb - 1)) / nb
    for k in range(nb):
        y0 = SH_Y0 + k * (band + gap)
        mat = M['stripe'] if k == nb - 1 else M['steel'] if k else M['paint']
        objs.append(tube('Band', [(y0, SH_R - 0.003), (y0 + 0.002, SH_R), (y0 + band - 0.002, SH_R), (y0 + band, SH_R - 0.003)],
                         mat, n=20, cz=BZ))
    hel = []
    nturn = 26
    for k in range(nturn * 6 + 1):
        f = k / (nturn * 6)
        a = 2 * math.pi * nturn * f
        y = SH_Y0 + 0.004 + (SH_Y1 - SH_Y0 - 0.008) * f
        hel.append(V(((SH_R - 0.0055) * math.cos(a), y, BZ + (SH_R - 0.0055) * math.sin(a))))
    objs.append(sweep('Winding', hel, circle_profile(0.0025, 4), M['copper'], cap=True))
    for k in range(3):  # tie rods along the shroud
        a = math.radians(90 + 120 * k + 60)
        p = ((SH_R + 0.0025) * math.cos(a), BZ + (SH_R + 0.0025) * math.sin(a))
        objs.append(cylinder('TieRod', (p[0], SH_Y0 - 0.004, p[1]), (p[0], FIN_Y1 + 0.004, p[1]), 0.0032, M['steel'], n=6))
    # rubber handguard under the shroud, ribbed
    hg = []
    y = HG_Y0
    prof = [(HG_Y0, 0.86)]
    while y < HG_Y1 - 0.012:
        prof += [(y + 0.003, 1.0), (y + 0.011, 1.0), (y + 0.014, 0.95)]
        y += 0.016
    prof.append((HG_Y1, 0.86))
    for y, s in prof:
        hg.append(yring(y, 0, HG_Z, HG_R * s * 1.04, HG_R * s, 2.4, 18))
    objs.append(loft('Handguard', hg, M['rubber'], cap_start=True, cap_end=True))
    # ---- heat fins (square, big) round the core, the emitter bell, the lens
    fy = FIN_Y0 + 0.004
    while fy < FIN_Y1:
        objs.append(loft('Fin', [yring(fy + d, 0, BZ, r, r, 3.4, 16) for d, r in
                                 ((-0.0026, SH_R - 0.010), (-0.0026, SH_R + 0.009), (0.0, SH_R + 0.011), (0.0026, SH_R + 0.009),
                                  (0.0026, SH_R - 0.010))], M['dark'], closed=True))
        fy += 0.0112
    objs.append(tube('FinCollar', [(FIN_Y0 - 0.008, SH_R - 0.004), (FIN_Y0 - 0.004, SH_R + 0.002), (FIN_Y0 + 0.0, SH_R + 0.002)],
                     M['dark'], n=18, cz=BZ))
    r = SH_R
    objs.append(tube('Bell', [(FIN_Y1, r - 0.009), (FIN_Y1 + 0.006, r - 0.004), (MUZZLE_Y - 0.022, r - 0.001),
                              (MUZZLE_Y - 0.006, r + 0.006), (MUZZLE_Y, r + 0.007), (MUZZLE_Y, r - 0.001),
                              (MUZZLE_Y - 0.010, r - 0.009)], M['steel'], n=20, cz=BZ, cap0=True, cap1=False))
    objs.append(tube('BellRing', [(MUZZLE_Y - 0.030, r - 0.0005), (MUZZLE_Y - 0.028, r + 0.003), (MUZZLE_Y - 0.020, r + 0.003),
                                  (MUZZLE_Y - 0.018, r)], M['stripe'], n=20, cz=BZ, cap0=False, cap1=False))
    glows.append(loft('Lens', [yring(MUZZLE_Y - 0.010, 0, BZ, r - 0.0088, r - 0.0088, 2, 16),
                               yring(MUZZLE_Y - 0.016, 0, BZ, 0.008, 0.008, 2, 16)], M['glow'], cap_end=True, flip=True))
    # ---- cables: from the capacitor's front terminal round under the left of the shroud into the fin collar
    for k, (mat, off) in enumerate(((M['red'], 0.0), (M['black'], 0.007))):
        pts = [V((CAP_X, CAP_Y1 + 0.016, CAP_Z - 0.004 + off * 0.5)), V((CAP_X + 0.002, CAP_Y1 + 0.050, CAP_Z - 0.012 + off)),
               V((-SH_R - 0.005, 0.250, BZ - 0.024 + off)), V((-SH_R - 0.007, 0.330, BZ - 0.016 + off)),
               V((-SH_R - 0.005, 0.410, BZ - 0.014 + off)), V((-SH_R + 0.001, FIN_Y0 - 0.010, BZ - 0.012 + off))]
        objs.append(sweep('Cable', catmull(pts, 3), circle_profile(0.0040, 6), mat))
    for y in (0.300, 0.400):
        objs.append(loft('Tie', [yring(y + d, -0.006, BZ - 0.007, SH_R + 0.0045, SH_R + 0.010, 2.4, 16) for d in (-0.0025, 0.0025)],
                         M['black'], closed=True))
    for o in objs + glows:  # as built: everything but what the hand holds scaled up about PIVOT
        if o.name.split('.')[0] not in HAND_SIZED:
            for v in o.data.vertices:
                v.co = sc(v.co)
            o.data.update()
    return objs, glows


def build(at=V((0, 0, 0))):
    """Build the blaster (joined mesh + the separate glow mesh) at `at`, turned to the mesh frame (muzzle -Y).
    Returns (blaster, glow)."""
    M = materials()
    objs, glows = build_parts(M)
    gun = join(objs, 'Blaster')
    gl = join(glows, 'BlasterGlowMesh')
    for o in (gun, gl):
        for v in o.data.vertices:
            v.co = FLIP.to_3x3() @ v.co + V(at)
        o.data.update()
    return gun, gl


def bake_and_export(gun, gl, out_dir, path, at, size=1024):
    """Bake into its own atlas (material 'Blaster'), origin at the grip, join the unbaked glow (material
    'BlasterGlow') and export it alone. Returns the blaster."""
    import bake
    import bpy
    bake.bake_atlas(gun, size, out_dir, tint_name='__none__', small=512, prefix='blaster')
    me = gun.data
    while len(me.materials) > 1:  # bake_atlas always adds a PlayerTint slot; there are no tint faces
        m = me.materials.pop(index=len(me.materials) - 1)
        if m and m.users == 0:
            bpy.data.materials.remove(m)
    for o in (gun, gl):
        for v in o.data.vertices:
            v.co -= V(at)
        o.data.update()
        o.location = (0, 0, 0)
    uv = gl.data.uv_layers.get('Detail')
    if uv:
        uv.name = 'Atlas'
    gun = join([gun, gl], 'Blaster')
    bake.export(None, [gun], path)
    return gun


def muzzle_local():
    """Muzzle tip on the bore (natural frame, as built)."""
    return sc((0, MUZZLE_Y, BZ))


def eye_local(relief):
    """Where the eye goes: on the sight line, `relief` behind the rear sight (natural frame, as built)."""
    return sc((0, REAR_Y, SIGHT_Z)) - V((0, relief, 0))


# what hands.py fits the hands to, as built: the grip and trigger as modelled, the receiver and handguard scaled
HANDS = SimpleNamespace(
    FLIP=FLIP, RAKE=RAKE, GRIP_AXIS=GRIP_AXIS, GRIP_R=GRIP_R, GRIP_TOP=GRIP_TOP, GRIP_BOT=GRIP_BOT, TRIGGER=TRIGGER,
    REC_W=REC_W * SCALE, REC_Y0=REC_Y0 * SCALE, REC_Y1=REC_Y1 * SCALE, REC_Z0=REC_Z0, REC_Z1=sc((0, 0, REC_Z1)).z,
    HG_Y0=HG_Y0 * SCALE, HG_Y1=HG_Y1 * SCALE, HG_Z=sc((0, 0, HG_Z)).z, HG_R=HG_R * SCALE,
    build=build, muzzle_local=muzzle_local, eye_local=eye_local)


if __name__ == '__main__':
    import bpy  # noqa: F401
    from sclib import reset_scene, tri_count
    reset_scene()
    ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
    AT = V((0, 0, 0.9))
    b, g = build(AT)
    print('BLASTER TRIS', tri_count(b), 'GLOW', tri_count(g))
    bake_and_export(b, g, os.path.join(HERE, 'out'), os.path.join(ROOT, 'public', 'models', 'blaster.glb'), AT)
