// Export a posed scavenger from the models lab as an STL (for printing or another tool), with `npm run dev` up:
//   node tools/models/stl.mjs <out.stl> [query=clip=Idle&item=laser_rifle] [waitMs=8000]
// e.g. node tools/models/stl.mjs data/rifle-aim.stl 'clip=Idle&item=laser_rifle&aim&pitch=0.1'
// Opens http://localhost:5173/models-lab.html?<query> in headless Chrome (CHROME=path, default chromium; WebGL2, as
// its WebGPU is flaky), lets the pose settle and the held item load, then saves `lab.stl()` (src/models/lab.ts):
// Z up, millimetres, feet at z = 0.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const [out, query = 'clip=Idle&item=laser_rifle', wait = '8000'] = process.argv.slice(2);
if (!out) throw new Error('usage: node tools/models/stl.mjs <out.stl> [query] [waitMs]');
const url = `${process.env.LAB ?? 'http://localhost:5173/models-lab.html'}?${query}`;
const CHROME = process.env.CHROME ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'chromium');
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'stl-'))}`,
  '--window-size=800,600', '--ignore-gpu-blocklist', '--no-first-run', '--mute-audio', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error(`no Chrome at ${CHROME} (set CHROME=)`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.once('open', r));
  let id = 0;
  const pending = new Map();
  ws.on('message', (m) => {
    const msg = JSON.parse(m.toString());
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
    if (msg.method === 'Runtime.exceptionThrown') console.log('exception', msg.params.exceptionDetails.exception?.description);
  });
  const send = (method, params = {}) => new Promise((r) => {
    pending.set(++id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(+wait);
  const res = await send('Runtime.evaluate', { expression: 'lab.stl(0)', returnByValue: true });
  const data = res.result?.result?.value;
  if (!data) throw new Error('lab.stl failed: ' + JSON.stringify(res.result?.exceptionDetails ?? res.error));
  const bytes = Buffer.from(data, 'base64');
  writeFileSync(out, bytes);
  console.log(`saved ${out}: ${bytes.readUInt32LE(80)} triangles (${url})`);
  ws.close();
} finally {
  chrome.kill();
}
