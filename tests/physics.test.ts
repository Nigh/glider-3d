import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { clone, defaultAircraft, DEG, fuselageEnds, mainWingSupport, PILOT_MASS, presets, resizeFuselage, wing, wingOrigin, planform, type AircraftDefinition, type Controls } from '../src/model';
import { AIR_DENSITY, coefficients, derive, FlightSimulation, GRAVITY, LAUNCH, LAUNCH_ROLL_LIMIT, launchHeight } from '../src/physics';

const neutral: Controls = { weight: 0, rudder: 0, elevator: 0, aileron: 0 };
const axisZ = new Vector3(0, 0, 1);
const axisX = new Vector3(1, 0, 0);
function definition(change?: (d: AircraftDefinition) => void) {
  const d = clone(defaultAircraft);
  change?.(d);
  return d;
}
function release(s = new FlightSimulation(defaultAircraft, 'standard', 0)) {
  while (s.launching) s.step(neutral);
  expect(s.ended).toBe(false);
  return s;
}
function budget(s: FlightSimulation) {
  const t = s.telemetry;
  expect(t.initialEnergy).toBeGreaterThan(0);
  expect(t.dissipatedEnergy).toBeGreaterThanOrEqual(0);
  expect(t.energy).toBeCloseTo(t.potentialEnergy + t.kineticEnergy, 9);
  expect(Math.abs(t.energy + t.dissipatedEnergy - t.initialEnergy) / t.initialEnergy).toBeLessThan(1e-8);
}
function probe(d = definition(), setup?: (s: FlightSimulation) => void) {
  const s = new FlightSimulation(d, 'standard', 0);
  s.launching = false;
  s.position.set(30, 80, 0);
  s.quaternion.identity();
  s.velocity.set(12, -1, 0);
  setup?.(s);
  s.step(neutral);
  return s;
}
function fly(d = definition(), controls = neutral) {
  const s = new FlightSimulation(d, 'standard', 0);
  for (let frame = 0; frame < 60 * 90 && !s.ended; frame++) s.step(controls);
  return s;
}
function finite(s: FlightSimulation) {
  for (const value of [s.position.x, s.position.y, s.position.z, s.velocity.x, s.velocity.y, s.velocity.z,
    s.omega.x, s.omega.y, s.omega.z, s.quaternion.length(), s.telemetry.energy, s.telemetry.aeroPower,
    s.telemetry.potentialEnergy, s.telemetry.kineticEnergy, s.telemetry.dissipatedEnergy,
    s.telemetry.initialEnergy, s.telemetry.liftDragRatio]) {
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
  it('从平台入口静止发射，质量中心与惯量均由构型计算', () => {
    const s = new FlightSimulation(defaultAircraft, 'standard', 0);
    const p = derive(defaultAircraft);
    expect(s.position.toArray()).toEqual([LAUNCH.startX, launchHeight(defaultAircraft), 0]);
    expect(s.velocity.toArray()).toEqual([0, 0, 0]);
    expect(s.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(s.launching).toBe(true);
    expect(s.telemetry.distance).toBe(0);
    expect(s.telemetry.initialEnergy).toBe(0);
    expect(s.telemetry.energyPerDistance).toBeNull();
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

  it('沿20米平台匀加速4秒，以固定10m/s离台后才建立能量预算', () => {
    const s = new FlightSimulation(defaultAircraft, 'standard', 0), height = s.position.y;
    for (let second = 1; second <= 4; second++) {
      for (let quarter = 0; quarter < 4; quarter++) s.step(neutral, 0.25);
      expect(s.position.x).toBeCloseTo(LAUNCH.startX + 0.5 * LAUNCH.acceleration * second ** 2, 10);
      expect(s.velocity.x).toBeCloseTo(LAUNCH.acceleration * second, 10);
      expect(s.position.y).toBe(height);
      expect(s.velocity.y).toBe(0);
      expect(s.telemetry.distance).toBe(0);
      expect(s.ended).toBe(false);
      expect(s.launching).toBe(second < 4);
      if (second < 4) {
        expect(s.telemetry.initialEnergy).toBe(0);
        expect(s.telemetry.dissipatedEnergy).toBe(0);
        expect(s.telemetry.energyPerDistance).toBeNull();
      }
    }
    expect(s.time).toBeCloseTo(4, 10);
    expect(s.position.x).toBe(LAUNCH.endX);
    expect(s.velocity.length()).toBe(LAUNCH.speed);
    expect(s.telemetry.initialEnergy).toBeCloseTo(s.aircraft.mass * (GRAVITY * height + 50), 8);
    budget(s);
    s.step(neutral);
    expect(s.telemetry.distance).toBeGreaterThan(0);
    expect(s.position.x).toBeGreaterThan(LAUNCH.endX);
    budget(s);
  });

  it.each([[12, -1, 0], [3, -4, 12]])('实时能耗使用真实耗散功率除以世界水平合速度 (%s, %s, %s)', (x, y, z) => {
    const s = probe(definition(), s => { s.velocity.set(x, y, z); });
    expect(s.telemetry.aeroPower).toBeLessThan(0);
    expect(s.telemetry.energyPerDistance).toBeCloseTo(
      -s.telemetry.aeroPower / Math.hypot(s.velocity.x, s.velocity.z), 12);
    expect(s.telemetry.energyPerDistance).toBeGreaterThan(0);
  });

  it.each([[0, -12, 0], [0, 0, 0], [0.03, 0, 0.04]])('水平速度不超过0.05m/s时能耗无定义 (%s, %s, %s)', (x, y, z) => {
    const s = new FlightSimulation(defaultAircraft, 'standard', 0);
    s.launching = false;
    s.position.set(30, 80, 0);
    s.velocity.set(x, y, z);
    s.step(neutral, 1e-8);
    expect(Math.hypot(s.velocity.x, s.velocity.z)).toBeLessThanOrEqual(0.05);
    expect(s.telemetry.energyPerDistance).toBeNull();
  });

  it('离台后能耗可用，复位和再次助跑恢复无定义', () => {
    const s = release();
    s.step(neutral);
    expect(s.telemetry.energyPerDistance).toBeGreaterThan(0);
    s.reset();
    expect(s.telemetry.energyPerDistance).toBeNull();
    expect(s.telemetry.aeroPower).toBe(0);
    s.step(neutral);
    expect(s.velocity.x).toBeGreaterThan(0);
    expect(s.telemetry.energyPerDistance).toBeNull();
  });

  it('助跑支持重心操纵，滑橇和大安装角翼面不沉入平台', () => {
    const d = definition(d => {
      d.mainWing = wing(14, 5.8, 5.8);
      d.assembly.mainWingHeight = 0;
      d.assembly.mainIncidence = 18;
    });
    const s = new FlightSimulation(d, 'standard', 0), originalCG = s.aircraft.cg.x, inertia = s.aircraft.inertia.clone();
    const height = s.position.y;
    for (let frame = 0; frame < 120; frame++) {
      s.step({ ...neutral, weight: 1 });
      expect(s.launching).toBe(true);
      expect(s.position.y).toBe(height);
      expect(s.position.y - s.aircraft.cg.y - 0.495).toBeGreaterThanOrEqual(LAUNCH.height + 0.05 - 1e-10);
      // 可见网格的主翼根部后缘，随安装角向下转动。
      const trailingY = s.position.y - s.aircraft.cg.y + wingOrigin(d, 'mainWing').y - 5.8 * Math.sin(18 * DEG);
      expect(trailingY).toBeGreaterThanOrEqual(LAUNCH.height + 0.05 - 1e-10);
      expect(s.aircraft.inertia.equals(inertia)).toBe(true);
      expect(s.ended).toBe(false);
    }
    expect(s.aircraft.cg.x).toBeGreaterThan(originalCG);
    expect(s.aircraft.cg.x).toBeCloseTo(derive(d, 1).cg.x, 10);
    expect(s.omega.length()).toBe(0);
  });

  it('离台后后部仍在平台上方，保留真实平台碰撞而不让默认构型沉台', () => {
    const s = release();
    expect(s.position.y - s.aircraft.cg.y - 0.495).toBeGreaterThanOrEqual(LAUNCH.height + 0.05 - 1e-9);
    for (let i = 0; i < 60 && !s.ended; i++) {
      s.step(neutral);
      expect(s.result?.landing).not.toBe('platform');
      budget(s);
    }
    expect(s.ended).toBe(false);
  });

  it('主翼1/4弦参考点独立于尾翼中性点，静稳定裕度以MAC归一化', () => {
    const d = definition(), p = derive(d);
    const fraction = (planform(d.mainWing).root + 2 * planform(d.mainWing).tip)
      / (3 * (planform(d.mainWing).root + planform(d.mainWing).tip));
    const quarter = d.mainWing.points[0].x + (d.mainWing.points[1].x - d.mainWing.points[0].x) * fraction
      + (planform(d.mainWing).root + (planform(d.mainWing).tip - planform(d.mainWing).root) * fraction) / 4;
    expect(p.mainQuarterChord.x).toBeCloseTo(d.assembly.mainWing - quarter * Math.cos(d.assembly.mainIncidence * DEG), 10);
    expect(p.mainQuarterChord.z).toBe(0);
    expect(p.staticMargin).toBeCloseTo((p.cg.x - p.neutralPoint) / planform(d.mainWing).chord, 10);
    const aftTail = derive(definition(d => { d.assembly.horizontalTail -= 1; resizeFuselage(d, 'tail', d.assembly.horizontalTail); }));
    expect(aftTail.neutralPoint).toBeLessThan(p.neutralPoint);
    expect(aftTail.mainQuarterChord.equals(p.mainQuarterChord)).toBe(true);
  });

  it('驾驶员固定60kg；绕过归一化的质量值也不改变质量、惯量或操纵', () => {
    const d = definition(d => { d.pilot.mass = 100; });
    const base = derive(defaultAircraft), changed = derive(d);
    expect(PILOT_MASS).toBe(60);
    expect(changed.mass).toBe(base.mass);
    expect(changed.cg.toArray()).toEqual(base.cg.toArray());
    expect(changed.inertia.toArray()).toEqual(base.inertia.toArray());
    expect(derive(d, 1).cg.toArray()).toEqual(derive(defaultAircraft, 1).cg.toArray());
    const s = new FlightSimulation(d, 'standard', 0);
    s.definition.pilot.mass = 1;
    for (let i = 0; i < 60; i++) s.step({ ...neutral, weight: 1 });
    expect(s.aircraft.mass).toBe(base.mass);
    expect(s.aircraft.cg.toArray()).toEqual(derive(defaultAircraft, 1).cg.toArray());
  });

  it('机身中心移动按平行轴定理改变重心及惯量，旧数据中心归零', () => {
    const d = definition(d => { d.fuselage.center = 0.2; }), base = derive(defaultAircraft), moved = derive(d);
    const bodyMass = 22 + 1.1 * d.fuselage.length, delta = d.fuselage.center;
    const bodyX = -0.13 * d.fuselage.length;
    expect(moved.mass).toBe(base.mass);
    expect(moved.cg.x - base.cg.x).toBeCloseTo(bodyMass * delta / base.mass, 12);
    const inertiaChange = 2 * bodyMass * delta * (bodyX - base.cg.x)
      + bodyMass * delta ** 2 * (1 - bodyMass / base.mass);
    expect(moved.inertia.y - base.inertia.y).toBeCloseTo(inertiaChange, 10);
    expect(moved.inertia.z - base.inertia.z).toBeCloseTo(inertiaChange, 10);
    expect(moved.inertia.x).toBe(base.inertia.x);
    const legacy = definition();
    delete (legacy.fuselage as Partial<AircraftDefinition['fuselage']>).center;
    expect(derive(legacy).cg.toArray()).toEqual(base.cg.toArray());
    expect(new FlightSimulation(legacy, 'standard', 0).definition.fuselage.center).toBe(0);
  });

  it.each([
    { end: 'nose', center: 1, length: 9, pitch: -90 },
    { end: 'tail', center: -2, length: 10, pitch: 90 },
  ] as const)('机身$end接触点随center移动，接水时不等待旧端点', ({ end, center, length, pitch }) => {
    const d = definition(d => { d.fuselage.center = center; d.fuselage.length = length; });
    const s = new FlightSimulation(d, 'standard', 0), ends = fuselageEnds(d);
    s.launching = false;
    s.quaternion.setFromAxisAngle(axisZ, pitch * DEG);
    const endX = end === 'nose' ? ends.nose + 0.252 : ends.tail;
    s.position.set(30, Math.abs(endX - s.aircraft.cg.x) - 0.01, 0);
    s.step(neutral, 1e-8);
    expect(s.position.y).toBeGreaterThan(0);
    expect(s.result?.landing).toBe('water');
  });

  it('估算失速速度复用全重与主翼极曲线峰值，不虚构安装角或地效增升', () => {
    const base = derive(defaultAircraft);
    const straight = definition(d => { d.mainWing = wing(8, 1.5, 1.5); });
    const swept = clone(straight);
    swept.mainWing = wing(8, 1.5, 1.5, 3);
    expect(derive(swept).stallSpeed).toBeGreaterThan(derive(straight).stallSpeed);
    expect(base.stallSpeed).toBeGreaterThan(0);
    const angled = derive(definition(d => { d.assembly.mainIncidence += 4; d.assembly.tailIncidence += 3; }));
    // 安装角改变支撑板投影面积与质量，失速速度只响应实际全重变化。
    expect(angled.stallSpeed / base.stallSpeed).toBeCloseTo(Math.sqrt(angled.mass / base.mass), 12);
    const heavy = derive(definition(d => { d.fuselage.length += 1; }));
    expect(heavy.stallSpeed / base.stallSpeed).toBeCloseTo(Math.sqrt(heavy.mass / base.mass), 12);
    const big = derive(definition(d => { d.mainWing = wing(18, 2, 1.5); }));
    expect(big.stallSpeed).toBeLessThan(base.stallSpeed);
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
    const snapshot = s.position.clone();
    s.step(neutral);
    expect(s.position.equals(snapshot)).toBe(true);
  });

  it('机翼尖先接水也结束，不等待重心沉入水面', () => {
    const s = new FlightSimulation(defaultAircraft, 'standard', 0);
    s.launching = false;
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
    const s = new FlightSimulation(defaultAircraft, 'standard', 0);
    s.launching = false;
    s.position.set(x, y, 0);
    s.step(neutral);
    expect(s.result?.landing).toBe(landing);
  });

  it('零速度不产生除零；重力仍使飞机下落', () => {
    const s = new FlightSimulation(defaultAircraft, 'standard', 0);
    s.launching = false;
    s.position.set(30, 50, 0); s.velocity.set(0, 0, 0);
    s.step(neutral);
    finite(s);
    // 中点来流包含本步重力下落，微小空气阻力不是零。
    expect(s.velocity.y).toBeCloseTo(-GRAVITY / 60, 4);
    expect(s.telemetry.force.y).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) s.step(neutral);
    finite(s);
  });

  it('外部大步长拆为60Hz；非有限/过大/非正步长拒绝', () => {
    const a = new FlightSimulation(defaultAircraft, 'standard', 0), b = new FlightSimulation(defaultAircraft, 'standard', 0);
    for (let second = 0; second < 5; second++) {
      for (let quarter = 0; quarter < 4; quarter++) a.step(neutral, 0.25);
      for (let frame = 0; frame < 60; frame++) b.step(neutral);
    }
    expect(a.position.distanceTo(b.position)).toBeLessThan(1e-10);
    expect(a.quaternion.angleTo(b.quaternion)).toBeLessThan(1e-7);
    for (const dt of [0, -1, NaN, Infinity, 1]) expect(() => a.step(neutral, dt)).toThrow();
    expect(() => a.step({ ...neutral, elevator: NaN })).toThrow();
  });

  it('重置清除状态、统计、记录与结果，构型不被模拟改写', () => {
    const d = definition(), before = JSON.stringify(d);
    const s = fly(d);
    s.reset();
    expect(s.position.toArray()).toEqual([LAUNCH.startX, launchHeight(d), 0]);
    expect(s.launching).toBe(true);
    expect(s.omega.length()).toBe(0);
    expect(s.time).toBe(0); expect(s.result).toBeNull(); expect(s.ended).toBe(false);
    expect(s.recordingLength).toBe(0);
    expect(s.telemetry.energy).toBeCloseTo(derive(d).mass * launchHeight(d) * GRAVITY);
    expect(s.telemetry.initialEnergy).toBe(0);
    expect(s.telemetry.dissipatedEnergy).toBe(0);
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

  it('B：主翼面积改变翼载荷和瞬时升力', () => {
    const big = definition(d => { d.mainWing = { ...wing(14, 2, 1.5, 0.25), dihedral: 5 }; });
    expect(derive(big).wingLoading).toBeLessThan(derive(defaultAircraft).wingLoading);
    expect(probe(big).telemetry.force.y).toBeGreaterThan(probe().telemetry.force.y);
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
    const near = definition(d => { resizeFuselage(d, 'tail', -4.5); });
    const far = clone(near);
    far.assembly.horizontalTail = -4.5;
    expect(pitchSlope(large)).toBeLessThan(pitchSlope(small));
    expect(pitchSlope(far)).toBeLessThan(pitchSlope(near));
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

  it('前后掠在侧滑中产生相反滚转，且大后掠降低同攻角升力', () => {
    const sample = (sweep: number, beta: number) => probe(definition(d => {
      d.mainWing = wing(8, 1.5, 1.5, sweep);
      d.assembly.mainIncidence = 4;
    }), s => { s.velocity.set(12, -1, beta); });
    const roll = (s: FlightSimulation) => s.telemetry.aerodynamics.wings[0].torque.x;
    const aft = sample(3, 2), forward = sample(-3, 2);
    expect(roll(aft)).toBeLessThan(-1);
    expect(roll(forward)).toBeGreaterThan(1);
    expect(roll(sample(3, -2))).toBeGreaterThan(1);
    expect(roll(sample(-3, -2))).toBeLessThan(-1);
    expect(sample(3, 0).telemetry.aerodynamics.wings[0].lift.y)
      .toBeLessThan(sample(0, 0).telemetry.aerodynamics.wings[0].lift.y);
    for (const s of [aft, forward]) {
      expect(s.telemetry.aeroPower).toBeLessThan(0);
      budget(s);
    }
  });

  it('G：主翼和水平尾翼安装角各自改变配平力矩', () => {
    const base = probe();
    const main = probe(definition(d => { d.assembly.mainIncidence += 3; }));
    const tail = probe(definition(d => { d.assembly.tailIncidence += 3; }));
    expect(main.telemetry.force.y).toBeGreaterThan(base.telemetry.force.y);
    expect(Math.abs(main.telemetry.torque.z - base.telemetry.torque.z)).toBeGreaterThan(1);
    expect(tail.telemetry.torque.z).toBeLessThan(base.telemetry.torque.z);
    const reference = derive(defaultAircraft).aerodynamics;
    for (const [key, wingIndex] of [['mainIncidence', 0], ['tailIncidence', 1]] as const) {
      const changed = derive(definition(d => { d.assembly[key] += 3; })).aerodynamics;
      expect(changed.wings[wingIndex].alpha - reference.wings[wingIndex].alpha).toBeCloseTo(3 * DEG, 12);
      expect(changed.wings[wingIndex].lift.y).toBeGreaterThan(reference.wings[wingIndex].lift.y);
      expect(changed.wings[wingIndex].drag.length()).toBeGreaterThan(reference.wings[wingIndex].drag.length());
      expect(Math.abs(changed.wings[wingIndex].torque.z - reference.wings[wingIndex].torque.z)).toBeGreaterThan(1);
    }
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
    budget(stalledFlight);
  });
});

describe('三翼共享参考模型与合力中心', () => {
  it('自由空气参考明确速度、攻角和侧滑，远离水面的飞行受力收敛到参考', () => {
    const reference = derive(defaultAircraft).aerodynamics;
    expect(reference.speed).toBeCloseTo(12, 12);
    expect(reference.alpha).toBeCloseTo(5 * DEG, 12);
    expect(reference.beta).toBeCloseTo(3 * DEG, 12);
    expect(reference.wings.map(wing => wing.kind)).toEqual(['main', 'tail', 'vertical']);
    const s = new FlightSimulation(defaultAircraft, 'standard', 0);
    s.launching = false; s.position.set(30, 280, 0);
    s.velocity.set(12 * Math.cos(reference.alpha) * Math.cos(reference.beta),
      -12 * Math.sin(reference.alpha) * Math.cos(reference.beta), 12 * Math.sin(reference.beta));
    s.step(neutral, 1e-8);
    for (let i = 0; i < reference.wings.length; i++) {
      const expected = reference.wings[i], actual = s.telemetry.aerodynamics.wings[i];
      expect(actual.force.distanceTo(expected.force)).toBeLessThan(0.01);
      expect(actual.alpha).toBeCloseTo(expected.alpha, 5);
      expect(expected.groundEffect).toBe(1);
    }
  });

  it('水平尾翼独立产生升力和阻力，面积及安装角改变其受力', () => {
    const base = derive(defaultAircraft).aerodynamics.wings[1];
    const angled = derive(definition(d => { d.assembly.tailIncidence += 5; })).aerodynamics.wings[1];
    const enlarged = derive(definition(d => { d.horizontalTail = wing(4.5, 1.1, 0.8); })).aerodynamics.wings[1];
    expect(Math.abs(base.lift.y)).toBeGreaterThan(1);
    expect(base.drag.x).toBeLessThan(0);
    expect(angled.alpha).toBeGreaterThan(base.alpha);
    expect(angled.lift.y).toBeGreaterThan(base.lift.y);
    expect(enlarged.drag.length()).toBeGreaterThan(base.drag.length());
    expect(enlarged.area).toBeCloseTo(planform(wing(4.5, 1.1, 0.8)).area);
    expect(enlarged.aspect).toBeCloseTo(planform(wing(4.5, 1.1, 0.8)).aspect);
  });

  it('垂尾侧力与侧滑相反，并独立贡献阻力和偏航力矩', () => {
    const base = derive(defaultAircraft).aerodynamics.wings[2];
    const enlarged = derive(definition(d => { d.verticalTail = wing(4, 1.1, 0.8); })).aerodynamics.wings[2];
    expect(base.lift.z).toBeLessThan(-1);
    expect(base.drag.x).toBeLessThan(0);
    expect(base.torque.y).toBeLessThan(0);
    expect(Math.abs(enlarged.lift.z)).toBeGreaterThan(Math.abs(base.lift.z));
    expect(enlarged.drag.length()).toBeGreaterThan(base.drag.length());
    expect(enlarged.area).toBeCloseTo(planform(wing(4, 1.1, 0.8), false).area);
    expect(enlarged.aspect).toBeCloseTo(planform(wing(4, 1.1, 0.8), false).aspect);
  });

  it('三翼加机身等于全机合力，等效中心和自由力矩完整重建气动力矩', () => {
    const p = derive(defaultAircraft), a = p.aerodynamics;
    const force = a.bodyDrag.clone(), drag = a.bodyDrag.clone(), torque = new Vector3();
    for (const wing of a.wings) {
      force.add(wing.force); drag.add(wing.drag); torque.add(wing.torque);
      expect(wing.force.distanceTo(wing.lift.clone().add(wing.drag))).toBeLessThan(1e-9);
    }
    expect(force.distanceTo(a.force)).toBeLessThan(1e-9);
    expect(drag.distanceTo(a.drag)).toBeLessThan(1e-9);
    expect(torque.distanceTo(a.torque)).toBeLessThan(1e-9);
    expect(a.liftCenter).not.toBeNull(); expect(a.dragCenter).not.toBeNull();
    const reconstructed = new Vector3().crossVectors(a.liftCenter!.clone().sub(p.cg), a.lift)
      .add(new Vector3().crossVectors(a.dragCenter!.clone().sub(p.cg), a.drag))
      .add(a.liftMoment).add(a.dragMoment).add(a.freeMoment);
    expect(reconstructed.distanceTo(a.torque)).toBeLessThan(1e-8);
    expect(a.liftMoment.length() + a.dragMoment.length()).toBeGreaterThan(1e-4);
    const moved = derive(definition(d => { d.assembly.horizontalTail -= 1; resizeFuselage(d, 'tail', d.assembly.horizontalTail); }));
    expect(moved.aerodynamics.liftCenter!.distanceTo(a.liftCenter!)).toBeGreaterThan(0.001);
    expect(p.mainQuarterChord.equals(moved.mainQuarterChord)).toBe(true);
  });

  it('实时分翼对象复用，零来流没有虚构中心，重置清空残留受力', () => {
    const s = new FlightSimulation(defaultAircraft, 'standard', 0), a = s.telemetry.aerodynamics;
    const wings = a.wings, force = wings[0].force;
    expect(a.liftCenter).toBeNull(); expect(a.dragCenter).toBeNull();
    s.launching = false; s.position.set(30, 80, 0); s.velocity.set(12, -1, 2); s.omega.set(0.2, 0.1, 0.3);
    s.step(neutral);
    expect(s.telemetry.aerodynamics).toBe(a); expect(a.wings).toBe(wings); expect(a.wings[0].force).toBe(force);
    const total = a.bodyDrag.clone();
    for (const wing of a.wings) total.add(wing.force);
    expect(total.distanceTo(a.force)).toBeLessThan(1e-9);
    const reconstructed = a.freeMoment.clone().add(a.liftMoment).add(a.dragMoment)
      .add(new Vector3().crossVectors(a.liftCenter!.clone().sub(s.aircraft.cg), a.lift))
      .add(new Vector3().crossVectors(a.dragCenter!.clone().sub(s.aircraft.cg), a.drag));
    expect(reconstructed.distanceTo(s.telemetry.torque)).toBeLessThan(1e-8);
    s.reset();
    expect(a.liftCenter).toBeNull(); expect(a.dragCenter).toBeNull();
    expect(a.force.length()).toBe(0); expect(a.torque.length()).toBe(0);
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

  it('偏航改变垂尾局部侧滑，横滚让左右主翼迎角不同', () => {
    const yawing = probe(undefined, s => { s.omega.y = 0.4; });
    const vertical = yawing.surfaces.find(surface => surface.kind === 'vertical')!;
    expect(vertical.alpha).toBeLessThan(-0.02);
    expect(vertical.force.z).toBeLessThan(-1);
    expect(yawing.telemetry.torque.y).toBeLessThan(0);
    const rolling = probe(undefined, s => { s.omega.x = 0.4; });
    const main = rolling.surfaces.filter(surface => surface.kind === 'main');
    expect(main[1].alpha).toBeGreaterThan(main[0].alpha);
    expect(rolling.telemetry.torque.x).toBeLessThan(0);
  });

  it('输入改变面上气动力，不直接写入姿态；拉杆产生抬头力矩', () => {
    const base = probe();
    const pull = new FlightSimulation(defaultAircraft, 'standard', 0);
    pull.launching = false;
    pull.position.set(30, 80, 0); pull.quaternion.identity(); pull.velocity.set(12, -1, 0);
    pull.step({ ...neutral, elevator: 0.5 });
    expect(pull.telemetry.torque.z).toBeGreaterThan(base.telemetry.torque.z);
    const tiny = new FlightSimulation(defaultAircraft, 'standard', 0), q = tiny.quaternion.clone();
    tiny.step({ weight: 1, rudder: 1, elevator: 1, aileron: 1 }, 1e-7);
    expect(tiny.quaternion.angleTo(q)).toBeLessThan(1e-6);
  });

  it.each(['standard', 'assisted', 'experimental'] as const)('%s 静态输入飞行的气动力做功非正，总机械能不凭空增加', mode => {
    const s = release(new FlightSimulation(defaultAircraft, mode, 0)), initial = s.telemetry.initialEnergy;
    let previous = s.telemetry.energy, previousDissipation = 0;
    for (let i = 0; i < 1800 && !s.ended; i++) {
      s.step(neutral);
      finite(s);
      budget(s);
      expect(s.telemetry.aeroPower).toBeLessThanOrEqual(0);
      expect(s.telemetry.energy).toBeLessThanOrEqual(previous + initial * 1e-10);
      expect(s.telemetry.dissipatedEnergy).toBeGreaterThanOrEqual(previousDissipation);
      previous = s.telemetry.energy;
      previousDissipation = s.telemetry.dissipatedEnergy;
    }
    expect(s.ended).toBe(true);
  });

  it('高频抖动全部操纵不提供无源推进或能量增益', () => {
    const s = release(), initial = s.telemetry.initialEnergy;
    const input = { ...neutral };
    for (let i = 0; i < 900 && !s.ended; i++) {
      const sign = i % 2 ? 1 : -1;
      input.weight = sign; input.rudder = sign; input.elevator = sign; input.aileron = sign;
      s.step(input);
      finite(s);
      budget(s);
      expect(s.telemetry.aeroPower).toBeLessThanOrEqual(0);
      expect(s.telemetry.energy).toBeLessThanOrEqual(initial * (1 + 1e-10));
    }
  });

  it('耗散只积分真实阻力功，不能填平数值残差；动能包含转动', () => {
    const s = new FlightSimulation(defaultAircraft, 'standard', 0);
    s.launching = false;
    s.position.set(30, 100, 0); s.velocity.set(12, -1, 2); s.omega.set(0.7, 0.9, 0.4);
    const initial = s.aircraft.mass * (GRAVITY * s.position.y + s.velocity.lengthSq() / 2)
      + s.aircraft.inertia.dot(new Vector3(s.omega.x ** 2, s.omega.y ** 2, s.omega.z ** 2)) / 2;
    const inertia = s.aircraft.inertia.clone(), input = { ...neutral }, dt = 1 / 240;
    let previousDissipation = 0;
    for (let frame = 0; frame < 240 && !s.ended; frame++) {
      input.weight = Math.sin(frame / 7);
      input.elevator = Math.cos(frame / 11) * 0.4;
      input.rudder = Math.sin(frame / 13) * 0.5;
      input.aileron = Math.cos(frame / 17) * 0.3;
      s.step(input, dt);
      expect(s.telemetry.initialEnergy).toBeCloseTo(initial, 8);
      expect(s.telemetry.dissipatedEnergy - previousDissipation).toBeCloseTo(-s.telemetry.aeroPower * dt, 8);
      expect(s.aircraft.inertia.equals(inertia)).toBe(true);
      const rotational = s.aircraft.inertia.dot(new Vector3(s.omega.x ** 2, s.omega.y ** 2, s.omega.z ** 2)) / 2;
      expect(s.telemetry.kineticEnergy).toBeCloseTo(s.aircraft.mass * s.velocity.lengthSq() / 2 + rotational, 8);
      budget(s);
      previousDissipation = s.telemetry.dissipatedEnergy;
    }
  });

  it('实时升阻比由实际合力沿来流分解，不冒用轨迹滑翔比', () => {
    const s = new FlightSimulation(defaultAircraft, 'standard', 0);
    s.launching = false;
    s.position.set(30, 80, 0); s.velocity.set(12, -1, 0);
    s.step(neutral, 1e-7);
    const flow = s.velocity.clone().normalize();
    const drag = -s.telemetry.force.dot(flow);
    const lift = s.telemetry.force.clone().addScaledVector(flow, drag).length();
    expect(drag).toBeGreaterThan(0);
    expect(s.telemetry.liftDragRatio).toBeCloseTo(lift / drag, 5);
    expect(Math.abs(s.telemetry.liftDragRatio - s.telemetry.glide)).toBeGreaterThan(0.1);
    expect(s.telemetry.liftDragRatio).toBeGreaterThan(0);
  });

  it('默认滚转在±1°随机抽样，reset重抽；助跑水平，扰动仅在离台时施加且不注入动能', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValueOnce(0.5);
    try {
      const s = new FlightSimulation(defaultAircraft);
      expect(s.getRecording().launchRoll).toBe(-LAUNCH_ROLL_LIMIT);
      expect(s.quaternion.toArray()).toEqual([0, 0, 0, 1]);
      const height = s.position.y;
      for (let i = 0; i < 15; i++) s.step(neutral, 0.25);
      expect(s.launching).toBe(true);
      expect(s.telemetry.roll).toBe(0);
      s.step(neutral, 0.25);
      expect(s.launching).toBe(false);
      expect(s.telemetry.roll).toBeCloseTo(-LAUNCH_ROLL_LIMIT, 14);
      expect(s.position.y).toBe(height);
      expect(s.velocity.toArray()).toEqual([LAUNCH.speed, 0, 0]);
      expect(s.omega.length()).toBe(0);
      expect(s.telemetry.kineticEnergy).toBe(s.aircraft.mass * LAUNCH.speed ** 2 / 2);
      budget(s);
      s.reset();
      expect(s.getRecording().launchRoll).toBe(LAUNCH_ROLL_LIMIT);
      expect(s.telemetry.roll).toBe(0);
      expect(s.recordingLength).toBe(0);
      const midpoint = new FlightSimulation(defaultAircraft);
      expect(midpoint.getRecording().launchRoll).toBe(0);
      expect(random).toHaveBeenCalledTimes(3);
    } finally {
      random.mockRestore();
    }
  });

  it.each([-LAUNCH_ROLL_LIMIT, LAUNCH_ROLL_LIMIT])('离台滚转%r保留大安装角主翼净空，不立即碰台', roll => {
    const d = definition(d => {
      d.mainWing = wing(24, 5.8, 5.8);
      d.assembly.mainWingHeight = 0;
      d.assembly.mainIncidence = 18;
    });
    const s = release(new FlightSimulation(d, 'standard', roll));
    expect(s.telemetry.roll).toBeCloseTo(roll, 14);
    for (let i = 0; i < 3; i++) {
      s.step(neutral);
      expect(s.result?.landing).not.toBe('platform');
      expect(s.ended).toBe(false);
      budget(s);
    }
  });

  it('明确滚转跨reset保持；非法滚转及非法回放拒绝', () => {
    const s = release(new FlightSimulation(defaultAircraft, 'standard', 0.37 * DEG));
    expect(s.getRecording().launchRoll).toBe(0.37 * DEG);
    s.reset();
    expect(s.getRecording().launchRoll).toBe(0.37 * DEG);
    expect(s.telemetry.roll).toBe(0);
    for (const roll of [NaN, Infinity, -Infinity, LAUNCH_ROLL_LIMIT * 1.01, -LAUNCH_ROLL_LIMIT * 1.01]) {
      expect(() => new FlightSimulation(defaultAircraft, 'standard', roll)).toThrow();
      expect(() => s.loadReplay({ frames: new Float64Array(), length: 0, launchRoll: roll })).toThrow();
    }
  });

  it('非零精确扰动记录后覆盖回放构造角度，逐帧重现位姿与能量；退出回放重置恢复构造角度', () => {
    const original = new FlightSimulation(defaultAircraft, 'standard', 0.713829 * DEG);
    const states: { position: number[]; quaternion: number[]; velocity: number[]; energy: number }[] = [];
    for (let i = 0; i < 300 && !original.ended; i++) {
      original.step(neutral);
      states.push({ position: original.position.toArray(), quaternion: original.quaternion.toArray(),
        velocity: original.velocity.toArray(), energy: original.telemetry.energy });
    }
    const recording = original.getRecording();
    expect(recording.launchRoll).toBe(0.713829 * DEG);
    const replay = new FlightSimulation(defaultAircraft, 'standard', -0.4 * DEG);
    replay.loadReplay(recording);
    expect(replay.getRecording().launchRoll).toBe(recording.launchRoll);
    expect(replay.telemetry.roll).toBe(0);
    for (const state of states) {
      replay.step(neutral, 0.2);
      expect(replay.position.toArray()).toEqual(state.position);
      expect(replay.quaternion.toArray()).toEqual(state.quaternion);
      expect(replay.velocity.toArray()).toEqual(state.velocity);
      expect(replay.telemetry.energy).toBe(state.energy);
    }
    expect(replay.launching).toBe(false);
    expect(replay.replayFinished).toBe(true);
    replay.reset();
    expect(replay.getRecording().launchRoll).toBe(-0.4 * DEG);
    expect(replay.telemetry.roll).toBe(0);
  });

  it('输入录制重放逐帧重现位姿、速度和结果，与外部帧率无关', () => {
    const original = new FlightSimulation(defaultAircraft, 'standard', 0);
    const input = { ...neutral };
    for (let i = 0; i < 420 && !original.ended; i++) {
      input.elevator = Math.sin(i / 20) * 0.08;
      input.rudder = Math.sin(i / 18) * 0.04;
      original.step(input, i % 2 ? 1 / 60 : 1 / 120);
    }
    const recording = original.getRecording();
    const replay = new FlightSimulation(defaultAircraft, 'standard', 0);
    replay.loadReplay(recording);
    while (!replay.replayFinished && !replay.ended) replay.step(neutral, 0.2);
    expect(replay.position.toArray()).toEqual(original.position.toArray());
    expect(replay.velocity.toArray()).toEqual(original.velocity.toArray());
    expect(replay.quaternion.toArray()).toEqual(original.quaternion.toArray());
    expect(replay.time).toBe(original.time);
    expect(replay.recordingLength).toBe(recording.length);
    expect(replay.result).toEqual(original.result);
    expect(replay.telemetry.initialEnergy).toBe(original.telemetry.initialEnergy);
    expect(replay.telemetry.dissipatedEnergy).toBe(original.telemetry.dissipatedEnergy);
    expect(replay.launching).toBe(original.launching);
    const snapshot = replay.position.clone(); replay.step(neutral);
    expect(replay.position.equals(snapshot)).toBe(true);
    expect(() => replay.loadReplay({ frames: new Float64Array([NaN, 0, 0, 0, 0]), length: 1, launchRoll: 0 })).toThrow();
  });

  it('全程输入重放得到同一落点和同一结算', () => {
    const original = fly(), replay = new FlightSimulation(defaultAircraft, 'standard', 0);
    replay.loadReplay(original.getRecording());
    while (!replay.ended && !replay.replayFinished) replay.step(neutral);
    expect(replay.ended).toBe(true);
    expect(replay.result).toEqual(original.result);
  });

  it.each([
    { name: '最大半展', make: () => definition(d => { d.mainWing = { ...wing(24, 1.5, 0.8), dihedral: 25 }; }) },
    { name: '最小主翼', make: () => definition(d => { d.mainWing = wing(0.5, 0.15, 0.15); }) },
    { name: '最小全部翼面', make: () => definition(d => { d.mainWing = wing(0.5, 0.15, 0.15); d.horizontalTail = wing(0.5, 0.15, 0.15); d.verticalTail = wing(0.5, 0.15, 0.15); }) },
  ])('$name 极端合法几何在大外部步长下保持有限姿态与能量', ({ make }) => {
    const s = release(new FlightSimulation(make(), 'standard', 0)), initial = s.telemetry.initialEnergy;
    for (let i = 0; i < 180 && !s.ended; i++) {
      s.step(neutral, i % 2 === 0 ? 0.25 : 1 / 60);
      finite(s);
      budget(s);
      expect(s.telemetry.energy).toBeLessThanOrEqual(initial * (1 + 1e-10));
      expect(s.telemetry.aeroPower).toBeLessThanOrEqual(0);
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
    budget(s);
    expect(s.ended).toBe(true);
    expect(s.result).not.toBeNull();
    expect(s.result!.distance).toBeGreaterThan(0);
    expect(s.result!.time).toBeGreaterThan(0);
    expect(Number.isFinite(s.result!.averageSpeed)).toBe(true);
    expect(s.recordingLength).toBeGreaterThan(0);
  });
});

describe('安装基准与支撑的真实质量分布', () => {
  it.each([
    { height: -0.5, angle: 0 }, { height: 0.5, angle: 0 },
    { height: -0.5, angle: 12 }, { height: 0.5, angle: 12 },
  ])('高度$height m、安装角$angle°的支撑质量、重心和惯量满足平行轴定理', ({ height, angle }) => {
    const flat = definition(d => { d.assembly.mainWingHeight = 0; d.assembly.mainIncidence = angle; });
    const raised = clone(flat);
    raised.assembly.mainWingHeight = height;
    const base = derive(flat), actual = derive(raised), support = mainWingSupport(raised), p = planform(flat.mainWing);
    const wingMass = p.area * 0.95 + 0.0025 * p.span ** 3;
    const wingY = base.mainQuarterChord.y - p.chord / 4 * Math.sin(angle * DEG);
    const expectedY = (base.mass * base.cg.y + wingMass * height + support.mass * support.y) / actual.mass;
    expect(actual.mass - base.mass).toBeCloseTo(support.mass, 12);
    expect(actual.cg.x).toBeCloseTo((base.mass * base.cg.x + support.mass * support.x) / actual.mass, 12);
    expect(actual.cg.y).toBeCloseTo(expectedY, 12);
    const movedWingMoment = wingMass * (2 * wingY * height + height ** 2);
    const supportXMoment = support.mass * (((support.frontY - support.backY) ** 2 + height ** 2) / 12 + support.y ** 2);
    const supportYMoment = support.mass * (support.width ** 2 / 12 + support.x ** 2);
    expect(actual.inertia.x + actual.mass * actual.cg.y ** 2)
      .toBeCloseTo(base.inertia.x + base.mass * base.cg.y ** 2 + movedWingMoment + supportXMoment, 10);
    expect(actual.inertia.y + actual.mass * actual.cg.x ** 2)
      .toBeCloseTo(base.inertia.y + base.mass * base.cg.x ** 2 + supportYMoment, 10);
    expect(actual.inertia.z + actual.mass * (actual.cg.x ** 2 + actual.cg.y ** 2))
      .toBeCloseTo(base.inertia.z + base.mass * (base.cg.x ** 2 + base.cg.y ** 2)
        + movedWingMoment + supportXMoment + supportYMoment, 10);
    expect(actual.stallSpeed / base.stallSpeed).toBeCloseTo(Math.sqrt(actual.mass / base.mass), 12);
    // 支撑不引入未要求的额外阻力；设计参考仍在自由空气中。
    expect(actual.aerodynamics.force.distanceTo(base.aerodynamics.force)).toBeLessThan(1e-9);
  });

  it('主翼根中心高度不随安装角漂移，质量和四分之一弦使用同一旋转原点', () => {
    const d = definition(d => {
      d.mainWing = wing(14, 1.5, 1.5);
      d.assembly.mainWingHeight = 0;
      d.assembly.mainIncidence = 0;
    });
    const base = derive(d), angled = clone(d);
    angled.assembly.mainIncidence = 12;
    const actual = derive(angled), origin = wingOrigin(angled, 'mainWing'), angle = 12 * DEG;
    const p = planform(d.mainWing), wingMass = p.area * 0.95 + 0.0025 * p.span ** 3;
    expect(origin.y - 0.75 * Math.sin(angle)).toBeCloseTo(0, 12);
    expect(actual.cg.y).toBeCloseTo(base.cg.y, 12);
    expect(actual.cg.x - base.cg.x).toBeCloseTo(wingMass * 0.75 * (1 - Math.cos(angle)) / base.mass, 12);
    expect(actual.mainQuarterChord.x).toBeCloseTo(origin.x - 0.375 * Math.cos(angle), 12);
    expect(actual.mainQuarterChord.y).toBeCloseTo(origin.y - 0.375 * Math.sin(angle), 12);
    const surface = new FlightSimulation(angled, 'standard', 0).surfaces.find(surface => surface.kind === 'main')!;
    expect(surface.point.x).toBeCloseTo(actual.mainQuarterChord.x, 12);
    expect(surface.point.y).toBeCloseTo(actual.mainQuarterChord.y, 12);
    expect(actual.aerodynamics.wings[0].alpha - base.aerodynamics.wings[0].alpha).toBeCloseTo(angle, 12);
  });

  it('水平尾翼绕梁上根中心旋转，质量中心不使用旧的0.35m气动基线', () => {
    const d = definition(d => { d.horizontalTail = wing(4, 1, 1); d.assembly.tailIncidence = 0; });
    const angled = clone(d);
    angled.assembly.tailIncidence = 10;
    const base = derive(d), actual = derive(angled);
    expect(actual.mass).toBe(base.mass);
    expect(actual.cg.distanceTo(base.cg)).toBeLessThan(1e-12);
    expect(actual.inertia.x).toBeGreaterThan(base.inertia.x);
    expect(actual.inertia.y).toBeLessThan(base.inertia.y);
    const surface = new FlightSimulation(angled, 'standard', 0).surfaces.find(surface => surface.kind === 'tail')!;
    expect(surface.point.x).toBeCloseTo(d.assembly.horizontalTail + 0.25 * Math.cos(10 * DEG), 12);
    expect(surface.point.y).toBeCloseTo(0.25 * Math.sin(10 * DEG), 12);
    expect(actual.aerodynamics.wings[1].alpha - base.aerodynamics.wings[1].alpha).toBeCloseTo(10 * DEG, 12);
  });

  it('垂尾根中心位于梁上，整体平移同步改变质心和气动作用点', () => {
    const d = definition(d => { d.verticalTail = wing(3, 1, 1); });
    const moved = clone(d);
    moved.assembly.verticalTail += 0.3;
    const base = derive(d), actual = derive(moved), mass = planform(d.verticalTail, false).area * 0.9;
    const a = new FlightSimulation(d, 'standard', 0).surfaces.find(surface => surface.kind === 'vertical')!;
    const b = new FlightSimulation(moved, 'standard', 0).surfaces.find(surface => surface.kind === 'vertical')!;
    expect(a.point.x).toBeCloseTo(d.assembly.verticalTail + 0.25, 12);
    expect(a.point.y).toBeCloseTo(planform(d.verticalTail, false).span / 2, 12);
    expect(actual.cg.x - base.cg.x).toBeCloseTo(mass * 0.3 / base.mass, 12);
    expect(b.point.x - a.point.x).toBeCloseTo(0.3, 12);
    expect(b.point.y).toBe(a.point.y);
  });

  it('尾翼安装角的真实根后缘参与平台净空', () => {
    const d = definition(d => {
      d.horizontalTail = wing(4, 5.8, 5.8);
      d.assembly.tailIncidence = 12;
      d.assembly.mainIncidence = 0;
    });
    const p = derive(d), origin = wingOrigin(d, 'horizontalTail');
    const rootTrailingY = origin.y - 5.8 * Math.sin(12 * DEG);
    expect(launchHeight(d) - p.cg.y + rootTrailingY).toBeGreaterThanOrEqual(LAUNCH.height + 0.05 - 1e-10);
    const flat = clone(d);
    flat.assembly.tailIncidence = 0;
    expect(launchHeight(d)).toBeGreaterThan(launchHeight(flat) + 0.1);
  });
});

describe('水面有限翼地效', () => {
  function sample(height: number, d = definition(), roll = 0, alpha = 5 * DEG, beta = 3 * DEG) {
    const s = new FlightSimulation(d, 'standard', 0);
    s.launching = false;
    s.position.set(30, height, 0);
    s.quaternion.setFromAxisAngle(axisX, roll);
    s.velocity.set(12 * Math.cos(alpha) * Math.cos(beta), -12 * Math.sin(alpha) * Math.cos(beta), 12 * Math.sin(beta))
      .applyQuaternion(s.quaternion);
    s.step(neutral, 1e-8);
    return s;
  }

  it('同速度同姿态越近水面诱导阻力越小、实际升阻比越高，远处恢复自由空气', () => {
    const low = sample(1), middle = sample(4), high = sample(280);
    const reference = derive(defaultAircraft).aerodynamics;
    const main = (s: FlightSimulation) => s.telemetry.aerodynamics.wings[0];
    expect(main(low).inducedDrag).toBeLessThan(main(middle).inducedDrag);
    expect(main(middle).inducedDrag).toBeLessThan(main(high).inducedDrag);
    expect(low.telemetry.liftDragRatio).toBeGreaterThan(middle.telemetry.liftDragRatio);
    expect(middle.telemetry.liftDragRatio).toBeGreaterThan(high.telemetry.liftDragRatio);
    expect(main(high).groundEffect).toBeGreaterThan(0.999);
    expect(main(high).force.distanceTo(reference.wings[0].force)).toBeLessThan(0.01);
    expect(main(low).lift.distanceTo(main(high).lift)).toBeLessThan(1e-4);
    // 主翼下洗减弱，尾翼有效攻角随之恢复；垂尾不享受地效。
    expect(low.telemetry.aerodynamics.wings[1].alpha).toBeGreaterThan(high.telemetry.aerodynamics.wings[1].alpha);
    const verticalLow = low.telemetry.aerodynamics.wings[2], verticalHigh = high.telemetry.aerodynamics.wings[2];
    expect(verticalLow.groundEffect).toBe(1);
    expect(verticalLow.force.distanceTo(verticalHigh.force)).toBeLessThan(1e-5);
    for (const s of [low, middle, high]) budget(s);
  });

  it.each([5, 40])('迎角%s°时地效不缩放型阻或失速分离阻力', alpha => {
    const low = sample(1, definition(), 0, alpha * DEG), high = sample(280, definition(), 0, alpha * DEG);
    for (const panel of low.surfaces.filter(surface => surface.kind === 'main')) {
      const far = high.surfaces.find(surface => surface.kind === 'main' && surface.side === panel.side)!;
      expect(panel.inducedDrag).toBeLessThan(far.inducedDrag);
      expect(panel.drag.length() - panel.inducedDrag).toBeCloseTo(far.drag.length() - far.inducedDrag, 5);
      expect(panel.alpha).toBeCloseTo(far.alpha, 7);
    }
    expect(low.telemetry.aeroPower).toBeLessThanOrEqual(0);
    budget(low);
  });

  it('上反角抬高作用点而削弱地效，滚转按每半翼实际净空计算', () => {
    const flat = definition(d => { d.mainWing.dihedral = 0; });
    const dihedral = definition(d => { d.mainWing.dihedral = 15; });
    const a = sample(2, flat), b = sample(2, dihedral), rolling = sample(3, flat, 15 * DEG);
    expect(b.telemetry.aerodynamics.wings[0].groundEffect).toBeGreaterThan(a.telemetry.aerodynamics.wings[0].groundEffect);
    const left = rolling.surfaces.find(surface => surface.kind === 'main' && surface.side < 0)!;
    const right = rolling.surfaces.find(surface => surface.kind === 'main' && surface.side > 0)!;
    expect(right.clearance).toBeLessThan(left.clearance);
    expect(right.groundEffect).toBeLessThan(left.groundEffect);
    const reversed = sample(3, flat, -15 * DEG);
    const reversedLeft = reversed.surfaces.find(surface => surface.kind === 'main' && surface.side < 0)!;
    expect(reversedLeft.groundEffect).toBeCloseTo(right.groundEffect, 6);
    const banked = sample(20, flat, 80 * DEG), level = sample(20, flat);
    expect(banked.telemetry.aerodynamics.wings[0].groundEffect).toBeGreaterThan(level.telemetry.aerodynamics.wings[0].groundEffect);
  });

  it('同面积同升力同翼面净空下，长翼展具有更强地效且更低诱导阻力', () => {
    function equalLift(span: number) {
      const d = definition(d => { d.mainWing = wing(span, 16 / span, 16 / span); d.assembly.mainIncidence = 0; });
      const s = new FlightSimulation(d, 'standard', 0), main = s.surfaces.find(surface => surface.kind === 'main')!;
      const alpha = 0.7 / (2 * Math.PI * s.aircraft.aspect / (s.aircraft.aspect + 2)) - 2 * DEG;
      return sample(2 - main.point.y + s.aircraft.cg.y, d, 0, alpha, 0);
    }
    const short = equalLift(10).telemetry.aerodynamics.wings[0], long = equalLift(18).telemetry.aerodynamics.wings[0];
    expect(long.lift.length()).toBeCloseTo(short.lift.length(), 4);
    expect(long.groundEffect).toBeLessThan(short.groundEffect);
    expect(long.inducedDrag).toBeLessThan(short.inducedDrag);
  });

  it('地效参考连续水面，不在平台边缘跳变', () => {
    function at(x: number) {
      const s = new FlightSimulation(defaultAircraft, 'standard', 0);
      s.launching = false; s.position.set(x, 12, 0); s.velocity.set(12, -1, 0);
      s.step(neutral, 1e-8);
      return s.telemetry.aerodynamics.wings[0].groundEffect;
    }
    expect(at(-1e-5)).toBeCloseTo(at(1e-5), 12);
  });

  it.each([-0.5, 0.5])('高度%s m 支撑随整机进入近水积分，隐式中点保持功率与能量守恒', height => {
    const d = definition(d => { d.assembly.mainWingHeight = height; });
    const s = new FlightSimulation(d, 'standard', 0);
    s.launching = false; s.position.set(30, 3, 0); s.velocity.set(12, -0.3, 0); s.omega.set(0.08, 0.02, 0.03);
    for (let i = 0; i < 120 && !s.ended; i++) {
      const position = s.position.clone(), velocity = s.velocity.clone(), omega = s.omega.clone(), orientation = s.quaternion.clone();
      const previousDissipation = s.telemetry.dissipatedEnergy, dt = 1 / 240;
      s.step(neutral, dt);
      const midpoint = velocity.add(s.velocity).multiplyScalar(0.5);
      const rotation = omega.add(s.omega).multiplyScalar(0.5);
      const angle = rotation.length() * dt / 2;
      if (angle > 0) orientation.multiply(s.quaternion.clone().setFromAxisAngle(rotation.normalize(), angle));
      position.addScaledVector(midpoint, dt / 2);
      const panel = s.surfaces[0];
      const expectedClearance = panel.point.clone().sub(s.aircraft.cg).applyQuaternion(orientation).add(position).y;
      expect(panel.clearance).toBeCloseTo(expectedClearance, 9);
      expect(s.telemetry.aeroPower).toBeLessThanOrEqual(0);
      expect(s.telemetry.dissipatedEnergy - previousDissipation).toBeCloseTo(-s.telemetry.aeroPower * dt, 8);
      budget(s);
    }
  });
});
