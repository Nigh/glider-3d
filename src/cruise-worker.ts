import type { AircraftDefinition } from './model';

self.onmessage = async (event: MessageEvent<{ id: string; definition: AircraftDefinition }>) => {
 const { id, definition } = event.data;
 try {
  // Static imports would await WASM before the first message handler exists.
  const { solveCruiseReference } = await import('./cruise');
  self.postMessage({ id, reference: solveCruiseReference(definition) });
 } catch {
  self.postMessage({ id, error: true });
 }
};
