import { afterEach, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { FlightSimulation, WATER } from '../src/physics';
import { BODY_GEOMETRY, clone, defaultAircraft, presets } from '../src/model';
import { cacheFlight, cacheRecording, recordedLoads, replaySimulation, seekReplay } from '../src/playback';
import { exportReplay, importReplay } from '../src/replay';
import * as challenges from '../src/challenges';

const neutral={weight:0,elevator:0,aileron:0,rudder:0};
afterEach(()=>vi.restoreAllMocks());
const conventional=()=>clone(presets.find(p=>p.name==='低空喷气巡航型')!);
function groundFlight(speed=8){
 vi.spyOn(challenges,'challengeTerrainHeight').mockReturnValue(20);
 const sim=new FlightSimulation(conventional(),'low-altitude',0);
 sim.launching=false;sim.quaternion.identity();sim.position.set(50,22,100);sim.velocity.set(speed,0,0);
 return sim;
}
function bodyBottom(sim:FlightSimulation,key:'nose'|'shell'|'canopy'){
 const shape=BODY_GEOMETRY[key],out=new Vector3();
 const x=key==='nose'?sim.definition.fuselage.center+sim.definition.fuselage.length/2+shape.x:sim.definition.cockpit.position+shape.x;
 (sim as any).lowestBodyPoint(shape,x,sim.position,sim.quaternion,out);return out;
}

it('supports a grazing wing without ending, penetrating terrain or creating energy',()=>{
 const sim=groundFlight();sim.quaternion.setFromAxisAngle(new Vector3(1,0,0),0.4);
 const points=(sim as any).contacts as Vector3[];
 const lowest=Math.min(...points.map(point=>point.clone().sub(sim.cg).applyQuaternion(sim.quaternion).y));
 sim.position.y=20-lowest;sim.velocity.y=-0.3;
 (sim as any).updateTelemetry();const energy=sim.telemetry.energy,dissipated=sim.telemetry.dissipatedEnergy;
 (sim as any).preparePlatformContacts();expect((sim as any).platformCount).toBeGreaterThan(0);
 sim.step(neutral);
 expect(sim.ended).toBe(false);
 for(const point of points){if(!(sim as any).mainContact(point))continue;expect(point.clone().sub(sim.cg).applyQuaternion(sim.quaternion).add(sim.position).y).toBeGreaterThan(20-3e-6);}
 const t=sim.telemetry;
 expect(t.energy+t.dissipatedEnergy-dissipated-t.propulsionWork-t.controlWork-t.waterWork+t.fuelEnergyRemoved).toBeCloseTo(energy,6);
});

it('ends on actual nose or inverted cockpit contact, and only ends a touching fuselage below 1.5 m/s',()=>{
 for(const key of ['nose','canopy'] as const){
  const sim=groundFlight();
  sim.quaternion.setFromAxisAngle(new Vector3(key==='nose'?0:1,0,key==='nose'?1:0),key==='nose'?-0.5:Math.PI);
  sim.position.y+=20-bodyBottom(sim,key).y-1e-5;sim.step(neutral);
  expect(sim.result?.landing).toBe('terrain');
 }
 for(const speed of [WATER.stopSpeed-0.01,WATER.stopSpeed+0.01,8]){
  const sim=groundFlight(speed);sim.position.y+=20-bodyBottom(sim,'shell').y-1e-6;sim.step(neutral,1e-5);
  expect(sim.ended).toBe(speed<WATER.stopSpeed);
 }
 const sim=groundFlight(0),launch=challenges.challengeLaunch('low-altitude')!;
 sim.position.set((launch.startX+launch.endX)/2,launch.y+1,launch.z);
 sim.position.y+=launch.y-bodyBottom(sim,'shell').y;sim.step(neutral,1e-5);
 expect(sim.ended).toBe(false);
});

it('saves substep load maxima and reads waveforms without running physics',async()=>{
 const big=new FlightSimulation(defaultAircraft,'birdman',0),fine=new FlightSimulation(defaultAircraft,'birdman',0);
 big.step(neutral,0.25);for(let i=0;i<15;i++)fine.step(neutral);
 const recording=big.getRecording(),fineLoads=fine.getRecording().wingLoads!;
 for(let wing=0;wing<3;wing++)expect(recording.wingLoads![wing]).toBeCloseTo(Math.max(...Array.from({length:15},(_,i)=>fineLoads[i*3+wing])),10);
 const step=vi.spyOn(FlightSimulation.prototype,'step');
 expect(recordedLoads(recording).at(-1)?.main).toBe(recording.wingLoads![0]);expect(step).not.toHaveBeenCalled();step.mockRestore();
 const replay={definition:clone(defaultAircraft),challenge:'birdman' as const,recording};
 const data=JSON.parse(await exportReplay(replay));
 for(const loads of [null,[1],['1',0,0],[-1,0,0],[null,0,0]]){
  await expect(importReplay(JSON.stringify({...data,recording:{...data.recording,wingLoads:loads}}))).rejects.toThrow('负载');
 }
 const pending=exportReplay(replay),expected=recording.wingLoads!.slice();recording.wingLoads!.fill(99);
 expect((await importReplay(await pending)).recording.wingLoads).toEqual(expected);
});

const state=(s:FlightSimulation)=>({p:s.position.toArray(),q:s.quaternion.toArray(),v:s.velocity.toArray(),w:s.omega.toArray(),fuel:s.telemetry.fuelRemaining,g:s.telemetry.gForce,fragments:s.fragments.map(f=>[f.id,...f.position.toArray(),...f.velocity.toArray()]),sections:s.structure.sections.map(p=>[p.bodyId,p.stressRatio,...p.tip.position.toArray()])});
it('restores independent checkpoints including fuel, controls, deformation and fracture state',async()=>{
 const definition=conventional();for(const key of ['mainWing','horizontalTail','verticalTail'] as const){definition[key].materialId='spruce';definition[key].structure={width:0.005,height:0.005,wallThickness:0.0002};}
 const sim=new FlightSimulation(definition,'downhill',0);
 cacheFlight(sim);const states=new Map<number,ReturnType<typeof state>>();
 for(let i=0;i<480&&!sim.ended;i++){sim.step({...neutral,elevator:0.5,aileron:Math.sin(i/40)*0.2,rudder:0.1,throttle:1},i%2?1/60:1/120);cacheFlight(sim);states.set(sim.recordingLength,state(sim));}
 const recording=sim.getRecording(),replay={definition,challenge:'downhill' as const,recording};cacheRecording(sim,recording);
 expect(sim.telemetry.fuelRemaining).toBeLessThan(definition.fuelTank.capacity);expect(sim.fragments.length).toBeGreaterThan(0);
 const steps=vi.spyOn(FlightSimulation.prototype,'step');
 const a=await seekReplay(replay,4.5,()=>false);expect(state(a!)).toEqual(states.get(a!.replayFrame));expect(steps.mock.calls.length).toBeLessThan(81);
 a!.position.set(999,999,999);a!.structure.sections[0].tip.position.set(999,999,999);
 steps.mockClear();const b=await seekReplay(replay,3.2,()=>false);expect(state(b!)).toEqual(states.get(b!.replayFrame));expect(steps.mock.calls.length).toBeLessThan(81);
 const c=await seekReplay(replay,4.5,()=>false);expect(state(c!)).toEqual(states.get(c!.replayFrame));
 const linear=replaySimulation(replay);while(linear.replayFrame<c!.replayFrame)linear.step(neutral);expect(state(c!)).toEqual(state(linear));
 expect(c!.getRecording()).toEqual(recording);
},30000);

it('retains older regions of a long recording for deterministic forward and backward seeks',async()=>{
 // Keep the engine off on the rail so recording length does not depend on piloting.
 const definition=conventional(),sim=new FlightSimulation(definition,'low-altitude',0);
 cacheFlight(sim);
 for(let i=0;i<320;i++){
  sim.step({...neutral,throttle:0,elevator:Math.sin(i/20)*0.2},i%2?0.25:0.125);
  cacheFlight(sim);
 }
 expect(sim.ended).toBe(false);expect(sim.elapsedTime).toBe(60);
 const recording=sim.getRecording(),replay={definition,challenge:'low-altitude' as const,recording};
 cacheRecording(sim,recording);
 const linear=replaySimulation(replay),states=new Map([[0,state(linear)]]);
 while(!linear.replayFinished){linear.step(neutral);states.set(linear.replayFrame,state(linear));}
 const steps=vi.spyOn(FlightSimulation.prototype,'step');
 for(const source of [replay,{...replay,recording:{...recording,frames:recording.frames.slice()}}]){
  // A distinct recording has no live cache; a first traversal must populate it.
  if(source!==replay)await seekReplay(source,Infinity,()=>false);
  for(const target of [12.5,36.25,8.75,48.5]){
   steps.mockClear();let start=-1;
   const restored=await seekReplay(source,target,()=>false,s=>{if(start<0)start=s.elapsedTime;});
   expect(start).toBeGreaterThan(0);expect(start).toBeLessThanOrEqual(target);
   expect(steps.mock.calls.length).toBeLessThan(32);
   expect(state(restored!)).toEqual(states.get(restored!.replayFrame));
  }
 }
},90_000);
