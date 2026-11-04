import { expect, it } from 'vitest';
import { clone, presets } from '../src/model';
import { FlightSimulation } from '../src/physics';

it('settles under sustained full rudder at a fixed high-load flight condition', () => {
  const definition = clone(presets.find(d => !d.birdman && !d.engine.count)!);
  definition.verticalTail.materialId = 'spruce'; definition.verticalTail.materialAmount = 0.5;
  const sim = new FlightSimulation(definition, 'downhill', 0); sim.launching = false;
  const tail: number[] = [];
  // Hold the flight condition to isolate the actuator/elastic-geometry feedback loop.
  // Structural deformation is retained between steps and all real forces are evaluated.
  for (let step = 0; step < 300; step++) {
    sim.position.set(100, 5000, 0); sim.quaternion.identity(); sim.velocity.set(35, 0, 0); sim.omega.set(0, 0, 0);
    sim.step({ weight: 0, rudder: 1, elevator: 0, aileron: 0, adaptiveControls: true });
    if (step >= 240) tail.push(sim.telemetry.controlInputs.rudder);
  }
  expect(sim.structure.fractureCount).toBe(0);
  expect(Math.min(...tail)).toBeGreaterThan(0.05);
  expect(Math.max(...tail)).toBeLessThan(0.5);
  expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.001);
  const variation = tail.slice(1).reduce((sum, value, index) => sum + Math.abs(value - tail[index]), 0);
  expect(variation).toBeLessThan(0.001);
  expect(sim.structure.maxStressRatio).toBeLessThanOrEqual(0.901);
}, 15_000);
