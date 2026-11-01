import { describe, expect, it } from 'vitest';
import { clone, defaultAircraft, DEG, engineMounts, fuelTankLimits, presets, type Controls } from '../src/model';
import { CONTROL_SURFACE_RATE, derive, FlightSimulation } from '../src/physics';
import { CHALLENGE_RIVER, challengeCenter, challengeCheckpoints, challengeCollisionHeight, challengeLaunch, challengeRiverCenter, challengeRiverHeight, challengeStartGate, challengeTerrainGrid, challengeTerrainHeight } from '../src/challenges';
import { engineCatalog } from '../src/engines';

const neutral: Controls = { weight: 0, lateral: 0, rudder: 0, elevator: 0, aileron: 0 };
const downhillAircraft = presets.find(d => !d.birdman && d.engine.count === 0)!;
const poweredAircraft = presets.find(d => d.engine.count > 0)!;
function airborne(s: FlightSimulation, x = 40, clearance = 70) {
  const z = challengeCenter(s.challenge, x);
  s.launching = false; s.position.set(x, challengeCollisionHeight(s.challenge, x, z) + clearance, z);
  s.quaternion.identity(); s.velocity.set(26, 0, 0);
  return s;
}
function create() { return airborne(new FlightSimulation(downhillAircraft, 'downhill', 0)); }
function lowAltitude(powered = false) {
  const d = clone(poweredAircraft);
  if (!powered) { d.engine.count = 0; d.fuelTank.capacity = 0; }
  return airborne(new FlightSimulation(d, 'low-altitude', 0), 40, 15);
}
function crossStart(s: FlightSimulation, clearance = 15) {
  const gate = challengeStartGate(s.challenge)!;
  airborne(s, gate.x - 0.1, clearance); s.position.z = gate.z; s.position.y = gate.y + clearance;
  s.velocity.set(30, 0, 0); s.step(neutral, 0.01);
  expect(s.telemetry.timingStarted).toBe(true);
  return s;
}

