import { FlightSimulation, FRAME_WIDTH, REPLAY_KEYFRAME_INTERVAL, captureReplayKeyframe, restoreReplayKeyframe, type InputRecording } from './physics';
import { clone } from './model';
import type { Replay } from './replay';

const neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0 };
export interface LoadSample { time: number; main: number; tail: number; vertical: number }
type Checkpoint = { time: number; frame: number; state: FlightSimulation };
type NearbyCache = { states: Map<number, Checkpoint>; center: number; bytes: number; failure?: Error };
const nearby = new WeakMap<InputRecording, NearbyCache>();
const live = new WeakMap<FlightSimulation, NearbyCache>();
const frameTimes = new WeakMap<InputRecording, Float64Array>();
const CACHE_SECONDS = 0.5;
// Hard count also bounds recordings whose external steps are much shorter than 60 Hz.
export const MAX_REPLAY_CACHED_STATES = 121;
export const MAX_REPLAY_CACHE_BYTES = 64 * 1024 * 1024;
let prefetchVersion = 0;
let cancelPrefetch: (() => void) | undefined;

function remember(cache: NearbyCache, sim: FlightSimulation, frame: number) {
  if (Math.abs(sim.elapsedTime - cache.center) > CACHE_SECONDS + 1e-9) return;
  if (!cache.states.has(frame)) {
    const state = sim.checkpoint();
    cache.states.set(frame, { time: sim.elapsedTime, frame, state }); cache.bytes += state.checkpointBytes;
  }
  for (const [index, point] of cache.states) if (Math.abs(point.time - cache.center) > CACHE_SECONDS + 1e-9) {
    cache.bytes -= point.state.checkpointBytes; cache.states.delete(index);
  }
  while (cache.states.size > MAX_REPLAY_CACHED_STATES || cache.bytes > MAX_REPLAY_CACHE_BYTES) {
    let farthest = -1, distance = -1;
    for (const [index, point] of cache.states) if (Math.abs(point.time - cache.center) > distance) { farthest = index; distance = Math.abs(point.time - cache.center); }
    cache.bytes -= cache.states.get(farthest)!.state.checkpointBytes; cache.states.delete(farthest);
  }
}

/** Live caches keep each accepted state, not a progressively thinned flight history. */
export function cacheFlight(sim: FlightSimulation) {
  let cache = live.get(sim);
  if (!cache) { cache = { states: new Map(), center: sim.elapsedTime, bytes: 0 }; live.set(sim, cache); }
  cache.center = sim.elapsedTime;
  remember(cache, sim, sim.recordingLength);
}
export function cacheRecording(sim: FlightSimulation, recording: InputRecording) {
  const cache = live.get(sim);
  if (cache) nearby.set(recording, cache);
}
export function cacheReplay(replay: Replay, sim: FlightSimulation) {
  let cache = nearby.get(replay.recording);
  if (!cache) { cache = { states: new Map(), center: sim.elapsedTime, bytes: 0 }; nearby.set(replay.recording, cache); }
  cache.center = sim.elapsedTime;
  remember(cache, sim, sim.replayFrame);
}

export function replayCacheStats(recording: InputRecording) {
  const cache = nearby.get(recording);
  return { states: cache?.states.size ?? 0, bytes: cache?.bytes ?? 0 };
}

function times(recording: InputRecording) {
  let values = frameTimes.get(recording);
  if (!values) {
    values = new Float64Array(recording.length + 1);
    for (let i = 0; i < recording.length; i++) values[i + 1] = values[i] + recording.frames[i * FRAME_WIDTH];
    frameTimes.set(recording, values);
  }
  return values;
}
function targetFrame(recording: InputRecording, seconds: number) {
  const values = times(recording);
  let low = 0, high = recording.length;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (values[middle] <= seconds + 1e-9) low = middle; else high = middle - 1; }
  return low;
}
async function advance(sim: FlightSimulation, frame: number, cancelled: () => boolean, onStep?: () => void) {
  let deadline = performance.now() + 8;
  while (!sim.ended && !sim.replayFinished && sim.replayFrame < frame) {
    if (cancelled()) return false;
    sim.step(neutral); onStep?.();
    if (performance.now() >= deadline) { await new Promise(resolve => setTimeout(resolve, 0)); deadline = performance.now() + 8; }
  }
  return !cancelled();
}
export function replaySimulation(replay: Replay): FlightSimulation {
  const sim = new FlightSimulation(clone(replay.definition), replay.challenge, replay.recording.launchRoll);
  sim.loadReplay(replay.recording);
  return sim;
}
export function replayDuration(recording: InputRecording): number { return times(recording)[recording.length]; }

