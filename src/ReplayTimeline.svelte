<script module lang="ts">
 import type { LoadSample } from './playback';
 import type { Replay } from './replay';
 const analyzed = new WeakMap<Replay, LoadSample[]>();
</script>
<script lang="ts">
 import { replayDuration } from './playback';
 import { language, t as translate } from './i18n';
 let { replay, position, seeking, onseek }: { replay: Replay; position: number; seeking: boolean; onseek: (seconds: number) => void } = $props();
 const t=$derived.by(()=>{const locale=$language;return (source:string)=>translate(source,undefined,locale);});
 let samples=$state.raw<LoadSample[]>([]), loading=$state(true), error=$state('');
 const duration=$derived(replayDuration(replay.recording));
 const peak=$derived(samples.reduce<LoadSample|null>((best,p)=>!best||Math.max(p.main,p.tail,p.vertical)>Math.max(best.main,best.tail,best.vertical)?p:best,null));
 const scale=$derived(Math.max(0.1,Math.ceil(Math.max(0,...samples.map(p=>Math.max(p.main,p.tail,p.vertical)))*10)/10));
 const curves=$derived((['main','tail','vertical'] as const).map(key=>({key,points:samples.map(p=>`${p.time/duration*600},${70-p[key]/scale*60}`).join(' ')})));
 $effect(()=>{
  const source=replay;loading=true;error='';samples=[];
  const cached=analyzed.get(source);if(cached){samples=cached;loading=false;return;}
  const worker=new Worker(new URL('./replay-analysis.worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=e=>{if(e.data.error)error=e.data.error;else{samples=e.data.samples;analyzed.set(source,samples);}loading=false;worker.terminate();};
  worker.onerror=e=>{error=e.message;loading=false;worker.terminate();};
  worker.postMessage(source);
  return ()=>worker.terminate();
 });
</script>
<section class="replay-timeline" aria-label={t('回放时间轴')} aria-busy={loading||seeking}>
 <div class="timeline-heading"><strong>{t('回放时间轴')}</strong><output>{position.toFixed(2)} / {duration.toFixed(2)} s</output></div>
 <div class="timeline-legend"><span class="main-load">{t('主翼')}</span><span class="tail-load">{t('水平尾翼')}</span><span class="vertical-load">{t('垂直尾翼')}</span><span>{t('结构极限利用率')} · {(scale*100).toFixed(0)}%</span></div>
 <div class="timeline-track">
  <svg viewBox="0 0 600 80" preserveAspectRatio="none" role="img" aria-label={t('翼面负载曲线')}>
   {#if scale>=1}<line x1="0" x2="600" y1={70-60/scale} y2={70-60/scale} stroke="currentColor" stroke-dasharray="4 4" opacity="0.3"/>{/if}
   {#each curves as curve}<polyline class={curve.key+'-load'} points={curve.points} fill="none" stroke-width="2" vector-effect="non-scaling-stroke"/>{/each}
   <line x1={position/duration*600} x2={position/duration*600} y1="0" y2="80" stroke="currentColor"/>
  </svg>
  <input type="range" min="0" max={duration} step="any" value={position} aria-label={t('回放进度')} oninput={e=>onseek(e.currentTarget.valueAsNumber)}/>
 </div>
 {#if peak}<button class="peak-jump" onclick={()=>onseek(peak!.peakTime)}>{t('跳至负载峰值')} · {peak.peakTime.toFixed(2)} s · {(Math.max(peak.main,peak.tail,peak.vertical)*100).toFixed(1)}%</button>{/if}
 {#if loading||seeking||error}<small role="status">{error||t(seeking?'正在跳转回放…':'正在计算负载曲线…')}</small>{/if}
</section>

<style>
 .replay-timeline{padding:10px 14px;background:var(--paper,#fafbf6);border:1px solid #a5b7b3;border-radius:10px;color:#173e43;grid-column:1/-1}
 .timeline-heading,.timeline-legend{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;font-size:12px}
 .timeline-legend{justify-content:flex-start;font-size:10px;margin-top:4px}
 .timeline-track{position:relative;height:92px;margin-top:4px}
 svg{width:100%;height:70px;display:block;pointer-events:none}
 input{position:absolute;inset:48px 0 0;width:100%;height:44px;margin:0;cursor:ew-resize;accent-color:#173e43}
 .main-load{color:#bd4f30;stroke:#bd4f30}.tail-load{color:#258875;stroke:#258875}.vertical-load{color:#6e60ad;stroke:#6e60ad}
 small{font-size:10px}
 .peak-jump{font-size:10px;min-height:44px;padding:4px 8px;width:100%}
</style>
