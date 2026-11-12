import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function enterFlight(page: Page, challenge = '高山速降') {
 await page.addInitScript(()=>localStorage.setItem('aero-formula.language','zh'));
 await page.goto('/');
 await page.getByRole('button',{name:challenge,exact:false}).click();
 await page.getByRole('button',{name:'重置设计',exact:true}).click();
 await page.getByRole('button',{name:'试飞',exact:true}).click();
}

test('开始试飞后配平集中在圆形杆量仪表',async({page})=>{
 await enterFlight(page);
 const start=page.getByRole('button',{name:'开始试飞',exact:true});
 const panel=page.getByRole('region',{name:'杆量与配平',exact:true});
 await expect(panel).toBeVisible();
 const pitch=panel.getByRole('slider',{name:'升降舵配平',exact:true});
 const roll=panel.getByRole('slider',{name:'副翼配平',exact:true});
 await expect(pitch).toHaveValue('50');await expect(roll).toHaveValue('50');
 await page.keyboard.press('j');await expect(pitch).toHaveValue('49');
 await page.keyboard.press('k');await expect(pitch).toHaveValue('50');
 await page.keyboard.press('h');await expect(roll).toHaveValue('49');
 await page.keyboard.press('l');await expect(roll).toHaveValue('50');
 await start.click();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('switch',{name:'气动图层',exact:true}).click();
 const aero=page.getByRole('complementary',{name:'实时气动数据'});
 await expect(aero.getByRole('slider',{name:'升降舵配平',exact:true})).toHaveCount(0);
 await expect(panel).toBeVisible();
});

test('T与Y切换飞行辅助，重飞复位，鸟人禁用自动配平',async({page})=>{
 await enterFlight(page);
 await page.getByRole('button',{name:'开始试飞',exact:true}).click();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 const auto=page.getByRole('switch',{name:'自动升降舵配平（T）',exact:true});
 const adaptive=page.getByRole('switch',{name:'自适应杆量（Y）',exact:true});
 await expect(auto).toHaveAttribute('aria-checked','false');
 await page.keyboard.press('t');await expect(auto).toHaveAttribute('aria-checked','true');
 await auto.click();await expect(auto).toHaveAttribute('aria-checked','false');
 await page.keyboard.press('y');await expect(adaptive).toHaveAttribute('aria-checked','true');
 await adaptive.click();await expect(adaptive).toHaveAttribute('aria-checked','false');
 await page.keyboard.press('t');await page.keyboard.press('y');await page.keyboard.press('r');
 await page.getByRole('button',{name:'开始试飞',exact:true}).click();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await expect(auto).toHaveAttribute('aria-checked','false');await expect(adaptive).toHaveAttribute('aria-checked','false');
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'返回主菜单',exact:true}).click();
 await page.getByRole('button',{name:'鸟人间挑战',exact:false}).click();
 await page.getByRole('button',{name:'试飞',exact:true}).click();
 await page.getByRole('button',{name:'开始试飞',exact:true}).click();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await expect(auto).toBeDisabled();await page.keyboard.press('t');
 await expect(auto).toHaveAttribute('aria-checked','false');
});

