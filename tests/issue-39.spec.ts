import { test, expect } from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('aero-formula.language','zh'));
 await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await page.getByRole('combobox',{name:'画质',exact:true}).selectOption('Low');
});

test('remembers the selected flight camera across retries and reloads',async({page})=>{
 await page.getByRole('button',{name:'高山速降',exact:false}).click();
 await page.getByRole('button',{name:'试飞',exact:true}).click();
 await page.getByLabel('飞行相机',{exact:true}).selectOption('驾驶员');
 await page.getByRole('button',{name:'返回设计',exact:true}).click();
 await page.getByRole('button',{name:'试飞',exact:true}).click();
 await expect(page.getByLabel('飞行相机',{exact:true})).toHaveValue('驾驶员');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'高山速降',exact:false}).click();
 await page.getByRole('button',{name:'试飞',exact:true}).click();
 await expect(page.getByLabel('飞行相机',{exact:true})).toHaveValue('驾驶员');
 await page.locator('canvas').click({position:{x:20,y:300}});
 await page.keyboard.press('KeyC');
 expect(await page.evaluate(()=>localStorage.getItem('aero-formula.flight-camera'))).toBe('自由');
});

test('chord lines ignore dragging while visible handles remain editable',async({page})=>{
 await page.getByRole('button',{name:'鸟人间挑战',exact:false}).click();
 await expect(page.locator('.scene-editor')).toBeVisible();
 const before=await page.evaluate(()=>(window as any).glider.aircraft);
 // The chord itself must not capture pointer events.
 const point=page.locator('.editor-point[data-handle="1"]');
 const lines=page.locator('.editor-chord line');
 expect(await lines.evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).pointerEvents==='none'))).toBe(true);
 const target=await page.locator('.scene-editor').evaluate(svg=>{
  const box=svg.getBoundingClientRect();
  for(const group of svg.querySelectorAll<SVGGElement>('.editor-chord')){
   if(group.style.display==='none')continue;
   const line=group.querySelector('line')!;
   for(const fraction of [0.25,0.5,0.75]){
    const x=box.left+Number(line.getAttribute('x1'))*(1-fraction)+Number(line.getAttribute('x2'))*fraction;
    const y=box.top+Number(line.getAttribute('y1'))*(1-fraction)+Number(line.getAttribute('y2'))*fraction;
    if(document.elementFromPoint(x,y)?.tagName.toLowerCase()==='canvas')return {x,y};
   }
  }
  return null; // Compact layouts can place legitimate 44px handles over the entire chord.
 });
 if(target){await page.mouse.move(target.x,target.y);await page.mouse.down();await page.mouse.move(target.x+12,target.y+12,{steps:3});await page.mouse.up();}
 expect(await page.evaluate(()=>(window as any).glider.aircraft)).toEqual(before);
 // Normal visible handles remain usable; chord geometry must never steal the hit.
 const box=(await point.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+16,box.y+box.height/2+14,{steps:4});await page.mouse.up();
 const after=await page.evaluate(()=>(window as any).glider.aircraft);
 expect(after.mainWing.points[1]).not.toEqual(before.mainWing.points[1]);
 expect(after.mainWing.points[0]).toEqual(before.mainWing.points[0]);
 expect(after.mainWing.points[3]).toEqual(before.mainWing.points[3]);
});

test('replay renders its own aircraft, seeks both ways and shows G only for powered challenges',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const fixture=await page.evaluate(async()=>{
  const {FlightSimulation}=await import('/src/physics.ts');const {presets,clone}=await import('/src/model.ts');const {exportReplay}=await import('/src/replay.ts');
  const definition=clone(presets.find(p=>p.name==='低空喷气巡航型')!);const sim=new FlightSimulation(definition,'downhill',0);
  for(let i=0;i<4000&&!sim.ended;i++)sim.step({weight:0,elevator:0,aileron:0,rudder:0,throttle:1});
  if(!sim.ended)throw Error('Fixture did not finish');
  return {text:await exportReplay({definition,challenge:'downhill',recording:sim.getRecording()}),duration:sim.elapsedTime,result:sim.result};
 });
 const design=await page.evaluate(()=>(window as any).glider.aircraft);
 await page.getByLabel('导入回放',{exact:true}).setInputFiles({name:'powered.json',mimeType:'application/json',buffer:Buffer.from(fixture.text)});
 await expect.poll(()=>page.evaluate(()=>(window as any).glider.scene.engines.filter((e:any)=>e.visible).length)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>(window as any).glider.aircraft)).toEqual(design);
 await page.getByRole('button',{name:'开始试飞',exact:true}).click({trial:true});
 const timeline=page.getByRole('region',{name:'回放时间轴',exact:true});
 await expect(timeline).toHaveAttribute('aria-busy','false',{timeout:60000});
 await expect(page.getByRole('img',{name:'翼面负载曲线',exact:true})).toBeVisible();
 await expect(timeline.locator('polyline.main-load')).toHaveAttribute('points',/\d/);
 const seek=async(value:number)=>{await page.getByRole('slider',{name:'回放进度',exact:true}).evaluate((el:HTMLInputElement,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);await expect(timeline).toHaveAttribute('aria-busy','false',{timeout:60000});};
 await seek(fixture.duration*0.7);
 const later=await page.evaluate(()=>(window as any).glider.scene.aircraft);
 await timeline.getByRole('button',{name:/跳至负载峰值/}).click();
 await expect(timeline).toHaveAttribute('aria-busy','false');
 await seek(fixture.duration*0.25);
 const earlier=await page.evaluate(()=>(window as any).glider.scene.aircraft);expect(earlier).not.toEqual(later);
 await seek(fixture.duration);
 await page.getByRole('button',{name:'继续飞行',exact:true}).click();
 await expect(page.getByRole('region',{name:'飞行结算',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).glider.result)).toEqual(fixture.result);
 await expect(page.locator('.result-g')).toContainText(fixture.result!.maxG.toFixed(2));
 await expect(page.getByRole('img',{name:/飞行数据曲线/}).locator('.chart-g-line')).toHaveCount(1);
 await page.screenshot({path:info.outputPath('replay-g-load.png')});
 await seek(0);
 await page.getByRole('slider',{name:'回放进度',exact:true}).press('Home');
 await expect(page.getByRole('region',{name:'飞行结算',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).glider.scene.aircraft)).not.toEqual(later);
 expect(errors).toEqual([]);
});
