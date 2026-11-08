export const actions = ['pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight', 'throttleUp', 'throttleDown', 'throttle', 'lookLeft', 'lookRight', 'lookUp', 'lookDown', 'pause', 'restart', 'camera', 'trimPitchUp', 'trimPitchDown', 'trimRollLeft', 'trimRollRight', 'autoTrim', 'adaptive', 'mouseStick'] as const;
export type Action = typeof actions[number];
export type Profile = 'keyboard' | 'gamepad' | 'joystick';
export type Binding = { kind: 'key' | 'button' | 'axis' | 'hat'; code?: string; index?: number; direction?: number };
export type AxisCalibration = { min: number; center: number; max: number; deadzone: number; inverted: boolean };
export const actionLabels: Record<Action, string> = {
  pitchUp: '低头', pitchDown: '抬头', rollLeft: '左滚转', rollRight: '右滚转', yawLeft: '左偏航', yawRight: '右偏航',
  throttleUp: '增加油门', throttleDown: '减少油门', throttle: '绝对油门', lookLeft: '向左看', lookRight: '向右看', lookUp: '向上看', lookDown: '向下看',
  pause: '开始／暂停', restart: '重新开始', camera: '切换视角', trimPitchUp: '增加俯仰配平', trimPitchDown: '减少俯仰配平',
  trimRollLeft: '向左滚转配平', trimRollRight: '向右滚转配平', autoTrim: '自动配平', adaptive: '自适应控制', mouseStick: '鼠标操纵杆',
};

