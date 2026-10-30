import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { clone, defaultAircraft, DEG, presets, wing, planform, type AircraftDefinition, type Controls } from '../src/model';
import { coefficients, derive, FlightSimulation, GRAVITY } from '../src/physics';

const neutral: Controls = { weight: 0, rudder: 0, elevator: 0, aileron: 0 };
const axisZ = new Vector3(0, 0, 1);
function definition(change?: (d: AircraftDefinition) => void) {
  const d = clone(defaultAircraft);
  change?.(d);
  return d;
}
function probe(d = definition(), setup?: (s: FlightSimulation) => void) {
  const s = new FlightSimulation(d);
  s.position.set(30, 80, 0);
  s.quaternion.identity();
  s.velocity.set(12, -1, 0);
  setup?.(s);
  s.step(neutral);
  return s;
}
function fly(d = definition(), controls = neutral) {
  const s = new FlightSimulation(d);
  for (let frame = 0; frame < 60 * 90 && !s.ended; frame++) s.step(controls);
  return s;
}
function finite(s: FlightSimulation) {
  for (const value of [s.position.x, s.position.y, s.position.z, s.velocity.x, s.velocity.y, s.velocity.z,
    s.omega.x, s.omega.y, s.omega.z, s.quaternion.length(), s.telemetry.energy, s.telemetry.aeroPower]) {
    expect(Number.isFinite(value)).toBe(true);
  }
  expect(s.quaternion.length()).toBeCloseTo(1, 10);
}
function pitchSlope(d: AircraftDefinition) {
  const low = probe(d, s => { s.velocity.set(12, 0, 0); s.quaternion.setFromAxisAngle(axisZ, 3 * DEG); });
  const high = probe(d, s => { s.velocity.set(12, 0, 0); s.quaternion.setFromAxisAngle(axisZ, 7 * DEG); });
  return high.telemetry.torque.z - low.telemetry.torque.z;
}

