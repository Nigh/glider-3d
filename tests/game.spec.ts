import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AircraftDefinition } from '../src/model';

type FlightResult = { distance: number; time: number; averageSpeed: number; maxSpeed: number; minSpeed: number; maxHeight: number; landing: string; hints: string[] };
declare global {
  interface Window {
    readonly glider: {
      readonly aircraft: AircraftDefinition;
      readonly state: 'menu' | 'design' | 'flight' | 'result';
      readonly metrics: Record<string, number | string>;
      readonly telemetry: { speed: number; altitude: number; distance: number; pitch: number; roll: number; cg: { x: number }; [key: string]: unknown } | undefined;
      readonly result: FlightResult | null;
    };
  }
}

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: '开始设计' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.glider?.state)).toBe('menu');
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page), '应用不得产生未捕获异常').toEqual([]);
});

async function aircraft(page: Page) {
  return page.evaluate(() => window.glider.aircraft);
}
async function enterDesign(page: Page) {
  await page.getByRole('button', { name: '开始设计' }).click();
  await expect(page.getByRole('heading', { name: '飞机工坊' })).toBeVisible();
}
async function number(page: Page, label: string, value: number) {
  const input = page.getByRole('spinbutton', { name: label, exact: true });
  await input.fill(String(value));
  await input.press('Tab');
  await expect(input).toHaveValue(String(value));
}
async function dragHandle(page: Page, index: number, dx: number, dy: number) {
  const handle = page.locator('.planform-editor svg circle[role="presentation"]').nth(index);
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
  await expect(page.getByRole('heading', { name: '每一米，都来自你的设计。' })).toBeVisible();
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

test.describe('桌面完整交互', () => {
  test.beforeEach(({ isMobile }) => test.skip(isMobile, '完整桌面链路在 desktop-chromium 项目运行'));

  test('机身、驾驶舱、四点拖翼、尾翼、组装、撤销和重做', async ({ page }) => {
    await enterDesign(page);
    await page.getByRole('tab', { name: '机身', exact: true }).click();
    await number(page, '机身长度精确值', 7.2);
    await number(page, '驾驶舱位置精确值', 1.5);
    expect((await aircraft(page)).fuselage.length).toBe(7.2);
    expect((await aircraft(page)).cockpit.position).toBe(1.5);
    await page.getByRole('tab', { name: '主翼', exact: true }).click();
    for (let i = 0; i < 4; i++) {
      const before = (await aircraft(page)).mainWing.points[i];
      await dragHandle(page, i, i === 1 || i === 2 ? 4 : 0, -4);
      expect((await aircraft(page)).mainWing.points[i].x).not.toBe(before.x);
    }
    const points = (await aircraft(page)).mainWing.points;
    expect(points[0].y).toBe(0);
    expect(points[3].y).toBe(0);
    expect(points[1].y).toBe(points[2].y);
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
    await page.getByRole('tab', { name: '组装', exact: true }).click();
    for (const [label, value, key] of [
      ['主翼纵向位置', 1.1, 'mainWing'], ['主翼安装高度', 1.0, 'mainWingHeight'],
      ['主翼安装角', 5, 'mainIncidence'], ['水平尾翼位置', -3.1, 'horizontalTail'],
      ['水平尾翼安装角', -1, 'tailIncidence'], ['垂直尾翼位置', -3.2, 'verticalTail'],
    ] as const) {
      await number(page, label + '精确值', value);
      expect((await aircraft(page)).assembly[key]).toBe(value);
    }
    const final = await aircraft(page);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await aircraft(page)).assembly.verticalTail).not.toBe(final.assembly.verticalTail);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect(await aircraft(page)).toEqual(final);
    await page.getByRole('tab', { name: '机身', exact: true }).click();
    await number(page, '机身长度精确值', 8);
    await page.getByRole('heading', { name: '飞机工坊' }).click();
    await page.keyboard.press('ControlOrMeta+z');
    expect((await aircraft(page)).fuselage.length).toBe(7.2);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect((await aircraft(page)).fuselage.length).toBe(8);
    await page.getByRole('combobox', { name: '预设飞机' }).selectOption({ label: '高展弦比型' });
    expect((await aircraft(page)).mainWing.points[1].y).toBe(9.5);
    await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
    await expect.poll(() => page.evaluate(() => window.glider.metrics.quality)).toBe('Low');
  });

  test('机库保存、刷新加载、命名复制、JSON 导出导入和失败保留设计', async ({ page }, testInfo) => {
    await enterDesign(page);
    await page.getByRole('textbox', { name: '飞机名称', exact: true }).fill('交互测试机');
    await page.getByRole('textbox', { name: '飞机名称', exact: true }).press('Tab');
    await page.getByRole('tab', { name: '机身', exact: true }).click();
    await number(page, '机身长度精确值', 7.4);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const saved = await aircraft(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enterDesign(page);
    await page.getByRole('button', { name: '机库', exact: true }).click();
    const library = page.getByRole('region', { name: '本地机库' });
    await library.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名交互测试机', exact: true }) }).getByRole('button', { name: '加载', exact: true }).click();
    expect(await aircraft(page)).toEqual(saved);
    await library.getByRole('textbox', { name: '重命名交互测试机', exact: true }).fill('重命名测试机');
    await library.getByRole('textbox', { name: '重命名交互测试机', exact: true }).press('Tab');
    const original = library.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名重命名测试机', exact: true }) });
    await original.getByRole('button', { name: '复制', exact: true }).click();
    await expect(library.locator('.saved-plane')).toHaveCount(2);
    const copy = library.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名重命名测试机 副本', exact: true }) });
    await copy.getByRole('button', { name: '加载', exact: true }).click();
    const exported = await aircraft(page);
    expect(exported.name).toBe('重命名测试机 副本');
    const downloadPromise = page.waitForEvent('download');
    await library.getByRole('button', { name: '导出 JSON', exact: true }).click();
    const download = await downloadPromise;
    const exportPath = testInfo.outputPath('aircraft.json');
    await download.saveAs(exportPath);
    expect(JSON.parse(await readFile(exportPath, 'utf8'))).toEqual(exported);
    await library.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '重置设计', exact: true }).click();
    expect(await aircraft(page)).not.toEqual(exported);
    await page.getByRole('button', { name: '机库', exact: true }).click();
    await library.getByLabel('导入飞机文件', { exact: true }).setInputFiles(exportPath);
    await expect(page.getByRole('status')).toContainText('导入成功');
    expect(await aircraft(page)).toEqual(exported);
    await library.getByLabel('导入飞机文件', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await expect(page.getByRole('status')).toContainText('导入失败');
    expect(await aircraft(page)).toEqual(exported);
    page.once('dialog', dialog => dialog.accept());
    await copy.getByRole('button', { name: '删除', exact: true }).click();
    await expect(library.locator('.saved-plane')).toHaveCount(1);
    await original.getByRole('button', { name: '加载', exact: true }).click();
    expect((await aircraft(page)).name).toBe('重命名测试机');
    expect((await aircraft(page)).fuselage.length).toBe(7.4);
  });

  test('键鼠飞控、暂停、着水结果、确定性重放、返回改进和再次飞行', async ({ page }) => {
    await enterDesign(page);
    await page.getByRole('button', { name: '前往平台试飞' }).click();
    await expect.poll(() => page.evaluate(() => window.glider.state)).toBe('flight');
    const initialCg = await page.evaluate(() => window.glider.telemetry!.cg.x);
    await page.keyboard.down('w');
    await page.keyboard.down('d');
    await page.waitForTimeout(250);
    await expect.poll(() => page.evaluate(() => window.glider.telemetry!.cg.x)).toBeGreaterThan(initialCg);
    await page.keyboard.up('w');
    await page.keyboard.up('d');
    const button = page.getByRole('button', { name: '重心后移', exact: true });
    const box = await button.boundingBox();
    if (!box) throw new Error('鼠标飞控不可见');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.getByRole('progressbar', { name: '重心操纵输入' })).toHaveAttribute('value', '0');
    await page.waitForTimeout(200);
    await page.mouse.up();
    await expect(page.getByRole('progressbar', { name: '重心操纵输入' })).toHaveAttribute('value', '1');
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const stopped = await page.evaluate(() => window.glider.telemetry?.distance);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.glider.telemetry?.distance)).toBe(stopped);
    await page.getByRole('combobox', { name: '飞行相机', exact: true }).selectOption('侧面');
    await page.getByRole('button', { name: '继续飞行', exact: true }).click();
    const first = await waitResult(page);
    await page.getByRole('button', { name: '重放飞行', exact: true }).click();
    await expect(page.getByText('输入重放', { exact: true })).toBeVisible();
    const replay = await waitResult(page);
    expect(replay).toEqual(first);
    await page.getByRole('button', { name: '返回设计改进', exact: true }).click();
    await page.getByRole('tab', { name: '机身', exact: true }).click();
    await number(page, '驾驶舱位置精确值', 1.3);
    await page.getByRole('button', { name: '前往平台试飞' }).click();
    await waitResult(page);
    await page.getByRole('button', { name: '再试一次', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.glider.state)).toBe('flight');
    expect((await aircraft(page)).cockpit.position).toBe(1.3);
    await page.getByRole('button', { name: '返回设计', exact: true }).click();
    await expect(page.getByRole('heading', { name: '飞机工坊' })).toBeVisible();
  });
});

