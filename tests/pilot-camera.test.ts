import { expect, it } from 'vitest';
import { Group, Matrix4, PerspectiveCamera, Quaternion, Vector3, Vector4 } from 'three';
import { defaultAircraft } from '../src/model';
import { SceneView } from '../src/scene';

function pilotView() {
  const aircraft = new Group(), body = new Group(); aircraft.add(body);
  const camera = new PerspectiveCamera(43, 1.5, 0.1, 3000);
  camera.position.set(defaultAircraft.cockpit.position + 0.79, 0.32, 0); camera.lookAt(camera.position.clone().add(new Vector3(1, 0, 0)));
  return Object.assign(Object.create(SceneView.prototype), {
    aircraft, body, camera, definition: defaultAircraft, width: 1200, height: 800, view: 'pilot',
    simulation: { ended: false, elapsedTime: 0, mass: 100, telemetry: { force: new Vector3(0, 981, 0) } },
    hudMatrix: new Matrix4(), hudScreenMatrix: new Matrix4(), renderCG: new Vector3(),
    headOffset: new Vector3(), headInverse: new Quaternion(), headTime: 0,
    desiredPosition: new Vector3(), desiredTarget: new Vector3(), target: new Vector3(),
    vector: new Vector3(), vector2: new Vector3(), controls: { enabled: false }, followInitialized: false,
  });
}
function center(style: string) {
  const elements = style.match(/matrix3d\(([^)]+)\)/)![1].split(',').map(Number);
  const matrix = new Matrix4().fromArray(elements);
  expect(Math.abs(matrix.determinant())).toBeGreaterThan(1e-10);
  const projected = new Vector4(300, 200, 0, 1).applyMatrix4(matrix);
  return new Vector3(projected.x / projected.w, projected.y / projected.w, 0);
}

it('keeps HUD in aircraft coordinates while head turns and translates', () => {
  const view = pilotView();
  const initial = center(view.pilotHudStyle());
  expect(initial.x).toBeCloseTo(600); expect(initial.y).toBeCloseTo(400);
  view.camera.position.z += 0.04;
  const translated = center(view.pilotHudStyle()); expect(translated.x).toBeLessThan(initial.x);
  view.camera.rotateY(0.3);
  expect(center(view.pilotHudStyle()).distanceTo(initial)).toBeGreaterThan(100);
  // Aircraft + camera translation together leaves the projected instrument unchanged.
  const turned = center(view.pilotHudStyle());
  view.aircraft.position.set(200, 500, 30); view.camera.position.add(view.aircraft.position);
  expect(center(view.pilotHudStyle()).distanceTo(turned)).toBeLessThan(1e-8);
  view.camera.rotateY(Math.PI);
  expect(view.pilotHudStyle()).toBe('visibility:hidden');
});

it('responds smoothly to body loads, stays bounded and freezes with physics time', () => {
  const view = pilotView(); view.followCamera(1 / 60, true);
  expect(view.headOffset.length()).toBe(0);
  view.simulation.telemetry.force.set(0, 6000, 3000);
  for (let step = 0; step < 60; step++) {
    view.simulation.elapsedTime += 1 / 60; view.followCamera(1 / 60, true);
    expect(view.headOffset.length()).toBeLessThan(0.09);
  }
  expect(view.headOffset.y).toBeLessThan(-0.05); expect(view.headOffset.z).toBeLessThan(-0.04);
  const paused = view.camera.position.clone();
  for (let frame = 0; frame < 60; frame++) view.followCamera(1 / 60, true);
  expect(view.camera.position.toArray()).toEqual(paused.toArray());
  view.reducedMotion = true; view.followCamera(1 / 60, true);
  expect(view.headOffset.length()).toBe(0);
});
