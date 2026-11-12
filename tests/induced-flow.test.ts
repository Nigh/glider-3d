import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { clone, defaultAircraft, wing, type AircraftDefinition } from '../src/model';
import { coefficients, FlightSimulation, SECTION_QUARTER_CHORD_CM } from '../src/physics';

function definition() {
  const d = clone(defaultAircraft);
  d.birdman = false; d.engine.count = 0; d.fuelTank.capacity = 0;
  d.assembly.tailOnFin = false;
  d.mainWing = wing(8, 1, 0.8); d.horizontalTail = wing(3, 0.7, 0.5);
  d.mainWing.dihedral = d.horizontalTail.dihedral = 0;
  d.mainWing.controlSurface = 0.3;
  d.assembly.mainWing = 1; d.assembly.mainWingHeight = 0;
  d.assembly.mainIncidence = d.assembly.tailIncidence = 0;
  d.assembly.horizontalTail = -1.5;
  return d;
}
function sample(d: AircraftDefinition, height = 100, isolated = false) {
  const s = new FlightSimulation(d, 'test-space', 0, { height: 100, speed: 20, catapult: false });
  s.structure.reset(); s.launching = false; s.position.set(100, height, 0); s.quaternion.identity();
  s.velocity.set(20, -1, 0); s.omega.set(0, 0, 0);
  if (isolated) for (const surface of s.surfaces) if (surface.kind !== 'main') surface.bodyId = 1;
  Reflect.get(s, 'evaluateForces').call(s, { weight: 0, elevator: 0, aileron: 0, rudder: 0 }, s.velocity, s.omega, s.quaternion, s.position);
  return s;
}
function tailAlpha(s: FlightSimulation) {
  const panels = s.surfaces.filter(surface => surface.kind === 'tail');
  return panels.reduce((sum, surface) => sum + surface.alpha * surface.area, 0) / panels.reduce((sum, surface) => sum + surface.area, 0);
}

