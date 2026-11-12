import type { Quaternion } from 'three';
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
export function signedLoad(value: number): string {
 const rounded = Math.round(value * 10) / 10;
 return `${rounded < 0 ? '' : '+'}${(Object.is(rounded, -0) ? 0 : rounded).toFixed(1)}`;
}
