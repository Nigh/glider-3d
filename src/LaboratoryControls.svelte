<script lang="ts">
 import { language, t as translate } from './i18n';
 import type { LaboratoryMode, TestSpaceSettings, WindTunnelSettings } from './laboratory';
 import type { AircraftDefinition } from './model';
 let { mode, definition, ready, windEnabled, cameraView, testSettings, windSettings, actualWind, onTestSettings, onWindSettings, onStop, onToggleWind, onRestore, onCamera }: {
  mode: LaboratoryMode; definition: AircraftDefinition; ready: boolean; windEnabled: boolean; cameraView: string; testSettings: TestSpaceSettings; windSettings: WindTunnelSettings; actualWind: WindTunnelSettings;
  onTestSettings: (value: TestSpaceSettings) => void; onWindSettings: (value: WindTunnelSettings) => void;
  onStop: () => void; onToggleWind: () => void; onRestore: () => void; onCamera: (view: string) => void;
 } = $props();
 const t = $derived.by(() => { const locale = $language; return (source: string) => translate(source, undefined, locale); });
 let editingField = $state<keyof WindTunnelSettings | 'height' | null>(null), fieldDraft = $state('');
 type WindControl = { key: keyof WindTunnelSettings; name: string; note?: string; min: number; max: number; step: number; unit: string; scale: number };
 const windControls = $derived<WindControl[]>([
  { key: 'speed', name: '气流速度', min: 1, max: definition.birdman ? 50 : 200, step: 0.01, unit: 'm/s', scale: 1 },
  { key: 'roll', name: '滚转角度', min: -180, max: 180, step: 0.1, unit: '°', scale: 1 },
  { key: 'pitch', name: '俯仰角度', min: -45, max: 45, step: 0.1, unit: '°', scale: 1 },
  ...(definition.birdman ? [
   { key: 'aileron' as const, name: '滚转控制', note: '驾驶员横移', min: -definition.controls.lateralTravel, max: definition.controls.lateralTravel, step: 0.01, unit: 'm', scale: definition.controls.lateralTravel },
   { key: 'elevator' as const, name: '俯仰控制', note: '驾驶员前后移', min: -definition.controls.travel, max: definition.controls.travel, step: 0.01, unit: 'm', scale: definition.controls.travel },
  ] : [
   { key: 'aileron' as const, name: '滚转控制', min: 0, max: 100, step: 1, unit: '%', scale: 50 },
   { key: 'elevator' as const, name: '俯仰控制', min: 0, max: 100, step: 1, unit: '%', scale: 50 },
  ]),
  { key: 'rudder', name: '方向舵控制比例', min: 0, max: 100, step: 1, unit: '%', scale: 50 },
  { key: 'mainIncidence', name: '主翼安装角', min: -10, max: 18, step: 0.1, unit: '°', scale: 1 },
  { key: 'tailIncidence', name: '水平辅助翼安装角', min: -12, max: 12, step: 0.1, unit: '°', scale: 1 },
 ]);
 const precision = (control: WindControl) => control.unit === '%' ? 0 : control.unit === '°' ? 1 : 2;
 const offset = (control: WindControl) => control.unit === '%' ? 50 : 0;
 const displayWind = (control: WindControl, settings: WindTunnelSettings) => settings[control.key] * control.scale + offset(control);
 function testValue(key: 'height' | 'speed', input: HTMLInputElement) {
  if (editingField === key && input.type === 'number') fieldDraft = input.value;
  const value = input.valueAsNumber;
  if (Number.isFinite(value)) onTestSettings({ ...testSettings, [key]: Math.max(key === 'height' ? 0 : 10, Math.min(key === 'height' ? 5000 : 150, Number(value.toFixed(2)))) });
 }
 function windValue(control: WindControl, input: HTMLInputElement) {
  // Preserve partial decimal/negative input; normalize its display on blur.
  if (editingField === control.key) fieldDraft = input.value;
  const value = input.valueAsNumber;
  if (Number.isFinite(value)) onWindSettings({ ...windSettings, [control.key]: (Math.max(control.min, Math.min(control.max, Number(value.toFixed(precision(control))))) - offset(control)) / control.scale });
 }
</script>

