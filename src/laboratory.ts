import type { AircraftDefinition } from './model';

export type LaboratoryMode = 'test-space' | 'wind-tunnel';
export const isLaboratory = (mode: string): mode is LaboratoryMode => mode === 'test-space' || mode === 'wind-tunnel';
export const TEST_SPACE = { halfSize: 5000, ceiling: 10000, mountainHeight: 5000, beachHalfWidth: 25, step: 25, railLength: 50, platformWidth: 40, railHeight: 2, platformX: -2000 } as const;
export interface TestSpaceSettings { height: number; catapult: boolean; speed: number }
export const defaultTestSpace: Readonly<TestSpaceSettings> = { height: 100, catapult: true, speed: 50 };
export function testSpaceSettings(value: TestSpaceSettings): TestSpaceSettings {
  if (!Number.isFinite(value.height) || value.height < 0 || value.height > 5000 || !Number.isFinite(value.speed) || value.speed < 10 || value.speed > 150 || typeof value.catapult !== 'boolean') throw Error('测试平台参数无效');
  return { height: value.height, catapult: value.catapult, speed: value.speed };
}
export function testSpaceLaunch(settings: TestSpaceSettings = defaultTestSpace) {
  return { kind: settings.catapult ? 'catapult' as const : 'runway' as const, startX: TEST_SPACE.platformX - 25, endX: TEST_SPACE.platformX + 25, z: 0, y: settings.height,
    width: TEST_SPACE.platformWidth, length: TEST_SPACE.railLength, slope: 0, thickness: 0.8,
    speed: settings.speed, acceleration: Math.max(9.81, settings.speed ** 2 / (2 * TEST_SPACE.railLength)) };
}
/** A minimum of 1 G until the requested speed, then unpowered coasting to the end. */
export function testCatapultSample(time: number, settings: TestSpaceSettings) {
  const launch = testSpaceLaunch(settings), accelerationTime = launch.speed / launch.acceleration;
  const accelerationDistance = launch.speed ** 2 / (2 * launch.acceleration);
  const duration = accelerationTime + (launch.length - accelerationDistance) / launch.speed;
  const t = Math.max(0, Math.min(time, duration)), accelerating = Math.min(t, accelerationTime);
  return { x: launch.startX + launch.acceleration * accelerating ** 2 / 2 + launch.speed * Math.max(0, t - accelerationTime),
    speed: Math.min(launch.speed, launch.acceleration * t), acceleration: t < accelerationTime ? launch.acceleration : 0, duration };
}
function terrainVertex(x: number, z: number) {
  if (Math.abs(z) <= TEST_SPACE.beachHalfWidth) return 0;
  if (z > 0) return -Math.min(180, (z - TEST_SPACE.beachHalfWidth) * 0.15);
  const progress = Math.min(1, (-z - TEST_SPACE.beachHalfWidth) / (TEST_SPACE.halfSize - TEST_SPACE.beachHalfWidth));
  // Intersecting, bending ridges create distinct peaks and deep valleys in both
  // horizontal directions, while the envelope meets the beach continuously.
  const ridge = (1 + Math.cos(x / 650 + 0.7 * Math.sin((z + 5000) / 500))) / 2;
  const crossRidge = (1 + Math.cos((z + 5000) / 340 + 0.45 * Math.sin(x / 900))) / 2;
  return TEST_SPACE.mountainHeight * progress ** 0.8 * (0.15 + 0.85 * ridge * crossRidge);
}
/** The rendered mesh and collision use exactly the same piecewise planar surface. */
export function testSpaceTerrainHeight(x: number, z: number) {
  const step = TEST_SPACE.step, x0 = Math.floor(x / step) * step, z0 = Math.floor(z / step) * step;
  const tx = (x - x0) / step, tz = (z - z0) / step;
  const a = terrainVertex(x0, z0 + step), b = terrainVertex(x0 + step, z0);
  if (tx + tz <= 1) { const c = terrainVertex(x0, z0); return c + (b - c) * tx + (a - c) * tz; }
  const c = terrainVertex(x0 + step, z0 + step); return c + (a - c) * (1 - tx) + (b - c) * (1 - tz);
}
export interface WindTunnelSettings { speed: number; roll: number; pitch: number; elevator: number; aileron: number; rudder: number; mainIncidence: number; tailIncidence: number }
export const defaultWindTunnel: Readonly<WindTunnelSettings> = { speed: 10, roll: 0, pitch: 0, elevator: 0, aileron: 0, rudder: 0, mainIncidence: 0, tailIncidence: 0 };
// Keep the original travel speeds; the filters below soften acceleration instead
// of slowing the entire manoeuvre. Calibrated with the balanced preset at 10 m/s.
export const windTunnelRates: Readonly<WindTunnelSettings> = { speed: 30, roll: 45, pitch: 30, elevator: 1.5, aileron: 1.5, rudder: 1.5, mainIncidence: 30, tailIncidence: 30 };
interface AttitudeMotion { command: number; lag: number; value: number }
export const windTunnelAttitudeFrequency = 1; // rad/s, two identical low-pass stages
export const createWindTunnelMotion = () => ({ roll: { command: 0, lag: 0, value: 0 }, pitch: { command: 0, lag: 0, value: 0 } });

