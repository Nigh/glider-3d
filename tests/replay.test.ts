import { describe, expect, it } from 'vitest';
import { clone, defaultAircraft } from '../src/model';
import { challengeMapHash } from '../src/challenges';
import { FlightSimulation } from '../src/physics';
import { exportReplay, importReplay } from '../src/replay';
import { PHYSICS_VERSION } from '../src/storage';

const neutral = { weight: 0, lateral: 0, rudder: 0, elevator: 0, aileron: 0, throttle: 0 };

describe('飞行回放文件', () => {
  it('携带飞机、挑战、物理版本和实际地图hash往返，输入保持逐值一致', () => {
    const simulation = new FlightSimulation(defaultAircraft, 'birdman', 0);
    simulation.step(neutral, 1 / 60);
    simulation.step({ ...neutral, weight: 0.25, rudder: -0.4 }, 1 / 60);
    const json = exportReplay(defaultAircraft, 'birdman', simulation.getRecording());
    const raw = JSON.parse(json);
    expect(raw.physicsVersion).toBe(PHYSICS_VERSION);
    expect(raw.mapHash).toBe(challengeMapHash('birdman'));
    const imported = importReplay(json);
    expect(imported.challenge).toBe('birdman');
    expect(imported.aircraft).toEqual(defaultAircraft);
    expect(imported.recording.launchRoll).toBe(0);
    expect(imported.recording.length).toBe(2);
    expect(Array.from(imported.recording.frames)).toEqual(Array.from(simulation.getRecording().frames));
  });

  it('地图、物理与格式版本不匹配时明确拒绝，且不接受非有限帧', () => {
    const simulation = new FlightSimulation(defaultAircraft, 'birdman', 0);
    simulation.step(neutral, 1 / 60);
    const valid = JSON.parse(exportReplay(clone(defaultAircraft), 'birdman', simulation.getRecording()));
    for (const [field, value, message] of [
      ['mapHash', '00000000', '回放地图与当前地图不匹配。'],
      ['physicsVersion', 'old', '回放物理版本与当前版本不匹配。'],
      ['version', 999, '回放文件版本不受支持。'],
    ] as const) {
      expect(() => importReplay(JSON.stringify({ ...valid, [field]: value }))).toThrow(message);
    }
    valid.recording.frames[1] = 'bad';
    expect(() => importReplay(JSON.stringify(valid))).toThrow('回放包含无效输入。');
  });

  it('三张地图的hash稳定且互不相同', () => {
    const hashes = ['birdman', 'downhill', 'low-altitude'].map(mode => challengeMapHash(mode as never));
    expect(new Set(hashes).size).toBe(3);
    expect(hashes.every(hash => /^[0-9a-f]{8}$/.test(hash))).toBe(true);
    expect(challengeMapHash('downhill')).toBe(hashes[1]);
  });
});
