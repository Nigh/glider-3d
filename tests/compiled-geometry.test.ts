import { expect, it } from 'vitest';
import Module, { type Manifold } from 'manifold-3d';
import { Matrix4, Quaternion, Triangle, Vector3 } from 'three';
import { clone, cockpitGeometry, defaultAircraft, engineMounts, planform, presets, wing, wingInstancePoint, type AircraftDefinition } from '../src/model';
import { compileAircraft, compileAffectedAircraft, geometryKey, getCompiledAircraft, installCompiledAircraft, type CompiledAircraft, type CompiledPartition } from '../src/compiled-geometry';
import { centeredMeshPositions, closeMesh, restoreSpanStations, wingMesh } from '../src/compiled-geometry-mesh';
import { engineCatalog } from '../src/engines';
import { ENGINE_GEOMETRY } from '../src/engine-geometry';
import { FlightSimulation } from '../src/physics';

const manifold = await Module({ locateFile: () => new URL('../node_modules/manifold-3d/manifold.wasm', import.meta.url).href });
manifold.setup();

function isolated(): AircraftDefinition {
 const d = clone(defaultAircraft);
 d.birdman = false; d.engine.count = 0; d.fuelTank.capacity = 0;
 d.fuselage = { length: 3, center: -30 }; d.cockpit.position = -30;
 d.mainWing = wing(3.2, 1, 1); d.mainWing.airfoil = 'naca0012';
 d.horizontalTail = wing(1.6, 0.4, 0.4); d.verticalTail = wing(1.6, 0.5, 0.5);
 d.assembly = { mainWing: 0, mainWingHeight: 1, horizontalTail: -20, verticalTail: -25, mainIncidence: 0, tailIncidence: 0, tailOnFin: false };
 d.auxiliaryWings = [];
 return d;
}

function solid(part: Pick<CompiledPartition, 'positions' | 'indices'>): Manifold {
 const local = centeredMeshPositions(part.positions), faceID = new Uint32Array(part.indices.length / 3);
 for (let i = 0; i < faceID.length; i++) faceID[i] = i;
 for (let i = 0; i < part.positions.length; i++) expect(Math.abs(local.positions[i] + local.offset[i % 3] - part.positions[i])).toBeLessThan(2e-6);
 const body = new manifold.Manifold(new manifold.Mesh({ numProp: 3, vertProperties: local.positions, triVerts: part.indices, faceID }));
 try { return body.translate(local.offset); } finally { body.delete(); }
}

function projectedMeshArea(result: CompiledAircraft, id: number): number {
 let area = 0;
 for (const p of result.partitions) {
  if (p.wingInstance !== id) continue;
  for (let i = 0; i < p.indices.length; i += 3) {
   const a = p.indices[i] * 3, b = p.indices[i + 1] * 3, c = p.indices[i + 2] * 3;
   area += Math.abs((p.positions[b] - p.positions[a]) * (p.positions[c + 2] - p.positions[a + 2])
    - (p.positions[b + 2] - p.positions[a + 2]) * (p.positions[c] - p.positions[a])) / 4;
  }
 }
 return area;
}

it('keeps visible skin and control authority when projections overlap but 3D solids are separated', () => {
 const d = isolated(); d.mainWing.controlSurface = 0.3;
 const baseline = compileAircraft(d), stacked = clone(d);
 stacked.auxiliaryWings = [{ kind: 'horizontalTail', wing: clone(d.mainWing), position: -0.5, incidence: 0 }];
 const result = compileAircraft(stacked);
 expect(projectedMeshArea(result, 0)).toBeCloseTo(projectedMeshArea(baseline, 0), 5);
 const area = (r: CompiledAircraft) => r.partitions.filter(p => p.wingInstance === 0).reduce((sum, p) => sum + p.surfaceArea, 0);
 expect(area(result)).toBeCloseTo(area(baseline), 5);
 const controls = (r: CompiledAircraft) => r.controls.filter(c => c.wingInstance === 0).map(c => [c.side, c.spanStart, c.areaFraction]);
 expect(controls(result)).toEqual(controls(baseline));
 expect(result.controls.filter(c => c.wingInstance === 0 && c.spanStart >= 0.8).every(c => c.areaFraction > 0.99 && c.maxAngle > 0)).toBe(true);
}, 60_000);

