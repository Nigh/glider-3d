import { createServer } from 'vite';
import { Session } from 'node:inspector';
import { writeFile } from 'node:fs/promises';
const server=await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null},appType:'custom'});
const session=new Session();session.connect();
const post=(method)=>new Promise((resolve,reject)=>session.post(method,(error,result)=>error?reject(error):resolve(result)));
try{
 const {FlightSimulation}=await server.ssrLoadModule('/src/physics.ts');
 const {clone,defaultAircraft,wing}=await server.ssrLoadModule('/src/model.ts');
 const {cacheFlight}=await server.ssrLoadModule('/src/playback.ts');
 const results=[];
 await post('Profiler.enable');await post('Profiler.start');
 for(const large of [false,true]){
  const d=clone(defaultAircraft);if(large)d.mainWing=wing(24,.9,.6);
  const sim=new FlightSimulation(d,'birdman',0),physics=[],cache=[];
  for(let i=0;i<240&&!sim.ended;i++){
   let start=performance.now();sim.step({weight:0,rudder:0,elevator:0,aileron:0});physics.push(performance.now()-start);
   start=performance.now();cacheFlight(sim);cache.push(performance.now()-start);
  }
  const stats=values=>{values.sort((a,b)=>a-b);return {mean:values.reduce((a,b)=>a+b,0)/values.length,p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1)};};
  results.push({aircraft:large?'24 m high aspect ratio':'default',steps:physics.length,physicsMs:stats(physics),cacheMs:stats(cache)});
 }
 const {profile}=await post('Profiler.stop');
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),totals=new Map();
 for(let i=0;i<profile.samples.length;i++){
  const node=nodes.get(profile.samples[i]),key=node.callFrame.functionName||node.callFrame.url;
  totals.set(key,(totals.get(key)||0)+(profile.timeDeltas[i]||0));
 }
 console.log(JSON.stringify({results,profileTopMs:[...totals].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([name,us])=>({name,ms:us/1000}))},null,2));
 if(process.env.CPU_PROFILE)await writeFile(process.env.CPU_PROFILE,JSON.stringify(profile));
}finally{session.disconnect();await server.close();}
