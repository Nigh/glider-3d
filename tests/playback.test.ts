import { expect, it } from 'vitest';
import { clone, defaultAircraft, presets } from '../src/model';
import { FlightSimulation, GRAVITY } from '../src/physics';
import { Vector3 } from 'three';
import { recordedLoads, replayDuration, replaySimulation, seekReplay } from '../src/playback';

const neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0 };

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
 const definition=clone(presets.find(p=>p.name==='高山速降机动型')!),sim=new FlightSimulation(definition,'downhill',0);
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