it('partitions genuinely intersecting wings into closed, non-overlapping volumes without welding sources', () => {
 const d = isolated(); d.assembly.mainWingHeight = 0;
 d.auxiliaryWings = [{ kind: 'horizontalTail', wing: clone(d.mainWing), position: -0.5, incidence: 20 }];
 const result = compileAircraft(d), partitions = result.partitions.filter(p => p.wingInstance === 0 || p.wingInstance === 3);
 const handles: Manifold[] = [];
 try {
  for (const p of partitions) {
   const body = solid(p); handles.push(body);
   expect(body.status()).toBe('NoError'); expect(body.volume()).toBeGreaterThan(0);
   expect(p.positions.length).toBe(p.coordinates.length);
   expect(p.spanEnd - p.spanStart).toBeLessThanOrEqual(0.800001);
   expect([...p.coordinates].every(Number.isFinite)).toBe(true);
  }
  for (let i = 0; i < handles.length; i++) for (let j = i + 1; j < handles.length; j++) {
   const intersection = handles[i].intersect(handles[j]);
   try { expect(intersection.volume()).toBeLessThan(1e-8); } finally { intersection.delete(); }
  }
  const raw: Manifold[] = [];
  try {
   for (const id of [0, 3]) for (const side of [-1, 1]) raw.push(solid(wingMesh(d, id, side, 0, 1.6)));
   const union = manifold.Manifold.union(raw);
   try { expect(handles.reduce((sum, body) => sum + body.volume(), 0)).toBeCloseTo(union.volume(), 5); } finally { union.delete(); }
  } finally { for (const body of raw) body.delete(); }
  expect(new Set(partitions.filter(p => p.wingInstance === 0).map(p => p.sourceIndex)).size).toBe(2);
  expect(partitions.some(p => p.wingInstance === 3 && p.surfaceArea > 0)).toBe(true);
 } finally { for (const body of handles) body.delete(); }
}, 60_000);

it('welds closed LE/TE sections and preserves area and source coordinates for thin trailing edges', () => {
 for (const airfoil of ['dae11', 'naca0012'] as const) {
  const d = isolated(); d.assembly.mainWingHeight = 0; d.mainWing.airfoil = airfoil;
  const mesh = wingMesh(d, 0, 1, 0, 0.8), body = solid(mesh);
  try { expect(body.status()).toBe('NoError'); expect(body.volume()).toBeGreaterThan(0); } finally { body.delete(); }
  const result = compileAircraft(d), main = result.partitions.filter(p => p.wingInstance === 0);
  expect(main.reduce((sum, p) => sum + p.surfaceArea, 0)).toBeCloseTo(planform(d.mainWing).area, 5);
  const point = new Vector3();
  for (const p of main) for (let i = 0; i < p.positions.length; i += 3) {
   wingInstancePoint(d, 0, p.side, p.coordinates[i], p.coordinates[i + 1], p.coordinates[i + 2], point);
   expect(point.distanceTo(new Vector3().fromArray(p.positions, i))).toBeLessThan(0.001);
  }
  if (airfoil === 'naca0012') {
   const supported = clone(d); supported.assembly.mainWingHeight = 1;
   const supportedArea = compileAircraft(supported).partitions.filter(p => p.wingInstance === 0).reduce((sum, p) => sum + p.surfaceArea, 0);
   // A 0.06 m-wide plate buries only the lower face; two skin faces count once.
   expect(supportedArea).toBeCloseTo(planform(d.mainWing).area - 0.03, 5);
  }
 }
 expect(() => closeMesh([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], [0, 1, 2])).toThrow();
}, 60_000);

it('splits selected cut faces at shared source stations without changing material or leaving edge cracks', () => {
 const points = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0.8 }];
 const mesh = closeMesh(points, [0, 1, 3, 0, 2, 1, 0, 3, 2, 1, 2, 3], [10, 20, 30, 40],
  points.flatMap(point => [point.z, point.x, point.y]));
 const refined = restoreSpanStations(mesh, [0.2, 0.4, 0.6], new Uint8Array([1, 0, 0, 0]));
 const before = solid(mesh), after = solid(refined), triangle = new Triangle(), point = new Vector3(), closest = new Vector3();
 try {
  expect(after.status()).toBe('NoError'); expect(after.volume()).toBeCloseTo(before.volume(), 8);
  expect(refined.indices.length).toBeGreaterThan(mesh.indices.length);
  for (let i = 0; i < refined.indices.length; i += 3) {
   const original = mesh.faceIDs.indexOf(refined.faceIDs[i / 3]) * 3;
   expect(original).toBeGreaterThanOrEqual(0);
   triangle.a.fromArray(mesh.positions, mesh.indices[original] * 3);
   triangle.b.fromArray(mesh.positions, mesh.indices[original + 1] * 3);
   triangle.c.fromArray(mesh.positions, mesh.indices[original + 2] * 3);
   const spans: number[] = [];
   for (let corner = 0; corner < 3; corner++) {
    const vertex = refined.indices[i + corner]; point.fromArray(refined.positions, vertex * 3);
    triangle.closestPointToPoint(point, closest);
    expect(point.distanceTo(closest)).toBeLessThan(1e-7);
    expect(refined.coordinates![vertex * 3]).toBe(point.z);
    spans.push(refined.coordinates![vertex * 3]);
   }
   if (refined.faceIDs[i / 3] === 10) expect(Math.max(...spans) - Math.min(...spans)).toBeLessThan(0.200001);
  }
 } finally { before.delete(); after.delete(); }
});

