import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { clone, defaultAircraft, presets } from '../src/model';
import { FlightSimulation, GRAVITY } from '../src/physics';
import { challengeCollisionHeight, challengeTerrainHeight } from '../src/challenges';
import { TEST_SPACE, advanceWindTunnel, createWindTunnelMotion, defaultTestSpace, defaultWindTunnel, testCatapultSample, testSpaceLaunch, testSpaceTerrainHeight, windTunnelAttitudeFrequency, windTunnelRates } from '../src/laboratory';
import { exportReplay } from '../src/replay';
import { readBest, writeBest } from '../src/storage';

const neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0, throttle: 0 };
const powered = () => clone(presets.find(p => p.name === '低空喷气巡航型')!);

it('keeps both laboratories out of leaderboard storage even when storage is unavailable', () => {
  const access = vi.fn(() => { throw Error('blocked'); });
  vi.stubGlobal('localStorage', { getItem: access, setItem: access });
  try {
    for (const mode of ['test-space', 'wind-tunnel'] as const) {
      expect(readBest(mode)).toBe(0); expect(writeBest(100, mode)).toBe(0);
    }
    expect(access).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

describe('test space', () => {
  it('shares the 10 km terrain, 50 m beach, ocean surface and 5000 m peaks with collisions', () => {
    for (const x of [-5000, -71.3, 0, 345.6, 5000]) {
      for (const z of [-25, -10, 0, 24, 25]) expect(testSpaceTerrainHeight(x, z)).toBe(0);
      expect(testSpaceTerrainHeight(x, -5000)).toBeLessThanOrEqual(5000);
      expect(testSpaceTerrainHeight(x, -100)).toBeGreaterThan(0);
      expect(testSpaceTerrainHeight(x, 5000)).toBeLessThan(0);
      expect(challengeCollisionHeight('test-space', x, 5000)).toBe(0);
      expect(challengeTerrainHeight('test-space', x, -1900)).toBe(testSpaceTerrainHeight(x, -1900));
    }
    expect(testSpaceTerrainHeight(0, -5000)).toBe(5000);
  });
  it('forms separate mountain ridges and deep valleys across and along the mountain side', () => {
    for (const points of [
      Array.from({ length: 101 }, (_, i) => testSpaceTerrainHeight(-5000 + i * 100, -3000)),
      Array.from({ length: 49 }, (_, i) => testSpaceTerrainHeight(0, -200 - i * 100)),
    ]) {
      const peaks = points.filter((height, i) => i > 0 && i < points.length - 1 && height > points[i - 1] && height > points[i + 1]);
      expect(peaks.length).toBeGreaterThanOrEqual(2);
      expect(Math.max(...points) - Math.min(...points)).toBeGreaterThan(1500);
    }
  });
  it('moves the whole launch rail back 2 km, leaving about 7 km ahead', () => {
    const launch = testSpaceLaunch();
    expect((launch.startX + launch.endX) / 2).toBe(-2000);
    expect(TEST_SPACE.halfSize - launch.endX).toBe(6975);
    const sim = new FlightSimulation(powered(), 'test-space', 0);
    expect(sim.position.x).toBeCloseTo(launch.startX, 8);
  });
  it.each([10, 30, 50, 150])('accelerates to %i m/s at at least 1 G, coasts when needed, and releases at 50 m', speed => {
    const settings = { ...defaultTestSpace, speed }, launch = testSpaceLaunch(settings);
    expect(launch.acceleration).toBeGreaterThanOrEqual(GRAVITY);
    const duration = testCatapultSample(0, settings).duration;
    const finish = testCatapultSample(duration, settings);
    expect(finish.x).toBeCloseTo(launch.endX, 12); expect(finish.speed).toBe(speed);
    expect(testCatapultSample(duration + 10, settings)).toEqual(finish);
    const atSpeed = speed / launch.acceleration;
    if (speed <= 30) {
      expect(testCatapultSample(atSpeed + 0.1, settings).speed).toBe(speed);
      expect(testCatapultSample(atSpeed + 0.1, settings).acceleration).toBe(0);
    }
    const sim = new FlightSimulation(powered(), 'test-space', 0, settings);
    for (let frame = 0; frame < 500 && sim.launching; frame++) sim.step(neutral);
    expect(sim.launching).toBe(false); expect(sim.ended).toBe(false);
    sim.stopTest(); expect(sim.result!.takeoffSpeed).toBeCloseTo(speed, 8);
    expect(sim.result!.distance).toBeGreaterThanOrEqual(50 - 1e-8);
    expect(sim.result!.time).toBeGreaterThanOrEqual(duration - 1e-10);
    expect(sim.result!.maxG).toBeGreaterThan(1);
    expect(sim.recordingLength).toBe(0); expect(sim.recording.byteLength).toBe(0); expect(sim.wingLoads.byteLength).toBe(0);
  });
  it('moves the aircraft and platform together across the full height range, locking configuration after start', () => {
    const sim = new FlightSimulation(powered(), 'test-space', 0);
    const offset = sim.position.y - sim.testSpace.height;
    for (const height of [0, 2500, 5000]) {
      sim.configureTestSpace({ height, catapult: false, speed: 120 });
      expect(sim.launch!.y).toBe(height); expect(sim.position.y - height).toBeCloseTo(offset, 10);
      expect(sim.railAttachmentHeight).toBe(height + 2); expect(sim.railPositionX).toBe(sim.launch!.startX);
    }
    sim.step(neutral);
    expect(() => sim.configureTestSpace(defaultTestSpace)).toThrow('开始前');
  });
  it('uses real engine thrust for the disabled catapult, supports rest, and can take off from the rail', () => {
    const sim = new FlightSimulation(powered(), 'test-space', 0, { height: 300, catapult: false, speed: 150 });
    for (let i = 0; i < 60; i++) sim.step(neutral);
    expect(sim.railAttached).toBe(true); expect(sim.velocity.length()).toBe(0); expect(sim.railPositionX).toBe(sim.launch!.startX);
    for (let i = 0; i < 1200 && sim.launching; i++) sim.step({ ...neutral, throttle: 1 });
    expect(sim.launching).toBe(false); expect(sim.ended).toBe(false);
    expect(sim.telemetry.fuelRemaining).toBeLessThan(sim.definition.fuelTank.capacity);
    sim.stopTest(); expect(sim.result!.takeoffSpeed).toBeGreaterThan(0); expect(sim.result!.takeoffSpeed).toBeLessThan(150);
    expect(sim.result!.platformHeight).toBe(300);
  });
  it.each([new Vector3(5001, 1000, 100), new Vector3(0, 10001, 100), new Vector3(0, 1000, 5001)])('terminates at the cubic boundary %s', position => {
    const sim = new FlightSimulation(defaultAircraft, 'test-space', 0); sim.launching = false;
    sim.position.copy(position); sim.velocity.set(1, 0, 0); sim.step(neutral);
    expect(sim.result?.landing).toBe('boundary'); expect(sim.result?.time).toBeGreaterThan(0);
  });
  it('does not export or load laboratory replays', async () => {
    const sim = new FlightSimulation(defaultAircraft, 'test-space', 0);
    expect(() => sim.loadReplay(sim.getRecording())).toThrow('不支持回放');
    await expect(exportReplay({ definition: sim.definition, challenge: sim.challenge, recording: sim.getRecording() })).rejects.toThrow('不支持回放');
  });
});

describe('wind tunnel', () => {
  it('bounds angular speed and acceleration through startup, reversal, retargeting and settling', () => {
    const motion = createWindTunnelMotion(), actual = { ...defaultWindTunnel }, w = windTunnelAttitudeFrequency;
    let target = { ...defaultWindTunnel, roll: 180, pitch: 45 };
    const previousAcceleration = { roll: 0, pitch: 0 };
    for (let frame = 0; frame < 2400; frame++) {
      if (frame === 300) target = { ...target, roll: -180, pitch: -45 };
      if (frame === 600) target = { ...target, roll: 12, pitch: -4 };
      const dt = frame % 2 ? 1 / 120 : 1 / 40;
      advanceWindTunnel(actual, target, dt, true, motion);
      for (const key of ['roll', 'pitch'] as const) {
        const velocity = w * (motion[key].lag - actual[key]);
        const acceleration = w * w * (motion[key].command - 2 * motion[key].lag + actual[key]);
        expect(Math.abs(velocity)).toBeLessThanOrEqual(windTunnelRates[key] + 1e-6);
        expect(Math.abs(acceleration)).toBeLessThanOrEqual(2 * windTunnelRates[key] * w / Math.E + 1e-6);
        expect(Math.abs(acceleration - previousAcceleration[key])).toBeLessThanOrEqual(4 * windTunnelRates[key] * w * w * dt + 1e-4);
        previousAcceleration[key] = acceleration;
      }
      expect(Math.abs(actual.pitch)).toBeLessThanOrEqual(45 + 1e-8);
    }
    expect(actual.roll).toBe(12); expect(actual.pitch).toBe(-4);
  });
  it('gives the same attitude trajectory with split steps, including command arrival', () => {
    const a = { ...defaultWindTunnel }, b = { ...defaultWindTunnel }, ma = createWindTunnelMotion(), mb = createWindTunnelMotion();
    for (let frame = 0; frame < 240; frame++) {
      const target = { ...defaultWindTunnel, roll: frame < 120 ? 3.1 : -2.7, pitch: frame < 120 ? -1.3 : 2.1 };
      advanceWindTunnel(a, target, 1 / 60, false, ma);
      for (let i = 0; i < 2; i++) advanceWindTunnel(b, target, 1 / 120, false, mb);
      expect(a.roll).toBeCloseTo(b.roll, 10); expect(a.pitch).toBeCloseTo(b.pitch, 10);
    }
  });
  it('gently reorients a light, unreinforced aircraft without motion-induced breakup', () => {
    const definition = clone(defaultAircraft); definition.mainWing.materialAmount = 0.5;
    const sim = new FlightSimulation(definition, 'wind-tunnel', 0);
    sim.step(neutral); expect(sim.structure.fractureCount).toBe(0);
    let maximumAcceleration = 0, previous = sim.omega.clone();
    for (let frame = 0; frame < 1800; frame++) {
      if (frame === 0) sim.setWindTunnel({ ...defaultWindTunnel, roll: 30, pitch: 15 });
      if (frame === 240) sim.setWindTunnel({ ...defaultWindTunnel, roll: -30, pitch: -15 });
      if (frame === 480) sim.setWindTunnel({ ...defaultWindTunnel, roll: 0, pitch: 0 });
      sim.step(neutral);
      maximumAcceleration = Math.max(maximumAcceleration, sim.omega.clone().sub(previous).length() * 60);
      previous.copy(sim.omega);
      expect(sim.structure.fractureCount).toBe(0);
    }
    expect(sim.windTunnel.speed).toBe(0);
    expect(sim.windTunnel.roll).toBe(0); expect(sim.windTunnel.pitch).toBe(0);
    expect(sim.omega.length()).toBeLessThan(1e-6);
    expect(maximumAcceleration).toBeLessThan(0.12); // rad/s², including coupled pitch/roll
  });
  it('enters with zero flow and a 10 m/s target, and reverses ramps without jumping', () => {
    const sim = new FlightSimulation(powered(), 'wind-tunnel', 0);
    expect(defaultWindTunnel.speed).toBe(10); expect(sim.windTunnel.speed).toBe(0); expect(sim.windTunnelEnabled).toBe(false);
    for (let i = 0; i < 30; i++) sim.step(neutral);
    expect(sim.windTunnel.speed).toBe(0);
    sim.setWindTunnelEnabled(true); expect(sim.windTunnel.speed).toBe(0);
    for (let i = 0; i < 6; i++) sim.step(neutral);
    expect(sim.windTunnel.speed).toBeCloseTo(3, 10);
    sim.setWindTunnelEnabled(false); expect(sim.windTunnel.speed).toBeCloseTo(3, 10);
    sim.step(neutral); expect(sim.windTunnel.speed).toBeCloseTo(2.5, 10);
    sim.setWindTunnelEnabled(true); expect(sim.windTunnel.speed).toBeCloseTo(2.5, 10);
    for (let i = 0; i < 30; i++) sim.step(neutral);
    expect(sim.windTunnel.speed).toBe(10);
    sim.setWindTunnelEnabled(false);
    for (let i = 0; i < 30; i++) sim.step(neutral);
    expect(sim.windTunnel.speed).toBe(0); expect(sim.ended).toBe(false); expect(sim.result).toBeNull();
    expect(sim.elapsedTime).toBeCloseTo(97 / 60, 8);
  });
  it('smooths every input in both directions while fixing the body and using right-to-left airflow', () => {
    const sim = new FlightSimulation(powered(), 'wind-tunnel', 0), before = { ...sim.windTunnel };
    const target = { speed: 200, roll: 180, pitch: 45, elevator: 1, aileron: -1, rudder: 1 };
    sim.setWindTunnelEnabled(true);
    sim.setWindTunnel(target); expect(sim.windTunnel).toEqual(before);
    sim.step(neutral);
    for (const key of Object.keys(target) as (keyof typeof target)[]) {
      expect(Math.abs(sim.windTunnel[key] - before[key])).toBeLessThanOrEqual(windTunnelRates[key] / 60 + 1e-10);
      expect(sim.windTunnel[key]).not.toBe(target[key]);
    }
    expect(sim.velocity.lengthSq()).toBe(0); expect(sim.telemetry.drag.x).toBeLessThan(0);
    const current = { ...sim.windTunnel };
    sim.setWindTunnel({ speed: 1, roll: -180, pitch: -45, elevator: -1, aileron: 1, rudder: -1 }); sim.step(neutral);
    for (const key of Object.keys(target) as (keyof typeof target)[]) expect(Math.abs(sim.windTunnel[key] - current[key])).toBeLessThanOrEqual(windTunnelRates[key] / 60 + 1e-10);
    expect(sim.recording.byteLength).toBe(0); expect(sim.recordingLength).toBe(0);
  });
  it('preserves targets and angular motion when restoring during an input transition', () => {
    const sim = new FlightSimulation(powered(), 'wind-tunnel', 0), reference = new FlightSimulation(powered(), 'wind-tunnel', 0);
    const target = { speed: 25, roll: 10, pitch: 4.1, elevator: 0.2, aileron: -0.3, rudder: 0.1 };
    for (const flight of [sim, reference]) { flight.setWindTunnel(target); flight.setWindTunnelEnabled(true); }
    for (let i = 0; i < 3; i++) { sim.step(neutral); reference.step(neutral); }
    const actual = { ...sim.windTunnel }, omega = sim.omega.clone();
    sim.restoreWindTunnelAircraft();
    expect(sim.windTunnel).toEqual(actual); expect(sim.omega.equals(omega)).toBe(true);
    for (let i = 0; i < 60; i++) {
      sim.step(neutral); reference.step(neutral);
      expect(sim.windTunnel).toEqual(reference.windTunnel);
      expect(sim.omega.distanceTo(reference.omega)).toBeLessThan(1e-10);
    }
    for (let i = 0; i < 1500; i++) sim.step(neutral);
    expect(sim.windTunnel).toEqual(target);
  });
  it('keeps testing after breakup and restores the intact aircraft without resetting the running wind or clock', () => {
    const definition = powered(); definition.mainWing.materialId = 'spruce'; definition.mainWing.structure = { width: 0.03, height: 0.04, wallThickness: 0.001 };
    const sim = new FlightSimulation(definition, 'wind-tunnel', 0);
    const initialMass = sim.mass;
    sim.setWindTunnel({ ...defaultWindTunnel, speed: 200, pitch: 12, elevator: 0.8 });
    sim.setWindTunnelEnabled(true);
    for (let i = 0; i < 600; i++) sim.step(neutral);
    expect(sim.structure.fractureCount).toBeGreaterThan(0); expect(sim.fragments.length).toBeGreaterThan(0);
    expect(sim.fragments.some(f => f.position.x < -1)).toBe(true);
    expect(sim.ended).toBe(false); expect(sim.result).toBeNull();
    expect(sim.windTunnel.speed).toBe(200); expect(sim.time).toBeCloseTo(10, 8);
    const before = sim.time; sim.step(neutral); expect(sim.time).toBeGreaterThan(before);
    const actual = { ...sim.windTunnel }, time = sim.time, elapsed = sim.elapsedTime, quaternion = sim.quaternion.clone();
    sim.restoreWindTunnelAircraft();
    expect(sim.windTunnel).toEqual(actual); expect(sim.windTunnelEnabled).toBe(true);
    expect(sim.time).toBe(time); expect(sim.elapsedTime).toBe(elapsed); expect(sim.quaternion.angleTo(quaternion)).toBeLessThan(1e-7);
    expect(sim.structure.fractureCount).toBe(0); expect(sim.fragments).toHaveLength(0); expect(sim.mass).toBeCloseTo(initialMass, 8);
    expect(sim.structure.sections.every(s => s.bodyId === 0)).toBe(true);
    sim.setWindTunnelEnabled(false); sim.step(neutral);
    const slowing = { ...sim.windTunnel };
    sim.restoreWindTunnelAircraft(); expect(sim.windTunnel).toEqual(slowing); expect(sim.windTunnelEnabled).toBe(false);
    for (let i = 0; i < 450; i++) sim.step(neutral);
    expect(sim.windTunnel.speed).toBe(0); expect(sim.ended).toBe(false);
    sim.restoreWindTunnelAircraft();
    expect(sim.structure.fractureCount).toBe(0); expect(sim.fragments).toHaveLength(0);
    sim.setWindTunnelEnabled(true); sim.step(neutral); expect(sim.windTunnel.speed).toBeCloseTo(0.5, 10);
  });
  it('rejects out-of-range and non-finite live controls', () => {
    const sim = new FlightSimulation(defaultAircraft, 'wind-tunnel', 0);
    for (const invalid of [{ speed: 0 }, { speed: 201 }, { pitch: NaN }, { pitch: 45.1 }, { pitch: -45.1 }, { roll: 181 }, { rudder: Infinity }]) expect(() => sim.setWindTunnel({ ...defaultWindTunnel, ...invalid })).toThrow();
    for (const pitch of [-45, -44.9, 44.9, 45]) expect(() => sim.setWindTunnel({ ...defaultWindTunnel, pitch })).not.toThrow();
  });
  it('reports angle of attack from relative airflow while the fixture stays stationary', () => {
    const sim = new FlightSimulation(powered(), 'wind-tunnel', 0);
    sim.setWindTunnel({ ...defaultWindTunnel, pitch: 5 });
    sim.setWindTunnelEnabled(true);
    for (let i = 0; i < 30; i++) sim.step(neutral);
    expect(sim.velocity.lengthSq()).toBe(0);
    expect(sim.telemetry.alpha * 180 / Math.PI).toBeCloseTo(sim.windTunnel.pitch + sim.definition.assembly.mainIncidence, 7);
    for (let i = 0; i < 1500; i++) sim.step(neutral);
    expect(sim.windTunnel.pitch).toBe(5);
    expect(sim.telemetry.alpha * 180 / Math.PI).toBeCloseTo(5 + sim.definition.assembly.mainIncidence, 7);
    expect(sim.telemetry.sink).toBeCloseTo(0, 12);
  });
});
