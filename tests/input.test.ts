import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { actions, InputManager, type Action, type AxisCalibration } from '../src/input';

type TestPad = Gamepad & { axes: number[]; buttons: GamepadButton[] };
const storageKey = 'glider-3d.input.v1';
let saved: Map<string, string>;
beforeEach(() => {
  saved = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
  });
});
afterEach(() => vi.unstubAllGlobals());
function pad(index = 0, mapping = 'standard', id = `controller-${index}`): TestPad {
  return { index, mapping, id, connected: true, axes: mapping === 'standard' ? [0, 0, 0, 0] : [0, 0, 0, 1, 0, 0, 0, 0, 0, 3.285714],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })) } as unknown as TestPad;
}
function button(device: TestPad, index: number, value: number): void {
  device.buttons[index] = { value, pressed: value > 0.5, touched: value > 0 };
}

it('preserves every keyboard default and keeps absolute throttle inactive', () => {
  const input = new InputManager();
  expect(input.value('throttle')).toBe(-1);
  const defaults: [Action, string[]][] = [
    ['pitchUp', ['KeyW', 'ArrowUp']], ['pitchDown', ['KeyS', 'ArrowDown']], ['rollLeft', ['KeyA', 'ArrowLeft']], ['rollRight', ['KeyD', 'ArrowRight']],
    ['yawLeft', ['KeyQ']], ['yawRight', ['KeyE']], ['throttleUp', ['Digit1', 'Numpad1']], ['throttleDown', ['Digit2', 'Numpad2']],
    ['pause', ['Space']], ['restart', ['KeyR']], ['camera', ['KeyC']], ['trimRollLeft', ['KeyH']], ['trimRollRight', ['KeyL']],
    ['trimPitchDown', ['KeyJ']], ['trimPitchUp', ['KeyK']], ['autoTrim', ['KeyT']], ['adaptive', ['KeyY']], ['mouseStick', ['KeyX']],
  ];
  for (const [action, codes] of defaults) for (const code of codes) {
    expect(input.key(code, true)).toBe(true); input.poll([]);
    expect(input.value(action)).toBe(1); expect(input.pressed(action)).toBe(true);
    input.key(code, false); input.poll([]); expect(input.value(action)).toBe(0);
  }
  expect(input.key('KeyB', true)).toBe(false);
  expect(input.value('throttle')).toBe(-1);
  expect(input.settings.bindings.keyboard.lookLeft).toEqual([]);
});

it('uses signed gamepad sticks, analog trigger difference, shoulders and face defaults', () => {
  const input = new InputManager(), device = pad();
  input.poll([device]);
  device.axes = [-1, -1, 1, 1]; button(device, 6, 1); button(device, 7, 0.5); button(device, 4, 1);
  input.poll([device]);
  expect(input.value('rollLeft')).toBe(1); expect(input.value('rollRight')).toBe(0);
  expect(input.value('pitchUp')).toBe(1); expect(input.value('lookRight')).toBe(1); expect(input.value('lookDown')).toBe(1);
  expect(input.value('yawRight') - input.value('yawLeft')).toBe(-0.5);
  button(device, 7, 1); input.poll([device]); expect(input.value('yawRight') - input.value('yawLeft')).toBe(0);
  expect(input.value('throttleDown')).toBe(1); expect(input.value('throttle')).toBe(-1);
  button(device, 5, 1); input.poll([device]); expect(input.value('throttleUp')).toBe(1);
  for (const [index, action] of [[0, 'pause'], [3, 'restart'], [2, 'camera']] as const) {
    button(device, index, 1); input.poll([device]); expect(input.pressed(action)).toBe(true);
    expect(input.pressed(action)).toBe(true); input.poll([device]); expect(input.pressed(action)).toBe(false);
    button(device, index, 0); input.poll([device]);
  }
  expect(input.settings.bindings.gamepad.autoTrim).toEqual([]);
});

