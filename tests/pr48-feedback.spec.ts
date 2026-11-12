import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/');
 await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
});

test('起飞前保留油门与配平设置，自动配平禁止鼠标与键盘手动修改', async ({ page }) => {
 await page.getByRole('button', { name: '低空飞行', exact: false }).click();
 await page.getByRole('button', { name: '前往挑战' }).click();
 const throttle = page.getByRole('slider', { name: '油门', exact: true });
 const pitch = page.getByRole('slider', { name: '升降舵配平', exact: true });
 const adaptive = page.getByRole('switch', { name: '自适应杆量（Y）', exact: true });
 const autoTrim = page.getByRole('switch', { name: '自动升降舵配平（T）', exact: true });
 await expect(pitch).toBeEnabled();
 await throttle.fill('0.4');
 await pitch.fill('65');
 await adaptive.click();
 await autoTrim.click();
 await expect(pitch).toBeDisabled();
 await page.locator('body').click({ position: { x: 2, y: 2 } });
 await page.keyboard.press('KeyK');
 expect(await page.evaluate(() => window.glider.flightControls.autoTrim)).toBe(true);
 await autoTrim.click();
 await expect(pitch).toHaveValue('50');
 await page.getByRole('button', { name: '开始试飞', exact: true }).click();
 await expect.poll(() => page.evaluate(() => window.glider.telemetry?.throttle)).toBeCloseTo(0.4, 2);
 expect(await page.evaluate(() => window.glider.flightControls.adaptiveControls)).toBe(true);
 await expect.poll(() => page.evaluate(() => window.glider.telemetry?.engineRpm)).toBeGreaterThan(0);
 const state = await throttle.evaluate(element => ({ rpm: Number.parseFloat((element.parentElement as HTMLElement).style.getPropertyValue('--rpm')), target: Number((element as HTMLInputElement).value) * 100 }));
 expect(state.rpm).toBeLessThan(state.target);
 await page.getByRole('button', { name: '暂停', exact: true }).click();
 await pitch.fill('65');
 await autoTrim.click();
 await autoTrim.click();
 await expect(pitch).toHaveValue('50');
});

test('精确尾翼端点编辑保持其他端点位置且支持向下垂尾', async ({ page }) => {
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 await page.getByRole('tab', { name: '垂直尾翼', exact: true }).click();
 await page.getByText('精确编辑四个顶点', { exact: true }).click();
 const before = await page.evaluate(() => window.glider.aircraft.verticalTail.points);
 const root = page.getByRole('spinbutton', { name: '顶点1后向坐标', exact: true });
 await root.fill('-0.11'); await root.press('Tab');
 const after = await page.evaluate(() => window.glider.aircraft.verticalTail.points);
 expect(after.slice(1)).toEqual(before.slice(1));
 const height = page.getByRole('spinbutton', { name: '顶点2展向坐标', exact: true });
 await height.fill('-0.4'); await height.press('Tab');
 await expect.poll(() => page.evaluate(() => window.glider.aircraft.verticalTail.points[1].y)).toBe(-0.4);
 await page.getByRole('tab', { name: '机身', exact: true }).click();
 const cockpit = page.getByRole('spinbutton', { name: '驾驶舱位置精确值', exact: true });
 await cockpit.fill('0.31'); await cockpit.press('Tab');
 await expect.poll(() => page.evaluate(() => window.glider.aircraft.cockpit.position)).toBeCloseTo(0.31, 2);
});

test('平尾开关控制安装位置，吸附手柄固定在垂尾顶端并支持撤销重做', async ({ page }) => {
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 await page.getByRole('tab', { name: '水平尾翼', exact: true }).click();
 await page.locator('.viewport-tools').getByRole('button', { name: '侧视', exact: true }).click();
 const toggle = page.getByRole('switch', { name: '平尾安装至垂尾顶端', exact: true });
 await expect(toggle).toHaveAttribute('aria-checked', 'false');
 await toggle.click();
 await expect(toggle).toHaveAttribute('aria-checked', 'true');
 await expect.poll(() => page.evaluate(() => window.glider.scene.wingRoots.horizontalTail.leading.y)).toBeCloseTo(1.5, 6);
 await expect.poll(() => page.evaluate(() => {
  const mount = (window.glider.scene.editor.handles as { handle: number; x: number; y: number; ax: number; ay: number }[]).find(h => h.handle === 6)!;
  return Math.hypot(mount.x - mount.ax, mount.y - mount.ay);
 })).toBe(0);
 await expect(page.getByRole('spinbutton', { name: '水平尾翼位置精确值', exact: true })).toBeDisabled();
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect(toggle).toHaveAttribute('aria-checked', 'false');
 await expect.poll(() => page.evaluate(() => window.glider.scene.wingRoots.horizontalTail.leading.y)).toBeCloseTo(0, 6);
 await page.getByRole('button', { name: '重做', exact: true }).click();
 await expect(toggle).toHaveAttribute('aria-checked', 'true');
 await toggle.click();
 await expect(toggle).toHaveAttribute('aria-checked', 'false');
 await expect.poll(() => page.evaluate(() => window.glider.scene.wingRoots.horizontalTail.leading.y)).toBeCloseTo(0, 6);
 await expect(page.getByRole('spinbutton', { name: '水平尾翼位置精确值', exact: true })).toBeEnabled();
});

test('真实拖动在垂尾顶端外侧二十厘米仍吸附至准确顶端', async ({ page, isMobile }) => {
 test.skip(isMobile, '精确鼠标轨迹在桌面验证；移动端覆盖显式安装开关');
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 await page.getByRole('tab', { name: '水平尾翼', exact: true }).click();
 await page.locator('.viewport-tools').getByRole('button', { name: '侧视', exact: true }).click();
 const toggle = page.getByRole('switch', { name: '平尾安装至垂尾顶端', exact: true });
 await toggle.click();
 await expect.poll(() => page.evaluate(() => window.glider.scene.wingRoots.horizontalTail.leading.y)).toBeCloseTo(1.5, 6);
 const mounted = await page.evaluate(() => (window.glider.scene.editor.handles as { handle: number; x: number; y: number; ax: number; ay: number }[]).find(h => h.handle === 6)!);
 await toggle.click();
 await expect.poll(() => page.evaluate(() => window.glider.scene.wingRoots.horizontalTail.leading.y)).toBeCloseTo(0, 6);
 const body = await page.evaluate(() => (window.glider.scene.editor.handles as { handle: number; x: number; y: number; ax: number; ay: number }[]).find(h => h.handle === 6)!);
 const canvas = await page.locator('.scene canvas').boundingBox();
 if (!canvas) throw Error('Scene canvas missing');
 const scale = (body.ay - mounted.ay) / 1.5;
 await page.mouse.move(canvas.x + body.x, canvas.y + body.y);
 await page.mouse.down();
 await page.mouse.move(canvas.x + body.x + mounted.ax - body.ax + 0.2 * scale, canvas.y + body.y + mounted.ay - body.ay + 0.05 * scale, { steps: 12 });
 await page.mouse.up();
 await expect(toggle).toHaveAttribute('aria-checked', 'true');
 await expect.poll(() => page.evaluate(() => window.glider.scene.wingRoots.horizontalTail.leading.y)).toBeCloseTo(1.5, 6);
 await expect.poll(() => page.evaluate(() => {
  const mount = (window.glider.scene.editor.handles as { handle: number; x: number; y: number; ax: number; ay: number }[]).find(h => h.handle === 6)!;
  return Math.hypot(mount.x - mount.ax, mount.y - mount.ay);
 })).toBe(0);
});
