import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { AIRFRAME_MASS, clone, defaultAircraft, DEG, wing, wingOrigin, type AircraftDefinition, type Controls } from '../src/model';
import { AIR_DENSITY, derive, FlightSimulation, type AerodynamicSurface } from '../src/physics';
import { airfoilDepthScale, airfoilSkinScale } from '../src/airfoils';
import { beamSection, materialCatalog } from '../src/materials';
import Module from 'manifold-3d';

const manifold = await Module({ locateFile: () => new URL('../node_modules/manifold-3d/manifold.wasm', import.meta.url).href });
manifold.setup();
const geometryTolerance = 1e-4;

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
function separatedDefinitions() {
  const d = definition();
  d.mainWing = { ...wing(4, 0.8, 0.8), airfoil: 'naca0012', controlSurface: 0.3 };
  d.horizontalTail = clone(d.mainWing);
  d.assembly.mainIncidence = d.assembly.tailIncidence = 0;
  // Equal external geometry is not equal mass: main/tail skin densities differ.
  // Match real linear mass with a thicker main spar, keeping outer dimensions.
  const depth = airfoilDepthScale('naca0012'), section = beamSection(d.mainWing.structure, 1, depth);
  const area = section.area + (AIRFRAME_MASS.tailArea - AIRFRAME_MASS.mainArea) * 0.8
    * airfoilSkinScale('naca0012') / materialCatalog[d.mainWing.materialId].density;
  const sum = section.width + section.height;
  d.mainWing.structure.wallThickness = (sum - Math.sqrt(sum * sum - 4 * area)) / (4 * Math.min(1, depth));
  d.assembly.mainWing = 1.8;
  d.assembly.horizontalTail = -1.4;
  d.assembly.verticalTail = -3;
  const swapped = clone(d), mainOrigin = wingOrigin(d, 'mainWing'), tailOrigin = wingOrigin(d, 'horizontalTail');
  // Spar compensation follows each identity's skin density, not its position.
  swapped.mainWing = { ...clone(d.horizontalTail), structure: clone(d.mainWing.structure) };
  swapped.horizontalTail = { ...clone(d.mainWing), structure: clone(d.horizontalTail.structure) };
  swapped.assembly.mainWing = tailOrigin.x;
  swapped.assembly.horizontalTail = mainOrigin.x - 0.4;
  return [d, swapped] as const;
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
function geometryBudget(a: AerodynamicSurface, b: AerodynamicSurface) {
  const chord = Math.min(a.chordMin, b.chordMin), width = a.spanEnd - a.spanStart;
  // Two 0.1 mm contours bound relative angle by 2ε/c and area by 2ε times perimeter.
  const angle = Math.atan2(2 * geometryTolerance, chord);
  const area = 4 * geometryTolerance * (width + Math.max(a.chordMax, b.chordMax));
  const pressure = 0.5 * AIR_DENSITY * Math.max(a.localFlow.lengthSq(), b.localFlow.lengthSq());
  const force = pressure * Math.max(a.area, b.area) * 2 * Math.PI * angle
    + Math.max(a.force.length(), b.force.length()) * area / Math.min(a.area, b.area);
  return { angle, force };
}
function expectEqual(main: AerodynamicSurface, tail: AerodynamicSurface) {
  const budget = geometryBudget(main, tail);
  expect(main.point.distanceTo(tail.point)).toBeLessThan(2 * geometryTolerance);
  expect(Math.abs(main.alpha - tail.alpha)).toBeLessThan(budget.angle);
  expect(main.force.distanceTo(tail.force)).toBeLessThan(budget.force);
  expect(main.drag.distanceTo(tail.drag)).toBeLessThan(budget.force);
  expect(Math.abs(main.inducedDrag - tail.inducedDrag)).toBeLessThan(budget.force);
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

  it('原始设计参考保留深入超过0.1mm的真实翼体遮蔽，不剔除同皮边界', () => {
    const d = definition();
    const coincident = Reflect.get(derive(d).aerodynamics, 'surfaces') as AerodynamicSurface[];
    d.assembly.mainWingHeight = 10 * geometryTolerance;
    const penetrating = Reflect.get(derive(d).aerodynamics, 'surfaces') as AerodynamicSurface[];
    for (const panels of [coincident, penetrating]) {
      for (const main of panels.filter(panel => panel.kind === 'main' && panel.spanStart >= 0.8)) {
        const tail = panels.find(panel => panel.kind === 'tail' && panel.side === main.side && panel.spanStart === main.spanStart)!;
        expect(main.exposedFraction).toBe(1);
        if (panels === coincident) expect(tail.exposedFraction).toBe(main.exposedFraction);
        else {
          expect(tail.exposedFraction).toBeGreaterThan(0);
          expect(tail.exposedFraction).toBeLessThan(main.exposedFraction);
          expect(tail.force.length()).toBeLessThan(main.force.length());
        }
      }
    }
  });

  it.each([0.8, 100])('无交叠翼交换身份在高度 %s m 保留局部来流、地效和极曲线', height => {
    const [d, swapped] = separatedDefinitions();
    for (const alpha of [-8, 0, 6, 30]) {
      const velocity = new Vector3(12 * Math.cos(alpha * DEG), -12 * Math.sin(alpha * DEG), 1.2);
      const before = evaluate(d, velocity, neutral, false, height), after = evaluate(swapped, velocity, neutral, false, height);
      for (const panel of before.surfaces.filter(panel => panel.kind !== 'vertical')) {
        const other = after.surfaces.find(other => other.kind === (panel.kind === 'main' ? 'tail' : 'main')
          && other.side === panel.side && other.spanStart === panel.spanStart)!;
        expectEqual(panel, other);
        expect(panel.groundEffect).toBeCloseTo(other.groundEffect, 12);
      }
    }
  });

  it('同位相交翼只保留一份闭合外露体积，控制指令不驱动被冻结区域', () => {
    const velocity = new Vector3(12, -0.5, 0.3), d = definition();
    const s = evaluate(d, velocity, { ...neutral, aileron: 0.3, elevator: -0.4 }), base = evaluate(d, velocity);
    const wingPanels = s.surfaces.filter(panel => panel.kind !== 'vertical');
    for (const panel of wingPanels) {
      expect(panel.controlEffectiveness).toBe(0); expect(Math.abs(panel.controlCandidate)).toBe(0);
      const other = base.surfaces.find(other => other.wingInstance === panel.wingInstance
        && other.side === panel.side && other.spanStart === panel.spanStart)!;
      expectEqual(panel, other);
    }
    const retained = wingPanels.reduce((area, panel) => area + panel.area * panel.retainedAreaFraction!, 0);
    expect(retained).toBeGreaterThan(0);
    expect(retained).toBeLessThanOrEqual(s.aircraft.wingArea + 4 * geometryTolerance * (s.aircraft.span + d.mainWing.points[3].x));
    const parts = s.compiledGeometry.partitions.filter(part => part.wingInstance === 0 || part.wingInstance === 1);
    expect(parts.length).toBeGreaterThan(0);
    const bodies = parts.map(part => new manifold.Manifold(new manifold.Mesh({
      numProp: 3, vertProperties: part.positions, triVerts: part.indices,
    })));
    try {
      for (const body of bodies) {
        expect(body.status()).toBe('NoError'); expect(body.volume()).toBeGreaterThan(0);
      }
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const intersection = bodies[i].intersect(bodies[j]);
        try { expect(intersection.volume()).toBeLessThan(1e-8); } finally { intersection.delete(); }
      }
    } finally { for (const body of bodies) body.delete(); }
  });

  it.each([false, true])('无交叠对称配置交换身份后保留非零操纵及力矩导数，智能混控%s', smart => {
    const controls = { ...neutral, aileron: 0.3, elevator: -0.4 }, velocity = new Vector3(12, -0.5, 0.3);
    const [d, swapped] = separatedDefinitions(), before = evaluate(d, velocity, controls, smart), after = evaluate(swapped, velocity, controls, smart);
    const base = evaluate(d, velocity, neutral, smart);
    expect(before.aircraft.mass).toBeCloseTo(after.aircraft.mass, 12);
    expect(before.aircraft.cg.distanceTo(after.aircraft.cg)).toBeLessThan(1e-12);
    for (let i = 0; i < 9; i++) expect(before.aircraft.inertiaTensor.elements[i]).toBeCloseTo(after.aircraft.inertiaTensor.elements[i], 12);
    let movable = 0;
    for (const panel of before.surfaces.filter(panel => panel.kind !== 'vertical')) {
      const other = after.surfaces.find(other => other.kind === (panel.kind === 'main' ? 'tail' : 'main')
        && other.side === panel.side && other.spanStart === panel.spanStart)!;
      expectEqual(panel, other);
      const budget = geometryBudget(panel, other);
      expect(Math.abs(panel.controlCandidate - other.controlCandidate)).toBeLessThan(budget.angle / (22 * DEG));
      const arm = Math.max(panel.point.distanceTo(before.aircraft.cg), other.point.distanceTo(after.aircraft.cg)) + panel.chordMax;
      expect(panel.controlMoment.distanceTo(other.controlMoment)).toBeLessThan(budget.force * arm);
      if (panel.controlEffectiveness === 0) {
        expect(panel.controlCandidate).toBe(0);
        continue;
      }
      movable++;
      expect(Math.abs(panel.controlCandidate)).toBeGreaterThan(0);
      expect(Math.abs(panel.controlCandidate * 22 * DEG)).toBeLessThanOrEqual(22 * DEG);
      if (smart) expect(panel.controlMoment.length()).toBeGreaterThan(0);
      const neutralPanel = base.surfaces.find(other => other.kind === panel.kind && other.side === panel.side && other.spanStart === panel.spanStart)!;
      expect(panel.force.distanceTo(neutralPanel.force)).toBeGreaterThan(0.01);
    }
    expect(movable).toBeGreaterThan(0);
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
