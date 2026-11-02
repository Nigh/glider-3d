import { expect, test } from '@playwright/test';

test('语言切换同步场景SVG与画布标签，不改变飞机几何与避让偏移', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // Vite's timestamped module copies must share state, not split App and Scene.
  expect(await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => /\/src\/i18n\.ts(?:\?|$)/.test(url));
    if (!moduleUrl) return true; // Production bundles have no HMR module copies.
    const first = new URL(moduleUrl), second = new URL(moduleUrl);
    first.search = '?t=1000000000001';
    second.search = '?t=1000000000002';
    const copies = await Promise.all([import(first.href), import(second.href)]);
    return copies[0].language === copies[1].language;
  })).toBe(true);
  await page.getByRole('button', { name: '高山速降', exact: false }).click();
  await page.getByRole('tab', { name: '动力', exact: true }).click();
  await page.getByRole('combobox', { name: '引擎数量', exact: true }).selectOption('2');
  const engine = page.locator('.scene-editor g[data-handle="6"]');
  const tank = page.locator('.scene-editor g[data-handle="7"]');
  await expect(engine).toHaveAttribute('aria-label', '引擎位置');
  await expect(tank).toHaveAttribute('aria-label', '油箱位置');
  const offsets = () => page.evaluate(() => {
    const scene = window.glider.scene as unknown as { editor: { handles: { x: number; y: number; ax: number; ay: number }[] } };
    return scene.editor.handles.map(handle => ({ x: handle.x - handle.ax, y: handle.y - handle.ay }));
  });
  const initialOffsets = await offsets();
  const definition = await page.evaluate(() => window.glider.aircraft);
  const language = page.locator('.language-label select');
  for (const [locale, engineLabel, tankLabel, overlayLabel, canvasLabel] of [
    ['ja', 'エンジン位置', 'タンク位置', '実際の翼面・部品位置を編集', '滑空機の3Dビュー。ドラッグで回転、ホイールで拡縮、右ドラッグまたは2本指で平行移動します。'],
    ['en', 'Engine position', 'Tank position', 'Edit actual surface and component positions', '3D glider view. Drag to orbit, scroll to zoom, right-drag or use two fingers to pan.'],
    ['zh', '引擎位置', '油箱位置', '真实翼面与部件位置编辑', '滑空机三维视图。拖动旋转，滚轮缩放，右键或双指平移。'],
  ]) {
    await language.selectOption(locale);
    await expect(engine).toHaveAttribute('aria-label', engineLabel);
    await expect(tank).toHaveAttribute('aria-label', tankLabel);
    await expect(engine.locator('text')).toHaveText(engineLabel);
    await expect(tank.locator('text')).toHaveText(tankLabel);
    await expect(page.locator('.scene-editor')).toHaveAttribute('aria-label', overlayLabel);
    await expect(page.locator('.scene canvas')).toHaveAttribute('aria-label', canvasLabel);
    const currentOffsets = await offsets();
    expect(currentOffsets).toHaveLength(initialOffsets.length);
    for (let index = 0; index < initialOffsets.length; index++) {
      expect(currentOffsets[index].x).toBeCloseTo(initialOffsets[index].x, 6);
      expect(currentOffsets[index].y).toBeCloseTo(initialOffsets[index].y, 6);
    }
    expect(await page.evaluate(() => window.glider.aircraft)).toEqual(definition);
  }
});
