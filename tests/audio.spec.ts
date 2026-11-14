import { test, expect } from '@playwright/test';
 import type * as AudioModule from '../src/audio';
import type * as PhysicsModule from '../src/physics';
import type * as ModelModule from '../src/model';
 declare global {
  interface Window { audioProbes: { context: AudioContext; meter: AnalyserNode }[] }
 }

test.beforeEach(async ({ page }) => {
 await page.addInitScript(() => {
  localStorage.setItem('aero-formula.language', 'zh');
  const NativeContext = window.AudioContext;
  const probes: { context: AudioContext; meter: AnalyserNode }[] = [];
   window.audioProbes = probes;
  window.AudioContext = class extends NativeContext {
   private meter: AnalyserNode;
   private firstGain = true;
   constructor(options?: AudioContextOptions) {
    super(options);
    this.meter = this.createAnalyser();
    this.meter.fftSize = 2048;
    probes.push({ context: this, meter: this.meter });
   }
   createGain(): GainNode {
    const gain = super.createGain();
    if (this.firstGain) { gain.connect(this.meter); this.firstGain = false; }
    return gain;
   }
  };
 });
});

test('原生音频随速度增强，静音有效，暂停恢复不阻断播放', async ({ page }) => {
 await page.goto('/');
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 await page.getByRole('button', { name: '前往挑战' }).click();
 const result = await page.evaluate(async () => {
  const path = '/src/audio.ts';
   // Browser execution must load Vite's module; Node-side static imports cannot cross page.evaluate.
   const { GameAudio } = await import(path) as typeof AudioModule;
  const audio = new GameAudio();
  const state = { screen: 'flight' as const, ready: true, paused: false, hidden: false, speed: 5, launching: false,
   challenge: 'birdman' as const, launchKind: 'catapult' as const, timingStarted: false, challengeProgress: 0 };
  audio.setPreferences({ muted: false, music: 0, effects: 1 });
  audio.update(state);
  audio.unlock();
   const { context, meter } = window.audioProbes.at(-1)!;
   const settle = () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 700);
    return promise;
   };
  const rms = () => {
   const data = new Float32Array(meter.fftSize);
   meter.getFloatTimeDomainData(data);
   return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
  };
  try {
   await settle();
   const low = rms();
   audio.update({ ...state, speed: 25 });
   await settle();
   const high = rms();
   audio.setPreferences({ muted: true, music: 0, effects: 1 });
   await settle();
   const muted = rms();
   audio.update({ ...state, paused: true });
   await settle();
   const paused = context.state, stoppedAt = context.currentTime;
   await settle();
   const frozen = context.currentTime === stoppedAt;
   audio.setPreferences({ muted: false, music: 0, effects: 1 });
   audio.update({ ...state, speed: 25 });
   await settle();
   return { low, high, muted, paused, frozen, resumed: rms(), advanced: context.currentTime > stoppedAt };
  } finally { audio.dispose(); }
 });
 expect(result.low).toBeGreaterThan(0.0001);
 expect(result.high).toBeGreaterThan(result.low * 2);
 expect(result.muted).toBeLessThan(0.000001);
 expect(result.paused).toBe('suspended');
 expect(result.frozen).toBe(true);
 expect(result.resumed).toBeGreaterThan(0.001);
 expect(result.advanced).toBe(true);
});