type DeviceProfile = Exclude<Profile, 'keyboard'>;
type Settings = {
  bindings: Record<Profile, Record<Action, Binding[]>>;
  calibration: Record<string, AxisCalibration[]>;
  deviceProfiles: Record<string, DeviceProfile>;
};
export type InputDevice = { index: number; id: string; profile: DeviceProfile; axes: number[]; buttons: number[] };
type DeviceState = {
  view: InputDevice; raw: Gamepad; mapping: string; blockedButtons: boolean[];
  activityAxes: number[]; activityButtons: number[];
};
const storageKey = 'glider-3d.input.v1';
const profiles: readonly Profile[] = ['keyboard', 'gamepad', 'joystick'];
const defaultCalibration: AxisCalibration = { min: -1, center: 0, max: 1, deadzone: 0.08, inverted: false };
const groups: readonly (readonly Action[])[] = [
  ['pitchUp', 'pitchDown'], ['rollLeft', 'rollRight'], ['yawLeft', 'yawRight'],
  ['lookLeft', 'lookRight', 'lookUp', 'lookDown'], ['throttleUp', 'throttleDown', 'throttle'],
];
function values(): Record<Action, number> {
  return Object.fromEntries(actions.map(action => [action, 0])) as Record<Action, number>;
}
function defaults(): Settings {
  const bindings = Object.fromEntries(profiles.map(profile => [profile, Object.fromEntries(actions.map(action => [action, [] as Binding[]]))])) as Settings['bindings'];
  const keys = (action: Action, ...codes: string[]) => { bindings.keyboard[action] = codes.map(code => ({ kind: 'key', code })); };
  keys('pitchUp', 'KeyW', 'ArrowUp'); keys('pitchDown', 'KeyS', 'ArrowDown');
  keys('rollLeft', 'KeyA', 'ArrowLeft'); keys('rollRight', 'KeyD', 'ArrowRight');
  keys('yawLeft', 'KeyQ'); keys('yawRight', 'KeyE'); keys('throttleUp', 'Digit1', 'Numpad1'); keys('throttleDown', 'Digit2', 'Numpad2');
  keys('pause', 'Space'); keys('restart', 'KeyR'); keys('camera', 'KeyC'); keys('trimRollLeft', 'KeyH'); keys('trimRollRight', 'KeyL');
  keys('trimPitchDown', 'KeyJ'); keys('trimPitchUp', 'KeyK'); keys('autoTrim', 'KeyT'); keys('adaptive', 'KeyY'); keys('mouseStick', 'KeyX');
  const axis = (profile: DeviceProfile, action: Action, index: number, direction: number) => { bindings[profile][action] = [{ kind: 'axis', index, direction }]; };
  const button = (profile: DeviceProfile, action: Action, index: number) => { bindings[profile][action].push({ kind: 'button', index }); };
  for (const profile of ['gamepad', 'joystick'] as const) {
    axis(profile, 'rollLeft', 0, -1); axis(profile, 'rollRight', 0, 1);
    axis(profile, 'pitchUp', 1, -1); axis(profile, 'pitchDown', 1, 1);
    button(profile, 'pause', 0);
  }
  axis('gamepad', 'lookLeft', 2, -1); axis('gamepad', 'lookRight', 2, 1);
  axis('gamepad', 'lookUp', 3, -1); axis('gamepad', 'lookDown', 3, 1);
  button('gamepad', 'throttleDown', 4); button('gamepad', 'throttleUp', 5);
  button('gamepad', 'yawLeft', 6); button('gamepad', 'yawRight', 7);
  button('gamepad', 'restart', 3); button('gamepad', 'camera', 2);
  axis('joystick', 'yawLeft', 2, -1); axis('joystick', 'yawRight', 2, 1); axis('joystick', 'throttle', 3, -1);
  button('joystick', 'restart', 1);
  for (const [action, direction, index] of [['lookUp', 0, 12], ['lookRight', 2, 15], ['lookDown', 4, 13], ['lookLeft', 6, 14]] as const) {
    bindings.joystick[action] = [{ kind: 'hat', index: 9, direction }, { kind: 'button', index }];
  }
  return { bindings, calibration: Object.create(null), deviceProfiles: Object.create(null) };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
function validBinding(value: unknown, profile: Profile): value is Binding {
  if (!object(value)) return false;
  if (value.kind === 'key') return profile === 'keyboard' && exactKeys(value, ['kind', 'code']) && typeof value.code === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value.code);
  if (profile === 'keyboard' || !Number.isInteger(value.index) || (value.index as number) < 0 || (value.index as number) > 255) return false;
  if (value.kind === 'button') return exactKeys(value, ['kind', 'index']);
  if (!exactKeys(value, ['kind', 'index', 'direction'])) return false;
  if (value.kind === 'axis') return value.direction === undefined || value.direction === -1 || value.direction === 1;
  return value.kind === 'hat' && Number.isInteger(value.direction) && (value.direction as number) >= 0 && (value.direction as number) <= 7;
}
function validCalibration(value: unknown): value is AxisCalibration {
  return object(value) && exactKeys(value, ['min', 'center', 'max', 'deadzone', 'inverted']) &&
    typeof value.min === 'number' && Number.isFinite(value.min) && typeof value.center === 'number' && Number.isFinite(value.center) &&
    typeof value.max === 'number' && Number.isFinite(value.max) && value.min < value.center && value.center < value.max &&
    typeof value.deadzone === 'number' && Number.isFinite(value.deadzone) && value.deadzone >= 0 && value.deadzone <= 0.95 && typeof value.inverted === 'boolean';
}
function parseSettings(raw: string): Settings {
  const data: unknown = JSON.parse(raw);
  if (!object(data) || !exactKeys(data, ['version', 'bindings', 'calibration', 'deviceProfiles']) || data.version !== 1 ||
    !object(data.bindings) || !exactKeys(data.bindings, profiles) || !object(data.calibration) || !object(data.deviceProfiles)) throw new Error('invalid');
  const settings = defaults();
  for (const profile of profiles) {
    const bindings = data.bindings[profile];
    if (!object(bindings) || !exactKeys(bindings, actions)) throw new Error('invalid');
    for (const action of actions) {
      const row = bindings[action];
      if (!Array.isArray(row) || row.length > 32 || !row.every(binding => validBinding(binding, profile))) throw new Error('invalid');
      settings.bindings[profile][action] = row.map(binding => ({ ...binding }));
    }
  }
  for (const [id, calibration] of Object.entries(data.calibration)) {
    if (!Array.isArray(calibration) || calibration.length > 256 || !calibration.every(validCalibration)) throw new Error('invalid');
    settings.calibration[id] = calibration.map(axis => ({ ...axis }));
  }
  for (const [id, profile] of Object.entries(data.deviceProfiles)) {
    if (profile !== 'gamepad' && profile !== 'joystick') throw new Error('invalid');
    settings.deviceProfiles[id] = profile;
  }
  return settings;
}
function buttonValue(button: GamepadButton | undefined): number {
  return button && Number.isFinite(button.value) ? Math.max(0, Math.min(1, button.value)) : button?.pressed ? 1 : 0;
}

export class InputManager {
  settings: Settings = defaults();
  devices: InputDevice[] = [];
  private listeners = new Set<() => void>();
  private errors = new Set<string>();
  private states = new Map<number, DeviceState>();
  private heldKeys = new Set<string>();
  private blockedKeys = new Set<string>();
  private pendingKeys = new Set<Action>();
  private keyboard = values();
  private controller = values();
  private output = values();
  private previous = values();
  private edges = values();
  private blockedEdges = values();
  private active: DeviceState | undefined;
  private autoIndex: number | null = null;
  private selection: number | null = null;
  private paused = false;
  private throttleBaseline: number | null = null;
  private throttleOwned = false;

