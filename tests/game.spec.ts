import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AircraftDefinition } from '../src/model';
import type * as SceneModule from '../src/scene';
import type * as PhysicsModule from '../src/physics';
import type * as ModelModule from '../src/model';
import type { BufferGeometry, Camera, WebGLRenderer } from 'three';

type FlightResult = { distance: number; time: number; averageSpeed: number; maxSpeed: number; minSpeed: number; maxHeight: number; landing: string };
declare global {
  interface Window {
    readonly glider: {
      readonly aircraft: AircraftDefinition;
      readonly state: 'menu' | 'design' | 'flight' | 'result';
      readonly flightReady: boolean;
      readonly time: number;
      readonly recordingLength: number;
      readonly trajectory: { time: number; distance: number; height: number; speed: number; scoringHeight: number; energyRatio: number; energyPerDistance: number | null }[];
      readonly metrics: Record<string, number | string>;
      readonly telemetry: { speed: number; altitude: number; distance: number; pitch: number; roll: number; cg: { x: number }; [key: string]: unknown } | undefined;
      readonly result: FlightResult | null;
      readonly scene: {
        view: string; orthographic: boolean; editing: string | null;
        camera: { x: number; y: number; z: number }; groundHeight: number; shadowVisible: boolean;
        wingRoots: Record<'mainWing' | 'horizontalTail' | 'verticalTail', {
          leading: { x: number; y: number; z: number }; trailing: { x: number; y: number; z: number };
          midpoint: { x: number; y: number; z: number };
        }>;
        support: { visible: boolean; area: number; mass: number };
        editor: {
          target: string | null; hover: string | null;
          parts: { target: string; x: number; y: number }[];
          handles: { index: number; side: number; x: number; y: number }[];
          segments: { id: string; side: number; x1: number; y1: number; x2: number; y2: number }[];
        };
      };
    };
  }
}

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('aero-formula.language')) localStorage.setItem('aero-formula.language', 'zh');
  });
  const messages: string[] = [];
  errors.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: '鸟人间挑战' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.glider?.state)).toBe('menu');
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page), '应用不得产生未捕获异常').toEqual([]);
});

async function aircraft(page: Page) {
  return page.evaluate(() => window.glider.aircraft);
}
async function enterDesign(page: Page) {
  await page.getByRole('button', { name: '鸟人间挑战' }).click();
  await expect(page.getByRole('heading', { name: '飞机工坊' })).toBeVisible();
}
async function expectWaiting(page: Page) {
  await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '低头', exact: true })).toHaveCount(0);
  const storedInputs = await page.evaluate(() => window.glider.recordingLength);
  for (let check = 0; check < 2; check++) {
    expect(await page.evaluate(() => ({
      ready: window.glider.flightReady, time: window.glider.time, inputs: window.glider.recordingLength,
      speed: window.glider.telemetry?.speed, distance: window.glider.telemetry?.distance, samples: window.glider.trajectory.length,
    }))).toEqual({ ready: false, time: 0, inputs: storedInputs, speed: 0, distance: 0, samples: 0 });
    if (check === 0) await page.waitForTimeout(200);
  }
}
async function beginFlight(page: Page) {
  await expectWaiting(page);
  await page.getByRole('button', { name: '开始试飞', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.glider.flightReady)).toBe(true);
}
async function number(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true });
  await input.fill(String(value));
  await input.press('Tab');
}
async function resizeLength(page: Page, length: number) {
  const d = await aircraft(page);
  await number(page, '机头端点精确值', d.fuselage.center - d.fuselage.length / 2 + length);
}
function endsOf(d: AircraftDefinition) {
  return { nose: d.fuselage.center + d.fuselage.length / 2, tail: d.fuselage.center - d.fuselage.length / 2 };
}
async function dragHandle(page: Page, index: number, dx: number, dy: number) {
  const handle = page.getByRole('button', { name: `主翼顶点${index + 1}`, exact: true });
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error('翼面控制点不可见');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}
async function waitResult(page: Page) {
  await expect.poll(() => page.evaluate(() => window.glider.state), { timeout: 90_000 }).toBe('result');
  await expect(page.locator('.results')).toHaveCSS('opacity', '1');
  const resultSurface = await page.locator('.results').evaluate(node => {
    const style = getComputedStyle(node), canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.fillStyle = style.backgroundColor;context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[3] / 255;
  });
  expect(resultSurface).toBeGreaterThan(0.75);
  expect(resultSurface).toBeLessThan(1);
  await expect(page.getByRole('region', { name: '距离高度曲线', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '离台能量守恒', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '能量分配', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '这次飞行的线索', exact: true })).toHaveCount(0);
  await expect(page.getByText('总计时（含助跑）', { exact: true })).toBeVisible();
  const result = await page.evaluate(() => window.glider.result);
  expect(result).not.toBeNull();
  expect(result!.landing).toBe('water');
  for (const key of ['distance', 'time', 'averageSpeed', 'maxSpeed', 'minSpeed', 'maxHeight'] as const) {
    expect(Number.isFinite(result![key]), key).toBe(true);
    expect(result![key], key).toBeGreaterThan(0);
  }
  return result!;
}
async function noOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height + 1);
}
async function insideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('工坊默认自由透视，切换部件保留显式选择的相机', async ({ page }) => {
  await enterDesign(page);
  await expect.poll(() => page.evaluate(() => window.glider.scene.orthographic)).toBe(false);
  const freeView = await page.evaluate(() => window.glider.scene.view);
  for (const tab of ['机身', '主翼', '水平尾翼', '垂直尾翼']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.glider.scene.view)).toBe(freeView);
    expect(await page.evaluate(() => window.glider.scene.orthographic)).toBe(false);
  }
  await page.getByRole('button', { name: '侧视', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.glider.scene.orthographic)).toBe(true);
  const sideView = await page.evaluate(() => window.glider.scene.view);
  for (const tab of ['机身', '主翼', '水平尾翼', '垂直尾翼']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.glider.scene.view)).toBe(sideView);
    expect(await page.evaluate(() => window.glider.scene.orthographic)).toBe(true);
  }
  await page.getByRole('button', { name: '自由', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.glider.scene.orthographic)).toBe(false);
});

