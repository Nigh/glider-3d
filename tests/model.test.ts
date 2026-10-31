import { describe,it,expect } from 'vitest';
import { defaultAircraft,clone,wing,planform,validateAircraft,presets,fuselageEnds,resizeFuselage,PILOT_MASS,wingOrigin,mainWingSupport,mainWingMountLimits,DEG,engineMounts,fuelTankDimensions,engineLateralOffset,engineHeightRanges,normalizeEngineHeight,fuelTankLimits,fuelTankPosition,BODY_GEOMETRY } from '../src/model';
describe('参数化几何与信任边界',()=>{
 it('矩形和梯形面积、展弦比、平均气动弦与左右对称一致',()=>{const p=planform(wing(10,2,1));expect(p.area).toBeCloseTo(15);expect(p.span).toBe(10);expect(p.aspect).toBeCloseTo(100/15);expect(p.chord).toBeCloseTo(14/9);expect(planform(wing(10,2,1),false).area).toBeCloseTo(7.5);});
 it('后掠不凭空改变面积，展弦比随翼展变化',()=>{expect(planform(wing(10,2,1,2)).area).toBeCloseTo(planform(wing(10,2,1,0)).area);expect(planform(wing(12,2,1)).aspect).toBeGreaterThan(planform(wing(10,2,1)).aspect);});
 it('预设均通过几何校验，包括空气动力学不稳定设计',()=>{for(const d of presets)expect(validateAircraft(d)).toEqual(d);});
 it('拒绝非有限数、自交、零面积与越界安装角',()=>{for(const mutate of [(d:any)=>d.fuselage.length=NaN,(d:any)=>d.mainWing.points[1].y=Infinity,(d:any)=>d.mainWing.points[2].x=-2,(d:any)=>d.mainWing.points[1].y=d.mainWing.points[2].y=0,(d:any)=>d.assembly.tailIncidence=50]){const d=clone(defaultAircraft);mutate(d);expect(()=>validateAircraft(d)).toThrow();}});
 it('主翼高度边界允许负安装，拒绝新范围外的数值',()=>{
  for(const height of [-0.5,0,1]){const d=clone(defaultAircraft);d.assembly.mainWingHeight=height;expect(validateAircraft(d).assembly.mainWingHeight).toBe(height);}
  for(const height of [-0.5001,1.0001,NaN,Infinity]){const d=clone(defaultAircraft);d.assembly.mainWingHeight=height;expect(()=>validateAircraft(d)).toThrow();}
 });
 it('各翼根中心随安装角保持在安装高度，尾翼中心固定梁上',()=>{
  const d=clone(defaultAircraft);d.assembly.mainIncidence=18;d.assembly.tailIncidence=-12;d.assembly.mainWingHeight=-0.5;
  for(const key of ['mainWing','horizontalTail','verticalTail'] as const){
   const origin=wingOrigin(d,key),middle=(d[key].points[0].x+d[key].points[3].x)/2;
   const angle=(key==='mainWing'?d.assembly.mainIncidence:key==='horizontalTail'?d.assembly.tailIncidence:0)*DEG;
   expect(origin.y-middle*Math.sin(angle)).toBeCloseTo(key==='mainWing'?-0.5:0,12);
   if(key!=='mainWing')expect(origin.x-middle*Math.cos(angle)).toBeCloseTo(d.assembly[key],12);
  }
 });
 it('主翼支撑面积随正负离机身距离变化，根中心不能脱离机身',()=>{
  const d=clone(defaultAircraft);d.assembly.mainWingHeight=0;expect(mainWingSupport(d).mass).toBe(0);
  d.assembly.mainWingHeight=0.5;const upper=mainWingSupport(d);
  d.assembly.mainWingHeight=-0.5;const lower=mainWingSupport(d);
  expect(lower.area).toBeCloseTo(upper.area);expect(lower.mass).toBeCloseTo(upper.mass);
  expect(lower.y).toBe(-0.25);expect(upper.y).toBe(0.25);
  d.assembly.mainWingHeight=1;expect(mainWingSupport(d).mass).toBeCloseTo(2*upper.mass);
  d.assembly.mainWing=5;const checked=validateAircraft(d),limits=mainWingMountLimits(checked);
  expect(checked.assembly.mainWing).toBe(limits.max);expect(mainWingSupport(checked).x).toBeCloseTo(fuselageEnds(checked).nose);
  resizeFuselage(checked,'nose',-100);expect(fuselageEnds(checked).nose).toBeGreaterThanOrEqual(mainWingSupport(checked).x-1e-10);
  const impossible=clone(defaultAircraft);impossible.fuselage={length:3,center:2};
  impossible.assembly.horizontalTail=1;impossible.assembly.verticalTail=1;
  impossible.mainWing.points[0].x=5.8;impossible.mainWing.points[3].x=6;
  expect(()=>validateAircraft(impossible)).toThrow('主翼翼根无法安装');
 });
 it('机头机尾独立缩放保持另一端并保留驾驶舱及尾翼支撑',()=>{
  const d=clone(defaultAircraft),original=fuselageEnds(d);
  resizeFuselage(d,'nose',-100);
  expect(fuselageEnds(d).tail).toBe(original.tail);
  expect(fuselageEnds(d).nose).toBeCloseTo(d.cockpit.position+0.95);
  expect(validateAircraft(d)).toEqual(d);
  resizeFuselage(d,'nose',original.nose);
  resizeFuselage(d,'tail',100);
  expect(fuselageEnds(d).nose).toBe(original.nose);
  expect(fuselageEnds(d).tail).toBeCloseTo(Math.min(d.assembly.horizontalTail,d.assembly.verticalTail),10);
  expect(validateAircraft(d)).toEqual(d);
  resizeFuselage(d,'tail',-100);
  expect(d.fuselage.length).toBe(12);
  expect(fuselageEnds(d).nose).toBe(original.nose);
 });
 it('旧定义补齐中心且驾驶员统一60kg，不能通过JSON降低重量',()=>{
  const legacy={...clone(defaultAircraft),fuselage:{length:6.5},pilot:{mass:40}};
  const checked=validateAircraft(legacy);
  expect(checked.fuselage.center).toBe(0);
  expect(checked.pilot.mass).toBe(PILOT_MASS);
  expect(legacy.pilot.mass).toBe(40);
  for(const mass of [40,65,100])expect(validateAircraft({...legacy,pilot:{mass}}).pilot.mass).toBe(60);
 });
 it('数值和导入入口也拒绝驾驶舱或尾翼脱离机身',()=>{
  for(const mutate of [
   (d:typeof defaultAircraft)=>{d.fuselage.center=NaN;},
   (d:typeof defaultAircraft)=>{d.fuselage.length=3;},
   (d:typeof defaultAircraft)=>{d.cockpit.position=4;},
   (d:typeof defaultAircraft)=>{d.assembly.horizontalTail=-6;},
   (d:typeof defaultAircraft)=>{d.assembly.verticalTail=5;},
  ]){const d=clone(defaultAircraft);mutate(d);expect(()=>validateAircraft(d)).toThrow();}
 });
 it('旧存档补齐鸟人间、左右行程和默认垂尾，不修改导入对象',()=>{
  const legacy:any=clone(defaultAircraft);delete legacy.birdman;delete legacy.controls.lateralTravel;
  delete legacy.engine;delete legacy.fuelTank;
  for(const key of ['mainWing','horizontalTail','verticalTail'])delete legacy[key].controlSurface;
  const checked=validateAircraft(legacy);
  expect(checked.birdman).toBe(true);expect(checked.controls.lateralTravel).toBe(0.1);
  expect(checked.mainWing.controlSurface).toBe(0);expect(checked.horizontalTail.controlSurface).toBe(0);expect(checked.verticalTail.controlSurface).toBe(1);
  expect(legacy.birdman).toBeUndefined();expect(legacy.verticalTail.controlSurface).toBeUndefined();
  expect(checked.engine.count).toBe(0);expect(checked.fuelTank.capacity).toBe(0);
  expect(legacy.engine).toBeUndefined();expect(legacy.fuelTank).toBeUndefined();
 });
 it('鸟人间只允许垂尾操纵，非鸟人间控制面比例和侧移行程有有限边界',()=>{
  const d=clone(defaultAircraft);d.mainWing.controlSurface=0.25;
  expect(()=>validateAircraft(d)).toThrow('鸟人间');d.birdman=false;d.horizontalTail.controlSurface=1;
  expect(validateAircraft(d).mainWing.controlSurface).toBe(0.25);
  d.verticalTail.controlSurface=0.3;expect(validateAircraft(d).verticalTail.controlSurface).toBe(0.3);
  for(const value of [-0.01,1.01,NaN,Infinity]){const invalid=clone(d);invalid.mainWing.controlSurface=value;expect(()=>validateAircraft(invalid)).toThrow();}
  for(const value of [0,0.201,NaN,Infinity]){const invalid=clone(d);invalid.controls.lateralTravel=value;expect(()=>validateAircraft(invalid)).toThrow();}
  for(const value of [0.01,0.2]){const valid=clone(d);valid.controls.lateralTravel=value;expect(validateAircraft(valid).controls.lateralTravel).toBe(value);}
 });
 it('单双发固定侧距和自动支撑共用尺寸，油箱体积对应升容量',()=>{
  const d=clone(defaultAircraft);d.birdman=false;d.engine={type:'jet-01',count:2,x:-0.5,y:0};
  const mounts=engineMounts(validateAircraft(d)),offset=engineLateralOffset(d);
  expect(offset).toBeCloseTo(0.63);expect(mounts.map(m=>m.z)).toEqual([-offset,offset]);expect(mounts.map(m=>m.y)).toEqual([0,0]);
  for(const mount of mounts){expect(mount.supportLength).toBeGreaterThan(0);expect(mount.supportMass).toBeGreaterThan(0);}
  d.engine.count=1;d.engine.x=-2;d.engine.y=-0.5;expect(engineMounts(validateAircraft(d))[0]).toMatchObject({z:0,y:-0.5});
  const shape=fuelTankDimensions(12);expect(4*Math.PI*shape.radius**3).toBeCloseTo(0.012,12);expect(shape.length).toBe(6*shape.radius);
 });
 it('单发高度跳过座舱、座舱盖及鼻锥，不存在的下方区不接受负高度',()=>{
  const d=clone(defaultAircraft);d.birdman=false;d.engine.count=1;
  d.engine.x=d.cockpit.position+BODY_GEOMETRY.shell.x;
  const ranges=engineHeightRanges(d);expect(ranges).toHaveLength(1);expect(ranges[0].min).toBeCloseTo(0.89);expect(ranges[0].max).toBe(1);
  expect(normalizeEngineHeight(d,-0.5)).toBe(ranges[0].min);expect(validateAircraft(d).engine.y).toBe(ranges[0].min);
  d.engine.x=-2;
  const rearRanges=engineHeightRanges(d);expect(rearRanges).toHaveLength(2);
  expect(rearRanges[0].min).toBe(-0.5);expect(rearRanges[0].max).toBeCloseTo(-0.29);expect(rearRanges[1].min).toBeCloseTo(0.29);expect(rearRanges[1].max).toBe(1);
  for(const y of [-0.5,1]){d.engine.y=y;expect(validateAircraft(d).engine.y).toBe(y);}
  d.engine.x=fuselageEnds(d).nose;expect(normalizeEngineHeight(d,0.3)).toBeGreaterThan(0.35);
  d.engine.count=2;expect(engineHeightRanges(d)).toEqual([{min:-0.5,max:1}]);expect(normalizeEngineHeight(d,0)).toBe(0);
 });
 it('油箱尺寸限制纵向位置，整个箱体保持在真实封闭座舱壳内',()=>{
  const d=clone(presets.find(d=>d.engine.count>0)!),shell=BODY_GEOMETRY.shell;
  let width=Infinity;
  for(const capacity of [0.5,12,40]){
   d.fuelTank.capacity=capacity;const limits=fuelTankLimits(d),shape=fuelTankDimensions(capacity);
   expect(limits.max-limits.min).toBeLessThan(width);width=limits.max-limits.min;
   for(const x of [limits.min,limits.max]){
    d.fuelTank.x=x;const position=fuelTankPosition(d);expect(position).toEqual({x,y:shell.y,z:0});
    for(let row=0;row<=12;row++)for(let ring=0;ring<16;ring++){
     const angle=row*Math.PI/12,azimuth=ring*Math.PI/8;
     const px=x+shape.length/2*Math.cos(angle)-(d.cockpit.position+shell.x);
     const py=shape.radius*Math.sin(angle)*Math.cos(azimuth),pz=shape.radius*Math.sin(angle)*Math.sin(azimuth);
     expect((px/shell.xRadius)**2+(py/shell.yRadius)**2+(pz/shell.zRadius)**2).toBeLessThanOrEqual(1+1e-10);
    }
   }
  }
  d.fuelTank.x=12;expect(validateAircraft(d).fuelTank.x).toBe(fuelTankLimits(d).max);
  d.engine.count=0;const checked=validateAircraft(d);expect(checked.fuelTank.capacity).toBe(0);expect(fuelTankLimits(checked).min).toBeCloseTo(d.cockpit.position-0.15-1.45);
 });
 it('旧动力字段只在导入边界迁移，移除方向、侧距、油箱高度且不修改原对象',()=>{
  const legacy:any=clone(defaultAircraft);legacy.birdman=false;
  legacy.engine={type:'jet-01',count:1,mount:'below',x:-2,y:2,z:3};legacy.fuelTank={x:3,y:-0.8,capacity:12};
  const checked=validateAircraft(legacy);
  expect(checked.engine).toEqual({type:'jet-01',count:1,x:-2,y:-0.5});expect(checked.fuelTank).toEqual({x:fuelTankLimits(checked).max,capacity:12});
  expect(legacy.engine.mount).toBe('below');expect(legacy.fuelTank.y).toBe(-0.8);expect(validateAircraft(checked)).toEqual(checked);
  for(const mutate of [(d:any)=>d.engine.z=NaN,(d:any)=>d.fuelTank.y=Infinity]){const invalid=clone(legacy);mutate(invalid);expect(()=>validateAircraft(invalid)).toThrow();}
 });
 it('拒绝非法动力输入，机身缩放保留引擎挂点并重新适配内部油箱',()=>{
  const d=clone(defaultAircraft);d.birdman=false;d.engine.count=1;d.engine.y=1;d.fuelTank.capacity=12;
  for(const patch of [{engine:{...d.engine,type:'missing'}},{engine:{...d.engine,count:3}},{engine:{...d.engine,y:NaN}},{engine:{...d.engine,y:-0.5001}},{engine:{...d.engine,y:1.0001}},{engine:{...d.engine,x:12}},{fuelTank:{...d.fuelTank,capacity:-1}},{fuelTank:{...d.fuelTank,capacity:40.1}},{fuelTank:{...d.fuelTank,x:Infinity}}]){
   expect(()=>validateAircraft({...d,...patch})).toThrow();
  }
  expect(()=>validateAircraft({...d,birdman:true})).toThrow('鸟人间');
  d.engine.x=fuselageEnds(d).tail+0.1;d.fuelTank.x=fuelTankLimits(d).max;
  resizeFuselage(d,'tail',100);resizeFuselage(d,'nose',-100);
  expect(fuselageEnds(d).tail).toBeLessThanOrEqual(d.engine.x);expect(validateAircraft(d)).toEqual(d);
 });
});
