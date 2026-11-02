# Piercer: the heavy slug gun, an anti-materiel rail rifle scavenged together like the laser rifle. A long boxy steel
# receiver in worn olive paint with a heavy bolt handle on the right, a ribbed rail on top carrying a big scope (fat
# objective, turrets, an eyecup), a slug box where the magazine goes, a skeleton stock (top bar, a lower strut, a tall
# butt plate with a rubber pad, a cheek riser and a folded monopod under it). In front of the receiver the barrel is
# an open rail: two thick steel rails with copper faces above and below the bore and a glowing slit between them, held
# by square clamps with phenolic insulators; under them a spine with a ribbed rubber handguard, two capacitor cans with
# glowing windows and a folded bipod; at the end a boxy three-baffle muzzle brake with the lens in its mouth.
# ~1.32 m long, stylised: the longest and heaviest gun in the game.
#
# Used by hands.py (held in both hands of the first-person viewmodel on the empty `PiercerMount`, where the game draws
# public/models/piercer.glb; hands.py only places it). Bake and export piercer.glb:
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/models/piercer.py
#
# Same frames as rifle.py: modelled in the "natural" frame (origin at the middle of the pistol grip, where the fist
# closes, +Y forward along the bore, +Z up, +X the gun's right); build() turns the mesh 180° about Z (FLIP), so in
# glTF the muzzle is +Z, up +Y. Materials are baked into one atlas ('Piercer'), except the emissive 'PiercerGlow'
# (the slit between the rails, the capacitor windows, the slug box's charge strip and the lens), which the game pulses.
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scmats  # noqa: E402
from sclib import V, catmull, cylinder, join, loft, rect_profile, rounded_box, sweep  # noqa: E402
from mathutils import Matrix  # noqa: E402
from rifle import aring, glow, tube, yring  # noqa: E402

FLIP = Matrix.Rotation(math.pi, 4, 'Z')

BZ = 0.100  # bore height above the grip origin
RAKE = 16  # pistol grip rake (deg): its top leans forward
GRIP_R = 0.0145  # radius of the cylinder the hand closes on
GRIP_TOP, GRIP_BOT = 0.050, -0.062  # grip extent along its axis from the origin
REC_Y0, REC_Y1 = -0.130, 0.250  # receiver
REC_Z0, REC_Z1 = 0.048, 0.146
REC_W = 0.052
BUTT_Y = -0.415
RAIL_Y0, RAIL_Y1 = REC_Y1, 0.800  # the open rails
RAIL_GAP = 0.0045  # half the slit between the rails
SPINE_Z, SPINE_Y1 = BZ - 0.041, 0.712  # the spine under the rails
HG_Y0, HG_Y1 = 0.256, 0.430  # rubber handguard round the spine's back end
HG_R = 0.021  # handguard radius the support hand closes on (its axis HG_Z, under the bore)
HG_Z = SPINE_Z
BRAKE_Y0 = 0.800
MUZZLE_Y = 0.905
SCOPE_Z = BZ + 0.085  # scope axis height
SCOPE_EYE_Y = -0.075  # back face of the eyepiece
SCOPE_OBJ_Y = 0.285
CAP_X, CAP_Z, CAP_R = 0.024, SPINE_Z - 0.003, 0.015  # the two capacitor cans either side of the spine
CAP_Y0, CAP_Y1 = 0.455, 0.690
TN = 16

TRIGGER = ((0, 0.050, REC_Z0 + 0.001), (0, 0.048, REC_Z0 - 0.011), (0, 0.042, REC_Z0 - 0.021))
GRIP_AXIS = V((0, math.sin(math.radians(RAKE)), math.cos(math.radians(RAKE))))  # bottom -> top


