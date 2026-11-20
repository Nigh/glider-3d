import { expect, it } from 'vitest';
import { Color, Quaternion, Vector3 } from 'three';
import { clone, presets } from '../src/model';
import { FlightSimulation } from '../src/physics';
import { readFileSync } from 'node:fs';
import { importReplay, replayFilename } from '../src/replay';
import { stickPosition } from '../src/stick';
import { structureLoadColor } from '../src/structure-display';
import { SceneView } from '../src/scene';
import { BufferAttribute, BufferGeometry, Mesh } from 'three';

it('names replay downloads using the local date and score without decimal dots', () => {
 expect(replayFilename('高山速降', 123.45, new Date(2026, 10, 16))).toBe('replay-高山速降-123_45-20261116.json');
 expect(replayFilename('低空挑战', '未完赛', new Date(2026, 0, 2))).toBe('replay-低空挑战-未完赛-20260102.json');
});

it('keeps the stick marker at the pointer while applying dead zone only to controls', () => {
 expect(stickPosition(0.03, 0)).toEqual({ x: 0.03, y: 0, roll: 0, pitch: 0 });
 const active = stickPosition(0.3, 0.4);
 expect(active.x).toBe(0.3); expect(active.y).toBe(0.4);
 expect(Math.hypot(active.roll, active.pitch)).toBeCloseTo(0.45 / 0.95);
 const outside=stickPosition(3,4);expect(outside.x).toBe(0.6);expect(outside.y).toBe(0.8);expect(outside.roll).toBeCloseTo(0.6);expect(outside.pitch).toBe(0.8);
});

it('colors the loaded skin and caps, and restores original colors after unloading or switching off', () => {
 const geometry = new BufferGeometry(), original = new Float32Array(128 * 3).fill(0.2);
 geometry.setAttribute('color', new BufferAttribute(original.slice(), 3));
 const section = { rows: 1, vertexStart: 0, rootCap: 64, tipCap: 96, physics: { stressRatio: 0.75 } };
 const view = Object.assign(Object.create(SceneView.prototype), {
  wingMeshes: [new Mesh(geometry)], wingOriginalColors: [original], wingSections: [[section]], structureColor: new Color(), fragments: [],
 });
 view.setStructureLayer(true);
 const orange = new Color(structureLoadColor(0.75)), colors = geometry.getAttribute('color');
 for (const vertex of [0, 63, 64, 95, 96, 127]) expect(colors.getX(vertex)).toBeCloseTo(orange.r);
 expect(structureLoadColor(0.50001)).toBe(0xeac127);
 expect(structureLoadColor(1)).toBe(0xc9302b); expect(structureLoadColor(2)).toBe(0xc9302b);
 section.physics.stressRatio = 0.2; view.updateStructureColors(); expect(colors.array).toEqual(original);
 section.physics.stressRatio = 0.9; view.updateStructureColors(); view.setStructureLayer(false); expect(colors.array).toEqual(original);
});

const neutral = { weight: 0, lateral: 0, elevator: 0, aileron: 0, rudder: 0 };
function flight() {
 const definition = clone(presets.find(p => p.name === '基础单发型')!);
 definition.engine.count = 0; definition.fuelTank.capacity = 0;
 const sim = new FlightSimulation(definition, 'test-space', 0, { height: 2000, catapult: false, speed: 20 });
 sim.launching = false;
 return sim;
}
it.each([-0.3, 0.3])('updates equilibrium trim with active stick %s while preserving pilot pitch response', stick => {
 const sim = flight();
 for (let i = 0; i < 90; i++) {
  sim.position.set(100, 2000, 0); sim.quaternion.identity(); sim.velocity.set(20, -0.4, 0); sim.omega.set(0, 0, 0);
  sim.step({ ...neutral, autoTrim: true, trimPitch: 0.7, elevator: stick });
 }
 expect(Math.abs(sim.telemetry.trimPitch - 0.7)).toBeGreaterThan(0.1);
 const trimmed = flight(), baseline = flight();
 for (const [model, command] of [[trimmed, stick], [baseline, 0]] as const) {
  for (let frame = 0; frame < 60; frame++) {
   model.position.set(100, 2000, 0); model.quaternion.identity(); model.velocity.set(20, -0.4, 0); model.omega.set(0, 0, 0);
   model.step({ ...neutral, autoTrim: true, trimPitch: sim.telemetry.trimPitch, elevator: command });
  }
 }
 expect((trimmed.omega.z - baseline.omega.z) * stick).toBeLessThan(0);
});

it('scales each surface using chord/normal dynamic pressure including local angular velocity', () => {
 const sim = flight() as any, input = { ...neutral, elevator: 0.3, aileron: 0.2, rudder: 0.4 };
 sim.effective.adaptiveControls = true;
 const orientation = new Quaternion(), velocity = new Vector3(20, 0, 0), omega = new Vector3();
 sim.mixControls(input, velocity, omega, orientation);
 const reference = sim.surfaces.map((s: any) => s.controlCandidate);
 sim.mixControls(input, velocity.clone().multiplyScalar(1.5), omega, orientation);
 expect(sim.surfaces.map((s: { controlCandidate: number }) => s.controlCandidate)).toEqual(reference);
 sim.mixControls(input, velocity.clone().multiplyScalar(2), omega, orientation);
 sim.surfaces.forEach((s: any, i: number) => {
  const local = new Vector3(40, 0, 0), q = local.dot(s.chordDirection) ** 2 + local.dot(s.normal) ** 2;
  expect(s.controlCandidate).toBeCloseTo(reference[i] * Math.min(1, 900 / q), 8);
 });
 omega.set(0, 2, 1); sim.mixControls(input, velocity, omega, orientation);
 sim.surfaces.forEach((s: any, i: number) => {
  const local = s.point.clone().sub(sim.cg).crossVectors(omega, s.point.clone().sub(sim.cg)).add(velocity);
  const q = local.dot(s.chordDirection) ** 2 + local.dot(s.normal) ** 2;
  expect(s.controlCandidate).toBeCloseTo(reference[i] * Math.min(1, 900 / Math.max(900, q)), 8);
 });
 sim.effective.adaptiveControls = false; sim.mixControls(input, new Vector3(80, 0, 0), omega, orientation);
 expect(sim.surfaces.map((s: any) => s.controlCandidate)).toEqual(reference);
});

it('rejects previous-physics replays in normal and ghost imports', async () => {
 const old = JSON.parse(readFileSync(new URL('./fixtures/pr60-compatible-replay.json', import.meta.url), 'utf8'));
 old.physicsVersion = 'surface-pressure-v25';
 for (const purpose of ['replay','ghost'] as const) await expect(importReplay(JSON.stringify(old), purpose)).rejects.toThrow('物理版本');
});
