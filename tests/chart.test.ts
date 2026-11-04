import { expect, it } from 'vitest';
import { energyCostScale } from '../src/chart';

it('能耗纵轴忽略擦水尖峰并用飞行样本的95百分位保留分辨率', () => {
  const flight = Array.from({ length: 100 }, (_, index) => ({ energyPerDistance: 80 + index, waterContact: false }));
  const samples = [...flight, { energyPerDistance: 50_000, waterContact: true }];
  const scale = energyCostScale(samples);
  expect(scale).toBeGreaterThan(170);
  expect(scale).toBeLessThan(210);
  expect(scale).toBe(energyCostScale(flight));
});

it('少量样本与只有触水样本时仍提供有限纵轴', () => {
  expect(energyCostScale([{ energyPerDistance: 7, waterContact: false }])).toBe(7);
  expect(energyCostScale([{ energyPerDistance: 30, waterContact: true }])).toBe(30);
  expect(energyCostScale([{ energyPerDistance: null }])).toBe(1);
});