it('keeps mirrored supports closed with attachment weights and both full-moving fin controls active', () => {
 const d = isolated(); d.assembly.verticalTail = 10;
 d.verticalTail = wing(3.2, 0.8, 0.5); d.verticalTail.mirrored = true;
 d.verticalTail.cant = 25; d.verticalTail.lateralOffset = 0.6; d.verticalTail.controlSurface = 1;
 const result = compileAircraft(d), supports = result.partitions.filter(p => p.kind === 'wing-support' && p.supportWingInstance === 2);
 expect(supports).toHaveLength(2);
 for (const p of supports) {
  expect(p.wingInstance).toBe(-1); expect(p.movable).toBe(false);
  const body = solid(p);
  try { expect(body.status()).toBe('NoError'); expect(body.volume()).toBeGreaterThan(0); } finally { body.delete(); }
  const weights = Array.from(p.coordinates).filter((_, i) => i % 3 === 0);
  expect(Math.min(...weights)).toBeGreaterThanOrEqual(0); expect(Math.max(...weights)).toBeLessThanOrEqual(1);
  expect(Math.max(...weights) - Math.min(...weights)).toBeGreaterThan(0.5);
 }
 for (const side of [-1, 1]) {
  const controls = result.controls.filter(c => c.wingInstance === 2 && c.side === side && c.spanStart >= 0.8);
  expect(controls.length).toBeGreaterThan(0);
  expect(controls.every(c => c.areaFraction > 0.99 && c.minAngle < 0 && c.maxAngle > 0)).toBe(true);
  expect(controls.every(c => c.center.every(Number.isFinite) && Math.abs(Math.hypot(...c.axis) - 1) < 1e-8)).toBe(true);
 }
 // Zero-offset outward-canted roots exercise the non-injective symmetry-plane miter.
 d.verticalTail.lateralOffset = 0; d.verticalTail.controlSurface = 0;
 const miter = compileAircraft(d);
 expect(miter.partitions.filter(p => p.wingInstance === 2).length).toBeGreaterThan(0);
}, 60_000);

it('provides hinge relief for opposite control travel without adding structural boundaries', () => {
 const d = isolated(); d.mainWing.controlSurface = 0.3;
 const result = compileAircraft(d), fixed = result.partitions.filter(p => p.wingInstance === 0 && !p.movable);
 const fixedBodies = fixed.map(p => solid(p));
 try {
  for (const side of [-1, 1]) {
   const control = result.controls.find(c => c.wingInstance === 0 && c.side === side && c.spanStart === 0.8)!;
   expect(control.area).toBeGreaterThan(0.23); expect(control.areaFraction).toBeGreaterThan(0.99);
   for (const angle of [control.minAngle, -0.07, 0.13, control.maxAngle]) {
    const pivot = new Vector3(...control.hinge), matrix = new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromAxisAngle(new Vector3(...control.axis), angle));
    matrix.setPosition(pivot.clone().sub(pivot.clone().applyMatrix4(matrix)));
    for (const part of result.partitions.filter(p => p.wingInstance === 0 && p.side === side && p.movable && p.spanStart >= 0.8)) {
     const original = solid(part), rotated = original.transform(matrix.elements as Parameters<Manifold['transform']>[0]);
     try {
      for (const obstacle of fixedBodies) {
       const intersection = rotated.intersect(obstacle);
       try { expect(intersection.volume()).toBeLessThan(1e-8); } finally { intersection.delete(); }
      }
     } finally { rotated.delete(); original.delete(); }
    }
   }
  }
 } finally { for (const body of fixedBodies) body.delete(); }
}, 60_000);

it.each([0.3, 1])('keeps base twin-engine same-section hinge solids clear through both control directions (fraction %s)', fraction => {
 const d = clone(presets.find(plane => plane.name === '基础双发型')!); d.mainWing.controlSurface = fraction;
 const controlTravel = { maxSweepIntersectionVolume: 0, maxPoseIntersectionVolume: 0, pairs: 0, mainRootPairs: 0 };
 const diagnostics = { maxIntersectionVolume: 0, maxSurfaceDeviation: 0, minVolume: 0, controlTravel };
 const result = compileAircraft(d, diagnostics);
 expect(controlTravel.pairs).toBeGreaterThan(0);
 if (fraction === 0.3) expect(controlTravel.mainRootPairs).toBeGreaterThan(0);
 expect(controlTravel.maxSweepIntersectionVolume).toBeLessThan(1e-10);
 expect(controlTravel.maxPoseIntersectionVolume).toBeLessThan(1e-10);
 expect(result.controls.filter(control => control.wingInstance === 0).reduce((area, control) => area + control.area, 0)).toBeGreaterThan(0);
 expect(diagnostics.minVolume).toBeGreaterThan(0);
}, 30_000);