test('手机竖屏与横屏无页面溢出，真实浏览器触摸事件可操纵并释放', async ({ page, isMobile, context }) => {
  test.skip(!isMobile, '此测试仅使用触摸视口；不代表真实手机硬件验证');
  await noOverflow(page);
  await enterDesign(page);
  await noOverflow(page);
  for (const tab of ['机身', '主翼', '水平尾翼', '垂直尾翼', '组装']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await noOverflow(page);
  }
  await page.getByRole('button', { name: '机库', exact: true }).tap();
  await noOverflow(page);
  await page.getByRole('region', { name: '本地机库' }).getByRole('button', { name: '关闭', exact: true }).tap();
  await insideViewport(page, page.getByRole('button', { name: '前往平台试飞' }));
  await page.getByRole('button', { name: '前往平台试飞' }).tap();
  await noOverflow(page);
  const session = await context.newCDPSession(page);
  let touchActive = false;
  try {
    for (const [name, progress, expected] of [
      ['重心前移', '重心操纵输入', '2'], ['重心后移', '重心操纵输入', '0'],
      ['向左转向', '方向操纵输入', '0'], ['向右转向', '方向操纵输入', '2'],
    ]) {
      const control = page.getByRole('button', { name, exact: true });
      await insideViewport(page, control);
      const box = (await control.boundingBox())!;
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
      touchActive = true;
      await expect(page.getByRole('progressbar', { name: progress })).toHaveAttribute('value', expected);
      await page.waitForTimeout(120);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      touchActive = false;
      await expect(page.getByRole('progressbar', { name: progress })).toHaveAttribute('value', '1');
    }
  } finally {
    if (touchActive) await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  }
  await expect.poll(() => page.evaluate(() => window.glider.telemetry?.distance ?? 0)).toBeGreaterThan(0);
  await waitResult(page);
  await noOverflow(page);
  await insideViewport(page, page.getByRole('button', { name: '返回设计改进', exact: true }));
  await page.getByRole('button', { name: '返回设计改进', exact: true }).tap();
  await noOverflow(page);
});

