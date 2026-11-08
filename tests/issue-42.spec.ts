import { test, expect, type Page } from '@playwright/test';

type TestPad = { id: string; index: number; connected: boolean; mapping: string; timestamp: number; axes: number[]; buttons: { value: number; pressed: boolean; touched: boolean }[] };
declare global { interface Window { testPad: TestPad | null } }
async function rudder(page: Page) {
 return page.evaluate(() => {
  const controls = window.glider.telemetry?.controlInputs;
  return controls && typeof controls === 'object' && 'rudder' in controls ? controls.rudder : null;
 });
}

async function button(page: Page, index: number, value: number) {
 await page.evaluate(({ index, value }) => {
  const pad = window.testPad;
  if (!pad) throw Error('Test controller disconnected');
  pad.buttons[index] = { value, pressed: value > 0.5, touched: value > 0 };
 }, { index, value });
}

test('controller starts, pauses, subtracts triggers, switches camera and disconnects safely', async ({ page }) => {
 await page.addInitScript(() => {
  localStorage.setItem('aero-formula.language', 'zh');
  window.testPad = { id: 'Test standard controller', index: 0, connected: true, mapping: 'standard', timestamp: 1,
   axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false, touched: false })) };
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.testPad ? [window.testPad] : [] });
 });
 const errors: string[] = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.goto('/');
 await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 await page.getByRole('button', { name: '前往挑战' }).click();
 await expect.poll(() => page.evaluate(() => window.glider.flightReady)).toBe(false);
 await button(page, 0, 1);
 await expect.poll(() => page.evaluate(() => window.glider.flightReady)).toBe(true);
 await button(page, 0, 0);
 await expect.poll(() => page.evaluate(() => window.glider.time)).toBeGreaterThan(0);
 await button(page, 6, 1);
 await button(page, 7, 0.5);
 await expect.poll(() => rudder(page)).toBeCloseTo(-0.5, 1);
 await button(page, 7, 1);
 await expect.poll(() => rudder(page)).toBeCloseTo(0, 2);
 await page.evaluate(() => { window.testPad = null; });
 await expect.poll(() => rudder(page)).toBeCloseTo(0, 2);
 await page.keyboard.press('Space');
 await expect(page.locator('.pause-banner')).toBeVisible();
 await page.keyboard.press('c');
 await expect(page.getByRole('combobox', { name: '飞行相机', exact: true })).toHaveValue('锁定');
 expect(errors).toEqual([]);
});

test('keyboard remapping persists, affects flight and restores individual defaults', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/');
 await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
 await page.getByRole('button', { name: '输入设置', exact: true }).click();
 await page.getByRole('button', { name: '清除绑定：开始／暂停', exact: true }).click();
 await page.getByRole('button', { name: '添加绑定：开始／暂停', exact: true }).click();
 await page.keyboard.press('b');
 await expect(page.locator('.actions > li').filter({ has: page.getByText('开始／暂停', { exact: true }) })).toContainText('KeyB');
 await page.keyboard.press('Escape');
 await page.reload();
 await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 await page.getByRole('button', { name: '前往挑战' }).click();
 await page.locator('.flight-hud').click();
 await page.keyboard.press('Space');
 expect(await page.evaluate(() => window.glider.flightReady)).toBe(false);
 await page.keyboard.press('b');
 await expect.poll(() => page.evaluate(() => window.glider.flightReady)).toBe(true);
 await page.getByRole('button', { name: '输入设置', exact: true }).click();
 await page.getByRole('button', { name: '恢复默认：开始／暂停', exact: true }).click();
 await page.keyboard.press('Escape');
 await page.locator('.flight-hud').click();
 await page.keyboard.press('Space');
 await expect(page.locator('.pause-banner')).toBeVisible();
});
