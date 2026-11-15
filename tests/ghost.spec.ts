import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page, challenge: string) {
  return page.evaluate(async challenge => {
    const physicsPath = '/src/physics.ts', modelPath = '/src/model.ts', replayPath = '/src/replay.ts';
    const { FlightSimulation } = await import(physicsPath), { defaultAircraft, presets, clone } = await import(modelPath), { exportReplay } = await import(replayPath);
    const definition = clone(challenge === 'birdman' ? defaultAircraft : presets.find((p: any) => p.name === (challenge === 'downhill' ? '高性能滑翔型' : '基础单发型')));
    definition.name = 'Ghost 独立机型'; definition.mainWing.points[1].y += 0.5; definition.mainWing.points[2].y += 0.5;
    const sim = new FlightSimulation(definition, challenge, 0.004);
    for (let i = 0; i < 150 && !sim.ended; i++) sim.step({ weight: 0.2, elevator: 0.1, aileron: 0.1, rudder: 0, throttle: 0.8 });
    return exportReplay({ definition, challenge, recording: sim.getRecording() });
  }, challenge);
}

async function enter(page: Page, name: string) {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
  await page.goto('/');
  await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
  await page.locator('.welcome').getByRole('button', { name, exact: false }).click();
  await page.getByRole('button', { name: '试飞', exact: true }).click();
}
async function upload(page: Page, text: string) {
  await page.getByLabel('选择 Ghost 回放文件', { exact: true }).setInputFiles({ name: 'ghost.json', mimeType: 'application/json', buffer: Buffer.from(text) });
}

for (const [challenge, name] of [['birdman', '鸟人间挑战'], ['downhill', '高山速降'], ['low-altitude', '低空飞行']]) {
  test(`${name}可选择独立ghost机型，按仿真时间同步、暂停和重飞`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await enter(page, name);
    const text = await fixture(page, challenge);
    await upload(page, text);
    await expect.poll(() => page.evaluate(() => (window as any).glider.ghost?.ready)).toBe(true);
    await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => (window as any).glider.scene.ghost?.name)).toBe('Ghost 独立机型');
    await page.getByRole('button', { name: '开始试飞', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).glider.ghost.time), { timeout: 60_000 }).toBeGreaterThan(challenge === 'birdman' ? 1.2 : 0.2);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const paused = await page.evaluate(() => ({ ghost: (window as any).glider.scene.ghost, stream: (window as any).glider.ghost }));
    expect(Math.abs(paused.ghost.time - paused.stream.time)).toBeLessThanOrEqual(1 / 60 + 1e-8);
    expect(paused.ghost.opacity).toBeGreaterThanOrEqual(0.2); expect(paused.ghost.opacity).toBeLessThanOrEqual(1);
    expect(paused.ghost.materials).toBeGreaterThan(5); expect(paused.ghost.radius).toBeGreaterThan(1);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as any).glider.scene.ghost.time)).toBeCloseTo(paused.stream.time, 8);
    expect(await page.evaluate(() => (window as any).glider.ghost.frames)).toBeLessThanOrEqual(65);
    await page.screenshot({ path: info.outputPath(`${challenge}-ghost.png`) });
    await page.keyboard.press('r');
    await expect.poll(() => page.evaluate(() => (window as any).glider.ghost?.ready)).toBe(true);
    await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).glider.scene.ghost?.time)).toBe(0);
    await page.getByRole('button', { name: '移除 Ghost', exact: true }).click();
    expect(await page.evaluate(() => (window as any).glider.scene.ghost)).toBeNull();
    expect(await page.evaluate(() => (window as any).glider.ghost)).toBeNull();
    expect(errors).toEqual([]);
  });
}

