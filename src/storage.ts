import { clone, validateAircraft, type AircraftDefinition, type FlightMode } from './model';
import type { ChallengeMode } from './challenges';

export interface SavedAircraft {
  id: string;
  name: string;
  definition: AircraftDefinition;
  updatedAt: number;
}

const AIRCRAFT_PREFIX = 'lakewind.aircraft.';
// 旧版重心计距与新版机体最后尾计距不可混榜；保留旧存储数据，不迁移为新成绩。
const BEST_PREFIX = 'lakewind.best.official-v1.';

function storageCall<T>(operation: (storage: Storage) => T): T {
  try {
    return operation(globalThis.localStorage);
  } catch (error) {
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      throw new Error('本地存储空间已满，请导出飞机备份后清理空间。');
    }
    throw new Error('无法访问浏览器本地存储，请允许本站保存数据后重试。');
  }
}

function checkedDefinition(value: unknown): AircraftDefinition {
  try {
    return validateAircraft(value);
  } catch (error) {
    throw new Error(`飞机数据无效：${error instanceof Error ? error.message : '请检查参数和翼面几何。'}`);
  }
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    throw new Error('飞机数据无法转换为 JSON，请检查导入数据。');
  }
}

function readRecord(id: string, raw: string): SavedAircraft {
  const record: unknown = JSON.parse(raw);
  if (!record || typeof record !== 'object') throw new Error('保存记录无效');
  const saved = record as SavedAircraft;
  if (saved.id !== id || typeof saved.updatedAt !== 'number' || !Number.isFinite(saved.updatedAt) || saved.updatedAt < 0) {
    throw new Error('保存记录无效');
  }
  const definition = checkedDefinition(saved.definition);
  if (saved.name !== definition.name) throw new Error('保存名称不一致');
  return { id, name: definition.name, definition, updatedAt: saved.updatedAt };
}

function requireAircraft(id: string): SavedAircraft {
  const raw = storageCall(storage => storage.getItem(AIRCRAFT_PREFIX + id));
  if (raw === null) throw new Error('未找到这架飞机，可能已被删除。');
  try {
    return readRecord(id, raw);
  } catch {
    throw new Error('这架飞机的本地记录已损坏；原始数据仍然保留。');
  }
}

export function listAircraft(): SavedAircraft[] {
  const records = storageCall(storage => {
    const result: [string, string][] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(AIRCRAFT_PREFIX)) continue;
      const raw = storage.getItem(key);
      if (raw !== null) result.push([key.slice(AIRCRAFT_PREFIX.length), raw]);
    }
    return result;
  });
  const aircraft: SavedAircraft[] = [];
  for (const [id, raw] of records) {
    try {
      aircraft.push(readRecord(id, raw));
    } catch {
      // Keep damaged entries untouched; one damaged aircraft must not hide the others.
    }
  }
  return aircraft.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveAircraft(definition: AircraftDefinition, id?: string): SavedAircraft {
  const checked = checkedDefinition(definition);
  if (id !== undefined) requireAircraft(id);
  const saved: SavedAircraft = {
    id: id ?? (globalThis.crypto.randomUUID?.() ?? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('')),
    name: checked.name,
    definition: checked,
    updatedAt: Date.now(),
  };
  const json = serialize(saved);
  storageCall(storage => storage.setItem(AIRCRAFT_PREFIX + saved.id, json));
  return saved;
}

export function deleteAircraft(id: string): void {
  storageCall(storage => storage.removeItem(AIRCRAFT_PREFIX + id));
}

export function renameAircraft(id: string, name: string): SavedAircraft {
  const saved = requireAircraft(id);
  return saveAircraft({ ...saved.definition, name }, id);
}

export function duplicateAircraft(id: string): SavedAircraft {
  const saved = requireAircraft(id);
  return saveAircraft({ ...saved.definition, name: `${saved.name.slice(0, 57)} 副本` });
}

export function exportAircraft(definition: AircraftDefinition): string {
  return serialize(checkedDefinition(definition));
}

export function importAircraft(json: string): AircraftDefinition {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('无法读取 JSON，请选择有效的飞机 JSON 文件。');
  }
  return checkedDefinition(value);
}

export function readBest(mode: FlightMode, challenge: ChallengeMode = 'birdman'): number {
  const raw = storageCall(storage => storage.getItem(BEST_PREFIX + (challenge === 'birdman' ? mode : `${challenge}.${mode}`)));
  if (raw === null) return 0;
  const distance = Number(raw);
  if (!raw.trim() || !Number.isFinite(distance) || distance < 0) {
    throw new Error('本地最远纪录已损坏；原始数据仍然保留。');
  }
  return distance;
}

export function writeBest(mode: FlightMode, distance: number, challenge: ChallengeMode = 'birdman'): number {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('成绩必须是非负有限数值。');
  const previous = readBest(mode, challenge);
  const best = challenge === 'downhill' ? (previous > 0 ? Math.min(previous, distance) : distance) : Math.max(previous, distance);
  storageCall(storage => storage.setItem(BEST_PREFIX + (challenge === 'birdman' ? mode : `${challenge}.${mode}`), String(best)));
  return best;
}

export class History<T> {
  private snapshots: T[];
  private index = 0;

  constructor(initial: T) {
    this.snapshots = [clone(initial)];
  }

  get current(): T { return clone(this.snapshots[this.index]); }
  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.snapshots.length - 1; }

  push(value: T): void {
    const snapshot = clone(value);
    this.snapshots.splice(this.index + 1);
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 60) this.snapshots.shift();
    this.index = this.snapshots.length - 1;
  }

  undo(): T {
    if (this.canUndo) this.index--;
    return this.current;
  }

  redo(): T {
    if (this.canRedo) this.index++;
    return this.current;
  }
}
