<script lang="ts">
 import { onMount, tick } from 'svelte';
 import { actionLabels, profileActions, signedActions, type InputManager, type Action, type Profile, type Binding, type AxisCalibration } from './input';
 import InputReadout from './InputReadout.svelte';
 import { language, t as translate, type TranslationParams } from './i18n';
 const t = $derived.by(() => { const locale = $language; return (source: string, params?: TranslationParams) => translate(source, params, locale); });
 let { input, onOpenChange, error = '' }: { input: InputManager; onOpenChange?: (open: boolean) => void; error?: string } = $props();
 let dialog: HTMLDialogElement, exitDialog: HTMLDialogElement, opener: HTMLButtonElement, cancelExitButton: HTMLButtonElement;
 let returnFocus: HTMLElement | null = null;
 let opened = $state(false), exitPending = $state(false), revision = $state(0), supported = $state(true);
 let profile = $state<Profile>('keyboard');
 let bindingAction = $state<Action | null>(null);
 let capture = $state(false), manualKind = $state<'button' | 'axis' | 'hat'>('button');
 let manualIndex = $state(0), manualDirection = $state(1), manualInverted = $state(false);
 let status = $state(''), saveError = $state(''), virtualThrottle = $state(0.5);
 let lastPreview = 0;
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
 const preview = $derived.by(() => { revision; return input.preview(profile); });
 const calibration = $derived.by(() => { revision; return activeDevice ? [...(input.settings.calibration[activeDevice.id] ?? [])] : []; });
 const canCapture = $derived(profile === 'keyboard' || !!activeDevice && activeDevice.profile === profile);
 const manualMax = $derived(Math.min(255, (manualKind === 'button' ? activeDevice?.buttons.length ?? 0 : activeDevice?.axes.length ?? 0) - 1));
 const isSigned = (action: Action) => (signedActions as readonly Action[]).includes(action);
 function dimensionBound(action: 'pitch' | 'roll' | 'yaw' | 'throttle') {
  if (action === 'throttle') return ['throttle', 'throttleUp', 'throttleDown'].some(item => bindings[item as Action].length > 0);
  if (profile !== 'keyboard') return bindings[action].length > 0;
  const pairs: Record<'pitch' | 'roll' | 'yaw', Action[]> = { pitch: ['pitchUp', 'pitchDown'], roll: ['rollLeft', 'rollRight'], yaw: ['yawLeft', 'yawRight'] };
  return pairs[action].some(item => bindings[item].length > 0);
 }
 function refreshPreview() {
  const now = performance.now(), dt = Math.min(0.1, Math.max(0, (now - lastPreview) / 1000));
  lastPreview = now;
  const current = input.preview(profile);
  if (current.throttle >= 0) virtualThrottle = current.throttle;
  else virtualThrottle = Math.max(0, Math.min(1, virtualThrottle + (current.throttleUp - current.throttleDown) * 0.35 * dt));
  revision++;
 }
 function open() {
  if (opened) return;
  input.beginEdit();
  opened = true;
  saveError = ''; status = ''; virtualThrottle = 0.5; lastPreview = performance.now();
  refreshPreview();
  dialog.showModal();
  onOpenChange?.(true);
 }
 function finish() {
  cancelBinding(); input.clearPreview(); input.clear(); input.suspended = false;
  opened = false; exitPending = false;
  if (exitDialog.open) exitDialog.close();
  dialog.close();
  onOpenChange?.(false);
  opener?.focus();
 }
 function save() {
  for (const field of dialog.querySelectorAll<HTMLInputElement>('input')) {
   if (field.closest('.binding-editor')) continue;
   if (!field.checkValidity()) { if (exitDialog.open) cancelExit(); field.reportValidity(); return; }
  }
  if (!input.saveEdit()) { saveError = t('保存失败。请允许浏览器本地存储后重试；设置尚未保存。'); return; }
  finish();
 }
 function discard() { input.discardEdit(); finish(); }
 async function requestExit() {
  if (!opened || exitPending) return;
  cancelBinding();
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  exitPending = true;
  await tick();
  if (opened && exitPending) { exitDialog.showModal(); cancelExitButton.focus(); }
 }
 function cancelExit() {
  exitPending = false;
  exitDialog.close();
  if (returnFocus?.isConnected && dialog.contains(returnFocus)) returnFocus.focus();
  else dialog.querySelector<HTMLButtonElement>('header button')?.focus();
 }
 function handleClose() {
  if (opened && input.editing) { dialog.showModal(); void requestExit(); }
 }
 function backdrop(event: MouseEvent) {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) void requestExit();
 }
 function cancelBinding() { bindingAction = null; capture = false; }
 function beginBinding(action: Action) {
  bindingAction = action; manualKind = action === 'throttle' || isSigned(action) ? 'axis' : 'button';
  manualIndex = 0; manualDirection = 1; manualInverted = false; status = ''; startCapture();
 }
 function startCapture() {
  capture = true;
  const device = activeDevice;
  captureDevice = device ? `${device.index}:${device.id}` : null;
  armedAxes = device ? device.axes.map(value => Math.abs(value) < 0.25) : [];
  armedButtons = device ? device.buttons.map(value => value < 0.25) : [];
 }
 function announce(message: string, displaced: readonly Action[]) {
  status = [message, ...displaced.map(action => bindings[action].length
   ? t('已移除{action}的重复绑定；其余绑定仍可使用。', { action: t(actionLabels[action]) })
   : t('当前{action}设置未绑定', { action: t(actionLabels[action]) }))].join(' ');
 }
 function saveBinding(binding: Binding) {
  if (!bindingAction) return;
  const action = bindingAction, current = input.settings.bindings[profile][action];
  const same = (existing: Binding) => existing.kind === binding.kind && existing.code === binding.code && existing.index === binding.index && existing.direction === binding.direction;
  const existingIndex = current.findIndex(same);
  const next = binding.kind === 'axis' && isSigned(action) ? [binding] : existingIndex < 0 ? [...current, binding] : current.map((existing, index) => index === existingIndex ? binding : existing);
  if (next.length > 32) { status = t('每个动作最多可添加 32 个绑定。请先清除后再添加。'); return; }
  cancelBinding();
  announce(t('已绑定：{action}', { action: t(actionLabels[action]) }), input.setBinding(profile, action, next));
 }
 function invertBinding(action: Action, index: number, inverted: boolean) {
  const next = bindings[action].map((binding, item) => item === index ? { ...binding, inverted } : binding);
  announce(t('已绑定：{action}', { action: t(actionLabels[action]) }), input.setBinding(profile, action, next));
 }
 function resetRow(action: Action) {
  cancelBinding();
  announce(t('已恢复默认：{action}', { action: t(actionLabels[action]) }), input.resetBinding(profile, action));
 }
 function captureController() {
  if (!opened || exitPending || !capture || !bindingAction || profile === 'keyboard') return;
  const device = activeDevice;
  if (!device || `${device.index}:${device.id}` !== captureDevice || device.profile !== profile) { cancelBinding(); return; }
  for (let index = 0; index < device.buttons.length; index++) {
   const value = device.buttons[index];
   if (value < 0.25) armedButtons[index] = true;
   else if (armedButtons[index] && value > 0.65) { saveBinding({ kind: 'button', index, inverted: manualInverted, ...(isSigned(bindingAction) ? { direction: manualDirection } : {}) }); return; }
  }
  for (let index = 0; index < device.axes.length; index++) {
   const value = device.axes[index];
   if (Math.abs(value) < 0.25) armedAxes[index] = true;
   else if (armedAxes[index] && Math.abs(value) > 0.65 && Math.abs(value) <= 1) {
    saveBinding({ kind: 'axis', index, inverted: manualInverted }); return;
   }
  }
 }
 function keydown(event: KeyboardEvent) {
  if (!opened || exitPending) return;
  if (event.key === 'Escape' && bindingAction) {
   event.preventDefault(); event.stopImmediatePropagation(); cancelBinding(); return;
  }
  if (event.code) input.previewKey(event.code, true);
  if (bindingAction && profile === 'keyboard' && capture) {
   event.preventDefault(); event.stopImmediatePropagation();
   if (!event.repeat && event.code) saveBinding({ kind: 'key', code: event.code });
  }
 }
 function keyup(event: KeyboardEvent) { if (opened && event.code) input.previewKey(event.code, false); }
 function clearPreview() { input.clearPreview(); lastPreview = performance.now(); revision++; }
 function bindingValue(action: Action, binding: Binding): number { revision; return input.previewBinding(profile, action, binding); }
 function bindingPressed(action: Action, binding: Binding, value: number): boolean {
  if (binding.kind === 'button') {
   if (!canCapture || activeDevice?.buttons[binding.index ?? -1] === undefined) return false;
   const physicalValue = isSigned(action) ? Math.abs(value) : binding.inverted ? 1 - value : value;
   return physicalValue > 0.001;
  }
  return binding.kind !== 'axis' && Math.abs(value) > 0.001;
 }
 function bindingText(binding: Binding): string {
  if (binding.kind === 'key') return binding.code ?? '';
  if (binding.kind === 'button') return t('按钮 {index}', { index: binding.index ?? 0 });
  if (binding.kind === 'hat') return t('帽开关 {index} · {direction}', { index: binding.index ?? 0, direction: t(hatLabels[binding.direction ?? 0] ?? '上') });
  return t('轴 {index}', { index: binding.index ?? 0 });
 }
 function selectProfile(value: Profile) { cancelBinding(); clearPreview(); profile = value; virtualThrottle = 0.5; status = ''; revision++; }
 function selectDevice(value: string) { cancelBinding(); clearPreview(); input.selectedIndex = value === 'auto' ? null : Number(value); input.clear(); revision++; }
 function resetProfile() { cancelBinding(); announce(t('当前配置已恢复默认'), input.resetProfile(profile)); }
 function resetAll() { cancelBinding(); clearPreview(); input.resetAll(); status = t('全部输入设置已恢复默认'); }
 function axisCalibration(index: number): AxisCalibration { return calibration[index] ?? { min: -1, center: 0, max: 1, deadzone: 0.08, inverted: false }; }
 function changeCalibration(index: number, field: 'min' | 'center' | 'max' | 'deadzone', element: HTMLInputElement) {
  element.setCustomValidity('');
  if (!element.checkValidity()) { element.reportValidity(); return; }
  const next = { ...axisCalibration(index), [field]: element.valueAsNumber };
  if (!Number.isFinite(element.valueAsNumber) || next.min >= next.center || next.center >= next.max) {
   element.setCustomValidity(t('校准值须满足：最小值 < 中心值 < 最大值。')); element.reportValidity(); return;
  }
  if (activeDevice) input.setCalibration(activeDevice.id, index, next);
 }
 onMount(() => {
  supported = typeof navigator.getGamepads === 'function';
  const unsubscribe = input.subscribe(() => { if (opened) { refreshPreview(); captureController(); } });
  window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup, true); window.addEventListener('blur', clearPreview);
  return () => {
   unsubscribe(); window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', clearPreview);
   if (opened) { input.discardEdit(); input.clearPreview(); input.clear(); input.suspended = false; onOpenChange?.(false); }
  };
 });
