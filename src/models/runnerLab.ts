// The models lab's runners (models-lab.html?runner; src/models/lab.ts): the runner (src/world/runner.ts) walking and
// running over the lab's dunes, to check the model, the gait and the feet.
//   ?runner            four: walking a small circle, trotting a wider one, galloping round them all, and one standing
//                      in the middle watching the camera
//   ?runner=7.5        one circling at that speed (m/s), the camera following it
//   ?runner=prowl      one prowling round the middle as summoned ones do in the game (debug menu), the camera following
//   ?runner=armed      the armed one (a rifle on an arm on its back) prowling so, aiming at the camera when it stops
//   &armed             with a speed: the armed one circling
//   ?runner=stab       two armed ones galloping side by side: the inner holding its gun steady (as in the game), the
//                      outer with the gun fixed to its body, riding every bounce
//   &nostab            no gun held steady
// The four: the trotting one and the standing one are armed (the standing one aims at the camera and fires).
import * as THREE from 'three/webgpu';
import { loadRunner, Prowl, Runner, type Ground } from '../world/runner';
import { RUNNER_SPRINT, RUNNER_TROT, RUNNER_WALK } from '../../shared/runner.ts';

type Driver = (dt: number, now: number) => { x: number; z: number; yaw: number; look: boolean };

/** Goes round a circle of radius r about (cx, cz) at `speed`, anticlockwise seen from above. */
function circle(cx: number, cz: number, r: number, speed: number, a0: number): Driver {
  let a = a0;
  return (dt) => {
    a += (speed / r) * dt;
    return { x: cx + r * Math.cos(a), z: cz + r * Math.sin(a), yaw: Math.atan2(-Math.sin(a), Math.cos(a)), look: false };
  };
}

export async function runnerLab(scene: THREE.Scene, ground: Ground, mode: string) {
  await loadRunner();
  const drivers: Driver[] = [];
  const single = mode !== '' && mode !== 'stab';
  const armedOnly = mode === 'armed' || new URLSearchParams(location.search).has('armed');
  const stab = mode === 'stab';
  if (stab) {
    drivers.push(circle(0, 0, 11, 12, 0));
    drivers.push(circle(0, 0, 15, 12 * 15 / 11, 0));
  } else if (mode === 'prowl' || mode === 'armed') {
    const p = new Prowl(0, -6, 0);
    drivers.push((dt, now) => {
      p.update(dt, 0, 0, now);
      return { x: p.x, z: p.z, yaw: p.yaw, look: p.speed < RUNNER_TROT };
    });
  } else if (single) {
    drivers.push(circle(0, 0, Math.max(6, Number(mode) * 1.4), Number(mode) || RUNNER_WALK, 0));
  } else {
    drivers.push(circle(0, 0, 6, RUNNER_WALK, 0));
    drivers.push(circle(0, 0, 12, RUNNER_TROT, 2));
    drivers.push(circle(0, 0, 20, RUNNER_SPRINT, 4));
    drivers.push(() => ({ x: 0, z: 0, yaw: 0.6, look: true }));
  }
  const runners = drivers.map((_, i) => {
    const r = new Runner(ground, armedOnly || mode === 'stab' || (!single && (i === 1 || i === 3)) ? 'armed' : 'plain');
    r.stabilize = !new URLSearchParams(location.search).has('nostab') && !(stab && i === 1);
    scene.add(r.root);
    return r;
  });
  Object.assign(window, { runnerLab: { runners } }); // for poking at from the console
  const focus = new THREE.Vector3();
  return {
    label: stab ? 'gun held steady (inner) · gun fixed to the body (outer)' : single ? `runner ${mode}` : `runners: walk ${RUNNER_WALK} · trot ${RUNNER_TROT} · gallop ${RUNNER_SPRINT} m/s · standing`,
    /** Where the camera should look, following the one runner (null: the camera's own target). */
    update(dt: number, now: number, eye: THREE.Vector3): THREE.Vector3 | null {
      drivers.forEach((d, i) => {
        const at = d(dt, now);
        runners[i].alert = single || stab ? 0 : i === 2 ? 1 : 0;
        runners[i].update(dt, at.x, at.z, at.yaw, at.look ? eye : null, now);
      });
      if (!single) return null;
      return focus.copy(runners[0].position).setY(runners[0].position.y - 0.3);
    },
  };
}
