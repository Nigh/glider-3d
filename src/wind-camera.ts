import { Camera, OrthographicCamera, Vector3 } from 'three';
import type { windTunnelRoom } from './laboratory';

const corner = new Vector3(), forward = new Vector3(), extent = new Vector3(), shift = new Vector3();
/** Keep every orthographic ray origin inside the closed room. Limiting only
 * the camera centre leaves the viewport corners outside when zooming out. */
export function constrainWindCamera(camera: Camera, target: Vector3, room: ReturnType<typeof windTunnelRoom>): number {
  camera.updateMatrixWorld();
  forward.setFromMatrixColumn(camera.matrixWorld, 2);
  const margin = 0.55;
  let minZoom = 0;
  extent.set(0, 0, 0);
  if (camera instanceof OrthographicCamera) {
    // Read the actual projection: workshop/panel framing can shift its centre
    // with setViewOffset, so left/right/top/bottom alone are insufficient.
    for (let x = -1; x <= 1; x += 2) for (let y = -1; y <= 1; y += 2) {
      corner.set(x, y, -1).applyMatrix4(camera.projectionMatrixInverse);
      corner.set(corner.x * camera.zoom, corner.y * camera.zoom, 0).applyQuaternion(camera.quaternion);
      for (let axis = 0; axis < 3; axis++) extent.setComponent(axis, Math.max(extent.getComponent(axis), Math.abs(corner.getComponent(axis))));
    }
    for (let axis = 0; axis < 3; axis++) {
      const projected = extent.getComponent(axis);
      const halfRoom = axis === 0 ? room.halfX : axis === 1 ? room.halfY : room.halfZ;
      minZoom = Math.max(minZoom, projected / (halfRoom - margin - Math.abs(forward.getComponent(axis)) * camera.near));
      extent.setComponent(axis, projected);
    }
    if (camera.zoom < minZoom) { camera.zoom = minZoom; camera.updateProjectionMatrix(); }
    extent.divideScalar(camera.zoom).addScaledVector(forward.set(Math.abs(forward.x), Math.abs(forward.y), Math.abs(forward.z)), camera.near);
  }
  shift.copy(camera.position);
  for (let axis = 0; axis < 3; axis++) {
    const halfRoom = axis === 0 ? room.halfX : axis === 1 ? room.halfY : room.halfZ;
    const center = axis === 1 ? room.centerY : 0, limit = Math.max(0, halfRoom - margin - extent.getComponent(axis));
    camera.position.setComponent(axis, Math.max(center - limit, Math.min(center + limit, camera.position.getComponent(axis))));
  }
  shift.sub(camera.position);
  target.sub(shift);
  camera.updateMatrixWorld();
  return minZoom;
}
