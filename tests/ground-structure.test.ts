import { afterEach, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { clone, presets } from '../src/model';
import { FlightSimulation, GRAVITY } from '../src/physics';
import * as challenges from '../src/challenges';
import { cacheFlight, cacheRecording, seekReplay } from '../src/playback';

const neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0 };
afterEach(() => vi.restoreAllMocks());

function grazing(downward = 0.3, weak = false) {
  const definition = clone(presets.find(p => p.name === '基础单发型')!);
  if (weak) {
    definition.mainWing.materialId = 'spruce';
    definition.mainWing.structure = { width: 0.05, height: 0.07, wallThickness: 0.002 };
  }
  const sim = new FlightSimulation(definition, 'low-altitude', 0);
  sim.launching = false;
  sim.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.4);
  sim.position.set(50, 30, 100);
  sim.velocity.set(8, -downward, 0);
  const contacts = (sim as any).contacts as Vector3[];
  sim.position.y = 20 - Math.min(...contacts.map(point => point.clone().sub(sim.cg).applyQuaternion(sim.quaternion).y));
  return sim;
}

it('transmits the actual contact force and chordwise moment through only the contacted strip and inboard joints', () => {
  for (const fraction of [0, 0.5, 1]) {
    const sim = grazing();
    sim.structure.reset(); sim.quaternion.identity(); sim.omega.set(0, 0, 0);
    const sections = sim.structure.sections;
    const chain = sections.filter(s => s.wingKey === 'mainWing' && s.side === -1);
    const hit = chain[Math.floor((chain.length - 1) * fraction)];
    // Offset the contact in both chord and span. Moving it to the panel centre
    // would lose the torsional moment, even if the resultant force stayed right.
    const point = hit.referenceRoot.clone().lerp(hit.referenceTip, 0.7).add(new Vector3(0.2, -0.04, 0));
    const force = new Vector3(0, 20, 0);
    const loads = sections.map(() => ({ force: new Vector3(), moment: new Vector3() }));
    loads[hit.id].force.copy(force);
    loads[hit.id].moment.crossVectors(point, force);
    sim.structure.update(sim, new Vector3(), new Vector3(), loads);
    for (const section of sections) {
      const expected = section.wingKey === hit.wingKey && section.side === hit.side && section.spanStart <= hit.spanStart
        ? new Vector3().crossVectors(point.clone().sub(section.referenceRoot), force) : new Vector3();
      expect(section.moment.distanceTo(expected)).toBeLessThan(1e-10);
      expect(section.load.distanceTo(section.id === hit.id ? force : new Vector3())).toBeLessThan(1e-10);
    }
    expect(chain.at(-1)!.tip.position.distanceTo(chain.at(-1)!.referenceTip)).toBeGreaterThan(1e-6);
    expect(sections.filter(s => s.side === 1 && s.wingKey === 'mainWing').every(s => s.stressRatio === 0)).toBe(true);
  }
});

it('includes initial impact loads in both local bending and the rigid-body inertial field, then clears them', () => {
  vi.spyOn(challenges, 'challengeTerrainHeight').mockReturnValue(20);
  const sim = grazing();
  const before = sim.velocity.clone(), mass = sim.mass, dt = 1 / 60;
  const originalUpdate = sim.structure.update;
  const update = vi.spyOn(sim.structure, 'update');
  let contactForce = 0;
  update.mockImplementation((body, force, torque, loads) => {
    if (body === sim) contactForce = loads!.reduce((sum, load) => sum + load.force.length(), 0);
    return originalUpdate.call(sim.structure, body, force, torque, loads);
  });
  sim.step(neutral, dt);
  expect(sim.ended).toBe(false); expect(sim.fragments).toHaveLength(0);
  expect(contactForce).toBeGreaterThan(1);
  const appliedForce = update.mock.calls.find(call => call[0] === sim)![1];
  const expected = sim.velocity.clone().sub(before).multiplyScalar(mass / dt).add(new Vector3(0, mass * GRAVITY, 0));
  expect(appliedForce.distanceTo(expected)).toBeLessThan(1e-8);
  expect((sim as any).wingContactLoads.every((load: any) => load.force.lengthSq() === 0 && load.moment.lengthSq() === 0)).toBe(true);
  expect(sim.structure.sections.some(s => s.wingKey === 'mainWing' && s.side === -1 && s.moment.length() > 1)).toBe(true);
});

