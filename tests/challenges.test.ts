import { describe, expect, it } from 'vitest';
import { clone, defaultAircraft, engineMounts, fuelTankLimits, presets, type Controls, type FlightMode } from '../src/model';
import { derive, FlightSimulation } from '../src/physics';
import { challengeCenter, challengeCheckpoints, challengeDefinitions, challengeTerrainGrid, challengeTerrainHeight } from '../src/challenges';
import { engineCatalog } from '../src/engines';

const neutral: Controls = { weight: 0, lateral: 0, rudder: 0, elevator: 0, aileron: 0 };
function create(mode: FlightMode = 'standard') {
  return new FlightSimulation(presets.find(d => !d.birdman)!, mode, 'downhill', 0);
}

describe('三轴操纵与高山路径边界', () => {
  it('鸟人间设计限制在构造处生效，各物理模式不开放违规舵面', () => {
    expect(() => new FlightSimulation(presets.find(d => !d.birdman)!)).toThrow('鸟人间');
    for (const mode of ['standard', 'assisted', 'experimental'] as const) {
      const plain = new FlightSimulation(defaultAircraft, mode, 'birdman', 0);
      const commanded = new FlightSimulation(defaultAircraft, mode, 'birdman', 0);
      for (const s of [plain, commanded]) { s.launching = false; s.position.set(40, 80, 0); s.quaternion.identity(); s.velocity.set(12, -1, 0); }
      plain.step(neutral); commanded.step({ ...neutral, elevator: 1, aileron: 1 });
      expect(commanded.position.toArray()).toEqual(plain.position.toArray());
      expect(commanded.omega.toArray()).toEqual(plain.omega.toArray());
    }
  });

  it.each(['standard', 'assisted', 'experimental'] as const)('%s 非鸟人间三轴产生独立实际力矩，正输入低头、右滚、右偏', mode => {
    const base = create(mode); base.step(neutral, 1e-7);
    for (const [control, axis, sign] of [['elevator', 'z', -1], ['aileron', 'x', 1], ['rudder', 'y', -1]] as const) {
      const s = create(mode); s.step({ ...neutral, [control]: 0.2 }, 1e-7);
      expect((s.telemetry.torque[axis] - base.telemetry.torque[axis]) * sign).toBeGreaterThan(1);
    }
    const disabled = clone(base.definition); disabled.mainWing.controlSurface = 0; disabled.horizontalTail.controlSurface = 0;
    const a = new FlightSimulation(disabled, mode, 'downhill', 0), b = new FlightSimulation(disabled, mode, 'downhill', 0);
    a.step(neutral); b.step({ ...neutral, elevator: 1, aileron: 1 });
    expect(a.position.toArray()).toEqual(b.position.toArray()); expect(a.omega.toArray()).toEqual(b.omega.toArray());
  });

  it('侧移同时改变CG、惯量和真实滚转，重放完整保留侧向输入', () => {
    const center = derive(defaultAircraft), right = derive(defaultAircraft, 0, 1), left = derive(defaultAircraft, 0, -1);
    expect(right.cg.z).toBeGreaterThan(0); expect(left.cg.z).toBeCloseTo(-right.cg.z, 12);
    expect(right.inertia.x).toBeGreaterThan(center.inertia.x); expect(right.inertia.y).toBeGreaterThan(center.inertia.y);
    const s = create(), plain = create();
    for (let i = 0; i < 20; i++) { s.step({ ...neutral, lateral: 1 }); plain.step(neutral); }
    expect(s.aircraft.cg.z).toBeGreaterThan(plain.aircraft.cg.z); expect(s.aircraft.inertia.x).toBeGreaterThan(plain.aircraft.inertia.x);
    expect(s.omega.x).toBeGreaterThan(plain.omega.x);
    const t = s.telemetry;
    expect(Math.abs(t.energy + t.dissipatedEnergy - t.initialEnergy - t.controlWork) / t.initialEnergy).toBeLessThan(1e-8);
    const replay = create(); replay.loadReplay(s.getRecording());
    while (!replay.replayFinished) replay.step(neutral);
    expect(replay.position.toArray()).toEqual(s.position.toArray()); expect(replay.aircraft.cg.toArray()).toEqual(s.aircraft.cg.toArray());
  });

  it('山谷可复现且三角插值匹配，从山顶空中立即开始真实计时', () => {
    const a = create(), b = create(), start = challengeDefinitions.downhill;
    expect(a.launching).toBe(false); expect(a.position.toArray()).toEqual(b.position.toArray());
    expect(a.position.y).toBe(start.startHeight); expect(a.velocity.length()).toBeCloseTo(start.startSpeed);
    expect(a.telemetry.groundClearance).toBeGreaterThan(0);
    expect(challengeCenter('downhill', 300)).not.toBe(challengeCenter('downhill', 600));
    const h = (x: number, z: number) => challengeTerrainHeight('downhill', x, z), step = challengeTerrainGrid.step;
    expect(h(2, 3)).toBeCloseTo(h(0, 0) * 0.5 + h(step, 0) * 0.2 + h(0, step) * 0.3, 12);
    expect(h(8, 7)).toBeCloseTo(h(step, step) * 0.5 + h(0, step) * 0.2 + h(step, 0) * 0.3, 12);
    a.step(neutral); expect(a.time).toBeCloseTo(1 / 60, 12); expect(a.telemetry.initialEnergy).toBeGreaterThan(0);
  });

  it('仅实际向前穿过下一扇门算进度，漏门或直接到终点不能完成', () => {
    const gates = challengeCheckpoints('downhill'), first = gates[0], last = gates[gates.length - 1];
    const s = create(); s.position.set(first.x - 0.2, first.y + 60, first.z); s.velocity.set(30, 0, 0); s.quaternion.identity(); s.step(neutral);
    expect(s.telemetry.challengeProgress).toBe(0.1); expect(s.ended).toBe(false);
    const skipped = create(); skipped.position.set(last.x - 0.2, last.y + 60, last.z); skipped.velocity.set(30, 0, 0); skipped.quaternion.identity(); skipped.step(neutral);
    expect(skipped.result?.completed).toBe(false); expect(skipped.result?.landing).toBe('boundary'); expect(skipped.telemetry.challengeProgress).toBe(0);
    const missed = create(); missed.position.set(first.x - 0.2, first.y + first.maxHeight + 1, first.z); missed.velocity.set(30, 0, 0); missed.quaternion.identity(); missed.step(neutral);
    expect(missed.result?.completed).toBe(false); expect(missed.telemetry.challengeProgress).toBe(0);
  });

  it('山坡按机体接触终止，飞出谷道不能得到完成成绩', () => {
    const crash = create(); crash.position.y = challengeTerrainHeight('downhill', crash.position.x, crash.position.z) - 1;
    crash.step(neutral); expect(crash.result?.landing).toBe('terrain'); expect(crash.result?.completed).toBe(false);
    const shortcut = create(); shortcut.position.z += 66; shortcut.position.y = challengeTerrainHeight('downhill', shortcut.position.x, shortcut.position.z) + 30;
    shortcut.step(neutral); expect(shortcut.result?.landing).toBe('boundary'); expect(shortcut.result?.completed).toBe(false);
  });
});

