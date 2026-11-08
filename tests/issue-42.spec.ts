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
 await page.getByRole('button', { name: '保存', exact: true }).first().click();
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
 await page.getByRole('button', { name: '保存', exact: true }).first().click();
 await page.locator('.flight-hud').click();
 await page.keyboard.press('Space');
 await expect(page.locator('.pause-banner')).toBeVisible();
});

async function installController(page: Page) {
 await page.addInitScript(() => {
  localStorage.setItem('aero-formula.language', 'zh');
  window.testPad = { id: 'Settings controller', index: 0, connected: true, mapping: 'standard', timestamp: 1,
   axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false, touched: false })) };
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.testPad ? [window.testPad] : [] });
 });
}

test('settings shows full axes, reversed live values and latest duplicate ownership', async ({ page }) => {
 await installController(page);
 await page.goto('/');
 await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
 await page.getByRole('button', { name: '输入设置', exact: true }).click();
 await page.getByRole('combobox', { name: '编辑输入配置', exact: true }).selectOption('gamepad');
 const roll = page.locator('[data-action="roll"]'), pitch = page.locator('[data-action="pitch"]');
 await expect(roll).toBeVisible();
 await expect(page.locator('[data-action="rollLeft"]')).toHaveCount(0);
 await expect(page.locator('[data-action="pitchUp"]')).toHaveCount(0);
 await page.evaluate(() => { if (window.testPad) window.testPad.axes[0] = 0.8; });
 await expect.poll(() => roll.locator('meter').first().evaluate((meter: HTMLMeterElement) => meter.value)).toBeGreaterThan(0.7);
 await roll.locator('input[type="checkbox"]').first().check();
 await expect.poll(() => roll.locator('meter').first().evaluate((meter: HTMLMeterElement) => meter.value)).toBeLessThan(-0.7);
 await expect.poll(() => page.locator('.input-readout .stick-position').getAttribute('data-roll').then(Number)).toBeLessThan(-0.7);
 await page.evaluate(() => { if (window.testPad) window.testPad.axes[0] = 0; });
 await pitch.getByRole('button', { name: /添加绑定/ }).click();
 await page.evaluate(() => { if (window.testPad) window.testPad.axes[0] = 0.9; });
 await expect(pitch.locator('[data-kind="axis"][data-index="0"]')).toHaveCount(1);
 await expect(roll.locator('[data-kind="axis"]')).toHaveCount(0);
 await expect(roll.locator('meter').first()).toHaveAttribute('aria-valuetext', '未绑定');
 await expect(page.getByRole('status').filter({ hasText: '滚转轴' })).toContainText('未绑定');
 const pause = page.locator('[data-action="pause"]'), restart = page.locator('[data-action="restart"]');
 const releasedBackground = await pause.locator('[data-kind="button"][data-index="0"]').evaluate(element => getComputedStyle(element).backgroundColor);
 await button(page, 0, 1);
 await expect(pause.locator('[data-kind="button"][data-index="0"]')).toHaveAttribute('data-pressed', 'true');
 await expect.poll(() => pause.locator('[data-kind="button"][data-index="0"]').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(releasedBackground);
 await pause.getByRole('button', { name: /清除绑定/ }).click();
 await expect(pause.locator('[data-kind="button"]')).toHaveCount(0);
 await pause.getByRole('button', { name: /添加绑定/ }).click();
 await button(page, 3, 1);
 await expect(pause.locator('[data-kind="button"][data-index="3"]')).toHaveAttribute('data-pressed', 'true');
 await expect(restart.locator('[data-kind="button"]')).toHaveCount(0);
 const pressedBackground = await pause.locator('[data-kind="button"][data-index="3"]').evaluate(element => getComputedStyle(element).backgroundColor);
 await button(page, 3, 0.009);
 await expect(pause.locator('.binding-live output')).toHaveText('0.01');
 await button(page, 3, 0);
 await expect(pause.locator('[data-kind="button"][data-index="3"]')).toHaveAttribute('data-pressed', 'false');
 await expect.poll(() => pause.locator('[data-kind="button"][data-index="3"]').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(pressedBackground);
 await page.evaluate(() => { window.testPad = null; });
 await expect.poll(() => pitch.locator('meter').first().evaluate((meter: HTMLMeterElement) => meter.value)).toBe(0);
});

test('outside exit offers save discard and cancel without writing drafts', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/');
 await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
 await page.getByRole('button', { name: '输入设置', exact: true }).click();
 await page.getByRole('button', { name: '清除绑定：开始／暂停', exact: true }).click();
 expect(await page.evaluate(() => localStorage.getItem('glider-3d.input.v1'))).toBeNull();
 await page.mouse.click(1, 1);
 const prompt = page.getByRole('alertdialog');
 await expect(prompt).toBeVisible();
 await prompt.getByRole('button', { name: '取消', exact: true }).click();
 await expect(page.locator('[data-action="pause"]')).toContainText('未绑定');
 await page.mouse.click(1, 1);
 await prompt.getByRole('button', { name: '不保存', exact: true }).click();
 await expect(page.locator('dialog[open]')).toHaveCount(0);
 await page.getByRole('button', { name: '输入设置', exact: true }).click();
 await expect(page.locator('[data-action="pause"]')).toContainText('Space');
 await page.getByRole('button', { name: '清除绑定：开始／暂停', exact: true }).click();
 await page.mouse.click(1, 1);
 await prompt.getByRole('button', { name: '保存', exact: true }).click();
 await expect(page.locator('dialog[open]')).toHaveCount(0);
 await page.reload();
 await page.getByRole('button', { name: '输入设置', exact: true }).click();
 await expect(page.locator('[data-action="pause"]')).toContainText('未绑定');
});
