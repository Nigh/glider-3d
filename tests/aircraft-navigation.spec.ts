import { test, expect } from '@playwright/test';

// Browser imports cross Vite's module boundary; static Node imports cannot access browser storage.
const current = (page: import('@playwright/test').Page) => page.evaluate(() => window.glider.aircraft);

test('菜单保留飞机，比赛切换仅在机型不兼容时恢复默认', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/');
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 await expect(page.getByRole('combobox', { name: '飞机类型', exact: true })).toHaveCount(0);
 const name = page.getByRole('textbox', { name: '飞机名称', exact: true });
 await name.fill('跨模式鸟人间机'); await name.press('Tab');
 const birdman = await current(page);
 await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
 expect(await current(page)).toEqual(birdman);
 await page.getByRole('button', { name: '鸟人间挑战', exact: false }).click();
 expect(await current(page)).toEqual(birdman);
 await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
 await page.getByRole('button', { name: '高山速降', exact: false }).click();
 await expect(page.getByRole('combobox', { name: '飞机类型', exact: true })).toHaveCount(0);
 expect((await current(page)).birdman).toBe(false);
 await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
 await name.fill('跨模式常规机'); await name.press('Tab');
 const downhill = await current(page);
 await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
 expect(await current(page)).toEqual(downhill);
 await page.getByRole('button', { name: '低空飞行', exact: false }).click();
 expect(await current(page)).toEqual(downhill);
 await expect(page.getByRole('combobox', { name: '飞机类型', exact: true })).toHaveCount(0);
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
 await name.fill('兼容恢复保存机'); await name.press('Tab');
 const saved = await current(page);
 await page.getByRole('button', { name: '保存', exact: true }).click();
 await page.getByRole('button', { name: '机库', exact: true }).click();
 await page.locator('.saved-plane').filter({ has: page.getByRole('textbox', { name: '重命名兼容恢复保存机', exact: true }) }).getByRole('button', { name: '加载', exact: true }).click();
 await expect(page.getByRole('region', { name: '本地机库' })).toBeHidden();
 expect(await current(page)).toEqual(saved);
});

test('风洞保留两类飞机并允许切换类型、撤销和重做', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/');
 await page.getByRole('button', { name: '鸟人间挑战', exact: false }).click();
 const birdman = await current(page);
 await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
 await page.getByRole('button', { name: '风洞', exact: false }).click();
 expect(await current(page)).toEqual(birdman);
 const type = page.getByRole('combobox', { name: '飞机类型', exact: true });
 await type.selectOption('normal');
 const normal = await current(page);
 expect(normal.birdman).toBe(false);
 await expect(page.getByRole('tab', { name: '动力', exact: true })).toBeVisible();
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 expect(await current(page)).toEqual(birdman);
 await page.getByRole('button', { name: '重做', exact: true }).click();
 expect(await current(page)).toEqual(normal);
 await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
 await page.getByRole('button', { name: '风洞', exact: false }).click();
 expect(await current(page)).toEqual(normal);
 await page.getByRole('tab', { name: '动力', exact: true }).click();
 await type.selectOption('birdman');
 expect((await current(page)).birdman).toBe(true);
 expect((await current(page)).engine.count).toBe(0);
 await expect(page.getByRole('tab', { name: '动力', exact: true })).toHaveCount(0);
});

for (const challenge of ['鸟人间挑战', '高山速降', '低空飞行']) {
 test(`${challenge}导入兼容飞机原样入库并加载，关闭机库且可撤销`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
  await page.goto('/');
  await page.getByRole('button', { name: challenge, exact: false }).click();
  const before = await current(page);
  const definition = await page.evaluate(async mode => {
   const { clone, defaultAircraft, presets } = await import('/src/model.ts');
   const definition = clone(mode === '鸟人间挑战' ? defaultAircraft : presets.find(item => item.name === '低空喷气巡航型')!);
   definition.name = '导入原样保留机';
   return definition;
  }, challenge);
  await page.getByRole('button', { name: '机库', exact: true }).click();
  await page.getByLabel('导入飞机文件', { exact: true }).setInputFiles({
   name: 'aircraft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)),
  });
  await expect(page.getByRole('region', { name: '本地机库' })).toBeHidden();
  await expect(page.locator('.toast')).toContainText('导入成功');
  expect(await current(page)).toEqual(definition);
  const stored = await page.evaluate(async () => (await import('/src/storage.ts')).listAircraft().filter(item => !item.builtIn));
  expect(stored).toHaveLength(1);expect(stored[0].definition).toEqual(definition);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await current(page)).toEqual(before);
  await page.reload();
  await page.getByRole('button', { name: challenge, exact: false }).click();
  await page.getByRole('button', { name: '机库', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '重命名导入原样保留机', exact: true })).toBeVisible();
 });
}

for (const preset of ['高山速降机动型', '低空喷气巡航型']) {
 test(`鸟人间导入${preset}只入库不改当前飞机，关闭机库并提示`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
  await page.goto('/');
  await page.getByRole('button', { name: '鸟人间挑战', exact: false }).click();
  const before = await current(page);
  const definition = await page.evaluate(async name => {
   const { clone, presets } = await import('/src/model.ts');
   return clone(presets.find(item => item.name === name)!);
  }, preset);
  await page.getByRole('button', { name: '机库', exact: true }).click();
  await page.getByLabel('导入飞机文件', { exact: true }).setInputFiles({
   name: 'aircraft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)),
  });
  await expect(page.getByRole('region', { name: '本地机库' })).toBeHidden();
  await expect(page.locator('.toast')).toContainText('未加载');
  expect(await current(page)).toEqual(before);
  const stored = await page.evaluate(async () => (await import('/src/storage.ts')).listAircraft().filter(item => !item.builtIn));
  expect(stored).toHaveLength(1);expect(stored[0].definition).toEqual(definition);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
 });
}

for (const challenge of ['高山速降', '低空飞行']) {
 test(`${challenge}导入鸟人间飞机只入库，不改当前飞机`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
  await page.goto('/');
  await page.getByRole('button', { name: challenge, exact: false }).click();
  const before = await current(page);
  const definition = await page.evaluate(async () => {
   const { clone, defaultAircraft } = await import('/src/model.ts');
   const definition = clone(defaultAircraft);
   definition.name = '不兼容鸟人间导入机';
   return definition;
  });
  await page.getByRole('button', { name: '机库', exact: true }).click();
  await page.getByLabel('导入飞机文件', { exact: true }).setInputFiles({
   name: 'birdman.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)),
  });
  await expect(page.getByRole('region', { name: '本地机库' })).toBeHidden();
  await expect(page.locator('.toast')).toContainText('未加载');
  expect(await current(page)).toEqual(before);
  const stored = await page.evaluate(async () => (await import('/src/storage.ts')).listAircraft().filter(item => !item.builtIn));
  expect(stored).toHaveLength(1);expect(stored[0].definition).toEqual(definition);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
 });
}

test('非法飞机文件不入库、不关机库、不改当前飞机', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/');
 await page.getByRole('button', { name: '鸟人间挑战', exact: false }).click();
 const before = await current(page);
 await page.getByRole('button', { name: '机库', exact: true }).click();
 await page.getByLabel('导入飞机文件', { exact: true }).setInputFiles({
  name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}'),
 });
 await expect(page.locator('.toast')).toContainText('导入失败：');
 await expect(page.getByRole('region', { name: '本地机库' })).toBeVisible();
 expect(await current(page)).toEqual(before);
 expect(await page.evaluate(async () => (await import('/src/storage.ts')).listAircraft().filter(item => !item.builtIn))).toHaveLength(0);
});
