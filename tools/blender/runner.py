"""The runner: a four-legged hunting robot (built the size of a horse; the game draws it RUNNER.scale times that), after Spot's layout (a long box body, a hip at each
corner, every knee bending backwards) but built to frighten: an armoured wedge of a hull with blade fins down the spine,
a low predator's head with a spider's cluster of red eyes and two mandible blades, bladed shins ending in claws.

    blender -b --python tools/blender/runner.py                       # writes public/models/runner.glb
    blender -b --python tools/blender/runner.py -- --preview <dir>    # also renders PNG previews into <dir>

One top-level node per part, no parenting, identity transforms; the game assembles it (src/world/runner.ts). All
coordinates are three.js (Y up, +Z forward), metres; meshes are built in three.js coordinates and turned into
Blender's Z-up frame just before export, so the glTF comes back with exactly these numbers. Numbers the rig needs are
in shared/runner.ts and must match the constants below.

  Runner_Body     origin = body centre, forward +Z. Hip sockets at (+-SOCK_X, SOCK_Y, +-SOCK_Z): each hip's
                  abduction axis runs along Z through its socket. Neck pivot at NECK.
  Runner_Head     origin = neck pivot; yaws about Y, then pitches about X (+ = nose down). Eyes: RunnerEye.
  Runner_JawL/R   origin = hinge at (+-JAW) in the head, turning about Y (+ opens the left jaw, - the right): a great
                  curved pincer, serrated inside, the tips crossing in front of the snout when shut.
  Runner_BodyArmed  the armed variant's body: the same, but a turret ring on the saddle (at MOUNT) where the middle
                  spine blades were.
  Runner_ArmBase  origin = MOUNT; yaws about Y. The shoulder's pitch axis is X through SHOULDER.
  Runner_ArmUpper origin = shoulder, runs along +Z to the elbow at (0, 0, UPPER); turns about X (+ = down, as
                  three.js: Rx maps +Z to (0, -sin, cos)).
  Runner_ArmFore  origin = elbow, along +Z to the wrist at (0, 0, FORE); turns about X.
  Runner_GunMount origin = wrist pivot, fixed to the wrist: the knuckle, a pylon and two rails under the gun's belly.
  Runner_Rifle    origin = wrist pivot (at rest; it slides back along -Z on the mount's rails up to RECOIL as it fires), turns about X: under the gun's belly at its balance point (the heavy housing
                  behind, the rails ahead), the gun entirely above it (y > 0.06). Rails along +Z, muzzle at
                  (0, 0.2, MUZZLE). The rail channel, coils, core and muzzle are RunnerGunGlow.
  Runner_HipL/R   origin = socket, rolls about local Z (abduction). The thigh's pitch axis is local X through
                  (+-HIP_OUT, 0, 0); L is the +X (left) side, R its mirror image.
  Runner_ThighL/R origin = hip pitch joint, hangs down -Y to the knee at (0, -THIGH, 0); turns about X
                  (+ swings the knee backwards). Outer face +X on L.
  Runner_ShinL/R  origin = knee (axis X), hangs down -Y to the claw's tip at (0, -SHIN, 0): what touches the ground.

Materials are flat Principled BSDF colours (no textures); RunnerEye is the emissive one (the game pulses it),
RunnerGlow the dim vents. Output is deterministic.
"""

import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PI = math.pi

# --- the rig (shared/runner.ts) ---
SOCK_X, SOCK_Y, SOCK_Z = 0.31, -0.02, 0.70
HIP_OUT = 0.20
THIGH = 0.72
SHIN = 0.78
NECK = (0.0, 0.07, 1.0)
JAW = (0.13, -0.06, 0.34)  # the left jaw's hinge in the head (vertical axis); the right one mirrored
# --- the armed runner's gun arm (shared/runner.ts RUNNER.arm) ---
MOUNT = (0.0, 0.21, -0.05)   # the turret ring on its back (body frame): the base yaws about Y here
SHOULDER = (0.0, 0.17, 0.0)  # the shoulder's pitch axis (X) in the base
UPPER = 0.6                  # shoulder to elbow, along the upper arm's +Z
FORE = 0.55                  # elbow to wrist, along the forearm's +Z
RAIL_X = 0.06               # the gun mount's two rails, either side under the gun's belly
RAIL_Z = (-0.5, 0.3)        # where they run (the gun's shoes, at -0.25 and 0.12, slide back on them as it recoils)
RECOIL = 0.17               # how far back the gun slides firing (shared/runner.ts RUNNER.arm.recoil)
MUZZLE = 1.23                # the gun's muzzle along its +Z from the wrist pivot (its balance point, under its belly)
STAND_Y = 1.15  # body centre over level ground, standing (previews)
SCALE = 2.0  # drawn this many times the built size in the game (shared/runner.ts RUNNER.scale): the previews too

# name -> (sRGB hex, metallic, roughness, emission strength or None)
MATERIALS = {
    'RunnerIron': (0x23201e, 0.65, 0.55, None),     # near-black gunmetal frame
    'RunnerSteel': (0x6b645c, 0.8, 0.35, None),     # blades, rods, claws: bright worn edges
    'RunnerRust': (0x5e2a15, 0.45, 0.75, None),     # undersides, bands
    'RunnerCeramic': (0xbfae8e, 0.1, 0.65, None),   # sand-bleached armour
    'RunnerHazard': (0xb85a1c, 0.3, 0.6, None),     # faded hazard orange
    'RunnerDark': (0x110e0d, 0.2, 0.85, None),      # hoses, sockets, recesses
    'RunnerEye': (0xff2a0e, 0.0, 0.4, 10.0),        # the eyes (pulsed by the game)
    'RunnerGlow': (0xff3a12, 0.0, 0.5, 3.0),        # flank vents, the maw
    'RunnerGunGlow': (0xff3a12, 0.0, 0.4, 4.0),     # the rifle's coil rings and muzzle (the game flares them as it fires)
}

# three.js (Y up) -> Blender (Z up): (x, y, z) -> (x, -z, y), a +90 degree turn about X.
C = Matrix.Rotation(PI / 2, 4, 'X')


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(hex_color):
    return [srgb_to_linear(((hex_color >> s) & 0xFF) / 255) for s in (16, 8, 0)]


def make_material(name, hex_color, metallic, roughness, emission):
    mat = bpy.data.materials.new(name)
    rgb = lin(hex_color)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*rgb, 1)
        bsdf.inputs['Emission Strength'].default_value = emission
    mat.use_backface_culling = False  # double-sided: thin blades and plates
    return mat


def lerp(a, b, t):
    return a + (b - a) * t


def T(x, y=None, z=None):
    if y is None:
        return Matrix.Translation(Vector(x))
    return Matrix.Translation(Vector((x, y, z)))


def S(x, y, z):
    return Matrix.Diagonal((x, y, z, 1))


def Rx(a):
    return Matrix.Rotation(a, 4, 'X')


def Ry(a):
    return Matrix.Rotation(a, 4, 'Y')


def Rz(a):
    return Matrix.Rotation(a, 4, 'Z')


def aim(p, d):
    """Matrix putting local +Z along d at point p."""
    d = Vector(d).normalized()
    up = Vector((0, 1, 0)) if abs(d.y) < 0.95 else Vector((1, 0, 0))
    x = up.cross(d).normalized()
    y = d.cross(x)
    m = Matrix((x, y, d)).transposed().to_4x4()
    return T(p) @ m


