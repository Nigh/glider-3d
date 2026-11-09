import { clone, validateAircraft, type AircraftDefinition } from './model';
import { FRAME_WIDTH, MAX_FRAMES, LAUNCH, PLATFORM, validateRecording, restoreReplayKeyframe, type InputRecording, type ReplayKeyframe, type SimulationSnapshot } from './physics';
import { PHYSICS_VERSION, isAircraftCompatible } from './storage';
import { isLaboratory } from './laboratory';
import { challengeDefinitions, challengeLaunch, challengeStartGate, challengeCheckpoints, challengeGateProfile, challengeTerrainGrid, challengeTerrainHeight, challengeRiverHeight, challengeRiverCenter, downhillRuins, CHALLENGE_RIVER, LOW_ALTITUDE, LOW_ALTITUDE_RAIL, type ChallengeMode } from './challenges';
import { prepareReplay } from './playback';

export const MAX_REPLAY_BYTES = 16 * 1024 * 1024;
export const MAX_KEYFRAME_BYTES = 128 * 1024 * 1024;
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
  if (isLaboratory(replay.challenge)) throw Error('测试环境不支持回放');
  if (!Object.hasOwn(challengeDefinitions, replay.challenge)) throw Error('未知飞行挑战');
  const definition = validateAircraft(replay.definition);
  if (replay.challenge === 'birdman' && (!definition.birdman || definition.engine.count > 0)) throw Error('鸟人间比赛只允许无动力鸟人间设计');
  if (!isAircraftCompatible(definition, replay.challenge)) throw Error('当前挑战不可使用鸟人间飞机，请选择普通飞机。');
  validateRecording(replay.recording);
  if (!replay.recording.length) throw Error('飞行记录长度无效');
  return { definition, challenge: replay.challenge, recording: replay.recording };
}

