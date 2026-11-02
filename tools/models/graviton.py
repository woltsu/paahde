# Graviton pistol: a graviton beam emitter, not made by anyone out here. A sleek dark ceramic-and-metal body like a
# drawn-out teardrop, smooth seams with a violet glow running down both flanks and the back of the grip, a ribbed
# glowing coil round the nose, and in front, held off the body by three swept silver prongs, a ring with a second
# smaller one ahead of it round a floating violet core on a needle. A low dorsal ridge with two glowing ears for a
# rear sight, a glowing dot on the nose for the front one; a smooth grip with a pale pommel, a slim trigger blade in an
# open loop. ~0.27 m long, stylised: nothing like the taped-together human guns.
#
# Used by hands.py (held in the right hand of the first-person viewmodel on the empty `GravitonMount`, where the game
# draws public/models/graviton.glb; hands.py only places it). Bake and export graviton.glb:
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/models/graviton.py
#
# Same frames as pistol.py: modelled in the "natural" frame (origin at the middle of the grip, where the fist closes,
# +Y forward along the bore, +Z up, +X the pistol's right); build() turns the mesh 180° about Z (FLIP), so in glTF
# the muzzle is +Z, up +Y. Materials are baked into one atlas ('Graviton'), except the emissive 'GravitonGlow' (the
# seams, the coil, the core and the sights), which the game pulses.
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scmats  # noqa: E402
from sclib import NB, V, catmull, circle_profile, cylinder, join, loft, new_mat, rect_profile, rounded_box, srgb, sweep  # noqa: E402
from mathutils import Matrix  # noqa: E402
from rifle import aring, lerp_prof, tube, yring  # noqa: E402

FLIP = Matrix.Rotation(math.pi, 4, 'Z')

BZ = 0.060  # bore height above the grip origin
RAKE = 22  # grip rake (deg): its top leans forward
GRIP_R = 0.0150  # radius of the capsule the hand closes on
GRIP_TOP, GRIP_BOT = 0.044, -0.054  # grip extent along its axis from the origin
REC_Y0, REC_Y1 = -0.056, 0.132  # the body
REC_W = 0.030
REC_Z0, REC_Z1 = BZ - 0.022, BZ + 0.022
RING_Y, RING_R = 0.170, 0.026  # the emitter ring (its axis on the bore)
RING2_Y, RING2_R = 0.196, 0.018
MUZZLE_Y = 0.200
REAR_Y = -0.036  # back of the rear sight ears
SIGHT_Z = REC_Z1 + 0.0075  # the sight line: between the rear ears, over the front dot
TN = 20

TRIGGER = ((0, 0.036, REC_Z0 - 0.001), (0, 0.035, REC_Z0 - 0.011), (0, 0.030, REC_Z0 - 0.020))
GRIP_AXIS = V((0, math.sin(math.radians(RAKE)), math.cos(math.radians(RAKE))))  # bottom -> top

# body side profile: (y, centre z, half width, half height): a long teardrop, blunt at the back, tapering to the nose
BODY = [(REC_Y0, BZ + 0.006, 0.004, 0.005), (REC_Y0 + 0.005, BZ + 0.005, 0.0105, 0.0135),
        (-0.036, BZ + 0.002, 0.0142, 0.0205), (0.000, BZ, 0.0152, 0.0222), (0.050, BZ, 0.0148, 0.0215),
        (0.090, BZ, 0.0130, 0.0175), (0.118, BZ, 0.0108, 0.0128), (REC_Y1, BZ, 0.0085, 0.0090)]


def glow(name='GravitonGlow', hex_='#a466ff', strength=4.0):
    """Unbaked emissive: the field's violet glow (the game pulses it)."""
    m = new_mat(name)
    nb = NB(m)
    nb.principled(srgb('#1a0a33'), 0.25, 0.0, None, emission=srgb(hex_), emission_strength=strength)
    return m


def materials():
    return {
        'shell': scmats.metal('GravitonShell', '#2c2e3a', '#16171e', rough=0.22, dust=0.12, dirt=0.25, scratches=0.12),
        'trim': scmats.metal('GravitonTrim', '#b9bdcc', '#5c5e70', rough=0.16, dust=0.08, dirt=0.25, scratches=0.12),
        'inner': scmats.plain('GravitonInner', '#111117', rough=0.55, dust=0.08),
        'glow': glow(),
    }


def body_ring(y, grow=0.0, n=TN):
    zc, hw, hh = lerp_prof(BODY, y)
    return yring(y, 0, zc, hw + grow, hh + grow, 2.4, n)


