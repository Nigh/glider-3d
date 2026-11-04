import { clone, validateAircraft, type AircraftDefinition } from './model';
import { FRAME_WIDTH, MAX_FRAMES, LAUNCH, PLATFORM, validateRecording, type InputRecording } from './physics';
import { PHYSICS_VERSION } from './storage';
import { challengeDefinitions, challengeLaunch, challengeStartGate, challengeCheckpoints, challengeGateProfile, challengeTerrainGrid, challengeTerrainHeight, challengeRiverHeight, challengeRiverCenter, downhillRuins, CHALLENGE_RIVER, LOW_ALTITUDE, LOW_ALTITUDE_RAIL, type ChallengeMode } from './challenges';

export const MAX_REPLAY_BYTES = 16 * 1024 * 1024;
export interface Replay { definition: AircraftDefinition; challenge: ChallengeMode; recording: InputRecording }

/** Hash actual deterministic map geometry, collision obstacles and scoring rules. */
export async function mapHash(challenge: ChallengeMode): Promise<string> {
  const terrain: number[] = [];
  const grid = challengeTerrainGrid;
  if (challenge !== 'birdman') {
    for (let x = grid.minX; x <= grid.maxX; x += grid.step) {
      for (let z = grid.minZ; z <= grid.maxZ; z += grid.step) terrain.push(challengeTerrainHeight(challenge, x, z));
      if (challenge === 'low-altitude') terrain.push(challengeRiverHeight(x), challengeRiverCenter(x));
    }
  }
  const start = challengeStartGate(challenge), gates = challengeCheckpoints(challenge);
  const profiles = (start ? [start, ...gates] : gates).map(gate => challengeGateProfile(challenge, gate));
  const data = JSON.stringify({ challenge, mapRevision: 1, grid, terrain, birdmanLaunch: LAUNCH, platform: PLATFORM, launch: challengeLaunch(challenge), start, gates, profiles, ruins: challenge === 'downhill' ? downhillRuins : [], river: CHALLENGE_RIVER, scoring: LOW_ALTITUDE, rail: LOW_ALTITUDE_RAIL });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

function checkedReplay(replay: Replay): Replay {
  if (!Object.hasOwn(challengeDefinitions, replay.challenge)) throw Error('未知飞行挑战');
  const definition = validateAircraft(replay.definition);
  if (replay.challenge === 'birdman' && (!definition.birdman || definition.engine.count > 0)) throw Error('鸟人间比赛只允许无动力鸟人间设计');
  validateRecording(replay.recording);
  if (!replay.recording.length) throw Error('飞行记录长度无效');
  return { definition, challenge: replay.challenge, recording: replay.recording };
}

export async function exportReplay(replay: Replay): Promise<string> {
  const checked = checkedReplay(replay);
  // Snapshot before hashing: the caller may start another flight while awaiting it.
  const data = { format: 'aero-formula-replay', version: 1, physicsVersion: PHYSICS_VERSION, challenge: checked.challenge, definition: clone(checked.definition), recording: { ...checked.recording, frames: Array.from(checked.recording.frames) } };
  return JSON.stringify({ ...data, mapHash: await mapHash(checked.challenge) });
}

export async function importReplay(text: string): Promise<Replay> {
  if (new TextEncoder().encode(text).length > MAX_REPLAY_BYTES) throw Error('回放文件超过 16 MB');
  let data;
  try { data = JSON.parse(text); } catch { throw Error('回放文件格式无效'); }
  if (!data || data.format !== 'aero-formula-replay' || data.version !== 1) throw Error('回放文件格式无效');
  if (data.physicsVersion !== PHYSICS_VERSION) throw Error('回放物理版本不匹配');
  if (!Object.hasOwn(challengeDefinitions, data.challenge)) throw Error('未知飞行挑战');
  const recording = data.recording;
  if (!recording || !Array.isArray(recording.frames) || recording.frames.length > MAX_FRAMES * FRAME_WIDTH || recording.frames.some((value: unknown) => typeof value !== 'number')) throw Error('飞行记录包含无效输入');
  const replay = checkedReplay({ definition: data.definition, challenge: data.challenge, recording: { ...recording, frames: new Float64Array(recording.frames) } });
  if (data.mapHash !== await mapHash(replay.challenge)) throw Error('回放地图不匹配');
  return replay;
}
