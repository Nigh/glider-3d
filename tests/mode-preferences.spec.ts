import { test, expect } from '@playwright/test';

test('工坊与风洞保留尾随零，正交旋转切到自由视角', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/');
 await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
 await page.locator('.mode-buttons').getByRole('button', { name: /^高山速降/ }).click();
 const incidence = page.getByRole('spinbutton', { name: '主翼安装角精确值', exact: true });
 await incidence.fill('2');
 await incidence.blur();
 await expect(incidence).toHaveValue('2.0');
 const height = page.getByRole('spinbutton', { name: '主翼安装高度精确值', exact: true });
 await height.fill('0');
 await height.blur();
 await expect(height).toHaveValue('0.00');
 const chord = page.getByRole('spinbutton', { name: '副翼弦长比例精确值', exact: true });
 await chord.fill('35');
 await chord.blur();
 await expect(chord).toHaveValue('35');
 await page.getByRole('navigation', { name: '游戏流程' }).getByRole('button', { name: '风洞', exact: true }).click();
 await expect(page.getByRole('spinbutton', { name: '气流速度数值', exact: true })).toHaveValue('10.00');
 await expect(page.getByRole('spinbutton', { name: '方向舵控制比例数值', exact: true })).toHaveValue('50');
 const cameras = page.getByLabel('观察视角', { exact: true });
 const canvas = page.locator('canvas').first();
 for (const name of ['侧视', '俯视', '正视']) {
  await cameras.getByRole('button', { name, exact: true }).click();
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width * 0.65, y = box.y + box.height * 0.4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 48, y + 20, { steps: 5 });
  await page.mouse.up();
  await expect(cameras.getByRole('button', { name: '自由', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.glider.scene.view)).toBe('free');
 }
});

test('试飞、工坊与风洞开关独立记忆，刷新后保留', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/');
 await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
 await page.locator('.mode-buttons').getByRole('button', { name: /^高山速降/ }).click();
 const button = (name: string) => page.getByRole('button', { name, exact: true });
 const layer = (name: string) => page.getByRole('switch', { name, exact: true });
 const checked = (name: string, value: boolean) => expect(layer(name)).toHaveAttribute('aria-checked', String(value));
 await button('试飞').click();
 for (const name of ['结构图层', '气动图层', '性能']) {
  await checked(name, false);
  await layer(name).click();
 }
 await button('返回设计').click();
 await checked('结构图层', false);
 await checked('气动图层', false);
 await checked('性能', false);
 await button('风洞').click();
 await checked('结构图层', false);
 await checked('气动图层', true);
 await checked('性能', false);
 await layer('气动图层').click();
 await button('返回设计').click();
 await button('试飞').click();
 for (const name of ['结构图层', '气动图层', '性能']) await checked(name, true);
 await page.reload();
 await page.locator('.mode-buttons').getByRole('button', { name: /^高山速降/ }).click();
 await button('试飞').click();
 for (const name of ['结构图层', '气动图层', '性能']) await checked(name, true);
});
