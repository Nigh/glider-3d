import { expect, it } from 'vitest';
import { wing, type AircraftDefinition } from '../src/model';
import { FlightSimulation } from '../src/physics';

function definition(width = 0.06): AircraftDefinition {
  return {
    name: '舵机沉降试验机', birdman: false,
    fuselage: { length: 6.5, center: 0 }, cockpit: { position: 0.45 },
    mainWing: { ...wing(8.6, 0.85, 0.55, 0.1), dihedral: 3, controlSurface: 0.28,
      structure: { width: 0.06, height: 0.14, wallThickness: 0.0025 } },
    horizontalTail: { ...wing(3, 0.65, 0.4, 0.1), controlSurface: 0.4,
      structure: { width: 0.03, height: 0.065, wallThickness: 0.0015 } },
    verticalTail: { ...wing(2.4, 0.7, 0.35, 0.15), controlSurface: 1, materialId: 'spruce', materialAmount: 0.5,
      structure: { width, height: 0.065, wallThickness: 0.0015 } },
    assembly: { mainWing: 0.8, mainWingHeight: 0.35, horizontalTail: -2.8, verticalTail: -2.9, mainIncidence: 1, tailIncidence: 0 },
    pilot: { mass: 60 }, controls: { travel: 0.3, lateralTravel: 0.1 },
    engine: { type: 'jet-01', count: 0, x: -0.5, y: 0.5 }, fuelTank: { x: 0, capacity: 0 },
  };
}

it('settles under sustained full rudder at a fixed high-load flight condition', () => {
  // The wider spruce beam raises torsional stiffness faster than bending strength.
  // The original 0.03 m beam can deform beyond every instantaneous safe rudder input.
  const sim = new FlightSimulation(definition(), 'downhill', 0); sim.launching = false;
  const tail: number[] = [], stress: number[] = [];
  // Hold the flight condition to isolate the actuator/elastic-geometry feedback loop.
  // Structural deformation is retained between steps and all real forces are evaluated.
  // Allow six seconds for the new exposed-area load equilibrium; keep the last-second tolerance.
  for (let step = 0; step < 360; step++) {
    sim.position.set(100, 5000, 0); sim.quaternion.identity(); sim.velocity.set(35, 0, 0); sim.omega.set(0, 0, 0);
    sim.step({ weight: 0, rudder: 1, elevator: 0, aileron: 0, adaptiveControls: true });
    if (step >= 300) {
      tail.push(Math.max(...sim.structure.sections.filter(section => section.wingKey === 'verticalTail' && section.bodyId === 0).map(section => Math.abs(section.surface.controlCommand))));
      stress.push(sim.structure.maxStressRatio);
    }
  }
  expect(sim.structure.fractureCount).toBe(0);
  expect(Math.min(...tail)).toBeGreaterThan(0.05);
  expect(Math.max(...tail)).toBeLessThan(1);
  expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.001);
  expect(Math.max(...stress)).toBeLessThanOrEqual(0.901);
  sim.position.set(100, 5000, 0); sim.quaternion.identity(); sim.velocity.set(35, 0, 0); sim.omega.set(0, 0, 0);
  const full = { weight: 0, elevator: 0, aileron: 0, rudder: 1 };
  const predict = (scale: number) => Reflect.get(sim, 'predictControlStress').call(sim, full, scale) as number;
  // Settling must retain an actual unloading interval, not make full rudder safe.
  expect(predict(0)).toBeGreaterThan(0.9);
  expect(predict(0.5)).toBeLessThan(0.9);
  expect(predict(1)).toBeGreaterThan(0.9);
}, 15_000);

it('returns zero when no rudder input is safe without suppressing real overload or fracture', () => {
  const sim = new FlightSimulation(definition(0.03), 'downhill', 0); sim.launching = false;
  sim.position.set(100, 5000, 0); sim.quaternion.identity(); sim.velocity.set(100, -50, 30); sim.omega.set(0, 0, 0);
  Reflect.get(sim, 'effective').adaptiveControls = true;
  Reflect.get(sim, 'updateControlDirections').call(sim);
  const full = { weight: 0, elevator: 0, aileron: 0, rudder: 1 };
  for (const scale of [0, 0.25, 0.5, 0.75, 1]) {
    expect(Reflect.get(sim, 'predictControlStress').call(sim, full, scale)).toBeGreaterThan(1);
  }
  expect(Reflect.get(sim, 'adaptiveControlLimit').call(sim, full)).toBe(0);
  sim.step({ ...full, adaptiveControls: true }, 1e-5);
  expect(sim.telemetry.controlLimit).toBe(0);
  expect(sim.telemetry.controlInputs.rudder).toBe(0);
  expect(sim.structure.maxStressRatio).toBeGreaterThan(1);
  expect(sim.structure.fractureCount).toBeGreaterThan(0);
});
