import { test, expect } from '@playwright/test';
import type * as SceneModule from '../src/scene';
import type * as PhysicsModule from '../src/physics';
import type * as ModelModule from '../src/model';
import { writeFile } from 'node:fs/promises';

test('T-tail combined fragments render both wings, split again and restore their shared GPU buffers', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const scenePath = '/src/scene.ts', physicsPath = '/src/physics.ts', modelPath = '/src/model.ts';
    const { SceneView } = await import(scenePath) as typeof SceneModule;
    const { FlightSimulation } = await import(physicsPath) as typeof PhysicsModule;
    const { clone, defaultAircraft, wing } = await import(modelPath) as typeof ModelModule;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999';
    document.body.appendChild(host);
    const view = new SceneView(host), definition = clone(defaultAircraft);
    definition.assembly.tailOnFin = true;
    definition.verticalTail = wing(3, 0.8, 0.4, 0.2);
    definition.horizontalTail = wing(4, 0.8, 0.6);
    view.setQuality('Low'); view.updateAircraft(definition);
    const internals = view as any;
    const gl = internals.renderer.getContext() as WebGLRenderingContext;
    const pixels = () => {
      view.render(0, 1);
      const image = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, image);
      return image;
    };
    const differences = (a: Uint8Array, b: Uint8Array) => a.reduce((count, value, i) => count + Number(value !== b[i]), 0);
    const simulation = () => {
      const sim = new FlightSimulation(definition, 'birdman', 0);
      sim.launching = false; sim.position.set(100, 100, 0); sim.quaternion.identity(); sim.omega.set(0, 0, 0);
      return sim;
    };
    try {
      const sim = simulation(); view.setFlight(sim); view.cameraView('top');
      const intact = pixels();
      const fin = sim.structure.sections.find(section => section.wingKey === 'verticalTail')!;
      fin.stressRatio = 2; (sim as any).commitFractures(sim);
      pixels();
      const combined = view.getDiagnostics().structureRendering.fragments;
      const firstBody = sim.fragments[0];
      view.captureFlightState(); firstBody.position.z += 4;
      firstBody.quaternion.setFromAxisAngle(firstBody.velocity.clone().set(1, 0, 0), 0.3);
      view.render(0, 1);
      const moved = view.getDiagnostics().structureRendering.fragments;
      const tail = sim.structure.sections.find(section => section.wingKey === 'horizontalTail' && section.side === 1)!;
      tail.stressRatio = 2; (sim as any).commitFractures(firstBody);
      pixels();
      const split = view.getDiagnostics().structureRendering.fragments;
      const secondBody = sim.fragments.find(body => body.id === tail.bodyId)!;
      view.captureFlightState(); secondBody.position.z -= 3;
      const broken = pixels(), separated = view.getDiagnostics().structureRendering.fragments;
      // Remove the last horizontal strip from the original combined body. Its
      // old mesh is disposed while both new tail meshes share the source data.
      const otherTail = sim.structure.sections.find(section => section.wingKey === 'horizontalTail' && section.side === -1)!;
      otherTail.stressRatio = 2; (sim as any).commitFractures(firstBody);
      pixels();
      const fullySplit = view.getDiagnostics().structureRendering.fragments;
      const screenshot = internals.renderer.domElement.toDataURL('image/png') as string;
      const gpuBuffersValid = internals.wingMeshes.every((mesh: any) => mesh.geometry.getAttribute('position').count > 0 && mesh.geometry.getAttribute('position').array.every(Number.isFinite));
      view.setFlight(null); view.updateAircraft(definition);
      const designFragments = view.getDiagnostics().structureRendering.fragments.length;
      view.setFlight(simulation()); view.cameraView('top');
      const restored = pixels();
      return { combined, moved, split, separated, fullySplit, screenshot, gpuBuffersValid, designFragments,
        brokenDifferences: differences(intact, broken), restoredDifferences: differences(intact, restored),
        graphicsError: gl.getError(), noError: gl.NO_ERROR };
    } finally { view.dispose(); host.remove(); }
  });
  expect(result.combined.map(fragment => fragment.wingIndex).sort()).toEqual([1, 2]);
  expect(new Set(result.combined.map(fragment => fragment.id)).size).toBe(1);
  expect(result.combined.every(fragment => fragment.triangles > 0)).toBe(true);
  expect(result.moved[0].position).toEqual(result.moved[1].position);
  expect(result.moved[0].quaternion).toEqual(result.moved[1].quaternion);
  expect(result.moved[0].position).not.toEqual(result.combined[0].position);
  expect(result.split).toHaveLength(3);
  expect(new Set(result.split.map(fragment => fragment.id)).size).toBe(2);
  expect(result.separated.every(fragment => fragment.triangles > 0)).toBe(true);
  expect(new Set(result.separated.map(fragment => fragment.position.z)).size).toBe(2);
  expect(result.fullySplit).toHaveLength(3);
  expect(new Set(result.fullySplit.map(fragment => fragment.id)).size).toBe(3);
  expect(result.fullySplit.every(fragment => fragment.triangles > 0)).toBe(true);
  expect(result.fullySplit.filter(fragment => fragment.id === result.combined[0].id).map(fragment => fragment.wingIndex)).toEqual([2]);
  expect(result.gpuBuffersValid).toBe(true);
  expect(result.designFragments).toBe(0);
  expect(result.brokenDifferences).toBeGreaterThan(0);
  expect(result.restoredDifferences).toBe(0);
  expect(result.graphicsError).toBe(result.noError);
  expect(errors).toEqual([]);
  await writeFile(testInfo.outputPath('separated-t-tail.png'), Buffer.from(result.screenshot.split(',')[1], 'base64'));
});
