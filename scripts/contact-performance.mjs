// Run serially, without a browser or unit tests competing for CPU time.
// Optional arguments name other checkouts to compare on the same machine.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

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
  const inputs = [
   ['shallow-bank-breakup', 0.08, false, 1 / 60],
   ['banked-breakup', 0.4, false, 1 / 60],
   ['intact-supported-wing', 0.08, true, 1 / 60],
   ['intact-banked-wing', 0.4, true, 1 / 60],
  ];
  for (const [name, bank, strong, dt] of inputs) {
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
    sim.updateTelemetry();
    const ledger = () => {
     const t = sim.telemetry;
     return t.energy + t.dissipatedEnergy - t.propulsionWork - t.controlWork - t.waterWork + t.fuelEnergyRemoved;
    };
    const initialEnergy = ledger(), events = [], measured = new Map();
    const structurePrototype = Object.getPrototypeOf(sim.structure);
    const { measureLoads, detach } = structurePrototype;
    let measurement = 0, energyError = 0, maxPenetration = 0, previousDissipation = sim.telemetry.dissipatedEnergy;
    structurePrototype.measureLoads = function(body, force, torque, contacts) {
     const maximum = measureLoads.call(this, body, force, torque, contacts);
     measured.set(body.id, { serial: ++measurement, ids: this.sectionsForBody(body.id).map(s => s.id),
      stress: this.sectionsForBody(body.id).map(s => s.stressRatio) });
     return maximum;
    };
    structurePrototype.detach = function(boundary, id) {
     const owner = boundary.bodyId, sample = measured.get(owner), owned = this.sectionsForBody(owner);
     assert.deepEqual(sample.ids, owned.map(s => s.id), `${name}: stale ownership at fracture`);
     assert.deepEqual(sample.stress, owned.map(s => s.stressRatio), `${name}: stale stress at fracture`);
     const worst = owned.filter(s => s.fractureDamage >= 1 && (owner === 0 || (s.parentId !== null && this.sections[s.parentId].bodyId === owner)))
      .sort((a, b) => b.stressRatio - a.stressRatio || a.id - b.id)[0];
     assert.equal(boundary.id, worst.id, `${name}: fracture did not select worst joint`);
     assert.ok(boundary.stressRatio >= 1, `${name}: fracture without measured overload`);
     assert.equal(boundary.fractureDamage, 1, `${name}: fracture before overload accumulation`);
     events.push({ time: sim.elapsed, sectionId: boundary.id, wing: boundary.wingKey, side: boundary.side,
      span: boundary.spanStart, stress: boundary.stressRatio, damage: boundary.fractureDamage,
      measurement: sample.serial, previousBody: owner, bodyId: id });
     return detach.call(this, boundary, id);
    };
    try {
    const start = performance.now(); let frames = 0;
    const targetFrames = Math.round((1 / 6) / dt);
    while (frames < targetFrames && !sim.ended) {
     sim.step({ weight: 0, elevator: 0, aileron: 0, rudder: 0, throttle: 0 }, dt); frames++;
     energyError = Math.max(energyError, Math.abs(ledger() - initialEnergy) / Math.max(1, Math.abs(initialEnergy)));
     assert.ok(energyError < 1e-8, `${name}: invalid energy ledger (${energyError})`);
     assert.ok(sim.telemetry.dissipatedEnergy >= previousDissipation - 1e-9, `${name}: contact injected energy`);
     previousDissipation = sim.telemetry.dissipatedEnergy;
     assert.ok(sim.structure.rotationBudgetValid(), `${name}: elastic rotation exceeded 0.25 rad`);
     for (const point of sim.contacts) {
      const owner = point.sectionId === undefined ? 0 : sim.structure.sections[point.sectionId].bodyId;
      const body = owner === 0 ? sim : sim.fragments.find(fragment => fragment.id === owner);
      const world = point.clone().sub(body.cg).applyQuaternion(body.quaternion).add(body.position);
      maxPenetration = Math.max(maxPenetration, challengeTerrainHeight('low-altitude', world.x, world.z) - world.y);
     }
     assert.ok(maxPenetration <= 2e-6, `${name}: contact penetration (${maxPenetration})`);
    }
    const ms = performance.now() - start;
    assert.ok(Number.isFinite(ms), `${name}: non-finite runtime`);
    assert.equal(frames, targetFrames, `${name}: ended before 1/6 s`);
    assert.equal(sim.ended, false, `${name}: unexpected flight end`);
    assert.equal(events.length > 0, !strong, `${name}: wrong strong/weak fracture behavior`);
    for (let i = 1; i < events.length; i++) assert.ok(events[i].measurement > events[i - 1].measurement, `${name}: missing post-fracture remeasurement`);
    if (trial > 0) samples.push(ms);
    last = { dt, frames, elapsed: sim.elapsed, contacts: sim.contacts.length, fragments: sim.fragments.length,
     energyError, maxPenetration, elasticRotationValid: sim.structure.rotationBudgetValid(),
     firstFracture: events[0] ?? null, fractures: events, position: sim.position.toArray() };
    } finally {
     structurePrototype.measureLoads = measureLoads;
     structurePrototype.detach = detach;
    }
   }
   scenarios.push({ name, samplesMs: samples.map(ms => +ms.toFixed(2)), medianMs: +[...samples].sort((a, b) => a - b)[1].toFixed(2), ...last });
  }
  results.push({ root, scenarios });
 } finally { await server.close(); }
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, scenarios: '1/6 s at fixed 60 Hz, 24 m wing, one warmup and three measured trials', results }, null, 2));