test('喷气引擎随实际转速提高音量与音高，停机后静音', async ({ page }) => {
 await page.goto('/');
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 await page.getByRole('button', { name: '前往挑战' }).click();
 const result = await page.evaluate(async () => {
  const path = '/src/audio.ts';
  // page.evaluate loads Vite's browser module; a static Node import cannot cross that execution boundary.
  const { GameAudio } = await import(path) as typeof AudioModule;
  const audio = new GameAudio();
  const state = { screen: 'flight' as const, ready: true, paused: false, hidden: false, speed: 0, launching: false, engineRpm: 0.25,
   challenge: 'birdman' as const, launchKind: 'catapult' as const, timingStarted: false, challengeProgress: 0 };
  audio.setPreferences({ muted: false, music: 0, effects: 1 });
  audio.update(state); audio.unlock();
  const { context, meter } = window.audioProbes.at(-1)!;
  const measure = async () => {
   const { promise, resolve } = Promise.withResolvers<void>();
   setTimeout(resolve, 900); await promise;
   const signal = new Float32Array(meter.fftSize), spectrum = new Float32Array(meter.frequencyBinCount);
   meter.getFloatTimeDomainData(signal); meter.getFloatFrequencyData(spectrum);
   const binHz = context.sampleRate / meter.fftSize;
   let peak = Math.ceil(80 / binHz);
   for (let bin = peak + 1; bin * binHz < 600; bin++) if (spectrum[bin] > spectrum[peak]) peak = bin;
   return { rms: Math.sqrt(signal.reduce((sum, value) => sum + value * value, 0) / signal.length), pitch: peak * binHz };
  };
  try {
   const low = await measure();
   audio.update({ ...state, engineRpm: 1 }); const high = await measure();
   audio.update({ ...state, engineRpm: 0 }); const stopped = await measure();
   return { low, high, stopped };
  } finally { audio.dispose(); }
 });
 expect(result.high.rms).toBeGreaterThan(result.low.rms * 2);
 expect(result.high.pitch).toBeGreaterThan(result.low.pitch + 100);
 expect(result.stopped.rms).toBeLessThan(0.0001);
});