def materials():
    return {
        'paint': scmats.metal('PiercerPaint', '#8a8478', '#4a4136', rough=0.45, dust=0.6, dirt=0.6, scratches=0.7,
                              paint='#6a6c3e'),
        'steel': scmats.metal('PiercerSteel', '#8e8f8a', '#4c4944', rough=0.34, dust=0.45, dirt=0.9, scratches=0.8),
        'dark': scmats.metal('PiercerDark', '#45474a', '#232120', rough=0.45, dust=0.45, dirt=0.8, scratches=0.6),
        'copper': scmats.metal('PiercerCopper', '#c87a45', '#5e3a22', rough=0.3, dust=0.3, scratches=0.4),
        'phenolic': scmats.plain('PiercerPhenolic', '#6e4424', rough=0.5, dust=0.5),
        'rubber': scmats.plain('PiercerRubber', '#1c1a19', rough=0.88, dust=0.6),
        'tape': scmats.cloth('PiercerTape', '#4a4844', '#2c2a28', dust=0.6, rough=0.75, weave=0.6, wrinkle=0.4,
                             stains=0.3, bleach='#6a665e', bleach_amt=0.2),
        'stripe': scmats.metal('PiercerStripe', '#8a8478', '#4a4136', rough=0.5, dust=0.6, scratches=0.6, paint='#c99a1e'),
        'glass': _glass(),
        'glow': glow('PiercerGlow', '#5ec8ff', 3.0),
    }


def _glass():
    import telescope
    return telescope.glass('PiercerLens', tint='#0a1714', edge='#1c3440')


def washer(name, y, d, cz, inner, outer, mat, p=4.0, n=16):
    """A square-ish band round the bore axis at `y`, `d` thick: inner / outer (rx, rz) half sizes."""
    return loft(name, [yring(y - d / 2, 0, cz, *inner, p, n), yring(y - d / 2, 0, cz, *outer, p, n),
                       yring(y + d / 2, 0, cz, *outer, p, n), yring(y + d / 2, 0, cz, *inner, p, n)], mat, closed=True)


