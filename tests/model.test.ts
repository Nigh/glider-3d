import { describe,it,expect } from 'vitest';
import { defaultAircraft,clone,wing,planform,validateAircraft,presets,fuselageEnds,resizeFuselage,PILOT_MASS,wingOrigin,mainWingSupport,mainWingMountLimits,DEG } from '../src/model';
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
  for(const key of ['mainWing','horizontalTail','verticalTail'])delete legacy[key].controlSurface;
  const checked=validateAircraft(legacy);
  expect(checked.birdman).toBe(true);expect(checked.controls.lateralTravel).toBe(0.1);
  expect(checked.mainWing.controlSurface).toBe(0);expect(checked.horizontalTail.controlSurface).toBe(0);expect(checked.verticalTail.controlSurface).toBe(1);
  expect(legacy.birdman).toBeUndefined();expect(legacy.verticalTail.controlSurface).toBeUndefined();
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
});
