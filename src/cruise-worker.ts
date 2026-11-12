import { solveCruiseReference } from './cruise';
import type { AircraftDefinition } from './model';

self.onmessage = (event: MessageEvent<{ id: string; definition: AircraftDefinition }>) => {
 const { id, definition } = event.data;
 try {
  self.postMessage({ id, reference: solveCruiseReference(definition) });
 } catch {
  self.postMessage({ id, error: true });
 }
};