it('audits the base twin-engine neutral fixed hinge boundary in native coordinates', () => {
 const d = clone(presets.find(plane => plane.name === '基础双发型')!); d.mainWing.controlSurface = 0.3;
 const diagnostics = { maxIntersectionVolume: 0, maxSurfaceDeviation: 0, minVolume: 0, maxIntersectionPair: '' };
 const result = compileAircraft(d, diagnostics), fixed = result.partitions.filter(part => part.wingInstance === 0 && part.side === -1 && !part.movable && part.spanStart < 0.8);
 expect(fixed).toHaveLength(1);
 expect(fixed[0].materialId).toBe(d.mainWing.materialId); expect(fixed[0].materialAmount).toBe(d.mainWing.materialAmount);
 expect(diagnostics.minVolume).toBeGreaterThan(0); expect(diagnostics.maxSurfaceDeviation).toBeLessThan(2e-6);
 expect(diagnostics.maxIntersectionVolume, diagnostics.maxIntersectionPair).toBeLessThan(1e-9);
}, 30_000);

it('keeps the twin-engine auxiliary hinge clear in each real proposed elastic cruise shape', () => {
 const d = clone(presets.find(plane => plane.name === '基础双发型')!); d.fuelTank.capacity = 0.3;
 const compiled = compileAircraft(d), simulation = new FlightSimulation(d, 'test-space', 0, { height: 1000, speed: 50, catapult: false });
 const update = simulation.structure.update.bind(simulation.structure);
 const parts = compiled.partitions.filter(part => part.wingInstance === 1 && part.side === -1 && part.spanStart < 0.8);
 const control = compiled.controls.find(item => item.wingInstance === 1 && item.side === -1 && item.spanStart === 0)!;
 const hinge = new Vector3(...control.hinge), axis = new Vector3(...control.axis), point = new Vector3();
 let proposals = 0;
 expect(parts).toHaveLength(2); expect(parts.some(part => part.movable)).toBe(true);
 simulation.structure.update = (...args) => {
  update(...args); proposals++;
  const section = simulation.structure.sections.find(item => item.wingInstance === 1 && item.side === -1 && item.spanStart === 0)!;
  const bodies: Manifold[] = [];
  try {
   for (const part of parts) {
    const positions = part.positions.slice();
    for (let i = 0; i < positions.length; i += 3) {
     point.fromArray(positions, i);
     if (part.movable) point.sub(hinge).applyAxisAngle(axis, section.controlDeflection).add(hinge);
     const t = Math.max(0, Math.min(1, (part.coordinates[i] - section.spanStart) / (section.spanEnd - section.spanStart)));
     simulation.structure.deformPoint(section, point, t); point.toArray(positions, i);
    }
    bodies.push(solid({ positions, indices: part.indices }));
   }
   const intersection = bodies[0].intersect(bodies[1]);
   try { expect(intersection.volume()).toBeLessThan(1e-9); } finally { intersection.delete(); }
  } finally { for (const body of bodies) body.delete(); }
 };
 simulation.sampleSteadyFlight(8, 7 * Math.PI / 180, -0.3, 0);
 expect(proposals).toBe(3);
}, 30_000);

it('retains frozen trailing skin area when fixed fragments share a structural cell', () => {
 const d = isolated(); d.assembly.mainWingHeight = 0; d.mainWing.controlSurface = 0.3;
 const result = compileAircraft(d);
 for (const side of [-1, 1]) {
  const fixed = result.partitions.filter(part => part.wingInstance === 0 && part.side === side && !part.movable);
  const root = fixed.find(part => part.spanStart === 0)!, outer = fixed.find(part => part.spanStart === 0.8)!;
  expect(fixed.filter(part => part.spanStart < 0.8)).toHaveLength(1);
  expect(root.surfaceArea).toBeCloseTo(0.02 + 0.78 * outer.surfaceArea / 0.8, 6);
 }
 const area = result.controls.filter(control => control.wingInstance === 0).reduce((sum, control) => sum + control.area, 0);
 expect(area).toBeCloseTo((3.2 - 2 * 0.02) * 0.3, 6);
}, 30_000);

it('caches geometry/material changes only and preserves prior results after failure', () => {
 const d = isolated(), key = geometryKey(d), result = compileAircraft(d);
 const renamed = clone(d); renamed.name = 'Renamed'; renamed.pilot.mass += 1; renamed.controls.travel += 0.01;
 renamed.mainWing.controlAxes = { roll: false, pitch: true, yaw: false }; renamed.mainWing.controlResponse = 0.2;
 expect(geometryKey(renamed)).toBe(key); expect(getCompiledAircraft(renamed)).toBe(result);
 const changed = clone(d); changed.mainWing.materialAmount = 1.1;
 expect(geometryKey(changed)).not.toBe(key); expect(getCompiledAircraft(changed)).toBeUndefined();
 expect(() => installCompiledAircraft(changed, result)).toThrow('does not match');
 const invalid = clone(d); invalid.mainWing.points[0].x = NaN;
 expect(() => compileAircraft(invalid)).toThrow();
 expect(getCompiledAircraft(d)).toBe(result);
}, 60_000);

