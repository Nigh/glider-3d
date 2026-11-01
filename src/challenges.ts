export type ChallengeMode = 'birdman' | 'downhill' | 'low-altitude';

export const challengeDefinitions = {
  birdman: { name: '鸟人间', length: 0 },
  downhill: { name: '高山速降', length: 1800 },
  'low-altitude': { name: '低空挑战', length: 1600 },
} as const;

export const LOW_ALTITUDE = { scoringHeight: 25, scoreScale: 1000, penaltyPerSecond: 4, sustainedPenalty: 2 } as const;
export const CHALLENGE_RIVER = { width: 24, depth: 3 } as const;

/** 所有地形顶点与碰撞共用10m网格；每格沿(x0,z1)至(x1,z0)对角线分成两三角形。 */
export const challengeTerrainGrid = { minX: -600, maxX: 2000, minZ: -700, maxZ: 700, step: 10 } as const;

export function challengeCenter(challenge: ChallengeMode, x: number): number {
  const bend = Math.max(0, x) - 100 * Math.sin(Math.max(0, x) / 100);
  return challenge === 'downhill' ? 90 * Math.sin(bend / 115) + 55 * Math.sin(bend / 260)
    : challenge === 'low-altitude' ? 55 * Math.sin(bend / 160) + 35 * Math.sin(bend / 330) : 0;
}

export function challengeRiverCenter(x: number): number {
  const x0 = Math.floor(x / challengeTerrainGrid.step) * challengeTerrainGrid.step;
  const fraction = (x - x0) / challengeTerrainGrid.step;
  return 55 + challengeCenter('low-altitude', x0) * (1 - fraction)
    + challengeCenter('low-altitude', x0 + challengeTerrainGrid.step) * fraction;
}
function riverHeightVertex(x: number): number {
  const forward = Math.max(0, x);
  return 32 + 16 * Math.sin(forward / 100) + 8 * Math.sin(forward / 48);
}
export function challengeRiverHeight(x: number): number {
  const x0 = Math.floor(x / challengeTerrainGrid.step) * challengeTerrainGrid.step;
  const fraction = (x - x0) / challengeTerrainGrid.step;
  return riverHeightVertex(x0) * (1 - fraction) + riverHeightVertex(x0 + challengeTerrainGrid.step) * fraction;
}

export interface ChallengeLaunch {
  kind: 'catapult' | 'runway';
  startX: number; endX: number; z: number; y: number;
  width: number; length: number; slope: number; thickness: number;
  speed: number; acceleration: number;
}

const lowAltitudeRunway: Readonly<ChallengeLaunch> = {
  kind: 'runway', startX: -420, endX: -20, z: -40, y: 35,
  width: 32, length: 400, slope: 0, thickness: 0.2, speed: 0, acceleration: 0,
};

function terrainVertex(challenge: ChallengeMode, x: number, z: number): number {
  const offset = z - challengeCenter(challenge, x);
  if (challenge === 'downhill') {
    // 山脊在弹射台后方抬升；前方谷底快速下降，两侧山峰形成曲折谷道。
    return 620 - 0.30 * x + 10 * Math.sin(x / 135) + 0.012 * offset * offset
      + (x < -35 ? Math.min(220, (-x - 35) * 2) : 0);
  }
  const riverOffset = Math.abs(z - challengeRiverCenter(x));
  const channel = Math.min(1, riverOffset / (CHALLENGE_RIVER.width / 2 + 10));
  const valley = challengeRiverHeight(x) - CHALLENGE_RIVER.depth + 7 * channel * channel;
  const mountain = 0.007 * Math.max(0, riverOffset - 35) ** 2
    + 18 * Math.sin(x / 73) ** 2 * Math.min(1, Math.max(0, riverOffset - 25) / 140);
  const natural = valley + mountain;
  // 跑道及两侧安全带使用同一平整地形，外围20m平滑接回山谷。
  const dx = Math.max(lowAltitudeRunway.startX - 20 - x, 0, x - lowAltitudeRunway.endX);
  const dz = Math.max(0, Math.abs(z - lowAltitudeRunway.z) - lowAltitudeRunway.width / 2 - 10);
  const blend = Math.min(1, Math.max(dx, dz) / 20);
  return lowAltitudeRunway.y + (natural - lowAltitudeRunway.y) * blend;
}

