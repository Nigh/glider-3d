<script lang="ts">
 import { onMount } from 'svelte';
 import { defaultAircraft, presets, clone, clamp, planform, validateAircraft, fuselageEnds, fuselageEndLimits, resizeFuselage, mainWingMountLimits, mainWingSupport, wingMountLimits, cockpitLimits, cockpitRearLengthLimits, fuelCapacityLimit, normalizeAircraftGeometry, editWingPoint, engineMountLimits, engineMounts, engineHeightRanges, fuelTankLimits, PILOT_MASS, type AircraftDefinition, type Wing } from './model';
 import { FlightSimulation, derive, GRAVITY, LAUNCH, type FlightControls } from './physics';
 import { engineCatalog, FUEL_DENSITY } from './engines';
 import { challengeDefinitions, challengeLaunch, LOW_ALTITUDE, type ChallengeMode } from './challenges';
 import { SceneView, type PilotHudFrame } from './scene';
 import LaboratoryControls from './LaboratoryControls.svelte';
 import LaboratoryResults from './LaboratoryResults.svelte';
 import WindForces from './WindForces.svelte';
 import { windForceSnapshot } from './wind-forces';
 import { defaultTestSpace, defaultWindTunnel, isLaboratory, type TestSpaceSettings, type WindTunnelSettings } from './laboratory';
 import { listAircraft, loadAircraft, saveAircraft, deleteAircraft, renameAircraft, duplicateAircraft, exportAircraft, importAircraft, isAircraftCompatible, readBest, writeBest, History, type SavedAircraft } from './storage';
 import ReplayTimeline from './ReplayTimeline.svelte';
 import { seekReplay, cacheFlight, cacheRecording, cacheReplay } from './playback';
 import WingEditor from './WingEditor.svelte'; import Parameter from './Parameter.svelte';
 import { GameAudio } from './audio';
 import AudioSettings from './AudioSettings.svelte';
 import InputSettings from './InputSettings.svelte';
 import InputReadout from './InputReadout.svelte';
 import { InputManager } from './input';
 import { trimStep, trimFromPointer, pitchDisplay } from './trim';
 import { FixedGameClock } from './game-clock';
 import { energyCostScale } from './flight-chart';
 import { exportReplay, importReplay, MAX_REPLAY_BYTES, type Replay } from './replay';
 import { summarizeWingStructure } from './structure';
 import { language, setLanguage, t as translate, type Language, type TranslationParams } from './i18n';
 const t=$derived.by(()=>{const locale=$language;return (source:string,params?:TranslationParams)=>translate(source,params,locale);});
 let audioError=$state('');
 const audio=new GameAudio(message=>audioError=message);
 function syncAudio(){audio.update({screen,ready:flightReady,paused:screen==='flight'&&paused,hidden:document.hidden,speed:simulation?.telemetry.speed??0,launching:simulation?.launching??false,engineRpm:simulation?.telemetry.engineRpm??0,challenge:simulation?.challenge??lastChallenge,launchKind:simulation?.launch?.kind??challengeLaunch(lastChallenge)?.kind??'catapult',timingStarted:simulation?.telemetry.timingStarted??false,challengeProgress:simulation?.telemetry.challengeProgress??0,simulation:simulation??undefined});}
 $effect(()=>{screen;flightReady;paused;if(sceneReady)syncAudio();});
 type Tab='机身'|'主翼'|'副翼'|'垂直尾翼'|'动力';
 const editorTabs={fuselage:'机身',mainWing:'主翼',horizontalTail:'副翼',verticalTail:'垂直尾翼',propulsion:'动力'} as const;
 const designViewNames:Record<string,string>={free:'自由',orbit:'自由',top:'俯视',side:'侧视',front:'正视',rear:'后视'};
 let host:HTMLDivElement;let scene:SceneView;let sceneReady=$state(false);let simulation:FlightSimulation|null=null;let history=$state.raw(new History(clone(defaultAircraft)));let historyVersion=$state(0);
 let aircraft=$state.raw<AircraftDefinition>(clone(defaultAircraft));let tab=$state<Tab>('主翼');let screen=$state<'menu'|'design'|'flight'|'result'>('menu');let quality=$state<'Auto'|'High'|'Medium'|'Low'>('Auto');
 const qualityNames:Record<string,string>={Auto:'自动',High:'高',Medium:'中',Low:'低'};
 let challenge=$state<ChallengeMode>('birdman'),lastChallenge=$state<ChallengeMode>('birdman');
 let testSettings=$state<TestSpaceSettings>({...defaultTestSpace}),windSettings=$state<WindTunnelSettings>({...defaultWindTunnel});
 let saved=$state.raw<SavedAircraft[]>([]),selectedId=$state(''),message=$state(''),showLibrary=$state(false),debug=$state(false),aero=$state(false),stick=$state(false),stickX=$state(0),stickY=$state(0),paused=$state(false),flightReady=$state(false);let best=$state(0);let result=$state<any>(null),hud=$state<any>({speed:0,altitude:LAUNCH.height,distance:0,alpha:0,pitch:0,roll:0,sink:0,glide:0,time:0,liftDragRatio:0,potentialEnergy:0,kineticEnergy:0,dissipatedEnergy:0,initialEnergy:0,launching:true});let perf=$state<any>({});
 let stats=$derived(derive(aircraft));let main=$derived(planform(aircraft.mainWing));let wingKey=$derived<'mainWing'|'horizontalTail'|'verticalTail'>(tab==='副翼'?'horizontalTail':tab==='垂直尾翼'?'verticalTail':'mainWing');
 const controlAxisOptions=[{key:'roll',label:'滚转'},{key:'pitch',label:'俯仰'},{key:'yaw',label:'偏航'}] as const;
 let wingControlAxes=$derived(aircraft[wingKey].controlAxes??{roll:wingKey!=='verticalTail',pitch:wingKey!=='verticalTail',yaw:wingKey==='verticalTail'});
 let ends=$derived(fuselageEnds(aircraft));
 let cockpitRange=$derived(cockpitLimits(aircraft));
 let cockpitMin=$derived(cockpitRange.min),cockpitMax=$derived(cockpitRange.max);
 let noseRange=$derived(fuselageEndLimits(aircraft,'nose')),tailEndRange=$derived(fuselageEndLimits(aircraft,'tail'));
 let rearRange=$derived(cockpitRearLengthLimits(aircraft));
 let mainMountLimits=$derived(mainWingMountLimits(aircraft)),support=$derived(mainWingSupport(aircraft));
 let engineRanges=$derived(engineHeightRanges(aircraft)),tankLimits=$derived(fuelTankLimits(aircraft));
 let thrustToWeight=$derived.by(()=>{const thrust=aircraft.engine.count*engineCatalog[aircraft.engine.type].maxThrust;return {full:thrust/(stats.mass*GRAVITY),empty:thrust/((stats.mass-(aircraft.engine.count>0?aircraft.fuelTank.capacity*FUEL_DENSITY:0))*GRAVITY)};});
 let thrustCenter=$derived.by(()=>{const mounts=engineMounts(aircraft);if(!mounts.length)return null;return mounts.reduce((center,mount)=>({x:center.x+mount.x/mounts.length,y:center.y+mount.y/mounts.length,z:center.z+mount.z/mounts.length}),{x:0,y:0,z:0});});
 let recording=$state.raw<ReturnType<FlightSimulation['getRecording']>|null>(null);let recordedLength=$state(0);let isReplay=$state(false);let lastDefinition=$state.raw(clone(defaultAircraft));
 let inputError=$state('');
 const input=new InputManager(message=>{inputError=message;queueMicrotask(()=>notify(message));});
 let inputSettingsOpen=$state(false);
 const controls:FlightControls={weight:0,lateral:0,rudder:0,elevator:0,aileron:0};
 const structureWings=summarizeWingStructure([]);
 let trimPitch=$state(0),trimRoll=$state(0),autoTrim=$state(false),smartMixing=$state(false),adaptiveControls=$state(false);
 let stickPointer:number|null=null,yawPointer:number|null=null,yawInput=0;
 let pitchTrimLocked=$derived(isReplay?hud.autoTrim??false:autoTrim);
 let displayedPitch=$derived(isReplay||autoTrim&&flightReady?hud.trimPitch??0:trimPitch),displayedRoll=$derived(isReplay?hud.trimRoll??0:trimRoll);
 let actualPitch=$derived(lastDefinition.birdman?hud.controlInputs?.weight??0:hud.controlInputs?.elevator??0);
 let actualRoll=$derived(lastDefinition.birdman?hud.controlInputs?.lateral??0:hud.controlInputs?.aileron??0);
 // Project body-axis pitch onto world up; trim settings remain body-axis values.
 let pitchDisplayScale=$derived(pitchDisplay(1,(hud.roll??0)*Math.PI/180));
 let flightInputDisabled=$derived(!flightReady||isReplay||paused);
 let throttle=$state(1);
 const flightViews=['追尾','锁定','侧追尾','驾驶员'];
 const replayViews=[...flightViews,'侧面','自由','轨道','俯视','侧视','正视','后视'];
 let availableViews=$derived(isReplay?replayViews:flightViews);
 const cameraKey='aero-formula.flight-camera';
 function savedCamera(){try{const value=localStorage.getItem(cameraKey);return value&&flightViews.includes(value)?value:'追尾';}catch{return '追尾';}}
 let flightCamera=$state(savedCamera());
 let windCamera=$state('侧视');
 let designCamera=$state('自由');
 function selectDesignCamera(value:string){designCamera=value;scene.cameraView(value);}
 const windViews=['侧视','俯视','正视','自由'];
 function selectWindCamera(value:string){windCamera=value;scene.cameraView(value);}
 function selectCamera(value:string){flightCamera=value;scene.cameraView(value);try{localStorage.setItem(cameraKey,value);}catch{/* Keep the session preference when storage is blocked. */}}
 let activeReplay=$state.raw<Replay|null>(null),seeking=$state(false),replayPosition=$state(0);let seekVersion=0;
 let seekFrame=0,seekSeconds=0,seekRequestVersion=0;let seekSource:Replay|null=null;
 function seekTo(seconds:number){
  seekSeconds=seconds;seekSource=activeReplay;seekRequestVersion=++seekVersion;seeking=true;
  if(seekFrame)return;
  seekFrame=requestAnimationFrame(()=>{seekFrame=0;if(seekRequestVersion===seekVersion&&activeReplay===seekSource&&(screen==='flight'||screen==='result'))void seekNow(seekSeconds);});
 }
 const replaySamples=new WeakMap<object,Map<number,FlightSample>>();
 async function seekNow(seconds:number){
  if(!activeReplay)return;const source=activeReplay,version=++seekVersion;paused=true;seeking=true;clearControls();
  const saved=replaySamples.get(source.recording)??new Map<number,FlightSample>();replaySamples.set(source.recording,saved);let last=-Infinity;
  try{
   const next=await seekReplay(source,seconds,()=>version!==seekVersion||screen==='menu'||screen==='design',sim=>{if(!(source.challenge==='birdman'&&sim.launching)&&sim.elapsedTime-last>=0.1){saved.set(sim.elapsedTime,flightSample(sim));last=sim.elapsedTime;}});
   if(!next)return;
   simulation=next;screen='flight';result=null;flightReady=true;flightElapsed=next.elapsedTime;replayPosition=next.elapsedTime;
   samples=[...saved.values()].filter(p=>p.time<=next.elapsedTime+1e-9).sort((a,b)=>a.time-b.time);lastSampleTime=samples.at(-1)?.time??-Infinity;sampleFlight(true);trajectory=samples.slice();
   scene.setFlight(next,true);scene.cameraView(flightCamera);scene.captureFlightState();refreshHud();syncAudio();
  }catch(e){if(version===seekVersion)notify((e as Error).message);}finally{if(version===seekVersion)seeking=false;}
 }

 let pilotHud=$state.raw<PilotHudFrame|null>(null);
 let replayBusy=$state(false);
 let messageTimeout:ReturnType<typeof setTimeout>;
 type FlightSample={time:number;distance:number;height:number;speed:number;scoringHeight:number;energyRatio:number;energyPerDistance:number|null;waterContact:boolean;gForce:number};
 let samples:FlightSample[]=[],lastSampleTime=-Infinity,flightElapsed=0;
 let trajectory=$state.raw<FlightSample[]>([]);
 let chartMaxDistance=$derived(trajectory.reduce<number>((max,p)=>Math.max(max,p.distance),1));
 let chartMaxHeight=$derived(trajectory.reduce<number>((max,p)=>Math.max(max,p.height,lastChallenge==='low-altitude'?p.scoringHeight:0),LAUNCH.height));
 let chartMaxEnergy=$derived(trajectory.reduce((max,p)=>Math.max(max,p.energyRatio),1));
 let chartWidth=$derived(screen==='result'?420:290);
 let chartHeight=$derived(screen==='result'?148:76);
 let chartBottom=$derived(22+chartHeight);
 let chartPoints=$derived(trajectory.map(p=>`${(38+(screen==='result'?p.time/chartMaxTime:p.distance/chartMaxDistance)*chartWidth).toFixed(2)},${(chartBottom-p.height/chartMaxHeight*chartHeight).toFixed(2)}`).join(' '));
 let energyCurvePoints=$derived(screen==='result'?trajectory.map(p=>`${(38+p.time/chartMaxTime*chartWidth).toFixed(2)},${(chartBottom-p.energyRatio/chartMaxEnergy*chartHeight).toFixed(2)}`).join(' '):'');
 let chartMaxCost=$derived(energyCostScale(trajectory));
 let costOutliers=$derived(trajectory.filter(p=>p.energyPerDistance!==null&&p.energyPerDistance>chartMaxCost));
 let costCurvePath=$derived(screen==='result'?trajectory.map((p,i)=>p.energyPerDistance===null?'':`${i===0||trajectory[i-1].energyPerDistance===null?'M':'L'}${(38+p.time/chartMaxTime*chartWidth).toFixed(2)},${(chartBottom-Math.min(p.energyPerDistance,chartMaxCost)/chartMaxCost*chartHeight).toFixed(2)}`).join(' '):'');
 let chartMaxTime=$derived(trajectory.reduce((max,p)=>Math.max(max,p.time),1));
 let chartMaxG=$derived(trajectory.reduce((max,p)=>Math.max(max,p.gForce),1));
 let gCurvePoints=$derived(trajectory.map(p=>`${(38+p.time/chartMaxTime*chartWidth).toFixed(2)},${(chartBottom-p.gForce/chartMaxG*chartHeight).toFixed(2)}`).join(' '));
 let chartMaxSpeed=$derived(trajectory.reduce((max,p)=>Math.max(max,p.speed),1));
 let speedCurvePoints=$derived(screen==='result'?trajectory.map(p=>`${(38+p.time/chartMaxTime*chartWidth).toFixed(2)},${(chartBottom-p.speed/chartMaxSpeed*chartHeight).toFixed(2)}`).join(' '):'');
 let scoringCurvePoints=$derived(screen==='result'&&lastChallenge==='low-altitude'?trajectory.map(p=>`${(38+p.time/chartMaxTime*chartWidth).toFixed(2)},${(chartBottom-p.scoringHeight/chartMaxHeight*chartHeight).toFixed(2)}`).join(' '):'');
 let energyParts=$derived([{key:'potential',name:'势能',value:hud.potentialEnergy},{key:'kinetic',name:'动能',value:hud.kineticEnergy},{key:'dissipated',name:'已耗散',value:hud.dissipatedEnergy}]);
 let energyTotal=$derived(hud.potentialEnergy+hud.kineticEnergy+hud.dissipatedEnergy);
 let energyBudget=$derived(hud.initialEnergy+(hud.propulsionWork??0)+(hud.controlWork??0)+(hud.waterWork??0)-(hud.fuelEnergyRemoved??0));
 let assemblyPositions=$derived([{key:'mainWing',label:'主翼纵向位置',value:aircraft.assembly.mainWing,min:mainMountLimits.min,max:mainMountLimits.max},{key:'horizontalTail',label:'副翼位置',value:aircraft.assembly.horizontalTail,min:wingMountLimits(aircraft,'horizontalTail').min,max:wingMountLimits(aircraft,'horizontalTail').max},{key:'verticalTail',label:'垂直尾翼位置',value:aircraft.assembly.verticalTail,min:wingMountLimits(aircraft,'verticalTail').min,max:wingMountLimits(aircraft,'verticalTail').max},{key:'cockpit',label:'驾驶舱位置',value:aircraft.cockpit.position,min:cockpitMin,max:cockpitMax}] as const);
 function setPosition(key:typeof assemblyPositions[number]['key'],input:HTMLInputElement){const n=Math.round(input.valueAsNumber*100)/100,position=assemblyPositions.find(p=>p.key===key)!;if(Number.isFinite(n)){const supported=clamp(n,position.min,position.max);change(d=>{if(key==='cockpit')d.cockpit.position=supported;else{if(key==='horizontalTail')d.assembly.tailOnFin=false;d.assembly[key]=supported;}});if(n!==supported)notify('已限制在机身支撑范围内；可先延长机头或机尾。');commit();}else notify('位置必须是有限数值');input.value=String(Number((key==='cockpit'?aircraft.cockpit.position:aircraft.assembly[key]).toFixed(2)));}
 function setEnd(end:'nose'|'tail',input:HTMLInputElement){const n=Math.round(input.valueAsNumber*100)/100;if(Number.isFinite(n)){change(d=>resizeFuselage(d,end,n));commit();if(Math.abs(fuselageEnds(aircraft)[end]-n)>1e-6)notify('端点受 3–12 m 机身长度、驾驶舱和尾翼支撑限制。');}else notify('端点必须是有限数值');input.value=String(Number(fuselageEnds(aircraft)[end].toFixed(2)));}
 $effect(()=>{const target=screen==='design'&&!showLibrary?(tab==='动力'?'propulsion':tab==='机身'?'fuselage':wingKey):null;if(sceneReady)scene.setEditor(target,d=>change(out=>Object.assign(out,d)),commit);});
 function flightSample(sim:FlightSimulation):FlightSample{const t=sim.telemetry;return {time:sim.elapsedTime,distance:t.distance,height:t.altitude,speed:t.speed,scoringHeight:t.altitude-t.groundClearance+LOW_ALTITUDE.scoringHeight,energyRatio:t.initialEnergy>0?(t.kineticEnergy+t.potentialEnergy)/t.initialEnergy:0,energyPerDistance:t.energyPerDistance,waterContact:t.waterContact,gForce:t.gForce};}
 function sampleFlight(final=false){if(!simulation||isLaboratory(lastChallenge)||(lastChallenge==='birdman'&&simulation.launching))return;if(final||flightElapsed-lastSampleTime>=0.1){const point=flightSample(simulation);samples.push(point);if(isReplay&&activeReplay){let saved=replaySamples.get(activeReplay.recording);if(!saved){saved=new Map();replaySamples.set(activeReplay.recording,saved);}saved.set(point.time,point);}lastSampleTime=flightElapsed;}}
 function refreshHud(){if(!simulation)return;const t=simulation.telemetry,s=simulation.structure;hud={...t,controlInputs:{...t.controlInputs},wind:{...simulation.windTunnel},windEnabled:simulation.windTunnelEnabled,windForces:simulation.challenge==='wind-tunnel'?windForceSnapshot(t,simulation.quaternion):undefined,alpha:t.alpha*180/Math.PI,pitch:t.pitch*180/Math.PI,roll:t.roll*180/Math.PI,time:simulation.time,launching:simulation.launching,maxStressRatio:s.maxStressRatio,maxYieldRatio:s.maxYieldRatio,maxDeflection:s.maxDeflection,fractureCount:s.fractureCount,fragmentCount:simulation.fragments.length,peakWings:s.peakWings,wings:summarizeWingStructure(s.sections,structureWings)};}
 function refreshTrajectory(){if(trajectory.length!==samples.length)trajectory=samples.slice();}
 const hints:Record<Tab,string>={
  '机身':'驾驶舱的位置改变重心。过度靠后可能让飞机俯仰失稳。',
  '主翼':'拖动顶点或根弦、梢弦的圆形手柄调整翼型。按住 Ctrl 取消吸附。增加面积降低翼载荷，但增加重量与阻力。',
  '副翼':'拖动顶点或根弦、梢弦的圆形手柄调整翼型。按住 Ctrl 取消吸附。增大副翼或后移安装位置，通常提高俯仰稳定性。',
  '垂直尾翼':'侧视拖动顶点或根弦、梢弦的圆形手柄。按住 Ctrl 取消吸附。垂直尾翼提供偏航恢复力矩，太小容易偏离航向。',
  '动力':'喷气引擎与油箱参与质量、重心和惯量计算。引擎偏离机身时自动增加支撑。正 X 朝机头。',
 };
 function notify(s:string,kind:'success'|'error'='error'){audio.ui(kind);clearTimeout(messageTimeout);message=s;messageTimeout=setTimeout(()=>message='',5000);}
 function commit(){try{aircraft=validateAircraft(aircraft);history.push(clone(aircraft));historyVersion++;}catch(e){notify((e as Error).message);}}
 function change(mutator:(d:AircraftDefinition)=>void){const d=clone(aircraft);mutator(d);try{normalizeAircraftGeometry(d);aircraft=validateAircraft(d);scene?.updateAircraft(aircraft);}catch(e){notify((e as Error).message);}}
 function toggleControlAxis(axis:keyof NonNullable<Wing['controlAxes']>){change(d=>{d[wingKey].controlAxes={...wingControlAxes,[axis]:!wingControlAxes[axis]};});commit();}
 function forChallenge(definition:AircraftDefinition,mode:ChallengeMode=challenge){const d=validateAircraft(definition);if(!isAircraftCompatible(d,mode))throw Error(mode==='birdman'?'鸟人间比赛只允许无动力鸟人间设计':'当前挑战不可使用鸟人间飞机，请选择普通飞机。');return d;}
 function replace(d:AircraftDefinition){try{aircraft=forChallenge(d);if(aircraft.birdman&&tab==='动力')tab='主翼';scene?.updateAircraft(aircraft);commit();return true;}catch(e){notify((e as Error).message);return false;}}
 function setAircraftType(birdman:boolean){if(!isLaboratory(challenge)||birdman===aircraft.birdman)return;change(d=>{d.birdman=birdman;if(birdman){d.engine.count=0;d.fuelTank.capacity=0;d.mainWing.controlSurface=0;d.horizontalTail.controlSurface=0;}else{d.mainWing.controlSurface=0.28;d.horizontalTail.controlSurface=0.4;}});if(birdman&&tab==='动力')tab='主翼';selectedId='';commit();}
 function undo(){if(screen!=='design'||showLibrary)return;const d=history.undo();if(d){aircraft=forChallenge(d);if(aircraft.birdman&&tab==='动力')tab='主翼';selectedId='';scene?.updateAircraft(aircraft);historyVersion++;}}
 function redo(){if(screen!=='design'||showLibrary)return;const d=history.redo();if(d){aircraft=forChallenge(d);if(aircraft.birdman&&tab==='动力')tab='主翼';selectedId='';scene?.updateAircraft(aircraft);historyVersion++;}}
 function library(){try{saved=listAircraft();}catch(e){saved=presets.map(preset=>loadAircraft(`system:${preset.name}`));notify((e as Error).message);}clearControls();showLibrary=true;}
 function save(){try{const definition=forChallenge(aircraft),existing=listAircraft().find(item=>!item.builtIn&&item.name===definition.name);if(existing&&!confirm(t('覆盖“{name}”？原设计将被替换。',{name:existing.name})))return;const item=saveAircraft(definition,existing?.id);selectedId=item.id;saved=listAircraft();notify('飞机已保存在此浏览器','success');}catch(e){notify((e as Error).message);}}
 function load(id:string){try{const item=loadAircraft(id);if(replace(item.definition)){selectedId=id;showLibrary=false;notify(t('已加载 {name}',{name:item.builtIn?t(item.name):item.name}),'success');}}catch(e){notify((e as Error).message);}}
 function renameSaved(id:string,name:string){try{const item=renameAircraft(id,name);saved=listAircraft();if(selectedId===id){change(d=>d.name=item.name);commit();}}catch(e){notify((e as Error).message);}}
 function fileExport(id:string){try{const definition=loadAircraft(id).definition,url=URL.createObjectURL(new Blob([exportAircraft(definition)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=definition.name+'.json';a.click();URL.revokeObjectURL(url);}catch(e){notify((e as Error).message);}}
 async function fileImport(e:Event){
 const input=e.target as HTMLInputElement;
 try{
  const f=input.files?.[0];
  if(f){
   if(f.size>100000)throw Error('文件超过 100 KB');
   const definition=importAircraft(await f.text()),item=saveAircraft(definition);
   saved=listAircraft();showLibrary=false;
   if(!isAircraftCompatible(definition,challenge)){
    notify(challenge==='birdman'?'已导入机库，但当前挑战只允许无动力鸟人间设计，未加载。':'已导入机库，但当前挑战不可使用鸟人间飞机，未加载。');
   }else{
    if(replace(definition)){selectedId=item.id;notify('导入成功','success');}
   }
  }
 }catch(e){notify(t('导入失败：{error}',{error:t((e as Error).message)}));}
 input.value='';
 }
 function clearControls(){stick=false;stickPointer=yawPointer=null;stickX=stickY=yawInput=0;input.clear();controls.weight=controls.lateral=controls.rudder=controls.elevator=controls.aileron=0;}
 function start(replay=false,imported?:Replay){
  seekVersion++;seeking=false;trimPitch=trimRoll=0;autoTrim=smartMixing=adaptiveControls=false;throttle=1;
  try{
   const selectedChallenge=imported?.challenge??(replay?lastChallenge:challenge),definition=forChallenge(imported?.definition??(replay?lastDefinition:aircraft),selectedChallenge);
   const next=new FlightSimulation(definition,selectedChallenge,undefined,testSettings);
   if(replay&&(imported?.recording??recording))next.loadReplay(imported?.recording??recording!);
   if(selectedChallenge==='wind-tunnel')next.setWindTunnel(windSettings);
   simulation=next;if(!replay&&!isLaboratory(selectedChallenge))cacheFlight(next);
   lastDefinition=clone(definition);lastChallenge=selectedChallenge;
   if(imported)recording=imported.recording;else if(isLaboratory(selectedChallenge))recording=null;
   samples=[];trajectory=[];lastSampleTime=-Infinity;flightElapsed=0;refreshHud();isReplay=replay;if(!replay&&!flightViews.includes(flightCamera))flightCamera='追尾';showLibrary=false;screen='flight';result=null;paused=false;flightReady=selectedChallenge==='wind-tunnel';clearControls();
   scene.setEditor(null,d=>change(out=>Object.assign(out,d)),commit);scene.setFlight(simulation);
   if(selectedChallenge==='wind-tunnel'){aero=true;windCamera='侧视';}
   scene.setDebug(aero);scene.cameraView(selectedChallenge==='wind-tunnel'?'侧视':flightCamera);
   activeReplay=replay?{definition:clone(lastDefinition),challenge:lastChallenge,recording:imported?.recording??recording!}:null;replayPosition=0;
  }catch(e){notify((e as Error).message);}
 }
 function configureTest(value:TestSpaceSettings){if(flightReady||!simulation)return;try{simulation.configureTestSpace(value);testSettings={...value};scene.captureFlightState();refreshHud();}catch(e){notify((e as Error).message);}}
 function configureWind(value:WindTunnelSettings){try{simulation?.setWindTunnel(value);windSettings={...value};}catch(e){notify((e as Error).message);}}
 function toggleWind(){if(!simulation)return;simulation.setWindTunnelEnabled(!simulation.windTunnelEnabled);refreshHud();}
 function restoreWindAircraft(){if(!simulation)return;simulation.restoreWindTunnelAircraft();scene.captureFlightState();refreshHud();}
 function stopTest(){if(!simulation||!flightReady)return;simulation.stopTest();finish();}
 async function replayExport(){
  if(!recording||replayBusy)return;
  replayBusy=true;
  try{
   const selectedChallenge=lastChallenge;
   const text=await exportReplay({definition:lastDefinition,challenge:selectedChallenge,recording});
   const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download=`${selectedChallenge}-replay.json`;a.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){notify((e as Error).message);}finally{replayBusy=false;}
 }
 async function replayImport(e:Event){
  const input=e.target as HTMLInputElement;
  if(replayBusy)return;
  replayBusy=true;
  try{
   const file=input.files?.[0];
   if(file){
    if(file.size>MAX_REPLAY_BYTES)throw Error('回放文件超过 16 MB');
    const replay=await importReplay(await file.text());
    start(true,replay);
   }
  }catch(e){notify(t('导入失败：{error}',{error:t((e as Error).message)}));}
  finally{input.value='';replayBusy=false;}
 }
 function beginFlight(){if(screen!=='flight'||!simulation||flightReady||seeking)return;clearControls();paused=false;flightReady=true;syncAudio();if(lastChallenge!=='wind-tunnel'&&(lastChallenge!=='test-space'||testSettings.catapult)&&lastChallenge!=='low-altitude')audio.launch();}
 function togglePause(){if(screen==='flight'&&lastChallenge!=='wind-tunnel'&&flightReady&&!seeking){paused=!paused;clearControls();}}
 function finish(){if(!simulation)return;sampleFlight(true);refreshHud();refreshTrajectory();result=simulation.result;if(result?.landing==='terrain'){audio.crash();scene.markCrash(()=>audio.stroke());}clearControls();recordedLength=simulation.recordingLength;screen='result';scene.cameraView('轨道');if(!isReplay&&!isLaboratory(lastChallenge)){recording=simulation.getRecording();cacheRecording(simulation,recording);replaySamples.set(recording,new Map(samples.map(p=>[p.time,p])));try{best=readBest(lastChallenge);if(lastChallenge==='birdman'||result.completed)best=writeBest(lastChallenge==='birdman'?result.distance:lastChallenge==='downhill'?result.time:result.score,lastChallenge);}catch(e){notify((e as Error).message);}}}
 function design(){seekVersion++;seeking=false;activeReplay=null;showLibrary=false;if(aircraft.birdman&&tab==='动力')tab='主翼';screen='design';simulation=null;flightReady=false;scene?.setFlight(null);scene?.updateAircraft(aircraft);selectDesignCamera('自由');clearControls();}
 function challengeAircraft(){return challenge==='birdman'||isLaboratory(challenge)&&aircraft.birdman?defaultAircraft:presets.find(p=>p.name===(challenge==='low-altitude'?'基础单发型':'高性能滑翔型'))!;}
 function enterChallenge(next:ChallengeMode){const previous=challenge;challenge=next;if(!isAircraftCompatible(aircraft,next)){aircraft=clone(challengeAircraft());selectedId='';history=new History(clone(aircraft));historyVersion=0;}else if(isLaboratory(previous)&&!isLaboratory(next)){history=new History(clone(aircraft));historyVersion=0;}showLibrary=false;try{best=readBest(challenge);}catch(e){notify((e as Error).message);}design();}
 function toggleAutoTrim(){if(screen!=='flight'||isReplay||lastDefinition.birdman)return;if(autoTrim)trimPitch=0;autoTrim=!autoTrim;}
 function toggleSmartMixing(){if(screen==='flight'&&!isReplay)smartMixing=!smartMixing;}
 function toggleAdaptiveControls(){if(screen==='flight'&&!isReplay)adaptiveControls=!adaptiveControls;}
 function setPitchTrim(value:number){if(!pitchTrimLocked)trimPitch=value;}
 function moveStick(e:PointerEvent){const bounds=e.currentTarget instanceof HTMLElement?e.currentTarget.getBoundingClientRect():null;if(!bounds)return;const radius=Math.min(bounds.width,bounds.height)/2,x=(e.clientX-bounds.left-bounds.width/2)/radius,y=(bounds.top+bounds.height/2-e.clientY)/radius,length=Math.hypot(x,y),scale=length>0.05?Math.min(1,(length-0.05)/0.95)/length:0;stickX=x*scale;stickY=y*scale;}
 function beginStick(e:PointerEvent){if(flightInputDisabled)return;e.preventDefault();stickPointer=e.pointerId;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);moveStick(e);}
 function releaseStick(e:PointerEvent){if(stickPointer!==e.pointerId)return;stickPointer=null;stickX=stickY=0;}
 function beginYaw(e:PointerEvent,value:number){if(flightInputDisabled)return;e.preventDefault();yawPointer=e.pointerId;yawInput=value;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);}
 function releaseYaw(e:PointerEvent){if(yawPointer===e.pointerId){yawPointer=null;yawInput=0;}}
 function keyboard(e:KeyboardEvent,down:boolean){
  if(!down){input.key(e.code,false);return;}
  if(input.suspended||inputSettingsOpen)return;
  const target=e.target instanceof HTMLElement?e.target:null;
  if(e.code==='Escape'&&!e.repeat){e.preventDefault();if(screen==='flight'||screen==='result')design();else if(screen==='design'){if(showLibrary)showLibrary=false;else screen='menu';}return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!target?.closest('input,textarea,[contenteditable="true"]')){e.preventDefault();e.shiftKey?redo():undo();return;}
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(target?.closest('input:not([type=range]):not([type=checkbox]):not([type=file]),textarea,select,summary,[contenteditable="true"]'))return;
  if(target?.matches('input[type=range]')&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  if(e.code==='Space'&&target?.closest('button,a'))return;
  if((screen==='flight'||screen==='result')&&input.key(e.code,true))e.preventDefault();
 }
 function inputActions(elapsed:number){
  if(input.pressed('restart')&&(screen==='result'||screen==='flight'&&flightReady&&paused)){start();return;}
  if(screen!=='flight'||seeking)return;
  if(input.pressed('pause')){audio.unlock();if(flightReady)togglePause();else beginFlight();}
  if(input.pressed('camera')){
   if(lastChallenge==='wind-tunnel')selectWindCamera(windViews[(windViews.indexOf(windCamera)+1)%windViews.length]);
   else selectCamera(availableViews[(availableViews.indexOf(flightCamera)+1)%availableViews.length]);
  }
  scene.lookInput(input.value('lookX'),input.value('lookY'),elapsed);
 if(isReplay||paused)return;
  if(input.pressed('autoTrim'))toggleAutoTrim();
  if(input.pressed('smartMixing'))toggleSmartMixing();
  if(input.pressed('adaptive'))toggleAdaptiveControls();
  if(input.pressed('trimPitchUp'))setPitchTrim(trimStep(displayedPitch,1));
  if(input.pressed('trimPitchDown'))setPitchTrim(trimStep(displayedPitch,-1));
  if(input.pressed('trimRollRight'))trimRoll=trimStep(trimRoll,1);
  if(input.pressed('trimRollLeft'))trimRoll=trimStep(trimRoll,-1);
  const mouseStick=input.value('mouseStick')>0;
  if(stick&&!mouseStick&&stickPointer===null)stickX=stickY=0;
  stick=mouseStick;
 }
onMount(()=>{
 scene=new SceneView(host);scene.onEditorSelect=target=>{if(screen==='design'&&!showLibrary)tab=editorTabs[target];};scene.onDesignViewChange=view=>{designCamera=designViewNames[view]??view;};scene.updateAircraft(aircraft);sceneReady=true;
 const unlock=()=>audio.unlock();
 const click=(e:MouseEvent)=>{const target=e.target instanceof Element?e.target:null;if(target?.closest('button:not(:disabled),summary')&&!target.closest('.flight-controls'))audio.ui('click');};
 document.addEventListener('pointerdown',unlock,true);document.addEventListener('keydown',unlock,true);document.addEventListener('click',click,true);
const clock=new FixedGameClock();
let previous=performance.now(),lastInstruments=0,request=0;
 const visibility=()=>{clearControls();input.suspended=inputSettingsOpen||document.hidden||!document.hasFocus();previous=performance.now();clock.reset();scene.captureFlightState();syncAudio();};
const stepFlight=(dt:number)=>{
 const pitchInput=stickPointer!==null||stick?stickY:input.value('pitch');
 const rollInput=stickPointer!==null||stick?stickX:input.value('roll');
 controls.weight=lastDefinition.birdman?clamp(trimPitch+pitchInput,-1,1):0;
 controls.lateral=lastDefinition.birdman?clamp(trimRoll+rollInput,-1,1):0;
 controls.rudder=yawPointer!==null||yawInput!==0?yawInput:input.value('yaw');
 controls.elevator=lastDefinition.birdman?0:clamp(pitchInput,-1,1);
 controls.aileron=lastDefinition.birdman?0:clamp(rollInput,-1,1);
 controls.throttle=throttle;controls.trimPitch=trimPitch;controls.trimRoll=trimRoll;
 controls.autoTrim=autoTrim&&!lastDefinition.birdman;controls.smartMixing=smartMixing;controls.adaptiveControls=adaptiveControls;
 scene.captureFlightState();
 const wasLaunching=simulation!.launching;
 simulation!.step(controls,dt);if(isReplay&&activeReplay)cacheReplay(activeReplay,simulation!);else if(!isLaboratory(lastChallenge))cacheFlight(simulation!);flightElapsed=simulation!.elapsedTime;if(isReplay)replayPosition=flightElapsed;sampleFlight();
 if(autoTrim&&!isReplay)trimPitch=simulation!.telemetry.trimPitch;
 syncAudio();
 if(lastChallenge!=='low-altitude'&&lastChallenge!=='wind-tunnel'&&wasLaunching&&!simulation!.launching)audio.release();
 if(simulation!.ended){finish();return false;}
 if(simulation!.replayFinished){paused=true;clearControls();notify('回放结束','success');return false;}
 return true;
};
const tick=(now:number)=>{
  const elapsed=Math.min(Math.max((now-previous)/1000,0),0.1);previous=now;
  if(!document.hidden){
    input.poll();
    inputActions(elapsed);
    if(screen==='flight'&&!isReplay&&!inputSettingsOpen){
     const absolute=input.value('throttle');
     if(absolute>=0)throttle=absolute;
     throttle=clamp(throttle+(input.value('throttleUp')-input.value('throttleDown'))*elapsed*0.35,0,1);
    }
    const running=screen==='flight'&&simulation&&flightReady&&!paused&&!seeking&&!inputSettingsOpen;
    let alpha=1;
    if(running){
      alpha=clock.advance(elapsed,stepFlight);
    }else{
      clock.reset();scene.captureFlightState();
    }
    if(!seeking)scene.render(elapsed,alpha);
     syncAudio();
    if(screen==='flight')refreshHud();
    if(flightCamera==='驾驶员'||flightCamera==='锁定')pilotHud=scene.pilotHud(hud.pitch,hud.roll);
    if(now-lastInstruments>150){refreshTrajectory();perf={...scene.metrics,physicsMs:simulation?.telemetry.physicsMs??0};lastInstruments=now;}
  }
  request=requestAnimationFrame(tick);
};
request=requestAnimationFrame(tick);
const mouse=(e:PointerEvent)=>{if(!stick||stickPointer!==null)return;const radius=innerHeight*0.3;let x=(e.clientX-innerWidth/2)/radius,y=(innerHeight/2-e.clientY)/radius;const length=Math.hypot(x,y),scale=length>0.05?Math.min(1,(length-0.05)/0.95)/length:0;stickX=x*scale;stickY=y*scale;};
window.addEventListener('pointermove',mouse);
 const down=(e:KeyboardEvent)=>keyboard(e,true),up=(e:KeyboardEvent)=>keyboard(e,false);
 const blur=()=>{clearControls();input.suspended=true;},focus=()=>{input.suspended=inputSettingsOpen||document.hidden;};
 window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visibility);
 try{saved=listAircraft();best=readBest(challenge);}catch(e){saved=presets.map(preset=>loadAircraft(`system:${preset.name}`));notify((e as Error).message);}
 // Read-only diagnostics for automated measurement; interaction tests still use visible controls.
 Object.assign(window,{glider:{get aircraft(){return clone(aircraft)},get state(){return screen},get flightReady(){return flightReady},get time(){return simulation?.time??0},get recordingLength(){return simulation?.recordingLength??0},get scene(){return scene.getDiagnostics()},get trajectory(){return samples.map(p=>({...p}))},get metrics(){return {...scene.metrics,physicsMs:simulation?.telemetry.physicsMs??0}},get telemetry(){return simulation?.telemetry},get flightControls(){return {trimPitch:displayedPitch,trimRoll:displayedRoll,autoTrim:isReplay?hud.autoTrim:autoTrim,smartMixing:isReplay?hud.smartMixing??false:smartMixing,adaptiveControls:isReplay?hud.adaptiveControls:adaptiveControls,controlLimit:hud.controlLimit??1,inputs:simulation?.telemetry.controlInputs}},get result(){return result}}});
 Object.defineProperty((window as any).glider,'laboratory',{get:()=>simulation&&isLaboratory(simulation.challenge)?{mode:simulation.challenge,settings:{...simulation.testSpace},wind:{...simulation.windTunnel},windEnabled:simulation.windTunnelEnabled,recordingBytes:simulation.recording.byteLength,curveSamples:samples.length,fractures:simulation.structure.fractureCount,fragments:simulation.fragments.length}:null});
 return()=>{window.removeEventListener('pointermove',mouse);clearTimeout(messageTimeout);cancelAnimationFrame(request);audio.dispose();scene.dispose();document.removeEventListener('pointerdown',unlock,true);document.removeEventListener('keydown',unlock,true);document.removeEventListener('click',click,true);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visibility);};});