it('recompiles only incidence neighbours and restores buried skin from original meshes', () => {
 const d = isolated(); d.assembly.mainWingHeight = 0; d.mainWing.controlSurface = 0.3;
 d.auxiliaryWings = [{ kind: 'horizontalTail', wing: clone(d.mainWing), position: -0.5, incidence: 0 }];
 const before = compileAircraft(d), remote = before.partitions.filter(p => p.wingInstance === 1);
 const transferred = structuredClone(before);
 d.assembly.mainIncidence = 9;
 const changed = compileAffectedAircraft(d, transferred, [0]);
 expect(changed.sourceMeshes?.length).toBe(before.sourceMeshes?.length);
 for (const p of transferred.partitions.filter(p => p.wingInstance === 1)) expect(changed.partitions).toContain(p);
 for (const p of remote) expect(changed.partitions).not.toContain(p); // Worker transfer owns independent buffers.
 const sameGeometry = clone(d); sameGeometry.verticalTail.materialAmount += 0.001;
 const full = compileAircraft(sameGeometry);
 for (const id of [0, 3]) {
  const area = (r: CompiledAircraft) => r.partitions.filter(p => p.wingInstance === id).reduce((sum, p) => sum + p.surfaceArea, 0);
  expect(area(changed)).toBeCloseTo(area(full), 5);
 }
 expect(compileAffectedAircraft(d, changed, [0])).toBe(changed);
 d.assembly.mainIncidence = 0.1;
 const restored = compileAffectedAircraft(d, changed, [0]);
 const handles: Manifold[] = [];
 try {
  for (const p of restored.partitions.filter(p => p.wingInstance === 0 || p.wingInstance === 3)) handles.push(solid(p));
  for (let i = 0; i < handles.length; i++) for (let j = i + 1; j < handles.length; j++) {
   const intersection = handles[i].intersect(handles[j]);
   try { expect(intersection.volume()).toBeLessThan(1e-8); } finally { intersection.delete(); }
  }
 } finally { for (const body of handles) body.delete(); }
}, 60_000);

it('emits closed engine/support solids and does not draw an internal tank through the cockpit', () => {
 const d = isolated(); d.engine.count = 2; d.engine.x = -30; d.engine.y = 1; d.engine.lateralOffset = 0.6;
 d.fuelTank.capacity = 1; d.fuelTank.x = -30;
 const result = compileAircraft(d);
 expect(result.sourceMeshes?.some(source => source.kind === 'fuel-tank')).toBe(true);
 expect(result.partitions.some(p => p.kind === 'fuel-tank')).toBe(false);
 expect(new Set(result.partitions.filter(p => p.kind === 'engine').map(p => p.engineIndex)).size).toBe(2);
 expect(result.partitions.filter(p => p.kind === 'engine-support')).toHaveLength(2);
 for (const p of result.partitions.filter(p => p.kind === 'engine' || p.kind === 'engine-support')) {
  const body = solid(p);
  try { expect(body.status()).toBe('NoError'); expect(body.volume()).toBeGreaterThan(0); } finally { body.delete(); }
 }
 const smaller = clone(d); smaller.fuelTank.capacity = 0.5;
 expect(geometryKey(smaller)).not.toBe(geometryKey(d));
}, 60_000);

