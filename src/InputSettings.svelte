<script lang="ts">
 import { onMount } from 'svelte';
 import { actions, actionLabels, type InputManager, type Action, type Profile, type Binding, type AxisCalibration } from './input';
 import { language, t as translate, type TranslationParams } from './i18n';
 const t = $derived.by(() => { const locale = $language; return (source: string, params?: TranslationParams) => translate(source, params, locale); });
 let { input, onOpenChange, error = '' }: { input: InputManager; onOpenChange?: (open: boolean) => void; error?: string } = $props();
 let dialog: HTMLDialogElement;
 let opener: HTMLButtonElement;
 let opened = $state(false), revision = $state(0), supported = $state(true);
 let profile = $state<Profile>('keyboard');
 let bindingAction = $state<Action | null>(null);
 let capture = $state(false), manualKind = $state<'button' | 'axis' | 'hat'>('button');
 let manualIndex = $state(0), manualDirection = $state(1);
 let status = $state('');
 const profiles: Profile[] = ['keyboard', 'gamepad', 'joystick'];
 const profileLabels: Record<Profile, string> = { keyboard: '键盘', gamepad: '手柄', joystick: '飞行摇杆' };
 const hatLabels = ['上', '右上', '右', '右下', '下', '左下', '左', '左上'];
 let armedAxes: boolean[] = [], armedButtons: boolean[] = [];
 let captureDevice: string | null = null;
 const devices = $derived.by(() => { revision; return input.devices.map(device => ({ ...device, axes: [...device.axes], buttons: [...device.buttons] })); });
 const selectedIndex = $derived.by(() => { revision; return input.selectedIndex; });
 const activeIndex = $derived.by(() => { revision; return input.activeIndex; });
 const activeDevice = $derived(devices.find(device => device.index === (selectedIndex ?? activeIndex)));
 const bindings = $derived.by(() => { revision; return { ...input.settings.bindings[profile] }; });
 const calibration = $derived.by(() => { revision; return activeDevice ? [...(input.settings.calibration[activeDevice.id] ?? [])] : []; });
 const canCapture = $derived(profile === 'keyboard' || !!activeDevice && activeDevice.profile === profile);
 const manualMax = $derived(Math.min(255, (manualKind === 'button' ? activeDevice?.buttons.length ?? 0 : activeDevice?.axes.length ?? 0) - 1));

 function open() {
  input.clear();
  input.suspended = true;
  opened = true;
  revision++;
  dialog.showModal();
  onOpenChange?.(true);
 }
 function closed() {
  if (!opened) return;
  cancelBinding();
  opened = false;
  input.clear();
  input.suspended = false;
  onOpenChange?.(false);
  opener?.focus();
 }
 function cancelBinding() { bindingAction = null; capture = false; }
 function beginBinding(action: Action) {
  bindingAction = action;
  manualKind = action === 'throttle' ? 'axis' : 'button';
  manualIndex = 0;
  manualDirection = 1;
  status = '';
  startCapture();
 }
 function startCapture() {
  capture = true;
  const device = activeDevice;
  captureDevice = device ? `${device.index}:${device.id}` : null;
  armedAxes = device ? device.axes.map(value => Math.abs(value) < 0.25) : [];
  armedButtons = device ? device.buttons.map(value => value < 0.25) : [];
 }
 function saveBinding(binding: Binding) {
  if (!bindingAction) return;
  const action = bindingAction;
  const current = input.settings.bindings[profile][action];
  cancelBinding();
  if (!current.some(existing => existing.kind === binding.kind && existing.code === binding.code && existing.index === binding.index && existing.direction === binding.direction)) {
   if (current.length >= 32) { status = t('每个动作最多可添加 32 个绑定。请先清除后再添加。'); return; }
   input.setBinding(profile, action, [...current, binding]);
  }
  status = t('已绑定：{action}', { action: t(actionLabels[action]) });
 }
 function captureController() {
  if (!opened || !capture || !bindingAction || profile === 'keyboard') return;
  const device = activeDevice;
  if (!device || `${device.index}:${device.id}` !== captureDevice || device.profile !== profile) { cancelBinding(); return; }
  for (let index = 0; index < device.buttons.length; index++) {
   const value = device.buttons[index];
   if (value < 0.25) armedButtons[index] = true;
   else if (armedButtons[index] && value > 0.65) { saveBinding({ kind: 'button', index }); return; }
  }
  for (let index = 0; index < device.axes.length; index++) {
   const value = device.axes[index];
   if (Math.abs(value) < 0.25) armedAxes[index] = true;
   else if (armedAxes[index] && Math.abs(value) > 0.65 && Math.abs(value) <= 1) {
    saveBinding({ kind: 'axis', index, direction: value < 0 ? -1 : 1 });
    return;
   }
  }
 }
 function keydown(event: KeyboardEvent) {
  if (!opened || !bindingAction) return;
  if (event.key === 'Escape') {
   event.preventDefault();
   event.stopImmediatePropagation();
   cancelBinding();
  } else if (profile === 'keyboard' && capture) {
   event.preventDefault();
   event.stopImmediatePropagation();
   if (!event.repeat && event.code) saveBinding({ kind: 'key', code: event.code });
  }
 }
 function bindingText(binding: Binding): string {
  if (binding.kind === 'key') return binding.code ?? '';
  if (binding.kind === 'button') return t('按钮 {index}', { index: binding.index ?? 0 });
  if (binding.kind === 'hat') return t('帽开关 {index} · {direction}', { index: binding.index ?? 0, direction: t(hatLabels[binding.direction ?? 0] ?? '上') });
  return t('轴 {index} · {direction}', { index: binding.index ?? 0, direction: binding.direction === -1 ? '−' : '+' });
 }
 function selectDevice(value: string) {
  cancelBinding();
  input.selectedIndex = value === 'auto' ? null : Number(value);
  input.clear();
  revision++;
 }
 function resetProfile() { cancelBinding(); input.resetProfile(profile); status = t('当前配置已恢复默认'); }
 function resetAll() { cancelBinding(); input.resetAll(); status = t('全部输入设置已恢复默认'); }
 function axisCalibration(index: number): AxisCalibration {
  return calibration[index] ?? { min: -1, center: 0, max: 1, deadzone: 0.08, inverted: false };
 }
 function changeCalibration(index: number, field: 'min' | 'center' | 'max' | 'deadzone', element: HTMLInputElement) {
  element.setCustomValidity('');
  if (!element.checkValidity()) { element.reportValidity(); return; }
  const next = { ...axisCalibration(index), [field]: element.valueAsNumber };
  if (!Number.isFinite(element.valueAsNumber) || next.min >= next.center || next.center >= next.max) {
   element.setCustomValidity(t('校准值须满足：最小值 < 中心值 < 最大值。'));
   element.reportValidity();
   return;
  }
  if (activeDevice) input.setCalibration(activeDevice.id, index, next);
 }
 onMount(() => {
  supported = typeof navigator.getGamepads === 'function';
  const unsubscribe = input.subscribe(() => { if (opened) { revision++; captureController(); } });
  window.addEventListener('keydown', keydown, true);
  return () => {
   unsubscribe();
   window.removeEventListener('keydown', keydown, true);
   if (opened) { input.clear(); input.suspended = false; onOpenChange?.(false); }
  };
 });