def oct_ring(z, w, h, ch=None):
    """Chamfered rectangle across Z at z."""
    ch = ch if ch is not None else min(w, h) * 0.25
    hw, hh = w / 2, h / 2
    return [(x, y, z) for x, y in ((hw, hh - ch), (hw, -hh + ch), (hw - ch, -hh), (-hw + ch, -hh), (-hw, -hh + ch),
                                   (-hw, hh - ch), (-hw + ch, hh), (hw - ch, hh))]


def sup(a, w, h, n=0.55):
    """Superellipse point at angle a (0 = top, clockwise seen from the front): a boxy, rounded section."""
    s, c = math.sin(a), math.cos(a)
    return w / 2 * math.copysign(abs(s) ** n, s), h / 2 * math.copysign(abs(c) ** n, c)


def sup_ring(z, w, h, cy=0.0, segs=12, n=0.55):
    """Section across Z (the body and head run along it)."""
    return [(x, cy + y, z) for x, y in (sup(2 * PI * k / segs, w, h, n) for k in range(segs))]


def bone_ring(y, w, d, cz=0.0, segs=8, n=0.6):
    """Section across Y (the legs hang down it): w across X, d along Z."""
    return [(x, y, cz + z) for x, z in (sup(2 * PI * k / segs + PI / segs, w, d, n) for k in range(segs))]


def blade_ring(y, w, d, cz=0.0):
    """Lozenge across Y, sharp front (+Z) and back (-Z) edges: the shins."""
    return [(0, y, cz + d / 2), (w / 2, y, cz + d * 0.1), (w * 0.4, y, cz - d * 0.25), (0, y, cz - d / 2),
            (-w * 0.4, y, cz - d * 0.25), (-w / 2, y, cz + d * 0.1)]


class MB:
    """bmesh built in three.js coordinates under a transform stack, one material per face (as tools/blender/guardians.py)."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []
        self.stack = [Matrix.Identity(4)]

    def push(self, m):
        self.stack.append(self.stack[-1] @ m)

    def pop(self):
        self.stack.pop()

    def mi(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def V(self, p):
        return self.bm.verts.new(self.stack[-1] @ Vector(p))

    def F(self, vs, mat):
        f = self.bm.faces.new(vs)
        f.material_index = self.mi(mat)
        f.smooth = False
        return f

    def fix(self, faces):
        if faces:
            bmesh.ops.recalc_face_normals(self.bm, faces=faces)

    def tag(self, verts, mat):
        faces = {f for v in verts for f in v.link_faces}
        for f in faces:
            f.material_index = self.mi(mat)
            f.smooth = False
        return list(faces)

    def loft(self, rings, mat, cap0=False, cap1=False, matfn=None, capmat=None):
        vr = [[self.V(p) for p in r] for r in rings]
        n = len(rings[0])
        faces = []
        for i in range(len(vr) - 1):
            for k in range(n):
                j = (k + 1) % n
                m = matfn(i, k) if matfn else mat
                faces.append(self.F([vr[i][k], vr[i][j], vr[i + 1][j], vr[i + 1][k]], m))
        if cap0:
            faces.append(self.F(list(reversed(vr[0])), capmat or mat))
        if cap1:
            faces.append(self.F(vr[-1], capmat or mat))
        self.fix(faces)
        return faces

    def fan(self, ring_pts, tip, mat):
        vs = [self.V(p) for p in ring_pts]
        t = self.V(tip)
        faces = [self.F([vs[k], vs[(k + 1) % len(vs)], t], mat) for k in range(len(vs))]
        self.fix(faces)
        return faces

    def cyl(self, a, b, r1, r2=None, segs=8, mat='RunnerIron', cap0=True, cap1=True, phase=0.0, matfn=None):
        """Cylinder/cone from a to b. r2 == 0 makes a spike."""
        a, b = Vector(a), Vector(b)
        d = b - a
        r2 = r1 if r2 is None else r2
        self.push(aim(a, d))
        ring = [(math.cos(phase + 2 * PI * k / segs), math.sin(phase + 2 * PI * k / segs)) for k in range(segs)]
        r0 = [(c * r1, s * r1, 0) for c, s in ring]
        if r2 <= 1e-6:
            faces = self.fan(r0, (0, 0, d.length), mat)
            if cap0:
                faces.append(self.F([self.V(p) for p in reversed(r0)], mat))
        else:
            faces = self.loft([r0, [(c * r2, s * r2, d.length) for c, s in ring]], mat, cap0, cap1, matfn=matfn)
        self.pop()
        return faces

    def box(self, c, size, mat, rot=(0, 0, 0), taper=(1, 1), M=None):
        """Box centred on c. taper scales the top (+Y) face in x and z."""
        verts = bmesh.ops.create_cube(self.bm, size=1)['verts']
        for v in verts:
            x, y, z = v.co
            if y > 0:
                x *= taper[0]
                z *= taper[1]
            v.co = Vector((x * size[0], y * size[1], z * size[2]))
        mm = self.stack[-1] @ (M if M is not None else Matrix.Identity(4)) @ T(c) @ Euler(rot).to_matrix().to_4x4()
        bmesh.ops.transform(self.bm, matrix=mm, verts=verts)
        return self.tag(verts, mat)

    def disc(self, c, n, r, segs, mat):
        """Flat polygon at c facing n."""
        self.push(aim(Vector(c), n))
        f = [self.F([self.V((r * math.cos(2 * PI * k / segs), r * math.sin(2 * PI * k / segs), 0)) for k in range(segs)], mat)]
        self.pop()
        return f

    def beam(self, a, b, w, h, mat, up=(0, 1, 0)):
        """Box from a to b with cross-section w x h, h along `up`."""
        a, b = Vector(a), Vector(b)
        z = (b - a).normalized()
        y = Vector(up)
        y = (y - z * y.dot(z)).normalized()
        x = y.cross(z)
        m = Matrix((x, y, z)).transposed().to_4x4()
        return self.box((0, 0, (b - a).length / 2), (w, h, (b - a).length), mat, M=T(a) @ m)

    def sphere(self, c, r, mat, u=8, v=5, scale=(1, 1, 1)):
        # built by hand: bmesh's create_uvsphere orders its faces differently from run to run
        self.push(T(c) @ S(*scale))
        rings = []
        for j in range(1, v):
            sj, cj = math.sin(PI * j / v), math.cos(PI * j / v)
            rings.append([(r * sj * math.cos(2 * PI * i / u), r * sj * math.sin(2 * PI * i / u), -r * cj)
                          for i in range(u)])
        faces = self.loft(rings, mat)
        faces += self.fan(list(reversed(rings[0])), (0, 0, -r), mat)
        faces += self.fan(rings[-1], (0, 0, r), mat)
        self.pop()
        return faces

    def prism_x(self, poly, x0, x1, mat, side=None):
        """Extrude a (y, z) polygon along X; `side` paints the rim."""
        a = [(x0, y, z) for y, z in poly]
        b = [(x1, y, z) for y, z in poly]
        return self.loft([a, b], side or mat, True, True, capmat=mat)

    def sweep(self, pts, r, mat, segs=5, radii=None):
        """Tube through a polyline, capped."""
        pts = [Vector(p) for p in pts]
        n = len(pts)
        rings = []
        ref = Vector((1, 0, 0))
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            if abs(t.dot(ref)) > 0.9:
                ref = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
            u = (ref - t * ref.dot(t)).normalized()
            w = t.cross(u)
            rr = radii[i] if radii else r
            rings.append([tuple(p + (u * math.cos(a) + w * math.sin(a)) * rr)
                          for a in (2 * PI * (k + 0.5) / segs for k in range(segs))])
            ref = u
        return self.loft(rings, mat, True, True)

    def shell(self, surf, u0, u1, v0, v1, nu, nv, off, thick, mat, edge_mat=None, inset=0.0):
        """Armour plate following surf(u, v) -> (point, outward normal), lifted `off`, `thick` thick; inset bevels
        the outer face's edge."""
        gi, go = [], []
        for j in range(nv + 1):
            ri, ro = [], []
            for i in range(nu + 1):
                u = lerp(u0, u1, i / nu)
                v = lerp(v0, v1, j / nv)
                p, n = surf(u, v)
                po = p + n * (off + thick)
                if inset and (i in (0, nu) or j in (0, nv)):
                    pc, nc = surf((u0 + u1) / 2, (v0 + v1) / 2)
                    po = po.lerp(pc + nc * (off + thick), inset)
                ri.append(self.V(p + n * off))
                ro.append(self.V(po))
            gi.append(ri)
            go.append(ro)
        faces = []
        em = edge_mat or mat
        for j in range(nv):
            for i in range(nu):
                faces.append(self.F([go[j][i], go[j][i + 1], go[j + 1][i + 1], go[j + 1][i]], mat))
        border = [(0, i) for i in range(nu)] + [(j, nu) for j in range(nv)] + \
                 [(nv, i) for i in range(nu, 0, -1)] + [(j, 0) for j in range(nv, 0, -1)]
        for k in range(len(border)):
            a = border[k]
            b = border[(k + 1) % len(border)]
            faces.append(self.F([gi[a[0]][a[1]], gi[b[0]][b[1]], go[b[0]][b[1]], go[a[0]][a[1]]], em))
        self.fix(faces)
        return faces

    def fin(self, base, length, height, rake, thick, mat, up=(0, 1, 0), along=(0, 0, 1)):
        """A swept blade: a base `length` long on `base` (along `along`), its point `height` out along `up`,
        raked back by `rake` (a fraction of the length)."""
        b, up, al = Vector(base), Vector(up).normalized(), Vector(along).normalized()
        side = up.cross(al).normalized() * thick / 2
        f0, f1 = b + al * length / 2, b - al * length / 2
        tip = b - al * length * rake + up * height
        ring0 = [tuple(f0 + side), tuple(f1 + side), tuple(f1 - side), tuple(f0 - side)]
        return self.fan(ring0, tuple(tip), mat) + [self.F([self.V(p) for p in reversed(ring0)], mat)]