it('maps joystick axes, inverted slider, eight-way hat and optional dpad buttons', () => {
  const input = new InputManager(), device = pad(0, '');
  input.poll([device]); expect(input.devices[0].profile).toBe('joystick'); expect(input.value('throttle')).toBe(-1);
  device.axes[0] = 1; device.axes[1] = -1; device.axes[2] = -1; device.axes[3] = -1;
  input.poll([device]); expect(input.value('rollRight')).toBe(1); expect(input.value('pitchUp')).toBe(1);
  expect(input.value('yawLeft')).toBe(1); expect(input.value('throttle')).toBe(1);
  const looks: Action[] = ['lookUp', 'lookRight', 'lookDown', 'lookLeft'];
  const expected = [[1, 0, 0, 0], [1, 1, 0, 0], [0, 1, 0, 0], [0, 1, 1, 0], [0, 0, 1, 0], [0, 0, 1, 1], [0, 0, 0, 1], [1, 0, 0, 1]];
  for (let octant = 0; octant < 8; octant++) {
    device.axes[9] = -1 + octant * 2 / 7; input.poll([device]); expect(looks.map(action => input.value(action))).toEqual(expected[octant]);
  }
  device.axes[9] = 3.285714; input.poll([device]); expect(looks.map(action => input.value(action))).toEqual([0, 0, 0, 0]);
  for (const [index, action] of [[12, 'lookUp'], [15, 'lookRight'], [13, 'lookDown'], [14, 'lookLeft']] as const) {
    button(device, index, 1); input.poll([device]); expect(input.value(action)).toBe(1);
    button(device, index, 0); input.poll([device]);
  }
  button(device, 1, 1); input.poll([device]); expect(input.pressed('restart')).toBe(true);
  device.buttons.length = 2; input.poll([device]); expect(input.value('lookLeft')).toBe(0);
  expect(input.settings.bindings.joystick.camera).toEqual([]);
});

it('gives held keyboard priority across each directional group, not only each action', () => {
  const input = new InputManager(), device = pad();
  input.setBinding('keyboard', 'lookLeft', [{ kind: 'key', code: 'KeyB' }]); input.poll([device]);
  device.axes = [1, 1, 1, 1]; button(device, 7, 1); button(device, 5, 1);
  for (const code of ['KeyW', 'KeyA', 'KeyQ', 'KeyB', 'Digit2']) input.key(code, true);
  input.poll([device]);
  for (const action of ['pitchUp', 'rollLeft', 'yawLeft', 'lookLeft', 'throttleDown'] as const) expect(input.value(action)).toBe(1);
  for (const action of ['pitchDown', 'rollRight', 'yawRight', 'lookRight', 'lookDown', 'throttleUp'] as const) expect(input.value(action)).toBe(0);
  for (const code of ['KeyW', 'KeyA', 'KeyQ', 'KeyB', 'Digit2']) input.key(code, false);
  input.poll([device]); expect(input.value('rollRight')).toBe(1); expect(input.value('yawRight')).toBe(1);
});

it('takes slider ownership only on meaningful movement and releases it for keyboard throttle', () => {
  const input = new InputManager(), device = pad(0, ''); device.axes[3] = 0.4;
  input.poll([device]); input.poll([device]); expect(input.value('throttle')).toBe(-1);
  device.axes[3] = 0.39; input.poll([device]); expect(input.value('throttle')).toBe(-1);
  device.axes[3] = 0.2; input.poll([device]); expect(input.value('throttle')).toBeCloseTo(0.4);
  input.poll([device]); expect(input.value('throttle')).toBeCloseTo(0.4);
  input.key('Digit1', true); input.poll([device]); expect(input.value('throttle')).toBe(-1);
  device.axes[3] = 0; input.poll([device]); input.key('Digit1', false); input.poll([device]); expect(input.value('throttle')).toBe(-1);
  device.axes[3] = -0.5; input.poll([device]); expect(input.value('throttle')).toBeCloseTo(0.75);
  input.key('Digit2', true); input.key('Digit2', false); input.poll([device]); expect(input.value('throttle')).toBe(-1);
  input.clear(); input.poll([device]); expect(input.value('throttle')).toBe(-1);
});

it('preserves short keyboard taps, rejects repeat edges and clears queued and held input', () => {
  const input = new InputManager();
  input.key('Space', true); input.key('Space', false); input.poll([]);
  expect(input.value('pause')).toBe(0); expect(input.pressed('pause')).toBe(true); expect(input.pressed('pause')).toBe(true);
  input.poll([]); expect(input.pressed('pause')).toBe(false);
  input.key('Space', true); input.poll([]); expect(input.pressed('pause')).toBe(true);
  input.key('Space', true); input.poll([]); expect(input.pressed('pause')).toBe(false);
  input.clear(); input.key('Space', true); input.poll([]); expect(input.pressed('pause')).toBe(false); expect(input.value('pause')).toBe(0);
  input.key('Space', false); input.key('Space', true); input.poll([]); expect(input.pressed('pause')).toBe(true);
  input.key('Space', false); input.key('KeyR', true); input.key('KeyR', false); input.clear(); input.poll([]); expect(input.pressed('restart')).toBe(false);
});

