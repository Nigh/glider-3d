import { NoBlending, Quaternion, Vector3, type Material, type Object3D } from 'three';
import type { FlightSimulation } from './physics';

export const GHOST_LOOKAHEAD = 1;
export const GHOST_SECTION_WIDTH = 24;
export interface GhostFrame {
  time: number; flightTime: number; ended: boolean; position: number[]; quaternion: number[]; cg: number[];
  pilot: number[]; controls: number[]; thrust: number; sections: Float64Array; fragments: Float64Array; done: boolean;
}
export type GhostFragment = Pick<FlightSimulation['fragments'][number], 'id' | 'position' | 'quaternion' | 'cg'>;

export function captureGhost(sim: FlightSimulation): GhostFrame {
  const sections = new Float64Array(sim.structure.sections.length * GHOST_SECTION_WIDTH);
  sim.structure.sections.forEach((s, i) => {
    const offset = i * GHOST_SECTION_WIDTH;
    sections.set([s.bodyId, ...s.root.position.toArray(), ...s.tip.position.toArray(), ...s.root.quaternion.toArray(),
      ...s.tip.quaternion.toArray(), s.controlDeflection, ...s.referenceRoot.toArray(), ...s.referenceTip.toArray(), s.surface.incidence, s.crownIncidence], offset);
  });
  const fragments = new Float64Array(sim.fragments.length * 11);
  sim.fragments.forEach((f, i) => fragments.set([f.id, ...f.position.toArray(), ...f.quaternion.toArray(), ...f.cg.toArray()], i * 11));
  return { time: sim.elapsedTime, flightTime: sim.time, ended: sim.ended, position: sim.position.toArray(), quaternion: sim.quaternion.toArray(), cg: sim.telemetry.cg.toArray(),
    pilot: [sim.pilotOffset.x, sim.pilotOffset.z], controls: [sim.controlDeflections.aileron, sim.controlDeflections.elevator, sim.controlDeflections.rudder],
    thrust: sim.telemetry.thrust, sections, fragments, done: sim.ended || sim.replayFinished };
}

/** Keep every input step, but send at most 60 visual samples per simulated second. */
export function advanceGhost(sim: FlightSimulation, until: number): GhostFrame[] {
  const frames: GhostFrame[] = [], neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0 };
  while (!sim.ended && !sim.replayFinished && sim.elapsedTime < until) {
    const next = sim.elapsedTime + 1 / 60;
    do { sim.step(neutral); } while (!sim.ended && !sim.replayFinished && sim.elapsedTime < next - 1e-9);
    frames.push(captureGhost(sim));
  }
  return frames;
}

/** Update only render inputs. This simulation is never stepped on the UI thread. */
export function applyGhost(sim: FlightSimulation, frame: GhostFrame, fragments: GhostFragment[]) {
  sim.position.fromArray(frame.position); sim.quaternion.fromArray(frame.quaternion); sim.telemetry.cg.fromArray(frame.cg);
  sim.time = frame.flightTime; sim.ended = frame.ended; sim.telemetry.thrust = frame.thrust;
  sim.pilotOffset.x = frame.pilot[0]; sim.pilotOffset.z = frame.pilot[1];
  [sim.controlDeflections.aileron, sim.controlDeflections.elevator, sim.controlDeflections.rudder] = frame.controls;
  sim.structure.sections.forEach((s, i) => {
    const o = i * GHOST_SECTION_WIDTH, data = frame.sections;
    s.bodyId = data[o]; s.root.position.fromArray(data, o + 1); s.tip.position.fromArray(data, o + 4);
    s.root.quaternion.fromArray(data, o + 7); s.tip.quaternion.fromArray(data, o + 11); s.controlDeflection = data[o + 15];
    s.referenceRoot.fromArray(data, o + 16); s.referenceTip.fromArray(data, o + 19); s.surface.incidence = data[o + 22]; s.crownIncidence = data[o + 23];
  });
  fragments.length = frame.fragments.length / 11;
  for (let i = 0; i < fragments.length; i++) {
    const f = fragments[i] ??= { id: 0, position: new Vector3(), quaternion: new Quaternion(), cg: new Vector3() }, o = i * 11;
    f.id = frame.fragments[o]; f.position.fromArray(frame.fragments, o + 1); f.quaternion.fromArray(frame.fragments, o + 4); f.cg.fromArray(frame.fragments, o + 8);
  }
}

export function ghostOpacity(distance: number, radius: number) {
  return 0.2 + 0.8 * Math.max(0, Math.min(1, (distance / Math.max(radius, 1e-6) - 1) / 3));
}

export const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;
export function ditherGhost(root: Object3D, opacity: { value: number }, patched: Set<Material>) {
  root.traverse(object => {
    object.castShadow = false;
    const materials = (object as Object3D & { material?: Material | Material[] }).material;
    for (const material of materials ? Array.isArray(materials) ? materials : [materials] : []) {
      if (patched.has(material)) continue;
      patched.add(material); material.transparent = false; material.depthWrite = true; material.blending = NoBlending;
      material.onBeforeCompile = shader => {
        shader.uniforms.ghostOpacity = opacity;
        shader.fragmentShader = `uniform float ghostOpacity;\n${shader.fragmentShader}`.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          int bayerIndex = int(mod(gl_FragCoord.x, 4.0)) + 4 * int(mod(gl_FragCoord.y, 4.0));
          float bayer[16] = float[16](${BAYER_4.map(n => `${(n + 0.5) / 16}`).join(',')});
          if (diffuseColor.a * ghostOpacity < bayer[bayerIndex]) discard;
        `);
      };
      material.customProgramCacheKey = () => 'ghost-bayer-4'; material.needsUpdate = true;
    }
  });
}

export class GhostBuffer {
  frames: GhostFrame[] = [];
  push(frames: GhostFrame[]) { this.frames.push(...frames); }
  get end() { return this.frames.at(-1); }
  covers(time: number) { return !!this.end && (this.end.done || this.end.time >= time); }
  sample(time: number) {
    while (this.frames.length > 2 && this.frames[1].time <= time) this.frames.shift();
    const a = this.frames[0], b = this.frames[1] ?? a;
    if (!a) return null;
    return { a, b, alpha: b.time > a.time ? Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time))) : 1 };
  }
}