def superellipse_surface(rows, n=0.55):
    """(u = angle from the top, v = z) -> point on a hull lofted through `rows` of (z, w, h, cy), with its normal."""
    zs = [r[0] for r in rows]

    def at(z):
        z = min(zs[-1], max(zs[0], z))
        for i in range(len(rows) - 1):
            if rows[i + 1][0] >= z:
                t = (z - rows[i][0]) / (rows[i + 1][0] - rows[i][0])
                return [lerp(rows[i][k], rows[i + 1][k], t) for k in (1, 2, 3)]
        return list(rows[-1][1:])

    def p(u, v):
        w, h, cy = at(v)
        x, y = sup(u, w, h, n)
        return Vector((x, cy + y, v))

    def surf(u, v, e=1e-3):
        q = p(u, v)
        du = p(u + e, v) - p(u - e, v)
        dv = p(u, v + e) - p(u, v - e)
        nn = du.cross(dv)
        w, h, cy = at(v)
        if nn.dot(q - Vector((0, cy, v))) < 0:
            nn = -nn
        return q, nn.normalized()
    return surf


# ==================================================================================================== body

HULL = [(-1.02, 0.28, 0.20, 0.04), (-0.94, 0.50, 0.34, 0.03), (-0.72, 0.62, 0.42, 0.02), (-0.36, 0.58, 0.40, 0.01),
        (0.0, 0.52, 0.37, 0.0), (0.36, 0.60, 0.42, 0.01), (0.70, 0.64, 0.45, 0.02), (0.92, 0.52, 0.39, 0.02),
        (1.02, 0.30, 0.26, 0.03)]


def build_body(armed=False):
    mb = MB()
    segs = 12
    # hull: a long rounded box, waisted between the shoulders and the haunches; dark belly
    rings = [sup_ring(z, w, h, cy, segs) for z, w, h, cy in HULL]
    mb.loft(rings, 'RunnerIron', True, True, capmat='RunnerDark',
            matfn=lambda i, k: 'RunnerRust' if k in (5, 6, 7) else ('RunnerDark' if k in (4, 8) else 'RunnerIron'))
    surf = superellipse_surface(HULL)
    # armour: shoulder and haunch plates over the back, a narrow saddle plate between, side skirts over the flanks
    mb.shell(surf, -1.05, 1.05, 0.2, 0.96, 4, 3, 0.005, 0.035, 'RunnerCeramic', 'RunnerIron', inset=0.06)
    mb.shell(surf, -1.05, 1.05, -0.95, -0.3, 4, 3, 0.005, 0.035, 'RunnerCeramic', 'RunnerIron', inset=0.06)
    mb.shell(surf, -0.6, 0.6, -0.22, 0.14, 2, 2, 0.005, 0.025, 'RunnerIron', 'RunnerDark', inset=0.08)
    for s in (-1, 1):
        a0, a1 = (1.25, 1.95) if s > 0 else (-1.95, -1.25)
        mb.shell(surf, a0, a1, -0.45, 0.42, 1, 3, 0.004, 0.03, 'RunnerCeramic', 'RunnerIron', inset=0.05)
        # three glowing vents slit through each skirt
        for z in (-0.22, 0.0, 0.22):
            q, n = surf(s * 1.6, z)
            mb.box(tuple(q + n * 0.03), (0.012, 0.11, 0.026), 'RunnerGlow', rot=(0, 0, s * -0.35))
    # hazard chevrons across the saddle
    for z in (-0.27, 0.19):
        q, _ = surf(0, z)
        for x in (-0.12, -0.04, 0.04, 0.12):
            mb.box((x, q.y + 0.03, z), (0.05, 0.012, 0.035), 'RunnerHazard', rot=(0, 0.6 if x > 0 else -0.6, 0))
    # the spine: a row of swept-back blades, tallest over the shoulders and haunches
    for i, z in enumerate((0.78, 0.56, 0.34, 0.12, -0.12, -0.36, -0.58, -0.8)):
        if armed and abs(z - MOUNT[2]) < 0.3:
            continue  # the turret ring's place
        q, _ = surf(0, z)
        h = 0.1 + 0.1 * abs(math.sin((i + 0.5) / 8 * 2 * PI))
        mb.fin((0, q.y + 0.03, z), 0.18, h, 0.85, 0.025, 'RunnerSteel' if i % 2 else 'RunnerIron')
    # hip sockets: steel collars round each abduction axis, the joint's housing (the hip) turns inside
    for sx in (-1, 1):
        for sz in (-1, 1):
            c = Vector((sx * SOCK_X, SOCK_Y, sz * SOCK_Z))
            mb.cyl(c + Vector((0, 0, -0.16)), c + Vector((0, 0, -0.13)), 0.135, None, 10, 'RunnerSteel')
            mb.cyl(c + Vector((0, 0, 0.13)), c + Vector((0, 0, 0.16)), 0.135, None, 10, 'RunnerSteel')
    # neck collar, ribbed
    nx, ny, nz = NECK
    mb.cyl((nx, ny, nz - 0.1), (nx, ny, nz - 0.02), 0.15, 0.13, 10, 'RunnerIron')
    mb.cyl((nx, ny, nz - 0.05), (nx, ny, nz - 0.03), 0.16, None, 10, 'RunnerRust')
    # belly: a dark power pack between the legs, cables looping from it into the hips
    mb.box((0, -0.24, 0.0), (0.34, 0.08, 0.86), 'RunnerDark', taper=(1.1, 1.05))
    mb.box((0, -0.29, 0.0), (0.26, 0.03, 0.6), 'RunnerRust')
    for sx in (-1, 1):
        for sz in (-1, 1):
            mb.sweep([(sx * 0.12, -0.24, sz * 0.38), (sx * 0.2, -0.27, sz * 0.52), (sx * SOCK_X - sx * 0.06, -0.1, sz * (SOCK_Z - 0.08))],
                     0.022, 'RunnerDark', 5)
    # tail: two whip antennae raking back, red-tipped, and a red slit across the rear
    for s in (-1, 1):
        a, b = Vector((s * 0.1, 0.14, -0.9)), Vector((s * 0.22, 0.62, -1.38))
        mb.cyl(a, b, 0.016, 0.008, 5, 'RunnerSteel')
        mb.sphere(tuple(b), 0.02, 'RunnerEye', 6, 4)
        mb.cyl(a - Vector((0, 0.03, 0)), a + Vector((0, 0.03, 0)), 0.035, None, 6, 'RunnerIron')
    mb.box((0, 0.04, -1.03), (0.18, 0.025, 0.02), 'RunnerGlow')
    if armed:
        # the turret ring: a steel race on a raised iron collar, bolted through the saddle, hoses down into the hull
        mx, my, mz = MOUNT
        mb.cyl((mx, my - 0.06, mz), (mx, my - 0.01, mz), 0.21, 0.2, 12, 'RunnerIron')
        mb.cyl((mx, my - 0.01, mz), (mx, my, mz), 0.2, 0.19, 12, 'RunnerSteel')
        for k in range(8):
            a = 2 * PI * (k + 0.5) / 8
            mb.box((mx + math.cos(a) * 0.205, my - 0.035, mz + math.sin(a) * 0.205), (0.03, 0.04, 0.03), 'RunnerRust')
        for s in (-1, 1):
            mb.sweep([(s * 0.16, my - 0.04, mz - 0.12), (s * 0.24, my - 0.07, mz - 0.25), (s * 0.27, 0.05, -0.38)], 0.02,
                     'RunnerDark', 5)
    return finish(mb, 'Runner_BodyArmed' if armed else 'Runner_Body')


