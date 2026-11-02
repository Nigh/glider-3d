import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { BODY_GEOMETRY, clone, defaultAircraft, DEG, engineMounts, fuelTankLimits, fuselageEnds, PILOT_MASS, presets, validateAircraft, wing, type Controls } from '../src/model';
import { AIR_DENSITY, CONTROL_SURFACE_RATE, derive, FlightSimulation, GRAVITY } from '../src/physics';
import { CHALLENGE_RIVER, challengeCenter, challengeCheckpoints, challengeCollisionHeight, challengeLaunch, challengeRiverCenter, challengeRiverHeight, challengeStartGate, challengeTerrainGrid, challengeTerrainHeight, LOW_ALTITUDE_RAIL } from '../src/challenges';
import { engineCatalog } from '../src/engines';
import jetCruise50m from './fixtures/jet-cruise-50m.json';

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
    expect(Math.abs(t.energy + t.dissipatedEnergy - t.initialEnergy - t.controlWork - t.waterWork) / t.initialEnergy).toBeLessThan(1e-8);
  });

  it('山顶20m弹射到20m/s，整台离当地地面至少100m，背后有山，离台后仍不计时', () => {
    const s = new FlightSimulation(downhillAircraft, 'downhill', 0), launch = challengeLaunch('downhill')!;
    expect(s.launching).toBe(true); expect(s.velocity.length()).toBe(0); expect(launch.length).toBe(20);
    expect(s.position.x).toBe(launch.startX);
    for (let x = launch.startX; x <= launch.endX; x += 2) for (let z = -launch.width / 2; z <= launch.width / 2; z += 2) {
      expect(launch.y - launch.thickness - challengeTerrainHeight('downhill', x, z)).toBeGreaterThanOrEqual(100);
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

  it.each(['downhill', 'low-altitude'] as const)('%s 出发门和检查点没有3m下限，实际触地才结束', challenge => {
    const d = clone(downhillAircraft);
    d.mainWing = wing(0.5, 0.3, 0.2); d.horizontalTail = wing(0.5, 0.3, 0.2); d.verticalTail = wing(0.5, 0.3, 0.2);
    const s = airborne(new FlightSimulation(d, challenge, 0), 40, 15);
    crossStart(s, 2.5);
    const gate = challengeCheckpoints(challenge)[0];
    airborne(s, gate.x - 0.1, 2.5); s.position.set(gate.x - 0.1, gate.y + 2.5, gate.z);
    s.velocity.set(30, 0, 0); s.step(neutral, 0.01);
    expect(s.ended).toBe(false); expect(s.telemetry.challengeProgress).toBe(1 / challengeCheckpoints(s.challenge).length);
    s.position.y = challengeCollisionHeight(challenge, s.position.x, s.position.z) - 1;
    s.step(neutral);
    expect(['terrain', 'water']).toContain(s.result?.landing);
  });

  it('低空可以从门参考高度下方通过，河面碰撞独立于门高度', () => {
    const s = lowAltitude(), gate = challengeStartGate('low-altitude')!, x = gate.x - 0.1;
    s.position.set(x, challengeRiverHeight(x) + 2.5, challengeRiverCenter(x)); s.velocity.set(30, 0, 0);
    expect(s.position.y).toBeLessThan(gate.y); s.step(neutral, 0.01);
    expect(s.ended).toBe(false); expect(s.telemetry.timingStarted).toBe(true);
  });

  it('速降起飞准备区不被赛段125m上限提前终止，计时后仍限高', () => {
    const preparing = airborne(new FlightSimulation(downhillAircraft, 'downhill', 0), 40, 150);
    preparing.step(neutral, 0.01); expect(preparing.ended).toBe(false);
    const racing = crossStart(create(), 60);
    airborne(racing, 150, 150); racing.step(neutral, 0.01);
    expect(racing.result?.landing).toBe('boundary');
  });

  it('仅向前穿过下一门算进度，漏门和直达终点不能完成', () => {
    const gates = challengeCheckpoints('downhill'), first = gates[0], last = gates[gates.length - 1];
    const s = crossStart(create(), 60); airborne(s, first.x - 0.2, 60); s.position.z = first.z; s.position.y = first.y + 60; s.velocity.set(30, 0, 0); s.step(neutral);
    expect(s.telemetry.challengeProgress).toBe(1 / challengeCheckpoints(s.challenge).length); expect(s.ended).toBe(false);
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

  it('山坡和弹射台按真实接触终止，速降无隐藏横向边界', () => {
    const crash = create(); crash.position.y = challengeTerrainHeight('downhill', crash.position.x, crash.position.z) - 1;
    crash.step(neutral); expect(crash.result?.landing).toBe('terrain');
    const shortcut = create(); shortcut.position.z += 80; shortcut.position.y = challengeTerrainHeight('downhill', shortcut.position.x, shortcut.position.z) + 30;
    shortcut.step(neutral); expect(shortcut.ended).toBe(false);
    const platform = create(), launch = challengeLaunch('downhill')!; platform.position.set(-10, launch.y - 0.1, 0); platform.velocity.set(0, -3, 0);
    platform.step(neutral); expect(platform.result?.landing).toBe('terrain');
  });

  it('速降所有可见门覆盖山体边缘，80m侧向路线真实通过起点和下一门', () => {
    const gates = [challengeStartGate('downhill')!, ...challengeCheckpoints('downhill')];
    for (const gate of gates) {
      expect(gate.z - gate.halfWidth).toBeLessThan(challengeTerrainGrid.minZ);
      expect(gate.z + gate.halfWidth).toBeGreaterThan(challengeTerrainGrid.maxZ);
    }
    const d = clone(downhillAircraft);
    d.mainWing = wing(0.5, 0.3, 0.2); d.horizontalTail = wing(0.5, 0.3, 0.2); d.verticalTail = wing(0.5, 0.3, 0.2);
    const s = new FlightSimulation(d, 'downhill', 0);
    for (const gate of gates.slice(0, 2)) {
      s.launching = false; s.quaternion.identity(); s.velocity.set(30, 0, 0);
      s.position.set(gate.x - 0.1, challengeTerrainHeight('downhill', gate.x, gate.z + 80) + 20, gate.z + 80);
      expect(s.position.y).toBeLessThan(gate.y + gate.maxHeight);
      s.step(neutral, 0.01); expect(s.ended).toBe(false);
      expect(s.telemetry.timingStarted).toBe(true);
    }
    expect(s.telemetry.challengeProgress).toBe(1 / challengeCheckpoints(s.challenge).length);
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

  it('2m导轨从静止靠真实推力滑跑，无动力不动，未整体抬升时滑至轨端释放', () => {
    const launch = challengeLaunch('low-altitude')!, d = clone(poweredAircraft); d.engine.count = 0; d.fuelTank.capacity = 0;
    const stationary = new FlightSimulation(d, 'low-altitude', 0);
    for (let i = 0; i < 20; i++) stationary.step({ ...neutral, throttle: 1 }, 0.25);
    expect(stationary.position.x).toBe(launch.startX); expect(stationary.velocity.length()).toBe(0); expect(stationary.launching).toBe(true);
    const s = new FlightSimulation(poweredAircraft, 'low-altitude', 0);
    expect(s.position.x).toBe(launch.startX); expect(s.velocity.length()).toBe(0);
    const contactPoints = Reflect.get(s, 'contacts') as { y: number }[];
    const lowest = Math.min(...contactPoints.map(point => s.position.y + point.y - s.cg.y));
    expect(s.railAttachmentHeight - launch.y).toBe(2);
    expect(lowest).toBeGreaterThanOrEqual(launch.y + LOW_ALTITUDE_RAIL.height);
    let rollWork = 0;
    for (let i = 0; i < 3600 && s.launching && !s.ended; i++) {
      s.step({ ...neutral, throttle: 1 }); rollWork = Math.max(rollWork, s.telemetry.propulsionWork);
    }
    expect(s.ended).toBe(false); expect(s.launching).toBe(false); expect(s.position.x).toBeGreaterThanOrEqual(launch.endX);
    expect(s.position.x).toBeGreaterThan(launch.startX + 20); expect(s.velocity.x).toBeGreaterThan(10);
    expect(rollWork).toBeGreaterThan(0); expect(s.telemetry.fuelRemaining).toBeLessThan(poweredAircraft.fuelTank.capacity);
    expect(s.telemetry.propulsionWork).toBeGreaterThan(0); expect(s.telemetry.fuelEnergyRemoved).toBeGreaterThan(0);
    const t = s.telemetry;
    expect(t.energy + t.dissipatedEnergy + t.fuelEnergyRemoved - t.propulsionWork - t.controlWork - t.waterWork).toBeCloseTo(t.initialEnergy, 8);
    expect(s.time).toBe(0); expect(s.telemetry.score).toBe(0); expect(s.telemetry.timingStarted).toBe(false);
    for (let x = launch.startX; x <= launch.endX; x += 10) expect(challengeTerrainHeight('low-altitude', x, launch.z)).toBe(launch.y);
  });

  it('合法最大展长宽弦翼开场完整碰撞体均在2m导轨顶面以上', () => {
    const d = clone(poweredAircraft);
    d.mainWing = wing(24, 6, 6); d.assembly.mainIncidence = 18; d.assembly.mainWingHeight = -0.5;
    const s = new FlightSimulation(d, 'low-altitude', 0), points = Reflect.get(s, 'contacts') as Vector3[];
    for (const point of points) {
      const world = point.clone().sub(s.cg).applyQuaternion(s.quaternion).add(s.position);
      expect(world.y).toBeGreaterThanOrEqual(s.railAttachmentHeight);
    }
    s.step(neutral, 1e-6);
    expect(s.ended).toBe(false); expect(s.launching).toBe(true); expect(s.velocity.length()).toBe(0);
  });

  it('配平飞机的保持力按当前质量缩放，超过门槛可在轨端前正常抬升', () => {
    for (const materialAmount of [0.5, 2]) {
      const d = clone(poweredAircraft); d.mainWing.materialAmount = materialAmount;
      // 用实际气动力配平俯仰，不让低头力矩遮蔽这项质量/保持力边界检查。
      let aft = -1, forward = 2;
      for (let iteration = 0; iteration < 24; iteration++) {
        d.cockpit.position = (aft + forward) / 2;
        const trim = new FlightSimulation(d, 'low-altitude', 0);
        trim.velocity.x = 20; trim.step(neutral, 1e-6);
        if (trim.telemetry.torque.z > 0) aft = d.cockpit.position; else forward = d.cockpit.position;
      }
      for (const target of [LOW_ALTITUDE_RAIL.retentionAcceleration / 2, LOW_ALTITUDE_RAIL.retentionAcceleration * 1.5]) {
        let low = 0, high = 50, sample!: FlightSimulation;
        for (let iteration = 0; iteration < 18; iteration++) {
          const speed = (low + high) / 2;
          sample = new FlightSimulation(d, 'low-altitude', 0);
          sample.velocity.x = speed; sample.step(neutral, 1e-6);
          if (sample.telemetry.force.y / sample.mass - GRAVITY < target) low = speed; else high = speed;
        }
        expect(sample.telemetry.force.y / sample.mass - GRAVITY).toBeCloseTo(target, 3);
        expect(sample.launching).toBe(target < LOW_ALTITUDE_RAIL.retentionAcceleration);
        if (sample.launching) expect(sample.velocity.y).toBe(0); else expect(sample.velocity.y).toBeGreaterThan(0);
      }
    }
  });

  it('净升力足够但低头力矩会压低机头时保持附轨，不在滑跑中掉向跑道', () => {
    const s = new FlightSimulation(validateAircraft(jetCruise50m), 'low-altitude', 0);
    const initialCg = s.cg.clone(), height = s.position.y, launch = challengeLaunch('low-altitude')!;
    let exceededRetention = false;
    for (let i = 0; i < 3600 && s.launching && !s.ended; i++) {
      s.step({ ...neutral, throttle: 1 });
      exceededRetention ||= s.telemetry.force.y > s.mass * (GRAVITY + LOW_ALTITUDE_RAIL.retentionAcceleration);
      if (!s.launching) {
        expect(s.position.x - (s.cg.x - initialCg.x)).toBeGreaterThanOrEqual(launch.endX);
        break;
      }
      expect(s.ended).toBe(false);
      expect(s.position.y - (s.cg.y - initialCg.y)).toBeCloseTo(height, 9);
      expect(s.velocity.y).toBe(0);
      expect(s.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    }
    expect(exceededRetention).toBe(true);
    expect(s.launching).toBe(false);
    expect(s.ended).toBe(false);
    expect(s.position.x - (s.cg.x - initialCg.x)).toBeGreaterThanOrEqual(launch.endX);
    const t = s.telemetry;
    expect(t.energy + t.dissipatedEnergy + t.fuelEnergyRemoved - t.propulsionWork - t.controlWork - t.waterWork).toBeCloseTo(t.initialEnergy, 8);
  });

  it('向下载荷大于保持力也不脱轨，继续约束高度与姿态', () => {
    const d = clone(poweredAircraft);
    d.assembly.mainIncidence = -10; d.assembly.tailIncidence = -10;
    const s = new FlightSimulation(d, 'low-altitude', 0), height = s.position.y, cg = s.cg.clone();
    s.velocity.x = 30;
    for (let i = 0; i < 120; i++) {
      s.step({ ...neutral, throttle: 0 });
      expect(s.telemetry.force.y).toBeLessThan(-s.mass * LOW_ALTITUDE_RAIL.retentionAcceleration);
      expect(s.launching).toBe(true);
      expect(s.position.y - (s.cg.y - cg.y)).toBeCloseTo(height, 9);
      expect(s.velocity.y).toBe(0);
      expect(s.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    }
  });

  it('轨末端自然释放进入六自由度，无升力也不结算；reset恢复附着', () => {
    const d = clone(poweredAircraft); d.engine.count = 0; d.fuelTank.capacity = 0;
    d.mainWing = wing(0.5, 0.3, 0.2); d.horizontalTail = wing(0.5, 0.3, 0.2); d.verticalTail = wing(0.5, 0.3, 0.2);
    const s = new FlightSimulation(d, 'low-altitude', 0), launch = challengeLaunch('low-altitude')!;
    for (let x = launch.endX; x <= launch.endX + 20; x += challengeTerrainGrid.step) {
      expect(challengeTerrainHeight('low-altitude', x, launch.z)).toBe(launch.y);
    }
    s.position.x = launch.endX - 0.01; s.velocity.x = 2;
    s.step(neutral, 0.02);
    expect(s.launching).toBe(false); expect(s.ended).toBe(false);
    expect(s.position.x).toBeGreaterThan(launch.endX); expect(s.velocity.y).toBeLessThan(0);
    s.reset(0); expect(s.launching).toBe(true); expect(s.position.x).toBe(launch.startX); expect(s.velocity.length()).toBe(0);
  });

  it('脱轨后坠回跑道用接触冲量支撑不结算，跑道外地形和机头入河仍终止', () => {
    const d = clone(downhillAircraft);
    d.mainWing = wing(0.5, 0.3, 0.2); d.horizontalTail = wing(0.5, 0.3, 0.2); d.verticalTail = wing(0.5, 0.3, 0.2);
    const s = new FlightSimulation(d, 'low-altitude', 0), launch = challengeLaunch('low-altitude')!;
    s.launching = false; s.position.set((launch.startX + launch.endX) / 2, launch.y + 2, launch.z);
    s.velocity.set(1, -8, 0);
    for (let i = 0; i < 120; i++) s.step(neutral);
    expect(s.ended).toBe(false); expect(s.launching).toBe(false);
    const points = Reflect.get(s, 'contacts') as Vector3[];
    for (const point of points) {
      const world = point.clone().sub(s.cg).applyQuaternion(s.quaternion).add(s.position);
      expect(world.y).toBeGreaterThanOrEqual(launch.y - 3e-6);
    }
    const t = s.telemetry;
    expect(t.energy + t.dissipatedEnergy + t.fuelEnergyRemoved - t.propulsionWork - t.controlWork - t.waterWork).toBeCloseTo(t.initialEnergy, 8);
    const outside = airborne(new FlightSimulation(d, 'low-altitude', 0), 50, 0);
    outside.step(neutral); expect(outside.result?.landing).toBe('terrain');
    const river = airborne(new FlightSimulation(d, 'low-altitude', 0), 200, 10);
    const nose = BODY_GEOMETRY.nose;
    const noseBottom = new Vector3(fuselageEnds(d).nose + nose.x, nose.y - nose.yRadius, 0).sub(river.cg);
    river.position.set(200, challengeRiverHeight(200) - 0.01, challengeRiverCenter(200)).sub(noseBottom);
    river.step(neutral); expect(river.result?.landing).toBe('water');
  });

  it('导轨滑跑、真实脱轨和六自由度油门录像可逐帧确定重放', () => {
    const s = new FlightSimulation(poweredAircraft, 'low-altitude', 0), states: number[][] = [];
    let releasedSteps = 0;
    for (let i = 0; i < 600 && releasedSteps < 4 && !s.ended; i++) {
      s.step({ ...neutral, throttle: i < 10 ? 0.5 : 1 }, 0.1);
      states.push([...s.position.toArray(), ...s.velocity.toArray(), ...s.quaternion.toArray(), ...s.omega.toArray(),
        s.telemetry.fuelRemaining, Number(s.launching)]);
      if (!s.launching) releasedSteps++;
    }
    expect(releasedSteps).toBe(4);
    const replay = new FlightSimulation(poweredAircraft, 'low-altitude', 0); replay.loadReplay(s.getRecording());
    for (const state of states) {
      replay.step(neutral);
      expect([...replay.position.toArray(), ...replay.velocity.toArray(), ...replay.quaternion.toArray(), ...replay.omega.toArray(),
        replay.telemetry.fuelRemaining, Number(replay.launching)]).toEqual(state);
    }
  });

  it('逐门记录低空分与贴地奖励，速度分只在终点加入，回头不重复得分', () => {
    const cross = (s: FlightSimulation, index: number, clearance: number, speed = 30) => {
      const gate = challengeCheckpoints('low-altitude')[index];
      airborne(s, gate.x - 0.1, clearance);
      s.position.set(gate.x - 0.1, challengeCollisionHeight('low-altitude', gate.x, gate.z) + clearance, gate.z);
      s.velocity.set(speed, 0, 0); s.step(neutral, 0.01);
    };
    const low = crossStart(lowAltitude()), high = crossStart(lowAltitude()), fast = crossStart(lowAltitude());
    cross(low, 0, 4); cross(high, 0, 15); cross(fast, 0, 4, 60);
    expect(low.checkpointScores).toHaveLength(1);
    expect(low.telemetry.score).toBeGreaterThan(high.telemetry.score);
    expect(fast.telemetry.score).toBeCloseTo(low.telemetry.score, 0);
    const score = low.telemetry.score;
    cross(low, 0, 4);
    expect(low.checkpointScores).toHaveLength(1); expect(low.telemetry.score).toBe(score);
    for (let i = 1; i < challengeCheckpoints('low-altitude').length; i++) cross(low, i, 4);
    expect(low.telemetry.completed).toBe(true);
    expect(low.telemetry.score).toBeGreaterThan(low.checkpointScores.reduce((a, b) => a + b, 0));
    low.reset(); expect(low.checkpointScores).toHaveLength(0);
  });

  it('赛道延长三倍，速降中段有陡降并在终点回到平原', () => {
    expect(challengeCheckpoints('downhill').at(-1)!.x).toBe(5400);
    expect(challengeCheckpoints('low-altitude').at(-1)!.x).toBe(4800);
    const ground = (x: number) => challengeTerrainHeight('downhill', x, challengeCenter('downhill', x));
    expect(ground(2400) - ground(2750)).toBeGreaterThan(700);
    expect(ground(5400)).toBeLessThan(100);
    expect(Math.abs(ground(5300) - ground(5400))).toBeLessThan(25);
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

  it('高速机头落河仍在河面附近结算，不穿到河床', () => {
    const s = crossStart(lowAltitude()), x = 180, water = challengeRiverHeight(x);
    s.position.set(x, water + 5, challengeRiverCenter(x)); s.velocity.set(0, -500, 0);
    s.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), -20 * DEG);
    s.step(neutral, 0.25);
    expect(s.result?.landing).toBe('water'); expect(s.telemetry.waterContact).toBe(true);
    const point = s.telemetry.waterContactPoint;
    expect(point.y).toBeGreaterThan(challengeTerrainHeight('low-altitude', point.x, point.z));
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

describe('物理smoke：低展弦比三角翼质量、发射和高速受力', () => {
  function deltaAircraft() {
    const d = clone(downhillAircraft);
    d.mainWing = { ...wing(4.26, 4.57, 0.16, 3), controlSurface: 0.28 };
    d.assembly.mainWingHeight = 0; d.assembly.mainIncidence = 0;
    return d;
  }

  it('77kg量级含60kg驾驶员，新增50m高度不改变离台速度或气动参数', () => {
    const d = deltaAircraft(), properties = derive(d), s = new FlightSimulation(d, 'downhill', 0);
    for (let i = 0; i < 8; i++) s.step(neutral, 0.25);
    expect(s.launching).toBe(false); expect(s.velocity.length()).toBeCloseTo(20, 10);
    const releaseClearance = s.telemetry.groundClearance;
    expect(releaseClearance).toBeGreaterThan(100);
    for (let i = 0; i < 60 && !s.ended; i++) s.step({ ...neutral, elevator: 0.15 });
    expect(s.ended).toBe(false); expect(Number.isFinite(s.telemetry.pitch)).toBe(true);
    console.info('物理smoke 发射', JSON.stringify({
      mass: properties.mass, emptyMass: properties.mass - PILOT_MASS, wingArea: properties.wingArea,
      aspect: properties.aspect, wingLoading: properties.wingLoading, releaseSpeed: 20, releaseClearance,
      afterOneSecond: { speed: s.telemetry.speed, pitchDegrees: s.telemetry.pitch / DEG, clearance: s.telemetry.groundClearance },
    }));
  });

  it.each(['downhill', 'low-altitude'] as const)('%s 20/40/50m/s受力扫描，没有40m/s限速器', challenge => {
    const d = deltaAircraft(), rows: object[] = [];
    for (const speed of [20, 40, 50]) for (const alpha of [-6, -3, 0, 6]) {
      const s = airborne(new FlightSimulation(d, challenge, 0));
      s.velocity.set(speed * Math.cos(alpha * DEG), -speed * Math.sin(alpha * DEG), 0);
      s.step(neutral, 1e-7);
      expect(s.ended).toBe(false); expect(s.telemetry.speed).toBeCloseTo(speed, 4);
      const drag = -s.telemetry.drag.dot(s.velocity) / s.velocity.length();
      expect(drag).toBeGreaterThan(0);
      const t = s.telemetry;
      expect(Math.abs(t.energy + t.dissipatedEnergy - t.waterWork - t.initialEnergy) / t.initialEnergy).toBeLessThan(1e-8);
      rows.push({
        speed, alpha, mass: t.mass, liftY: t.force.y, drag,
        bodyDrag: t.aerodynamics.bodyDrag.length(),
        mainDrag: t.aerodynamics.wings[0].drag.length(), mainInducedDrag: t.aerodynamics.wings[0].inducedDrag,
        tailDrag: t.aerodynamics.wings[1].drag.length(), verticalDrag: t.aerodynamics.wings[2].drag.length(),
        accelerationAlongVelocity: t.force.dot(s.velocity) / (t.mass * s.velocity.length()) - GRAVITY * s.velocity.y / s.velocity.length(),
        dynamicPressure: AIR_DENSITY * speed ** 2 / 2,
      });
    }
    console.info(`物理smoke ${challenge}`, JSON.stringify(rows));
  });

  it('低空喷气增加发动机、支架、油箱及燃油质量，实际阻力包含引擎外阻', () => {
    const d = deltaAircraft();
    d.engine = clone(poweredAircraft.engine); d.fuelTank = clone(poweredAircraft.fuelTank);
    const properties = derive(d), s = new FlightSimulation(d, 'low-altitude', 0);
    const mounts = engineMounts(s.definition), supportMass = mounts.reduce((sum, mount) => sum + mount.supportMass, 0);
    const fuelMass = d.fuelTank.capacity * 0.8, tankDryMass = 0.8 + d.fuelTank.capacity * 0.035;
    expect(properties.mass).toBeCloseTo(derive(deltaAircraft()).mass + engineCatalog[d.engine.type].mass + supportMass + tankDryMass + fuelMass, 8);
    for (let i = 0; i < 8; i++) s.step({ ...neutral, throttle: 1 }, 0.25);
    airborne(s); s.velocity.set(40, 0, 0); s.omega.set(0, 0, 0); s.step({ ...neutral, throttle: 1 }, 1e-7);
    expect(s.telemetry.thrust).toBeGreaterThan(0);
    const totalMass = s.telemetry.mass + s.fragments.reduce((sum, fragment) => sum + fragment.mass, 0);
    expect(totalMass).toBeCloseTo(properties.mass - (d.fuelTank.capacity - s.telemetry.fuelRemaining) * 0.8, 8);
    expect(s.telemetry.drag.length()).toBeGreaterThan(s.telemetry.aerodynamics.drag.length());
    console.info('物理smoke 动力质量链', JSON.stringify({
      initialMass: properties.mass, pilotMass: PILOT_MASS, engineMass: engineCatalog[d.engine.type].mass,
      supportMass, tankDryMass, fuelMass, currentMass: s.telemetry.mass, fuelRemaining: s.telemetry.fuelRemaining,
      thrust: s.telemetry.thrust, actualDrag: s.telemetry.drag.length(), displayedAeroDrag: s.telemetry.aerodynamics.drag.length(),
    }));
  });
});
