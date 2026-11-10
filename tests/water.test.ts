import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { BODY_GEOMETRY, clone, defaultAircraft, DEG, type Controls } from '../src/model';
import { FlightSimulation, WATER } from '../src/physics';
import { CHALLENGE_RIVER, challengeRiverCenter, challengeRiverHeight, challengeTerrainHeight, type ChallengeMode } from '../src/challenges';

const neutral: Controls = { weight: 0, lateral: 0, rudder: 0, elevator: 0, aileron: 0 };
const rollAxis = new Vector3(1, 0, 0);
function placeSkim(s: FlightSimulation) {
  const river = s.challenge === 'low-altitude', x = river ? 100 : 40;
  const shell = BODY_GEOMETRY.shell, water = river ? challengeRiverHeight(x) : 0;
  s.launching = false; s.quaternion.identity(); s.omega.set(0, 0, 0);
  // 机身椭球底部浅浸2cm，机头和翼面保持出水；不是把CG当接触点。
  s.position.set(x, water + s.cg.y - shell.y + shell.yRadius - 0.02, river ? challengeRiverCenter(x) : 0);
  s.velocity.set(8, 3, 0);
  return s;
}
function skim(challenge: ChallengeMode = 'birdman') { return placeSkim(new FlightSimulation(defaultAircraft, challenge, 0)); }
function budget(s: FlightSimulation) {
  const t = s.telemetry;
  const balance = t.energy + t.dissipatedEnergy + t.fuelEnergyRemoved - t.controlWork - t.propulsionWork - t.waterWork;
  expect(Math.abs(balance - t.initialEnergy) / t.initialEnergy).toBeLessThan(1e-8);
  expect(t.aeroPower).toBeLessThanOrEqual(0);
  expect(t.dissipatedEnergy).toBeGreaterThanOrEqual(0);
}
function state(s: FlightSimulation) {
  return {
    position: s.position.toArray(), velocity: s.velocity.toArray(), quaternion: s.quaternion.toArray(), omega: s.omega.toArray(),
    contact: s.telemetry.waterContact, contactPoint: s.telemetry.waterContactPoint.toArray(),
    waterWork: s.telemetry.waterWork, energy: s.telemetry.energy, dissipated: s.telemetry.dissipatedEnergy,
    fractures: s.structure.fractureCount, result: s.result,
  };
}
function banked(side: number, speed: number, dry = false) {
  const definition = clone(defaultAircraft);
  // 对照组只改变是否触水；碳梁保证16m/s空气载荷本身不会先破坏木梁。
  for (const key of ['mainWing', 'horizontalTail', 'verticalTail'] as const) {
    definition[key].materialId = 'carbon-epoxy'; definition[key].materialAmount = 1;
  }
  const s = new FlightSimulation(definition, 'birdman', 0);
  s.launching = false; s.position.set(40, dry ? 80 : 1.2, 0);
  s.quaternion.setFromAxisAngle(rollAxis, side * 25 * DEG);
  s.velocity.set(speed, -speed / 20, 0); s.omega.set(0, 0, 0);
  s.step(neutral, 1e-5);
  return s;
}

describe('水阻、浮力与真实接触', () => {
  it('主体轻擦不结算，可自然离水；浮力功独立计账且受控初态录像逐帧重放', () => {
    const source = skim(); source.step(neutral, 1 / 240);
    expect(source.ended).toBe(false); expect(source.telemetry.waterContact).toBe(true);
    expect(source.position.y).toBeGreaterThan(0); expect(source.telemetry.waterContactPoint.y).toBeLessThanOrEqual(0);
    expect(source.telemetry.waterWork).toBeGreaterThan(0);
    expect(source.telemetry.dissipatedEnergy).toBeGreaterThan(0); budget(source);
    const states = [state(source)];
    for (let i = 0; i < 23; i++) { source.step(neutral, i % 2 ? 1 / 120 : 1 / 240); budget(source); states.push(state(source)); }
    expect(source.ended).toBe(false); expect(source.telemetry.waterContact).toBe(false);
    const replay = new FlightSimulation(defaultAircraft, 'birdman', 0);
    replay.loadReplay(source.getRecording()); placeSkim(replay);
    for (const expected of states) { replay.step(neutral, 0.25); expect(state(replay)).toEqual(expected); }
    expect(replay.replayFinished).toBe(true);
  });

  it('单翼入水产生反向滚转和向湿翼偏航，严重水载通过梁应力真实断翼', () => {
    for (const side of [-1, 1]) {
      const wet = banked(side, 4), dry = banked(side, 4, true);
      expect(wet.telemetry.force.x).toBeLessThan(dry.telemetry.force.x);
      expect((wet.telemetry.torque.x - dry.telemetry.torque.x) * side).toBeLessThan(0);
      expect((wet.telemetry.torque.y - dry.telemetry.torque.y) * side).toBeLessThan(0);
      expect(wet.ended).toBe(false); budget(wet);
    }
    const wet = banked(1, 16), dry = banked(1, 16, true);
    expect(dry.structure.fractureCount).toBe(0);
    expect(wet.structure.sections.some(section => section.wingKey === 'mainWing' && section.side === 1 && section.bodyId !== 0)).toBe(true);
    expect(wet.structure.fractureCount).toBeGreaterThan(0); expect(wet.ended).toBe(false); budget(wet);
  });

  it('机头实际入水即结算，不要求先降至停止速度', () => {
    const s = skim(); s.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), -20 * DEG);
    s.velocity.set(8, -1, 0); s.step(neutral, 1e-4);
    expect(s.result?.landing).toBe('water'); expect(s.telemetry.waterContact).toBe(true);
    expect(s.velocity.length()).toBeGreaterThan(WATER.stopSpeed);
  });

  it('触水且低于1.5m/s才低速结算，空中低速和略高于阈值的擦水均继续', () => {
    for (const speed of [0, 1.49, 1.51]) {
      const wet = skim(); wet.velocity.set(speed, 0, 0); wet.step(neutral, 1e-5);
      expect(wet.ended).toBe(speed < 1.5);
      if (speed < 1.5) expect(wet.result?.landing).toBe('water');
      const air = skim(); air.position.y += 20; air.velocity.set(speed, 0, 0); air.step(neutral, 1e-5);
      expect(air.ended).toBe(false); expect(air.telemetry.waterContact).toBe(false);
    }
  });

  it('河面允许主体擦水，岸坡和水下河床仍按真实terrain结算', () => {
    const river = skim('low-altitude'); river.step(neutral, 1e-4);
    expect(river.telemetry.waterContact).toBe(true); expect(river.ended).toBe(false); budget(river);
    for (const offset of [-CHALLENGE_RIVER.width, 0, CHALLENGE_RIVER.width]) {
      const s = skim('low-altitude'), x = s.position.x, z = challengeRiverCenter(x) + offset;
      s.position.set(x, challengeTerrainHeight('low-altitude', x, z) - 0.1, z);
      s.velocity.set(8, -1, 0); s.step(neutral, 1e-4);
      expect(s.result?.landing).toBe('terrain');
    }
  });
});
