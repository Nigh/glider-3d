import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { clone, defaultAircraft, DEG, presets } from '../src/model';
import { captureReplayKeyframe, FlightSimulation, restoreReplayKeyframe } from '../src/physics';

const neutral = { weight: 0, lateral: 0, elevator: 0, aileron: 0, rudder: 0 };
const rollAxis = new Vector3(1, 0, 0);
function definition() {
  const d = clone(presets.find(plane => plane.name === '基础单发型')!);
  d.engine.count = 0; d.fuelTank.capacity = 0;
  return d;
}
function flight(d = definition()) {
  const sim = new FlightSimulation(d, 'test-space', 0, { height: 2000, catapult: false, speed: 20 });
  sim.launching = false;
  holdCondition(sim);
  return sim;
}
function holdCondition(sim: FlightSimulation, orientation = new Quaternion(), speed = 20) {
  sim.position.set(100, 2000, 0);
  sim.quaternion.copy(orientation);
  sim.velocity.set(speed, -0.4, 0).applyQuaternion(orientation);
}

describe('body-axis elevator trim', () => {
  it.each([0, 90, 180])('settles pitch drift for multiple seconds at %d degrees roll without hunting', roll => {
    for (const initialRate of [-0.3, 0.3]) {
      const sim = flight(), orientation = new Quaternion().setFromAxisAngle(rollAxis, roll * DEG);
      sim.omega.z = initialRate;
      const rates: number[] = [], trims: number[] = [];
      // A fixed aerodynamic condition isolates body pitch regulation from gravity-driven trajectory changes.
      // Keep pitch rate dynamic: every rate sample comes from the real rigid-body integrator.
      for (let frame = 0; frame < 600; frame++) {
        holdCondition(sim, orientation);
        sim.omega.x = sim.omega.y = 0;
        sim.step({ ...neutral, autoTrim: true });
        if (frame >= 420) { rates.push(sim.omega.z); trims.push(sim.telemetry.trimPitch); }
      }
      expect(sim.ended).toBe(false);
      expect(sim.structure.fractureCount).toBe(0);
      expect(Math.max(...rates.map(Math.abs))).toBeLessThan(0.003);
      expect(Math.max(...rates) - Math.min(...rates)).toBeLessThan(0.01);
      expect(Math.max(...trims) - Math.min(...trims)).toBeLessThan(0.015);
    }
  });

  it('does not level world attitude or use roll/yaw rate as pitch error', () => {
    const level = flight(), tilted = flight();
    const orientation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.4))
      .multiply(new Quaternion().setFromAxisAngle(rollAxis, Math.PI / 2));
    holdCondition(tilted, orientation);
    level.omega.set(0.2, -0.15, 0); tilted.omega.copy(level.omega);
    level.step({ ...neutral, autoTrim: true }, 0.001);
    tilted.step({ ...neutral, autoTrim: true }, 0.001);
    expect(tilted.telemetry.trimPitch).toBeCloseTo(level.telemetry.trimPitch, 8);
    expect(tilted.telemetry.controlInputs.elevator).toBeCloseTo(level.telemetry.controlInputs.elevator, 8);
  });

  it('freezes trim during active stick, low speed and launch; birdman cannot enable it', () => {
    for (const condition of ['stick', 'slow', 'launch']) {
      const sim = condition === 'launch'
        ? new FlightSimulation(definition(), 'test-space', 0, { height: 2000, catapult: true, speed: 20 }) : flight();
      if (condition === 'slow') sim.velocity.set(4, 0, 0);
      sim.omega.z = 0.5;
      sim.step({ ...neutral, autoTrim: true, trimPitch: 0.3, elevator: condition === 'stick' ? 0.5 : 0 }, 0.001);
      expect(sim.telemetry.trimPitch).toBe(0.3);
    }
    const birdman = new FlightSimulation(defaultAircraft, 'birdman', 0);
    birdman.step({ ...neutral, autoTrim: true, trimPitch: 1, trimRoll: 1 });
    expect(birdman.telemetry.autoTrim).toBe(false);
    expect(Math.abs(birdman.controlDeflections.elevator) + Math.abs(birdman.controlDeflections.aileron)).toBe(0);
  });

  it('centers canceled trim before launch and in flight, without reapplying stale API input', () => {
    for (const launching of [false, true]) {
      const sim = launching
        ? new FlightSimulation(definition(), 'test-space', 0, { height: 2000, catapult: true, speed: 20 }) : flight();
      sim.step({ ...neutral, autoTrim: true, trimPitch: 0.7, elevator: 0.5 }, 0.001);
      expect(sim.telemetry.trimPitch).toBe(0.7);
      for (let step = 0; step < 3; step++) {
        sim.step({ ...neutral, autoTrim: false, trimPitch: 0.7 }, 0.001);
        expect(sim.telemetry.trimPitch).toBe(0);
      }
      sim.step({ ...neutral, trimPitch: -0.2 }, 0.001);
      expect(sim.telemetry.trimPitch).toBe(-0.2);
    }
  });

  it.each([-1, 1])('reaches opposite full elevator and aileron despite full trim %d', trim => {
    const sim = flight();
    for (let frame = 0; frame < 60; frame++) {
      holdCondition(sim, new Quaternion(), 0); sim.omega.set(0, 0, 0);
      sim.step({ ...neutral, autoTrim: true, trimPitch: trim, trimRoll: trim });
    }
    expect(sim.telemetry.controlInputs.elevator).toBe(trim);
    for (let frame = 0; frame < 120; frame++) {
      holdCondition(sim, new Quaternion(), 0); sim.omega.set(0, 0, 0);
      sim.step({ ...neutral, autoTrim: true, trimPitch: trim, trimRoll: trim, elevator: -trim, aileron: -trim });
    }
    expect(sim.telemetry.trimPitch).toBe(trim);
    expect(sim.telemetry.controlInputs.elevator).toBe(-trim);
    expect(sim.telemetry.controlInputs.aileron).toBe(-trim);
  });

  it('restores predictive trim and control directions across a replay keyframe', () => {
    const sim = new FlightSimulation(definition(), 'downhill', 0);
    const state = (s: FlightSimulation) => ({
      trim: s.telemetry.trimPitch, omega: s.omega.toArray(),
      deflections: s.structure.sections.map(section => section.controlDeflection),
    });
    const states: { trim: number; omega: number[]; deflections: number[] }[] = [];
    for (let frame = 0; frame < 180; frame++) {
      sim.step({ ...neutral, autoTrim: frame < 165, trimPitch: 0.2, elevator: frame < 120 ? 0.2 : 0 });
      if (frame >= 150) states.push(state(sim));
    }
    const recording = sim.getRecording();
    const replay = new FlightSimulation(sim.definition, 'downhill', 0); replay.loadReplay(recording);
    for (let frame = 0; frame < 150; frame++) replay.step(neutral);
    const restored = restoreReplayKeyframe(sim.definition, 'downhill', recording, captureReplayKeyframe(replay, recording));
    for (const expected of states) {
      restored.step(neutral);
      expect(state(restored)).toEqual(expected);
    }
  });
});