/** Upgrade input-only files once, before interactive seeking or exporting. */
export async function prepareReplay(replay: Replay, cancelled: () => boolean = () => false): Promise<boolean> {
  if (replay.recording.keyframes?.length) return !cancelled();
  const sim = replaySimulation(replay), points = [captureReplayKeyframe(sim, replay.recording)];
  let next = REPLAY_KEYFRAME_INTERVAL;
  const done = await advance(sim, replay.recording.length, cancelled, () => {
    if (sim.elapsedTime + 1e-9 >= next || sim.ended || sim.replayFinished) {
      points.push(captureReplayKeyframe(sim, replay.recording));
      next = (Math.floor((sim.elapsedTime + 1e-9) / REPLAY_KEYFRAME_INTERVAL) + 1) * REPLAY_KEYFRAME_INTERVAL;
    }
  });
  if (done) replay.recording.keyframes = points;
  return done;
}

/** Read saved interval maxima. No physics or worker is run to draw a waveform. */
export function recordedLoads(recording: InputRecording): LoadSample[] {
  const samples: LoadSample[] = [];
  if (!recording.wingLoads) return samples;
  let time = 0, nextTime = 0.1, main = 0, tail = 0, vertical = 0;
  for (let i = 0; i < recording.length; i++) {
    time += recording.frames[i * FRAME_WIDTH];
    const loads = recording.wingLoads.subarray(i * 3, i * 3 + 3);
    main = Math.max(main, loads[0]); tail = Math.max(tail, loads[1]); vertical = Math.max(vertical, loads[2]);
    if (time >= nextTime || i === recording.length - 1) { samples.push({ time, main, tail, vertical }); main = tail = vertical = 0; nextTime = time + 0.1; }
  }
  return samples;
}

function restoreAt(replay: Replay, frame: number): FlightSimulation {
  const cached = nearby.get(replay.recording)?.states;
  let closest: Checkpoint | undefined;
  for (const point of cached?.values() ?? []) if (point.frame <= frame && (!closest || point.frame > closest.frame)) closest = point;
  const points = replay.recording.keyframes!;
  let low = 0, high = points.length - 1;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (points[middle].frame <= frame) low = middle; else high = middle - 1; }
  const point = points[low];
  if (closest && closest.frame >= point.frame) { const sim = closest.state.checkpoint(); sim.resumeReplay(replay.recording, closest.frame); return sim; }
  return restoreReplayKeyframe(replay.definition, replay.challenge, replay.recording, point);
}

function prefetch(replay: Replay, center: number, version: number, cancelled: () => boolean) {
  // One deferred, cancellable job. Never mutate the returned simulation or emit chart samples.
  const timer = setTimeout(() => { void (async () => {
    const stopped = () => version !== prefetchVersion || cancelled();
    if (stopped()) return;
    const cache = nearby.get(replay.recording)!;
    const start = targetFrame(replay.recording, Math.max(0, center - CACHE_SECONDS));
    const end = targetFrame(replay.recording, center + CACHE_SECONDS);
    const sim = restoreAt(replay, start);
    if (!await advance(sim, start, stopped)) return;
    if (stopped()) return;
    remember(cache, sim, sim.replayFrame);
    await advance(sim, end, stopped, () => remember(cache, sim, sim.replayFrame));
  })().catch((error: unknown) => {
    if (version === prefetchVersion && !cancelled()) nearby.get(replay.recording)!.failure = error instanceof Error ? error : Error(String(error));
  }); }, 0);
  cancelPrefetch = () => clearTimeout(timer);
}

export async function seekReplay(replay: Replay, seconds: number, cancelled: () => boolean, onStep?: (sim: FlightSimulation) => void): Promise<FlightSimulation | null> {
  const version = ++prefetchVersion;
  cancelPrefetch?.();
  const previous = nearby.get(replay.recording);
  if (previous?.failure) throw previous.failure;
  const stopped = () => version !== prefetchVersion || cancelled();
  if (Number.isNaN(seconds)) throw Error('回放时间无效');
  if (stopped() || !await prepareReplay(replay, stopped)) return null;
  const target = Math.max(0, seconds), frame = targetFrame(replay.recording, target);
  const sim = restoreAt(replay, frame);
  let cache = nearby.get(replay.recording);
  if (!cache) { cache = { states: new Map(), center: times(replay.recording)[frame], bytes: 0 }; nearby.set(replay.recording, cache); }
  cache.center = times(replay.recording)[frame];
  remember(cache, sim, sim.replayFrame); onStep?.(sim);
  if (!await advance(sim, frame, stopped, () => { remember(cache!, sim, sim.replayFrame); onStep?.(sim); })) return null;
  prefetch(replay, sim.elapsedTime, version, cancelled);
  return sim;
}