# ================================================================================================= gun arm

def build_arm_base():
    mb = MB()
    sx, sy, sz = SHOULDER
    # the turntable drum, a rust band, and a yoke of two cheeks rising to the shoulder axle (round about it)
    mb.cyl((0, 0, 0), (0, 0.07, 0), 0.18, 0.17, 12, 'RunnerIron')
    mb.cyl((0, 0.02, 0), (0, 0.045, 0), 0.185, None, 12, 'RunnerRust')
    poly = [(0.04, 0.12)] + [(sy + 0.085 * math.sin(a), 0.085 * math.cos(a))
                             for a in (-PI / 2 + PI * i / 6 for i in range(7))] + [(0.04, -0.12)]
    for s in (-1, 1):
        mb.prism_x(poly, s * 0.085, s * 0.115, 'RunnerIron', side='RunnerDark')
        mb.cyl((s * 0.115, sy, sz), (s * 0.14, sy, sz), 0.06, 0.05, 8, 'RunnerSteel')
    # hazard marks round the drum and a sensor pod on its back
    for k in range(6):
        a = 2 * PI * k / 6
        mb.box((math.sin(a) * 0.172, 0.055, math.cos(a) * 0.172), (0.05, 0.02, 0.012), 'RunnerHazard', rot=(0, a, 0))
    mb.box((0, 0.1, -0.13), (0.1, 0.07, 0.07), 'RunnerIron')
    mb.box((0, 0.1, -0.168), (0.05, 0.02, 0.005), 'RunnerEye')
    return finish(mb, 'Runner_ArmBase')


def build_arm_upper():
    mb = MB()
    L = UPPER
    # shoulder knuckle between the yoke's cheeks, a girder, the elbow fork; a ram underneath, armour on top
    mb.cyl((-0.08, 0, 0), (0.08, 0, 0), 0.075, None, 10, 'RunnerIron')
    rings = [sup_ring(0.04, 0.12, 0.13, 0.0, 8), sup_ring(0.2, 0.13, 0.14, 0.0, 8), sup_ring(L - 0.12, 0.1, 0.1, 0.0, 8)]
    mb.loft(rings, 'RunnerIron', cap1=True, matfn=lambda i, k: 'RunnerRust' if k in (3, 4, 5) else 'RunnerIron')
    poly = [(0.05, L - 0.15)] + [(0.065 * math.cos(a), L + 0.065 * math.sin(a))
                                 for a in (PI / 2 - PI * i / 6 for i in range(7))] + [(-0.05, L - 0.15)]
    for s in (-1, 1):
        mb.prism_x(poly, s * 0.055, s * 0.075, 'RunnerIron')

    def plate(u, v):
        a = lerp(-1.0, 1.0, u)
        return Vector((math.sin(a) * 0.075, math.cos(a) * 0.075, v)), Vector((math.sin(a), math.cos(a), 0))
    mb.shell(plate, 0, 1, 0.1, L - 0.16, 2, 2, 0.005, 0.02, 'RunnerCeramic', 'RunnerIron', inset=0.1)
    mb.cyl((0, -0.08, 0.06), (0, -0.075, 0.36), 0.025, None, 6, 'RunnerIron')
    mb.cyl((0, -0.075, 0.34), (0, -0.05, L - 0.06), 0.012, None, 5, 'RunnerSteel')
    mb.box((0.078, 0.0, 0.3), (0.006, 0.025, 0.16), 'RunnerGlow')
    return finish(mb, 'Runner_ArmUpper')


def build_arm_fore():
    mb = MB()
    L = FORE
    mb.cyl((-0.05, 0, 0), (0.05, 0, 0), 0.06, None, 10, 'RunnerIron')
    rings = [sup_ring(0.03, 0.09, 0.1, 0.0, 8), sup_ring(L - 0.12, 0.07, 0.075, 0.0, 8)]
    mb.loft(rings, 'RunnerIron', cap1=True, matfn=lambda i, k: 'RunnerSteel' if k in (0, 1, 7) else 'RunnerIron')
    poly = [(0.04, L - 0.14)] + [(0.05 * math.cos(a), L + 0.05 * math.sin(a))
                                 for a in (PI / 2 - PI * i / 6 for i in range(7))] + [(-0.04, L - 0.14)]
    for s in (-1, 1):
        mb.prism_x(poly, s * 0.045, s * 0.062, 'RunnerIron')
        mb.cyl((s * 0.062, 0, L), (s * 0.072, 0, L), 0.035, 0.03, 8, 'RunnerSteel')
    mb.sweep([(0.05, 0.03, 0.05), (0.06, 0.06, 0.25), (0.045, 0.04, L - 0.1)], 0.012, 'RunnerDark', 4)
    mb.box((0, -0.06, 0.22), (0.05, 0.03, 0.18), 'RunnerHazard', taper=(0.8, 1))
    return finish(mb, 'Runner_ArmFore')


