import { expect, test } from '@playwright/test';

test('持久化日语后切换语言，声音、翼面、参数和已有错误同步更新', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'ja'));
 await page.goto('/');
 await page.getByRole('button', { name: '鳥人間チャレンジ' }).click();
 const definition = await page.evaluate(() => window.glider.aircraft);
 await page.getByText('4頂点を数値で編集', { exact: true }).click();
 await page.locator('#px0').fill('');
 await page.locator('#px1').focus();
 await expect(page.locator('.field-error')).toBeVisible();
 await page.locator('.audio-settings > summary').click();
 const language = page.locator('select:has(option[value="ja"])');
 const cases = [
  { code: 'en', sound: 'Sound settings', mute: 'Mute all', material: 'Surface material', amount: 'Material amount', precise: 'Material amount precise value', error: 'Enter a finite number. The previous value was restored.' },
  { code: 'zh', sound: '声音设置', mute: '全部静音', material: '翼面材料', amount: '材料用量', precise: '材料用量精确值', error: '请输入有限数值，已恢复原值。' },
  { code: 'ja', sound: 'サウンド設定', mute: 'すべて消音', material: '翼面材料', amount: '材料量', precise: '材料量の精密値', error: '有限の数値を入力してください。元の値に戻しました。' },
 ];
 for (const value of cases) {
  await language.selectOption(value.code);
  await expect(page.locator('.audio-settings > summary')).toHaveAttribute('aria-label', value.sound);
  await expect(page.locator('.audio-settings > summary')).toHaveAttribute('title', value.sound);
  await expect(page.getByRole('checkbox', { name: value.mute })).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: value.material, exact: true })).toHaveValue(definition.mainWing.materialId);
  await expect(page.getByRole('slider', { name: value.amount, exact: true })).toHaveValue(String(definition.mainWing.materialAmount*100));
  await expect(page.getByRole('spinbutton', { name: value.precise, exact: true })).toHaveValue(String(definition.mainWing.materialAmount*100));
  await expect(page.locator('.field-error')).toHaveText(value.error);
  expect(await page.evaluate(() => window.glider.aircraft)).toEqual(definition);
 }
});

test('Vite多时间戳模块复用语言store，不产生界面和场景语言分裂', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'ja'));
 await page.goto('/');
 await expect(page.locator('select:has(option[value="ja"])')).toHaveValue('ja');
 const sameStore = await page.evaluate(async () => {
  // Static imports cannot exercise two browser module URLs and their separate HMR loading boundaries.
  const first = await import(/* @vite-ignore */ '/src/i18n.ts?t=1111111111111');
  const second = await import(/* @vite-ignore */ '/src/i18n.ts?t=2222222222222');
  second.setLanguage('en');
  return first.language === second.language;
 });
 expect(sameStore).toBe(true);
 await expect(page).toHaveTitle(/Aero Formula/);
 await expect(page.locator('.audio-settings > summary')).toHaveAttribute('aria-label', 'Sound settings');
 await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('系统名称随语言切换，用户同名飞机不翻译，动力预设显示巡航参数', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.goto('/');
 await page.getByRole('button', { name: '鸟人间挑战' }).click();
 const definition = await page.evaluate(() => window.glider.aircraft);
 await page.getByRole('button', { name: '保存', exact: true }).click();
 await page.getByRole('button', { name: '机库', exact: true }).click();
 const systems = page.locator('.saved-plane[data-aircraft-id^="system:"]');
 await expect(systems).toHaveCount(4);
 for (const locale of ['en', 'ja', 'zh']) {
  await page.locator('select:has(option[value="ja"])').selectOption(locale);
  const translated = await page.evaluate(async () => {
   // UI assertions need Vite's browser store, not a separate Node module instance.
   const { t } = await import('/src/i18n.ts');
   const { presets } = await import('/src/model.ts');
   return presets.map(plane => ({ id:`system:${plane.name}`, name:t(plane.name) }));
  });
  for (const plane of translated) await expect(page.locator(`[data-aircraft-id="${plane.id}"] h3`)).toHaveText(plane.name);
  await expect(page.locator('.saved-plane:not([data-aircraft-id^="system:"]) input')).toHaveValue(definition.name);
  const twin = page.locator('[data-aircraft-id="system:基础双发型"] p').first();
  const single = page.locator('[data-aircraft-id="system:基础单发型"] p').first();
  await expect(twin).toContainText('72%'); await expect(twin).toContainText('30 m/s');
  await expect(single).toContainText('55%'); await expect(single).toContainText('17 m/s');
 }
});
