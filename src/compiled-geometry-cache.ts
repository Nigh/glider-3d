import { aircraftWings, type AircraftDefinition, type WingSupport } from './model';
import type { MaterialId } from './materials';
import type { EnginePart } from './engine-geometry';

export type CompiledPartKind = 'wing' | 'fuselage' | 'cockpit' | 'canopy' | 'nose' | 'wing-support' | 'engine' | 'engine-support' | 'fuel-tank';
export interface CompiledPartition {
 wingInstance: number; side: number; spanStart: number; spanEnd: number; movable: boolean;
 positions: Float32Array; indices: Uint32Array;
 /** Wing vertices: span (m), chord fraction, signed normal (m). Support vertices: attachment weight (0..1), 0, 0. Other parts: zeros. */
 coordinates: Float32Array;
 /** Retained original wing skin projected onto its planform, counting both faces once. Caps contribute zero. */
 surfaceArea: number;
 kind: CompiledPartKind; sourceIndex: number; materialId: MaterialId; materialAmount: number;
 enginePart?: EnginePart; engineIndex?: number;
 /** Installed wing for a support; -1 for body/engine parts. Non-wing wingInstance is always -1. */
 supportWingInstance: number;
 /** Canonical geometry for rigid installation edits; never chain Float32 rotations. */
 prototype?: { positions: Float32Array; frame: CompiledGeometryFrame };
}
export interface CompiledControl {
 wingInstance: number; side: number; spanStart: number; spanEnd: number;
 /** Retained movable planform area / original control planform area in this 0.8 m strip. */
 areaFraction: number; area: number; center: [number, number, number];
 /** Body coordinates, right-hand rotation about the shared model hinge axis; angles in radians. */
 hinge: [number, number, number]; axis: [number, number, number]; minAngle: number; maxAngle: number;
 prototype?: { center: [number, number, number]; hinge: [number, number, number]; axis: [number, number, number]; frame: CompiledGeometryFrame };
}
export interface CompiledGeometryFrame { matrix: number[] }
export interface CompiledSourceCell {
 spanStart: number; spanEnd: number;
 bounds: { min: [number, number, number]; max: [number, number, number] };
 motionBounds: { min: [number, number, number]; max: [number, number, number] };
}
export interface CompiledSourceMesh {
 sourceIndex: number; kind: CompiledPartKind; wingInstance: number; side: number; supportWingInstance: number;
 materialId: MaterialId; materialAmount: number;
 enginePart?: EnginePart; engineIndex?: number;
 positions: Float32Array; indices: Uint32Array; faceIDs: Uint32Array; coordinates?: Float32Array;
 bounds: { min: [number, number, number]; max: [number, number, number] };
 motionBounds: { min: [number, number, number]; max: [number, number, number] };
 support?: WingSupport;
 frame?: CompiledGeometryFrame; cells?: CompiledSourceCell[];
}
export interface CompiledAttachmentSpan {
 wingInstance: number; side: number; spanStart: number; spanEnd: number;
 anchorWingInstance: number; anchorSide: number; anchorSpan: number;
}
export interface CompiledAircraft {
 key: string; partitions: CompiledPartition[]; controls: CompiledControl[];
 /** Original solids survive worker transfer so local incidence edits can restore previously buried material. */
 sourceMeshes?: CompiledSourceMesh[];
 attachmentSpans?: CompiledAttachmentSpan[];
}

export function geometryKey(d: AircraftDefinition): string {
 return JSON.stringify([d.birdman, d.fuselage, d.cockpit, d.assembly, d.engine, d.fuelTank,
  aircraftWings(d).map(({ key, wing: w, position, incidence }) => [key, position, incidence, w.points,
   w.airfoil ?? 'dae11', w.rootReference, !!w.mirrored, w.cant ?? 0, w.lateralOffset ?? 0,
   w.dihedral, w.controlSurface, w.materialId, w.materialAmount, w.structure])]);
}

const cache = new Map<string, { result: CompiledAircraft; bytes: number }>();
const activeDefinitions = new WeakMap<AircraftDefinition, CompiledAircraft>();
let cacheBytes = 0;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
export function getCompiledAircraft(d: AircraftDefinition): CompiledAircraft | undefined {
 const key = geometryKey(d), active = activeDefinitions.get(d);
 if (active?.key === key) return active;
 const entry = cache.get(key);
 if (!entry) return undefined;
 cache.delete(key); cache.set(key, entry);
 activeDefinitions.set(d, entry.result);
 return entry.result;
}
export function installCompiledAircraft(d: AircraftDefinition, result: CompiledAircraft): void {
 if (result.key !== geometryKey(d)) throw Error('Compiled aircraft does not match the current geometry');
 activeDefinitions.set(d, result);
 const buffers = new Set<ArrayBufferLike>();
 for (const p of result.partitions) {
  for (const array of [p.positions, p.indices, p.coordinates]) buffers.add(array.buffer);
  if (p.prototype) buffers.add(p.prototype.positions.buffer);
 }
 for (const source of result.sourceMeshes ?? []) for (const array of [source.positions, source.indices, source.faceIDs, source.coordinates]) if (array) buffers.add(array.buffer);
 const bytes = [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
 const previous = cache.get(result.key);
 if (previous) { cacheBytes -= previous.bytes; cache.delete(result.key); }
 if (bytes <= MAX_CACHE_BYTES) { cache.set(result.key, { result, bytes }); cacheBytes += bytes; }
 while (cache.size > 8 || cacheBytes > MAX_CACHE_BYTES) {
  const key = cache.keys().next().value!;
  cacheBytes -= cache.get(key)!.bytes; cache.delete(key);
 }
}