test('分离音有低频冲击、机械高频与衰减余振，每次飞行只响一次并遵守音效音量', async ({ page }) => {
 await page.goto('/');
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 await page.getByRole('button', { name: '前往挑战' }).click();
 const result = await page.evaluate(async () => {
  const path = '/src/audio.ts';
  // page.evaluate runs in the browser; static Node imports cannot load Vite's audio module there.
  const { GameAudio } = await import(path) as typeof AudioModule;
  const audio = new GameAudio();
  const state = { screen: 'flight' as const, ready: true, paused: false, hidden: false, speed: 0, launching: false,
   challenge: 'birdman' as const, launchKind: 'catapult' as const, timingStarted: false, challengeProgress: 0 };
  audio.setPreferences({ muted: false, music: 0, effects: 1 });
  audio.update(state);
  audio.unlock();
  const { context, meter } = window.audioProbes.at(-1)!;
  // Record on the audio thread: main-thread timers cannot reliably catch a 35 ms latch transient.
  const moduleUrl = URL.createObjectURL(new Blob([`
   registerProcessor('release-recorder', class extends AudioWorkletProcessor {
    process(inputs) {
     const input = inputs[0]?.[0];
     if (input) {
      const samples = input.slice();
      this.port.postMessage({ frame: currentFrame, samples }, [samples.buffer]);
     }
     // Leave output zeroed; the master already connects to the speakers.
     return true;
    }
   });
  `], { type: 'text/javascript' }));
  try { await context.audioWorklet.addModule(moduleUrl); }
  finally { URL.revokeObjectURL(moduleUrl); }
  const recorder = new AudioWorkletNode(context, 'release-recorder');
  meter.connect(recorder);
  recorder.connect(context.destination);
  // Keep continuous PCM: currentTime may reference a quantum already delivered to the main thread.
  const blocks: { frame: number; samples: Float32Array }[] = [];
  const recordingReady = Promise.withResolvers<void>();
  let pending: { end: number; resolve: () => void } | null = null;
  recorder.port.onmessage = ({ data }: MessageEvent<{ frame: number; samples: Float32Array }>) => {
   blocks.push(data);
   recordingReady.resolve();
   if (pending && data.frame + data.samples.length >= pending.end) {
    const { resolve } = pending;
    pending = null;
    resolve();
   }
  };
  const wait = (ms: number) => {
   const { promise, resolve } = Promise.withResolvers<void>();
   setTimeout(resolve, ms);
   return promise;
  };
  const capture = async (duration: number, release = true) => {
   const start = Math.round(context.currentTime * context.sampleRate);
   const samples = new Float32Array(Math.ceil(duration * context.sampleRate));
   const end = start + samples.length;
   const { promise, resolve } = Promise.withResolvers<void>();
   pending = { end, resolve };
   if (release) audio.release();
   await promise;
   let copied = 0;
   for (const block of blocks) {
    const from = Math.max(start, block.frame);
    const to = Math.min(end, block.frame + block.samples.length);
    if (to <= from) continue;
    samples.set(block.samples.subarray(from - block.frame, to - block.frame), from - start);
    copied += to - from;
   }
   if (copied !== samples.length) throw new Error('Audio recording contains missing frames');
   return samples;
  };
  const rms = (samples: Float32Array, from: number, to: number) => {
   let power = 0;
   for (let i = from; i < to; i++) power += samples[i] * samples[i];
   return Math.sqrt(power / (to - from));
  };
  const peak = (samples: Float32Array) => {
   const window = Math.round(context.sampleRate * 0.01);
   let level = 0;
   for (let from = 0; from < samples.length; from += window) {
    level = Math.max(level, rms(samples, from, Math.min(samples.length, from + window)));
   }
   return level;
  };
  const reset = async (effects: number, muted = false) => {
   audio.update({ ...state, ready: false });
   audio.setPreferences({ muted, music: 0, effects });
   audio.update(state);
   await wait(350);
  };
  try {
   await recordingReady.promise;
   audio.update({ ...state, launching: true }); audio.launch();
   await wait(350);
   const runup = await capture(0.15, false);
   audio.update(state);
   const full = await capture(0.6);
   const repeated = await capture(0.16);
   await reset(0.25);
   const quiet = await capture(0.6);
   await reset(1, true);
   const muted = await capture(0.16);
   audio.setPreferences({ muted: false, music: 0, effects: 1 });
   await wait(350);
   const unmuted = await capture(0.16);

   // Filter recorded PCM offline, then measure band RMS without FFT smoothing or timer sampling.
   const offline = new OfflineAudioContext(2, full.length, context.sampleRate);
   const buffer = offline.createBuffer(1, full.length, context.sampleRate);
   buffer.getChannelData(0).set(full);
   const source = offline.createBufferSource();
   source.buffer = buffer;
   const merger = offline.createChannelMerger(2);
   for (const [channel, [from, to]] of [[40, 250], [600, 5000]].entries()) {
    const highpass = offline.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = from;
    highpass.Q.value = Math.SQRT1_2;
    const lowpass = offline.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = to;
    lowpass.Q.value = Math.SQRT1_2;
    source.connect(highpass).connect(lowpass).connect(merger, 0, channel);
   }
   merger.connect(offline.destination);
   source.start();
   const bands = await offline.startRendering();
   const onsetEnd = Math.round(context.sampleRate * 0.1);
   return {
    full: {
     peak: peak(full),
     runup: peak(runup),
     low: rms(bands.getChannelData(0), 0, onsetEnd),
     high: rms(bands.getChannelData(1), 0, onsetEnd),
     tail: rms(full, Math.round(context.sampleRate * 0.12), Math.round(context.sampleRate * 0.24)),
     quiet: rms(full, Math.round(context.sampleRate * 0.45), full.length),
    },
    repeated: peak(repeated), quiet: peak(quiet), muted: peak(muted), unmuted: peak(unmuted),
   };
  } finally {
   meter.disconnect(recorder);
   recorder.disconnect();
   recorder.port.close();
   audio.dispose();
  }
 });
 expect(result.full.peak).toBeGreaterThan(0.02);
 expect(result.full.peak).toBeGreaterThan(result.full.runup * 3);
 // Both bands must exceed -46 dBFS RMS, not merely contain nonzero spectral bins.
 expect(result.full.low).toBeGreaterThan(0.005);
 expect(result.full.high).toBeGreaterThan(0.005);
 expect(result.full.tail).toBeGreaterThan(0.001);
 expect(result.full.tail).toBeLessThan(result.full.peak * 0.8);
 expect(result.full.quiet).toBeLessThan(0.000001);
 expect(result.repeated).toBeLessThan(0.000001);
 expect(result.quiet).toBeGreaterThan(result.full.peak * 0.1);
 expect(result.quiet).toBeLessThan(result.full.peak * 0.4);
 expect(result.muted).toBeLessThan(0.000001);
 expect(result.unmuted).toBeLessThan(0.000001);
});

