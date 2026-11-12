import { describe, expect, it } from 'vitest';
import { ArrowHelper, BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import { clone, defaultAircraft } from '../src/model';
import { FlightSimulation, GRAVITY } from '../src/physics';
import { defaultWindTunnel } from '../src/laboratory';
import { cgGeometryRadius, loadMagnitude, momentDirection, solidForceArrow, solidMomentArrow, windForceSnapshot } from '../src/wind-forces';
import { SceneView } from '../src/scene';

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

 it('formats moments as direction plus unsigned magnitude without negative zero', () => {
  expect(loadMagnitude(12.34)).toBe('12.3'); expect(loadMagnitude(-12.34)).toBe('12.3');
  expect(loadMagnitude(-0.001)).toBe('0.0');
  expect([0, 1, 2].map(axis => momentDirection(axis, 1))).toEqual(['右翼下', '左偏', '抬头']);
  expect([0, 1, 2].map(axis => momentDirection(axis, -1))).toEqual(['右翼上', '右偏', '低头']);
  expect(momentDirection(0, 0)).toBe('零力矩');
 });
});

describe('solid load geometry', () => {
 it('uses real drawn vertices, hidden parts and current transforms rather than AABB corners', () => {
  const root = new Group(), geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([3, 0, 0, 0, 4, 0, 0, 0, 100]), 3));
  geometry.setIndex([0, 1]);
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  root.add(mesh);
  const hidden = new Mesh(geometry, mesh.material);
  hidden.position.x = 100; hidden.visible = false; root.add(hidden);
  root.updateWorldMatrix(true, true);
  expect(cgGeometryRadius(root, new Vector3(), new Vector3())).toBe(4);
  mesh.position.x = 1; root.updateWorldMatrix(true, true);
  expect(cgGeometryRadius(root, new Vector3(1, 0, 0), new Vector3())).toBe(4);
  geometry.attributes.position.setXYZ(1, 0, 6, 0);
  expect(cgGeometryRadius(root, new Vector3(1, 0, 0), new Vector3())).toBe(6);
 });

 it.each([1, -1])('keeps torque tip tangent right-handed for sign %s on every body axis', sign => {
  for (let axis = 0; axis < 3; axis++) {
   const arrow = solidMomentArrow(), normal = new Vector3().setComponent(axis, sign);
   arrow.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
   const head = arrow.children[1];
   const radial = head.position.clone().applyQuaternion(arrow.quaternion);
   const tangent = new Vector3(0, 1, 0).applyQuaternion(head.quaternion).applyQuaternion(arrow.quaternion);
   expect(radial.length()).toBeCloseTo(1, 12);
   expect(new Vector3().crossVectors(radial, tangent).dot(normal)).toBeCloseTo(1, 12);
  }
 });

 it('places lift/drag at real centers, preserves auxiliary lift, and draws net loads from CG', () => {
  const sim = new FlightSimulation(defaultAircraft, 'wind-tunnel', 0);
  sim.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
  sim.telemetry.aerodynamics.liftCenter = new Vector3(1, 2, 3);
  sim.telemetry.aerodynamics.dragCenter = new Vector3(-2, 1, 0);
  sim.telemetry.aerodynamics.lift.set(0, 100, 0);
  sim.telemetry.aerodynamics.drag.set(-20, 0, 0);
  sim.telemetry.force.set(40, 50, 60); sim.telemetry.torque.set(-1, 2, -3);
  const body = new Group();
  body.add(new Mesh(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([4, 0, 0]), 3)), new MeshBasicMaterial()));
  const aircraft = new Group(); aircraft.position.set(10, 20, 30); aircraft.quaternion.copy(sim.quaternion);
  aircraft.add(body); body.position.copy(sim.telemetry.cg).negate();
  const arrows = Array.from({ length: sim.surfaces.length + 4 }, () => new ArrowHelper());
  const view = Object.assign(Object.create(SceneView.prototype), {
   simulation: sim, debug: true, cg: new Group(), aircraft, body, renderCG: sim.telemetry.cg.clone(),
   arrows, applicationMarkers: sim.surfaces.map(() => new Mesh()), fragments: [],
   vector: new Vector3(), vector2: new Vector3(), loadScratch: new Vector3(), headInverse: new Quaternion(),
   netForceArrow: solidForceArrow(), netMomentFrame: new Group(), netMomentArrow: solidMomentArrow(), momentNormal: new Vector3(0, 0, 1),
  });
  const tail = sim.surfaces.findIndex(surface => surface.kind === 'tail');
  sim.surfaces[tail].force.set(0, 10, 0); sim.surfaces[tail].drag.set(0, 0, 0);
  view.updateDebug();
  for (const [index, center] of [sim.telemetry.aerodynamics.liftCenter, sim.telemetry.aerodynamics.dragCenter].entries()) {
   const expected = center.clone().sub(view.renderCG).applyQuaternion(aircraft.quaternion).add(aircraft.position);
   expect(arrows[index].position.distanceTo(expected)).toBeLessThan(1e-10);
  }
  expect(arrows[tail + 4].visible).toBe(true);
  expect(view.netForceArrow.position.equals(aircraft.position)).toBe(true);
  const expectedForce = sim.telemetry.force.clone().add(new Vector3(0, -GRAVITY * sim.telemetry.mass, 0)).normalize();
  expect(new Vector3(0, 1, 0).applyQuaternion(view.netForceArrow.quaternion).distanceTo(expectedForce)).toBeLessThan(1e-10);
  expect(view.netMomentArrow.scale.x).toBeCloseTo(1.2 * new Vector3(4, 0, 0).sub(view.renderCG).length(), 10);
  expect(view.netMomentFrame.quaternion.equals(aircraft.quaternion)).toBe(true);
  sim.telemetry.force.set(0, GRAVITY * sim.telemetry.mass, 0); sim.telemetry.torque.set(0, 0, 0);
  sim.telemetry.aerodynamics.liftCenter = sim.telemetry.aerodynamics.dragCenter = null;
  view.updateDebug();
  expect(view.netForceArrow.visible).toBe(false); expect(view.netMomentArrow.visible).toBe(false);
  expect(arrows[0].visible).toBe(false); expect(arrows[1].visible).toBe(false);
 });

 it('reaches solid arrows through the real pointer raycast and clears hover when leaving', () => {
  const arrow = solidForceArrow(); arrow.visible = true;
  const camera = new PerspectiveCamera(45, 1, 0.1, 100); camera.position.set(0, 0.5, 5); camera.updateMatrixWorld();
  const canvas = { title: '', style: { cursor: '' }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), removeAttribute() { this.title = ''; } };
  const view = Object.assign(Object.create(SceneView.prototype), {
   debug: true, cameraDragging: false, renderer: { domElement: canvas }, camera,
   simulation: { quaternion: new Quaternion(), telemetry: { force: new Vector3(), torque: new Vector3(), mass: 1 } },
   partPointer: new Vector2(), partRay: new Raycaster(), partHits: [], loadPickObjects: [arrow],
   netForceArrow: arrow, vector: new Vector3(), headInverse: new Quaternion(),
  });
  view.hoverLoads({ clientX: 50, clientY: 50 });
  expect(canvas.title).toContain('N'); expect(canvas.style.cursor).toBe('help');
  view.hoverLoads({ clientX: 0, clientY: 0 });
  expect(canvas.title).toBe('');
 });
});
