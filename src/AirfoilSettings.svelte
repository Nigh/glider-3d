<script lang="ts">
 import { language, t as translate } from './i18n';
 import { wingAirfoil, type AircraftDefinition } from './model';
 import { AIR_VISCOSITY, airfoilCatalog, airfoilCoverage, airfoilShapes, type AirfoilId } from './airfoils';
 let { definition, wingKey, mass, onselect }: { definition: AircraftDefinition; mass: number; wingKey: 'mainWing' | 'horizontalTail'; onselect: (id: AirfoilId) => void } = $props();
 const t = $derived.by(() => { const locale = $language; return (source: string) => translate(source, undefined, locale); });
 let speed = $state(12);
 const id = $derived(wingAirfoil(definition, wingKey)), spec = $derived(airfoilCatalog[id]);
 const chords = $derived([definition[wingKey].points[3].x - definition[wingKey].points[0].x, definition[wingKey].points[2].x - definition[wingKey].points[1].x]);
 const reMin = $derived(speed * Math.min(...chords) / AIR_VISCOSITY), reMax = $derived(speed * Math.max(...chords) / AIR_VISCOSITY);
 const volume = $derived(2 * Math.abs(definition[wingKey].points[1].y) * (chords[0] ** 2 + chords[0] * chords[1] + chords[1] ** 2) / 3 * airfoilShapes[id].area);
 const valid = $derived(airfoilCoverage(id, reMin, reMax, speed));
</script>

<fieldset class="airfoil-settings">
 <legend>{t('翼型与数据范围')}</legend>
 <label>{t('翼型')} <select aria-label={t('翼型')} disabled={definition.birdman} value={id} onchange={e=>onselect(e.currentTarget.value as AirfoilId)}>{#each Object.entries(airfoilCatalog) as [key, foil]}<option value={key}>{foil.name}</option>{/each}</select></label>
 {#if definition.birdman}<p class="help">{t('鸟人机固定 DAE-11，允许自由改形；数据外性能没有标定保证。')}</p>{/if}
 <label>{t('范围检查速度')} <input aria-label={t('范围检查速度')} type="number" min="1" max="200" step="1" value={speed} oninput={e=>{if(Number.isFinite(e.currentTarget.valueAsNumber))speed=Math.max(1,Math.min(200,e.currentTarget.valueAsNumber));}}/> m/s</label>
 <p class="help">{t('机翼质量 / 平均密度')} <output data-wing-mass>{mass.toFixed(2)}</output> kg / <output data-wing-density>{(mass/volume).toFixed(2)}</output> kg/m³</p>
 <p class="help">Re {reMin.toExponential(2)}–{reMax.toExponential(2)} · {t('模型范围')} {spec.reMin.toExponential(1)}–{spec.reMax.toExponential(1)} · M ≤ {spec.machMax}</p>
 {#if !valid}<p role="status" data-airfoil-invalid>{t(definition.birdman?'鸟人机允许此形状；数据外结果未标定。':'当前形状无效：超出翼型模型范围，请更换翼型或改变机翼形状。')}</p>{/if}
 <p class="help">{t('范围按检查速度与根梢弦计算；飞行中另按实际来流提示，不阻止试飞。二维极曲线不能标定任意展弦比或后掠。')}</p>
 <p class="help">{t(id==='naca0012'?'Re=6M 为实测锚点；低 Re 为 XFOIL 预测，中间为未标定工程插值。':'DAE-11 使用 Re=200k–1M 的 XFOIL 预测，不是实测数据。')}</p>
</fieldset>

<style>
 .airfoil-settings{margin:12px 0;padding:10px;border:1px solid #8d9b9b66;border-radius:8px}
 label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0}input{width:75px}select{max-width:160px}p{font-size:12px;line-height:1.5}p[role=status]{color:#d57836}
</style>
