import { describe, expect, it } from 'vitest';
import type { Quaternion, Vector3 } from 'three';
import { clone, defaultAircraft, engineMounts, engineLateralOffsetLimits, presets, type Controls } from '../src/model';
import { engineCatalog, FUEL_DENSITY } from '../src/engines';
import { FlightSimulation } from '../src/physics';

const neutral: Controls = { weight: 0, lateral: 0, rudder: 0, elevator: 0, aileron: 0 };
const spec = engineCatalog['jet-01'];
function simulation(fuel = 1) {
  const d = clone(defaultAircraft);
  d.birdman = false; d.engine = { type: 'jet-01', count: 1, x: -1.5, y: 0.8 }; d.fuelTank.capacity = fuel;
  const s = new FlightSimulation(d, 'low-altitude', 0);
  s.position.set(40, -100, 0); s.quaternion.identity(); s.velocity.set(0, 0, 0); s.omega.set(0, 0, 0);
  return s;
}
function advance(s: FlightSimulation, throttle: number, dt: number) {
  const update = Reflect.get(s, 'updatePropulsion') as (throttle: number, dt: number) => void;
  update.call(s, throttle, dt);
  return {
    rpm: Reflect.get(s, 'engineRpm') as number,
    fuel: Reflect.get(s, 'fuelRemaining') as number,
    thrust: Reflect.get(s, 'availableThrust') as number,
  };
}
function squareIntegral(initial: number, target: number, dt: number, tau: number) {
  const delta = initial - target;
  return target ** 2 * dt + 2 * target * delta * tau * -Math.expm1(-dt / tau)
    + delta ** 2 * tau / 2 * -Math.expm1(-2 * dt / tau);
}

