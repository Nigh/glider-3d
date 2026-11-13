<script lang="ts">
 import { language, t as translate } from './i18n';
 import { wingAirfoil, type AircraftDefinition } from './model';
 import { airfoilCatalog, type AirfoilId } from './airfoils';
 let { definition, wingKey, onselect }: { definition: AircraftDefinition; wingKey: 'mainWing' | 'horizontalTail'; onselect: (id: AirfoilId) => void } = $props();
 const t = $derived.by(() => { const locale = $language; return (source: string) => translate(source, undefined, locale); });
 const id = $derived(wingAirfoil(definition, wingKey));
</script>

<fieldset class="airfoil-settings">
 <legend>{t('翼型')}</legend>
 <label>{t('翼型')} <select aria-label={t('翼型')} disabled={definition.birdman} value={id} onchange={e=>onselect(e.currentTarget.value as AirfoilId)}>{#each Object.entries(airfoilCatalog) as [key, foil]}<option value={key}>{foil.name}</option>{/each}</select></label>
</fieldset>

<style>
 .airfoil-settings{margin:12px 0;padding:10px;border:1px solid #8d9b9b66;border-radius:8px}
 label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0}select{max-width:160px}
</style>
