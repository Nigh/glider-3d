import { afterEach, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { clone, presets, wing } from '../src/model';
import { FlightSimulation, GRAVITY, GROUND_FRICTION } from '../src/physics';
import * as challenges from '../src/challenges';
import { cacheFlight, cacheRecording, seekReplay } from '../src/playback';
import { rotationalEnergy, type SectionContactLoad, type StructureSection, type StructuralBody, type WingFragment } from '../src/structure';
import { FIXED_DT, FixedGameClock } from '../src/game-clock';

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

it('ground friction opposes sliding and accounts for its work without injecting energy', () => {
  vi.spyOn(challenges, 'challengeTerrainHeight').mockReturnValue(20);
  for (const direction of [new Vector3(8, 0, 0), new Vector3(0, 0, -8)]) {
    const sim = grazing(0); sim.velocity.copy(direction);
    const free = sim.checkpoint(); free.position.y += 100;
    (sim as any).updateTelemetry();
    const initial = sim.telemetry.energy;
    const friction = vi.spyOn(sim as any, 'solveContactFriction');
    for (let frame = 0; frame < 10; frame++) { sim.step({ ...neutral, throttle: 0 }); free.step({ ...neutral, throttle: 0 }); }
    expect(sim.ended).toBe(false);
    // A wingtip only supports part of the weight while the body rolls toward
    // the ground; compare with the same aerodynamic motion in free air.
    expect(sim.velocity.dot(direction.clone().normalize())).toBeLessThan(free.velocity.dot(direction.clone().normalize()) - 0.01);
    expect(friction.mock.calls.some(call => Number(call[4]) > 0)).toBe(true);
    expect(GROUND_FRICTION).toBeGreaterThan(0);
    const t = sim.telemetry;
    expect(t.dissipatedEnergy).toBeGreaterThan(0);
    expect(t.energy + t.dissipatedEnergy - t.propulsionWork - t.controlWork - t.waterWork + t.fuelEnergyRemoved).toBeCloseTo(initial, 5);
  }
});

it('gravity rolls a banked aircraft about its grounded wing instead of freezing its attitude', () => {
  vi.spyOn(challenges, 'challengeTerrainHeight').mockReturnValue(20);
  const sim = grazing(0); sim.velocity.set(0, 0, 0);
  const initial = sim.quaternion.clone();
  for (let frame = 0; frame < 12; frame++) sim.step({ ...neutral, throttle: 0 });
  expect(sim.ended).toBe(false);
  expect(sim.quaternion.angleTo(initial)).toBeGreaterThan(0.005);
  expect(sim.omega.x).toBeLessThan(-0.01);
  expect(sim.structure.sections.some(s => s.load.y < -0.01)).toBe(true);
});

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
  const originalUpdate = sim.structure.measureLoads;
  const update = vi.spyOn(sim.structure, 'measureLoads');
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
  const originalUpdate = sim.structure.measureLoads;
  let supportForce = 0;
  vi.spyOn(sim.structure, 'measureLoads').mockImplementation((body, force, torque, loads) => {
    if (body === sim) supportForce = Math.max(supportForce, loads!.reduce((sum, load) => sum + load.force.length(), 0));
    return originalUpdate.call(sim.structure, body, force, torque, loads);
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

type CollisionInternals = {
  contacts: (Vector3 & { sectionId?: number })[];
  wingContactLoads: SectionContactLoad[]; wingImpactLoads: SectionContactLoad[];
  previousVelocity: Vector3; previousOmega: Vector3; midpointOmega: Vector3;
  initialImpactImpulse: Vector3; initialImpactTorque: Vector3;
  finalImpactImpulse: Vector3; finalImpactTorque: Vector3;
  advanceStructure(dt: number, force: Vector3, torque: Vector3): void;
  updateTelemetry(): void;
};

function collisionInternals(sim: FlightSimulation) {
  // Tests observe existing private acceptance hooks without widening production API.
  return sim as unknown as CollisionInternals;
}

function longWingCollision(bank: number, strong = false) {
  const definition = clone(presets.find(p => p.name === '基础单发型')!);
  definition.mainWing = { ...definition.mainWing, ...wing(24, 1.5, 1), materialAmount: 2 };
  if (strong) definition.mainWing.structure = { width: 0.15, height: 0.3, wallThickness: 0.005 };
  const sim = new FlightSimulation(definition, 'low-altitude', 0);
  sim.launching = false; sim.structure.reset();
  sim.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), bank);
  sim.position.set(50, 0, 100); sim.velocity.set(8, -0.3, 0);
  const contacts = collisionInternals(sim).contacts;
  sim.position.y = Math.max(...contacts.map(point => {
    const world = point.clone().sub(sim.cg).applyQuaternion(sim.quaternion).add(sim.position);
    return challenges.challengeTerrainHeight('low-altitude', world.x, world.z) - world.y;
  })) + 1e-6;
  collisionInternals(sim).updateTelemetry();
  return sim;
}

function ledger(sim: FlightSimulation) {
  const t = sim.telemetry;
  return t.energy + t.dissipatedEnergy - t.propulsionWork - t.controlWork - t.waterWork + t.fuelEnergyRemoved;
}

function collisionEvidence(sim: FlightSimulation) {
  const conserved = () => {
    let mass = 0, energy = 0;
    const momentum = new Vector3(), angularMomentum = new Vector3();
    for (const body of [sim, ...sim.fragments]) {
      mass += body.mass;
      const linear = body.velocity.clone().multiplyScalar(body.mass);
      momentum.add(linear);
      angularMomentum.add(body.omega.clone().applyMatrix3(body.inertiaTensor).applyQuaternion(body.quaternion))
        .add(new Vector3().crossVectors(body.position, linear));
      energy += body.mass * (body.velocity.lengthSq() / 2 + GRAVITY * body.position.y)
        + rotationalEnergy(body.inertiaTensor, body.omega);
    }
    return { mass, energy, momentum, angularMomentum };
  };
  const fractureBody = sim as unknown as { commitFractures(body: StructuralBody): WingFragment | undefined };
  const commit = fractureBody.commitFractures;
  vi.spyOn(fractureBody, 'commitFractures').mockImplementation(body => {
    const before = conserved(), result = commit.call(sim, body), after = conserved();
    expect(Math.abs(after.mass - before.mass) / before.mass).toBeLessThanOrEqual(1e-9);
    expect(after.momentum.distanceTo(before.momentum) / Math.max(1, before.momentum.length())).toBeLessThanOrEqual(1e-9);
    expect(after.angularMomentum.distanceTo(before.angularMomentum) / Math.max(1, before.angularMomentum.length())).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(after.energy - before.energy) / Math.max(1, Math.abs(before.energy))).toBeLessThanOrEqual(1e-9);
    return result;
  });
  const sections = sim.structure.sections;
  type Measurement = { ids: number[]; stress: number[]; serial: number };
  type Wrench = { force: Vector3; moment: Vector3 };
  type FrozenLoads = { sections: Map<number, Wrench>; residual: Wrench };
  const measured = new Map<number, Measurement>(), frozen = new Map<number, FrozenLoads>();
  const latestLoads = new Map<number, FrozenLoads>();
  const events: { time: number; id: number; wingKey: StructureSection['wingKey']; side: number; spanStart: number; stress: number; measurement: number; previousBody: number; bodyId: number }[] = [];
  let serial = 0, framePeaks = [0, 0, 0], expectedContacts: SectionContactLoad[] | undefined;
  const frameStress = sections.map(() => 0);
  const internal = collisionInternals(sim), originalAdvance = internal.advanceStructure;
  vi.spyOn(internal, 'advanceStructure').mockImplementation((dt, force, torque) => {
    frozen.clear(); latestLoads.clear();
    // Sustained reactions use accepted dt; discrete impacts always use 1/60 s.
    expectedContacts = internal.wingContactLoads.map((load, id) => ({
      force: load.force.clone().divideScalar(dt).addScaledVector(internal.wingImpactLoads[id].force, 60),
      moment: load.moment.clone().divideScalar(dt).addScaledVector(internal.wingImpactLoads[id].moment, 60),
    }));
    const expectedForce = sim.velocity.clone().sub(internal.previousVelocity).multiplyScalar(sim.mass / dt);
    expectedForce.y += sim.mass * GRAVITY;
    expectedForce.addScaledVector(internal.initialImpactImpulse, 60).addScaledVector(internal.finalImpactImpulse, 60 - 1 / dt);
    const angularMomentum = internal.midpointOmega.clone().applyMatrix3(sim.inertiaTensor);
    const expectedTorque = sim.omega.clone().sub(internal.previousOmega).applyMatrix3(sim.inertiaTensor).divideScalar(dt)
      .add(new Vector3().crossVectors(internal.midpointOmega, angularMomentum))
      .addScaledVector(internal.initialImpactTorque, 60).addScaledVector(internal.finalImpactTorque, 60 - 1 / dt);
    expect(force.distanceTo(expectedForce)).toBeLessThan(1e-8);
    expect(torque.distanceTo(expectedTorque)).toBeLessThan(1e-8);
    return originalAdvance.call(sim, dt, force, torque);
  });
  const originalMeasure = sim.structure.measureLoads;
  vi.spyOn(sim.structure, 'measureLoads').mockImplementation((body, force, torque, contacts) => {
    if (body.id === 0 && expectedContacts) {
      expect(contacts).toBeDefined();
      for (let id = 0; id < expectedContacts.length; id++) {
        expect(contacts![id].force.distanceTo(expectedContacts[id].force)).toBeLessThan(1e-8);
        expect(contacts![id].moment.distanceTo(expectedContacts[id].moment)).toBeLessThan(1e-8);
      }
      expectedContacts = undefined;
    }
    const inverse = body.quaternion.clone().invert();
    const localForce = force.clone().applyQuaternion(inverse);
    const originMoment = torque.clone().add(new Vector3().crossVectors(body.cg, localForce));
    const previous = frozen.get(body.id);
    if (previous) {
      const expectedForce = body.id === 0 ? previous.residual.force.clone() : new Vector3();
      const expectedMoment = body.id === 0 ? previous.residual.moment.clone() : new Vector3();
      for (const section of sim.structure.sectionsForBody(body.id)) {
        const load = previous.sections.get(section.id)!;
        expectedForce.add(load.force); expectedMoment.add(load.moment);
      }
      expect(localForce.distanceTo(expectedForce)).toBeLessThan(1e-8);
      expect(originMoment.distanceTo(expectedMoment)).toBeLessThan(1e-8);
    }
    const sectionLoads = new Map<number, Wrench>();
    const residual = { force: localForce.clone(), moment: originMoment.clone() };
    for (const section of sim.structure.sectionsForBody(body.id)) {
      const sectionForce = section.surface.force.clone().applyQuaternion(inverse);
      const sectionMoment = new Vector3().crossVectors(section.surface.point, sectionForce);
      if (contacts) { sectionForce.add(contacts[section.id].force); sectionMoment.add(contacts[section.id].moment); }
      sectionLoads.set(section.id, { force: sectionForce, moment: sectionMoment });
      residual.force.sub(sectionForce); residual.moment.sub(sectionMoment);
    }
    latestLoads.set(body.id, { sections: sectionLoads, residual });
    const result = originalMeasure.call(sim.structure, body, force, torque, contacts);
    const owned = sim.structure.sectionsForBody(body.id);
    measured.set(body.id, { ids: owned.map(s => s.id), stress: owned.map(s => s.stressRatio), serial: ++serial });
    for (const s of owned) {
      const index = s.wingKey === 'mainWing' ? 0 : s.wingKey === 'horizontalTail' ? 1 : 2;
      framePeaks[index] = Math.max(framePeaks[index], s.stressRatio);
      frameStress[s.id] = Math.max(frameStress[s.id], s.stressRatio);
    }
    return result;
  });
  const originalDetach = sim.structure.detach;
  vi.spyOn(sim.structure, 'detach').mockImplementation((boundary, id) => {
    const previousBody = boundary.bodyId, measurement = measured.get(previousBody)!;
    const owned = sim.structure.sectionsForBody(previousBody);
    // Actual ownership changes, not candidate calls, establish fracture order.
    expect(measurement.ids).toEqual(owned.map(s => s.id));
    expect(measurement.stress).toEqual(owned.map(s => s.stressRatio));
    const valid = owned.filter(s => s.fractureDamage >= 1
      && (previousBody === 0 || (s.parentId !== null && sections[s.parentId].bodyId === previousBody)));
    const worst = [...valid].sort((a, b) => b.stressRatio - a.stressRatio || a.id - b.id)[0];
    expect(boundary.id).toBe(worst.id); expect(boundary.stressRatio).toBeGreaterThanOrEqual(1);
    expect(boundary.fractureDamage).toBe(1);
    const descendants = owned.filter(s => {
      for (let node: StructureSection | undefined = s; node; node = node.parentId === null ? undefined : sections[node.parentId]) {
        if (node.id === boundary.id) return true;
      }
      return false;
    }).map(s => s.id);
    const loads = frozen.get(previousBody) ?? latestLoads.get(previousBody)!;
    frozen.set(previousBody, loads); frozen.set(id, loads);
    events.push({ time: sim.elapsed, id: boundary.id, wingKey: boundary.wingKey, side: boundary.side,
      spanStart: boundary.spanStart, stress: boundary.stressRatio, measurement: measurement.serial, previousBody, bodyId: id });
    originalDetach.call(sim.structure, boundary, id);
    expect(sim.structure.sectionsForBody(id).map(s => s.id)).toEqual(descendants);
    expect(sim.structure.rotationBudgetValid()).toBe(true);
  });
  return {
    events,
    frameStress,
    beginFrame() { framePeaks = [0, 0, 0]; frameStress.fill(0); },
    checkFrame() {
      const recording = sim.getRecording();
      for (let i = 0; i < 3; i++) {
        expect(sim.structure.peakWings[i].stress).toBeGreaterThanOrEqual(framePeaks[i]);
        expect(recording.wingLoads![(recording.length - 1) * 3 + i]).toBeCloseTo(framePeaks[i], 10);
      }
    },
  };
}

