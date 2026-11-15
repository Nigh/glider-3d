import { importReplay, type Replay } from './replay';
import { replayCheckpointTimes, replaySimulation } from './playback';
import { advanceGhost, captureGhost, GHOST_LOOKAHEAD, type GhostFrame } from './ghost';
import type { FlightSimulation } from './physics';

let replay: Replay, sim: FlightSimulation;
let checkpointTimes: (number | null)[] = [];
// Worker requests are serialized, including asynchronous file validation.
let work = Promise.resolve();
self.onmessage = event => { work = work.then(async () => {
  const { type, generation } = event.data;
  try {
    if (type === 'load') {
      replay = await importReplay(event.data.text);
      if (replay.challenge !== event.data.challenge) throw Error('Ghost 回放与当前关卡不一致');
      checkpointTimes = await replayCheckpointTimes(replay);
      // Ghosts only replay forward; retaining decoded seek snapshots wastes memory.
      delete replay.recording.keyframes; delete replay.recording.wingLoads;
    }
    const frames: GhostFrame[] = [];
    if (type === 'load' || type === 'reset') { sim = replaySimulation(replay); frames.push(captureGhost(sim)); }
    const until = type === 'advance' ? event.data.until : GHOST_LOOKAHEAD;
    frames.push(...advanceGhost(sim, until));
    self.postMessage({ generation, definition: type !== 'advance' ? replay.definition : undefined,
      checkpointTimes: type !== 'advance' ? checkpointTimes : undefined, frames },
      { transfer: frames.flatMap(f => [f.sections.buffer, f.fragments.buffer]) });
  } catch (error) { self.postMessage({ generation, error: error instanceof Error ? error.message : String(error) }); }
}); };