  constructor(private onError?: (message: string) => void) {
    this.output.throttle = -1;
    let raw: string | null;
    try { raw = globalThis.localStorage.getItem(storageKey); }
    catch { this.error('无法访问浏览器本地存储，输入设置仅在本次会话中生效。'); return; }
    if (raw === null) return;
    try { this.settings = parseSettings(raw); }
    catch { this.error('输入设置已损坏，已使用默认映射。'); }
  }
  get activeIndex(): number | null { return this.active?.view.index ?? null; }
  get selectedIndex(): number | null { return this.selection; }
  set selectedIndex(index: number | null) {
    if (index !== null && (!Number.isInteger(index) || index < 0)) throw new Error('输入设置无效。');
    if (this.selection === index) return;
    this.selection = index; this.active = undefined; this.throttleBaseline = null; this.throttleOwned = false;
    this.notify();
  }
  get suspended(): boolean { return this.paused; }
  set suspended(value: boolean) {
    if (this.paused === value) return;
    this.paused = value;
    this.clear();
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify(): void { for (const listener of this.listeners) listener(); }
  private error(message: string): void {
    if (!this.errors.has(message)) { this.errors.add(message); this.onError?.(message); }
  }
  private save(): void {
    try { globalThis.localStorage.setItem(storageKey, JSON.stringify({ version: 1, ...this.settings })); }
    catch { this.error('无法访问浏览器本地存储，输入设置仅在本次会话中生效。'); }
    this.clear(); this.notify();
  }
  setBinding(profile: Profile, action: Action, bindings: Binding[]): void {
    if (!profiles.includes(profile) || !actions.includes(action) || !Array.isArray(bindings) || bindings.length > 32 || !bindings.every(binding => validBinding(binding, profile))) throw new Error('输入设置无效。');
    this.settings.bindings[profile][action] = bindings.map(binding => ({ ...binding })); this.save();
  }
  resetBinding(profile: Profile, action: Action): void { this.setBinding(profile, action, defaults().bindings[profile][action]); }
  resetProfile(profile: Profile): void { this.settings.bindings[profile] = defaults().bindings[profile]; this.save(); }
  resetAll(): void {
    this.settings = defaults();
    for (const state of this.states.values()) state.view.profile = state.mapping === 'standard' ? 'gamepad' : 'joystick';
    this.active = undefined; this.save();
  }
  deviceProfile(id: string): DeviceProfile {
    if (Object.hasOwn(this.settings.deviceProfiles, id)) return this.settings.deviceProfiles[id];
    for (const state of this.states.values()) if (state.view.id === id) return state.mapping === 'standard' ? 'gamepad' : 'joystick';
    return 'joystick';
  }
  setDeviceProfile(id: string, profile: DeviceProfile): void {
    if (profile !== 'gamepad' && profile !== 'joystick') throw new Error('输入设置无效。');
    this.settings.deviceProfiles[id] = profile;
    for (const state of this.states.values()) if (state.view.id === id) state.view.profile = profile;
    this.active = undefined; this.save();
  }
  setCalibration(id: string, index: number, calibration: AxisCalibration): void {
    if (!Number.isInteger(index) || index < 0 || index > 255 || !validCalibration(calibration)) throw new Error('输入设置无效。');
    const axes = this.settings.calibration[id] ?? (this.settings.calibration[id] = []);
    while (axes.length <= index) axes.push({ ...defaultCalibration });
    axes[index] = { ...calibration }; this.save();
  }
  calibrateCenter(index: number): void {
    const state = this.states.get(index);
    if (!state) return;
    const calibration = this.settings.calibration[state.view.id] ?? [];
    const next = state.raw.axes.map((raw, axis) => {
      const saved = calibration[axis] ?? defaultCalibration;
      return { ...saved, center: Number.isFinite(raw) && raw > saved.min && raw < saved.max ? raw : saved.center };
    });
    this.settings.calibration[state.view.id] = next; this.save();
  }
  key(code: string, down: boolean): boolean {
    let mapped = false;
    for (const action of actions) {
      const row = this.settings.bindings.keyboard[action];
      if (!row.some(binding => binding.code === code)) continue;
      mapped = true;
      if (down && !this.paused && !this.blockedKeys.has(code) && !row.some(binding => binding.code && this.heldKeys.has(binding.code))) this.pendingKeys.add(action);
    }
    if (!down) { this.heldKeys.delete(code); this.blockedKeys.delete(code); }
    else if (mapped) {
      if (this.paused) this.blockedKeys.add(code);
      if (!this.blockedKeys.has(code)) this.heldKeys.add(code);
    }
    return mapped;
  }
  clear(): void {
    for (const code of this.heldKeys) this.blockedKeys.add(code);
    this.heldKeys.clear();
    this.pendingKeys.clear();
    for (const state of this.states.values()) for (let i = 0; i < state.raw.buttons.length; i++) if (buttonValue(state.raw.buttons[i]) > 0.1) state.blockedButtons[i] = true;
    for (const action of actions) { this.blockedEdges[action] = this.controller[action] > 0.5 ? 1 : 0; this.output[action] = this.previous[action] = this.edges[action] = 0; }
    this.output.throttle = -1; this.throttleOwned = false; this.throttleBaseline = null;
  }
  private axis(state: DeviceState, index: number): number {
    const raw = state.raw.axes[index];
    if (!Number.isFinite(raw)) return 0;
    const calibration = this.settings.calibration[state.view.id]?.[index] ?? defaultCalibration;
    let value = (raw - calibration.center) / (raw < calibration.center ? calibration.center - calibration.min : calibration.max - calibration.center);
    value = Math.max(-1, Math.min(1, value));
    value = Math.sign(value) * Math.max(0, (Math.abs(value) - calibration.deadzone) / (1 - calibration.deadzone));
    return calibration.inverted ? -value : value;
  }
  private bindingValue(state: DeviceState, action: Action, binding: Binding): number {
    const index = binding.index ?? 0;
    if (binding.kind === 'button') return state.blockedButtons[index] ? 0 : buttonValue(state.raw.buttons[index]);
    if (binding.kind === 'axis') {
      if (!Number.isFinite(state.raw.axes[index])) return action === 'throttle' ? -1 : 0;
      if (action === 'throttle') {
        const calibration = this.settings.calibration[state.view.id]?.[index] ?? defaultCalibration;
        let value = Math.max(0, Math.min(1, (state.raw.axes[index] - calibration.min) / (calibration.max - calibration.min)));
        if (calibration.inverted !== ((binding.direction ?? 1) < 0)) value = 1 - value;
        return value;
      }
      return Math.max(0, this.axis(state, index) * (binding.direction ?? 1));
    }
    if (binding.kind === 'hat') {
      const raw = state.raw.axes[index];
      if (!Number.isFinite(raw) || raw < -1 || raw > 1) return 0;
      const octant = Math.round((raw + 1) * 3.5), direction = binding.direction ?? 0;
      const distance = Math.abs(octant - direction);
      return distance === 0 || (direction % 2 === 0 && (distance === 1 || distance === 7)) ? 1 : 0;
    }
    return 0;
  }
  poll(gamepads?: readonly (Gamepad | null)[]): void {
    if (gamepads === undefined) {
      try {
        if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') { this.error('当前浏览器不支持 Gamepad API，请使用键盘控制。'); gamepads = []; }
        else gamepads = navigator.getGamepads();
      } catch { this.error('无法读取控制器，请在安全连接中允许控制器访问。'); gamepads = []; }
    }
    let changed = false;
    let meaningfulIndex: number | null = null;
    for (const [index, state] of this.states) {
      let found = false;
      for (const pad of gamepads) if (pad && pad.connected !== false && pad.index === index && pad.id === state.view.id && pad.mapping === state.mapping) { found = true; break; }
      if (!found) { this.states.delete(index); changed = true; if (this.selection === index) this.selection = null; }
    }
    for (const pad of gamepads) {
      if (!pad || pad.connected === false) continue;
      let state = this.states.get(pad.index);
      if (!state) {
        const profile = Object.hasOwn(this.settings.deviceProfiles, pad.id) ? this.settings.deviceProfiles[pad.id] : pad.mapping === 'standard' ? 'gamepad' : 'joystick';
        state = { view: { index: pad.index, id: pad.id, profile, axes: Array.from(pad.axes), buttons: Array.from(pad.buttons, buttonValue) }, raw: pad, mapping: pad.mapping,
          blockedButtons: Array.from(pad.buttons, button => buttonValue(button) > 0.1), activityAxes: Array.from(pad.axes), activityButtons: Array.from(pad.buttons, buttonValue) };
        this.states.set(pad.index, state); changed = true;
      }
      state.raw = pad;
      if (state.view.axes.length !== pad.axes.length || state.view.buttons.length !== pad.buttons.length) changed = true;
      for (let i = 0; i < pad.axes.length; i++) {
        const value = Number.isFinite(pad.axes[i]) ? pad.axes[i] : 0;
        if (!Number.isFinite(state.view.axes[i]) || Math.abs(state.view.axes[i] - value) >= 0.01) { state.view.axes[i] = value; changed = true; }
        if (!Number.isFinite(state.activityAxes[i]) || Math.abs(state.activityAxes[i] - value) >= 0.03) { state.activityAxes[i] = value; this.autoIndex = meaningfulIndex = pad.index; }
      }
      for (let i = 0; i < pad.buttons.length; i++) {
        const value = buttonValue(pad.buttons[i]);
        if (state.view.buttons[i] === undefined) state.blockedButtons[i] = value > 0.1;
        if (state.view.buttons[i] === undefined || Math.abs(state.view.buttons[i] - value) >= 0.01) { state.view.buttons[i] = value; changed = true; }
        if (state.activityButtons[i] === undefined || Math.abs(state.activityButtons[i] - value) >= 0.05) { state.activityButtons[i] = value; this.autoIndex = meaningfulIndex = pad.index; }
        if (value <= 0.1) state.blockedButtons[i] = false;
        else if (this.paused) state.blockedButtons[i] = true;
      }
      state.view.axes.length = pad.axes.length; state.view.buttons.length = pad.buttons.length;
    }
    if (changed) { this.devices.length = 0; for (const state of this.states.values()) this.devices.push(state.view); }
    let current = this.states.get(this.selection ?? this.autoIndex ?? -1);
    if (!current) current = this.states.values().next().value;
    const switched = current !== this.active;
    if (switched) { this.active = current; this.throttleOwned = false; this.throttleBaseline = null; }
    for (const action of actions) {
      let keyboard = 0;
      for (const binding of this.settings.bindings.keyboard[action]) if (binding.code && this.heldKeys.has(binding.code)) keyboard = 1;
      this.keyboard[action] = keyboard;
      let value = action === 'throttle' ? -1 : 0;
      if (current) for (const binding of this.settings.bindings[current.view.profile][action]) value = Math.max(value, this.bindingValue(current, action, binding));
      this.controller[action] = value;
      if (switched || this.paused) this.blockedEdges[action] = value > 0.5 && (this.paused || meaningfulIndex !== current?.view.index) ? 1 : 0;
      else if (value <= 0.5) this.blockedEdges[action] = 0;
      if (switched && meaningfulIndex === current?.view.index && !this.blockedEdges[action]) this.previous[action] = 0;
      this.output[action] = Math.max(keyboard, value);
    }
    const throttle = this.controller.throttle;
    const keyboardThrottle = this.keyboard.throttleUp > 0 || this.keyboard.throttleDown > 0 || this.keyboard.throttle > 0 || this.pendingKeys.has('throttleUp') || this.pendingKeys.has('throttleDown');
    if (throttle < 0) { this.throttleBaseline = null; this.throttleOwned = false; }
    else if (this.throttleBaseline === null || keyboardThrottle || this.paused) { this.throttleBaseline = throttle; this.throttleOwned = false; }
    else if (Math.abs(throttle - this.throttleBaseline) >= 0.02) { this.throttleOwned = true; this.throttleBaseline = throttle; }
    this.output.throttle = this.keyboard.throttle || (this.throttleOwned ? throttle : -1);
    for (const group of groups) {
      let keyboardHeld = false;
      for (const action of group) if (this.keyboard[action] > 0) keyboardHeld = true;
      if (keyboardHeld) for (const action of group) this.output[action] = action === 'throttle' && !this.keyboard[action] ? -1 : this.keyboard[action];
    }
    for (const action of actions) {
      const value = this.output[action];
      this.edges[action] = !this.paused && (this.pendingKeys.has(action) || (value > 0.5 && this.previous[action] <= 0.5 && (this.keyboard[action] > 0 || !this.blockedEdges[action]))) ? 1 : 0;
      this.previous[action] = value;
      if (this.paused) { this.output[action] = action === 'throttle' ? -1 : 0; this.edges[action] = 0; }
    }
    this.pendingKeys.clear();
    if (changed || switched) this.notify();
  }
  value(action: Action): number { return this.paused ? action === 'throttle' ? -1 : 0 : this.output[action]; }
  pressed(action: Action): boolean { return !this.paused && this.edges[action] === 1; }
}