test('计时起点、检查点、终点清晰短促且每点只响一次，静音暂停后台不补播，新飞行与回放重置', async ({ page }) => {
 await page.goto('/');
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 const result = await page.evaluate(async () => {
  const path = '/src/audio.ts';
  // Browser evaluation loads Vite's module; Node-side static imports cannot cross that boundary.
  const { GameAudio } = await import(path) as typeof AudioModule;
  const audio = new GameAudio();
  const state = { screen: 'flight' as const, ready: true, paused: false, hidden: false, speed: 0, launching: false,
   challenge: 'downhill' as const, launchKind: 'catapult' as const, timingStarted: false, challengeProgress: 0 };
  audio.setPreferences({ muted: false, music: 0, effects: 1 });
  audio.update(state);
  audio.update({ ...state, timingStarted: true });
  audio.unlock();
  const { context, meter } = window.audioProbes.at(-1)!;
  await context.resume();
  const url = URL.createObjectURL(new Blob([`
   registerProcessor('timing-recorder', class extends AudioWorkletProcessor {
    process(inputs) {
     const input = inputs[0]?.[0];
     if (input) {
      const samples = input.slice();
      this.port.postMessage({ frame: currentFrame, samples }, [samples.buffer]);
     }
     return true;
    }
   });
  `], { type: 'text/javascript' }));
  try { await context.audioWorklet.addModule(url); }
  finally { URL.revokeObjectURL(url); }
  const recorder = new AudioWorkletNode(context, 'timing-recorder');
  meter.connect(recorder); recorder.connect(context.destination);
  // Keep continuous PCM across captures and suspend/resume; never discard an already delivered quantum.
  const blocks: { frame: number; samples: Float32Array }[] = [];
  const recordingReady = Promise.withResolvers<void>();
  let pending: { end: number; resolve: () => void } | null = null;
  recorder.port.onmessage = ({ data }: MessageEvent<{ frame: number; samples: Float32Array }>) => {
   blocks.push(data);
   recordingReady.resolve();
   if (pending && data.frame + data.samples.length >= pending.end) {
    const { resolve } = pending; pending = null; resolve();
   }
  };
  const capture = async (event: () => void) => {
   const start = Math.round(context.currentTime * context.sampleRate);
   const samples = new Float32Array(Math.ceil(0.4 * context.sampleRate));
   const { promise, resolve } = Promise.withResolvers<void>();
   pending = { end: start + samples.length, resolve };
   event(); await promise;
   let copied = 0;
   for (const block of blocks) {
    const from = Math.max(start, block.frame), to = Math.min(start + samples.length, block.frame + block.samples.length);
    if (to <= from) continue;
    samples.set(block.samples.subarray(from - block.frame, to - block.frame), from - start);
    copied += to - from;
   }
   if (copied !== samples.length) throw new Error('Audio recording contains missing frames');
   const rms = (from: number, to: number) => {
    let power = 0;
    for (let i = Math.round(from * context.sampleRate); i < Math.round(to * context.sampleRate); i++) power += samples[i] ** 2;
    return Math.sqrt(power / Math.round((to - from) * context.sampleRate));
   };
   return { onset: rms(0, 0.08), tail: rms(0.30, 0.39), peak: samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) };
  };
  let current = { ...state, timingStarted: true };
  try {
   await recordingReady.promise;
   const locked = await capture(() => audio.update(current));
   audio.update({ ...state, ready: false }); audio.update(state);
   const start = await capture(() => audio.update(current));
   const repeated = await capture(() => { for (let i = 0; i < 20; i++) audio.update({ ...current }); });
   current = { ...current, challengeProgress: 0.1 };
   const checkpoint = await capture(() => audio.update(current));
   audio.setPreferences({ muted: true, music: 0, effects: 1 });
   current = { ...current, challengeProgress: 0.2 }; audio.update(current);
   audio.setPreferences({ muted: false, music: 0, effects: 1 });
   const muted = await capture(() => audio.update(current));
   current = { ...current, challengeProgress: 0.3 };
   audio.update({ ...current, paused: true }); await context.suspend();
   audio.update(current); await context.resume();
   const paused = await capture(() => audio.update(current));
   current = { ...current, challengeProgress: 0.4 };
   audio.update({ ...current, hidden: true }); await context.suspend();
   audio.update(current); await context.resume();
   const hidden = await capture(() => audio.update(current));
   audio.setPreferences({ muted: false, music: 0, effects: 0 });
   current = { ...current, challengeProgress: 0.5 }; audio.update(current);
   audio.setPreferences({ muted: false, music: 0, effects: 1 });
   const zeroEffects = await capture(() => audio.update(current));
   current = { ...current, challengeProgress: 1 };
   const finish = await capture(() => {
    audio.update(current);
    audio.update({ ...current, screen: 'result' });
   });
   audio.update({ ...state, ready: false }); audio.update(state);
   const restarted = await capture(() => audio.update({ ...state, timingStarted: true }));
   audio.update({ ...state, screen: 'result' });
   audio.update({ ...state, ready: false }); audio.update(state);
   const replayed = await capture(() => audio.update({ ...state, challenge: 'low-altitude', launchKind: 'runway', timingStarted: true }));
   // Cancel an already audible cue before suspending, not just events received while suspended.
   const { promise, resolve } = Promise.withResolvers<void>();
   pending = { end: Math.round((context.currentTime + 0.025) * context.sampleRate), resolve };
   audio.update({ ...state, timingStarted: true, challengeProgress: 0.1 });
   await promise;
   audio.update({ ...state, timingStarted: true, challengeProgress: 0.1, hidden: true });
   await context.suspend();
   audio.update({ ...state, timingStarted: true, challengeProgress: 0.1 }); await context.resume();
   const resumedTail = await capture(() => {});
   return { start, checkpoint, finish, restarted, replayed, repeated, locked, muted, paused, hidden, zeroEffects, resumedTail };
  } finally {
   meter.disconnect(recorder); recorder.disconnect(); recorder.port.close(); audio.dispose();
  }
 });
 for (const cue of [result.start, result.checkpoint, result.finish, result.restarted, result.replayed]) {
  expect(cue.onset).toBeGreaterThan(0.008);
  expect(cue.peak).toBeLessThan(0.22);
  expect(cue.tail).toBeLessThan(0.000001);
 }
 for (const quiet of [result.repeated, result.locked, result.muted, result.paused, result.hidden, result.zeroEffects, result.resumedTail]) {
  expect(quiet.peak).toBeLessThan(0.000001);
 }
});

