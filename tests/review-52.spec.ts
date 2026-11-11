import { test, expect } from '@playwright/test';
import type * as SceneModule from '../src/scene';
import type * as PhysicsModule from '../src/physics';
import type * as ModelModule from '../src/model';
import type * as PlaybackModule from '../src/playback';
import type * as ReplayModule from '../src/replay';
import type * as StorageModule from '../src/storage';
import type * as ChallengesModule from '../src/challenges';
import { writeFile } from 'node:fs/promises';
import type { StructuralBody, WingFragment } from '../src/structure';
import type { WebGLRenderer } from 'three';

interface ContactRenderingReport {
  missingSections: number[];
  maxNodeError: number;
  maxWorldError: number;
  expectedFragments: string[];
  actualFragments: string[];
  fragmentTransformsMatch: boolean;
  renderedSections: number;
  physicalSections: number;
  finite: boolean;
  maxSeamGap: number;
  maxNormalError: number;
  trianglesValid: boolean;
  rotationBudgetValid: boolean;
  physicalUnchanged: boolean;
  graphicsError: number;
  nonBlank: boolean;
}

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
      // Exercise mesh lifetime directly, without waiting for overload accumulation.
      const fracture = sim as unknown as { commitFractures(body: StructuralBody): WingFragment | undefined };
      const fin = sim.structure.sections.find(section => section.wingKey === 'verticalTail')!;
      fin.stressRatio = 2; fin.fractureDamage = 1; fracture.commitFractures(sim);
      pixels();
      const combined = view.getDiagnostics().structureRendering.fragments;
      const firstBody = sim.fragments[0];
      view.captureFlightState(); firstBody.position.z += 4;
      firstBody.quaternion.setFromAxisAngle(firstBody.velocity.clone().set(1, 0, 0), 0.3);
      view.render(0, 1);
      const moved = view.getDiagnostics().structureRendering.fragments;
      const tail = sim.structure.sections.find(section => section.wingKey === 'horizontalTail' && section.side === 1)!;
      tail.stressRatio = 2; tail.fractureDamage = 1; fracture.commitFractures(firstBody);
      pixels();
      const split = view.getDiagnostics().structureRendering.fragments;
      const secondBody = sim.fragments.find(body => body.id === tail.bodyId)!;
      view.captureFlightState(); secondBody.position.z -= 3;
      const broken = pixels(), separated = view.getDiagnostics().structureRendering.fragments;
      // Remove the last horizontal strip from the original combined body. Its
      // old mesh is disposed while both new tail meshes share the source data.
      const otherTail = sim.structure.sections.find(section => section.wingKey === 'horizontalTail' && section.side === -1)!;
      otherTail.stressRatio = 2; otherTail.fractureDamage = 1; fracture.commitFractures(firstBody);
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

