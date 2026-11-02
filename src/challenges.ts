export type ChallengeMode = 'birdman' | 'downhill' | 'low-altitude';

export const challengeDefinitions = {
  birdman: { name: '鸟人间', length: 0 },
  downhill: { name: '高山速降', length: 5400 },
  'low-altitude': { name: '低空挑战', length: 4800 },
} as const;

export const DOWNHILL_PLAIN_START = 4300;
export function downhillHeightLimit(x: number): number { return x >= DOWNHILL_PLAIN_START ? 62.5 : 125; }

export const LOW_ALTITUDE = { scoringHeight: 25, bonusHeight: 8, scoreScale: 1000, penaltyPerSecond: 4, sustainedPenalty: 2 } as const;
export const LOW_ALTITUDE_RAIL = { height: 2, retentionAcceleration: 0.8, rollingResistance: 0.02 } as const;
export const CHALLENGE_RIVER = { width: 24, depth: 3 } as const;

/** 所有地形顶点与碰撞共用10m网格；每格沿(x0,z1)至(x1,z0)对角线分成两三角形。 */
export const challengeTerrainGrid = { minX: -600, maxX: 5600, minZ: -700, maxZ: 700, step: 10 } as const;

export function challengeCenter(challenge: ChallengeMode, x: number): number {
  const bend = Math.max(0, x) - 100 * Math.sin(Math.max(0, x) / 100);
  return challenge === 'downhill' ? 90 * Math.sin(bend / 115) + 55 * Math.sin(bend / 260) + 25 * Math.sin(bend / 63) * Math.min(1, Math.max(0, x - 400) / 600)
    : challenge === 'low-altitude' ? 55 * Math.sin(bend / 160) + 35 * Math.sin(bend / 330) + 18 * Math.sin(bend / 75) * Math.min(1, Math.max(0, x - 500) / 500) : 0;
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
    const progress = Math.max(0, x) / 5400;
    const drop = 720 * Math.max(0, Math.min(1, (x - 2400) / 350));
    return 1620 - 0.15 * x - drop + 10 * Math.sin(x / 135) * Math.max(0, 1 - progress)
      + (0.012 * offset * offset + 25 * Math.sin(x / 83) ** 2) * Math.max(0, 1 - progress)
        * Math.max(0, Math.min(1, (DOWNHILL_PLAIN_START - x) / 600))
      + 0.009 * Math.max(0, Math.abs(offset) - 180) ** 2 * Math.max(0, Math.min(1, (x - 3700) / 600))
      + (x < -35 ? Math.min(220, (-x - 35) * 2) : 0);
  }
  const riverOffset = Math.abs(z - challengeRiverCenter(x));
  const channel = Math.min(1, riverOffset / (CHALLENGE_RIVER.width / 2 + 10));
  const valley = challengeRiverHeight(x) - CHALLENGE_RIVER.depth + 7 * channel * channel;
  const mountain = 0.007 * Math.max(0, riverOffset - 35) ** 2
    + 18 * Math.sin(x / 73) ** 2 * Math.min(1, Math.max(0, riverOffset - 25) / 140);
  const natural = valley + mountain;
  // 起终点各留20m平地安全带，保证整架飞机越过轨端后才接回山谷；外围20m平滑过渡。
  const dx = Math.max(lowAltitudeRunway.startX - 20 - x, 0, x - lowAltitudeRunway.endX - 20);
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
    downhillLaunchHeight = Math.max(downhillLaunchHeight, challengeTerrainHeight('downhill', x, z) + 105);
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
  halfWidth: number; maxHeight: number;
}
function gate(challenge: ChallengeMode, x: number): ChallengeCheckpoint {
  const z = challengeCenter(challenge, x);
  return { x, z, y: challengeTerrainHeight(challenge, x, z),
    halfWidth: challenge === 'downhill' ? Math.max(Math.abs(challengeTerrainGrid.minZ - z), Math.abs(challengeTerrainGrid.maxZ - z)) + 10 : 100,
    maxHeight: challenge === 'downhill' ? downhillHeightLimit(x) : 500 };
}
const downhillStart = gate('downhill', 130), lowAltitudeStart = gate('low-altitude', 140);
export function challengeStartGate(challenge: ChallengeMode): Readonly<ChallengeCheckpoint> | null {
  return challenge === 'downhill' ? downhillStart : challenge === 'low-altitude' ? lowAltitudeStart : null;
}
const downhillCheckpoints = Array.from({ length: 30 }, (_, index) => gate('downhill', 260 + index * (5400 - 260) / 29));
const lowAltitudeCheckpoints = Array.from({ length: 30 }, (_, index) => gate('low-altitude', 280 + index * (4800 - 280) / 29));
const noCheckpoints: readonly ChallengeCheckpoint[] = [];
export function challengeCheckpoints(challenge: ChallengeMode): readonly ChallengeCheckpoint[] {
  return challenge === 'downhill' ? downhillCheckpoints : challenge === 'low-altitude' ? lowAltitudeCheckpoints : noCheckpoints;
}

