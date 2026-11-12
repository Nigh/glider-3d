import { expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { constrainWindCamera } from '../src/wind-camera';
import { windTunnelRoom } from '../src/laboratory';
import { defaultAircraft } from '../src/model';

it('keeps actual viewport corners inside the room through zoom, pan, rotation and shifted framing', () => {
  const room = windTunnelRoom(defaultAircraft);
  for (const aspect of [0.3, 1.44, 5]) for (const direction of [[1,0,0], [0,1,0.001], [0,0,1], [1,2,3]]) for (const shifted of [false, true]) {
    const camera = new OrthographicCamera(-15 * aspect, 15 * aspect, 15, -15, 0.1, 1000);
    const target = new Vector3(0, room.centerY, 0);
    camera.position.copy(target).add(new Vector3(...direction).normalize().multiplyScalar(20));
    camera.lookAt(target);
    if (shifted) camera.setViewOffset(1440, 1000, 250, -180, 1440, 1000);
    camera.zoom = 0.001; camera.updateProjectionMatrix();
    camera.position.add(new Vector3(500, -500, 500)); target.add(new Vector3(500, -500, 500));
    const originalDirection = camera.getWorldDirection(new Vector3());
    const originalOffset = target.clone().sub(camera.position);
    const minZoom = constrainWindCamera(camera, target, room);
    expect(camera.zoom).toBeGreaterThanOrEqual(minZoom);
    expect(target.clone().sub(camera.position).distanceTo(originalOffset)).toBeLessThan(1e-10);
    expect(camera.getWorldDirection(new Vector3()).distanceTo(originalDirection)).toBeLessThan(1e-12);
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const corner = new Vector3(x, y, -1).unproject(camera);
      expect(Math.abs(corner.x)).toBeLessThanOrEqual(room.halfX - 0.49);
      expect(Math.abs(corner.y - room.centerY)).toBeLessThanOrEqual(room.halfY - 0.49);
      expect(Math.abs(corner.z)).toBeLessThanOrEqual(room.halfZ - 0.49);
    }
    const position = camera.position.clone();
    constrainWindCamera(camera, target, room);
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-10);
  }
});

it('contains a free perspective camera while preserving its look direction', () => {
  const room = windTunnelRoom(defaultAircraft), camera = new PerspectiveCamera();
  camera.position.set(-200, 300, 400);
  const target = new Vector3(0, room.centerY, 0), offset = target.clone().sub(camera.position);
  expect(constrainWindCamera(camera, target, room)).toBe(0);
  expect(Math.abs(camera.position.x)).toBeLessThan(room.halfX);
  expect(Math.abs(camera.position.y - room.centerY)).toBeLessThan(room.halfY);
  expect(Math.abs(camera.position.z)).toBeLessThan(room.halfZ);
  expect(target.clone().sub(camera.position).distanceTo(offset)).toBeLessThan(1e-10);
});