def grip_ring(t, grow=0.0, n=16):
    """Grip cross-section at `t` along GRIP_AXIS: a smooth oval, fuller low down, swelling at the palm."""
    f = (t - GRIP_BOT) / (GRIP_TOP - GRIP_BOT)
    sw = 0.0012 * math.sin(math.pi * min(1.0, f * 1.4))
    rx = 0.0125 + 0.0010 * (1 - f) + sw + grow
    ry = 0.0172 + 0.0012 * (1 - f) + sw + grow
    side = V((1, 0, 0))
    fwd = (V((0, 1, 0)) - GRIP_AXIS * GRIP_AXIS.y).normalized()
    c = GRIP_AXIS * t
    return [c + side * (rx * math.cos(2 * math.pi * k / n)) + fwd * (ry * math.sin(2 * math.pi * k / n)) for k in range(n)]


def ring_path(y, r, n=24, cz=BZ):
    return [V((r * math.cos(2 * math.pi * k / n), y, cz + r * math.sin(2 * math.pi * k / n))) for k in range(n)]


def build_parts(M):
    objs, glows = [], []
    fwd = (V((0, 1, 0)) - GRIP_AXIS * GRIP_AXIS.y).normalized()
    # ---- body: the long teardrop, with a pale trim band round its waist
    ys = [REC_Y0, REC_Y0 + 0.005, -0.046, -0.036, -0.018, 0.000, 0.025, 0.050, 0.070, 0.090, 0.104, 0.118, REC_Y1]
    objs.append(loft('Body', [body_ring(y) for y in ys], M['shell'], cap_start=True, cap_end=True))
    objs.append(loft('Waist', [body_ring(y, g) for y, g in ((0.018, 0.0), (0.0195, 0.0011), (0.0255, 0.0011), (0.027, 0.0))],
                     M['trim'], closed=True))
    # glowing seams down both flanks, a little proud of the shell
    for sx in (1, -1):
        pts = []
        for y in (-0.042, -0.020, 0.010, 0.040, 0.070, 0.088):
            zc, hw, hh = lerp_prof(BODY, y)
            pts.append(V((sx * (hw + 0.0002), y, zc - 0.002)))
        glows.append(sweep('Seam', catmull(pts, 3), rect_profile(0.0012, 0.0024), M['glow'], up_fn=lambda i: V((1, 0, 0))))
    # the coil round the nose: glowing rings between pale ribs
    for k in range(4):
        y = 0.094 + 0.0085 * k
        glows.append(loft('Coil', [body_ring(y + d, g) for d, g in ((-0.002, -0.0004), (0.0, 0.0007), (0.002, -0.0004))],
                          M['glow'], closed=True))
        objs.append(loft('Rib', [body_ring(y + 0.0042 + d, g) for d, g in ((-0.0012, -0.0002), (0.0, 0.0012),
                                                                             (0.0012, -0.0002))], M['trim'], closed=True))
    # ---- sights: a low dorsal ridge at the back with two glowing ears, a glowing dot on the nose
    top = BZ + 0.0222
    objs.append(rounded_box('Ridge', (0, REAR_Y + 0.016, top - 0.001), (0.010, 0.034, 0.006), M['shell'], bevel=0.0025,
                            segments=2))
    for sx in (1, -1):
        objs.append(rounded_box('RearEar', (sx * 0.0045, REAR_Y + 0.004, (top + SIGHT_Z + 0.004) / 2),
                                (0.0035, 0.008, SIGHT_Z + 0.004 - top), M['trim'], bevel=0.0012, segments=1))
        glows.append(rounded_box('EarDot', (sx * 0.0045, REAR_Y - 0.0002, SIGHT_Z + 0.0008), (0.0018, 0.001, 0.0018),
                                 M['glow'], bevel=0.0004, segments=1))
    nz = lerp_prof(BODY, 0.084)
    objs.append(rounded_box('FrontBase', (0, 0.084, nz[0] + nz[2] + 0.0015), (0.005, 0.012, 0.005), M['trim'], bevel=0.0018,
                            segments=1))
    glows.append(cylinder('FrontDot', (0, 0.084, nz[0] + nz[2] + 0.003), (0, 0.084, SIGHT_Z), 0.0016, M['glow'], n=8))
    # ---- grip: smooth shell, a glowing strip down the back strap, a pale pommel
    gts = [GRIP_BOT + 0.004, GRIP_BOT + 0.012, -0.03, -0.01, 0.01, 0.03, GRIP_TOP + 0.006]
    objs.append(loft('Grip', [grip_ring(t) for t in gts], M['shell'], cap_start=True, cap_end=True))
    objs.append(loft('Pommel', [grip_ring(GRIP_BOT + 0.004, 0.0010), grip_ring(GRIP_BOT - 0.003, 0.0012),
                                grip_ring(GRIP_BOT - 0.007, -0.004)], M['trim'], cap_end=True))
    pts = [GRIP_AXIS * t - fwd * (0.0186 + 0.0012 * (1 - (t - GRIP_BOT) / (GRIP_TOP - GRIP_BOT)))
           for t in (GRIP_BOT + 0.008, -0.025, 0.0, 0.028)]
    glows.append(sweep('GripSeam', catmull(pts, 2), rect_profile(0.0026, 0.0014), M['glow'], up_fn=lambda i: V((0, 0, 1))))
    # ---- trigger: a slim blade in an open loop from the front of the grip to the body
    tg = [V((0, 0.012, REC_Z0 + 0.002)), V((0, 0.010, REC_Z0 - 0.018)), V((0, 0.030, REC_Z0 - 0.030)),
          V((0, 0.056, REC_Z0 - 0.022)), V((0, 0.066, REC_Z0 + 0.003))]
    objs.append(sweep('Guard', catmull(tg, 4), rect_profile(0.0055, 0.0030, 0.001), M['trim'], up_fn=lambda i: V((1, 0, 0))))
    objs.append(sweep('Trigger', catmull([V(p) for p in TRIGGER], 3), rect_profile(0.0045, 0.0028, 0.001), M['trim'],
                      up_fn=lambda i: V((1, 0, 0))))
    # ---- emitter: three swept prongs from the nose out to the ring, a second ring ahead, a core on a needle
    for k in range(3):
        a = math.radians(90 + 120 * k)
        d = V((math.cos(a), 0, math.sin(a)))
        pts = [V((0, 0.104, BZ)) + d * 0.0105, V((0, 0.128, BZ)) + d * 0.0115, V((0, 0.150, BZ)) + d * 0.020,
               V((0, RING_Y + 0.004, BZ)) + d * (RING_R + 0.001), V((0, RING2_Y, BZ)) + d * (RING2_R + 0.0015)]
        objs.append(sweep('Prong', catmull(pts, 3), rect_profile(0.0065, 0.0032, 0.001), M['trim'],
                          up_fn=lambda i, d=d: d, scale_fn=lambda i, f: (1.0 - 0.45 * f, 1.0)))
    objs.append(sweep('Ring', ring_path(RING_Y, RING_R, 28), circle_profile(0.0042, 8, 0.0028), M['shell'],
                      closed_path=True, up=V((0, 1, 0))))
    glows.append(sweep('RingGlow', ring_path(RING_Y - 0.0002, RING_R - 0.0038, 28), circle_profile(0.0011, 4), M['glow'],
                       closed_path=True, up=V((0, 1, 0))))
    objs.append(sweep('Ring2', ring_path(RING2_Y, RING2_R, 24), circle_profile(0.0030, 8, 0.0022), M['trim'],
                      closed_path=True, up=V((0, 1, 0))))
    objs.append(tube('Needle', [(REC_Y1 - 0.002, 0.0060), (0.150, 0.0024), (RING_Y - 0.006, 0.0014)], M['inner'], n=10, cz=BZ,
                     cap1=False))
    glows.append(tube('Core', [(RING_Y - 0.010, 0.0004), (RING_Y - 0.007, 0.0055), (RING_Y, 0.0075), (RING_Y + 0.007, 0.0055),
                               (RING_Y + 0.011, 0.0004)], M['glow'], n=12, cz=BZ, cap0=False, cap1=False))
    return objs, glows


