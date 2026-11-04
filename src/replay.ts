import { clone, validateAircraft, type AircraftDefinition } from './model';
import { challengeDefinitions, challengeMapHash, type ChallengeMode } from './challenges';
import { LAUNCH_ROLL_LIMIT, type InputRecording } from './physics';
import { PHYSICS_VERSION } from './storage';

export const REPLAY_FORMAT = 'glider-3d-replay';
export const REPLAY_FORMAT_VERSION = 1;
const FRAME_WIDTH = 11;
const MAX_FRAMES = 36_000;

export interface ReplayBundle {
  challenge: ChallengeMode;
  aircraft: AircraftDefinition;
  recording: InputRecording;
}

interface ReplayDocument {
  format: typeof REPLAY_FORMAT;
  version: typeof REPLAY_FORMAT_VERSION;
  physicsVersion: string;
  mapHash: string;
  challenge: ChallengeMode;
  aircraft: AircraftDefinition;
  recording: { length: number; launchRoll: number; frames: number[] };
}

function serialize(value: unknown): string {
  try { return JSON.stringify(value); }
  catch { throw new Error('回放数据无法转换为 JSON。'); }
}

export function exportReplay(aircraft: AircraftDefinition, challenge: ChallengeMode, recording: InputRecording): string {
  const definition = validateAircraft(aircraft);
  validateRecording(recording);
  const document: ReplayDocument = {
    format: REPLAY_FORMAT,
    version: REPLAY_FORMAT_VERSION,
    physicsVersion: PHYSICS_VERSION,
    mapHash: challengeMapHash(challenge),
    challenge,
    aircraft: clone(definition),
    recording: { length: recording.length, launchRoll: recording.launchRoll, frames: Array.from(recording.frames.slice(0, recording.length * FRAME_WIDTH)) },
  };
  return serialize(document);
}

export function importReplay(json: string): ReplayBundle {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { throw new Error('无法读取回放 JSON，请选择有效的回放文件。'); }
  if (!value || typeof value !== 'object') throw new Error('回放文件格式无效。');
  const document = value as Partial<ReplayDocument>;
  if (document.format !== REPLAY_FORMAT || document.version !== REPLAY_FORMAT_VERSION) throw new Error('回放文件版本不受支持。');
  if (document.physicsVersion !== PHYSICS_VERSION) throw new Error('回放物理版本与当前版本不匹配。');
  if (typeof document.challenge !== 'string' || !Object.hasOwn(challengeDefinitions, document.challenge)) throw new Error('回放挑战类型无效。');
  const challenge = document.challenge as ChallengeMode;
  if (document.mapHash !== challengeMapHash(challenge)) throw new Error('回放地图与当前地图不匹配。');
  const aircraft = validateAircraft(document.aircraft);
  const source = document.recording;
  if (!source || !Array.isArray(source.frames)) throw new Error('回放输入记录无效。');
  const recording: InputRecording = { frames: Float64Array.from(source.frames), length: source.length, launchRoll: source.launchRoll };
  validateRecording(recording);
  return { challenge, aircraft, recording };
}

function validateRecording(recording: InputRecording): void {
  if (!Number.isInteger(recording.length) || recording.length < 0 || recording.length > MAX_FRAMES
    || recording.frames.length !== recording.length * FRAME_WIDTH) throw new Error('回放输入记录长度无效。');
  if (!Number.isFinite(recording.launchRoll) || Math.abs(recording.launchRoll) > LAUNCH_ROLL_LIMIT) throw new Error('回放离台滚转角无效。');
  for (let index = 0; index < recording.frames.length; index++) {
    const value = recording.frames[index];
    if (!Number.isFinite(value) || (index % FRAME_WIDTH === 0 && (value <= 0 || value > 0.25))) throw new Error('回放包含无效输入。');
  }
}
