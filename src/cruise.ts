import { clamp, DEG, planform, validateAircraft, type AircraftDefinition } from './model';
import { engineCatalog, engineThrustFactor } from './engines';
import { FlightSimulation, GRAVITY, PHYSICS_TICK } from './physics';

export interface CruiseReference {
  /** Actual equilibrium values. Round only when displaying percentages. */
  speed: number;
  throttle: number;
  pitch: number;
  elevator: number;
  fuelPerDistance: number;
  residual: { horizontalForce: number; verticalForce: number; pitchMoment: number };
  validation: { seconds: number; speedDrift: number; heightDrift: number; attitudeDrift: number; maximumAngularSpeed: number };
}
export interface CruiseAnalysis {
  reference: CruiseReference | null;
  reason: 'solved' | 'unpowered' | 'no-trim' | 'free-flight-drift';
  searched: { minimumSpeed: number; maximumSpeed: number; speedStep: number };
  minimumRelativeResidual: number | null;
  trimmedCandidates: number;
}

/** Full fuel, sea-level free air. Best range among attached-flow, integer-m/s trims. */
export function analyzeCruiseReference(definition: AircraftDefinition): CruiseAnalysis {
  const d = validateAircraft(definition);
  const result: CruiseAnalysis = { reference: null, reason: 'unpowered',
    searched: { minimumSpeed: 8, maximumSpeed: 120, speedStep: 1 }, minimumRelativeResidual: null, trimmedCandidates: 0 };
  if (!d.engine.count || d.fuelTank.capacity <= 0) return result;
  result.reason = 'no-trim';
  const simulation = new FlightSimulation(d, 'test-space', 0, { height: 1000, speed: 50, catapult: false });
  const weight = simulation.mass * GRAVITY, momentScale = weight * planform(d.mainWing).chord;
  const engine = engineCatalog[d.engine.type], candidates: Omit<CruiseReference, 'validation'>[] = [];
  const probe = new Float64Array(4);
  // Thrust has no propwash term. Solve its horizontal balance directly, retaining
  // vertical thrust, mount moment, and the same aeroelastic force evaluation.
  const balance = (speed: number, pitch: number, elevator: number) => {
    const unit = d.engine.count * engine.maxThrust * engineThrustFactor(0, speed * Math.cos(pitch), engine.exhaustVelocity) * Math.cos(pitch);
    let squaredThrottle = 0;
    let t = simulation.sampleSteadyFlight(speed, pitch, elevator, 0);
    for (let iteration = 0; iteration < 3 && Math.abs(t.force.x) > weight * 0.00001; iteration++) {
      squaredThrottle = clamp(squaredThrottle - t.force.x / Math.max(1, unit), 0, 1);
      t = simulation.sampleSteadyFlight(speed, pitch, elevator, Math.sqrt(squaredThrottle));
    }
    probe[0] = (t.force.y - weight) / weight;
    probe[1] = t.torque.z / momentScale;
    probe[2] = Math.sqrt(squaredThrottle);
    probe[3] = t.force.x / weight;
  };
  let previousPitch = 3 * DEG, previousElevator = 0;
  for (let speed = result.searched.minimumSpeed; speed <= result.searched.maximumSpeed; speed++) {
    let pitch = previousPitch, elevator = previousElevator;
    for (let iteration = 0; iteration < 12; iteration++) {
      balance(speed, pitch, elevator);
      const lift = probe[0], moment = probe[1], error = Math.hypot(lift, moment);
      const residual = Math.hypot(lift, moment, probe[3]);
      result.minimumRelativeResidual = Math.min(result.minimumRelativeResidual ?? Infinity, residual);
      if (error < 0.0001) break;
      const angleStep = 0.0001, controlStep = 0.001;
      balance(speed, pitch + angleStep, elevator);
      const a = (probe[0] - lift) / angleStep, c = (probe[1] - moment) / angleStep;
      const controlDirection = elevator > 0.99 ? -controlStep : controlStep;
      balance(speed, pitch, elevator + controlDirection);
      const b = (probe[0] - lift) / controlDirection, f = (probe[1] - moment) / controlDirection;
      const determinant = a * f - b * c;
      if (Math.abs(determinant) < 1e-10) break;
      const changePitch = clamp((-lift * f + b * moment) / determinant, -4 * DEG, 4 * DEG);
      const changeElevator = clamp((-a * moment + c * lift) / determinant, -0.3, 0.3);
      let accepted = false;
      for (let fraction = 1; fraction >= 1 / 16; fraction /= 2) {
        const nextPitch = clamp(pitch + fraction * changePitch, -12 * DEG, 18 * DEG);
        const nextElevator = clamp(elevator + fraction * changeElevator, -1, 1);
        balance(speed, nextPitch, nextElevator);
        if (Math.hypot(probe[0], probe[1]) >= error) continue;
        pitch = nextPitch; elevator = nextElevator; accepted = true; break;
      }
      if (!accepted) break;
    }
    balance(speed, pitch, elevator);
    if (Math.hypot(probe[0], probe[1], probe[3]) > 0.001) continue;
    if (simulation.surfaces.some(surface => {
      if (surface.kind === 'vertical') return false;
      const degrees = surface.alpha / DEG;
      const blend = clamp(degrees < -6 ? (-degrees - 6) / 29 : (Math.abs(degrees) - 17) / 18, 0, 1);
      return blend * blend * (3 - 2 * blend) > 0.1;
    })) continue;
    previousPitch = pitch; previousElevator = elevator;
    candidates.push({ speed, pitch, elevator, throttle: probe[2],
      fuelPerDistance: d.engine.count * engine.fuelFlow * probe[2] ** 2 / speed,
      residual: { horizontalForce: probe[3] * weight, verticalForce: probe[0] * weight, pitchMoment: probe[1] * momentScale } });
  }
  result.trimmedCandidates = candidates.length;
  candidates.sort((a, b) => a.fuelPerDistance - b.fuelPerDistance || a.speed - b.speed);
  if (candidates.length) result.reason = 'free-flight-drift';
  for (const candidate of candidates) {
    simulation.sampleSteadyFlight(candidate.speed, candidate.pitch, candidate.elevator, candidate.throttle);
    const orientation = simulation.quaternion.clone(), height = simulation.position.y;
    const validation = { seconds: 2, speedDrift: 0, heightDrift: 0, attitudeDrift: 0, maximumAngularSpeed: 0 };
    for (let tick = 0; tick < validation.seconds / PHYSICS_TICK; tick++) {
      simulation.step({ weight: 0, lateral: 0, aileron: 0, rudder: 0, elevator: candidate.elevator, throttle: candidate.throttle });
      validation.speedDrift = Math.max(validation.speedDrift, Math.abs(simulation.velocity.length() - candidate.speed));
      validation.heightDrift = Math.max(validation.heightDrift, Math.abs(simulation.position.y - height));
      validation.attitudeDrift = Math.max(validation.attitudeDrift, simulation.quaternion.angleTo(orientation));
      validation.maximumAngularSpeed = Math.max(validation.maximumAngularSpeed, simulation.omega.length());
      if (simulation.ended || simulation.structure.fractureCount) break;
    }
    if (simulation.ended || simulation.structure.fractureCount || validation.speedDrift > 0.5 || validation.heightDrift > 0.5
      || validation.attitudeDrift > DEG || validation.maximumAngularSpeed > 0.03) continue;
    result.reference = { ...candidate, validation }; result.reason = 'solved'; break;
  }
  return result;
}

/** UI entry point; null explicitly means no validated equilibrium in the search domain. */
export function solveCruiseReference(definition: AircraftDefinition): CruiseReference | null {
  return analyzeCruiseReference(definition).reference;
}