<section class="laboratory-controls" aria-label={t(mode === 'test-space' ? '测试平台设置' : '风洞控制')}>
 <h2>{t(mode === 'test-space' ? '测试空间' : '风洞')} <small>{t('自由测试 · 不计成绩')}</small></h2>
 {#if mode === 'test-space'}
  <p>{t('10 × 10 × 10 km · 山地 / 沙滩 / 海洋')}</p>
  <details class="platform-options" open={!ready}>
  <summary>{t('平台高度')} {testSettings.height.toFixed(2)} m · {testSettings.catapult ? testSettings.speed.toFixed(2) + ' m/s' : t('跑道滑跑')}</summary>
  <fieldset disabled={ready}>
   <label for="platform-height">{t('平台高度')} <span><input aria-label={t('平台高度数值')} type="number" min="0" max="5000" step="0.01" value={editingField === 'height' ? fieldDraft : testSettings.height.toFixed(2)} onfocus={e => { editingField = 'height'; fieldDraft = e.currentTarget.value; }} oninput={e => testValue('height', e.currentTarget)} onblur={e => { editingField = null; e.currentTarget.value = testSettings.height.toFixed(2); }}/> m</span></label>
   <input id="platform-height" aria-label={t('平台高度')} type="range" min="0" max="5000" step="1" value={testSettings.height} oninput={e => testValue('height', e.currentTarget)}/>
   <label class="lab-check"><input aria-label={t('启用弹射')} type="checkbox" checked={testSettings.catapult} onchange={e => onTestSettings({ ...testSettings, catapult: e.currentTarget.checked })}/>{t('启用弹射')}</label>
   <label for="catapult-speed">{t('弹射末端速度')} <span><input aria-label={t('弹射末端速度数值')} disabled={!testSettings.catapult} type="number" min="10" max="150" step="0.01" value={editingField === 'speed' ? fieldDraft : testSettings.speed.toFixed(2)} onfocus={e => { editingField = 'speed'; fieldDraft = e.currentTarget.value; }} oninput={e => testValue('speed', e.currentTarget)} onblur={e => { editingField = null; e.currentTarget.value = testSettings.speed.toFixed(2); }}/> m/s</span></label>
   <input id="catapult-speed" aria-label={t('弹射末端速度')} disabled={!testSettings.catapult} type="range" min="10" max="150" step="1" value={testSettings.speed} oninput={e => testValue('speed', e.currentTarget)}/>
  </fieldset>
  </details>
  <p>{t(ready ? '平台设置已锁定，重新试飞后可调整。' : testSettings.catapult ? '50 m 轨道 · 至少 1 G · 达到目标速度后滑行，轨道末端脱离。' : '弹射已关闭，使用飞机自身推力在轨道上滑跑起飞。')}</p>
 {:else}
  <p class="wind-direction">← {t('气流从右向左')} <small>{t('网格 1 m · 小刻度 0.1 m')}</small></p>
  {#each windControls as control}
   <div class="wind-control">
    <label for={`wind-${control.key}`}>{t(control.name)}<span><input aria-label={t(control.name + '数值')} type="number" min={control.min} max={control.max} step={control.step} value={editingField === control.key ? fieldDraft : displayWind(control, windSettings).toFixed(precision(control))} onfocus={e => { editingField = control.key; fieldDraft = e.currentTarget.value; }} oninput={e => windValue(control, e.currentTarget)} onblur={e => { editingField = null; e.currentTarget.value = displayWind(control, windSettings).toFixed(precision(control)); }}/>{control.unit}</span></label>
    <input id={`wind-${control.key}`} aria-label={t(control.name)} type="range" min={control.min} max={control.max} step={control.step} value={displayWind(control, windSettings)} oninput={e => windValue(control, e.currentTarget)}/>
    <small>{#if control.note}{t(control.note)} · {/if}{t('实际值')} <output aria-label={t(control.name + '实际值')}>{displayWind(control, actualWind).toFixed(precision(control))}</output> {control.unit}</small>
   </div>
  {/each}
   <p>{t('舵量 50% 为中位。')}</p>
  {#if definition.birdman}<p>{t('驾驶员位移正值为向右、向前，负值为向左、向后。')}</p>{/if}
  <p>{t('安装角按限速实时变化；返回工坊保留当前实际角度。')}</p>
  {#if definition.assembly.tailOnFin}<p>{t('垂尾顶面随水平辅助翼安装角和翼型平滑变化。')}</p>{/if}
  <p>{t('开启或关闭风洞以平滑调整气流；还原飞机状态可修复结构损伤。')}</p>
  <div class="lab-cameras" aria-label={t('观察视角')}>{#each ['侧视', '俯视', '正视', '自由'] as camera}<button class:active={cameraView === camera} aria-pressed={cameraView === camera} onclick={() => onCamera(camera)}>{t(camera)}</button>{/each}</div>
 {/if}
 <div class="lab-actions">
  {#if mode === 'wind-tunnel'}
   <button class="primary" aria-pressed={windEnabled} onclick={onToggleWind}>{t(windEnabled ? '关闭风洞' : '开启风洞')}</button>
   <button onclick={onRestore}>{t('还原飞机状态')}</button>
  {:else if ready}<button onclick={onStop}>{t('停止测试')}</button>{/if}
 </div>
</section>
