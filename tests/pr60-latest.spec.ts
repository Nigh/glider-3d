import { expect, test, type Page } from '@playwright/test';
import type { AircraftDefinition } from '../src/model';

async function open(page: Page) {
 await page.addInitScript(() => localStorage.setItem('aero-formula.language', 'zh'));
 await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({status:200,contentType:'text/css',body:''}));
 await page.goto('/', {waitUntil:'domcontentloaded'});
 await page.getByRole('combobox', {name:'画质',exact:true}).selectOption('Low');
}

test('风洞中的真实高载荷使用共同色阶着色，关闭后恢复机体原色', async ({page},info) => {
 await open(page);
 await page.locator('.welcome').getByRole('button',{name:/风洞/}).click();
 await page.getByRole('button',{name:/前往风洞/}).click();
 const original=await page.evaluate(()=>(window as any).glider.scene.structureColors.map((wing:any[])=>wing.map(s=>[s.r,s.g,s.b])));
 await page.getByRole('spinbutton',{name:'气流速度数值',exact:true}).fill('10');
 await page.getByRole('spinbutton',{name:'俯仰角度数值',exact:true}).fill('0');
 await page.getByRole('switch',{name:'结构图层',exact:true}).click();
 await page.getByRole('button',{name:'俯视',exact:true}).click();
 await page.getByRole('button',{name:'开启风洞',exact:true}).click();
 let samples:{actual:number[];expected:number[]}[]=[];
 await expect.poll(async()=>{samples=await page.evaluate(async()=>{
  const displayPath='/src/structure-display.ts',threePath='/node_modules/three/build/three.module.js';
  const {structureLoadColor}=await import(displayPath),{Color}=await import(threePath);
  return (window as any).glider.scene.structureColors.flat().filter((s:any)=>s.load>0.5).map((s:any)=>({actual:[s.r,s.g,s.b],expected:new Color(structureLoadColor(s.load)).toArray()}));
 });return samples.length;},{timeout:60000}).toBeGreaterThan(0);
 for(const sample of samples)sample.actual.forEach((channel:number,i:number)=>expect(channel).toBeCloseTo(sample.expected[i],5));
 await page.screenshot({path:info.outputPath('loaded-structure-layer.png')});
 await page.getByRole('switch',{name:'结构图层',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).glider.scene.structureLayer)).toBe(false);
 expect(await page.evaluate(()=>(window as any).glider.scene.structureColors.map((wing:any[])=>wing.map(s=>[s.r,s.g,s.b])))).toEqual(original);
 const bars=await page.evaluate(async()=>{
  const path='/src/structure-display.ts',{structureLoadColor}=await import(path);
  return [...document.querySelectorAll('.wing-load[role=meter]')].map(el=>{const swatch=document.createElement('span');swatch.style.backgroundColor=`#${structureLoadColor(Number(el.getAttribute('aria-valuenow'))/100).toString(16).padStart(6,'0')}`;return {actual:(el.firstElementChild as HTMLElement).style.backgroundColor,expected:swatch.style.backgroundColor};});
 });for(const bar of bars)expect(bar.actual).toBe(bar.expected);
 for(const [locale,name] of [['en','Structure layer'],['ja','構造レイヤー'],['zh','结构图层']]){
  await page.getByRole('combobox',{name:/语言|Language|言語/}).selectOption(locale);
  await expect(page.getByRole('switch',{name,exact:true})).toBeVisible();
 }
});

test('结构面板可反复展开且实时刷新不折叠，结构图层切换生效', async ({page}, info) => {
 await open(page);
 await page.locator('.welcome').getByRole('button', {name:/高山速降/}).click();
 await page.getByRole('button', {name:'试飞',exact:true}).click();
 const panel=page.locator('.advanced-hud'), summary=panel.locator('summary');
 await expect(panel).not.toHaveAttribute('open','');
 await summary.click();
 await expect(panel).toHaveAttribute('open','');
 for(const name of ['主翼','水平辅助翼','垂直辅助翼']) await expect(page.getByRole('meter',{name:`${name}结构极限利用率`,exact:true})).toBeVisible();
 await expect(page.locator('.flight-hud .advanced-hud')).toHaveCount(0);
 await expect(page.locator('.flight-status')).toHaveCount(0);
 await expect(panel.locator('.wing-structure')).toHaveCount(3);
 await expect(panel).not.toContainText(/弹性|连接|脱离|形变|断片|结构完整/);
 for(const row of await panel.locator('.wing-structure').all()){
  const label=await row.locator('strong').boundingBox(),bar=await row.getByRole('meter').boundingBox();
  expect(label!.x+label!.width).toBeLessThan(bar!.x);
  await expect(row.getByRole('meter').locator('output')).toBeVisible();
 }
 const toggle=page.getByRole('switch',{name:'结构图层',exact:true});
 await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked','true');
 await page.getByRole('button',{name:'开始试飞',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).glider.recordingLength)).toBeGreaterThan(5);
 await expect(panel).toHaveAttribute('open','');
 const meters=await page.getByRole('meter').evaluateAll(elements=>elements.map(el=>({now:Number(el.getAttribute('aria-valuenow')),max:el.getAttribute('aria-valuemax'),width:(el.firstElementChild as HTMLElement).style.width})));
 expect(meters).toHaveLength(3);for(const meter of meters){expect(meter.max).toBe('100');expect(meter.now).toBeLessThanOrEqual(100);expect(parseFloat(meter.width)).toBeLessThanOrEqual(100);}
 await page.screenshot({path:info.outputPath('structure-panel.png')});
 await summary.click();await expect(panel).not.toHaveAttribute('open','');
 await summary.click();await expect(panel).toHaveAttribute('open','');
 await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','false');
});

