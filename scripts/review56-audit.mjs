// Reproduce PR review 5875614273 using its attached, unmodified aircraft.
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null }, appType: 'custom' });
try {
  const { FlightSimulation, AIR_DENSITY, coefficients } = await server.ssrLoadModule('/src/physics.ts');
  const { validateAircraft, DEG, BODY_GEOMETRY } = await server.ssrLoadModule('/src/model.ts');
  const { DRAG_TERMS, dragResistance, ellipsoidSurfaceArea } = await server.ssrLoadModule('/src/drag.ts');
  const { PHYSICS_VERSION } = await server.ssrLoadModule('/src/storage.ts');
  const definition = validateAircraft(JSON.parse(await readFile(new URL('../tests/fixtures/review56-twin.json', import.meta.url), 'utf8')));
  const neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0, throttle: 0 };
  const results = [];
  function snapshot(sim, mode, pitch) {
    const velocity = mode === 'wind' ? sim.laboratoryState.windVelocity : sim.velocity;
    const a = sim.aerodynamics; a.update(sim.cg, sim.quaternion, velocity, sim.torque, sim.omega);
    const qS = 0.5 * AIR_DENSITY * 31 ** 2 * sim.aircraft.wingArea;
    return { mode, bodyPitch: pitch, bodyAlpha: a.alpha / DEG, mainGeometricAlpha: sim.telemetry.alpha / DEG,
      mainEffectiveAlpha: a.wings[0].alpha / DEG, thrust: sim.thrust, pitchMoment: sim.telemetry.torque.z,
      drag: dragResistance(a.drag, a.dragAxis), nonInduced: dragResistance(a.profileDrag, a.dragAxis), induced: dragResistance(a.inducedDrag, a.dragAxis),
      nonInducedCd: dragResistance(a.profileDrag, a.dragAxis) / qS,
      terms: Object.fromEntries(DRAG_TERMS.map(key => [key, dragResistance(a.dragTerms[key], a.dragAxis)])),
      localReynolds: sim.surfaces.map(surface => ({ kind: surface.kind, chord: surface.chord, reynolds: surface.localFlow.length() * surface.chord / 1.46e-5 })),
      fractures: sim.structure.fractureCount };
  }
  for (const pitch of [1.3, 5.3]) {
    const flight = new FlightSimulation(definition, 'test-space', 0, { height: 1000, catapult: false, speed: 31 });
    flight.sampleSteadyFlight(31, pitch * DEG, 0, 0.8); flight.updateTelemetry();
    results.push(snapshot(flight, 'flight', pitch));
    const wind = new FlightSimulation(definition, 'wind-tunnel', 0);
    wind.setWindTunnel({ ...wind.windTunnel, speed: 31, pitch }); wind.setWindTunnelEnabled(true);
    for (let tick = 0; tick < 1500; tick++) wind.step(neutral);
    results.push(snapshot(wind, 'wind', pitch));
  }
  const wettedAreas = ['shell', 'canopy'].map(key => {
    const shape = BODY_GEOMETRY[key];
    return { key, oldArea: 2 * Math.PI * shape.xRadius * (shape.yRadius + shape.zRadius), ellipsoidArea: ellipsoidSurfaceArea(shape) };
  });
  const highReBoundary = [-6,0,5,12].map(alpha => ({ alpha,
    cd1M: coefficients(alpha * DEG, 2, 1_000_000).profileCd, cd8M: coefficients(alpha * DEG, 2, 8_000_000).profileCd }));
  console.log(JSON.stringify({ physicsVersion: PHYSICS_VERSION, speed: 31, throttleInFlight: 0.8, conditions:
    'Flight: full fuel, sea-level force reference, four quasi-static shape iterations. Wind: unpowered fixture, 25 s settling, normal room ground effect. These are different support/shape states, not a single captured in-flight state.',
    results, wettedAreas, highReBoundary }, null, 2));
} finally { await server.close(); }
