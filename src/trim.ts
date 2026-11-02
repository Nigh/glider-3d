import { clamp } from './model';

// UI percentages use 50% as neutral; the simulation uses signed -1…1 inputs.
export function trimStep(value: number, direction: number): number {
 const percent = (value + 1) * 50;
 const tick = direction > 0 ? Math.floor((percent + 1e-8) / 10) + 1 : Math.ceil((percent - 1e-8) / 10) - 1;
 return (clamp(tick * 10, 0, 100) - 50) / 50;
}
export function trimFromPointer(percent: number): number {
 return (Math.abs(percent - 50) <= 3 ? 0 : (clamp(percent, 0, 100) - 50) / 50);
}