test('编辑错误和跨飞机撤销不会悄悄改变保存数据', async ({ page }) => {
  await enterDesign(page);
  await page.getByText('精确编辑四个顶点', { exact: true }).click();
  const root = page.getByRole('spinbutton', { name: '顶点1后向坐标', exact: true });
  await root.fill('2');
  await root.press('Tab');
  await expect(root).toHaveValue('0');
  await expect(page.getByRole('alert')).toContainText('至少 0.15 m');
  expect((await aircraft(page)).mainWing.points[0].x).toBe(0);
  const before = (await aircraft(page)).mainWing.points[1].y;
  await dragHandle(page, 1, 0, -7);
  expect((await aircraft(page)).mainWing.points[1].y).toBeCloseTo(before, 4);
  await page.getByRole('textbox', { name: '飞机名称', exact: true }).fill('设计 A');
  await page.getByRole('textbox', { name: '飞机名称', exact: true }).press('Tab');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('combobox', { name: '预设飞机', exact: true }).selectOption('1');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '机库', exact: true }).click();
  const a = page.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名设计 A', exact: true }) });
  await a.getByRole('button', { name: '加载', exact: true }).click();
  const rename = page.getByRole('textbox', { name: '重命名设计 A', exact: true });
  await rename.fill('重命名 A');
  await rename.press('Tab');
  await expect(page.getByRole('textbox', { name: '飞机名称', exact: true })).toHaveValue('重命名 A');
  await page.getByRole('button', { name: '保存当前飞机', exact: true }).click();
  await page.locator('.library-title').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '机库', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '重命名重命名 A', exact: true })).toHaveValue('重命名 A');
  await expect(page.locator('.saved-plane')).toHaveCount(3);
});
