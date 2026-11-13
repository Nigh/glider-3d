import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const fixture = fileURLToPath(new URL('./fixtures/review56-twin.json', import.meta.url));

async function load(page: Page) {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/');
 await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
 await page.locator('.welcome').getByRole('button', { name: '测试空间', exact: false }).click();
 await page.getByRole('button', { name: '机库', exact: true }).click();
 await page.getByLabel('导入飞机文件', { exact: true }).setInputFiles(fixture);
 await expect.poll(() => page.evaluate(() => window.glider.aircraft.name)).toBe('基础双发型Test');
}

test('review测试机风洞按真实模型列出阻力，区分迎角且面板止于升阻比，三语完整可读', async ({ page }, info) => {
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 await load(page); await page.keyboard.press('w');
 await page.getByRole('spinbutton', { name: '气流速度数值', exact: true }).fill('31');
 await page.getByRole('spinbutton', { name: '俯仰角度数值', exact: true }).fill('1.3');
 await page.getByRole('button', { name: '开启风洞', exact: true }).click();
 await expect.poll(() => page.evaluate(() => Math.abs((window as any).glider.laboratory.wind.pitch - 1.3)), { timeout: 45_000 }).toBeLessThan(0.001);
 await page.getByRole('button', { name: '输入设置', exact: true }).click();
 const sample = await page.evaluate(() => {
  const a = (window as any).glider.telemetry.aerodynamics;
  return { total: -a.drag.dot(a.dragAxis), terms: Object.fromEntries(Object.entries(a.dragTerms).map(([key, force]: [string, any]) => [key, -force.dot(a.dragAxis)])) };
 });
 const rows = page.locator('.aero-live [data-drag-term]');
 await expect(rows).toHaveCount(11);
 await expect(page.locator('[data-drag-term="total"] dd')).toHaveText(sample.total.toFixed(2) + ' N');
 for (const [key, value] of Object.entries(sample.terms)) await expect(page.locator(`[data-drag-term="${key}"] dd`)).toHaveText((value as number).toFixed(2) + ' N');
 const values = await rows.locator('dd').allTextContents();
 expect(values.slice(1).reduce((sum, value) => sum + parseFloat(value), 0)).toBeCloseTo(parseFloat(values[0]), 1);
 await expect(page.locator('[data-polar-limit],[data-airfoil-live],[data-reynolds-range]')).toHaveCount(0);
 await expect(page.locator('.aero-live dt').last()).toHaveText('升阻比');
 await expect(page.locator('.aero-live p')).toHaveCount(0);
 const body = page.locator('.aero-live div').filter({ has: page.getByText('机身攻角', { exact: true }) });
 const geometric = page.locator('.aero-live div').filter({ has: page.getByText('主翼几何攻角', { exact: true }) });
 await expect(body.locator('dd')).toHaveText('1.30 °'); await expect(geometric.locator('dd')).toHaveText('5.30 °');
 await page.getByRole('dialog', { name: '输入设置', exact: true }).getByRole('button', { name: '保存', exact: true }).first().click();
 for (const [locale, label] of [['zh','座舱与罩体表面摩擦'],['en','Cockpit / canopy skin friction'],['ja','コックピット・風防の表面摩擦']]) {
  await page.locator('.language-label select').selectOption(locale);
  await expect(page.locator('[data-drag-term="bodySkin"] dt')).toHaveText(label);
  const overflow = await page.locator('.aero-live').evaluate(panel => {
   const bounds = panel.getBoundingClientRect();
   return [...panel.querySelectorAll('dt,dd,p')].some(node => {const rect = node.getBoundingClientRect();return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;});
  });
  expect(overflow).toBe(false);
  await page.screenshot({ path: info.outputPath(`review-drag-${locale}.png`) });
 }
 expect(errors).toEqual([]);
});

test('飞行只显示诱导与非诱导两项，风洞往返不泄漏详细分项', async ({ page }) => {
 await load(page); await page.keyboard.press('Space');
 const toggle = page.getByRole('switch', { name: '气动图层', exact: true });
 if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click();
 const rows = page.locator('.aero-live [data-drag-term]');
 await expect(rows).toHaveCount(3);
 await expect(rows.locator('dt')).toHaveText(['阻力','非诱导阻力','诱导阻力']);
 await page.keyboard.press('Escape'); await page.keyboard.press('w');
 await expect(rows).toHaveCount(11);
 await page.keyboard.press('Escape'); await page.keyboard.press('Space');
 await expect(rows).toHaveCount(3);
});
