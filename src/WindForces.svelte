<script lang="ts">
 import { language, t as translate } from './i18n';
 import { loadMagnitude, momentDirection, type WindForceSnapshot } from './wind-forces';
 let { loads }: { loads: WindForceSnapshot } = $props();
 const t = $derived.by(() => { const locale = $language; return (source: string) => translate(source, undefined, locale); });
 const axes = ['x', 'y', 'z'] as const;
 let details = $state<string | null>(null);
 const groups = $derived([
  { key: 'force', symbol: 'F', values: loads.force, unit: 'N', name: '净外力 · 机体', directions: '+X 机头 · +Y 机背 · +Z 右翼', description: '含重力，不含支架反力；表示解除固定时主体的平移趋势。' },
  { key: 'moment', symbol: 'M', values: loads.moment, unit: 'N·m', name: '重心力矩 · 机体', directions: '+Mx 右翼下 · +My 左偏 · +Mz 抬头', description: '机体轴关于当前重心的外力矩，不含支架反力矩；箭头遵循右手定则，数值为绝对值。' },
 ]);
</script>

<section class="wind-forces" aria-label={t('当前受力与力矩')}>
 {#each groups as group}
  {@const scale = Math.max(1, ...group.values.map(Math.abs))}
  <div class="wind-load-group" role="group" aria-label={t(group.name)} aria-describedby={`wind-${group.key}-description`} title={`${t(group.directions)}\n${t(group.description)}`}>
   <span class="wind-load-description" class:open={details === group.key} id={`wind-${group.key}-description`}>{t(group.directions)} {t(group.description)}</span>
   <h3><button class="wind-load-info" aria-label={t(group.name)} aria-expanded={details === group.key} aria-controls={`wind-${group.key}-description`} onclick={() => details = details === group.key ? null : group.key}>{group.symbol}<small>{group.unit}</small></button></h3>
   {#each axes as axis, index}
    {@const value = group.values[index]}
    {@const end = 50 + 42 * value / scale}
    <div class="wind-load-row" data-axis={`${group.symbol}${axis}`}>
     <span>{group.symbol}<sub>{axis}</sub></span>
     <svg viewBox="0 0 100 24" aria-hidden="true">
      {#if group.key === 'moment'}
       <circle class="wind-load-axis" cx="50" cy="12" r="9"/>
       {#if Math.abs(value) >= 0.05}
        {@const side = Math.sign(value)}
        <path class="wind-load-vector" d={`M${50-side*8} 17A9.43 9.43 0 1 ${side>0?1:0} ${50+side*8} 17M${50+side*12.8} 14.1L${50+side*8} 17L${50+side*8.5} 11.4`}/>
       {:else}<circle class="wind-load-zero" cx="50" cy="12" r="2"/>{/if}
      {:else}
       <path class="wind-load-axis" d="M8 12H92M50 5V19"/>
       <text x="2" y="15">−</text><text x="94" y="15">+</text>
       {#if Math.abs(value) >= 0.05}
        <path class="wind-load-vector" d={`M50 12H${end}M${end - Math.sign(value) * 5} 8L${end} 12L${end - Math.sign(value) * 5} 16`}/>
       {:else}<circle class="wind-load-zero" cx="50" cy="12" r="2"/>{/if}
      {/if}
     </svg>
     <output aria-label={`${t(group.name)} ${group.symbol}${axis}`} aria-live="off">{group.key === 'moment' ? t(momentDirection(index, value)) : value < -0.05 ? '−' : value >= 0.05 ? '+' : ''} {loadMagnitude(value)} <small>{group.unit}</small></output>
    </div>
   {/each}
  </div>
 {/each}
</section>

<style>
 .wind-load-group { position: relative; }
 .wind-load-description { display: none; }
 .wind-load-info { display: flex; align-items: baseline; justify-content: space-between; width: 100%; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; }
 .wind-load-description.open {
  display: block;
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 2;
  width: min(300px, 70vw);
  padding: 8px;
  background: var(--panel);
  color: var(--ink);
  border: 1px solid var(--line);
  font-size: 12px;
  line-height: 1.5;
 }
</style>
