import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
  await page.goto('/');
});

for (const challenge of ['鸟人间挑战', '高山速降', '低空飞行', '风洞', '测试空间']) {
  test(`${challenge}工坊Space启动、W临时风洞及返回保留原关卡和设计`, async ({ page }) => {
    await page.locator('.welcome').getByRole('button', { name: challenge, exact: false }).click();
    const name = page.getByRole('textbox', { name: '飞机名称', exact: true });
    await name.fill(`保留${challenge} W 空格`);
    await page.keyboard.press('w'); await page.keyboard.press('Space');
    expect(await page.evaluate(() => window.glider.state)).toBe('design');
    await name.press('Tab');
    await page.getByRole('heading', { name: '飞机工坊', exact: true }).click();
    const aircraft = await page.evaluate(() => window.glider.aircraft);
    await page.keyboard.press('w');
    await expect(page.locator('.wind-tunnel')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '开启风洞', exact: true })).toBeVisible();
    await page.keyboard.down('Space');
    await expect(page.getByRole('button', { name: '关闭风洞', exact: true })).toBeVisible();
    await page.keyboard.down('Space'); // auto repeat must not toggle again
    await expect(page.getByRole('button', { name: '关闭风洞', exact: true })).toBeVisible();
    await page.keyboard.up('Space'); await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: '开启风洞', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(name).toHaveValue(aircraft.name);
    expect(await page.evaluate(() => window.glider.aircraft)).toEqual(aircraft);
    await page.keyboard.press('Space');
    if (challenge === '风洞') await expect(page.locator('.wind-tunnel')).toHaveCount(1);
    else if (challenge === '测试空间') await expect(page.getByRole('region', { name: '测试平台设置', exact: true })).toBeVisible();
    else await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('navigation', { name: '游戏流程' }).getByRole('button', { name: '风洞', exact: true }).click();
    await expect(page.locator('.wind-tunnel')).toHaveCount(1);
    await page.getByRole('navigation', { name: '游戏流程' }).getByRole('button', { name: '设计', exact: true }).click();
    await expect(name).toBeVisible();
    if (challenge === '鸟人间挑战') {
      await page.getByRole('button', { name: '机库', exact: true }).click();
      await page.keyboard.press('Space'); await page.keyboard.press('w');
      await expect(page.getByRole('region', { name: '本地机库', exact: true })).toBeVisible();
      await page.getByRole('navigation', { name: '游戏流程' }).getByRole('button', { name: '风洞', exact: true }).click();
      await expect(page.locator('.wind-tunnel')).toHaveCount(1);
      await page.keyboard.press('Escape'); await expect(name).toBeVisible();
    }
  });
}

test('非输入控件和动态对话框不持有焦点，原生选择器、滑条和文本输入仍可操作', async ({ page }) => {
  const language = page.locator('.language-label select');
  await language.click();
  await expect(language).not.toBeFocused();
  // Exercise Chromium's native picker, rather than merely dispatching change.
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await language.selectOption('zh');
  await page.locator('.welcome').getByRole('button', { name: '测试空间', exact: false }).click();
  for (const element of await page.locator('button,a[href],select,summary,input[type=range],input[type=checkbox],[role=slider]').all()) {
    await expect(element).toHaveAttribute('tabindex', '-1');
  }
  const name = page.getByRole('textbox', { name: '飞机名称', exact: true });
  await name.fill('键盘输入 W Space'); await expect(name).toBeFocused();
  await page.getByRole('button', { name: '输入设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '输入设置', exact: true });
  await expect(dialog).toBeVisible();
  for (const button of await dialog.getByRole('button').all()) await expect(button).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('w'); await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.glider.state)).toBe('design');
  await dialog.getByRole('button', { name: '保存', exact: true }).first().click();
  await page.keyboard.press('Space');
  const summary = page.locator('.platform-options summary');
  await summary.click(); await expect(summary).not.toBeFocused(); await summary.click();
  const slider = page.getByRole('slider', { name: '平台高度', exact: true });
  const box = (await slider.boundingBox())!;
  await slider.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(slider).not.toBeFocused();
  await expect(page.getByRole('spinbutton', { name: '平台高度数值', exact: true })).not.toHaveValue('2000');
});

