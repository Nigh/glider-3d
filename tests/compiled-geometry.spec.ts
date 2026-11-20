import { expect, test, type Page } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import type { AircraftDefinition } from '../src/model';
import type * as ModelModule from '../src/model';
import type * as PhysicsModule from '../src/physics';
import type * as ReplayModule from '../src/replay';
import type * as GeometryCacheModule from '../src/compiled-geometry-cache';
import type { WindTunnelSettings } from '../src/laboratory';

// Load application modules in the browser; inspect rendered output through read-only diagnostics.
interface BrowserDiagnostics {
 aircraft: AircraftDefinition; state: string; recordingLength: number;
 scene: { compiledGeometry: { key: string; partitions: number; bodyParts: number } | null;
  structureRendering: { wings: { vertices: number; finite: boolean }[] } };
 laboratory: { wind: WindTunnelSettings }; ghost: { ready: boolean } | null;
 elapsedTime?: number; windGeometry: { busy: boolean; error: string };
}
type BrowserWindow = Window & { readonly glider: BrowserDiagnostics };

async function open(page: Page, locale = 'zh') {
 await page.addInitScript(locale => localStorage.setItem('aero-formula.language', locale), locale);
 await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
 await page.goto('/', { waitUntil: 'domcontentloaded' });
 await page.getByRole('combobox', { name: /画质|Quality|画質/, exact: true }).selectOption('Low');
}

