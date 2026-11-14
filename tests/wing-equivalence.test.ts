import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { clone, defaultAircraft, DEG, wing, wingOrigin, type AircraftDefinition, type Controls } from '../src/model';
import { derive, FlightSimulation, type AerodynamicSurface } from '../src/physics';

const neutral: Controls = { weight: 0, lateral: 0, aileron: 0, elevator: 0, rudder: 0 };
function definition() {
  const d = clone(defaultAircraft);
  d.birdman = false;
  d.assembly.tailOnFin = false;
  d.mainWing = wing(4, 0.8, 0.5, 0.2);
  d.mainWing.dihedral = 7;
  d.mainWing.controlSurface = 0.3;
  d.horizontalTail = clone(d.mainWing);
  d.assembly.mainWingHeight = 0;
  d.assembly.mainIncidence = d.assembly.tailIncidence = 3;
  d.assembly.mainWing = -0.5;
  // Tail mount references root midpoint; main mount references root leading edge.
  d.assembly.horizontalTail = d.assembly.mainWing - 0.4 * Math.cos(3 * DEG);
  return d;
}
function evaluate(d: AircraftDefinition, velocity: Vector3, controls = neutral, smart = false, height = 100) {
  const s = new FlightSimulation(d, 'test-space', 0, { height, catapult: false, speed: 12 });
  s.launching = false;
  s.position.set(100, height, 0); s.quaternion.identity(); s.velocity.copy(velocity); s.omega.set(0.1, -0.03, 0.04);
  s.structure.reset();
  Reflect.get(s, 'effective').smartMixing = smart;
  Reflect.get(s, 'updateControlDirections').call(s);
  // Exercise real force evaluation without integrating identity-dependent mass/layout differences.
  Reflect.get(s, 'evaluateForces').call(s, neutral, s.velocity, s.omega, s.quaternion, s.position, controls);
  return s;
}
function matchingPanels(s: FlightSimulation) {
  return s.surfaces.filter(panel => panel.kind === 'main').map(main => [main,
    s.surfaces.find(panel => panel.kind === 'tail' && panel.side === main.side && panel.spanStart === main.spanStart)!,
  ] as const);
}
function expectEqual(main: AerodynamicSurface, tail: AerodynamicSurface) {
  expect(main.point.distanceTo(tail.point)).toBeLessThan(1e-12);
  expect(main.alpha).toBeCloseTo(tail.alpha, 12);
  expect(main.force.distanceTo(tail.force)).toBeLessThan(1e-9);
  expect(main.drag.distanceTo(tail.drag)).toBeLessThan(1e-9);
  expect(main.inducedDrag).toBeCloseTo(tail.inducedDrag, 12);
}

describe('主翼与副翼气动等效', () => {
  it('设计参考中同位同参数水平翼产生相同正升力及力矩', () => {
    const a = derive(definition()).aerodynamics, [main, tail] = a.wings;
    expect(main.lift.y).toBeGreaterThan(0);
    expect(tail.lift.y).toBeGreaterThan(0);
    expect(main.force.distanceTo(tail.force)).toBeLessThan(1e-9);
    expect(main.torque.distanceTo(tail.torque)).toBeLessThan(1e-9);
    expect(main.alpha).toBeCloseTo(tail.alpha, 12);
  });

  it.each([0.8, 100])('真实受力路径在高度 %s m 使用相同局部来流、地效和极曲线', height => {
    for (const alpha of [-8, 0, 6, 30]) {
      const velocity = new Vector3(12 * Math.cos(alpha * DEG), -12 * Math.sin(alpha * DEG), 1.2);
      const s = evaluate(definition(), velocity, neutral, false, height);
      for (const [main, tail] of matchingPanels(s)) expectEqual(main, tail);
    }
  });

  it('相同混控配置和非零舵量保持等效', () => {
    const controls = { ...neutral, aileron: 0.3, elevator: -0.4 };
    const s = evaluate(definition(), new Vector3(12, -0.5, 0.3), controls);
    for (const [main, tail] of matchingPanels(s)) {
      expect(Math.abs(main.controlCandidate)).toBeGreaterThan(0);
      expect(main.controlCandidate).toBeCloseTo(tail.controlCandidate, 10);
      expectEqual(main, tail);
    }
    const base = evaluate(definition(), new Vector3(12, -0.5, 0.3));
    expect(s.surfaces[0].force.distanceTo(base.surfaces[0].force)).toBeGreaterThan(0.01);
  });

  it('智能混控使用相同的真实力矩导数和水平翼舵角上限', () => {
    const s = evaluate(definition(), new Vector3(12, -0.5, 0.3), neutral, true);
    for (const [main, tail] of matchingPanels(s)) {
      expect(main.controlMoment.length()).toBeGreaterThan(0);
      expect(main.controlMoment.distanceTo(tail.controlMoment)).toBeLessThan(1e-9);
    }
  });


  it('互换前后水平翼的身份，不改变对应位置的升阻力', () => {
    const d = definition();
    d.assembly.horizontalTail = -2;
    d.horizontalTail = wing(3, 0.6, 0.4, -0.1);
    d.horizontalTail.controlSurface = 0.2;
    d.horizontalTail.dihedral = -3;
    d.assembly.tailIncidence = -2;
    const swapped = clone(d), mainOrigin = wingOrigin(d, 'mainWing'), tailOrigin = wingOrigin(d, 'horizontalTail');
    swapped.mainWing = clone(d.horizontalTail); swapped.horizontalTail = clone(d.mainWing);
    swapped.assembly.mainIncidence = d.assembly.tailIncidence; swapped.assembly.tailIncidence = d.assembly.mainIncidence;
    swapped.assembly.mainWing = tailOrigin.x;
    swapped.assembly.mainWingHeight = 0;
    swapped.assembly.horizontalTail = mainOrigin.x - 0.4 * Math.cos(d.assembly.mainIncidence * DEG);
    const before = derive(d).aerodynamics, after = derive(swapped).aerodynamics;
    for (const [a, b] of [[before.wings[0], after.wings[1]], [before.wings[1], after.wings[0]]]) {
      expect(a.force.distanceTo(b.force)).toBeLessThan(1e-9);
      expect(a.drag.distanceTo(b.drag)).toBeLessThan(1e-9);
    }
  });

  it('垂尾对称截面零侧滑无侧力，正负侧滑产生反向等大侧力', () => {
    const d = definition();
    const samples = [-2, 0, 2].map(z => {
      const s = evaluate(d, new Vector3(12, 0, z));
      s.omega.set(0, 0, 0);
      Reflect.get(s, 'evaluateForces').call(s, neutral, s.velocity, s.omega, s.quaternion, s.position, neutral);
      return s.surfaces.filter(panel => panel.kind === 'vertical').reduce((sum, panel) => sum.add(panel.force.clone().sub(panel.drag)), new Vector3());
    });
    expect(samples[1].length()).toBeLessThan(1e-12);
    expect(samples[0].z).toBeGreaterThan(0);
    expect(samples[2].z).toBeLessThan(0);
    expect(samples[0].z).toBeCloseTo(-samples[2].z, 12);
  });
});