describe('三轴操纵与高山路径边界', () => {
  it('鸟人间设计限制在构造处生效，不开放违规舵面', () => {
    expect(() => new FlightSimulation(downhillAircraft)).toThrow('鸟人间');
    const plain = new FlightSimulation(defaultAircraft, 'birdman', 0), commanded = new FlightSimulation(defaultAircraft, 'birdman', 0);
    for (const s of [plain, commanded]) { s.launching = false; s.position.set(40, 80, 0); s.quaternion.identity(); s.velocity.set(12, -1, 0); }
    plain.step(neutral); commanded.step({ ...neutral, elevator: 1, aileron: 1 });
    expect(commanded.position.toArray()).toEqual(plain.position.toArray()); expect(commanded.omega.toArray()).toEqual(plain.omega.toArray());
    expect(commanded.telemetry.timingStarted).toBe(true);
  });

  it('三轴产生独立实际力矩，正输入低头、右滚、右偏', () => {
    const base = create(); base.step(neutral);
    for (const [control, axis, sign] of [['elevator', 'z', -1], ['aileron', 'x', 1], ['rudder', 'y', -1]] as const) {
      const s = create(); s.step({ ...neutral, [control]: 0.2 });
      expect((s.telemetry.torque[axis] - base.telemetry.torque[axis]) * sign).toBeGreaterThan(0);
    }
    const disabled = clone(base.definition); disabled.mainWing.controlSurface = 0; disabled.horizontalTail.controlSurface = 0;
    const a = airborne(new FlightSimulation(disabled, 'downhill', 0)), b = airborne(new FlightSimulation(disabled, 'downhill', 0));
    a.step(neutral); b.step({ ...neutral, elevator: 1, aileron: 1 });
    expect(a.position.toArray()).toEqual(b.position.toArray()); expect(a.omega.toArray()).toEqual(b.omega.toArray());
  });

  it('舵面按秒逐渐运动，松手回中、反向经过零位，重置清零', () => {
    const s = new FlightSimulation(downhillAircraft, 'downhill', 0), command = { ...neutral, elevator: 1, aileron: 1, rudder: 1 };
    s.step(command, 0.1);
    expect(s.controlDeflections.aileron).toBeCloseTo(18 * DEG * CONTROL_SURFACE_RATE * 0.1, 12);
    expect(s.controlDeflections.elevator).toBeCloseTo(-22 * DEG * CONTROL_SURFACE_RATE * 0.1, 12);
    expect(s.controlDeflections.rudder).toBeCloseTo(15 * DEG * CONTROL_SURFACE_RATE * 0.1, 12);
    s.step(neutral, 0.04); expect(s.controlDeflections.aileron).toBeCloseTo(18 * DEG * 0.15, 12);
    s.step({ ...neutral, aileron: -1 }, 0.04); expect(s.controlDeflections.aileron).toBeCloseTo(18 * DEG * 0.05, 12);
    s.step({ ...neutral, aileron: -1 }, 0.04); expect(s.controlDeflections.aileron).toBeCloseTo(-18 * DEG * 0.05, 12);
    s.reset(); expect(s.controlDeflections).toEqual({ aileron: 0, elevator: 0, rudder: 0 });
  });

  it('舵面大步长与60Hz细分一致，混合dt、回中和反向录像逐帧确定重放', () => {
    const a = new FlightSimulation(downhillAircraft, 'downhill', 0), b = new FlightSimulation(downhillAircraft, 'downhill', 0);
    const command = { ...neutral, elevator: 1, aileron: -1, rudder: 0.8 };
    a.step(command, 0.25); for (let i = 0; i < 15; i++) b.step(command);
    expect(a.position.toArray()).toEqual(b.position.toArray()); expect(a.controlDeflections).toEqual(b.controlDeflections);
    const states: number[][] = [];
    const source = new FlightSimulation(downhillAircraft, 'downhill', 0);
    for (let i = 0; i < 30; i++) {
      source.step({ ...neutral, rudder: i < 10 ? 1 : i < 20 ? 0 : -1, aileron: i < 15 ? 0.7 : -0.7 }, i % 2 ? 1 / 120 : 1 / 60);
      states.push([...source.position.toArray(), ...source.quaternion.toArray(), ...Object.values(source.controlDeflections)]);
    }
    const replay = new FlightSimulation(downhillAircraft, 'downhill', 0); replay.loadReplay(source.getRecording());
    for (const state of states) { replay.step(neutral); expect([...replay.position.toArray(), ...replay.quaternion.toArray(), ...Object.values(replay.controlDeflections)]).toEqual(state); }
  });

  it('侧移改变CG、惯量及真实滚转，录像保留侧向输入', () => {
    const center = derive(defaultAircraft), right = derive(defaultAircraft, 0, 1), left = derive(defaultAircraft, 0, -1);
    expect(right.cg.z).toBeGreaterThan(0); expect(left.cg.z).toBeCloseTo(-right.cg.z, 12);
    expect(right.inertia.x).toBeGreaterThan(center.inertia.x); expect(right.inertia.y).toBeGreaterThan(center.inertia.y);
    const s = new FlightSimulation(downhillAircraft, 'downhill', 0), plain = new FlightSimulation(downhillAircraft, 'downhill', 0);
    for (let i = 0; i < 20; i++) { s.step({ ...neutral, lateral: 1 }); plain.step(neutral); }
    expect(s.aircraft.cg.z).toBeGreaterThan(plain.aircraft.cg.z); expect(s.aircraft.inertia.x).toBeGreaterThan(plain.aircraft.inertia.x);
    const replay = new FlightSimulation(downhillAircraft, 'downhill', 0); replay.loadReplay(s.getRecording());
    while (!replay.replayFinished) replay.step(neutral);
    expect(replay.position.toArray()).toEqual(s.position.toArray()); expect(replay.aircraft.cg.toArray()).toEqual(s.aircraft.cg.toArray());
    const flying = create(), centered = create();
    for (let i = 0; i < 20; i++) { flying.step({ ...neutral, lateral: 1 }); centered.step(neutral); }
    expect(flying.omega.x).toBeGreaterThan(centered.omega.x);
    const t = flying.telemetry;
    expect(Math.abs(t.energy + t.dissipatedEnergy - t.initialEnergy - t.controlWork) / t.initialEnergy).toBeLessThan(1e-8);
  });

  it('山顶20m弹射到20m/s，整台离当地地面至少50m，背后有山，离台后仍不计时', () => {
    const s = new FlightSimulation(downhillAircraft, 'downhill', 0), launch = challengeLaunch('downhill')!;
    expect(s.launching).toBe(true); expect(s.velocity.length()).toBe(0); expect(launch.length).toBe(20);
    expect(s.position.x).toBe(launch.startX);
    for (let x = launch.startX; x <= launch.endX; x += 2) for (let z = -launch.width / 2; z <= launch.width / 2; z += 2) {
      expect(launch.y - launch.thickness - challengeTerrainHeight('downhill', x, z)).toBeGreaterThanOrEqual(50);
    }
    expect(challengeTerrainHeight('downhill', -110, 0)).toBeGreaterThan(launch.y);
    for (let i = 1; i <= 8; i++) {
      s.step(neutral, 0.25); expect(s.position.x).toBeCloseTo(launch.startX + 5 * (i / 4) ** 2, 10);
      expect(s.velocity.length()).toBeCloseTo(10 * i / 4, 10); expect(s.time).toBe(0);
    }
    expect(s.launching).toBe(false); expect(s.position.x).toBe(launch.endX); expect(s.telemetry.timingStarted).toBe(false);
    s.step(neutral); expect(s.time).toBe(0); expect(s.telemetry.initialEnergy).toBeGreaterThan(0);
  });

  it('三角地形插值一致，速降航线有连续反向弯道', () => {
    const h = (x: number, z: number) => challengeTerrainHeight('downhill', x, z), step = challengeTerrainGrid.step;
    expect(h(2, 3)).toBeCloseTo(h(0, 0) * 0.5 + h(step, 0) * 0.2 + h(0, step) * 0.3, 12);
    expect(h(8, 7)).toBeCloseTo(h(step, step) * 0.5 + h(0, step) * 0.2 + h(step, 0) * 0.3, 12);
    const centers = Array.from({ length: 19 }, (_, i) => challengeCenter('downhill', i * 100));
    const changes = centers.slice(1).map((z, i) => z - centers[i]);
    expect(changes.filter((v, i) => i && v * changes[i - 1] < 0).length).toBeGreaterThanOrEqual(4);
  });

  it.each(['downhill', 'low-altitude'] as const)('%s 必须真实通过远处出发门才计时，错过和绕过不能得分', challenge => {
    const s = challenge === 'downhill' ? create() : lowAltitude(), gate = challengeStartGate(challenge)!;
    s.step(neutral, 0.01); expect(s.time).toBe(0); expect(s.telemetry.score).toBe(0);
    expect(gate.x - challengeLaunch(challenge)!.endX).toBeGreaterThanOrEqual(100);
    crossStart(s, challenge === 'downhill' ? 60 : 15);
    expect(s.time).toBeGreaterThan(0); expect(s.time).toBeLessThan(0.01); expect(s.telemetry.challengeProgress).toBe(0);
    const bypass = challenge === 'downhill' ? create() : lowAltitude();
    airborne(bypass, gate.x + 1, 40); bypass.step(neutral);
    expect(bypass.result?.landing).toBe('boundary'); expect(bypass.telemetry.timingStarted).toBe(false); expect(bypass.telemetry.score).toBe(0);
    const missed = challenge === 'downhill' ? create() : lowAltitude();
    airborne(missed, gate.x - 0.1, gate.maxHeight + 5); missed.position.z = gate.z; missed.velocity.set(30, 0, 0); missed.step(neutral);
    expect(missed.result?.completed).toBe(false); expect(missed.telemetry.timingStarted).toBe(false);
  });

  it('仅向前穿过下一门算进度，漏门和直达终点不能完成', () => {
    const gates = challengeCheckpoints('downhill'), first = gates[0], last = gates[gates.length - 1];
    const s = crossStart(create(), 60); airborne(s, first.x - 0.2, 60); s.position.z = first.z; s.position.y = first.y + 60; s.velocity.set(30, 0, 0); s.step(neutral);
    expect(s.telemetry.challengeProgress).toBe(0.1); expect(s.ended).toBe(false);
    const skipped = crossStart(create(), 60); airborne(skipped, last.x - 0.2, 60); skipped.position.z = last.z; skipped.velocity.set(30, 0, 0); skipped.step(neutral);
    expect(skipped.result?.completed).toBe(false); expect(skipped.result?.landing).toBe('boundary'); expect(skipped.telemetry.challengeProgress).toBe(0);
    const completed = crossStart(create(), 60);
    for (const gate of gates) {
      airborne(completed, gate.x - 0.1, 60); completed.position.z = gate.z; completed.position.y = gate.y + 60;
      completed.velocity.set(30, 0, 0); completed.step(neutral, 0.01);
    }
    expect(completed.result?.landing).toBe('finish'); expect(completed.result?.completed).toBe(true);
    expect(completed.telemetry.challengeProgress).toBe(1); expect(completed.result?.score).toBe(completed.time);
  });

  it('山坡、弹射台与谷道边界均按真实接触终止', () => {
    const crash = create(); crash.position.y = challengeTerrainHeight('downhill', crash.position.x, crash.position.z) - 1;
    crash.step(neutral); expect(crash.result?.landing).toBe('terrain');
    const shortcut = create(); shortcut.position.z += 66; shortcut.position.y = challengeTerrainHeight('downhill', shortcut.position.x, shortcut.position.z) + 30;
    shortcut.step(neutral); expect(shortcut.result?.landing).toBe('boundary');
    const platform = create(), launch = challengeLaunch('downhill')!; platform.position.set(-10, launch.y - 0.1, 0); platform.velocity.set(0, -3, 0);
    platform.step(neutral); expect(platform.result?.landing).toBe('terrain');
  });
});