function integrateAttitude(motion: AttitudeMotion, slope: number, time: number) {
  if (time <= 0) return;
  const w = windTunnelAttitudeFrequency, decay = Math.exp(-w * time), command = motion.command;
  const transient = motion.lag - command + slope / w;
  motion.lag = command + slope * (time - 1 / w) + transient * decay;
  motion.value = command + slope * (time - 2 / w)
    + (motion.value - command + 2 * slope / w + w * time * transient) * decay;
  motion.command += slope * time;
}

/** Exact response of two cascaded filters to a ramp, including its final stop.
 * A continuous, rate-limited command gives continuous angular velocity and
 * acceleration, even on retarget/reversal. Acceleration is bounded by 2*rate*w/e.
 */
function advanceAttitude(motion: AttitudeMotion, target: number, rate: number, dt: number) {
  const difference = target - motion.command, rampTime = Math.min(dt, Math.abs(difference) / rate);
  integrateAttitude(motion, Math.sign(difference) * rate, rampTime);
  if (rampTime < dt) { motion.command = target; integrateAttitude(motion, 0, dt - rampTime); }
  // Snap only below a microdegree, where the residual motion is negligible.
  if (Math.abs(target - motion.command) < 1e-9 && Math.abs(target - motion.lag) < 1e-6 && Math.abs(target - motion.value) < 1e-6) motion.command = motion.lag = motion.value = target;
}
export function windTunnelSettings(value: WindTunnelSettings): WindTunnelSettings {
  const limits = { speed: [1, 200], roll: [-180, 180], pitch: [-45, 45], elevator: [-1, 1], aileron: [-1, 1], rudder: [-1, 1], mainIncidence: [-10, 18], tailIncidence: [-12, 12] };
  for (const key of Object.keys(limits) as (keyof WindTunnelSettings)[]) if (!Number.isFinite(value[key]) || value[key] < limits[key][0] || value[key] > limits[key][1]) throw Error('风洞参数无效');
  return { ...value };
}
export function advanceWindTunnel(actual: WindTunnelSettings, target: WindTunnelSettings, dt: number, enabled: boolean, motion: ReturnType<typeof createWindTunnelMotion>) {
  for (const key of Object.keys(windTunnelRates) as (keyof WindTunnelSettings)[]) {
    if (key === 'roll' || key === 'pitch') {
      advanceAttitude(motion[key], target[key], windTunnelRates[key], dt); actual[key] = motion[key].value; continue;
    }
    const difference = (key === 'speed' && !enabled ? 0 : target[key]) - actual[key];
    actual[key] += Math.sign(difference) * Math.min(Math.abs(difference), windTunnelRates[key] * dt);
  }
}
/** Leave clearance for every pitch/roll attitude, including the largest editable span. */
export function windTunnelRoom(definition: AircraftDefinition) {
  const radius = Math.max(definition.fuselage.length, definition.mainWing.points[1].y, definition.horizontalTail.points[1].y, definition.verticalTail.points[1].y) + 6;
  return { halfX: Math.ceil(Math.max(20, radius)), halfY: Math.ceil(Math.max(14, radius)), halfZ: Math.ceil(Math.max(20, radius)), centerY: Math.ceil(Math.max(14, radius)) + 2 };
}
