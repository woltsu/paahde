// The dev test lab's name plates (shared/lab.ts labPlates): dark boards with the name of what lies or stands there, flat
// on the floor, readable from the spawn side. Dev-only, so their words are composed here (docs/text.md).
import * as THREE from 'three/webgpu';
import { heightAt } from '../../shared/terrain.ts';
import { LAB_TERMINALS, labPlates } from '../../shared/lab.ts';
import { NetTerminal, TERMINALS } from './netTerminal.ts';
import { bar, fit, wrap, type TerminalProgram } from './terminalText.ts';

function plate(text: string, w: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(24, 28, 34, 0.9)';
  g.beginPath();
  g.roundRect(4, 4, 504, 120, 16);
  g.fill();
  g.fillStyle = '#e8eef5';
  g.font = '600 52px ui-monospace, Menlo, Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Long names (the jet engines' seeds) shrink to fit.
  const fit = Math.min(1, 480 / Math.max(1, g.measureText(text).width));
  g.font = `600 ${Math.floor(52 * fit)}px ui-monospace, Menlo, Consolas, monospace`;
  g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  m.rotation.x = -Math.PI / 2; // lying flat, its top toward the machines, readable from the spawn side
  return m;
}

/** Puts every plate of the lab in the scene (none outside it). */
export function addLabPlates(scene: THREE.Object3D) {
  for (const p of labPlates()) {
    const m = plate(p.text, p.w);
    m.position.set(p.x, heightAt(p.x, p.z) + 0.06, p.z);
    scene.add(m);
  }
}

/** An example of a custom terminal program (docs/terminals.md), on the lab's compact terminal: a status board redrawn
 *  once a second (screen-style `setLines`), a prompt with the cursor blinking at it. */
function labBoard(): TerminalProgram {
  let clock = 0, shown = -1;
  return {
    update(text, dt) {
      clock += dt;
      const s = Math.floor(clock);
      if (s === shown) return; // nothing new: no redraw, no upload
      shown = s;
      const w = text.cols;
      text.setLines([
        fit(' LAB TERMINAL ', w, 'center', '='),
        '',
        ` awake    ${fit(String(s), 6, 'right')} s`,
        ` load     ${bar((Math.sin(clock * 0.7) + 1) / 2, 30)}`,
        '',
        ...wrap('A custom program: src/world/labPlates.ts labBoard. Any object with update(text, dt) will do; see docs/terminals.md.', w - 2).map((l) => ` ${l}`),
      ]);
      text.print(0, text.rows - 1, '> ');
      text.moveTo(2, text.rows - 1);
    },
  };
}

/** The lab's net terminals, each on a dark stand (shared/lab.ts LAB_TERMINALS); the caller updates them every frame. The
 *  console streams code (the default program), the compact runs `labBoard`. */
export function addLabTerminals(scene: THREE.Object3D): NetTerminal[] {
  const standMat = new THREE.MeshStandardNodeMaterial({ color: 0x3a3d42, roughness: 0.7 });
  return LAB_TERMINALS.map(({ kind, x, z, facing }, i) => {
    const y = heightAt(x, z);
    const [w, d] = TERMINALS[kind].footprint;
    const stand = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.74, d + 0.1), standMat);
    stand.position.set(x, y + 0.37, z);
    stand.rotation.y = facing;
    stand.castShadow = stand.receiveShadow = true;
    const t = new NetTerminal({ kind, seed: i + 1, program: kind === 'compact' ? labBoard() : undefined });
    t.object.position.set(x, y + 0.74, z);
    t.object.rotation.y = facing;
    scene.add(stand, t.object);
    return t;
  });
}
