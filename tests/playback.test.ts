import { afterEach, expect, it, vi } from 'vitest';
import { clone, defaultAircraft, presets } from '../src/model';
import { FlightSimulation, GRAVITY, REPLAY_KEYFRAME_INTERVAL, captureReplayKeyframe } from '../src/physics';
import { Vector3 } from 'three';
import { recordedLoads, replayDuration, replaySimulation, seekReplay, replayCacheStats, MAX_REPLAY_CACHED_STATES, MAX_REPLAY_CACHE_BYTES } from '../src/playback';

const neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0 };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('measures 2 G and free fall using the mass before a structural split', () => {
 const sim=new FlightSimulation(defaultAircraft,'birdman',0), mass=sim.telemetry.mass;
 (sim as any).advanceStructure(1/60,new Vector3(0,mass*GRAVITY*2,0),new Vector3());
 expect(sim.telemetry.gForce).toBeCloseTo(2,12);
 (sim as any).advanceStructure(1/60,new Vector3(),new Vector3());
 expect(sim.telemetry.gForce).toBe(0);
});

it('seeks variable-duration recordings forward, backward and to both endpoints without losing physics state', async () => {
 const definition=clone(defaultAircraft), sim=new FlightSimulation(definition,'birdman',0.004);
 for(let i=0;i<100;i++)sim.step({...neutral,weight:i%2?0.1:-0.1},i%2?1/60:1/120);
 const replay={definition,challenge:'birdman' as const,recording:sim.getRecording()};
 expect(replayDuration(replay.recording)).toBeCloseTo(sim.elapsedTime,10);
 const snapshot=(s:FlightSimulation)=>({position:s.position.toArray(),quaternion:s.quaternion.toArray(),fuel:s.telemetry.fuelRemaining,structure:s.structure.sections.map(p=>[p.bodyId,p.stressRatio]),g:s.telemetry.gForce});
 const end=await seekReplay(replay,Infinity,()=>false);
 expect(snapshot(end!)).toEqual(snapshot(sim));
 const middle=await seekReplay(replay,0.6,()=>false), linear=replaySimulation(replay);
 while(linear.replayFrame<middle!.replayFrame)linear.step(neutral);
 expect(snapshot(middle!)).toEqual(snapshot(linear));
 expect((await seekReplay(replay,0,()=>false))!.replayFrame).toBe(0);
 expect(await seekReplay(replay,1,()=>true)).toBeNull();
 const loads=recordedLoads(replay.recording);
 expect(loads!.at(-1)!.time).toBe(sim.elapsedTime);
 expect(Math.max(...loads!.map(p=>p.main))).toBeGreaterThan(0);

});

it('records real per-step G peaks and reproduces them in replay, including launch loads', async () => {
 const definition=clone(presets.find(p=>p.name==='高性能滑翔型')!),sim=new FlightSimulation(definition,'downhill',0);
 expect(sim.telemetry.gForce).toBeCloseTo(1,12);
 let maxG=1;
 for(let i=0;i<4000&&!sim.ended;i++){
  sim.step({...neutral,elevator:0.5});maxG=Math.max(maxG,sim.telemetry.gForce);
  expect(Number.isFinite(sim.telemetry.gForce)).toBe(true);
 }
 expect(sim.ended).toBe(true);
 expect(maxG).toBeGreaterThan(1);
 expect(sim.result!.maxG).toBeGreaterThanOrEqual(maxG);
 const end=await seekReplay({definition,challenge:'downhill',recording:sim.getRecording()},Infinity,()=>false);
 expect(end!.result).toEqual(sim.result);
 sim.reset();expect(sim.telemetry.gForce).toBeCloseTo(1,12);
},20000);

it('persists fixed frame-aligned keyframes and seeks untouched regions with bounded integration', async () => {
 const definition=clone(presets.find(p=>p.name==='基础单发型')!),sim=new FlightSimulation(definition,'low-altitude',0.005);
 for(let i=0;i<80;i++)sim.step({...neutral,throttle:0,trimPitch:0.1,adaptiveControls:true},i%2?0.25:0.125);
 const recording=sim.getRecording(),replay={definition,challenge:'low-altitude' as const,recording};
 expect(recording.keyframes![0].time).toBe(0);
 let boundary=REPLAY_KEYFRAME_INTERVAL;
 for(const point of recording.keyframes!.slice(1,-1)){
  expect(point.time).toBeGreaterThanOrEqual(boundary-1e-9);
  expect(point.time).toBeLessThan(boundary+0.25);
  boundary+=REPLAY_KEYFRAME_INTERVAL;
 }
 const steps=vi.spyOn(FlightSimulation.prototype,'step');
 for(const target of [12.7,2.6,9.4]){
  steps.mockClear();
  const restored=await seekReplay(replay,target,()=>false);
  expect(restored!.elapsedTime).toBeLessThanOrEqual(target+1e-9);
  expect(steps.mock.calls.length).toBeLessThanOrEqual(8);
 }
 steps.mockClear();
 const point=recording.keyframes!.find(point=>point.time>=5)!;
 const restored=await seekReplay(replay,point.time,()=>false);
 expect(steps).not.toHaveBeenCalled();
 expect(captureReplayKeyframe(restored!,recording).state).toEqual(point.state);
 restored!.position.x+=100;
 expect(captureReplayKeyframe((await seekReplay(replay,point.time,()=>false))!,recording).state).toEqual(point.state);
},30000);

it('prefetches both sides without changing the displayed state or emitting chart samples, with bounded memory', async () => {
 const definition=clone(presets.find(p=>p.name==='基础单发型')!),sim=new FlightSimulation(definition,'low-altitude',0.005);
 for(let i=0;i<360;i++)sim.step({...neutral,throttle:0},1/120);
 const recording=sim.getRecording(),replay={definition,challenge:'low-altitude' as const,recording};
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 let cancelled=false;
 const samples=vi.fn(),restored=await seekReplay(replay,2,()=>cancelled,samples);
 const before=captureReplayKeyframe(restored!,recording),sampleCount=samples.mock.calls.length;
 await vi.runAllTimersAsync();
 expect(captureReplayKeyframe(restored!,recording)).toEqual(before);
 expect(samples).toHaveBeenCalledTimes(sampleCount);
 const steps=vi.spyOn(FlightSimulation.prototype,'step');
 for(const target of [2-1/120,2+1/120]){
  steps.mockClear();
  expect((await seekReplay(replay,target,()=>cancelled))!.elapsedTime).toBeCloseTo(target,10);
  expect(steps).not.toHaveBeenCalled();
 }
 const cache=replayCacheStats(recording);
 expect(cache.states).toBeGreaterThan(1);
 expect(cache.states).toBeLessThanOrEqual(MAX_REPLAY_CACHED_STATES);
 expect(cache.bytes).toBeLessThanOrEqual(MAX_REPLAY_CACHE_BYTES);
 cancelled=true;
 await vi.runAllTimersAsync();
},30000);

it('cancels superseded prefetch before integrating and rejects NaN seek times', async () => {
 const sim=new FlightSimulation(defaultAircraft,'birdman',0);
 for(let i=0;i<90;i++)sim.step(neutral);
 const replay={definition:clone(defaultAircraft),challenge:'birdman' as const,recording:sim.getRecording()};
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 let cancelled=false;
 await seekReplay(replay,1,()=>cancelled);
 const steps=vi.spyOn(FlightSimulation.prototype,'step');
 cancelled=true;
 await vi.runAllTimersAsync();
 expect(steps).not.toHaveBeenCalled();
 await expect(seekReplay(replay,NaN,()=>false)).rejects.toThrow('时间');
});