test.describe('桌面完整交互', () => {
  test.beforeEach(({ isMobile }) => test.skip(isMobile, '完整桌面链路在 desktop-chromium 项目运行'));

  test('机身、驾驶舱、四点拖翼、尾翼、安装位置、撤销和重做', async ({ page }) => {
    await enterDesign(page);
    await page.getByRole('tab', { name: '机身', exact: true }).click();
    await resizeLength(page, 8.2);
    await number(page, '驾驶舱位置精确值', 1.5);
    expect((await aircraft(page)).fuselage.length).toBeCloseTo(8.2, 8);
    expect((await aircraft(page)).cockpit.position).toBe(1.5);
    await page.getByRole('tab', { name: '主翼', exact: true }).click();
    await page.getByRole('button', { name: '俯视', exact: true }).click();
    for (let i = 0; i < 4; i++) {
      const before = (await aircraft(page)).mainWing.points[i];
      await dragHandle(page, i, i === 1 || i === 2 ? 4 : 0, -4);
      expect((await aircraft(page)).mainWing.points[i].x).not.toBe(before.x);
    }
    const points = (await aircraft(page)).mainWing.points;
    expect(points[0].y).toBe(0);
    expect(points[3].y).toBe(0);
    expect(points[1].y).toBe(points[2].y);
    await expect(page.getByRole('button', { name: '自由', exact: true })).toBeEnabled();
    await number(page, '主翼上反角精确值', 8);
    for (const [tab, key, value] of [
      ['水平尾翼', 'horizontalTail', 2.1], ['垂直尾翼', 'verticalTail', 2.0],
    ] as const) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.getByText('精确编辑四个顶点', { exact: true }).click();
      await number(page, '顶点2展向坐标', value);
      expect((await aircraft(page))[key].points[1].y).toBe(value);
      expect((await aircraft(page))[key].points[2].y).toBe(value);
    }
    await page.getByRole('tab', { name: '主翼', exact: true }).click();
    await page.getByRole('button', { name: '侧视', exact: true }).click();
    const mainHandle = page.getByRole('button', { name: '主翼位置', exact: true });
    const mainBox = await mainHandle.boundingBox();
    if (!mainBox) throw new Error('主翼位置手柄不可见');
    const originalPosition = (await aircraft(page)).assembly.mainWing;
    await page.mouse.move(mainBox.x + mainBox.width / 2, mainBox.y + mainBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(mainBox.x + mainBox.width / 2 + 18, mainBox.y + mainBox.height / 2 - 8, { steps: 8 });
    await page.mouse.up();
    expect((await aircraft(page)).assembly.mainWing).not.toBe(originalPosition);
    for (const [tab, label, value, key] of [
      ['主翼', '主翼纵向位置', 1.1, 'mainWing'], ['主翼', '主翼安装高度', 1.0, 'mainWingHeight'],
      ['主翼', '主翼安装角', 5, 'mainIncidence'], ['水平尾翼', '水平尾翼位置', -3.1, 'horizontalTail'],
      ['水平尾翼', '水平尾翼安装角', -1, 'tailIncidence'], ['垂直尾翼', '垂直尾翼位置', -3.2, 'verticalTail'],
    ] as const) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await number(page, label + '精确值', value);
      expect((await aircraft(page)).assembly[key]).toBe(value);
    }
    const final = await aircraft(page);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await aircraft(page)).assembly.verticalTail).not.toBe(final.assembly.verticalTail);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect(await aircraft(page)).toEqual(final);
    await page.getByRole('tab', { name: '机身', exact: true }).click();
    await resizeLength(page, 9);
    await page.getByRole('heading', { name: '飞机工坊' }).click();
    await page.keyboard.press('ControlOrMeta+z');
    expect((await aircraft(page)).fuselage.length).toBeCloseTo(8.2, 8);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect((await aircraft(page)).fuselage.length).toBeCloseTo(9, 8);
    await page.getByRole('button', { name: '机库', exact: true }).click();
    const preset = page.locator('.saved-plane').filter({ hasText: '鸟人间滑翔基础型' });
    await expect(preset.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
    await preset.getByRole('button', { name: '加载', exact: true }).click();
    expect((await aircraft(page)).name).toBe('鸟人间滑翔基础型');
    await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
    await expect.poll(() => page.evaluate(() => window.glider.metrics.quality)).toBe('Low');
  });

  test('机库保存、刷新加载、命名复制、JSON 导出导入和失败保留设计', async ({ page }, testInfo) => {
    await enterDesign(page);
    await page.getByRole('textbox', { name: '飞机名称', exact: true }).fill('交互测试机');
    await page.getByRole('textbox', { name: '飞机名称', exact: true }).press('Tab');
    await page.getByRole('tab', { name: '机身', exact: true }).click();
    await resizeLength(page, 7.4);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const saved = await aircraft(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enterDesign(page);
    await page.getByRole('button', { name: '机库', exact: true }).click();
    const library = page.getByRole('region', { name: '本地机库' });
    await library.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名交互测试机', exact: true }) }).getByRole('button', { name: '加载', exact: true }).click();
    expect(await aircraft(page)).toEqual(saved);
    await expect(library).toBeHidden();
    await page.getByRole('button', { name: '机库', exact: true }).click();
    await library.getByRole('textbox', { name: '重命名交互测试机', exact: true }).fill('重命名测试机');
    await library.getByRole('textbox', { name: '重命名交互测试机', exact: true }).press('Tab');
    const original = library.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名重命名测试机', exact: true }) });
    await original.getByRole('button', { name: '复制', exact: true }).click();
    await expect(library.locator('.saved-plane').filter({ has: library.getByRole('textbox') })).toHaveCount(2);
    const copy = library.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名重命名测试机 副本', exact: true }) });
    await copy.getByRole('button', { name: '加载', exact: true }).click();
    await expect(library).toBeHidden();
    await page.getByRole('button', { name: '机库', exact: true }).click();
    const exported = { ...await aircraft(page), name: '重命名测试机' };
    const downloadPromise = page.waitForEvent('download');
    await original.locator('summary').click();
    await original.getByRole('button', { name: '导出 JSON', exact: true }).click();
    const download = await downloadPromise;
    const exportPath = testInfo.outputPath('aircraft.json');
    await download.saveAs(exportPath);
    expect(JSON.parse(await readFile(exportPath, 'utf8'))).toEqual(exported);
    await library.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '重置设计', exact: true }).click();
    expect(await aircraft(page)).not.toEqual(exported);
    await page.getByRole('button', { name: '机库', exact: true }).click();
    await library.getByLabel('导入飞机文件', { exact: true }).setInputFiles(exportPath);
    await expect(page.getByRole('status').filter({ has: page.getByRole('button', { name: '关闭提示', exact: true }) })).toContainText('导入成功');
    expect(await aircraft(page)).toEqual(exported);
    await page.getByRole('button', { name: '机库', exact: true }).click();
    await library.getByLabel('导入飞机文件', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await expect(page.getByRole('status').filter({ has: page.getByRole('button', { name: '关闭提示', exact: true }) })).toContainText('导入失败');
    expect(await aircraft(page)).toEqual(exported);
    await expect(library).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await copy.getByRole('button', { name: '删除', exact: true }).click();
    await expect(library.locator('.saved-plane').filter({ has: library.getByRole('textbox') })).toHaveCount(1);
    await original.getByRole('button', { name: '加载', exact: true }).click();
    await expect(library).toBeHidden();
    expect((await aircraft(page)).name).toBe('重命名测试机');
    expect((await aircraft(page)).fuselage.length).toBeCloseTo(7.4, 8);
  });

  test('键鼠飞控、暂停、着水结果、确定性重放、返回改进和再次飞行', async ({ page }) => {
    await enterDesign(page);
    await page.getByRole('button', { name: '前往挑战' }).click();
    await expect.poll(() => page.evaluate(() => window.glider.state)).toBe('flight');
    await beginFlight(page);
    const initialCg = await page.evaluate(() => window.glider.telemetry!.cg.x);
    await page.keyboard.down('w');
    await page.keyboard.down('d');
    await page.waitForTimeout(250);
    await expect.poll(() => page.evaluate(() => window.glider.telemetry!.cg.x)).toBeGreaterThan(initialCg);
    await page.keyboard.up('w');
    await page.keyboard.up('d');
    await page.keyboard.down('x');
    await page.mouse.move(800,400);
    await expect(page.getByLabel('虚拟操纵杆')).toBeVisible();
    await page.keyboard.up('x');
    await expect(page.getByLabel('虚拟操纵杆')).toHaveCount(0);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const stopped = await page.evaluate(() => window.glider.telemetry?.distance);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.glider.telemetry?.distance)).toBe(stopped);
    await page.getByRole('combobox', { name: '飞行相机', exact: true }).selectOption('侧面');
    await page.getByRole('button', { name: '继续飞行', exact: true }).click();
    const first = await waitResult(page);
    const energy = await page.evaluate(() => {
      const t = window.glider.telemetry!;
      return {
        initial: Number(t.initialEnergy),
        total: Number(t.potentialEnergy) + Number(t.kineticEnergy) + Number(t.dissipatedEnergy)
          + Number(t.fuelEnergyRemoved) - Number(t.propulsionWork) - Number(t.controlWork) - Number(t.waterWork),
        dissipated: Number(t.dissipatedEnergy),
      };
    });
    expect(energy.initial).toBeGreaterThan(0);
    expect(energy.dissipated).toBeGreaterThan(0);
    expect(Math.abs(energy.total - energy.initial) / energy.initial).toBeLessThan(1e-6);
    await page.getByRole('button', { name: '重放飞行', exact: true }).click();
    await beginFlight(page);
    const replay = await waitResult(page);
    expect(replay).toEqual(first);
    await page.getByRole('button', { name: '返回设计改进', exact: true }).click();
    await page.getByRole('tab', { name: '机身', exact: true }).click();
    await number(page, '驾驶舱位置精确值', 1.3);
    await page.getByRole('button', { name: '前往挑战' }).click();
    await beginFlight(page);
    await waitResult(page);
    await page.getByRole('button', { name: '再试一次', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.glider.state)).toBe('flight');
    await beginFlight(page);
    expect((await aircraft(page)).cockpit.position).toBe(1.3);
    await page.getByRole('button', { name: '返回设计', exact: true }).click();
    await expect(page.getByRole('heading', { name: '飞机工坊' })).toBeVisible();
  });
});

test('手机竖屏与横屏无页面溢出，保留相机操作并移除虚拟飞控', async ({ page, isMobile, context }) => {
  test.skip(!isMobile, '此测试仅使用触摸视口；不代表真实手机硬件验证');
  await noOverflow(page);
  await enterDesign(page);
  await noOverflow(page);
  for (const tab of ['机身', '主翼', '水平尾翼', '垂直尾翼']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await noOverflow(page);
  }
  await page.getByRole('button', { name: '机库', exact: true }).tap();
  await noOverflow(page);
  await page.getByRole('region', { name: '本地机库' }).getByRole('button', { name: '关闭', exact: true }).tap();
  await insideViewport(page, page.getByRole('button', { name: '前往挑战' }));
  await page.getByRole('button', { name: '前往挑战' }).tap();
  await beginFlight(page);
  await noOverflow(page);
  await expect(page.locator('.flight-controls')).toHaveCount(0);
  await insideViewport(page,page.getByRole('combobox',{name:'飞行相机'}));
  await expect.poll(() => page.evaluate(() => window.glider.telemetry?.distance ?? 0)).toBeGreaterThan(0);
  await waitResult(page);
  await noOverflow(page);
  await insideViewport(page, page.getByRole('button', { name: '返回设计改进', exact: true }));
  await page.getByRole('button', { name: '返回设计改进', exact: true }).tap();
  await noOverflow(page);
});

test('编辑错误和跨飞机撤销不会悄悄改变保存数据', async ({ page }) => {
  await enterDesign(page);
  const originalRoot=(await aircraft(page)).mainWing.points[0].x;
  await page.getByRole('button', { name: '俯视', exact: true }).click();
  await page.getByText('精确编辑四个顶点', { exact: true }).click();
  const root = page.getByRole('spinbutton', { name: '顶点1后向坐标', exact: true });
  await root.fill('2');
  await root.press('Tab');
  await expect(root).toHaveValue(String(originalRoot));
  await expect(page.getByRole('alert')).toContainText('至少 0.15 m');
  expect((await aircraft(page)).mainWing.points[0].x).toBe(originalRoot);
  const before = (await aircraft(page)).mainWing.points[1].y;
  await dragHandle(page, 1, 0, -7);
  expect((await aircraft(page)).mainWing.points[1].y).toBeCloseTo(before, 4);
  await page.getByRole('textbox', { name: '飞机名称', exact: true }).fill('设计 A');
  await page.getByRole('textbox', { name: '飞机名称', exact: true }).press('Tab');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '机库', exact: true }).click();
  await page.locator('.saved-plane').filter({ hasText: '鸟人间滑翔基础型' }).getByRole('button', { name: '加载', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '机库', exact: true }).click();
  const a = page.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名设计 A', exact: true }) });
  await a.getByRole('button', { name: '加载', exact: true }).click();
  await expect(page.getByRole('region', { name: '本地机库' })).toBeHidden();
  await page.getByRole('button', { name: '机库', exact: true }).click();
  const rename = page.getByRole('textbox', { name: '重命名设计 A', exact: true });
  await rename.fill('重命名 A');
  await rename.press('Tab');
  await expect(page.getByRole('textbox', { name: '飞机名称', exact: true })).toHaveValue('重命名 A');
  await page.locator('.library-title').getByRole('button', { name: '关闭', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '机库', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '重命名重命名 A', exact: true })).toHaveValue('重命名 A');
  await expect(page.locator('.saved-plane').filter({ has: page.getByRole('textbox') })).toHaveCount(3);
});

test('相机轨道与飞行视角保持在地表以上，低画质保留湖面阴影', async ({ page, isMobile }) => {
  test.skip(isMobile, '相机鼠标轨道在桌面验证');
  await enterDesign(page);
  await page.getByRole('tab', { name: '机身', exact: true }).click();
  await page.getByRole('button', { name: '自由', exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(1050, 420);
    await page.mouse.down();
    await page.mouse.move(1050, 140, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => {
      const s = window.glider.scene;
      return s.camera.y - s.groundHeight;
    })).toBeGreaterThanOrEqual(0.549);
  }
  await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
  await page.getByRole('button', { name: '前往挑战' }).click();
  await beginFlight(page);
  await expect.poll(() => page.evaluate(() => window.glider.telemetry?.distance ?? 0), { timeout: 20_000 }).toBeGreaterThan(30);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  for (const camera of ['追尾', '侧追尾', '侧面', '驾驶员', '自由']) {
    await page.getByRole('combobox', { name: '飞行相机', exact: true }).selectOption(camera);
    await expect.poll(() => page.evaluate(() => {
      const s = window.glider.scene;
      return s.camera.y - s.groundHeight;
    })).toBeGreaterThanOrEqual(0.549);
  }
  expect(await page.evaluate(() => window.glider.scene.shadowVisible)).toBe(true);
});