test('风洞安装角实体同步，返回工坊保留实际角度，三语阻力分项紧随总阻力', async ({ page }) => {
  await page.locator('.welcome').getByRole('button', { name: '低空飞行', exact: false }).click();
  await page.keyboard.press('w');
  const before = await page.evaluate(() => window.glider.scene.wingRoots);
  await page.getByRole('spinbutton', { name: '主翼安装角数值', exact: true }).fill('18');
  await page.getByRole('spinbutton', { name: '副翼安装角数值', exact: true }).fill('-12');
  await page.getByRole('button', { name: '开启风洞', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const roots = window.glider.scene.wingRoots;
    return Math.abs(roots.mainWing.leading.y - roots.mainWing.trailing.y);
  })).toBeGreaterThan(Math.abs(before.mainWing.leading.y - before.mainWing.trailing.y) + 0.05);
  await page.getByRole('button', { name: '输入设置', exact: true }).click(); // freeze for exact display comparisons
  const errors = await page.evaluate(() => {
    const aero = window.glider.telemetry!.aerodynamics as any;
    return [Math.hypot(aero.profileDrag.x + aero.inducedDrag.x - aero.drag.x, aero.profileDrag.y + aero.inducedDrag.y - aero.drag.y, aero.profileDrag.z + aero.inducedDrag.z - aero.drag.z)];
  });
  expect(errors[0]).toBeLessThan(1e-8);
  await page.getByRole('dialog', { name: '输入设置', exact: true }).getByRole('button', { name: '保存', exact: true }).first().click();
  for (const [locale, labels] of [
    ['zh', ['阻力', '摩擦阻力（零升阻力）', '诱导阻力']],
    ['en', ['Drag', 'Profile / parasite drag', 'Induced drag']],
    ['ja', ['抗力', '形状・有害抗力（非誘導）', '誘導抗力']],
  ] as const) {
    await page.locator('.language-label select').selectOption(locale);
    const rows = await page.locator('.aero-live dt').allTextContents(), index = rows.indexOf(labels[0]);
    expect(index).toBeGreaterThanOrEqual(0); expect(rows.slice(index, index + 3)).toEqual(labels);
  }
  await page.locator('.language-label select').selectOption('zh');
  await page.keyboard.press('Escape');
  expect((await page.evaluate(() => window.glider.aircraft)).assembly.mainIncidence).toBe(18);
  expect((await page.evaluate(() => window.glider.aircraft)).assembly.tailIncidence).toBe(-12);
});

test('真实WebGL风洞在各正交视角、超宽视口和极端缩放平移后保持整个近裁剪面在室内', async ({ page }, info) => {
  const result = await page.evaluate(async () => {
    const scenePath = '/src/scene.ts', physicsPath = '/src/physics.ts', modelPath = '/src/model.ts';
    const { SceneView } = await import(scenePath), { FlightSimulation } = await import(physicsPath), { presets } = await import(modelPath);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:900px;height:600px'; document.body.append(host);
    const view = new SceneView(host), sim = new FlightSimulation(presets[2], 'wind-tunnel', 0), internal = view as any;
    const vector = internal.camera.position.clone();
    const clearances: number[] = [];
    try {
      view.setQuality('Low'); view.setFlight(sim);
      for (const [width, height] of [[900,600], [1800,400], [700,900]]) {
        host.style.width = `${width}px`; host.style.height = `${height}px`;
        for (const direction of ['侧视', '俯视', '正视', '后视']) {
          view.cameraView(direction);
          internal.camera.zoom = 0.001; internal.camera.updateProjectionMatrix();
          vector.set(500,-500,500); internal.camera.position.add(vector); internal.controls.target.add(vector);
          view.render(0, 1);
          const room = internal.laboratoryScene.room;
          for (const x of [-1,1]) for (const y of [-1,1]) {
            const point = vector.set(x,y,-1).unproject(internal.camera);
            clearances.push(room.halfX-Math.abs(point.x), room.halfY-Math.abs(point.y-room.centerY), room.halfZ-Math.abs(point.z));
          }
        }
      }
      const image = internal.renderer.domElement.toDataURL('image/png');
      const gl = internal.renderer.getContext(), graphicsError = gl.getError();
      view.setFlight(null); view.cameraView('侧视');
      return { minimumClearance: Math.min(...clearances), graphicsError, minZoomAfterExit: internal.controls.minZoom, image };
    } finally { view.dispose(); host.remove(); }
  });
  expect(result.minimumClearance).toBeGreaterThanOrEqual(0.49);
  expect(result.graphicsError).toBe(0); expect(result.minZoomAfterExit).toBe(0);
  await writeFile(info.outputPath('wind-room-zoom.png'), Buffer.from(result.image.split(',')[1], 'base64'));
});

