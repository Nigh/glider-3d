import type { Vector3 } from 'three';
import { clone, type AircraftDefinition } from './model';
import { geometryKey, getCompiledAircraft, installCompiledAircraft, type CompiledAircraft } from './compiled-geometry-cache';

export interface DesignReference {
 mass: number; wingLoading: number; stallSpeed: number; glideRatio: number; staticMargin: number; cg: Vector3;
 aerodynamics: { liftCenter: Vector3 | null; dragCenter: Vector3 | null; lift: Vector3; drag: Vector3 };
}
export interface DesignReferenceResult { stats: DesignReference; fuel: { full: Vector3; empty: Vector3 } }
type Response = { id: number; compiled?: CompiledAircraft; compileMs?: number; stats?: DesignReference; fuel?: DesignReferenceResult['fuel']; error?: string; fatal?: boolean };
export const geometryMetrics = { lastCompileMs: 0 };
interface IncrementalGeometry { previous: CompiledAircraft; changedWingInstances: readonly number[] }

class GeometryWorkerClient {
 private worker: Worker | null = null;
 private id = 0;
 private baselineKey: string | undefined;
 private readonly requests = new Map<number, { resolve: (value: Response) => void; reject: (error: Error) => void }>();
 constructor(private readonly reference: boolean) {}
 request(definition: AircraftDefinition, incremental?: IncrementalGeometry): Promise<Response> {
  let resolve!: (value: Response) => void, reject!: (error: Error) => void;
  const promise = new Promise<Response>((accept, fail) => { resolve = accept; reject = fail; });
  try {
   if (!this.worker) {
    this.worker = new Worker(new URL('./geometry-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<Response>) => {
     const request = this.requests.get(event.data.id);
     if (!request) return;
     this.requests.delete(event.data.id);
     if (event.data.compiled) this.baselineKey = event.data.compiled.key;
     if (event.data.error) {
      request.reject(new Error(event.data.error));
      if (event.data.fatal) this.dispose();
     } else request.resolve(event.data);
    };
    this.worker.onerror = () => this.dispose();
    this.worker.onmessageerror = () => this.dispose();
   }
   const id = ++this.id;
   this.requests.set(id, { resolve, reject });
   this.worker.postMessage({ id, definition, reference: this.reference,
    ...(incremental ? { previousKey: incremental.previous.key,
     previous: this.baselineKey === incremental.previous.key ? undefined : incremental.previous,
     changedWingInstances: incremental.changedWingInstances } : {}) });
  } catch (error) { this.dispose(); reject(error instanceof Error ? error : new Error(String(error))); }
  return promise;
 }
 dispose(): void {
  this.worker?.terminate(); this.worker = null;
  this.baselineKey = undefined;
  for (const request of this.requests.values()) request.reject(new Error('飞机表面编译失败，请重试。'));
  this.requests.clear();
 }
}
const compiler = new GeometryWorkerClient(false), references = new GeometryWorkerClient(true);

export async function prepareAircraft(definition: AircraftDefinition): Promise<CompiledAircraft> {
 const cached = getCompiledAircraft(definition);
 if (cached) return cached;
 const response = await compiler.request(definition);
 if (!response.compiled) throw new Error('飞机表面编译失败，请重试。');
 geometryMetrics.lastCompileMs = response.compileMs ?? 0;
 return response.compiled;
}
export function installPreparedAircraft(definition: AircraftDefinition, compiled: CompiledAircraft): void {
 installCompiledAircraft(definition, compiled);
}
export async function designReference(definition: AircraftDefinition): Promise<DesignReferenceResult> {
 const response = await references.request(definition);
 if (!response.stats || !response.fuel) throw new Error('飞机性能计算失败，请重试。');
 return { stats: response.stats, fuel: response.fuel };
}

interface WindGeometryRequest extends IncrementalGeometry { definition: AircraftDefinition; key: string; version: number }
export class WindGeometryCompiler {
 private desired: WindGeometryRequest | null = null;
 private ready: { key: string; previousKey: string; compiled: CompiledAircraft } | null = null;
 private running = false;
 private version = 0;
 private failedKey = '';
 private disposed = false;
 constructor(private readonly status: (busy: boolean, error?: string) => void) {}

 provide = (definition: AircraftDefinition, previous: CompiledAircraft, changedWingInstances: readonly number[]): CompiledAircraft | undefined => {
  if (this.disposed) return undefined;
  const key = geometryKey(definition);
  if (this.ready?.key === key && this.ready.previousKey === previous.key) {
   const compiled = this.ready.compiled; this.ready = null; this.desired = null;
   installCompiledAircraft(definition, compiled); return compiled;
  }
  if (this.desired?.key !== key || this.desired.previous.key !== previous.key) {
   this.desired = { definition: clone(definition), key, previous, changedWingInstances: [...changedWingInstances], version: ++this.version };
   this.status(true);
  }
  if (!this.running && this.failedKey !== key) void this.compile();
  return undefined;
 };

 invalidate(): void {
  this.version++; this.desired = null; this.ready = null; this.failedKey = '';
  if (!this.disposed) this.status(false);
 }
 retry(): void {
  this.failedKey = '';
  if (!this.running && this.desired && !this.disposed) void this.compile();
 }
 dispose(): void { this.disposed = true; this.invalidate(); }

 private async compile(): Promise<void> {
  const request = this.desired;
  if (!request || this.disposed) return;
  this.running = true; this.status(true);
  try {
   const response = await compiler.request(request.definition, request);
   if (this.disposed || request.version !== this.version) return;
   if (!response.compiled || response.compiled.key !== request.key) throw new Error('飞机表面编译结果已过期');
   geometryMetrics.lastCompileMs = response.compileMs ?? 0;
   this.ready = { key: request.key, previousKey: request.previous.key, compiled: response.compiled };
   this.status(false);
  } catch (error) {
   if (!this.disposed && request.version === this.version) {
    this.failedKey = request.key; this.status(false, error instanceof Error ? error.message : String(error));
   }
  } finally {
   this.running = false;
   if (!this.disposed && this.desired && this.desired.version !== request.version && this.failedKey !== this.desired.key) void this.compile();
  }
 }
}
export function disposeGeometryWorkers(): void { compiler.dispose(); references.dispose(); }
