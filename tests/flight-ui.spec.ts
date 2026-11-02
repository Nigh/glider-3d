import { test, expect } from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('aero-formula.language','zh'));
 await page.goto('/');
 await page.getByRole('button',{name:'高山速降',exact:false}).click();
 await page.getByRole('button',{name:'试飞',exact:true}).click();
 await page.getByRole('button',{name:'开始试飞',exact:true}).click();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 // The paused UI stays live; stop submitting identical WebGL frames during control assertions.
 await page.evaluate(()=>{window.requestAnimationFrame=()=>0;});
});

test('气动窗口按流布局，配平中点吸附、热键步进和临时显示',async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'气动图层',exact:true}).click();
 const panel=page.getByRole('complementary',{name:'实时气动数据'});
 const pitch=panel.getByRole('slider',{name:'升降舵配平',exact:true}),roll=panel.getByRole('slider',{name:'副翼配平',exact:true});
 await expect(pitch).toHaveValue('50');await expect(roll).toHaveValue('50');
 expect(await pitch.evaluate(e=>getComputedStyle(e).writingMode)).toBe('vertical-lr');
 await roll.evaluate(e=>{const input=e as HTMLInputElement;input.value='53';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await expect(roll).toHaveValue('50');
 await roll.evaluate(e=>{const input=e as HTMLInputElement;input.value='67';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await expect(roll).toHaveValue('67');
 await roll.focus();await page.keyboard.press('h');await expect(roll).toHaveValue('60');
 await page.keyboard.press('l');await expect(roll).toHaveValue('70');
 await page.keyboard.press('j');await expect(pitch).toHaveValue('40');
 await page.keyboard.press('k');await expect(pitch).toHaveValue('50');
 const bounds=await page.evaluate(()=>{
  const panel=document.querySelector('.aero-live')!.getBoundingClientRect(),hud=document.querySelector('.flight-hud')!.getBoundingClientRect();
  return {left:panel.left,right:panel.right,top:panel.top,hudBottom:hud.bottom,width:innerWidth,bg:getComputedStyle(document.querySelector('.aero-live')!).backgroundColor};
 });
 expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(bounds.width);expect(bounds.top).toBeGreaterThanOrEqual(bounds.hudBottom);
 expect(bounds.bg).toBe('rgb(18, 61, 67)');
 await panel.scrollIntoViewIfNeeded();
 await page.screenshot({path:testInfo.outputPath('aero-trim.png')});
 await page.getByRole('button',{name:'气动图层',exact:true}).click();
 await expect(panel).toHaveCount(0,{timeout:4000});
 await page.getByRole('button',{name:'气动图层',exact:true}).focus();
 const flash=await page.evaluate(async()=>{
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'h',code:'KeyH',bubbles:true}));
  await Promise.resolve();
  return {visible:!!document.querySelector('.aero-live'),value:(document.querySelector('.roll-trim input') as HTMLInputElement)?.value};
 });
 expect(flash).toEqual({visible:true,value:'60'});
 const transient=page.getByRole('complementary',{name:'实时气动数据'});
 await expect(transient).toHaveCount(0,{timeout:6000});
 expect(errors).toEqual([]);
});