test('飞行视角拖动回正，锁定禁止拖动，自由视角保持环绕并支持滚轮缩放', async ({ page, isMobile }) => {
  test.skip(isMobile, '鼠标拖动在桌面验证');
  await enterDesign(page);
  await page.getByRole('button', { name: '前往挑战' }).click();
  type CameraPoint = { x: number; y: number; z: number };
  const snapshot = () => page.evaluate(() => {
    const scene = window.glider.scene as typeof window.glider.scene & { target: { x: number; y: number; z: number } };
    return [scene.camera, scene.target];
  });
  const distance = (a: CameraPoint[], b: CameraPoint[]) =>
    a.reduce((sum, point, index) => sum + Math.hypot(point.x - b[index].x, point.y - b[index].y, point.z - b[index].z), 0);
  for (const name of ['追尾', '锁定', '侧追尾', '侧面', '驾驶员', '自由']) {
    await page.getByRole('combobox', { name: '飞行相机', exact: true }).selectOption(name);
    const before = await snapshot();
    await page.mouse.move(1000, 420); await page.mouse.down();
    await page.mouse.move(1120, 470, { steps: 8 }); await page.mouse.up();
    const dragged = await snapshot();
    if (name === '锁定') {
      expect(distance(before, dragged)).toBeLessThan(0.001);
      continue;
    }
    expect(distance(before, dragged)).toBeGreaterThan(1);
    expect(name === '驾驶员' ? dragged[1].y : dragged[0].y).toBeGreaterThan(name === '驾驶员' ? before[1].y : before[0].y);
    if (name === '自由') {
      let settled = dragged;
      // Orbit damping advances per rendered frame; wait for convergence on slow hosts.
      await expect.poll(async () => {
        const previous = settled;
        await page.waitForTimeout(1_000);
        settled = await snapshot();
        return distance(previous, settled);
      }, { timeout: 25_000, intervals: [100] }).toBeLessThan(0.005);
      expect(distance(before, settled)).toBeGreaterThan(1);
      await page.waitForTimeout(4_000);
      expect(distance(settled, await snapshot())).toBeLessThan(0.05);
      const radius = Math.hypot(settled[0].x - settled[1].x, settled[0].y - settled[1].y, settled[0].z - settled[1].z);
      await page.mouse.wheel(0, 400);
      await expect.poll(async () => {
        const points = await snapshot();
        return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y, points[0].z - points[1].z);
      }).toBeGreaterThan(radius * 1.1);
      continue;
    }
    if (name === '追尾') {
      await page.waitForTimeout(4_000);
      expect(distance(before, await snapshot())).toBeGreaterThan(distance(before, dragged) * 0.5);
    }
    await expect.poll(async () => distance(before, await snapshot()), { timeout: 25_000 }).toBeLessThan(0.3);
  }
});

test('结算拖动只改变仰角，按住鼠标仍自动环绕', async ({ page, isMobile }) => {
  test.skip(isMobile, '鼠标交互在桌面验证');
  await enterDesign(page);
  await page.getByRole('button', { name: '前往挑战' }).click();
  await beginFlight(page);
  await expect(page.locator('.results')).toBeVisible({ timeout: 90_000 });
  const snapshot = () => page.evaluate(() => {
    const { camera, aircraft } = window.glider.scene;
    return { bearing: Math.atan2(camera.x - aircraft.x, camera.z - aircraft.z), height: camera.y };
  });
  const turn = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const before = await snapshot();
  await page.mouse.move(450, 260); await page.mouse.down();
  await page.mouse.move(650, 260, { steps: 8 });
  const horizontal = await snapshot();
  expect(Math.abs(turn(before.bearing, horizontal.bearing))).toBeLessThan(0.3);
  expect(horizontal.height).toBeCloseTo(before.height, 5);
  await expect.poll(async () => turn(horizontal.bearing, (await snapshot()).bearing)).toBeGreaterThan(0.04);
  await page.mouse.move(650, 210, { steps: 8 });
  expect((await snapshot()).height).toBeLessThan(horizontal.height);
  await page.mouse.up();
});

test('120Hz侧面飞行无交替抖动，暂停、恢复和新飞行不回跳', async ({ page, isMobile }) => {
  test.skip(isMobile, '高刷新率回归在 desktop-chromium 项目运行');
  const result = await page.evaluate(async () => {
    // evaluate 在浏览器执行，必须从 Vite 加载真实模块，不能使用 Node 侧的静态值导入。
    const scenePath = '/src/scene.ts', physicsPath = '/src/physics.ts', modelPath = '/src/model.ts';
    const { SceneView } = await import(scenePath) as typeof SceneModule;
    const { FlightSimulation } = await import(physicsPath) as typeof PhysicsModule;
    const { defaultAircraft } = await import(modelPath) as typeof ModelModule;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:960px;height:600px;z-index:10000';
    document.body.appendChild(host);
    let view: InstanceType<typeof SceneView> | undefined;
    try {
      view = new SceneView(host);
      view.setQuality('Low');
      const sim = new FlightSimulation(defaultAircraft, 'birdman', 0);
      view.setFlight(sim);
      view.cameraView('侧面');
      const fixedDt = 1 / 60, renderDt = 1 / 120;
      const controls = { weight: 0, rudder: 0, elevator: 0, aileron: 0 };
      let accumulator = 0;
      const frame = () => {
        accumulator += renderDt;
        while (accumulator >= fixedDt) {
          view!.captureFlightState();
          sim.step(controls, fixedDt);
          accumulator -= fixedDt;
        }
        view!.render(renderDt, accumulator / fixedDt);
      };
      // 只借用相机做屏幕投影；飞机位置来自公开诊断，不读取插值内部状态。
      const projectionView = view as unknown as { camera: Camera };
      const projectedX = () => {
        const position = sim.position.clone().copy(view!.getDiagnostics().aircraft).project(projectionView.camera);
        return (position.x + 1) * host.clientWidth / 2;
      };
      const positionError = (flight: InstanceType<typeof FlightSimulation>) =>
        flight.position.clone().copy(view!.getDiagnostics().aircraft).distanceTo(flight.position);
      for (let i = 0; i < 240; i++) frame();
      const startX = sim.position.x;
      const pixels = [projectedX()];
      for (let i = 0; i < 120; i++) {
        frame();
        pixels.push(projectedX());
      }
      const travelled = sim.position.x - startX;
      const active = !sim.ended && !sim.replayFinished;
      // 忽略小于 0.02 CSS 像素的数值噪声，允许平滑轨迹出现少量自然转向。
      const deltas = pixels.slice(1).map((x, i) => x - pixels[i]);
      const reversals = deltas.slice(1).filter((dx, i) =>
        dx * deltas[i] < 0 && Math.min(Math.abs(dx), Math.abs(deltas[i])) > 0.02).length;
      const beforePause = sim.position.clone();
      for (let i = 0; i < 12; i++) view.render(renderDt, 1);
      const pausedError = positionError(sim);
      const pausedSimulationError = sim.position.distanceTo(beforePause);
      view.captureFlightState();
      accumulator = 0;
      frame(); // 恢复首个半步尚未推进物理，必须停留在暂停时的真实位置。
      const resumedError = positionError(sim);
      frame();
      frame();
      const resumedMidpoint = beforePause.clone().lerp(sim.position, 0.5);
      const resumedMidpointError = resumedMidpoint.distanceTo(
        sim.position.clone().copy(view.getDiagnostics().aircraft));
      const fresh = new FlightSimulation(defaultAircraft, 'birdman', 0);
      const flightSeparation = fresh.position.distanceTo(sim.position);
      view.setFlight(fresh);
      view.render(renderDt, 0);
      const freshStartError = positionError(fresh);
      view.render(renderDt, 0.5);
      return {
        finite: pixels.every(Number.isFinite), frames: deltas.length, travelled, active, reversals,
        pausedError, pausedSimulationError, resumedError, resumedMidpointError,
        flightSeparation, freshStartError, freshMidpointError: positionError(fresh),
      };
    } finally {
      view?.dispose();
      host.remove();
    }
  });
  expect(result.finite).toBe(true);
  expect(result.frames).toBe(120);
  expect(result.active).toBe(true);
  expect(result.travelled).toBeGreaterThan(5);
  expect(result.reversals, '飞机屏幕投影不得随物理步交替前后抖动').toBeLessThanOrEqual(2);
  expect(result.flightSeparation).toBeGreaterThan(5);
  for (const key of [
    'pausedError', 'pausedSimulationError', 'resumedError', 'resumedMidpointError',
    'freshStartError', 'freshMidpointError',
  ] as const) {
    expect(result[key], key).toBeLessThan(1e-10);
  }
});

test('空格开始、暂停与继续，C键循环视角，输入焦点不触发快捷键', async ({ page }) => {
  await enterDesign(page);
  await page.getByRole('button', { name: '前往挑战' }).click();
  await expectWaiting(page);
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  await expectWaiting(page);
  const cg = await page.evaluate(() => window.glider.telemetry!.cg.x);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.glider.time)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.glider.telemetry!.cg.x)).toBe(cg);
  await expect(page.getByRole('progressbar', { name: '重心操纵输入' })).toHaveCount(0);
  await page.keyboard.up('w');
  await page.keyboard.up('d');
  await page.keyboard.press('Space');
  await expect(page.locator('.pause-banner')).toBeVisible();
  const stopped = await page.evaluate(() => window.glider.time);
  const camera = page.getByRole('combobox', { name: '飞行相机', exact: true });
  for (const view of ['锁定', '侧追尾', '侧面', '驾驶员', '自由', '追尾']) {
    await page.keyboard.press('c');
    await expect(camera).toHaveValue(view);
  }
  expect(await page.evaluate(() => window.glider.time)).toBe(stopped);
  await camera.selectOption('驾驶员');
  await page.locator('.flight-hud').click();
  await page.keyboard.press('c');
  await expect(camera).toHaveValue('自由');
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.glider.time)).toBeGreaterThan(stopped);
  await page.getByRole('button', { name: '返回设计', exact: true }).click();
  const name = page.getByRole('textbox', { name: '飞机名称', exact: true });
  await name.fill('测试');
  await name.press('Space');
  await name.press('c');
  await expect(name).toHaveValue('测试 c');
  // Issue #39 keeps the selected flight camera across new flights.
  expect(await page.evaluate(() => localStorage.getItem('aero-formula.flight-camera'))).toBe('自由');
  await page.getByRole('navigation', { name: '游戏流程' }).getByRole('button', { name: '试飞', exact: true }).click();
  await expectWaiting(page);
  await expect(camera).toHaveValue('自由');
});

