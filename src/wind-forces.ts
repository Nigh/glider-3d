import { ConeGeometry, CylinderGeometry, DynamicDrawUsage, Group, Mesh, MeshBasicMaterial, Sphere, TorusGeometry, Vector3, type BufferAttribute, type Object3D, type Quaternion } from 'three';
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

export const MOMENT_AXES = [
 { name: '滚转力矩', color: '#e18349' },
 { name: '偏航力矩', color: '#3bada1' },
 { name: '俯仰力矩', color: '#8468bd' },
] as const;
const MOMENT_SEGMENTS = 24, MOMENT_TUBE_SEGMENTS = 6;

/** Unit-radius body-axis arcs: roll above CG; yaw and pitch ahead of CG. */
export function solidMomentArrow(axis: number): Group {
 const group = new Group();
 const material = new MeshBasicMaterial({ color: MOMENT_AXES[axis].color, depthTest: false, depthWrite: false, toneMapped: false });
 const geometry = new TorusGeometry(1, 0.012, MOMENT_TUBE_SEGMENTS, MOMENT_SEGMENTS, Math.PI / 3);
 (geometry.getAttribute('position') as BufferAttribute).setUsage(DynamicDrawUsage);
 geometry.boundingSphere = new Sphere(new Vector3(), 1.02);
 const arc = new Mesh(geometry, material);
 const head = new Mesh(new ConeGeometry(0.045, 0.1, 12), material);
 group.add(arc, head);
 if (axis === 0) {
  group.rotation.y = Math.PI / 2;
  group.rotateZ(Math.PI / 2);
 } else if (axis === 1) group.rotation.x = -Math.PI / 2;
 group.userData.momentAxis = axis;
 group.visible = false;
 return group;
}

/** Fixed 100 N·m full scale; 10–60° arcs, independent of other axes. */
export function updateMomentArrow(arrow: Group, value: number): void {
 arrow.visible = Math.abs(value) >= 0.05;
 if (arrow.userData.value === value) return;
 arrow.userData.value = value;
 const degrees = 10 + 50 * Math.min(Math.abs(value) / 100, 1);
 arrow.userData.arcDegrees = degrees;
 if (!arrow.visible) return;
 const sign = Math.sign(value), angle = degrees * Math.PI / 180, start = -angle / 2;
 const arc = arrow.children[0] as Mesh<TorusGeometry>, head = arrow.children[1];
 const positions = arc.geometry.getAttribute('position');
 for (let i = 0; i <= MOMENT_SEGMENTS; i++) {
  const theta = start + angle * i / MOMENT_SEGMENTS;
  const x = Math.cos(theta), y = Math.sin(theta);
  for (let j = 0; j <= MOMENT_TUBE_SEGMENTS; j++) {
   const tube = j / MOMENT_TUBE_SEGMENTS * Math.PI * 2, radius = 1 + 0.012 * Math.cos(tube);
   positions.setXYZ(j * (MOMENT_SEGMENTS + 1) + i, radius * x, radius * y, 0.012 * Math.sin(tube));
  }
 }
 positions.needsUpdate = true;
 const end = sign * angle / 2;
 head.position.set(Math.cos(end) + sign * Math.sin(end) * 0.05, Math.sin(end) - sign * Math.cos(end) * 0.05, 0);
 head.rotation.z = end + (sign < 0 ? Math.PI : 0);
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