def build_parts(M):
    objs, glows = [], []
    side = V((1, 0, 0))
    # ---- receiver: a long tall box with rounded edges, bolts, a heavy bolt handle on the right, vents on the left
    rec = []
    for y, top in ((REC_Y0, REC_Z1 - 0.010), (REC_Y0 + 0.010, REC_Z1), (REC_Y1 - 0.014, REC_Z1), (REC_Y1, REC_Z1 - 0.008)):
        rec.append(yring(y, 0, (top + REC_Z0) / 2, REC_W / 2, (top - REC_Z0) / 2, 4.0, 24))
    objs.append(loft('Receiver', rec, M['paint'], cap_start=True, cap_end=True))
    for y, z in ((-0.115, 0.060), (0.235, 0.060), (0.235, 0.132), (-0.115, 0.132), (0.080, 0.058), (0.150, 0.132)):
        for sx in (1, -1):
            objs.append(cylinder('Bolt', (sx * REC_W / 2, y, z), (sx * (REC_W / 2 + 0.002), y, z), 0.0036, M['steel'], n=6))
    for k in range(5):  # vent slots on the left
        objs.append(rounded_box('Vent', (-REC_W / 2 - 0.0002, 0.090 + 0.024 * k, BZ + 0.014), (0.003, 0.010, 0.034),
                                M['dark'], bevel=0.001, segments=1))
    # bolt: a slot along the right, the handle sticking out and down, a fat knob
    objs.append(rounded_box('BoltSlot', (REC_W / 2 + 0.0004, -0.030, BZ + 0.022), (0.003, 0.120, 0.012), M['dark'],
                            bevel=0.001, segments=1))
    objs.append(cylinder('BoltArm', (REC_W / 2, -0.060, BZ + 0.022), (REC_W / 2 + 0.034, -0.068, BZ + 0.002), 0.0055,
                         M['steel'], n=8))
    objs.append(cylinder('BoltKnob', (REC_W / 2 + 0.030, -0.067, BZ + 0.005), (REC_W / 2 + 0.046, -0.070, BZ - 0.004),
                         0.0105, M['dark'], n=12, rings_extra=[(0.15, 1.08), (0.85, 1.08)]))
    # ribbed rail on top for the scope
    objs.append(rounded_box('TopRail', (0, 0.040, REC_Z1 + 0.004), (0.024, 0.320, 0.008), M['dark'], bevel=0.002,
                            segments=1))
    for k in range(18):
        objs.append(rounded_box('Rib', (0, -0.110 + 0.0176 * k, REC_Z1 + 0.009), (0.028, 0.008, 0.005), M['dark'],
                                bevel=0.0012, segments=1))
    # ---- scope: two tall rings on the rail, a long tube with a fat objective, turrets, eyecup
    for y in (-0.020, 0.165):
        objs.append(rounded_box('ScopeBase', (0, y, (REC_Z1 + 0.012 + SCOPE_Z - 0.016) / 2), (0.022, 0.024,
                                SCOPE_Z - 0.016 - REC_Z1 - 0.010), M['dark'], bevel=0.003, segments=1))
        objs.append(tube('ScopeRing', [(y - 0.011, 0.0190), (y + 0.011, 0.0190)], M['dark'], n=18, cz=SCOPE_Z))
        objs.append(cylinder('RingScrew', (0.020, y, SCOPE_Z), (0.026, y, SCOPE_Z), 0.004, M['steel'], n=6))
    objs.append(tube('Scope', [(SCOPE_EYE_Y, 0.0175), (SCOPE_EYE_Y + 0.003, 0.0215), (SCOPE_EYE_Y + 0.040, 0.0215),
                               (SCOPE_EYE_Y + 0.056, 0.0165), (0.185, 0.0165), (0.217, 0.0290), (SCOPE_OBJ_Y - 0.006, 0.0305),
                               (SCOPE_OBJ_Y, 0.0290)], M['steel'], n=20, cz=SCOPE_Z, cap0=False, cap1=False))
    objs.append(tube('EyeCup', [(SCOPE_EYE_Y - 0.002, 0.0220), (SCOPE_EYE_Y + 0.016, 0.0226), (SCOPE_EYE_Y + 0.016, 0.0216)],
                     M['rubber'], n=20, cz=SCOPE_Z, cap0=False, cap1=False))
    objs.append(loft('EyeLens', [yring(SCOPE_EYE_Y + 0.001, 0, SCOPE_Z, 0.0177, 0.0177, 2, 16),
                                 yring(SCOPE_EYE_Y + 0.006, 0, SCOPE_Z, 0.007, 0.007, 2, 16)], M['glass'], cap_end=True))
    objs.append(loft('ObjLens', [yring(SCOPE_OBJ_Y - 0.004, 0, SCOPE_Z, 0.0278, 0.0278, 2, 18),
                                 yring(SCOPE_OBJ_Y - 0.010, 0, SCOPE_Z, 0.010, 0.010, 2, 18)], M['glass'], cap_end=True,
                     flip=True))
    objs.append(tube('Sunshade', [(SCOPE_OBJ_Y - 0.030, 0.0300), (SCOPE_OBJ_Y - 0.030, 0.0322), (SCOPE_OBJ_Y - 0.004, 0.0322),
                                  (SCOPE_OBJ_Y - 0.004, 0.0300)], M['tape'], n=20, cz=SCOPE_Z, cap0=False, cap1=False))
    for a, b, r in (((0, 0.090, SCOPE_Z + 0.014), (0, 0.090, SCOPE_Z + 0.034), 0.011),  # elevation
                    ((0.014, 0.090, SCOPE_Z), (0.032, 0.090, SCOPE_Z), 0.0095),  # windage
                    ((-0.014, 0.090, SCOPE_Z), (-0.028, 0.090, SCOPE_Z), 0.012)):  # parallax
        objs.append(cylinder('Turret', a, b, r, M['dark'], n=14, rings_extra=[(0.55, 1.0), (0.6, 1.1), (0.95, 1.1)]))
    objs.append(rounded_box('Saddle', (0, 0.090, SCOPE_Z), (0.034, 0.034, 0.034), M['dark'], bevel=0.008, segments=2))
    # ---- skeleton stock: a top bar, a lower strut, a tall butt plate with a rubber pad, cheek riser, monopod
    objs.append(rounded_box('StockBar', (0, (REC_Y0 + BUTT_Y + 0.02) / 2, BZ + 0.012), (0.022, REC_Y0 - BUTT_Y - 0.01, 0.022),
                            M['dark'], bevel=0.004, segments=1))
    strut = [V((0, REC_Y0 + 0.004, REC_Z0 + 0.008)), V((0, -0.200, 0.030)), V((0, -0.320, -0.016)),
             V((0, BUTT_Y + 0.016, -0.040))]
    objs.append(sweep('Strut', catmull(strut, 3), rect_profile(0.018, 0.016, 0.004), M['dark'],
                      up_fn=lambda i: V((1, 0, 0))))
    bt, bb = BZ + 0.024, -0.056  # butt plate top / bottom
    objs.append(rounded_box('ButtPlate', (0, BUTT_Y + 0.012, (bt + bb) / 2), (0.040, 0.020, bt - bb), M['paint'],
                            bevel=0.006, segments=2))
    objs.append(rounded_box('ButtPad', (0, BUTT_Y - 0.004, (bt + bb) / 2 - 0.002), (0.044, 0.016, bt - bb + 0.006),
                            M['rubber'], bevel=0.006, segments=2))
    objs.append(rounded_box('Cheek', (0, -0.262, BZ + 0.032), (0.034, 0.140, 0.026), M['paint'], bevel=0.008, segments=2))
    objs.append(rounded_box('CheekPad', (0, -0.262, BZ + 0.0455), (0.030, 0.120, 0.004), M['rubber'], bevel=0.0015,
                            segments=1))
    for y in (-0.220, -0.300):  # posts under the riser and their clamp knob
        objs.append(cylinder('CheekPost', (0, y, BZ + 0.020), (0, y, BZ + 0.024), 0.006, M['steel'], n=8))
    objs.append(cylinder('CheekKnob', (0.011, -0.200, BZ + 0.012), (0.024, -0.200, BZ + 0.012), 0.008, M['dark'], n=10))
    mz = -0.026  # the monopod, folded up under the strut
    objs.append(rounded_box('MonoClamp', (0, -0.345, mz + 0.004), (0.026, 0.026, 0.016), M['dark'], bevel=0.003, segments=1))
    objs.append(cylinder('Monopod', (0, -0.345, mz - 0.004), (0, -0.345, mz - 0.050), 0.0085, M['steel'], n=10))
    objs.append(cylinder('MonoFoot', (0, -0.345, mz - 0.050), (0, -0.345, mz - 0.060), 0.016, M['rubber'], n=12,
                         rings_extra=[(0.5, 1.05)]))
    # ---- pistol grip (rubber), along GRIP_AXIS
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
    tg = [V((0, 0.008, REC_Z0 - 0.001)), V((0, 0.011, REC_Z0 - 0.026)), V((0, 0.036, REC_Z0 - 0.036)),
          V((0, 0.070, REC_Z0 - 0.032)), V((0, 0.084, REC_Z0 - 0.004))]
    objs.append(sweep('Guard', catmull(tg, 3), rect_profile(0.013, 0.004), M['dark'], up_fn=lambda i: V((1, 0, 0))))
    objs.append(sweep('Trigger', catmull([V(p) for p in TRIGGER], 3), rect_profile(0.006, 0.0035, 0.001), M['steel'],
                      up_fn=lambda i: V((1, 0, 0))))
    # ---- slug box: a steel box where the magazine goes, a charge strip down the left, a latch, tape round it
    my0, my1, mz1 = 0.110, 0.200, REC_Z0 - 0.080
    tilt = Matrix.Rotation(math.radians(-6), 3, 'X')
    objs.append(rounded_box('SlugBox', (0, (my0 + my1) / 2 + 0.004, (REC_Z0 + 0.004 + mz1) / 2), (0.040, my1 - my0,
                            REC_Z0 + 0.004 - mz1), M['steel'], bevel=0.004, segments=2, rot=tilt))
    objs.append(rounded_box('SlugFoot', (0, (my0 + my1) / 2 + 0.009, mz1 - 0.001), (0.044, my1 - my0 + 0.006, 0.010),
                            M['dark'], bevel=0.003, segments=1, rot=tilt))
    objs.append(rounded_box('SlugTape', (0, (my0 + my1) / 2 + 0.006, REC_Z0 - 0.050), (0.0425, my1 - my0 + 0.0025, 0.016),
                            M['tape'], bevel=0.002, segments=1, rot=tilt))
    glows.append(rounded_box('SlugGlow', (-0.0204, (my0 + my1) / 2 + 0.002, REC_Z0 - 0.022), (0.0014, 0.060, 0.010),
                             M['glow'], bevel=0.0005, segments=1, rot=tilt))
    objs.append(rounded_box('Latch', (0, my1 + 0.012, REC_Z0 - 0.004), (0.026, 0.012, 0.010), M['steel'], bevel=0.002,
                            segments=1))
    # ---- the open rails: steel bars with copper faces above and below the bore, the glowing slit between
    ry = (RAIL_Y0 + RAIL_Y1) / 2
    rl = RAIL_Y1 - RAIL_Y0
    for sz in (1, -1):
        objs.append(rounded_box('Rail', (0, ry, BZ + sz * (RAIL_GAP + 0.010)), (0.018, rl, 0.016), M['steel'], bevel=0.003,
                                segments=1))
        objs.append(rounded_box('RailFace', (0, ry, BZ + sz * (RAIL_GAP + 0.0012)), (0.012, rl - 0.004, 0.0024),
                                M['copper'], bevel=0.0006, segments=1))
    glows.append(rounded_box('Slit', (0, ry, BZ), (0.006, rl - 0.002, 2 * RAIL_GAP), M['glow'], bevel=0.001, segments=1))
    # the spine under the rails, the ribbed handguard round its back end
    objs.append(rounded_box('Spine', (0, (RAIL_Y0 + SPINE_Y1) / 2, SPINE_Z), (0.030, SPINE_Y1 - RAIL_Y0, 0.026),
                            M['dark'], bevel=0.004, segments=1))
    hg = []
    y = HG_Y0
    prof = [(HG_Y0, 0.86)]
    while y < HG_Y1 - 0.012:
        prof += [(y + 0.003, 1.0), (y + 0.011, 1.0), (y + 0.014, 0.95)]
        y += 0.016
    prof.append((HG_Y1, 0.86))
    for y, s in prof:
        hg.append(yring(y, 0, HG_Z, HG_R * s * 1.05, HG_R * s, 2.6, 18))
    objs.append(loft('Handguard', hg, M['rubber'], cap_start=True, cap_end=True))
    # square clamps round the rails and the spine, phenolic insulators either side of the slit
    cz = (BZ + RAIL_GAP + 0.018 + SPINE_Z - 0.013) / 2
    chz = (BZ + RAIL_GAP + 0.018 - (SPINE_Z - 0.013)) / 2
    for k, y in enumerate((0.258, 0.445, 0.520, 0.595, 0.670, 0.745, 0.792)):
        objs.append(washer('Clamp', y, 0.016 if k < 6 else 0.020, cz, (0.0165, chz - 0.002), (0.024, chz + 0.004),
                           M['paint'] if k in (0, 6) else M['dark']))
        for sx in (1, -1):
            objs.append(rounded_box('Insulator', (sx * 0.0115, y, BZ), (0.006, 0.020, 0.030), M['phenolic'], bevel=0.0015,
                                    segments=1))
    objs.append(washer('Stripe', 0.774, 0.020, cz, (0.0165, chz - 0.002), (0.0235, chz + 0.0025), M['stripe']))
    # the two capacitor cans either side of the spine, glowing windows between wide steel bands
    nwin = 3
    seg = (CAP_Y1 - CAP_Y0 - 0.040) / nwin
    for sx in (1, -1):
        x = sx * CAP_X
        objs.append(cylinder('CapBody', (x, CAP_Y0, CAP_Z), (x, CAP_Y1, CAP_Z), CAP_R * 0.86, M['dark'], n=14))
        for k in range(nwin + 1):
            y = CAP_Y0 + 0.020 + seg * k
            objs.append(cylinder('CapBand', (x, y - 0.016, CAP_Z), (x, y + 0.016, CAP_Z), CAP_R, M['steel'], n=14,
                                 rings_extra=[(0.15, 1.04), (0.85, 1.04)]))
            if k < nwin:
                glows.append(cylinder('CapWindow', (x, y + 0.016, CAP_Z), (x, y + seg - 0.016, CAP_Z), CAP_R * 0.93,
                                      M['glow'], n=14, cap=False))
        for y0, y1 in ((CAP_Y0 - 0.008, CAP_Y0), (CAP_Y1, CAP_Y1 + 0.008)):
            objs.append(cylinder('CapCap', (x, y0, CAP_Z), (x, y1, CAP_Z), CAP_R * 1.05, M['copper'], n=14))
    # the folded bipod: a hinge block at the spine's front, two legs laid back under the cans, rubber feet
    objs.append(rounded_box('BipodHinge', (0, SPINE_Y1 - 0.012, SPINE_Z - 0.020), (0.040, 0.024, 0.016), M['dark'],
                            bevel=0.003, segments=1))
    for sx in (1, -1):
        x = sx * 0.013
        objs.append(cylinder('BipodLeg', (x, SPINE_Y1 - 0.012, SPINE_Z - 0.024), (x, 0.540, SPINE_Z - 0.026), 0.0058,
                             M['steel'], n=8))
        objs.append(cylinder('BipodInner', (x, 0.540, SPINE_Z - 0.026), (x, 0.470, SPINE_Z - 0.027), 0.0042, M['steel'],
                             n=8))
        objs.append(rounded_box('BipodFoot', (x, 0.462, SPINE_Z - 0.028), (0.012, 0.018, 0.012), M['rubber'], bevel=0.004,
                                segments=1))
    # ---- the muzzle brake: top and bottom plates, three baffles, the bore and the lens in the mouth
    by = (BRAKE_Y0 + MUZZLE_Y) / 2
    for sz in (1, -1):
        objs.append(rounded_box('BrakePlate', (0, by, BZ + sz * 0.025), (0.056, MUZZLE_Y - BRAKE_Y0, 0.010), M['dark'],
                                bevel=0.003, segments=1))
    for y in (BRAKE_Y0 + 0.008, BRAKE_Y0 + 0.044, MUZZLE_Y - 0.026, MUZZLE_Y - 0.007):
        objs.append(rounded_box('Baffle', (0, y, BZ), (0.064, 0.014, 0.046), M['dark'], bevel=0.003, segments=1))
    objs.append(cylinder('Bore', (0, BRAKE_Y0, BZ), (0, MUZZLE_Y - 0.004, BZ), 0.011, M['steel'], n=12))
    objs.append(tube('Mouth', [(MUZZLE_Y - 0.0005, 0.016), (MUZZLE_Y + 0.002, 0.016), (MUZZLE_Y + 0.002, 0.011),
                               (MUZZLE_Y - 0.002, 0.010)], M['steel'], n=16, cz=BZ, cap0=False, cap1=False))
    glows.append(loft('Lens', [yring(MUZZLE_Y - 0.001, 0, BZ, 0.0102, 0.0102, 2, 14),
                               yring(MUZZLE_Y - 0.004, 0, BZ, 0.004, 0.004, 2, 14)], M['glow'], cap_end=True, flip=True))
    return objs, glows


