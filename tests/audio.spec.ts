import { test, expect } from '@playwright/test';
 import type * as AudioModule from '../src/audio';
 declare global {
  interface Window { audioProbes: { context: AudioContext; meter: AnalyserNode }[] }
 }

test('原生音频随速度增强，静音有效，暂停恢复不阻断播放', async ({ page }) => {
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