describe('载荷与几何尾迹', () => {
  it('后置翼感受更强下洗，抬高前翼或减小其载荷会改变尾翼有效迎角', () => {
    const base = definition(), ahead = clone(base), raised = clone(base), loaded = clone(base);
    ahead.assembly.horizontalTail = 1.5;
    raised.assembly.mainWingHeight = 1;
    loaded.assembly.mainIncidence = 8;
    const aft = sample(base), front = sample(ahead), elevated = sample(raised), highLoad = sample(loaded);
    expect(tailAlpha(aft)).toBeLessThan(tailAlpha(front));
    expect(tailAlpha(elevated)).toBeGreaterThan(tailAlpha(aft));
    expect(tailAlpha(highLoad)).toBeLessThan(tailAlpha(aft));
  });
  it('几何推导Cm是负俯仰力偶，分离/对称截面淡出，有限弦压力偶不造能', () => {
    expect(SECTION_QUARTER_CHORD_CM).toBeGreaterThan(-0.2);
    expect(SECTION_QUARTER_CHORD_CM).toBeLessThan(-0.05);
    expect(coefficients(0, 8).cm).toBe(SECTION_QUARTER_CHORD_CM);
    expect(Math.abs(coefficients(Math.PI / 2, 8).cm)).toBe(0);
    expect(coefficients(0, 8, 500_000, false).cm).toBe(0);
    const s = sample(definition());
    s.omega.set(0.2, -0.1, 0.4);
    Reflect.get(s, 'evaluateForces').call(s, {}, s.velocity, s.omega, s.quaternion, s.position);
    for (const surface of s.surfaces) {
      const power = surface.force.clone().sub(surface.drag).dot(surface.localFlow) + surface.moment.dot(s.omega);
      expect(Math.abs(power)).toBeLessThan(1e-8);
      if (surface.kind !== 'vertical') expect(surface.moment.z).toBeLessThan(0);
    }
  });

  it('截面自由力偶沿真实连接传递，预测与提交使用相同应力', () => {
    const s = sample(definition()), zero = new Vector3();
    for (const surface of s.surfaces) { surface.force.set(0, 0, 0); surface.moment.set(0, 0, 0); }
    const tip = s.structure.sections.filter(section => section.wingKey === 'horizontalTail' && section.side > 0).at(-1)!;
    tip.surface.moment.set(0, 0, -20);
    const predicted = s.structure.predictStress(s, zero, zero);
    const measured = s.structure.measureLoads(s, zero, zero);
    expect(predicted).toBeCloseTo(measured, 12); expect(measured).toBeGreaterThan(0);
    let section: typeof tip | undefined = tip;
    while (section) {
      expect(section.moment.z).toBeCloseTo(-20, 10);
      section = section.parentId === null ? undefined : s.structure.sections[section.parentId];
    }
  });


  it('同一完整翼不重复求自身尾流，近地有限翼损失降低而产生增升', () => {
    const high = sample(definition(), 100, true), low = sample(definition(), 0.7, true);
    let highLift = 0, lowLift = 0, highDrag = 0, lowDrag = 0;
    for (let i = 0; i < high.surfaces.length; i++) {
      const a = high.surfaces[i], b = low.surfaces[i];
      if (a.kind !== 'main') continue;
      expect(a.inducedFlow.length()).toBe(0); expect(b.inducedFlow.length()).toBe(0);
      highLift += a.force.y - a.drag.y; lowLift += b.force.y - b.drag.y;
      highDrag += a.inducedDrag; lowDrag += b.inducedDrag;
    }
    expect(lowLift).toBeGreaterThan(highLift); expect(lowDrag).toBeLessThan(highDrag);
  });

  it('耦合后的升力仍不做局部功，阻力只耗能，断片不残留主体尾流', () => {
    const s = sample(definition());
    for (const surface of s.surfaces) {
      const force = surface.force.clone().sub(surface.drag);
      expect(Math.abs(force.dot(surface.localFlow) + surface.moment.dot(surface.localOmega))).toBeLessThan(1e-8);
      expect(surface.drag.dot(surface.localFlow)).toBeLessThanOrEqual(0);
    }
    expect(s.telemetry.aeroPower).toBeLessThan(0);
    const before = s.surfaces.map(surface => surface.inducedFlow.clone());
    for (const surface of s.surfaces) if (surface.kind === 'tail') surface.bodyId = 1;
    Reflect.get(s, 'evaluateForces').call(s, {}, s.velocity, s.omega, s.quaternion, s.position);
    expect(s.surfaces.some((surface, i) => surface.kind === 'main' && surface.inducedFlow.distanceTo(before[i]) > 1e-6)).toBe(true);
    // The attached fin still receives the main wing's wake. Detaching the
    // horizontal tail removes only that source, not all cross-wing flow.
    expect(s.surfaces.some(surface => surface.kind === 'vertical' && surface.inducedFlow.length() > 1e-6)).toBe(true);
    const detached = s.surfaces.map(surface => surface.inducedFlow.clone());
    for (const surface of s.surfaces) if (surface.bodyId === 1) surface.circulation = surface.nextCirculation = 1e6;
    Reflect.get(s, 'evaluateForces').call(s, {}, s.velocity, s.omega, s.quaternion, s.position);
    for (let i = 0; i < s.surfaces.length; i++) {
      if (s.surfaces[i].bodyId === 0) expect(s.surfaces[i].inducedFlow.distanceTo(detached[i])).toBeLessThan(1e-12);
    }
  });

  it.each([
    { name: '附着流', incidence: 0, omega: new Vector3() },
    { name: '分离过渡与旋转压力偶', incidence: 18, omega: new Vector3(0.2, -0.1, 0.4) },
  ])('智能混控的力矩导数包含被动翼载荷反馈：$name', ({ incidence, omega }) => {
    const d = definition();
    d.assembly.mainIncidence = incidence;
    d.horizontalTail.controlSurface = d.verticalTail.controlSurface = 0.3;
    const s = sample(d);
    s.omega.copy(omega);
    for (const surface of s.surfaces) surface.controlCommand = 0.05 * surface.side;
    Reflect.get(s, 'effective').smartMixing = true;
    Reflect.get(s, 'updateControlDirections').call(s);
    const sources = (['main', 'tail', 'vertical'] as const).map(kind =>
      s.surfaces.find(surface => surface.kind === kind && surface.controlEffectiveness > 0));
    const predicted = sources.map(source => source?.controlMoment.clone()), delta = 0.0001;
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (!source) throw Error('测试翼面缺少舵面');
      // Perturb one physical actuator; every passive receiving wing stays coupled.
      const center = source.controlCommand;
      source.controlCommand = center - delta;
      Reflect.get(s, 'evaluateForces').call(s, {}, s.velocity, s.omega, s.quaternion, s.position);
      const low = s.telemetry.torque.clone();
      source.controlCommand = center + delta;
      Reflect.get(s, 'evaluateForces').call(s, {}, s.velocity, s.omega, s.quaternion, s.position);
      const measured = s.telemetry.torque.clone().sub(low).multiplyScalar(1 / (2 * delta));
      source.controlCommand = center;
      expect(predicted[i]!.distanceTo(measured) / Math.max(1, measured.length())).toBeLessThan(0.05);
    }
  });
});