def build(at=V((0, 0, 0))):
    """Build the piercer (joined mesh + the separate glow mesh) at `at`, turned to the mesh frame (muzzle -Y).
    Returns (piercer, glow)."""
    M = materials()
    objs, glows = build_parts(M)
    gun = join(objs, 'Piercer')
    gl = join(glows, 'PiercerGlowMesh')
    for o in (gun, gl):
        for v in o.data.vertices:
            v.co = FLIP.to_3x3() @ v.co + V(at)
        o.data.update()
    return gun, gl


def bake_and_export(gun, gl, out_dir, path, at, size=1024):
    """Bake into its own atlas (material 'Piercer'), origin at the grip, join the unbaked glow (material
    'PiercerGlow') and export it alone. Returns the piercer."""
    import bake
    import bpy
    bake.bake_atlas(gun, size, out_dir, tint_name='__none__', small=512, prefix='piercer')
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
    gun = join([gun, gl], 'Piercer')
    bake.export(None, [gun], path)
    return gun


def muzzle_local():
    """Muzzle tip on the bore (natural frame)."""
    return V((0, MUZZLE_Y, BZ))


def eye_local(relief):
    """Where the eye goes: on the scope axis, `relief` behind the eyepiece (natural frame)."""
    return V((0, SCOPE_EYE_Y - relief, SCOPE_Z))


if __name__ == '__main__':
    import bpy  # noqa: F401
    from sclib import reset_scene, tri_count
    reset_scene()
    ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
    AT = V((0, 0, 0.9))
    b, g = build(AT)
    print('PIERCER TRIS', tri_count(b), 'GLOW', tri_count(g))
    bake_and_export(b, g, os.path.join(HERE, 'out'), os.path.join(ROOT, 'public', 'models', 'piercer.glb'), AT)
