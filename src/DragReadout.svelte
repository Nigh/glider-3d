<script lang="ts">
 import type { AerodynamicReference } from './physics';
 import { dragResistance, type DragTerm } from './drag';
 import { language, t as translate } from './i18n';
 let { aerodynamics: aero, windTunnel }: { aerodynamics: AerodynamicReference; windTunnel: boolean } = $props();
 const t = $derived.by(() => { const locale = $language; return (source: string) => translate(source, undefined, locale); });
 const terms: [DragTerm, string][] = [
  ['wingProfile', '翼型型阻（摩擦与压差）'], ['wingSeparated', '翼面分离阻力'], ['wingSpanwise', '展向来流阻力'],
  ['bodyPressure', '座舱与罩体压差阻力'], ['bodySkin', '座舱与罩体表面摩擦'], ['fuselage', '未解析机体阻力'],
  ['engineNacelle', '发动机外阻'], ['engineSupport', '发动机支架阻力'], ['water', '水阻'], ['induced', '诱导阻力'],
 ];
</script>

<div data-drag-term="total"><dt title={t('阻力沿未扰动来流方向分解，各项相加等于总阻力；无来流时使用机头轴。')}>{t('阻力')}</dt><dd>{dragResistance(aero.drag, aero.dragAxis).toFixed(2)} N</dd></div>
{#if windTunnel}
 {#each terms as [key, label]}
  <div data-drag-term={key}><dt>{t(label)}</dt><dd>{dragResistance(aero.dragTerms[key], aero.dragAxis).toFixed(2)} N</dd></div>
 {/each}
{:else}
 <div data-drag-term="nonInduced"><dt title={t('非诱导分项包含翼型摩擦与压差阻力、机身及发动机外阻；不是单独的表面摩擦。')}>{t('非诱导阻力')}</dt><dd>{dragResistance(aero.profileDrag, aero.dragAxis).toFixed(2)} N</dd></div>
 <div data-drag-term="induced"><dt>{t('诱导阻力')}</dt><dd>{dragResistance(aero.inducedDrag, aero.dragAxis).toFixed(2)} N</dd></div>
{/if}
