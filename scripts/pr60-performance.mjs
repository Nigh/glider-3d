import { createServer } from 'vite';
const server=await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null},appType:'custom'});
try {
 const { FlightSimulation }=await server.ssrLoadModule('/src/physics.ts');
 const { clone,presets }=await server.ssrLoadModule('/src/model.ts');
 const { exportReplay,importReplay }=await server.ssrLoadModule('/src/replay.ts');
 const { GhostBuffer,ghostFrameBytes }=await server.ssrLoadModule('/src/ghost.ts');
 const definition=clone(presets.find(p=>p.name==='基础单发型'));definition.engine.count=0;definition.fuelTank.capacity=0;
 const sim=new FlightSimulation(definition,'low-altitude',0);
 const physicsStart=performance.now();for(let i=0;i<1800&&!sim.ended;i++)sim.step({weight:0,elevator:0,aileron:0,rudder:0,throttle:0});
 const recording=sim.getRecording(),physicsMs=performance.now()-physicsStart;
 const text=await exportReplay({definition,challenge:'low-altitude',recording});
 const legacy=JSON.parse(text);delete legacy.recording.ghostData;delete legacy.recording.ghostEncoding;delete legacy.recording.checkpointTimes;
 const files=[['legacy',JSON.stringify(legacy)],['visual-track',text]];
 const results=[];
 for(const [format,file] of files){
  let steps=0;const step=FlightSimulation.prototype.step;FlightSimulation.prototype.step=function(...args){steps++;return step.apply(this,args);};
  const begin=performance.now();let firstTrackMs;
  const replay=await importReplay(file,'ghost',()=>{firstTrackMs??=performance.now()-begin;});const importMs=performance.now()-begin;
  const buffer=new GhostBuffer();buffer.push(replay.recording.ghostFrames);
  const sampleStart=performance.now();for(let i=0;i<6000;i++)buffer.sample((i%1800)/60);const samplingMs=performance.now()-sampleStart;
  FlightSimulation.prototype.step=step;
  results.push({format,bytes:Buffer.byteLength(file),firstTrackMs:firstTrackMs??importMs,importMs,physicsSteps:steps,visualSamples:buffer.frames.length,trackBytes:buffer.frames.reduce((sum,f)=>sum+ghostFrameBytes(f),0),samples6000Ms:samplingMs});
 }
 console.log(JSON.stringify({duration:sim.elapsedTime,sections:sim.structure.sections.length,livePhysicsAndRecordingMs:physicsMs,results},null,2));
} finally {await server.close();}
