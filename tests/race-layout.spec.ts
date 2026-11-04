import {test,expect} from '@playwright/test';

 for(const mode of ['鸟人间挑战','高山速降','低空飞行'])test(`${mode}结算曲线保留可读尺寸且可滚动访问`,async({page},info)=>{
 await page.addInitScript(()=>localStorage.setItem('aero-formula.language','zh'));
 await page.goto('/');
 await page.getByRole('button',{name:mode,exact:false}).click();
 await page.getByRole('button',{name:'试飞',exact:true}).click();
 // Finish a short real simulation to exercise result layout without flying the full course.
 await page.evaluate(async()=>{
  const path=performance.getEntriesByType('resource').map(e=>e.name).find(name=>name.includes('/src/physics.ts'))!;const {FlightSimulation}=await import(/* @vite-ignore */ path);
  const step=FlightSimulation.prototype.step;
  FlightSimulation.prototype.step=function(...args:any[]){step.apply(this,args);if(this.recordingLength>6&&!this.ended){if(this.challenge==='low-altitude'){this.checkpointScores.push(...Array(30).fill(1500));this.telemetry.score=45000;}this.finish('boundary');}};
 });
 await page.getByRole('combobox',{name:'飞行相机'}).selectOption('驾驶员');
 await page.getByRole('button',{name:'开始试飞',exact:true}).click();
 const result=page.getByRole('region',{name:'飞行结算',exact:true});await expect(result).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).glider.scene.view)).toBe('orbit');
 await expect(result.locator('.chart-energy-line,.chart-cost-line')).toHaveCount(mode==='鸟人间挑战'?2:0);
 await expect(result.locator('.chart-speed-line')).toHaveCount(1);
 await expect(result.locator('.chart-scoring-line')).toHaveCount(mode==='低空飞行'?1:0);
 const bounds=await result.evaluate(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom}));
 expect(bounds.top).toBeGreaterThanOrEqual(0);expect(bounds.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
 const chart=result.locator('.trajectory-panel svg');
 const chartBounds=await chart.evaluate(e=>({width:e.clientWidth,height:e.clientHeight}));expect(chartBounds.width).toBeGreaterThanOrEqual(720);expect(chartBounds.height).toBeGreaterThanOrEqual(230);
 const viewport=result.locator('.chart-viewport');
 await viewport.evaluate(e=>e.scrollLeft=e.scrollWidth);
 await expect(result.locator('.chart-speed-line')).toBeAttached();
 await result.getByRole('button',{name:'返回设计改进',exact:true}).scrollIntoViewIfNeeded();
 await expect(result.getByRole('button',{name:'返回设计改进',exact:true})).toBeInViewport();
 await page.screenshot({path:info.outputPath('race-result.png')});
});

