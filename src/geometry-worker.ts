import type * as GeometryModule from './compiled-geometry';
import type * as PhysicsModule from './physics';
import type { CompiledAircraft } from './compiled-geometry-cache';
import type { AircraftDefinition } from './model';

interface GeometryRequest {
 id: number; definition: AircraftDefinition; reference: boolean;
 previousKey?: string; previous?: CompiledAircraft; changedWingInstances?: readonly number[];
}
let baseline: CompiledAircraft | undefined;
let ready: Promise<[typeof GeometryModule, typeof PhysicsModule]> | undefined;

self.onmessage = async (event: MessageEvent<GeometryRequest>) => {
 const { id, definition, reference, previousKey, previous, changedWingInstances } = event.data;
 let initialized = false;
 try {
  // Register the handler before asynchronous WASM initialization can yield.
  const [{ compileAircraft, compileAffectedAircraft }, { derive, fuelCgRange }] = await (ready ??=
   Promise.all([import('./compiled-geometry'), import('./physics')]));
  initialized = true;
  if (reference) {
   const properties = derive(definition), aero = properties.aerodynamics;
   const stats = { mass: properties.mass, wingLoading: properties.wingLoading, stallSpeed: properties.stallSpeed,
    glideRatio: properties.glideRatio, staticMargin: properties.staticMargin, cg: properties.cg,
    aerodynamics: { liftCenter: aero.liftCenter, dragCenter: aero.dragCenter, lift: aero.lift, drag: aero.drag } };
   self.postMessage({ id, stats, fuel: fuelCgRange(definition) });
  } else {
   const start = performance.now();
   let compiled: CompiledAircraft;
   if (changedWingInstances) {
    const source = previous ?? baseline;
    if (!source || source.key !== previousKey) throw new Error('增量编译缺少当前飞机表面');
    compiled = compileAffectedAircraft(definition, source, changedWingInstances);
   } else compiled = compileAircraft(definition);
   baseline = compiled;
   const compileMs = performance.now() - start;
   self.postMessage({ id, compiled, compileMs });
  }
 } catch (error) {
  self.postMessage({ id, error: error instanceof Error ? error.message : String(error), fatal: !initialized });
 }
};
