import { FlightSimulation, FRAME_WIDTH, type InputRecording } from './physics';
import { clone } from './model';
import type { Replay } from './replay';

const neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0 };
export interface LoadSample { time: number; main: number; tail: number; vertical: number }
type Checkpoint = { time: number; frame: number; state: FlightSimulation };
const checkpoints = new WeakMap<InputRecording, Checkpoint[]>();
const liveCheckpoints = new WeakMap<FlightSimulation, Checkpoint[]>();
const INTERVAL = 0.25;
const MAX_CHECKPOINTS = 32;

function remember(list: Checkpoint[], sim: FlightSimulation, frame: number) {
  const span = Math.max(sim.elapsedTime, list.at(-1)?.time ?? sim.elapsedTime) - (list[0]?.time ?? sim.elapsedTime);
  const interval = Math.max(INTERVAL, span / (MAX_CHECKPOINTS - 1));
  if (list.some(point => Math.abs(point.time - sim.elapsedTime) < interval - 1e-9)) return;
  list.push({ time: sim.elapsedTime, frame, state: sim.checkpoint() });
  list.sort((a,b)=>a.time-b.time);
  // Keep both endpoints and thin the densest region, not the oldest region.
  // Sampling grows with the traversed span so long flights stay broadly covered.
  if (list.length > MAX_CHECKPOINTS) {
    let densest = 1;
    for (let i = 2; i < list.length - 1; i++) {
      if (list[i + 1].time - list[i - 1].time < list[densest + 1].time - list[densest - 1].time) densest = i;
    }
    list.splice(densest, 1);
  }
}

/** Capture live flights too, making their replay immediately seekable. */
export function cacheFlight(sim: FlightSimulation) {
  let list = liveCheckpoints.get(sim);
  if (!list) { list=[];liveCheckpoints.set(sim,list); }
  remember(list,sim,sim.recordingLength);
}
export function cacheRecording(sim: FlightSimulation, recording: InputRecording) {
  const list=liveCheckpoints.get(sim);
  if(list) checkpoints.set(recording,list);
}
export function cacheReplay(replay: Replay, sim: FlightSimulation) {
  let list=checkpoints.get(replay.recording);
  if(!list){list=[];checkpoints.set(replay.recording,list);}
  remember(list,sim,sim.replayFrame);
}

async function advance(sim: FlightSimulation, replay: Replay, target: number, cancelled: () => boolean, onStep?: () => void): Promise<boolean> {
  let deadline = performance.now() + 8;
  while (!sim.ended && !sim.replayFinished && sim.elapsedTime + replay.recording.frames[sim.replayFrame * FRAME_WIDTH] <= target + 1e-9) {
    if (cancelled()) return false;
    sim.step(neutral); onStep?.();cacheReplay(replay,sim);
    if (performance.now() >= deadline) {
      await new Promise(resolve => setTimeout(resolve, 0));
      deadline = performance.now() + 8;
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

/** Read saved interval maxima. No physics or worker is run to draw a waveform. */
export function recordedLoads(recording: InputRecording): LoadSample[] {
  const samples: LoadSample[]=[];
  if(!recording.wingLoads)return samples;
  let time=0,nextTime=0.1,main=0,tail=0,vertical=0;
  for(let i=0;i<recording.length;i++){
    time+=recording.frames[i*FRAME_WIDTH];
    const loads=recording.wingLoads.subarray(i*3,i*3+3);
    main=Math.max(main,loads[0]);tail=Math.max(tail,loads[1]);vertical=Math.max(vertical,loads[2]);
    if(time>=nextTime||i===recording.length-1){samples.push({time,main,tail,vertical});main=tail=vertical=0;nextTime=time+0.1;}
  }
  return samples;
}

export async function seekReplay(replay: Replay, seconds: number, cancelled: () => boolean, onStep?: (sim: FlightSimulation) => void): Promise<FlightSimulation | null> {
  if(cancelled())return null;
  const target=Math.max(0,seconds),list=checkpoints.get(replay.recording)??[];
  const point=list.filter(point=>point.time<=target+1e-9).at(-1);
  const sim=point?point.state.checkpoint():replaySimulation(replay);
  if(point)sim.resumeReplay(replay.recording,point.frame);
  cacheReplay(replay,sim);onStep?.(sim);
  return await advance(sim,replay,target,cancelled,()=>onStep?.(sim))?sim:null;
}
