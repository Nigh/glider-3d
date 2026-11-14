import { test, expect } from '@playwright/test';

test.beforeEach(async ({page})=>{
 await page.addInitScript(()=>localStorage.setItem('aero-formula.language','zh'));
 await page.goto('/');
 await page.getByRole('combobox',{name:'画质',exact:true}).selectOption('Low');
});

test('翼型独立选择、简洁设置、T尾安装角和鸟人风速上限通过真实控件生效', async ({page},info)=>{
 await page.locator('.welcome').getByRole('button',{name:'风洞',exact:false}).click();
 await page.getByRole('combobox',{name:'飞机类型',exact:true}).selectOption('normal');
 const selector=page.getByRole('combobox',{name:'翼型',exact:true});
 await selector.selectOption('naca0012');
 await expect(page.locator('.airfoil-settings input,.airfoil-settings p,.airfoil-settings output')).toHaveCount(0);
 expect((await page.evaluate(()=>window.glider.aircraft)).mainWing.airfoil).toBe('naca0012');
 await page.getByRole('tab',{name:'副翼',exact:true}).click();
 await expect(selector).toHaveValue('dae11'); await selector.selectOption('naca0012');
 await page.getByRole('switch',{name:'副翼安装至垂尾顶端',exact:true}).click();
 await expect(page.getByText('副翼安装角',{exact:true}).first()).toBeVisible();
 await page.screenshot({path:info.outputPath('airfoil-workshop.png')});
 await page.getByRole('heading',{name:'飞机工坊',exact:true}).click(); await page.keyboard.press('w');
 const tail=page.getByRole('spinbutton',{name:'副翼安装角数值',exact:true}); await tail.fill('12');
 await expect.poll(()=>page.evaluate(()=>window.glider.laboratory?.wind.tailIncidence)).toBe(12);
 await expect(page.getByRole('spinbutton',{name:'气流速度数值',exact:true})).toHaveAttribute('max','200');
 await page.getByRole('spinbutton',{name:'气流速度数值',exact:true}).fill('200');
 await page.getByRole('spinbutton',{name:'气流速度数值',exact:true}).blur();
 await page.keyboard.press('Escape');
 await page.getByRole('combobox',{name:'飞机类型',exact:true}).selectOption('birdman');
 await expect(selector).toBeDisabled(); await expect(selector).toHaveValue('dae11');
 await page.getByRole('heading',{name:'飞机工坊',exact:true}).click();await page.keyboard.press('w');
 const speed=page.getByRole('spinbutton',{name:'气流速度数值',exact:true});await expect(speed).toHaveAttribute('max','50');await expect(speed).toHaveValue('50.0');
 await expect(page.getByRole('slider',{name:'气流速度',exact:true})).toHaveAttribute('max','50');
 await speed.fill('200'); await speed.blur(); await expect(speed).toHaveValue('50.0');
 await page.getByRole('spinbutton',{name:'方向舵控制比例数值',exact:true}).fill('100');
 await expect.poll(()=>page.evaluate(()=>window.glider.telemetry?.controlInputs.rudder)).toBe(1);
 await page.keyboard.press('Escape');
 for(const locale of ['en','ja']){
  await page.locator('.language-label select').selectOption(locale);
  await expect(page.locator('.airfoil-settings')).not.toContainText('未标定');
  await expect(page.locator('.airfoil-settings')).not.toContainText('模型范围');
 }
});

