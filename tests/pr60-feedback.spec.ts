import { expect, test, type Page } from '@playwright/test';
import { createLegacyReplay } from './fixtures/legacy-replay';
async function open(page: Page) {
 await page.setViewportSize({ width: 1000, height: 800 });
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
 await page.goto('/', { waitUntil: 'domcontentloaded' });
 await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('Low');
}

test('导入旧回放时全局遮罩阻挡鼠标和快捷键，成功和失败后均恢复', async ({ page }, info) => {
 await open(page);
 await page.locator('.welcome').getByRole('button', { name: /鸟人间挑战/ }).click();
 const before = await page.evaluate(() => (window as any).glider.aircraft);
 await page.evaluate(() => {
  const original = File.prototype.text;
  File.prototype.text = function () { return new Promise(resolve => { (window as any).releaseImport = async () => resolve(await original.call(this)); }); };
 });
 const upload = (buffer: Buffer) => page.getByLabel('导入回放', { exact: true }).setInputFiles({ name: 'replay.json', mimeType: 'application/json', buffer });
 await upload(Buffer.from(await createLegacyReplay()));
 const overlay = page.getByRole('dialog', { name: '正在导入回放…' });
 await expect(overlay).toBeVisible();
 expect(await overlay.evaluate(el => el.matches(':modal'))).toBe(true);
 await page.screenshot({ path: info.outputPath('replay-import-overlay.png') });
 for (const key of ['Escape', 'Space', 'Control+z', 'Tab']) await page.keyboard.press(key);
 await page.mouse.click(30, 30);
 await expect(overlay).toBeVisible();
 expect(await page.evaluate(() => (window as any).glider.state)).toBe('design');
 expect(await page.evaluate(() => (window as any).glider.aircraft)).toEqual(before);
 await page.evaluate(() => (window as any).releaseImport());
 await expect(overlay).not.toBeVisible();
 await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeVisible();
 await page.keyboard.press('Escape');
 await upload(Buffer.from('{'));
 await expect(overlay).toBeVisible();
 await page.evaluate(() => (window as any).releaseImport());
 await expect(overlay).not.toBeVisible();
 await expect(page.locator('.toast')).toContainText('导入失败');
 await page.getByRole('button', { name: '试飞', exact: true }).click();
 await expect(page.getByRole('button', { name: '开始试飞', exact: true })).toBeEnabled();
});