describe('geometry-dependent control directions', () => {
  it.each(['horizontalTail', 'verticalTail'] as const)('%s reverses its physical deflection ahead of CG, not its commanded moment', key => {
    const deflections: number[] = [];
    for (const mount of [-3, 2.5]) {
      const d = definition(); d.assembly.tailOnFin = false; d.assembly[key] = mount;
      const base = flight(d), commanded = flight(d);
      const control = key === 'horizontalTail' ? 'elevator' : 'rudder', axis = key === 'horizontalTail' ? 'z' : 'y';
      base.step(neutral, 0.001);
      commanded.step({ ...neutral, [control]: 0.2 }, 0.001);
      expect(commanded.telemetry.torque[axis] - base.telemetry.torque[axis]).toBeLessThan(0);
      const section = commanded.structure.sections.find(section => section.wingKey === key && section.side === 1)!;
      expect(Math.sign(section.surface.point.x - commanded.cg.x)).toBe(Math.sign(mount));
      deflections.push(section.controlDeflection);
      const reverse = flight(d); reverse.step({ ...neutral, [control]: -0.2 }, 0.001);
      expect(reverse.telemetry.torque[axis] - base.telemetry.torque[axis]).toBeGreaterThan(0);
    }
    expect(deflections[0] * deflections[1]).toBeLessThan(0);
  });

  it('aileron uses lateral moment arms for both forward and rearward main wings', () => {
    for (const mount of [-2, 2]) {
      const d = definition(); d.assembly.mainWing = mount;
      const base = flight(d), commanded = flight(d);
      base.step(neutral, 0.001); commanded.step({ ...neutral, aileron: 0.2 }, 0.001);
      expect(commanded.telemetry.torque.x - base.telemetry.torque.x).toBeGreaterThan(0);
      const left = commanded.structure.sections.find(section => section.wingKey === 'mainWing' && section.side === -1)!;
      const right = commanded.structure.sections.find(section => section.wingKey === 'mainWing' && section.side === 1)!;
      expect(left.controlDeflection).toBeLessThan(0);
      expect(right.controlDeflection).toBeLessThan(0);
    }
  });
});
