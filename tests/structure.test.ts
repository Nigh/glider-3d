import { setTimeout as yieldTurn } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { Matrix3, Quaternion, Vector3 } from 'three';
import { AIRFRAME_MASS, clone, defaultAircraft, presets, wing, type AircraftDefinition, type Controls } from '../src/model';
import { captureReplayKeyframe, restoreReplayKeyframe, FlightSimulation, GRAVITY, PHYSICS_TICK, type FlightControls } from '../src/physics';
import { MAX_ELASTIC_ROTATION, rotationalEnergy, summarizeWingStructure, type StructuralBody, type StructureSection } from '../src/structure';

const neutral: Controls = { weight: 0, lateral: 0, rudder: 0, elevator: 0, aileron: 0 };
interface FlightSnapshot {
  position: number[]; quaternion: number[]; velocity: number[]; omega: number[]; mass: number; energy: number;
  sections: number[][]; fragments: (number | boolean)[][];
}
function airborne(speed = new Vector3(100, -30, 25), definition = defaultAircraft) {
  const simulation = new FlightSimulation(definition, 'birdman', 0);
  simulation.launching = false;
  simulation.position.set(200, 150, 0); simulation.quaternion.identity();
  simulation.velocity.copy(speed); simulation.omega.set(0.4, 0.2, -0.3);
  return simulation;
}
function energy(body: StructuralBody) {
  return body.mass * (GRAVITY * body.position.y + body.velocity.lengthSq() / 2) + rotationalEnergy(body.inertiaTensor, body.omega);
}
function state(simulation: FlightSimulation) {
  return {
    position: simulation.position.toArray(), quaternion: simulation.quaternion.toArray(), velocity: simulation.velocity.toArray(),
    omega: simulation.omega.toArray(), mass: simulation.mass, energy: simulation.telemetry.energy,
    sections: simulation.structure.sections.map(section => [section.bodyId, section.fractureDamage, section.fractureDamageBase, section.fractureDamagePeak, section.fractureDamageTick, ...section.root.position.toArray(), ...section.tip.position.toArray(), ...section.root.quaternion.toArray(), ...section.tip.quaternion.toArray()]),
    fragments: simulation.fragments.map(fragment => [fragment.id, fragment.landed, fragment.mass, ...fragment.position.toArray(), ...fragment.quaternion.toArray(), ...fragment.velocity.toArray(), ...fragment.omega.toArray()]),
  };
}

describe('结构载荷自适应杆量', () => {
  function controlled(materialId: 'spruce' | 'carbon-epoxy' = 'spruce', materialAmount = 0.5) {
    const definition: AircraftDefinition = {
      name: '结构限幅试验机', birdman: false,
      fuselage: { length: 6.5, center: 0 }, cockpit: { position: 1.2 },
      mainWing: { ...wing(14, 1.5, 0.8, 0.25), dihedral: 5 },
      horizontalTail: wing(3.5, 0.9, 0.55, 0.15),
      verticalTail: { ...wing(3, 0.9, 0.4, 0.3), controlSurface: 1 },
      assembly: { mainWing: 0.9, mainWingHeight: 0.8, horizontalTail: -2.8, verticalTail: -2.9, mainIncidence: -4, tailIncidence: 0 },
      pilot: { mass: 60 }, controls: { travel: 0.45, lateralTravel: 0.1 },
      engine: { type: 'jet-01', count: 0, x: -0.5, y: 0.5 }, fuelTank: { x: 0, capacity: 0 },
    };
    for (const key of ['mainWing', 'horizontalTail'] as const) {
      definition[key].structure = { width: 0.15, height: 0.3, wallThickness: 0.005 };
      definition[key].controlSurface = 0.4;
    }
    definition.verticalTail.materialId = materialId;
    definition.verticalTail.materialAmount = materialAmount;
    const simulation = new FlightSimulation(definition, 'downhill', 0);
    simulation.launching = false; simulation.structure.reset();
    simulation.position.set(100, 5000, 0); simulation.quaternion.identity();
    simulation.velocity.set(25, 0, 0); simulation.omega.set(0, 0, 0);
    return simulation;
  }
  function stress(simulation: FlightSimulation) {
    return Math.max(...simulation.structure.sections.map(section => section.stressRatio));
  }
  const full = { ...neutral, rudder: 1 };

  it('同一空速下强材料/大截面允许更大满杆，实际载荷受90%上限约束', () => {
    const weak = controlled(), strong = controlled('carbon-epoxy', 2);
    for (const simulation of [weak, strong]) simulation.step({ ...full, adaptiveControls: true }, 1e-5);
    const weakLimit = weak.telemetry.controlLimit;
    expect(weakLimit).toBeGreaterThan(0); expect(weakLimit).toBeLessThan(1);
    expect(strong.telemetry.controlLimit).toBeGreaterThan(weakLimit);
    expect(Math.abs(weak.telemetry.controlInputs.rudder)).toBeLessThanOrEqual(weakLimit);
    expect(stress(weak)).toBeLessThanOrEqual(0.901);
    expect(weak.structure.fractureCount).toBe(0);
    const stopped = controlled(); stopped.velocity.set(0, 0, 0);
    stopped.step({ ...full, adaptiveControls: true }, 1e-5);
    expect(stopped.telemetry.controlLimit).toBe(1);
  });

  it('三轴混合满杆、配平及已有大舵量的行程过渡均受真实90%载荷限制', () => {
    for (const elevator of [-1, 1]) for (const aileron of [-1, 1]) for (const rudder of [-1, 1]) {
      const simulation = controlled();
      const command: FlightControls = { ...neutral, elevator, aileron, rudder, adaptiveControls: true, trimPitch: 0.8, trimRoll: -0.8 };
      for (let step = 0; step < 3; step++) {
        simulation.velocity.set(0, 0, 0); simulation.omega.set(0, 0, 0); simulation.quaternion.identity();
        simulation.step({ ...neutral, elevator: -elevator, aileron: -aileron, rudder: -rudder }, 0.25);
      }
      expect(Math.abs(simulation.telemetry.controlInputs.rudder)).toBeGreaterThan(0.5);
      simulation.structure.reset();
      simulation.position.set(100, 5000, 0); simulation.quaternion.identity();
      simulation.velocity.set(25, 0, 0); simulation.omega.set(0, 0, 0);
      simulation.step(command, 1e-5);
      expect(simulation.ended).toBe(false);
      const actual = simulation.telemetry.controlInputs, cap = simulation.telemetry.controlLimit;
      expect(cap).toBeGreaterThan(0); expect(cap).toBeLessThan(1);
      for (const axis of ['elevator', 'aileron', 'rudder'] as const) expect(Math.abs(actual[axis])).toBeLessThanOrEqual(cap);
      // 已接受步的真实载荷才是本步上限；提交形变后重算属于下一步的基础载荷。
      expect(stress(simulation)).toBeLessThanOrEqual(0.901);
      expect(simulation.structure.fractureCount).toBe(0);
    }
  });

  it('零舵基础载荷已超限时归零杆量，但不伪造安全应力或阻止真实断裂', () => {
    const simulation = controlled();
    simulation.velocity.set(100, -50, 30);
    simulation.step({ ...full, adaptiveControls: true }, 1e-5);
    expect(simulation.telemetry.controlLimit).toBe(0);
    expect(simulation.telemetry.controlInputs.rudder).toBe(0);
    expect(simulation.structure.fractureCount).toBeGreaterThan(0);
  });

  it('持续满杆时区分受控载荷与形变后真实零舵基础过载，后者仍可断裂', () => {
    const simulation = controlled();
    simulation.position.x = 100;
    let limitedWithoutOverload = false, neutralOverload = false;
    for (let step = 0; step < 60; step++) {
      simulation.step({ ...full, adaptiveControls: true }, 1 / 120);
      const actualStress = stress(simulation);
      if (simulation.telemetry.controlLimit > 0) {
        expect(actualStress).toBeLessThanOrEqual(0.901);
        limitedWithoutOverload ||= simulation.telemetry.controlLimit > 0 && simulation.telemetry.controlLimit < 1;
      } else {
        neutralOverload = true;
        expect(simulation.telemetry.controlLimit).toBe(0);
        expect(simulation.telemetry.controlInputs.rudder).toBe(0);
      }
      if (simulation.structure.fractureCount > 0) {
        expect(simulation.telemetry.controlLimit).toBe(0);
        expect(Math.max(...simulation.structure.peakWings.map(wing => wing.stress))).toBeGreaterThan(1);
        break;
      }
    }
    expect(limitedWithoutOverload).toBe(true);
    expect(neutralOverload).toBe(true);
    expect(simulation.structure.fractureCount).toBeGreaterThan(0);
  });
});