it('suppresses initially held and cleared buttons until release, including reconnects', () => {
  const input = new InputManager(), device = pad(); button(device, 0, 1);
  input.poll([device]); expect(input.pressed('pause')).toBe(false); expect(input.value('pause')).toBe(0);
  button(device, 0, 0); input.poll([device]); button(device, 0, 1); input.poll([device]); expect(input.pressed('pause')).toBe(true);
  input.clear(); input.poll([device]); expect(input.value('pause')).toBe(0); expect(input.pressed('pause')).toBe(false);
  input.poll([]); input.poll([device]); expect(input.pressed('pause')).toBe(false);
  button(device, 0, 0); input.poll([device]); button(device, 0, 1); input.poll([device]); expect(input.pressed('pause')).toBe(true);
});

it('consumes edges while suspended but keeps raw controls visible and notified', () => {
  const input = new InputManager(), device = pad(); const listener = vi.fn(); input.subscribe(listener);
  input.poll([device]); input.suspended = true;
  device.axes[0] = 1; button(device, 0, 1); input.key('Space', true); input.poll([device]);
  expect(input.value('rollRight')).toBe(0); expect(input.value('throttle')).toBe(-1); expect(input.pressed('pause')).toBe(false);
  expect(input.devices[0].axes[0]).toBe(1); expect(input.devices[0].buttons[0]).toBe(1); expect(listener).toHaveBeenCalledTimes(2);
  input.suspended = false; input.poll([device]); expect(input.pressed('pause')).toBe(false); expect(input.value('rollRight')).toBe(1);
  input.key('Space', false); button(device, 0, 0); input.poll([device]); button(device, 0, 1); input.poll([device]); expect(input.pressed('pause')).toBe(true);
  input.suspended = true; input.poll([]); button(device, 3, 1); input.poll([device]); input.suspended = false; input.poll([device]); expect(input.pressed('restart')).toBe(false);
});

it('consumes axis-bound discrete edges on initial connection and while settings are open', () => {
  const input = new InputManager(), device = pad();
  input.setBinding('gamepad', 'pause', [{ kind: 'axis', index: 0, direction: 1 }]); device.axes[0] = 1;
  input.poll([device]); expect(input.pressed('pause')).toBe(false);
  device.axes[0] = 0; input.poll([device]); device.axes[0] = 1; input.poll([device]); expect(input.pressed('pause')).toBe(true);
  input.suspended = true; device.axes[0] = 0; input.poll([device]); device.axes[0] = 1; input.poll([device]);
  input.suspended = false; input.poll([device]); expect(input.pressed('pause')).toBe(false);
});

it('handles hotplug, sparse indices, selection fallback, index reuse and meaningful auto selection', () => {
  const input = new InputManager(), first = pad(2), second = pad(5, '', 'stick');
  input.poll([null, first, null, second]); expect(input.devices.map(device => device.index)).toEqual([2, 5]);
  expect(input.activeIndex).toBe(2);
  second.axes[0] = 0.005; input.poll([first, second]); expect(input.value('rollRight')).toBe(0);
  second.axes[0] = 1; input.poll([first, second]); expect(input.value('rollRight')).toBe(1);
  expect(input.activeIndex).toBe(5);
  input.selectedIndex = 2; input.poll([first, second]); expect(input.value('rollRight')).toBe(0);
  input.poll([null, second]); expect(input.selectedIndex).toBeNull(); expect(input.value('rollRight')).toBe(1);
  const replacement = pad(5, 'standard', 'replacement'); button(replacement, 0, 1);
  input.poll([replacement]); expect(input.devices[0].id).toBe('replacement'); expect(input.devices[0].profile).toBe('gamepad'); expect(input.pressed('pause')).toBe(false);
  replacement.connected = false; input.poll([replacement]); expect(input.devices).toEqual([]);
  expect(input.activeIndex).toBeNull();
});