test('实际断翼后改变安装角，断片保留释放角度，实时蒙皮与按当前状态重建的网格一致', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const scenePath = '/src/scene.ts', physicsPath = '/src/physics.ts', modelPath = '/src/model.ts';
    const { SceneView } = await import(scenePath), { FlightSimulation } = await import(physicsPath), { presets, clone } = await import(modelPath);
    const definition = clone(presets[2]); definition.mainWing.materialId = 'spruce'; definition.mainWing.materialAmount = 0.5;
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;width:640px;height:480px'; document.body.append(host);
    const live = new SceneView(host), fresh = new SceneView(host), sim = new FlightSimulation(definition, 'wind-tunnel', 0);
    const neutral = { weight: 0, lateral: 0, elevator: 0, aileron: 0, rudder: 0 };
    try {
      live.setQuality('Low'); fresh.setQuality('Low'); live.setFlight(sim);
      sim.setWindTunnel({ ...sim.windTunnel, speed: 200, mainIncidence: 18 }); sim.setWindTunnelEnabled(true);
      for (let frame = 0; frame < 900 && !sim.fragments.length; frame++) sim.step(neutral);
      live.render(0, 1);
      const detached = sim.structure.sections.filter((section: any) => section.bodyId !== 0);
      const released = detached.map((section: any) => section.surface.incidence);
      const liveGeometry = (live as any).wingMeshes.map((mesh: any) => mesh.geometry);
      sim.setWindTunnel({ ...sim.windTunnel, speed: 1, mainIncidence: -10, tailIncidence: 12 });
      live.captureFlightState(); sim.step(neutral); live.render(0, 1);
      fresh.setFlight(sim); fresh.render(0, 1);
      let maximumError = 0;
      for (let wing = 0; wing < 3; wing++) {
        const actual = (live as any).wingMeshes[wing].geometry.getAttribute('position').array;
        const expected = (fresh as any).wingMeshes[wing].geometry.getAttribute('position').array;
        for (let value = 0; value < actual.length; value++) maximumError = Math.max(maximumError, Math.abs(actual[value] - expected[value]));
      }
      const diagnostics = live.getDiagnostics().structureRendering;
      return { fragments: sim.fragments.length, detached: detached.length, released,
        after: detached.map((section: any) => section.surface.incidence), maximumError,
        reused: (live as any).wingMeshes.every((mesh: any, index: number) => mesh.geometry === liveGeometry[index]),
        finite: diagnostics.wings.every((wing: any) => wing.finite), glError: (live as any).renderer.getContext().getError() };
    } finally { live.dispose(); fresh.dispose(); host.remove(); }
  });
  expect(result.fragments).toBeGreaterThan(0); expect(result.detached).toBeGreaterThan(0);
  expect(result.after).toEqual(result.released); expect(result.maximumError).toBeLessThan(3e-6);
  expect(result.reused).toBe(true); expect(result.finite).toBe(true); expect(result.glError).toBe(0);
});
