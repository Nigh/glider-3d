import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { clone, defaultAircraft } from '../src/model';
import { FlightSimulation, GRAVITY } from '../src/physics';
import { defaultWindTunnel } from '../src/laboratory';
import { signedLoad, windForceSnapshot } from '../src/wind-forces';

const neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0, throttle: 0 };
const snapshot = (sim: FlightSimulation) => windForceSnapshot(sim.telemetry, sim.quaternion);
const expectCurrentLoads = (sim: FlightSimulation) => {
 const loads = snapshot(sim);
 const expected = sim.telemetry.force.clone().add(new Vector3(0, -sim.mass * GRAVITY, 0)).applyQuaternion(sim.quaternion.clone().invert());
 expect(new Vector3(...loads.force).distanceTo(expected)).toBeLessThan(1e-8);
 expect(loads.moment).toEqual(sim.telemetry.torque.toArray());
 return loads;
};

describe('wind tunnel load readout', () => {
 it('shows weight downward at zero flow instead of the fixture-balanced zero acceleration', () => {
  const sim = new FlightSimulation(defaultAircraft, 'wind-tunnel', 0);
  sim.step(neutral);
  const loads = snapshot(sim);
  expect(loads.force).toEqual([0, -sim.mass * GRAVITY, 0]);
  expect(loads.moment).toEqual([0, 0, 0]);
  expect(sim.velocity.lengthSq()).toBe(0);
  expect(sim.telemetry.specificForce.y).toBeCloseTo(GRAVITY, 10);
 });

 it('rotates world force, including gravity, into the same body axes as CG moments', () => {
  const telemetry = { force: new Vector3(-40, 0, 0), torque: new Vector3(2, -3, 4), mass: 2 };
  const orientation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  const loads = windForceSnapshot(telemetry, orientation);
  expect(loads.force[0]).toBeCloseTo(0, 10);
  expect(loads.force[1]).toBeCloseTo(-2 * GRAVITY, 10);
  expect(loads.force[2]).toBeCloseTo(-40, 10);
  expect(loads.moment).toEqual([2, -3, 4]);
  telemetry.force.set(0, 0, 0); telemetry.torque.set(0, 0, 0);
  expect(loads.force[2]).toBeCloseTo(-40, 10); expect(loads.moment).toEqual([2, -3, 4]);
 });

 it('tracks real positive-incidence and sideslip loads, stops with gravity, and restores without stale snapshots', () => {
  const definition = clone(defaultAircraft);
  // Keep this readout test below the structural limit so its direction assertions isolate aerodynamics.
  for (const wing of [definition.mainWing, definition.horizontalTail, definition.verticalTail]) wing.materialId = 'carbon-epoxy';
  const sim = new FlightSimulation(definition, 'wind-tunnel', 0);
  sim.setWindTunnel({ ...defaultWindTunnel, speed: 10, pitch: 5 }); sim.setWindTunnelEnabled(true);
  for (let frame = 0; frame < 1500; frame++) sim.step(neutral);
  const incidence = expectCurrentLoads(sim);
  expect(sim.telemetry.alpha).toBeGreaterThan(0);
  expect(sim.telemetry.aerodynamics.force.y).toBeGreaterThan(0);
  expect(incidence.force[0]).toBeLessThan(0);
  sim.setWindTunnel({ ...defaultWindTunnel, speed: 10, pitch: 10, roll: 30 });
  for (let frame = 0; frame < 1500; frame++) sim.step(neutral);
  const sideslip = expectCurrentLoads(sim);
  expect(sim.telemetry.aerodynamics.beta).toBeGreaterThan(0);
  expect(sim.telemetry.aerodynamics.wings.find(wing => wing.kind === 'vertical')!.force.z).toBeLessThan(0);
  expect(sideslip.force).not.toEqual(incidence.force);
  const time = sim.time;
  sim.restoreWindTunnelAircraft();
  const restored = expectCurrentLoads(sim);
  expect(sim.time).toBe(time); expect(sim.windTunnelEnabled).toBe(true);
  expect(restored.force.every(Number.isFinite)).toBe(true);
  sim.setWindTunnelEnabled(false);
  for (let frame = 0; frame < 60; frame++) sim.step(neutral);
  const stopped = expectCurrentLoads(sim);
  expect(sim.windTunnel.speed).toBe(0);
  expect(new Vector3(...stopped.force).length()).toBeCloseTo(sim.mass * GRAVITY, 8);
  expect(stopped.moment).toEqual([0, 0, 0]);
 });

 it('formats signed values without negative zero', () => {
  expect(signedLoad(12.34)).toBe('+12.3'); expect(signedLoad(-12.34)).toBe('-12.3');
  expect(signedLoad(-0.001)).toBe('+0.0'); expect(signedLoad(0)).toBe('+0.0');
 });
});