it('transmits accepted midpoint support reactions without needing a closing impact', () => {
  vi.spyOn(challenges, 'challengeTerrainHeight').mockReturnValue(20);
  const sim = grazing(0);
  const addImpulse = vi.spyOn(sim as any, 'addWingContactImpulse');
  const originalUpdate = sim.structure.update;
  let supportForce = 0;
  vi.spyOn(sim.structure, 'update').mockImplementation((body, force, torque, loads) => {
    if (body === sim) supportForce = Math.max(supportForce, loads!.reduce((sum, load) => sum + load.force.length(), 0));
    originalUpdate.call(sim.structure, body, force, torque, loads);
  });
  sim.step(neutral);
  expect(sim.ended).toBe(false);
  expect(addImpulse.mock.calls.some(call => !call[3] && Number(call[2]) > 0)).toBe(true);
  expect(addImpulse.mock.calls.filter(call => call[3]).every(call => Number(call[2]) < 1e-8)).toBe(true);
  expect(supportForce).toBeGreaterThan(1);
});

it('grazing impacts bend a strong wing and fracture a weak wing without creating energy', () => {
  vi.spyOn(challenges, 'challengeTerrainHeight').mockReturnValue(20);
  for (const weak of [false, true]) {
    const sim = grazing(3, weak);
    sim.velocity.x = 0;
    const free = sim.checkpoint(); free.position.y += 50;
    free.step(neutral); expect(free.structure.fractureCount).toBe(0);
    (sim as any).updateTelemetry();
    const before = sim.telemetry.energy, dissipated = sim.telemetry.dissipatedEnergy;
    sim.step(neutral);
    expect(sim.ended).toBe(false);
    expect(sim.structure.maxDeflection).toBeGreaterThan(1e-4);
    expect(sim.structure.fractureCount > 0).toBe(weak);
    expect(sim.structure.peakWings[0].stress > 1).toBe(weak);
    expect(sim.structure.sections.filter(s => s.bodyId !== 0).every(s => s.wingKey === 'mainWing')).toBe(true);
    expect(sim.getRecording().wingLoads![0]).toBeCloseTo(sim.structure.peakWings[0].stress, 12);
    const t = sim.telemetry;
    expect(t.energy + t.dissipatedEnergy - dissipated - t.propulsionWork - t.controlWork - t.waterWork + t.fuelEnergyRemoved).toBeCloseTo(before, 5);
  }
});

it('does not amplify impact stress when swept collision searches subdivide the physics interval', () => {
  vi.spyOn(challenges, 'challengeTerrainHeight').mockReturnValue(20);
  const touching = grazing(3); touching.step(neutral);
  const sim = grazing(3);
  sim.position.y += 0.01;
  const integrate = vi.spyOn(sim as any, 'integrateFlight');
  sim.step(neutral);
  expect(integrate.mock.calls.length).toBeGreaterThan(2);
  expect(sim.structure.fractureCount).toBe(0);
  const stressRatio = sim.structure.peakWings[0].stress / touching.structure.peakWings[0].stress;
  expect(stressRatio).toBeGreaterThan(0.5); expect(stressRatio).toBeLessThan(2);
});

const state = (s: FlightSimulation) => ({
  position: s.position.toArray(), velocity: s.velocity.toArray(), quaternion: s.quaternion.toArray(), omega: s.omega.toArray(),
  mass: s.mass, energy: s.telemetry.energy, dissipated: s.telemetry.dissipatedEnergy,
  sections: s.structure.sections.map(p => [p.bodyId, p.stressRatio, ...p.moment.toArray(), ...p.tip.position.toArray()]),
  fragments: s.fragments.map(f => [f.id, f.landed, ...f.position.toArray(), ...f.velocity.toArray()]),
});

it('restores contact-induced deformation and fractures deterministically when seeking forward and backward', async () => {
  vi.spyOn(challenges, 'challengeTerrainHeight').mockReturnValue(20);
  const sim = grazing(3, true); sim.velocity.x = 0;
  const initial = sim.checkpoint();
  cacheFlight(sim);
  const states = new Map<number, ReturnType<typeof state>>();
  for (let frame = 0; frame < 8 && !sim.ended; frame++) {
    sim.step(neutral); states.set(sim.recordingLength, state(sim)); cacheFlight(sim);
  }
  expect(sim.structure.fractureCount).toBeGreaterThan(0);
  const recording = sim.getRecording(), replay = { definition: sim.definition, challenge: sim.challenge, recording };
  cacheRecording(sim, recording);
  initial.resumeReplay(recording, 0);
  while (!initial.replayFinished && !initial.ended) {
    initial.step(neutral); expect(state(initial)).toEqual(states.get(initial.replayFrame));
  }
  for (const frame of [3, 1, recording.length]) {
    const restored = await seekReplay(replay, frame / 60, () => false);
    expect(restored!.replayFrame).toBe(frame);
    expect(state(restored!)).toEqual(states.get(frame));
  }
});