def build(at=V((0, 0, 0))):
    """Build the graviton pistol (joined mesh + the separate glow mesh) at `at`, turned to the mesh frame (muzzle -Y).
    Returns (gun, glow)."""
    M = materials()
    objs, glows = build_parts(M)
    gun = join(objs, 'Graviton')
    gl = join(glows, 'GravitonGlowMesh')
    for o in (gun, gl):
        for v in o.data.vertices:
            v.co = FLIP.to_3x3() @ v.co + V(at)
        o.data.update()
    return gun, gl


def bake_and_export(gun, gl, out_dir, path, at, size=1024):
    """Bake into its own atlas (material 'Graviton'), origin at the grip, join the unbaked glow (material
    'GravitonGlow') and export it alone. Returns the gun."""
    import bake
    import bpy
    bake.bake_atlas(gun, size, out_dir, tint_name='__none__', small=512, prefix='graviton')
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
    gun = join([gun, gl], 'Graviton')
    bake.export(None, [gun], path)
    return gun


def muzzle_local():
    """The front ring's centre on the bore (natural frame)."""
    return V((0, MUZZLE_Y, BZ))


def eye_local(relief):
    """Where the eye goes: on the sight line, `relief` behind the rear sight (natural frame)."""
    return V((0, REAR_Y - relief, SIGHT_Z))


if __name__ == '__main__':
    import bpy  # noqa: F401
    from sclib import reset_scene, tri_count
    reset_scene()
    ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
    AT = V((0, 0, 0.9))
    p, g = build(AT)
    print('GRAVITON TRIS', tri_count(p), 'GLOW', tri_count(g))
    bake_and_export(p, g, os.path.join(HERE, 'out'), os.path.join(ROOT, 'public', 'models', 'graviton.glb'), AT)