test('Ghost 使用项目按钮，速降出发前显示有效计时零且窄屏可用', async ({ page }, info) => {
 await open(page);
 await page.locator('.welcome').getByRole('button', { name: /高山速降/ }).click();
 await page.getByRole('button', { name: '试飞', exact: true }).click();
 await expect(page.getByLabel('有效计时', { exact: true })).toHaveText('0.00');
 await expect(page.locator('.flight-sidebar .race-clock')).toHaveCount(0);
 let timerBounds=(await page.locator('.downhill-timing').boundingBox())!;
 expect(timerBounds.x+timerBounds.width/2).toBeCloseTo(500,0);
 const picker = page.getByRole('button', { name: '选择 Ghost 回放文件', exact: true });
 await expect(picker).toBeVisible();
 await expect(page.getByLabel('选择 Ghost 回放文件', { exact: true })).toBeHidden();
 await page.setViewportSize({ width: 390, height: 844 });
 timerBounds=(await page.locator('.downhill-timing').boundingBox())!;
 expect(timerBounds.x+timerBounds.width/2).toBeCloseTo(195,0);
 expect(await page.locator('.flight-hud').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 const bounds = await picker.boundingBox();
 expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
 await page.screenshot({ path: info.outputPath('downhill-ghost-mobile.png') });
 await page.getByRole('button', { name: '开始试飞', exact: true }).click();
 await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
 await page.getByRole('button', { name: '暂停', exact: true }).click();
 const time = await page.getByLabel('有效计时', { exact: true }).textContent();
 await page.waitForTimeout(100);
 await expect(page.getByLabel('有效计时', { exact: true })).toHaveText(time!);
});

test('检查点秒差显示领先、落后、持平、未通过和重飞清零，语言切换即时生效', async ({ page }) => {
 await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({status:200,contentType:'text/css',body:''}));
 await page.route('**/timing-test', route => route.fulfill({ contentType: 'text/html', body: '<html><body><div id="timing"></div><script type="module" src="/tests/fixtures/downhill-timing-harness.ts"></script></body></html>' }));
 await page.goto('/timing-test');
 await page.waitForFunction(() => typeof (window as any).timing === 'function');
 const render=(own: number[], reference: (number|null)[], active=true, started=true)=>page.evaluate(props=>(window as any).timing(props),{time:13.456,started,checkpointTimes:own,ghostTimes:reference,ghostActive:active});
 await render([10.125],[11.375]);
 await expect(page.getByLabel('有效计时', { exact: true })).toHaveText('13.46');
 const split=page.locator('.race-split');
 await expect(split).toContainText('-1.25'); await expect(split).toContainText('领先 Ghost');
 await render([10,13],[9,11]); await expect(split).toContainText('检查点 2'); await expect(split).toContainText('+2.00'); await expect(split).toContainText('落后 Ghost');
 await render([10],[10]); await expect(split).toContainText('0.00'); await expect(split).toContainText('与 Ghost 持平');
 await render([10],[null]); await expect(split).toContainText('Ghost 未通过此检查点');
 await page.evaluate(()=>(window as any).locale('en')); await expect(split).toContainText('Ghost did not reach this checkpoint');
 await render([10],[11],false); await expect(split).toHaveCount(0);
 await render([],[],true,false); await expect(split).toHaveCount(0); await expect(page.getByLabel('Race time', { exact: true })).toHaveText('0.00');
 await render([10],[11]);
 for(const language of ['zh','en','ja'])for(const viewport of [{width:1000,height:800},{width:390,height:844},{width:844,height:390}]){
  await page.evaluate(value=>(window as any).locale(value),language);await page.setViewportSize(viewport);
  const panel=page.locator('.downhill-timing'),bounds=(await panel.boundingBox())!;
  expect(bounds.x+bounds.width/2).toBeCloseTo(viewport.width/2,0);expect(bounds.y).toBeLessThan(110);
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 }
});

for (const completed of [false,true]) test(`速降结算${completed?'完赛显示成绩':'未完赛隐藏成绩时间'}`, async ({ page }) => {
 await open(page);
 const replay=await page.evaluate(async completed=>{
  const physicsPath='/src/physics.ts',modelPath='/src/model.ts',replayPath='/src/replay.ts',challengePath='/src/challenges.ts';
  const {FlightSimulation}=await import(physicsPath),{clone,presets}=await import(modelPath),{exportReplay}=await import(replayPath),{challengeCheckpoints}=await import(challengePath);
  const definition=clone(presets.find((p: any)=>p.name==='高性能滑翔型')),sim=new FlightSimulation(definition,'downhill',0),gates=challengeCheckpoints('downhill'),gate=gates.at(-1);
  sim.launching=false; sim.time=21.3; sim.raceStarted=true;
  sim.position.set(gate.x-0.1,gate.y+(completed?20:-20),gate.z); sim.velocity.set(30,0,0);sim.quaternion.identity();
  if(completed)sim.checkpointIndex=gates.length-1;
  sim.step({weight:0,elevator:0,aileron:0,rudder:0});
  if(!sim.ended||sim.result.completed!==completed)throw Error('fixture did not finish');
  return exportReplay({definition,challenge:'downhill',recording:sim.getRecording()});
 },completed);
 await page.getByLabel('导入回放',{exact:true}).setInputFiles({name:'result.json',mimeType:'application/json',buffer:Buffer.from(replay)});
 await expect(page.getByRole('button',{name:'开始试飞',exact:true})).toBeVisible();
 const progress=page.getByRole('slider',{name:'回放进度',exact:true});
 await progress.evaluate((el: HTMLInputElement)=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}));});
 await expect(page.getByLabel('回放时间轴',{exact:true})).toHaveAttribute('aria-busy','false');
 await page.getByRole('button',{name:'继续',exact:true}).click();
 const result=page.getByLabel('飞行结算',{exact:true});await expect(result).toBeVisible();
 if(completed){await expect(result.locator('.score')).toContainText('21.');await expect(result.locator('.result-statistics')).toContainText('总计时');}
 else {await expect(result.locator('.score')).toHaveText('未完赛');await expect(result.locator('.result-statistics')).not.toContainText('总计时');await expect(result.locator('.best')).not.toContainText('个人最佳');}
});
