import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { BODY_GEOMETRY, DEG, validateAircraft } from '../src/model';
import { coefficients, FlightSimulation } from '../src/physics';
import { DRAG_TERMS, dragResistance, ellipsoidSurfaceArea } from '../src/drag';

const definition = validateAircraft(JSON.parse(readFileSync(new URL('./fixtures/review56-twin.json', import.meta.url), 'utf8')));
const neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0, throttle: 0 };
const internal = (sim: FlightSimulation) => sim as any;
function measure(sim: FlightSimulation, velocity: Vector3, controls = neutral) {
  internal(sim).evaluateForces(controls, velocity, sim.omega, sim.quaternion, sim.position, controls);
  internal(sim).aerodynamics.update(sim.cg, sim.quaternion, velocity, sim.telemetry.torque, sim.omega);
  return sim.telemetry.aerodynamics;
}
function closed(sim: FlightSimulation, velocity: Vector3) {
  const a = measure(sim, velocity), sum = new Vector3();
  let scalar = 0;
  for (const key of DRAG_TERMS) {
    expect(a.dragTerms[key].toArray().every(Number.isFinite), key).toBe(true);
    sum.add(a.dragTerms[key]); scalar += dragResistance(a.dragTerms[key], a.dragAxis);
  }
  expect(sum.distanceTo(a.drag)).toBeLessThan(1e-8);
  expect(scalar).toBeCloseTo(dragResistance(a.drag, a.dragAxis), 8);
  expect(a.profileDrag.clone().add(a.inducedDrag).distanceTo(a.drag)).toBeLessThan(1e-8);
  expect(a.drag.clone().applyQuaternion(sim.quaternion).distanceTo(sim.telemetry.drag)).toBeLessThan(1e-8);
  const torque = a.liftMoment.clone().add(a.dragMoment).add(a.freeMoment);
  if (a.liftCenter) torque.add(new Vector3().crossVectors(a.liftCenter.clone().sub(sim.cg), a.lift));
  if (a.dragCenter) torque.add(new Vector3().crossVectors(a.dragCenter.clone().sub(sim.cg), a.drag));
  expect(torque.distanceTo(a.torque)).toBeLessThan(1e-8);
  return a;
}

it('integrates true ellipsoid wetted area, recovering analytic spheres and prolate spheroids', () => {
  expect(ellipsoidSurfaceArea({ xRadius: 2, yRadius: 2, zRadius: 2 })).toBeCloseTo(16 * Math.PI, 10);
  for (const a of [1.45, 6]) {
    const b = 0.4, e = Math.sqrt(1 - b * b / (a * a));
    const exact = 2 * Math.PI * b * b * (1 + a / (b * e) * Math.asin(e));
    expect(Math.abs(ellipsoidSurfaceArea({ xRadius: a, yRadius: b, zRadius: b }) / exact - 1)).toBeLessThan(0.0005);
  }
  const shell = BODY_GEOMETRY.shell;
  const oldArea = 2 * Math.PI * shell.xRadius * (shell.yRadius + shell.zRadius);
  expect(ellipsoidSurfaceArea(shell)).toBeLessThan(oldArea * 0.9);
});

it.each([1.3, 5.3])('same frozen aircraft, body alpha and flow give identical drag across modes at %s degrees', pitch => {
  const flight = new FlightSimulation(definition, 'test-space', 0, { height: 1000, catapult: false, speed: 31 });
  const wind = new FlightSimulation(definition, 'wind-tunnel', 0);
  for (const sim of [flight, wind]) {
    internal(sim).seaLevelReference = true; sim.launching = false; sim.structure.reset();
    sim.position.set(100, 1000, 0); sim.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), pitch * DEG); sim.omega.set(0, 0, 0);
    internal(sim).applied.elevator = 0;
  }
  const velocity = new Vector3(31, 0, 0);
  const a = closed(flight, velocity), b = closed(wind, velocity);
  expect(a.alpha / DEG).toBeCloseTo(pitch, 10);
  expect(a.drag.distanceTo(b.drag)).toBeLessThan(1e-10);
  expect(flight.telemetry.torque.distanceTo(wind.telemetry.torque)).toBeLessThan(1e-10);
  const unpoweredMoment = flight.telemetry.torque.clone();
  internal(flight).availableThrust = 720 * 0.8 ** 2;
  const powered = closed(flight, velocity);
  expect(powered.drag.distanceTo(b.drag)).toBeLessThan(1e-10);
  expect(flight.telemetry.torque.z - unpoweredMoment.z).toBeCloseTo(-(definition.engine.y - flight.cg.y) * internal(flight).thrust, 9);
});

it('distinguishes body alpha, installed geometry and effective wing alpha and reports actual local Reynolds numbers', () => {
  const sim = new FlightSimulation(definition, 'wind-tunnel', 0);
  sim.setWindTunnel({ ...sim.windTunnel, speed: 31, pitch: 1.3 }); sim.setWindTunnelEnabled(true);
  for (let tick = 0; tick < 1500; tick++) sim.step(neutral);
  const a = sim.telemetry.aerodynamics;
  expect(a.alpha / DEG).toBeCloseTo(1.3, 7);
  expect(sim.telemetry.alpha / DEG).toBeCloseTo(5.3, 7);
  expect(a.wings[0].alpha / DEG).toBeGreaterThan(5.3); // Sweep/wake/elastic angle, not the fuselage angle.
  expect(a.reynoldsMin).toBeGreaterThan(900_000); expect(a.reynoldsMax).toBeGreaterThan(7_800_000);
  expect(a.reynoldsMax).toBeLessThan(7_830_000);
  const main = sim.surfaces.filter(surface => surface.kind === 'main').map(surface => surface.localFlow.length() * surface.chord / 1.46e-5);
  expect(Math.min(...main)).toBeGreaterThan(3_750_000);
  expect(sim.structure.fractureCount).toBe(0);
});

it.each([new Vector3(31,-3,5), new Vector3(0,0,31), new Vector3()])('keeps every model term closed under oblique and rotating flow %s', velocity => {
  const sim = new FlightSimulation(definition, 'test-space', 0, { height: 1000, catapult: false, speed: 31 });
  internal(sim).seaLevelReference = true; sim.launching = false; sim.position.set(100,1000,0);
  sim.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0,0,1), 0.2)); sim.omega.set(0.4,-0.3,0.2);
  closed(sim, velocity);
});

it('separates airfoil profile, separated flow and water loads without stale wet terms after reset', () => {
  const sim = new FlightSimulation(definition, 'test-space', 0);
  sim.launching = false; sim.position.set(100,0,1000); sim.quaternion.identity(); sim.omega.set(0,0,0);
  const wet = closed(sim, new Vector3(10,-1,0));
  expect(wet.dragTerms.water.length()).toBeGreaterThan(100);
  sim.reset(); sim.launching = false; sim.position.set(100,1000,0);
  sim.quaternion.setFromAxisAngle(new Vector3(0,0,1), Math.PI / 2);
  const separated = closed(sim, new Vector3(31,0,0));
  expect(separated.dragTerms.water.length()).toBe(0);
  expect(separated.dragTerms.wingSeparated.length()).toBeGreaterThan(100);
});

it('makes the uncalibrated high-Re boundary explicit rather than extrapolating a decreasing Cd', () => {
  for (const alpha of [-6,0,5,12]) for (const re of [2_000_000, 5_000_000, 8_000_000]) {
    expect(coefficients(alpha * DEG, 2, re)).toEqual(coefficients(alpha * DEG, 2, 1_000_000));
  }
});
