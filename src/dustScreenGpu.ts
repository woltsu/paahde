// A dust screen's blown sand on the GPU (src/dustScreenRunner.ts draws the text over it, src/dustScreenWorker.ts runs both).
// A few hundred thousand grains ride a curl-noise wind (divergence-free, so they gather into streamers and eddies that
// drift up the screen and let go), each with its own depth: far grains are dim, slow and follow the air closely, near ones
// bright, fast and heavy enough to cut across the eddies. A grain's colour comes from where it is set down: a slow noise
// map over the screen picks it along a loop of desert colours, so the sand comes in drifts of rust, amber, bone, ash.
// Per frame, three passes:
//   fade: the trail buffer (four fixed-point channels per pixel: brightness, and brightness x r, g, b) dims a little;
//   move: each grain steps and splats its segment into the trail with atomic adds (bilinear, so sub-pixel smooth);
//   draw: a full-screen triangle lays the dark backdrop, the trails and the vignette.
// Raw WebGPU rather than three/webgpu: this runs before the game's bundle has downloaded, in a worker of its own.

const TRAIL_PIXELS = 2.5e6; // the trail buffer, at most (16 bytes a pixel); finer than css px on a dense screen
const MAX_PIXELS = 4.2e6; // the canvas's backing store, at most
const FADE = 0.003; // how much of the trails fades per frame (at 60 fps)
const SCALE = 16384; // trail fixed point: units per 1.0 of brightness

const COMMON = /* wgsl */ `
struct U {
  size: vec2f,   // css px
  trail: vec2f,  // trail px
  canvas: vec2f, // canvas px
  ts: f32,       // trail px per css px
  time: f32,
  dt: f32,
  decay: f32,
  fadeIn: f32,
  count: u32,
  frame: u32,
  tw: u32,
  pad0: u32,
  pad1: u32,
}
@group(0) @binding(0) var<uniform> u: U;
const SCALE = ${SCALE}.0;

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
`;