describe('60Hz连续超限累积', () => {
  function constantStress(ratio: number) {
    const simulation = new FlightSimulation(defaultAircraft, 'wind-tunnel', 0);
    // Isolate the damage clock from elastic feedback and settle the fixture pose.
    simulation.structure.updateGeometry = () => {};
    simulation.step(neutral, 2 * PHYSICS_TICK);
    const root = simulation.structure.sections[0], scale = root.stressRatio / ratio;
    root.normalStrength *= scale; root.shearStrength *= scale;
    return { simulation, root };
  }

  it('轻微超限第五tick成熟，同tick重复测量与峰值只替换一次增量', () => {
    const { structure } = airborne(new Vector3());
    structure.reset();
    const root = structure.sections[0];
    root.stressRatio = 1;
    for (let tick = 1; tick <= 5; tick++) {
      for (let repeat = 0; repeat < 20; repeat++) structure.accumulateFractureDamage(0, tick);
      expect(root.fractureDamage).toBeCloseTo(tick / 5, 12);
      expect(structure.fractureCandidates(0)).toHaveLength(tick === 5 ? 1 : 0);
    }
    structure.reset();
    root.stressRatio = 1;
    structure.accumulateFractureDamage(0, 1);
    root.stressRatio = 2;
    structure.accumulateFractureDamage(0, 1);
    expect(root.fractureDamage).toBe(0.4);
    root.stressRatio = 1;
    structure.accumulateFractureDamage(0, 1);
    expect(root.fractureDamage).toBe(0.4);
    root.stressRatio = 5;
    structure.accumulateFractureDamage(0, 1);
    expect(root.fractureDamage).toBe(1);
    expect(structure.fractureCandidates(0)).toEqual([root]);
  });

  it('同tick卸载清除成熟与旧历史，重新超载必须重新确认', () => {
    const { structure } = airborne(new Vector3());
    structure.reset();
    const root = structure.sections[0];
    root.stressRatio = 5;
    structure.accumulateFractureDamage(0, 1);
    expect(structure.fractureCandidates(0)).toEqual([root]);
    root.stressRatio = 0.99;
    structure.accumulateFractureDamage(0, 1);
    expect(root.fractureDamage).toBe(0);
    root.stressRatio = 1;
    structure.accumulateFractureDamage(0, 1);
    expect(root.fractureDamage).toBe(0.2);
    expect(structure.fractureCandidates(0)).toHaveLength(0);
    for (let tick = 2; tick <= 5; tick++) structure.accumulateFractureDamage(0, tick);
    expect(structure.fractureCandidates(0)).toEqual([root]);
  });

  it('只从成熟候选中按stressRatio/id选首断，自由根不累计', () => {
    const { structure } = airborne(new Vector3());
    structure.reset();
    const [root, inner, outer] = structure.sections;
    root.stressRatio = 3; root.fractureDamage = 1;
    inner.stressRatio = 3; inner.fractureDamage = 1;
    outer.stressRatio = 4; outer.fractureDamage = 0.8;
    expect(structure.fractureCandidates(0)).toEqual([root]);
    outer.fractureDamage = 1;
    expect(structure.fractureCandidates(0)).toEqual([outer]);
    structure.detach(root, 1);
    root.stressRatio = 100;
    for (let tick = 1; tick <= 5; tick++) structure.accumulateFractureDamage(1, tick);
    expect(root.fractureDamage).toBe(0);
    expect(structure.fractureCandidates(1)).not.toContain(root);
  });

  it.each([1, 2, 4])('诊断dt=1/(60×%s)跨调用共享tick，第五tick才断', subdivisions => {
    const { simulation, root } = constantStress(1.01);
    for (let step = 0; step < 4 * subdivisions; step++) simulation.step(neutral, PHYSICS_TICK / subdivisions);
    expect(simulation.structure.fractureCount).toBe(0);
    expect(root.fractureDamage).toBeCloseTo(4 * 1.01 / 5, 10);
    simulation.step(neutral, PHYSICS_TICK / subdivisions);
    expect(simulation.structure.fractureCount).toBeGreaterThan(0);
    expect(root.bodyId).not.toBe(0);
    expect(root.fractureDamage).toBe(0);
  });

  it('单次大dt跨越真实tick，严重超限在首个极短诊断步可断', () => {
    for (const [ratio, dt] of [[1.01, 5 * PHYSICS_TICK], [5.01, 1e-5]]) {
      const { simulation, root } = constantStress(ratio);
      simulation.step(neutral, dt);
      expect(root.bodyId).not.toBe(0);
      expect(simulation.structure.fractureCount).toBeGreaterThan(0);
    }
  });

  it('独立静载update、measureLoads和预测均不计损伤', () => {
    const simulation = airborne(new Vector3()), structure = simulation.structure, zero = new Vector3();
    structure.reset(); simulation.omega.set(0, 0, 0);
    structure.sections.at(-1)!.surface.force.set(0, 1e6, 0);
    for (let repeat = 0; repeat < 10; repeat++) {
      structure.update(simulation, zero, zero);
      structure.measureLoads(simulation, zero, zero);
      structure.predictStress(simulation, zero, zero);
    }
    expect(Math.max(...structure.sections.map(s => s.stressRatio))).toBeGreaterThan(5);
    expect(structure.sections.every(s => s.fractureDamage === 0 && s.fractureDamageTick === 0)).toBe(true);
    expect(structure.fractureCandidates(0)).toHaveLength(0);
  });

  it('checkpoint与关键帧保留tick增量，reset清空，拒绝损伤/时钟越界', () => {
    const simulation = airborne(new Vector3());
    simulation.omega.set(0, 0, 0);
    simulation.step(neutral, PHYSICS_TICK / 2);
    const structure = simulation.structure;
    for (const s of structure.sections) s.stressRatio = 0;
    structure.sections[0].stressRatio = 1;
    structure.accumulateFractureDamage(0, 1);
    const recording = simulation.getRecording();
    const restored = restoreReplayKeyframe(simulation.definition, 'birdman', recording, captureReplayKeyframe(simulation, recording));
    const continued = restored.checkpoint(), expected = simulation.checkpoint();
    continued.step(neutral); expected.step(neutral, PHYSICS_TICK / 2);
    expect(state(continued)).toEqual(state(expected));
    for (const copy of [simulation.checkpoint(), restored]) {
      expect(copy.structure.sections[0].fractureDamage).toBe(0.2);
      copy.structure.accumulateFractureDamage(0, 1);
      expect(copy.structure.sections[0].fractureDamage).toBe(0.2);
      copy.structure.accumulateFractureDamage(0, 2);
      expect(copy.structure.sections[0].fractureDamage).toBe(0.4);
      copy.reset(0);
      expect(copy.structure.sections.every(s => s.fractureDamage === 0 && s.fractureDamageBase === 0 && s.fractureDamagePeak === 0 && s.fractureDamageTick === 0)).toBe(true);
    }
    for (const key of ['fractureDamage', 'fractureDamageBase', 'fractureDamagePeak'] as const) {
      for (const value of [-0.1, 1.1, Infinity]) {
        const invalid = simulation.checkpoint();
        invalid.structure.sections[0][key] = value;
        expect(() => restoreReplayKeyframe(simulation.definition, 'birdman', recording, captureReplayKeyframe(invalid, recording))).toThrow('回放关键帧状态无效');
      }
      const invalid = simulation.checkpoint();
      invalid.structure.sections[0][key] = NaN;
      expect(() => captureReplayKeyframe(invalid, recording)).toThrow('回放状态包含无效数值');
    }
    for (const [key, value] of [['fractureTick', 1.5], ['fractureTick', 2], ['fractureTickElapsed', -0.1], ['fractureTickElapsed', PHYSICS_TICK]] as const) {
      const invalid = simulation.checkpoint();
      Reflect.set(invalid, key, value);
      expect(() => restoreReplayKeyframe(simulation.definition, 'birdman', recording, captureReplayKeyframe(invalid, recording))).toThrow('回放关键帧状态无效');
    }
    const future = simulation.checkpoint();
    future.structure.sections[0].fractureDamageTick = 2;
    expect(() => restoreReplayKeyframe(simulation.definition, 'birdman', recording, captureReplayKeyframe(future, recording))).toThrow('回放关键帧状态无效');
  });
});

