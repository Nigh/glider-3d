<script lang="ts">
 import { onMount } from 'svelte';
 import { defaultAircraft, presets, clone, clamp, planform, validateAircraft, fuselageEnds, resizeFuselage, mainWingMountLimits, mainWingSupport, PILOT_MASS, type AircraftDefinition, type Controls, type FlightMode, type Wing } from './model';
 import { FlightSimulation, derive, LAUNCH } from './physics';
 import { challengeDefinitions, type ChallengeMode } from './challenges';
 import { SceneView } from './scene';
 import { listAircraft, saveAircraft, deleteAircraft, renameAircraft, duplicateAircraft, exportAircraft, importAircraft, readBest, writeBest, History, type SavedAircraft } from './storage';
 import WingEditor from './WingEditor.svelte'; import Parameter from './Parameter.svelte';
 import { GameAudio } from './audio';
 import AudioSettings from './AudioSettings.svelte';
 let audioError=$state('');
 const audio=new GameAudio(message=>audioError=message);
 function syncAudio(){audio.update({screen,ready:flightReady,paused:screen==='flight'&&paused,hidden:document.hidden,speed:simulation?.telemetry.speed??0,launching:simulation?.launching??false});}
 $effect(()=>{screen;flightReady;paused;if(sceneReady)syncAudio();});
 type Tab='机身'|'主翼'|'水平尾翼'|'垂直尾翼'|'组装';
 let host:HTMLDivElement;let scene:SceneView;let sceneReady=$state(false);let simulation:FlightSimulation|null=null;let history=new History(clone(defaultAircraft));let historyVersion=$state(0);
 let aircraft=$state.raw<AircraftDefinition>(clone(defaultAircraft));let tab=$state<Tab>('主翼');let screen=$state<'menu'|'design'|'flight'|'result'>('menu');let mode=$state<FlightMode>('standard');let quality=$state<'Auto'|'High'|'Medium'|'Low'>('Auto');
 let challenge=$state<ChallengeMode>('birdman'),lastChallenge=$state<ChallengeMode>('birdman');
 let saved=$state.raw<SavedAircraft[]>([]),selectedId=$state(''),message=$state(''),showLibrary=$state(false),debug=$state(false),paused=$state(false),flightReady=$state(false);let best=$state(0);let result=$state<any>(null),hud=$state<any>({speed:0,altitude:LAUNCH.height,distance:0,alpha:0,pitch:0,roll:0,sink:0,glide:0,time:0,liftDragRatio:0,potentialEnergy:0,kineticEnergy:0,dissipatedEnergy:0,initialEnergy:0,launching:true});let perf=$state<any>({});
 let stats=$derived(derive(aircraft));let main=$derived(planform(aircraft.mainWing));let wingKey=$derived<'mainWing'|'horizontalTail'|'verticalTail'>(tab==='水平尾翼'?'horizontalTail':tab==='垂直尾翼'?'verticalTail':'mainWing');
 let ends=$derived(fuselageEnds(aircraft));
 let cockpitMin=$derived(Math.max(-3,ends.tail)),cockpitMax=$derived(Math.min(4,ends.nose-0.95));
 let tailMin=$derived(Math.max(-6,ends.tail)),tailMax=$derived(Math.min(5,ends.nose));
 let mainMountLimits=$derived(mainWingMountLimits(aircraft)),support=$derived(mainWingSupport(aircraft));
 let recording:ReturnType<FlightSimulation['getRecording']>|null=null;let recordedLength=$state(0);let isReplay=$state(false);let lastDefinition=$state.raw(clone(defaultAircraft)),lastMode=$state<FlightMode>('standard');
 let weight=$state(0),lateral=$state(0),rudder=$state(0),elevator=$state(0),aileron=$state(0);const keys=new Set<string>();const controls:Controls={weight:0,lateral:0,rudder:0,elevator:0,aileron:0};
 const flightViews=['追尾','侧面','驾驶员','自由'];
 let flightCamera=$state('追尾');
 let messageTimeout:ReturnType<typeof setTimeout>;
 type FlightSample={distance:number;height:number;energyRatio:number;energyPerDistance:number|null};
 let samples:FlightSample[]=[],lastSampleTime=-Infinity;
 let trajectory=$state.raw<FlightSample[]>([]);
 let chartMaxDistance=$derived(trajectory.reduce<number>((max,p)=>Math.max(max,p.distance),1));
 let chartMaxHeight=$derived(trajectory.reduce<number>((max,p)=>Math.max(max,p.height),LAUNCH.height));
 let chartPoints=$derived(trajectory.map(p=>`${(38+p.distance/chartMaxDistance*290).toFixed(2)},${(98-p.height/chartMaxHeight*76).toFixed(2)}`).join(' '));
 let energyCurvePoints=$derived(screen==='result'?trajectory.map(p=>`${(38+p.distance/chartMaxDistance*290).toFixed(2)},${(98-p.energyRatio*76).toFixed(2)}`).join(' '):'');
 let chartMaxCost=$derived(trajectory.reduce<number>((max,p)=>Math.max(max,p.energyPerDistance??0),1));
 let costCurvePath=$derived(screen==='result'?trajectory.map((p,i)=>p.energyPerDistance===null?'':`${i===0||trajectory[i-1].energyPerDistance===null?'M':'L'}${(38+p.distance/chartMaxDistance*290).toFixed(2)},${(98-p.energyPerDistance/chartMaxCost*76).toFixed(2)}`).join(' '):'');
 let energyParts=$derived([{key:'potential',name:'势能',value:hud.potentialEnergy},{key:'kinetic',name:'动能',value:hud.kineticEnergy},{key:'dissipated',name:'已耗散',value:hud.dissipatedEnergy}]);
 let energyTotal=$derived(hud.potentialEnergy+hud.kineticEnergy+hud.dissipatedEnergy);
 let assemblyPositions=$derived([{key:'mainWing',label:'主翼纵向位置',value:aircraft.assembly.mainWing,min:mainMountLimits.min,max:mainMountLimits.max},{key:'horizontalTail',label:'水平尾翼位置',value:aircraft.assembly.horizontalTail,min:tailMin,max:tailMax},{key:'verticalTail',label:'垂直尾翼位置',value:aircraft.assembly.verticalTail,min:tailMin,max:tailMax},{key:'cockpit',label:'驾驶舱位置',value:aircraft.cockpit.position,min:cockpitMin,max:cockpitMax}] as const);
 function setPosition(key:typeof assemblyPositions[number]['key'],input:HTMLInputElement){const n=input.valueAsNumber,position=assemblyPositions.find(p=>p.key===key)!;if(Number.isFinite(n)){const supported=clamp(n,position.min,position.max);change(d=>{if(key==='cockpit')d.cockpit.position=supported;else d.assembly[key]=supported;});if(n!==supported)notify('已限制在机身支撑范围内；可先延长机头或机尾。');commit();}else notify('位置必须是有限数值');input.value=String(key==='cockpit'?aircraft.cockpit.position:aircraft.assembly[key]);}
 function setEnd(end:'nose'|'tail',input:HTMLInputElement){const n=input.valueAsNumber;if(Number.isFinite(n)){change(d=>resizeFuselage(d,end,n));commit();if(Math.abs(fuselageEnds(aircraft)[end]-n)>1e-6)notify('端点受 3–12 m 机身长度、驾驶舱和尾翼支撑限制。');}else notify('端点必须是有限数值');input.value=String(Number(fuselageEnds(aircraft)[end].toFixed(6)));}
 $effect(()=>{const target=screen==='design'?(tab==='组装'?'assembly':tab==='机身'?null:wingKey):null;if(sceneReady)scene.setEditor(target,d=>change(out=>Object.assign(out,d)),commit);});
 function sampleFlight(final=false){if(!simulation||simulation.launching)return;if(final||simulation.time-lastSampleTime>=0.1){const t=simulation.telemetry;samples.push({distance:t.distance,height:t.altitude,energyRatio:(t.kineticEnergy+t.potentialEnergy)/t.initialEnergy,energyPerDistance:t.energyPerDistance});lastSampleTime=simulation.time;}}
 function refreshHud(){if(!simulation)return;const t=simulation.telemetry;hud={...t,alpha:t.alpha*180/Math.PI,pitch:t.pitch*180/Math.PI,roll:t.roll*180/Math.PI,time:simulation.time,launching:simulation.launching};}
 function refreshTrajectory(){if(trajectory.length!==samples.length)trajectory=samples.slice();}
 const hints:Record<Tab,string>={'机身':'驾驶舱的位置改变重心。过度靠后可能让飞机俯仰失稳。','主翼':'拖动四个顶点或 1–4 根弦、2–3 梢弦线段。沿屏幕垂直方向轻吸附，按住 Ctrl 取消。增加面积降低翼载荷，但增加重量与阻力。','水平尾翼':'拖动顶点或 1–4 根弦、2–3 梢弦线段。沿屏幕垂直方向轻吸附，按住 Ctrl 取消。增大尾翼或后移安装位置，通常提高俯仰稳定性。','垂直尾翼':'侧视拖动顶点或 1–4 根弦、2–3 梢弦线段。沿屏幕垂直方向轻吸附，按住 Ctrl 取消。垂直尾翼提供偏航恢复力矩，太小容易偏离航向。','组装':'侧视拖动主翼、尾翼或驾驶舱。主翼高度接近机身时吸附至 0 m，按住 Ctrl 绕过吸附。正 X 朝机头；尾翼位置以翼根中心为准。'};
 function notify(s:string,kind:'success'|'error'='error'){audio.ui(kind);clearTimeout(messageTimeout);message=s;messageTimeout=setTimeout(()=>message='',5000);}
 function commit(){try{aircraft=validateAircraft(aircraft);history.push(clone(aircraft));historyVersion++;}catch(e){notify((e as Error).message);}}
 function change(mutator:(d:AircraftDefinition)=>void){const d=clone(aircraft);mutator(d);try{aircraft=validateAircraft(d);scene?.updateAircraft(aircraft);}catch(e){notify((e as Error).message);}}
 function replace(d:AircraftDefinition){try{aircraft=validateAircraft(d);scene?.updateAircraft(aircraft);commit();}catch(e){notify((e as Error).message);}}
 function undo(){const d=history.undo();if(d){aircraft=clone(d);selectedId='';scene?.updateAircraft(aircraft);historyVersion++;}}
 function redo(){const d=history.redo();if(d){aircraft=clone(d);selectedId='';scene?.updateAircraft(aircraft);historyVersion++;}}
 function library(){try{saved=listAircraft();showLibrary=!showLibrary;}catch(e){notify((e as Error).message);}}
 function save(){try{const item=saveAircraft(aircraft,selectedId||undefined);selectedId=item.id;saved=listAircraft();notify('飞机已保存在此浏览器','success');}catch(e){notify((e as Error).message);}}
 function load(id:string){const item=saved.find(s=>s.id===id);if(item){replace(item.definition);selectedId=id;notify('已加载 '+item.name,'success');}}
 function renameSaved(id:string,name:string){try{const item=renameAircraft(id,name);saved=listAircraft();if(selectedId===id){change(d=>d.name=item.name);commit();}}catch(e){notify((e as Error).message);}}
 function fileExport(){const url=URL.createObjectURL(new Blob([exportAircraft(aircraft)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=aircraft.name+'.json';a.click();URL.revokeObjectURL(url);}
 async function fileImport(e:Event){const input=e.target as HTMLInputElement;try{const f=input.files?.[0];if(f){if(f.size>100000)throw Error('文件超过 100 KB');replace(importAircraft(await f.text()));selectedId='';notify('导入成功','success');}}catch(e){notify('导入失败：'+(e as Error).message);}input.value='';}
 function clearControls(){keys.clear();weight=lateral=rudder=elevator=aileron=0;controls.weight=controls.lateral=controls.rudder=controls.elevator=controls.aileron=0;}
 function start(replay=false){try{const definition=replay?lastDefinition:clone(aircraft),selectedChallenge=replay?lastChallenge:challenge;if(selectedChallenge==='birdman'&&!definition.birdman)throw Error('鸟人间挑战仅允许鸟人间飞机参加。');simulation=new FlightSimulation(definition,replay?lastMode:mode,selectedChallenge);lastDefinition=definition;lastMode=replay?lastMode:mode;lastChallenge=selectedChallenge;if(replay&&recording)simulation.loadReplay(recording);samples=[];trajectory=[];lastSampleTime=-Infinity;refreshHud();isReplay=replay;screen='flight';result=null;paused=false;flightReady=false;clearControls();scene.setEditor(null,d=>change(out=>Object.assign(out,d)),commit);scene.setFlight(simulation);scene.setDebug(debug||lastMode==='experimental');flightCamera='追尾';scene.cameraView(flightCamera);}catch(e){notify((e as Error).message);}}
 function beginFlight(){if(screen!=='flight'||!simulation||flightReady)return;clearControls();paused=false;flightReady=true;syncAudio();audio.launch();}
 function togglePause(){if(screen==='flight'&&flightReady)paused=!paused;}
 function finish(){if(!simulation)return;sampleFlight(true);refreshHud();refreshTrajectory();result=simulation.result;recordedLength=simulation.recordingLength;screen='result';if(!isReplay){recording=simulation.getRecording();try{best=readBest(lastMode,lastChallenge);if(lastChallenge==='birdman'||result.completed)best=writeBest(lastMode,lastChallenge==='birdman'?result.distance:result.time,lastChallenge);}catch(e){notify((e as Error).message);}}}
 function design(){screen='design';simulation=null;flightReady=false;scene?.setFlight(null);scene?.updateAircraft(aircraft);scene?.cameraView('轨道');clearControls();}
 function keyboard(e:KeyboardEvent,down:boolean){
 const target=e.target as HTMLElement;
 if(target.closest('input,select,textarea,summary,a,[contenteditable="true"]')||(e.code==='Space'&&target.closest('button')))return;
 if(screen==='flight'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.code==='Space'||e.code==='KeyC')){
 e.preventDefault();
 if(down&&!e.repeat){
 if(e.code==='Space'){if(flightReady)togglePause();else beginFlight();}
 else{flightCamera=flightViews[(flightViews.indexOf(flightCamera)+1)%flightViews.length];scene.cameraView(flightCamera);}
 }
 return;
 }
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))e.preventDefault();
 if(down&&screen==='flight'&&flightReady)keys.add(e.key.toLowerCase());else keys.delete(e.key.toLowerCase());
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
    const running=screen==='flight'&&simulation&&flightReady&&!paused;
    if(running){
      accumulator+=elapsed;
      let steps=0;
      while(accumulator>=fixedDt&&steps<5){
        const pitchInput=(keys.has('arrowup')||keys.has('w')?1:0)-(keys.has('arrowdown')||keys.has('s')?1:0);
        const rollInput=(keys.has('arrowright')||keys.has('d')?1:0)-(keys.has('arrowleft')||keys.has('a')?1:0);
        controls.weight=lastDefinition.birdman?clamp(weight+pitchInput,-1,1):0;
        controls.lateral=lastDefinition.birdman?clamp(lateral+rollInput,-1,1):0;
        controls.rudder=clamp(rudder+(keys.has('e')?1:0)-(keys.has('q')?1:0),-1,1);
        controls.elevator=lastDefinition.birdman?0:clamp(elevator+pitchInput,-1,1);
        controls.aileron=lastDefinition.birdman?0:clamp(aileron+rollInput,-1,1);
        scene.captureFlightState();
         const wasLaunching=simulation!.launching;
         simulation!.step(controls,fixedDt);sampleFlight();
         if(wasLaunching&&!simulation!.launching)audio.release();
        accumulator-=fixedDt;steps++;
        if(simulation!.ended){finish();accumulator=0;break;}
      }
      // 过载时只丢弃整步积压，保留渲染插值所需的小数余量。
      if(accumulator>=fixedDt)accumulator%=fixedDt;
    }else{
      accumulator=0;scene.captureFlightState();
    }
    scene.render(elapsed,running?accumulator/fixedDt:1);
     syncAudio();
    if(screen==='flight')refreshHud();
    if(now-lastInstruments>150){refreshTrajectory();perf={...scene.metrics,physicsMs:simulation?.telemetry.physicsMs??0};lastInstruments=now;}
  }
  request=requestAnimationFrame(tick);
};
request=requestAnimationFrame(tick);
const down=(e:KeyboardEvent)=>keyboard(e,true),up=(e:KeyboardEvent)=>keyboard(e,false),blur=clearControls;window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);
 try{saved=listAircraft();best=readBest(mode);}catch(e){notify((e as Error).message);}
 // Read-only diagnostics for automated measurement; interaction tests still use visible controls.
 Object.assign(window,{glider:{get aircraft(){return clone(aircraft)},get state(){return screen},get flightReady(){return flightReady},get time(){return simulation?.time??0},get recordingLength(){return simulation?.recordingLength??0},get scene(){return scene.getDiagnostics()},get trajectory(){return samples.map(p=>({...p}))},get metrics(){return {...scene.metrics,physicsMs:simulation?.telemetry.physicsMs??0}},get telemetry(){return simulation?.telemetry},get result(){return result}}});
 return()=>{clearTimeout(messageTimeout);cancelAnimationFrame(request);audio.dispose();scene.dispose();document.removeEventListener('pointerdown',unlock,true);document.removeEventListener('keydown',unlock,true);document.removeEventListener('click',click,true);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);};});
 function touch(e:PointerEvent,key:'weight'|'lateral'|'rudder',value:number){if(!flightReady)return;e.currentTarget instanceof HTMLElement&&e.currentTarget.setPointerCapture(e.pointerId);if(key==='weight'){if(lastDefinition.birdman)weight=value;else elevator=value;}else if(key==='lateral'){if(lastDefinition.birdman)lateral=value;else aileron=value;}else rudder=value;}
