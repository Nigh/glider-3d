import { test, expect } from '@playwright/test';
import type { FlightTelemetry } from '../src/physics';
import type { WindTunnelSettings } from '../src/laboratory';

// App exposes these read-only getters; the shared browser declaration omits laboratory details.
type WindDiagnostics = { glider: { time: number; telemetry: Pick<FlightTelemetry, 'force' | 'mass' | 'torque'>; laboratory: { wind: WindTunnelSettings } } };

test.use({ viewport: { width: 1440, height: 1000 } });

test('风洞受力简图使用当前机体系净力，暂停冻结，还原与停风后保留真实载荷', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/');
 await page.getByRole('button', { name: '风洞', exact: false }).click();
 await page.getByRole('button', { name: '前往风洞', exact: false }).click();
 const panel = page.getByRole('region', { name: '当前受力与力矩', exact: true });
 await expect(panel).toBeVisible();
 await expect(panel.locator('output')).toHaveCount(6);
 await page.getByRole('spinbutton', { name: '气流速度数值', exact: true }).fill('12');
 await page.getByRole('spinbutton', { name: '俯仰角度数值', exact: true }).fill('5');
 await page.getByRole('spinbutton', { name: '滚转角度数值', exact: true }).fill('30');
 await page.getByRole('button', { name: '开启风洞', exact: true }).click();
 await expect.poll(() => page.evaluate(() => {
  const wind = (window as unknown as WindDiagnostics).glider.laboratory.wind;
  return wind.speed === 12 && Math.abs(wind.pitch - 5) < 0.01 && Math.abs(wind.roll - 30) < 0.01;
 }), { timeout: 45_000 }).toBe(true);
 await page.getByRole('button', { name: '输入设置', exact: true }).click();
 const values = await page.evaluate(async () => {
  // Vite browser modules cannot load as Node imports because they include aircraft JSON.
  const { GRAVITY: gravity } = await import('/src/physics.ts');
  const frame = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => frame.resolve()));
  await frame.promise;
  const game = (window as unknown as WindDiagnostics).glider, telemetry = game.telemetry, wind = game.laboratory.wind;
  const pitch = wind.pitch * Math.PI / 180, roll = wind.roll * Math.PI / 180;
  const x = telemetry.force.x, y = telemetry.force.y - telemetry.mass * gravity, z = telemetry.force.z;
  const forward = Math.cos(pitch) * x + Math.sin(pitch) * y;
  const vertical = -Math.sin(pitch) * x + Math.cos(pitch) * y;
  const force = [forward, Math.cos(roll) * vertical + Math.sin(roll) * z, -Math.sin(roll) * vertical + Math.cos(roll) * z];
  return {
   actual: [...document.querySelectorAll('.wind-forces output')].map(node => node.textContent!.trim()),
   actualNumbers: [...document.querySelectorAll('.wind-forces output')].map(node => Number(node.textContent!.replace('−', '-').replace(/\s/g, '').match(/[+-]?\d+(?:\.\d+)?/)![0])),
   expectedNumbers: [...force, ...(['x', 'y', 'z'] as const).map(axis => Math.abs(telemetry.torque[axis]))],
   time: game.time,
  };
 });
 values.actualNumbers.forEach((value, index) => expect(value).toBeCloseTo(values.expectedNumbers[index], 0));
 for (const output of await panel.locator('[data-axis^="M"] output').allTextContents()) expect(output).not.toMatch(/[+−-]/);
 await page.evaluate(() => {
  const frame = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => frame.resolve()));
  return frame.promise;
 });
 expect(await page.evaluate(() => window.glider.time)).toBe(values.time);
 expect(await panel.locator('output').allTextContents()).toEqual(values.actual);
 await page.getByRole('dialog', { name: '输入设置', exact: true }).getByRole('button', { name: '保存', exact: true }).first().click();
 await page.getByRole('button', { name: '还原飞机状态', exact: true }).click();
 await expect(panel.locator('output')).toHaveCount(6);
 await expect(panel).not.toContainText(/NaN|Infinity/);
 await page.getByRole('button', { name: '关闭风洞', exact: true }).click();
 await expect.poll(() => page.evaluate(() => (window as unknown as WindDiagnostics).glider.laboratory.wind.speed)).toBe(0);
});

test('受力和力矩可访问名称覆盖中英日三语', async ({ page }) => {
 const locales = [
  { code: 'zh', menu: '风洞', start: '前往风洞', panel: '当前受力与力矩', force: '净外力 · 机体', moment: '重心力矩 · 机体' },
  { code: 'en', menu: 'Wind tunnel', start: 'Enter wind tunnel', panel: 'Current forces and moments', force: 'Net force · Body axes', moment: 'CG moment · Body axes' },
  { code: 'ja', menu: '風洞', start: '風洞へ', panel: '現在の力とモーメント', force: '合外力 · 機体軸', moment: '重心モーメント · 機体軸' },
 ];
 for (const locale of locales) {
  await page.goto('/');
  await page.evaluate(code => localStorage.setItem('aero-formula.language', code), locale.code);
  await page.reload();
  await page.getByRole('button', { name: locale.menu, exact: false }).click();
  await page.getByRole('button', { name: locale.start, exact: false }).click();
  const panel = page.getByRole('region', { name: locale.panel, exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('group', { name: locale.force, exact: true })).toBeVisible();
  await expect(panel.getByRole('group', { name: locale.moment, exact: true })).toBeVisible();
  await expect(panel.getByLabel(`${locale.force} Fx`, { exact: true })).toBeVisible();
  await expect(panel.getByLabel(`${locale.moment} Mz`, { exact: true })).toBeVisible();
 }
});
