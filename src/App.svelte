<script lang="ts">
 import { onMount } from 'svelte';
 import { defaultAircraft, presets, clone, clamp, planform, validateAircraft, fuselageEnds, resizeFuselage, mainWingMountLimits, mainWingSupport, engineMounts, engineHeightRanges, fuelTankLimits, PILOT_MASS, type AircraftDefinition, type Wing } from './model';
 import { FlightSimulation, derive, fuelCgRange, LAUNCH, type FlightControls } from './physics';
 import { challengeDefinitions, challengeLaunch, LOW_ALTITUDE, type ChallengeMode } from './challenges';
 import { SceneView } from './scene';
 import { listAircraft, loadAircraft, saveAircraft, deleteAircraft, renameAircraft, duplicateAircraft, exportAircraft, importAircraft, readBest, writeBest, History, type SavedAircraft } from './storage';
 import WingEditor from './WingEditor.svelte'; import Parameter from './Parameter.svelte';
 import { GameAudio } from './audio';
 import AudioSettings from './AudioSettings.svelte';
 import { trimStep, trimFromPointer } from './trim';
 import { energyCostScale } from './flight-chart';
 import { exportReplay, importReplay, MAX_REPLAY_BYTES, type Replay } from './replay';
 import { summarizeWingStructure } from './structure';
 import { language, setLanguage, t as translate, type Language, type TranslationParams } from './i18n';
 const t=$derived.by(()=>{const locale=$language;return (source:string,params?:TranslationParams)=>translate(source,params,locale);});
 let audioError=$state('');
 const audio=new GameAudio(message=>audioError=message);
 function syncAudio(){audio.update({screen,ready:flightReady,paused:screen==='flight'&&paused,hidden:document.hidden,speed:simulation?.telemetry.speed??0,launching:simulation?.launching??false,engineRpm:simulation?.telemetry.engineRpm??0,challenge:simulation?.challenge??lastChallenge,launchKind:challengeLaunch(simulation?.challenge??lastChallenge)?.kind??'catapult',timingStarted:simulation?.telemetry.timingStarted??false,challengeProgress:simulation?.telemetry.challengeProgress??0});}
 $effect(()=>{screen;flightReady;paused;if(sceneReady)syncAudio();});
 type Tab='机身'|'主翼'|'水平尾翼'|'垂直尾翼'|'动力'|'组装';
 let host:HTMLDivElement;let scene:SceneView;let sceneReady=$state(false);let simulation:FlightSimulation|null=null;let history=$state.raw(new History(clone(defaultAircraft)));let historyVersion=$state(0);
 let aircraft=$state.raw<AircraftDefinition>(clone(defaultAircraft));let tab=$state<Tab>('主翼');let screen=$state<'menu'|'design'|'flight'|'result'>('menu');let quality=$state<'Auto'|'High'|'Medium'|'Low'>('Auto');
 const qualityNames:Record<string,string>={Auto:'自动',High:'高',Medium:'中',Low:'低'};
 let challenge=$state<ChallengeMode>('birdman'),lastChallenge=$state<ChallengeMode>('birdman');
 let saved=$state.raw<SavedAircraft[]>([]),selectedId=$state(''),message=$state(''),showLibrary=$state(false),debug=$state(false),aero=$state(false),stick=$state(false),stickX=$state(0),stickY=$state(0),paused=$state(false),flightReady=$state(false);let best=$state(0);let result=$state<any>(null),hud=$state<any>({speed:0,altitude:LAUNCH.height,distance:0,alpha:0,pitch:0,roll:0,sink:0,glide:0,time:0,liftDragRatio:0,potentialEnergy:0,kineticEnergy:0,dissipatedEnergy:0,initialEnergy:0,launching:true});let perf=$state<any>({});
 let stats=$derived(derive(aircraft));let main=$derived(planform(aircraft.mainWing));let wingKey=$derived<'mainWing'|'horizontalTail'|'verticalTail'>(tab==='水平尾翼'?'horizontalTail':tab==='垂直尾翼'?'verticalTail':'mainWing');
 let ends=$derived(fuselageEnds(aircraft));
 let cockpitMin=$derived(Math.max(-3,ends.tail)),cockpitMax=$derived(Math.min(4,ends.nose-0.95));
 let tailMin=$derived(Math.max(-6,ends.tail)),tailMax=$derived(Math.min(5,ends.nose));
 let mainMountLimits=$derived(mainWingMountLimits(aircraft)),support=$derived(mainWingSupport(aircraft));
 let engineRanges=$derived(engineHeightRanges(aircraft)),tankLimits=$derived(fuelTankLimits(aircraft));
 let fuelCenters=$derived(aircraft.engine.count>0&&aircraft.fuelTank.capacity>0?fuelCgRange(aircraft):null);
 let thrustCenter=$derived.by(()=>{const mounts=engineMounts(aircraft);if(!mounts.length)return null;return mounts.reduce((center,mount)=>({x:center.x+mount.x/mounts.length,y:center.y+mount.y/mounts.length,z:center.z+mount.z/mounts.length}),{x:0,y:0,z:0});});
 let recording=$state.raw<ReturnType<FlightSimulation['getRecording']>|null>(null);let recordedLength=$state(0);let isReplay=$state(false);let lastDefinition=$state.raw(clone(defaultAircraft));
 const keys=new Set<string>();const controls:FlightControls={weight:0,lateral:0,rudder:0,elevator:0,aileron:0};
 const structureWings=summarizeWingStructure([]);
 let trimPitch=$state(0),trimRoll=$state(0),autoTrim=$state(false),adaptiveControls=$state(false);
 let stickPointer:number|null=null,yawPointer:number|null=null,yawInput=0;
 let displayedPitch=$derived(isReplay?hud.trimPitch??0:trimPitch),displayedRoll=$derived(isReplay?hud.trimRoll??0:trimRoll);
 let actualPitch=$derived(lastDefinition.birdman?hud.controlInputs?.weight??0:hud.controlInputs?.elevator??0);
 let actualRoll=$derived(lastDefinition.birdman?hud.controlInputs?.lateral??0:hud.controlInputs?.aileron??0);
 let flightInputDisabled=$derived(!flightReady||isReplay||paused);
 let throttle=$state(1);
 const flightViews=['追尾','侧追尾','侧面','驾驶员','自由'];
 let flightCamera=$state('追尾');
 let pilotHudStyle=$state('visibility:hidden');
 let replayBusy=$state(false);
 let messageTimeout:ReturnType<typeof setTimeout>;
 type FlightSample={time:number;distance:number;height:number;speed:number;scoringHeight:number;energyRatio:number;energyPerDistance:number|null;waterContact:boolean};
 let samples:FlightSample[]=[],lastSampleTime=-Infinity,flightElapsed=0;
 let trajectory=$state.raw<FlightSample[]>([]);
 let chartMaxDistance=$derived(trajectory.reduce<number>((max,p)=>Math.max(max,p.distance),1));
 let chartMaxHeight=$derived(trajectory.reduce<number>((max,p)=>Math.max(max,p.height,lastChallenge==='low-altitude'?p.scoringHeight:0),LAUNCH.height));
 let chartMaxEnergy=$derived(trajectory.reduce((max,p)=>Math.max(max,p.energyRatio),1));
 let chartPoints=$derived(trajectory.map(p=>`${(38+(screen==='result'?p.time/chartMaxTime:p.distance/chartMaxDistance)*290).toFixed(2)},${(98-p.height/chartMaxHeight*76).toFixed(2)}`).join(' '));
 let energyCurvePoints=$derived(screen==='result'?trajectory.map(p=>`${(38+p.time/chartMaxTime*290).toFixed(2)},${(98-p.energyRatio/chartMaxEnergy*76).toFixed(2)}`).join(' '):'');
 let chartMaxCost=$derived(energyCostScale(trajectory));
 let costOutliers=$derived(trajectory.filter(p=>p.energyPerDistance!==null&&p.energyPerDistance>chartMaxCost));
 let costCurvePath=$derived(screen==='result'?trajectory.map((p,i)=>p.energyPerDistance===null?'':`${i===0||trajectory[i-1].energyPerDistance===null?'M':'L'}${(38+p.time/chartMaxTime*290).toFixed(2)},${(98-Math.min(p.energyPerDistance,chartMaxCost)/chartMaxCost*76).toFixed(2)}`).join(' '):'');
 let chartMaxTime=$derived(trajectory.reduce((max,p)=>Math.max(max,p.time),1));
 let chartMaxSpeed=$derived(trajectory.reduce((max,p)=>Math.max(max,p.speed),1));
 let speedCurvePoints=$derived(screen==='result'?trajectory.map(p=>`${(38+p.time/chartMaxTime*290).toFixed(2)},${(98-p.speed/chartMaxSpeed*76).toFixed(2)}`).join(' '):'');
 let scoringCurvePoints=$derived(screen==='result'&&lastChallenge==='low-altitude'?trajectory.map(p=>`${(38+(screen==='result'?p.time/chartMaxTime:p.distance/chartMaxDistance)*290).toFixed(2)},${(98-p.scoringHeight/chartMaxHeight*76).toFixed(2)}`).join(' '):'');
 let energyParts=$derived([{key:'potential',name:'势能',value:hud.potentialEnergy},{key:'kinetic',name:'动能',value:hud.kineticEnergy},{key:'dissipated',name:'已耗散',value:hud.dissipatedEnergy}]);
 let energyTotal=$derived(hud.potentialEnergy+hud.kineticEnergy+hud.dissipatedEnergy);
 let energyBudget=$derived(hud.initialEnergy+(hud.propulsionWork??0)+(hud.controlWork??0)+(hud.waterWork??0)-(hud.fuelEnergyRemoved??0));
 let assemblyPositions=$derived([{key:'mainWing',label:'主翼纵向位置',value:aircraft.assembly.mainWing,min:mainMountLimits.min,max:mainMountLimits.max},{key:'horizontalTail',label:'水平尾翼位置',value:aircraft.assembly.horizontalTail,min:tailMin,max:tailMax},{key:'verticalTail',label:'垂直尾翼位置',value:aircraft.assembly.verticalTail,min:tailMin,max:tailMax},{key:'cockpit',label:'驾驶舱位置',value:aircraft.cockpit.position,min:cockpitMin,max:cockpitMax}] as const);
 function setPosition(key:typeof assemblyPositions[number]['key'],input:HTMLInputElement){const n=input.valueAsNumber,position=assemblyPositions.find(p=>p.key===key)!;if(Number.isFinite(n)){const supported=clamp(n,position.min,position.max);change(d=>{if(key==='cockpit')d.cockpit.position=supported;else d.assembly[key]=supported;});if(n!==supported)notify('已限制在机身支撑范围内；可先延长机头或机尾。');commit();}else notify('位置必须是有限数值');input.value=String(key==='cockpit'?aircraft.cockpit.position:aircraft.assembly[key]);}
 function setEnd(end:'nose'|'tail',input:HTMLInputElement){const n=input.valueAsNumber;if(Number.isFinite(n)){change(d=>resizeFuselage(d,end,n));commit();if(Math.abs(fuselageEnds(aircraft)[end]-n)>1e-6)notify('端点受 3–12 m 机身长度、驾驶舱和尾翼支撑限制。');}else notify('端点必须是有限数值');input.value=String(Number(fuselageEnds(aircraft)[end].toFixed(6)));}
 $effect(()=>{const target=screen==='design'?(tab==='组装'?'assembly':tab==='动力'?'propulsion':tab==='机身'?null:wingKey):null;if(sceneReady)scene.setEditor(target,d=>change(out=>Object.assign(out,d)),commit);});
 function sampleFlight(final=false){if(!simulation||(lastChallenge==='birdman'&&simulation.launching))return;if(final||flightElapsed-lastSampleTime>=0.1){const t=simulation.telemetry;samples.push({time:flightElapsed,distance:t.distance,height:t.altitude,speed:t.speed,scoringHeight:t.altitude-t.groundClearance+LOW_ALTITUDE.scoringHeight,energyRatio:t.initialEnergy>0?(t.kineticEnergy+t.potentialEnergy)/t.initialEnergy:0,energyPerDistance:t.energyPerDistance,waterContact:t.waterContact});lastSampleTime=flightElapsed;}}
 function refreshHud(){if(!simulation)return;const t=simulation.telemetry,s=simulation.structure;hud={...t,alpha:t.alpha*180/Math.PI,pitch:t.pitch*180/Math.PI,roll:t.roll*180/Math.PI,time:simulation.time,launching:simulation.launching,maxStressRatio:s.maxStressRatio,maxYieldRatio:s.maxYieldRatio,maxDeflection:s.maxDeflection,fractureCount:s.fractureCount,fragmentCount:simulation.fragments.length,peakWings:s.peakWings,wings:summarizeWingStructure(s.sections,structureWings)};}
 function refreshTrajectory(){if(trajectory.length!==samples.length)trajectory=samples.slice();}
 const hints:Record<Tab,string>={
  '机身':'驾驶舱的位置改变重心。过度靠后可能让飞机俯仰失稳。',
  '主翼':'拖动四个顶点或 1–4 根弦、2–3 梢弦线段。沿屏幕垂直方向轻吸附，按住 Ctrl 取消。增加面积降低翼载荷，但增加重量与阻力。',
  '水平尾翼':'拖动顶点或 1–4 根弦、2–3 梢弦线段。沿屏幕垂直方向轻吸附，按住 Ctrl 取消。增大尾翼或后移安装位置，通常提高俯仰稳定性。',
  '垂直尾翼':'侧视拖动顶点或 1–4 根弦、2–3 梢弦线段。沿屏幕垂直方向轻吸附，按住 Ctrl 取消。垂直尾翼提供偏航恢复力矩，太小容易偏离航向。',
  '组装':'侧视拖动主翼、尾翼或驾驶舱。主翼高度接近机身时吸附至 0 m，按住 Ctrl 绕过吸附。正 X 朝机头；尾翼位置以翼根中心为准。',
  '动力':'喷气引擎与油箱参与质量、重心和惯量计算。引擎偏离机身时自动增加支撑。正 X 朝机头。',
 };
 function notify(s:string,kind:'success'|'error'='error'){audio.ui(kind);clearTimeout(messageTimeout);message=s;messageTimeout=setTimeout(()=>message='',5000);}
 function commit(){try{aircraft=validateAircraft(aircraft);history.push(clone(aircraft));historyVersion++;}catch(e){notify((e as Error).message);}}
 function change(mutator:(d:AircraftDefinition)=>void){const d=clone(aircraft);mutator(d);try{aircraft=validateAircraft(d);scene?.updateAircraft(aircraft);}catch(e){notify((e as Error).message);}}
 function forChallenge(definition:AircraftDefinition){const d=clone(definition);if(challenge==='birdman'){if(!d.birdman){d.birdman=true;d.mainWing.controlSurface=0;d.horizontalTail.controlSurface=0;}d.engine.count=0;d.fuelTank.capacity=0;}return validateAircraft(d);}
 function replace(d:AircraftDefinition){try{aircraft=forChallenge(d);scene?.updateAircraft(aircraft);commit();return true;}catch(e){notify((e as Error).message);return false;}}
 function undo(){const d=history.undo();if(d){aircraft=forChallenge(d);selectedId='';scene?.updateAircraft(aircraft);historyVersion++;}}
 function redo(){const d=history.redo();if(d){aircraft=forChallenge(d);selectedId='';scene?.updateAircraft(aircraft);historyVersion++;}}
 function library(){try{saved=listAircraft();showLibrary=!showLibrary;}catch(e){notify((e as Error).message);}}
 function save(){try{const definition=validateAircraft(aircraft),existing=listAircraft().find(item=>item.name===definition.name);if(existing&&!confirm(t('覆盖“{name}”？原设计将被替换。',{name:existing.name})))return;const item=saveAircraft(definition,existing?.id);selectedId=item.id;saved=listAircraft();notify('飞机已保存在此浏览器','success');}catch(e){notify((e as Error).message);}}
 function load(id:string){try{const item=loadAircraft(id);if(replace(item.definition)){selectedId=id;showLibrary=false;notify(t('已加载 {name}',{name:item.name}),'success');}}catch(e){notify((e as Error).message);}}
 function renameSaved(id:string,name:string){try{const item=renameAircraft(id,name);saved=listAircraft();if(selectedId===id){change(d=>d.name=item.name);commit();}}catch(e){notify((e as Error).message);}}
 function fileExport(id:string){try{const definition=loadAircraft(id).definition,url=URL.createObjectURL(new Blob([exportAircraft(definition)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=definition.name+'.json';a.click();URL.revokeObjectURL(url);}catch(e){notify((e as Error).message);}}
 async function fileImport(e:Event){const input=e.target as HTMLInputElement;try{const f=input.files?.[0];if(f){if(f.size>100000)throw Error('文件超过 100 KB');if(replace(importAircraft(await f.text()))){selectedId='';notify('导入成功','success');}}}catch(e){notify(t('导入失败：{error}',{error:t((e as Error).message)}));}input.value='';}
 function clearControls(){stick=false;stickPointer=yawPointer=null;stickX=stickY=yawInput=0;keys.clear();controls.weight=controls.lateral=controls.rudder=controls.elevator=controls.aileron=0;}
 function start(replay=false,imported?:Replay){trimPitch=trimRoll=0;autoTrim=adaptiveControls=false;throttle=1;try{const definition=imported?.definition??(replay?lastDefinition:forChallenge(aircraft)),selectedChallenge=imported?.challenge??(replay?lastChallenge:challenge);const next=new FlightSimulation(definition,selectedChallenge);if(replay&&(imported?.recording??recording))next.loadReplay(imported?.recording??recording!);simulation=next;lastDefinition=definition;lastChallenge=selectedChallenge;if(imported)recording=imported.recording;samples=[];trajectory=[];lastSampleTime=-Infinity;flightElapsed=0;refreshHud();isReplay=replay;screen='flight';result=null;paused=false;flightReady=false;clearControls();scene.setEditor(null,d=>change(out=>Object.assign(out,d)),commit);scene.setFlight(simulation);scene.setDebug(aero);flightCamera='追尾';scene.cameraView(flightCamera);}catch(e){notify((e as Error).message);}}
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
 function beginFlight(){if(screen!=='flight'||!simulation||flightReady)return;clearControls();paused=false;flightReady=true;syncAudio();if(lastChallenge!=='low-altitude')audio.launch();}
 function togglePause(){if(screen==='flight'&&flightReady){paused=!paused;clearControls();}}
 function finish(){if(!simulation)return;sampleFlight(true);refreshHud();refreshTrajectory();result=simulation.result;if(result?.landing==='terrain'){audio.crash();scene.markCrash(()=>audio.stroke());}clearControls();recordedLength=simulation.recordingLength;screen='result';flightCamera='追尾';scene.cameraView('轨道');if(!isReplay){recording=simulation.getRecording();try{best=readBest(lastChallenge);if(lastChallenge==='birdman'||result.completed)best=writeBest(lastChallenge==='birdman'?result.distance:lastChallenge==='downhill'?result.time:result.score,lastChallenge);}catch(e){notify((e as Error).message);}}}
 function design(){if(aircraft.birdman&&tab==='动力')tab='主翼';screen='design';simulation=null;flightReady=false;scene?.setFlight(null);scene?.updateAircraft(aircraft);scene?.cameraView('轨道');clearControls();}
 function challengeAircraft(){return challenge==='birdman'?defaultAircraft:presets.find(p=>p.name===(challenge==='downhill'?'高山速降机动型':'低空喷气巡航型'))!;}
 function enterChallenge(next:ChallengeMode){challenge=next;if(next==='birdman'&&(!aircraft.birdman||aircraft.engine.count>0)){aircraft=clone(defaultAircraft);selectedId='';history=new History(clone(aircraft));historyVersion=0;}showLibrary=false;try{best=readBest(challenge);}catch(e){notify((e as Error).message);}design();}
 function toggleAutoTrim(){if(screen!=='flight'||!flightReady||isReplay||lastDefinition.birdman)return;autoTrim=!autoTrim;}
 function toggleAdaptiveControls(){if(screen==='flight'&&flightReady&&!isReplay)adaptiveControls=!adaptiveControls;}
 function setPitchTrim(value:number){trimPitch=value;autoTrim=false;}
 function moveStick(e:PointerEvent){const bounds=e.currentTarget instanceof HTMLElement?e.currentTarget.getBoundingClientRect():null;if(!bounds)return;const radius=Math.min(bounds.width,bounds.height)/2,x=(e.clientX-bounds.left-bounds.width/2)/radius,y=(bounds.top+bounds.height/2-e.clientY)/radius,length=Math.hypot(x,y),scale=length>0.05?Math.min(1,(length-0.05)/0.95)/length:0;stickX=x*scale;stickY=y*scale;}
 function beginStick(e:PointerEvent){if(flightInputDisabled)return;e.preventDefault();stickPointer=e.pointerId;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);moveStick(e);}
 function releaseStick(e:PointerEvent){if(stickPointer!==e.pointerId)return;stickPointer=null;stickX=stickY=0;}
 function beginYaw(e:PointerEvent,value:number){if(flightInputDisabled)return;e.preventDefault();yawPointer=e.pointerId;yawInput=value;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);}
 function releaseYaw(e:PointerEvent){if(yawPointer===e.pointerId){yawPointer=null;yawInput=0;}}
 function keyboard(e:KeyboardEvent,down:boolean){
 if(!down&&e.code==='KeyX'&&stickPointer===null){stick=false;stickX=stickY=0;}
 if(e.code==='Escape'&&down&&!e.repeat){e.preventDefault();if(screen==='flight'||screen==='result')design();else if(screen==='design'){screen='menu';showLibrary=false;}return;}
 const target=e.target as HTMLElement;
 if((e.ctrlKey||e.metaKey)&&e.code==='KeyA'&&!target.closest('input:not([type=range]),textarea,[contenteditable="true"]'))e.preventDefault();
 if((target.closest('input:not([type=range]):not([type=checkbox]):not([type=file]),textarea,[contenteditable="true"]')&&!(target.closest('.trim-controls')&&['KeyH','KeyJ','KeyK','KeyL'].includes(e.code))))return;
 if(target.matches('input[type=range]')&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 if(['Digit1','Numpad1','Digit2','Numpad2'].includes(e.code)){
 const key=e.code.endsWith('1')?'throttle-up':'throttle-down';
 if(down&&screen==='flight'&&!isReplay&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();keys.add(key);}else keys.delete(key);
 return;
 }
 if(screen==='flight'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.code==='Space'||e.code==='KeyC')&&!(e.code==='Space'&&target.closest('button,select,summary,a'))){
 e.preventDefault();
 if(down&&!e.repeat){
 if(e.code==='Space'){if(flightReady)togglePause();else beginFlight();}
 else{flightCamera=flightViews[(flightViews.indexOf(flightCamera)+1)%flightViews.length];scene.cameraView(flightCamera);}
 }
 return;
 }
 if(!e.ctrlKey&&!e.metaKey&&!e.altKey){
 if(down&&screen==='flight'&&flightReady&&!isReplay&&['KeyH','KeyJ','KeyK','KeyL'].includes(e.code)){e.preventDefault();if(e.code==='KeyH'||e.code==='KeyL')trimRoll=trimStep(trimRoll,e.code==='KeyL'?1:-1);else setPitchTrim(trimStep(displayedPitch,e.code==='KeyK'?1:-1));return;}
 if(down&&!e.repeat&&screen==='flight'&&['KeyT','KeyY'].includes(e.code)){e.preventDefault();if(e.code==='KeyT')toggleAutoTrim();else toggleAdaptiveControls();return;}
 if(e.code==='KeyR'&&down&&!e.repeat&&(screen==='flight'||screen==='result')){e.preventDefault();start();return;}
 if(e.code==='KeyX'){if(screen==='flight'&&!flightInputDisabled){stick=down;if(!down&&stickPointer===null)stickX=stickY=0;}return;}
 }
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))e.preventDefault();
 if(down&&screen==='flight'&&!flightInputDisabled)keys.add(e.key.toLowerCase());else keys.delete(e.key.toLowerCase());
 if(down&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}
 }