async function overlapDesign(page: Page) {
 const definition = await page.evaluate(async () => {
  const path = '/src/model.ts', model: typeof ModelModule = await import(path), definition = (window as BrowserWindow).glider.aircraft;
  const { clone, wing } = model;
  definition.mainWing = wing(4, 0.8, 0.6); definition.mainWing.controlSurface = 0;
  definition.horizontalTail = clone(definition.mainWing); definition.auxiliaryWings = [];
  definition.mainWing.rootReference = definition.horizontalTail.rootReference = 0;
  Object.assign(definition.assembly, { mainWing: 0, horizontalTail: 0, mainWingHeight: 0, mainIncidence: 0, tailIncidence: 0, tailOnFin: false });
  return definition;
 });
 await page.getByRole('button', { name: '机库', exact: true }).click();
 await page.getByLabel('导入飞机文件', { exact: true }).setInputFiles({ name: 'overlapping-wings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)) });
 await expect(page.locator('.editor')).toBeVisible();
 return page.evaluate(() => (window as BrowserWindow).glider.aircraft);
}

test('设计保留交叠蒙皮，风洞真实使用Worker布尔结果并保留渐进安装角', async ({ page }, info) => {
 test.setTimeout(120000);
 await open(page); await page.locator('.welcome').getByRole('button', { name: /风洞/ }).click();
 const original = await overlapDesign(page);
 const profileGap = await page.evaluate(async () => {
  const path = '/src/model.ts', model: typeof ModelModule = await import(path), definition = (window as BrowserWindow).glider.aircraft;
  let gap = 0;
  for (const side of [-1, 1]) for (const span of [0, 0.6, 1.3, 2]) for (const u of [0, 0.25, 0.7, 1]) for (const normal of [-0.02, 0, 0.02]) {
   const main = model.wingInstancePoint(definition, 0, side, span, u, normal, { x: 0, y: 0, z: 0 });
   const tail = model.wingInstancePoint(definition, 1, side, span, u, normal, { x: 0, y: 0, z: 0 });
   gap = Math.max(gap, Math.hypot(main.x - tail.x, main.y - tail.y, main.z - tail.z));
  }
  return gap;
 });
 expect(profileGap).toBeLessThan(1e-12);
 await expect.poll(() => page.evaluate(() => (window as BrowserWindow).glider.scene.compiledGeometry)).toBeNull();
 const raw = await page.evaluate(() => (window as BrowserWindow).glider.scene.structureRendering.wings.map(wing => wing.vertices));
 expect(raw[0]).toBeGreaterThan(0); expect(raw[1]).toBeGreaterThan(0);
 await page.getByRole('button', { name: /前往风洞/ }).click();
 await expect.poll(() => page.evaluate(() => (window as BrowserWindow).glider.scene.compiledGeometry?.partitions), { timeout: 90000 }).toBeGreaterThan(0);
 const result = await page.evaluate(() => {
  const app = (window as BrowserWindow).glider;
  return { actual: app.scene.structureRendering.wings.map(wing => wing.vertices), definition: app.aircraft,
   finite: app.scene.structureRendering.wings.every(wing => wing.finite), bodyParts: app.scene.compiledGeometry!.bodyParts };
 });
 expect(result.actual[0]).toBeGreaterThan(0); expect(result.actual[1]).toBe(0);
 expect(result.definition).toEqual(original); expect(result.finite).toBe(true); expect(result.bodyParts).toBeGreaterThan(0);
 await page.screenshot({ path: info.outputPath('compiled-overlap.png') });
 const previousKey = await page.evaluate(() => (window as BrowserWindow).glider.scene.compiledGeometry!.key);
 await page.getByRole('spinbutton', { name: '水平辅助翼安装角数值', exact: true }).fill('8');
 await expect.poll(() => page.evaluate(() => (window as BrowserWindow).glider.laboratory.wind.tailIncidence), { timeout: 90000 }).toBeCloseTo(8, 4);
 await expect.poll(() => page.evaluate(() => (window as BrowserWindow).glider.scene.compiledGeometry!.key)).not.toBe(previousKey);
 await page.getByRole('button', { name: '返回设计', exact: true }).click();
 await expect.poll(() => page.evaluate(() => (window as BrowserWindow).glider.scene.compiledGeometry)).toBeNull();
 expect(await page.evaluate(() => (window as BrowserWindow).glider.aircraft.assembly.tailIncidence)).toBeCloseTo(8, 4);
});

test('试飞、Ghost、回放与seek共用已编译蒙皮，不改变设计', async ({ page }) => {
 test.setTimeout(120000);
 await open(page); await page.locator('.welcome').getByRole('button', { name: /鸟人间/ }).click();
 await page.route('**/src/geometry-worker.ts*', async route => { await delay(350); await route.continue(); });
 await page.route('**/manifold.wasm*', async route => { await delay(350); await route.continue(); });
 await page.getByRole('button', { name: '试飞', exact: true }).click();
 await expect(page.getByRole('dialog', { name: '正在编译飞机表面…', exact: true })).toBeVisible();
 await page.keyboard.press('Space');
 expect(await page.evaluate(() => (window as BrowserWindow).glider.state)).toBe('design');
 await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeVisible({ timeout: 90000 });
 const replay = await page.evaluate(async () => {
  const physicsPath = '/src/physics.ts', replayPath = '/src/replay.ts';
  const physics: typeof PhysicsModule = await import(physicsPath), replay: typeof ReplayModule = await import(replayPath);
  const { FlightSimulation } = physics, { exportReplay } = replay;
  const simulation = new FlightSimulation((window as BrowserWindow).glider.aircraft, 'birdman', 0);
  for (let step = 0; step < 90 && !simulation.ended; step++) simulation.step({ weight: 0, lateral: 0, rudder: 0, elevator: 0, aileron: 0 });
  return exportReplay({ definition: simulation.definition, challenge: 'birdman', recording: simulation.getRecording() });
 });
 await page.getByLabel('选择 Ghost 回放文件', { exact: true }).setInputFiles({ name: 'compiled-ghost.json', mimeType: 'application/json', buffer: Buffer.from(replay) });
 await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeEnabled({ timeout: 90000 });
 await expect.poll(() => page.evaluate(() => (window as BrowserWindow).glider.ghost?.ready)).toBe(true);
 await page.getByRole('button', { name: '开始试飞', exact: true }).click();
 await expect.poll(() => page.evaluate(() => (window as BrowserWindow).glider.recordingLength)).toBeGreaterThan(5);
 await page.keyboard.press('Escape');
 await page.getByRole('button', { name: '试飞', exact: true }).click();
 await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeVisible({ timeout: 90000 });
 expect(await page.evaluate(() => (window as BrowserWindow).glider.scene.structureRendering.wings.every(wing => wing.finite))).toBe(true);
 await page.keyboard.press('Escape');
 await page.getByLabel('导入回放', { exact: true }).setInputFiles({ name: 'compiled-replay.json', mimeType: 'application/json', buffer: Buffer.from(replay) });
 await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeVisible({ timeout: 90000 });
 await page.getByRole('slider', { name: '回放进度', exact: true }).evaluate((element: HTMLInputElement) => { element.value = String(Number(element.max) / 2); element.dispatchEvent(new Event('input', { bubbles: true })); });
 await expect(page.getByLabel('回放时间轴', { exact: true })).toHaveAttribute('aria-busy', 'false');
 const snapshot = await page.evaluate(() => (window as BrowserWindow).glider.scene);
 expect(snapshot.compiledGeometry!.partitions).toBeGreaterThan(0);
 expect(snapshot.structureRendering.wings.every(wing => wing.finite)).toBe(true);
});

test('风洞逐步编译期间继续接受编辑，丢弃等待墙钟及过期目标', async ({ page }) => {
 test.setTimeout(120000);
 await open(page); await page.locator('.welcome').getByRole('button', { name: /风洞/ }).click();
 await overlapDesign(page); await page.getByRole('button', { name: /前往风洞/ }).click();
 await expect.poll(() => page.evaluate(() => (window as BrowserWindow).glider.scene.compiledGeometry?.partitions)).toBeGreaterThan(0);
 await page.evaluate(() => {
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(this: Worker, message: unknown) {
   if (message && typeof message === 'object' && 'changedWingInstances' in message) setTimeout(() => post.call(this, message), 700);
   else post.call(this, message);
  };
 });
 const tail = page.getByRole('spinbutton', { name: '水平辅助翼安装角数值', exact: true });
 await tail.fill('4');
 await expect(page.locator('.flight-sidebar [role="status"][aria-busy="true"]')).toContainText('正在更新风洞表面');
 const waitingTime = await page.evaluate(() => (window as BrowserWindow).glider.elapsedTime);
 await delay(80);
 expect(await page.evaluate(() => (window as BrowserWindow).glider.elapsedTime)).toBe(waitingTime);
 await expect(page.locator('.replay-import-dialog')).not.toBeVisible();
 await tail.fill('-1');
 await page.getByRole('spinbutton', { name: '气流速度数值', exact: true }).fill('12');
 expect(Number(await tail.inputValue())).toBe(-1);
 const angles = await page.evaluate(async () => {
  const result: number[] = [];
  for (let sample = 0; sample < 16; sample++) {
   result.push((window as BrowserWindow).glider.laboratory.wind.tailIncidence);
   await new Promise<void>(resolve => setTimeout(resolve, 50));
  }
  return result;
 });
 expect(angles.every(angle => angle <= 1e-8)).toBe(true);
 await expect.poll(() => page.evaluate(() => (window as BrowserWindow).glider.laboratory.wind.tailIncidence), { timeout: 90000 }).toBeCloseTo(-1, 6);
 await expect.poll(() => page.evaluate(() => (window as BrowserWindow).glider.windGeometry.busy)).toBe(false);
 const accepted = await page.evaluate(async () => {
  const path = '/src/compiled-geometry-cache.ts', cache: typeof GeometryCacheModule = await import(path), app = (window as BrowserWindow).glider;
  const definition = app.aircraft; definition.assembly.tailIncidence = -1;
  return { actual: app.scene.compiledGeometry!.key, expected: cache.geometryKey(definition), elapsed: app.elapsedTime };
 });
 expect(accepted.actual).toBe(accepted.expected);
 expect(accepted.elapsed).toBeGreaterThan(waitingTime!);
});

test('风洞增量Worker失败保留当前完整实体，允许修改目标后继续', async ({ page }) => {
 test.setTimeout(120000);
 await open(page); await page.locator('.welcome').getByRole('button', { name: /风洞/ }).click();
 await overlapDesign(page); await page.getByRole('button', { name: /前往风洞/ }).click();
 await expect.poll(() => page.evaluate(() => (window as BrowserWindow).glider.scene.compiledGeometry?.partitions)).toBeGreaterThan(0);
 const original = await page.evaluate(() => (window as BrowserWindow).glider.scene.compiledGeometry!.key);
 await page.evaluate(() => {
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(this: Worker, message: unknown) {
   if (message && typeof message === 'object' && 'changedWingInstances' in message) throw new Error('wind worker offline');
   post.call(this, message);
  };
 });
 const tail = page.getByRole('spinbutton', { name: '水平辅助翼安装角数值', exact: true });
 await tail.fill('2');
 await expect(page.getByRole('button', { name: '重试表面更新', exact: true })).toBeVisible();
 await expect(page.locator('.toast')).toContainText('风洞表面更新失败');
 expect(await page.evaluate(() => (window as BrowserWindow).glider.scene.compiledGeometry!.key)).toBe(original);
 expect(await page.evaluate(() => (window as BrowserWindow).glider.laboratory.wind.tailIncidence)).toBe(0);
 expect(Number(await tail.inputValue())).toBe(2);
 await expect(page.locator('.replay-import-dialog')).not.toBeVisible();
 const stopped = await page.evaluate(() => (window as BrowserWindow).glider.elapsedTime!);
 await tail.fill('0');
 await expect.poll(() => page.evaluate(() => (window as BrowserWindow).glider.windGeometry.error)).toBe('');
 await expect.poll(() => page.evaluate(() => (window as BrowserWindow).glider.elapsedTime!)).toBeGreaterThan(stopped);
});

test('WASM启动失败保留设计，恢复网络后可重新编译', async ({ page }) => {
 await open(page);
 await page.route('**/manifold.wasm*', route => route.abort());
 await page.locator('.welcome').getByRole('button', { name: /鸟人间/ }).click();
 const original = await page.evaluate(() => (window as BrowserWindow).glider.aircraft);
 await page.getByRole('button', { name: '试飞', exact: true }).click();
 await expect(page.locator('.toast')).toContainText('飞机表面编译失败');
 expect(await page.evaluate(() => (window as BrowserWindow).glider.state)).toBe('design');
 expect(await page.evaluate(() => (window as BrowserWindow).glider.aircraft)).toEqual(original);
 await page.unroute('**/manifold.wasm*');
 await page.getByRole('button', { name: '试飞', exact: true }).click();
 await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeVisible();
 expect(await page.evaluate(() => (window as BrowserWindow).glider.scene.compiledGeometry!.partitions)).toBeGreaterThan(0);
 expect(await page.evaluate(() => (window as BrowserWindow).glider.aircraft)).toEqual(original);
});

for (const [locale, challenge, start, error] of [
 ['zh', '鸟人间', '试飞', '飞机表面编译失败'],
 ['en', 'Birdman', 'Test flight', 'Aircraft surface compilation failed'],
 ['ja', '鳥人間', '試飛', '機体表面を構築できませんでした'],
] as const) test(`Worker失败保留${locale}设计并明确提示`, async ({ page }) => {
 await page.addInitScript(() => {
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
   constructor(url: string | URL, options?: WorkerOptions) {
    if (String(url).includes('geometry-worker.ts')) throw new Error('worker offline');
    super(url, options);
   }
  };
 });
 await open(page, locale);
 await page.locator('.welcome').getByRole('button', { name: new RegExp(challenge, 'i') }).click();
 const before = await page.evaluate(() => (window as BrowserWindow).glider.aircraft);
 await page.getByRole('button', { name: new RegExp(`^${start}$`, 'i') }).click();
 await expect(page.locator('.toast')).toContainText(error);
 expect(await page.evaluate(() => (window as BrowserWindow).glider.state)).toBe('design');
 expect(await page.evaluate(() => (window as BrowserWindow).glider.aircraft)).toEqual(before);
 await expect(page.locator('.replay-import-dialog')).not.toBeVisible();
});
