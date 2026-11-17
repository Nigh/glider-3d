import { expect, test } from '@playwright/test';

test('镜像垂直辅助翼支持双垂尾、V尾和撤销，禁止顶端安装水平辅助翼', async ({ page }) => {
 const errors: string[] = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/', { waitUntil: 'domcontentloaded' });
 await page.getByRole('button', { name: '高山速降', exact: false }).click();
 await page.getByRole('tab', { name: '水平辅助翼', exact: true }).click();
 const tipMount = page.getByRole('switch', { name: '水平辅助翼安装至垂尾顶端', exact: true });
 if (await tipMount.getAttribute('aria-checked') !== 'true') await tipMount.click();
 await expect(tipMount).toHaveAttribute('aria-checked', 'true');
 await page.getByRole('tab', { name: '垂直辅助翼', exact: true }).click();
 const mirror = page.getByRole('switch', { name: '垂直辅助翼镜像', exact: true });
 await mirror.click();
 await expect(mirror).toHaveAttribute('aria-checked', 'true');
 expect(await page.evaluate(() => window.glider.aircraft.assembly.tailOnFin)).toBe(false);
 await page.getByRole('tab', { name: '水平辅助翼', exact: true }).click();
 await expect(tipMount).toBeDisabled();
 await expect(tipMount).toHaveAttribute('aria-checked', 'false');
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect(tipMount).toBeEnabled();
 await expect(tipMount).toHaveAttribute('aria-checked', 'true');
 await page.getByRole('button', { name: '重做', exact: true }).click();
 await expect(tipMount).toBeDisabled();
 await page.getByRole('tab', { name: '垂直辅助翼', exact: true }).click();
 const offset = page.getByRole('spinbutton', { name: '垂直辅助翼横向偏移精确值', exact: true });
 const cant = page.getByRole('spinbutton', { name: '垂直辅助翼偏转角精确值', exact: true });
 await offset.fill('1'); await offset.press('Tab');
 await cant.fill('45'); await cant.press('Tab');
 expect(await page.evaluate(() => {
  const wing = window.glider.aircraft.verticalTail;
  return { mirrored: wing.mirrored, cant: wing.cant, lateralOffset: wing.lateralOffset };
 })).toEqual({ mirrored: true, cant: 45, lateralOffset: 1 });
 await offset.fill('0'); await offset.press('Tab');
 expect(await page.evaluate(() => window.glider.aircraft.verticalTail.lateralOffset)).toBe(0);
 await cant.fill('-10'); await cant.press('Tab');
 const safeOffset = await page.evaluate(() => window.glider.aircraft.verticalTail.lateralOffset!);
 expect(safeOffset).toBeGreaterThan(0);
 expect(safeOffset).toBeLessThanOrEqual(1);
 await page.getByRole('textbox', { name: '飞机名称', exact: true }).fill('镜像辅助翼回归');
 await page.getByRole('textbox', { name: '飞机名称', exact: true }).press('Tab');
 await page.getByRole('button', { name: '保存', exact: true }).click();
 const saved = await page.evaluate(() => window.glider.aircraft);
 await page.getByRole('button', { name: '重置设计', exact: true }).click();
 await page.getByRole('button', { name: '机库', exact: true }).click();
 await page.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名镜像辅助翼回归', exact: true }) }).getByRole('button', { name: '加载', exact: true }).click();
 expect(await page.evaluate(() => window.glider.aircraft)).toEqual(saved);
 for (const [locale, label] of [['en', 'Mirror vertical auxiliary wing'], ['ja', '垂直補助翼をミラー配置']] as const) {
  await page.getByRole('combobox', { name: /语言|Language|言語/, exact: true }).selectOption(locale);
  await expect(page.getByRole('switch', { name: label, exact: true })).toHaveAttribute('aria-checked', 'true');
 }
 expect(errors).toEqual([]);
});