function checkCollisionFrame(sim: FlightSimulation, initialLedger: number, previousDissipation: number) {
  expect(sim.ended).toBe(false);
  expect(sim.structure.rotationBudgetValid()).toBe(true);
  expect(Math.abs(ledger(sim) - initialLedger) / Math.max(1, Math.abs(initialLedger))).toBeLessThan(1e-8);
  expect(sim.telemetry.dissipatedEnergy).toBeGreaterThanOrEqual(previousDissipation - 1e-9);
  for (const s of sim.structure.sections) {
    const fragment = sim.fragments.find(body => body.id === s.bodyId);
    const connected = s.bodyId === 0 || (s.parentId !== null && sim.structure.sections[s.parentId].bodyId === s.bodyId);
    if (connected && !fragment?.landed && s.stressRatio >= 1) expect(s.fractureDamage).toBeLessThan(1);
  }
  const contacts = collisionInternals(sim).contacts;
  for (const point of contacts) {
    const owner = point.sectionId === undefined ? 0 : sim.structure.sections[point.sectionId].bodyId;
    const body = owner === 0 ? sim : sim.fragments.find(fragment => fragment.id === owner)!;
    const world = point.clone().sub(body.cg).applyQuaternion(body.quaternion).add(body.position);
    expect(world.y - challenges.challengeTerrainHeight('low-altitude', world.x, world.z)).toBeGreaterThanOrEqual(-2e-6);
  }
}