test('满油门待开始可调，1增2减且Shift和Ctrl不再控制油门',async({page})=>{
 await enterFlight(page,'低空飞行');
 const throttle=page.getByRole('slider',{name:'油门',exact:true});
 await expect(throttle).toBeEnabled();await expect(throttle).toHaveValue('1');
 await throttle.fill('0.5');
 await page.keyboard.down('2');
 try{await expect.poll(async()=>Number(await throttle.inputValue())).toBeLessThan(0.4);}finally{await page.keyboard.up('2');}
 await page.keyboard.down('1');
 try{await expect.poll(async()=>Number(await throttle.inputValue())).toBeGreaterThan(0.5);}finally{await page.keyboard.up('1');}
 const selected=await throttle.inputValue();
 await page.keyboard.down('Shift');await page.keyboard.down('Control');
 try{
  await page.evaluate(()=>{const {promise,resolve}=Promise.withResolvers<void>();let frames=0;const tick=()=>{if(++frames===8)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);return promise;});
  await expect(throttle).toHaveValue(selected);
 }finally{await page.keyboard.up('Control');await page.keyboard.up('Shift');}
 await expect(page.getByRole('button',{name:'开始试飞',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'开始试飞',exact:true}).click();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await expect(throttle).toHaveValue(selected);
});

test('R仅暂停时重飞，准备和飞行中保留当前试飞',async({page})=>{
 await enterFlight(page,'低空飞行');
 const throttle=page.getByRole('slider',{name:'油门',exact:true});
 const start=page.getByRole('button',{name:'开始试飞',exact:true});
 await throttle.fill('0.43');
 await page.keyboard.press('r');
 await expect(start).toBeVisible();await expect(throttle).toHaveValue('0.43');
 await start.click();
 await expect.poll(()=>page.evaluate(()=>window.glider.recordingLength)).toBeGreaterThan(6);
 const frames=await page.evaluate(()=>window.glider.recordingLength);
 await page.keyboard.press('r');
 await expect(start).toHaveCount(0);await expect(throttle).toHaveValue('0.43');
 expect(await page.evaluate(()=>window.glider.flightReady)).toBe(true);
 expect(await page.evaluate(()=>window.glider.recordingLength)).toBeGreaterThanOrEqual(frames);
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.keyboard.press('r');
 await expect(start).toBeVisible();await expect(throttle).toHaveValue('1');
 expect(await page.evaluate(()=>window.glider.flightReady)).toBe(false);
 expect(await page.evaluate(()=>window.glider.recordingLength)).toBe(0);
});

test('工坊每个翼面保留响应轴，支持撤销与重置',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('aero-formula.language','zh'));
 await page.goto('/');
 await page.getByRole('button',{name:'高山速降',exact:false}).click();
 await page.getByRole('button',{name:'重置设计',exact:true}).click();
 const axes=page.getByRole('group',{name:'舵面响应轴',exact:true});
 for(const [part,roll,pitch,yaw] of [['主翼',true,true,false],['副翼',true,true,false],['垂直尾翼',false,false,true]] as const){
  await page.getByRole('tab',{name:part,exact:true}).click();
  for(const [axis,enabled] of [['滚转',roll],['俯仰',pitch],['偏航',yaw]] as const)await expect(axes.getByRole('switch',{name:`${axis}响应`,exact:true})).toHaveAttribute('aria-checked',String(enabled));
 }
 const roll=axes.getByRole('switch',{name:'滚转响应',exact:true});
 await roll.click();await expect(roll).toHaveAttribute('aria-checked','true');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(roll).toHaveAttribute('aria-checked','false');
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect(roll).toHaveAttribute('aria-checked','true');
 await page.getByRole('tab',{name:'主翼',exact:true}).click();
 await page.getByRole('tab',{name:'垂直尾翼',exact:true}).click();await expect(roll).toHaveAttribute('aria-checked','true');
 expect(await page.evaluate(()=>window.glider.aircraft.verticalTail.controlAxes)).toEqual({roll:true,pitch:false,yaw:true});
 await page.getByRole('button',{name:'重置设计',exact:true}).click();await expect(roll).toHaveAttribute('aria-checked','false');
});

test('智能混控默认关闭，支持U和输入设置，重飞复位',async({page})=>{
 await enterFlight(page);
 const mixing=page.getByRole('switch',{name:'智能混控（U）',exact:true});
 await expect(mixing).toBeVisible();await expect(mixing).toHaveAttribute('aria-checked','false');
 await page.keyboard.press('u');await expect(mixing).toHaveAttribute('aria-checked','true');
 expect(await page.evaluate(()=>window.glider.flightControls.smartMixing)).toBe(true);
 await mixing.click();await expect(mixing).toHaveAttribute('aria-checked','false');
 await page.getByRole('button',{name:'输入设置',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'输入设置',exact:true});
 const row=settings.locator('[data-action="smartMixing"]');
 await expect(row.locator('[data-code="KeyU"]')).toBeVisible();
 await row.getByRole('button',{name:'添加绑定：智能混控',exact:true}).click();
 await page.keyboard.press('b');await settings.getByRole('banner').getByRole('button',{name:'保存',exact:true}).click();
 await page.keyboard.press('b');await expect(mixing).toHaveAttribute('aria-checked','true');
 await page.getByRole('button',{name:'开始试飞',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.glider.telemetry?.smartMixing)).toBe(true);
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.keyboard.press('r');await expect(mixing).toHaveAttribute('aria-checked','false');
 expect(await page.evaluate(()=>window.glider.flightControls.smartMixing)).toBe(false);
});