describe('低空地形、滑跑与计分', () => {
  it('明显起伏、两侧山与蜿蜒河流共用接触几何，河面按10m线性连接', () => {
    const heights = Array.from({ length: 17 }, (_, i) => challengeTerrainHeight('low-altitude', i * 100, challengeCenter('low-altitude', i * 100)));
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(25);
    for (const x of [200, 600, 1000]) {
      const river = challengeRiverCenter(x), floor = challengeTerrainHeight('low-altitude', x, river);
      expect(challengeTerrainHeight('low-altitude', x, river - 200) - floor).toBeGreaterThan(100);
      expect(challengeTerrainHeight('low-altitude', x, river + 200) - floor).toBeGreaterThan(100);
      expect(challengeCollisionHeight('low-altitude', x, river)).toBe(challengeRiverHeight(x));
      expect(challengeTerrainHeight('low-altitude', x, river + CHALLENGE_RIVER.width)).toBeGreaterThan(floor);
    }
    expect(challengeRiverCenter(300)).not.toBe(challengeRiverCenter(600));
    expect(challengeRiverHeight(205)).toBeCloseTo((challengeRiverHeight(200) + challengeRiverHeight(210)) / 2, 12);
  });

  it('地面静止起步，无动力不会获得速度；全油门在跑道内靠真实升力离地', () => {
    const launch = challengeLaunch('low-altitude')!, d = clone(poweredAircraft); d.engine.count = 0; d.fuelTank.capacity = 0;
    const stationary = new FlightSimulation(d, 'low-altitude', 0);
    for (let i = 0; i < 20; i++) stationary.step({ ...neutral, throttle: 1 }, 0.25);
    expect(stationary.position.x).toBe(launch.startX); expect(stationary.velocity.length()).toBe(0); expect(stationary.launching).toBe(true);
    const s = new FlightSimulation(poweredAircraft, 'low-altitude', 0);
    expect(s.position.x).toBe(launch.startX); expect(s.velocity.length()).toBe(0);
    let rollWork = 0;
    for (let i = 0; i < 3600 && s.launching && !s.ended; i++) {
      s.step({ ...neutral, throttle: 1 }); rollWork = Math.max(rollWork, s.telemetry.propulsionWork);
    }
    expect(s.ended).toBe(false); expect(s.launching).toBe(false); expect(s.position.x).toBeLessThan(launch.endX);
    expect(s.position.x).toBeGreaterThan(launch.startX + 20); expect(s.velocity.x).toBeGreaterThan(10);
    expect(s.telemetry.force.y).toBeGreaterThanOrEqual(s.aircraft.mass * 9.81);
    expect(rollWork).toBeGreaterThan(0); expect(s.telemetry.fuelRemaining).toBeLessThan(poweredAircraft.fuelTank.capacity);
    expect(s.telemetry.propulsionWork).toBe(0); expect(s.telemetry.fuelEnergyRemoved).toBe(0);
    const t = s.telemetry;
    expect(t.energy + t.dissipatedEnergy + t.fuelEnergyRemoved - t.propulsionWork - t.controlWork).toBeCloseTo(t.initialEnergy, 8);
    expect(s.time).toBe(0); expect(s.telemetry.score).toBe(0); expect(s.telemetry.timingStarted).toBe(false);
    for (let x = launch.startX; x <= launch.endX; x += 10) expect(challengeTerrainHeight('low-altitude', x, launch.z)).toBe(launch.y);
  });

  it('起飞前地面滑跑与油门录像可逐帧确定重放', () => {
    const s = new FlightSimulation(poweredAircraft, 'low-altitude', 0), states: number[][] = [];
    for (let i = 0; i < 40; i++) { s.step({ ...neutral, throttle: i < 10 ? 0.5 : 1 }, 0.1); states.push([...s.position.toArray(), ...s.velocity.toArray(), s.telemetry.fuelRemaining]); }
    const replay = new FlightSimulation(poweredAircraft, 'low-altitude', 0); replay.loadReplay(s.getRecording());
    for (const state of states) { replay.step(neutral); expect([...replay.position.toArray(), ...replay.velocity.toArray(), replay.telemetry.fuelRemaining]).toEqual(state); }
  });

  it('同段首次前进贴地更近、完成更快分更高，反复走同段不重复得距离', () => {
    const fast = crossStart(lowAltitude()), slow = crossStart(lowAltitude()), high = crossStart(lowAltitude());
    const gate = challengeStartGate('low-altitude')!, x = gate.x + 1, z = gate.z, y = challengeCollisionHeight('low-altitude', x, z);
    for (const s of [fast, slow, high]) { s.position.set(x, y + 8, z); s.quaternion.identity(); }
    fast.velocity.set(40, 0, 0); slow.velocity.set(20, 0, 0); high.velocity.set(40, 0, 0); high.position.y += 10;
    fast.step(neutral, 0.01); slow.step(neutral, 0.02); high.step(neutral, 0.01);
    expect(fast.telemetry.score).toBeGreaterThan(slow.telemetry.score); expect(fast.telemetry.score).toBeGreaterThan(high.telemetry.score);
    const score = fast.telemetry.score, farthest = fast.position.x;
    fast.velocity.set(-40, 0, 0); fast.quaternion.set(0, 1, 0, 0); fast.step(neutral, 0.01);
    fast.velocity.set(40, 0, 0); fast.quaternion.identity(); fast.step(neutral, 0.01);
    expect(fast.position.x).toBeCloseTo(farthest, 3); expect(fast.telemetry.score).toBeLessThan(score); expect(fast.ended).toBe(false);
  });

  it('持续超高按真实秒数加重扣分；起点前不扣分，落河返回water', () => {
    const waiting = lowAltitude(); waiting.position.y += 100; waiting.step(neutral, 0.25);
    expect(waiting.telemetry.aboveHeightTime).toBe(0); expect(waiting.telemetry.score).toBe(0);
    const s = crossStart(lowAltitude(), 100); s.velocity.set(0, 0, 0); s.quaternion.identity();
    const startTime = s.telemetry.aboveHeightTime;
    for (let i = 0; i < 4; i++) s.step(neutral, 0.25);
    const firstPenalty = -s.telemetry.score;
    for (let i = 0; i < 4; i++) s.step(neutral, 0.25);
    expect(s.telemetry.aboveHeightTime - startTime).toBeCloseTo(2, 10); expect(-s.telemetry.score - firstPenalty).toBeGreaterThan(firstPenalty);
    const river = lowAltitude(), x = 600; river.position.set(x, challengeRiverHeight(x) - 0.5, challengeRiverCenter(x)); river.velocity.set(0, -5, 0);
    river.step(neutral); expect(river.result?.landing).toBe('water'); expect(river.result?.completed).toBe(false);
  });

  it('高速落河定位首次可见河面接触，不穿到河床', () => {
    const s = crossStart(lowAltitude()), x = 180, water = challengeRiverHeight(x);
    s.position.set(x, water + 5, challengeRiverCenter(x)); s.velocity.set(0, -500, 0); s.quaternion.identity();
    s.step(neutral, 0.25);
    expect(s.result?.landing).toBe('water'); expect(s.position.y).toBeGreaterThan(water - 0.001);
  });
});

