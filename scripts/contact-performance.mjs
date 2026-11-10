// Run serially, without a browser or unit tests competing for CPU time.
// Optional arguments name other checkouts to compare on the same machine.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const current = fileURLToPath(new URL('../', import.meta.url));
const roots = process.argv.length > 2 ? process.argv.slice(2).map(root => path.resolve(root)) : [current];
const results = [];
for (const root of roots) {
 const server = await createServer({ root, configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, watch: null }, appType: 'custom' });
 try {
  const { FlightSimulation } = await server.ssrLoadModule('/src/physics.ts');
  const { clone, presets, wing } = await server.ssrLoadModule('/src/model.ts');
  const { challengeTerrainHeight } = await server.ssrLoadModule('/src/challenges.ts');
  const scenarios = [];
  for (const [name, bank, strong] of [['shallow-bank-breakup', 0.08, false], ['banked-breakup', 0.4, false], ['intact-supported-wing', 0.08, true]]) {
   const samples = []; let last;
   for (let trial = 0; trial < 4; trial++) {
    const d = clone(presets.find(p => p.name === '基础单发型'));
    d.mainWing = { ...d.mainWing, ...wing(24, 1.5, 1) }; d.mainWing.materialAmount = 2;
    if (strong) d.mainWing.structure = { width: 0.15, height: 0.3, wallThickness: 0.005 };
    const sim = new FlightSimulation(d, 'low-altitude', 0);
    sim.launching = false; sim.structure.reset();
    sim.quaternion.setFromAxisAngle(sim.position.clone().set(1, 0, 0), bank);
    sim.position.set(50, 0, 100); sim.velocity.set(8, -0.3, 0);
    let height = -Infinity;
    for (const point of sim.contacts) {
     const p = point.clone().sub(sim.cg).applyQuaternion(sim.quaternion).add(sim.position);
     height = Math.max(height, challengeTerrainHeight('low-altitude', p.x, p.z) - p.y);
    }
    sim.position.y = height + 1e-6;
    const start = performance.now(); let frames = 0;
    while (frames < 10 && !sim.ended) { sim.step({ weight: 0, elevator: 0, aileron: 0, rudder: 0, throttle: 0 }); frames++; }
    const ms = performance.now() - start, t = sim.telemetry;
    const energyError = Math.abs(t.energy + t.dissipatedEnergy - t.propulsionWork - t.controlWork - t.waterWork + t.fuelEnergyRemoved - t.initialEnergy) / Math.max(1, Math.abs(t.initialEnergy));
    if (!Number.isFinite(ms) || energyError > 1e-8) throw new Error(`${name}: invalid energy ledger (${energyError})`);
    if (trial > 0) samples.push(ms);
    last = { frames, contacts: sim.contacts.length, fragments: sim.fragments.length, energyError, position: sim.position.toArray() };
   }
   scenarios.push({ name, samplesMs: samples.map(ms => +ms.toFixed(2)), medianMs: +[...samples].sort((a, b) => a - b)[1].toFixed(2), ...last });
  }
  results.push({ root, scenarios });
 } finally { await server.close(); }
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, scenarios: '10 frames at 60 Hz, 24 m wing, one warmup and three measured trials', results }, null, 2));