describe('基础物理与边界', () => {
  it('统一 10m / 10m/s 初始条件，质量中心与惯量均由构型计算', () => {
    const s = new FlightSimulation(defaultAircraft);
    const p = derive(defaultAircraft);
    expect(s.position.toArray()).toEqual([0, 10, 0]);
    expect(s.velocity.toArray()).toEqual([10, 0, 0]);
    expect(s.time).toBe(0);
    expect(s.surfaces).toHaveLength(5);
    expect(p.mass).toBeGreaterThan(defaultAircraft.pilot.mass);
    expect(p.inertia.x).toBeGreaterThan(0);
    expect(p.inertia.y).toBeGreaterThan(0);
    expect(p.inertia.z).toBeGreaterThan(0);
    expect(p.cg.z).toBeCloseTo(0);
    expect(p.wingArea).toBeCloseTo(16.1);
    expect(p.wingLoading).toBeCloseTo(p.mass / p.wingArea);
    expect(p.aspect).toBeCloseTo(p.span ** 2 / p.wingArea);
    expect(s.telemetry.cg).toBe(s.aircraft.cg);
  });

  it('增加乘员质量同时改变质量、重心和惯量', () => {
    const light = derive(definition(d => { d.pilot.mass = 40; }));
    const heavy = derive(definition(d => { d.pilot.mass = 100; }));
    expect(heavy.mass - light.mass).toBeCloseTo(60);
    expect(heavy.cg.x).toBeGreaterThan(light.cg.x);
    expect(heavy.inertia.z).toBeGreaterThan(light.inertia.z);
    expect(heavy.wingLoading).toBeGreaterThan(light.wingLoading);
  });

  it('默认构型实际可滑翔，接触水面结束，结果完整', () => {
    const s = fly();
    finite(s);
    expect(s.ended).toBe(true);
    expect(s.result?.landing).toBe('water');
    expect(s.result!.distance).toBeGreaterThan(40);
    expect(s.result!.time).toBeGreaterThan(3);
    expect(s.result!.averageSpeed).toBeGreaterThan(0);
    expect(s.result!.maxSpeed).toBeGreaterThanOrEqual(s.result!.minSpeed);
    expect(s.result!.maxHeight).toBeGreaterThanOrEqual(10);
    expect(s.result!.hints.length).toBeGreaterThan(0);
    const snapshot = s.position.clone();
    s.step(neutral);
    expect(s.position.equals(snapshot)).toBe(true);
  });

  it('机翼尖先接水也结束，不等待重心沉入水面', () => {
    const s = new FlightSimulation(defaultAircraft);
    s.position.set(30, 1, 0);
    s.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 30 * DEG);
    s.step(neutral);
    expect(s.ended).toBe(true);
    expect(s.position.y).toBeGreaterThan(0);
    expect(s.result?.landing).toBe('water');
  });

  it.each([
    { name: '平台', x: -8, y: 9.8, landing: 'platform' },
    { name: '岸地', x: -40, y: 7.8, landing: 'terrain' },
    { name: '场景边界', x: 2001, y: 20, landing: 'boundary' },
  ])('$name 接触终止', ({ x, y, landing }) => {
    const s = new FlightSimulation(defaultAircraft);
    s.position.set(x, y, 0);
    s.step(neutral);
    expect(s.result?.landing).toBe(landing);
  });

  it('零速度不产生除零；重力仍使飞机下落', () => {
    const s = new FlightSimulation(defaultAircraft);
    s.position.set(30, 50, 0); s.velocity.set(0, 0, 0);
    s.step(neutral);
    finite(s);
    expect(s.velocity.y).toBeCloseTo(-GRAVITY / 60);
    expect(s.telemetry.force.length()).toBe(0);
    for (let i = 0; i < 30; i++) s.step(neutral);
    finite(s);
  });

  it('外部大步长拆为60Hz；非有限/过大/非正步长拒绝', () => {
    const a = new FlightSimulation(defaultAircraft), b = new FlightSimulation(defaultAircraft);
    a.step(neutral, 0.25);
    for (let i = 0; i < 15; i++) b.step(neutral);
    expect(a.position.distanceTo(b.position)).toBeLessThan(1e-10);
    expect(a.quaternion.angleTo(b.quaternion)).toBeLessThan(1e-7);
    for (const dt of [0, -1, NaN, Infinity, 1]) expect(() => a.step(neutral, dt)).toThrow();
    expect(() => a.step({ ...neutral, elevator: NaN })).toThrow();
  });

  it('重置清除状态、统计、记录与结果，构型不被模拟改写', () => {
    const d = definition(), before = JSON.stringify(d);
    const s = fly(d);
    s.reset();
    expect(s.position.toArray()).toEqual([0, 10, 0]);
    expect(s.omega.length()).toBe(0);
    expect(s.time).toBe(0); expect(s.result).toBeNull(); expect(s.ended).toBe(false);
    expect(s.recordingLength).toBe(0);
    expect(s.telemetry.energy).toBeCloseTo(derive(d).mass * (10 * GRAVITY + 50));
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('行为 A–H：改变设计会改变真实受力及飞行', () => {
  it('A：重心前移加强恢复，后移可产生俯仰不稳定', () => {
    const forward = definition(), aft = definition(d => { d.cockpit.position = -0.8; });
    expect(derive(forward).staticMargin).toBeGreaterThan(0);
    expect(derive(aft).staticMargin).toBeLessThan(0);
    expect(pitchSlope(forward)).toBeLessThan(0);
    expect(pitchSlope(aft)).toBeGreaterThan(0);
    expect(derive(forward, 1).cg.x).toBeGreaterThan(derive(forward, -1).cg.x);
    expect(derive(forward, 1).inertia.z).not.toBeCloseTo(derive(forward, -1).inertia.z);
  });

  it('B：主翼面积改变翼载荷、瞬时升力和实际航程', () => {
    const big = definition(d => { d.mainWing = { ...wing(14, 2, 1.5, 0.25), dihedral: 5 }; });
    expect(derive(big).wingLoading).toBeLessThan(derive(defaultAircraft).wingLoading);
    expect(probe(big).telemetry.force.y).toBeGreaterThan(probe().telemetry.force.y);
    expect(Math.abs(fly(big).result!.distance - fly().result!.distance)).toBeGreaterThan(1);
  });

  it('C：可比面积与升力条件下，高展弦比降低诱导阻力并提高估算滑翔效率', () => {
    const low = definition(d => { d.mainWing = wing(10, 1.6, 1.6); });
    const high = definition(d => { d.mainWing = wing(18, 16 / 18, 16 / 18); });
    const a = derive(low), b = derive(high), targetCl = 0.7;
    const alphaA = targetCl / (2 * Math.PI * a.aspect / (a.aspect + 2));
    const alphaB = targetCl / (2 * Math.PI * b.aspect / (b.aspect + 2));
    const ca = coefficients(alphaA, a.aspect), cb = coefficients(alphaB, b.aspect);
    expect(a.wingArea).toBeCloseTo(b.wingArea);
    expect(ca.cl).toBeCloseTo(cb.cl, 10);
    expect(cb.cd).toBeLessThan(ca.cd);
    expect(b.glideRatio).toBeGreaterThan(a.glideRatio);
    expect(fly(high).result!.distance).not.toBeCloseTo(fly(low).result!.distance, 1);
  });

  it('D：水平尾翼面积和后移距离增强俯仰恢复力矩', () => {
    const small = definition(d => { d.horizontalTail = wing(2.5, 0.6, 0.4); });
    const large = definition(d => { d.horizontalTail = wing(4.5, 1, 0.8); });
    const far = definition(d => { d.assembly.horizontalTail = -4.5; });
    expect(pitchSlope(large)).toBeLessThan(pitchSlope(small));
    expect(pitchSlope(far)).toBeLessThan(pitchSlope(defaultAircraft));
  });

  it('E：垂尾面积增加侧滑引起的偏航恢复力矩', () => {
    const small = definition(d => { d.verticalTail = wing(2, 0.5, 0.3); });
    const large = definition(d => { d.verticalTail = wing(4, 1, 0.8); });
    const setup = (s: FlightSimulation) => { s.velocity.set(12, 0, 2); };
    const a = probe(small, setup), b = probe(large, setup);
    expect(a.telemetry.torque.y).toBeLessThan(0);
    expect(b.telemetry.torque.y).toBeLessThan(a.telemetry.torque.y);
  });

  it('F：上反角增加侧滑恢复滚转，反向侧滑时增量反向', () => {
    const flat = definition(d => { d.mainWing.dihedral = 0; });
    const angled = definition(d => { d.mainWing.dihedral = 12; });
    const setup = (s: FlightSimulation) => { s.velocity.set(12, 0, 2); };
    const a = probe(flat, setup), b = probe(angled, setup);
    // 高翼侧滑阻力本身也会滚转；隔离主翼后比较上反角带来的增量。
    const mainRoll = (s: FlightSimulation) => s.surfaces.filter(p => p.kind === 'main').reduce((sum, p) =>
      sum + (p.point.y - s.aircraft.cg.y) * p.force.z - p.point.z * p.force.y, 0);
    expect(mainRoll(b) - mainRoll(a)).toBeLessThan(-1);
    const opposite = (s: FlightSimulation) => { s.velocity.set(12, 0, -2); };
    const reversedFlat = probe(flat, opposite), reversedAngled = probe(angled, opposite);
    expect(mainRoll(reversedAngled) - mainRoll(reversedFlat)).toBeGreaterThan(1);
  });

  it('G：主翼和水平尾翼安装角各自改变配平力矩', () => {
    const base = probe();
    const main = probe(definition(d => { d.assembly.mainIncidence += 3; }));
    const tail = probe(definition(d => { d.assembly.tailIncidence += 3; }));
    expect(main.telemetry.force.y).toBeGreaterThan(base.telemetry.force.y);
    expect(Math.abs(main.telemetry.torque.z - base.telemetry.torque.z)).toBeGreaterThan(1);
    expect(tail.telemetry.torque.z).toBeLessThan(base.telemetry.torque.z);
  });

  it('H：失速连续，深失速升力衰减且阻力上升，正负迎角对称', () => {
    const normal = coefficients(15 * DEG, 10), stalled = coefficients(50 * DEG, 10);
    expect(stalled.cl).toBeLessThan(normal.cl);
    expect(stalled.cd).toBeGreaterThan(normal.cd * 2);
    expect(coefficients(-8 * DEG, 10).cl).toBeCloseTo(-coefficients(8 * DEG, 10).cl);
    expect(coefficients(-8 * DEG, 10).cd).toBeCloseTo(coefficients(8 * DEG, 10).cd);
    for (const angle of [12, 15, 32, 35]) {
      const below = coefficients(angle * DEG - 1e-7, 10), above = coefficients(angle * DEG + 1e-7, 10);
      expect(Math.abs(below.cl - above.cl)).toBeLessThan(1e-4);
      expect(Math.abs(below.cd - above.cd)).toBeLessThan(1e-4);
    }
    const stalledFlight = probe(undefined, s => { s.quaternion.setFromAxisAngle(axisZ, 40 * DEG); });
    expect(stalledFlight.telemetry.stall).toBe(true);
  });
});

describe('局部来流、操纵、能量与确定性', () => {
  it('使用 v + omega cross r：俯仰角速度改变尾翼来流并形成阻尼', () => {
    const still = probe(), rotating = probe(undefined, s => { s.omega.z = 0.4; });
    const tailA = still.surfaces.find(p => p.kind === 'tail')!;
    const tailB = rotating.surfaces.find(p => p.kind === 'tail')!;
    expect(tailB.alpha).toBeGreaterThan(tailA.alpha);
    expect(rotating.telemetry.torque.z).toBeLessThan(still.telemetry.torque.z);
  });

  it('输入改变面上气动力，不直接写入姿态；拉杆产生抬头力矩', () => {
    const base = probe();
    const pull = new FlightSimulation(defaultAircraft);
    pull.position.set(30, 80, 0); pull.quaternion.identity(); pull.velocity.set(12, -1, 0);
    pull.step({ ...neutral, elevator: 0.5 });
    expect(pull.telemetry.torque.z).toBeGreaterThan(base.telemetry.torque.z);
    const tiny = new FlightSimulation(defaultAircraft), q = tiny.quaternion.clone();
    tiny.step({ weight: 1, rudder: 1, elevator: 1, aileron: 1 }, 1e-7);
    expect(tiny.quaternion.angleTo(q)).toBeLessThan(1e-6);
  });

  it.each(['standard', 'assisted', 'experimental'] as const)('%s 静态输入飞行的气动力做功非正，总机械能不凭空增加', mode => {
    const s = new FlightSimulation(defaultAircraft, mode), initial = s.telemetry.energy;
    let previous = initial;
    for (let i = 0; i < 1800 && !s.ended; i++) {
      s.step(neutral);
      finite(s);
      expect(s.telemetry.aeroPower).toBeLessThanOrEqual(1e-6);
      // 有限步长积分误差允许每帧初始能量的百万分之一，不允许持续增益。
      expect(s.telemetry.energy).toBeLessThanOrEqual(previous + initial * 1e-6);
      expect(s.telemetry.energy).toBeLessThanOrEqual(initial * 1.00001);
      previous = s.telemetry.energy;
    }
    expect(s.ended).toBe(true);
  });

  it('高频抖动全部操纵不提供无源推进或能量增益', () => {
    const s = new FlightSimulation(defaultAircraft), initial = s.telemetry.energy;
    const input = { ...neutral };
    for (let i = 0; i < 900 && !s.ended; i++) {
      const sign = i % 2 ? 1 : -1;
      input.weight = sign; input.rudder = sign; input.elevator = sign; input.aileron = sign;
      s.step(input);
      finite(s);
      expect(s.telemetry.aeroPower).toBeLessThanOrEqual(1e-6);
      expect(s.telemetry.energy).toBeLessThan(initial * 1.001);
    }
  });

  it('输入录制重放逐帧重现位姿、速度和结果，与外部帧率无关', () => {
    const original = new FlightSimulation(defaultAircraft);
    const input = { ...neutral };
    for (let i = 0; i < 120; i++) {
      input.elevator = Math.sin(i / 20) * 0.08;
      input.rudder = Math.sin(i / 18) * 0.04;
      original.step(input, i % 2 ? 1 / 60 : 1 / 120);
    }
    const recording = original.getRecording();
    const replay = new FlightSimulation(defaultAircraft);
    replay.loadReplay(recording);
    while (!replay.replayFinished && !replay.ended) replay.step(neutral, 0.2);
    expect(replay.position.toArray()).toEqual(original.position.toArray());
    expect(replay.velocity.toArray()).toEqual(original.velocity.toArray());
    expect(replay.quaternion.toArray()).toEqual(original.quaternion.toArray());
    expect(replay.time).toBe(original.time);
    expect(replay.recordingLength).toBe(recording.length);
    expect(replay.result).toEqual(original.result);
    const snapshot = replay.position.clone(); replay.step(neutral);
    expect(replay.position.equals(snapshot)).toBe(true);
    expect(() => replay.loadReplay({ frames: new Float64Array([NaN, 0, 0, 0, 0]), length: 1 })).toThrow();
  });

  it('全程输入重放得到同一落点和同一结算', () => {
    const original = fly(), replay = new FlightSimulation(defaultAircraft);
    replay.loadReplay(original.getRecording());
    while (!replay.ended && !replay.replayFinished) replay.step(neutral);
    expect(replay.ended).toBe(true);
    expect(replay.result).toEqual(original.result);
  });

  it.each([
    { name: '最大半展', make: () => definition(d => { d.mainWing = { ...wing(24, 1.5, 0.8), dihedral: 25 }; }) },
    { name: '最小主翼', make: () => definition(d => { d.mainWing = wing(0.5, 0.15, 0.15); }) },
    { name: '最小全部翼面', make: () => definition(d => { d.mainWing = wing(0.5, 0.15, 0.15); d.horizontalTail = wing(0.5, 0.15, 0.15); d.verticalTail = wing(0.5, 0.15, 0.15); }) },
  ])('$name 极端合法几何保持有限姿态与能量', ({ make }) => {
    const s = new FlightSimulation(make()), initial = s.telemetry.energy;
    for (let i = 0; i < 180 && !s.ended; i++) {
      s.step(neutral);
      finite(s);
      expect(s.telemetry.energy).toBeLessThan(initial * 1.05);
      expect(s.telemetry.aeroPower).toBeLessThanOrEqual(1e-5);
    }
  });
});

describe('六个预设的完整实际模拟', () => {
  it('等面积增加翼展仍增加结构质量，极端展弦比不是免费提升', () => {
    const short = definition(d => { d.mainWing = wing(10, 1.6, 1.6); });
    const long = definition(d => { d.mainWing = wing(20, 0.8, 0.8); });
    expect(planform(short.mainWing).area).toBeCloseTo(planform(long.mainWing).area);
    expect(derive(long).mass).toBeGreaterThan(derive(short).mass + 10);
    expect(derive(long).inertia.x).toBeGreaterThan(derive(short).inertia.x);
  });
  it('适度配平改进默认距离，而大尾翼安装角使滑翔变差', () => {
    const baseline = fly().result!.distance;
    const trimmed = fly(definition(d => { d.assembly.tailIncidence = -4; })).result!.distance;
    const diving = fly(definition(d => { d.assembly.tailIncidence = 6; })).result!.distance;
    expect(trimmed).toBeGreaterThan(baseline);
    expect(diving).toBeLessThan(baseline);
  });
  it.each(presets.map(d => ({ name: d.name, d })))('$name 从平台飞行至真实终止', ({ d }) => {
    const s = fly(d);
    finite(s);
    expect(s.ended).toBe(true);
    expect(s.result).not.toBeNull();
    expect(s.result!.distance).toBeGreaterThan(0);
    expect(s.result!.time).toBeGreaterThan(0);
    expect(Number.isFinite(s.result!.averageSpeed)).toBe(true);
    expect(s.recordingLength).toBeGreaterThan(0);
    if (d.name.includes('重心过后')) expect(s.result!.hints.join('')).toContain('中性点');
  });
});