function runLongWingCollision(bank: number, dt: number, strong = false) {
  const sim = longWingCollision(bank, strong), evidence = collisionEvidence(sim), initialLedger = ledger(sim);
  for (let frame = 0; frame < Math.round((1 / 6) / dt); frame++) {
    const dissipated = sim.telemetry.dissipatedEnergy;
    evidence.beginFrame(); sim.step({ ...neutral, throttle: 0 }, dt);
    evidence.checkFrame(); checkCollisionFrame(sim, initialLedger, dissipated);
  }
  expect(sim.elapsed).toBeCloseTo(1 / 6, 12);
  return { sim, events: evidence.events };
}

it.each([0.08, 0.4])('long-wing terrain collision cuts only freshly measured worst joints and retains bounded geometry (bank=%s)', bank => {
  const { sim, events } = runLongWingCollision(bank, 1 / 60);
  expect(events.length).toBeGreaterThan(0);
  expect(sim.structure.fractureCount).toBe(events.length);
  for (let i = 1; i < events.length; i++) expect(events[i].measurement).toBeGreaterThan(events[i - 1].measurement);
  expect(sim.telemetry.dissipatedEnergy).toBeGreaterThan(0);
});

it.each([0.08, 0.4])('strong long-wing terrain contact stays intact without relaxing shape or energy bounds (bank=%s)', bank => {
  const { sim, events } = runLongWingCollision(bank, 1 / 60, true);
  expect(events).toHaveLength(0); expect(sim.fragments).toHaveLength(0);
  expect(sim.structure.maxDeflection).toBeGreaterThan(0);
  expect(sim.telemetry.dissipatedEnergy).toBeGreaterThan(0);
});

