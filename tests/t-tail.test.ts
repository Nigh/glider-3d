import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { clone, defaultAircraft, wing } from '../src/model';
import { captureReplayKeyframe, restoreReplayKeyframe, FlightSimulation, GRAVITY } from '../src/physics';
import { rotationalEnergy, type StructuralBody } from '../src/structure';

const neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0 };
function fixture(sign = 1, mounted = true) {
 const d = clone(defaultAircraft); d.assembly.tailOnFin = mounted;
 d.verticalTail = wing(sign > 0 ? 3 : 0.5, 0.8, 0.4, 0.2);
 d.verticalTail.points[1].y *= sign; d.verticalTail.points[2].y *= sign;
 d.horizontalTail = wing(4, 0.8, 0.6);
 const sim = new FlightSimulation(d, 'birdman', 0);
 sim.launching = false; sim.position.set(100, 100, 0); sim.quaternion.identity(); sim.omega.set(0, 0, 0);
 sim.structure.reset();
 return sim;
}
function energy(body: StructuralBody) {
 return body.mass * (GRAVITY * body.position.y + body.velocity.lengthSq() / 2) + rotationalEnergy(body.inertiaTensor, body.omega);
}

it.each([1, -1])('transmits a mounted horizontal-tail contact through every supporting fin joint (%s)', sign => {
 const sim = fixture(sign), sections = sim.structure.sections;
 const hit = sections.find(s => s.wingKey === 'horizontalTail' && s.side === 1)!;
 const force = new Vector3(60, 30, 40), point = hit.referenceTip.clone().add(new Vector3(0.2, 0, 0));
 const support = new Vector3(0, sim.mass * GRAVITY, 0), torque = new Vector3();
 const loads = sections.map(() => ({ force: new Vector3(), moment: new Vector3() }));
 for (const s of sections) s.surface.force.set(0, 0, 0);
 sim.structure.update(sim, support, torque);
 const baseline = sections.map(s => s.moment.clone()), roots = sections.map(s => s.root.position.clone());
 // Preserve geometry for the load comparison, then test the resulting mount motion separately.
 sim.structure.reset();
 loads[hit.id].force.copy(force); loads[hit.id].moment.crossVectors(point, force);
 sim.structure.update(sim, support, torque, loads);
 for (const s of sections.filter(s => s.wingKey === 'verticalTail')) {
  const expected = new Vector3().crossVectors(point.clone().sub(s.referenceRoot), force);
  expect(s.moment.clone().sub(baseline[s.id]).distanceTo(expected)).toBeLessThan(1e-8);
 }
 const fin = sections.filter(s => s.wingKey === 'verticalTail').at(-1)!;
 expect(fin.tip.quaternion.angleTo(fin.baseTipRotation)).toBeGreaterThan(1e-5);
 const rotation = fin.baseTipRotation.clone().invert().premultiply(fin.tip.quaternion);
 for (const root of sections.filter(s => s.wingKey === 'horizontalTail' && s.spanStart === 0)) {
  const expected = root.baseRoot.clone().sub(fin.baseTip).applyQuaternion(rotation).add(fin.tip.position);
  expect(root.root.position.distanceTo(expected)).toBeLessThan(1e-10);
  expect(root.root.quaternion.angleTo(rotation.clone().multiply(root.baseRootRotation))).toBeLessThan(1e-7);
  expect(root.root.position.distanceTo(roots[root.id])).toBeGreaterThan(1e-5);
 }
});

it.each([true, false])('fin fracture preserves the actual tail support and rigid-body conservation (mounted=%s)', mounted => {
 const sim = fixture(1, mounted), sections = sim.structure.sections;
 sim.velocity.set(18, -2, 1); sim.omega.set(0.3, 0.2, -0.1);
 const mass = sim.mass, initial = energy(sim), momentum = sim.velocity.clone().multiplyScalar(mass);
 const world = sections.map(s => s.root.position.clone().sub(sim.cg).applyQuaternion(sim.quaternion).add(sim.position));
 const boundary = sections.filter(s => s.wingKey === 'verticalTail')[1];
 boundary.stressRatio = 2; boundary.fractureDamage = 1;
 (sim as any).commitFractures(sim);
 const fragment = sim.fragments.find(f => f.id === boundary.bodyId)!;
 expect(fragment).toBeDefined(); expect(fragment.id).not.toBe(0);
 const tails = sections.filter(s => s.wingKey === 'horizontalTail');
 expect(tails.every(s => s.bodyId === (mounted ? fragment.id : 0))).toBe(true);
 expect(mass).toBeCloseTo(sim.mass + fragment.mass, 10);
 expect(energy(sim) + energy(fragment)).toBeCloseTo(initial, 7);
 expect(sim.velocity.clone().multiplyScalar(sim.mass).addScaledVector(fragment.velocity, fragment.mass).distanceTo(momentum)).toBeLessThan(1e-10);
 for (const s of sections) {
  const body = s.bodyId ? fragment : sim;
  expect(s.root.position.clone().sub(body.cg).applyQuaternion(body.quaternion).add(body.position).distanceTo(world[s.id])).toBeLessThan(1e-10);
 }
 if (mounted) {
  // Horizontal roots remain real joints while their fin support is a fragment.
  tails[0].stressRatio = 2; tails[0].fractureDamage = 1;
  expect(sim.structure.fractureCandidates(fragment.id)).toContain(tails[0]);
  (sim as any).commitFractures(fragment);
  expect(tails[0].bodyId).not.toBe(fragment.id);
 }
 const copy = sim.checkpoint();
 for (const body of [copy, ...copy.fragments]) expect(copy.structure.sectionsForBody(body.id)).toEqual(copy.structure.sections.filter(s => s.bodyId === body.id));
 copy.reset(); expect(copy.structure.sectionsForBody(0)).toHaveLength(sections.length);
 expect(copy.structure.sections.every(s => s.bodyId === 0)).toBe(true);
});

