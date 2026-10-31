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
  // Default FFT smoothing averages away short latch transients and depends on polling count.
  meter.smoothingTimeConstant = 0;
  const samples = new Float32Array(meter.fftSize);
  const spectrum = new Float32Array(meter.frequencyBinCount);
  const wait = (ms: number) => {
   const { promise, resolve } = Promise.withResolvers<void>();
   setTimeout(resolve, ms);
   return promise;
  };
  const capture = async (duration: number) => {
   const start = context.currentTime;
   const measured = { peak: 0, low: 0, high: 0, tail: 0, quiet: 0 };
   while (context.currentTime - start < duration) {
    meter.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    const elapsed = context.currentTime - start;
    measured.peak = Math.max(measured.peak, rms);
    if (elapsed < 0.1) {
     meter.getFloatFrequencyData(spectrum);
     let low = 0, high = 0;
     for (let i = 0; i < spectrum.length; i++) {
      const frequency = i * context.sampleRate / meter.fftSize;
      const power = 10 ** (spectrum[i] / 10);
      if (frequency >= 40 && frequency < 250) low += power;
      if (frequency >= 600 && frequency < 5000) high += power;
     }
     measured.low = Math.max(measured.low, low);
     measured.high = Math.max(measured.high, high);
    }
    if (elapsed >= 0.12 && elapsed < 0.24) measured.tail = Math.max(measured.tail, rms);
    if (elapsed >= 0.45) measured.quiet = Math.max(measured.quiet, rms);
    await wait(10);
   }
   return measured;
  };
  const reset = async (effects: number, muted = false) => {
   audio.update({ ...state, ready: false });
   audio.setPreferences({ muted, music: 0, effects });
   audio.update(state);
   await wait(350);
  };
  try {
   await wait(350);
   audio.release();
   const full = await capture(0.6);
   audio.release();
   const repeated = await capture(0.16);
   await reset(0.25);
   audio.release();
   const quiet = await capture(0.6);
   await reset(1, true);
   audio.release();
   const muted = await capture(0.16);
   audio.setPreferences({ muted: false, music: 0, effects: 1 });
   await wait(350);
   audio.release();
   const unmuted = await capture(0.16);
   return { full, repeated, quiet, muted, unmuted };
  } finally { audio.dispose(); }
 });
 expect(result.full.peak).toBeGreaterThan(0.02);
 expect(result.full.low).toBeGreaterThan(0.0001);
 expect(result.full.high).toBeGreaterThan(0.0001);
 expect(result.full.tail).toBeGreaterThan(0.001);
 expect(result.full.tail).toBeLessThan(result.full.peak * 0.8);
 expect(result.full.quiet).toBeLessThan(0.000001);
 expect(result.repeated.peak).toBeLessThan(0.000001);
 expect(result.quiet.peak).toBeGreaterThan(result.full.peak * 0.1);
 expect(result.quiet.peak).toBeLessThan(result.full.peak * 0.4);
 expect(result.muted.peak).toBeLessThan(0.000001);
 expect(result.unmuted.peak).toBeLessThan(0.000001);
});
