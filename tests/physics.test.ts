import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { clone, defaultAircraft, DEG, fuelTankPosition, fuselageEnds, mainWingSupport, PILOT_MASS, planform, presets, resizeFuselage, wing, wingOrigin, type AircraftDefinition, type Controls } from '../src/model';
import { coefficients, derive, FlightSimulation, fuelCgRange, LAUNCH, LAUNCH_ROLL_LIMIT, launchHeight, PLATFORM, runwayHeight, SURFACE_STEP } from '../src/physics';

const neutral: Controls = { weight: 0, rudder: 0, elevator: 0, aileron: 0 };
const axisX = new Vector3(1, 0, 0), axisY = new Vector3(0, 1, 0);
function definition(change?: (d: AircraftDefinition) => void) { const d = clone(defaultAircraft); change?.(d); return d; }
function release(s = new FlightSimulation(defaultAircraft, 'birdman', 0)) {
  while (s.launching) s.step(neutral);
  expect(s.ended).toBe(false);
  return s;
}
function probe(d = definition(), setup?: (s: FlightSimulation) => void, dt = 1e-7) {
  const s = new FlightSimulation(d, 'birdman', 0);
  s.launching = false; s.position.set(40, 80, 0); s.quaternion.identity(); s.velocity.set(12, -1, 0);
  setup?.(s); s.step(neutral, dt); return s;
}
function pitchSlope(d: AircraftDefinition) {
  const low = probe(d, s => { s.velocity.set(12 * Math.cos(DEG), 12 * Math.sin(DEG), 0); });
  const high = probe(d, s => { s.velocity.set(12 * Math.cos(DEG), -12 * Math.sin(DEG), 0); });
  return high.telemetry.torque.z - low.telemetry.torque.z;
}
function fly(d = definition(), dt = 1 / 60) {
  const s = new FlightSimulation(d, d.birdman ? 'birdman' : 'downhill', 0);
  for (let i = 0; i < 90 / dt && !s.ended; i++) s.step(neutral, dt);
  return s;
}
function budget(s: FlightSimulation) {
  const t = s.telemetry;
  expect(t.initialEnergy).toBeGreaterThan(0);
  expect(t.dissipatedEnergy).toBeGreaterThanOrEqual(0);
  expect(Math.abs(t.energy + t.dissipatedEnergy - t.controlWork - t.initialEnergy) / t.initialEnergy).toBeLessThan(1e-8);
  expect(t.energy).toBeCloseTo(t.potentialEnergy + t.kineticEnergy, 8);
}
function world(s: FlightSimulation, point: Vector3) { return point.clone().sub(s.aircraft.cg).applyQuaternion(s.quaternion).add(s.position); }
function keelPoints(d: AircraftDefinition) {
  const { nose, tail } = fuselageEnds(d);
  const points = [new Vector3(nose, -0.12, 0), new Vector3(tail, -0.12, 0), new Vector3(d.cockpit.position - 0.75, -0.495, 0)];
  for (const key of ['mainWing', 'horizontalTail'] as const) {
    const origin = wingOrigin(d, key), angle = (key === 'mainWing' ? d.assembly.mainIncidence : d.assembly.tailIncidence) * DEG;
    for (const point of d[key].points) for (const side of [-1, 1]) points.push(new Vector3(origin.x - point.x * Math.cos(angle), origin.y - point.x * Math.sin(angle) + point.y * Math.tan(d[key].dihedral * DEG), side * point.y));
  }
  return points;
}
function compactAircraft() {
  return definition(d => {
    d.mainWing = wing(0.5, 0.3, 0.3); d.horizontalTail = wing(0.5, 0.3, 0.2); d.verticalTail = wing(0.6, 0.3, 0.2);
    d.assembly.mainWingHeight = 0; d.assembly.mainIncidence = 0;
  });
}
// 验证完整接触代理（含翼型厚度），不只验证重心或机身下缘。
function contacts(s: FlightSimulation) { return Reflect.get(s, 'contacts') as Vector3[]; }
function platformLocal(point: Vector3) {
  return point.clone().sub(new Vector3(LAUNCH.endX, LAUNCH.height, 0)).applyAxisAngle(new Vector3(0, 0, 1), LAUNCH.slope);
}
function outsidePlatform(s: FlightSimulation) {
  const boxes = [
    [-LAUNCH.length, 0, -PLATFORM.thickness, 0, -PLATFORM.width / 2, -PLATFORM.slotWidth / 2],
    [-LAUNCH.length, 0, -PLATFORM.thickness, 0, PLATFORM.slotWidth / 2, PLATFORM.width / 2],
    [-LAUNCH.length, 0, -PLATFORM.slotDepth - PLATFORM.slotFloorThickness, -PLATFORM.slotDepth, -PLATFORM.slotWidth / 2, PLATFORM.slotWidth / 2],
  ];
  for (const point of contacts(s)) {
    const p = platformLocal(world(s, point));
    for (const box of boxes) expect(Math.max(box[0] - p.x, p.x - box[1], box[2] - p.y, p.y - box[3], box[4] - p.z, p.z - box[5])).toBeGreaterThan(-3e-6);
  }
}
function approachingPlatform(axis: number, sign: number, speed = 3, gap = 0.01) {
  const s = new FlightSimulation(compactAircraft(), 'birdman', 0);
  s.launching = false;
  s.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), -LAUNCH.slope);
  const values = contacts(s).map(point => point.getComponent(axis) - s.aircraft.cg.getComponent(axis));
  const boundary = axis === 0 ? (sign > 0 ? 0 : -LAUNCH.length)
    : axis === 1 ? (sign > 0 ? 0 : -PLATFORM.thickness) : sign * PLATFORM.width / 2;
  const position = new Vector3(-5, -0.3, 1.5);
  position.setComponent(axis, boundary - (sign > 0 ? Math.min(...values) : Math.max(...values)) + sign * gap);
  s.position.copy(position).applyQuaternion(s.quaternion).add(new Vector3(LAUNCH.endX, LAUNCH.height, 0));
  s.velocity.set(0, 0, 0).setComponent(axis, -sign * speed).applyQuaternion(s.quaternion);
  return s;
}

