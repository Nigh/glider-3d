export interface EnergyCostSample { energyPerDistance: number | null; waterContact?: boolean }

/** Keep brief water/skimming spikes from flattening the useful flight trace. */
export function energyCostScale(samples: readonly EnergyCostSample[]): number {
  const finite = (sample: EnergyCostSample) => sample.energyPerDistance !== null
    && Number.isFinite(sample.energyPerDistance) && sample.energyPerDistance >= 0;
  let values = samples.filter(sample => !sample.waterContact && finite(sample)).map(sample => sample.energyPerDistance as number);
  if (!values.length) values = samples.filter(finite).map(sample => sample.energyPerDistance as number);
  if (!values.length) return 1;
  values.sort((a, b) => a - b);
  if (values.length < 20) return Math.max(1, values[values.length - 1]);
  const percentile95 = values[Math.floor((values.length - 1) * 0.95)];
  return Math.max(1, percentile95 * 1.12);
}
