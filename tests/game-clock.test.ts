import { expect, it } from 'vitest';
import { FIXED_DT, FixedGameClock } from '../src/game-clock';

it('runs exactly 60 fixed ticks per second at 30, 60 and 144 Hz rendering', () => {
 for (const refresh of [30, 60, 144]) {
  let wallTime = 0;
  const clock = new FixedGameClock(() => wallTime);
  const ticks: number[] = [];
  let frameTicks = 0, mostFrameTicks = 0;
  const step = (dt: number) => { ticks.push(dt); frameTicks++; wallTime += 0.1; return true; };
  for (let frame = 0; frame < refresh; frame++) {
   frameTicks = 0;
   const alpha = clock.advance(1 / refresh, step);
   mostFrameTicks = Math.max(mostFrameTicks, frameTicks);
   expect(alpha).toBeGreaterThanOrEqual(0);
   expect(alpha).toBeLessThan(1);
  }
  expect(ticks).toHaveLength(60);
  expect(ticks.every(dt => dt === 1 / 60)).toBe(true);
  if (refresh === 30) expect(mostFrameTicks).toBe(2);
 }
});

it('interpolates high-refresh frames without creating extra physics ticks', () => {
 const clock = new FixedGameClock(() => 0);
 let ticks = 0;
 const step = () => { ticks++; return true; };
 for (const alpha of [0.25, 0.5, 0.75, 0]) {
  expect(clock.advance(FIXED_DT / 4, step)).toBeCloseTo(alpha);
 }
 expect(ticks).toBe(1);
});

it('uses a time budget for catch-up and drops only whole overdue ticks', () => {
 let wallTime = 0, ticks = 0;
 const clock = new FixedGameClock(() => wallTime);
 const step = (dt: number) => { expect(dt).toBe(FIXED_DT); ticks++; wallTime += 5; return true; };
 // Four ticks are due, but two indivisible 5 ms ticks exhaust the 8 ms budget.
 expect(clock.advance(4.25 * FIXED_DT, step)).toBeCloseTo(0.25);
 expect(ticks).toBe(2);
 expect(clock.advance(FIXED_DT / 4, step)).toBeCloseTo(0.5);
 expect(ticks).toBe(2);
 expect(clock.advance(FIXED_DT / 2, step)).toBeCloseTo(0);
 expect(ticks).toBe(3);
});

it('slows game time instead of enlarging dt when one physics tick exceeds the budget', () => {
 let wallTime = 0, gameTime = 0, ticks = 0;
 const clock = new FixedGameClock(() => wallTime);
 const step = (dt: number) => { expect(dt).toBe(FIXED_DT); ticks++; gameTime += dt; wallTime += 20; return true; };
 for (let frame = 0; frame < 30; frame++) clock.advance(1 / 30, step);
 expect(ticks).toBe(30);
 expect(gameTime).toBeCloseTo(0.5);
 clock.advance(0, step);
 expect(ticks).toBe(30);
});

it('bounds long stalls and clears fractional time on reset or an ended flight', () => {
 const clock = new FixedGameClock(() => 0);
 let ticks = 0;
 const step = () => { ticks++; return true; };
 clock.advance(10, step);
 expect(ticks).toBe(6);
 clock.advance(FIXED_DT * 0.75, step);
 clock.reset();
 expect(clock.advance(FIXED_DT / 2, step)).toBeCloseTo(0.5);
 let endedTicks = 0;
 expect(clock.advance(FIXED_DT * 3, () => { endedTicks++; return false; })).toBe(1);
 expect(endedTicks).toBe(1);
 expect(clock.advance(FIXED_DT / 4, step)).toBeCloseTo(0.25);
 expect(ticks).toBe(6);
});
