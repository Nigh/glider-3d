import { expect, it } from 'vitest';
import { mixTrim, trimStep, trimFromPointer, pitchDisplay } from '../src/trim';
it('trim keys add 1 displayed percentage point from any value and stop at endpoints', () => {
 expect(trimStep(0,1)).toBeCloseTo(0.02);
 expect(trimStep(0,-1)).toBeCloseTo(-0.02);
 expect(trimStep(0.07,1)).toBeCloseTo(0.09);
 expect(trimStep(0.07,-1)).toBeCloseTo(0.05);
 expect(trimStep(-0.07,1)).toBeCloseTo(-0.05);
 expect(trimStep(-0.07,-1)).toBeCloseTo(-0.09);
 expect(trimStep(1,1)).toBe(1);expect(trimStep(-1,-1)).toBe(-1);
 for (let i=0;i<=100;i++) {const value=(i-50)/50;expect(trimStep(value,1)).toBeCloseTo(Math.min(1,value+0.02));expect(trimStep(value,-1)).toBeCloseTo(Math.max(-1,value-0.02));}
});
it('pointer trim only snaps near the neutral 50 percent tick',()=>{
 for (const p of [47,49,50,52,53])expect(trimFromPointer(p)).toBe(0);
 expect(trimFromPointer(54)).toBeCloseTo(0.08);
 expect(trimFromPointer(39)).toBeCloseTo(-0.22);
 expect(trimFromPointer(0)).toBe(-1);expect(trimFromPointer(100)).toBe(1);
});

it('trim shifts neutral without taking either endpoint away from the pilot', () => {
 for (const trim of [-1, -0.4, 0, 0.7, 1]) {
  expect(mixTrim(0, trim)).toBe(trim);
  expect(mixTrim(-1, trim)).toBe(-1);
  expect(mixTrim(1, trim)).toBe(1);
  let previous = -1;
  for (let step = -100; step <= 100; step++) {
   const input = mixTrim(step / 100, trim);
   expect(input).toBeGreaterThanOrEqual(previous);
   expect(input).toBeGreaterThanOrEqual(-1);
   expect(input).toBeLessThanOrEqual(1);
   previous = input;
  }
 }
});

it('pitch indication reverses inverted and passes continuously through knife-edge without changing trim', () => {
 for (const value of [-1, -0.3, 0, 0.6, 1]) {
  expect(pitchDisplay(value, 0)).toBe(value);
  expect(pitchDisplay(value, Math.PI)).toBeCloseTo(-value);
  expect(pitchDisplay(value, Math.PI / 2)).toBeCloseTo(0);
  expect(pitchDisplay(value, -Math.PI / 2)).toBeCloseTo(0);
  expect(pitchDisplay(value, Math.PI / 3)).toBeCloseTo(value / 2);
  expect(mixTrim(0, value)).toBe(value);
 }
});
