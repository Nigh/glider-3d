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
 await expect(pitch).toHaveValue('65');
 await page.getByRole('button', { name: '开始试飞', exact: true }).click();
 await expect.poll(() => page.evaluate(() => window.glider.telemetry?.throttle)).toBeCloseTo(0.4, 2);
 expect(await page.evaluate(() => window.glider.flightControls.adaptiveControls)).toBe(true);
 await expect.poll(() => page.evaluate(() => window.glider.telemetry?.engineRpm)).toBeGreaterThan(0);
 const state = await throttle.evaluate(element => ({ rpm: Number.parseFloat((element.parentElement as HTMLElement).style.getPropertyValue('--rpm')), target: Number((element as HTMLInputElement).value) * 100 }));
 expect(state.rpm).toBeLessThan(state.target);
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
