export type ChallengeMode = 'birdman' | 'downhill';

export const challengeDefinitions = {
  birdman: { name: '鸟人间', length: 0, startHeight: 10, startSpeed: 10 },
  downhill: { name: '高山速降', length: 1800, startHeight: 690, startSpeed: 26 },
} as const;

/** 所有地形顶点与碰撞共用10m网格；每格沿(x0,z1)至(x1,z0)对角线分成两三角形。 */
export const challengeTerrainGrid = { minX: -200, maxX: 2000, minZ: -700, maxZ: 700, step: 10 } as const;

export function challengeCenter(challenge: ChallengeMode, x: number): number {
  return challenge === 'downhill' ? 90 * Math.sin(x / 230) + 60 * Math.sin(x / 510) : 0;
}

function terrainVertex(x: number, z: number): number {
  const offset = z - challengeCenter('downhill', x);
  return 620 - 0.3 * x + 8 * Math.sin(x / 170) + 0.018 * offset * offset;
}

/** 分片平面，而非渲染网格外的隐藏解析曲面。鸟人间保持连续水面Y=0。 */
export function challengeTerrainHeight(challenge: ChallengeMode, x: number, z: number): number {
  if (challenge === 'birdman') return 0;
  const step = challengeTerrainGrid.step;
  const x0 = Math.floor(x / step) * step, z0 = Math.floor(z / step) * step;
  const tx = (x - x0) / step, tz = (z - z0) / step;
  const a = terrainVertex(x0, z0 + step), b = terrainVertex(x0 + step, z0);
  if (tx + tz <= 1) {
    const c = terrainVertex(x0, z0);
    return c + (b - c) * tx + (a - c) * tz;
  }
  const c = terrainVertex(x0 + step, z0 + step);
  return c + (a - c) * (1 - tx) + (b - c) * (1 - tz);
}

export interface ChallengeCheckpoint {
  x: number; y: number; z: number;
  halfWidth: number; minHeight: number; maxHeight: number;
}

const downhillCheckpoints: readonly ChallengeCheckpoint[] = Array.from({ length: 10 }, (_, index) => {
  const x = (index + 1) * 180, z = challengeCenter('downhill', x);
  return { x, z, y: challengeTerrainHeight('downhill', x, z), halfWidth: 65, minHeight: 3, maxHeight: 125 };
});
const noCheckpoints: readonly ChallengeCheckpoint[] = [];
export function challengeCheckpoints(challenge: ChallengeMode): readonly ChallengeCheckpoint[] {
  return challenge === 'downhill' ? downhillCheckpoints : noCheckpoints;
}