test('实时T尾顶面与新建网格一致，保留断片形状且复用图形缓冲',async({page})=>{
 const result=await page.evaluate(async()=>{
  const scenePath='/src/scene.ts',physicsPath='/src/physics.ts',modelPath='/src/model.ts';
  const {SceneView}=await import(scenePath),{FlightSimulation}=await import(physicsPath),{presets,clone,normalizeAircraftGeometry,finPoint}=await import(modelPath);
  const d=clone(presets.find((p:any)=>p.name==='基础单发型'));d.assembly.tailOnFin=true;d.horizontalTail.airfoil='naca0012';normalizeAircraftGeometry(d);
  const host=document.createElement('div');host.style.cssText='position:fixed;width:640px;height:480px';document.body.append(host);
  const live=new SceneView(host),fresh=new SceneView(host),sim=new FlightSimulation(d,'wind-tunnel',0),a=live as any,b=fresh as any;
  const neutral={weight:0,lateral:0,elevator:0,aileron:0,rudder:0};let maximumError=0,crownError=0;
  try{
   live.setQuality('Low');fresh.setQuality('Low');live.setFlight(sim);
   const buffers=a.wingMeshes.map((m:any)=>m.geometry);
   for(const angle of [12,-12]){
    sim.setWindTunnel({...sim.windTunnel,speed:10,tailIncidence:angle});
    for(let i=0;i<55;i++){live.captureFlightState();sim.step(neutral);}
    live.render(0,1);fresh.setFlight(sim);fresh.render(0,1);
    for(let wing=0;wing<3;wing++){
     const actual=a.wingMeshes[wing].geometry.getAttribute('position').array,expected=b.wingMeshes[wing].geometry.getAttribute('position').array;
     for(let i=0;i<actual.length;i++)maximumError=Math.max(maximumError,Math.abs(actual[i]-expected[i]));
    }
    const s=a.wingSections[2].at(-1),coords=a.wingCoordinates[2],points=a.wingMeshes[2].geometry.getAttribute('position');
    const vertex=s.vertexStart+s.rows*32+8,offset=vertex*4;
    const point=finPoint(sim.definition,coords[offset],coords[offset+1],coords[offset+2],a.vector.clone());
    // Include the actual elastic tip transform (gravity still loads the fin).
    const physical=s.physics;
    point.sub(physical.referenceTip).applyQuaternion(physical.tip.quaternion).add(physical.tip.position);
    crownError=Math.max(crownError,Math.hypot(points.getX(vertex)-point.x,points.getY(vertex)-point.y,points.getZ(vertex)-point.z));
   }
   const fin=sim.structure.sections.filter((s:any)=>s.wingKey==='verticalTail').at(-1)!;
   sim.structure.detach(fin,1); // Keep a deterministic frozen-geometry regression independent of failure thresholds.
   const released=fin.crownIncidence,tip=fin.referenceTip.toArray();
   sim.setWindTunnel({...sim.windTunnel,speed:10,tailIncidence:12});
   // Test geometry sync without integrating a manually detached synthetic body.
   (sim as any).laboratoryState.windTunnel.tailIncidence=12;(sim as any).syncWindTunnelIncidence();
   live.captureFlightState();live.render(0,1);fresh.setFlight(sim);fresh.render(0,1);
   const x=a.wingMeshes[2].geometry.getAttribute('position').array,y=b.wingMeshes[2].geometry.getAttribute('position').array;
   for(let i=0;i<x.length;i++)maximumError=Math.max(maximumError,Math.abs(x[i]-y[i]));
   return {maximumError,crownError,released,after:fin.crownIncidence,tip,afterTip:fin.referenceTip.toArray(),reused:a.wingMeshes.every((m:any,i:number)=>m.geometry===buffers[i]),glError:a.renderer.getContext().getError()};
  }finally{live.dispose();fresh.dispose();host.remove();}
 });
 expect(result.maximumError).toBeLessThan(4e-6);expect(result.crownError).toBeLessThan(4e-6);
 expect(result.after).toBe(result.released);expect(result.afterTip).toEqual(result.tip);expect(result.reused).toBe(true);expect(result.glError).toBe(0);
});

test('Birdman方向舵在真实渲染中随正负控制反向偏转',async({page})=>{
 const result=await page.evaluate(async()=>{
  const scenePath='/src/scene.ts',physicsPath='/src/physics.ts',modelPath='/src/model.ts';
  const {SceneView}=await import(scenePath),{FlightSimulation}=await import(physicsPath),{defaultAircraft}=await import(modelPath);
  const host=document.createElement('div');host.style.cssText='position:fixed;width:640px;height:480px';document.body.append(host);
  const view=new SceneView(host),sim=new FlightSimulation(defaultAircraft,'wind-tunnel',0),internal=view as any,neutral={weight:0,elevator:0,aileron:0,rudder:0};
  const z:number[]=[],deflections:number[]=[],moments:number[]=[];
  try{
   view.setQuality('Low');view.setFlight(sim);sim.setWindTunnelEnabled(true);
   for(const rudder of [-1,1]){
    sim.setWindTunnel({...sim.windTunnel,speed:10,rudder});
    for(let i=0;i<90;i++){view.captureFlightState();sim.step(neutral);}view.render(0,1);
    const points=internal.wingMeshes[2].geometry.getAttribute('position');z.push(points.getZ(16));
    deflections.push(sim.structure.sections.find((s:any)=>s.wingKey==='verticalTail').controlDeflection);moments.push(sim.telemetry.aerodynamics.wings[2].torque.y);
   }
   return {z,deflections,moments,glError:internal.renderer.getContext().getError()};
  }finally{view.dispose();host.remove();}
 });
 expect(result.z[0]*result.z[1]).toBeLessThan(0);expect(result.deflections[0]*result.deflections[1]).toBeLessThan(0);expect(result.moments[0]*result.moments[1]).toBeLessThan(0);expect(result.glError).toBe(0);
});
