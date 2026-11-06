<script lang="ts">
 import { language, t as translate } from './i18n';
 import type { FlightResult } from './physics';
 let { result, fractures, onDesign, onRetry }: { result: FlightResult; fractures: number; onDesign: () => void; onRetry: () => void } = $props();
 const t = $derived.by(() => { const locale = $language; return (source: string) => translate(source, undefined, locale); });
</script>
<section class="results laboratory-results" aria-label={t('测试结果')}>
 <div class="result-heading"><h1>{t(result.challenge === 'test-space' ? '测试空间结果' : '风洞测试结束')}</h1><span>{t(result.landing === 'boundary' ? '达到测试空间边界' : result.landing === 'manual' ? '已手动停止' : result.landing === 'water' ? '接触海面' : '接触地面')}</span></div>
 <dl class="result-statistics">
  {#if result.challenge === 'test-space'}
   <div><dt>{t('平台高度')}</dt><dd>{(result.platformHeight ?? 0).toFixed(0)} m</dd></div>
   <div><dt>{t('起飞高度')}</dt><dd>{result.takeoffHeight ? result.takeoffHeight.toFixed(1) + ' m' : t('尚未起飞')}</dd></div>
   <div><dt>{t('起飞速度')}</dt><dd>{result.takeoffHeight ? (result.takeoffSpeed ?? 0).toFixed(1) + ' m/s' : t('尚未起飞')}</dd></div>
   <div><dt>{t('总飞行距离')}</dt><dd>{result.distance.toFixed(1)} m</dd></div>
  {/if}
  <div><dt>{t('总飞行时间')}</dt><dd>{result.time.toFixed(2)} s</dd></div>
  <div><dt>{t('最高速度')}</dt><dd>{result.maxSpeed.toFixed(1)} m/s</dd></div>
  <div><dt>{t('最大G值')}</dt><dd>{result.maxG.toFixed(2)} G</dd></div>
  <div><dt>{t('最大高度')}</dt><dd>{result.maxHeight.toFixed(1)} m</dd></div>
  <div><dt>{t('结构断裂')}</dt><dd>{fractures}</dd></div>
 </dl>
 <div class="result-actions"><button class="primary" onclick={onDesign}>{t('返回设计改进')}</button><button onclick={onRetry}>{t('再试一次')}</button></div>
</section>
