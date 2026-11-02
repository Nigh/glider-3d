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
  await expect(page.getByRole('combobox', { name: value.material, exact: true })).toHaveValue('carbon-epoxy');
  await expect(page.getByRole('slider', { name: value.amount, exact: true })).toHaveValue('100');
  await expect(page.getByRole('spinbutton', { name: value.precise, exact: true })).toHaveValue('100');
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
