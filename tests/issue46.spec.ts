import { test, expect } from '@playwright/test';

// Browser storage and Vite modules live across a page boundary; Node static imports cannot access them.

test.beforeEach(async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/');
 await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
});

test('安装参数归属各部件，负上反角可编辑，菜单与场景选中同步', async ({ page }) => {
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 await expect(page.getByRole('tab', { name: '组装', exact: true })).toHaveCount(0);
 await expect(page.getByRole('combobox', { name: '预设飞机', exact: true })).toHaveCount(0);
 await expect(page.getByRole('spinbutton', { name: '主翼纵向位置精确值', exact: true })).toBeVisible();
 await expect(page.getByRole('spinbutton', { name: '主翼安装高度精确值', exact: true })).toBeVisible();
 await expect(page.getByRole('spinbutton', { name: '主翼安装角精确值', exact: true })).toBeVisible();
 const dihedral = page.getByRole('spinbutton', { name: '主翼上反角精确值', exact: true });
 await expect(dihedral).toHaveAttribute('min', '-25');
 await dihedral.fill('-12'); await dihedral.press('Tab');
 await expect.poll(() => page.evaluate(() => window.glider.aircraft.mainWing.dihedral)).toBe(-12);
 for (const [label, target, fields] of [
  ['副翼', 'horizontalTail', ['副翼位置精确值', '副翼安装角精确值']],
  ['垂直尾翼', 'verticalTail', ['垂直尾翼位置精确值']],
  ['机身', 'fuselage', ['机头端点精确值', '机尾端点精确值', '驾驶舱位置精确值']],
 ] as const) {
  await page.getByRole('tab', { name: label, exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.glider.scene.editing)).toBe(target);
  for (const field of fields) await expect(page.getByRole('spinbutton', { name: field, exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: '主翼安装高度精确值', exact: true })).toHaveCount(0);
 }
});