</script>

<button class="input-settings-trigger" bind:this={opener} type="button" aria-haspopup="dialog" aria-expanded={opened} onclick={open}>{t('输入设置')}</button>
<dialog bind:this={dialog} class="input-settings-dialog" aria-labelledby="input-settings-title" onclose={closed} oncancel={event => { if (bindingAction) { event.preventDefault(); cancelBinding(); } }}>
 <header>
  <div><h2 id="input-settings-title">{t('输入设置')}</h2><p>{t('设置期间暂停操纵输入；关闭后恢复。')}</p></div>
  <button type="button" onclick={() => dialog.close()}>{t('关闭')}</button>
 </header>
 {#if error}<p class="error" role="alert">{t(error)}</p>{/if}
 <label class="profile-picker">{t('编辑输入配置')}
  <select value={profile} onchange={event => { cancelBinding(); profile = event.currentTarget.value as Profile; status = ''; }}>
   {#each profiles as item}<option value={item}>{t(profileLabels[item])}</option>{/each}
  </select>
 </label>
 <section aria-labelledby="input-devices-title">
  <h3 id="input-devices-title">{t('控制器设备')}</h3>
  {#if !supported}
   <p role="status">{t('此浏览器无法使用 Gamepad API。请使用支持此 API 的浏览器，并通过 HTTPS 或 localhost 打开。键盘仍可使用。')}</p>
  {:else}
   <p>{t('连接控制器后按任意控制器按钮，让浏览器识别设备。拔出后停止该设备输入，重新连接后恢复。')}</p>
   <p role="status">{devices.length ? t('已连接 {count} 个控制器', { count: devices.length }) : t('未连接控制器，或设备已断开。键盘仍可使用。')}</p>
   <label>{t('活动控制器')}
    <select value={selectedIndex ?? 'auto'} onchange={event => selectDevice(event.currentTarget.value)}>
     <option value="auto">{t('自动选择')}</option>
     {#each devices as device}<option value={device.index}>#{device.index} · {device.id}</option>{/each}
     {#if selectedIndex !== null && !devices.some(device => device.index === selectedIndex)}<option value={selectedIndex}>{t('设备 {index}（已断开）', { index: selectedIndex })}</option>{/if}
    </select>
   </label>
   <ul class="devices">
    {#each devices as device}
     <li><span>#{device.index} · {device.id}</span><label>{t('设备类型')}
      <select value={device.profile} aria-label={t('设备 {index} 类型', { index: device.index })} onchange={event => { cancelBinding(); input.setDeviceProfile(device.id, event.currentTarget.value as 'gamepad' | 'joystick'); }}>
       <option value="gamepad">{t('手柄')}</option><option value="joystick">{t('飞行摇杆')}</option>
      </select>
     </label></li>
    {/each}
   </ul>
   <p>{t('标准映射设备自动识别为手柄，其他设备默认为飞行摇杆；可在此修改。')}</p>
  {/if}
 </section>
 <section aria-labelledby="input-bindings-title">
  <div class="section-heading"><h3 id="input-bindings-title">{t('动作映射')} · {t(profileLabels[profile])}</h3><button type="button" onclick={resetProfile}>{t('重置当前配置')}</button></div>
  <p>{t('一个动作可绑定多个输入。添加绑定保留原有映射；先清除可替换映射。键盘按键使用物理位置，不随键盘布局变化。')}</p>
  {#if profile !== 'keyboard' && !canCapture}<p>{t('请连接并选择相同类型的控制器，或修改设备类型后绑定。')}</p>{/if}
  <ul class="actions">
   {#each actions as action}
    <li class:capturing={bindingAction === action}>
     <div class="action-heading"><strong>{t(actionLabels[action])}</strong><span class="binding-values">{bindings[action].length ? bindings[action].map(bindingText).join(' / ') : t('未绑定')}</span></div>
     <div class="row-buttons">
      <button type="button" disabled={!canCapture} aria-label={t('添加绑定：{action}', { action: t(actionLabels[action]) })} onclick={() => beginBinding(action)}>{t('添加绑定')}</button>
      <button type="button" aria-label={t('清除绑定：{action}', { action: t(actionLabels[action]) })} onclick={() => { cancelBinding(); input.setBinding(profile, action, []); }}>{t('清除')}</button>
      <button type="button" aria-label={t('恢复默认：{action}', { action: t(actionLabels[action]) })} onclick={() => { cancelBinding(); input.resetBinding(profile, action); }}>{t('恢复默认')}</button>
     </div>
     {#if bindingAction === action}
      <div class="binding-editor">
       <p role="status">{profile === 'keyboard' ? t('请按要绑定的键；Escape 取消。') : capture ? t('先松开按钮并将摇杆回中，再按按钮或移动单个轴。非回中滑块和帽开关请手动指定。') : t('自动检测已停止，可手动指定输入。')}</p>
       {#if profile !== 'keyboard'}
        <div class="manual-fields">
         <label>{t('输入类型')}<select bind:value={manualKind} onchange={() => { capture = false; manualDirection = manualKind === 'hat' ? 0 : 1; }}><option value="button">{t('按钮')}</option><option value="axis">{t('轴')}</option><option value="hat">{t('帽开关（轴）')}</option></select></label>
         <label>{t('索引（从 0 开始）')}<input type="number" min="0" max={manualMax} step="1" bind:value={manualIndex} onfocus={() => capture = false}/></label>
         {#if manualKind !== 'button'}<label>{t('方向')}<select bind:value={manualDirection} onfocus={() => capture = false}>
          {#if manualKind === 'hat'}{#each hatLabels as label, direction}<option value={direction}>{t(label)}</option>{/each}{:else}<option value={1}>{t('正向 +')}</option><option value={-1}>{t('反向 −')}</option>{/if}
         </select></label>{/if}
        </div>
        {#if action === 'throttle'}<p>{t('绝对油门使用整轴行程；方向反转可交换最小和最大油门。')}</p>{/if}
        <p>{t('帽开关选择其所在轴及八向方向；索引可在下方实时轴读数中查找。')}</p>
        <div class="editor-buttons"><button type="button" disabled={!Number.isInteger(manualIndex) || manualIndex < 0 || manualIndex > manualMax || !canCapture} onclick={() => saveBinding({ kind: manualKind, index: manualIndex, ...(manualKind === 'button' ? {} : { direction: manualDirection }) })}>{t('使用指定输入')}</button><button type="button" disabled={!canCapture} onclick={startCapture}>{t('重新检测')}</button></div>
       {/if}
       <button type="button" onclick={cancelBinding}>{t('取消绑定')}</button>
      </div>
     {/if}
    </li>
   {/each}
  </ul>
 </section>
 {#if activeDevice}
  <section aria-labelledby="input-calibration-title">
   <div class="section-heading"><h3 id="input-calibration-title">{t('轴校准')} · #{activeDevice.index}</h3><button type="button" disabled={!activeDevice.axes.length} onclick={() => input.calibrateCenter(activeDevice.index)}>{t('采集全部轴中心')}</button></div>
   <p>{t('先将各轴移动完整行程，查看实时值并填写最小值、最大值。松开摇杆回中后再采集中心；油门滑块请放在行程中点。死区用于消除中心漂移。')}</p>
   {#if !activeDevice.axes.length}<p>{t('此设备没有可用轴。')}</p>{/if}
   {#each activeDevice.axes as value, index}
    {@const current = axisCalibration(index)}
    <fieldset class="axis-calibration">
     <legend>{t('轴 {index}', { index })}</legend>
     <div class="axis-live"><meter min="-1" max="1" value={Math.max(-1, Math.min(1, value))} aria-label={t('轴 {index} 实时值', { index })}></meter><output aria-live="off" aria-label={t('轴 {index} 实时值', { index })}>{value.toFixed(3)}</output></div>
     <div class="calibration-fields">
      {#each ['min', 'center', 'max', 'deadzone'] as field}
       <label>{t(field === 'min' ? '最小值' : field === 'center' ? '中心值' : field === 'max' ? '最大值' : '死区')}<input type="number" min={field === 'deadzone' ? 0 : -1} max={field === 'deadzone' ? 0.95 : 1} step="any" required value={current[field as 'min' | 'center' | 'max' | 'deadzone']} oninput={event => event.currentTarget.setCustomValidity('')} onchange={event => changeCalibration(index, field as 'min' | 'center' | 'max' | 'deadzone', event.currentTarget)}/></label>
      {/each}
     </div>
     <div class="axis-buttons"><label class="invert"><input type="checkbox" checked={current.inverted} onchange={event => input.setCalibration(activeDevice.id, index, { ...current, inverted: event.currentTarget.checked })}/>{t('反转轴')}</label></div>
    </fieldset>
   {/each}
  </section>
 {/if}
 <footer><button type="button" onclick={resetAll}>{t('重置全部输入设置')}</button><p>{t('设置自动保存在此浏览器。输入同时出现时，键盘优先；松开后使用控制器。')}</p></footer>
 <p class="status" role="status" aria-live="polite">{status}</p>
</dialog>

<style>
 .input-settings-trigger{min-height:44px;min-width:44px;flex:none}
 dialog{color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:8px;width:min(880px,calc(100vw - 24px));max-width:none;max-height:calc(100dvh - 24px);padding:24px;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;box-shadow:0 18px 64px #173e4340}
 dialog::backdrop{background:#10282dcc}
 header,.section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
 header{margin-bottom:20px}header>div{flex:1;min-width:140px}h2{margin:0;font-size:22px}h3{margin:0 0 12px;font-size:16px}p{margin:8px 0 12px;font-size:12px;line-height:1.7;color:var(--muted)}
 button,select,input[type=number]{min-height:44px}button{min-width:44px}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
 section{border-top:1px solid var(--line);margin-top:20px;padding-top:20px}label{display:flex;flex-direction:column;gap:6px;font-size:12px;min-width:0}select{width:100%;max-width:100%}.profile-picker{max-width:280px;font-weight:600}.section-heading button{font-size:12px}
 ul{list-style:none;margin:0;padding:0}.devices{display:grid;gap:8px;margin-top:12px}.devices li{display:grid;grid-template-columns:minmax(0,1fr) minmax(130px,180px);gap:12px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:5px}.devices span{overflow-wrap:anywhere;font-size:12px}
 .actions{display:grid;gap:8px}.actions>li{padding:14px;border:1px solid var(--line);border-radius:5px}.actions>li.capturing{border-color:var(--accent)}.action-heading{display:flex;justify-content:space-between;align-items:baseline;gap:8px 16px;flex-wrap:wrap}.action-heading strong{font-size:13px}.binding-values{font-family:ui-monospace,monospace;font-size:12px;overflow-wrap:anywhere;color:var(--muted)}.row-buttons,.editor-buttons{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.row-buttons button,.binding-editor button{font-size:12px}
 .binding-editor{border-top:1px solid var(--line);padding-top:12px;margin-top:12px}.binding-editor>button{margin-top:10px}.manual-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.manual-fields input{width:100%}
 fieldset{min-width:0}.axis-calibration{border:1px solid var(--line);border-radius:5px;padding:14px;margin:14px 0 0}.axis-calibration legend{font-size:13px;font-weight:600;padding:0 6px}.axis-live{display:flex;align-items:center;gap:12px;margin-bottom:12px}.axis-live meter{flex:1;width:0;min-width:0;height:20px;accent-color:var(--accent)}output{font-variant-numeric:tabular-nums;font-size:12px;min-width:6ch;text-align:right}.calibration-fields{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.calibration-fields input{width:100%}.axis-buttons{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}.invert{flex-direction:row;align-items:center;min-height:44px;cursor:pointer}.invert input{width:20px;height:20px;margin:0 6px 0 0}
 footer{border-top:1px solid var(--line);margin-top:24px;padding-top:20px}.error{color:var(--accent);border:1px solid var(--accent);border-radius:5px;padding:12px}.status{margin-bottom:0;min-height:1.7em}
 @media(max-width:520px){dialog{padding:16px;width:calc(100vw - 16px);max-height:calc(100dvh - 16px)}header{gap:8px}h2{font-size:20px}.devices li{grid-template-columns:minmax(0,1fr)}.devices label{max-width:100%}.manual-fields,.calibration-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.manual-fields label:first-child{grid-column:1/-1}.row-buttons{gap:6px}.row-buttons button{flex:1;padding-inline:7px}.actions>li{padding:12px}.input-settings-trigger{padding-inline:8px;font-size:12px}}
 @media(max-height:540px){dialog{max-height:calc(100dvh - 16px);margin-block:8px;padding-block:16px}}
</style>