/** 分片平面，而非渲染网格外的隐藏解析曲面。鸟人间保持连续水面Y=0。 */
export function challengeTerrainHeight(challenge: ChallengeMode, x: number, z: number): number {
  if (challenge === 'birdman') return 0;
  const step = challengeTerrainGrid.step;
  const x0 = Math.floor(x / step) * step, z0 = Math.floor(z / step) * step;
  const tx = (x - x0) / step, tz = (z - z0) / step;
  const a = terrainVertex(challenge, x0, z0 + step), b = terrainVertex(challenge, x0 + step, z0);
  if (tx + tz <= 1) {
    const c = terrainVertex(challenge, x0, z0);
    return c + (b - c) * tx + (a - c) * tz;
  }
  const c = terrainVertex(challenge, x0 + step, z0 + step);
  return c + (a - c) * (1 - tx) + (b - c) * (1 - tz);
}

/** 河面与三角地形共同构成接触表面；河面沿每个10m断面线性连接。 */
export function challengeCollisionHeight(challenge: ChallengeMode, x: number, z: number): number {
  const terrain = challengeTerrainHeight(challenge, x, z);
  return challenge === 'low-altitude' && Math.abs(z - challengeRiverCenter(x)) <= CHALLENGE_RIVER.width / 2
    ? Math.max(terrain, challengeRiverHeight(x)) : terrain;
}

let downhillLaunchHeight = -Infinity;
for (let x = -20; x <= 0; x += challengeTerrainGrid.step) {
  for (let z = -20; z <= 20; z += challengeTerrainGrid.step) {
    downhillLaunchHeight = Math.max(downhillLaunchHeight, challengeTerrainHeight('downhill', x, z) + 55);
  }
}
const downhillLaunch: Readonly<ChallengeLaunch> = {
  kind: 'catapult', startX: -20, endX: 0, z: 0, y: downhillLaunchHeight,
  width: 40, length: 20, slope: 0, thickness: 0.8, speed: 20, acceleration: 10,
};
export function challengeLaunch(challenge: ChallengeMode): Readonly<ChallengeLaunch> | null {
  return challenge === 'downhill' ? downhillLaunch : challenge === 'low-altitude' ? lowAltitudeRunway : null;
}

export interface ChallengeCheckpoint {
  x: number; y: number; z: number;
  halfWidth: number; minHeight: number; maxHeight: number;
}
function gate(challenge: ChallengeMode, x: number): ChallengeCheckpoint {
  const z = challengeCenter(challenge, x);
  return { x, z, y: challengeTerrainHeight(challenge, x, z), halfWidth: challenge === 'downhill' ? 65 : 100,
    minHeight: 3, maxHeight: challenge === 'downhill' ? 125 : 500 };
}
const downhillStart = gate('downhill', 130), lowAltitudeStart = gate('low-altitude', 140);
export function challengeStartGate(challenge: ChallengeMode): Readonly<ChallengeCheckpoint> | null {
  return challenge === 'downhill' ? downhillStart : challenge === 'low-altitude' ? lowAltitudeStart : null;
}
const downhillCheckpoints = Array.from({ length: 10 }, (_, index) => gate('downhill', 260 + index * (1800 - 260) / 9));
const lowAltitudeCheckpoints = Array.from({ length: 10 }, (_, index) => gate('low-altitude', 280 + index * (1600 - 280) / 9));
const noCheckpoints: readonly ChallengeCheckpoint[] = [];
export function challengeCheckpoints(challenge: ChallengeMode): readonly ChallengeCheckpoint[] {
  return challenge === 'downhill' ? downhillCheckpoints : challenge === 'low-altitude' ? lowAltitudeCheckpoints : noCheckpoints;
}
