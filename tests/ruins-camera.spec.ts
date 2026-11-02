import {test,expect} from '@playwright/test';

test('油门位于左侧并保留竖直滑条',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('aero-formula.language','zh'));
 await page.goto('/');await page.getByRole('button',{name:'低空飞行',exact:false}).click();
 await page.getByRole('button',{name:'试飞',exact:true}).click();
 const throttle=page.getByRole('slider',{name:'油门',exact:true});
 const box=(await throttle.boundingBox())!;
 expect(box.x+box.width).toBeLessThan(page.viewportSize()!.width*0.4);
 expect(await throttle.evaluate(e=>getComputedStyle(e).writingMode)).toBe('vertical-lr');
});

test('平原废墟实例与碰撞盒一致，连续路线穿过楼间通道',async({page},info)=>{
 test.skip(info.project.name!=='desktop-chromium','场景几何在桌面验证');
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const source=(name:string)=>performance.getEntriesByType('resource').map(e=>e.name).find(p=>p.includes(`/src/${name}.ts`))!;
  const {SceneView}=await import(/* @vite-ignore */ source('scene'));
  const {FlightSimulation}=await import(/* @vite-ignore */ source('physics'));
  const {presets}=await import(/* @vite-ignore */ source('model'));
  const {downhillRuins,downhillRouteCenter,challengeTerrainHeight}=await import(/* @vite-ignore */ source('challenges'));
  const threePath='/node_modules/.vite/deps/three.js';const {Matrix4,Vector3,Quaternion,Euler}=await import(/* @vite-ignore */ threePath);
  document.querySelector<HTMLElement>('.app')!.style.display='none';
  const host=document.createElement('div');host.id='ruins-preview';host.style.cssText='position:fixed;inset:0';document.body.append(host);
  const view=new SceneView(host);view.setQuality('Low');
  const sim=new FlightSimulation(presets.find((d:any)=>!d.birdman&&!d.engine.count),'downhill',0);
  sim.launching=false;const x=4260,z=downhillRouteCenter(x);sim.position.set(x,challengeTerrainHeight('downhill',x,z)+40,z);sim.velocity.set(30,0,0);
  view.setFlight(sim);view.captureFlightState();view.cameraView('自由');
  view.camera.position.set(4480,400,550);view.controls.target.set(4900,180,0);view.render(0,1);
  const bodies=view.mountainEnvironment.getObjectByName('fallen-highrises');
  let mismatch=0;const actual=new Matrix4(),expected=new Matrix4();
  for(const [i,r]of downhillRuins.entries()){
   bodies.getMatrixAt(i,actual);expected.compose(new Vector3(r.x,r.y,r.z),new Quaternion().setFromEuler(new Euler(r.tilt,r.yaw,0,'YXZ')),new Vector3(r.width,r.height,r.length));
   mismatch=Math.max(mismatch,...actual.elements.map((v:number,j:number)=>Math.abs(v-expected.elements[j])));
  }
  return {count:bodies.count,expected:downhillRuins.length,mismatch,calls:view.metrics.drawCalls};
 });
 expect(result.count).toBeGreaterThan(60);expect(result.count).toBe(result.expected);expect(result.mismatch).toBeLessThan(0.001);
 await page.screenshot({path:info.outputPath('ruins.png')});expect(errors).toEqual([]);
});

 test('开始按钮可点击，驾驶员 HUD 随视角切换',async({page},info)=>{
 await page.addInitScript(()=>localStorage.setItem('aero-formula.language','zh'));
 await page.goto('/');await page.getByRole('button',{name:'高山速降',exact:false}).click();
 await page.getByRole('button',{name:'试飞',exact:true}).click();
 const start=page.getByRole('button',{name:'开始试飞',exact:true});
 await expect(start).toBeInViewport();await start.click();await expect(start).toBeHidden();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('combobox',{name:'飞行相机',exact:true}).selectOption('驾驶员');
 await expect(page.getByRole('img',{name:'HUD',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('pilot-hud.png')});
 await page.getByRole('combobox',{name:'飞行相机',exact:true}).selectOption('追尾');
 await expect(page.getByRole('img',{name:'HUD',exact:true})).toHaveCount(0);
 });