onMount(()=>{
 scene=new SceneView(host);scene.updateAircraft(aircraft);sceneReady=true;
 const unlock=()=>audio.unlock();
 const click=(e:MouseEvent)=>{const target=e.target instanceof Element?e.target:null;if(target?.closest('button:not(:disabled),summary')&&!target.closest('.flight-controls'))audio.ui('click');};
 document.addEventListener('pointerdown',unlock,true);document.addEventListener('keydown',unlock,true);document.addEventListener('click',click,true);
const fixedDt=1/60;
let previous=performance.now(),accumulator=0,lastInstruments=0,request=0;
 const visibility=()=>{clearControls();previous=performance.now();accumulator=0;scene.captureFlightState();syncAudio();};
const tick=(now:number)=>{
  const elapsed=Math.min(Math.max((now-previous)/1000,0),0.1);previous=now;
  if(!document.hidden){
    if(screen==='flight'&&!isReplay)throttle=clamp(throttle+((keys.has('throttle-up')?1:0)-(keys.has('throttle-down')?1:0))*elapsed*0.35,0,1);
    const running=screen==='flight'&&simulation&&flightReady&&!paused;
    if(running){
      accumulator+=elapsed;
      let steps=0;
      while(accumulator>=fixedDt&&steps<5){
        const pitchInput=stickY+(keys.has('arrowup')||keys.has('w')?1:0)-(keys.has('arrowdown')||keys.has('s')?1:0);
        const rollInput=stickX+(keys.has('arrowright')||keys.has('d')?1:0)-(keys.has('arrowleft')||keys.has('a')?1:0);
        controls.weight=lastDefinition.birdman?clamp(trimPitch+pitchInput,-1,1):0;
        controls.lateral=lastDefinition.birdman?clamp(trimRoll+rollInput,-1,1):0;
        controls.rudder=clamp(yawInput+(keys.has('e')?1:0)-(keys.has('q')?1:0),-1,1);
        controls.elevator=lastDefinition.birdman?0:clamp(pitchInput,-1,1);
        controls.aileron=lastDefinition.birdman?0:clamp(rollInput,-1,1);
        controls.throttle=throttle;controls.trimPitch=trimPitch;controls.trimRoll=trimRoll;
        controls.autoTrim=autoTrim&&!lastDefinition.birdman;controls.adaptiveControls=adaptiveControls;
        scene.captureFlightState();
         const wasLaunching=simulation!.launching;
         simulation!.step(controls,fixedDt);flightElapsed+=fixedDt;sampleFlight();
         if(autoTrim&&!isReplay)trimPitch=simulation!.telemetry.trimPitch;
         syncAudio();
         if(lastChallenge!=='low-altitude'&&wasLaunching&&!simulation!.launching)audio.release();
        accumulator-=fixedDt;steps++;
        if(simulation!.ended){finish();accumulator=0;break;}
        if(simulation!.replayFinished){paused=true;clearControls();notify('回放结束','success');accumulator=0;break;}
      }
      // 过载时只丢弃整步积压，保留渲染插值所需的小数余量。
      if(accumulator>=fixedDt)accumulator%=fixedDt;
    }else{
      accumulator=0;scene.captureFlightState();
    }
    scene.render(elapsed,running?accumulator/fixedDt:1);
    if(flightCamera==='驾驶员')pilotHudStyle=scene.pilotHudStyle();
     syncAudio();
    if(screen==='flight')refreshHud();
    if(now-lastInstruments>150){refreshTrajectory();perf={...scene.metrics,physicsMs:simulation?.telemetry.physicsMs??0};lastInstruments=now;}
  }
  request=requestAnimationFrame(tick);
};
request=requestAnimationFrame(tick);
const mouse=(e:PointerEvent)=>{if(!stick||stickPointer!==null)return;const radius=innerHeight*0.3;let x=(e.clientX-innerWidth/2)/radius,y=(innerHeight/2-e.clientY)/radius;const length=Math.hypot(x,y),scale=length>0.05?Math.min(1,(length-0.05)/0.95)/length:0;stickX=x*scale;stickY=y*scale;};
window.addEventListener('pointermove',mouse);
const down=(e:KeyboardEvent)=>keyboard(e,true),up=(e:KeyboardEvent)=>keyboard(e,false),blur=clearControls;window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);
 try{saved=listAircraft();best=readBest(challenge);}catch(e){notify((e as Error).message);}
 // Read-only diagnostics for automated measurement; interaction tests still use visible controls.
 Object.assign(window,{glider:{get aircraft(){return clone(aircraft)},get state(){return screen},get flightReady(){return flightReady},get time(){return simulation?.time??0},get recordingLength(){return simulation?.recordingLength??0},get scene(){return scene.getDiagnostics()},get trajectory(){return samples.map(p=>({...p}))},get metrics(){return {...scene.metrics,physicsMs:simulation?.telemetry.physicsMs??0}},get telemetry(){return simulation?.telemetry},get flightControls(){return {trimPitch:displayedPitch,trimRoll:displayedRoll,autoTrim:isReplay?hud.autoTrim:autoTrim,adaptiveControls:isReplay?hud.adaptiveControls:adaptiveControls,controlLimit:hud.controlLimit??1,inputs:simulation?.telemetry.controlInputs}},get result(){return result}}});
 return()=>{window.removeEventListener('pointermove',mouse);clearTimeout(messageTimeout);cancelAnimationFrame(request);audio.dispose();scene.dispose();document.removeEventListener('pointerdown',unlock,true);document.removeEventListener('keydown',unlock,true);document.removeEventListener('click',click,true);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);};});

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
 {#if screen==='result'}<div class="chart-legend"><span class="height-key">{t("高度 · 左轴 m")}</span>{#if lastChallenge==='birdman'}<span class="energy-key">{t("剩余机械能 · 右轴 %")}</span><span class="cost-key">{t("实时能耗 · 外右轴 J/m")}</span>{/if}<span class="speed-key">{t("空速")} · m/s</span>{#if lastChallenge==='low-altitude'}<span class="scoring-key">{t("计分高度上限 · 接触表面 +")} {LOW_ALTITUDE.scoringHeight.toFixed(1)} m</span>{/if}</div>{/if}
 <svg viewBox={screen==='result'?(lastChallenge==='birdman'?'0 0 510 124':'0 0 390 124'):'0 0 348 124'} role="img" aria-label={screen==='result'?t("飞行数据曲线")+' · '+t("横轴为试飞时间，各曲线使用独立纵轴。"):t("飞行轨迹，水平距离0至{p0}米，高度0至{p1}米{p2}",{p0:chartMaxDistance.toFixed(1),p1:chartMaxHeight.toFixed(1),p2:''})}>
 <line class="chart-grid" x1="38" y1="22" x2="328" y2="22"/><line class="chart-grid" x1="38" y1="60" x2="328" y2="60"/><path class="chart-axis" d="M38 16V98H330"/>
 <text x="2" y="25">{chartMaxHeight.toFixed(1)}</text><text x="23" y="101">0</text><text x="38" y="116">0</text><text x="328" y="116" text-anchor="end">{screen==='result'?chartMaxTime.toFixed(1)+' s':chartMaxDistance.toFixed(1)+' m'}</text><text x="3" y="12">{t("高度 m")}</text>
 {#if trajectory.length}{@const last=trajectory[trajectory.length-1]}<polyline class="chart-line" points={chartPoints}/><circle class="chart-current" cx={38+(screen==='result'?last.time/chartMaxTime:last.distance/chartMaxDistance)*290} cy={98-last.height/chartMaxHeight*76} r="3"/>{/if}
 {#if screen==='result'&&lastChallenge==='birdman'}
 <path class="chart-axis" d="M328 22V98"/><text x="336" y="25">{(chartMaxEnergy*100).toFixed(0)}%</text><text x="336" y="63">{(chartMaxEnergy*50).toFixed(0)}%</text><text x="336" y="101">0%</text>
 <polyline class="chart-energy-line" aria-label={t("剩余机械能占比曲线")} points={energyCurvePoints}/>
 <path class="chart-axis" d="M390 22V98"/><text x="396" y="12">J/m</text><text x="396" y="25">{chartMaxCost.toFixed(1)}</text><text x="396" y="63">{(chartMaxCost/2).toFixed(1)}</text><text x="396" y="101">0</text>
 <path class="chart-cost-line" aria-label={t("实时能耗曲线")} d={costCurvePath}/>
 {#each costOutliers as p}<path class="chart-cost-line" d={`M${36+p.time/chartMaxTime*290} 26 l2 -4 l2 4`}><title>{p.energyPerDistance!.toFixed(1)} J/m</title></path>{/each}
 {/if}
 {#if screen==='result'&&lastChallenge==='low-altitude'}
 <polyline class="chart-scoring-line" aria-label={t("计分高度参考曲线")} points={scoringCurvePoints}/>
 {/if}
 {#if screen==='result'}<path class="chart-axis" d={lastChallenge==='birdman'?"M450 22V98":"M328 22V98"}/><text x={lastChallenge==='birdman'?455:336} y="12">m/s</text><text x={lastChallenge==='birdman'?455:336} y="25">{chartMaxSpeed.toFixed(1)}</text><text x={lastChallenge==='birdman'?455:336} y="101">0</text><polyline class="chart-speed-line" aria-label={t("空速")} points={speedCurvePoints}/>{/if}
 </svg>
 <p class="chart-caption">{#if screen==='result'}{t("横轴为试飞时间，各曲线使用独立纵轴。")} {/if}{lastChallenge==='birdman'?t("离台后"):t("开始试飞后")}{t("每 0.1 s 采样，末点保留实际终止高度。")}{#if screen==='result'&&lastChallenge==='birdman'}{t("能耗纵轴按正常飞行缩放；擦水与离群峰值以顶部三角标记，悬停查看原值。")} {t("机械能占比 =（动能 + 势能）/ 离台初始能量，动能含转动。实时能耗 = 耗散功率 / 水平速度；无定义时断线，不记作零。")}{:else if lastChallenge!=='birdman'}{t("距离从出发门后累计，门前采样距离为零。")}{#if lastChallenge==='low-altitude'}{t("虚线沿每个真实采样位置的地形或河面上方")} {LOW_ALTITUDE.scoringHeight.toFixed(1)} {t("m；实际高度高于虚线时超出计分高度。")}{/if}{/if}</p>
 </section>
{/snippet}

{#snippet trimControls()}
 <div class="trim-controls" aria-label={t("配平控制")}>
 <label class="pitch-trim"><span>{t("升降舵配平")} <kbd>J/K</kbd> <output>{((displayedPitch+1)*50).toFixed(0)}%</output></span><span class="trim-track"><input aria-label={t("升降舵配平")} disabled={!flightReady||isReplay} type="range" min="0" max="100" step="1" value={(displayedPitch+1)*50} oninput={e=>{setPitchTrim(trimFromPointer(e.currentTarget.valueAsNumber));e.currentTarget.value=String((trimPitch+1)*50);}}/><i aria-hidden="true"></i></span></label>
 <label class="roll-trim"><span>{t("副翼配平")} <kbd>H/L</kbd> <output>{((displayedRoll+1)*50).toFixed(0)}%</output></span><span class="trim-track"><input aria-label={t("副翼配平")} disabled={!flightReady||isReplay} type="range" min="0" max="100" step="1" value={(displayedRoll+1)*50} oninput={e=>{trimRoll=trimFromPointer(e.currentTarget.valueAsNumber);e.currentTarget.value=String((trimRoll+1)*50);}}/><i aria-hidden="true"></i></span></label>
 <small>{t("50% 中立 · 鼠标吸附中点 · 快捷键每格 5%")}</small>
 </div>
{/snippet}
{#snippet aeroWindow()}
{#if aero&&hud.aerodynamics}<aside class="aero-live" aria-label={t("实时气动数据")}><h2>{t("实时气动数据")}</h2><dl>
{#each [["下沉率",hud.sink,"m/s"],["航迹滑翔比",hud.glide,""] ,["升力",hud.aerodynamics.lift.y,"N"],["推力",hud.thrust,"N"],["阻力",hud.aerodynamics.drag.length(),"N"],["侧向力",hud.aerodynamics.force.z,"N"],["攻角",hud.alpha,"°"],["侧滑角",hud.aerodynamics.beta*180/Math.PI,"°"],["俯仰角",hud.pitch,"°"],["滚转角",hud.roll,"°"],["升阻比",hud.liftDragRatio,""],["速度×升阻比",hud.speed*hud.liftDragRatio,"m/s"]] as item}<div><dt>{t(String(item[0]))}</dt><dd>{Number(item[1]).toFixed(2)} {item[2]}</dd></div>{/each}
</dl></aside>{/if}

{/snippet}
<div class="app" class:flying={screen==='flight'} class:designing={screen==='design'} class:powered-flight={screen==='flight'&&lastDefinition.engine.count>0} class:low-flying={screen==='flight'&&lastChallenge==='low-altitude'} class:awaiting-flight={screen==='flight'&&!flightReady}>
 <div class="scene" bind:this={host} aria-label={t("三维滑空机与湖面场景")}></div>
 <header class="topbar">
  <div class="brand-group">
   <button class="brand" onclick={()=>screen==='flight'?togglePause():screen='menu'} aria-label={t("返回主菜单")}><svg viewBox="0 0 36 28" width="34" height="28" fill="none" aria-hidden="true"><path d="M2 10 33 3 23 13 19 25 14 14 2 10Z" stroke="currentColor" stroke-width="1.7"/><path d="m14 14 19-11" stroke="currentColor"/></svg><span>{t('翼构方程')}<small>{t('设计与驾驶')}</small></span></button>
   <a class="github-link" href="https://github.com/Nigh/glider-3d" target="_blank" rel="noopener noreferrer" aria-label={t("GitHub 项目源码（新标签页）")} title={t("GitHub 项目源码")}><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.77c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg></a>
  </div>
  {#if screen!=='menu'}<nav aria-label={t("游戏流程")}><button class:active={screen==='design'} onclick={design}>{t("设计")}</button><button class:active={screen==='flight'||screen==='result'} onclick={()=>start()}>{t("试飞")}</button></nav>{/if}
  <div class="top-actions">
   <label class="language-label"><span>{t('语言')}</span><select aria-label={t('语言')} value={$language} onchange={e=>setLanguage(e.currentTarget.value as Language)}><option value="zh">中文</option><option value="en">English</option><option value="ja">日本語</option></select></label>
   <AudioSettings {audio} error={audioError}/>
   <label class="quality-label">{t("画质")} <select aria-label={t("画质")} bind:value={quality} onchange={()=>scene?.setQuality(quality)}><option value="Auto">{t(qualityNames.Auto)}</option><option value="High">{t(qualityNames.High)}</option><option value="Medium">{t(qualityNames.Medium)}</option><option value="Low">{t(qualityNames.Low)}</option></select></label>
   <button class="text-button toggle-switch" role="switch" aria-checked={aero} onclick={()=>{aero=!aero;scene?.setDebug(aero);}}>{t("气动图层")}</button>
   <button class="text-button toggle-switch" role="switch" aria-checked={debug} onclick={()=>{debug=!debug;}}>{t("性能")}</button>
  </div>
 </header>
 {#if screen==='menu'}
 <main class="welcome"><h1>{t("不同飞机，")}<br/>{t("不同挑战。")}</h1><p>{t("选择挑战，进入对应飞机工坊。")}<br/>{t("湖面比距离，山谷竞速，低空贴地闯关。")}</p><div class="mode-buttons"><button class="primary large" onclick={()=>enterChallenge('birdman')}>{t("鸟人间挑战")} <small>{t("无动力 · 湖面距离")}</small></button><button class="secondary large" onclick={()=>enterChallenge('downhill')}>{t("高山速降")} <small>{t("山顶弹射 · 山谷竞速")}</small></button><button class="secondary large" onclick={()=>enterChallenge('low-altitude')}>{t("低空飞行")} <small>{t("跑道起飞 · 河谷计分")}</small></button></div><label class="button replay-import">{t("导入回放")}<input aria-label={t("导入回放")} disabled={replayBusy} type="file" accept=".json,application/json" onchange={replayImport}/></label><div class="welcome-note">{t("W / S 俯仰 · A / D 滚转 · Q / E 偏航 · 1 / 2 油门")}</div></main>
 <aside class="menu-caption"><span>{t("湖风 01 / 均衡型")}</span><p>{t("14.0 m 翼展")} <b>·</b> {t("参数化轻型滑空机")}</p></aside>
 {:else if screen==='design'}
 <aside class="editor"><div class="editor-heading"><div><h1>{t("飞机工坊")}</h1><p>{t(challengeDefinitions[challenge].name)} {t("· 调整设计，前往挑战。")}</p></div><button class="hangar-button" aria-expanded={showLibrary} onclick={library}>{t("机库")}</button></div><div class="name-row"><input aria-label={t("飞机名称")} value={aircraft.name} maxlength="60" onchange={e=>{change(d=>d.name=e.currentTarget.value);commit();}}/><button onclick={save}>{t("保存")}</button></div><div class="history"><button disabled={!historyVersion||!history.canUndo} onclick={undo}>{t("撤销")}</button><button disabled={!historyVersion||!history.canRedo} onclick={redo}>{t("重做")}</button><button onclick={()=>{replace(challengeAircraft());selectedId='';}}>{t("重置设计")}</button></div>
 <div class="replay-toolbar"><label class="button replay-import">{t("导入回放")}<input aria-label={t("导入回放")} disabled={replayBusy} type="file" accept=".json,application/json" onchange={replayImport}/></label></div><div class="tabs" role="tablist" aria-label={t("部件编辑")}>{#each (aircraft.birdman?['机身','主翼','水平尾翼','垂直尾翼','组装']:['机身','主翼','水平尾翼','垂直尾翼','动力','组装']) as part}<button role="tab" aria-selected={tab===part} class:active={tab===part} onclick={()=>tab=part as Tab}>{t(part)}</button>{/each}</div>
 <div class="editor-content"><h2>{tab==='组装'?t('位置与配平'):t('{part}设计',{part:t(tab)})}</h2><p class="help">{t(hints[tab])}</p>
 <p class="help">{aircraft.birdman?t("鸟人间专用：仅垂尾具有控制面；俯仰与滚转靠驾驶员移动重心。"):t("主翼副翼与平尾升降舵控制姿态；驾驶员由流线座舱包覆。")}</p>
 <p class="help">{t("切换挑战保留当前飞机。仅进入鸟人间时，不符合规则的飞机恢复默认。重置设计会载入当前挑战的默认飞机。")}</p>
 {#if tab==='机身'}
 <div class="assembly-positions" aria-label={t("机身端点精确值")}>
 <label><span>{t("机头端点")}</span><input aria-label={t("机头端点精确值")} type="number" min={Math.max(ends.tail+3,aircraft.cockpit.position+0.95,aircraft.assembly.horizontalTail,aircraft.assembly.verticalTail,support.x)} max={ends.tail+12} step="0.1" value={Number(ends.nose.toFixed(6))} onchange={e=>setEnd('nose',e.currentTarget)}/><small>m</small></label>
 <label><span>{t("机尾端点")}</span><input aria-label={t("机尾端点精确值")} type="number" min={ends.nose-12} max={Math.min(ends.nose-3,aircraft.cockpit.position,aircraft.assembly.horizontalTail,aircraft.assembly.verticalTail,support.x)} step="0.1" value={Number(ends.tail.toFixed(6))} onchange={e=>setEnd('tail',e.currentTarget)}/><small>m</small></label>
 </div><p class="fixed-parameter">{t("机身长度")} <output aria-label={t("机身长度")}>{aircraft.fuselage.length.toFixed(2)} m</output> {t("· 驾驶员")} <output aria-label={t("固定驾驶员质量")}>{PILOT_MASS} kg</output></p><p class="help">{t("端点以机身局部 X 为准。移动一端，另一端不动；在组装视图也可直接拖动。驾驶舱及尾翼必须留在机身支撑范围内。")}</p>
 <div class="parameter"><div class="parameter-head"><label><span>{t("驾驶舱位置")}</span><input aria-label={t("驾驶舱位置精确值")} type="number" min={cockpitMin} max={cockpitMax} step="0.1" value={aircraft.cockpit.position} onchange={e=>setPosition('cockpit',e.currentTarget)}/><small>m</small></label></div><input aria-label={t("驾驶舱位置")} type="range" min={cockpitMin} max={cockpitMax} step="0.1" value={aircraft.cockpit.position} oninput={e=>change(d=>d.cockpit.position=e.currentTarget.valueAsNumber)} onchange={commit}/><p>{t("正值向机头移动。固定")} {PILOT_MASS} {t("kg 驾驶员随驾驶舱改变重心；移动范围保持机身支撑。")}</p></div>
 {#if aircraft.birdman}<Parameter label={t("重心前后行程")} value={aircraft.controls.travel} min={0.1} max={0.8} step={0.05} unit="m" onchange={n=>change(d=>d.controls.travel=n)} oncommit={commit}/><Parameter label={t("重心左右行程")} value={aircraft.controls.lateralTravel} min={0.01} max={0.2} step={0.01} unit="m" onchange={n=>change(d=>d.controls.lateralTravel=n)} oncommit={commit}/>{/if}
 {:else if tab==='动力'}
 <label class="fixed-parameter">{t("喷气引擎")}<select aria-label={t("引擎数量")} value={aircraft.engine.count} onchange={e=>{change(d=>{const previous=d.engine.count;d.engine.count=Number(e.currentTarget.value) as 0|1|2;if(d.engine.count){if(d.engine.count===2&&previous!==2)d.engine.y=0;if(!d.fuelTank.capacity)d.fuelTank.capacity=12;}else d.fuelTank.capacity=0;});commit();}}><option value={0}>{t("无引擎")}</option><option value={1}>{t("单发 · Jet 01")}</option><option value={2}>{t("双发 · Jet 01")}</option></select></label>
 {#if aircraft.engine.count}
 <Parameter label={t("引擎纵向位置")} value={aircraft.engine.x} min={ends.tail} max={ends.nose} step={0.05} unit="m" onchange={n=>change(d=>d.engine.x=n)} oncommit={commit}/>
 <Parameter label={t("引擎垂直偏移")} value={aircraft.engine.y} min={-0.5} max={1} step={0.01} unit="m" onchange={n=>change(d=>d.engine.y=n)} oncommit={commit} hint={t("负值在下，正值在上。可用范围：{p0}。自动跳过机身重叠区；单发居中，双发固定在机身两侧。",{p0:engineRanges.map(r=>t('{p0} 至 {p1} m',{p0:r.min.toFixed(3),p1:r.max.toFixed(3)})).join(' / ')})}/>
 <Parameter label={t("油箱容量")} value={aircraft.fuelTank.capacity} min={0} max={40} step={0.5} unit="L" onchange={n=>change(d=>d.fuelTank.capacity=n)} oncommit={commit} hint={t("油箱固定在机身内部，起飞装满；燃油消耗改变质量与重心，耗尽后引擎无推力。")}/>
 <Parameter label={t("油箱纵向位置")} value={aircraft.fuelTank.x} min={tankLimits.min} max={tankLimits.max} step={0.01} unit="m" onchange={n=>change(d=>d.fuelTank.x=n)} oncommit={commit} hint={t("位置范围随容量和机身空间调整，油箱整体始终位于机身内部。")}/>
 {:else}<p class="help">{t("未安装引擎，油箱已自动取消。")}</p>{/if}
 {:else if tab==='组装'}
 <div class="assembly-positions" aria-label={t("组装位置精确值")}>
 {#each assemblyPositions as position}<label><span>{t(position.label)}</span><input aria-label={t("{p0}精确值",{p0:t(position.label)})} type="number" min={position.min} max={position.max} step="0.1" value={position.value} onchange={e=>setPosition(position.key,e.currentTarget)}/><small>m</small></label>{/each}
 </div>
 <Parameter label={t("主翼安装高度")} value={aircraft.assembly.mainWingHeight} min={-0.5} max={1} step={0.01} unit="m" onchange={n=>change(d=>d.assembly.mainWingHeight=n)} oncommit={commit} hint={t("0 m 直接安装机身；正值在上、负值在下。离开机身自动生成根弦宽支撑，面积越大越重；拖动时 Ctrl 可绕过吸附。")}/>
 <Parameter label={t("主翼安装角")} value={aircraft.assembly.mainIncidence} min={-10} max={18} unit="°" onchange={n=>change(d=>d.assembly.mainIncidence=n)} oncommit={commit} hint={t("提高安装角会增加有效攻角；过大可能失速。")}/>
 <Parameter label={t("水平尾翼安装角")} value={aircraft.assembly.tailIncidence} min={-12} max={12} unit="°" onchange={n=>change(d=>d.assembly.tailIncidence=n)} oncommit={commit} hint={t("调节尾翼安装角以配平，观察离台后攻角与俯仰变化。")}/>
 {:else}
 {#key wingKey}<WingEditor value={aircraft[wingKey]} vertical={tab==='垂直尾翼'} onchange={(w:Wing)=>change(d=>d[wingKey]=w)} oncommit={commit}/>{/key}
 {#if tab==='主翼'}<Parameter label={t("主翼上反角")} value={aircraft.mainWing.dihedral} min={0} max={25} unit="°" onchange={n=>change(d=>d.mainWing.dihedral=n)} oncommit={commit} hint={t("增加侧滑时的滚转恢复效应，不会强制飞机自动水平。")}/>{/if}
 {#if !aircraft.birdman||tab==='垂直尾翼'}<Parameter label={tab==='主翼'?t("副翼弦长比例"):tab==='水平尾翼'?t("升降舵弦长比例"):t("方向舵弦长比例")} value={aircraft[wingKey].controlSurface} min={0.1} max={1} step={0.05} onchange={n=>change(d=>d[wingKey].controlSurface=n)} oncommit={commit} hint={tab==='垂直尾翼'?t("1 为全动垂尾。"):t("控制面占翼面弦长的比例。")}/>{/if}
 {/if}
 <div class="preset"><label for="preset">{t("预设设计")}</label><select id="preset" aria-label={t("预设飞机")} onchange={e=>{const n=+e.currentTarget.value;if(n>=0){replace(presets[n]);selectedId='';}}}><option value="-1">{t("选择预设飞机")}</option>{#each presets as p,i}<option value={i}>{t(p.name)}</option>{/each}</select></div>
 </div><div class="editor-footer"><span>{t(challengeDefinitions[challenge].name)}</span><button class="primary" onclick={()=>start()}>{t("前往挑战")} <span>↗</span></button></div></aside>
 <div class="viewport-tools" aria-label={t("设计相机")}>{#each ['轨道','俯视','侧视','正视','后视'] as c}<button disabled={tab!=='机身'&&tab!=='动力'&&c!==(tab==='垂直尾翼'||tab==='组装'?'侧视':'俯视')} onclick={()=>scene.cameraView(c)}>{t(c)}</button>{/each}</div>
 <section class="design-instruments" aria-label={t("设计实时仪表")}>
 <section class="design-metrics" aria-label={t("飞机性能估算")}>
 <div><small>{t("主翼面积")}</small><strong>{main.area.toFixed(2)} <em>m²</em></strong></div><div><small>{t("翼展 / 展弦比")}</small><strong>{main.span.toFixed(1)} <em>m / {main.aspect.toFixed(1)}</em></strong></div><div><small>{t("全备质量 · 驾驶员")} {PILOT_MASS} kg</small><strong><output aria-label={t("全备质量")}>{stats.mass.toFixed(1)}</output> <em>kg</em></strong><small>{t("支撑")} <output aria-label={t("主翼支撑面积")}>{support.area.toFixed(2)}</output> m² · <output aria-label={t("主翼支撑质量")}>{support.mass.toFixed(2)}</output> kg</small></div><div><small>{t("翼载荷")}</small><strong>{stats.wingLoading.toFixed(2)} <em>kg/m²</em></strong></div><div title={t("自由空气、无地效的设计估算；飞行时随离水高度变化")}><small>{t("自由空气最佳滑翔比")}</small><strong>{stats.glideRatio.toFixed(1)} <em>: 1</em></strong></div><div title={t("全重、主翼面积、海平面、无地效")}><small>{t("估算失速速度")}</small><strong><output aria-label={t("估算失速速度")}>{stats.stallSpeed.toFixed(1)}</output> <em>m/s</em></strong></div>
 </section>
 <section class="stability" aria-label={t("重心与升力中心配平参考")}>
 <div class="scene-hint"><span><i class="cg"></i> {t("重心 CG")} <output aria-label={t("重心X")}>{stats.cg.x.toFixed(2)}</output> m</span><span><i class="lift"></i> {t("全机升力中心")} <output aria-label={t("全机升力中心X")}>{stats.aerodynamics.liftCenter?stats.aerodynamics.liftCenter.x.toFixed(2)+' m':t("无合力")}</output></span><span><i class="drag"></i> {t("全机阻力中心")} <output aria-label={t("全机阻力中心X")}>{stats.aerodynamics.dragCenter?stats.aerodynamics.dragCenter.x.toFixed(2)+' m':t("无合力")}</output></span></div>
 {#if thrustCenter}<div class="scene-hint thrust-readout"><span><i class="thrust"></i>{t('推力中心')} <output aria-label={t('推力中心X')}>{thrustCenter.x.toFixed(2)}</output> / <output aria-label={t('推力中心Y')}>{thrustCenter.y.toFixed(2)}</output> / <output aria-label={t('推力中心Z')}>{thrustCenter.z.toFixed(2)}</output> m · {t('方向 +X')}</span></div>{/if}
 <div class="trim-values"><span>{t("静稳定裕度")} <output aria-label={t("静稳定裕度")}>{(stats.staticMargin*100).toFixed(1)}% MAC</output></span><span>{t("中性点 X")} {stats.neutralPoint.toFixed(2)} m</span><span>CG {((stats.mainQuarterChord.x+main.chord*0.25-stats.cg.x)/main.chord*100).toFixed(1)}% MAC</span><span>MAC {main.chord.toFixed(2)} m</span></div>
 <p class="trim-advice">{stats.staticMargin<0?t("重心偏后，可能俯仰失稳。"):stats.staticMargin>0.35?t("重心偏前，可能难以抬头。"):t("正稳定裕度不代表已配平。")} {t("建议 5–20% MAC；合力中心不表示力矩为零。")}</p>
 {#if fuelCenters}<p class="fuel-cg-range" aria-label={t("燃油重心范围")}>{t("燃油重心范围 · 满油 X")} <output aria-label={t("满油重心X")}>{fuelCenters.full.x.toFixed(4)}</output> {t("m · 空油 X")} <output aria-label={t("空油重心X")}>{fuelCenters.empty.x.toFixed(4)}</output> m <small>{t("三维连线标出满油圆点与空油菱形；空油仍保留油箱质量。")}</small></p>{/if}
 </section>
 <section class="aero-preview" aria-label={t("三翼气动力预览")}>
 <div class="aero-heading"><h2>{t("三翼气动力预览")}</h2><p>{t("自由空气 · 无地效 · 空速")} {stats.aerodynamics.speed.toFixed(0)} {t("m/s · 机身攻角")} {(stats.aerodynamics.alpha*180/Math.PI).toFixed(0)}{t("° · 侧滑")} {(stats.aerodynamics.beta*180/Math.PI).toFixed(0)}{t("° · 无操纵")}</p></div>
 <table><thead><tr><th scope="col">{t("翼面 / 几何")}</th><th scope="col">{t("有效攻角")}</th><th scope="col">{t("升 / 侧向力")}</th><th scope="col">{t("阻力")}</th><th scope="col">{t("俯仰 / 偏航矩")}</th></tr></thead><tbody>{#each stats.aerodynamics.wings as wing}{@const geometry=planform(aircraft[wing.kind==='vertical'?'verticalTail':wing.name==='主翼'?'mainWing':'horizontalTail'],wing.kind!=='vertical')}<tr class="aero-wing" aria-label={t("{p0}气动作用",{p0:t(wing.name)})}><th scope="row">{t(wing.name)}<small>{geometry.area.toFixed(2)} m² · {geometry.span.toFixed(1)} m · AR {geometry.aspect.toFixed(1)}</small></th><td><output aria-label={t("{p0}有效攻角",{p0:t(wing.name)})}>{(wing.alpha*180/Math.PI).toFixed(1)}</output>°</td><td><output aria-label={t("{p0}{p1}",{p0:t(wing.name),p1:wing.kind==='vertical'?t("侧向力"):t("升力")})}>{(wing.kind==='vertical'?wing.lift.z:wing.lift.y).toFixed(1)}</output> N</td><td><output aria-label={t("{p0}阻力",{p0:t(wing.name)})}>{wing.drag.length().toFixed(1)}</output> N</td><td><output aria-label={t("{p0}{p1}",{p0:t(wing.name),p1:wing.kind==='vertical'?t("偏航力矩"):t("俯仰力矩")})}>{(wing.kind==='vertical'?wing.torque.y:wing.torque.z).toFixed(1)}</output> N·m</td></tr>{/each}</tbody></table>
 </section>
 </section>
 {:else if screen==='flight'}
 {#if !flightReady}<div class="launch-action"><button class="primary launch-start flight-start" onclick={beginFlight}>{t("开始试飞")}<svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 5 7 7-7 7"/></svg></button><p>{t("空格开始 / 暂停 / 继续")}</p></div>{/if}
 {#if flightCamera==='驾驶员'}
 <svg class="pilot-hud" style={pilotHudStyle} viewBox="0 0 600 400" aria-label="HUD" role="img">
 <title>{t("飞行数据")}</title>
 <defs><clipPath id="hud-attitude"><rect x="180" y="75" width="240" height="250"/></clipPath></defs>
 <g clip-path="url(#hud-attitude)"><g transform={`translate(300 200) rotate(${-hud.roll})`}>
 {#each [-60,-50,-40,-30,-20,-10,0,10,20,30,40,50,60] as angle}
 <g transform={`translate(0 ${(hud.pitch-angle)*4})`} stroke-dasharray={angle<0?'6 4':undefined}>
 <path d={angle===0?'M -110 0 H -25 M 25 0 H 110':'M -65 5 V 0 H -25 M 25 0 H 65 V 5'}/>
 <text x="-88" y="4">{angle}</text><text x="80" y="4">{angle}</text>
 </g>{/each}</g></g>
 <path d="M 265 200 H 288 L 300 208 L 312 200 H 335 M 300 185 V 193 M 285 62 L 300 72 L 315 62"/>
 <text x="78" y="175">{t("空速")} m/s</text><text class="hud-value" x="78" y="205">{hud.speed.toFixed(1)}</text>
 <text x="520" y="175">{t("高度")} m</text><text class="hud-value" x="520" y="205">{hud.altitude.toFixed(0)}</text>
 <text x="300" y="352">{t("离地高度")} {(hud.groundClearance??0).toFixed(1)} m · {t("下降率")} {hud.sink.toFixed(1)} m/s</text>
 {#if hud.stall}<text x="300" y="110">{t("攻角过大 · 失速")}</text>{/if}
 </svg>{/if}
 <div class="flight-sidebar">
 <section class="flight-hud" class:compact-hud={lastChallenge!=='birdman'} aria-label={t("飞行数据")}>
 {#if lastChallenge==='birdman'}<div><small>{t("滑翔距离")}</small><strong>{hud.distance.toFixed(1)}<em>m</em></strong></div>{/if}
 <div><small>{t("空速")}</small><strong>{hud.speed.toFixed(1)}<em>m/s</em></strong></div>
 {#if lastChallenge==='downhill'}
 <div><small>{t("下降率")}</small><strong>{hud.sink.toFixed(1)}<em>m/s</em></strong></div>
 {:else if lastChallenge==='low-altitude'}
 <div><small>{t("离地高度")}</small><strong>{(hud.groundClearance??0).toFixed(1)}<em>m</em></strong></div><div><small>{t("剩余燃料")}</small><strong>{(hud.fuelRemaining??0).toFixed(2)}<em>L</em></strong></div>
 {:else}
 <div><small>{t("高度")}</small><strong>{hud.altitude.toFixed(1)}<em>m</em></strong></div><div><small>{t("总计时")}</small><strong>{hud.time.toFixed(1)}<em>s</em></strong></div><div><small>{t("实时攻角")}</small><strong>{hud.alpha.toFixed(1)}<em>°</em></strong></div><div><small>{t("实时升阻比")}</small><strong>{Number.isFinite(hud.liftDragRatio)?hud.liftDragRatio.toFixed(1):'—'}<em>:1</em></strong></div>
 <div title={t("真实耗散功率除以世界水平速度；助跑或水平速度不超过0.05 m/s时无定义")}><small>{t("实时能耗")}</small><strong><output aria-label={t("实时能耗")}>{hud.energyPerDistance!=null&&Number.isFinite(hud.energyPerDistance)?hud.energyPerDistance.toFixed(1):'—'}</output><em>J/m</em></strong></div>
 {/if}
 </section>
 <div class="flight-status"><span>{t(challengeDefinitions[lastChallenge].name)} · {!flightReady?t("待开始"):hud.launching?(lastChallenge==='low-altitude'?t("跑道滑跑"):t("弹射助跑")):t("飞行中")}</span><span>{lastChallenge==='birdman'?t("湖面最远距离"):!hud.timingStarted?(lastChallenge==='low-altitude'?t("通过出发门后开始计时与计分"):t("通过出发门后开始计时")):t("赛道进度 {p0}% · 依次穿过航线检查点",{p0:(100*(hud.challengeProgress??0)).toFixed(0)})}</span>{#if hud.stall}<b>{t("攻角过大 · 失速")}</b>{/if}</div>
 {#if lastChallenge==='low-altitude'}<section class="challenge-hud" class:over-height={(hud.groundClearance??0)>LOW_ALTITUDE.scoringHeight} aria-label={t("贴地挑战数据")}><span>{t("离地")} <strong>{(hud.groundClearance??0).toFixed(1)} m / {LOW_ALTITUDE.scoringHeight} m</strong></span><span>{t("得分")} <strong>{(hud.score??0).toFixed(0)}</strong></span><span>{t("连续超高")} <strong>{(hud.aboveHeightTime??0).toFixed(1)} s</strong></span>{#if (hud.groundClearance??0)>LOW_ALTITUDE.scoringHeight}<b role="status">{t("超出计分高度 · 降低高度")}</b>{/if}</section>{/if}
 {#if lastDefinition.engine.count}<section class="engine-hud" aria-label={t("引擎数据")}><label>{t("油门 · 1 增 / 2 减")} <output>{((isReplay?hud.throttle??0:throttle)*100).toFixed(0)}%</output><input aria-label={t("油门")} disabled={isReplay} type="range" min="0" max="1" step="0.01" bind:value={throttle}/></label><p>{t("转速")} {((hud.engineRpm??0)*100).toFixed(0)}{t("% · 推力")} {(hud.thrust??0).toFixed(0)} {t("N · 余油")} {(hud.fuelRemaining??0).toFixed(2)} L</p></section>{/if}
 <div class="flight-tools"><span class="keyboard-hint">X · {t("虚拟操纵杆")} / R · {t("再试一次")} / Esc · {t("设计")}</span>{#if flightReady}<button title={t("空格开始 / 暂停 / 继续")} onclick={togglePause}>{paused?t("继续飞行"):t("暂停")}</button>{/if}<select aria-label={t("飞行相机")} title={t("C 键切换视角")} bind:value={flightCamera} onchange={e=>scene.cameraView(e.currentTarget.value)}>{#each flightViews as c}<option value={c}>{t(c)}</option>{/each}</select><button onclick={design}>{t("返回设计")}</button></div>
 {#if paused}<div class="pause-banner">{t("飞行已暂停")} <button onclick={()=>paused=false}>{t("继续")}</button></div>{/if}
 <div class="flight-right">{@render aeroWindow()}</div>
 {#if lastChallenge==='birdman'}<div class="flight-instruments">{@render energyPanel()}{@render altitudeCurve()}</div>{/if}
 <details class="advanced-hud"><summary>{t("姿态与结构 ·")} {(hud.fractureCount??0)>0?t("已断裂 {p0} 次",{p0:hud.fractureCount}):t("结构完整")} {t("· 极限")} {((hud.maxStressRatio??0)*100).toFixed(0)}%</summary><div class="structure-status" aria-label={t("结构载荷与断裂状态")}><p>{t("结构极限利用率")} <output aria-label={t("结构极限利用率")}>{((hud.maxStressRatio??0)*100).toFixed(1)}%</output> {t("· 弹性限利用率")} {((hud.maxYieldRatio??0)*100).toFixed(1)}%</p>{#each hud.wings??[] as wing}<p class="wing-structure" data-wing={wing.key}><strong>{t(wing.name)}</strong> · {t('结构极限')} <output aria-label={t('{name}结构极限利用率',{name:t(wing.name)})}>{(wing.stress*100).toFixed(1)}%</output> · {t('弹性限')} {(wing.yieldRatio*100).toFixed(1)}% · {t('连接 {attached} 段 / 脱离 {detached} 段',{attached:wing.attached,detached:wing.detached})}</p>{/each}<p>{t("最大形变")} <output aria-label={t("最大结构形变")}>{((hud.maxDeflection??0)*1000).toFixed(1)}</output> {t("mm · 独立断片")} <output aria-label={t("独立断片数量")}>{hud.fragmentCount??0}</output> {t("片")}</p>{#if (hud.fractureCount??0)>0}<p role="status"><strong>{t("承力梁已断裂")} {hud.fractureCount} {t("次。")}</strong>{t("主体继续飞行；断片独立运动，断片落地不结束主体。")}</p>{:else if (hud.maxStressRatio??0)>=0.8}<p role="status"><strong>{t("接近结构极限，减小载荷。")}</strong></p>{/if}{#if (hud.maxYieldRatio??0)>1}<p>{t("超过等效弹性限。当前仍为线弹性近似，不模拟塑性或真实颤振。")}</p>{/if}</div></details>
 </div>
 <section class="stick-panel" class:controls-disabled={!flightReady} aria-label={t("杆量与配平")}>
 <div class="stick-heading"><strong>{t("杆量与配平")}</strong>{#if isReplay}<span>{t("飞行重放")}</span>{:else}<span>W/S · A/D · X</span>{/if}</div>
 <div class="stick-main">
 <div class="stick-input">
 <button class="stick-pad" aria-label={t("操纵杆")} title={t("拖动控制俯仰与滚转")} disabled={flightInputDisabled} onpointerdown={beginStick} onpointermove={e=>{if(stickPointer===e.pointerId)moveStick(e);}} onpointerup={releaseStick} onpointercancel={releaseStick} onlostpointercapture={releaseStick}>
 <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="stick-rim" cx="60" cy="60" r="56"/><path class="stick-cross" d="M 60 8 V 112 M 8 60 H 112"/><circle class="stick-limit" cx="60" cy="60" r={50*(lastDefinition.birdman?1:hud.controlLimit??1)}/><path class="stick-trim-marker" d={`M ${60+displayedRoll*35-4} ${60-displayedPitch*35} h 8 M ${60+displayedRoll*35} ${60-displayedPitch*35-4} v 8`}/><circle class="stick-position" cx={60+actualRoll*35} cy={60-actualPitch*35} r="6" data-pitch={actualPitch} data-roll={actualRoll}/></svg>
 </button>
 <div class="yaw-controls"><button aria-label={t("左偏航")} disabled={flightInputDisabled} onpointerdown={e=>beginYaw(e,-1)} onpointerup={releaseYaw} onpointercancel={releaseYaw} onlostpointercapture={releaseYaw} onkeydown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();yawInput=-1;}}} onkeyup={()=>yawInput=0} onblur={()=>yawInput=0}>Q</button><span>{t("偏航")}</span><button aria-label={t("右偏航")} disabled={flightInputDisabled} onpointerdown={e=>beginYaw(e,1)} onpointerup={releaseYaw} onpointercancel={releaseYaw} onlostpointercapture={releaseYaw} onkeydown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();yawInput=1;}}} onkeyup={()=>yawInput=0} onblur={()=>yawInput=0}>E</button></div>
 </div>
 {@render trimControls()}
 </div>
 <div class="flight-assists"><button class="toggle-switch" role="switch" aria-label={t("自动升降舵配平（T）")} aria-checked={isReplay?hud.autoTrim??false:autoTrim} disabled={lastDefinition.birdman||!flightReady||isReplay} onclick={toggleAutoTrim}><span>{t("自动升降舵配平")}</span><kbd>T</kbd></button><button class="toggle-switch" role="switch" aria-label={t("自适应杆量（Y）")} aria-checked={isReplay?hud.adaptiveControls??false:adaptiveControls} disabled={!flightReady||isReplay} onclick={toggleAdaptiveControls}><span>{t("自适应杆量")}</span><kbd>Y</kbd></button></div>
 </section>
 {#if flightReady}<p class="flight-keyboard-hints">{t("W / S 俯仰 · A / D 滚转 · Q / E 偏航 · X 鼠标操纵 · C 镜头 · Space 开始/暂停")}</p>{/if}

 {:else if screen==='result'&&result}
 <section class="results" class:race-results={lastChallenge!=='birdman'} aria-label={t("飞行结算")}>
 <div class="result-heading"><h1>{lastChallenge==='birdman'?t("本次滑翔成绩"):result.completed?t("挑战完成"):t("挑战未完成")}</h1><span>{t(challengeDefinitions[lastChallenge].name)} · {isReplay?t("飞行重放"):t("挑战成绩")}</span></div>
 <div class="score">{(lastChallenge==='birdman'?result.distance:lastChallenge==='downhill'?result.time:result.score).toFixed(2)}<small>{lastChallenge==='birdman'?'m':lastChallenge==='downhill'?'s':t("分")}</small></div>
 <p class="best">{t("个人最佳")} {best?best.toFixed(2):t("暂无")} {lastChallenge==='birdman'?'m':lastChallenge==='downhill'?'s':t("分")} · {result.completed?t("到达终点"):lastChallenge!=='birdman'?t("未通过全部检查点或碰撞地形"):result.landing==='water'?t("接触湖面"):t("达到飞行边界")}</p>
 <dl class="result-statistics"><div><dt>{t("总计时")}{lastChallenge==='birdman'?t("（含助跑）"):''}</dt><dd>{result.time.toFixed(2)} s</dd></div><div><dt>{t("平均速度")}</dt><dd>{result.averageSpeed.toFixed(2)} m/s</dd></div><div><dt>{t("最高速度")}</dt><dd>{result.maxSpeed.toFixed(2)} m/s</dd></div><div><dt>{t("最低速度")}</dt><dd>{result.minSpeed.toFixed(2)} m/s</dd></div><div><dt>{t("最大高度")}</dt><dd>{result.maxHeight.toFixed(2)} m</dd></div><div><dt>{t("输入记录")}</dt><dd>{recordedLength} {t("步 · 60 Hz")}</dd></div></dl>
 {#if lastChallenge==='low-altitude'}<p class="result-scoring" title={result.checkpointScores.map((score:number,index:number)=>`${index+1}: ${score.toFixed(0)}`).join(' · ')}>{t("低空分")} {result.checkpointScores.reduce((sum:number,score:number)=>sum+score,0).toFixed(0)} · {t("速度分")} {result.speedScore.toFixed(0)} · {t("超高扣分")} {result.heightPenalty.toFixed(0)}<small aria-label={t("逐门得分")}>{#each result.checkpointScores as score,index}<span title={`${index+1}`}>{score.toFixed(0)}</span>{/each}</small></p>{/if}
 <p class="result-structure" aria-label={t("最终结构状态")}>{t("结构断裂")} {hud.fractureCount??0} {t("次 · 独立断片")} {hud.fragmentCount??0} {t("片 · 最终结构极限利用率")} {((hud.maxStressRatio??0)*100).toFixed(1)}%</p>
 <section class="wing-peaks" aria-label={t("本次飞行翼面峰值")}><h2>{t("本次飞行翼面峰值")}</h2>{#each hud.peakWings??[] as wing}<p data-wing={wing.key}><strong>{t(wing.name)}</strong><span>{t("结构极限")} <output>{(wing.stress*100).toFixed(1)}%</output> · {t("弹性限")} {(wing.yieldRatio*100).toFixed(1)}%</span></p>{/each}</section>
 <div class="result-instruments">{@render altitudeCurve()}</div><div class="result-actions"><button class="primary" onclick={design}>{t("返回设计改进")}</button><button onclick={()=>start()}>{t("再试一次")}</button><button onclick={()=>start(true)}>{t("重放飞行")}</button><button disabled={replayBusy||!recording?.length} onclick={replayExport}>{t("导出回放")}</button></div>
 </section>
 {/if}
 {#if showLibrary&&screen==='design'}<section class="library" aria-label={t("本地机库")}><div class="library-title"><h2>{t("本地机库 ·")} {saved.length} {t("架")}</h2><button onclick={()=>showLibrary=false}>{t("关闭")}</button></div><p>{t("飞机保存在当前浏览器。同名保存需确认覆盖，新名字新增记录。各架飞机可导出 JSON 备份或分享。")}</p><div class="library-actions"><label class="button">{t("导入 JSON")}<input aria-label={t("导入飞机文件")} type="file" accept=".json,application/json" onchange={fileImport}/></label></div>{#if !saved.length}<p class="empty">{t("机库还没有飞机。先保存你的第一个设计。")}</p>{/if}{#each saved as s}<article class="saved-plane"><input aria-label={t("重命名{p0}",{p0:s.name})} value={s.name} maxlength="60" onchange={e=>renameSaved(s.id,e.currentTarget.value)}/><small>{new Date(s.updatedAt).toLocaleString($language)}{selectedId===s.id?t(" · 当前飞机"):''}</small><div><button class="load-plane" onclick={()=>load(s.id)}>{t("加载")}</button><button onclick={()=>{try{duplicateAircraft(s.id);saved=listAircraft();}catch(e){notify((e as Error).message);}}}>{t("复制")}</button><button onclick={()=>fileExport(s.id)}>{t("导出")}</button><button class="delete-plane" onclick={()=>{if(confirm(t('删除“{name}”？此操作不可撤销。',{name:s.name}))){try{deleteAircraft(s.id);saved=listAircraft();if(selectedId===s.id)selectedId='';}catch(e){notify((e as Error).message);}}}}>{t("删除")}</button></div></article>{/each}</section>{/if}
 {#if debug}<aside class="performance" aria-label={t("开发性能面板")}><h2>{t("性能实测")} <button onclick={()=>debug=false}>{t("关闭")}</button></h2><p>{t(qualityNames[perf.quality]??perf.quality??'')} · {Number(perf.fps||0).toFixed(1)} FPS</p><p>{t("平均")} {Number(perf.mean||0).toFixed(2)} ms · P95 {Number(perf.p95||0).toFixed(2)} ms · P99 {Number(perf.p99||0).toFixed(2)} ms</p><p>{t("物理")} {Number(perf.physicsMs||0).toFixed(3)} {t("ms · 渲染提交")} {Number(perf.renderMs||0).toFixed(2)} ms</p><p>{t("几何")} {Number(perf.geometryMs||0).toFixed(2)} ms · {perf.drawCalls||0} {t('绘制调用')} · {perf.triangles||0} {t('三角形')}</p><p>{t("几何与纹理估算")} {typeof perf.memory==='number'?perf.memory.toFixed(2)+' MiB':t("不可用")}</p><small>{t("帧率来自当前环境，不代表真实手机性能。")}</small></aside>{/if}
 {#if message}<div class="toast" role="status">{t(message)}<button aria-label={t("关闭提示")} onclick={()=>message=''}>{t("关闭")}</button></div>{/if}
</div>

{#if stick&&screen==='flight'}<div class="joystick" aria-label={t("虚拟操纵杆")}><div class="stick-deadzone"></div><div class="stick-knob" style:left={`${50+stickX*50}%`} style:top={`${50-stickY*50}%`}></div></div>{/if}
