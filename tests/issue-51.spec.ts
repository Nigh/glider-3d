import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
 await page.goto('/', { waitUntil: 'domcontentloaded' });
 await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
});

test('flight uses four views, repeated trim steps are 1%, and locked/pilot dragging follows each view convention', async ({ page }, info) => {
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 await page.getByRole('button', { name: /^高山速降/ }).click();
 await page.getByRole('button', { name: '试飞', exact: true }).click();
 const camera = page.getByLabel('飞行相机', { exact: true });
 await expect(camera.locator('option')).toHaveText(['追尾','锁定','侧追尾','驾驶员']);
 const pitch = page.getByRole('slider', { name: '升降舵配平', exact: true });
 const roll = page.getByRole('slider', { name: '副翼配平', exact: true });
 await page.keyboard.down('k'); await expect(pitch).toHaveValue('51');
 await page.keyboard.down('k'); await expect(pitch).toHaveValue('52');
 await page.keyboard.down('k'); await expect(pitch).toHaveValue('53'); await page.keyboard.up('k');
 await page.keyboard.press('j'); await expect(pitch).toHaveValue('52');
 await page.keyboard.press('h'); await expect(roll).toHaveValue('49');
 await page.keyboard.press('l'); await expect(roll).toHaveValue('50');
 await page.keyboard.press('c'); await expect(camera).toHaveValue('锁定');
 await expect(page.getByRole('img', { name: 'HUD', exact: true })).toBeVisible();
 const viewport = page.viewportSize()!;
 const points = () => page.evaluate(() => { const {camera,target} = (window as any).glider.scene; return {camera,target}; });
 const dragDown = async () => {
  await page.mouse.move(viewport.width * 0.55, viewport.height * 0.4); await page.mouse.down();
  await page.mouse.move(viewport.width * 0.55, viewport.height * 0.55, { steps: 8 }); await page.mouse.up();
 };
 const locked = await points(); await dragDown();
 await expect.poll(async () => (await points()).camera.y - locked.camera.y).toBeGreaterThan(0.2);
 const moved = await points();
 expect(Math.abs(moved.camera.y - locked.camera.y)).toBeLessThan(5);
 await page.screenshot({ path: info.outputPath('locked-hud.png') });
 await camera.selectOption('驾驶员');
 const pilot = await points(); await dragDown();
 await expect.poll(async () => (await points()).target.y - pilot.target.y).toBeLessThan(-0.2);
 await page.keyboard.press('c'); await expect(camera).toHaveValue('追尾');
 expect(errors).toEqual([]);
});

test('replay retains all cameras and returning to a live flight restores an allowed view', async ({ page, isMobile }) => {
 const text = await page.evaluate(async () => {
  const { FlightSimulation } = await import('/src/physics.ts');
  const { defaultAircraft } = await import('/src/model.ts');
  const { exportReplay } = await import('/src/replay.ts');
  const sim = new FlightSimulation(defaultAircraft, 'birdman', 0);
  for (let frame = 0; frame < 30; frame++) sim.step({ weight: 0, elevator: 0, aileron: 0, rudder: 0 });
  return exportReplay({ definition: defaultAircraft, challenge: 'birdman', recording: sim.getRecording() });
 });
 await page.getByLabel('导入回放', { exact: true }).setInputFiles({ name: 'issue51.json', mimeType: 'application/json', buffer: Buffer.from(text) });
 const camera = page.getByLabel('飞行相机', { exact: true });
 await expect(camera.locator('option')).toHaveText(['追尾','锁定','侧追尾','驾驶员','侧面','自由','轨道','俯视','侧视','正视','后视']);
 for (const name of ['自由','轨道','俯视','侧视','正视','后视','侧面','驾驶员','锁定']) {
  await camera.selectOption(name); await expect(camera).toHaveValue(name);
 }
 await camera.selectOption('自由');
 if (!isMobile) {
  const radius = () => page.evaluate(() => {
   const {camera,target} = (window as any).glider.scene;
   return Math.hypot(camera.x-target.x,camera.y-target.y,camera.z-target.z);
  });
  const before = await radius();
  await page.mouse.move(900, 400); await page.mouse.wheel(0, 400);
  await expect.poll(radius).toBeGreaterThan(before * 1.1);
 }
 await page.getByRole('button', { name: '返回设计', exact: true }).click();
 await page.getByRole('navigation', { name: '游戏流程', exact: true }).getByRole('button', { name: '试飞', exact: true }).click();
 await expect(camera).toHaveValue('追尾');
 await expect(camera.locator('option')).toHaveCount(4);
});