const MOVE = /* wgsl */ `${COMMON}
struct Grain {
  pos: vec2f,
  vel: vec2f,
  size: f32,
  tint: u32,  // its colour (rgba8)
  pace: f32,  // its own speed; 0 until first placed
  seed: u32,
}
@group(0) @binding(1) var<storage, read_write> grains: array<Grain>;
@group(0) @binding(2) var<storage, read_write> trail: array<atomic<u32>>;

fn corner(c: vec3i) -> vec3f {
  let h = pcg((u32(c.x) * 73856093u) ^ pcg((u32(c.y) * 19349663u) ^ pcg(u32(c.z) * 83492791u)));
  return vec3f(f32(h & 1023u), f32((h >> 10u) & 1023u), f32((h >> 20u) & 1023u)) / 511.5 - 1.0;
}

// 3D gradient noise, about -1..1
fn noise(p: vec3f) -> f32 {
  let i = vec3i(floor(p));
  let f = fract(p);
  let s = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = mix(dot(corner(i), f), dot(corner(i + vec3i(1, 0, 0)), f - vec3f(1, 0, 0)), s.x);
  let b = mix(dot(corner(i + vec3i(0, 1, 0)), f - vec3f(0, 1, 0)), dot(corner(i + vec3i(1, 1, 0)), f - vec3f(1, 1, 0)), s.x);
  let c = mix(dot(corner(i + vec3i(0, 0, 1)), f - vec3f(0, 0, 1)), dot(corner(i + vec3i(1, 0, 1)), f - vec3f(1, 0, 1)), s.x);
  let d = mix(dot(corner(i + vec3i(0, 1, 1)), f - vec3f(0, 1, 1)), dot(corner(i + vec3i(1, 1, 1)), f - vec3f(1, 1, 1)), s.x);
  return mix(mix(a, b, s.y), mix(c, d, s.y), s.z) * 1.6;
}

// the wind's field coordinates at a css position: one unit is about half the screen's short side, sliding downwind
fn field(p: vec2f, t: f32) -> vec2f {
  return p / (min(u.size.x, u.size.y) * 0.45) + vec2f(0.0, t * 0.035);
}

fn rnd(s: ptr<function, u32>) -> f32 {
  *s = pcg(*s);
  return f32(*s >> 8u) / 16777216.0;
}

fn potential(q: vec2f, t: f32) -> f32 {
  return noise(vec3f(q, t * 0.06)) + 0.45 * noise(vec3f(q * 2.3 + vec2f(5.2, 1.3), t * 0.11));
}

// The air's velocity (css px/s for a grain of speed 1): a steady wind up the screen, the curl of a slowly changing
// potential on top (it runs along the potential's contours), a slight pull onto its zero contour so grains gather into
// ribbons that form, wander and let go as it changes, and gust bands sweeping through.
fn wind(p: vec2f) -> vec2f {
  let t = u.time;
  let q = field(p, t);
  let e = 0.02;
  let grad = vec2f(potential(q + vec2f(e, 0.0), t) - potential(q - vec2f(e, 0.0), t),
                   potential(q + vec2f(0.0, e), t) - potential(q - vec2f(0.0, e), t)) / (2.0 * e);
  let gather = -potential(q, t) * grad * 0.3;
  let s = sin(-q.x * 0.8 - q.y * 1.6 - t * 0.35);
  return (vec2f(-0.08, -0.65) + vec2f(grad.y, -grad.x) * 0.3 + gather) * (0.45 + s * s * 1.1);
}

// The sand's colours, a loop round the desert: maroon, rust, burnt orange, amber, gold, bone, ash, sienna.
fn tint(pos: vec2f, s: ptr<function, u32>) -> u32 {
  var pal = array<vec3f, 8>(
    vec3f(110.0, 44.0, 30.0), vec3f(181.0, 80.0, 42.0), vec3f(224.0, 123.0, 40.0), vec3f(240.0, 164.0, 64.0),
    vec3f(222.0, 182.0, 98.0), vec3f(240.0, 228.0, 204.0), vec3f(170.0, 150.0, 128.0), vec3f(138.0, 90.0, 52.0),
  );
  // a slow noise map of the screen picks along the loop (give or take, grain by grain), another lightens or darkens
  let q = 3.0 * pos / (min(u.size.x, u.size.y) * 0.5);
  let x = noise(vec3f(q, u.time * 0.02 + 40.0)) * 6.0 + 4.0 + (rnd(s) - 0.5) * 1.2;
  let k = i32(floor(x));
  var c = mix(pal[k & 7], pal[(k + 1) & 7], smoothstep(0.0, 1.0, fract(x))) / 255.0;
  c *= max(1.0, 0.75 / max(c.r, max(c.g, c.b))); // (the dark ones lifted, or they'd vanish on the dark)
  c *= 0.75 + 0.25 * (noise(vec3f(q * 2.1 + 9.0, u.time * 0.03)) + 1.0);

  return pack4x8unorm(vec4f(saturate(c), 0.0));
}

fn deposit(p: vec2f, a: f32, rgb: vec3f) {
  let f = p - 0.5;
  let c = vec2i(floor(f));
  let t = f - floor(f);
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let q = c + o;
    if (q.x < 0 || q.y < 0 || f32(q.x) >= u.trail.x || f32(q.y) >= u.trail.y) { continue; }
    let w = select(1.0 - t.x, t.x, o.x == 1) * select(1.0 - t.y, t.y, o.y == 1);
    let i = 4u * (u32(q.y) * u.tw + u32(q.x));
    atomicAdd(&trail[i], u32(a * w * SCALE));
    atomicAdd(&trail[i + 1u], u32(a * rgb.r * w * SCALE));
    atomicAdd(&trail[i + 2u], u32(a * rgb.g * w * SCALE));
    atomicAdd(&trail[i + 3u], u32(a * rgb.b * w * SCALE));
  }
}

@compute @workgroup_size(64)
fn step(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= u.count) { return; }
  var g = grains[i];
  var s = pcg(g.seed ^ (u.frame * 2654435769u));
  var fresh = false;
  if (g.pace == 0.0) {
    g.seed = pcg(i * 2654435761u + 1u);
    s = g.seed;
    g.size = pow(rnd(&s), 20.0);
    g.pace = 0.55 + rnd(&s) * rnd(&s) * 2.0;
    g.vel = vec2f(0.0, -500.0);
    g.pos = vec2f(rnd(&s), rnd(&s)) * u.size;
    g.tint = tint(g.pos, &s);
    fresh = true;
  }
  let speed = 26.0;
  g.vel += (wind(g.pos) * speed - g.vel * 0.5) * (1.0 - exp(-u.dt * mix(6.0, 1.6, g.size)));
  // and a little Brownian jostle, which the pull back to the wind smooths into a wobble (more for the light ones)
  let jostle = vec2f(rnd(&s) + rnd(&s) + rnd(&s), rnd(&s) + rnd(&s) + rnd(&s)) * 2.0 - 3.0;
  g.vel += jostle * speed * sqrt(u.dt) * 0.5;
  let start = g.pos;
  g.pos += g.vel * u.dt;
  // off one edge, on at the other (so the sand stays evenly spread); now and then one is lifted away and set down
  // anywhere, so the ribbons never take up all of it
  let m = vec2f(20.0);
  let wrapped = g.pos + (u.size + 2.0 * m) * (vec2f(g.pos < -m) - vec2f(g.pos > u.size + m));
  if (any(wrapped != g.pos) || rnd(&s) < 0.1 * u.dt) {
    if (all(wrapped == g.pos)) {
      g.pos = vec2f(rnd(&s), rnd(&s)) * u.size;
      g.tint = tint(g.pos, &s);
    } else {
      g.pos = wrapped;
    }
    g.vel = wind(g.pos) * speed;
    grains[i] = g;
    return;
  }
  grains[i] = g;

  // the segment, a sample per trail px, each leaving ink by the length it covers (so slow and fast grains read alike)
  let a = start * u.ts;
  let b = g.pos * u.ts;
  let len = distance(a, b);
  let n = clamp(ceil(len), 1.0, 8.0);
  let c = unpack4x8unorm(g.tint).rgb;

  for (var k = 1.0; k <= n; k += 1.0) {
    deposit(mix(a, b, k / n), 0.01, c);
  }
}
`;

