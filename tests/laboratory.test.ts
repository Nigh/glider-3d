import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { clone, defaultAircraft, presets } from '../src/model';
import { FlightSimulation, GRAVITY } from '../src/physics';
import { challengeCollisionHeight, challengeTerrainHeight } from '../src/challenges';
import { defaultTestSpace, defaultWindTunnel, testCatapultSample, testSpaceLaunch, testSpaceTerrainHeight, windTunnelRates } from '../src/laboratory';
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
      expect(testSpaceTerrainHeight(x, -5000)).toBeCloseTo(5000, 8);
      expect(testSpaceTerrainHeight(x, -100)).toBeGreaterThan(0);
      expect(testSpaceTerrainHeight(x, 5000)).toBeLessThan(0);
      expect(challengeCollisionHeight('test-space', x, 5000)).toBe(0);
      expect(challengeTerrainHeight('test-space', x, -1900)).toBe(testSpaceTerrainHeight(x, -1900));
    }
  });
  it.each([10, 30, 50, 150])('accelerates to %i m/s at at least 1 G, coasts when needed, and releases at 50 m', speed => {
    const settings = { ...defaultTestSpace, speed }, launch = testSpaceLaunch(settings);
    expect(launch.acceleration).toBeGreaterThanOrEqual(GRAVITY);
    const duration = testCatapultSample(0, settings).duration;
    const finish = testCatapultSample(duration, settings);
    expect(finish.x).toBeCloseTo(25, 12); expect(finish.speed).toBe(speed);
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
      expect(sim.railAttachmentHeight).toBe(height + 2); expect(sim.railPositionX).toBe(-25);
    }
    sim.step(neutral);
    expect(() => sim.configureTestSpace(defaultTestSpace)).toThrow('开始前');
  });
  it('uses real engine thrust for the disabled catapult, supports rest, and can take off from the rail', () => {
    const sim = new FlightSimulation(powered(), 'test-space', 0, { height: 300, catapult: false, speed: 150 });
    for (let i = 0; i < 60; i++) sim.step(neutral);
    expect(sim.railAttached).toBe(true); expect(sim.velocity.length()).toBe(0); expect(sim.railPositionX).toBe(-25);
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
  it('smooths every input in both directions while fixing the body and using right-to-left airflow', () => {
    const sim = new FlightSimulation(powered(), 'wind-tunnel', 0), before = { ...sim.windTunnel };
    const target = { speed: 200, roll: 180, pitch: 90, elevator: 1, aileron: -1, rudder: 1 };
    sim.setWindTunnel(target); expect(sim.windTunnel).toEqual(before);
    sim.step(neutral);
    for (const key of Object.keys(target) as (keyof typeof target)[]) {
      expect(Math.abs(sim.windTunnel[key] - before[key])).toBeLessThanOrEqual(windTunnelRates[key] / 60 + 1e-10);
      expect(sim.windTunnel[key]).not.toBe(target[key]);
    }
    expect(sim.velocity.lengthSq()).toBe(0); expect(sim.telemetry.drag.x).toBeLessThan(0);
    const current = { ...sim.windTunnel };
    sim.setWindTunnel({ speed: 1, roll: -180, pitch: -90, elevator: -1, aileron: 1, rudder: -1 }); sim.step(neutral);
    for (const key of Object.keys(target) as (keyof typeof target)[]) expect(Math.abs(sim.windTunnel[key] - current[key])).toBeLessThanOrEqual(windTunnelRates[key] / 60 + 1e-10);
    expect(sim.recording.byteLength).toBe(0); expect(sim.recordingLength).toBe(0);
  });
  it('keeps testing after aerodynamic breakup, simulates debris in the airflow, and ends only on manual stop', () => {
    const definition = powered(); definition.mainWing.materialId = 'spruce'; definition.mainWing.structure = { width: 0.03, height: 0.04, wallThickness: 0.001 };
    const sim = new FlightSimulation(definition, 'wind-tunnel', 0);
    sim.setWindTunnel({ ...defaultWindTunnel, speed: 200, pitch: 12, elevator: 0.8 });
    for (let i = 0; i < 600; i++) sim.step(neutral);
    expect(sim.structure.fractureCount).toBeGreaterThan(0); expect(sim.fragments.length).toBeGreaterThan(0);
    expect(sim.fragments.some(f => f.position.x < -1)).toBe(true);
    expect(sim.ended).toBe(false); expect(sim.result).toBeNull();
    expect(sim.windTunnel.speed).toBe(200); expect(sim.time).toBeCloseTo(10, 8);
    const before = sim.time; sim.step(neutral); expect(sim.time).toBeGreaterThan(before);
    sim.stopTest(); expect(sim.result?.landing).toBe('manual');
    const stopped = sim.time; sim.step(neutral); expect(sim.time).toBe(stopped);
  });
  it('rejects out-of-range and non-finite live controls', () => {
    const sim = new FlightSimulation(defaultAircraft, 'wind-tunnel', 0);
    for (const invalid of [{ speed: 0 }, { speed: 201 }, { pitch: NaN }, { roll: 181 }, { rudder: Infinity }]) expect(() => sim.setWindTunnel({ ...defaultWindTunnel, ...invalid })).toThrow();
  });
  it('reports angle of attack from relative airflow while the fixture stays stationary', () => {
    const sim = new FlightSimulation(powered(), 'wind-tunnel', 0);
    sim.setWindTunnel({ ...defaultWindTunnel, pitch: 5 });
    for (let i = 0; i < 30; i++) sim.step(neutral);
    expect(sim.velocity.lengthSq()).toBe(0);
    expect(sim.telemetry.alpha * 180 / Math.PI).toBeCloseTo(5 + sim.definition.assembly.mainIncidence, 7);
    expect(sim.telemetry.sink).toBeCloseTo(0, 12);
  });
});