function lowAltitude(powered = false) {
  const d = clone(presets.find(d => d.engine.count > 0)!);
  if (!powered) { d.engine.count = 0; d.fuelTank.capacity = 0; }
  return new FlightSimulation(d, 'standard', 'low-altitude', 0);
}

describe('低空计分与动力边界', () => {
  it('相同首次前进距离，贴地更近、完成更快分更高', () => {
    const fast = lowAltitude(), slow = lowAltitude(), high = lowAltitude();
    for (const s of [fast, slow, high]) { s.position.set(0, 45, 0); s.quaternion.identity(); }
    fast.velocity.set(40, 0, 0); slow.velocity.set(20, 0, 0); high.velocity.set(40, 0, 0); high.position.y = 55;
    fast.step(neutral, 0.0001); slow.step(neutral, 0.0002); high.step(neutral, 0.0001);
    expect(fast.position.x).toBeCloseTo(slow.position.x, 5);
    expect(fast.telemetry.score).toBeGreaterThan(slow.telemetry.score * 1.9);
    expect(fast.telemetry.score).toBeGreaterThan(high.telemetry.score);
  });

  it('倒飞再重走同一段不刷新前进距离，经过时间继续压低分数', () => {
    const s = lowAltitude(); s.position.set(0, 45, 0); s.quaternion.identity(); s.velocity.set(30, 0, 0);
    s.step(neutral, 0.0001);
    const score = s.telemetry.score, farthest = s.position.x;
    s.velocity.set(-30, 0, 0); s.quaternion.set(0, 1, 0, 0); s.step(neutral, 0.0001);
    s.velocity.set(30, 0, 0); s.quaternion.identity(); s.step(neutral, 0.0001);
    expect(s.position.x).toBeCloseTo(farthest, 5);
    expect(s.telemetry.score).toBeLessThan(score * 0.34);
    expect(s.ended).toBe(false);
  });

  it('持续超高按真实秒数加重扣分，不夹零；低空也有真实碰撞和顺序终点', () => {
    const s = lowAltitude(); s.position.y = 135; s.velocity.set(0, 0, 0); s.quaternion.identity();
    for (let i = 0; i < 4; i++) s.step(neutral, 0.25);
    const firstPenalty = -s.telemetry.score;
    for (let i = 0; i < 4; i++) s.step(neutral, 0.25);
    expect(s.telemetry.aboveHeightTime).toBeCloseTo(2, 10); expect(s.telemetry.score).toBeLessThan(0);
    expect(-s.telemetry.score - firstPenalty).toBeGreaterThan(firstPenalty);
    const crash = lowAltitude(); crash.position.y = challengeTerrainHeight('low-altitude', 0, 0) - 1; crash.step(neutral);
    expect(crash.result?.landing).toBe('terrain'); expect(crash.result?.completed).toBe(false);
    const gates = challengeCheckpoints('low-altitude'), last = gates[gates.length - 1], skipped = lowAltitude();
    skipped.position.set(last.x - 0.1, last.y + 15, last.z); skipped.velocity.set(30, 0, 0); skipped.quaternion.identity(); skipped.step(neutral);
    expect(skipped.result?.completed).toBe(false); expect(skipped.result?.landing).toBe('boundary');
  });

  it('转速和推力渐变、实际耗油改变质量/重心/惯量，燃油不驱动驾驶员', () => {
    const d = clone(presets.find(d => d.engine.count > 0)!); d.fuelTank.x = fuelTankLimits(d).max;
    const s = new FlightSimulation(d, 'standard', 'low-altitude', 0);
    const initialMass = s.aircraft.mass, initialX = s.aircraft.cg.x, initialInertia = s.aircraft.inertia.z;
    s.step({ ...neutral, throttle: 1 }, 0.25);
    const firstThrust = s.telemetry.thrust, firstRpm = s.telemetry.engineRpm;
    expect(firstThrust).toBeGreaterThan(0); expect(firstRpm).toBeGreaterThan(0); expect(firstRpm).toBeLessThan(1);
    expect(s.telemetry.fuelRemaining).toBeLessThan(d.fuelTank.capacity);
    expect(s.aircraft.mass).toBeLessThan(initialMass); expect(s.aircraft.cg.x).toBeLessThan(initialX);
    expect(s.aircraft.inertia.z).toBeLessThan(initialInertia); expect(s.pilotOffset).toEqual({ x: 0, z: 0 });
    s.step({ ...neutral, throttle: 1 }, 0.25);
    expect(s.telemetry.thrust).toBeGreaterThan(firstThrust); expect(s.telemetry.engineRpm).toBeGreaterThan(firstRpm);
    expect(s.telemetry.propulsionWork).toBeGreaterThan(0); expect(s.telemetry.fuelEnergyRemoved).toBeGreaterThan(0);
    expect(() => s.step({ ...neutral, throttle: NaN })).toThrow();
  });

  it('空油停推但保留转速回落，重置恢复满箱；油门记录可确定重放', () => {
    const d = clone(presets.find(d => d.engine.count > 0)!); d.fuelTank.capacity = 0.000001;
    const empty = new FlightSimulation(d, 'standard', 'low-altitude', 0);
    empty.step({ ...neutral, throttle: 1 }, 0.25);
    expect(empty.telemetry.fuelRemaining).toBe(0); expect(empty.telemetry.thrust).toBe(0);
    const rpm = empty.telemetry.engineRpm; empty.step({ ...neutral, throttle: 1 }, 0.25);
    expect(empty.telemetry.engineRpm).toBeLessThan(rpm); expect(empty.telemetry.thrust).toBe(0);
    empty.reset(); expect(empty.telemetry.fuelRemaining).toBe(d.fuelTank.capacity); expect(empty.telemetry.engineRpm).toBe(0);
    const s = lowAltitude(true);
    for (let i = 0; i < 20; i++) s.step({ ...neutral, throttle: i / 20 });
    const replay = lowAltitude(true); replay.loadReplay(s.getRecording());
    while (!replay.replayFinished) replay.step(neutral);
    expect(replay.position.toArray()).toEqual(s.position.toArray()); expect(replay.omega.toArray()).toEqual(s.omega.toArray());
    expect(replay.telemetry.fuelRemaining).toBe(s.telemetry.fuelRemaining); expect(replay.telemetry.engineRpm).toBe(s.telemetry.engineRpm);
  });

  it('双发固定侧距和支撑参与质量/惯量，低挂发动机纳入地形接触', () => {
    const one = clone(presets.find(d => d.engine.count > 0)!), twin = clone(one);
    twin.engine.count = 2; twin.engine.y = 0;
    expect(derive(twin).mass).toBeGreaterThan(derive(one).mass); expect(derive(twin).inertia.x).toBeGreaterThan(derive(one).inertia.x);
    const mounts = engineMounts(twin);expect(mounts[0].z).toBeCloseTo(-0.63);expect(mounts[1].z).toBeCloseTo(0.63);
    expect(derive(twin).inertia.y).toBeGreaterThan(derive(one).inertia.y);
    const singleFlight = new FlightSimulation(one, 'standard', 'low-altitude', 0), twinFlight = new FlightSimulation(twin, 'standard', 'low-altitude', 0);
    singleFlight.step({ ...neutral, throttle: 1 }, 0.25); twinFlight.step({ ...neutral, throttle: 1 }, 0.25);
    expect(twinFlight.telemetry.thrust).toBeCloseTo(singleFlight.telemetry.thrust * 2, 10);
    expect(one.fuelTank.capacity - twinFlight.telemetry.fuelRemaining).toBeCloseTo((one.fuelTank.capacity - singleFlight.telemetry.fuelRemaining) * 2, 10);
    one.engine.x = -2; one.engine.y = -0.5;
    const s = new FlightSimulation(one, 'standard', 'low-altitude', 0);
    s.position.set(0, challengeTerrainHeight('low-altitude', 0, 0) + 0.4, 0); s.quaternion.identity(); s.step(neutral);
    expect(s.result?.landing).toBe('terrain');
  });

  it('每台引擎额定推力精确为360N，转速响应与耗油率不变', () => {
    const d = clone(presets.find(d => d.engine.count > 0)!);
    const s = new FlightSimulation(d, 'standard', 'low-altitude', 0), dt = 1 / 60, tau = 1.8;
    expect(engineCatalog[d.engine.type].maxThrust).toBe(360);
    expect(engineCatalog[d.engine.type].fuelFlow).toBe(0.012);
    s.step({ ...neutral, throttle: 1 }, dt);
    const integral = dt - 2 * tau * (1 - Math.exp(-dt / tau)) + tau / 2 * (1 - Math.exp(-2 * dt / tau));
    expect(s.telemetry.thrust).toBeCloseTo(360 * integral / dt, 9);
  });
});
