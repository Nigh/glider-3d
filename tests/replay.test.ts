import { afterEach, expect, it, vi } from 'vitest';
import { clone, defaultAircraft, presets } from '../src/model';
import { FlightSimulation, FRAME_WIDTH, MAX_FRAMES, validateRecording } from '../src/physics';
import { exportReplay, importReplay, mapHash } from '../src/replay';
import * as challenges from '../src/challenges';
import { seekReplay } from '../src/playback';

const neutral = { weight: 0, rudder: 0, elevator: 0, aileron: 0 };
const sample = () => {
  const sim = new FlightSimulation(defaultAircraft, 'birdman', 0.005);
  for (let i = 0; i < 15; i++) sim.step({ ...neutral, weight: i % 2 ? 0.5 : -0.5, adaptiveControls: true, smartMixing: i % 3 === 0, trimPitch: 0.1 });
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
    expect(second.telemetry.smartMixing).toBe(first.telemetry.smartMixing);
    expect(second.structure.sections.map(section => section.controlDeflection)).toEqual(first.structure.sections.map(section => section.controlDeflection));
  }
  expect(second.getRecording()).toEqual(source.recording);
});

it.each(['birdman', 'downhill', 'low-altitude'] as const)('exports live %s flights without a fixed launch roll and restores their keyframes', async challenge => {
  vi.spyOn(Math, 'random').mockReturnValue(0.8);
  const definition = challenge === 'birdman' ? defaultAircraft : presets.find(d => d.name === (challenge === 'downhill' ? '高性能滑翔型' : '基础单发型'))!;
  const sim = new FlightSimulation(definition, challenge);
  const states = new Map<number, { position: number[]; quaternion: number[]; fuel: number }>();
  for (let frame = 0; frame <= 61; frame++) {
    if (frame) sim.step({ ...neutral, throttle: 0.7 });
    states.set(frame, { position: sim.position.toArray(), quaternion: sim.quaternion.toArray(), fuel: sim.telemetry.fuelRemaining });
  }
  const source = { definition, challenge, recording: sim.getRecording() };
  const restored = await importReplay(await exportReplay(source));
  expect(restored.recording.launchRoll).toBe(source.recording.launchRoll);
  expect(restored.recording.frames).toEqual(source.recording.frames);
  let cancelled = false;
  try {
    for (const point of restored.recording.keyframes!) {
      const state = await seekReplay(restored, point.time, () => cancelled);
      const expected = states.get(point.frame)!;
      expect(state!.position.toArray()).toEqual(expected.position);
      expect(state!.quaternion.toArray()).toEqual(expected.quaternion);
      expect(state!.telemetry.fuelRemaining).toBe(expected.fuel);
    }
  } finally { cancelled = true; }
});

it('rejects incompatible versions, maps and invalid file envelopes', async () => {
  const data = JSON.parse(await exportReplay(sample()));
  for (const [field, value, error] of [
    ['version', 999, '格式'], ['physicsVersion', 'old', '物理版本'], ['mapHash', 'wrong', '地图'], ['challenge', 'unknown', '挑战'],
    ['physicsVersion', 'progressive-fracture-v15', '物理版本'],
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
  for (const value of [-1, 0.5]) {
    const recording = { ...valid, frames: valid.frames.slice() }; recording.frames[11] = value;
    expect(() => validateRecording(recording)).toThrow('输入');
  }
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

it('rejects unsafe keyframe references, field names and mismatched state bindings at import', async () => {
  const source = sample(), envelope = JSON.parse(await exportReplay(source));
  delete envelope.recording.keyframeData;
  delete envelope.recording.keyframeEncoding;
  const invalid = [
    (state: NonNullable<typeof source.recording.keyframes>[number]['state']) => { state.binding = 'different-aircraft'; },
    (state: NonNullable<typeof source.recording.keyframes>[number]['state']) => { state.changes = [[0, ['constructor', 1]]]; },
    (state: NonNullable<typeof source.recording.keyframes>[number]['state']) => { state.changes = [[0, ['position', [999999]]]]; },
    (state: NonNullable<typeof source.recording.keyframes>[number]['state']) => { state.extra.push(['o', ['__proto__'], [null]]); },
    (state: NonNullable<typeof source.recording.keyframes>[number]['state']) => { state.changes = [[0, ['fixedLaunchRoll', 1]]]; },
    (state: NonNullable<typeof source.recording.keyframes>[number]['state']) => { state.changes = [[0, ['fixedLaunchRoll', true]]]; },
  ];
  for (const mutate of invalid) {
    const data = structuredClone(envelope);
    data.recording.keyframes = structuredClone(source.recording.keyframes);
    mutate(data.recording.keyframes[0].state);
    await expect(importReplay(JSON.stringify(data))).rejects.toThrow('关键帧');
  }
});

it('upgrades input-only files and rejects aircraft types forbidden by the recorded competition', async () => {
  const source = sample(), data = JSON.parse(await exportReplay(source));
  delete data.recording.keyframeData;
  delete data.recording.keyframeEncoding;
  const imported = await importReplay(JSON.stringify(data));
  expect(imported.recording.frames).toEqual(source.recording.frames);
  expect(imported.recording.keyframes?.at(-1)?.frame).toBe(source.recording.length);
  data.challenge = 'downhill';
  data.mapHash = await mapHash('downhill');
  await expect(importReplay(JSON.stringify(data))).rejects.toThrow('当前挑战不可使用鸟人间飞机');
});
