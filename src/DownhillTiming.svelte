<script lang="ts">
 import { language, t as translate, type TranslationParams } from './i18n';
 const t=$derived.by(()=>{const locale=$language;return (source:string,params?:TranslationParams)=>translate(source,params,locale);});
 let { time, started, checkpointTimes, ghostTimes, ghostActive, timingReady = true }: {
  time: number; started: boolean; checkpointTimes: readonly number[]; ghostTimes: readonly (number | null)[]; ghostActive: boolean; timingReady?: boolean;
 } = $props();
 let index = $derived(checkpointTimes.length - 1);
 let own = $derived(checkpointTimes[index]), reference = $derived(ghostTimes[index]);
 let difference = $derived(own != null && reference != null ? Math.round((own - reference) * 100) / 100 : null);
</script>

<div class="race-clock"><small>{t('有效计时')}</small><strong><output aria-label={t('有效计时')}>{(started ? time : 0).toFixed(2)}</output><em>s</em></strong></div>
{#if ghostActive && index >= 0}
 <div class="race-split" class:ahead={difference !== null && difference < 0} class:behind={difference !== null && difference > 0} role="status" aria-label={t('Ghost 检查点秒差')}>
  <small>{t('检查点 {number}', { number: index + 1 })}</small>
  {#if !timingReady}<span>{t('正在计算 Ghost 秒差…')}</span>
  {:else if difference !== null}<strong><output>{difference > 0 ? '+' : ''}{difference.toFixed(2)}</output><em>s</em></strong><small>{t(difference < 0 ? '领先 Ghost' : difference > 0 ? '落后 Ghost' : '与 Ghost 持平')}</small>
  {:else}<span>{t('Ghost 未通过此检查点')}</span>{/if}
 </div>
{/if}
