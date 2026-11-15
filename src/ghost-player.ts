import { GhostBuffer } from './ghost';
import type { AircraftDefinition } from './model';
import type { ChallengeMode } from './challenges';

export class GhostPlayer {
 readonly buffer = new GhostBuffer();
 definition?: AircraftDefinition;
 checkpointTimes: (number | null)[] = [];
 timingReady = false;
 ready = false;
 private worker: Worker;
 constructor(text: string, challenge: ChallengeMode, private changed: () => void, private failed: (message: string) => void) {
  this.worker = new Worker(new URL('./ghost-worker.ts', import.meta.url), { type: 'module' });
  this.worker.onmessage = event => {
   const data = event.data;
   if (data.error) { this.failed(data.error); return; }
   if (data.definition) this.definition = data.definition;
   if (data.checkpointTimes) this.checkpointTimes = data.checkpointTimes;
   if (data.timingReady !== undefined) this.timingReady = data.timingReady;
   if (data.frames) { this.buffer.push(data.frames); this.ready = true; }
   this.changed();
  };
  this.worker.onerror = event => { event.preventDefault(); this.failed('Ghost 回放加载失败'); };
  this.worker.postMessage({ text, challenge });
 }
 reset() { this.changed(); }
 dispose() { this.worker.onmessage = null; this.worker.terminate(); }
}