</script>
<svelte:head><title>{t('翼构方程')} · {t('设计与驾驶')}</title></svelte:head>
{#snippet energyPanel()}
 <section class="energy-panel" aria-label={t("离台能量守恒")}>
 <div class="instrument-heading"><h2>{t("能量分配")}</h2><span>{!flightReady?t("待开始"):hud.launching?t("助跑供能中"):lastDefinition.engine.count?t("引擎做功计入总量"):t("飞行能量账本")}</span></div>
 {#if hud.launching}
 <p class="launch-note">{!flightReady?t("点击开始后助跑"):t("坡道助跑中")}{t("，沿10 m、3.5°坡道加速至")} {LAUNCH.speed.toFixed(1)} {t("m/s。滚转扰动在助跑中平滑加入；离台时建立能量基准，助跑外力供能不计入耗散。")}</p>
 {:else}
 <div class="energy-track" aria-hidden="true">{#each energyParts as part}<span class={part.key} style:width={`${energyBudget>0?part.value/energyBudget*100:0}%`}></span>{/each}</div>
 <dl class="energy-values">{#each energyParts as part}<div class={part.key}><dt>{t(part.name)}</dt><dd>{part.value.toFixed(0)} J <small>{(energyBudget>0?part.value/energyBudget*100:0).toFixed(1)}%</small></dd></div>{/each}</dl>
 <p class="energy-total">{t("合计")} {energyTotal.toFixed(0)} J <span>{t("能量预算")} {energyBudget.toFixed(0)} J</span></p>
 <p class="energy-caption">{t("动能含平动与转动；耗散含空气、水体阻力与阻尼。引擎做功")} {(hud.propulsionWork??0).toFixed(0)} {t("J · 驾驶员做功")} {(hud.controlWork??0).toFixed(0)} {t("J · 浮力做功")} {(hud.waterWork??0).toFixed(0)} {t("J · 燃油带走")} {(hud.fuelEnergyRemoved??0).toFixed(0)} {t("J。")}</p>
 {/if}
 </section>
{/snippet}
{#snippet altitudeCurve()}
 <section class="trajectory-panel" aria-label={t("距离高度曲线")}>
 <div class="instrument-heading"><h2>{screen==='result'?t("飞行数据曲线"):t("距离—高度")}</h2><span>{trajectory.length?t("真实采样 {p0} 点",{p0:trajectory.length}):lastChallenge==='birdman'?t("离台后开始采样"):t("开始试飞后采样")}</span></div>
 {#if screen==='result'}<div class="chart-legend"><span class="height-key">{t("高度 · 左轴 m")}</span>{#if lastChallenge==='birdman'}<span class="energy-key">{t("剩余机械能 · 右轴 %")}</span><span class="cost-key">{t("实时能耗 · 外右轴 J/m")}</span>{/if}{#if lastChallenge!=='birdman'}<span class="g-key">{t("G值")} · G</span>{/if}<span class="speed-key">{t("空速")} · m/s</span>{#if lastChallenge==='low-altitude'}<span class="scoring-key">{t("计分高度上限 · 接触表面 +")} {LOW_ALTITUDE.scoringHeight.toFixed(1)} m</span>{/if}</div>{/if}
 <div class="chart-viewport">
 <svg viewBox={screen==='result'?(lastChallenge==='birdman'?'0 0 600 196':'0 0 570 196'):'0 0 348 124'} role="img" aria-label={screen==='result'?t("飞行数据曲线")+' · '+t("横轴为试飞时间，各曲线使用独立纵轴。"):t("飞行轨迹，水平距离0至{p0}米，高度0至{p1}米{p2}",{p0:chartMaxDistance.toFixed(1),p1:chartMaxHeight.toFixed(1),p2:''})}>
 <line class="chart-grid" x1="38" y1="22" x2={38+chartWidth} y2="22"/><line class="chart-grid" x1="38" y1={22+chartHeight/2} x2={38+chartWidth} y2={22+chartHeight/2}/><path class="chart-axis" d={`M38 16V${chartBottom}H${40+chartWidth}`}/>
 <text x="2" y="25">{chartMaxHeight.toFixed(1)}</text><text x="23" y={chartBottom+3}>0</text><text x="38" y={chartBottom+18}>0</text><text x={38+chartWidth} y={chartBottom+18} text-anchor="end">{screen==='result'?chartMaxTime.toFixed(1)+' s':chartMaxDistance.toFixed(1)+' m'}</text><text x="3" y="12">{t("高度 m")}</text>
 {#if trajectory.length}{@const last=trajectory[trajectory.length-1]}<polyline class="chart-line" points={chartPoints}/><circle class="chart-current" cx={38+(screen==='result'?last.time/chartMaxTime:last.distance/chartMaxDistance)*chartWidth} cy={chartBottom-last.height/chartMaxHeight*chartHeight} r="3"/>{/if}
 {#if screen==='result'&&lastChallenge==='birdman'}
 <path class="chart-axis" d={`M458 22V${chartBottom}`}/><text x="464" y="25">{(chartMaxEnergy*100).toFixed(0)}%</text><text x="464" y={25+chartHeight/2}>{(chartMaxEnergy*50).toFixed(0)}%</text><text x="464" y={chartBottom+3}>0%</text>
 <polyline class="chart-energy-line" aria-label={t("剩余机械能占比曲线")} points={energyCurvePoints}/>
 <path class="chart-axis" d={`M508 22V${chartBottom}`}/><text x="514" y="12">J/m</text><text x="514" y="25">{chartMaxCost.toFixed(1)}</text><text x="514" y={25+chartHeight/2}>{(chartMaxCost/2).toFixed(1)}</text><text x="514" y={chartBottom+3}>0</text>
 <path class="chart-cost-line" aria-label={t("实时能耗曲线")} d={costCurvePath}/>
 {#each costOutliers as p}<path class="chart-cost-line" d={`M${36+p.time/chartMaxTime*chartWidth} 26 l2 -4 l2 4`}><title>{p.energyPerDistance!.toFixed(1)} J/m</title></path>{/each}
 {/if}
 {#if screen==='result'&&lastChallenge==='low-altitude'}
 <polyline class="chart-scoring-line" aria-label={t("计分高度参考曲线")} points={scoringCurvePoints}/>
 {/if}
 {#if screen==='result'}{@const speedAxis=lastChallenge==='birdman'?558:458}<path class="chart-axis" d={`M${speedAxis} 22V${chartBottom}`}/><text x={speedAxis+6} y="12">m/s</text><text x={speedAxis+6} y="25">{chartMaxSpeed.toFixed(1)}</text><text x={speedAxis+6} y={chartBottom+3}>0</text><polyline class="chart-speed-line" aria-label={t("空速")} points={speedCurvePoints}/>{/if}
 {#if screen==='result'&&lastChallenge!=='birdman'}<path class="chart-axis" d={`M508 22V${chartBottom}`}/><text x="514" y="12">G</text><text x="514" y="25">{chartMaxG.toFixed(1)}</text><text x="514" y={chartBottom+3}>0</text><polyline class="chart-g-line" aria-label={t("G值曲线")} points={gCurvePoints}/>{/if}</svg>
 </div>
 <p class="chart-caption">{#if screen==='result'}{t("横轴为试飞时间，各曲线使用独立纵轴。")} {/if}{lastChallenge==='birdman'?t("离台后"):t("开始试飞后")}{t("每 0.1 s 采样，末点保留实际终止高度。")}{#if screen==='result'&&lastChallenge==='birdman'}{t("能耗纵轴按正常飞行缩放；擦水与离群峰值以顶部三角标记，悬停查看原值。")} {t("机械能占比 =（动能 + 势能）/ 离台初始能量，动能含转动。实时能耗 = 耗散功率 / 水平速度；无定义时断线，不记作零。")}{:else if lastChallenge!=='birdman'}{t("距离从出发门后累计，门前采样距离为零。")}{#if lastChallenge==='low-altitude'}{t("虚线沿每个真实采样位置的地形或河面上方")} {LOW_ALTITUDE.scoringHeight.toFixed(1)} {t("m；实际高度高于虚线时超出计分高度。")}{/if}{/if}</p>
 </section>
{/snippet}

{#snippet trimControls()}
 <div class="trim-controls" aria-label={t("配平控制")}>
 <label class="pitch-trim" class:auto-trim={pitchTrimLocked}><span>{t("升降舵配平")} <kbd>J/K</kbd> <output>{((displayedPitch+1)*50).toFixed(0)}%</output></span><span class="trim-track"><input aria-label={t("升降舵配平")} disabled={isReplay||pitchTrimLocked} type="range" min="0" max="100" step="1" value={(displayedPitch+1)*50} oninput={e=>{setPitchTrim(trimFromPointer(e.currentTarget.valueAsNumber));e.currentTarget.value=String((trimPitch+1)*50);}}/><i aria-hidden="true"></i></span></label>
 <label class="roll-trim"><span>{t("副翼配平")} <kbd>H/L</kbd> <output>{((displayedRoll+1)*50).toFixed(0)}%</output></span><span class="trim-track"><input aria-label={t("副翼配平")} disabled={isReplay} type="range" min="0" max="100" step="1" value={(displayedRoll+1)*50} oninput={e=>{trimRoll=trimFromPointer(e.currentTarget.valueAsNumber);e.currentTarget.value=String((trimRoll+1)*50);}}/><i aria-hidden="true"></i></span></label>
 <small>{t("50% 中立 · 鼠标吸附中点 · 快捷键每格 1% · 长按连续调节")}</small>
 </div>
{/snippet}
{#snippet structureData()}
<details class="advanced-hud" open={lastChallenge==='wind-tunnel'}><summary>{t("姿态与结构 ·")} {(hud.fractureCount??0)>0?t("已断裂 {p0} 次",{p0:hud.fractureCount}):t("结构完整")} {t("· 极限")} {((hud.maxStressRatio??0)*100).toFixed(0)}%</summary><div class="structure-status" aria-label={t("结构载荷与断裂状态")}><p>{t("结构极限利用率")} <output aria-label={t("结构极限利用率")}>{((hud.maxStressRatio??0)*100).toFixed(1)}%</output> {t("· 弹性限利用率")} {((hud.maxYieldRatio??0)*100).toFixed(1)}%</p>{#each hud.wings??[] as wing}<p class="wing-structure" data-wing={wing.key}><strong>{t(wing.name)}</strong> · {t('结构极限')} <output aria-label={t('{name}结构极限利用率',{name:t(wing.name)})}>{(wing.stress*100).toFixed(1)}%</output> · {t('弹性限')} {(wing.yieldRatio*100).toFixed(1)}% · {t('连接 {attached} 段 / 脱离 {detached} 段',{attached:wing.attached,detached:wing.detached})}</p>{/each}<p>{t("最大形变")} <output aria-label={t("最大结构形变")}>{((hud.maxDeflection??0)*1000).toFixed(1)}</output> {t("mm · 独立断片")} <output aria-label={t("独立断片数量")}>{hud.fragmentCount??0}</output> {t("片")}</p>{#if (hud.fractureCount??0)>0}<p role="status"><strong>{t("承力梁已断裂")} {hud.fractureCount} {t("次。")}</strong>{t(lastChallenge==='wind-tunnel'?"主体由夹具固定，断片随气流运动；测试继续。":"主体继续飞行；断片独立运动，断片落地不结束主体。")}</p>{:else if (hud.maxStressRatio??0)>=0.8}<p role="status"><strong>{t("接近结构极限，减小载荷。")}</strong></p>{/if}{#if (hud.maxYieldRatio??0)>1}<p>{t("超过等效弹性限。当前仍为线弹性近似，不模拟塑性或真实颤振。")}</p>{/if}</div></details>
{/snippet}
{#snippet aeroWindow()}
{#if aero&&hud.aerodynamics}<aside class="aero-live" aria-label={t("实时气动数据")}><h2>{t("实时气动数据")}</h2><dl>
{#each [["下沉率",hud.sink,"m/s"],["航迹滑翔比",hud.glide,""] ,["升力",hud.aerodynamics.lift.y,"N"],["推力",hud.thrust,"N"],["阻力",hud.aerodynamics.drag.length(),"N"],["侧向力",hud.aerodynamics.force.z,"N"],["攻角",hud.alpha,"°"],["侧滑角",hud.aerodynamics.beta*180/Math.PI,"°"],["俯仰角",hud.pitch,"°"],["滚转角",hud.roll,"°"],["升阻比",hud.liftDragRatio,""],["速度×升阻比",hud.speed*hud.liftDragRatio,"m/s"]] as item}<div><dt>{t(String(item[0]))}</dt><dd>{Number(item[1]).toFixed(2)} {item[2]}</dd></div>{/each}
</dl></aside>{/if}

{/snippet}
{#snippet hangar()}
 <section class="library" aria-label={t("本地机库")}>
 <div class="library-title"><h2>{t("本地机库 ·")} {saved.length} {t("架")}</h2><button onclick={()=>showLibrary=false}>{t("返回工坊")}</button></div>
 <p>{t("系统飞机可复制和导出，不可修改或删除。个人设计保存在当前浏览器，同名保存需确认覆盖。")}</p>
 <div class="library-actions"><label class="button">{t("导入 JSON")}<input aria-label={t("导入飞机文件")} type="file" accept=".json,application/json" onchange={fileImport}/></label></div>
 {#each saved as s}
 {@const compatible=isAircraftCompatible(s.definition,challenge)}
 <article class="saved-plane" class:incompatible={!compatible} data-aircraft-id={s.id}>
 {#if s.builtIn}<h3>{t(s.name)}</h3>{:else}<input aria-label={t("重命名{p0}",{p0:s.name})} value={s.name} maxlength="60" onchange={e=>renameSaved(s.id,e.currentTarget.value)}/>{/if}
 <small>{s.builtIn?t("系统飞机"):new Date(s.updatedAt).toLocaleString($language)} · {t(s.definition.birdman?"鸟人间飞机":"普通飞机")}{selectedId===s.id?t(" · 当前飞机"):''}</small>
 {#if s.builtIn&&s.definition.engine.count>0}<p>{t("巡航油门 {throttle}% · 巡航速度 {speed} m/s",{throttle:s.definition.engine.count===2?68:72,speed:s.definition.engine.count===2?29:24})}</p>{/if}
 {#if !compatible}<p class="compatibility-note">{t(challenge==='birdman'?"鸟人间比赛只允许无动力鸟人间设计":"当前挑战不可使用鸟人间飞机，请选择普通飞机。")}</p>{/if}
 <div><button class="load-plane" disabled={!compatible} onclick={()=>load(s.id)}>{t("加载")}</button><button onclick={()=>{try{duplicateAircraft(s.id);saved=listAircraft();}catch(e){notify((e as Error).message);}}}>{t("复制")}</button><button onclick={()=>fileExport(s.id)}>{t("导出")}</button>
 {#if !s.builtIn}<button class="delete-plane" onclick={()=>{if(confirm(t('删除“{name}”？此操作不可撤销。',{name:s.name}))){try{deleteAircraft(s.id);saved=listAircraft();if(selectedId===s.id)selectedId='';}catch(e){notify((e as Error).message);}}}}>{t("删除")}</button>{/if}</div>
 </article>
 {/each}
 </section>
{/snippet}
<div class="app" class:flying={screen==='flight'} class:designing={screen==='design'} class:powered-flight={screen==='flight'&&lastDefinition.engine.count>0&&lastChallenge!=='wind-tunnel'} class:low-flying={screen==='flight'&&lastChallenge==='low-altitude'} class:awaiting-flight={screen==='flight'&&!flightReady} class:wind-tunnel={screen==='flight'&&lastChallenge==='wind-tunnel'} class:laboratory-flight={screen==='flight'&&isLaboratory(lastChallenge)}>
 <div class="scene" bind:this={host} aria-label={t("三维滑空机与湖面场景")}></div>
 <header class="topbar">
  <div class="brand-group">
   <button class="brand" onclick={()=>{if(screen==='flight')togglePause();else{screen='menu';showLibrary=false;}}} aria-label={t("返回主菜单")}><svg viewBox="0 0 36 28" width="34" height="28" fill="none" aria-hidden="true"><path d="M2 10 33 3 23 13 19 25 14 14 2 10Z" stroke="currentColor" stroke-width="1.7"/><path d="m14 14 19-11" stroke="currentColor"/></svg><span>{t('翼构方程')}<small>{t('设计与驾驶')}</small></span></button>
   <a class="github-link" href="https://github.com/Nigh/glider-3d" target="_blank" rel="noopener noreferrer" aria-label={t("GitHub 项目源码（新标签页）")} title={t("GitHub 项目源码")}><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.77c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg></a>
  </div>
  {#if screen!=='menu'}<nav aria-label={t("游戏流程")}><button class:active={screen==='design'} onclick={design}>{t("设计")}</button><button class:active={screen==='flight'||screen==='result'} onclick={()=>start()}>{t("试飞")}</button></nav>{/if}
  <div class="top-actions">
   <label class="language-label"><span>{t('语言')}</span><select aria-label={t('语言')} value={$language} onchange={e=>setLanguage(e.currentTarget.value as Language)}><option value="zh">中文</option><option value="en">English</option><option value="ja">日本語</option></select></label>
   <AudioSettings {audio} error={audioError}/>
   <InputSettings {input} error={inputError} onOpenChange={open=>{inputSettingsOpen=open;clearControls();}}/>
   <label class="quality-label">{t("画质")} <select aria-label={t("画质")} bind:value={quality} onchange={()=>scene?.setQuality(quality)}><option value="Auto">{t(qualityNames.Auto)}</option><option value="High">{t(qualityNames.High)}</option><option value="Medium">{t(qualityNames.Medium)}</option><option value="Low">{t(qualityNames.Low)}</option></select></label>
   <button class="text-button toggle-switch" role="switch" aria-checked={aero} onclick={()=>{aero=!aero;scene?.setDebug(aero);}}>{t("气动图层")}</button>
   <button class="text-button toggle-switch" role="switch" aria-checked={debug} onclick={()=>{debug=!debug;}}>{t("性能")}</button>
  </div>
 </header>
 {#if screen==='menu'}
 <main class="welcome">
 <h1><span>{t("不同飞机，")}</span><span>{t("不同挑战。")}</span></h1>
 <p><span>{t("选择挑战，进入对应飞机工坊。")}</span> <span>{t("湖面比距离，山谷竞速，低空贴地闯关。")}</span></p>
 <div class="mode-buttons">
 <button class="primary large" onclick={()=>enterChallenge('birdman')}><span>{t("鸟人间挑战")}</span><small>{t("无动力 · 湖面距离")}</small></button>
 <button class="secondary large" onclick={()=>enterChallenge('downhill')}><span>{t("高山速降")}</span><small>{t("山顶弹射 · 山谷竞速")}</small></button>
 <button class="secondary large" onclick={()=>enterChallenge('low-altitude')}><span>{t("低空飞行")}</span><small>{t("跑道起飞 · 河谷计分")}</small></button>
 </div>
 <div class="lab-mode-buttons">
 <button class="secondary" onclick={()=>enterChallenge('test-space')}><span>{t("测试空间")}</span><small>{t("自由飞行 · 可调平台")}</small></button>
 <button class="secondary" onclick={()=>enterChallenge('wind-tunnel')}><span>{t("风洞")}</span><small>{t("来流与姿态 · 气动和结构")}</small></button>
 </div>
 <label class="button secondary large replay-import">{t("导入回放")}<input aria-label={t("导入回放")} disabled={replayBusy} type="file" accept=".json,application/json" onchange={replayImport}/></label>
 <div class="welcome-note">{t("W / S 俯仰 · A / D 滚转 · Q / E 偏航 · 1 / 2 油门")}</div>
 </main>
 <aside class="menu-caption"><span>{t(defaultAircraft.name)}</span><p>{t("{span} m 翼展",{span:planform(defaultAircraft.mainWing).span.toFixed(2)})} <b>·</b> {t("参数化轻型滑空机")}</p></aside>
 {:else if screen==='design'}
 <aside class="editor">
 {#if showLibrary}
 {@render hangar()}
 {:else}
 <div class="editor-heading"><div><h1>{t("飞机工坊")}</h1><p>{t(challengeDefinitions[challenge].name)} {t(isLaboratory(challenge)?"· 调整设计，开始测试。":"· 调整设计，前往挑战。")}</p></div><button class="hangar-button" onclick={library}>{t("机库")}</button></div><div class="name-row"><input aria-label={t("飞机名称")} value={aircraft.name} maxlength="60" onchange={e=>{change(d=>d.name=e.currentTarget.value);commit();}}/><button onclick={save}>{t("保存")}</button></div><div class="history"><button disabled={!historyVersion||!history.canUndo} onclick={undo}>{t("撤销")}</button><button disabled={!historyVersion||!history.canRedo} onclick={redo}>{t("重做")}</button><button onclick={()=>{replace(challengeAircraft());selectedId='';}}>{t("重置设计")}</button></div>
 {#if isLaboratory(challenge)}<label class="aircraft-type">{t("飞机类型")}<select aria-label={t("飞机类型")} value={aircraft.birdman?'birdman':'normal'} onchange={e=>setAircraftType(e.currentTarget.value==='birdman')}><option value="birdman">{t("鸟人间飞机")}</option><option value="normal">{t("普通飞机")}</option></select></label>{/if}
 <div class="replay-toolbar"><label class="button replay-import">{t("导入回放")}<input aria-label={t("导入回放")} disabled={replayBusy} type="file" accept=".json,application/json" onchange={replayImport}/></label></div><div class="tabs" role="tablist" aria-label={t("部件编辑")}>{#each (aircraft.birdman?['机身','主翼','副翼','垂直尾翼']:['机身','主翼','副翼','垂直尾翼','动力']) as part}<button role="tab" aria-selected={tab===part} class:active={tab===part} onclick={()=>tab=part as Tab}>{t(part)}</button>{/each}</div>
 <div class="editor-content"><h2>{t('{part}设计',{part:t(tab)})}</h2><p class="help">{t(hints[tab])}</p>
 <p class="help">{aircraft.birdman?t("鸟人间专用：仅垂尾具有控制面；俯仰与滚转靠驾驶员移动重心。"):t("主翼的滚转舵面与副翼的升降舵控制姿态；驾驶员由流线座舱包覆。")}</p>
 <p class="help">{t("比赛仅允许对应类型的飞机；测试空间和风洞可切换类型。重置设计载入当前类型的默认飞机。")}</p>
 {#if tab==='机身'}
 <div class="assembly-positions" aria-label={t("机身端点精确值")}>
 <label><span>{t("机头端点")}</span><input aria-label={t("机头端点精确值")} type="number" min={noseRange.min} max={noseRange.max} step="0.01" value={Number(ends.nose.toFixed(2))} onchange={e=>setEnd('nose',e.currentTarget)}/><small>m</small></label>
 <label><span>{t("机尾端点")}</span><input aria-label={t("机尾端点精确值")} type="number" min={tailEndRange.min} max={tailEndRange.max} step="0.01" value={Number(ends.tail.toFixed(2))} onchange={e=>setEnd('tail',e.currentTarget)}/><small>m</small></label>
 </div><p class="fixed-parameter">{t("机身长度")} <output aria-label={t("机身长度")}>{aircraft.fuselage.length.toFixed(2)} m</output> {t("· 驾驶员")} <output aria-label={t("固定驾驶员质量")}>{PILOT_MASS} kg</output></p><p class="help">{t("端点以机身局部 X 为准。移动一端，另一端不动；在机身编辑中也可直接拖动。驾驶舱及尾翼必须留在机身支撑范围内。")}</p>
 <div class="parameter"><div class="parameter-head"><label><span>{t("驾驶舱位置")}</span><input aria-label={t("驾驶舱位置精确值")} type="number" min={cockpitMin} max={cockpitMax} step="0.01" value={Number(aircraft.cockpit.position.toFixed(2))} onchange={e=>setPosition('cockpit',e.currentTarget)}/><small>m</small></label></div><input aria-label={t("驾驶舱位置")} type="range" min={cockpitMin} max={cockpitMax} step="0.01" value={aircraft.cockpit.position} oninput={e=>change(d=>d.cockpit.position=e.currentTarget.valueAsNumber)} onchange={commit}/><p>{t("正值向机头移动。固定")} {PILOT_MASS} {t("kg 驾驶员随驾驶舱改变重心；移动范围保持机身支撑。")}</p></div>
 {#if !aircraft.birdman}<Parameter label={t("驾驶舱后段长度")} value={aircraft.cockpit.rearLength??1.45} min={rearRange.min} max={rearRange.max} unit="m" onchange={n=>change(d=>d.cockpit.rearLength=n)} oncommit={commit} hint={t("前段与玻璃座舱罩固定；后段长度改变驾驶舱质量和最大油箱容量。")}/>{/if}
 {#if aircraft.birdman}<Parameter label={t("重心前后行程")} value={aircraft.controls.travel} min={0.1} max={0.8} step={0.05} unit="m" onchange={n=>change(d=>d.controls.travel=n)} oncommit={commit}/><Parameter label={t("重心左右行程")} value={aircraft.controls.lateralTravel} min={0.01} max={0.2} step={0.01} unit="m" onchange={n=>change(d=>d.controls.lateralTravel=n)} oncommit={commit}/>{/if}
 {:else if tab==='动力'}
 <label class="fixed-parameter">{t("喷气引擎")}<select aria-label={t("引擎数量")} value={aircraft.engine.count} onchange={e=>{change(d=>{const previous=d.engine.count;d.engine.count=Number(e.currentTarget.value) as 0|1|2;if(d.engine.count){if(d.engine.count===2&&previous!==2)d.engine.y=0;if(!d.fuelTank.capacity)d.fuelTank.capacity=12;}else d.fuelTank.capacity=0;});commit();}}><option value={0}>{t("无引擎")}</option><option value={1}>{t("单发 · Jet 01")}</option><option value={2}>{t("双发 · Jet 01")}</option></select></label>
 {#if aircraft.engine.count}
 <Parameter label={t("引擎纵向位置")} value={aircraft.engine.x} min={engineMountLimits(aircraft).min} max={engineMountLimits(aircraft).max} unit="m" onchange={n=>change(d=>d.engine.x=n)} oncommit={commit}/>
 <Parameter label={t("引擎垂直偏移")} value={aircraft.engine.y} min={-0.5} max={1} step={0.01} unit="m" onchange={n=>change(d=>d.engine.y=n)} oncommit={commit} hint={t("负值在下，正值在上。可用范围：{p0}。自动跳过机身重叠区；单发居中，双发固定在机身两侧。",{p0:engineRanges.map(r=>t('{p0} 至 {p1} m',{p0:r.min.toFixed(2),p1:r.max.toFixed(2)})).join(' / ')})}/>
 <Parameter label={t("油箱容量")} value={aircraft.fuelTank.capacity} min={0} max={fuelCapacityLimit(aircraft)} step={0.5} unit="L" onchange={n=>change(d=>d.fuelTank.capacity=n)} oncommit={commit} hint={t("油箱固定在机身内部，起飞装满；燃油消耗改变质量与重心，耗尽后引擎无推力。")}/>
 <Parameter label={t("油箱纵向位置")} value={aircraft.fuelTank.x} min={tankLimits.min} max={tankLimits.max} step={0.01} unit="m" onchange={n=>change(d=>d.fuelTank.x=n)} oncommit={commit} hint={t("位置范围随容量和机身空间调整，油箱整体始终位于机身内部。")}/>
 {:else}<p class="help">{t("未安装引擎，油箱已自动取消。")}</p>{/if}
 {:else}
 {@const position=assemblyPositions.find(position=>position.key===wingKey)!}
 {#if tab==='副翼'}<button class="toggle-switch" role="switch" aria-checked={aircraft.assembly.tailOnFin===true} onclick={()=>{change(d=>d.assembly.tailOnFin=!d.assembly.tailOnFin);commit();}}>{t("副翼安装至垂尾顶端")}</button><p class="help">{aircraft.assembly.tailOnFin?t("已安装至垂尾顶端，翼根与垂尾梢弦联动；关闭开关可移回机身。"):t("可开启开关直接安装，或将副翼安装点拖近垂尾顶端吸附。")}</p>{/if}
 {#key wingKey}<WingEditor value={aircraft[wingKey]} vertical={tab==='垂直尾翼'} onchange={(w:Wing)=>change(d=>d[wingKey]=w)} onpointchange={(i,x,y)=>change(d=>editWingPoint(d,wingKey,i,x,y))} oncommit={commit}/>{/key}
 <div class="assembly-positions">
 <label><span>{t(position.label)}</span><input aria-label={t("{p0}精确值",{p0:t(position.label)})} type="number" min={position.min} max={position.max} step="0.01" value={Number(position.value.toFixed(2))} disabled={wingKey==='horizontalTail'&&aircraft.assembly.tailOnFin===true} onchange={e=>setPosition(position.key,e.currentTarget)}/><small>m</small></label>
 </div>
 {#if tab==='主翼'}
 <Parameter label={t("主翼安装高度")} value={aircraft.assembly.mainWingHeight} min={-0.5} max={1} step={0.01} unit="m" onchange={n=>change(d=>d.assembly.mainWingHeight=n)} oncommit={commit} hint={t("0 m 直接安装机身；正值在上、负值在下。离开机身自动生成根弦宽支撑，面积越大越重；拖动时 Ctrl 可绕过吸附。")}/>
 <Parameter label={t("主翼安装角")} value={aircraft.assembly.mainIncidence} min={-10} max={18} unit="°" onchange={n=>change(d=>d.assembly.mainIncidence=n)} oncommit={commit} hint={t("提高安装角会增加有效攻角；过大可能失速。")}/>
 {/if}
 {#if tab==='副翼'&&!aircraft.assembly.tailOnFin}
 <Parameter label={t("副翼安装角")} value={aircraft.assembly.tailIncidence} min={-12} max={12} unit="°" onchange={n=>change(d=>d.assembly.tailIncidence=n)} oncommit={commit} hint={t("调节尾翼安装角以配平，观察离台后攻角与俯仰变化。")}/>
 {/if}
 {#if tab==='主翼'}<Parameter label={t("主翼上反角")} value={aircraft.mainWing.dihedral} min={-25} max={25} unit="°" onchange={n=>change(d=>d.mainWing.dihedral=n)} oncommit={commit} hint={t("增加侧滑时的滚转恢复效应，不会强制飞机自动水平。")}/>{/if}
 {#if !aircraft.birdman||tab==='垂直尾翼'}<Parameter label={tab==='主翼'?t("副翼弦长比例"):tab==='副翼'?t("升降舵弦长比例"):t("方向舵弦长比例")} value={aircraft[wingKey].controlSurface} min={0.1} max={1} step={0.05} onchange={n=>change(d=>d[wingKey].controlSurface=n)} oncommit={commit} hint={tab==='垂直尾翼'?t("1 为全动垂尾。"):t("控制面占翼面弦长的比例。")}/>{/if}
 <fieldset class="control-axis-settings"><legend>{t("舵面响应轴")}</legend>{#each controlAxisOptions as axis}<button class="toggle-switch" role="switch" aria-label={t("{axis}响应",{axis:t(axis.label)})} aria-checked={wingControlAxes[axis.key]} onclick={()=>toggleControlAxis(axis.key)}>{t(axis.label)}</button>{/each}</fieldset>
 <p class="help">{t("普通混控按响应轴分配；智能混控使用所有可用舵面。实际力矩取决于安装几何。")}</p>
 {/if}
 </div><div class="editor-footer"><span>{t(challengeDefinitions[challenge].name)}</span><button class="primary" onclick={()=>start()}>{t(challenge==='test-space'?'前往测试空间':challenge==='wind-tunnel'?'前往风洞':"前往挑战")} <span>↗</span></button></div>
 {/if}
 </aside>
 <div class="viewport-tools" aria-label={t("设计相机")}>{#each ['自由','俯视','侧视','正视','后视'] as c}<button class:active={designCamera===c} aria-pressed={designCamera===c} onclick={()=>selectDesignCamera(c)}>{t(c)}</button>{/each}</div>
 <section class="design-instruments" aria-label={t("设计实时仪表")}>
 <section class="design-metrics" aria-label={t("飞机性能估算")}>
 <div><small>{t("主翼面积")}</small><strong>{main.area.toFixed(2)} <em>m²</em></strong></div>
 <div><small>{t("翼展 / 展弦比")}</small><strong>{main.span.toFixed(2)} <em>m / {main.aspect.toFixed(1)}</em></strong></div>
 <div><small>{t("翼载荷")}</small><strong>{stats.wingLoading.toFixed(2)} <em>kg/m²</em></strong></div>
 <div title={t("自由空气、无地效的设计估算；飞行时随离水高度变化")}><small>{t("自由空气最佳滑翔比")}</small><strong>{stats.glideRatio.toFixed(1)} <em>: 1</em></strong></div>
 <div title={t("全重、主翼面积、海平面、无地效")}><small>{t("估算失速速度")}</small><strong><output aria-label={t("估算失速速度")}>{stats.stallSpeed.toFixed(1)}</output> <em>m/s</em></strong></div>
 <div><small>{t("全备质量 · 驾驶员")} {PILOT_MASS} kg</small><strong><output aria-label={t("全备质量")}>{stats.mass.toFixed(1)}</output> <em>kg</em></strong><small>{t("支撑")} <output aria-label={t("主翼支撑面积")}>{support.area.toFixed(2)}</output> m² · <output aria-label={t("主翼支撑质量")}>{support.mass.toFixed(2)}</output> kg</small></div>
 <div title={t("海平面最大静推力 / 重量；满油至空油")}><small>{t("推重比")}</small><strong><output aria-label={t("推重比")}>{aircraft.engine.count>0?`${thrustToWeight.full.toFixed(2)}–${thrustToWeight.empty.toFixed(2)}`:'0'}</output></strong></div>
 </section>
 <section class="stability" aria-label={t("重心与升力中心配平参考")}>
 <div class="scene-hint">
 <span><i class="cg"></i> {t("重心 CG")} <output aria-label={t("重心X")}>{stats.cg.x.toFixed(2)}</output> / <output aria-label={t("重心Y")}>{stats.cg.y.toFixed(2)}</output> / <output aria-label={t("重心Z")}>{stats.cg.z.toFixed(2)}</output> m</span>
 <span><i class="lift"></i> {t("全机升力中心")} {#if stats.aerodynamics.liftCenter}{#each ['x','y','z'] as axis,index}{#if index} / {/if}<output aria-label={t(`全机升力中心${axis.toUpperCase()}`)}>{stats.aerodynamics.liftCenter[axis as 'x'|'y'|'z'].toFixed(2)}</output>{/each} m{:else}<output aria-label={t("全机升力中心X")}>{t("无合力")}</output>{/if}</span>
 <span><i class="drag"></i> {t("全机阻力中心")} {#if stats.aerodynamics.dragCenter}{#each ['x','y','z'] as axis,index}{#if index} / {/if}<output aria-label={t(`全机阻力中心${axis.toUpperCase()}`)}>{stats.aerodynamics.dragCenter[axis as 'x'|'y'|'z'].toFixed(2)}</output>{/each} m{:else}<output aria-label={t("全机阻力中心X")}>{t("无合力")}</output>{/if}</span>
 <span><i class="thrust"></i> {t("推力中心")} {#if thrustCenter}<output aria-label={t("推力中心X")}>{thrustCenter.x.toFixed(2)}</output> / <output aria-label={t("推力中心Y")}>{thrustCenter.y.toFixed(2)}</output> / <output aria-label={t("推力中心Z")}>{thrustCenter.z.toFixed(2)}</output> m{:else}<output aria-label={t("推力中心X")}>{t("无合力")}</output>{/if}</span>
 <span>{t("静稳定裕度")} <output aria-label={t("静稳定裕度")}>{(stats.staticMargin*100).toFixed(1)}% MAC</output></span>
 </div>
 </section>
 </section>
 {:else if screen==='flight'}
 {#if !flightReady&&lastChallenge!=='wind-tunnel'}<div class="launch-action"><button class="primary launch-start flight-start" onclick={beginFlight}>{t("开始试飞")}<svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 5 7 7-7 7"/></svg></button><p>{t("空格开始 / 暂停 / 继续")}</p></div>{/if}
 {#if (flightCamera==='驾驶员'||flightCamera==='锁定')&&pilotHud}
 <svg class="pilot-hud" viewBox={`0 0 ${pilotHud.width} ${pilotHud.height}`} aria-label="HUD" role="img">
 <title>{t("飞行数据")}</title>
 <defs><clipPath id="hud-attitude"><polygon points={pilotHud.clip}/></clipPath></defs>
 <g clip-path="url(#hud-attitude)">
 <path d={pilotHud.ladder}/><path d={pilotHud.dashedLadder} stroke-dasharray="6 4"/>
 {#each pilotHud.labels as label}
 {#if label.left}<text transform={label.left}>{label.angle}</text>{/if}
 {#if label.right}<text transform={label.right}>{label.angle}</text>{/if}
 {/each}</g>
 <path class="hud-marker" d={pilotHud.marker}/>
 <text transform={pilotHud.speedLabel}>{t("空速")} m/s</text><text class="hud-value" transform={pilotHud.speed}>{hud.speed.toFixed(1)}</text>
 <text transform={pilotHud.altitudeLabel}>{t("高度")} m</text><text class="hud-value" transform={pilotHud.altitude}>{hud.altitude.toFixed(0)}</text>
 <text transform={pilotHud.clearance}>{t("离地高度")} {(hud.groundClearance??0).toFixed(1)} m · {t("垂直速度")} {(-hud.sink).toFixed(1)} m/s</text>
 {#if hud.stall}<text transform={pilotHud.stall}>{t("攻角过大 · 失速")}</text>{/if}
 </svg>{/if}
 <div class="flight-sidebar">
 {#if isLaboratory(lastChallenge)}
  <LaboratoryControls mode={lastChallenge} ready={flightReady} windEnabled={hud.windEnabled??false} cameraView={windCamera} {testSettings} {windSettings} actualWind={hud.wind??defaultWindTunnel} onTestSettings={configureTest} onWindSettings={configureWind} onStop={stopTest} onToggleWind={toggleWind} onRestore={restoreWindAircraft} onCamera={selectWindCamera}/>
  {#if lastChallenge==='wind-tunnel'}<button onclick={design}>{t('返回设计')}</button>{/if}
 {/if}
 {#if lastChallenge!=='wind-tunnel'}<section class="flight-hud" class:compact-hud={lastChallenge!=='birdman'} aria-label={t("飞行数据")}>
 {#if lastChallenge==='birdman'}<div><small>{t("滑翔距离")}</small><strong>{hud.distance.toFixed(1)}<em>m</em></strong></div>{/if}
 <div><small>{t("空速")}</small><strong>{hud.speed.toFixed(1)}<em>m/s</em></strong></div>
 {#if lastChallenge==='downhill'}
 <div class="vertical-speed" data-direction={hud.sink<=-0.1?"up":hud.sink>=0.1?"down":"level"}><small>{t("垂直速度")}</small><strong><span class="vertical-arrow" aria-hidden="true">{hud.sink<=-0.1?"↑":hud.sink>=0.1?"↓":"━"}</span>{(-hud.sink).toFixed(1)}<em>m/s</em></strong></div>
 {:else if lastChallenge==='low-altitude'}
 <div><small>{t("离地高度")}</small><strong>{(hud.groundClearance??0).toFixed(1)}<em>m</em></strong></div><div><small>{t("剩余燃料")}</small><strong>{(hud.fuelRemaining??0).toFixed(2)}<em>L</em></strong></div>
 {:else if isLaboratory(lastChallenge)}
 <div><small>{t('高度')}</small><strong>{hud.altitude.toFixed(1)}<em>m</em></strong></div><div><small>{t('总飞行时间')}</small><strong>{hud.time.toFixed(1)}<em>s</em></strong></div><div><small>{t('G值')}</small><strong>{hud.gForce.toFixed(2)}<em>G</em></strong></div>
 {:else}
 <div><small>{t("高度")}</small><strong>{hud.altitude.toFixed(1)}<em>m</em></strong></div><div><small>{t("总计时")}</small><strong>{hud.time.toFixed(1)}<em>s</em></strong></div><div><small>{t("实时攻角")}</small><strong>{hud.alpha.toFixed(1)}<em>°</em></strong></div><div><small>{t("实时升阻比")}</small><strong>{Number.isFinite(hud.liftDragRatio)?hud.liftDragRatio.toFixed(1):'—'}<em>:1</em></strong></div>
 <div title={t("真实耗散功率除以世界水平速度；助跑或水平速度不超过0.05 m/s时无定义")}><small>{t("实时能耗")}</small><strong><output aria-label={t("实时能耗")}>{hud.energyPerDistance!=null&&Number.isFinite(hud.energyPerDistance)?hud.energyPerDistance.toFixed(1):'—'}</output><em>J/m</em></strong></div>
 {/if}
 </section>{/if}
 {#if isLaboratory(lastChallenge)}<div class="flight-status"><span>{t(challengeDefinitions[lastChallenge].name)} · {t(!flightReady?"待开始":lastChallenge==='wind-tunnel'?"测试运行中":hud.launching?(testSettings.catapult?"弹射助跑":"跑道滑跑"):"飞行中")}</span><span>{t("自由测试 · 不计成绩")}</span></div>{:else}<div class="flight-status"><span>{t(challengeDefinitions[lastChallenge].name)} · {!flightReady?t("待开始"):hud.launching?(lastChallenge==='low-altitude'?t("跑道滑跑"):t("弹射助跑")):t("飞行中")}</span><span>{lastChallenge==='birdman'?t("湖面最远距离"):!hud.timingStarted?(lastChallenge==='low-altitude'?t("通过出发门后开始计时与计分"):t("通过出发门后开始计时")):t("赛道进度 {p0}% · 依次穿过航线检查点",{p0:(100*(hud.challengeProgress??0)).toFixed(0)})}</span>{#if hud.stall}<b>{t("攻角过大 · 失速")}</b>{/if}</div>{/if}
 {#if lastChallenge==='low-altitude'}<section class="challenge-hud" class:over-height={(hud.groundClearance??0)>LOW_ALTITUDE.scoringHeight} aria-label={t("贴地挑战数据")}><span>{t("离地")} <strong>{(hud.groundClearance??0).toFixed(1)} m / {LOW_ALTITUDE.scoringHeight} m</strong></span><span>{t("得分")} <strong>{(hud.score??0).toFixed(0)}</strong></span><span>{t("连续超高")} <strong>{(hud.aboveHeightTime??0).toFixed(1)} s</strong></span>{#if (hud.groundClearance??0)>LOW_ALTITUDE.scoringHeight}<b role="status">{t("超出计分高度 · 降低高度")}</b>{/if}</section>{/if}
 {#if lastDefinition.engine.count&&lastChallenge!=='wind-tunnel'}<section class="engine-hud" aria-label={t("引擎数据")}><label>{t("油门")} <output>{((isReplay?hud.throttle??0:throttle)*100).toFixed(0)}%</output><span class="throttle-track" style={`--rpm:${clamp(hud.engineRpm??0,0,1)*100}%`}><input aria-label={t("油门")} title={t("实色表示实际转速，滑块表示设定转速。")} disabled={isReplay} type="range" min="0" max="1" step="0.01" value={isReplay?hud.throttle??0:throttle} oninput={e=>{throttle=e.currentTarget.valueAsNumber;input.clear();}}/></span></label><p>{t("转速")} {((hud.engineRpm??0)*100).toFixed(0)}{t("% · 推力")} {(hud.thrust??0).toFixed(0)} {t("N · 余油")} {(hud.fuelRemaining??0).toFixed(2)} L</p></section>{/if}
 {#if lastChallenge!=='wind-tunnel'}<div class="flight-tools"><span class="keyboard-hint">X · {t("虚拟操纵杆")} / R · {t("再试一次（仅暂停或结算时）")} / Esc · {t("设计")}</span>{#if flightReady}<button title={t("空格开始 / 暂停 / 继续")} onclick={togglePause}>{paused?t("继续飞行"):t("暂停")}</button>{/if}<select aria-label={t("飞行相机")} title={t("C 键切换视角 · 锁定视角可小幅拖动 · 回放支持全部视角")} bind:value={flightCamera} onchange={e=>selectCamera(e.currentTarget.value)}>{#each availableViews as c}<option value={c}>{t(c)}</option>{/each}</select><button onclick={design}>{t("返回设计")}</button></div>{/if}
 {#if paused}<div class="pause-banner">{t("飞行已暂停")} <button onclick={togglePause}>{t("继续")}</button></div>{/if}
 <div class="flight-right">{#if lastChallenge==='wind-tunnel'&&hud.windForces}<WindForces loads={hud.windForces}/>{/if}{@render aeroWindow()}{#if lastChallenge==='wind-tunnel'}{@render structureData()}{/if}</div>
 {#if lastChallenge==='birdman'}<div class="flight-instruments">{@render energyPanel()}{@render altitudeCurve()}</div>{/if}
 {#if lastChallenge!=='wind-tunnel'}{@render structureData()}{/if}
 </div>
 {#if lastChallenge==='wind-tunnel'}<section class="wind-speed-hud" aria-label={t('风洞风速')}><span>{t('当前风速')}</span><strong><output aria-label={t('当前风速')}>{(hud.wind?.speed??0).toFixed(1)}</output><small>m/s</small></strong></section>{/if}
 {#if isReplay}<section class="replay-inputs" aria-label={t("实时杆量")}>
 <InputReadout pitch={actualPitch*pitchDisplayScale} roll={actualRoll} yaw={hud.controlInputs?.rudder??0} throttle={hud.throttle??0}/>
 <button class="toggle-switch" role="switch" aria-label={t("智能混控（U）")} aria-checked={hud.smartMixing??false} disabled><span>{t("智能混控")}</span></button>
 </section>{/if}
 {#if lastChallenge!=='wind-tunnel'}<section class="stick-panel" aria-label={t("杆量与配平")}>
 <div class="stick-heading"><strong>{t("杆量与配平")}</strong>{#if isReplay}<span>{t("飞行重放")}</span>{:else}<span>{t("自定义映射见输入设置")}</span>{/if}</div>
 <div class="stick-main">
 <div class="stick-input">
 <button class="stick-pad" aria-label={t("操纵杆")} title={t("拖动控制俯仰与滚转")} disabled={flightInputDisabled} onpointerdown={beginStick} onpointermove={e=>{if(stickPointer===e.pointerId)moveStick(e);}} onpointerup={releaseStick} onpointercancel={releaseStick} onlostpointercapture={releaseStick}>
 <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="stick-rim" cx="60" cy="60" r="56"/><path class="stick-cross" d="M 60 8 V 112 M 8 60 H 112"/><circle class="stick-limit" cx="60" cy="60" r={50*(lastDefinition.birdman?1:hud.controlLimit??1)}/><path class="stick-trim-marker" d={`M ${60+displayedRoll*35-4} ${60-displayedPitch*pitchDisplayScale*35} h 8 M ${60+displayedRoll*35} ${60-displayedPitch*pitchDisplayScale*35-4} v 8`}/><circle class="stick-position" cx={60+actualRoll*35} cy={60-actualPitch*pitchDisplayScale*35} r="6" data-pitch={actualPitch*pitchDisplayScale} data-roll={actualRoll}/></svg>
 </button>
 <div class="yaw-controls"><button aria-label={t("左偏航")} disabled={flightInputDisabled} onpointerdown={e=>beginYaw(e,-1)} onpointerup={releaseYaw} onpointercancel={releaseYaw} onlostpointercapture={releaseYaw} onkeydown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();yawInput=-1;}}} onkeyup={()=>yawInput=0} onblur={()=>yawInput=0}>Q</button><span>{t("偏航")}</span><button aria-label={t("右偏航")} disabled={flightInputDisabled} onpointerdown={e=>beginYaw(e,1)} onpointerup={releaseYaw} onpointercancel={releaseYaw} onlostpointercapture={releaseYaw} onkeydown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();yawInput=1;}}} onkeyup={()=>yawInput=0} onblur={()=>yawInput=0}>E</button></div>
 </div>
 {@render trimControls()}
 </div>
 <div class="flight-assists"><button class="toggle-switch" role="switch" aria-label={t("自动升降舵配平（T）")} aria-checked={isReplay?hud.autoTrim??false:autoTrim} disabled={lastDefinition.birdman||isReplay} onclick={toggleAutoTrim}><span>{t("自动升降舵配平")}</span><kbd>T</kbd></button><button class="toggle-switch" role="switch" aria-label={t("智能混控（U）")} aria-checked={isReplay?hud.smartMixing??false:smartMixing} disabled={isReplay} onclick={toggleSmartMixing}><span>{t("智能混控")}</span><kbd>U</kbd></button><button class="toggle-switch" role="switch" aria-label={t("自适应杆量（Y）")} aria-checked={isReplay?hud.adaptiveControls??false:adaptiveControls} disabled={isReplay} onclick={toggleAdaptiveControls}><span>{t("自适应杆量")}</span><kbd>Y</kbd></button></div>
 </section>
 {#if flightReady}<p class="flight-keyboard-hints">{t("W / S 俯仰 · A / D 滚转 · Q / E 偏航 · X 鼠标操纵 · C 镜头 · Space 开始/暂停")}</p>{/if}
 {/if}

 {:else if screen==='result'&&result}
 {#if isLaboratory(lastChallenge)}
 <LaboratoryResults {result} fractures={hud.fractureCount??0} onDesign={design} onRetry={()=>start()}/>
 {:else}
 <section class="results" class:race-results={lastChallenge!=='birdman'} aria-label={t("飞行结算")}>
 <div class="result-heading"><h1>{lastChallenge==='birdman'?t("本次滑翔成绩"):result.completed?t("挑战完成"):t("挑战未完成")}</h1><span>{t(challengeDefinitions[lastChallenge].name)} · {isReplay?t("飞行重放"):t("挑战成绩")}</span></div>
 <div class="score">{(lastChallenge==='birdman'?result.distance:lastChallenge==='downhill'?result.time:result.score).toFixed(2)}<small>{lastChallenge==='birdman'?'m':lastChallenge==='downhill'?'s':t("分")}</small></div>
 <p class="best">{t("个人最佳")} {best?best.toFixed(2):t("暂无")} {lastChallenge==='birdman'?'m':lastChallenge==='downhill'?'s':t("分")} · {result.completed?t("到达终点"):lastChallenge!=='birdman'?t("未通过全部检查点或碰撞地形"):result.landing==='water'?t("接触湖面"):t("达到飞行边界")}</p>
 <dl class="result-statistics"><div><dt>{t("总计时")}{lastChallenge==='birdman'?t("（含助跑）"):''}</dt><dd>{result.time.toFixed(2)} s</dd></div><div><dt>{t("平均速度")}</dt><dd>{result.averageSpeed.toFixed(2)} m/s</dd></div><div><dt>{t("最高速度")}</dt><dd>{result.maxSpeed.toFixed(2)} m/s</dd></div>{#if lastChallenge!=='birdman'}<div><dt>{t("最大G值")}</dt><dd>{result.maxG.toFixed(2)} G</dd></div>{/if}<div><dt>{t("最大高度")}</dt><dd>{result.maxHeight.toFixed(2)} m</dd></div><div><dt>{t("输入记录")}</dt><dd>{recordedLength} {t("步 · 60 Hz")}</dd></div></dl>
 {#if lastChallenge==='low-altitude'}<p class="result-scoring" title={result.checkpointScores.map((score:number,index:number)=>`${index+1}: ${score.toFixed(0)}`).join(' · ')}>{t("低空分")} {result.checkpointScores.reduce((sum:number,score:number)=>sum+score,0).toFixed(0)} · {t("速度分")} {result.speedScore.toFixed(0)} · {t("超高扣分")} {result.heightPenalty.toFixed(0)}<small aria-label={t("逐门得分")}>{#each result.checkpointScores as score,index}<span title={`${index+1}`}>{score.toFixed(0)}</span>{/each}</small></p>{/if}
 {#if lastChallenge!=='birdman'}<p class="result-g"><small>{t("G值为重心处比力大小，包含发射与接触载荷；静止承重为1G，自由落体为0G。")}</small></p>{/if}
 <p class="result-structure" aria-label={t("最终结构状态")}>{t("结构断裂")} {hud.fractureCount??0} {t("次 · 独立断片")} {hud.fragmentCount??0} {t("片 · 最终结构极限利用率")} {((hud.maxStressRatio??0)*100).toFixed(1)}%</p>
 <section class="wing-peaks" aria-label={t("本次飞行翼面峰值")}><h2>{t("本次飞行翼面峰值")}</h2>{#each hud.peakWings??[] as wing}<p data-wing={wing.key}><strong>{t(wing.name)}</strong><span>{t("结构极限")} <output>{(wing.stress*100).toFixed(1)}%</output> · {t("弹性限")} {(wing.yieldRatio*100).toFixed(1)}%</span></p>{/each}</section>
 {#if activeReplay}<ReplayTimeline replay={activeReplay} position={replayPosition} {seeking} paused={true} onseek={seekTo}/>{/if}<div class="result-instruments">{@render altitudeCurve()}</div><div class="result-actions"><button class="primary" onclick={design}>{t("返回设计改进")}</button><button onclick={()=>start()}>{t("再试一次")}</button><button onclick={()=>start(true)}>{t("重放飞行")}</button><button disabled={replayBusy||!recording?.length} onclick={replayExport}>{t("导出回放")}</button></div>
 </section>
 {/if}
 {/if}
 {#if activeReplay&&screen==='flight'}<div class="replay-panel"><ReplayTimeline replay={activeReplay} position={replayPosition} {seeking} {paused} onseek={seekTo}/></div>{/if}
 {#if debug}<aside class="performance" aria-label={t("开发性能面板")}><h2>{t("性能实测")} <button onclick={()=>debug=false}>{t("关闭")}</button></h2><p>{t(qualityNames[perf.quality]??perf.quality??'')} · {Number(perf.fps||0).toFixed(1)} FPS</p><p>{t("平均")} {Number(perf.mean||0).toFixed(2)} ms · P95 {Number(perf.p95||0).toFixed(2)} ms · P99 {Number(perf.p99||0).toFixed(2)} ms</p><p>{t("物理")} {Number(perf.physicsMs||0).toFixed(3)} {t("ms · 渲染提交")} {Number(perf.renderMs||0).toFixed(2)} ms</p><p>{t("几何")} {Number(perf.geometryMs||0).toFixed(2)} ms · {perf.drawCalls||0} {t('绘制调用')} · {perf.triangles||0} {t('三角形')}</p><p>{t("几何与纹理估算")} {typeof perf.memory==='number'?perf.memory.toFixed(2)+' MiB':t("不可用")}</p><small>{t("帧率来自当前环境，不代表真实手机性能。")}</small></aside>{/if}
 {#if message}<div class="toast" role="status">{t(message)}<button aria-label={t("关闭提示")} onclick={()=>message=''}>{t("关闭")}</button></div>{/if}
</div>

{#if stick&&screen==='flight'}<div class="joystick" aria-label={t("虚拟操纵杆")}><div class="stick-deadzone"></div><div class="stick-knob" style:left={`${50+stickX*50}%`} style:top={`${50-stickY*50}%`}></div></div>{/if}
