import { clamp, type Controls } from './model';

type Components = { x: number; y: number; z: number };
export interface MixingSurface {
  bodyId: number;
  controlEffectiveness: number;
  controlAxes: { roll: boolean; pitch: boolean; yaw: boolean };
  controlResponse: number;
  controlReversed: boolean;
  /** Unit moment-arm projection: x roll, y negative yaw, z negative pitch. */
  controlProjection: Components;
  /** Local aerodynamic torque derivative per normalized physical deflection. */
  controlMoment: Components;
  controlCandidate: number;
}

/** Bounded least squares in actual torque units. No inverse exists for a missing axis. */
export function mixControlSurfaces(surfaces: readonly MixingSurface[], controls: Controls, smart: boolean) {
  let targetX = 0, targetY = 0, targetZ = 0;
  let actualX = 0, actualY = 0, actualZ = 0;
  for (const surface of surfaces) {
    const axes = surface.controlAxes, p = surface.controlProjection, m = surface.controlMoment;
    if (surface.bodyId !== 0 || surface.controlEffectiveness === 0 || surface.controlResponse === 0
      || !smart && !axes.roll && !axes.pitch && !axes.yaw) {
      surface.controlCandidate = 0;
      continue;
    }
    const response = surface.controlResponse;
    const roll = smart || axes.roll ? controls.aileron * p.x : 0;
    const pitch = smart || axes.pitch ? -controls.elevator * p.z : 0;
    const yaw = smart || axes.yaw ? -controls.rudder * p.y : 0;
    surface.controlCandidate = clamp(roll + pitch + yaw, -1, 1);
    if (smart) {
      // Smart mode owns all installed actuators. Cross-axis torque is an error.
      targetX += m.x * roll * response;
      targetY += m.y * yaw * response;
      targetZ += m.z * pitch * response;
      actualX += m.x * surface.controlCandidate * response;
      actualY += m.y * surface.controlCandidate * response;
      actualZ += m.z * surface.controlCandidate * response;
    }
  }
  if (smart) {
    let errorX = targetX - actualX, errorY = targetY - actualY, errorZ = targetZ - actualZ;
    // ponytail: three-axis box-constrained coordinate descent; bounded sweeps
    // avoid a general optimizer. Replace only if larger actuator sets need it.
    for (let iteration = 0; iteration < 64; iteration++) {
      let largestChange = 0;
      for (const surface of surfaces) {
        if (surface.bodyId !== 0 || surface.controlEffectiveness === 0 || surface.controlResponse === 0) continue;
        const m = surface.controlMoment, response = surface.controlResponse;
        const x = m.x * response, y = m.y * response, z = m.z * response;
        const norm = x * x + y * y + z * z;
        if (norm < 1e-16) continue;
        const previous = surface.controlCandidate;
        const next = clamp(previous + (x * errorX + y * errorY + z * errorZ) / norm, -1, 1);
        const change = next - previous;
        surface.controlCandidate = next;
        errorX -= x * change; errorY -= y * change; errorZ -= z * change;
        largestChange = Math.max(largestChange, Math.abs(change));
      }
      if (largestChange < 1e-8) break;
    }
  }
  // User calibration is deliberately applied after mixing. Reversal remains
  // a physical reversal; allocation must not silently cancel that setting.
  for (const surface of surfaces) if (surface.controlCandidate !== 0) {
    surface.controlCandidate *= surface.controlResponse * (surface.controlReversed ? -1 : 1);
  }
}