test('GameAudio拒绝低空与跑道模式的蒸汽及弹射分离音，其他弹射模式保留机械事件', async ({ page }) => {
 await page.goto('/');
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 const result = await page.evaluate(async () => {
  const path = '/src/audio.ts';
  // Browser evaluation loads Vite's module; Node-side static imports cannot cross that boundary.
  const { GameAudio } = await import(path) as typeof AudioModule;
  const audio = new GameAudio();
  const state = { screen: 'flight' as const, ready: true, paused: false, hidden: false, speed: 0, launching: true,
   challenge: 'low-altitude' as const, launchKind: 'runway' as const, timingStarted: false, challengeProgress: 0 };
  audio.setPreferences({ muted: false, music: 0, effects: 1 });
  audio.update(state); audio.unlock();
  const { context, meter } = window.audioProbes.at(-1)!;
  await context.resume();
  const sources: AudioScheduledSourceNode[] = [];
  const oscillator = context.createOscillator.bind(context), buffer = context.createBufferSource.bind(context);
  context.createOscillator = () => { const source = oscillator(); sources.push(source); return source; };
  context.createBufferSource = () => { const source = buffer(); sources.push(source); return source; };
  const measureSteam = async () => {
   const { promise, resolve } = Promise.withResolvers<void>();
   setTimeout(resolve, 600); await promise;
   const samples = new Float32Array(meter.fftSize);
   meter.getFloatTimeDomainData(samples);
   return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  };
  try {
   const rejected: { steam: number; sources: number }[] = [];
   for (const mode of [
    { challenge: 'low-altitude' as const, launchKind: 'runway' as const },
    { challenge: 'low-altitude' as const, launchKind: 'catapult' as const },
    { challenge: 'downhill' as const, launchKind: 'runway' as const },
    { challenge: 'test-space' as const, launchKind: 'runway' as const },
    { challenge: 'wind-tunnel' as const, launchKind: 'catapult' as const },
   ]) {
    audio.update({ ...state, ...mode, ready: false });
    audio.update({ ...state, ...mode }); audio.launch();
    const steam = await measureSteam();
    audio.update({ ...state, ...mode, launching: false }); audio.release(); audio.release();
    rejected.push({ steam, sources: sources.length });
   }
   const accepted: { steam: number; sources: number; repeated: number }[] = [];
   for (const challenge of ['birdman', 'downhill', 'test-space'] as const) {
    const catapult = { ...state, challenge, launchKind: 'catapult' as const };
    audio.update({ ...catapult, ready: false }); audio.update(catapult); audio.launch();
    const steam = await measureSteam();
    const before = sources.length;
    audio.update({ ...catapult, launching: false }); audio.release();
    const played = sources.length - before;
    audio.release();
    accepted.push({ steam, sources: played, repeated: sources.length - before - played });
   }
   return { rejected, accepted };
  } finally { audio.dispose(); }
 });
 for (const rejected of result.rejected) {
  expect(rejected.steam).toBeLessThan(0.000001);
  expect(rejected.sources).toBe(0);
 }
 for (const accepted of result.accepted) {
  expect(accepted.steam).toBeGreaterThan(0.001);
  expect(accepted.sources).toBeGreaterThan(0);
  expect(accepted.repeated).toBe(0);
 }
});