test('默认自由视角，切换部件不改视角，旋转等角视角同步恢复自由透视', async ({ page }) => {
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 const cameras = page.locator('.viewport-tools');
 await expect(cameras.getByRole('button', { name: '自由', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await expect.poll(() => page.evaluate(() => window.glider.scene.orthographic)).toBe(false);
 await cameras.getByRole('button', { name: '俯视', exact: true }).click();
 await expect(cameras.getByRole('button', { name: '俯视', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await expect.poll(() => page.evaluate(() => window.glider.scene.orthographic)).toBe(true);
 await page.getByRole('tab', { name: '垂直尾翼', exact: true }).click();
 await expect(cameras.getByRole('button', { name: '俯视', exact: true })).toHaveAttribute('aria-pressed', 'true');
 const bounds = await page.locator('.scene canvas').boundingBox();
 if (!bounds) throw Error('Scene canvas missing');
 await page.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.65);
 await page.mouse.down();
 await page.mouse.move(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.72, { steps: 8 });
 await page.mouse.up();
 await expect(cameras.getByRole('button', { name: '自由', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await expect.poll(() => page.evaluate(() => window.glider.scene.orthographic)).toBe(false);
});

for (const mode of ['测试空间', '风洞']) {
 test(`${mode}允许切换飞机类型，清理不兼容部件并可撤销`, async ({ page }) => {
  await page.getByRole('button', { name: mode, exact: false }).click();
  const type = page.getByRole('combobox', { name: '飞机类型', exact: true });
  await type.selectOption('normal');
  await page.getByRole('tab', { name: '动力', exact: true }).click();
  await page.getByRole('combobox', { name: '引擎数量', exact: true }).selectOption('1');
  const powered = await page.evaluate(() => window.glider.aircraft);
  expect(powered.birdman).toBe(false);
  expect(powered.engine.count).toBe(1);
  expect(powered.fuelTank.capacity).toBeGreaterThan(0);
  expect(powered.mainWing.controlSurface).toBeGreaterThan(0);
  expect(powered.horizontalTail.controlSurface).toBeGreaterThan(0);
  await type.selectOption('birdman');
  const birdman = await page.evaluate(() => window.glider.aircraft);
  expect(birdman.birdman).toBe(true);
  expect(birdman.engine.count).toBe(0);
  expect(birdman.fuelTank.capacity).toBe(0);
  expect(birdman.mainWing.controlSurface).toBe(0);
  expect(birdman.horizontalTail.controlSurface).toBe(0);
  expect(birdman.verticalTail.controlSurface).toBe(powered.verticalTail.controlSurface);
  expect(birdman.mainWing.points).toEqual(powered.mainWing.points);
  await expect(page.getByRole('tab', { name: '动力', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await page.evaluate(() => window.glider.aircraft)).toEqual(powered);
  await expect(type).toHaveValue('normal');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(await page.evaluate(() => window.glider.aircraft)).toEqual(birdman);
  await page.getByRole('button', { name: '机库', exact: true }).click();
  await expect(page.locator('.saved-plane .load-plane:disabled')).toHaveCount(0);
 });
}

for (const mode of ['高山速降', '低空飞行']) {
 test(`${mode}禁用系统和导入的鸟人间飞机，程序点击也不可加载`, async ({ page }) => {
  await page.getByRole('button', { name: mode, exact: false }).click();
  const before = await page.evaluate(() => window.glider.aircraft);
  expect(before.birdman).toBe(false);
  await expect(page.getByRole('combobox', { name: '飞机类型', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '机库', exact: true }).click();
  const system = page.locator('[data-aircraft-id="system:鸟人间滑翔基础型"]');
  await expect(system).toHaveClass(/incompatible/);
  await expect(system.getByRole('button', { name: '加载', exact: true })).toBeDisabled();
  await expect(system.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
  await expect(system.getByRole('textbox')).toHaveCount(0);
  await system.getByRole('button', { name: '加载', exact: true }).dispatchEvent('click');
  expect(await page.evaluate(() => window.glider.aircraft)).toEqual(before);
  await expect(page.locator('.toast')).toContainText('当前挑战不可使用鸟人间飞机');
  const imported = await page.evaluate(async () => {
   const { clone, defaultAircraft } = await import('/src/model.ts');
   return { ...clone(defaultAircraft), name: '导入鸟人间禁用机' };
  });
  await page.getByLabel('导入飞机文件', { exact: true }).setInputFiles({ name: 'birdman.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator('.toast')).toContainText('已导入机库，但当前挑战不可使用鸟人间飞机，未加载。');
  expect(await page.evaluate(() => window.glider.aircraft)).toEqual(before);
  await page.getByRole('button', { name: '机库', exact: true }).click();
  const personal = page.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名导入鸟人间禁用机', exact: true }) });
  await expect(personal.getByRole('button', { name: '加载', exact: true })).toBeDisabled();
  await page.getByRole('region', { name: '本地机库', exact: true }).getByRole('button', { name: '返回工坊', exact: true }).click();
  await page.getByRole('button', { name: '前往挑战', exact: false }).click();
  await expect.poll(() => page.evaluate(() => window.glider.state)).toBe('flight');
  expect((await page.evaluate(() => window.glider.aircraft)).birdman).toBe(false);
 });
}

test('系统预设直接入库，保存系统同名设计与复制不改变系统飞机', async ({ page }) => {
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 await page.getByRole('button', { name: '机库', exact: true }).click();
 const system = page.locator('[data-aircraft-id="system:鸟人间滑翔基础型"]');
 await system.getByRole('button', { name: '加载', exact: true }).click();
 await page.getByRole('spinbutton', { name: '主翼上反角精确值', exact: true }).fill('-8');
 await page.getByRole('spinbutton', { name: '主翼上反角精确值', exact: true }).press('Tab');
 await page.getByRole('button', { name: '保存', exact: true }).click();
 await page.getByRole('button', { name: '机库', exact: true }).click();
 await expect(page.getByRole('textbox', { name: '重命名鸟人间滑翔基础型', exact: true })).toBeVisible();
 expect(await page.evaluate(async () => (await import('/src/storage.ts')).loadAircraft('system:鸟人间滑翔基础型').definition.mainWing.dihedral)).toBe(5.9);
 await system.getByRole('button', { name: '复制', exact: true }).click();
 await expect(page.getByRole('textbox', { name: '重命名鸟人间滑翔基础型 副本', exact: true })).toBeVisible();
 await expect(system.getByRole('button', { name: '加载', exact: true })).toBeEnabled();
});

test('浏览器存储不可用时保留系统机库与错误提示', async ({ page }) => {
 await page.addInitScript(() => Object.defineProperty(Storage.prototype, 'length', { configurable: true, get() { throw Error('Storage blocked'); } }));
 await page.reload();
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 await page.getByRole('button', { name: '机库', exact: true }).click();
 await expect(page.getByRole('region', { name: '本地机库', exact: true })).toBeVisible();
 await expect(page.locator('.toast')).toContainText('无法访问浏览器本地存储');
 await page.locator('[data-aircraft-id="system:鸟人间滑翔基础型"]').getByRole('button', { name: '加载', exact: true }).click();
 await expect.poll(() => page.evaluate(() => window.glider.aircraft.name)).toBe('鸟人间滑翔基础型');
});

test('连续拖动回放进度时同步更新飞机，不等待停止拖动', async ({ page }) => {
 // Fixture generation must use Vite's browser modules, not Node's module instance.
 const text = await page.evaluate(async () => {
  const { FlightSimulation } = await import('/src/physics.ts');
  const { defaultAircraft } = await import('/src/model.ts');
  const { exportReplay } = await import('/src/replay.ts');
  const sim = new FlightSimulation(defaultAircraft, 'birdman', 0);
  for (let frame = 0; frame < 240 && !sim.ended; frame++) sim.step({ weight: 0, elevator: 0, aileron: 0, rudder: 0 });
  return exportReplay({ definition: defaultAircraft, challenge: 'birdman', recording: sim.getRecording() });
 });
 await page.getByLabel('导入回放', { exact: true }).setInputFiles({ name: 'scrub.json', mimeType: 'application/json', buffer: Buffer.from(text) });
 const slider = page.getByRole('slider', { name: '回放进度', exact: true });
 await slider.evaluate((element: HTMLInputElement) => { element.value = '2.2'; element.dispatchEvent(new Event('input', { bubbles: true })); });
 await expect.poll(() => page.evaluate(() => window.glider.time)).toBeGreaterThan(2.1);
 const during = await slider.evaluate(async (element: HTMLInputElement) => {
  const times: number[] = [];
  for (let frame = 0; frame < 24; frame++) {
   element.value = String(2.3 + frame / 60);
   element.dispatchEvent(new Event('input', { bubbles: true }));
   const next = Promise.withResolvers<void>();
   requestAnimationFrame(() => next.resolve());
   await next.promise;
   times.push(window.glider.time);
  }
  return times;
 });
 expect(during.slice(0, 20).some(time => time > 2.4)).toBe(true);
 await expect.poll(() => page.evaluate(() => window.glider.time)).toBeGreaterThan(2.6);
});

test('真实部件拾取显示悬停反馈并同步侧栏，拖动空白不误选', async ({ page }) => {
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 const canvas = await page.locator('.scene canvas').boundingBox();
 const part = await page.evaluate(() => window.glider.scene.editor.parts.find(part => part.target === 'horizontalTail'));
 if (!canvas || !part) throw Error('Auxiliary wing projection missing');
 await page.mouse.move(canvas.x + part.x, canvas.y + part.y);
 await expect.poll(() => page.evaluate(() => window.glider.scene.editor.hover)).toBe('horizontalTail');
 await page.mouse.click(canvas.x + part.x, canvas.y + part.y);
 await expect(page.getByRole('tab', { name: '副翼', exact: true })).toHaveAttribute('aria-selected', 'true');
 await expect.poll(() => page.evaluate(() => window.glider.scene.editor.target)).toBe('horizontalTail');
 await page.getByRole('tab', { name: '主翼', exact: true }).click();
 await expect.poll(() => page.evaluate(() => window.glider.scene.editor.target)).toBe('mainWing');
 await page.mouse.move(canvas.x + canvas.width * 0.9, canvas.y + canvas.height * 0.65);
 await page.mouse.down();
 await page.mouse.move(canvas.x + canvas.width * 0.75, canvas.y + canvas.height * 0.7, { steps: 8 });
 await page.mouse.up();
 await expect(page.getByRole('tab', { name: '主翼', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('真实相机靠近避开水面，推挤有界且离开障碍后恢复观察距离', async ({ page }) => {
 const result = await page.evaluate(async () => {
  // Use Vite's browser instances to exercise the actual scene and its renderer.
  const { SceneView } = await import('/src/scene.ts');
  const { FlightSimulation } = await import('/src/physics.ts');
  const { defaultAircraft } = await import('/src/model.ts');
  document.querySelector<HTMLElement>('.app')!.style.display = 'none';
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0';
  document.body.append(host);
  const view = new SceneView(host);
  try {
   view.setQuality('Low');
   const simulation = new FlightSimulation(defaultAircraft, 'birdman', 0);
   simulation.launching = false;
   simulation.position.set(50, 10, 0);
   view.setFlight(simulation); view.captureFlightState(); view.cameraView('自由');
   const camera = Reflect.get(view, 'camera'), controls = Reflect.get(view, 'controls');
   controls.target.set(50, 2, 0); camera.position.set(50, -1, 10);
   const intended = camera.position.clone(), target = controls.target.clone(), radius = intended.distanceTo(target);
   view.render(0, 1);
   const pushed = view.getDiagnostics(), shortened = camera.position.distanceTo(controls.target);
   view.render(0, 1);
   const stable = camera.position.clone();
   camera.position.y += 50; controls.target.y += 50;
   view.render(0, 1);
   return {
    push: Math.hypot(pushed.cameraClearance.offset.x, pushed.cameraClearance.offset.y, pushed.cameraClearance.offset.z),
    maximum: pushed.cameraClearance.maximumPush,
    aboveSurface: pushed.camera.y >= pushed.groundHeight + 0.55 - 1e-6,
    shortened: shortened < radius,
    stable: stable.distanceTo(intended) <= pushed.cameraClearance.maximumPush + 1e-6,
    restoredRadius: camera.position.distanceTo(controls.target), radius,
    restoredPush: view.getDiagnostics().cameraClearance.offset,
   };
  } finally { view.dispose(); host.remove(); }
 });
 expect(result.push).toBeGreaterThan(0);
 expect(result.push).toBeLessThanOrEqual(result.maximum + 1e-6);
 expect(result.aboveSurface).toBe(true);
 expect(result.shortened).toBe(true);
 expect(result.stable).toBe(true);
 expect(result.restoredRadius).toBeCloseTo(result.radius, 6);
 expect(result.restoredPush).toEqual({ x: 0, y: 0, z: 0 });
});
