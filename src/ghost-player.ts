import { GhostBuffer, GHOST_LOOKAHEAD } from './ghost';
import type { AircraftDefinition } from './model';
import type { ChallengeMode } from './challenges';

export class GhostPlayer {
  readonly buffer = new GhostBuffer();
  definition?: AircraftDefinition;
  ready = false;
  private generation = 0;
  private pending = false;
  private worker: Worker;
  constructor(text: string, challenge: ChallengeMode, private changed: () => void, private failed: (message: string) => void) {
    this.worker = new Worker(new URL('./ghost-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = event => {
      const data = event.data;
      if (data.generation !== this.generation) return;
      this.pending = false;
      if (data.error) { this.failed(data.error); return; }
      if (data.definition) this.definition = data.definition;
      this.buffer.push(data.frames); this.ready = true; this.changed();
    };
    this.worker.onerror = event => { event.preventDefault(); this.failed('Ghost 回放加载失败'); };
    this.pending = true;
    this.worker.postMessage({ type: 'load', text, challenge, generation: this.generation });
  }
  reset() {
    this.generation++; this.ready = false; this.pending = true; this.buffer.frames = [];
    this.worker.postMessage({ type: 'reset', generation: this.generation }); this.changed();
  }
  request(time: number) {
    if (!this.pending && this.ready && !this.buffer.end?.done && (this.buffer.end?.time ?? 0) < time + 0.5) {
      this.pending = true; this.worker.postMessage({ type: 'advance', until: time + GHOST_LOOKAHEAD, generation: this.generation });
    }
  }
  dispose() { this.worker.terminate(); }
}