describe('发动机独立加减速响应', () => {
  it('升速与降速分别使用目录时间常数，降速更快且仍连续耗油、产生推力', () => {
    const up = simulation(), down = simulation(), dt = 0.6;
    Reflect.set(down, 'engineRpm', 1);
    const rising = advance(up, 1, dt), falling = advance(down, 0, dt);
    expect(rising.rpm).toBeCloseTo(1 - Math.exp(-dt / spec.spoolUpTime), 12);
    expect(falling.rpm).toBeCloseTo(Math.exp(-dt / spec.spoolDownTime), 12);
    expect(1 - falling.rpm).toBeGreaterThan(rising.rpm);
    for (const [state, initial, target, tau] of [[rising, 0, 1, spec.spoolUpTime], [falling, 1, 0, spec.spoolDownTime]] as const) {
      const integral = squareIntegral(initial, target, dt, tau);
      expect(1 - state.fuel).toBeCloseTo(spec.fuelFlow * integral, 12);
      expect(state.thrust * dt).toBeCloseTo(spec.maxThrust * integral, 10);
      expect(state.thrust).toBeGreaterThan(0);
    }
  });

  it.each([0, 1])('目标油门 %r 的转速、燃油、推力积分不依赖分段数', target => {
    const whole = simulation(), split = simulation(), initial = target === 0 ? 0.85 : 0.15, duration = 1.2;
    for (const s of [whole, split]) Reflect.set(s, 'engineRpm', initial);
    const a = advance(whole, target, duration);
    let impulse = 0, b = a;
    for (let i = 0; i < 24; i++) { b = advance(split, target, duration / 24); impulse += b.thrust * duration / 24; }
    expect(b.rpm).toBeCloseTo(a.rpm, 12); expect(b.fuel).toBeCloseTo(a.fuel, 12);
    expect(impulse).toBeCloseTo(a.thrust * duration, 10);
    expect(split.mass).toBeCloseTo(whole.mass, 10);
    expect(split.aircraft.inertia.z).toBeCloseTo(whole.aircraft.inertia.z, 10);
  });

  it('降速期间耗尽燃油只提供等比例积分推力，之后无推力且继续自由降速', () => {
    const fuel = 0.001, s = simulation(fuel), mass = s.mass, dt = 0.6;
    Reflect.set(s, 'engineRpm', 1);
    const exhausted = advance(s, 0, dt);
    expect(exhausted.fuel).toBe(0);
    expect(exhausted.thrust * dt).toBeCloseTo(spec.maxThrust * fuel / spec.fuelFlow, 10);
    expect(mass - s.mass).toBeCloseTo(fuel * FUEL_DENSITY, 10);
    const empty = advance(s, 1, dt);
    expect(empty.fuel).toBe(0); expect(empty.thrust).toBe(0);
    expect(empty.rpm).toBeCloseTo(exhausted.rpm * Math.exp(-dt / spec.spoolDownTime), 12);
  });

  it('升速与降速交替录制后逐帧重放燃油、实际转速与推力', () => {
    const source = simulation(), replay = simulation(), states: number[][] = [];
    source.reset(); replay.reset();
    for (let frame = 0; frame < 80; frame++) {
      source.step({ ...neutral, throttle: frame < 40 ? 1 : 0 });
      states.push([source.telemetry.engineRpm, source.telemetry.fuelRemaining, source.telemetry.thrust]);
    }
    replay.loadReplay(source.getRecording());
    for (const state of states) {
      replay.step(neutral);
      expect([replay.telemetry.engineRpm, replay.telemetry.fuelRemaining, replay.telemetry.thrust]).toEqual(state);
    }
    expect(replay.replayFinished).toBe(true);
  });

  it('双发侧距同步质量、惯量、阻力、接触及角速度下的推力矩', () => {
    const definition = clone(presets.find(plane => plane.engine.count === 2)!);
    definition.engine.y = 0;
    const flights = [engineLateralOffsetLimits(definition).min, 1.5].map(offset => {
      const d = clone(definition); d.engine.lateralOffset = offset;
      const s = new FlightSimulation(d, 'test-space', 0);
      const mounts = engineMounts(s.definition);
      expect(mounts.map(mount => mount.z)).toEqual([-offset, offset]);
      expect((Reflect.get(s, 'enginePositions') as typeof mounts).map(mount => mount.z)).toEqual([-offset, offset]);
      expect(s.telemetry.aerodynamics.engines.map(engine => engine.point.z)).toEqual([-offset, offset]);
      const parts = Reflect.get(s, 'parts') as { mass: number; x: number; y: number; z: number }[];
      const contacts = Reflect.get(s, 'contacts') as Vector3[];
      for (const mount of mounts) {
        expect(parts.some(part => part.mass === spec.mass && part.x === mount.x && part.y === mount.y && part.z === mount.z)).toBe(true);
        expect(contacts.some(point => Math.abs(point.x - mount.x - spec.length / 2) < 1e-8
          && Math.abs(point.y - mount.y - spec.radius) < 1e-8 && Math.abs(point.z - mount.z) < 1e-8)).toBe(true);
      }
      s.position.set(100, 1000, 0); s.velocity.set(40, 0, 0); s.omega.set(0, 1, 0); s.quaternion.identity();
      Reflect.set(s, 'seaLevelReference', true);
      const evaluate = Reflect.get(s, 'evaluateForces') as (input: Controls, velocity: Vector3, omega: Vector3, orientation: Quaternion, position: Vector3) => void;
      Reflect.set(s, 'availableThrust', 0);
      evaluate.call(s, neutral, s.velocity, s.omega, s.quaternion, s.position);
      const unpoweredYaw = s.telemetry.torque.y;
      Reflect.set(s, 'availableThrust', spec.maxThrust * 2);
      evaluate.call(s, neutral, s.velocity, s.omega, s.quaternion, s.position);
      expect(s.telemetry.torque.y - unpoweredYaw).toBeCloseTo(-2 * spec.maxThrust * offset ** 2 / spec.exhaustVelocity, 8);
      return s;
    });
    expect(flights[1].mass).toBeGreaterThan(flights[0].mass);
    expect(flights[1].aircraft.inertia.x).toBeGreaterThan(flights[0].aircraft.inertia.x);
    expect(flights[1].aircraft.inertia.y).toBeGreaterThan(flights[0].aircraft.inertia.y);
    expect(flights[1].telemetry.aerodynamics.engines[0].supportArea).toBeGreaterThan(flights[0].telemetry.aerodynamics.engines[0].supportArea);
  });
});
