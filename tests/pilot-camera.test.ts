import { expect, it } from 'vitest';
import { Group, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { defaultAircraft } from '../src/model';
import { SceneView } from '../src/scene';

function pilotView() {
  const aircraft = new Group(), body = new Group(); aircraft.add(body);
  const camera = new PerspectiveCamera(43, 1.5, 0.1, 3000);
  camera.position.set(defaultAircraft.cockpit.position + 0.79, 0.32, 0); camera.lookAt(camera.position.clone().add(new Vector3(1, 0, 0)));
  return Object.assign(Object.create(SceneView.prototype), {
    aircraft, body, camera, definition: defaultAircraft, width: 1200, height: 800, view: 'pilot',
    simulation: { ended: false, elapsedTime: 0, mass: 100, telemetry: { force: new Vector3(0, 981, 0) } },
    hudMatrix: new Matrix4(), renderCG: new Vector3(),
    headOffset: new Vector3(), headInverse: new Quaternion(), headTime: 0,
    desiredPosition: new Vector3(), desiredTarget: new Vector3(), target: new Vector3(),
    vector: new Vector3(), vector2: new Vector3(), controls: { enabled: false }, followInitialized: false,
    followPosition: new Vector3(), followTarget: new Vector3(),
    cameraYaw: 0, cameraPitch: 0,
  });
}
function affine(transform: string): number[] {
  return transform.slice(7, -1).split(' ').map(Number);
}
function anchor(transform: string) {
  const matrix = affine(transform);
  return new Vector3(matrix[4], matrix[5], 0);
}
function panelPoint(view: { body: Group; camera: PerspectiveCamera; width: number; height: number }, x: number, y: number) {
  const projected = new Vector3(defaultAircraft.cockpit.position + 2.79, 0.72-y*0.002, -0.6+x*0.002)
    .applyMatrix4(view.body.matrixWorld).project(view.camera);
  return new Vector3((1+projected.x)*view.width/2, (1-projected.y)*view.height/2, 0);
}

it('keeps HUD in aircraft coordinates while head turns and translates', () => {
  const view = pilotView();
  const initial = anchor(view.pilotHud(0, 0).clearance);
  expect(initial.distanceTo(panelPoint(view, 300, 352))).toBeLessThan(1e-8);
  expect(initial.x).toBeCloseTo(600);
  view.camera.position.z += 0.04;
  const translated = anchor(view.pilotHud(0, 0).clearance); expect(translated.x).toBeLessThan(initial.x);
  view.camera.rotateY(0.3);
  const turned = anchor(view.pilotHud(0, 0).clearance);
  expect(turned.distanceTo(initial)).toBeGreaterThan(100);
  // Aircraft + camera translation together leaves the projected instrument unchanged.
  view.aircraft.position.set(200, 500, 30); view.camera.position.add(view.aircraft.position);
  expect(anchor(view.pilotHud(0, 0).clearance).distanceTo(turned)).toBeLessThan(1e-8);
  view.camera.rotateY(Math.PI);
  expect(view.pilotHud(0, 0)).toBeNull();
});

it('locked view adds brief tracking lag, a bounded load-sensitive HUD and limited look offsets', () => {
  const view = pilotView(); view.view = 'locked'; view.camera.up.set(0, 1, 0);
  view.followCamera(1 / 60, true);
  const start = view.camera.position.clone();
  view.aircraft.position.x += 12;
  view.followCamera(1 / 60, false);
  expect(view.camera.position.x).toBeGreaterThan(start.x);
  expect(view.camera.position.x).toBeLessThan(start.x + 12);
  for (let frame = 0; frame < 60; frame++) view.followCamera(1 / 60, false);
  expect(view.camera.position.x).toBeCloseTo(start.x + 12, 3);
  const neutral = view.pilotHud(0, 0);
  expect(neutral).not.toBeNull();
  // Supported/impact loads are not present in the aerodynamic force alone.
  view.simulation.telemetry.specificForce = new Vector3(100, 200, -100);
  for (let frame = 0; frame < 60; frame++) { view.simulation.elapsedTime += 1 / 60; view.followCamera(1 / 60, false); }
  const loaded = view.pilotHud(0, 0);
  expect(loaded.marker).not.toBe(neutral.marker);
  expect(anchor(loaded.speed).distanceTo(anchor(neutral.speed))).toBeGreaterThan(1);
  expect(anchor(loaded.speed).distanceTo(anchor(neutral.speed))).toBeLessThan(25);
  view.lookInput(100, 100, 1);
  expect(Math.abs(view.cameraYaw)).toBeLessThanOrEqual(0.18);
  expect(Math.abs(view.cameraPitch)).toBeLessThanOrEqual(0.12);
  const frozen = view.headOffset.clone();
  view.followCamera(1 / 60, false);
  expect(view.headOffset.toArray()).toEqual(frozen.toArray());
  view.reducedMotion = true; view.followCamera(1 / 60, false);
  expect(view.headOffset.length()).toBe(0);
});


it('clips rotated pitch lines to the panel before projection, including extreme attitudes', () => {
  const view = pilotView(), initial = view.pilotHud(0, 0);
  for (const [pitch, roll] of [[0,0], [78,133], [-82,-157], [180,0]]) {
    const frame = view.pilotHud(pitch, roll);
    const clip = frame.clip.split(/[ ,]+/).map(Number), xs = clip.filter((_: number, i: number) => i%2 === 0), ys = clip.filter((_: number, i: number) => i%2 === 1);
    const points = (frame.ladder+frame.dashedLadder).match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
    for (let i = 0; i < points.length; i += 2) {
      expect(Number.isFinite(points[i]) && Number.isFinite(points[i+1])).toBe(true);
      expect(points[i]).toBeGreaterThanOrEqual(Math.min(...xs)-1e-8); expect(points[i]).toBeLessThanOrEqual(Math.max(...xs)+1e-8);
      expect(points[i+1]).toBeGreaterThanOrEqual(Math.min(...ys)-1e-8); expect(points[i+1]).toBeLessThanOrEqual(Math.max(...ys)+1e-8);
    }
    expect(frame.marker).toBe(initial.marker);
  }
  expect(view.pilotHud(0, 0).ladder).not.toBe(view.pilotHud(20, 35).ladder);
});

it('hides HUD outside pilot view, at the near plane and after flight termination', () => {
  const view = pilotView();
  view.view = 'chase'; expect(view.pilotHud(0, 0)).toBeNull();
  view.view = 'pilot'; view.simulation.ended = true; expect(view.pilotHud(0, 0)).toBeNull();
  view.simulation.ended = false; view.camera.position.x += 1.95;
  expect(view.pilotHud(0, 0)).toBeNull();
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