it('retains open engine mouths, inward walls and recessed bulkheads instead of filled cylinders', () => {
 const d = isolated(); d.engine.count = 2; d.engine.x = -30; d.engine.y = 1; d.engine.lateralOffset = 0.6;
 const result = compileAircraft(d), mount = engineMounts(d)[0], spec = engineCatalog[d.engine.type], g = ENGINE_GEOMETRY;
 const parts = result.partitions.filter(p => p.kind === 'engine' && p.engineIndex === 0);
 expect(new Set(parts.map(p => p.enginePart))).toEqual(new Set(['housing', 'nozzle', 'intake', 'exhaust-back', 'rim', 'hub']));
 const bodies: Manifold[] = [];
 try {
  for (const part of parts) bodies.push(solid(part));
  const phi = Math.PI / g.segments, y = mount.y + 0.6 * spec.radius * Math.cos(phi), z = mount.z + 0.6 * spec.radius * Math.sin(phi);
  const front = bodies.flatMap(body => body.rayCast([mount.x + 0.7 * spec.length, y, z], [mount.x + 0.35 * spec.length, y, z]));
  expect(front.length).toBeGreaterThan(0);
  expect(Math.max(...front.map(hit => hit.position[0]))).toBeCloseTo(Math.fround(mount.x + g.intake.x * spec.length), 6);
  const backY = mount.y + 0.3 * spec.radius * Math.cos(phi), backZ = mount.z + 0.3 * spec.radius * Math.sin(phi);
  const rear = bodies.flatMap(body => body.rayCast([mount.x - 0.7 * spec.length, backY, backZ], [mount.x - 0.25 * spec.length, backY, backZ]));
  expect(rear.length).toBeGreaterThan(0);
  expect(Math.min(...rear.map(hit => hit.position[0]))).toBeCloseTo(Math.fround(mount.x + g.exhaustBack.x * spec.length), 6);
  const x = mount.x + 0.405 * spec.length;
  const inner = bodies.flatMap(body => body.rayCast([x, backY, backZ],
   [x, mount.y + 1.1 * spec.radius * Math.cos(phi), mount.z + 1.1 * spec.radius * Math.sin(phi)]));
  const firstRadius = Math.min(...inner.map(hit => Math.hypot(hit.position[1] - mount.y, hit.position[2] - mount.z)));
  const outerRadius = g.housing.rearRadius + (0.405 - g.housing.rearX) / (g.housing.frontX - g.housing.rearX) * (g.housing.frontRadius - g.housing.rearRadius);
  expect(firstRadius).toBeCloseTo((outerRadius - g.wall) * spec.radius * Math.cos(phi), 6);
  const filledEnvelope = Math.PI * spec.length * spec.radius ** 2 * (0.8 * (1 + 0.82 + 0.82 ** 2) + 0.2 * (0.82 ** 2 + 0.82 * 0.55 + 0.55 ** 2)) / 3;
  expect(bodies.reduce((sum, body) => sum + body.volume(), 0)).toBeLessThan(filledEnvelope * 0.2);
 } finally { for (const body of bodies) body.delete(); }
}, 60_000);

