import { afterEach, expect, it, vi } from 'vitest';
import { clone, defaultAircraft } from '../src/model';
import { FlightSimulation, FRAME_WIDTH, MAX_FRAMES, validateRecording } from '../src/physics';
import { exportReplay, importReplay, mapHash } from '../src/replay';
import * as challenges from '../src/challenges';

const neutral = { weight: 0, rudder: 0, elevator: 0, aileron: 0 };
const sample = () => {
  const sim = new FlightSimulation(defaultAircraft, 'birdman', 0.005);
  for (let i = 0; i < 15; i++) sim.step({ ...neutral, weight: i % 2 ? 0.5 : -0.5, adaptiveControls: true, trimPitch: 0.1 });
  return { definition: clone(defaultAircraft), challenge: 'birdman' as const, recording: sim.getRecording() };
};
afterEach(() => vi.restoreAllMocks());

it('keeps the exported aircraft snapshot independent of later design edits', async () => {
  const source=sample(), expected=clone(source.definition);
  const pending=exportReplay(source);
  source.definition.mainWing.points[1].y+=0.5;
  source.definition.mainWing.points[2].y+=0.5;
  expect((await importReplay(await pending)).definition).toEqual(expected);
});

it('exports lossless JSON and reproduces every recorded state after import', async () => {
  const source = sample(), restored = await importReplay(await exportReplay(source));
  expect(restored).toEqual(source);
  const first = new FlightSimulation(source.definition, source.challenge), second = new FlightSimulation(restored.definition, restored.challenge);
  first.loadReplay(source.recording); second.loadReplay(restored.recording);
  while (!first.replayFinished) {
    first.step(neutral); second.step(neutral);
    expect(second.position.toArray()).toEqual(first.position.toArray());
    expect(second.quaternion.toArray()).toEqual(first.quaternion.toArray());
    expect(second.telemetry.controlInputs).toEqual(first.telemetry.controlInputs);
  }
  expect(second.getRecording()).toEqual(source.recording);
});

it('rejects incompatible versions, maps and invalid file envelopes', async () => {
  const data = JSON.parse(await exportReplay(sample()));
  for (const [field, value, error] of [
    ['version', 999, '格式'], ['physicsVersion', 'old', '物理版本'], ['mapHash', 'wrong', '地图'], ['challenge', 'unknown', '挑战'],
  ] as const) await expect(importReplay(JSON.stringify({ ...data, [field]: value }))).rejects.toThrow(error);
  for (const text of ['null', '{}', '[]', '{', '"string"']) await expect(importReplay(text)).rejects.toThrow();
  for (const value of [null, '0', true, 2]) {
    const changed = structuredClone(data); changed.recording.frames[3] = value;
    await expect(importReplay(JSON.stringify(changed))).rejects.toThrow('输入');
  }
  await expect(importReplay(JSON.stringify({ ...data, recording: { ...data.recording, length: MAX_FRAMES + 1 } }))).rejects.toThrow('长度');
});

it('validates every input field at both JSON and simulation boundaries', () => {
  const valid = sample().recording;
  for (let field = 0; field < FRAME_WIDTH; field++) {
    for (const value of [NaN, Infinity, field === 0 ? 0 : 2]) {
      const recording = { ...valid, frames: valid.frames.slice() }; recording.frames[field] = value;
      expect(() => validateRecording(recording)).toThrow();
      expect(() => new FlightSimulation(defaultAircraft).loadReplay(recording)).toThrow();
    }
  }
  expect(() => validateRecording({ ...valid, frames: new Float64Array(valid.frames.length + 1) })).toThrow();
});

it('hashes actual map geometry and detects terrain edits', async () => {
  const birdman = await mapHash('birdman'), downhill = await mapHash('downhill');
  expect(birdman).toMatch(/^[a-f0-9]{64}$/);
  expect(downhill).not.toBe(birdman);
  expect(await mapHash('downhill')).toBe(downhill);
  const original = challenges.challengeTerrainHeight;
  vi.spyOn(challenges, 'challengeTerrainHeight').mockImplementation((...args) => original(...args) + 0.01);
  expect(await mapHash('downhill')).not.toBe(downhill);
});