describe('动力与燃油边界', () => {
  it('转速与推力渐变，耗油改变质量/重心/惯量，不驱动驾驶员', () => {
    const d = clone(poweredAircraft); d.fuelTank.x = fuelTankLimits(d).max;
    const s = new FlightSimulation(d, 'low-altitude', 0), mass = s.aircraft.mass, x = s.aircraft.cg.x, inertia = s.aircraft.inertia.z;
    s.step({ ...neutral, throttle: 1 }, 0.25);
    const thrust = s.telemetry.thrust, rpm = s.telemetry.engineRpm;
    expect(thrust).toBeGreaterThan(0); expect(rpm).toBeGreaterThan(0); expect(rpm).toBeLessThan(1);
    expect(s.aircraft.mass).toBeLessThan(mass); expect(s.aircraft.cg.x).toBeLessThan(x); expect(s.aircraft.inertia.z).toBeLessThan(inertia);
    expect(s.pilotOffset).toEqual({ x: 0, z: 0 }); expect(s.telemetry.fuelEnergyRemoved).toBeGreaterThan(0);
    s.step({ ...neutral, throttle: 1 }, 0.25); expect(s.telemetry.thrust).toBeGreaterThan(thrust); expect(s.telemetry.engineRpm).toBeGreaterThan(rpm);
    expect(() => s.step({ ...neutral, throttle: NaN })).toThrow();
  });

  it('空油停推、转速回落，重置恢复满箱；油门录像保持燃油状态', () => {
    const d = clone(poweredAircraft); d.fuelTank.capacity = 0.000001;
    const empty = new FlightSimulation(d, 'low-altitude', 0); empty.step({ ...neutral, throttle: 1 }, 0.25);
    expect(empty.telemetry.fuelRemaining).toBe(0); expect(empty.telemetry.thrust).toBe(0);
    const rpm = empty.telemetry.engineRpm; empty.step({ ...neutral, throttle: 1 }, 0.25);
    expect(empty.telemetry.engineRpm).toBeLessThan(rpm); empty.reset(); expect(empty.telemetry.fuelRemaining).toBe(d.fuelTank.capacity); expect(empty.telemetry.engineRpm).toBe(0);
    const s = new FlightSimulation(poweredAircraft, 'low-altitude', 0);
    for (let i = 0; i < 20; i++) s.step({ ...neutral, throttle: i / 20 });
    const replay = new FlightSimulation(poweredAircraft, 'low-altitude', 0); replay.loadReplay(s.getRecording());
    while (!replay.replayFinished) replay.step(neutral);
    expect(replay.position.toArray()).toEqual(s.position.toArray()); expect(replay.omega.toArray()).toEqual(s.omega.toArray());
    expect(replay.telemetry.fuelRemaining).toBe(s.telemetry.fuelRemaining); expect(replay.telemetry.engineRpm).toBe(s.telemetry.engineRpm);
  });

  it('双发侧距和支撑参与质量/惯量，低挂发动机纳入地形接触', () => {
    const one = clone(poweredAircraft), twin = clone(one); twin.engine.count = 2; twin.engine.y = 0;
    expect(derive(twin).mass).toBeGreaterThan(derive(one).mass); expect(derive(twin).inertia.x).toBeGreaterThan(derive(one).inertia.x);
    const mounts = engineMounts(twin); expect(mounts[0].z).toBeCloseTo(-0.63); expect(mounts[1].z).toBeCloseTo(0.63);
    expect(derive(twin).inertia.y).toBeGreaterThan(derive(one).inertia.y);
    const a = new FlightSimulation(one, 'low-altitude', 0), b = new FlightSimulation(twin, 'low-altitude', 0);
    a.step({ ...neutral, throttle: 1 }, 0.25); b.step({ ...neutral, throttle: 1 }, 0.25);
    expect(b.telemetry.thrust).toBeCloseTo(a.telemetry.thrust * 2, 10);
    expect(one.fuelTank.capacity - b.telemetry.fuelRemaining).toBeCloseTo((one.fuelTank.capacity - a.telemetry.fuelRemaining) * 2, 10);
    one.engine.x = -2; one.engine.y = -0.5;
    const crash = airborne(new FlightSimulation(one, 'low-altitude', 0)); crash.position.y = challengeTerrainHeight('low-altitude', crash.position.x, crash.position.z) + 0.4;
    crash.step(neutral); expect(crash.result?.landing).toBe('terrain');
  });

  it('每台引擎额定360N，转速响应与耗油率不变', () => {
    const s = new FlightSimulation(poweredAircraft, 'low-altitude', 0), dt = 1 / 60, tau = 1.8;
    expect(engineCatalog[poweredAircraft.engine.type].maxThrust).toBe(360); expect(engineCatalog[poweredAircraft.engine.type].fuelFlow).toBe(0.012);
    s.step({ ...neutral, throttle: 1 }, dt);
    const integral = dt - 2 * tau * (1 - Math.exp(-dt / tau)) + tau / 2 * (1 - Math.exp(-2 * dt / tau));
    expect(s.telemetry.thrust).toBeCloseTo(360 * integral / dt, 9);
  });
});