it('keeps every performance glider partition closed and free of positive-volume intersections', () => {
 const d = clone(presets.find(p => p.name === '高性能滑翔型')!);
 const diagnostics = { maxIntersectionVolume: 0, maxSurfaceDeviation: 0, minVolume: 0 };
 const result = compileAircraft(d, diagnostics);
 expect(diagnostics.minVolume).toBeGreaterThan(0);
 expect(diagnostics.maxIntersectionVolume).toBeLessThan(1e-9);
 expect(diagnostics.maxSurfaceDeviation).toBeLessThan(2e-6);
 // Worker-transfer source meshes use the same conditioned import as production.
 for (const source of result.sourceMeshes!) {
  const body = solid(source); let signedVolume = 0;
  const p = centeredMeshPositions(source.positions).positions, ox = p[0], oy = p[1], oz = p[2];
  for (let i = 0; i < source.indices.length; i += 3) {
   const a = source.indices[i] * 3, b = source.indices[i + 1] * 3, c = source.indices[i + 2] * 3;
   const ax = p[a] - ox, ay = p[a + 1] - oy, az = p[a + 2] - oz;
   const bx = p[b] - ox, by = p[b + 1] - oy, bz = p[b + 2] - oz;
   const cx = p[c] - ox, cy = p[c + 1] - oy, cz = p[c + 2] - oz;
   signedVolume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  try { expect(Math.abs(body.volume() - signedVolume / 6), source.kind).toBeLessThan(1e-9); }
  finally { body.delete(); }
 }
}, 60_000);

it('keeps cockpit rear extension bounds while its front and canopy stay fixed', () => {
 let fixedFront: number | undefined;
 for (const rearLength of [0.4, 2.7]) {
  const d = isolated(); d.cockpit.rearLength = rearLength;
  const result = compileAircraft(d), source = result.sourceMeshes!.find(p => p.kind === 'cockpit')!, shape = cockpitGeometry(d);
  expect(source.bounds.min[0]).toBeCloseTo(d.cockpit.position + shape.x - shape.xRadius, 5);
  expect(source.bounds.max[0]).toBeCloseTo(d.cockpit.position + shape.x + shape.xRadius, 5);
  if (fixedFront !== undefined) expect(source.bounds.max[0]).toBeCloseTo(fixedFront, 5);
  fixedFront = source.bounds.max[0];
  const body = solid(source);
  try {
   const y = shape.y + shape.yRadius * 0.5;
   const hits = body.rayCast([source.bounds.min[0] - 1, y, 0], [source.bounds.max[0] + 1, y, 0]);
   expect(hits.length).toBe(2);
   expect(hits[0].position[0]).toBeLessThan(d.cockpit.position - 0.15);
   expect(hits[1].position[0]).toBeGreaterThan(d.cockpit.position - 0.15);
  } finally { body.delete(); }
 }
}, 60_000);

function expectSameWingGeometry(a: CompiledAircraft, b: CompiledAircraft): void {
 const triangle = new Triangle(), point = new Vector3(), closest = new Vector3();
 type Face = { positions: Float32Array; a: number; b: number; c: number; bounds: number[] };
 const key = (part: CompiledPartition) => `${part.wingInstance},${part.side},${Math.floor((part.spanStart + 1e-8) / 0.8)},${part.movable}`;
 const compare = (from: CompiledAircraft, to: CompiledAircraft) => {
  const groups = new Map<string, Face[]>();
  for (const part of to.partitions) {
   if (part.kind !== 'wing') continue;
   const name = key(part), faces = groups.get(name) ?? []; groups.set(name, faces);
   for (let i = 0; i < part.indices.length; i += 3) {
    const a = part.indices[i] * 3, b = part.indices[i + 1] * 3, c = part.indices[i + 2] * 3, p = part.positions;
    faces.push({ positions: p, a, b, c, bounds: [Math.min(p[a], p[b], p[c]), Math.min(p[a + 1], p[b + 1], p[c + 1]), Math.min(p[a + 2], p[b + 2], p[c + 2]),
     Math.max(p[a], p[b], p[c]), Math.max(p[a + 1], p[b + 1], p[c + 1]), Math.max(p[a + 2], p[b + 2], p[c + 2])] });
   }
  }
  let deviation = 0, worst = '';
  for (const part of from.partitions) {
   if (part.kind !== 'wing') continue;
   const faces = groups.get(key(part)); expect(faces, key(part)).toBeDefined();
   for (const vertex of new Set(part.indices)) {
    const i = vertex * 3; point.fromArray(part.positions, i); let distance = Infinity;
    for (const face of faces!) {
     const box = face.bounds;
     const dx = Math.max(box[0] - point.x, point.x - box[3], 0), dy = Math.max(box[1] - point.y, point.y - box[4], 0), dz = Math.max(box[2] - point.z, point.z - box[5], 0);
     if (dx * dx + dy * dy + dz * dz > distance * distance) continue;
     triangle.a.fromArray(face.positions, face.a); triangle.b.fromArray(face.positions, face.b); triangle.c.fromArray(face.positions, face.c);
     const bx = triangle.b.x - triangle.a.x, by = triangle.b.y - triangle.a.y, bz = triangle.b.z - triangle.a.z;
     const cx = triangle.c.x - triangle.a.x, cy = triangle.c.y - triangle.a.y, cz = triangle.c.z - triangle.a.z;
     const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx, norm = nx * nx + ny * ny + nz * nz;
     if (norm) {
      const px = point.x - triangle.a.x, py = point.y - triangle.a.y, pz = point.z - triangle.a.z;
      const signed = px * nx + py * ny + pz * nz, scale = signed / norm, qx = px - scale * nx, qy = py - scale * ny, qz = pz - scale * nz;
      const u = ((qy * cz - qz * cy) * nx + (qz * cx - qx * cz) * ny + (qx * cy - qy * cx) * nz) / norm;
      const v = ((by * qz - bz * qy) * nx + (bz * qx - bx * qz) * ny + (bx * qy - by * qx) * nz) / norm;
      if (u >= 0 && v >= 0 && u + v <= 1) distance = Math.min(distance, Math.abs(signed) / Math.sqrt(norm));
     }
     for (const [a, b] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]]) {
      // Float32 Boolean output can contain collinear triangles; their edges still participate.
      const x = b.x - a.x, y = b.y - a.y, z = b.z - a.z, length = x * x + y * y + z * z;
      const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * x + (point.y - a.y) * y + (point.z - a.z) * z) / length)) : 0;
      closest.set(a.x + t * x, a.y + t * y, a.z + t * z); distance = Math.min(distance, point.distanceTo(closest));
     }
    }
    if (distance > deviation) { deviation = distance; worst = `${key(part)} vertex ${vertex} at ${point.toArray()}`; }
   }
  }
  expect(deviation, worst).toBeLessThan(3e-6);
 };
 const totals = (plane: CompiledAircraft) => plane.partitions.reduce((sum, part) => sum + part.surfaceArea, 0);
 expect(totals(a)).toBeCloseTo(totals(b), 5);
 expect(a.controls).toHaveLength(b.controls.length);
 for (const control of a.controls) {
  const other = b.controls.find(item => item.wingInstance === control.wingInstance && item.side === control.side && Math.abs(item.spanStart - control.spanStart) < 1e-8)!;
  expect(other).toBeDefined(); expect(control.areaFraction, `${control.wingInstance},${control.side},${control.spanStart}`).toBeCloseTo(other.areaFraction, 5); expect(control.area).toBeCloseTo(other.area, 5);
 }
 compare(a, b); compare(b, a);
}

