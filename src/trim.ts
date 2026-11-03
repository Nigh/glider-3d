import { clamp } from './model';

// UI percentages use 50% as neutral; the simulation uses signed -1…1 inputs.
export function trimStep(value: number, direction: number): number {
 return clamp(value + (direction > 0 ? 0.1 : -0.1), -1, 1);
}
export function trimFromPointer(percent: number): number {
 return (Math.abs(percent - 50) <= 3 ? 0 : (clamp(percent, 0, 100) - 50) / 50);
}