GUN = [(-0.84, 0.15, 0.1, 0.19), (-0.76, 0.28, 0.22, 0.19), (-0.4, 0.33, 0.25, 0.19), (0.1, 0.31, 0.24, 0.19),
       (0.38, 0.25, 0.18, 0.2), (0.5, 0.18, 0.13, 0.2)]


def build_rifle():
    """A heavy rail gun, held at its balance point: a broad armoured housing behind the wrist, capacitor pods down its
    flanks, twin rails reaching ahead with a glowing channel between them; carried on a pylon under its belly."""
    mb = MB()
    # slide shoes under the belly, riding the mount's rails (Runner_GunMount)
    for s in (-1, 1):
        for z in (-0.25, 0.12):
            mb.box((s * RAIL_X, 0.072, z), (0.045, 0.03, 0.09), 'RunnerDark')
    # the housing: wide and flat, dark beneath; armour over the top
    mb.loft([sup_ring(z, w, h, cy, 12, 0.45) for z, w, h, cy in GUN], 'RunnerIron', True, True, capmat='RunnerDark',
            matfn=lambda i, k: 'RunnerDark' if k in (5, 6, 7) else 'RunnerIron')
    surf = superellipse_surface(GUN, 0.45)
    mb.shell(surf, -0.95, 0.95, -0.7, -0.15, 4, 2, 0.004, 0.025, 'RunnerCeramic', 'RunnerIron', inset=0.07)
    mb.shell(surf, -0.8, 0.8, -0.08, 0.36, 4, 2, 0.004, 0.025, 'RunnerCeramic', 'RunnerIron', inset=0.07)
    for x in (-0.11, -0.04, 0.04, 0.11):
        q, _ = surf(0, -0.11)
        mb.box((x, q.y + 0.012, -0.11), (0.045, 0.012, 0.03), 'RunnerHazard', rot=(0, 0.6 if x > 0 else -0.6, 0))
    # heat-sink fins over the back, a sensor ridge at the front with a red slit
    for x in (-0.09, -0.03, 0.03, 0.09):
        q, _ = surf(0, -0.5)
        mb.box((x, q.y + 0.04, -0.5), (0.012, 0.07, 0.26), 'RunnerSteel', taper=(1, 0.7))
    q, _ = surf(0, 0.22)
    mb.box((0, q.y + 0.02, 0.22), (0.07, 0.04, 0.2), 'RunnerIron', taper=(0.6, 0.8))
    mb.box((0, q.y + 0.02, 0.322), (0.04, 0.012, 0.004), 'RunnerEye')
    # capacitor pods down the flanks, ringed with coils, nosed with cones
    for s in (-1, 1):
        x, y = s * 0.19, 0.16
        mb.cyl((x, y, -0.62), (x, y, 0.22), 0.062, None, 10, 'RunnerIron')
        mb.cyl((x, y, 0.22), (x, y, 0.32), 0.062, 0.025, 10, 'RunnerSteel', cap0=False)
        mb.cyl((x, y, -0.66), (x, y, -0.62), 0.045, 0.062, 10, 'RunnerDark', cap1=False)
        for z in (-0.42, -0.2, 0.02):
            mb.cyl((x, y, z), (x, y, z + 0.035), 0.068, None, 10, 'RunnerGunGlow')
        mb.box((x + s * 0.05, y, -0.3), (0.012, 0.03, 0.3), 'RunnerHazard')
    # the rails: two thick blades, a glowing channel between, bound by collars; the muzzle's emitters at their tips
    z0, z1 = 0.42, MUZZLE
    for s in (-1, 1):
        mb.box((s * 0.065, 0.2, (z0 + z1) / 2), (0.04, 0.11, z1 - z0), 'RunnerIron', taper=(1, 1))
        mb.box((s * 0.065, 0.257, (z0 + z1) / 2 + 0.05), (0.03, 0.008, z1 - z0 - 0.1), 'RunnerSteel')
        mb.box((s * 0.048, 0.2, z1 - 0.02), (0.008, 0.07, 0.04), 'RunnerGunGlow')
    mb.box((0, 0.2, (z0 + z1) / 2), (0.03, 0.035, z1 - z0 - 0.02), 'RunnerGunGlow')
    for z in (0.62, 0.86, 1.08):
        mb.box((0, 0.2, z), (0.2, 0.15, 0.045), 'RunnerIron')
        mb.box((0, 0.2, z), (0.21, 0.035, 0.03), 'RunnerDark')
    # the power core at the back: three glowing slits in a dark frame
    mb.box((0, 0.19, -0.845), (0.13, 0.08, 0.02), 'RunnerDark')
    for x in (-0.04, 0.0, 0.04):
        mb.box((x, 0.19, -0.857), (0.018, 0.06, 0.006), 'RunnerGunGlow')
    # a cable from each rear shoe into its pod
    for s in (-1, 1):
        mb.sweep([(s * RAIL_X, 0.07, -0.3), (s * 0.12, 0.06, -0.38), (s * 0.18, 0.1, -0.45)], 0.014, 'RunnerDark', 4)
    return finish(mb, 'Runner_Rifle')


def build_gun_mount():
    """What stays on the wrist when the gun recoils: the knuckle on the wrist's axis (between the forearm's fork), a
    pylon, and a cradle of two rails under the gun's belly that it slides back along, stops at either end and a
    hydraulic buffer behind each rail that catches it."""
    mb = MB()
    mb.cyl((-0.04, 0, 0), (0.04, 0, 0), 0.05, None, 8, 'RunnerSteel')
    mb.box((0, 0.03, -0.02), (0.07, 0.05, 0.2), 'RunnerIron', taper=(1.6, 1.4))
    # the cradle: a crossbeam, the rails, stops
    mb.box((0, 0.045, -0.02), (2 * RAIL_X + 0.05, 0.022, 0.12), 'RunnerIron')
    for s in (-1, 1):
        mb.box((s * RAIL_X, 0.05, (RAIL_Z[0] + RAIL_Z[1]) / 2), (0.022, 0.016, RAIL_Z[1] - RAIL_Z[0]), 'RunnerSteel')
        mb.box((s * RAIL_X, 0.042, (RAIL_Z[0] + RAIL_Z[1]) / 2), (0.034, 0.012, RAIL_Z[1] - RAIL_Z[0]), 'RunnerIron')
        for z in RAIL_Z:
            mb.box((s * RAIL_X, 0.055, z), (0.04, 0.035, 0.025), 'RunnerRust')
        # the buffer: a cylinder along the rail's outside, its rod reaching forward to the rear shoe's place
        bx = s * (RAIL_X + 0.045)
        mb.cyl((bx, 0.045, RAIL_Z[0] + 0.02), (bx, 0.045, -0.36), 0.022, None, 8, 'RunnerIron')
        mb.cyl((bx, 0.045, -0.36), (bx, 0.045, -0.3), 0.008, None, 5, 'RunnerSteel')
        mb.box((bx, 0.045, -0.4), (0.012, 0.03, 0.03), 'RunnerHazard')
    return finish(mb, 'Runner_GunMount')


# ==================================================================================================== head

SKULL = [(0.05, 0.22, 0.2, 0.0), (0.14, 0.32, 0.25, 0.01), (0.30, 0.32, 0.22, 0.0), (0.44, 0.24, 0.15, -0.015),
         (0.56, 0.13, 0.08, -0.03)]