test('主视图持续展示三翼结果，安装角滑条实时改变气动数值', async ({ page }) => {
  await enterDesign(page);
  const instruments = page.getByRole('region', { name: '设计实时仪表', exact: true });
  const preview = instruments.getByRole('region', { name: '三翼气动力预览', exact: true });
  await expect(preview.getByRole('row')).toHaveCount(4);
  for (const tab of ['主翼', '水平尾翼', '垂直尾翼', '机身']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await insideViewport(page, instruments);
    for (const name of ['重心X', '全机升力中心X', '全机阻力中心X', '静稳定裕度', '估算失速速度']) {
      await insideViewport(page, instruments.getByLabel(name, { exact: true }));
    }
    for (const wing of ['主翼', '水平尾翼', '垂直尾翼']) {
      await insideViewport(page, preview.getByRole('row', { name: wing + '气动作用', exact: true }));
    }
  }
  for (const wing of ['主翼', '水平尾翼']) {
    await page.getByRole('tab', { name: wing, exact: true }).click();
    const outputs = ['有效攻角', '升力', '阻力', '俯仰力矩'].map(metric => preview.getByLabel(wing + metric, { exact: true }));
    const before = await Promise.all(outputs.map(output => output.textContent()));
    const slider = page.getByRole('slider', { name: wing + '安装角', exact: true });
    await slider.focus();
    for (let step = 0; step < 20; step++) await slider.press('ArrowRight');
    for (let index = 0; index < outputs.length; index++) {
      await expect(outputs[index]).not.toHaveText(before[index]!);
      expect(Number.isFinite(Number(await outputs[index].textContent()))).toBe(true);
      await insideViewport(page, outputs[index]);
    }
  }
  const vertical = preview.getByRole('row', { name: '垂直尾翼气动作用', exact: true });
  const beforeVertical = await vertical.textContent();
  await page.getByRole('tab', { name: '垂直尾翼', exact: true }).click();
  await page.getByText('精确编辑四个顶点', { exact: true }).click();
  const d = await aircraft(page);
  await number(page, '顶点2展向坐标', d.verticalTail.points[1].y + 0.5);
  await expect(vertical).not.toHaveText(beforeVertical!);
  const stall = instruments.getByLabel('估算失速速度', { exact: true });
  const beforeStall = Number(await stall.textContent());
  expect(beforeStall).toBeGreaterThan(0);
  await page.getByRole('tab', { name: '主翼', exact: true }).click();
  await page.getByText('精确编辑四个顶点', { exact: true }).click();
  await number(page, '顶点2展向坐标', (await aircraft(page)).mainWing.points[1].y + 1);
  await expect(stall).not.toHaveText(String(beforeStall));
  expect(Number(await stall.textContent())).toBeLessThan(beforeStall);
});

test('拥挤翼型的外伸手柄可分别拖动且不改变弦长', async ({ page }) => {
  await enterDesign(page);
  for (const [tab, key] of [['主翼', 'mainWing'], ['水平尾翼', 'horizontalTail'], ['垂直尾翼', 'verticalTail']] as const) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await page.getByRole('button', { name: tab === '垂直尾翼' ? '侧视' : '俯视', exact: true }).click();
    await page.getByText('精确编辑四个顶点', { exact: true }).click();
    await number(page, '顶点2展向坐标', 0.25);
    await number(page, '顶点3后向坐标', 0.45);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const overlay = page.locator('.scene-editor');
    const controls = await overlay.evaluate(svg => {
      const points = Array.from(svg.querySelectorAll<SVGGElement>('g[data-handle]')).filter(g => g.style.display !== 'none').map(g => {
        const matrix = g.transform.baseVal.consolidate()!.matrix;
        return { x: matrix.e, y: matrix.f };
      });
      const knobs = Array.from(svg.querySelectorAll<SVGCircleElement>('[data-segment-knob]')).filter(c => (c.parentElement as unknown as SVGElement).style.display !== 'none').map(c => ({ x: c.cx.baseVal.value, y: c.cy.baseVal.value }));
      return [...points, ...knobs];
    });
    for (let i = 0; i < controls.length; i++) for (let j = 0; j < i; j++) {
      expect(Math.hypot(controls[i].x - controls[j].x, controls[i].y - controls[j].y)).toBeGreaterThanOrEqual(51.9);
    }
    for (const id of ['14', '23']) {
      const before = (await aircraft(page))[key].points;
      const knob = overlay.locator(`g[data-segment="${id}"][data-side="1"] [data-segment-knob]`);
      const box = (await knob.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10, { steps: 4 });
      await page.mouse.up();
      const after = (await aircraft(page))[key].points;
      const first = id === '14' ? 0 : 1, last = id === '14' ? 3 : 2;
      expect(after[last].x - after[first].x).toBeCloseTo(before[last].x - before[first].x, 8);
      expect(after[first].x).not.toBe(before[first].x);
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    }
    const before = (await aircraft(page))[key].points;
    const vertex = overlay.locator('g[data-handle="1"] circle').nth(1);
    const box = (await vertex.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 - 10, { steps: 4 });
    await page.mouse.up();
    const after = (await aircraft(page))[key].points;
    expect(after[1]).not.toEqual(before[1]);
    expect(after[2].x).toBe(before[2].x);
  }
});

test('翼弦线段整体拖动保留弦长，垂直轻吸附可用Ctrl绕过', async ({ page, isMobile }) => {
  test.skip(isMobile, '鼠标与Ctrl组合在桌面验证；数字输入提供触摸替代');
  await enterDesign(page);
  await page.getByRole('button', { name: '俯视', exact: true }).click();
  for (const segment of ['14', '23']) {
    const before = (await aircraft(page)).mainWing.points;
    const line = page.locator(`.scene-editor g[data-segment="${segment}"][data-side="1"] [data-segment-knob]`);
    const box = await line.boundingBox();
    if (!box) throw new Error('翼弦拖动区不可见');
    await page.keyboard.down('Control');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + (segment === '23' ? 16 : 0), box.y + box.height / 2 + 14, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    const after = (await aircraft(page)).mainWing.points;
    const first = segment === '14' ? 0 : 1, last = segment === '14' ? 3 : 2;
    expect(after[first].x).not.toBe(before[first].x);
    expect(after[last].x - after[first].x).toBeCloseTo(before[last].x - before[first].x, 8);
    expect(after[0].y).toBe(0);
    expect(after[3].y).toBe(0);
    expect(after[1].y).toBe(after[2].y);
    if (segment === '23') expect(after[1].y).toBeGreaterThan(before[1].y);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await aircraft(page)).mainWing.points).toEqual(before);
  }
  const points = (await aircraft(page)).mainWing.points;
  const segments = await page.evaluate(() => window.glider.scene.editor.segments);
  const root = segments.find(segment => segment.id === '14' && segment.side === 1)!;
  // 外伸手柄可避让；用真实根弦端点而非手柄显示位置计算投影比例。
  const pixelsPerMetre = (root.y2 - root.y1) / (points[3].x - points[0].x);
  const dy = (0.309 - points[1].x) * pixelsPerMetre;
  await dragHandle(page, 1, 0, dy);
  expect((await aircraft(page)).mainWing.points[1].x).toBeCloseTo(0.3, 6);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.keyboard.down('Control');
  await dragHandle(page, 1, 0, dy);
  await page.keyboard.up('Control');
  expect((await aircraft(page)).mainWing.points[1].x).toBeCloseTo(0.309, 3);
});

test('固定驾驶员质量，端点数值保持对端不动，安装位置受机身支撑限制', async ({ page }) => {
  await enterDesign(page);
  await page.getByRole('tab', { name: '机身', exact: true }).click();
  await expect(page.getByRole('slider', { name: '驾驶员质量', exact: true })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: '驾驶员质量精确值', exact: true })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: '机身长度精确值', exact: true })).toHaveCount(0);
  expect((await aircraft(page)).pilot.mass).toBe(60);
  const initial = await aircraft(page), initialEnds = endsOf(initial);
  await number(page, '机头端点精确值', initialEnds.nose + 0.6);
  let changed = await aircraft(page);
  expect(endsOf(changed).tail).toBeCloseTo(initialEnds.tail, 8);
  expect(changed.fuselage.length).toBeCloseTo(initial.fuselage.length + 0.6, 8);
  expect(changed.fuselage.center).toBeGreaterThan(initial.fuselage.center);
  const nose = endsOf(changed).nose;
  await number(page, '机尾端点精确值', initialEnds.tail - 0.4);
  changed = await aircraft(page);
  expect(endsOf(changed).nose).toBeCloseTo(nose, 8);
  expect(endsOf(changed).tail).toBeCloseTo(initialEnds.tail - 0.4, 8);
  const fixedEnds = endsOf(changed);
  for (const [tab, label] of [['水平尾翼', '水平尾翼位置'], ['垂直尾翼', '垂直尾翼位置'], ['机身', '驾驶舱位置']]) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const input = page.getByRole('spinbutton', { name: label + '精确值', exact: true });
    await input.fill(String(fixedEnds.tail - 1));
    await input.press('Tab');
    const supported = await aircraft(page);
    const value = label === '驾驶舱位置' ? supported.cockpit.position : supported.assembly[label === '水平尾翼位置' ? 'horizontalTail' : 'verticalTail'];
    expect(value).toBeGreaterThanOrEqual(fixedEnds.tail);
    expect(Number(await input.inputValue())).toBeCloseTo(value, 8);
    expect(endsOf(supported)).toEqual(fixedEnds);
  }
  const cockpit = page.getByRole('spinbutton', { name: '驾驶舱位置精确值', exact: true });
  await cockpit.fill(String(fixedEnds.nose + 1));
  await cockpit.press('Tab');
  expect((await aircraft(page)).cockpit.position + 0.95).toBeLessThanOrEqual(fixedEnds.nose + 1e-8);
  await page.getByRole('button', { name: '机库', exact: true }).click();
  const library = page.getByRole('region', { name: '本地机库', exact: true });
  const current = await aircraft(page);
  const legacy = { ...current, fuselage: { length: current.fuselage.length }, pilot: { mass: 97 } };
  // Legacy files had no center. Keep this fixture supported when normalized to center zero.
  legacy.cockpit = { position: 0 };
  legacy.assembly = { ...current.assembly, horizontalTail: -1, verticalTail: -1 };
  await library.getByLabel('导入飞机文件', { exact: true }).setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
  const normalized = await aircraft(page);
  expect(normalized.fuselage.center).toBe(0);
  expect(normalized.pilot.mass).toBe(60);
  await page.getByRole('tab', { name: '机身', exact: true }).click();
  await expect(page.getByLabel('固定驾驶员质量', { exact: true })).toContainText('60 kg');
  const github = page.getByRole('link', { name: 'GitHub 项目源码（新标签页）', exact: true });
  await expect(github).toHaveAttribute('href', 'https://github.com/Nigh/glider-3d');
  await expect(github).toHaveAttribute('target', '_blank');
  await expect(github).toHaveAttribute('rel', /noopener/);
});

