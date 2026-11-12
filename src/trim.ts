import { clamp } from './model';

// UI percentages use 50% as neutral; the simulation uses signed -1…1 inputs.
export function trimStep(value: number, direction: number): number {
 return clamp(value + (direction > 0 ? 0.02 : -0.02), -1, 1);
}
export function trimFromPointer(percent: number): number {
 return (Math.abs(percent - 50) <= 3 ? 0 : (clamp(percent, 0, 100) - 50) / 50);
}

// Trim sets the neutral position; either full-stick endpoint remains reachable.
export function mixTrim(stick: number, trim: number): number {
 return clamp(stick + trim * (1 - Math.abs(stick)), -1, 1);
}

// Body-axis pitch projected onto world up, including knife-edge and inverted flight.
export function pitchDisplay(value: number, roll: number): number {
 return value * Math.cos(roll);
}