for (const scenario of [
  { name: 'shallow-bank-breakup', bank: 0.08, strong: false },
  { name: 'banked-breakup', bank: 0.4, strong: false },
  { name: 'intact-supported-wing', bank: 0.08, strong: true },
]) {
  test(`real long-wing contact renders bounded nodes and replays both ways: ${scenario.name}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/');
    const result = await page.evaluate(async scenario => {
      // Vite must load browser modules inside page.evaluate; Node imports cannot cross this boundary.
      const scenePath = '/src/scene.ts', physicsPath = '/src/physics.ts', modelPath = '/src/model.ts';
      const playbackPath = '/src/playback.ts', replayPath = '/src/replay.ts', storagePath = '/src/storage.ts', challengesPath = '/src/challenges.ts';
      const { SceneView } = await import(scenePath) as typeof SceneModule;
      const { FlightSimulation, captureReplayKeyframe, restoreReplayKeyframe } = await import(physicsPath) as typeof PhysicsModule;
      const { clone, presets, wing } = await import(modelPath) as typeof ModelModule;
      const { seekReplay } = await import(playbackPath) as typeof PlaybackModule;
      const { exportReplay, importReplay } = await import(replayPath) as typeof ReplayModule;
      const { PHYSICS_VERSION, readBest, writeBest } = await import(storagePath) as typeof StorageModule;
      const { challengeTerrainHeight } = await import(challengesPath) as typeof ChallengesModule;
      const definition = clone(presets.find(preset => preset.name === '基础单发型')!);
      definition.mainWing = { ...definition.mainWing, ...wing(24, 1.5, 1) };
      definition.mainWing.materialAmount = 2;
      if (scenario.strong) definition.mainWing.structure = { width: 0.15, height: 0.3, wallThickness: 0.005 };
      const sim = new FlightSimulation(definition, 'low-altitude', 0);
      sim.launching = false; sim.structure.reset();
      sim.quaternion.setFromAxisAngle(sim.position.clone().set(1, 0, 0), scenario.bank);
      sim.position.set(50, 0, 100); sim.velocity.set(8, -0.3, 0);
      let height = -Infinity;
      for (const point of sim.contacts) {
        const world = point.clone().sub(sim.cg).applyQuaternion(sim.quaternion).add(sim.position);
        height = Math.max(height, challengeTerrainHeight('low-altitude', world.x, world.z) - world.y);
      }
      sim.position.y = height + 1e-6;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999';
      document.body.appendChild(host);
      const view = new SceneView(host);
      // Inspect the existing private renderer without adding a production test API.
      const internals = view as unknown as { renderer: WebGLRenderer };
      const renderer = internals.renderer;
      const gl = renderer.getContext() as WebGLRenderingContext;
      const neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0, throttle: 0 };
      const state = (body: PhysicsModule.FlightSimulation) => JSON.stringify({
        time: body.elapsedTime, fractures: body.structure.fractureCount,
        position: body.position.toArray(), velocity: body.velocity.toArray(),
        quaternion: body.quaternion.toArray(), omega: body.omega.toArray(),
        cg: body.cg.toArray(), mass: body.mass, inertia: body.inertiaTensor.toArray(),
        energy: body.telemetry.energy, dissipated: body.telemetry.dissipatedEnergy,
        peaks: body.structure.peakWings,
        sections: body.structure.sections.map(section => ({
          id: section.id, parentId: section.parentId, bodyId: section.bodyId,
          load: section.load.toArray(), moment: section.moment.toArray(), stress: section.stressRatio, yield: section.yieldRatio,
          fractureDamage: section.fractureDamage,
          root: section.root.position.toArray(), tip: section.tip.position.toArray(),
          rootRotation: section.root.quaternion.toArray(), tipRotation: section.tip.quaternion.toArray(),
          baseRoot: section.baseRoot.toArray(), baseTip: section.baseTip.toArray(),
          baseRootRotation: section.baseRootRotation.toArray(), baseTipRotation: section.baseTipRotation.toArray(),
        })),
        fragments: body.fragments.map(fragment => ({
          id: fragment.id, landed: fragment.landed, mass: fragment.mass, cg: fragment.cg.toArray(),
          inertia: fragment.inertiaTensor.toArray(), position: fragment.position.toArray(), velocity: fragment.velocity.toArray(),
          quaternion: fragment.quaternion.toArray(), omega: fragment.omega.toArray(),
        })),
      });
      const inspect = (body: PhysicsModule.FlightSimulation) => {
        const before = state(body);
        view.render(0, 1);
        const diagnostics = view.getDiagnostics().structureRendering;
        const missingSections: number[] = [];
        let maxNodeError = 0, maxWorldError = 0;
        for (const section of body.structure.sections) {
          const rendered = diagnostics.wings.flatMap(wing => wing.sections).find(rendered => rendered.id === section.id);
          if (!rendered) { missingSections.push(section.id); continue; }
          if (rendered.bodyId !== section.bodyId) missingSections.push(section.id);
          const owner = section.bodyId === 0 ? body : body.fragments.find(fragment => fragment.id === section.bodyId)!;
          for (const endpoint of ['root', 'tip'] as const) {
            const local = section[endpoint].position;
            const renderedLocal = rendered[endpoint];
            maxNodeError = Math.max(maxNodeError, Math.hypot(local.x - renderedLocal.x, local.y - renderedLocal.y, local.z - renderedLocal.z));
            const expected = local.clone().sub(owner.cg).applyQuaternion(owner.quaternion).add(owner.position);
            const actual = endpoint === 'root' ? rendered.rootWorld : rendered.tipWorld;
            maxWorldError = Math.max(maxWorldError, Math.hypot(expected.x - actual.x, expected.y - actual.y, expected.z - actual.z));
          }
        }
        const expectedFragments = [...new Set(body.structure.sections.filter(section => section.bodyId !== 0)
          .map(section => `${section.bodyId}:${section.wingKey === 'mainWing' ? 0 : section.wingKey === 'horizontalTail' ? 1 : 2}`))].sort();
        const actualFragments = diagnostics.fragments.map(fragment => `${fragment.id}:${fragment.wingIndex}`).sort();
        const fragmentTransformsMatch = diagnostics.fragments.every(fragment => {
          const physical = body.fragments.find(body => body.id === fragment.id)!;
          return (['x', 'y', 'z'] as const).every(axis =>
            Math.abs(fragment.position[axis] - physical.position[axis]) < 1e-9
            && Math.abs(fragment.cg[axis] - physical.cg[axis]) < 1e-9
            && Math.abs(fragment.quaternion[axis] - physical.quaternion[axis]) < 1e-9)
            && Math.abs(fragment.quaternion.w - physical.quaternion.w) < 1e-9
            && fragment.landed === physical.landed;
        });
        const image = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, image);
        return {
          missingSections, maxNodeError, maxWorldError, expectedFragments, actualFragments, fragmentTransformsMatch,
          renderedSections: diagnostics.wings.reduce((sum, wing) => sum + wing.sections.length, 0),
          physicalSections: body.structure.sections.length,
          finite: diagnostics.wings.every(wing => wing.finite),
          maxSeamGap: Math.max(...diagnostics.wings.map(wing => wing.maxSeamGap)),
          maxNormalError: Math.max(...diagnostics.wings.map(wing => wing.maxNormalError)),
          trianglesValid: diagnostics.fragments.every(fragment => fragment.triangles > 0),
          rotationBudgetValid: body.structure.rotationBudgetValid(),
          physicalUnchanged: state(body) === before, graphicsError: gl.getError(),
          nonBlank: image.some((value, index) => index % 4 !== 3 && value !== image[index % 4]),
        };
      };
      const screenshots: { name: string; image: string; fractures: number }[] = [];
      const reports: { phase: string; report: ContactRenderingReport }[] = [];
      const capture = (name: string) => {
        reports.push({ phase: name, report: inspect(sim) });
        screenshots.push({ name, image: renderer.domElement.toDataURL('image/png'), fractures: sim.structure.fractureCount });
      };
      // Wrap the existing private seam; preserve its return value for the unloading queue.
      const prototype = FlightSimulation.prototype as unknown as {
        commitFractures(this: PhysicsModule.FlightSimulation, body: StructuralBody): WingFragment | undefined;
      };
      const originalCommit = prototype.commitFractures;
      const events: { frame: number; sectionId: number; stress: number; detached: boolean }[] = [];
      let cancelled = false;
      try {
        view.setQuality('Low'); view.setFlight(sim); view.cameraView('top');
        capture('initial-contact');
        // Observe actual separation boundaries. No fabricated stress, nodes or impulses.
        prototype.commitFractures = function(this: PhysicsModule.FlightSimulation, body: StructuralBody) {
          const candidate = this === sim ? this.structure.fractureCandidates(body.id)[0] : undefined;
          const before = this.structure.fractureCount;
          const sectionId = candidate?.id, stress = candidate?.stressRatio;
          if (candidate && events.length === 0) capture('before-first-fracture');
          const result = originalCommit.call(this, body);
          if (candidate && this.structure.fractureCount > before) {
            events.push({ frame: sim.recordingLength, sectionId: sectionId!, stress: stress!, detached: candidate.bodyId !== body.id });
            if (events.length <= 2) capture(events.length === 1 ? 'after-first-fracture' : 'after-second-fracture');
          }
          return result;
        };
        const seed = sim.getRecording(), states = new Map<number, string>([[0, state(sim)]]);
        const points = [{ ...captureReplayKeyframe(sim, seed), frame: 0 }];
        const frames: { frame: number; fractures: number; report: ContactRenderingReport }[] = [];
        for (let frame = 0; frame < 10 && !sim.ended; frame++) {
          view.captureFlightState(); sim.step(neutral);
          frames.push({ frame: sim.recordingLength, fractures: sim.structure.fractureCount, report: inspect(sim) });
          states.set(sim.recordingLength, state(sim));
          points.push({ ...captureReplayKeyframe(sim, seed), frame: sim.recordingLength });
          if (events.length && !screenshots.some(shot => shot.name === 'after-first-unloading')) capture('after-first-unloading');
        }
        prototype.commitFractures = originalCommit;
        capture('after-unloading');
        const recording = sim.getRecording();
        const firstFrame = frames.find(frame => frame.fractures > 0)?.frame;
        const repeatedFrame = frames.find(frame => frame.fractures > 1)?.frame;
        const beforeFirstFrame = Math.max(0, (firstFrame ?? 1) - 1);
        const selectedFrames = [...new Set([0, beforeFirstFrame, firstFrame, repeatedFrame, recording.length].filter((frame): frame is number => frame !== undefined))];
        recording.keyframes = points.filter(point => selectedFrames.includes(point.frame));
        const replay = { definition, challenge: sim.challenge, recording };
        const imported = await importReplay(await exportReplay(replay));
        const restored = imported.recording.keyframes!.map(point => {
          const body = restoreReplayKeyframe(definition, sim.challenge, imported.recording, point);
          view.setFlight(body); view.cameraView('top');
          return { frame: point.frame, matches: state(body) === states.get(point.frame), report: inspect(body) };
        });
        const continuous = restoreReplayKeyframe(definition, sim.challenge, imported.recording, imported.recording.keyframes![0]);
        const continuousMatches: boolean[] = [];
        view.setFlight(continuous); view.cameraView('top');
        while (!continuous.replayFinished && !continuous.ended) {
          view.captureFlightState(); continuous.step(neutral);
          continuousMatches.push(state(continuous) === states.get(continuous.replayFrame));
          reports.push({ phase: `continuous-${continuous.replayFrame}`, report: inspect(continuous) });
        }
        // A sparse recording also makes seeks advance from keyframes, not only copy cached states.
        const seekFrames = [recording.length, beforeFirstFrame, firstFrame ?? 1, repeatedFrame ?? 1, 0, Math.floor(recording.length / 2), recording.length];
        const seeks = [];
        for (const frame of seekFrames) {
          const body = (await seekReplay(imported, points[frame].time, () => cancelled))!;
          view.setFlight(body); view.cameraView('top');
          seeks.push({ frame, actualFrame: body.replayFrame, matches: state(body) === states.get(frame), report: inspect(body) });
        }
        const envelope = JSON.parse(await exportReplay(replay));
        let oldVersionError = '';
        try { await importReplay(JSON.stringify({ ...envelope, physicsVersion: 'connected-tail-contact-v14' })); }
        catch (error) { oldVersionError = error instanceof Error ? error.message : String(error); }
        const oldKey = 'lakewind.best.connected-tail-contact-v14.birdman', currentKey = `lakewind.best.${PHYSICS_VERSION}.birdman`;
        const previous = [localStorage.getItem(oldKey), localStorage.getItem(currentKey)];
        let oldBest = '', bestBefore = 0, bestAfter = 0;
        try {
          localStorage.setItem(oldKey, '900'); localStorage.removeItem(currentKey);
          bestBefore = readBest(); writeBest(120); bestAfter = readBest(); oldBest = localStorage.getItem(oldKey)!;
        } finally {
          [oldKey, currentKey].forEach((key, index) => {
            if (previous[index] === null) localStorage.removeItem(key); else localStorage.setItem(key, previous[index]!);
          });
        }
        return {
          frames, events, reports, screenshots, restored, continuousMatches, seeks, firstFrame, repeatedFrame,
          recordingLength: recording.length, continuousFrame: continuous.replayFrame,
          oldVersionError, oldBest, bestBefore, bestAfter, noError: gl.NO_ERROR,
        };
      } finally {
        cancelled = true; prototype.commitFractures = originalCommit;
        view.dispose(); host.remove();
      }
    }, scenario);
    for (const screenshot of result.screenshots) {
      const path = testInfo.outputPath(`${scenario.name}-${screenshot.name}.png`);
      await writeFile(path, Buffer.from(screenshot.image.split(',')[1], 'base64'));
      await testInfo.attach(screenshot.name, { path, contentType: 'image/png' });
    }
    expect(result.frames).toHaveLength(10);
    if (scenario.strong) {
      expect(result.events).toEqual([]);
      expect(result.frames.every(frame => frame.fractures === 0)).toBe(true);
    } else {
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.events.every(event => event.stress >= 1 && event.detached)).toBe(true);
      expect(result.screenshots.map(shot => shot.name)).toEqual(expect.arrayContaining([
        'before-first-fracture', 'after-first-fracture', 'after-first-unloading', 'after-unloading',
      ]));
      expect(result.screenshots.find(shot => shot.name === 'before-first-fracture')!.fractures).toBe(0);
      expect(result.screenshots.find(shot => shot.name === 'after-first-fracture')!.fractures).toBe(1);
      if (scenario.bank === 0.4) {
        expect(result.repeatedFrame, 'banked collision must exercise restoration after another real separation').toBeDefined();
        expect(result.screenshots.map(shot => shot.name)).toContain('after-second-fracture');
      }
    }
    for (const { phase, report } of [
      ...result.reports,
      ...result.frames.map(frame => ({ phase: `accepted-${frame.frame}`, report: frame.report })),
      ...result.restored.map(frame => ({ phase: `restored-${frame.frame}`, report: frame.report })),
      ...result.seeks.map(frame => ({ phase: `seek-${frame.frame}`, report: frame.report })),
    ]) {
      expect(report.missingSections, phase).toEqual([]);
      expect(report.renderedSections, phase).toBe(report.physicalSections);
      expect(report.maxNodeError, phase).toBeLessThan(1e-9);
      expect(report.maxWorldError, phase).toBeLessThan(1e-7);
      expect(report.actualFragments, phase).toEqual(report.expectedFragments);
      expect(report.fragmentTransformsMatch, phase).toBe(true);
      expect(report.finite, phase).toBe(true);
      expect(report.maxSeamGap, phase).toBeLessThan(1e-5);
      expect(report.maxNormalError, phase).toBeLessThan(1e-5);
      expect(report.trianglesValid, phase).toBe(true);
      expect(report.rotationBudgetValid, phase).toBe(true);
      expect(report.physicalUnchanged, phase).toBe(true);
      expect(report.graphicsError, phase).toBe(result.noError);
      expect(report.nonBlank, phase).toBe(true);
    }
    expect(result.restored.every(frame => frame.matches)).toBe(true);
    expect(result.continuousMatches).toHaveLength(result.recordingLength);
    expect(result.continuousMatches.every(Boolean)).toBe(true);
    expect(result.continuousFrame).toBe(result.recordingLength);
    expect(result.seeks.every(frame => frame.matches && frame.actualFrame === frame.frame)).toBe(true);
    expect(result.oldVersionError).toBe('回放物理版本不匹配');
    expect(result.bestBefore).toBe(0);
    expect(result.bestAfter).toBe(120);
    expect(result.oldBest).toBe('900');
    expect(errors).toEqual([]);
  });
}
