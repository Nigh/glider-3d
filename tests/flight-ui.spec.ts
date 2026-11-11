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
