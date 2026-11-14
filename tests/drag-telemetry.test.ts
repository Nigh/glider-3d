import { expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { clone, presets, type Controls } from '../src/model';
import { AIR_DENSITY, FlightSimulation, coefficients } from '../src/physics';

const neutral: Controls = { weight: 0, lateral: 0, aileron: 0, elevator: 0, rudder: 0, throttle: 0 };

it.each(presets.map(plane => [plane.name, plane] as const))('%s reports the complete drag without counting engines twice', (_, definition) => {
  const sim = new FlightSimulation(clone(definition), 'test-space', 0, { height: 1000, catapult: false, speed: 20 });
  sim.launching = false; sim.position.set(100, 1000, 0);
  const orientation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.15);
  for (const velocity of [new Vector3(20,-1,2), new Vector3(0,0,12), new Vector3()]) {
    sim.quaternion.copy(orientation); sim.velocity.copy(velocity); sim.omega.set(0.03,-0.04,0.02);
    Reflect.get(sim, 'evaluateForces').call(sim, neutral, sim.velocity, sim.omega, sim.quaternion, sim.position, neutral);
    const summary = Reflect.get(sim, 'aerodynamics');
    summary.update(sim.cg, sim.quaternion, sim.velocity, undefined, sim.omega);
    expect(summary.drag.clone().applyQuaternion(orientation).distanceTo(sim.telemetry.drag)).toBeLessThan(1e-8);
    expect(summary.profileDrag.clone().add(summary.inducedDrag).distanceTo(summary.drag)).toBeLessThan(1e-10);
    expect(summary.inducedDrag.length()).toBeLessThanOrEqual(summary.drag.length() + 1e-9);
    const engines = summary.engines.reduce((sum: Vector3, engine: { point: Vector3; area: number }) => {
      const local = new Vector3().crossVectors(sim.omega, engine.point.clone().sub(sim.cg)).add(sim.velocity.clone().applyQuaternion(orientation.clone().invert()));
      return sum.addScaledVector(local, -0.5 * AIR_DENSITY * local.length() * engine.area);
    }, new Vector3());
    const wings = summary.wings.reduce((sum: Vector3, wing: { drag: Vector3 }) => sum.add(wing.drag), new Vector3());
    expect(summary.drag.clone().sub(wings).sub(summary.bodyDrag).distanceTo(engines)).toBeLessThan(1e-8);
  }
});

it('keeps non-induced resistance separate through stopped flow and restoration', () => {
  const sim = new FlightSimulation(presets[0], 'wind-tunnel', 0);
  sim.setWindTunnel({ ...sim.windTunnel, speed: 12 }); sim.setWindTunnelEnabled(true);
  for (let i = 0; i < 60; i++) sim.step(neutral);
  let aero = sim.telemetry.aerodynamics;
  expect(aero.profileDrag.length()).toBeGreaterThan(0); expect(aero.inducedDrag.length()).toBeGreaterThan(0);
  sim.restoreWindTunnelAircraft();
  aero = sim.telemetry.aerodynamics;
  expect(aero.profileDrag.clone().add(aero.inducedDrag).distanceTo(aero.drag)).toBeLessThan(1e-10);
  sim.setWindTunnelEnabled(false);
  for (let i = 0; i < 60; i++) sim.step(neutral);
  expect(sim.telemetry.aerodynamics.profileDrag.length()).toBe(0);
  expect(sim.telemetry.aerodynamics.inducedDrag.length()).toBe(0);
});

it('retains the published DAE-11 profile-drag samples and distinguishes zero alpha from zero lift', () => {
  expect(coefficients(0, 12, 500_000).profileCd).toBeCloseTo(0.01023, 8);
  expect(coefficients(0, 12, 1_000_000).profileCd).toBeCloseTo(0.00773, 8);
  expect(coefficients(0, 12, 200_000).profileCd).toBeCloseTo(0.01968, 8);
  expect(coefficients(-6 * Math.PI / 180, 12, 200_000).profileCd).toBeCloseTo(0.06387, 8);
  expect(coefficients(1.25 * Math.PI / 180, 12, 200_000).profileCd).toBeCloseTo(0.02081, 8);
  for (const re of [200_000, 500_000, 1_000_000]) {
    const center = coefficients(0, 12, re).profileCd;
    expect(Math.abs(coefficients(0, 12, re - 0.01).profileCd - center)).toBeLessThan(1e-8);
    expect(Math.abs(coefficients(0, 12, re + 0.01).profileCd - center)).toBeLessThan(1e-8);
  }
  expect(coefficients(-6 * Math.PI / 180, 12).cl).toBeLessThan(0.03);
  expect(coefficients(-6 * Math.PI / 180, 12).profileCd).toBeGreaterThan(coefficients(0, 12).profileCd);
});
