import { test, expect } from '@playwright/test';
import { clickRangeEdge } from './pointer-controls';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
  // The external optional font must not hold up interaction or screenshots offline.
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

test('pilot view uses a common open cockpit and keeps HUD fixed to the airframe during dragging', async ({ page }, info) => {
  await page.getByRole('button', { name: '高山速降', exact: false }).click();
  await page.getByRole('button', { name: '试飞', exact: true }).click();
  await page.getByRole('combobox', { name: '飞行相机', exact: true }).selectOption('驾驶员');
  const hud = page.getByRole('img', { name: 'HUD', exact: true });
  await expect(hud).toBeVisible();
  const marker = hud.locator('.hud-marker'), before = await marker.getAttribute('d');
  const state = () => page.evaluate(() => ({ exterior: (window as any).glider.scene.aircraftExteriorVisible, interior: (window as any).glider.scene.pilotInteriorVisible }));
  await expect.poll(state).toEqual({ exterior: false, interior: true });
  const size = page.viewportSize()!;
  await page.mouse.move(size.width * 0.55, size.height * 0.48);
  await page.mouse.down(); await page.mouse.move(size.width * 0.55 + 65, size.height * 0.48 + 15, { steps: 5 }); await page.mouse.up();
  await expect.poll(() => marker.getAttribute('d')).not.toBe(before);
  await page.screenshot({ path: info.outputPath('pilot-airframe-hud.png') });
  await page.getByRole('combobox', { name: '飞行相机', exact: true }).selectOption('追尾');
  await expect.poll(state).toEqual({ exterior: true, interior: false });
  await expect(hud).toHaveCount(0);
});

test('imports a complete recording, exports it losslessly and rejects incompatible maps without replacing the design', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const source = await page.evaluate(async () => {
    const { FlightSimulation } = await import('/src/physics.ts');
    const { defaultAircraft } = await import('/src/model.ts');
    const { exportReplay } = await import('/src/replay.ts');
    const sim = new FlightSimulation(defaultAircraft, 'birdman', 0.004);
    for (let i = 0; i < 5000 && !sim.ended; i++) sim.step({ weight: 0, elevator: 0, aileron: 0, rudder: 0 });
    if (!sim.ended) throw Error('Fixture did not finish');
    return { text: await exportReplay({ definition: defaultAircraft, challenge: 'birdman', recording: sim.getRecording() }), result: sim.result };
  });
  const originalDesign = await page.evaluate(() => (window as any).glider.aircraft);
  const invalid = JSON.parse(source.text); invalid.mapHash = 'different-map';
  await page.getByLabel('导入回放', { exact: true }).setInputFiles({ name: 'wrong-map.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole('status')).toContainText('回放地图不匹配');
  expect(await page.evaluate(() => (window as any).glider.aircraft)).toEqual(originalDesign);
  await page.getByLabel('导入回放', { exact: true }).setInputFiles({ name: 'flight.json', mimeType: 'application/json', buffer: Buffer.from(source.text) });
  await page.getByRole('button', { name: '开始试飞', exact: true }).click();
  // Exercise pointer seeking as well as import/export without wall-clock playback.
  await clickRangeEdge(page.getByRole('slider', { name: '回放进度', exact: true }), 'max');
  await expect(page.getByRole('region', { name: '回放时间轴', exact: true })).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 });
  await page.getByRole('button', { name: '继续飞行', exact: true }).click();
  await expect(page.getByRole('region', { name: '飞行结算', exact: true })).toBeVisible({ timeout: 120_000 });
  expect(await page.evaluate(() => (window as any).glider.result)).toEqual(source.result);
  await expect(page.locator('.result-g,.chart-g-line')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('lakewind.best.')))).toEqual([]);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出回放', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported).toEqual(JSON.parse(source.text));
  await page.screenshot({ path: info.outputPath('replay-result.png') });
  expect(errors).toEqual([]);
  await page.keyboard.press('r');
  await expect(page.getByRole('region', { name: '飞行结算', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.glider.flightReady)).toBe(false);
  expect(await page.evaluate(() => window.glider.time)).toBe(0);
});
