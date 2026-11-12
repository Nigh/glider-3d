// Reproduce the model audit without a browser or a second copy of the equations.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null }, appType: 'custom' });
try {
  const { coefficients, FlightSimulation, AIR_DENSITY } = await server.ssrLoadModule('/src/physics.ts');
  const { presets, DEG } = await server.ssrLoadModule('/src/model.ts');
  const sections = [200_000, 500_000, 1_000_000].map(re => ({
    reynolds: re,
    profileCdAtAlpha0: coefficients(0, 12, re).profileCd,
    profileCdAtAlpha1_25: coefficients(1.25 * DEG, 12, re).profileCd,
    profileCdAtAlphaMinus6: coefficients(-6 * DEG, 12, re).profileCd,
  }));
  const aircraft = [];
  const neutral = { weight: 0, lateral: 0, elevator: 0, aileron: 0, rudder: 0, throttle: 0 };
  for (const definition of presets) for (const speed of [12, 20, 40]) {
    const sim = new FlightSimulation(definition, 'test-space', 0, { height: 1000, catapult: false, speed });
    sim.launching = false; sim.position.set(100, 1000, 0); sim.quaternion.identity(); sim.velocity.set(speed, 0, 0); sim.omega.set(0, 0, 0);
    // Fixed undeformed geometry, alpha_body=0, no integration/trim/ground effect.
    sim.evaluateForces(neutral, sim.velocity, sim.omega, sim.quaternion, sim.position, neutral);
    sim.aerodynamics.update(sim.cg, sim.quaternion, sim.velocity, undefined, sim.omega);
    const aero = sim.telemetry.aerodynamics, qS = 0.5 * AIR_DENSITY * speed ** 2 * sim.aircraft.wingArea;
    aircraft.push({ name: definition.name, speed, wingArea: sim.aircraft.wingArea,
      profileN: aero.profileDrag.length(), inducedN: aero.inducedDrag.length(), totalN: aero.drag.length(),
      nonInducedCD: aero.profileDrag.length() / qS, inducedCD: aero.inducedDrag.length() / qS,
      unresolvedBodyCD: 0.07 / sim.aircraft.wingArea,
    });
  }
  console.log(JSON.stringify({ conditions: 'Sea-level density; fixed undeformed geometry; body alpha=0; no trim, throttle, angular motion or ground effect. Wing installation angles remain those of each preset.', sections, aircraft }, null, 2));
} finally { await server.close(); }