test('拖动机身端点不脱离驾驶舱或尾翼，撤销和键盘调整保留独立端点', async ({ page, isMobile }) => {
  test.skip(isMobile, '鼠标拖动在桌面覆盖；触摸设备共用端点数值入口');
  await enterDesign(page);
  await page.getByRole('tab', { name: '机身', exact: true }).click();
  await page.getByRole('button', { name: '侧视', exact: true }).click();
  for (const [label, end, opposite] of [['机头端点', 'nose', 'tail'], ['机尾端点', 'tail', 'nose']] as const) {
    const before = await aircraft(page), originalEnds = endsOf(before);
    const handle = page.getByRole('button', { name: label, exact: true });
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    if (!box) throw new Error('机身端点不可见');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(end === 'nose' ? 15 : page.viewportSize()!.width - 15, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    const changed = await aircraft(page), changedEnds = endsOf(changed);
    expect(changedEnds[end]).not.toBeCloseTo(originalEnds[end], 6);
    expect(changedEnds[opposite]).toBeCloseTo(originalEnds[opposite], 8);
    expect(changed.fuselage.length).toBeGreaterThanOrEqual(3);
    expect(changed.fuselage.length).toBeLessThanOrEqual(12);
    expect(changedEnds.nose).toBeGreaterThanOrEqual(changed.cockpit.position + 0.95 - 1e-8);
    expect(changedEnds.tail).toBeLessThanOrEqual(Math.min(changed.assembly.horizontalTail, changed.assembly.verticalTail, changed.cockpit.position) + 1e-8);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(await aircraft(page)).toEqual(before);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect(await aircraft(page)).toEqual(changed);
    await handle.focus();
    await handle.press(end === 'nose' ? 'ArrowRight' : 'ArrowLeft');
    const keyboardEnds = endsOf(await aircraft(page));
    expect(keyboardEnds[end]).not.toBe(changedEnds[end]);
    expect(keyboardEnds[opposite]).toBeCloseTo(changedEnds[opposite], 8);
  }
});

test('主翼高度滑条与精确值同步，正负支撑质量进入主视图并保留历史', async ({ page }) => {
  await enterDesign(page);
  await page.getByRole('tab', { name: '主翼', exact: true }).click();
  const instruments = page.getByRole('region', { name: '设计实时仪表', exact: true });
  const slider = page.getByRole('slider', { name: '主翼安装高度', exact: true });
  const input = page.getByRole('spinbutton', { name: '主翼安装高度精确值', exact: true });
  const area = instruments.getByLabel('主翼支撑面积', { exact: true });
  const supportMass = instruments.getByLabel('主翼支撑质量', { exact: true });
  const mass = instruments.getByLabel('全备质量', { exact: true });
  await expect(input).toHaveCount(1);
  await number(page, '主翼安装高度精确值', 0);
  const baselineMass = Number(await mass.textContent());
  await expect.poll(() => page.evaluate(() => window.glider.scene.support.visible)).toBe(false);
  await slider.focus();
  await slider.press('Home');
  await expect(input).toHaveValue('-0.5');
  expect((await aircraft(page)).assembly.mainWingHeight).toBe(-0.5);
  const negativeArea = Number(await area.textContent()), negativeMass = Number(await supportMass.textContent());
  expect(negativeArea).toBeGreaterThan(0);
  expect(negativeMass).toBeGreaterThan(0);
  expect(Math.abs(Number(await mass.textContent()) - baselineMass - negativeMass)).toBeLessThan(0.11);
  await slider.press('End');
  await expect(input).toHaveValue('1');
  expect((await aircraft(page)).assembly.mainWingHeight).toBe(1);
  expect(Number(await area.textContent())).toBeCloseTo(negativeArea * 2, 1);
  expect(Number(await supportMass.textContent())).toBeCloseTo(negativeMass * 2, 1);
  expect(Math.abs(Number(await mass.textContent()) - baselineMass - Number(await supportMass.textContent()))).toBeLessThan(0.11);
  for (const output of [area, supportMass, mass]) await insideViewport(page, output);
  await number(page, '主翼安装高度精确值', 0.25);
  await expect(slider).toHaveValue('0.25');
  const quarter = await aircraft(page), quarterMass = await mass.textContent();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(slider).toHaveValue('1');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(await aircraft(page)).toEqual(quarter);
  await number(page, '主翼安装高度精确值', -0.25);
  await expect(slider).toHaveValue('-0.25');
  await expect(mass).toHaveText(quarterMass!);
  expect(await page.evaluate(() => window.glider.scene.wingRoots.mainWing.midpoint.y)).toBeCloseTo(-0.25, 6);
  await number(page, '主翼安装高度精确值', 0);
  expect(Number(await area.textContent())).toBe(0);
  expect(Number(await supportMass.textContent())).toBe(0);
  expect(Number(await mass.textContent())).toBe(baselineMass);
  await expect.poll(() => page.evaluate(() => window.glider.scene.support.visible)).toBe(false);
});

test('尾翼变根形和安装角后翼根仍贴梁，主翼纵向输入保持根中心支撑', async ({ page }) => {
  await enterDesign(page);
  for (const [tab, key] of [['水平尾翼', 'horizontalTail'], ['垂直尾翼', 'verticalTail']] as const) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await page.getByText('精确编辑四个顶点', { exact: true }).click();
    const before = (await aircraft(page))[key].points;
    await number(page, '顶点1后向坐标', before[0].x + 0.2);
    await number(page, '顶点4后向坐标', before[3].x + 0.4);
  }
  await page.getByRole('tab', { name: '水平尾翼', exact: true }).click();
  await number(page, '水平尾翼安装角精确值', 7);
  await number(page, '水平尾翼位置精确值', -1.9);
  await page.getByRole('tab', { name: '垂直尾翼', exact: true }).click();
  await number(page, '垂直尾翼位置精确值', -2.1);
  for (const key of ['horizontalTail', 'verticalTail'] as const) {
    const definition = await aircraft(page);
    const root = await page.evaluate(key => window.glider.scene.wingRoots[key], key);
    expect(root.midpoint.x).toBeCloseTo(definition.assembly[key], 6);
    expect(root.midpoint.y).toBeCloseTo(0, 6);
    expect(root.midpoint.z).toBeCloseTo(0, 6);
    expect((root.leading.x + root.trailing.x) / 2).toBeCloseTo(root.midpoint.x, 6);
    expect((root.leading.y + root.trailing.y) / 2).toBeCloseTo(0, 6);
    expect(Math.hypot(root.trailing.x - root.leading.x, root.trailing.y - root.leading.y)).toBeCloseTo(definition[key].points[3].x - definition[key].points[0].x, 6);
  }
  const horizontal = await page.evaluate(() => window.glider.scene.wingRoots.horizontalTail);
  expect(Math.abs(horizontal.leading.y - horizontal.trailing.y)).toBeGreaterThan(0.01);
  const nose = endsOf(await aircraft(page)).nose;
  await page.getByRole('tab', { name: '主翼', exact: true }).click();
  await number(page, '主翼纵向位置精确值', nose + 2);
  const mainX = page.getByRole('spinbutton', { name: '主翼纵向位置精确值', exact: true });
  expect(Number(await mainX.inputValue())).toBeCloseTo(Number(await mainX.getAttribute('max')), 6);
  expect(await page.evaluate(() => window.glider.scene.wingRoots.mainWing.midpoint.x)).toBeCloseTo(nose, 6);
  await number(page, '主翼安装角精确值', 18);
  expect(await page.evaluate(() => window.glider.scene.wingRoots.mainWing.midpoint.x)).toBeCloseTo(nose, 6);
  await page.getByText('精确编辑四个顶点', { exact: true }).click();
  await number(page, '顶点1后向坐标', -0.3);
  expect(await page.evaluate(() => window.glider.scene.wingRoots.mainWing.midpoint.x)).toBeCloseTo(nose, 6);
  expect(Number(await mainX.inputValue())).toBeCloseTo(Number(await mainX.getAttribute('max')), 6);
});

test('主翼拖近机身吸附，Ctrl保留微小高度，取消拖动不破坏撤销重做', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Ctrl与鼠标取消在桌面覆盖；触摸设备使用相同高度精确值');
  await enterDesign(page);
  await page.getByRole('tab', { name: '主翼', exact: true }).click();
  await number(page, '主翼安装高度精确值', 0.25);
  const baseline = await aircraft(page);
  await page.getByRole('button', { name: '侧视', exact: true }).click();
  await page.getByRole('tab', { name: '机身', exact: true }).click();
  const endpoints = await Promise.all(['机头端点', '机尾端点'].map(name => page.getByRole('button', { name, exact: true }).boundingBox()));
  if (!endpoints[0] || !endpoints[1]) throw new Error('机身端点不可见');
  const pixelsPerMetre = Math.abs((endpoints[0].x + endpoints[0].width / 2) - (endpoints[1].x + endpoints[1].width / 2)) / baseline.fuselage.length;
  await page.getByRole('tab', { name: '主翼', exact: true }).click();
  const mainHandle = page.getByRole('button', { name: '主翼位置', exact: true });
  async function moveHeight(target: number) {
    const box = await mainHandle.boundingBox();
    if (!box) throw new Error('主翼位置手柄不可见');
    const current = (await aircraft(page)).assembly.mainWingHeight;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + (current - target) * pixelsPerMetre, { steps: 8 });
  }
  await moveHeight(0.01);
  await page.mouse.up();
  expect((await aircraft(page)).assembly.mainWingHeight).toBe(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await aircraft(page)).toEqual(baseline);
  await page.keyboard.down('Control');
  await moveHeight(0.01);
  await page.mouse.up();
  await page.keyboard.up('Control');
  const precise = await aircraft(page);
  expect(precise.assembly.mainWingHeight).toBeCloseTo(0.01, 3);
  expect(await page.evaluate(() => window.glider.scene.support.visible)).toBe(true);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await aircraft(page)).toEqual(baseline);
  await moveHeight(-0.2);
  expect((await aircraft(page)).assembly.mainWingHeight).toBeLessThan(0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await aircraft(page)).toEqual(baseline);
  await moveHeight(-0.2);
  await page.locator('.scene-editor').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  expect(await aircraft(page)).toEqual(baseline);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(await aircraft(page)).toEqual(precise);
});