describe('展向条带与完整翼面', () => {
  it('所有翼面按0.8m截短分段，面积和面积加权作用点保持完整梯形，左右镜像', () => {
    const d = definition(), s = new FlightSimulation(d, 'birdman', 0);
    for (const [key, kind] of [['mainWing', 'main'], ['horizontalTail', 'tail'], ['verticalTail', 'vertical']] as const) {
      const p = planform(d[key], key !== 'verticalTail'), panels = s.surfaces.filter(surface => surface.kind === kind);
      expect(panels.reduce((sum, panel) => sum + panel.area, 0)).toBeCloseTo(p.area, 12);
      for (const side of key === 'verticalTail' ? [1] : [-1, 1]) {
        const row = panels.filter(panel => panel.side === side);
        expect(row[0].spanStart).toBe(0);
        expect(row.at(-1)!.spanEnd).toBeCloseTo(d[key].points[1].y, 12);
        for (let i = 0; i < row.length; i++) {
          expect(row[i].spanEnd - row[i].spanStart).toBeLessThanOrEqual(SURFACE_STEP + 1e-12);
          if (i < row.length - 1) expect(row[i].spanEnd - row[i].spanStart).toBeCloseTo(SURFACE_STEP, 12);
          expect(row[i].spanEnd).toBeGreaterThan(row[i].spanStart);
          expect(row[i].chord).toBeGreaterThan(0);
          expect(row[i].aspect).toBeCloseTo(p.aspect, 12);
          if (i) expect(row[i].spanStart).toBeCloseTo(row[i - 1].spanEnd, 12);
        }
      }
      const point = new Vector3();
      for (const panel of panels) point.addScaledVector(panel.point, panel.area / p.area);
      const fraction = (p.root + 2 * p.tip) / (3 * (p.root + p.tip));
      if (kind === 'main') expect(point.distanceTo(s.aircraft.mainQuarterChord)).toBeLessThan(1e-10);
      if (kind === 'vertical') expect(point.y).toBeCloseTo(wingOrigin(d, key).y + p.span * fraction, 12);
      else {
        expect(point.z).toBeCloseTo(0, 12);
        for (const left of panels.filter(panel => panel.side < 0)) {
          const right = panels.find(panel => panel.side > 0 && panel.spanStart === left.spanStart)!;
          expect(right.area).toBe(left.area); expect(right.point.x).toBe(left.point.x); expect(right.point.y).toBe(left.point.y);
          expect(right.point.z).toBe(-left.point.z);
        }
      }
    }
  });

  it('对称来流无虚构滚转/偏航，局部滚转来流产生阻尼且条带对象复用', () => {
    const s = probe(), rotating = probe(undefined, s => { s.omega.x = 0.3; });
    expect(Math.abs(s.telemetry.torque.x)).toBeLessThan(1e-8);
    expect(Math.abs(s.telemetry.torque.y)).toBeLessThan(1e-8);
    expect(rotating.telemetry.torque.x).toBeLessThan(0);
    const panels = rotating.surfaces, forces = panels.map(panel => panel.force);
    rotating.step(neutral);
    expect(rotating.surfaces).toBe(panels);
    panels.forEach((panel, index) => expect(panel.force).toBe(forces[index]));
  });

  it('跨越分段边界时下洗和诱导阻力连续，不把新末段当独立短翼', () => {
    const samples = [-1e-6, 1e-6].map(delta => derive(definition(d => {
      const span = 12.8 + delta;
      d.mainWing = wing(span, 16 / span, 16 / span);
    })).aerodynamics);
    expect(Math.abs(samples[0].wings[1].alpha - samples[1].wings[1].alpha)).toBeLessThan(1e-6);
    expect(samples[0].wings[0].inducedDrag).toBeCloseTo(samples[1].wings[0].inducedDrag, 4);
    expect(samples[0].wings[0].lift.distanceTo(samples[1].wings[0].lift)).toBeLessThan(0.001);
  });

  it('远离水面的分段合力与设计参考一致，三翼和机身完整重建力与力矩', () => {
    const p = derive(defaultAircraft), a = p.aerodynamics;
    const s = probe(undefined, s => { s.position.y = 280; s.velocity.set(12 * Math.cos(a.alpha) * Math.cos(a.beta), -12 * Math.sin(a.alpha) * Math.cos(a.beta), 12 * Math.sin(a.beta)); });
    const sum = a.bodyDrag.clone(), torque = new Vector3();
    for (let i = 0; i < a.wings.length; i++) {
      expect(s.telemetry.aerodynamics.wings[i].force.distanceTo(a.wings[i].force)).toBeLessThan(0.02);
      sum.add(a.wings[i].force); torque.add(a.wings[i].torque);
    }
    expect(sum.distanceTo(a.force)).toBeLessThan(1e-8);
    expect(torque.distanceTo(a.torque)).toBeLessThan(1e-8);
    const reconstructed = new Vector3().crossVectors(a.liftCenter!.clone().sub(p.cg), a.lift)
      .add(new Vector3().crossVectors(a.dragCenter!.clone().sub(p.cg), a.drag)).add(a.liftMoment).add(a.dragMoment).add(a.freeMoment);
    expect(reconstructed.distanceTo(a.torque)).toBeLessThan(1e-8);
  });
});