it('三翼分别汇总当前极限、弹性限与分离状态，不复用全机最大值', () => {
 const sections = [
  { wingKey: 'mainWing', stressRatio: 1.25, yieldRatio: 2.4, bodyId: 0 },
  { wingKey: 'mainWing', stressRatio: 0.8, yieldRatio: 1.6, bodyId: 7 },
  { wingKey: 'horizontalTail', stressRatio: 0.12, yieldRatio: 0.3, bodyId: 0 },
  { wingKey: 'verticalTail', stressRatio: 0.41, yieldRatio: 0.7, bodyId: 0 },
 ] as const;
 const summary = summarizeWingStructure(sections);
 expect(summary).toMatchObject([
  { key: 'mainWing', stress: 1.25, yieldRatio: 2.4, attached: 1, detached: 1 },
  { key: 'horizontalTail', stress: 0.12, yieldRatio: 0.3, attached: 1, detached: 0 },
  { key: 'verticalTail', stress: 0.41, yieldRatio: 0.7, attached: 1, detached: 0 },
 ]);
 const afterFracture = sections.map(section => section.wingKey === 'mainWing'
  ? { ...section, stressRatio: 0.02, yieldRatio: 0.04, bodyId: 7 } : section);
 expect(summarizeWingStructure(afterFracture, summary)).toMatchObject([
  { key: 'mainWing', stress: 0.02, yieldRatio: 0.04, attached: 0, detached: 2 },
  { key: 'horizontalTail', stress: 0.12, yieldRatio: 0.3, attached: 1, detached: 0 },
  { key: 'verticalTail', stress: 0.41, yieldRatio: 0.7, attached: 1, detached: 0 },
 ]);
});