def build_head():
    mb = MB()
    # neck: a ribbed hose into the collar
    mb.cyl((0, 0, -0.1), (0, 0, 0.08), 0.09, None, 8, 'RunnerDark')
    for z in (-0.05, 0.0, 0.05):
        mb.cyl((0, 0, z - 0.012), (0, 0, z + 0.012), 0.1, None, 8, 'RunnerRust')
    # skull: a low wedge, dark beneath
    mb.loft([sup_ring(z, w, h, cy, 12) for z, w, h, cy in SKULL], 'RunnerIron', True, True, capmat='RunnerDark',
            matfn=lambda i, k: 'RunnerDark' if k in (5, 6, 7) else 'RunnerIron')
    surf = superellipse_surface(SKULL)
    # a ceramic crown, and brows slanting down to the middle: a scowl
    mb.shell(surf, -1.0, 1.0, 0.08, 0.34, 4, 2, 0.004, 0.03, 'RunnerCeramic', 'RunnerIron', inset=0.08)
    for s in (-1, 1):
        mb.box((s * 0.075, 0.105, 0.395), (0.13, 0.026, 0.1), 'RunnerCeramic', rot=(0.12, 0, s * 0.42))
    # eyes: a spider's cluster, two big ones under the brows, six small round them, each in a dark socket
    eyes = [(0.072, 0.045, 0.44, 0.03), (0.125, 0.04, 0.35, 0.021), (0.03, 0.068, 0.5, 0.016), (0.1, -0.005, 0.42, 0.015)]
    for s in (-1, 1):
        for x, y, z, r in eyes:
            mb.sphere((s * x, y, z - r * 0.3), r * 1.35, 'RunnerDark', 8, 4)
            mb.sphere((s * x, y, z + r * 0.15), r, 'RunnerEye', 8, 4)
    # jaw hinges: dark sockets low on each cheek, the jaws (Runner_JawL/R) swing in them
    for s in (-1, 1):
        mb.box((s * (JAW[0] - 0.035), JAW[1], JAW[2]), (0.06, 0.12, 0.12), 'RunnerDark')
        mb.cyl((s * (JAW[0] - 0.01), JAW[1] + 0.07, JAW[2]), (s * (JAW[0] - 0.01), JAW[1] + 0.09, JAW[2]), 0.05, None, 8, 'RunnerSteel')
    # the maw between them: a dim red slit
    mb.box((0, -0.045, 0.52), (0.07, 0.016, 0.05), 'RunnerGlow')
    # two sensor fins raking back off the crown
    for s in (-1, 1):
        mb.fin((s * 0.07, 0.12, 0.16), 0.12, 0.09, 0.9, 0.018, 'RunnerSteel', up=(s * 0.35, 1, 0))
    return finish(mb, 'Runner_Head')


# Centre line of the left jaw from its hinge: out, forward, then hooking in to the tip; widths (across) and heights.
JAW_LINE = [(0.0, 0.0, 0.0), (0.075, -0.005, 0.15), (0.11, -0.015, 0.32), (0.09, -0.025, 0.49), (0.02, -0.035, 0.62),
            (-0.07, -0.04, 0.69)]
JAW_W = [0.075, 0.075, 0.065, 0.05, 0.035, 0.018]
JAW_H = [0.13, 0.12, 0.1, 0.075, 0.05, 0.025]


def build_jaw():
    """The left jaw, in its hinge's frame: a curved blade, heavy at the root, hooked at the tip, toothed along the
    inside (the side facing the other jaw)."""
    mb = MB()
    pts = [Vector(p) for p in JAW_LINE]
    n = len(pts)
    up = Vector((0, 1, 0))
    rings, inner = [], []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        side = up.cross(t).normalized()  # outwards (the convex side)
        u = t.cross(side).normalized()
        inner.append((p, -side, t))
        rings.append([tuple(p + u * math.cos(a) * JAW_H[i] / 2 + side * math.sin(a) * JAW_W[i] / 2)
                      for a in (2 * PI * k / 8 for k in range(8))])
    # the blade: dark iron above, a steel cutting edge along the inside (k 5..7 face it)
    mb.loft(rings, 'RunnerIron', cap0=True, matfn=lambda i, k: 'RunnerSteel' if k in (5, 6, 7) else ('RunnerRust' if k in (3, 4) else 'RunnerIron'))
    tip = pts[-1] + (pts[-1] - pts[-2]).normalized() * 0.07
    mb.fan(rings[-1], tuple(tip), 'RunnerSteel')
    # teeth along the inside: a big one near the root (a stag beetle's), then a row of smaller ones, raked forward
    for i, (f, size) in enumerate(((0.9, 0.11), (1.6, 0.06), (2.2, 0.075), (2.8, 0.05), (3.3, 0.055), (3.8, 0.04))):
        k = min(n - 2, int(f))
        a = f - k
        p = pts[k].lerp(pts[k + 1], a)
        w = lerp(JAW_W[k], JAW_W[k + 1], a)
        _, ins, t = inner[k]
        base = p + ins * w * 0.35
        mb.cyl(tuple(base), tuple(base + ins * size + t * size * 0.45), 0.022 + size * 0.15, 0, 5, 'RunnerSteel', cap0=False)
    # the hinge knuckle, and two blades raking back along the jaw's back
    mb.cyl((0, -0.07, 0), (0, 0.07, 0), 0.055, None, 8, 'RunnerIron')
    for k, h in ((1, 0.07), (2, 0.05)):
        t = (pts[k + 1] - pts[k - 1]).normalized()
        mb.fin(tuple(pts[k] + up * JAW_H[k] * 0.42), 0.12, h, 0.7, 0.016, 'RunnerCeramic', along=tuple(t))
    mb.sweep([(0.03, -0.05, 0.03), (0.0, -0.09, -0.04), (-0.05, -0.06, -0.06)], 0.016, 'RunnerDark', 4)
    return finish(mb, 'Runner_Jaw')


# ==================================================================================================== legs

def build_hip():
    mb = MB()
    # abduction drum round the socket's Z axis, banded
    mb.cyl((0, 0, -0.13), (0, 0, 0.13), 0.115, None, 10, 'RunnerIron')
    mb.cyl((0, 0, -0.04), (0, 0, 0.04), 0.122, None, 10, 'RunnerRust')
    # arm out to the pitch motor, which drives the thigh about X at (HIP_OUT, 0, 0)
    mb.box((0.08, 0, 0), (0.12, 0.17, 0.2), 'RunnerIron')
    mb.cyl((0.08, 0, 0), (HIP_OUT - 0.07, 0, 0), 0.13, None, 10, 'RunnerIron')
    mb.cyl((HIP_OUT - 0.11, 0, 0), (HIP_OUT - 0.09, 0, 0), 0.137, None, 10, 'RunnerHazard')
    # hose from the drum round to the motor
    mb.sweep([(0.0, 0.1, -0.1), (0.07, 0.15, -0.08), (0.12, 0.1, -0.1)], 0.018, 'RunnerDark', 4)
    return finish(mb, 'Runner_Hip')


