/** Keep ordinary airborne energy costs readable without discarding raw samples. */
export function energyCostScale(samples: readonly { energyPerDistance: number | null; waterContact: boolean }[]): number {
  const values = samples.filter(p => !p.waterContact && p.energyPerDistance !== null && Number.isFinite(p.energyPerDistance) && p.energyPerDistance >= 0)
    .map(p => p.energyPerDistance!).sort((a, b) => a - b);
  if (!values.length) return 1;
  const median = values[Math.floor((values.length - 1) / 2)];
  const q1 = values[Math.floor((values.length - 1) * 0.25)], q3 = values[Math.floor((values.length - 1) * 0.75)];
  return Math.max(1, Math.min(values[values.length - 1], Math.max(median * 3, q3 + 1.5 * (q3 - q1))));
}