describe('分段等效弹性梁', () => {
  it.each(['birdman', 'downhill', 'low-altitude'] as const)('%s待发射零速时，支撑重力产生真实应力与下垂', challenge => {
    const simulation = new FlightSimulation(defaultAircraft, challenge, 0);
    const tip = simulation.structure.sections.filter(section => section.wingKey === 'mainWing' && section.side === 1).at(-1)!;
    expect(simulation.launching).toBe(true); expect(simulation.velocity.lengthSq()).toBe(0);
    expect(tip.tip.position.y).toBeLessThan(tip.referenceTip.y);
    expect(simulation.structure.maxStressRatio).toBeGreaterThan(0);
    expect(simulation.structure.maxDeflection).toBeGreaterThan(0);
    expect(simulation.structure.fractureCount).toBe(0);
    expect(simulation.surfaces.every(surface => surface.force.lengthSq() === 0)).toBe(true);
  });

  it.each(['birdman', 'downhill'] as const)('%s加速发射通过气动抬升机翼，离轨保留受力形状', challenge => {
    const simulation = new FlightSimulation(defaultAircraft, challenge, 0);
    const tip = simulation.structure.sections.filter(section => section.wingKey === 'mainWing' && section.side === 1).at(-1)!;
    const sag = tip.tip.position.y - tip.referenceTip.y;
    const lift = () => simulation.surfaces.filter(surface => surface.kind === 'main').reduce((sum, surface) => sum + surface.force.y, 0);
    simulation.step(neutral, 0.25);
    const slowLift = lift(), slowDeflection = tip.tip.position.y - tip.referenceTip.y;
    expect(simulation.launching).toBe(true);
    for (let i = 0; i < 3; i++) simulation.step(neutral, 0.25);
    expect(simulation.launching).toBe(true); expect(simulation.structure.fractureCount).toBe(0);
    expect(lift()).toBeGreaterThan(slowLift);
    expect(tip.tip.position.y - tip.referenceTip.y).toBeGreaterThan(slowDeflection);
    expect(tip.tip.position.y - tip.referenceTip.y).toBeGreaterThan(sag);
    for (let i = 0; i < 4; i++) simulation.step(neutral, 0.25);
    expect(simulation.launching).toBe(false); expect(simulation.ended).toBe(false);
    expect(tip.tip.position.distanceTo(tip.referenceTip)).toBeGreaterThan(1e-5);
    expect(tip.tip.quaternion.angleTo(new Quaternion())).toBeGreaterThan(1e-5);
    simulation.step(neutral, 1e-4);
    expect(tip.tip.position.distanceTo(tip.referenceTip)).toBeGreaterThan(1e-5);
    expect(lift()).toBeGreaterThan(0);
  });

  it('低空滑跑共用飞行积分，轨道支撑时随来流增加抬升而不清空形变', () => {
    const simulation = new FlightSimulation(defaultAircraft, 'low-altitude', 0);
    const tip = simulation.structure.sections.filter(section => section.wingKey === 'mainWing' && section.side === 1).at(-1)!;
    const sag = tip.tip.position.y - tip.referenceTip.y;
    simulation.step(neutral, 1e-4);
    expect(simulation.velocity.lengthSq()).toBe(0);
    expect(tip.tip.position.y).toBeLessThan(tip.referenceTip.y);
    simulation.velocity.set(2, 0, 0); simulation.step(neutral, 1e-4);
    expect(simulation.launching).toBe(true);
    const slowDeflection = tip.tip.position.y - tip.referenceTip.y, slowLift = simulation.telemetry.force.y;
    simulation.velocity.set(4, 0, 0); simulation.step(neutral, 1e-4);
    expect(simulation.launching).toBe(true); expect(simulation.ended).toBe(false);
    expect(simulation.structure.fractureCount).toBe(0);
    expect(slowLift).toBeGreaterThan(0);
    expect(simulation.telemetry.force.y).toBeGreaterThan(slowLift);
    expect(simulation.telemetry.force.y).toBeLessThan(simulation.mass * GRAVITY);
    expect(slowDeflection).toBeGreaterThan(sag);
    expect(tip.tip.position.y - tip.referenceTip.y).toBeGreaterThan(slowDeflection);
    expect(simulation.structure.maxStressRatio).toBeGreaterThan(0);
  });

  it('同一来流下三材料实际改变质量、形变和极限利用率；增厚梁降低形变', () => {
    const sample = (materialId: 'spruce' | 'aluminum-6061-t6' | 'carbon-epoxy', thickness = 1) => {
      const definition = clone(defaultAircraft);
      definition.mainWing.materialId = materialId;
      definition.mainWing.structure.wallThickness *= thickness;
      const simulation = airborne(new Vector3(5, 0, 0), definition);
      simulation.omega.set(0, 0, 0);
      simulation.step(neutral, 1e-4);
      expect(simulation.structure.fractureCount).toBe(0);
      return simulation;
    };
    const wood = sample('spruce'), aluminum = sample('aluminum-6061-t6'), carbon = sample('carbon-epoxy');
    expect(wood.mass).toBeLessThan(carbon.mass);
    expect(carbon.mass).toBeLessThan(aluminum.mass);
    expect(wood.structure.maxDeflection).toBeGreaterThan(carbon.structure.maxDeflection * 3);
    expect(wood.structure.maxDeflection).toBeGreaterThan(aluminum.structure.maxDeflection * 3);
    expect(wood.structure.maxStressRatio).toBeGreaterThan(carbon.structure.maxStressRatio * 3);
    const thicker = sample('carbon-epoxy', 2);
    expect(thicker.mass).toBeGreaterThan(carbon.mass);
    expect(thicker.structure.maxDeflection).toBeLessThan(carbon.structure.maxDeflection);
    expect(thicker.structure.maxStressRatio).toBeLessThan(carbon.structure.maxStressRatio);
  });

  it('50–200%材料用量改变真实质量、惯量、EI/GJ和应力截面，保持合法管壁比例', () => {
    const simulations = [0.5, 1, 2].map(materialAmount => {
      const d = clone(defaultAircraft);
      d.mainWing.materialId = 'carbon-epoxy'; d.mainWing.materialAmount = materialAmount;
      return new FlightSimulation(d, 'birdman', 0);
    });
    const baseline = simulations[1], base = baseline.structure.sections.find(section => section.wingKey === 'mainWing')!;
    for (const [index, amount] of [0.5, 1, 2].entries()) {
      const simulation = simulations[index], section = simulation.structure.sections.find(row => row.wingKey === 'mainWing')!;
      const skinMass = section.surface.area * AIRFRAME_MASS.mainArea;
      expect(section.mass - skinMass).toBeCloseTo((base.mass - skinMass) * amount, 12);
      expect(section.sectionArea).toBeCloseTo(base.sectionArea * amount, 12);
      expect(section.bendingStiffness).toBeCloseTo(base.bendingStiffness * amount ** 2, 7);
      expect(section.lateralStiffness).toBeCloseTo(base.lateralStiffness * amount ** 2, 7);
      expect(section.torsionalStiffness).toBeCloseTo(base.torsionalStiffness * amount ** 2, 7);
      for (const key of ['normalModulus', 'lateralModulus', 'torsionModulus'] as const) {
        expect(section[key]).toBeCloseTo(base[key] * amount ** 1.5, 12);
        expect(section[key]).toBeGreaterThan(0);
      }
    }
    expect(simulations[0].mass).toBeLessThan(baseline.mass); expect(simulations[2].mass).toBeGreaterThan(baseline.mass);
    expect(simulations[0].cg.distanceTo(simulations[2].cg)).toBeGreaterThan(0);
    expect(simulations[0].inertiaTensor.elements[0]).toBeLessThan(simulations[2].inertiaTensor.elements[0]);
    for (const simulation of simulations) {
      simulation.launching = false; simulation.position.set(200, 150, 0); simulation.quaternion.identity();
      simulation.velocity.set(5, 0, 0); simulation.step(neutral, 1e-4);
      expect(simulation.structure.fractureCount).toBe(0);
    }
    expect(simulations[2].structure.maxDeflection).toBeLessThan(simulations[0].structure.maxDeflection);
    expect(simulations[2].structure.maxStressRatio).toBeLessThan(simulations[0].structure.maxStressRatio);
  });

  it('根部应力累计全部外段偏心力臂，两个弯曲方向和扭转均实际变形', () => {
    const d = clone(defaultAircraft); d.mainWing = wing(6.4, 1, 1); d.assembly.mainIncidence = 0;
    const simulation = new FlightSimulation(d, 'birdman', 0);
    const row = simulation.structure.sections.filter(section => section.wingKey === 'mainWing' && section.side === 1);
    const root = row[0], tip = row.at(-1)!;
    tip.surface.point.x -= 0.2; tip.surface.force.set(50, 100, 10);
    const expected = new Vector3().crossVectors(tip.surface.point.clone().sub(root.root.position), tip.surface.force);
    const body: StructuralBody = { id: 0, position: new Vector3(), quaternion: new Quaternion(), velocity: new Vector3(), omega: new Vector3(), cg: new Vector3(), mass: 1, inertiaTensor: new Matrix3(), inverseInertia: new Matrix3() };
    // 自由落体消去均匀重力；固定姿态的制造解隔离指定偏心载荷，不调用人工断裂。
    simulation.structure.update(body, new Vector3(), new Vector3());
    expect(root.moment.distanceTo(expected)).toBeLessThan(1e-9);
    expect(Math.abs(root.moment.dot(root.chordAxis))).toBeGreaterThan(1);
    expect(Math.abs(root.moment.dot(root.normalAxis))).toBeGreaterThan(1);
    expect(Math.abs(root.moment.dot(root.beamAxis))).toBeGreaterThan(1);
    expect(tip.tip.position.distanceTo(tip.referenceTip)).toBeGreaterThan(1e-5);
    expect(tip.tip.quaternion.angleTo(new Quaternion())).toBeGreaterThan(1e-5);
    expect(tip.surface.normal.distanceTo(tip.referenceNormal)).toBeGreaterThan(1e-5);
    expect(root.stressRatio).toBeGreaterThan(tip.stressRatio);
  });

  it('重力惯性在自由落体抵消，不凭空产生自重弯曲；支撑时自重进入应力', () => {
    const simulation = new FlightSimulation(defaultAircraft, 'birdman', 0);
    simulation.structure.update(simulation, new Vector3(), new Vector3());
    expect(Math.max(...simulation.structure.sections.map(section => section.stress))).toBeLessThan(1e-8);
    simulation.structure.update(simulation, new Vector3(0, simulation.mass * GRAVITY, 0), new Vector3());
    expect(Math.max(...simulation.structure.sections.map(section => section.stress))).toBeGreaterThan(1);
  });
});