test('尾翼根顶点和根弦拖动跟随光标，翼根中心仍安装在机身梁上', async ({ page, isMobile }) => {
  test.skip(isMobile, '根形鼠标反投影在桌面覆盖，移动端共用同一求解');
  await enterDesign(page);
  for (const [tab, key] of [['水平尾翼', 'horizontalTail'], ['垂直尾翼', 'verticalTail']] as const) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await page.getByRole('button', { name: tab === '垂直尾翼' ? '侧视' : '俯视', exact: true }).click();
    for (const segment of [false, true]) {
      const name = tab + (segment ? '根弦线段1–4' : '顶点1');
      const handle = page.getByRole('button', { name, exact: true });
      const before = await aircraft(page), box = await (segment ? handle.locator('[data-segment-knob]') : handle).boundingBox();
      if (!box) throw new Error('尾翼根拖动区不可见');
      const dx = key === 'verticalTail' ? (segment ? 10 : -10) : 0;
      const dy = key === 'horizontalTail' ? (segment ? -10 : 10) : 0;
      await page.keyboard.down('Control');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 });
      await page.mouse.up();
      await page.keyboard.up('Control');
      const after = await aircraft(page), root = await page.evaluate(key => window.glider.scene.wingRoots[key], key);
      expect(after[key].points).not.toEqual(before[key].points);
      expect(root.midpoint.x).toBeCloseTo(after.assembly[key], 6);
      expect(root.midpoint.y).toBeCloseTo(0, 6);
      if (segment) expect(after.assembly[key]).not.toBe(before.assembly[key]);
      else expect(after.assembly[key]).toBe(before.assembly[key]);
    }
  }
});

test('启动飞行，实时能耗及结算机械能曲线使用真实飞行数据', async ({ page }) => {
  await enterDesign(page);
  await page.getByRole('button', { name: '前往挑战' }).click();
  await expectWaiting(page);
  const start = page.getByRole('button', { name: '开始试飞', exact: true });
  const cost = page.getByLabel('实时能耗', { exact: true });
  await expect(cost).toHaveText('—');
  await start.focus();
  await start.press('Space');
  await expect(start).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.glider.time)).toBeGreaterThan(4.2);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const actualCost = await page.evaluate(() => Number(window.glider.telemetry!.energyPerDistance));
  expect(actualCost).toBeGreaterThan(0);
  await expect(cost).toHaveText(actualCost.toFixed(1));
  await insideViewport(page, cost);
  await page.getByRole('button', { name: '继续飞行', exact: true }).click();
  await waitResult(page);
  const trajectory = await page.evaluate(() => window.glider.trajectory);
  const finalRatio = await page.evaluate(() => {
    const t = window.glider.telemetry!;
    return (Number(t.kineticEnergy)+Number(t.potentialEnergy))/Number(t.initialEnergy);
  });
  expect(trajectory[0].energyRatio).toBeCloseTo(1, 9);
  expect(trajectory.at(-1)!.energyRatio).toBeCloseTo(finalRatio, 12);
  expect(finalRatio).toBeGreaterThan(0);
  expect(finalRatio).toBeLessThan(1);
  for (let i=1;i<trajectory.length;i++) expect(trajectory[i].energyRatio).toBeLessThanOrEqual(trajectory[i-1].energyRatio+1e-10);
  const chart = page.getByRole('region', { name: '距离高度曲线', exact: true });
  const energyLine = chart.locator('.chart-energy-line');
  await energyLine.scrollIntoViewIfNeeded();
  const energyPoints = (await energyLine.getAttribute('points'))!.trim().split(/\s+/).map(point=>point.split(',').map(Number));
  const heightPoints = (await chart.locator('.chart-line').getAttribute('points'))!.trim().split(/\s+/).map(point=>point.split(',').map(Number));
  expect(energyPoints.map(point=>point[0])).toEqual(heightPoints.map(point=>point[0]));
  expect(energyPoints[0][1]).toBeCloseTo(22, 2);
  expect(energyPoints.at(-1)![1]).toBeCloseTo(98-finalRatio*76, 2);
  const finalCost = await page.evaluate(() => Number(window.glider.telemetry!.energyPerDistance));
  const maxCost = Math.max(1,...trajectory.map(p=>p.energyPerDistance??0));
  const costLine = chart.locator('.chart-cost-line');
  const costPoints = (await costLine.getAttribute('d'))!.match(/[ML][\d.]+,[\d.]+/g)!.map(point=>point.slice(1).split(',').map(Number));
  expect(costPoints.at(-1)![0]).toBeCloseTo(heightPoints.at(-1)![0], 2);
  expect(costPoints.at(-1)![1]).toBeCloseTo(98-finalCost/maxCost*76, 2);
  await insideViewport(page, chart.getByText('J/m', { exact: true }));
  await insideViewport(page, chart.getByText('100%', { exact: true }));
  await insideViewport(page, chart.getByText('0%', { exact: true }));
  await noOverflow(page);
});

test('弹射底座随飞机加速，分离后留在轨道末端，暂停和再次试飞保持正确位置', async ({ page, isMobile }) => {
  test.skip(isMobile, '三维弹射状态在桌面运行，几何与移动端共用');
  const result = await page.evaluate(async () => {
    const scenePath = '/src/scene.ts', physicsPath = '/src/physics.ts', modelPath = '/src/model.ts';
    const { SceneView } = await import(scenePath) as typeof SceneModule;
    const { FlightSimulation, LAUNCH } = await import(physicsPath) as typeof PhysicsModule;
    const { defaultAircraft } = await import(modelPath) as typeof ModelModule;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:960px;height:600px';
    document.body.appendChild(host);
    const view = new SceneView(host);
    const sim = new FlightSimulation(defaultAircraft, 'birdman', 0);
    const tree = view as unknown as { scene: import('three').Scene };
    const shuttle = tree.scene.getObjectByName('catapult-shuttle')!;
    const input = { weight: 0, rudder: 0, elevator: 0, aileron: 0 };
    const position = () => shuttle.getWorldPosition(sim.position.clone()).toArray();
    const advance = (frames: number) => {
      for (let i = 0; i < frames; i++) { view.captureFlightState(); sim.step(input); }
      view.render(1 / 60, 1);
      return position();
    };
    try {
      view.setQuality('Low');
      view.setFlight(sim);
      view.render(1 / 60, 1);
      const start = position(), moving = advance(60);
      for (let i = 0; i < 12; i++) view.render(1 / 60, 1);
      const paused = position();
      const end = advance(60), later = advance(60), plane = sim.position.toArray();
      view.setFlight(new FlightSimulation(defaultAircraft, 'birdman', 0));
      view.render(1 / 60, 1);
      return { start, moving, paused, end, later, plane, reset: position(), endX: LAUNCH.endX, height: LAUNCH.height };
    } finally { view.dispose(); host.remove(); }
  });
  expect(result.moving[0]).toBeGreaterThan(result.start[0]);
  expect(result.moving[0]).toBeLessThan(result.endX);
  expect(result.paused).toEqual(result.moving);
  expect(result.end[0]).toBeCloseTo(result.endX, 10);
  expect(result.end[1]).toBeCloseTo(result.height, 10);
  expect(result.later).toEqual(result.end);
  expect(result.plane[0]).toBeGreaterThan(result.later[0] + 3);
  expect(result.reset).toEqual(result.start);
});

test('不同名称保存独立飞机，同名取消保留旧设计、确认才覆盖', async ({ page }) => {
  await enterDesign(page);
  const name = page.getByRole('textbox', { name: '飞机名称', exact: true });
  await name.fill('多机设计甲');
  await name.press('Tab');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const first = await aircraft(page);
  await name.fill('多机设计乙');
  await name.press('Tab');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const second = await aircraft(page);
  await page.getByRole('tab', { name: '机身', exact: true }).click();
  await resizeLength(page, second.fuselage.length + 0.2);
  const changed = await aircraft(page);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '机库', exact: true }).click();
  const secondRow = page.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名多机设计乙', exact: true }) });
  await secondRow.getByRole('button', { name: '加载', exact: true }).click();
  expect(await aircraft(page)).toEqual(second);
  await resizeLength(page, changed.fuselage.length);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await enterDesign(page);
  await page.getByRole('button', { name: '机库', exact: true }).click();
  const library = page.getByRole('region', { name: '本地机库' });
  await expect(library.locator('.saved-plane').filter({ has: library.getByRole('textbox') })).toHaveCount(2);
  await library.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名多机设计甲', exact: true }) }).getByRole('button', { name: '加载', exact: true }).click();
  expect(await aircraft(page)).toEqual(first);
  await expect(library).toBeHidden();
  await page.getByRole('button', { name: '机库', exact: true }).click();
  await library.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名多机设计乙', exact: true }) }).getByRole('button', { name: '加载', exact: true }).click();
  await expect(library).toBeHidden();
  expect(await aircraft(page)).toEqual(changed);
});