test('弹射分离音跟随真实模拟，暂停不补播，重飞和回放跳转不重复旧事件', async ({ page }) => {
 await page.goto('/');
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 const result = await page.evaluate(async () => {
  const audioPath = '/src/audio.ts', physicsPath = '/src/physics.ts', modelPath = '/src/model.ts';
  // Browser evaluation must load Vite modules here; Node static imports cannot cross this boundary.
  const { GameAudio } = await import(audioPath) as typeof AudioModule;
  const { FlightSimulation } = await import(physicsPath) as typeof PhysicsModule;
  const { defaultAircraft } = await import(modelPath) as typeof ModelModule;
  const audio = new GameAudio();
  const simulation = new FlightSimulation(defaultAircraft, 'birdman', 0);
  const state = { screen: 'flight' as const, ready: true, paused: false, hidden: false, speed: 0, launching: true,
   challenge: 'birdman' as const, launchKind: 'catapult' as const, timingStarted: false, challengeProgress: 0, simulation };
  audio.setPreferences({ muted: false, music: 0, effects: 1 });
  audio.update(state); audio.unlock();
  const { context } = window.audioProbes.at(-1)!;
  await context.resume();
  let count = 0;
  const createBuffer = context.createBufferSource.bind(context);
  context.createBufferSource = () => { count++; return createBuffer(); };
  const neutral = { weight: 0, rudder: 0, elevator: 0, aileron: 0 };
  const separate = () => {
   while (simulation.launching && !simulation.ended) simulation.step(neutral);
   audio.update({ ...state, launching: simulation.launching });
   audio.release();
  };
  try {
   separate();
   const first = count;
   audio.release(); audio.update({ ...state, launching: false, paused: true }); audio.release();
   audio.update({ ...state, launching: false }); await context.resume(); audio.release();
   const repeated = count - first;
   // Replacement simulation already detached represents a seek beyond separation.
   const seek = new FlightSimulation(defaultAircraft, 'birdman', 0);
   while (seek.launching && !seek.ended) seek.step(neutral);
   audio.update({ ...state, simulation: seek, launching: false }); audio.release();
   const skipped = count - first;
   // Same simulation rewinds to frame zero, then crosses separation again.
   simulation.reset();
   audio.update(state);
   separate();
   const rewound = count - first;
   simulation.reset(); audio.update({ ...state, paused: true });
   while (simulation.launching && !simulation.ended) simulation.step(neutral);
   audio.update({ ...state, launching: false, paused: true }); audio.release();
   audio.update({ ...state, launching: false }); await context.resume(); audio.release();
   return { first, repeated, skipped, rewound, paused: count - first - rewound };
  } finally { audio.dispose(); }
 });
 expect(result).toEqual({ first: 1, repeated: 0, skipped: 0, rewound: 1, paused: 0 });
});