it('a combined fin/tail fragment collides using its tail envelope and restores deterministically', () => {
 const sim = fixture();
 const fin = sim.structure.sections.find(s => s.wingKey === 'verticalTail')!; fin.stressRatio = 2; fin.fractureDamage = 1;
 (sim as any).commitFractures(sim); (sim as any).syncContacts();
 const copy = sim.checkpoint();
 for (const s of [sim, copy]) {
  const fragment = s.fragments[0];
  // Invert the assembly: the T-tail, rather than the fin root, reaches water first.
  fragment.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI - 0.7);
  const tail = s.structure.sections.find(section => section.wingKey === 'horizontalTail' && section.side === 1 && section.bodyId === fragment.id)!;
  const p = tail.tip.position.clone().sub(fragment.cg).applyQuaternion(fragment.quaternion);
  fragment.position.set(100, -p.y - 0.2, 0);
  for (const fin of s.structure.sectionsForBody(fragment.id).filter(section => section.wingKey === 'verticalTail')) {
   for (const index of (s as any).sectionContacts[fin.id] as number[]) expect((s as any).contacts[index].clone().sub(fragment.cg).applyQuaternion(fragment.quaternion).add(fragment.position).y).toBeGreaterThan(0);
  }
  expect((s as any).fragmentCollision(fragment, fragment.position, fragment.quaternion)).toBe(true);
  s.step(neutral, 1e-4);
  expect(fragment.landed).toBe(true); expect(s.ended).toBe(false);
 }
 expect(copy.fragments[0].position.toArray()).toEqual(sim.fragments[0].position.toArray());
 expect(copy.structure.sections.map(s => s.bodyId)).toEqual(sim.structure.sections.map(s => s.bodyId));
 const recording = sim.getRecording();
 const replay = restoreReplayKeyframe(sim.definition, 'birdman', recording, captureReplayKeyframe(sim, recording));
 expect(replay.structure.sections.map(s => s.bodyId)).toEqual(sim.structure.sections.map(s => s.bodyId));
 expect(replay.fragments[0].position.toArray()).toEqual(sim.fragments[0].position.toArray());
 expect(replay.fragments[0].landed).toBe(true);
 for (const body of [replay, ...replay.fragments]) expect(replay.structure.sectionsForBody(body.id)).toEqual(replay.structure.sections.filter(s => s.bodyId === body.id));
 const corrupted = sim.checkpoint();
 (corrupted.structure as any).owned[1].push(corrupted.structure.sections[0]);
 expect(() => restoreReplayKeyframe(sim.definition, 'birdman', recording, captureReplayKeyframe(corrupted, recording))).toThrow('回放关键帧状态无效');
 const cycle = sim.checkpoint();
 const section = cycle.structure.sections.find(section => section.parentId !== null)!;
 section.parentId = section.id;
 expect(() => restoreReplayKeyframe(sim.definition, 'birdman', recording, captureReplayKeyframe(cycle, recording))).toThrow('回放关键帧状态无效');
 for (const frozen of [false, true]) {
  const folded = sim.checkpoint(), fin = folded.structure.sections.find(s => s.wingKey === 'verticalTail')!;
  const rotation = frozen ? fin.baseTipRotation : fin.tip.quaternion;
  rotation.setFromAxisAngle(new Vector3(1, 0, 0), 0.251);
  expect(() => restoreReplayKeyframe(sim.definition, 'birdman', recording, captureReplayKeyframe(folded, recording))).toThrow('回放关键帧状态无效');
 }
});