test('三翼页整体位置手柄保留顶点，动力页引擎与油箱复用位置操纵', async ({ page }) => {
  await page.getByRole('button', { name: '高山速降', exact: false }).click();
  for (const [tab, key] of [['主翼', 'mainWing'], ['水平尾翼', 'horizontalTail'], ['垂直尾翼', 'verticalTail']] as const) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const before = await aircraft(page);
    const handle = page.getByRole('button', { name: tab + '位置', exact: true });
    await expect(handle).toBeVisible();
    await handle.press('ArrowRight');
    const after = await aircraft(page);
    expect(after.assembly[key]).toBeGreaterThan(before.assembly[key]);
    expect(after[key].points).toEqual(before[key].points);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(await aircraft(page)).toEqual(before);
  }
  await page.getByRole('tab', { name: '动力', exact: true }).click();
  await page.getByRole('combobox', { name: '引擎数量', exact: true }).selectOption('2');
  await page.getByRole('button', { name: '侧视', exact: true }).click();
  for (const [label, key] of [['引擎位置', 'engine'], ['油箱位置', 'fuelTank']] as const) {
    const before = await aircraft(page);
    const handle = page.getByRole('button', { name: label, exact: true });
    await expect(handle).toBeVisible();
    await handle.press('ArrowRight');
    expect((await aircraft(page))[key].x).toBeGreaterThan(before[key].x);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(await aircraft(page)).toEqual(before);
  }
});
test('鸟人间隐藏动力，切换挑战后不保留动力编辑状态', async ({ page }) => {
  await enterDesign(page);
  await expect(page.getByRole('tab', { name: '动力', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  await page.getByRole('button', { name: '高山速降', exact: false }).click();
  await page.getByRole('button', { name: '重置设计', exact: true }).click();
  await page.getByRole('tab', { name: '动力', exact: true }).click();
  await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  await page.getByRole('button', { name: '鸟人间挑战', exact: false }).click();
  await expect(page.getByRole('tab', { name: '动力', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.glider.scene.editing)).not.toBe('propulsion');
  expect((await aircraft(page)).engine.count).toBe(0);
});


for (const [mode, labels] of [
  ['高山速降', ['空速', '下降率']],
  ['低空飞行', ['空速', '离地高度', '剩余燃料']],
] as const) {
  test(`${mode}精简HUD与结果曲线记录真实空速和高度`, async ({ page }) => {
    await page.getByRole('button', { name: mode, exact: false }).click();
    await page.getByRole('button', { name: '前往挑战' }).click();
    const hud = page.getByRole('region', { name: '飞行数据', exact: true });
    await expect(hud.locator('small')).toHaveText([...labels]);
    await expect(page.getByRole('region', { name: '离台能量守恒', exact: true })).toHaveCount(0);
    await beginFlight(page);
    if (mode === '低空飞行') await page.getByRole('slider', { name: '油门', exact: true }).fill('1');
    await expect.poll(() => page.evaluate(() => window.glider.trajectory.length)).toBeGreaterThan(4);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const frozen = await page.evaluate(() => window.glider.trajectory);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.glider.trajectory)).toEqual(frozen);
    await page.getByRole('button', { name: '继续飞行', exact: true }).click();
    await page.keyboard.down('w');
    await expect.poll(() => page.evaluate(() => window.glider.state), { timeout: 120_000 }).toBe('result');
    await page.keyboard.up('w');
    const { samples, telemetry } = await page.evaluate(() => ({ samples: window.glider.trajectory, telemetry: window.glider.telemetry! }));
    expect(samples.length).toBeGreaterThan(5);
    expect(samples.at(-1)!.speed).toBeCloseTo(telemetry.speed, 10);
    expect(samples.at(-1)!.height).toBeCloseTo(telemetry.altitude, 10);
    for (let index = 1; index < samples.length; index++) expect(samples[index].time).toBeGreaterThanOrEqual(samples[index - 1].time);
    await expect(page.getByRole('region',{name:'本次飞行翼面峰值'}).locator('[data-wing]')).toHaveCount(3);
    const speedChart = page.getByRole('region', { name: '距离高度曲线', exact: true });
    await speedChart.scrollIntoViewIfNeeded();
    const speedPoints = (await speedChart.locator('.chart-speed-line').getAttribute('points'))!.trim().split(/\s+/).map(point => point.split(',').map(Number));
    expect(speedPoints).toHaveLength(samples.length);
    const maxTime = Math.max(1, ...samples.map(sample => sample.time));
    const maxSpeed = Math.max(1, ...samples.map(sample => sample.speed));
    expect(speedPoints.at(-1)![0]).toBeCloseTo(38 + samples.at(-1)!.time / maxTime * 290, 2);
    expect(speedPoints.at(-1)![1]).toBeCloseTo(98 - telemetry.speed / maxSpeed * 76, 2);
    const heightChart = page.getByRole('region', { name: '距离高度曲线', exact: true });
    await heightChart.scrollIntoViewIfNeeded();
    await expect(heightChart.locator('.chart-energy-line,.chart-cost-line')).toHaveCount(2);
    await expect(heightChart.locator('.chart-scoring-line')).toHaveCount(mode === '低空飞行' ? 1 : 0);
    if (mode === '低空飞行') {
      expect(samples.at(-1)!.scoringHeight).toBeCloseTo(telemetry.altitude - Number(telemetry.groundClearance) + 25, 10);
      const reference = (await heightChart.locator('.chart-scoring-line').getAttribute('points'))!.trim().split(/\s+/).map(point => point.split(',').map(Number));
      const maxHeight = Math.max(10, ...samples.flatMap(sample => [sample.height, sample.scoringHeight]));
      expect(reference).toHaveLength(samples.length);
      expect(reference.at(-1)![1]).toBeCloseTo(98 - samples.at(-1)!.scoringHeight / maxHeight * 76, 2);
      await expect(heightChart.getByText('计分高度上限 · 接触表面 + 25.0 m', { exact: true })).toBeVisible();
    }
    await noOverflow(page);
  });
}

test('低速助跑翼尖拖尾按距离渐入渐出，失速清除', async ({ page, isMobile }) => {
  test.skip(isMobile, '独立场景几何回归在桌面覆盖，触屏共用同一几何');
  const result = await page.evaluate(async () => {
    // page.evaluate runs in Chromium; static Node imports cannot cross this execution boundary.
    const scenePath = '/src/scene.ts', physicsPath = '/src/physics.ts', modelPath = '/src/model.ts';
    const { SceneView } = await import(scenePath) as typeof SceneModule;
    const { FlightSimulation } = await import(physicsPath) as typeof PhysicsModule;
    const { defaultAircraft } = await import(modelPath) as typeof ModelModule;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:960px;height:600px';
    document.body.appendChild(host);
    const view = new SceneView(host);
    try {
      view.setQuality('Low');
      const sim = new FlightSimulation(defaultAircraft, 'birdman', 0);
      view.setFlight(sim);
      sim.launching = true;
      sim.telemetry.speed = 5;
      sim.telemetry.stall = false;
      for (let index = 0; index < 240; index++) {
        view.captureFlightState();
        sim.time += 1 / 60;
        sim.position.x += 0.2;
        view.render(1 / 60, 1);
      }
      // Inspect private renderer geometry without exposing a production API.
      const renderer = view as unknown as { wingTrailGeometry: BufferGeometry; wingTrail: { material: { opacity: number; blending: number } } };
      const geometry = renderer.wingTrailGeometry;
      const color = geometry.getAttribute('color'), count = geometry.drawRange.count;
      const alpha = Array.from({ length: count }, (_, index) => color.getW(index));
      const opacity = renderer.wingTrail.material.opacity;
      sim.telemetry.stall = true;
      view.render(1 / 60, 1);
      return { count, itemSize: color.itemSize, first: alpha[0], peak: Math.max(...alpha), last: alpha.at(-1), stalled: geometry.drawRange.count, opacity };
    } finally { view.dispose(); host.remove(); }
  });
  expect(result.count).toBeGreaterThan(0);
  expect(result.itemSize).toBe(4);
  expect(result.first).toBe(0);
  expect(result.peak).toBeGreaterThan(0.8);
  expect(result.last).toBeCloseTo(0, 6);
  expect(result.stalled).toBe(0);
  expect(result.opacity).toBe(0.95);
  expect(result.peak * result.opacity).toBeLessThanOrEqual(0.95);
});

test('三翼调整材料用量并独立撤销，保留预设截面且不提供尺寸输入', async ({ page }) => {
  await enterDesign(page);
  const before = await aircraft(page);
  for (const [tab, key] of [['主翼', 'mainWing'], ['水平尾翼', 'horizontalTail'], ['垂直尾翼', 'verticalTail']] as const) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    for (const name of ['梁截面弦向宽度', '梁截面法向高度', '梁管壁厚']) {
      await expect(page.getByRole('slider', { name, exact: true })).toHaveCount(0);
      await expect(page.getByRole('spinbutton', { name: `${name}精确值`, exact: true })).toHaveCount(0);
    }
    const amount = page.getByRole('spinbutton', { name: '材料用量精确值', exact: true });
    await expect(page.getByRole('slider', { name: '材料用量', exact: true })).toHaveAttribute('min', '50');
    await expect(page.getByRole('slider', { name: '材料用量', exact: true })).toHaveAttribute('max', '200');
    await amount.fill('137');
    await amount.press('Tab');
    expect((await aircraft(page))[key].materialAmount).toBe(1.37);
    await page.getByRole('combobox', { name: '翼面材料', exact: true }).selectOption('spruce');
    expect((await aircraft(page))[key].materialId).toBe('spruce');
    expect((await aircraft(page))[key].structure).toEqual(before[key].structure);
    expect((await aircraft(page))[key].materialAmount).toBe(1.37);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await aircraft(page))[key].materialId).toBe(before[key].materialId);
    expect((await aircraft(page))[key].materialAmount).toBe(1.37);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await aircraft(page))[key].materialAmount).toBe(1);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect((await aircraft(page))[key].materialAmount).toBe(1.37);
    await noOverflow(page);
  }
});

