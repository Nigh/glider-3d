import { expect, it } from 'vitest';
import { energyCostScale } from '../src/flight-chart';

it('keeps airborne resolution through water spikes and isolated airborne outliers', () => {
  const normal = [40, 50, 55, 60, 65, 70, 80].map(energyPerDistance => ({ energyPerDistance, waterContact: false }));
  const water = { energyPerDistance: 100000, waterContact: true };
  expect(energyCostScale([...normal, water, water, water])).toBe(80);
  const axis = energyCostScale([...normal, { ...water, waterContact: false }]);
  expect(axis).toBeGreaterThanOrEqual(80); expect(axis).toBeLessThan(200);
  expect(energyCostScale([])).toBe(1);
  expect(energyCostScale([water, { energyPerDistance: null, waterContact: false }])).toBe(1);
});
