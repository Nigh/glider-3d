import { test, expect } from '@playwright/test';

const current = (page: import('@playwright/test').Page) => page.evaluate(() => window.glider.aircraft);

test('菜单和模式切换保留飞机，仅鸟人间不兼容时恢复默认', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/');
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 const name = page.getByRole('textbox', { name: '飞机名称', exact: true });
 await name.fill('跨模式保留机'); await name.press('Tab');
 const birdman = await current(page);
 for (const mode of ['高山速降', '低空飞行', '鸟人间挑战']) {
  await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  expect(await current(page)).toEqual(birdman);
  await page.getByRole('button', { name: mode, exact: false }).click();
  expect(await current(page)).toEqual(birdman);
 }
 await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
 await page.getByRole('button', { name: '高山速降', exact: false }).click();
 await page.getByRole('button', { name: '重置设计', exact: true }).click();
 const downhill = await current(page);
 expect(downhill.birdman).toBe(false);
 await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
 expect(await current(page)).toEqual(downhill);
 await page.getByRole('button', { name: '低空飞行', exact: false }).click();
 expect(await current(page)).toEqual(downhill);
 await page.getByRole('button', { name: '试飞', exact: true }).click();
 await page.keyboard.press('Escape');
 expect(await current(page)).toEqual(downhill);
 await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
 await page.getByRole('button', { name: '鸟人间挑战', exact: false }).click();
 const restored = await current(page);
 expect(restored.birdman).toBe(true);
 expect(restored.engine.count).toBe(0);
 expect(restored.name).not.toBe(birdman.name);
 await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
 await page.getByRole('button', { name: '保存', exact: true }).click();
 await page.getByRole('button', { name: '机库', exact: true }).click();
 await page.getByRole('button', { name: '加载', exact: true }).click();
 await expect(page.getByRole('region', { name: '本地机库' })).toBeHidden();
 expect(await current(page)).toEqual(restored);
});
