import { expect, it } from 'vitest';
import { wing, type AircraftDefinition } from '../src/model';
import { FlightSimulation } from '../src/physics';

it('settles under sustained full rudder at a fixed high-load flight condition', () => {
  const definition: AircraftDefinition = {
    name: '舵机沉降试验机', birdman: false,
    fuselage: { length: 6.5, center: 0 }, cockpit: { position: 0.45 },
    mainWing: { ...wing(8.6, 0.85, 0.55, 0.1), dihedral: 3, controlSurface: 0.28,
      structure: { width: 0.06, height: 0.14, wallThickness: 0.0025 } },
    horizontalTail: { ...wing(3, 0.65, 0.4, 0.1), controlSurface: 0.4,
      structure: { width: 0.03, height: 0.065, wallThickness: 0.0015 } },
    verticalTail: { ...wing(2.4, 0.7, 0.35, 0.15), controlSurface: 1, materialId: 'spruce', materialAmount: 0.5,
      structure: { width: 0.03, height: 0.065, wallThickness: 0.0015 } },
    assembly: { mainWing: 0.8, mainWingHeight: 0.35, horizontalTail: -2.8, verticalTail: -2.9, mainIncidence: 1, tailIncidence: 0 },
    pilot: { mass: 60 }, controls: { travel: 0.3, lateralTravel: 0.1 },
    engine: { type: 'jet-01', count: 0, x: -0.5, y: 0.5 }, fuelTank: { x: 0, capacity: 0 },
  };
  const sim = new FlightSimulation(definition, 'downhill', 0); sim.launching = false;
  const tail: number[] = [];
  // Hold the flight condition to isolate the actuator/elastic-geometry feedback loop.
  // Structural deformation is retained between steps and all real forces are evaluated.
  // Allow six seconds for the new exposed-area load equilibrium; keep the last-second tolerance.
  for (let step = 0; step < 360; step++) {
    sim.position.set(100, 5000, 0); sim.quaternion.identity(); sim.velocity.set(35, 0, 0); sim.omega.set(0, 0, 0);
    sim.step({ weight: 0, rudder: 1, elevator: 0, aileron: 0, adaptiveControls: true });
    if (step >= 300) tail.push(sim.telemetry.controlInputs.rudder);
  }
  expect(sim.structure.fractureCount).toBe(0);
  expect(Math.min(...tail)).toBeGreaterThan(0.05);
  expect(Math.max(...tail)).toBeLessThan(0.5);
  expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.001);
  expect(sim.structure.maxStressRatio).toBeLessThanOrEqual(0.901);
}, 15_000);
