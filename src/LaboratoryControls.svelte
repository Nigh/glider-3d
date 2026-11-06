<script lang="ts">
 import { language, t as translate } from './i18n';
 import type { LaboratoryMode, TestSpaceSettings, WindTunnelSettings } from './laboratory';
 let { mode, ready, paused, testSettings, windSettings, actualWind, onTestSettings, onWindSettings, onStart, onStop, onPause, onCamera }: {
  mode: LaboratoryMode; ready: boolean; paused: boolean; testSettings: TestSpaceSettings; windSettings: WindTunnelSettings; actualWind: WindTunnelSettings;
  onTestSettings: (value: TestSpaceSettings) => void; onWindSettings: (value: WindTunnelSettings) => void;
  onStart: () => void; onStop: () => void; onPause: () => void; onCamera: (view: string) => void;
 } = $props();
 const t = $derived.by(() => { const locale = $language; return (source: string) => translate(source, undefined, locale); });
 const windControls: { key: keyof WindTunnelSettings; name: string; min: number; max: number; step: number; unit: string; scale: number }[] = [
  { key: 'speed', name: '气流速度', min: 1, max: 200, step: 1, unit: 'm/s', scale: 1 },
  { key: 'roll', name: '滚转角度', min: -180, max: 180, step: 1, unit: '°', scale: 1 },
  { key: 'pitch', name: '俯仰角度', min: -90, max: 90, step: 1, unit: '°', scale: 1 },
  { key: 'aileron', name: '副翼控制比例', min: -100, max: 100, step: 1, unit: '%', scale: 100 },
  { key: 'elevator', name: '升降舵控制比例', min: -100, max: 100, step: 1, unit: '%', scale: 100 },
  { key: 'rudder', name: '方向舵控制比例', min: -100, max: 100, step: 1, unit: '%', scale: 100 },
 ];
 function testValue(key: 'height' | 'speed', input: HTMLInputElement) {
  const value = input.valueAsNumber;
  if (Number.isFinite(value)) onTestSettings({ ...testSettings, [key]: Math.max(key === 'height' ? 0 : 10, Math.min(key === 'height' ? 5000 : 150, value)) });
 }
 function windValue(key: keyof WindTunnelSettings, scale: number, input: HTMLInputElement) {
  const control = windControls.find(c => c.key === key)!, value = input.valueAsNumber;
  if (Number.isFinite(value)) onWindSettings({ ...windSettings, [key]: Math.max(control.min, Math.min(control.max, value)) / scale });
 }
</script>

<section class="laboratory-controls" aria-label={t(mode === 'test-space' ? '测试平台设置' : '风洞控制')}>
 <h2>{t(mode === 'test-space' ? '测试空间' : '风洞')} <small>{t('自由测试 · 不计成绩')}</small></h2>
 {#if mode === 'test-space'}
  <p>{t('10 × 10 × 10 km · 山地 / 沙滩 / 海洋')}</p>
  <details class="platform-options" open={!ready}>
  <summary>{t('平台高度')} {testSettings.height.toFixed(0)} m · {testSettings.catapult ? testSettings.speed.toFixed(0) + ' m/s' : t('跑道滑跑')}</summary>
  <fieldset disabled={ready}>
   <label for="platform-height">{t('平台高度')} <span><input aria-label={t('平台高度数值')} type="number" min="0" max="5000" step="1" value={testSettings.height} oninput={e => testValue('height', e.currentTarget)}/> m</span></label>
   <input id="platform-height" aria-label={t('平台高度')} type="range" min="0" max="5000" step="1" value={testSettings.height} oninput={e => testValue('height', e.currentTarget)}/>
   <label class="lab-check"><input aria-label={t('启用弹射')} type="checkbox" checked={testSettings.catapult} onchange={e => onTestSettings({ ...testSettings, catapult: e.currentTarget.checked })}/>{t('启用弹射')}</label>
   <label for="catapult-speed">{t('弹射末端速度')} <span><input aria-label={t('弹射末端速度数值')} disabled={!testSettings.catapult} type="number" min="10" max="150" value={testSettings.speed} oninput={e => testValue('speed', e.currentTarget)}/> m/s</span></label>
   <input id="catapult-speed" aria-label={t('弹射末端速度')} disabled={!testSettings.catapult} type="range" min="10" max="150" step="1" value={testSettings.speed} oninput={e => testValue('speed', e.currentTarget)}/>
  </fieldset>
  </details>
  <p>{t(ready ? '平台设置已锁定，重新试飞后可调整。' : testSettings.catapult ? '50 m 轨道 · 至少 1 G · 达到目标速度后滑行，轨道末端脱离。' : '弹射已关闭，使用飞机自身推力在轨道上滑跑起飞。')}</p>
 {:else}
  <p class="wind-direction">← {t('气流从右向左')} <small>{t('网格 1 m · 小刻度 0.1 m')}</small></p>
  {#each windControls as control}
   <div class="wind-control">
    <label for={`wind-${control.key}`}>{t(control.name)}<span><input aria-label={t(control.name + '数值')} type="number" min={control.min} max={control.max} step={control.step} value={windSettings[control.key] * control.scale} oninput={e => windValue(control.key, control.scale, e.currentTarget)}/>{control.unit}</span></label>
    <input id={`wind-${control.key}`} aria-label={t(control.name)} type="range" min={control.min} max={control.max} step={control.step} value={windSettings[control.key] * control.scale} oninput={e => windValue(control.key, control.scale, e.currentTarget)}/>
    <small>{t('实际值')} <output aria-label={t(control.name + '实际值')}>{(actualWind[control.key] * control.scale).toFixed(1)}</output> {control.unit}</small>
   </div>
  {/each}
  <p>{t('所有调整平滑过渡；气动解体后继续测试，手动停止后结束。')}</p>
  <div class="lab-cameras" aria-label={t('观察视角')}>{#each ['侧视', '俯视', '正视', '自由'] as camera}<button onclick={() => onCamera(camera)}>{t(camera)}</button>{/each}</div>
 {/if}
 <div class="lab-actions">
  {#if mode === 'wind-tunnel'}{#if !ready}<button class="primary flight-start" onclick={onStart}>{t('开始测试')}</button>{:else}<button onclick={onPause}>{t(paused ? '继续测试' : '暂停测试')}</button>{/if}{/if}
  {#if ready}<button onclick={onStop}>{t('停止测试')}</button>{/if}
 </div>
</section>
