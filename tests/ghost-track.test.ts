import { afterEach, expect, it, vi } from 'vitest';
import { createLegacyReplay } from './fixtures/legacy-replay';
import { clone, defaultAircraft, wing } from '../src/model';
import { FlightSimulation } from '../src/physics';
import * as physics from '../src/physics';
import { captureGhost, ghostRecording, recordGhost, MAX_GHOST_TRACK_BYTES, ghostFrameBytes, GHOST_SECTION_WIDTH } from '../src/ghost';
import { encodeGhostFrames, decodeGhostFrames } from '../src/ghost-track';
import { exportReplay, importReplay } from '../src/replay';

const neutral={weight:0,elevator:0,aileron:0,rudder:0};
afterEach(()=>vi.restoreAllMocks());
it('records exact visual knots and split metadata without serializing extra physics fields',async()=>{
 const sim=new FlightSimulation(defaultAircraft,'birdman',0),states=new Map([[0,captureGhost(sim)]]);
 for(let i=0;i<30;i++){sim.step(neutral);states.set(sim.elapsedTime,captureGhost(sim));}
 const recording=sim.getRecording(),frames=recording.ghostFrames!;
 for(const f of frames)expect(f).toEqual({...states.get(f.time),done:f===frames.at(-1)});
 const restored=await decodeGhostFrames(await encodeGhostFrames(frames),sim.elapsedTime,sim.structure.sections.length,recording.length);
 expect(restored).toEqual(frames);
 expect(recording.checkpointTimes).toEqual([]);
 sim.reset();expect(sim.getRecording().ghostFrames).toBeUndefined();
});
it('imports a dense ghost without restoring keyframes or stepping physics, preserving replay validation',async()=>{
 const sim=new FlightSimulation(defaultAircraft,'birdman',0);for(let i=0;i<15;i++)sim.step(neutral);
 const text=await exportReplay({definition:defaultAircraft,challenge:'birdman',recording:sim.getRecording()});
 const step=vi.spyOn(FlightSimulation.prototype,'step'),restore=vi.spyOn(physics,'restoreReplayKeyframe');
 const ghost=await importReplay(text,'ghost');
 expect(step).not.toHaveBeenCalled();expect(restore).not.toHaveBeenCalled();
 expect(ghost.recording.keyframes).toBeUndefined();expect(ghost.recording.ghostFrames).toEqual(sim.getRecording().ghostFrames);
 const data=JSON.parse(text);data.recording.keyframeData='bad';
 await expect(importReplay(JSON.stringify(data))).rejects.toThrow('关键帧');
 await expect(importReplay(JSON.stringify(data),'ghost')).resolves.toBeDefined();
});
it('imports pre-track files from their recorded keyframes with zero physics steps',async()=>{
 const text=await createLegacyReplay();
 const step=vi.spyOn(FlightSimulation.prototype,'step');const ghost=await importReplay(text,'ghost');
 expect(step).not.toHaveBeenCalled();expect(ghost.recording.ghostFrames!.length).toBe(ghost.recording.keyframes!.length);
 expect(ghost.recording.ghostFrames!.at(-1)!.done).toBe(true);
});
it('makes the first two validated legacy states available before reading the remaining keyframes',async()=>{
 const sim=new FlightSimulation(defaultAircraft,'birdman',0);for(let i=0;i<90;i++)sim.step(neutral);
 const data=JSON.parse(await exportReplay({definition:defaultAircraft,challenge:'birdman',recording:sim.getRecording()}));
 delete data.recording.ghostData;delete data.recording.ghostEncoding;delete data.recording.checkpointTimes;
 const batches:number[][]=[],completion:boolean[]=[];let finished=false;
 const replay=await importReplay(JSON.stringify(data),'ghost',(_,frames)=>{
  expect(finished).toBe(false);batches.push(frames.map(f=>f.time));completion.push(...frames.map(f=>f.done));
 });finished=true;
 expect(batches[0]).toHaveLength(2);expect(batches[0].at(-1)!).toBeLessThan(sim.elapsedTime);
 expect(batches.flat()).toEqual(replay.recording.keyframes!.map(f=>f.time));
 expect(completion).toEqual(batches.flat().map((_,i,all)=>i===all.length-1));
});
it('rejects truncated, nonfinite, inconsistent or unbounded visual data',async()=>{
 const sim=new FlightSimulation(defaultAircraft,'birdman',0);sim.step(neutral);const frames=sim.getRecording().ghostFrames!;
 for(const mutate of [
  (f:typeof frames)=>{f[1].time=0;},
  (f:typeof frames)=>{f[1].position[0]=NaN;},
  (f:typeof frames)=>{f[1].quaternion=[0,0,0,0];},
  (f:typeof frames)=>{f[1].sections=new Float64Array(1);},
  (f:typeof frames)=>{f[1].fragments=new Float64Array([999,0,0,0,0,0,0,1,0,0,0]);},
  (f:typeof frames)=>{f[1].sections[24]=2;},
  (f:typeof frames)=>{f[1].sections[24]=1;f[1].sections.fill(0,31,35);},
 ]){
  const changed=structuredClone(frames);mutate(changed);
  await expect(decodeGhostFrames(await encodeGhostFrames(changed),sim.elapsedTime,sim.structure.sections.length,1)).rejects.toThrow('Ghost');
 }
 await expect(decodeGhostFrames('bad',1,1,1)).rejects.toThrow('Ghost');
 const bytes=new Uint8Array(MAX_GHOST_TRACK_BYTES+1024*1024+8);const compressed=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 await expect(decodeGhostFrames(Buffer.from(compressed).toString('base64'),1,1,1)).rejects.toThrow('Ghost');
});
it('bounds a long large-wing recording and retains fracture transitions',()=>{
 const d=clone(defaultAircraft);d.mainWing=wing(24,5,5);const sim=new FlightSimulation(d,'birdman',0);recordGhost(sim);
 const count=Math.ceil(MAX_GHOST_TRACK_BYTES/ghostFrameBytes(captureGhost(sim)))*2;
 for(let i=1;i<=count;i++){
  Reflect.set(sim,'elapsed',i/10);
  if(i===1501){sim.structure.sections[0].bodyId=1;sim.fragments.push({id:1,position:sim.position.clone(),quaternion:sim.quaternion.clone(),cg:sim.telemetry.cg.clone()} as any);sim.structure.fractureCount++;}
  if(i===1603){sim.structure.sections[1].bodyId=1;sim.structure.fractureCount++;}
  recordGhost(sim);
 }
 const frames=ghostRecording(sim)!;
 expect(frames.reduce((sum,f)=>sum+ghostFrameBytes(f),0)).toBeLessThan(MAX_GHOST_TRACK_BYTES);
 expect(frames.some(f=>f.time===150.1&&f.fragments.length===11)).toBe(true);
 expect(frames.some(f=>f.time===160.3&&f.sections[GHOST_SECTION_WIDTH]===1)).toBe(true);
 expect(frames[0].time).toBe(0);expect(frames.at(-1)!.time).toBe(count/10);
 expect(frames.length).toBeLessThan(count+1);
});