it.each([0.08, 0.4])('mirrors long-wing first fractures, stresses and ownership on flat terrain (bank=%s)', bank => {
  vi.spyOn(challenges, 'challengeTerrainHeight').mockReturnValue(20);
  vi.spyOn(challenges, 'challengeCollisionHeight').mockReturnValue(20);
  const left = longWingCollision(bank), right = longWingCollision(-bank);
  const a = collisionEvidence(left), b = collisionEvidence(right);
  const initial = [ledger(left), ledger(right)];
  const mirrorId = (id: number) => {
    const s = left.structure.sections[id];
    return right.structure.sections.find(other => other.wingKey === s.wingKey && other.spanStart === s.spanStart
      && other.side === (s.wingKey === 'verticalTail' ? s.side : -s.side))!.id;
  };
  const groups = (sim: FlightSimulation, mirror: boolean) => {
    const bodies = new Map<number, number[]>();
    for (const s of sim.structure.sections) {
      const ids = bodies.get(s.bodyId) ?? []; ids.push(mirror ? mirrorId(s.id) : s.id); bodies.set(s.bodyId, ids);
    }
    return [...bodies].map(([id, ids]) => `${id === 0 ? 'main' : 'fragment'}:${ids.sort((x, y) => x - y).join(',')}`).sort();
  };
  for (let frame = 0; frame < 10; frame++) {
    for (const [index, sim, evidence] of [[0, left, a], [1, right, b]] as const) {
      const dissipated = sim.telemetry.dissipatedEnergy;
      evidence.beginFrame(); sim.step({ ...neutral, throttle: 0 });
      evidence.checkFrame(); checkCollisionFrame(sim, initial[index], dissipated);
    }
    for (const s of left.structure.sections) {
      expect(Math.abs(s.stressRatio - right.structure.sections[mirrorId(s.id)].stressRatio)).toBeLessThanOrEqual(1e-7);
      expect(Math.abs(a.frameStress[s.id] - b.frameStress[mirrorId(s.id)])).toBeLessThanOrEqual(1e-7);
    }
    expect(groups(left, true)).toEqual(groups(right, false));
  }
  expect(a.events.length).toBeGreaterThan(0); expect(b.events.length).toBeGreaterThan(0);
  expect(mirrorId(a.events[0].id)).toBe(b.events[0].id);
  expect(Math.abs(a.events[0].stress - b.events[0].stress)).toBeLessThanOrEqual(1e-7);
});

it.each([0.08, 0.4])('render cadence does not change fixed-60Hz collision damage or motion (bank=%s)', bank => {
  const runs = [30, 60, 120, 240].map(hz => {
    const sim = longWingCollision(bank), evidence = collisionEvidence(sim);
    const clock = new FixedGameClock(() => 0);
    for (let frame = 0; frame < hz / 6; frame++) clock.advance(1 / hz, dt => {
      expect(dt).toBe(FIXED_DT);
      evidence.beginFrame(); sim.step(neutral, dt); evidence.checkFrame();
      return !sim.ended;
    });
    return { sim, events: evidence.events };
  });
  const first = runs[0];
  expect(first.events.length).toBeGreaterThan(0);
  for (const run of runs.slice(1)) {
    expect(run.sim.elapsedTime).toBeCloseTo(1 / 6, 12);
    expect(run.sim.position.toArray()).toEqual(first.sim.position.toArray());
    expect(run.sim.velocity.toArray()).toEqual(first.sim.velocity.toArray());
    expect(run.events).toEqual(first.events);
    expect(run.sim.structure.sections.map(s => [s.bodyId, s.fractureDamage]))
      .toEqual(first.sim.structure.sections.map(s => [s.bodyId, s.fractureDamage]));
  }
});