test('拒绝错误版本、地图、关卡和损坏文件，取消或返回不会留下ghost', async ({ page }) => {
  await enter(page, '鸟人间挑战');
  const valid = await fixture(page, 'birdman'), other = await fixture(page, 'downhill');
  for (const [text, error] of [
    [JSON.stringify({ ...JSON.parse(valid), physicsVersion: 'old' }), '物理版本'],
    [JSON.stringify({ ...JSON.parse(valid), mapHash: 'wrong' }), '地图'],
    [other, '关卡不一致'], ['{', '导入失败'],
  ]) {
    await upload(page, text);
    await expect(page.locator('.toast')).toContainText(error);
    await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => (window as any).glider.ghost)).toBeNull();
  }
  await upload(page, valid);
  await page.getByRole('button', { name: '移除 Ghost', exact: true }).click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).glider.ghost)).toBeNull();
  await upload(page, valid); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '试飞', exact: true }).click();
  expect(await page.evaluate(() => (window as any).glider.ghost)).toBeNull();
  await page.keyboard.press('Escape'); await page.keyboard.press('w');
  await expect(page.getByLabel('选择 Ghost 回放文件', { exact: true })).toHaveCount(0);
});

test('ghost尚未加载时重新进入试飞，丢弃旧批次并恢复机型', async ({ page }) => {
  await enter(page, '鸟人间挑战');
  const text = await fixture(page, 'birdman');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/src\/ghost-worker\.ts\?worker_file/, async route => { await gate; await route.continue(); });
  await upload(page, text);
  await page.getByRole('navigation', { name: '游戏流程' }).getByRole('button', { name: '试飞', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeDisabled();
  release();
  await expect.poll(() => page.evaluate(() => (window as any).glider.scene.ghost?.name), { timeout: 30_000 }).toBe('Ghost 独立机型');
  await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).glider.scene.ghost.time)).toBe(0);
});

test('GPU实际输出4×4 Bayer图案并写入深度，不使用alpha混合', async ({ page }) => {
  await enter(page, '鸟人间挑战');
  const result = await page.evaluate(async () => {
    const threePath = '/node_modules/three/build/three.module.js', ghostPath = '/src/ghost.ts';
    const THREE = await import(threePath), { ditherGhost } = await import(ghostPath);
    const renderer = new THREE.WebGLRenderer(), scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 }), geometry = new THREE.PlaneGeometry(2, 2), mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh); const opacity = { value: 1 }; ditherGhost(scene, opacity, new Set());
    const target = new THREE.WebGLRenderTarget(32, 32), pixels = new Uint8Array(32 * 32 * 4), counts: number[] = [];
    try {
      renderer.setRenderTarget(target); renderer.setClearColor(0x000000);
      for (const value of [0.2, 0.6, 1]) {
        opacity.value = value; renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, 32, 32, pixels);
        counts.push(Array.from({ length: 1024 }, (_, i) => pixels[i * 4]).filter(red => red > 0).length);
      }
      return { counts, error: renderer.getContext().getError(), blending: material.transparent, depthWrite: material.depthWrite };
    } finally { target.dispose(); geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
  });
  expect(result).toEqual({ counts: [192, 640, 1024], error: 0, blending: false, depthWrite: true });
});