const FADE_WGSL = /* wgsl */ `
struct U { size: vec2f, trail: vec2f, canvas: vec2f, ts: f32, time: f32, dt: f32, decay: f32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> trail: array<u32>;

@compute @workgroup_size(256)
fn fade(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&trail)) { return; }
  trail[i] = u32(f32(trail[i]) * u.decay);
}
`;

const DRAW = /* wgsl */ `${COMMON}
@group(0) @binding(1) var<storage, read> trail: array<u32>;

fn texel(c: vec2i) -> vec4f {
  let q = clamp(c, vec2i(0), vec2i(u.trail) - 1);
  let i = 4u * (u32(q.y) * u.tw + u32(q.x));
  return vec4f(f32(trail[i]), f32(trail[i + 1u]), f32(trail[i + 2u]), f32(trail[i + 3u])) / SCALE;
}

fn sample(p: vec2f) -> vec4f {
  let f = p - 0.5;
  let c = vec2i(floor(f));
  let t = f - floor(f);
  return mix(mix(texel(c), texel(c + vec2i(1, 0)), t.x), mix(texel(c + vec2i(0, 1)), texel(c + vec2i(1, 1)), t.x), t.y);
}

fn srgb(r: f32, g: f32, b: f32) -> vec3f { return vec3f(r, g, b) / 255.0; }

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = fc.xy * u.size / u.canvas;
  let r = length(u.size) * 0.5;
  var col = mix(srgb(21, 16, 11), srgb(5, 4, 3), saturate(length(p - u.size * vec2f(0.5, 0.45)) / r));

  // the trails: in their grains' mean colour, thick and paler where many cross
  let d = sample(p * u.ts);
  var ink = d.yzw / max(d.x, 1e-5);
  ink = mix(ink, srgb(255, 248, 230), saturate(d.x - 1.2) * 0.5);
  col = mix(col, ink, (1.0 - exp(-d.x * 1.7)) * u.fadeIn);

  col *= 1.0 - 0.7 * saturate((length(p - u.size * 0.5) / r - 0.45) / 0.55);
  col = pow(col, vec3f(1.9));
  // a little dither so the dark gradients don't band
  col += (f32(pcg(u32(fc.x) + u32(fc.y) * 8192u + u.frame * 7919u) & 255u) / 255.0 - 0.5) / 255.0;
  return vec4f(col, 1.0);
}
`;

export type GpuDust = { resize(w: number, h: number, dpr: number): void; frame(dt: number): void; destroy(): void; lost: Promise<unknown> };

