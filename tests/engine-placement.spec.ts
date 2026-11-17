import { expect, test } from '@playwright/test';
import { engineCatalog } from '../src/engines';

test('双引擎最小侧距使实体相互紧靠，支持精确输入、撤销和重做', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/', { waitUntil: 'domcontentloaded' });
 await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
 await page.getByRole('button', { name: '低空飞行', exact: false }).click();
 await page.getByRole('tab', { name: '动力', exact: true }).click();
 await page.getByRole('combobox', { name: '引擎数量', exact: true }).selectOption('2');
 const height = page.getByRole('spinbutton', { name: '引擎垂直偏移精确值', exact: true });
 await height.fill('1'); await height.press('Tab');
 const offset = page.getByRole('spinbutton', { name: '引擎横向偏移精确值', exact: true });
 await offset.fill('1'); await offset.press('Tab');
 await offset.fill('0'); await offset.press('Tab');
 const radius = engineCatalog['jet-01'].radius;
 await expect(offset).toHaveValue(String(radius));
 const separation = () => page.evaluate(() => {
  const scene = window.glider.scene as unknown as { engines: { visible: boolean; position: { x: number; y: number; z: number } }[] };
  const [left, right] = scene.engines.filter(engine => engine.visible);
  return Math.hypot(left.position.x - right.position.x, left.position.y - right.position.y, left.position.z - right.position.z);
 });
 await expect.poll(separation).toBeCloseTo(2 * radius, 8);
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect(offset).toHaveValue('1');
 await expect.poll(separation).toBeCloseTo(2, 8);
 await page.getByRole('button', { name: '重做', exact: true }).click();
 await expect(offset).toHaveValue(String(radius));
 await expect.poll(separation).toBeCloseTo(2 * radius, 8);
 await offset.fill('0'); await offset.press('Tab');
 await expect(offset).toHaveValue(String(radius));
 await expect.poll(separation).toBeCloseTo(2 * radius, 8);
});