test('鼠标点与光标对齐，死区灰色、有效杆量恢复颜色', async ({page},info) => {
 await open(page);
 await page.locator('.welcome').getByRole('button',{name:/高山速降/}).click();
 await page.getByRole('button',{name:'试飞',exact:true}).click();
 await page.keyboard.down('x');
 const joystick=page.locator('.joystick'),knob=joystick.locator('.stick-knob');await expect(joystick).toBeVisible();
 const bounds=(await joystick.boundingBox())!,cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2;
 for(const [dx,dy,dead] of [[3,2,true],[70,-45,false],[-93,67,false]] as const){
  await page.mouse.move(cx+dx,cy+dy);
  await expect(knob).toHaveClass(dead?/inactive/:/^stick-knob$/);
  const dot=(await knob.boundingBox())!;
  expect(dot.x+dot.width/2).toBeCloseTo(cx+dx,0);expect(dot.y+dot.height/2).toBeCloseTo(cy+dy,0);
 }
 await page.screenshot({path:info.outputPath('mouse-stick.png')});await page.keyboard.up('x');await expect(joystick).toBeHidden();
});

for (const completed of [false,true]) test(`导出${completed?'完赛':'未完赛'}回放使用关卡、成绩和本地日期命名`, async ({page}) => {
 await open(page);
 const replay=await page.evaluate(async completed=>{
  const physicsPath='/src/physics.ts',modelPath='/src/model.ts',replayPath='/src/replay.ts',challengePath='/src/challenges.ts';
  const {FlightSimulation}=await import(physicsPath),{clone,presets}=await import(modelPath),{exportReplay}=await import(replayPath),{challengeCheckpoints}=await import(challengePath);
  const definition=clone(presets.find((p:any)=>p.name==='高性能滑翔型')),sim=new FlightSimulation(definition,'downhill',0),gates=challengeCheckpoints('downhill'),gate=gates.at(-1);
  sim.launching=false;sim.time=21.3;sim.raceStarted=true;
  sim.position.set(gate.x-0.1,gate.y+(completed?20:-20),gate.z);sim.velocity.set(30,0,0);sim.quaternion.identity();
  if(completed)sim.checkpointIndex=gates.length-1;
  sim.step({weight:0,elevator:0,aileron:0,rudder:0});
  if(!sim.ended)throw Error('fixture did not finish');
  return exportReplay({definition,challenge:'downhill',recording:sim.getRecording()});
 },completed);
 await page.getByLabel('导入回放',{exact:true}).setInputFiles({name:'flight.json',mimeType:'application/json',buffer:Buffer.from(replay)});
 await expect(page.getByRole('button',{name:'开始试飞',exact:true})).toBeVisible();
 await page.getByRole('slider',{name:'回放进度',exact:true}).evaluate((el:HTMLInputElement)=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}));});
 await expect(page.getByLabel('回放时间轴',{exact:true})).toHaveAttribute('aria-busy','false');
 await page.getByRole('button',{name:'继续',exact:true}).click();
 await expect(page.getByRole('button',{name:'导出回放',exact:true})).toBeVisible();
 const expected=await page.evaluate(()=>{const result=(window as any).glider.result,date=new Date(),score=result.completed?result.time.toFixed(2).replaceAll('.','_'):'未完赛';return `replay-高山速降-${score}-${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}.json`;});
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出回放',exact:true}).click();expect((await download).suggestedFilename()).toBe(expected);
});

