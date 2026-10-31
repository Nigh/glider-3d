import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clone, defaultAircraft } from '../src/model';
import {
  deleteAircraft, duplicateAircraft, exportAircraft, History, importAircraft,
  listAircraft, readBest, renameAircraft, saveAircraft, writeBest,
} from '../src/storage';

class MemoryStorage implements Storage {
  private records = new Map<string, string>();
  get length(): number { return this.records.size; }
  clear(): void { this.records.clear(); }
  getItem(key: string): string | null { return this.records.get(key) ?? null; }
  key(index: number): string | null { return [...this.records.keys()][index] ?? null; }
  removeItem(key: string): void { this.records.delete(key); }
  setItem(key: string, value: string): void { this.records.set(key, String(value)); }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  let nextId = 0;
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('crypto', { randomUUID: () => `aircraft-${++nextId}` });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  storage.clear();
});

function keyFor(id: string): string {
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)!;
    if (key.endsWith(id)) return key;
  }
  throw new Error('测试记录不存在');
}

describe('飞机 JSON 信任边界', () => {
  it('导出与导入往返，并返回独立数据', () => {
    const definition = clone(defaultAircraft);
    const imported = importAircraft(exportAircraft(definition));
    expect(imported).toEqual(definition);
    imported.mainWing.points[0].x = 0.1;
    expect(definition.mainWing.points[0].x).toBe(0);
  });

  it('拒绝坏 JSON 和不完整对象', () => {
    expect(() => importAircraft('{broken')).toThrow('无法读取 JSON');
    expect(() => importAircraft('null')).toThrow('飞机数据无效');
    expect(() => importAircraft('{}')).toThrow('飞机数据无效');
  });

  it('导入、导出和保存均拒绝非法几何，不覆盖有效记录', () => {
    const saved = saveAircraft(defaultAircraft);
    const invalid = clone(defaultAircraft);
    invalid.mainWing.points[2].x = invalid.mainWing.points[1].x;
    expect(() => importAircraft(JSON.stringify(invalid))).toThrow('翼面不得自交');
    expect(() => exportAircraft(invalid)).toThrow('翼面不得自交');
    expect(() => saveAircraft(invalid, saved.id)).toThrow('翼面不得自交');
    expect(listAircraft()).toEqual([saved]);
  });
});

describe('飞机本地保存', () => {
  it('新增、覆盖、改名、复制和删除完整往返', () => {
    const input = clone(defaultAircraft);
    const first = saveAircraft(input);
    expect(first).toMatchObject({ name: input.name, definition: input });
    expect(typeof first.updatedAt).toBe('number');
    input.name = '未保存的改动';
    expect(listAircraft()[0].definition.name).toBe(defaultAircraft.name);

    const changed = clone(first.definition);
    changed.cockpit.position = 1.8;
    expect(saveAircraft(changed, first.id).id).toBe(first.id);
    expect(listAircraft()).toHaveLength(1);
    expect(listAircraft()[0].definition.cockpit.position).toBe(1.8);
    const renamed = renameAircraft(first.id, '新机名');
    expect(renamed.name).toBe('新机名');
    expect(renamed.definition.name).toBe('新机名');

    const copied = duplicateAircraft(first.id);
    expect(copied.id).not.toBe(first.id);
    expect(copied.name).toBe('新机名 副本');
    expect(copied.definition.cockpit.position).toBe(1.8);
    expect(listAircraft()).toHaveLength(2);
    deleteAircraft(first.id);
    expect(listAircraft()).toEqual([copied]);
    deleteAircraft(copied.id);
    expect(listAircraft()).toEqual([]);
  });

  it('读取结果不能修改已保存数据，按更新时间降序排列', () => {
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValueOnce(10).mockReturnValueOnce(20);
    const first = saveAircraft(defaultAircraft);
    const second = saveAircraft(defaultAircraft);
    const listed = listAircraft();
    expect(listed.map(record => record.id)).toEqual([second.id, first.id]);
    listed[0].definition.name = '未保存的修改';
    expect(listAircraft()[0].name).toBe(defaultAircraft.name);
  });

  it('长名称复制保持60字符上限，非法改名保留原记录', () => {
    const saved = saveAircraft({ ...defaultAircraft, name: '机'.repeat(60) });
    expect(duplicateAircraft(saved.id).name).toHaveLength(60);
    expect(() => renameAircraft(saved.id, '')).toThrow('名称长度');
    expect(listAircraft().find(record => record.id === saved.id)).toEqual(saved);
  });

  it('不存在的记录不能被改名、复制或覆盖', () => {
    expect(() => renameAircraft('missing', '名字')).toThrow('未找到');
    expect(() => duplicateAircraft('missing')).toThrow('未找到');
    expect(() => saveAircraft(defaultAircraft, 'missing')).toThrow('未找到');
    expect(listAircraft()).toEqual([]);
  });

  it('坏JSON、非法几何和非法元数据只跳过单条，并保留原始数据', () => {
    const brokenJson = saveAircraft(defaultAircraft);
    const brokenGeometry = saveAircraft(defaultAircraft);
    const brokenMetadata = saveAircraft(defaultAircraft);
    const healthy = saveAircraft(defaultAircraft);
    const jsonKey = keyFor(brokenJson.id);
    const geometryKey = keyFor(brokenGeometry.id);
    const metadataKey = keyFor(brokenMetadata.id);
    storage.setItem(jsonKey, '{broken');
    brokenGeometry.definition.horizontalTail.points[1].y = -1;
    storage.setItem(geometryKey, JSON.stringify(brokenGeometry));
    storage.setItem(metadataKey, JSON.stringify({ ...brokenMetadata, updatedAt: 'yesterday' }));
    storage.setItem('another-app', 'not JSON');
    expect(listAircraft()).toEqual([healthy]);
    saveAircraft(defaultAircraft);
    expect(listAircraft()).toHaveLength(2);
    expect(storage.getItem(jsonKey)).toBe('{broken');
    expect(storage.getItem(geometryKey)).toBe(JSON.stringify(brokenGeometry));
    expect(storage.getItem(metadataKey)).toContain('yesterday');
    expect(storage.getItem('another-app')).toBe('not JSON');
    expect(() => renameAircraft(brokenJson.id, '修复')).toThrow('已损坏');
    expect(() => saveAircraft(defaultAircraft, brokenJson.id)).toThrow('已损坏');
    deleteAircraft(brokenJson.id);
    expect(storage.getItem(jsonKey)).toBeNull();
  });

  it('本地存储不可用时抛出可显示中文错误', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => listAircraft()).toThrow('无法访问浏览器本地存储');
    expect(() => saveAircraft(defaultAircraft)).toThrow('无法访问浏览器本地存储');
    expect(() => deleteAircraft('missing')).toThrow('无法访问浏览器本地存储');
    expect(() => readBest('standard')).toThrow('无法访问浏览器本地存储');
  });

  it('存储读取被拒绝时不伪装成空列表', () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    storage.setItem('lakewind.aircraft.aircraft-1', '{}');
    expect(() => listAircraft()).toThrow('无法访问浏览器本地存储');
  });

  it('配额满时保留旧数据并抛出中文错误', () => {
    const saved = saveAircraft(defaultAircraft);
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      const error = new Error('full');
      error.name = 'QuotaExceededError';
      throw error;
    });
    expect(() => renameAircraft(saved.id, '不能保存')).toThrow('本地存储空间已满');
    expect(() => saveAircraft(defaultAircraft)).toThrow('本地存储空间已满');
    expect(listAircraft()).toEqual([saved]);
  });
});

