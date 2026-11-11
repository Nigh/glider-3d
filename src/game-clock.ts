export const FIXED_DT = 1 / 60;
const PHYSICS_BUDGET_MS = 8;
const TIME_EPSILON = 1e-12;

/** Fixed simulation time; wall time beyond the per-frame budget is not replayed later. */
export class FixedGameClock {
 private accumulator = 0;
 constructor(private readonly now: () => number = () => performance.now()) {}

 reset(): void { this.accumulator = 0; }

 /** Return interpolation alpha. A false step result stops immediately at the current state. */
 advance(elapsed: number, step: (dt: number) => boolean): number {
  this.accumulator += Math.min(Math.max(elapsed, 0), 0.1);
  const deadline = this.now() + PHYSICS_BUDGET_MS;
  let steps = 0;
  while (this.accumulator + TIME_EPSILON >= FIXED_DT) {
   // Always allow one due step; an indivisible slow step may exceed the budget.
   if (steps > 0 && this.now() >= deadline) break;
   this.accumulator = Math.max(0, this.accumulator - FIXED_DT);
   steps++;
   if (!step(FIXED_DT)) { this.reset(); return 1; }
  }
  // Drop whole overdue ticks, not the fractional remainder used by scene interpolation.
  this.accumulator = Math.max(0, this.accumulator - Math.floor((this.accumulator + TIME_EPSILON) / FIXED_DT) * FIXED_DT);
  return this.accumulator / FIXED_DT;
 }
}