export interface ChallengeRuin {
  x: number; y: number; z: number;
  width: number; height: number; length: number; yaw: number; tilt: number; radiusX: number;
}

// The same oriented boxes define concrete bodies in rendering and swept aircraft/fragment collision.
export const downhillRuinPassages = [4380, 4620, 4860, 5100, 5310].map((x,row) => ({x,offset:[-95,110,-120,85,-80][row]}));

export function downhillRouteCenter(x: number): number {
  if (x < DOWNHILL_PLAIN_START - 150) return challengeCenter('downhill', x);
  const points = [{x:DOWNHILL_PLAIN_START-150,z:challengeCenter('downhill',DOWNHILL_PLAIN_START-150)},
    ...downhillRuinPassages.flatMap(({x,offset})=>[-65,65].map(dx=>({x:x+dx,z:challengeCenter('downhill',x)+offset}))),
    {x:5400,z:challengeCenter('downhill',5400)}];
  for (let i=1;i<points.length;i++) {
    if (x <= points[i].x) {
      const a=points[i-1],b=points[i],t=Math.max(0,(x-a.x)/(b.x-a.x));
      return a.z+(b.z-a.z)*t;
    }
  }
  return challengeCenter('downhill',x);
}

export const downhillRuins: readonly ChallengeRuin[] = downhillRuinPassages.flatMap(({x,offset:gap}, row) => {
  const center = challengeCenter('downhill', x);
  const blocks: ChallengeRuin[] = [];
  // Fixed noise keeps retries, replays and collision geometry identical.
  const noise = (i: number) => { const n = Math.sin((row + 1) * 127.1 + i * 311.7) * 43758.5453; return n - Math.floor(n); };
  const add = (z: number, width: number, height: number, length: number, yaw: number, tilt: number, shift = 0, buried = false) => {
    const blockX = x + shift;
    // Fallen slabs sink into the ground instead of leaving a straight tunnel underneath.
    const halfY = (Math.abs(Math.cos(tilt)) * height + Math.abs(Math.sin(tilt)) * length) / 2;
    const radiusX = (Math.abs(Math.cos(yaw)) * width + Math.abs(Math.sin(yaw)) * (Math.abs(Math.sin(tilt)) * height + Math.abs(Math.cos(tilt)) * length)) / 2;
    blocks.push({x:blockX,y:challengeTerrainHeight('downhill',blockX,z)+halfY * (buried ? 0.5 : 1),z,width,height,length,yaw,tilt,radiusX});
  };
  for (const [left, right] of [[-750, gap - 44], [gap + 44, 750]]) {
    const count = Math.ceil((right - left) / 110), length = (right - left) / count;
    for (let i = 0; i < count; i++) {
      add(center + left + (i + 0.5) * length, 30 + noise(i + 1) * 20, 70 + noise(i + 2) * 20, length - 15, (noise(i + 3) - 0.5) * 0.5, (i % 2 ? 1 : -1) * (0.65 + noise(i + 4) * 0.45), (noise(i + 5) - 0.5) * 46, true);
    }
  }
  // Tall broken cores prevent flying straight over the fallen buildings below the height limit.
  add(center, 32, 85, 52, 0.05 * (row % 2 ? 1 : -1), 0.08);
  return blocks;
});

export function hitsChallengeRuin(challenge: ChallengeMode, a: {x:number;y:number;z:number}, b = a): boolean {
  if (challenge !== 'downhill' || Math.max(a.x,b.x) < DOWNHILL_PLAIN_START) return false;
  for (const ruin of downhillRuins) {
    if (Math.max(a.x,b.x) < ruin.x - ruin.radiusX || Math.min(a.x,b.x) > ruin.x + ruin.radiusX) continue;
    const cy = Math.cos(ruin.yaw), sy = Math.sin(ruin.yaw), ct = Math.cos(ruin.tilt), st = Math.sin(ruin.tilt);
    const ax = a.x - ruin.x, ay = a.y - ruin.y, az = a.z - ruin.z;
    const bx = b.x - ruin.x, by = b.y - ruin.y, bz = b.z - ruin.z;
    const ar = sy * ax + cy * az, br = sy * bx + cy * bz;
    let entry = 0, exit = 1;
    for (let axis = 0; axis < 3; axis++) {
      const start = axis === 0 ? cy * ax - sy * az : axis === 1 ? ct * ay + st * ar : -st * ay + ct * ar;
      const end = axis === 0 ? cy * bx - sy * bz : axis === 1 ? ct * by + st * br : -st * by + ct * br;
      const half = (axis === 0 ? ruin.width : axis === 1 ? ruin.height : ruin.length) / 2;
      const delta = end - start;
      if (Math.abs(delta) < 1e-12) {
        if (Math.abs(start) > half) { entry = Infinity; break; }
      } else {
        const first = (-half - start) / delta, last = (half - start) / delta;
        entry = Math.max(entry, Math.min(first,last)); exit = Math.min(exit, Math.max(first,last));
      }
    }
    if (entry <= exit) return true;
  }
  return false;
}