test('24米翼展逐帧渲染及ghost断翼共用真实形变，按自机包络计算渐隐并释放资源', async ({ page }, info) => {
  await enter(page, '鸟人间挑战');
  const errors: string[] = []; page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const result = await page.evaluate(async () => {
    const scenePath = '/src/scene.ts', physicsPath = '/src/physics.ts', modelPath = '/src/model.ts', ghostPath = '/src/ghost.ts', playbackPath = '/src/playback.ts', forcesPath = '/src/wind-forces.ts';
    const { SceneView } = await import(scenePath), { FlightSimulation } = await import(physicsPath), { defaultAircraft, clone, wing } = await import(modelPath);
    const { captureGhost } = await import(ghostPath), { cacheFlight } = await import(playbackPath), { cgGeometryRadius } = await import(forcesPath);
    const definition = clone(defaultAircraft); definition.mainWing = wing(24, 0.9, 0.6);
    const sim = new FlightSimulation(definition, 'birdman', 0), host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:100;width:100vw;height:100vh'; document.body.append(host);
    const view = new SceneView(host), internal = view as any, cpu: number[] = [], intervals: number[] = [];
    let copies = 0, maximumError = 0, disposed = 0;
    const checkpoint = sim.checkpoint.bind(sim);
    // Keep instrumentation out of enumerable physics snapshot fields.
    Object.defineProperty(sim, 'checkpoint', { value: () => { copies++; return checkpoint(); } });
    try {
      view.setQuality('Low'); view.setFlight(sim); view.cameraView('侧面');
      let previous = performance.now();
      for (let i = 0; i < 210 && !sim.ended; i++) {
        const now = await new Promise<number>(resolve => requestAnimationFrame(resolve)); intervals.push(now - previous); previous = now;
        view.captureFlightState(); const start = performance.now();
        sim.step({ weight: 0, elevator: 0, aileron: 0, rudder: 0 }); cacheFlight(sim); cpu.push(performance.now() - start);
        view.render(1 / 60, 1);
      }
      view.setGhost(definition, 'birdman'); const frame = captureGhost(sim); view.renderGhost(frame, frame, 1); view.render(0, 1);
      for (let wing = 0; wing < 3; wing++) {
        const actual = internal.ghost.wingMeshes[wing].geometry.getAttribute('position').array;
        const expected = internal.wingMeshes[wing].geometry.getAttribute('position').array;
        for (let i = 0; i < actual.length; i++) maximumError = Math.max(maximumError, Math.abs(actual[i] - expected[i]));
      }
      const fragmentError = internal.ghost.fragments.reduce((error: number, fragment: any) => {
        const expected = internal.fragments.find((f: any) => f.id === fragment.id && f.wingIndex === fragment.wingIndex);
        return Math.max(error, fragment.mesh.position.distanceTo(expected.mesh.position), fragment.mesh.quaternion.angleTo(expected.mesh.quaternion));
      }, 0);
      const radius = cgGeometryRadius(internal.body, internal.aircraft.position, internal.loadScratch) * 1.2, opacities: number[] = [];
      for (const ratio of [0.5, 2.5, 4]) {
        const offset = { ...frame, position: [frame.position[0], frame.position[1], frame.position[2] + radius * ratio] };
        view.renderGhost(offset, offset, 1); view.render(0, 1); opacities.push(view.getDiagnostics().ghost!.opacity);
      }
      const fragments = internal.ghost.fragments.length;
      internal.ghost.wingMeshes[0].geometry.addEventListener('dispose', () => disposed++);
      internal.ghost.aircraftMaterials.main.addEventListener('dispose', () => disposed++);
      view.setGhost(null); view.render(0, 1);
      const stats = (values: number[]) => { const sorted = values.slice().sort((a, b) => a - b); return { mean: values.reduce((a, b) => a + b, 0) / values.length, p95: sorted[Math.ceil(sorted.length * 0.95) - 1] }; };
      return { steps: cpu.length, copies, physicsAndCacheMs: stats(cpu), frameIntervalsMs: stats(intervals), maximumError, fragmentError, fragments, opacities, disposed, glError: internal.renderer.getContext().getError() };
    } finally { view.dispose(); host.remove(); }
  });
  await info.attach('24m-flight-measurement.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.steps).toBeGreaterThan(120); expect(result.copies).toBeLessThan(result.steps / 4);
  expect(result.maximumError).toBeLessThan(1e-5); expect(result.fragmentError).toBeLessThan(1e-6); expect(result.fragments).toBeGreaterThan(0);
  expect(result.opacities[0]).toBeCloseTo(0.2, 10); expect(result.opacities[1]).toBeCloseTo(0.6, 10); expect(result.opacities[2]).toBeCloseTo(1, 10);
  expect(result.disposed).toBe(2); expect(result.glError).toBe(0); expect(errors).toEqual([]);
});