it('allows a fresh press to activate an already connected idle controller', () => {
  const input = new InputManager(), first = pad(0), second = pad(1);
  input.poll([first, second]); expect(input.activeIndex).toBe(0);
  button(second, 0, 1); input.poll([first, second]);
  expect(input.activeIndex).toBe(1); expect(input.pressed('pause')).toBe(true);
  input.poll([first, second]); expect(input.pressed('pause')).toBe(false);
});

it('notifies only structural changes and significant raw axis/button changes', () => {
  const input = new InputManager(), device = pad(), listener = vi.fn(), unsubscribe = input.subscribe(listener);
  input.poll([device]); const devices = input.devices, axes = input.devices[0].axes;
  input.poll([device]); device.axes[0] = 0.005; button(device, 7, 0.005); input.poll([device]); expect(listener).toHaveBeenCalledTimes(1);
  device.axes[0] = 0.1; input.poll([device]); button(device, 7, 0.5); input.poll([device]); expect(listener).toHaveBeenCalledTimes(3);
  expect(input.devices).toBe(devices); expect(input.devices[0].axes).toBe(axes);
  unsubscribe(); input.poll([]); expect(listener).toHaveBeenCalledTimes(3);
});

it('applies asymmetric calibration bounds, normalized deadzone, inversion and sampled centers', () => {
  const input = new InputManager(), device = pad(0, ''); input.poll([device]);
  const calibration: AxisCalibration = { min: -0.8, center: 0.2, max: 0.9, deadzone: 0.1, inverted: false };
  input.setCalibration(device.id, 0, calibration);
  device.axes[0] = 0.24; input.poll([device]); expect(input.value('rollRight')).toBe(0);
  device.axes[0] = 0.55; input.poll([device]); expect(input.value('rollRight')).toBeCloseTo((0.5 - 0.1) / 0.9);
  device.axes[0] = -1; input.poll([device]); expect(input.value('rollLeft')).toBe(1);
  input.setCalibration(device.id, 0, { ...calibration, inverted: true }); input.poll([device]); expect(input.value('rollRight')).toBe(1);
  device.axes[0] = 0.1; device.axes[1] = -0.1; input.calibrateCenter(0); input.poll([device]);
  expect(input.value('rollRight')).toBe(0); expect(input.value('pitchUp')).toBe(0);
  expect(input.settings.calibration[device.id][0]).toEqual({ ...calibration, inverted: true, center: 0.1 });
  expect(input.settings.calibration[device.id][9].center).toBe(0);
  input.setCalibration(device.id, 3, { min: -0.8, center: 0.2, max: 0.8, deadzone: 0.3, inverted: true });
  input.poll([device]); device.axes[3] = -0.8; input.poll([device]); expect(input.value('throttle')).toBe(0);
  device.axes[3] = 0.8; input.poll([device]); expect(input.value('throttle')).toBe(1);
});

it('persists mappings, profile overrides and calibration safely across module instances', () => {
  const input = new InputManager(), device = pad(0, '', '__proto__'); input.poll([device]);
  input.setBinding('keyboard', 'pause', [{ kind: 'key', code: 'Enter' }]); input.setDeviceProfile(device.id, 'gamepad');
  input.setCalibration(device.id, 1, { min: -1, center: 0.1, max: 1, deadzone: 0.2, inverted: true });
  const loaded = new InputManager(); loaded.poll([device]);
  expect(loaded.devices[0].profile).toBe('gamepad'); expect(loaded.deviceProfile(device.id)).toBe('gamepad');
  expect(loaded.settings.calibration[device.id][1].inverted).toBe(true);
  expect(loaded.key('Space', true)).toBe(false); expect(loaded.key('Enter', true)).toBe(true);
  expect(Object.getPrototypeOf(loaded.settings.deviceProfiles)).toBeNull(); expect(Object.getPrototypeOf(loaded.settings.calibration)).toBeNull();
});