</script>

<button class="input-settings-trigger" bind:this={opener} type="button" aria-haspopup="dialog" aria-expanded={opened} onclick={open}>{t('输入设置')}</button>
<dialog bind:this={dialog} class="input-settings-dialog" aria-labelledby="input-settings-title" onclose={handleClose} oncancel={event => { event.preventDefault(); void requestExit(); }} onclick={backdrop}>
 <header><div><h2 id="input-settings-title">{t('输入设置')}</h2><p>{t('设置期间暂停操纵输入；关闭后恢复。')}</p></div><button type="button" onclick={save}>{t('保存')}</button></header>
 {#if error}<p class="error" role="alert">{t(error)}</p>{/if}
 {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
 <label class="profile-picker">{t('编辑输入配置')}<select value={profile} onchange={event => selectProfile(event.currentTarget.value as Profile)}>{#each profiles as item}<option value={item}>{t(profileLabels[item])}</option>{/each}</select></label>
 <section aria-labelledby="input-devices-title">
  <h3 id="input-devices-title">{t('控制器设备')}</h3>
  {#if !supported}<p role="status">{t('此浏览器无法使用 Gamepad API。请使用支持此 API 的浏览器，并通过 HTTPS 或 localhost 打开。键盘仍可使用。')}</p>
  {:else}
   <p>{t('连接控制器后按任意控制器按钮，让浏览器识别设备。拔出后停止该设备输入，重新连接后恢复。')}</p>
   <p role="status">{devices.length ? t('已连接 {count} 个控制器', { count: devices.length }) : t('未连接控制器，或设备已断开。键盘仍可使用。')}</p>
   <label>{t('活动控制器')}<select value={selectedIndex ?? 'auto'} onchange={event => selectDevice(event.currentTarget.value)}><option value="auto">{t('自动选择')}</option>{#each devices as device}<option value={device.index}>#{device.index} · {device.id}</option>{/each}{#if selectedIndex !== null && !devices.some(device => device.index === selectedIndex)}<option value={selectedIndex}>{t('设备 {index}（已断开）', { index: selectedIndex })}</option>{/if}</select></label>
   <ul class="devices">{#each devices as device}<li><span>#{device.index} · {device.id}</span><label>{t('设备类型')}<select value={device.profile} aria-label={t('设备 {index} 类型', { index: device.index })} onchange={event => { cancelBinding(); clearPreview(); input.setDeviceProfile(device.id, event.currentTarget.value as 'gamepad' | 'joystick'); }}><option value="gamepad">{t('手柄')}</option><option value="joystick">{t('飞行摇杆')}</option></select></label></li>{/each}</ul>
   <p>{t('标准映射设备自动识别为手柄，其他设备默认为飞行摇杆；可在此修改。')}</p>
  {/if}
 </section>
 <section aria-labelledby="input-bindings-title">
  <div class="section-heading"><h3 id="input-bindings-title">{t('动作映射')} · {t(profileLabels[profile])}</h3><button type="button" onclick={resetProfile}>{t('重置当前配置')}</button></div>
  <p>{t('一个动作可绑定多个输入；重复输入会从其他动作移除。键盘按键使用物理位置，不随键盘布局变化。')}</p>
  {#if profile !== 'keyboard' && !canCapture}<p>{t('请连接并选择相同类型的控制器，或修改设备类型后绑定。')}</p>{/if}
  <ul class="actions">
   {#each profileActions(profile) as action}
    <li data-action={action} class:capturing={bindingAction === action}>
     <div class="action-heading"><strong>{t(actionLabels[action])}</strong><output aria-label={t('{action}实时输出', { action: t(actionLabels[action]) })}>{bindings[action].length ? preview[action].toFixed(2) : t('未绑定')}</output></div>
     {#if !bindings[action].length}<meter class="action-meter unbound" min={isSigned(action) ? -1 : 0} max="1" value="0" aria-label={t('{action}实时输出', { action: t(actionLabels[action]) })} aria-valuetext={t('未绑定')} data-bound="false"></meter>{/if}
     <div class="binding-list">
      {#each bindings[action] as binding, index}
       {@const value = bindingValue(action, binding)}
       {@const pressed = bindingPressed(action, binding, value)}
       {@const analog = binding.kind === 'axis' || binding.kind === 'button'}
       <div class="binding-item">
        <span class="binding-chip" class:pressed={pressed} data-kind={binding.kind} data-index={binding.index} data-code={binding.code} data-pressed={pressed ? 'true' : 'false'}>
         {bindingText(binding)}{#if binding.kind !== 'axis'}<span>{pressed ? t('已按下') : t('已松开')}</span>{/if}
        </span>
        {#if analog}
         <div class="binding-live"><meter min={isSigned(action) ? -1 : 0} max="1" value={Math.max(isSigned(action) ? -1 : 0, value)} aria-label={t('{action} · {binding}归一化输出', { action: t(actionLabels[action]), binding: bindingText(binding) })}></meter><output>{value.toFixed(2)}</output></div>
         <label class="invert"><input type="checkbox" checked={binding.inverted ?? false} aria-label={t('反转绑定：{action} · {binding}', { action: t(actionLabels[action]), binding: bindingText(binding) })} onchange={event => invertBinding(action, index, event.currentTarget.checked)}/>{t('反转输入')}</label>
        {/if}
       </div>
      {/each}
     </div>
     <div class="row-buttons">
      <button type="button" disabled={!canCapture} aria-label={t('添加绑定：{action}', { action: t(actionLabels[action]) })} onclick={() => beginBinding(action)}>{t('添加绑定')}</button>
      <button type="button" aria-label={t('清除绑定：{action}', { action: t(actionLabels[action]) })} onclick={() => { cancelBinding(); input.setBinding(profile, action, []); status = t('已清除绑定：{action}', { action: t(actionLabels[action]) }); }}>{t('清除')}</button>
      <button type="button" aria-label={t('恢复默认：{action}', { action: t(actionLabels[action]) })} onclick={() => resetRow(action)}>{t('恢复默认')}</button>
     </div>
     {#if bindingAction === action}
      <div class="binding-editor">
       <p role="status">{profile === 'keyboard' ? t('请按要绑定的键；Escape 取消。') : capture ? t('先松开按钮并将摇杆回中，再按按钮或移动单个轴。非回中滑块和帽开关请手动指定。') : t('自动检测已停止，可手动指定输入。')}</p>
       {#if profile !== 'keyboard'}
        <div class="manual-fields">
         <label>{t('输入类型')}<select bind:value={manualKind} onchange={() => { capture = false; manualDirection = manualKind === 'hat' ? 0 : 1; }}><option value="button">{t('按钮')}</option><option value="axis">{t('轴')}</option><option value="hat">{t('帽开关（轴）')}</option></select></label>
         <label>{t('索引（从 0 开始）')}<input type="number" min="0" max={manualMax} step="1" required bind:value={manualIndex} onfocus={() => capture = false}/></label>
         {#if manualKind === 'hat' || manualKind === 'button' && isSigned(action)}<label>{t('方向')}<select bind:value={manualDirection} onfocus={() => capture = false}>{#if manualKind === 'hat'}{#each hatLabels as label, direction}<option value={direction}>{t(label)}</option>{/each}{:else}<option value={1}>{t('正向 +')}</option><option value={-1}>{t('反向 −')}</option>{/if}</select></label>{/if}
        </div>
        {#if manualKind !== 'hat'}<label class="invert"><input type="checkbox" bind:checked={manualInverted}/>{t('反转输入')}</label>{/if}
        {#if action === 'throttle'}<p>{t('绝对油门使用整轴行程；反转输入可交换最小和最大油门。')}</p>{/if}
        <p>{t('帽开关选择其所在轴及八向方向；索引可在下方实时轴读数中查找。')}</p>
        <div class="editor-buttons"><button type="button" disabled={!Number.isInteger(manualIndex) || manualIndex < 0 || manualIndex > manualMax || !canCapture} onclick={() => saveBinding({ kind: manualKind, index: manualIndex, ...(manualKind === 'hat' ? { direction: manualDirection } : { inverted: manualInverted, ...(manualKind === 'button' && isSigned(action) ? { direction: manualDirection } : {}) }) })}>{t('使用指定输入')}</button><button type="button" disabled={!canCapture} onclick={startCapture}>{t('重新检测')}</button></div>
       {/if}
       <button type="button" onclick={cancelBinding}>{t('取消绑定')}</button>
      </div>
     {/if}
    </li>
   {/each}
  </ul>
 </section>
 {#if activeDevice}
  <section aria-labelledby="input-calibration-title"><details>
   <summary id="input-calibration-title">{t('轴校准')} · #{activeDevice.index}</summary>
   <button type="button" disabled={!activeDevice.axes.length} onclick={() => input.calibrateCenter(activeDevice.index)}>{t('采集全部轴中心')}</button>
   <p>{t('先将各轴移动完整行程，查看实时值并填写最小值、最大值。松开摇杆回中后再采集中心；油门滑块请放在行程中点。死区用于消除中心漂移。')}</p>
   {#if !activeDevice.axes.length}<p>{t('此设备没有可用轴。')}</p>{/if}
   <div class="calibration-grid">{#each activeDevice.axes as value, index}
    {@const current = axisCalibration(index)}
    <fieldset class="axis-calibration"><legend>{t('轴 {index}', { index })}</legend>
     <div class="axis-live"><meter min="-1" max="1" value={Math.max(-1, Math.min(1, value))} aria-label={t('轴 {index} 实时值', { index })}></meter><output aria-live="off" aria-label={t('轴 {index} 实时值', { index })}>{value.toFixed(3)}</output></div>
     <div class="calibration-fields">{#each ['min', 'center', 'max', 'deadzone'] as field}
      {@const label = t(field === 'min' ? '最小值' : field === 'center' ? '中心值' : field === 'max' ? '最大值' : '死区')}
      <label>{label}<input type="number" aria-label={t('轴 {index} · {field}', { index, field: label })} min={field === 'deadzone' ? 0 : -1} max={field === 'deadzone' ? 0.95 : 1} step="any" required value={current[field as 'min' | 'center' | 'max' | 'deadzone']} oninput={event => event.currentTarget.setCustomValidity('')} onchange={event => changeCalibration(index, field as 'min' | 'center' | 'max' | 'deadzone', event.currentTarget)}/></label>
     {/each}</div>
     <label class="invert"><input type="checkbox" checked={current.inverted} onchange={event => input.setCalibration(activeDevice.id, index, { ...current, inverted: event.currentTarget.checked })}/>{t('反转轴')}</label>
    </fieldset>
   {/each}</div>
  </details></section>
 {/if}
 <section class="preview-section" aria-labelledby="input-preview-title"><div><h3 id="input-preview-title">{t('实时杆量')}</h3><p>{t('预览当前配置，不影响飞行。油门增减以每秒 35% 调整预览值。')}</p></div><InputReadout pitch={preview.pitch} roll={preview.roll} yaw={preview.yaw} throttle={preview.throttle >= 0 ? preview.throttle : virtualThrottle} pitchBound={dimensionBound('pitch')} rollBound={dimensionBound('roll')} yawBound={dimensionBound('yaw')} throttleBound={dimensionBound('throttle')}/></section>
 <footer><button type="button" onclick={resetAll}>{t('重置全部输入设置')}</button><button type="button" onclick={save}>{t('保存')}</button><p>{t('仅点击保存后写入此浏览器。输入同时出现时，键盘优先；松开后使用控制器。')}</p></footer>
 <p class="status" role="status" aria-live="polite">{status}</p>
</dialog>
<dialog bind:this={exitDialog} class="exit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="input-exit-title" aria-describedby="input-exit-description" oncancel={event => { event.preventDefault(); cancelExit(); }} onclose={() => { if (exitPending) cancelExit(); }}>
 <h2 id="input-exit-title">{t('保存输入设置？')}</h2><p id="input-exit-description">{t('保存当前设置，或不保存并恢复打开前的设置。取消可继续编辑。')}</p>
 {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
 <div class="exit-buttons"><button type="button" onclick={save}>{t('保存')}</button><button type="button" onclick={discard}>{t('不保存')}</button><button type="button" bind:this={cancelExitButton} onclick={cancelExit}>{t('取消')}</button></div>
</dialog>

<style>
 .input-settings-trigger{min-height:44px;min-width:44px;flex:none}
 dialog{color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:8px;max-width:none;max-height:calc(100dvh - 24px);padding:20px;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;box-shadow:0 18px 64px #173e4340}.input-settings-dialog{width:min(1080px,calc(100vw - 24px))}dialog::backdrop{background:#10282dcc}.exit-dialog{width:min(440px,calc(100vw - 24px))}
 header,.section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}header{margin-bottom:16px}header>div{flex:1;min-width:140px}h2{margin:0;font-size:22px}h3{margin:0 0 10px;font-size:16px}p{margin:8px 0 12px;font-size:12px;line-height:1.7;color:var(--muted)}
 button,select,input[type=number],summary{min-height:44px}button{min-width:44px}button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
 section{border-top:1px solid var(--line);margin-top:16px;padding-top:16px}label{display:flex;flex-direction:column;gap:5px;font-size:12px;min-width:0}select{width:100%;max-width:100%}.profile-picker{max-width:280px;font-weight:600}.section-heading button{font-size:12px}
 ul{list-style:none;margin:0;padding:0}.devices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.devices li{display:grid;grid-template-columns:minmax(0,1fr) 130px;gap:10px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:5px}.devices span{overflow-wrap:anywhere;font-size:12px}
 .actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;align-items:start}.actions>li{min-width:0;padding:10px;border:1px solid var(--line);border-radius:5px}.actions>li.capturing{border-color:var(--accent)}.action-heading{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}.action-heading strong{font-size:13px}output{font-variant-numeric:tabular-nums;font-size:12px;min-width:5ch;text-align:right}.action-meter{display:block;width:100%;height:14px;margin:6px 0}.action-meter.unbound{filter:grayscale(1);opacity:.4}
 .binding-list{display:grid;gap:6px}.binding-item{padding:6px;background:#6f8a820b;border:1px solid var(--line);border-radius:4px}.binding-chip{display:flex;justify-content:space-between;gap:6px;align-items:center;padding:5px 7px;min-height:28px;font-family:ui-monospace,monospace;font-size:11px;overflow-wrap:anywhere;color:var(--muted);border:1px solid transparent;border-radius:4px}.binding-chip.pressed{background:var(--ink);color:var(--panel);border-color:var(--ink)}.binding-live,.axis-live{display:flex;align-items:center;gap:8px}.binding-live meter,.axis-live meter{flex:1;width:0;min-width:0;height:16px;accent-color:var(--accent)}.binding-live{margin-top:5px}.row-buttons,.editor-buttons,.exit-buttons{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.row-buttons button{flex:1;padding-inline:5px}.row-buttons button,.binding-editor button{font-size:11px}
 .binding-editor{border-top:1px solid var(--line);padding-top:8px;margin-top:8px}.binding-editor>button{margin-top:8px}.manual-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.manual-fields input{width:100%}
 summary{cursor:pointer;font-size:16px;font-weight:600;padding-block:10px}.calibration-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}fieldset{min-width:0}.axis-calibration{border:1px solid var(--line);border-radius:5px;padding:10px;margin:0}.axis-calibration legend{font-size:13px;font-weight:600;padding:0 5px}.axis-live{margin-bottom:8px}.calibration-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.calibration-fields input{width:100%}.invert{flex-direction:row;align-items:center;gap:8px;min-height:44px;cursor:pointer}.invert input{width:20px;height:20px;margin:0;flex:none;accent-color:var(--accent)}
 .preview-section{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.preview-section>div{max-width:360px}footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line);margin-top:20px;padding-top:16px}footer p{flex-basis:100%;margin:0}.error{color:var(--accent);border:1px solid var(--accent);border-radius:5px;padding:12px}.status{margin-bottom:0;min-height:1.7em}.exit-buttons{justify-content:flex-end}
 @media(max-width:900px){.actions,.calibration-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.devices{grid-template-columns:minmax(0,1fr)}}
 @media(max-width:600px){dialog{padding:16px;max-height:calc(100dvh - 16px)}.input-settings-dialog{width:calc(100vw - 16px)}.actions,.calibration-grid{grid-template-columns:minmax(0,1fr)}header{gap:8px}h2{font-size:20px}.devices li{grid-template-columns:minmax(0,1fr)}.devices label{max-width:100%}.input-settings-trigger{padding-inline:8px;font-size:12px}}
 @media(max-height:540px){dialog{max-height:calc(100dvh - 16px);margin-block:8px;padding-block:16px}}
</style>