describe('斜坡发射、连续滚转与最后尾计距', () => {
  it('真实10m下坡3.5°，两秒沿坡匀加速，离台才建立能量预算', () => {
    const s = new FlightSimulation(defaultAircraft, 'birdman', 0), initialHeight = s.position.y;
    expect(s.position.x).toBeCloseTo(-10 * Math.cos(3.5 * DEG), 12);
    expect(s.position.y).toBeCloseTo(launchHeight(defaultAircraft), 12);
    expect(s.telemetry.pitch).toBeCloseTo(-3.5 * DEG, 12);
    expect(s.velocity.length()).toBe(0);
    for (let quarter = 1; quarter <= 8; quarter++) {
      s.step(neutral, 0.25);
      const time = quarter / 4, distance = 2.5 * time * time;
      expect(s.position.x).toBeCloseTo(LAUNCH.startX + distance * Math.cos(LAUNCH.slope), 10);
      expect(s.position.y).toBeCloseTo(initialHeight - distance * Math.sin(LAUNCH.slope), 10);
      expect(s.velocity.length()).toBeCloseTo(5 * time, 10);
      expect(s.velocity.y / s.velocity.x).toBeCloseTo(-Math.tan(LAUNCH.slope), 12);
      expect(s.telemetry.distance).toBe(0);
      if (quarter < 8) { expect(s.telemetry.initialEnergy).toBe(0); expect(s.telemetry.energyPerDistance).toBeNull(); }
    }
    expect(s.launching).toBe(false); expect(s.time).toBeCloseTo(2, 12);
    expect(s.position.x).toBe(0); expect(s.velocity.length()).toBeCloseTo(10, 12); budget(s);
    s.step(neutral); budget(s);
    expect(s.telemetry.distance).toBe(0); // CG已出平台，最后尾仍未越过前缘。
  });

  it.each([-LAUNCH_ROLL_LIMIT, LAUNCH_ROLL_LIMIT])('滚转%r整个助跑光滑，端点角速度/角加速度趋零且无离台跳变', roll => {
    const s = new FlightSimulation(defaultAircraft, 'birdman', roll), dt = 1 / 120;
    let previousRoll = 0, previousRate = 0, lastRate = 0;
    for (let i = 1; i <= 240; i++) {
      s.step(neutral, dt);
      const u = i / 240, expected = roll * u ** 3 * (10 - 15 * u + 6 * u * u);
      expect(s.telemetry.roll).toBeCloseTo(expected, 11);
      expect(Math.abs(s.telemetry.roll - previousRoll)).toBeLessThan(Math.abs(roll) * 2 * dt);
      expect(Math.abs(s.omega.x)).toBeLessThanOrEqual(Math.abs(roll) * 0.938);
      if (i === 1) expect(Math.abs(s.omega.x / dt)).toBeLessThan(0.003);
      if (i === 239) lastRate = s.omega.x;
      previousRoll = s.telemetry.roll; previousRate = s.omega.x;
    }
    expect(previousRate).toBe(0); expect(Math.abs(lastRate / dt)).toBeLessThan(0.003);
    const q = s.quaternion.clone(); s.step(neutral, 1e-7);
    expect(s.quaternion.angleTo(q)).toBeLessThan(1e-6); budget(s);
  });

  it('随机滚转每次重置重抽，固定滚转保持；录制逐帧重现整个助跑和自由飞行', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(1);
    try { const s = new FlightSimulation(defaultAircraft); expect(s.getRecording().launchRoll).toBe(-DEG); s.reset(); expect(s.getRecording().launchRoll).toBe(DEG); }
    finally { random.mockRestore(); }
    const s = new FlightSimulation(defaultAircraft, 'birdman', 0.713829 * DEG), states: number[][] = [];
    for (let i = 0; i < 240 && !s.ended; i++) { s.step({ ...neutral, rudder: Math.sin(i / 20) * 0.03 }); states.push([...s.position.toArray(), ...s.quaternion.toArray(), ...s.velocity.toArray(), s.telemetry.energy]); }
    const replay = new FlightSimulation(defaultAircraft, 'birdman', -0.4 * DEG); replay.loadReplay(s.getRecording());
    for (const state of states) { replay.step(neutral, 0.2); expect([...replay.position.toArray(), ...replay.quaternion.toArray(), ...replay.velocity.toArray(), replay.telemetry.energy]).toEqual(state); }
    expect(replay.replayFinished).toBe(true); replay.reset(); expect(replay.getRecording().launchRoll).toBe(-0.4 * DEG);
    for (const roll of [NaN, Infinity, DEG * 1.01]) expect(() => s.reset(roll)).toThrow();
  });

  it('坡面净空包含大安装角和滚转包络，重心操纵不使机体穿坡', () => {
    const d = definition(d => { d.mainWing = wing(24, 5.8, 5.8); d.assembly.mainWingHeight = 0; d.assembly.mainIncidence = 18; });
    const s = new FlightSimulation(d, 'birdman', DEG), points = keelPoints(d);
    for (let i = 0; i < 120; i++) {
      s.step({ ...neutral, weight: 1 });
      for (const point of points) { const p = world(s, point); expect(p.y - runwayHeight(p.x)).toBeGreaterThanOrEqual(0.049999); }
      expect(s.ended).toBe(false);
    }
    const full = derive(d, 1), expectedCg = full.cg.clone().multiplyScalar(full.mass);
    for (const section of s.structure.sections) if (section.bodyId !== 0) expectedCg.addScaledVector(section.center, -section.mass);
    expectedCg.divideScalar(s.mass);
    expect(s.aircraft.cg.distanceTo(expectedCg)).toBeLessThan(1e-10);
    for (let i = 0; i < 3; i++) { s.step(neutral); expect(s.ended).toBe(false); budget(s); }
  });

  it('最后尾而非CG计距，横向飞行与偏航使用同一径向几何标准，距离非负', () => {
    const d = definition(d => { d.fuselage.length = 8; d.horizontalTail = wing(2, 0.4, 0.4); d.verticalTail = wing(2, 0.4, 0.4); d.assembly.horizontalTail = -2.5; d.assembly.verticalTail = -2.5; });
    for (const yaw of [0, 0.7, -1.2]) {
      const s = probe(d, s => { s.quaternion.setFromAxisAngle(axisY, yaw); s.position.set(50 * Math.cos(yaw), 80, -50 * Math.sin(yaw)); s.velocity.set(0, 0, 0); }, 1e-8);
      expect(s.telemetry.distance).toBeCloseTo(50 - 4 - s.aircraft.cg.x, 6);
      expect(s.telemetry.distance).toBeLessThan(Math.hypot(s.position.x, s.position.z));
    }
    const broadside = probe(d, s => { s.position.set(50, 80, 0); s.quaternion.setFromAxisAngle(axisY, Math.PI / 2); s.velocity.set(0, 0, 0); }, 1e-8);
    expect(broadside.telemetry.distance).toBeCloseTo(43, 6);
    const edge = probe(d, s => { s.position.set(0.1, 80, 0); s.velocity.set(0, 0, 0); }, 1e-8);
    expect(edge.telemetry.distance).toBe(0);
  });

  it('接水时定位首次接触，终点不明显穿水；不存在旧岸地box的幽灵终止', () => {
    const s = new FlightSimulation(defaultAircraft, 'birdman', 0); s.launching = false; s.quaternion.identity();
    s.position.set(40, 2, 0); s.velocity.set(0, -20, 0);
    while (!s.ended) s.step(neutral, 0.25);
    expect(s.result?.landing).toBe('water');
    const minY = Math.min(...keelPoints(defaultAircraft).map(point => world(s, point).y));
    expect(minY).toBeGreaterThan(-0.001); expect(minY).toBeLessThan(0.15); budget(s);
    const shore = probe(undefined, s => { s.position.set(-40, 7.8, 0); });
    expect(shore.ended).toBe(false); expect(shore.result).toBeNull();
  });

  it.each([[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]])('平台轴%d、法向%d真实碰撞，改变平动/转动，不终止或穿透', (axis, sign) => {
    const s = approachingPlatform(axis, sign), normal = new Vector3().setComponent(axis, sign).applyQuaternion(s.quaternion);
    outsidePlatform(s);
    s.step(neutral, 0.08);
    expect(s.ended).toBe(false); expect(s.result).toBeNull(); expect(s.time).toBeCloseTo(0.08, 12);
    expect(s.velocity.dot(normal)).toBeGreaterThan(-2.8);
    expect(s.omega.length()).toBeGreaterThan(1e-6);
    outsidePlatform(s); budget(s);
  });

  it('平台支撑持续推进时间且不造能；滑离平台后仍正常落水结算', () => {
    const s = approachingPlatform(1, 1, 0.2);
    for (let i = 0; i < 120; i++) {
      s.step(neutral);
      expect(s.ended).toBe(false); outsidePlatform(s); budget(s);
    }
    expect(s.time).toBeCloseTo(2, 10);
    for (let i = 0; i < 1800 && !s.ended; i++) { s.step(neutral); budget(s); }
    expect(s.result?.landing).toBe('water');
    expect(s.time).toBeGreaterThan(2);
  });

  it('高速扫掠不能从底面穿过0.6m薄平台，接触耗散只记真实动能损失', () => {
    const s = approachingPlatform(1, -1, 80);
    s.step(neutral);
    expect(s.ended).toBe(false);
    expect(s.telemetry.dissipatedEnergy).toBeGreaterThan(s.telemetry.initialEnergy * 0.05);
    expect(s.velocity.y).toBeLessThan(70);
    outsidePlatform(s); budget(s);
  });

  it('蒸汽槽不是整块平台顶面；进入槽内后接触真实槽底', () => {
    const s = approachingPlatform(1, 1, 0, 0.03);
    const lowest = Math.min(...contacts(s).map(point => point.y - s.aircraft.cg.y));
    s.position.set(-5, -PLATFORM.slotDepth - lowest + 0.03, 0).applyQuaternion(s.quaternion).add(new Vector3(0, LAUNCH.height, 0));
    s.step(neutral, 0.02);
    const minY = Math.min(...contacts(s).map(point => platformLocal(world(s, point)).y));
    expect(minY).toBeLessThan(0); expect(minY).toBeGreaterThan(-PLATFORM.slotDepth);
    for (let i = 0; i < 30; i++) { s.step(neutral); expect(s.ended).toBe(false); outsidePlatform(s); budget(s); }
  });

  it('碰撞子步不丢失时间；批量步进与60Hz逐步结果一致', () => {
    const coarse = approachingPlatform(1, 1), fine = approachingPlatform(1, 1);
    coarse.step(neutral, 0.25);
    for (let i = 0; i < 15; i++) fine.step(neutral);
    expect(coarse.time).toBeCloseTo(0.25, 12); expect(fine.time).toBeCloseTo(0.25, 12);
    expect(coarse.position.distanceTo(fine.position)).toBeLessThan(1e-9);
    expect(coarse.velocity.distanceTo(fine.velocity)).toBeLessThan(1e-9);
    expect(coarse.omega.distanceTo(fine.omega)).toBeLessThan(1e-9);
    expect(coarse.telemetry.dissipatedEnergy).toBeCloseTo(fine.telemetry.dissipatedEnergy, 8);
    outsidePlatform(coarse); outsidePlatform(fine); budget(coarse); budget(fine);
  });

  it('槽底与侧壁可同时接触，不把槽底支撑当成忽略侧板的理由', () => {
    const s = approachingPlatform(1, 1, 0, 0.01);
    const lowest = Math.min(...contacts(s).map(point => point.y - s.aircraft.cg.y));
    s.position.set(-5, -PLATFORM.slotDepth - lowest + 0.01, 0).applyQuaternion(s.quaternion).add(new Vector3(0, LAUNCH.height, 0));
    s.velocity.set(0, 0, 1.5);
    for (let i = 0; i < 30; i++) { s.step(neutral); expect(s.ended).toBe(false); outsidePlatform(s); budget(s); }
    expect(s.velocity.z).toBeLessThan(1.4);
  });
});

