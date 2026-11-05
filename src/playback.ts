import { FlightSimulation, FRAME_WIDTH, type InputRecording } from './physics';
import { clone } from './model';
import type { Replay } from './replay';

const neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0 };
export interface LoadSample { time: number; peakTime: number; main: number; tail: number; vertical: number }

/** Keep replay analysis/seeking responsive, including on long recordings. */
async function advance(sim: FlightSimulation, recording: InputRecording, target: number, cancelled: () => boolean, onStep?: () => void): Promise<boolean> {
  let deadline = performance.now() + 12;
  while (!sim.ended && !sim.replayFinished && sim.elapsedTime + recording.frames[sim.replayFrame * FRAME_WIDTH] <= target + 1e-9) {
    if (cancelled()) return false;
    sim.step(neutral); onStep?.();
    if (performance.now() >= deadline) {
      await new Promise(resolve => setTimeout(resolve, 0));
      deadline = performance.now() + 12;
    }
  }
  return !cancelled();
}

export function replaySimulation(replay: Replay): FlightSimulation {
  const sim = new FlightSimulation(clone(replay.definition), replay.challenge);
  sim.loadReplay(replay.recording);
  return sim;
}

export function replayDuration(recording: InputRecording): number {
  let duration = 0;
  for (let i = 0; i < recording.frames.length; i += FRAME_WIDTH) duration += recording.frames[i];
  return duration;
}

export async function analyzeReplay(replay: Replay, cancelled: () => boolean): Promise<LoadSample[] | null> {
  const sim = replaySimulation(replay), samples: LoadSample[] = [];
  // Interval maxima preserve brief load spikes rather than sampling past them.
  let nextTime = 0.1, main = 0, tail = 0, vertical = 0, peakTime = 0;
  const append = () => { samples.push({ time: sim.elapsedTime, peakTime, main, tail, vertical }); main = tail = vertical = 0; };
  const complete = await advance(sim, replay.recording, Infinity, cancelled, () => {
    for (const section of sim.structure.sections) {
      const stress = section.stressRatio;
      if (stress > Math.max(main, tail, vertical)) peakTime = sim.elapsedTime;
      if (section.wingKey === 'mainWing') main = Math.max(main, stress);
      else if (section.wingKey === 'horizontalTail') tail = Math.max(tail, stress);
      else vertical = Math.max(vertical, stress);
    }
    if (sim.elapsedTime >= nextTime) { append(); nextTime = sim.elapsedTime + 0.1; }
  });
  if (!complete) return null;
  if (!samples.length || samples[samples.length - 1].time !== sim.elapsedTime) append();
  return samples;
}

export async function seekReplay(replay: Replay, seconds: number, cancelled: () => boolean, onStep?: (sim: FlightSimulation) => void): Promise<FlightSimulation | null> {
  const sim = replaySimulation(replay);
  return await advance(sim, replay.recording, Math.max(0, seconds), cancelled, () => onStep?.(sim)) ? sim : null;
}