it.each([0.3, 1])('matches independent full geometry mid-edit and after a canonical round trip (control fraction %s)', fraction => {
 const d = clone(presets.find(plane => !plane.birdman && plane.engine.count === 0)!);
 d.assembly.tailOnFin = false; d.mainWing.controlSurface = d.horizontalTail.controlSurface = fraction;
 const initial = compileAircraft(d), main = d.assembly.mainIncidence, tail = d.assembly.tailIncidence;
 const canonical = initial.partitions.find(part => part.wingInstance === 0 && part.spanStart >= 1.6)!;
 let previous = initial;
 const compareFull = () => {
  const diagnostics = { maxIntersectionVolume: 0, maxSurfaceDeviation: 0, minVolume: 0 };
  const full = compileAircraft(clone(d), diagnostics);
  expect(full).not.toBe(previous); expect(diagnostics.maxIntersectionVolume).toBeLessThan(1e-9);
  expectSameWingGeometry(previous, full);
 };
 for (let frame = 1; frame <= 9; frame++) {
  d.assembly.mainIncidence = main + frame * 0.5; d.assembly.tailIncidence = tail - frame * 0.5;
  const work: Record<string, number> = {};
  previous = compileAffectedAircraft(d, previous, [0, 1], work);
  expect(work.cellsReused).toBeGreaterThan(work.cellsRebuilt);
  if (frame === 3) compareFull();
 }
 d.assembly.mainIncidence = main; d.assembly.tailIncidence = tail;
 previous = compileAffectedAircraft(d, previous, [0, 1]);
 expect(previous).not.toBe(initial);
 const returned = previous.partitions.find(part => part.wingInstance === canonical.wingInstance && part.side === canonical.side && part.spanStart === canonical.spanStart && part.movable === canonical.movable)!;
 expect(returned.prototype?.positions).toBe(canonical.positions);
 compareFull();
}, 30_000);

it('invalidates the fin crown when its mounted tail changes incidence', () => {
 const d = clone(presets.find(plane => plane.name === '高性能滑翔型')!); d.assembly.tailOnFin = true;
 const before = compileAircraft(d); d.assembly.tailIncidence += 2;
 const result = compileAffectedAircraft(d, before, [1]);
 const full = compileAircraft(clone(d), { maxIntersectionVolume: 0, maxSurfaceDeviation: 0, minVolume: 0 });
 expect(result).not.toBe(full); expectSameWingGeometry(result, full);
 const previous = before.sourceMeshes!.find(source => source.wingInstance === 2)!, current = result.sourceMeshes!.find(source => source.wingInstance === 2)!;
 expect(current.positions.some((value, i) => value !== previous.positions[i])).toBe(true);
}, 30_000);

it('binds only true parent cap interfaces and covers both T-tail triangle owners', () => {
 const d = clone(presets.find(plane => plane.name === '高性能滑翔型')!);
 const result = compileAircraft(d), spans = result.attachmentSpans!, tip = Math.abs(d.verticalTail.points[1].y);
 for (const side of [-1, 1]) {
  const main = spans.find(span => span.wingInstance === 0 && span.side === side && span.anchorWingInstance === -1)!;
  expect(main.spanStart).toBe(0); expect(main.spanEnd).toBeGreaterThan(0); expect(main.spanEnd).toBeLessThanOrEqual(0.8);
  const tail = spans.find(span => span.wingInstance === 1 && span.side === side && span.anchorWingInstance === 2)!;
  expect(tail.spanStart).toBe(0); expect(tail.spanEnd).toBeGreaterThan(0);
  expect(tail.anchorSide).toBe(1); expect(tail.anchorSpan).toBe(tip);
 }
 const crown = spans.find(span => span.wingInstance === 2 && span.anchorWingInstance === 2)!;
 expect(crown.spanStart).toBeGreaterThanOrEqual(tip - 0.8); expect(crown.spanEnd).toBe(tip); expect(crown.anchorSpan).toBe(tip);
 const crossed = isolated(); crossed.assembly.mainWingHeight = 0;
 crossed.auxiliaryWings = [{ kind: 'horizontalTail', wing: clone(crossed.mainWing), position: -0.5, incidence: 20 }];
 expect(compileAircraft(crossed).attachmentSpans?.filter(span => span.wingInstance === 0 || span.wingInstance === 3)).toHaveLength(0);
}, 30_000);

it('does not weld a detached outboard body intersection back to the root', () => {
 const d = isolated(); d.cockpit.position = 0; d.assembly.mainWing = 1.8; d.assembly.mainWingHeight = 0;
 d.mainWing = wing(3.2, 0.3, 0.3, 5); d.mainWing.airfoil = 'naca0012';
 const result = compileAircraft(d), area = result.partitions.filter(part => part.wingInstance === 0).reduce((sum, part) => sum + part.surfaceArea, 0);
 expect(area).toBeLessThan(planform(d.mainWing).area - 1e-5);
 expect(result.attachmentSpans?.filter(span => span.wingInstance === 0)).toHaveLength(0);
}, 30_000);