const ramp = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The dust on `canvas` (its own: a WebGPU canvas can't take 2D drawing), coming up from the dark over `dustIn` s,
 *  or null where WebGPU isn't to be had. */
export async function createGpuDust(canvas: OffscreenCanvas | HTMLCanvasElement, dustIn = 5): Promise<GpuDust | null> {
  const gpu = (globalThis.navigator as Navigator | undefined)?.gpu;
  if (!gpu) return null;
  const adapter = await gpu.requestAdapter({ powerPreference: 'low-power' }).catch(() => null);
  if (!adapter) return null;
  const got = await adapter.requestDevice().catch(() => null);
  if (!got) return null;
  const device: GPUDevice = got;
  const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!ctx) {
    device.destroy();
    return null;
  }
  const format = gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const module = (code: string) => device.createShaderModule({ code });
  const [fade, move, draw] = await Promise.all([
    device.createComputePipelineAsync({ layout: 'auto', compute: { module: module(FADE_WGSL), entryPoint: 'fade' } }),
    device.createComputePipelineAsync({ layout: 'auto', compute: { module: module(MOVE), entryPoint: 'step' } }),
    device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: module(DRAW), entryPoint: 'vs' },
      fragment: { module: module(DRAW), entryPoint: 'fs', targets: [{ format }] },
    }),
  ]).catch(() => [null, null, null] as const);
  if (!fade || !move || !draw) {
    device.destroy();
    return null;
  }

  const ubuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uf = new Float32Array(16);
  const uu = new Uint32Array(uf.buffer);
  let grains: GPUBuffer | null = null;
  let trail: GPUBuffer | null = null;
  let groups: { fade: GPUBindGroup; move: GPUBindGroup; draw: GPUBindGroup } | null = null;
  let count = 0;
  let trailWords = 0;
  let clock = 0;
  let frames = 0;
  let pending = 0; // time not yet stepped while the GPU was still busy with the last frame
  let busy = false;
  let dead = false;

  function resize(cw: number, ch: number, deviceRatio: number) {
    const w = Math.max(1, cw);
    const h = Math.max(1, ch);
    const dpr = Math.min(deviceRatio, 2, Math.sqrt(MAX_PIXELS / (w * h)));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ts = Math.min(deviceRatio, Math.sqrt(TRAIL_PIXELS / (w * h)));
    const tw = Math.ceil(w * ts);
    const th = Math.ceil(h * ts);
    count = Math.round(Math.min(300000, Math.max(40000, w * h * 0.12)));
    trailWords = tw * th * 4;
    grains?.destroy();
    trail?.destroy();
    grains = device.createBuffer({ size: count * 32, usage: GPUBufferUsage.STORAGE }); // zeroed: placed on their first step
    trail = device.createBuffer({ size: trailWords * 4, usage: GPUBufferUsage.STORAGE });
    groups = {
      fade: device.createBindGroup({ layout: fade!.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: trail } }] }),
      move: device.createBindGroup({
        layout: move!.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: grains } }, { binding: 2, resource: { buffer: trail } }],
      }),
      draw: device.createBindGroup({ layout: draw!.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: trail } }] }),
    };
    uf.set([w, h, tw, th, canvas.width, canvas.height, ts]);
    uu[13] = tw;
  }

  function frame(dt: number) {
    if (dead || !groups) return;
    if (busy) {
      pending += dt;
      return;
    }
    dt = Math.min(0.05, dt + pending);
    pending = 0;
    clock += dt;
    uf[7] = clock;
    uf[8] = dt;
    uf[9] = Math.pow(1 - FADE, dt * 60);
    uf[10] = ramp(clock / dustIn);
    uu[11] = count;
    uu[12] = ++frames;
    device.queue.writeBuffer(ubuf, 0, uf);

    const enc = device.createCommandEncoder();
    const cp = enc.beginComputePass();
    cp.setPipeline(fade!);
    cp.setBindGroup(0, groups.fade);
    cp.dispatchWorkgroups(Math.ceil(trailWords / 256));
    cp.setPipeline(move!);
    cp.setBindGroup(0, groups.move);
    cp.dispatchWorkgroups(Math.ceil(count / 64));
    cp.end();
    const rp = enc.beginRenderPass({ colorAttachments: [{ view: ctx!.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    rp.setPipeline(draw!);
    rp.setBindGroup(0, groups.draw);
    rp.draw(3);
    rp.end();
    device.queue.submit([enc.finish()]);
    busy = true;
    device.queue.onSubmittedWorkDone().then(() => (busy = false), () => {});
  }

  return {
    resize,
    frame,
    lost: device.lost,
    destroy() {
      dead = true;
      device.destroy();
    },
  };
}