</script>
<svelte:head><title>飞行挑战 · 设计与驾驶</title></svelte:head>
{#snippet energyPanel()}
 <section class="energy-panel" aria-label="离台能量守恒">
 <div class="instrument-heading"><h2>能量分配</h2><span>{!flightReady?'待开始':hud.launching?'助跑供能中':'离台后总量恒定'}</span></div>
 {#if hud.launching}
 <p class="launch-note">{!flightReady?'点击开始后助跑':'坡道助跑中'}，沿10 m、3.5°坡道加速至 {LAUNCH.speed.toFixed(1)} m/s。滚转扰动在助跑中平滑加入；离台时建立能量基准，助跑外力供能不计入耗散。</p>
 {:else}
 <div class="energy-track" aria-hidden="true">{#each energyParts as part}<span class={part.key} style:width={`${hud.initialEnergy>0?part.value/hud.initialEnergy*100:0}%`}></span>{/each}</div>
 <dl class="energy-values">{#each energyParts as part}<div class={part.key}><dt>{part.name}</dt><dd>{part.value.toFixed(0)} J <small>{(hud.initialEnergy>0?part.value/hud.initialEnergy*100:0).toFixed(1)}%</small></dd></div>{/each}</dl>
 <p class="energy-total">合计 {energyTotal.toFixed(0)} J <span>基准 {hud.initialEnergy.toFixed(0)} J · 100%</span></p>
 <p class="energy-caption">动能含平动与转动；耗散含空气阻力与阻尼损失。</p>
 {/if}
 </section>
{/snippet}
{#snippet altitudeCurve()}
 <section class="trajectory-panel" aria-label="距离高度曲线">
 <div class="instrument-heading"><h2>{screen==='result'?'距离—高度、能量与能耗':'距离—高度'}</h2><span>{trajectory.length?`真实采样 ${trajectory.length} 点`:'离台后开始采样'}</span></div>
 {#if screen==='result'}<div class="chart-legend"><span class="height-key">高度 · 左轴 m</span><span class="energy-key">剩余机械能 · 右轴 %</span><span class="cost-key">实时能耗 · 外右轴 J/m</span></div>{/if}
 <svg viewBox={screen==='result'?'0 0 450 124':'0 0 348 124'} role="img" aria-label={`飞行轨迹，水平距离0至${chartMaxDistance.toFixed(1)}米，高度0至${chartMaxHeight.toFixed(1)}米${screen==='result'?`；剩余机械能为动能与势能之和占离台初始能量的百分比，右轴0至100%；实时能耗外右轴0至${chartMaxCost.toFixed(1)}焦耳每米`:''}`}>
 <line class="chart-grid" x1="38" y1="22" x2="328" y2="22"/><line class="chart-grid" x1="38" y1="60" x2="328" y2="60"/><path class="chart-axis" d="M38 16V98H330"/>
 <text x="2" y="25">{chartMaxHeight.toFixed(1)}</text><text x="23" y="101">0</text><text x="38" y="116">0</text><text x="328" y="116" text-anchor="end">{chartMaxDistance.toFixed(1)} m</text><text x="3" y="12">高度 m</text>
 {#if trajectory.length}{@const last=trajectory[trajectory.length-1]}<polyline class="chart-line" points={chartPoints}/><circle class="chart-current" cx={38+last.distance/chartMaxDistance*290} cy={98-last.height/chartMaxHeight*76} r="3"/>{/if}
 {#if screen==='result'}
 <path class="chart-axis" d="M328 22V98"/><text x="336" y="25">100%</text><text x="336" y="63">50%</text><text x="336" y="101">0%</text>
 <polyline class="chart-energy-line" aria-label="剩余机械能占比曲线" points={energyCurvePoints}/>
 <path class="chart-axis" d="M390 22V98"/><text x="396" y="12">J/m</text><text x="396" y="25">{chartMaxCost.toFixed(1)}</text><text x="396" y="63">{(chartMaxCost/2).toFixed(1)}</text><text x="396" y="101">0</text>
 <path class="chart-cost-line" aria-label="实时能耗曲线" d={costCurvePath}/>
 {/if}
 </svg>
 <p class="chart-caption">离台后每 0.1 s 采样，末点保留实际终止高度。{#if screen==='result'}机械能占比 =（动能 + 势能）/ 离台初始能量，动能含转动。实时能耗 = 耗散功率 / 水平速度；无定义时断线，不记作零。{/if}</p>
 </section>
{/snippet}
<div class="app" class:flying={screen==='flight'} class:designing={screen==='design'} class:awaiting-flight={screen==='flight'&&!flightReady}>
 <div class="scene" bind:this={host} aria-label="三维滑空机与湖面场景"></div>
 <header class="topbar">
  <div class="brand-group">
   <button class="brand" onclick={()=>screen==='flight'?togglePause():screen='menu'} aria-label="返回主菜单"><svg viewBox="0 0 36 28" width="34" height="28" fill="none" aria-hidden="true"><path d="M2 10 33 3 23 13 19 25 14 14 2 10Z" stroke="currentColor" stroke-width="1.7"/><path d="m14 14 19-11" stroke="currentColor"/></svg><span>飞行挑战<small>FLIGHT CHALLENGES</small></span></button>
   <a class="github-link" href="https://github.com/Nigh/glider-3d" target="_blank" rel="noopener noreferrer" aria-label="GitHub 项目源码（新标签页）" title="GitHub 项目源码"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.77c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg></a>
  </div>
  <nav aria-label="游戏流程"><button class:active={screen==='design'} onclick={design}>设计</button><button class:active={screen==='flight'||screen==='result'} onclick={()=>start()}>试飞</button></nav>
  <div class="top-actions">
   <AudioSettings {audio} error={audioError}/>
   <label class="quality-label">画质 <select aria-label="画质" bind:value={quality} onchange={()=>scene?.setQuality(quality)}><option>Auto</option><option>High</option><option>Medium</option><option>Low</option></select></label>
   <button class="text-button" onclick={()=>{debug=!debug;scene?.setDebug(debug);}} aria-pressed={debug}>性能</button>
  </div>
 </header>
 {#if screen==='menu'}
 <main class="welcome"><h1>不同飞机，<br/>不同挑战。</h1><p>设计飞机，选择挑战。<br/>在湖面追逐距离，在高山峡谷争分夺秒。</p><label>选择挑战<select aria-label="菜单挑战" bind:value={challenge}><option value="birdman">鸟人间挑战 · 无动力距离</option><option value="downhill">高山速降 · 山谷竞速</option></select></label><button class="primary large" onclick={design}>开始设计 <span>↗</span></button><button class="secondary" onclick={()=>start()}>试飞当前飞机</button><div class="welcome-note">W / S 俯仰 · A / D 滚转 · Q / E 偏航 · 本地保存</div></main>
 <aside class="menu-caption"><span>湖风 01 / 均衡型</span><p>14.0 m 翼展 <b>·</b> 参数化轻型滑空机</p></aside>
 {:else if screen==='design'}
 <aside class="editor"><div class="editor-heading"><div><h1>飞机工坊</h1><p>每一次调整，都是下一次远航。</p></div><button class="text-button" onclick={library}>机库</button></div><div class="name-row"><input aria-label="飞机名称" value={aircraft.name} maxlength="60" onchange={e=>{change(d=>d.name=e.currentTarget.value);commit();}}/><button onclick={save}>保存</button></div><div class="history"><button disabled={!historyVersion||!history.canUndo} onclick={undo}>撤销</button><button disabled={!historyVersion||!history.canRedo} onclick={redo}>重做</button><button onclick={()=>{replace(defaultAircraft);selectedId='';}}>重置设计</button></div>
 <div class="tabs" role="tablist" aria-label="部件编辑">{#each ['机身','主翼','水平尾翼','垂直尾翼','组装'] as t}<button role="tab" aria-selected={tab===t} class:active={tab===t} onclick={()=>tab=t as Tab}>{t}</button>{/each}</div>
 <div class="editor-content"><h2>{tab==='组装'?'位置与配平':tab+'设计'}</h2><p class="help">{hints[tab]}</p>
 <label class="fixed-parameter"><input aria-label="鸟人间飞机" type="checkbox" checked={aircraft.birdman} onchange={e=>{change(d=>{d.birdman=e.currentTarget.checked;d.mainWing.controlSurface=d.birdman?0:0.25;d.horizontalTail.controlSurface=d.birdman?0:0.35;});commit();}}/> 鸟人间飞机</label><p class="help">{aircraft.birdman?'仅垂尾具有控制面；俯仰与滚转靠驾驶员移动重心。':'主翼副翼与平尾升降舵控制姿态；驾驶员由流线座舱包覆。'}</p>
 {#if tab==='机身'}
 <div class="assembly-positions" aria-label="机身端点精确值">
 <label><span>机头端点</span><input aria-label="机头端点精确值" type="number" min={Math.max(ends.tail+3,aircraft.cockpit.position+0.95,aircraft.assembly.horizontalTail,aircraft.assembly.verticalTail,support.x)} max={ends.tail+12} step="0.1" value={Number(ends.nose.toFixed(6))} onchange={e=>setEnd('nose',e.currentTarget)}/><small>m</small></label>
 <label><span>机尾端点</span><input aria-label="机尾端点精确值" type="number" min={ends.nose-12} max={Math.min(ends.nose-3,aircraft.cockpit.position,aircraft.assembly.horizontalTail,aircraft.assembly.verticalTail,support.x)} step="0.1" value={Number(ends.tail.toFixed(6))} onchange={e=>setEnd('tail',e.currentTarget)}/><small>m</small></label>
 </div><p class="fixed-parameter">机身长度 <output aria-label="机身长度">{aircraft.fuselage.length.toFixed(2)} m</output> · 驾驶员 <output aria-label="固定驾驶员质量">{PILOT_MASS} kg</output></p><p class="help">端点以机身局部 X 为准。移动一端，另一端不动；在组装视图也可直接拖动。驾驶舱及尾翼必须留在机身支撑范围内。</p>
 <div class="parameter"><div class="parameter-head"><label><span>驾驶舱位置</span><input aria-label="驾驶舱位置精确值" type="number" min={cockpitMin} max={cockpitMax} step="0.1" value={aircraft.cockpit.position} onchange={e=>setPosition('cockpit',e.currentTarget)}/><small>m</small></label></div><input aria-label="驾驶舱位置" type="range" min={cockpitMin} max={cockpitMax} step="0.1" value={aircraft.cockpit.position} oninput={e=>change(d=>d.cockpit.position=e.currentTarget.valueAsNumber)} onchange={commit}/><p>正值向机头移动。固定 {PILOT_MASS} kg 驾驶员随驾驶舱改变重心；移动范围保持机身支撑。</p></div>
 {#if aircraft.birdman}<Parameter label="重心前后行程" value={aircraft.controls.travel} min={0.1} max={0.8} step={0.05} unit="m" onchange={n=>change(d=>d.controls.travel=n)} oncommit={commit}/><Parameter label="重心左右行程" value={aircraft.controls.lateralTravel} min={0.01} max={0.2} step={0.01} unit="m" onchange={n=>change(d=>d.controls.lateralTravel=n)} oncommit={commit}/>{/if}
 {:else if tab==='组装'}
 <div class="assembly-positions" aria-label="组装位置精确值">
 {#each assemblyPositions as position}<label><span>{position.label}</span><input aria-label={position.label+'精确值'} type="number" min={position.min} max={position.max} step="0.1" value={position.value} onchange={e=>setPosition(position.key,e.currentTarget)}/><small>m</small></label>{/each}
 </div>
 <Parameter label="主翼安装高度" value={aircraft.assembly.mainWingHeight} min={-0.5} max={1} step={0.01} unit="m" onchange={n=>change(d=>d.assembly.mainWingHeight=n)} oncommit={commit} hint="0 m 直接安装机身；正值在上、负值在下。离开机身自动生成根弦宽支撑，面积越大越重；拖动时 Ctrl 可绕过吸附。"/>
 <Parameter label="主翼安装角" value={aircraft.assembly.mainIncidence} min={-10} max={18} unit="°" onchange={n=>change(d=>d.assembly.mainIncidence=n)} oncommit={commit} hint="提高安装角会增加有效攻角；过大可能失速。"/>
 <Parameter label="水平尾翼安装角" value={aircraft.assembly.tailIncidence} min={-12} max={12} unit="°" onchange={n=>change(d=>d.assembly.tailIncidence=n)} oncommit={commit} hint="调节尾翼安装角以配平，观察离台后攻角与俯仰变化。"/>
 {:else}
 {#key wingKey}<WingEditor value={aircraft[wingKey]} vertical={tab==='垂直尾翼'} onchange={(w:Wing)=>change(d=>d[wingKey]=w)} oncommit={commit}/>{/key}
 {#if tab==='主翼'}<Parameter label="主翼上反角" value={aircraft.mainWing.dihedral} min={0} max={25} unit="°" onchange={n=>change(d=>d.mainWing.dihedral=n)} oncommit={commit} hint="增加侧滑时的滚转恢复效应，不会强制飞机自动水平。"/>{/if}
 {#if !aircraft.birdman||tab==='垂直尾翼'}<Parameter label={tab==='主翼'?'副翼弦长比例':tab==='水平尾翼'?'升降舵弦长比例':'方向舵弦长比例'} value={aircraft[wingKey].controlSurface} min={0.1} max={1} step={0.05} onchange={n=>change(d=>d[wingKey].controlSurface=n)} oncommit={commit} hint={tab==='垂直尾翼'?'1 为全动垂尾。':'控制面占翼面弦长的比例。'}/>{/if}
 {/if}
 <div class="preset"><label for="preset">试试不同设计</label><select id="preset" aria-label="预设飞机" onchange={e=>{const n=+e.currentTarget.value;if(n>=0){replace(presets[n]);selectedId='';}}}><option value="-1">选择预设飞机</option>{#each presets as p,i}<option value={i}>{p.name}</option>{/each}</select></div>
 </div><div class="editor-footer"><label>挑战<select aria-label="挑战" bind:value={challenge}><option value="birdman">鸟人间挑战</option><option value="downhill">高山速降挑战</option></select></label><label>飞行模式<select aria-label="飞行模式" bind:value={mode} onchange={()=>{try{best=readBest(mode);}catch{best=0;}}}><option value="standard">标准 · 公平竞赛</option><option value="assisted">辅助 · 额外阻尼</option><option value="experimental">实验 · 完整操纵</option></select></label><button class="primary" onclick={()=>start()}>前往挑战 <span>↗</span></button></div></aside>
 <div class="viewport-tools" aria-label="设计相机">{#each ['轨道','俯视','侧视','正视','后视'] as c}<button disabled={tab!=='机身'&&c!==(tab==='垂直尾翼'||tab==='组装'?'侧视':'俯视')} onclick={()=>scene.cameraView(c)}>{c}</button>{/each}</div>
 <section class="design-instruments" aria-label="设计实时仪表">
 <section class="design-metrics" aria-label="飞机性能估算">
 <div><small>主翼面积</small><strong>{main.area.toFixed(2)} <em>m²</em></strong></div><div><small>翼展 / 展弦比</small><strong>{main.span.toFixed(1)} <em>m / {main.aspect.toFixed(1)}</em></strong></div><div><small>全备质量 · 驾驶员 {PILOT_MASS} kg</small><strong><output aria-label="全备质量">{stats.mass.toFixed(1)}</output> <em>kg</em></strong><small>支撑 <output aria-label="主翼支撑面积">{support.area.toFixed(2)}</output> m² · <output aria-label="主翼支撑质量">{support.mass.toFixed(2)}</output> kg</small></div><div><small>翼载荷</small><strong>{stats.wingLoading.toFixed(2)} <em>kg/m²</em></strong></div><div title="自由空气、无地效的设计估算；飞行时随离水高度变化"><small>自由空气最佳滑翔比</small><strong>{stats.glideRatio.toFixed(1)} <em>: 1</em></strong></div><div title="全重、主翼面积、海平面、无地效"><small>估算失速速度</small><strong><output aria-label="估算失速速度">{stats.stallSpeed.toFixed(1)}</output> <em>m/s</em></strong></div>
 </section>
 <section class="stability" aria-label="重心与升力中心配平参考">
 <div class="scene-hint"><span><i class="cg"></i> 重心 CG <output aria-label="重心X">{stats.cg.x.toFixed(2)}</output> m</span><span><i class="lift"></i> 全机升力中心 <output aria-label="全机升力中心X">{stats.aerodynamics.liftCenter?stats.aerodynamics.liftCenter.x.toFixed(2)+' m':'无合力'}</output></span><span><i class="drag"></i> 全机阻力中心 <output aria-label="全机阻力中心X">{stats.aerodynamics.dragCenter?stats.aerodynamics.dragCenter.x.toFixed(2)+' m':'无合力'}</output></span></div>
 <div class="trim-values"><span>静稳定裕度 <output aria-label="静稳定裕度">{(stats.staticMargin*100).toFixed(1)}% MAC</output></span><span>中性点 X {stats.neutralPoint.toFixed(2)} m</span><span>CG {((stats.mainQuarterChord.x+main.chord*0.25-stats.cg.x)/main.chord*100).toFixed(1)}% MAC</span><span>MAC {main.chord.toFixed(2)} m</span></div>
 <p class="trim-advice">{stats.staticMargin<0?'重心偏后，可能俯仰失稳。':stats.staticMargin>0.35?'重心偏前，可能难以抬头。':'正稳定裕度不代表已配平。'} 建议 5–20% MAC；合力中心不表示力矩为零。</p>
 </section>
 <section class="aero-preview" aria-label="三翼气动力预览">
 <div class="aero-heading"><h2>三翼气动力预览</h2><p>自由空气 · 无地效 · 空速 {stats.aerodynamics.speed.toFixed(0)} m/s · 机身攻角 {(stats.aerodynamics.alpha*180/Math.PI).toFixed(0)}° · 侧滑 {(stats.aerodynamics.beta*180/Math.PI).toFixed(0)}° · 无操纵</p></div>
 <table><thead><tr><th scope="col">翼面 / 几何</th><th scope="col">有效攻角</th><th scope="col">升 / 侧向力</th><th scope="col">阻力</th><th scope="col">俯仰 / 偏航矩</th></tr></thead><tbody>{#each stats.aerodynamics.wings as wing}{@const geometry=planform(aircraft[wing.kind==='vertical'?'verticalTail':wing.name==='主翼'?'mainWing':'horizontalTail'],wing.kind!=='vertical')}<tr class="aero-wing" aria-label={wing.name+'气动作用'}><th scope="row">{wing.name}<small>{geometry.area.toFixed(2)} m² · {geometry.span.toFixed(1)} m · AR {geometry.aspect.toFixed(1)}</small></th><td><output aria-label={wing.name+'有效攻角'}>{(wing.alpha*180/Math.PI).toFixed(1)}</output>°</td><td><output aria-label={wing.name+(wing.kind==='vertical'?'侧向力':'升力')}>{(wing.kind==='vertical'?wing.lift.z:wing.lift.y).toFixed(1)}</output> N</td><td><output aria-label={wing.name+'阻力'}>{wing.drag.length().toFixed(1)}</output> N</td><td><output aria-label={wing.name+(wing.kind==='vertical'?'偏航力矩':'俯仰力矩')}>{(wing.kind==='vertical'?wing.torque.y:wing.torque.z).toFixed(1)}</output> N·m</td></tr>{/each}</tbody></table>
 </section>
 </section>
 {:else if screen==='flight'}
 <section class="flight-hud" aria-label="飞行数据"><div><small>滑翔距离</small><strong>{hud.distance.toFixed(1)}<em>m</em></strong></div><div><small>空速</small><strong>{hud.speed.toFixed(1)}<em>m/s</em></strong></div><div><small>高度</small><strong>{hud.altitude.toFixed(1)}<em>m</em></strong></div><div><small>总计时</small><strong>{hud.time.toFixed(1)}<em>s</em></strong></div><div><small>实时攻角</small><strong>{hud.alpha.toFixed(1)}<em>°</em></strong></div><div><small>实时升阻比</small><strong>{Number.isFinite(hud.liftDragRatio)?hud.liftDragRatio.toFixed(1):'—'}<em>:1</em></strong></div>
 <div title="真实耗散功率除以世界水平速度；助跑或水平速度不超过0.05 m/s时无定义"><small>实时能耗</small><strong><output aria-label="实时能耗">{hud.energyPerDistance!=null&&Number.isFinite(hud.energyPerDistance)?hud.energyPerDistance.toFixed(1):'—'}</output><em>J/m</em></strong></div></section>
 <div class="flight-status"><span>{challengeDefinitions[lastChallenge].name} · {!flightReady?'待开始':hud.launching?'坡道助跑':'飞行中'}</span><span>{lastChallenge==='birdman'?'湖面最远距离':`赛道进度 ${(100*(hud.challengeProgress??0)).toFixed(0)}% · 依次穿过航线检查点`}</span>{#if hud.stall}<b>攻角过大 · 失速</b>{/if}</div>
 <div class="flight-instruments">{@render energyPanel()}{@render altitudeCurve()}</div>
 <div class="flight-tools"><button disabled={!flightReady} title="空格开始 / 暂停 / 继续" onclick={togglePause}>{paused?'继续飞行':'暂停'}</button><select aria-label="飞行相机" title="C 键切换视角" bind:value={flightCamera} onchange={e=>scene.cameraView(e.currentTarget.value)}>{#each flightViews as c}<option>{c}</option>{/each}</select><button onclick={design}>返回设计</button></div>
 {#if !flightReady}<div class="launch-action"><button class="primary launch-start" aria-label="开始试飞" aria-keyshortcuts="Space" onclick={beginFlight}>开始试飞 <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><p>空格开始 / 暂停 · C 切换视角</p></div>{/if}
 {#if paused}<div class="pause-banner">飞行已暂停 <button onclick={()=>paused=false}>继续</button></div>{/if}
 <div class="flight-controls">
 <div><span>俯仰 · W / S{lastDefinition.birdman?' · 前后重心':''}</span><button disabled={!flightReady} aria-label="低头" onpointerdown={e=>touch(e,'weight',1)} onpointerup={()=>weight=elevator=0} onpointercancel={()=>weight=elevator=0}>低头</button><button disabled={!flightReady} aria-label="抬头" onpointerdown={e=>touch(e,'weight',-1)} onpointerup={()=>weight=elevator=0} onpointercancel={()=>weight=elevator=0}>抬头</button><progress max="2" value={(lastDefinition.birdman?weight:elevator)+1} aria-label="重心操纵输入"></progress></div>
 <div><span>滚转 · A / D{lastDefinition.birdman?' · 左右重心':''}</span><button disabled={!flightReady} aria-label="左滚转" onpointerdown={e=>touch(e,'lateral',-1)} onpointerup={()=>lateral=aileron=0} onpointercancel={()=>lateral=aileron=0}>左滚</button><button disabled={!flightReady} aria-label="右滚转" onpointerdown={e=>touch(e,'lateral',1)} onpointerup={()=>lateral=aileron=0} onpointercancel={()=>lateral=aileron=0}>右滚</button><progress max="2" value={(lastDefinition.birdman?lateral:aileron)+1} aria-label="滚转操纵输入"></progress></div>
 <div><span>偏航 · Q / E</span><button disabled={!flightReady} aria-label="向左转向" onpointerdown={e=>touch(e,'rudder',-1)} onpointerup={()=>rudder=0} onpointercancel={()=>rudder=0}>左转</button><button disabled={!flightReady} aria-label="向右转向" onpointerdown={e=>touch(e,'rudder',1)} onpointerup={()=>rudder=0} onpointercancel={()=>rudder=0}>右转</button><progress max="2" value={rudder+1} aria-label="方向操纵输入"></progress></div>
 </div>
 <details class="advanced-hud"><summary>姿态与操纵</summary><p>俯仰 {hud.pitch.toFixed(1)}° · 滚转 {hud.roll.toFixed(1)}°</p><p>下沉率 {hud.sink.toFixed(2)} m/s · 航迹滑翔比 {Number.isFinite(hud.glide)?hud.glide.toFixed(1):'—'}</p>{#if !lastDefinition.birdman}<label>升降舵<input disabled={!flightReady} aria-label="升降舵" type="range" min="-1" max="1" step="0.05" bind:value={elevator}/></label><label>副翼<input disabled={!flightReady} aria-label="副翼" type="range" min="-1" max="1" step="0.05" bind:value={aileron}/></label>{/if}</details>
 {:else if screen==='result'&&result}
 <section class="results"><div class="result-heading"><h1>{lastChallenge==='birdman'?'每一米，都来自你的设计。':result.completed?'挑战完成':'挑战未完成'}</h1><span>{challengeDefinitions[lastChallenge].name} · {isReplay?'飞行重放':lastMode==='assisted'?'辅助组成绩':lastMode==='experimental'?'实验组成绩':'标准组成绩'}</span></div><div class="score">{(lastChallenge==='birdman'?result.distance:result.time).toFixed(2)}<small>{lastChallenge==='birdman'?'m':'s'}</small></div><p class="best">个人最佳 {best?best.toFixed(2):'暂无'} {lastChallenge==='birdman'?'m':'s'} · {result.completed?'到达终点':lastChallenge!=='birdman'?'未通过全部检查点或碰撞地形':result.landing==='water'?'接触湖面':'达到飞行边界'}</p><dl class="result-statistics"><div><dt>总计时{lastChallenge==='birdman'?'（含助跑）':''}</dt><dd>{result.time.toFixed(2)} s</dd></div><div><dt>平均速度</dt><dd>{result.averageSpeed.toFixed(2)} m/s</dd></div><div><dt>最高速度</dt><dd>{result.maxSpeed.toFixed(2)} m/s</dd></div><div><dt>最低速度</dt><dd>{result.minSpeed.toFixed(2)} m/s</dd></div><div><dt>最大高度</dt><dd>{result.maxHeight.toFixed(2)} m</dd></div><div><dt>输入记录</dt><dd>{recordedLength} 步 · 60 Hz</dd></div></dl><div class="result-instruments">{@render altitudeCurve()}</div><div class="result-actions"><button class="primary" onclick={design}>返回设计改进</button><button onclick={()=>start()}>再试一次</button><button onclick={()=>start(true)}>重放飞行</button></div></section>
 {/if}
 {#if showLibrary&&screen==='design'}<section class="library" aria-label="本地机库"><div class="library-title"><h2>本地机库</h2><button onclick={()=>showLibrary=false}>关闭</button></div><p>飞机保存在当前浏览器。导出 JSON 可备份或分享。</p><div class="library-actions"><button onclick={save}>保存当前飞机</button><button onclick={fileExport}>导出 JSON</button><label class="button">导入 JSON<input aria-label="导入飞机文件" type="file" accept=".json,application/json" onchange={fileImport}/></label></div>{#if !saved.length}<p class="empty">机库还没有飞机。先保存你的第一个设计。</p>{/if}{#each saved as s}<article class="saved-plane"><input aria-label={'重命名'+s.name} value={s.name} maxlength="60" onchange={e=>renameSaved(s.id,e.currentTarget.value)}/><small>{new Date(s.updatedAt).toLocaleString()}</small><div><button onclick={()=>load(s.id)}>加载</button><button onclick={()=>{try{duplicateAircraft(s.id);saved=listAircraft();}catch(e){notify((e as Error).message);}}}>复制</button><button onclick={()=>{if(confirm('删除“'+s.name+'”？此操作不可撤销。')){try{deleteAircraft(s.id);saved=listAircraft();if(selectedId===s.id)selectedId='';}catch(e){notify((e as Error).message);}}}}>删除</button></div></article>{/each}</section>{/if}
 {#if debug}<aside class="performance" aria-label="开发性能面板"><h2>性能实测 <button onclick={()=>debug=false}>关闭</button></h2><p>{perf.quality} · {Number(perf.fps||0).toFixed(1)} FPS</p><p>平均 {Number(perf.mean||0).toFixed(2)} ms · P95 {Number(perf.p95||0).toFixed(2)} ms · P99 {Number(perf.p99||0).toFixed(2)} ms</p><p>物理 {Number(perf.physicsMs||0).toFixed(3)} ms · 渲染提交 {Number(perf.renderMs||0).toFixed(2)} ms</p><p>几何 {Number(perf.geometryMs||0).toFixed(2)} ms · {perf.drawCalls||0} draw calls · {perf.triangles||0} triangles</p><p>几何与纹理估算 {typeof perf.memory==='number'?perf.memory.toFixed(2)+' MiB':'不可用'}</p><small>帧率来自当前环境，不代表真实手机性能。</small></aside>{/if}
 {#if message}<div class="toast" role="status">{message}<button aria-label="关闭提示" onclick={()=>message=''}>关闭</button></div>{/if}
</div>
