import { describe, expect, it } from 'vitest';
import { clone, defaultAircraft, presets, type Controls, type FlightMode } from '../src/model';
import { derive, FlightSimulation } from '../src/physics';
import { challengeCenter, challengeCheckpoints, challengeDefinitions, challengeTerrainGrid, challengeTerrainHeight } from '../src/challenges';

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