describe('分支材料与累计小转角预算', () => {
  function fixture(tailOnFin = false, finSide = 1) {
    const definition = clone(presets.find(p => p.name === '基础单发型')!);
    definition.mainWing = { ...definition.mainWing, ...wing(24, 1.5, 1) };
    definition.mainWing.materialAmount = 2;
    definition.assembly.tailOnFin = tailOnFin;
    if (finSide < 0) {
      const scale = -0.4 / definition.verticalTail.points[1].y;
      for (const point of definition.verticalTail.points) point.y *= scale;
    }
    const simulation = new FlightSimulation(definition, 'low-altitude', 0);
    const structure = simulation.structure;
    structure.reset();
    const body: StructuralBody = { id: 0, position: new Vector3(), quaternion: new Quaternion(),
      velocity: new Vector3(), omega: new Vector3(), cg: new Vector3(), mass: 1,
      inertiaTensor: new Matrix3(), inverseInertia: new Matrix3() };
    const row = structure.sections.filter(s => s.wingKey === 'mainWing' && s.side === 1);
    return { structure, body, row };
  }
  function angle(a: Quaternion, b: Quaternion) {
    const q = a.clone().invert().multiply(b);
    return 2 * Math.atan2(Math.hypot(q.x, q.y, q.z), Math.abs(q.w));
  }
  function pathAngle(row: readonly StructureSection[], base = false) {
    let sum = 0, previous = new Quaternion();
    for (const section of row) {
      const root = base ? section.baseRootRotation : section.root.quaternion;
      const tip = base ? section.baseTipRotation : section.tip.quaternion;
      sum += angle(previous, root) + angle(root, tip);
      previous = tip;
    }
    return sum;
  }

  it('100/10000 N真实端载利用率不钳制，提交形状均遵守0.25 rad预算', () => {
    const results = [100, 10000].map(force => {
      const { structure, body, row } = fixture();
      const tip = row.at(-1)!;
      const contacts = structure.sections.map(() => ({ force: new Vector3(), moment: new Vector3() }));
      contacts[tip.id].force.set(0, force, 0);
      contacts[tip.id].moment.crossVectors(tip.referenceTip, contacts[tip.id].force);
      const before = row.map(s => s.tip.position.toArray());
      const maximum = structure.measureLoads(body, new Vector3(), new Vector3(), contacts);
      expect(structure.fractureCandidates(0)).toHaveLength(0);
      structure.accumulateFractureDamage(0, 1);
      expect(row.map(s => s.tip.position.toArray())).toEqual(before);
      const ratios = row.map(s => s.stressRatio);
      structure.updateGeometry(0);
      expect(row.map(s => s.stressRatio)).toEqual(ratios);
      expect(structure.rotationBudgetValid()).toBe(true);
      expect(pathAngle(row)).toBeLessThanOrEqual(MAX_ELASTIC_ROTATION + 1e-9);
      for (let i = 1; i < row.length; i++) {
        expect(row[i].root.position.distanceTo(row[i - 1].tip.position)).toBeLessThan(1e-10);
        expect(angle(row[i].root.quaternion, row[i - 1].tip.quaternion)).toBeLessThan(1e-10);
      }
      expect(structure.fractureCandidates(0)).toHaveLength(force === 100 ? 0 : 1);
      return { maximum, angle: pathAngle(row) };
    });
    expect(results[0].maximum).toBeCloseTo(0.7828723617584119, 6);
    expect(results[1].maximum).toBeCloseTo(78.28723617584119, 6);
    expect(results[1].maximum / results[0].maximum).toBeCloseTo(100, 12);
    expect(results[1].angle).toBeLessThanOrEqual(results[0].angle + 1e-9);
  });

  it('零载荷和零曲率保持有限节点，不产生形变或候选', () => {
    const { structure, body } = fixture();
    for (let i = 0; i < 3; i++) structure.update(body, new Vector3(), new Vector3());
    expect(structure.rotationBudgetValid()).toBe(true);
    expect(structure.fractureCandidates(0)).toHaveLength(0);
    for (const section of structure.sections) {
      expect(section.stressRatio).toBe(0);
      expect(section.root.position.distanceTo(section.referenceRoot)).toBe(0);
      expect(section.tip.position.distanceTo(section.referenceTip)).toBe(0);
    }
  });

  it('重复分离保留冻结根角预算，预算耗尽仍报告真实超载', () => {
    const { structure, body, row } = fixture();
    row.at(-1)!.surface.force.set(0, 10000, 0);
    structure.update(body, new Vector3(), new Vector3());
    const initial = pathAngle(row);
    expect(initial).toBeGreaterThan(0.1);
    for (let i = 0; i < 4; i++) {
      const boundary = row[i], id = i + 1;
      structure.detach(boundary, id);
      const remaining = row.slice(i);
      const frozen = pathAngle(remaining, true);
      expect(frozen).toBeCloseTo(initial, 10);
      structure.update({ ...body, id }, new Vector3(), new Vector3());
      expect(structure.rotationBudgetValid()).toBe(true);
      expect(pathAngle(remaining)).toBeLessThanOrEqual(MAX_ELASTIC_ROTATION + 1e-9);
      expect(remaining[0].root.quaternion.toArray()).toEqual(remaining[0].baseRootRotation.toArray());
      expect(remaining.some(s => s.stressRatio > 1)).toBe(true);
      expect(structure.fractureCandidates(id)).not.toContain(boundary);
    }
  });

  it.each(['base', 'current'] as const)('回放预算拒绝%s超限但不计刚体姿态', source => {
    const { structure, body, row } = fixture();
    body.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 2);
    expect(structure.rotationBudgetValid()).toBe(true);
    const target = source === 'base' ? row.at(-1)!.baseTipRotation : row.at(-1)!.tip.quaternion;
    target.setFromAxisAngle(new Vector3(1, 0, 0), MAX_ELASTIC_ROTATION + 2e-9);
    expect(structure.rotationBudgetValid()).toBe(false);
  });

  it('材料限制使用整个支撑分支的共同系数，不缩减真实弯矩', () => {
    const { structure, row } = fixture();
    for (const section of row) section.moment.copy(section.chordAxis).multiplyScalar(1);
    row[0].stressRatio = 2; row.at(-1)!.yieldRatio = 4;
    const moments = row.map(s => s.moment.toArray());
    structure.updateGeometry(0);
    for (const section of row) {
      const expected = section.referenceRoot.distanceTo(section.referenceTip) / section.bendingStiffness / 4;
      expect(angle(section.root.quaternion, section.tip.quaternion)).toBeCloseTo(expected, 12);
    }
    expect(row.map(s => s.moment.toArray())).toEqual(moments);
    expect(row[0].stressRatio).toBe(2);
    expect(row.at(-1)!.yieldRatio).toBe(4);
  });

  it.each([-1, 1])('T尾同用垂尾分支材料系数，%s侧安装保持连续', finSide => {
    const { structure } = fixture(true, finSide);
    const fin = structure.sections.filter(s => s.wingKey === 'verticalTail');
    const tails = structure.sections.filter(s => s.wingKey === 'horizontalTail');
    for (const section of [...fin, ...tails]) section.moment.copy(section.chordAxis);
    tails.at(-1)!.yieldRatio = 100;
    structure.updateGeometry(0);
    for (const section of [...fin, ...tails]) {
      const expected = section.referenceRoot.distanceTo(section.referenceTip) / section.bendingStiffness / 100;
      expect(angle(section.root.quaternion, section.tip.quaternion)).toBeCloseTo(expected, 12);
    }
    const support = fin.at(-1)!;
    for (const first of tails.filter(s => s.parentId === support.id)) {
      const expected = first.referenceRoot.clone().sub(support.referenceTip)
        .applyQuaternion(support.tip.quaternion).add(support.tip.position);
      expect(first.root.position.distanceTo(expected)).toBeLessThan(1e-10);
      expect(angle(first.root.quaternion, support.tip.quaternion)).toBeLessThan(1e-10);
    }
    expect(structure.rotationBudgetValid()).toBe(true);
    structure.detach(fin[0], 1);
    expect([...fin, ...tails].every(s => s.bodyId === 1)).toBe(true);
    expect(structure.rotationBudgetValid()).toBe(true);
  });
});

