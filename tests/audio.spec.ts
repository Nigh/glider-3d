import { test, expect } from '@playwright/test';
 import type * as AudioModule from '../src/audio';
 declare global {
  interface Window { audioProbes: { context: AudioContext; meter: AnalyserNode }[] }
 }

test.beforeEach(async ({ page }) => {
 await page.addInitScript(() => {
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
 await page.getByRole('button', { name: '先试飞默认飞机', exact: true }).click();
 const result = await page.evaluate(async () => {
  const path = '/src/audio.ts';
   // Browser execution must load Vite's module; Node-side static imports cannot cross page.evaluate.
   const { GameAudio } = await import(path) as typeof AudioModule;
  const audio = new GameAudio();
  const state = { screen: 'flight' as const, ready: true, paused: false, hidden: false, speed: 5, launching: false };
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

test('分离音有低频冲击、机械高频与衰减余振，每次飞行只响一次并遵守音效音量', async ({ page }) => {
 await page.goto('/');
 await page.getByRole('button', { name: '先试飞默认飞机', exact: true }).click();
 const result = await page.evaluate(async () => {
  const path = '/src/audio.ts';
  // page.evaluate runs in the browser; static Node imports cannot load Vite's audio module there.
  const { GameAudio } = await import(path) as typeof AudioModule;
  const audio = new GameAudio();
  const state = { screen: 'flight' as const, ready: true, paused: false, hidden: false, speed: 0, launching: false };
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
  const blocks: { frame: number; samples: Float32Array }[] = [];
  let pending: { end: number; resolve: () => void } | null = null;
  recorder.port.onmessage = ({ data }: MessageEvent<{ frame: number; samples: Float32Array }>) => {
   blocks.push(data);
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
  const capture = async (duration: number) => {
   blocks.length = 0;
   const start = Math.round(context.currentTime * context.sampleRate);
   const samples = new Float32Array(Math.ceil(duration * context.sampleRate));
   const end = start + samples.length;
   const { promise, resolve } = Promise.withResolvers<void>();
   pending = { end, resolve };
   audio.release();
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
   await wait(350);
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
