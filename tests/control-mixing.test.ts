import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { mixControlSurfaces, type MixingSurface } from '../src/control-mixing';
import { clone, DEG, presets } from '../src/model';
import { CONTROL_SURFACE_RATE, FlightSimulation } from '../src/physics';

const neutral = { weight: 0, aileron: 0, elevator: 0, rudder: 0 };
const disabled = { roll: false, pitch: false, yaw: false };
function surface(moment: [number, number, number], axes = { roll: true, pitch: true, yaw: true }): MixingSurface {
  return {
    bodyId: 0, controlEffectiveness: 1, controlAxes: { ...axes }, controlResponse: 1, controlReversed: false,
    controlMoment: new Vector3(...moment), controlProjection: new Vector3(...moment).normalize(), controlCandidate: 0,
  };
}
function torque(surfaces: MixingSurface[]) {
  const total = new Vector3();
  for (const s of surfaces) if (s.bodyId === 0) total.addScaledVector(new Vector3(s.controlMoment.x, s.controlMoment.y, s.controlMoment.z), s.controlCandidate);
  return total;
}

describe('independent control allocation', () => {
  it('projects every enabled axis onto geometry, not wing roles', () => {
    const s = surface([3, -4, -12], { roll: true, pitch: false, yaw: true });
    mixControlSurfaces([s], { ...neutral, aileron: 0.5, elevator: 1, rudder: 0.25 }, false);
    expect(s.controlCandidate).toBeCloseTo((3 * 0.5 + 4 * 0.25) / 13, 12);
    s.controlAxes = { ...disabled };
    mixControlSurfaces([s], { ...neutral, aileron: 1, elevator: 1, rudder: 1 }, false);
    expect(s.controlCandidate).toBe(0);
  });

  it.each([false, true])('applies response and reversal after mixing, smart=%s', smart => {
    const s = surface([10, 0, 0]);
    s.controlResponse = 0.35; s.controlReversed = true;
    mixControlSurfaces([s], { ...neutral, aileron: 0.6 }, smart);
    expect(s.controlCandidate).toBeCloseTo(-0.21, 12);
    s.controlResponse = 0;
    mixControlSurfaces([s], { ...neutral, aileron: 1 }, smart);
    expect(s.controlCandidate).toBe(0);
  });

  it('cancels fin-induced roll during yaw even when compensation axes are switched off', () => {
    const surfaces = [surface([-2, -10, 0], { roll: false, pitch: false, yaw: true }), surface([10, 0, 0], disabled)];
    mixControlSurfaces(surfaces, { ...neutral, rudder: 0.5 }, false);
    const ordinary = torque(surfaces);
    expect(Math.abs(ordinary.x)).toBeGreaterThan(0.9);
    mixControlSurfaces(surfaces, { ...neutral, rudder: 0.5 }, true);
    const smart = torque(surfaces);
    expect(Math.abs(smart.x)).toBeLessThan(1e-6);
    expect(smart.y).toBeCloseTo(ordinary.y, 6);
    expect(surfaces[1].controlCandidate).toBeGreaterThan(0);
  });

  it('bounds saturated allocation and degrades without inventing missing authority', () => {
    const surfaces = [surface([-20, -10, 0]), surface([1, 0, 0])];
    mixControlSurfaces(surfaces, { ...neutral, rudder: 1 }, false);
    const ordinary = torque(surfaces);
    mixControlSurfaces(surfaces, { ...neutral, rudder: 1 }, true);
    expect(surfaces.every(s => Number.isFinite(s.controlCandidate) && Math.abs(s.controlCandidate) <= 1)).toBe(true);
    expect(surfaces[1].controlCandidate).toBe(1);
    expect(Math.abs(torque(surfaces).x)).toBeLessThan(Math.abs(ordinary.x));
    surfaces[1].bodyId = 1;
    mixControlSurfaces(surfaces, { ...neutral, rudder: 1 }, true);
    expect(surfaces[1].controlCandidate).toBe(0);
    expect(Number.isFinite(surfaces[0].controlCandidate)).toBe(true);
    const noYaw = [surface([1, 0, 0]), surface([0, 0, -1])];
    mixControlSurfaces(noYaw, { ...neutral, rudder: 1 }, true);
    expect(torque(noYaw).length()).toBe(0);
  });

  it('suppresses real yaw-induced roll without reversing the requested yaw torque', () => {
    const definition = clone(presets.find(d => d.name === '基础单发型')!);
    definition.engine.count = 0; definition.fuelTank.capacity = 0;
    definition.mainWing.controlAxes = { ...disabled };
    definition.horizontalTail.controlAxes = { ...disabled };
    const sample = (smartMixing: boolean, rudder: number) => {
      const sim = new FlightSimulation(definition, 'test-space', 0, { height: 2000, catapult: false, speed: 20 });
      sim.launching = false;
      for (let frame = 0; frame < 30; frame++) {
        sim.position.set(100, 2000, 0); sim.quaternion.identity(); sim.velocity.set(20, 0, 0); sim.omega.set(0, 0, 0);
        sim.step({ ...neutral, rudder, smartMixing });
      }
      expect(sim.structure.fractureCount).toBe(0);
      return sim.telemetry.torque.clone();
    };
    const ordinary = sample(false, 0.15).sub(sample(false, 0));
    const smart = sample(true, 0.15).sub(sample(true, 0));
    expect(Math.abs(ordinary.x)).toBeGreaterThan(0.1);
    expect(Math.abs(smart.x)).toBeLessThan(Math.abs(ordinary.x) * 0.3);
    expect(ordinary.y).toBeLessThan(0);
    expect(smart.y).toBeLessThan(0);
    expect(Math.abs(smart.y)).toBeGreaterThan(Math.abs(ordinary.y) * 0.5);
  });

  it('rates each real actuator independently during smart mode and reversal', () => {
    const definition = clone(presets.find(d => d.name === '基础单发型')!);
    definition.engine.count = 0; definition.fuelTank.capacity = 0;
    const sim = new FlightSimulation(definition, 'test-space', 0, { height: 2000, catapult: false, speed: 20 });
    sim.launching = false;
    const previous = sim.structure.sections.map(() => 0), dt = 1 / 60;
    for (let frame = 0; frame < 50; frame++) {
      sim.position.set(100, 2000, 0); sim.quaternion.identity(); sim.velocity.set(20, 0, 0); sim.omega.set(0, 0, 0);
      sim.step({ ...neutral, rudder: frame < 25 ? 0.5 : -0.5, smartMixing: true }, dt);
      expect(sim.telemetry.smartMixing).toBe(true);
      for (const section of sim.structure.sections) {
        const limit = (section.wingKey === 'mainWing' ? 18 : section.wingKey === 'horizontalTail' ? 22 : 15) * DEG;
        const current = section.controlDeflection / limit;
        expect(Math.abs(current)).toBeLessThanOrEqual(1 + 1e-12);
        expect(Math.abs(current - previous[section.id])).toBeLessThanOrEqual(CONTROL_SURFACE_RATE * dt + 1e-10);
        previous[section.id] = current;
      }
    }
    expect(sim.structure.fractureCount).toBe(0);
    expect(sim.structure.sections.some(s => s.wingKey === 'mainWing' && Math.abs(s.controlDeflection) > 1e-5)).toBe(true);
  });
});
