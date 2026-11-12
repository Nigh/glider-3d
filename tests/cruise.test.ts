import { describe, expect, it } from 'vitest';
import { presets } from '../src/model';
import { FlightSimulation, GRAVITY } from '../src/physics';
import { analyzeCruiseReference, solveCruiseReference } from '../src/cruise';

describe('海平面满油稳态最佳航程参考', () => {
  it.each(presets.filter(d => d.engine.count > 0))('$name通过受力、配平和独立短自由积分', d => {
    const result = analyzeCruiseReference(d), reference = result.reference;
    expect(result.reason).toBe('solved'); expect(reference).not.toBeNull();
    if (!reference) throw Error(JSON.stringify(result));
    expect(reference.throttle).toBeGreaterThan(0); expect(reference.throttle).toBeLessThanOrEqual(1);
    expect(Number.isInteger(reference.speed)).toBe(true);
    expect(reference.speed).toBeGreaterThanOrEqual(result.searched.minimumSpeed);
    expect(reference.speed).toBeLessThanOrEqual(result.searched.maximumSpeed);
    const simulation = new FlightSimulation(d, 'test-space', 0, { height: 1000, speed: 50, catapult: false });
    const sample = simulation.sampleSteadyFlight(reference.speed, reference.pitch, reference.elevator, reference.throttle);
    expect(Math.hypot(sample.force.x, sample.force.y - simulation.mass * GRAVITY)).toBeLessThan(simulation.mass * GRAVITY * 0.002);
    expect(Math.abs(sample.torque.z)).toBeLessThan(1);
    expect(sample.force.x).toBeCloseTo(reference.residual.horizontalForce, 7);
    expect(sample.torque.z).toBeCloseTo(reference.residual.pitchMoment, 7);
    const position = simulation.position.clone(), attitude = simulation.quaternion.clone();
    for (let tick = 0; tick < 120; tick++) simulation.step({ weight: 0, lateral: 0, elevator: reference.elevator, aileron: 0, rudder: 0, throttle: reference.throttle });
    expect(simulation.ended).toBe(false); expect(simulation.structure.fractureCount).toBe(0);
    expect(Math.abs(simulation.position.y - position.y)).toBeLessThan(0.5);
    expect(simulation.quaternion.angleTo(attitude)).toBeLessThan(Math.PI / 180);
  }, 60_000);

  it('确定性求解不改变输入，无动力设计明确不返回巡航', () => {
    const d = presets.find(preset => preset.engine.count === 1)!;
    const original = structuredClone(d), first = solveCruiseReference(d), second = solveCruiseReference(d);
    expect(first).not.toBeNull(); expect(second).toEqual(first); expect(d).toEqual(original);
    expect(solveCruiseReference(presets[0])).toBeNull();
  }, 60_000);
});