describe('气动、质量、能量与消费者边界', () => {
  it('固定60kg乘员，构型质量/惯量响应真实面积、展长、支撑和重心移动', () => {
    const p = derive(defaultAircraft), heavyPilot = derive(definition(d => { d.pilot.mass = 100; }));
    expect(PILOT_MASS).toBe(60); expect(p.mass).toBeGreaterThan(60); expect(heavyPilot.mass).toBe(p.mass);
    expect(heavyPilot.inertia.toArray()).toEqual(p.inertia.toArray());
    expect(p.inertia.x).toBeGreaterThan(0); expect(p.inertia.y).toBeGreaterThan(0); expect(p.inertia.z).toBeGreaterThan(0);
    expect(derive(defaultAircraft, 1).cg.x).toBeGreaterThan(derive(defaultAircraft, -1).cg.x);
    const short = definition(d => { d.mainWing = wing(10, 1.6, 1.6); }), long = definition(d => { d.mainWing = wing(20, 0.8, 0.8); });
    expect(derive(long).mass).toBeGreaterThan(derive(short).mass); expect(derive(long).inertia.x).toBeGreaterThan(derive(short).inertia.x);
    const flat = definition(d => { d.assembly.mainWingHeight = 0; }), raised = clone(flat); raised.assembly.mainWingHeight = 0.5;
    expect(derive(raised).mass - derive(flat).mass).toBeCloseTo(mainWingSupport(raised).mass, 10);
    expect(derive(raised).cg.y).toBeGreaterThan(derive(flat).cg.y);
    const aft = definition(d => { d.fuselage.center -= 0.2; resizeFuselage(d, 'nose', 3.25); });
    expect(derive(aft).cg.x).not.toBe(p.cg.x);
  });

  it('满油空油CG保留油箱壳重，耗尽燃油后模拟重心与空油端点一致', () => {
    const d = clone(presets.find(d => d.engine.count > 0)!); d.fuelTank.capacity = 0.001;
    const range = fuelCgRange(d), full = derive(d), tank = fuelTankPosition(d), fuelMass = d.fuelTank.capacity * 0.8;
    expect(range.full.distanceTo(full.cg)).toBeLessThan(1e-12);
    const expectedEmpty = full.cg.clone().multiplyScalar(full.mass).sub(new Vector3(tank.x,tank.y,tank.z).multiplyScalar(fuelMass)).divideScalar(full.mass-fuelMass);
    expect(range.empty.distanceTo(expectedEmpty)).toBeLessThan(1e-12);
    const noTank = clone(d); noTank.fuelTank.capacity = 0;
    expect(range.empty.distanceTo(derive(noTank).cg)).toBeGreaterThan(1e-5);
    const s = new FlightSimulation(d, 'low-altitude', 0);
    s.launching = false; s.position.set(0,1000,0); s.velocity.set(30,0,0); s.quaternion.identity();
    for(let i=0;i<100&&s.telemetry.fuelRemaining>0;i++)s.step({...neutral,throttle:1},0.25);
    expect(s.telemetry.fuelRemaining).toBe(0);expect(s.aircraft.mass).toBeCloseTo(full.mass-fuelMass,10);
    expect(s.aircraft.cg.distanceTo(range.empty)).toBeLessThan(1e-10);
  });

  it('无引擎所有物理入口自动移除油箱、燃油与油量CG区间', () => {
    const d = clone(defaultAircraft); d.fuelTank.capacity = 12;
    expect(derive(d).mass).toBe(derive(defaultAircraft).mass);
    expect(fuelCgRange(d).full.toArray()).toEqual(fuelCgRange(d).empty.toArray());
    const s = new FlightSimulation(d);
    expect(s.definition.fuelTank.capacity).toBe(0);expect(s.telemetry.fuelRemaining).toBe(0);
    expect(s.aircraft.mass).toBe(derive(defaultAircraft).mass);
  });

  it('面积/展弦比/操纵/尾臂改变实际受力，垂尾恢复侧滑', () => {
    const base = probe(), big = probe(definition(d => { d.mainWing = wing(14, 2, 1.5); }));
    expect(big.telemetry.force.y).toBeGreaterThan(base.telemetry.force.y);
    expect(derive(big.definition).wingLoading).toBeLessThan(derive(base.definition).wingLoading);
    const low = derive(definition(d => { d.mainWing = wing(10, 1.6, 1.6); })), high = derive(definition(d => { d.mainWing = wing(18, 16 / 18, 16 / 18); }));
    expect(high.glideRatio).toBeGreaterThan(low.glideRatio);
    const sideslip = probe(undefined, s => { s.velocity.z = 2; }); expect(sideslip.telemetry.aerodynamics.wings[2].lift.z).toBeLessThan(0); expect(sideslip.telemetry.torque.y).toBeLessThan(0);
    const tail = probe(definition(d => { d.assembly.tailIncidence += 5; })); expect(tail.telemetry.aerodynamics.wings[1].lift.y).toBeGreaterThan(base.telemetry.aerodynamics.wings[1].lift.y);
  });

  it('前后掠在侧滑中产生相反滚转，反向侧滑时恢复相反符号', () => {
    for (const sweep of [-3, 3]) for (const beta of [-2, 2]) {
      const s = probe(definition(d => { d.mainWing = wing(8, 1.5, 1.5, sweep); }), s => { s.velocity.z = beta; });
      expect(s.telemetry.aerodynamics.wings[0].torque.x * sweep * beta).toBeLessThan(-1);
      budget(s);
    }
  });

  it('前重心产生俯仰恢复，后移重心可使真实俯仰响应发散', () => {
    const front = definition(), aft = definition(d => { d.cockpit.position = -0.8; });
    expect(derive(front).staticMargin).toBeGreaterThan(0);
    expect(derive(aft).staticMargin).toBeLessThan(0);
    expect(pitchSlope(front)).toBeLessThan(0);
    expect(pitchSlope(aft)).toBeGreaterThan(0);
  });

  it('水平尾翼面积和后移距离增强俯仰恢复力矩', () => {
    const small = definition(d => { d.horizontalTail = wing(2.5, 0.6, 0.4); });
    const large = definition(d => { d.horizontalTail = wing(4.5, 1, 0.8); });
    expect(pitchSlope(large)).toBeLessThan(pitchSlope(small));
    const near = definition(d => { resizeFuselage(d, 'tail', -4.5); }), far = clone(near);
    far.assembly.horizontalTail = -4.5;
    expect(pitchSlope(far)).toBeLessThan(pitchSlope(near));
  });

  it('增大垂尾面积增强侧滑偏航恢复', () => {
    const small = definition(d => { d.verticalTail = wing(2, 0.5, 0.3); });
    const large = definition(d => { d.verticalTail = wing(4, 1, 0.6); });
    const a = probe(small, s => { s.velocity.z = 2; }), b = probe(large, s => { s.velocity.z = 2; });
    // 小垂尾可能不足以稳定整机；检查垂尾自身恢复方向和增大垂尾后的整机增量。
    expect(a.telemetry.aerodynamics.wings[2].torque.y).toBeLessThan(0);
    expect(b.telemetry.aerodynamics.wings[2].torque.y).toBeLessThan(a.telemetry.aerodynamics.wings[2].torque.y);
    expect(b.telemetry.torque.y).toBeLessThan(a.telemetry.torque.y);
  });

  it('上反角增强侧滑恢复滚转，反向侧滑时响应反向', () => {
    const flat = definition(d => { d.mainWing.dihedral = 0; });
    const angled = definition(d => { d.mainWing.dihedral = 12; });
    for (const beta of [-2, 2]) {
      const a = probe(flat, s => { s.velocity.z = beta; }), b = probe(angled, s => { s.velocity.z = beta; });
      expect((b.telemetry.aerodynamics.wings[0].torque.x - a.telemetry.aerodynamics.wings[0].torque.x) * beta).toBeLessThan(-1);
    }
  });

  it('极曲线连续，失速后升力衰减且阻力增长，不出现负阻力', () => {
    const normal = coefficients(12 * DEG, 10), stalled = coefficients(60 * DEG, 10);
    expect(stalled.cl).toBeLessThan(normal.cl); expect(stalled.cd).toBeGreaterThan(normal.cd);
    for (let angle = -180; angle <= 180; angle++) {
      const a = coefficients(angle * DEG - 1e-8, 10), b = coefficients(angle * DEG + 1e-8, 10);
      expect(a.cd).toBeGreaterThan(0); expect(Math.abs(a.cl - b.cl)).toBeLessThan(1e-4); expect(Math.abs(a.cd - b.cd)).toBeLessThan(1e-4);
    }
  });

  it('接近纯法向来流时升力连续且不被归一化阈值关断，隐式步保持能量平衡', () => {
    const d = definition(d => { d.mainWing.dihedral = 0; });
    const samples = [-1, 1].map(sign => probe(d, simulation => {
      simulation.velocity.set(12e-6 * (1 + sign * 1e-3), -12, 0);
    }));
    const a = samples[0].telemetry.aerodynamics.wings[0].lift, b = samples[1].telemetry.aerodynamics.wings[0].lift;
    expect(a.length()).toBeGreaterThan(1); expect(b.length()).toBeGreaterThan(1);
    expect(a.distanceTo(b)).toBeLessThan(1e-3);
    for (const simulation of samples) budget(simulation);
  });

  it('主翼保留DAE11弯度，低Re增加型阻；尾翼仅为对称工程代理', () => {
    const low = coefficients(0, 12, 200_000), middle = coefficients(0, 12, 500_000), high = coefficients(0, 12, 1_000_000);
    expect(middle.cl).toBeGreaterThan(0.4);
    expect(low.profileCd).toBeGreaterThan(middle.profileCd); expect(middle.profileCd).toBeGreaterThan(high.profileCd);
    expect(low.cl).toBeLessThan(middle.cl);
    const positive = coefficients(5 * DEG, 5, 500_000, false), negative = coefficients(-5 * DEG, 5, 500_000, false);
    expect(positive.cl).toBeCloseTo(-negative.cl, 12); expect(positive.cd).toBeCloseTo(negative.cd, 12);
    expect(coefficients(0, 5, 500_000, false).cl).toBe(0);
  });

  it('地效逐条带使用净空和完整翼展，只降低诱导阻力并减弱尾翼下洗', () => {
    const low = probe(undefined, s => { s.position.y = 2; }), high = probe(undefined, s => { s.position.y = 280; });
    const a = low.telemetry.aerodynamics.wings[0], b = high.telemetry.aerodynamics.wings[0];
    expect(a.inducedDrag).toBeLessThan(b.inducedDrag); expect(low.telemetry.liftDragRatio).toBeGreaterThan(high.telemetry.liftDragRatio);
    expect(a.lift.distanceTo(b.lift)).toBeLessThan(0.001);
    expect(low.telemetry.aerodynamics.wings[1].alpha).toBeGreaterThan(high.telemetry.aerodynamics.wings[1].alpha);
    for (let i = 0; i < low.surfaces.length; i++) {
      const near = low.surfaces[i], far = high.surfaces[i];
      if (near.kind === 'main') expect(near.drag.length() - near.inducedDrag).toBeCloseTo(far.drag.length() - far.inducedDrag, 4);
      if (near.kind === 'vertical') expect(near.groundEffect).toBe(1);
    }
    const rolling = probe(undefined, s => { s.position.y = 4; s.quaternion.setFromAxisAngle(axisX, 10 * DEG); });
    const left = rolling.surfaces.find(panel => panel.kind === 'main' && panel.side < 0)!;
    const right = rolling.surfaces.find(panel => panel.kind === 'main' && panel.side > 0)!;
    expect(right.clearance).toBeLessThan(left.clearance); expect(right.groundEffect).toBeLessThan(left.groundEffect);
  });

  it('全程保持机械能与真实耗散功平衡，抖动操纵不造能', () => {
    const s = release(new FlightSimulation(defaultAircraft, 'birdman', 0)); let previous = s.telemetry.energy - s.telemetry.controlWork;
    for (let i = 0; i < 1800 && !s.ended; i++) {
      const sign = i % 2 ? 1 : -1;
      s.step({ weight: sign, rudder: sign * 0.2, elevator: sign * 0.2, aileron: sign * 0.2 });
      budget(s); expect(s.telemetry.aeroPower).toBeLessThanOrEqual(0);
      expect(s.telemetry.energy - s.telemetry.controlWork).toBeLessThanOrEqual(previous + 1e-6);
      expect(s.quaternion.length()).toBeCloseTo(1, 10); previous = s.telemetry.energy - s.telemetry.controlWork;
    }
    expect(s.ended).toBe(true);
  });

  it('步长收敛，外部大步长等同60Hz细分，能耗使用世界水平速度', () => {
    const a = probe(undefined, undefined, 1 / 60), b = probe(undefined, undefined, 1 / 120), c = probe(undefined, undefined, 1 / 240);
    const reference = probe(undefined, undefined, 1 / 960);
    for (let i = 1; i < 60; i++) a.step(neutral);
    for (let i = 1; i < 120; i++) b.step(neutral, 1 / 120);
    for (let i = 1; i < 240; i++) c.step(neutral, 1 / 240);
    for (let i = 1; i < 960; i++) reference.step(neutral, 1 / 960);
    // 准静态形状在接受步后更新；比较实际收敛，不沿用纯刚体中点法的毫米级误差数值钉。
    expect(b.position.distanceTo(reference.position)).toBeLessThan(a.position.distanceTo(reference.position));
    expect(c.position.distanceTo(reference.position)).toBeLessThan(b.position.distanceTo(reference.position));
    for (const s of [a, b, c, reference]) { budget(s); expect(s.telemetry.energyPerDistance).toBeCloseTo(-s.telemetry.aeroPower / Math.hypot(s.velocity.x, s.velocity.z), 10); }
    const coarse = new FlightSimulation(defaultAircraft, 'birdman', 0), fine = new FlightSimulation(defaultAircraft, 'birdman', 0);
    for (let i = 0; i < 12; i++) coarse.step(neutral, 0.25); for (let i = 0; i < 180; i++) fine.step(neutral);
    expect(coarse.position.distanceTo(fine.position)).toBeLessThan(1e-8);
    expect(coarse.quaternion.angleTo(fine.quaternion)).toBeLessThan(1e-7);
  });

  it.each(presets.map(d => ({ name: d.name, d })))('$name 可完整飞行至真实接触，代表性预设不靠平台碰撞结束', ({ d }) => {
    const s = fly(d); expect(s.ended).toBe(true); expect(s.result).not.toBeNull(); budget(s);
    expect(Number.isFinite(s.result!.distance)).toBe(true); expect(s.result!.distance).toBeGreaterThanOrEqual(0);
    if (d.name === '默认均衡型' || d.name === '高展弦比型') { expect(s.result!.landing).toBe('water'); expect(s.result!.distance).toBeGreaterThan(20); }
    const replay = new FlightSimulation(d, d.birdman ? 'birdman' : 'downhill', DEG); replay.loadReplay(s.getRecording());
    while (!replay.ended && !replay.replayFinished) replay.step(neutral);
    expect(replay.result).toEqual(s.result);
    const position = s.position.clone(); s.step(neutral); expect(s.position.equals(position)).toBe(true);
  }, 15_000);

  it.each([{ name: '最小弦与半展', span: 0.5, chord: 0.15 }, { name: '最大展长与大弦', span: 24, chord: 5.8 }])('$name 的三翼分段受力保持有限并满足真实能量账本', ({ span, chord }) => {
    const d = definition(d => {
      d.mainWing = wing(span, chord, chord);
      d.horizontalTail = wing(span, chord, chord);
      d.verticalTail = wing(span, chord, chord);
    });
    const s = probe(d, undefined, 1 / 60);
    for (let i = 0; i < 60 && !s.ended; i++) {
      s.step(neutral);
      budget(s);
      expect(s.telemetry.aeroPower).toBeLessThanOrEqual(0);
      expect(s.quaternion.length()).toBeCloseTo(1, 10);
      for (const value of [...s.position.toArray(), ...s.velocity.toArray(), ...s.omega.toArray(), s.telemetry.energy]) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('重置清空统计，拒绝无效输入/回放，零速度保持有限', () => {
    const s = probe(undefined, s => { s.velocity.set(0, 0, 0); }); expect(s.velocity.y).toBeLessThan(0); expect(Number.isFinite(s.telemetry.energy)).toBe(true);
    s.reset(); expect(s.telemetry.initialEnergy).toBe(0); expect(s.telemetry.dissipatedEnergy).toBe(0); expect(s.telemetry.energyPerDistance).toBeNull(); expect(s.recordingLength).toBe(0);
    for (const dt of [0, -1, NaN, Infinity, 1]) expect(() => s.step(neutral, dt)).toThrow();
    expect(() => s.step({ ...neutral, elevator: NaN })).toThrow();
    expect(() => s.loadReplay({ frames: new Float64Array([NaN, 0, 0, 0, 0]), length: 1, launchRoll: 0 })).toThrow();
    expect(() => s.loadReplay({ frames: new Float64Array(), length: 0, launchRoll: 2 * DEG })).toThrow();
    expect(() => s.step({ ...neutral, lateral: NaN })).toThrow();
  });
});