test('回放智能混控只读且跟随记录和跳转',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('aero-formula.language','zh'));
 await page.goto('/');
 const text=await page.evaluate(async()=>{
  // This fixture exercises browser modules; Node imports cannot run inside page.evaluate.
  const {FlightSimulation}=await import('/src/physics.ts');
  const {defaultAircraft}=await import('/src/model.ts');
  const {exportReplay}=await import('/src/replay.ts');
  const simulation=new FlightSimulation(defaultAircraft,'birdman',0);
  for(let frame=0;frame<60;frame++)simulation.step({weight:0,elevator:0,aileron:0,rudder:0,smartMixing:frame>=30});
  return exportReplay({definition:defaultAircraft,challenge:'birdman',recording:simulation.getRecording()});
 });
 await page.getByLabel('导入回放',{exact:true}).setInputFiles({name:'mixing.json',mimeType:'application/json',buffer:Buffer.from(text)});
 const mixing=page.getByRole('region',{name:'实时杆量',exact:true}).getByRole('switch',{name:'智能混控（U）',exact:true});
 await expect(mixing).toBeVisible();await expect(mixing).toBeDisabled();await expect(mixing).toHaveAttribute('aria-checked','false');
 const timeline=page.getByRole('region',{name:'回放时间轴',exact:true});
 await page.getByRole('slider',{name:'回放进度',exact:true}).press('End');
 await expect(timeline).toHaveAttribute('aria-busy','false',{timeout:60000});
 await expect(mixing).toHaveAttribute('aria-checked','true');
 await page.keyboard.press('u');await expect(mixing).toHaveAttribute('aria-checked','true');
 expect(await page.evaluate(()=>window.glider.flightControls.smartMixing)).toBe(true);
 await page.getByRole('slider',{name:'回放进度',exact:true}).press('Home');
 await expect(timeline).toHaveAttribute('aria-busy','false',{timeout:60000});
 await expect(mixing).toHaveAttribute('aria-checked','false');
});

test('回放倒飞时俯仰杆量与配平标记反向，配平设定不变',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('aero-formula.language','zh'));
 await page.goto('/');
 const text=await page.evaluate(async()=>{
  // Browser-only fixture modules must load in the page, not the Node test process.
  const {FlightSimulation}=await import('/src/physics.ts');
  const {presets,clone}=await import('/src/model.ts');
  const {exportReplay}=await import('/src/replay.ts');
  const definition=clone(presets.find(plane=>plane.name==='基础单发型')!);
  const simulation=new FlightSimulation(definition,'downhill',0);
  // Capture a valid replay keyframe in inverted free flight, without changing live UI state.
  simulation.launching=false;
  simulation.position.set(100,2000,0);
  simulation.quaternion.set(1,0,0,0);
  simulation.velocity.set(20,0,0);
  simulation.omega.set(0,0,0);
  for(let frame=0;frame<60;frame++)simulation.step({weight:0,lateral:0,elevator:0,aileron:0,rudder:0,trimPitch:0.4});
  return exportReplay({definition,challenge:'downhill',recording:simulation.getRecording()});
 });
 await page.getByLabel('导入回放',{exact:true}).setInputFiles({name:'inverted.json',mimeType:'application/json',buffer:Buffer.from(text)});
 await page.getByRole('slider',{name:'回放进度',exact:true}).press('End');
 await expect(page.getByRole('region',{name:'回放时间轴',exact:true})).toHaveAttribute('aria-busy','false');
 await expect.poll(async()=>Number(await page.locator('.stick-pad .stick-position').getAttribute('cy'))).toBeGreaterThan(60);
 const values=await page.evaluate(()=>{
  const t=window.glider.telemetry;
  const dot=document.querySelector('.stick-pad .stick-position')!;
  return {roll:t.roll,pitch:t.controlInputs.elevator,trim:t.trimPitch,cy:Number(dot.getAttribute('cy')),marker:document.querySelector('.stick-trim-marker')!.getAttribute('d')!};
 });
 expect(Math.cos(values.roll)).toBeLessThan(-0.9);
 expect(Math.abs(values.pitch)).toBeGreaterThan(0.1);
 expect(values.cy).toBeCloseTo(60-values.pitch*Math.cos(values.roll)*35,5);
 expect(Number(values.marker.split(' ')[2])).toBeCloseTo(60-values.trim*Math.cos(values.roll)*35,5);
 await expect(page.getByRole('slider',{name:'升降舵配平',exact:true})).toHaveValue(String((values.trim+1)*50));
});
