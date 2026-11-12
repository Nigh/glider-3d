import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, TorusGeometry, Vector3, type Object3D, type Quaternion } from 'three';
import type { FlightTelemetry } from './physics';
import { GRAVITY } from './physics';

export interface WindForceSnapshot {
 force: [number, number, number];
 moment: [number, number, number];
}

/** Current attached body only. Both vectors use body axes about its current CG.
 * Force includes weight but excludes fixture reactions; gravity adds no CG moment.
 * Copy components: physics mutates telemetry vectors on subsequent ticks.
 */
export function windForceSnapshot(telemetry: Pick<FlightTelemetry, 'force' | 'torque' | 'mass'>, orientation: Quaternion): WindForceSnapshot {
 const { force, torque, mass } = telemetry;
 const x = force.x, y = force.y - mass * GRAVITY, z = force.z;
 // Rotate world force by the inverse unit quaternion without temporary Three objects.
 const qx = -orientation.x, qy = -orientation.y, qz = -orientation.z, qw = orientation.w;
 const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
 return {
  force: [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx],
  moment: [torque.x, torque.y, torque.z],
 };
}
export function loadMagnitude(value: number): string {
 return Math.abs(value).toFixed(1);
}

export function momentDirection(axis: number, value: number): string {
 if (Math.abs(value) < 0.05) return '零力矩';
 return (value > 0 ? ['右翼下', '左偏', '抬头'] : ['右翼上', '右偏', '低头'])[axis];
}

/** Local +Y arrow; meshes stay solid and can be picked with the scene raycaster. */
export function solidForceArrow(): Group {
 const group = new Group();
 const material = new MeshBasicMaterial({ color: 0xffcf32, depthTest: false, depthWrite: false, toneMapped: false });
 const shaft = new Mesh(new CylinderGeometry(0.045, 0.045, 1, 8), material);
 shaft.position.y = 0.5;
 const head = new Mesh(new ConeGeometry(0.15, 0.32, 12), material);
 head.position.y = 1;
 group.add(shaft, head);
 group.visible = false;
 return group;
}

/** Local +Z right-hand rotation. Tip follows the increasing-angle arc tangent. */
export function solidMomentArrow(): Group {
 const group = new Group();
 const material = new MeshBasicMaterial({ color: 0xe18349, depthTest: false, depthWrite: false, toneMapped: false });
 const angle = Math.PI * 1.5;
 const arc = new Mesh(new TorusGeometry(1, 0.012, 8, 64, angle), material);
 const head = new Mesh(new ConeGeometry(0.045, 0.1, 12), material);
 head.position.set(Math.cos(angle), Math.sin(angle), 0);
 head.rotation.z = angle;
 group.add(arc, head);
 group.visible = false;
 return group;
}

/** Exact drawn-vertex radius about a fixed world-space CG, not an AABB diagonal.
 * Call after updating world matrices. Scratch vector and geometry buffers are reused.
 */
export function cgGeometryRadius(object: Object3D, cg: Vector3, scratch: Vector3, root = true): number {
 if ((!root && !object.visible) || object.userData.excludeLoadEnvelope) return 0;
 let squared = 0;
 if (object instanceof Mesh) {
  const geometry = object.geometry, position = geometry.getAttribute('position'), index = geometry.index;
  if (position) {
   const start = geometry.drawRange.start;
   const end = Math.min(index?.count ?? position.count, start + geometry.drawRange.count);
   for (let i = start; i < end; i++) {
    scratch.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(object.matrixWorld);
    squared = Math.max(squared, scratch.distanceToSquared(cg));
   }
  }
 }
 for (const child of object.children) {
  const radius = cgGeometryRadius(child, cg, scratch, false);
  squared = Math.max(squared, radius * radius);
 }
 return Math.sqrt(squared);
}
