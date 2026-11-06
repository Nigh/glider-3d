<script lang="ts">
 import { recordedLoads, replayDuration } from './playback';
 import type { Replay } from './replay';
 import { language, t as translate } from './i18n';
 let { replay, position, seeking, paused, onseek }: { replay: Replay; position: number; seeking: boolean; paused: boolean; onseek: (seconds: number) => void } = $props();
 const t=$derived.by(()=>{const locale=$language;return (source:string)=>translate(source,undefined,locale);});
 const samples=$derived(recordedLoads(replay.recording));
 const duration=$derived(replayDuration(replay.recording));
 const scale=$derived(Math.max(0.1,Math.ceil(Math.max(0,...samples.map(p=>Math.max(p.main,p.tail,p.vertical)))*10)/10));
 const curves=$derived((['main','tail','vertical'] as const).map(key=>({key,points:samples.map(p=>`${p.time/duration*600},${70-p[key]/scale*60}`).join(' ')})));
</script>
<section class="replay-timeline" class:paused aria-label={t('回放时间轴')} aria-busy={seeking}>
 <div class="timeline-heading"><strong>{t('回放时间轴')}</strong><output>{position.toFixed(2)} / {duration.toFixed(2)} s</output></div>
 <div class="waveform">
  <div class="timeline-legend"><span class="main-load">{t('主翼')}</span><span class="tail-load">{t('水平尾翼')}</span><span class="vertical-load">{t('垂直尾翼')}</span><span>{t('结构极限利用率')} · {(scale*100).toFixed(0)}%</span></div>
  <svg viewBox="0 0 600 80" preserveAspectRatio="none" role="img" aria-label={t('翼面负载曲线')}>
   {#if scale>=1}<line x1="0" x2="600" y1={70-60/scale} y2={70-60/scale} stroke="currentColor" stroke-dasharray="4 4" opacity="0.3"/>{/if}
   {#each curves as curve}<polyline class={curve.key+'-load'} points={curve.points} fill="none" stroke-width="2" vector-effect="non-scaling-stroke"/>{/each}
   <line x1={position/duration*600} x2={position/duration*600} y1="0" y2="80" stroke="currentColor"/>
  </svg>
  {#if !samples.length}<small>{t('此记录未保存负载曲线')}</small>{/if}
 </div>
 <input type="range" min="0" max={duration} step="any" value={position} aria-label={t('回放进度')} oninput={e=>onseek(e.currentTarget.valueAsNumber)}/>
 {#if seeking}<div class="seek-overlay" role="status"><span class="seek-spinner" aria-hidden="true"></span><strong>{t('正在跳转回放…')}</strong></div>{/if}
</section>

<style>
 .replay-timeline{position:relative;padding:8px 14px;background:var(--paper,#fafbf6);border:1px solid #a5b7b3;border-radius:10px;color:#173e43;grid-column:1/-1}
 .timeline-heading,.timeline-legend{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;font-size:12px}
 .timeline-legend{justify-content:flex-start;font-size:10px;margin-top:4px}
 .waveform{display:none}
 .paused .waveform{display:block}
 @media(hover:hover){.replay-timeline:hover .waveform{display:block}}
 svg{width:100%;height:70px;display:block;pointer-events:none}
 input{display:block;width:100%;height:44px;margin:0;cursor:ew-resize;accent-color:#173e43}
 .main-load{color:#bd4f30;stroke:#bd4f30}.tail-load{color:#258875;stroke:#258875}.vertical-load{color:#6e60ad;stroke:#6e60ad}
 small{font-size:10px}
 .seek-overlay{position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;gap:12px;padding:12px;background:#fafbf6ed;border:2px solid var(--ink,#173e43);border-radius:inherit;font-size:14px;pointer-events:none}
 .seek-spinner{width:24px;height:24px;flex-shrink:0;border:3px solid #a5b7b3;border-top-color:var(--accent,#b84a2b);border-radius:50%;animation:seek-spin .75s linear infinite}
 @keyframes seek-spin{to{transform:rotate(360deg)}}
 @media(prefers-reduced-motion:reduce){.seek-spinner{animation:none;border-top-color:var(--ink,#173e43)}}
</style>