test('断翼后返回设计和重新试飞恢复完整GPU翼面，不残留已释放断片的弯曲图形', async ({ page, isMobile }) => {
  test.skip(isMobile, '共享WebGL缓冲生命周期在桌面验证，移动端使用同一渲染路径');
  const result = await page.evaluate(async () => {
    // 模块须在浏览器上下文由Vite加载；静态导入只能进入Node测试进程。
    const scenePath = '/src/scene.ts', physicsPath = '/src/physics.ts', modelPath = '/src/model.ts';
    const { SceneView } = await import(scenePath) as typeof SceneModule;
    const { FlightSimulation } = await import(physicsPath) as typeof PhysicsModule;
    const { defaultAircraft, clone } = await import(modelPath) as typeof ModelModule;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:640px;height:480px';
    document.body.appendChild(host);
    const view = new SceneView(host), definition = clone(defaultAircraft);
    view.setQuality('Low');
    view.updateAircraft(definition);
    view.setEditor('mainWing', () => {}, () => {});
    view.setFlight(null);
    const { renderer } = view as unknown as { renderer: WebGLRenderer };
    const gl = renderer.getContext();
    const pixels = () => {
      view.render(0, 1);
      const image = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, image);
      return image;
    };
    const differences = (a: Uint8Array, b: Uint8Array) => a.reduce((count, value, index) => count + Number(value !== b[index]), 0);
    const fracture = (sim: InstanceType<typeof FlightSimulation>) => {
      sim.launching = false; sim.position.set(200, 150, 0); sim.quaternion.identity();
      sim.velocity.set(100, -30, 25); sim.omega.set(0.4, 0.2, -0.3);
      view.captureFlightState();
      sim.step({ weight: 0, lateral: 0, rudder: 0, elevator: 0, aileron: 0 }, 1e-4);
      view.render(0, 1);
      return sim.fragments.length;
    };
    try {
      const designBefore = pixels();
      const sim = new FlightSimulation(definition, 'birdman', 0);
      view.setFlight(sim); view.cameraView('top');
      const flightBefore = pixels(), detached = fracture(sim);
      view.setFlight(null); view.updateAircraft(definition);
      const designAfter = pixels(), restored = view.getDiagnostics().structureRendering;
      const next = new FlightSimulation(definition, 'birdman', 0);
      view.setFlight(next); view.cameraView('top');
      const flightAfter = pixels(), detachedAgain = fracture(next), brokenPixels = pixels();
      view.setFlight(new FlightSimulation(definition, 'birdman', 0)); view.cameraView('top');
      const directRestart = pixels();
      return {
        detached, detachedAgain, remainingFragments: restored.fragments.length,
        designDifferences: differences(designBefore, designAfter),
        flightDifferences: differences(flightBefore, flightAfter),
        directRestartDifferences: differences(flightBefore, directRestart),
        brokenDifferences: differences(flightBefore, brokenPixels),
        graphicsError: gl.getError(), noError: gl.NO_ERROR,
      };
    } finally { view.dispose(); host.remove(); }
  });
  expect(result.detached).toBeGreaterThan(0);
  expect(result.detachedAgain).toBeGreaterThan(0);
  expect(result.brokenDifferences).toBeGreaterThan(0);
  expect(result.remainingFragments).toBe(0);
  expect(result.designDifferences).toBe(0);
  expect(result.flightDifferences).toBe(0);
  expect(result.directRestartDifferences).toBe(0);
  expect(result.graphicsError).toBe(result.noError);
});

test('机库加载损坏记录失败保留机库和当前设计', async ({ page }) => {
  await enterDesign(page);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '机库', exact: true }).click();
  const before = await aircraft(page);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('lakewind.aircraft.'))!;
    localStorage.setItem(key, '{broken');
  });
  const library = page.getByRole('region', { name: '本地机库' });
  await library.getByRole('button', { name: '加载', exact: true }).click();
  await expect(library).toBeVisible();
  expect(await aircraft(page)).toEqual(before);
  await expect(page.getByRole('status').filter({ has: page.getByRole('button', { name: '关闭提示', exact: true }) })).toContainText('记录已损坏');
  expect(await page.evaluate(() => Object.values(localStorage).includes('{broken'))).toBe(true);
});

test('低空2m导轨随真实滑跑移动，升力脱轨后断开连接，再次试飞恢复附着', async ({ page, isMobile }) => {
  test.skip(isMobile, '导轨三维与物理状态在桌面验证，触屏共用同一实现');
  const result = await page.evaluate(async () => {
    // 真实模块须在浏览器由Vite加载；Node静态导入不能跨越page.evaluate上下文。
    const scenePath = '/src/scene.ts', physicsPath = '/src/physics.ts', modelPath = '/src/model.ts';
    const { SceneView } = await import(scenePath) as typeof SceneModule;
    const { FlightSimulation } = await import(physicsPath) as typeof PhysicsModule;
    const { presets, clone } = await import(modelPath) as typeof ModelModule;
    const definition = clone(presets.find(plane => plane.name === '基础单发型')!);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:960px;height:600px';
    document.body.append(host);
    const view = new SceneView(host), simulation = new FlightSimulation(definition, 'low-altitude', 0);
    const input = { weight: 0, lateral: 0, rudder: 0, elevator: 0, aileron: 0, throttle: 1 };
    try {
      view.setQuality('Low'); view.updateAircraft(definition); view.setFlight(simulation); view.render(0, 1);
      const initial = view.getDiagnostics().lowAltitudeRail!;
      for (let frame = 0; frame < 2400 && simulation.launching && !simulation.ended; frame++) {
        view.captureFlightState(); simulation.step(input);
      }
      view.render(0, 1);
      const released = view.getDiagnostics().lowAltitudeRail!;
      const releaseSpeed = simulation.velocity.length(), endedAtRelease = simulation.ended;
      for (let frame = 0; frame < 12 && !simulation.ended; frame++) {
        view.captureFlightState(); simulation.step(input);
      }
      view.render(0, 1);
      const carriageAfterRelease = view.getDiagnostics().lowAltitudeRail!.carriage;
      view.setFlight(new FlightSimulation(definition, 'low-altitude', 0)); view.render(0, 1);
      const reset = view.getDiagnostics().lowAltitudeRail!;
      return { initial, released, reset, carriageAfterRelease, releaseSpeed, endedAtRelease };
    } finally { view.dispose(); host.remove(); }
  });
  expect(result.initial.attached).toBe(true);
  expect(result.initial.couplingVisible).toBe(true);
  expect(result.initial.carriage.y - result.initial.launch!.y).toBeCloseTo(2, 8);
  expect(result.initial.steamVisible).toBe(false);
  expect(result.endedAtRelease).toBe(false);
  expect(result.releaseSpeed).toBeGreaterThan(0);
  expect(result.released.attached).toBe(false);
  expect(result.released.couplingVisible).toBe(false);
  expect(result.released.carriage.x).toBeGreaterThan(result.initial.carriage.x);
  expect(result.carriageAfterRelease).toEqual(result.released.carriage);
  expect(result.reset.attached).toBe(true);
  expect(result.reset.couplingVisible).toBe(true);
  expect(result.reset.carriage).toEqual(result.initial.carriage);
});

test('中英日切换保留设计，重载后保留语言选择', async ({ page }) => {
  await enterDesign(page);
  const before = await aircraft(page);
  const language = page.locator('select:has(option[value="ja"])');
  for (const [code, title] of [['en', 'Aero Formula'], ['ja', '翼の方程式'], ['zh', '翼构方程']] as const) {
    await language.selectOption(code);
    await expect(page).toHaveTitle(new RegExp(title));
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    expect(await aircraft(page)).toEqual(before);
  }
  await language.selectOption('ja');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/翼の方程式/);
  await expect(language).toHaveValue('ja');
});


test('快捷键、独立气动窗口与鼠标操纵杆释放复位', async ({page,isMobile})=>{
 test.skip(isMobile,'键鼠控制在桌面验证');
 await enterDesign(page);
 await page.keyboard.press('Escape');
 await expect.poll(()=>page.evaluate(()=>window.glider.state)).toBe('menu');
 await enterDesign(page);
 await page.getByRole('button',{name:'试飞',exact:true}).click();
 await page.getByRole('button',{name:'开始试飞',exact:true}).click();
 await page.getByRole('switch',{name:'气动图层',exact:true}).click();
 await expect(page.getByRole('complementary',{name:'实时气动数据'})).toBeVisible();
 await expect(page.getByRole('complementary',{name:'开发性能面板'})).toHaveCount(0);
 await page.keyboard.down('x');
 await page.mouse.move(800,400);
 await expect(page.getByLabel('虚拟操纵杆')).toBeVisible();
 await page.keyboard.up('x');
 await expect(page.getByLabel('虚拟操纵杆')).toHaveCount(0);
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.keyboard.press('r');
 await expect.poll(()=>page.evaluate(()=>window.glider.flightReady)).toBe(false);
 await page.keyboard.press('Escape');
 await expect.poll(()=>page.evaluate(()=>window.glider.state)).toBe('design');
});


test('地面X分两笔同步发声，计时门外侧随接近变红',async({page,isMobile})=>{
 test.skip(isMobile,'场景几何在桌面验证');
 const result=await page.evaluate(async()=>{
  const scenePath='/src/scene.ts',physicsPath='/src/physics.ts',modelPath='/src/model.ts';
  const {SceneView}=await import(scenePath),{FlightSimulation}=await import(physicsPath),{presets}=await import(modelPath);
  const host=document.createElement('div');host.style.cssText='width:800px;height:600px';document.body.append(host);
  const view=new SceneView(host),sim=new FlightSimulation(presets.find((p:any)=>p.name==='高性能滑翔型'),'downhill',0);
  try{
   view.setFlight(sim);sim.ended=true;sim.groundImpactPoint.copy(sim.position);
   const internals=view as any,gate=internals.mountainEnvironment.children.find((g:any)=>g.userData.gate),warning=gate.children.find((c:any)=>c.userData.warning);
   sim.position.x=gate.position.x-120;view.render(0);const far=warning.material.uniforms.opacity.value;
   sim.position.x=gate.position.x;view.render(0);const near=warning.material.uniforms.opacity.value;
   let sounds=0;view.markCrash(()=>sounds++);
   for(let i=0;i<7;i++)view.render(0.1);
   const first=internals.crashMark.children.map((c:any)=>c.geometry.instanceCount),oneSound=sounds;
   for(let i=0;i<6;i++)view.render(0.1);
   const second=internals.crashMark.children.map((c:any)=>c.geometry.instanceCount);
   const strokes=internals.crashMark.children.map((c:any)=>({width:c.material.linewidth,worldUnits:c.material.worldUnits,start:Array.from(c.geometry.getAttribute('instanceStart').array).slice(0,3)}));
   return {far,near,first,second,oneSound,sounds,strokes};
  }finally{view.dispose();host.remove();}
 });
 expect(result.far).toBe(0);expect(result.near).toBe(1);
 expect(result.first[0]).toBeGreaterThan(0);expect(result.first[1]).toBe(0);expect(result.oneSound).toBe(1);
 expect(result.second).toEqual([64,64]);expect(result.sounds).toBe(2);
 for(const stroke of result.strokes){expect(stroke.width).toBe(12);expect(stroke.worldUnits).toBe(false);expect(stroke.start[0]).toBe(-3);}
});