describe('最远纪录', () => {
  it('按模式隔离，仅保留最大有限非负距离', () => {
    expect(readBest('standard')).toBe(0);
    expect(writeBest('standard', 84.88)).toBe(84.88);
    expect(writeBest('standard', 20)).toBe(84.88);
    expect(readBest('standard')).toBe(84.88);
    expect(readBest('assisted')).toBe(0);
    expect(writeBest('assisted', 100)).toBe(100);
    expect(readBest('standard')).toBe(84.88);
    for (const invalid of [-1, NaN, Infinity]) {
      expect(() => writeBest('standard', invalid)).toThrow('非负有限数值');
    }
  });

  it('速降只保留最短时间，不与鸟人间距离混榜', () => {
    writeBest('standard', 180);
    expect(writeBest('standard', 75, 'downhill')).toBe(75);
    expect(writeBest('standard', 90, 'downhill')).toBe(75);
    expect(writeBest('standard', 68, 'downhill')).toBe(68);
    expect(readBest('standard')).toBe(180);
    expect(readBest('assisted', 'downhill')).toBe(0);
  });

  it('损坏纪录不被静默覆盖', () => {
    storage.setItem('lakewind.best.official-v1.standard', 'broken');
    expect(() => readBest('standard')).toThrow('纪录已损坏');
    expect(() => writeBest('standard', 90)).toThrow('纪录已损坏');
    expect(storage.getItem('lakewind.best.official-v1.standard')).toBe('broken');
  });

  it('旧版重心距离不参与机体最后尾计距纪录，且不删除原始数据', () => {
    storage.setItem('lakewind.best.standard', '900');
    expect(readBest('standard')).toBe(0);
    expect(writeBest('standard', 120)).toBe(120);
    expect(storage.getItem('lakewind.best.standard')).toBe('900');
  });
});

describe('撤销重做历史', () => {
  it('撤销后编辑清除重做分支，边界操作保持当前值', () => {
    const history = new History(0);
    expect(history.canUndo).toBe(false);
    expect(history.undo()).toBe(0);
    history.push(1);
    history.push(2);
    expect(history.undo()).toBe(1);
    expect(history.canRedo).toBe(true);
    expect(history.redo()).toBe(2);
    expect(history.undo()).toBe(1);
    history.push(3);
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBe(3);
    expect(history.undo()).toBe(1);
    expect(history.undo()).toBe(0);
  });

  it('最多保留60快照', () => {
    const history = new History(0);
    for (let index = 1; index <= 65; index++) history.push(index);
    let undoCount = 0;
    while (history.canUndo) { history.undo(); undoCount++; }
    expect(undoCount).toBe(59);
    expect(history.current).toBe(6);
    while (history.canRedo) history.redo();
    expect(history.current).toBe(65);
  });

  it('输入、当前快照和返回值互不共享可变对象', () => {
    const input = { value: 0 };
    const history = new History(input);
    input.value = 9;
    expect(history.current.value).toBe(0);
    history.push(input);
    input.value = 10;
    const current = history.current;
    current.value = 11;
    expect(history.current.value).toBe(9);
    const undone = history.undo();
    undone.value = 12;
    expect(history.current.value).toBe(0);
    expect(history.redo().value).toBe(9);
  });
});

it('HTTP 局域网没有 randomUUID 时仍能保存独立飞机', () => {
  let sequence = 0;
  vi.stubGlobal('crypto', { getRandomValues: (array: Uint32Array) => { array.fill(++sequence); return array; } });
  const first = saveAircraft(defaultAircraft);
  const second = saveAircraft({ ...defaultAircraft, name: '局域网试飞机' });
  expect(first.id).not.toBe(second.id);
  expect(listAircraft().map(item => item.name).sort()).toEqual([defaultAircraft.name, '局域网试飞机'].sort());
});