describe('真实超载、独立断片和完整能量账本', () => {
  it('首断选最大真实利用率，卸载后保留安全连接，独立超载分支继续失效', () => {
    const simulation = airborne(new Vector3());
    const structure = simulation.structure;
    structure.reset(); simulation.omega.set(0, 0, 0); simulation.quaternion.identity();
    const right = structure.sections.filter(s => s.wingKey === 'mainWing' && s.side === 1);
    const left = structure.sections.filter(s => s.wingKey === 'mainWing' && s.side === -1);
    right.at(-1)!.surface.force.set(0, 100000, 0);
    left.at(-1)!.surface.force.set(0, 50000, 0);
    const body: StructuralBody = { id: 0, position: new Vector3(), quaternion: new Quaternion(),
      velocity: new Vector3(), omega: new Vector3(), cg: new Vector3(), mass: 1,
      inertiaTensor: new Matrix3(), inverseInertia: new Matrix3() };
    structure.measureLoads(body, new Vector3(), new Vector3());
    structure.accumulateFractureDamage(0, 1);
    const expected = [...structure.sections].sort((a, b) => b.stressRatio - a.stressRatio || a.id - b.id)[0];
    expect(expected).toBe(right[0]);
    const [boundary] = structure.fractureCandidates(0);
    expect(boundary).toBe(expected);
    structure.updateGeometry(0); structure.detach(boundary, 1);
    expect(right.every(s => s.bodyId === 1)).toBe(true);
    structure.measureLoads(body, new Vector3(), new Vector3());
    structure.accumulateFractureDamage(0, 1);
    const [next] = structure.fractureCandidates(0);
    expect(next).toBe(left[0]);
    structure.detach(next, 2);
    structure.measureLoads(body, new Vector3(), new Vector3());
    structure.accumulateFractureDamage(0, 1);
    expect(structure.fractureCandidates(0)).toHaveLength(0);
    expect(structure.sectionsForBody(0).every(s => s.stressRatio < 1)).toBe(true);
    for (const section of right) section.surface.force.set(0, 0, 0);
    structure.measureLoads({ ...body, id: 1 }, new Vector3(), new Vector3());
    structure.accumulateFractureDamage(1, 1);
    expect(structure.fractureCandidates(1)).toHaveLength(0);
    expect(right.every(s => s.bodyId === 1)).toBe(true);
    // Equal utilization uses the lower id, never depth. Free roots cannot fail.
    for (const section of right) { section.stressRatio = 2; section.fractureDamage = 1; }
    expect(structure.fractureCandidates(1)).toEqual([right[1]]);
    structure.detach(right.at(-1)!, 3);
    expect(structure.fractureCandidates(3)).toHaveLength(0);
  });
  it('高动压通过公开step断开三类翼面，主体继续，质量/全张量动能不丢失', () => {
    const simulation = airborne(), mass = simulation.mass, initial = energy(simulation), area = simulation.aircraft.wingArea;
    const momentum = simulation.velocity.clone().multiplyScalar(mass);
    simulation.step(neutral, 1e-4);
    expect(simulation.ended).toBe(false); expect(simulation.structure.fractureCount).toBeGreaterThan(0);
    for (const wingKey of ['mainWing', 'horizontalTail', 'verticalTail']) expect(simulation.structure.sections.some(section => section.wingKey === wingKey && section.bodyId !== 0)).toBe(true);
    expect(simulation.fragments.length).toBeGreaterThan(0);
    expect(simulation.mass + simulation.fragments.reduce((sum, fragment) => sum + fragment.mass, 0)).toBeCloseTo(mass, 10);
    const finalMomentum = simulation.velocity.clone().multiplyScalar(simulation.mass);
    for (const fragment of simulation.fragments) finalMomentum.addScaledVector(fragment.velocity, fragment.mass);
    const expectedMomentum = momentum.addScaledVector(simulation.telemetry.force, 1e-4);
    expectedMomentum.y -= mass * GRAVITY * 1e-4;
    expect(finalMomentum.distanceTo(expectedMomentum)).toBeLessThan(1e-7);
    const t = simulation.telemetry;
    expect(Math.abs(t.energy + t.dissipatedEnergy - t.controlWork - t.waterWork - initial) / initial).toBeLessThan(1e-8);
    expect(t.energy).toBeCloseTo(energy(simulation) + simulation.fragments.reduce((sum, fragment) => sum + energy(fragment), 0), 7);
    for (const fragment of simulation.fragments) expect(fragment.inertiaTensor.determinant()).toBeGreaterThan(0);
    expect(simulation.aircraft.wingArea).toBeLessThan(area);
  });

  it('非对称断裂保留非对角惯量，片体继续使用局部来流且可再次超载断裂', () => {
    const d = clone(defaultAircraft); d.mainWing.materialId = 'spruce';
    // First-cut unloading can retain a multi-strip fragment; a later independent
    // load must still be able to break its remaining real joints.
    const simulation = airborne(new Vector3(20, -8, 8), d);
    simulation.omega.set(3, 0.2, -0.1);
    simulation.step(neutral, 1e-4);
    const fragment = simulation.fragments.find(body => simulation.structure.sections.filter(section => section.bodyId === body.id && section.wingKey === 'mainWing').length > 2);
    expect(fragment).toBeDefined();
    const f = fragment!, oldCount = simulation.structure.fractureCount, position = f.position.clone();
    const mass = simulation.mass + simulation.fragments.reduce((sum, body) => sum + body.mass, 0);
    expect(Math.abs(f.inertiaTensor.elements[3]) + Math.abs(f.inertiaTensor.elements[6]) + Math.abs(f.inertiaTensor.elements[7])).toBeGreaterThan(1e-6);
    // 外部改变片体旋转代表后续阵风/碰撞冲量；仍由公开step求正常气动和应力，不强制detach。
    f.omega.set(80, 0.3, -0.2);
    simulation.step(neutral, 1e-5);
    expect(f.position.distanceTo(position)).toBeGreaterThan(0);
    expect(f.drag.length()).toBeGreaterThan(0); expect(f.aeroPower).toBeLessThan(0);
    expect(simulation.structure.fractureCount).toBeGreaterThan(oldCount);
    expect(simulation.mass + simulation.fragments.reduce((sum, body) => sum + body.mass, 0)).toBeCloseTo(mass, 10);
    expect(simulation.ended).toBe(false);
  });

  it('断裂基形在无载荷自由落体中保持，不每步重复叠加初始扭转', () => {
    const simulation = airborne(); simulation.step(neutral, 1e-4);
    const fragment = simulation.fragments[0]; expect(fragment).toBeDefined();
    fragment.omega.set(0, 0, 0);
    const sections = simulation.structure.sections.filter(section => section.bodyId === fragment.id);
    for (const section of sections) section.surface.force.set(0, 0, 0);
    const shape = sections.map(section => [...section.root.position.toArray(), ...section.tip.position.toArray(), ...section.root.quaternion.toArray(), ...section.tip.quaternion.toArray()]);
    for (let i = 0; i < 5; i++) simulation.structure.update(fragment, new Vector3(), new Vector3());
    expect(sections.map(section => [...section.root.position.toArray(), ...section.tip.position.toArray(), ...section.root.quaternion.toArray(), ...section.tip.quaternion.toArray()])).toEqual(shape);
  });

  it('碎片接触只停止所属片体，不触发主体落水或结束', () => {
    const simulation = airborne(); simulation.step(neutral, 1e-4);
    const fragment = simulation.fragments[0]; expect(fragment).toBeDefined();
    fragment.position.y = -50;
    simulation.step(neutral, 1e-4);
    expect(fragment.landed).toBe(true); expect(fragment.velocity.lengthSq()).toBe(0); expect(fragment.omega.lengthSq()).toBe(0);
    expect(simulation.ended).toBe(false); expect(simulation.result).toBeNull();
    expect(simulation.position.y).toBeGreaterThan(100);
  });

  it('正常发射产生的真实断裂可确定性回放；reset恢复完整质量、边界和静载节点', async () => {
    const d = clone(defaultAircraft);
    for (const key of ['mainWing', 'horizontalTail', 'verticalTail'] as const) {
      d[key].materialId = 'spruce'; d[key].structure = { width: 0.005, height: 0.005, wallThickness: 0.0002 };
    }
    const simulation = new FlightSimulation(d, 'birdman', 0), mass = simulation.mass;
    const initialSections = state(simulation).sections;
    const states: FlightSnapshot[] = [];
    for (let i = 0; i < 150 && !simulation.ended; i++) {
      simulation.step(neutral); states.push(state(simulation));
      if (i % 15 === 0) await yieldTurn(0);
    }
    expect(simulation.structure.fractureCount).toBeGreaterThan(0);
    const replay = new FlightSimulation(d, 'birdman', 0); replay.loadReplay(simulation.getRecording());
    for (const [index, expected] of states.entries()) {
      replay.step(neutral); expect(state(replay)).toEqual(expected);
      if (index % 15 === 0) await yieldTurn(0);
    }
    simulation.reset(0);
    expect(simulation.fragments).toHaveLength(0); expect(simulation.structure.fractureCount).toBe(0);
    expect(simulation.mass).toBe(mass);
    expect(state(simulation).sections).toEqual(initialSections);
    for (const section of simulation.structure.sections) {
      expect(section.bodyId).toBe(0); expect(section.surface.bodyId).toBe(0);
    }
  }, 60_000);
});

it('翼面峰值保留卸载和断裂前的最高受力，reset清空',()=>{
 const simulation=new FlightSimulation(defaultAircraft,'birdman',0),structure=simulation.structure;
 simulation.launching=false;simulation.position.set(0,150,0);simulation.velocity.set(80,-20,0);
 simulation.step({weight:0,lateral:0,rudder:0,elevator:0,aileron:0},1/60);
 const peaks=structure.peakWings.map(w=>({...w}));
 expect(peaks[0].stress).toBeGreaterThan(0);
 for(const body of [simulation,...simulation.fragments]){
  body.position.set(200,150,0);body.velocity.set(0,0,0);body.omega.set(0,0,0);
 }
 simulation.step(neutral,1e-5);
 expect(structure.maxStressRatio).toBeLessThan(0.001);
 expect(structure.peakWings).toEqual(peaks);
 structure.reset();
 expect(structure.peakWings.every(w=>w.stress===0&&w.yieldRatio===0)).toBe(true);
});
