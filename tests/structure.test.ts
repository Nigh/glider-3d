import { describe, expect, it } from 'vitest';
import { Matrix3, Quaternion, Vector3 } from 'three';
import { clone, defaultAircraft, wing, type Controls } from '../src/model';
import { FlightSimulation, GRAVITY } from '../src/physics';
import { rotationalEnergy, type StructuralBody } from '../src/structure';

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
    sections: simulation.structure.sections.map(section => [section.bodyId, ...section.root.position.toArray(), ...section.tip.position.toArray(), ...section.root.quaternion.toArray(), ...section.tip.quaternion.toArray()]),
    fragments: simulation.fragments.map(fragment => [fragment.id, fragment.landed, fragment.mass, ...fragment.position.toArray(), ...fragment.quaternion.toArray(), ...fragment.velocity.toArray(), ...fragment.omega.toArray()]),
  };
}

describe('分段等效弹性梁', () => {
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

describe('真实超载、独立断片和完整能量账本', () => {
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
    expect(Math.abs(t.energy + t.dissipatedEnergy - t.controlWork - initial) / initial).toBeLessThan(1e-8);
    expect(t.energy).toBeCloseTo(energy(simulation) + simulation.fragments.reduce((sum, fragment) => sum + energy(fragment), 0), 7);
    for (const fragment of simulation.fragments) expect(fragment.inertiaTensor.determinant()).toBeGreaterThan(0);
    expect(simulation.aircraft.wingArea).toBeLessThan(area);
  });

  it('非对称断裂保留非对角惯量，片体继续使用局部来流且可再次超载断裂', () => {
    const d = clone(defaultAircraft); d.mainWing.materialId = 'spruce';
    const simulation = airborne(new Vector3(65, -18, 8), d);
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

  it('正常发射产生的真实断裂可确定性回放；reset恢复完整质量、边界和节点', () => {
    const d = clone(defaultAircraft);
    for (const key of ['mainWing', 'horizontalTail', 'verticalTail'] as const) {
      d[key].materialId = 'spruce'; d[key].structure = { width: 0.005, height: 0.005, wallThickness: 0.0002 };
    }
    const simulation = new FlightSimulation(d, 'birdman', 0), mass = simulation.mass;
    const states: FlightSnapshot[] = [];
    for (let i = 0; i < 150 && !simulation.ended; i++) { simulation.step(neutral); states.push(state(simulation)); }
    expect(simulation.structure.fractureCount).toBeGreaterThan(0);
    const replay = new FlightSimulation(d, 'birdman', 0); replay.loadReplay(simulation.getRecording());
    for (const expected of states) { replay.step(neutral); expect(state(replay)).toEqual(expected); }
    simulation.reset(0);
    expect(simulation.fragments).toHaveLength(0); expect(simulation.structure.fractureCount).toBe(0);
    expect(simulation.mass).toBe(mass);
    for (const section of simulation.structure.sections) {
      expect(section.bodyId).toBe(0); expect(section.surface.bodyId).toBe(0);
      expect(section.root.position.toArray()).toEqual(section.referenceRoot.toArray());
      expect(section.tip.position.toArray()).toEqual(section.referenceTip.toArray());
      expect(section.root.quaternion.toArray()).toEqual([0, 0, 0, 1]); expect(section.tip.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    }
  });
});