def build_thigh():
    mb = MB()
    L = THIGH
    # root knuckle on the hip's pitch axis, an outer steel cap
    mb.cyl((-0.07, 0, 0), (0.06, 0, 0), 0.1, None, 10, 'RunnerIron')
    mb.cyl((0.06, 0, 0), (0.085, 0, 0), 0.07, 0.06, 8, 'RunnerSteel')
    # the beam: deep at the hip, tapering to the knee; rust down its back
    rings = [bone_ring(-0.04, 0.11, 0.17), bone_ring(-0.16 * L / 0.72, 0.12, 0.18, -0.01),
             bone_ring(-0.42 * L / 0.72, 0.1, 0.13, -0.01), bone_ring(L - 0.13 - L, 0.085, 0.1)]
    mb.loft(rings, 'RunnerIron', cap1=True, matfn=lambda i, k: 'RunnerRust' if k in (3, 4) else 'RunnerIron')
    # knee fork cheeks round the knee axis, the shin's knuckle between them
    poly = [(-L + 0.16, 0.06)] + [(-L + 0.085 * math.cos(a), 0.085 * math.sin(a))
                                  for a in (PI / 2 - PI * i / 6 for i in range(7))] + [(-L + 0.16, -0.06)]
    for s in (-1, 1):
        mb.prism_x(poly, s * 0.05, s * 0.072, 'RunnerIron')
        mb.cyl((s * 0.072, -L, 0), (s * 0.085, -L, 0), 0.05, 0.045, 8, 'RunnerSteel')
    # knee spur: a horn out the back of the knee
    mb.cyl((0, -L + 0.03, -0.05), (0, -L - 0.04, -0.27), 0.035, 0, 4, 'RunnerSteel', phase=PI / 4)
    # outer armour: a blade-shaped plate, its top a spike over the shoulder
    plate = [(0.17, -0.12), (0.06, 0.1), (-0.14, 0.115), (-0.42, 0.075), (-0.5, 0.0), (-0.42, -0.07), (-0.12, -0.095),
             (0.02, -0.09)]
    mb.prism_x(plate, 0.064, 0.088, 'RunnerCeramic', side='RunnerIron')
    mb.box((0.09, -0.26, 0.0), (0.008, 0.13, 0.014), 'RunnerGlow')
    # hazard band below the knuckle
    mb.loft([bone_ring(-0.13, 0.126, 0.186, -0.005), bone_ring(-0.17, 0.126, 0.186, -0.008)], 'RunnerHazard',
            matfn=lambda i, k: 'RunnerHazard' if k % 2 == 0 else 'RunnerDark')
    # knee piston down the front, and a cable down the inside
    mb.cyl((0, -0.1, 0.095), (0, -0.4, 0.08), 0.032, None, 6, 'RunnerIron')
    mb.cyl((0, -0.38, 0.08), (0, -L + 0.1, 0.06), 0.015, None, 5, 'RunnerSteel')
    mb.sweep([(-0.06, -0.05, 0.02), (-0.07, -0.3, 0.05), (-0.065, -0.5, 0.0), (-0.04, -L + 0.12, -0.03)], 0.014,
             'RunnerDark', 4)
    return finish(mb, 'Runner_Thigh')


def build_shin():
    mb = MB()
    L = SHIN
    # knee knuckle
    mb.cyl((-0.045, 0, 0), (0.045, 0, 0), 0.072, None, 10, 'RunnerIron')
    # the blade: a lozenge section, keen fore and aft, tapering to the ankle
    k = L / 0.78
    rings = [blade_ring(-0.02, 0.08, 0.14), blade_ring(-0.12 * k, 0.085, 0.16), blade_ring(-0.36 * k, 0.065, 0.12),
             blade_ring(-0.58 * k, 0.045, 0.08), blade_ring(-L + 0.1, 0.04, 0.06)]
    mb.loft(rings, 'RunnerIron', matfn=lambda i, k: 'RunnerSteel' if k == 0 else ('RunnerRust' if k == 3 else 'RunnerIron'))
    # serrated spurs raking up the back edge
    for i, y in enumerate((-0.2, -0.32, -0.44)):
        sc = 1 - 0.2 * i
        mb.fin((0, y * k, -0.06 * sc - 0.005), 0.07 * sc, 0.07 * sc, -0.6, 0.016, 'RunnerSteel',
               up=(0, 0.35, -1), along=(0, 1, 0))
    # ankle collar, then the claw: a hooked talon whose tip is the foot (0, -L, 0), two side toes, a dewclaw
    mb.cyl((0, -L + 0.12, 0), (0, -L + 0.07, 0), 0.042, 0.045, 8, 'RunnerRust')
    mb.loft([bone_ring(-L + 0.075, 0.07, 0.07, -0.005), bone_ring(-L + 0.035, 0.05, 0.06, 0.01)], 'RunnerIron', True)
    mb.fan(bone_ring(-L + 0.035, 0.05, 0.06, 0.01), (0, -L, 0.035), 'RunnerSteel')
    for s in (-1, 1):
        mb.cyl((s * 0.02, -L + 0.06, 0.01), (s * 0.075, -L + 0.008, 0.08), 0.017, 0, 5, 'RunnerSteel')
    mb.cyl((0, -L + 0.09, -0.03), (0, -L + 0.03, -0.11), 0.016, 0, 5, 'RunnerSteel')
    return finish(mb, 'Runner_Shin')


# ================================================================================================= helpers

def finish(mb, name):
    bmesh.ops.transform(mb.bm, matrix=C, verts=mb.bm.verts)
    mb.bm.normal_update()
    mesh = bpy.data.meshes.new(name)
    mb.bm.to_mesh(mesh)
    mb.bm.free()
    for m in mb.mats:
        mesh.materials.append(bpy.data.materials[m])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mirrored(obj, name):
    """obj's mirror image across X (three.js x = Blender x), faces turned back outwards."""
    mesh = obj.data.copy()
    mesh.name = name
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for v in bm.verts:
        v.co.x = -v.co.x
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    return o


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def export_glb(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_materials='EXPORT', export_normals=True,
                              export_texcoords=False)


# ================================================================================================= preview

def leg_ik(foot_y, foot_z):
    """Hip pitch and knee angle (radians, + swings backwards) putting the claw at (foot_y, foot_z) from the hip's
    pitch joint, knee bent back (as src/world/runner.ts)."""
    d = min(THIGH + SHIN - 1e-3, math.hypot(foot_y, foot_z))
    at = math.atan2(-foot_z, -foot_y)
    a1 = math.acos(max(-1, min(1, (THIGH ** 2 + d ** 2 - SHIN ** 2) / (2 * THIGH * d))))
    t1 = at + a1
    ky, kz = -THIGH * math.cos(t1), -THIGH * math.sin(t1)
    ts = math.atan2(-(foot_z - kz), -(foot_y - ky))
    return t1, ts - t1


def pose(body_M, strides=(0.0, 0.0, 0.0, 0.0), head=(0.0, 0.15), jaws=0.3):
    """three.js matrices for every part, the feet on y = 0 under the hips shifted by `strides` (z, per leg FL FR RL RR),
    the jaws open `jaws` radians."""
    H = body_M @ T(NECK) @ Ry(head[0]) @ Rx(head[1])
    out = [('Runner_Body', body_M), ('Runner_Head', H), ('Runner_JawL', H @ T(JAW) @ Ry(jaws)),
           ('Runner_JawR', H @ T(-JAW[0], JAW[1], JAW[2]) @ Ry(-jaws))]
    for i, (sx, sz) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1))):
        side = 'L' if sx > 0 else 'R'
        hip = body_M @ T(sx * SOCK_X, SOCK_Y, sz * SOCK_Z)
        thigh_at = hip @ T(sx * HIP_OUT, 0, 0)
        t1, t2 = leg_ik(-thigh_at.translation.y, strides[i])
        th = thigh_at @ Rx(t1)
        out += [('Runner_Hip' + side, hip), ('Runner_Thigh' + side, th), ('Runner_Shin' + side, th @ T(0, -THIGH, 0) @ Rx(t2))]
    return out


