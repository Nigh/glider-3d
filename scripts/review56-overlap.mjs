// Compare the same frozen geometry/flow; --baseline loads the pre-fix force model.
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),baseline=process.argv.includes('--baseline');
const previous='2d805f9dec5711303327dc4796d6c5fb93c556af';
const server=await createServer({root,configFile:false,logLevel:'error',optimizeDeps:{noDiscovery:true},
 plugins:baseline?[{name:'pre-overlap-model',enforce:'pre',load(id){
  const path=id.replaceAll('\\','/');
  if(path.endsWith('/src/physics.ts')||path.endsWith('/src/storage.ts'))return execFileSync('git',['show',`${previous}:src/${path.split('/').at(-1)}`],{cwd:root,encoding:'utf8'});
 }}]:[],server:{middlewareMode:true,watch:null},appType:'custom'});
try{
 const {FlightSimulation}=await server.ssrLoadModule('/src/physics.ts');
 const {presets,clone,DEG}=await server.ssrLoadModule('/src/model.ts');
 const {PHYSICS_VERSION}=await server.ssrLoadModule('/src/storage.ts');
 const {Vector3}=await import('three');
 const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/review56-twin.json',import.meta.url),'utf8'));
 const neutral={weight:0,lateral:0,elevator:0,aileron:0,rudder:0,throttle:0},results=[];
 for(const d of [...presets,fixture])for(const pitch of [0,5.3]){
  const sim=new FlightSimulation(clone(d),'test-space',0),velocity=new Vector3(31,0,0);
  sim.seaLevelReference=true;sim.launching=false;sim.position.set(100,1000,0);sim.quaternion.setFromAxisAngle(new Vector3(0,0,1),pitch*DEG);sim.omega.set(0,0,0);
  sim.evaluateForces(neutral,velocity,sim.omega,sim.quaternion,sim.position,neutral);
  sim.aerodynamics.update(sim.cg,sim.quaternion,velocity,sim.telemetry.torque,sim.omega);
  const a=sim.aerodynamics;
  results.push({name:d.name,pitch,drag:-a.drag.dot(a.dragAxis),nonInduced:-a.profileDrag.dot(a.dragAxis),
   terms:Object.fromEntries(Object.entries(a.dragTerms).map(([key,force])=>[key,-force.dot(a.dragAxis)])),
   exposedWingArea:sim.surfaces.reduce((sum,s)=>sum+s.area*(s.exposedFraction??1),0),
   geometricWingArea:sim.surfaces.reduce((sum,s)=>sum+s.area,0)});
 }
 console.log(JSON.stringify({physicsVersion:PHYSICS_VERSION,speed:31,geometry:'Frozen undeformed system/fixture geometry; sea level, zero controls, zero angular velocity. No trim or support-shape differences.',results},null,2));
}finally{await server.close();}
