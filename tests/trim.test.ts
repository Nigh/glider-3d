import { expect, it } from 'vitest';
import { trimStep, trimFromPointer } from '../src/trim';
it('trim keys add 5 percentage points from any value and stop at endpoints', () => {
 expect(trimStep(0,1)).toBeCloseTo(0.1);
 expect(trimStep(0,-1)).toBeCloseTo(-0.1);
 expect(trimStep(0.07,1)).toBeCloseTo(0.17);
 expect(trimStep(0.07,-1)).toBeCloseTo(-0.03);
 expect(trimStep(-0.07,1)).toBeCloseTo(0.03);
 expect(trimStep(-0.07,-1)).toBeCloseTo(-0.17);
 expect(trimStep(1,1)).toBe(1);expect(trimStep(-1,-1)).toBe(-1);
 for (let i=0;i<=20;i++) {const value=(i*5-50)/50;expect(trimStep(value,1)).toBeCloseTo(Math.min(1,value+0.1));expect(trimStep(value,-1)).toBeCloseTo(Math.max(-1,value-0.1));}
});
it('pointer trim only snaps near the neutral 50 percent tick',()=>{
 for (const p of [47,49,50,52,53])expect(trimFromPointer(p)).toBe(0);
 expect(trimFromPointer(54)).toBeCloseTo(0.08);
 expect(trimFromPointer(39)).toBeCloseTo(-0.22);
 expect(trimFromPointer(0)).toBe(-1);expect(trimFromPointer(100)).toBe(1);
});