def arm_ik(wrist_y, wrist_z):
    """Shoulder and elbow elevations (radians, up from level) putting the wrist at (wrist_y, wrist_z) from the
    shoulder, elbow up and behind (as src/world/runner.ts): the forearm comes up to the gun's pylon from below."""
    d = max(abs(UPPER - FORE) + 0.02, min(UPPER + FORE - 1e-3, math.hypot(wrist_y, wrist_z)))
    up = math.atan2(wrist_y, wrist_z) + math.acos(max(-1, min(1, (UPPER ** 2 + d ** 2 - FORE ** 2) / (2 * UPPER * d))))
    ey, ez = UPPER * math.sin(up), UPPER * math.cos(up)
    return up, math.atan2(wrist_y - ey, wrist_z - ez)


def arm_pose(body_M, yaw, wrist, aim, slide=0.0):
    """three.js matrices of the gun arm on the armed body: base yawed `yaw`, the wrist at `wrist` (y, z) from the
    shoulder, the rifle `aim` up from level."""
    base = body_M @ T(MOUNT) @ Ry(yaw)
    up, fore = arm_ik(*wrist)
    upper = base @ T(SHOULDER) @ Rx(-up)
    forearm = upper @ T(0, 0, UPPER) @ Rx(-(fore - up))
    rifle = forearm @ T(0, 0, FORE) @ Rx(-(aim - fore))
    return [('Runner_ArmBase', base), ('Runner_ArmUpper', upper), ('Runner_ArmFore', forearm), ('Runner_GunMount', rifle),
            ('Runner_Rifle', rifle @ T(0, 0, -slide))]


def place(src, M3, coll):
    o = src.copy()
    o.hide_render = False
    coll.objects.link(o)
    o.matrix_world = C @ M3 @ C.inverted()
    return o


def render_previews(parts, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x, scene.render.resolution_y = 1200, 800
    scene.view_settings.view_transform = 'Standard'
    for o in parts.values():
        o.hide_render = True
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    ground = bpy.context.active_object
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    gm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*lin(0xc46a24), 1)
    gm.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = 1.0
    ground.data.materials.append(gm)
    world = scene.world or bpy.data.worlds.new('world')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*lin(0xe07b28), 1)
    bg.inputs['Strength'].default_value = 0.8
    sd = bpy.data.lights.new('sun', 'SUN')
    sd.energy = 4.0
    sd.color = (1.0, 0.75, 0.5)
    sun = bpy.data.objects.new('sun', sd)
    sun.rotation_euler = (math.radians(90 - 25), 0, math.radians(-140))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam

    def look(pos3, target3, lens):
        p = C @ Vector(pos3)
        t = C @ Vector(target3)
        cam.location = p
        cam.rotation_euler = (t - p).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens

    def shoot(name):
        scene.render.filepath = os.path.join(out_dir, name)
        bpy.ops.render.render(write_still=True)

    coll = bpy.data.collections.new('rig')
    scene.collection.children.link(coll)
    for name, M in pose(T(0, STAND_Y * SCALE, 0) @ S(SCALE, SCALE, SCALE), strides=(0.12, 0.02, -0.04, 0.1), head=(0.25, 0.2), jaws=0.45):
        place(parts[name], M, coll)
    # a player-sized post for scale, off the left shoulder
    hm = bpy.data.materials.new('human')
    hm.use_nodes = True
    hm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.05, 0.15, 0.6, 1)
    bpy.ops.mesh.primitive_cube_add(size=1)
    human = bpy.context.active_object
    human.scale = (0.45, 0.3, 1.8)
    human.location = C @ Vector((-2.4, 0.9, 1.6))  # beside it, behind from the cameras
    human.data.materials.append(hm)
    look((7.0, 3.6, 7.0), (0, 1.8, 0.3), 38)
    shoot('runner_34.png')
    look((9.5, 2.0, 0.6), (0, 1.7, 0.6), 40)
    shoot('runner_side.png')
    human.hide_render = True
    look((1.6, 3.0, 5.4), (0.2, 2.3, 2.9), 40)
    shoot('runner_face.png')
    look((-5.4, 4.4, -6.0), (0, 1.8, 0), 38)
    shoot('runner_rear.png')

    # the armed one: carrying (the rifle folded over its back), then raised and aiming at the post ahead
    coll.hide_render = True
    body = T(0, STAND_Y * SCALE, 0) @ S(SCALE, SCALE, SCALE)
    for name, (wrist, aim) in (('carry', ((0.6, 0.05), 0.0)), ('aim', ((0.75, 0.2), -0.12))):
        c = bpy.data.collections.new('armed_' + name)
        scene.collection.children.link(c)
        for n, M in pose(body, strides=(0.12, 0.02, -0.04, 0.1), head=(0.0, 0.2), jaws=0.3):
            place(parts['Runner_BodyArmed' if n == 'Runner_Body' else n], M, c)
        for n, M in arm_pose(body, 0.0, wrist, aim):
            place(parts[n], M, c)
        look((8.5, 3.4, 4.0), (0, 2.6, 1.0), 34)
        shoot(f'runner_armed_{name}.png')
        if name == 'aim':
            look((2.6, 5.4, 4.6), (0, 4.2, 1.2), 40)
            shoot('runner_armed_gun.png')
            # recoiled: slid back to the end of its travel on the rails
            for o in list(c.objects):
                if o.name.startswith('Runner_Rifle'):
                    bpy.data.objects.remove(o)
            for n, M in arm_pose(body, 0.0, wrist, aim, RECOIL):
                if n == 'Runner_Rifle':
                    place(parts[n], M, c)
            look((3.4, 4.6, 1.2), (0, 4.2, 0.6), 40)
            shoot('runner_armed_recoil.png')
        c.hide_render = True


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'models'))
    ap.add_argument('--preview', default=None, help='directory for PNG previews')
    args = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name, spec in MATERIALS.items():
        make_material(name, *spec)

    parts = {'Runner_Body': build_body(), 'Runner_BodyArmed': build_body(armed=True), 'Runner_Head': build_head(),
             'Runner_ArmBase': build_arm_base(), 'Runner_ArmUpper': build_arm_upper(), 'Runner_ArmFore': build_arm_fore(),
             'Runner_Rifle': build_rifle(), 'Runner_GunMount': build_gun_mount()}
    for build in (build_jaw, build_hip, build_thigh, build_shin):
        left = build()
        base = left.name
        left.name = left.data.name = base + 'L'
        parts[base + 'L'] = left
        parts[base + 'R'] = mirrored(left, base + 'R')

    os.makedirs(args.out, exist_ok=True)
    export_glb(list(parts.values()), os.path.join(args.out, 'runner.glb'))
    total, arm = 0, 0
    for o in parts.values():
        bb = [C.inverted() @ Vector(c) for c in o.bound_box]
        lo = [min(v[i] for v in bb) for i in range(3)]
        hi = [max(v[i] for v in bb) for i in range(3)]
        if o.name.startswith(('Runner_Arm', 'Runner_Rifle', 'Runner_Gun')):
            arm += tri_count(o)
        elif o.name != 'Runner_BodyArmed':
            total += tri_count(o) * (2 if o.name.startswith(('Runner_Hip', 'Runner_Thigh', 'Runner_Shin')) else 1)
        print(f'{o.name}: tris={tri_count(o)} bbox x {lo[0]:.2f}..{hi[0]:.2f} y {lo[1]:.2f}..{hi[1]:.2f} '
              f'z {lo[2]:.2f}..{hi[2]:.2f}')
    print(f'assembled runner tris: {total}; the gun arm adds {arm}')

    if args.preview:
        render_previews(parts, os.path.abspath(args.preview))


main()