test('动力操纵台横向合并，油量相对起飞满油显示，双发偏移可编辑和撤销',async({page},info)=>{
 await open(page);
 await page.locator('.welcome').getByRole('button',{name:/低空飞行/}).click();
 await page.getByRole('tab',{name:'动力',exact:true}).click();
 await page.getByRole('combobox',{name:'引擎数量',exact:true}).selectOption('2');
 const offset=page.getByRole('spinbutton',{name:'引擎横向偏移精确值',exact:true});
 const initial=await offset.inputValue();
 await offset.fill('2');await offset.press('Tab');
 await expect(offset).toHaveValue('2.00');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(offset).toHaveValue(initial);
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect(offset).toHaveValue('2.00');
 const tinyTank=await page.evaluate(()=>{
  // The development API returns an independent aircraft snapshot.
  const app=window as unknown as {glider:{aircraft:AircraftDefinition}};
  const aircraft=app.glider.aircraft;aircraft.fuelTank.capacity=0.02;return aircraft;
 });
 await page.getByRole('button',{name:'机库',exact:true}).click();
 await page.getByLabel('导入飞机文件',{exact:true}).setInputFiles({name:'short-flight.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(tinyTank))});
 await page.getByRole('button',{name:'试飞',exact:true}).click();
 const consolePanel=page.locator('.stick-panel');
 const trims=consolePanel.getByRole('slider',{name:'升降舵配平',exact:true});
 const trimBounds=(await trims.boundingBox())!,trimWidth=trimBounds.width;
 expect(trimWidth).toBeGreaterThan(120);expect(trimWidth).toBeLessThan(180);
 await page.mouse.click(trimBounds.x+trimWidth*0.6,trimBounds.y+trimBounds.height/2);
 expect(Number(await trims.inputValue())).toBeGreaterThan(55);
 const engine=await consolePanel.locator('.engine-hud').boundingBox(),stick=await consolePanel.locator('.stick-main').boundingBox(),assists=await consolePanel.locator('.flight-assists').boundingBox();
 expect(engine!.x+engine!.width).toBeLessThanOrEqual(stick!.x);
 expect(stick!.x+stick!.width).toBeLessThanOrEqual(assists!.x);
 expect((await consolePanel.boundingBox())!.height).toBeLessThan(220);
 const fuel=consolePanel.getByRole('meter',{name:'剩余燃料',exact:true});
 await expect(fuel).toHaveAttribute('aria-valuenow','100');
 await expect(consolePanel.locator('.fuel-readout')).not.toHaveClass(/low-fuel/);
 await page.screenshot({path:info.outputPath('compact-powered-controls.png')});
 for(const locale of ['en','ja']){
  await page.getByRole('combobox',{name:/语言|Language/,exact:true}).selectOption(locale);
  expect((await consolePanel.boundingBox())!.height).toBeLessThan(220);
  expect(await consolePanel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 }
 const replay=await page.evaluate(async definition=>{
  // Browser fixtures load Vite modules in the page, not the Node test process.
  const physicsPath='/src/physics.ts',replayPath='/src/replay.ts';
  const {FlightSimulation}=await import(physicsPath),{exportReplay}=await import(replayPath);
  const simulation=new FlightSimulation(definition,'low-altitude',0);
  for(let tick=0;tick<600&&simulation.telemetry.fuelRemaining>=definition.fuelTank.capacity*0.19;tick++)simulation.step({weight:0,elevator:0,aileron:0,rudder:0,throttle:1});
  if(simulation.telemetry.fuelRemaining>=definition.fuelTank.capacity*0.2)throw Error('fixture did not reach low fuel');
  return exportReplay({definition,challenge:'low-altitude',recording:simulation.getRecording()});
 },tinyTank);
 await page.getByRole('combobox',{name:'言語',exact:true}).selectOption('zh');
 await page.getByRole('button',{name:'返回设计',exact:true}).click();
 await page.getByLabel('导入回放',{exact:true}).setInputFiles({name:'low-fuel.json',mimeType:'application/json',buffer:Buffer.from(replay)});
 await page.getByRole('slider',{name:'回放进度',exact:true}).evaluate((el:HTMLInputElement)=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}));});
 await expect(page.getByLabel('回放时间轴',{exact:true})).toHaveAttribute('aria-busy','false');
 const replayFuel=page.locator('.replay-inputs .fuel-readout');
 await expect(replayFuel).toHaveClass(/low-fuel/);
 expect(Number(await replayFuel.getByRole('meter').getAttribute('aria-valuenow'))).toBeLessThan(20);
 await page.screenshot({path:info.outputPath('low-fuel-replay.png')});
});