export async function exportReplay(replay: Replay): Promise<string> {
  const checked = checkedReplay(replay);
  // Snapshot before yielding: callers may edit the design or start another flight.
  const snapshot = clone(checked);
  await prepareReplay(snapshot);
  await validateKeyframeStates(snapshot);
  const keyframeText = JSON.stringify(snapshot.recording.keyframes);
  if (new TextEncoder().encode(keyframeText).byteLength > MAX_KEYFRAME_BYTES) throw Error('回放关键帧超过 128 MB');
  const encoded = new Uint8Array(await new Response(new Blob([keyframeText]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let binary = '';
  for (let i = 0; i < encoded.length; i += 32768) binary += String.fromCharCode(...encoded.subarray(i, i + 32768));
  const data = { format: 'aero-formula-replay', version: 1, physicsVersion: PHYSICS_VERSION, challenge: snapshot.challenge, definition: snapshot.definition, recording: { length: snapshot.recording.length, launchRoll: snapshot.recording.launchRoll, frames: Array.from(snapshot.recording.frames), wingLoads: snapshot.recording.wingLoads ? Array.from(snapshot.recording.wingLoads) : undefined, keyframeEncoding: 'gzip-base64', keyframeData: btoa(binary) } };
  const text = JSON.stringify({ ...data, mapHash: await mapHash(snapshot.challenge) });
  if (new TextEncoder().encode(text).length > MAX_REPLAY_BYTES) throw Error('回放文件超过 16 MB');
  return text;
}

async function validateKeyframeStates(replay: Replay) {
  let deadline = performance.now() + 8;
  for (const point of replay.recording.keyframes ?? []) {
    restoreReplayKeyframe(replay.definition, replay.challenge, replay.recording, point);
    if (performance.now() >= deadline) {
      await new Promise(resolve => setTimeout(resolve, 0));
      deadline = performance.now() + 8;
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function parseKeyframes(value: unknown): ReplayKeyframe[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_FRAMES + 1) throw Error('回放关键帧无效');
  const parseValue = (item: unknown): SimulationSnapshot['extra'][number][2][number] => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item) && item.length === 1 && typeof item[0] === 'number' && Number.isInteger(item[0])) return [item[0]];
    throw Error('回放关键帧状态无效');
  };
  return value.map(point => {
    if (!isObject(point) || typeof point.time !== 'number' || typeof point.frame !== 'number' || !isObject(point.state)) throw Error('回放关键帧无效');
    const state = point.state;
    if (typeof state.binding !== 'string' || !Array.isArray(state.changes) || !Array.isArray(state.extra)) throw Error('回放关键帧状态无效');
    const changes: SimulationSnapshot['changes'] = state.changes.map(change => {
      if (!Array.isArray(change) || change.length !== 2 || typeof change[0] !== 'number' || !Array.isArray(change[1])) throw Error('回放关键帧状态无效');
      return [change[0], change[1].map(parseValue)];
    });
    const extra: SimulationSnapshot['extra'] = state.extra.map(node => {
      if (!Array.isArray(node) || node.length !== 3 || typeof node[0] !== 'string' || !Array.isArray(node[1]) || !Array.isArray(node[2]) || !node[1].every(key => typeof key === 'string')) throw Error('回放关键帧状态无效');
      return [node[0], node[1], node[2].map(parseValue)];
    });
    return { time: point.time, frame: point.frame, state: { binding: state.binding, changes, extra } };
  });
}

async function decodeKeyframes(recording: Record<string, unknown>) {
  if (recording.keyframeData === undefined) {
    if (recording.keyframeEncoding !== undefined) throw Error('回放关键帧编码无效');
    return parseKeyframes(recording.keyframes);
  }
  if (recording.keyframes !== undefined || recording.keyframeEncoding !== 'gzip-base64' || typeof recording.keyframeData !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(recording.keyframeData)) throw Error('回放关键帧编码无效');
  try {
    const compressed = Uint8Array.from(atob(recording.keyframeData), character => character.charCodeAt(0));
    const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0, text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_KEYFRAME_BYTES) { await reader.cancel(); throw Error('回放关键帧超过 128 MB'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return parseKeyframes(JSON.parse(text));
  } catch (error) {
    if (error instanceof Error && error.message.includes('128 MB')) throw error;
    throw Error('回放关键帧编码无效');
  }
}

export async function importReplay(text: string): Promise<Replay> {
  if (new TextEncoder().encode(text).length > MAX_REPLAY_BYTES) throw Error('回放文件超过 16 MB');
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw Error('回放文件格式无效'); }
  if (!isObject(data) || data.format !== 'aero-formula-replay' || data.version !== 1) throw Error('回放文件格式无效');
  if (data.physicsVersion !== PHYSICS_VERSION) throw Error('回放物理版本不匹配');
  if (typeof data.challenge !== 'string' || !Object.hasOwn(challengeDefinitions, data.challenge)) throw Error('未知飞行挑战');
  // Membership is checked against the canonical challenge registry above.
  const challenge = data.challenge as ChallengeMode;
  const recording = data.recording;
  if (!isObject(recording) || !Array.isArray(recording.frames) || recording.frames.length > MAX_FRAMES * FRAME_WIDTH || !recording.frames.every(value => typeof value === 'number')) throw Error('飞行记录包含无效输入');
  if (recording.wingLoads !== undefined && (!Array.isArray(recording.wingLoads) || !recording.wingLoads.every(value => typeof value === 'number'))) throw Error('飞行记录包含无效负载');
  if (typeof recording.length !== 'number' || typeof recording.launchRoll !== 'number') throw Error('飞行记录长度无效');
  const replay = checkedReplay({ definition: validateAircraft(data.definition), challenge, recording: { length: recording.length, launchRoll: recording.launchRoll, frames: new Float64Array(recording.frames), wingLoads: recording.wingLoads === undefined ? undefined : new Float64Array(recording.wingLoads as number[]), keyframes: await decodeKeyframes(recording) } });
  if (data.mapHash !== await mapHash(replay.challenge)) throw Error('回放地图不匹配');
  await validateKeyframeStates(replay);
  await prepareReplay(replay);
  return replay;
}