it('resets one row, one mapping profile, or all settings without changing unrelated rows', () => {
  const input = new InputManager(), device = pad(); input.poll([device]);
  input.setBinding('keyboard', 'pause', []); input.setBinding('keyboard', 'restart', []); input.setBinding('gamepad', 'pause', []);
  input.resetBinding('keyboard', 'pause'); expect(input.settings.bindings.keyboard.pause).toEqual([{ kind: 'key', code: 'Space' }]);
  expect(input.settings.bindings.keyboard.restart).toEqual([]); expect(input.settings.bindings.gamepad.pause).toEqual([]);
  input.resetProfile('keyboard'); expect(input.settings.bindings.keyboard.restart).toEqual([{ kind: 'key', code: 'KeyR' }]); expect(input.settings.bindings.gamepad.pause).toEqual([]);
  input.setDeviceProfile(device.id, 'joystick'); input.setCalibration(device.id, 0, { min: -1, center: 0, max: 1, deadzone: 0.3, inverted: false });
  input.resetAll(); expect(input.devices[0].profile).toBe('gamepad'); expect(input.settings.calibration).toEqual({}); expect(input.settings.deviceProfiles).toEqual({});
  expect(new InputManager().settings.bindings.gamepad.pause).toEqual([{ kind: 'button', index: 0 }]);
});

it('rejects malformed stored mappings and calibration without overwriting damaged records', () => {
  const baseline = new InputManager(); baseline.resetAll(); const valid = saved.get(storageKey)!;
  type Stored = { version: number; bindings: Record<string, Record<string, unknown>>; calibration: Record<string, unknown>; deviceProfiles: Record<string, unknown> };
  const mutations: ((value: Stored) => void)[] = [
    value => { value.version = 2; },
    value => { delete value.bindings.keyboard.pause; },
    value => { value.bindings.keyboard.extra = []; },
    value => { value.bindings.gamepad.pause = [{ kind: 'button', index: -1 }]; },
    value => { value.bindings.gamepad.pause = [{ kind: 'axis', index: 0, direction: 0 }]; },
    value => { value.bindings.joystick.lookUp = [{ kind: 'hat', index: 9, direction: 8 }]; },
    value => { value.bindings.keyboard.pause = [{ kind: 'key', code: 'Space', index: 1 }]; },
    value => { value.calibration.device = [{ min: 0, center: 0, max: 1, deadzone: 0.1, inverted: false }]; },
    value => { value.calibration.device = [{ min: -1, center: 0, max: 1, deadzone: 1, inverted: false }]; },
    value => { value.deviceProfiles.device = 'keyboard'; },
  ];
  for (const mutate of mutations) {
    const data = JSON.parse(valid); mutate(data); const damaged = JSON.stringify(data); saved.set(storageKey, damaged);
    const error = vi.fn(), input = new InputManager(error); expect(error).toHaveBeenCalledOnce();
    expect(input.settings.bindings.keyboard.pause).toEqual([{ kind: 'key', code: 'Space' }]); expect(saved.get(storageKey)).toBe(damaged);
  }
  saved.set(storageKey, '{'); const error = vi.fn(); new InputManager(error); expect(error).toHaveBeenCalledOnce();
  expect(() => baseline.setCalibration('device', 0, { min: -1, center: NaN, max: 1, deadzone: 0.1, inverted: false })).toThrow();
  expect(() => baseline.setBinding('gamepad', 'pause', [{ kind: 'button', index: Infinity }])).toThrow();
});

it('keeps settings usable when storage is blocked and reports each error only once', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new DOMException('blocked', 'SecurityError'); }, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } });
  const error = vi.fn(), input = new InputManager(error);
  expect(error).toHaveBeenCalledOnce(); input.setBinding('keyboard', 'pause', []); input.resetProfile('gamepad');
  expect(error).toHaveBeenCalledOnce(); expect(input.settings.bindings.keyboard.pause).toEqual([]);
  input.key('KeyW', true); input.poll([]); expect(input.value('pitchUp')).toBe(1);
});

it('guards unavailable and blocked Gamepad API and disconnects stale device input', () => {
  const error = vi.fn(), input = new InputManager(error), device = pad();
  vi.stubGlobal('navigator', {}); input.poll(); input.poll(); expect(error).toHaveBeenCalledOnce();
  vi.stubGlobal('navigator', { getGamepads: () => [device] }); device.axes[0] = 1; input.poll(); expect(input.value('rollRight')).toBe(1);
  vi.stubGlobal('navigator', { getGamepads: () => { throw new DOMException('insecure', 'SecurityError'); } });
  input.poll(); input.poll(); expect(error).toHaveBeenCalledTimes(2); expect(input.devices).toEqual([]); expect(input.value('rollRight')).toBe(0);
  expect(actions).toContain('adaptive');
});
