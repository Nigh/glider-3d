<script lang="ts">
 import { language, t as translate } from './i18n';
 import { signedLoad, type WindForceSnapshot } from './wind-forces';
 let { loads }: { loads: WindForceSnapshot } = $props();
 const t = $derived.by(() => { const locale = $language; return (source: string) => translate(source, undefined, locale); });
 const axes = ['x', 'y', 'z'] as const;
 const groups = $derived([
  { key: 'force', symbol: 'F', values: loads.force, unit: 'N', name: '净外力 · 机体', directions: '+X 机头 · +Y 机背 · +Z 右翼', description: '含重力，不含支架反力；表示解除固定时主体的平移趋势。' },
  { key: 'moment', symbol: 'M', values: loads.moment, unit: 'N·m', name: '重心力矩 · 机体', directions: '+Mx 右翼下 · +My 左偏 · +Mz 抬头', description: '机体轴关于当前重心的外力矩，不含支架反力矩；正值按标注方向，负值相反。' },
 ]);
</script>

<section class="wind-forces" aria-label={t('当前受力与力矩')}>
 {#each groups as group}
  {@const scale = Math.max(1, ...group.values.map(Math.abs))}
  <div class="wind-load-group" role="group" aria-label={t(group.name)} aria-describedby={`wind-${group.key}-description`} title={`${t(group.directions)}\n${t(group.description)}`}>
   <span id={`wind-${group.key}-description`} hidden>{t(group.directions)} {t(group.description)}</span>
   <h3>{group.symbol}<small>{group.unit}</small></h3>
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
        <path class="wind-load-vector" d={`M${50-side*8} 17A10 10 0 1 ${side>0?1:0} ${50+side*8} 17M${50+side*8} 11V17H${50+side*2}`}/>
       {:else}<circle class="wind-load-zero" cx="50" cy="12" r="2"/>{/if}
      {:else}
       <path class="wind-load-axis" d="M8 12H92M50 5V19"/>
       <text x="2" y="15">−</text><text x="94" y="15">+</text>
       {#if Math.abs(value) >= 0.05}
        <path class="wind-load-vector" d={`M50 12H${end}M${end - Math.sign(value) * 5} 8L${end} 12L${end - Math.sign(value) * 5} 16`}/>
       {:else}<circle class="wind-load-zero" cx="50" cy="12" r="2"/>{/if}
      {/if}
     </svg>
     <output aria-label={`${t(group.name)} ${group.symbol}${axis}`} aria-live="off">{signedLoad(value)} <small>{group.unit}</small></output>
    </div>
   {/each}
  </div>
 {/each}
</section>
