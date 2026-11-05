import { analyzeReplay } from './playback';
import type { Replay } from './replay';

self.onmessage = async (event: MessageEvent<Replay>) => {
 try { self.postMessage({ samples: await analyzeReplay(event.data, () => false) }); }
 catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
