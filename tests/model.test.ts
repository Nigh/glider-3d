import { describe,it,expect } from 'vitest';
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { defaultAircraft,clone,wing,planform,validateAircraft,presets,fuselageEnds,resizeFuselage,PILOT_MASS,wingLocalPoint,wingOrigin,mainWingSupport,mainWingMountLimits,DEG,engineMounts,fuelTankDimensions,engineLateralOffset,engineLateralOffsetLimits,engineHeightRanges,normalizeEngineHeight,fuelTankLimits,fuelTankPosition,BODY_GEOMETRY,cockpitGeometry,cockpitLimits,cockpitMass,cockpitRearLengthLimits,fuelCapacityLimit,normalizeAircraftGeometry,editWingPoint,wingMountLimits,fuselageEndLimits } from '../src/model';
import { beamSection, defaultStructures, materialCatalog, type MaterialId } from '../src/materials';
import { derive, FlightSimulation } from '../src/physics';
import { engineCatalog } from '../src/engines';
import { exportAircraft, importAircraft, History } from '../src/storage';
import { aircraftWings, controlSurfaceRegions, finPairMinimumOffset, finThickness, fuselageBeamRadius, hasMirroredFin, wingInstancePoint, wingSupports } from '../src/model';
import { WingStructure } from '../src/structure';
describe('参数化几何与信任边界',()=>{
 it('矩形和梯形面积、展弦比、平均气动弦与左右对称一致',()=>{const p=planform(wing(10,2,1));expect(p.area).toBeCloseTo(15);expect(p.span).toBe(10);expect(p.aspect).toBeCloseTo(100/15);expect(p.chord).toBeCloseTo(14/9);expect(planform(wing(10,2,1),false).area).toBeCloseTo(7.5);});
 it('后掠不凭空改变面积，展弦比随翼展变化',()=>{expect(planform(wing(10,2,1,2)).area).toBeCloseTo(planform(wing(10,2,1,0)).area);expect(planform(wing(12,2,1)).aspect).toBeGreaterThan(planform(wing(10,2,1)).aspect);});
 it('所有系统飞机均通过几何校验且参数不被修改',()=>{for(const d of presets)expect(validateAircraft(d)).toEqual(d);});
 it('系统预设控制弦长比例统一0.3，鸟人间主翼和副翼保持禁用',()=>{
  for(const d of presets)for(const key of ['mainWing','horizontalTail','verticalTail'] as const){
   expect(d[key].controlSurface).toBe(d.birdman&&key!=='verticalTail'?0:0.3);
  }
 });
 it('缺省导入补齐控制弦长比例，不覆盖显式自定义值或修改原始对象',()=>{
  for(const preset of presets){
   const legacy:any=clone(preset);
   for(const key of ['mainWing','horizontalTail','verticalTail'] as const)delete legacy[key].controlSurface;
   const checked=validateAircraft(legacy);
   for(const key of ['mainWing','horizontalTail','verticalTail'] as const){
    expect(checked[key].controlSurface).toBe(preset.birdman&&key!=='verticalTail'?0:0.3);
    expect(legacy[key].controlSurface).toBeUndefined();
    for(const value of [0,0.15,0.4,0.45,1]){
     const custom=clone(preset);custom[key].controlSurface=value;
     if(preset.birdman&&key!=='verticalTail'&&value!==0)expect(()=>validateAircraft(custom)).toThrow('鸟人间');
     else expect(validateAircraft(custom)[key].controlSurface).toBe(value);
    }
   }
  }
 });
 it('材料用量默认1，迁移旧档并拒绝非有限或越界字段',()=>{
  for(const key of ['mainWing','horizontalTail','verticalTail'] as const){
   const legacy:any=clone(defaultAircraft);delete legacy[key].materialAmount;
   expect(validateAircraft(legacy)[key].materialAmount).toBe(1);
   for(const amount of [0.5,1,1.37,2]){const d=clone(defaultAircraft);d[key].materialAmount=amount;expect(validateAircraft(d)[key].materialAmount).toBe(amount);}
   for(const amount of [0.49,2.01,NaN,Infinity,-Infinity,null,'1']){const d:any=clone(defaultAircraft);d[key].materialAmount=amount;expect(()=>validateAircraft(d)).toThrow();}
  }
 });
 it('梁用量按面积缩放且截面惯性矩按平方缩放',()=>{
  const base=beamSection(defaultStructures.mainWing);
  for(const amount of [0.5,1,2]){
   const section=beamSection(defaultStructures.mainWing,amount),scale=Math.sqrt(amount);
   expect(section.area/base.area).toBeCloseTo(amount,12);
   expect(section.secondMoment/base.secondMoment).toBeCloseTo(amount**2,12);
   expect(section.lateralSecondMoment/base.lateralSecondMoment).toBeCloseTo(amount**2,12);
   expect(section.torsionConstant/base.torsionConstant).toBeCloseTo(amount**2,12);
   expect(section.width/base.width).toBeCloseTo(scale,12);
   expect(section.height/base.height).toBeCloseTo(scale,12);
   expect(section.wallThickness/base.wallThickness).toBeCloseTo(scale,12);
   expect((section.secondMoment/section.height)/(base.secondMoment/base.height)).toBeCloseTo(amount**1.5,12);
  }
 });
 it('拒绝非有限数、自交、零面积与越界安装角',()=>{for(const mutate of [(d:any)=>d.fuselage.length=NaN,(d:any)=>d.mainWing.points[1].y=Infinity,(d:any)=>d.mainWing.points[2].x=-2,(d:any)=>d.mainWing.points[1].y=d.mainWing.points[2].y=0,(d:any)=>d.assembly.tailIncidence=50]){const d=clone(defaultAircraft);mutate(d);expect(()=>validateAircraft(d)).toThrow();}});
 it('主翼高度边界允许负安装，拒绝新范围外的数值',()=>{
  for(const height of [-0.5,0,1]){const d=clone(defaultAircraft);d.assembly.mainWingHeight=height;expect(validateAircraft(d).assembly.mainWingHeight).toBe(height);}
  for(const height of [-0.5001,1.0001,NaN,Infinity]){const d=clone(defaultAircraft);d.assembly.mainWingHeight=height;expect(()=>validateAircraft(d)).toThrow();}
 });
 it('上反角接受正负25度，拒绝越界和非有限输入',()=>{
  for(const key of ['mainWing','horizontalTail','verticalTail'] as const){
   for(const angle of [-25,-12.5,0,12.5,25]){const d=clone(defaultAircraft);d[key].dihedral=angle;expect(validateAircraft(d)[key].dihedral).toBe(angle);}
   for(const angle of [-25.0001,25.0001,NaN,Infinity,-Infinity]){const d=clone(defaultAircraft);d[key].dihedral=angle;expect(()=>validateAircraft(d)).toThrow();}
  }
 });
 it('正负上反角刚性旋转保留真实翼长、翼型厚度和面积',()=>{
  for(const incidence of [-12,0,18])for(const side of [-1,1]){
   const w=wing(14,1.5,0.8,0.7);
   const points=w.points.map(p=>new Vector3(-p.x,0,p.y)).concat([new Vector3(-0.8,0.08,3),new Vector3(-0.8,-0.04,3)]);
   for(const angle of [-25,-10,0,10,25]){
    w.dihedral=angle;
    const rotated=points.map(p=>wingLocalPoint(w,incidence*DEG,side,p.x,p.y,p.z,new Vector3()));
    for(let a=0;a<points.length;a++)for(let b=a+1;b<points.length;b++)expect(rotated[a].distanceTo(rotated[b])).toBeCloseTo(points[a].distanceTo(points[b]),12);
    const edge1=rotated[1].clone().sub(rotated[0]),edge2=rotated[3].clone().sub(rotated[0]);
    const edge3=rotated[2].clone().sub(rotated[1]),edge4=rotated[3].clone().sub(rotated[1]);
    const area=(edge1.cross(edge2).length()+edge3.cross(edge4).length())/2;
    expect(area).toBeCloseTo(planform(w,false).area,12);
   }
  }
 });
 it('正负上反角保持真实梁长、面积与质量，并刚性旋转惯量',()=>{
  const d=clone(defaultAircraft);d.mainWing.dihedral=d.horizontalTail.dihedral=0;
  d.assembly.mainIncidence=18;d.assembly.tailIncidence=-12;
  const base=new FlightSimulation(d,'birdman',0);
  for(const angle of [-25,-8,8,25]){
   const changed=clone(d);changed.mainWing.dihedral=changed.horizontalTail.dihedral=angle;
   const simulation=new FlightSimulation(changed,'birdman',0);
   expect(simulation.aircraft.mass).toBeCloseTo(base.aircraft.mass,12);
   expect(simulation.aircraft.wingArea).toBe(base.aircraft.wingArea);
   // Clearance changes strip boundaries. Compare identical physical spans,
   // not section IDs from two different partitions.
   const reference=new WingStructure(d,simulation.surfaces.map(surface=>{
    const w=d[surface.kind==='main'?'mainWing':surface.kind==='tail'?'horizontalTail':'verticalTail'];
    const p=planform(w,surface.kind!=='vertical'),half=Math.abs(w.points[1].y),width=surface.spanEnd-surface.spanStart;
    const root=p.root+(p.tip-p.root)*surface.spanStart/half,tip=p.root+(p.tip-p.root)*surface.spanEnd/half;
    const span=surface.spanStart+width*(root+2*tip)/(3*(root+tip));
    const original=base.structure.sections.find(candidate=>candidate.wingInstance===surface.wingInstance&&candidate.side===surface.side)!;
    return {...original.surface,spanStart:surface.spanStart,spanEnd:surface.spanEnd,area:width*(root+tip)/2,
     chord:2/3*(root*root+root*tip+tip*tip)/(root+tip),
     normal:original.referenceNormal,spanDirection:original.referenceSpan,
     chordDirection:original.referenceChord,crossflowDirection:original.referenceCrossflow,
     point:wingInstancePoint(d,surface.wingInstance,surface.side,span,0.25,0,new Vector3())};
   }));
   for(const section of simulation.structure.sections){
    const original=reference.sections.find(candidate=>candidate.wingInstance===section.wingInstance&&candidate.side===section.side
     &&candidate.spanStart===section.spanStart&&candidate.spanEnd===section.spanEnd)!;
    const incidence=section.wingKey==='mainWing'?d.assembly.mainIncidence:d.assembly.tailIncidence;
    const rotation=section.wingKey==='verticalTail'?new Quaternion():new Quaternion().setFromAxisAngle(new Vector3(Math.cos(incidence*DEG),Math.sin(incidence*DEG),0),-section.side*angle*DEG);
    const origin=wingOrigin(d,section.wingKey),pivot=new Vector3(origin.x,origin.y,0);
    const rotate=(point:Vector3)=>point.clone().sub(pivot).applyQuaternion(rotation).add(pivot);
    expect(section.referenceRoot.distanceTo(rotate(original.referenceRoot))).toBeLessThan(1e-11);
    expect(section.referenceTip.distanceTo(rotate(original.referenceTip))).toBeLessThan(1e-11);
    expect(section.center.distanceTo(rotate(original.center))).toBeLessThan(1e-11);
    expect(section.referenceRoot.distanceTo(section.referenceTip)).toBeCloseTo(original.referenceRoot.distanceTo(original.referenceTip),12);
    expect(section.mass).toBeCloseTo(original.mass,12);expect(section.surface.area).toBe(original.surface.area);
    for(const key of ['normal','spanDirection','chordDirection','crossflowDirection'] as const){
     expect(section.surface[key].length()).toBeCloseTo(1,12);
    }
    expect(section.surface.normal.dot(section.surface.chordDirection)).toBeCloseTo(0,12);
    expect(section.surface.normal.dot(section.surface.spanDirection)).toBeCloseTo(0,12);
    const matrix=new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(rotation));
    const inertia=matrix.clone().multiply(original.inertia).multiply(matrix.clone().transpose());
    for(let i=0;i<9;i++)expect(section.inertia.elements[i]).toBeCloseTo(inertia.elements[i],12);
   }
  }
 });
 it('各翼根中心随安装角保持在安装高度，尾翼中心固定梁上',()=>{
  const d=clone(defaultAircraft);d.assembly.mainIncidence=18;d.assembly.tailIncidence=-12;d.assembly.mainWingHeight=-0.5;
  for(const key of ['mainWing','horizontalTail','verticalTail'] as const){
   const origin=wingOrigin(d,key),middle=d[key].rootReference??(d[key].points[0].x+d[key].points[3].x)/2;
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
  expect(checked.assembly.mainWing).toBe(limits.max);expect(mainWingSupport(checked).frontX).toBeCloseTo(fuselageEnds(checked).nose);
  resizeFuselage(checked,'nose',-100);expect(fuselageEnds(checked).nose).toBeGreaterThanOrEqual(mainWingSupport(checked).x-1e-10);
  const impossible=clone(defaultAircraft);impossible.fuselage={length:3,center:0};impossible.cockpit.position=0.1;
  impossible.assembly.horizontalTail=-1;impossible.assembly.verticalTail=-1;
  impossible.mainWing.points[0].x=-3;impossible.mainWing.points[3].x=6;
  expect(()=>validateAircraft(impossible)).toThrow('主翼翼根无法安装');
 });
 it('机头机尾独立缩放保持另一端并保留驾驶舱及尾翼支撑',()=>{
  const d=clone(defaultAircraft),original=fuselageEnds(d);
  resizeFuselage(d,'nose',-100);
  expect(fuselageEnds(d).tail).toBe(original.tail);
  expect(fuselageEnds(d).nose).toBeCloseTo(d.cockpit.position+1.3);
  expect(validateAircraft(d)).toEqual(d);
  resizeFuselage(d,'nose',original.nose);
  resizeFuselage(d,'tail',100);
  expect(fuselageEnds(d).nose).toBe(original.nose);
  expect(fuselageEnds(d).tail).toBeCloseTo(wingOrigin(d,'verticalTail').x-d.verticalTail.points[3].x,10);
  expect(validateAircraft(d)).toEqual(d);
  resizeFuselage(d,'tail',-100);
  expect(d.fuselage.length).toBe(12);
  expect(fuselageEnds(d).nose).toBe(original.nose);
 });
 it('旧定义补齐中心且驾驶员统一60kg，不能通过JSON降低重量',()=>{
  const legacy={...clone(defaultAircraft),fuselage:{length:10},pilot:{mass:40}};
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
  expect(checked.mainWing.controlSurface).toBe(0);expect(checked.horizontalTail.controlSurface).toBe(0);expect(checked.verticalTail.controlSurface).toBe(0.3);
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
 it('双发默认相切且自动支撑共用尺寸，油箱体积对应升容量',()=>{
  const d=clone(defaultAircraft);d.birdman=false;d.engine={type:'jet-01',count:2,x:-0.5,y:0};
  const mounts=engineMounts(validateAircraft(d)),offset=engineLateralOffset(d);
  expect(offset).toBe(engineCatalog[d.engine.type].radius);expect(mounts.map(m=>m.z)).toEqual([-offset,offset]);expect(mounts.map(m=>m.y)).toEqual([0,0]);
  for(const mount of mounts){expect(mount.supportLength).toBe(0);expect(mount.supportMass).toBe(0);}
  d.engine.count=1;d.engine.x=-2;d.engine.y=-0.5;expect(engineMounts(validateAircraft(d))[0]).toMatchObject({z:0,y:-0.5});
  const shape=fuelTankDimensions(12);expect(4*Math.PI*shape.radius**3).toBeCloseTo(0.012,12);expect(shape.length).toBe(6*shape.radius);
 });
 it('双发横向偏移从引擎相切到主翼水平翼展，缩翼及上反角变化自动夹紧',()=>{
  const d=clone(presets.find(plane=>plane.engine.count===2)!);
  d.mainWing.points[1].y=d.mainWing.points[2].y=3;
  d.mainWing.dihedral=0;
  const radius=engineCatalog[d.engine.type].radius,limits=engineLateralOffsetLimits(d);
  expect(limits.min).toBe(radius);
  expect(limits.max+radius).toBeCloseTo(3);
  for(const value of [0,limits.min,1.5,12]){
   d.engine.lateralOffset=value;
   const checked=validateAircraft(d),offset=Math.max(limits.min,Math.min(limits.max,value));
   expect(checked.engine.lateralOffset).toBe(offset);
   expect(engineMounts(checked).map(mount=>mount.z)).toEqual([-offset,offset]);
   expect(Math.abs(engineMounts(checked)[1].z)+radius).toBeLessThanOrEqual(3+1e-8);
  }
  d.engine.lateralOffset=2.5;
  editWingPoint(d,'mainWing',1,d.mainWing.points[1].x,1);
  expect(d.engine.lateralOffset).toBe(engineLateralOffsetLimits(d).max);
  expect(d.engine.lateralOffset).toBeCloseTo(0.86);
  d.mainWing.dihedral=25;normalizeAircraftGeometry(d);
  expect(d.engine.lateralOffset).toBe(engineLateralOffsetLimits(d).max);
  expect(d.engine.lateralOffset!+radius).toBeLessThanOrEqual(Math.cos(25*DEG)+1e-8);
  editWingPoint(d,'mainWing',2,d.mainWing.points[2].x,0.25);
  const narrow=engineLateralOffsetLimits(d);
  expect(narrow.max).toBe(narrow.min);expect(d.engine.lateralOffset).toBe(narrow.min);
  expect(()=>validateAircraft(d)).not.toThrow();
  expect(engineMounts(d)[1].z-radius).toBeCloseTo(0);
 });
 it('横向偏移保留导出导入和撤销重做，旧设计默认相切且不复活旧侧距',()=>{
  const legacy:any=clone(presets.find(plane=>plane.engine.count===2)!);
  delete legacy.engine.lateralOffset;legacy.engine.z=3;
  const migrated=validateAircraft(legacy),minimum=engineLateralOffsetLimits(migrated).min;
  expect(migrated.engine).not.toHaveProperty('lateralOffset');
  expect(engineLateralOffset(migrated)).toBe(minimum);
  expect(migrated.engine).not.toHaveProperty('z');expect(legacy.engine.lateralOffset).toBeUndefined();
  const history=new History(migrated),edited=clone(migrated);
  edited.engine.lateralOffset=1.5;normalizeAircraftGeometry(edited);history.push(edited);
  expect(importAircraft(exportAircraft(edited))).toEqual(edited);
  const restored=history.undo();
  expect(restored.engine).not.toHaveProperty('lateralOffset');
  expect(engineLateralOffset(restored)).toBe(minimum);
  expect(history.redo().engine.lateralOffset).toBe(1.5);
  edited.engine.count=1;normalizeAircraftGeometry(edited);
  expect(engineMounts(edited)[0].z).toBe(0);expect(edited.engine.lateralOffset).toBe(1.5);
  edited.engine.count=2;normalizeAircraftGeometry(edited);
  expect(engineMounts(edited).map(mount=>mount.z)).toEqual([-1.5,1.5]);
  for(const value of [-0.01,12.01,NaN,Infinity,-Infinity,null,'1']){
   const invalid:any=clone(edited);invalid.engine.lateralOffset=value;
   expect(()=>validateAircraft(invalid)).toThrow();
  }
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
  expect(fuselageEnds(d).tail).toBeLessThanOrEqual(d.engine.x);
  const checked=validateAircraft(d);
  expect(checked.engine.x).toBeCloseTo(d.engine.x,12);
  expect(checked.fuelTank.x).toBeGreaterThanOrEqual(fuelTankLimits(checked).min);
  expect(checked.fuelTank.x).toBeLessThanOrEqual(fuelTankLimits(checked).max);
 });
 it('根点独立编辑保持其他绝对端点，角度不为零也不改变原点',()=>{
  for(const key of ['mainWing','horizontalTail','verticalTail'] as const)for(const index of [0,3]){
   const d=clone(defaultAircraft);d.assembly.horizontalTail=-2;d.assembly.verticalTail=-2;d.assembly.tailIncidence=7.1;
   normalizeAircraftGeometry(d);
   const before=clone(d),origin=wingOrigin(d,key);
   editWingPoint(d,key,index,d[key].points[index].x+(index===0?-0.12:0.12),0);
   expect(wingOrigin(d,key)).toEqual(origin);
   for(let i=0;i<4;i++)if(i!==index)expect(d[key].points[i]).toEqual(before[key].points[i]);
   expect(validateAircraft(d)).toEqual(d);
  }
 });
 it('垂尾有符号高度保持正面积与跨度，并允许跨机身向下',()=>{
  const d=clone(defaultAircraft);editWingPoint(d,'verticalTail',1,0.3,-0.47);
  const p=planform(d.verticalTail,false);
  expect(p.span).toBe(0.47);expect(p.area).toBeGreaterThan(0);expect(p.centerY).toBe(-0.235);
  expect(validateAircraft(d).verticalTail.points[2].y).toBe(-0.47);
  d.verticalTail.points[1].y=d.verticalTail.points[2].y=-0.51;
  expect(()=>validateAircraft(d)).toThrow();
 });
 it('副翼附着根弦逐端跟随垂尾梢，梢点及长度修改保持连接',()=>{
  const d=clone(defaultAircraft);d.assembly.tailOnFin=true;normalizeAircraftGeometry(d);
  for(const [index,x,y] of [[1,0.43,1.91],[2,1.03,-0.4]]){
   editWingPoint(d,'verticalTail',index,x,y);
   const fin=wingOrigin(d,'verticalTail'),tail=wingOrigin(d,'horizontalTail');
   expect(tail).toEqual({x:fin.x,y});
   expect(d.horizontalTail.points[0].x).toBe(d.verticalTail.points[1].x);
   expect(d.horizontalTail.points[3].x).toBe(d.verticalTail.points[2].x);
   expect(d.assembly.tailIncidence).toBe(defaultAircraft.assembly.tailIncidence);
  }
  const other=d.verticalTail.points[2].x;
  editWingPoint(d,'horizontalTail',0,0.51,0);
  expect(d.verticalTail.points[1].x).toBe(0.51);expect(d.verticalTail.points[2].x).toBe(other);
  expect(validateAircraft(d)).toEqual(d);
 });
 it('可调舱后段改变质量和可用油量，舱前端与舱盖固定且旧档不新增字段',()=>{
  const d=clone(defaultAircraft);d.birdman=false;const shell=cockpitGeometry(d),mass=cockpitMass(d);
  expect(shell.x+shell.xRadius).toBeCloseTo(1.3);
  d.cockpit.rearLength=0.2;
  expect(cockpitGeometry(d).x+cockpitGeometry(d).xRadius).toBeCloseTo(1.3);
  expect(cockpitMass(d)).toBeLessThan(mass);expect(fuelCapacityLimit(d)).toBeLessThan(40);
  d.birdman=false;d.engine.count=2;d.fuelTank.capacity=40;
  normalizeAircraftGeometry(d);
  expect(d.fuelTank.capacity).toBe(fuelCapacityLimit(d));expect(Number.isFinite(fuelTankLimits(d).min)).toBe(true);
  expect(cockpitRearLengthLimits(d).max).toBeCloseTo(d.cockpit.position-fuselageEnds(d).tail-0.15);
  const birdman=clone(d);birdman.birdman=true;expect(cockpitMass(birdman)).toBe(4);
  expect(validateAircraft(defaultAircraft).cockpit.rearLength).toBeUndefined();
 });
 it('完整驾驶舱与全部根端约束来自真实机身，位置不受旧范围限制',()=>{
  const d=clone(defaultAircraft);resizeFuselage(d,'nose',8);d.cockpit.position=5.13;normalizeAircraftGeometry(d);
  expect(validateAircraft(d).cockpit.position).toBe(5.13);
  const limits=cockpitLimits(d);expect(limits.max).toBeCloseTo(fuselageEnds(d).nose-1.3);
  for(const key of ['mainWing','horizontalTail','verticalTail'] as const){
   const range=wingMountLimits(d,key);d.assembly[key]=range.max;normalizeAircraftGeometry(d);
   const origin=wingOrigin(d,key),c=Math.cos((key==='mainWing'?d.assembly.mainIncidence:key==='horizontalTail'?d.assembly.tailIncidence:0)*DEG);
   for(const index of [0,3])expect(origin.x-d[key].points[index].x*c).toBeLessThanOrEqual(fuselageEnds(d).nose+1e-8);
  }
  const epsilon=1e-12;
  for(const end of ['nose','tail'] as const){
   const fixed=fuselageEnds(d)[end==='nose'?'tail':'nose'],range=fuselageEndLimits(d,end);
   resizeFuselage(d,end,end==='nose'?-100:100);
   expect(fuselageEnds(d)[end]).toBeCloseTo(end==='nose'?range.min:range.max);
   expect(fuselageEnds(d)[end==='nose'?'tail':'nose']).toBeCloseTo(fixed);
   expect(fuselageEnds(d).tail).toBeLessThanOrEqual(-0.1+epsilon);expect(fuselageEnds(d).nose).toBeGreaterThanOrEqual(0.1-epsilon);
  }
 });
});

describe('材料目录与独立梁截面',()=>{
 it('旧档补齐三翼材料与截面，不修改原始对象，迁移可重复',()=>{
  const legacy:any=clone(defaultAircraft);
  for(const key of ['mainWing','horizontalTail','verticalTail']){delete legacy[key].materialId;delete legacy[key].structure;}
  const migrated=validateAircraft(legacy);
  for(const key of ['mainWing','horizontalTail','verticalTail'] as const){
   expect(migrated[key].materialId).toBe('carbon-epoxy');expect(migrated[key].structure).toEqual(defaultStructures[key]);
   expect(legacy[key].materialId).toBeUndefined();expect(legacy[key].structure).toBeUndefined();
  }
  expect(validateAircraft(migrated)).toEqual(migrated);
 });
 it('每个翼面拒绝未知ID、非有限、越界、缺参数及封死管壁',()=>{
  for(const key of ['mainWing','horizontalTail','verticalTail'] as const){
   for(const id of ['missing','toString',null,3]){const invalid:any=clone(defaultAircraft);invalid[key].materialId=id;expect(()=>validateAircraft(invalid)).toThrow('未知翼面材料');}
   for(const field of ['width','height','wallThickness'] as const){
    for(const n of [NaN,Infinity,-Infinity,0,-1,1,undefined,'0.02']){
     const invalid:any=clone(defaultAircraft);invalid[key].structure[field]=n;expect(()=>validateAircraft(invalid)).toThrow();
    }
   }
   for(const structure of [null,{},[],{width:0.01,height:0.03,wallThickness:0.005}]){
    const invalid:any=clone(defaultAircraft);invalid[key].structure=structure;expect(()=>validateAircraft(invalid)).toThrow();
   }
  }
 });
 it('闭口梁截面按真实外内尺寸计算面积和惯性矩，增高增厚提高刚度',()=>{
  const s={width:0.04,height:0.08,wallThickness:0.002},section=beamSection(s);
  expect(section.area).toBeCloseTo(0.04*0.08-0.036*0.076,12);
  expect(section.secondMoment).toBeCloseTo((0.04*0.08**3-0.036*0.076**3)/12,12);
  expect(section.lateralSecondMoment).toBeCloseTo((0.08*0.04**3-0.076*0.036**3)/12,12);
  expect(section.torsionConstant).toBeGreaterThan(0);
  for(const changed of [{...s,height:0.1},{...s,wallThickness:0.003}]){
   expect(beamSection(changed).secondMoment).toBeGreaterThan(section.secondMoment);
   expect(beamSection(changed).area).toBeGreaterThan(section.area);
  }
 });
 it('三翼材料与截面修改实际改变设计质量，材料切换不修改截面',()=>{
  for(const key of ['mainWing','horizontalTail','verticalTail'] as const){
   const d=clone(defaultAircraft),baseline=derive(d).mass,w=d[key],section=beamSection(w.structure,w.materialAmount),p=w.points;
   const quarterDelta=p[1].x-p[0].x+((p[2].x-p[1].x)-(p[3].x-p[0].x))/4;
   const beamLength=Math.hypot(quarterDelta,p[1].y)*(key==='verticalTail'?1:2);
   for(const id of Object.keys(materialCatalog) as MaterialId[]){
    d[key].materialId=id;expect(validateAircraft(d)[key].structure).toEqual(defaultAircraft[key].structure);
    expect(derive(d).mass-baseline).toBeCloseTo((materialCatalog[id].density-materialCatalog[defaultAircraft[key].materialId].density)*section.area*beamLength,8);
   }
   d[key].materialId='carbon-epoxy';d[key].structure.wallThickness*=1.5;
   expect(derive(d).mass).toBeGreaterThan(baseline);
  }
 });
 it('设计边界移除运行形变、分段归属和断片，不写回原始对象',()=>{
  const input:any=clone(defaultAircraft);input.fragments=[{id:1}];input.structure={fractureCount:4};input.mainWing.deformation=[1];input.mainWing.structure.runtime=1;
  const checked:any=validateAircraft(input);
  expect(checked).toEqual(defaultAircraft);expect(input.fragments).toHaveLength(1);expect(input.mainWing.deformation).toEqual([1]);
 });
});

describe('多辅助翼与镜像垂翼边界',()=>{
 it('旧存档保持首翼字段，多实例及镜像参数完整导入导出',()=>{
  const d=clone(defaultAircraft);d.assembly.tailOnFin=false;
  d.verticalTail={...d.verticalTail,mirrored:true,cant:30,lateralOffset:0};
  d.auxiliaryWings=[
   {kind:'horizontalTail',wing:clone(d.horizontalTail),position:0.7,incidence:-4},
   {kind:'verticalTail',wing:{...clone(d.verticalTail),cant:0,lateralOffset:1},position:-1,incidence:2},
   {kind:'horizontalTail',wing:clone(d.horizontalTail),position:-0.8,incidence:5},
   {kind:'verticalTail',wing:{...clone(d.verticalTail),cant:45,lateralOffset:0.01},position:-1.5,incidence:0},
  ];
  const checked=validateAircraft(d),restored=importAircraft(exportAircraft(d));
  expect(restored).toEqual(checked);
  expect(restored.auxiliaryWings).toHaveLength(4);
  expect(aircraftWings(restored).map(instance=>instance.id)).toEqual([0,1,2,3,4,5,6]);
  expect(validateAircraft(defaultAircraft)).toEqual(defaultAircraft);
  expect(defaultAircraft.auxiliaryWings).toBeUndefined();
 });
 it('45度及1米边界有效，越界、非有限值和错误字段被拒绝',()=>{
  for(const cant of [-45,0,45]){
   const d=clone(defaultAircraft);d.assembly.tailOnFin=false;
   d.verticalTail={...wing(0.6,0.5,0.3),mirrored:true,cant,lateralOffset:1};
   expect(validateAircraft(d).verticalTail.cant).toBe(cant);
  }
  for(const [field,values] of [['cant',[-45.001,45.001,NaN,Infinity]],['lateralOffset',[-0.001,1.001,NaN,Infinity]],['mirrored',[1,'true',null]]] as const)for(const value of values){
   const d:any=clone(defaultAircraft);d.verticalTail[field]=value;
   expect(()=>validateAircraft(d)).toThrow();
  }
  for(const malformed of [null,{},[null],[{kind:'mainWing'}],[{kind:'verticalTail',position:0,incidence:Infinity}]]){
   const d:any=clone(defaultAircraft);d.auxiliaryWings=malformed;
   expect(()=>validateAircraft(d)).toThrow();
  }
 });
 it('有限厚度平行翼和向下内倾翼必须留足间距',()=>{
  for(const height of [0.5,-0.5])for(const cant of [0,-45]){
   const d=clone(defaultAircraft);d.assembly.tailOnFin=false;
   d.verticalTail={...wing(1,0.8,0.6),mirrored:true,cant,lateralOffset:1};
   d.verticalTail.points[1].y=d.verticalTail.points[2].y=height;
   const minimum=finPairMinimumOffset(d.verticalTail);
   expect(minimum).toBeGreaterThan(0);
   d.verticalTail.lateralOffset=minimum-1e-5;
   expect(()=>validateAircraft(d)).toThrow('镜像垂直辅助翼不得相交');
   d.verticalTail.lateralOffset=minimum;
   expect(()=>validateAircraft(d)).not.toThrow();
  }
 });
 it('V翼根斜接及微小偏移不产生跨过对称面的实体顶点',()=>{
  for(const height of [0.5,-0.5])for(const offset of [0,0.01]){
   const d=clone(defaultAircraft);d.assembly.tailOnFin=false;
   d.verticalTail={...wing(1,1.5,0.6),mirrored:true,cant:30,lateralOffset:offset};
   d.verticalTail.points[1].y=d.verticalTail.points[2].y=height;
   expect(finPairMinimumOffset(d.verticalTail)).toBe(0);
   expect(()=>validateAircraft(d)).not.toThrow();
   for(const span of [0,0.01,0.25,0.5])for(const u of [0,0.1,0.3,0.7,1])for(const face of [-1,1]){
    const chord=1.5+(0.6-1.5)*span/0.5,normal=face*finThickness(u)*chord;
    const left=wingInstancePoint(d,2,-1,span,u,normal,new Vector3()),right=wingInstancePoint(d,2,1,span,u,normal,new Vector3());
    expect(right.z).toBeGreaterThanOrEqual(0);expect(left.z).toBeLessThanOrEqual(0);
    expect(left.x).toBe(right.x);expect(left.y).toBe(right.y);expect(left.z).toBe(-right.z);
   }
  }
 });
 it('任意镜像垂翼禁止顶置水平翼，关闭镜像恢复单片居中直立',()=>{
  const d=clone(defaultAircraft);d.assembly.tailOnFin=true;
  d.auxiliaryWings=[{kind:'verticalTail',wing:{...wing(1,0.5,0.3),mirrored:true,cant:30,lateralOffset:0},position:-1,incidence:0}];
  expect(hasMirroredFin(d)).toBe(true);
  expect(()=>validateAircraft(d)).toThrow('镜像垂直辅助翼不能顶置水平辅助翼');
  d.auxiliaryWings=[];d.verticalTail={...d.verticalTail,mirrored:true,cant:30,lateralOffset:0};
  expect(()=>validateAircraft(d)).toThrow('镜像垂直辅助翼不能顶置水平辅助翼');
  d.verticalTail.mirrored=false;d.verticalTail.lateralOffset=1;
  expect(()=>validateAircraft(d)).not.toThrow();
  d.assembly.tailOnFin=false;
  const checked=validateAircraft(d),point=wingInstancePoint(checked,2,1,0.2,0.25,0,new Vector3());
  expect(hasMirroredFin(checked)).toBe(false);expect(point.z).toBe(0);expect(point.y).toBeCloseTo(0.2);
  expect(wingSupports(checked)).toHaveLength(0);
 });
 it('所有水平翼的上下根截面在对称面斜接，平均面与翼梁位置不变',()=>{
  const d=clone(defaultAircraft);
  d.auxiliaryWings=[{kind:'horizontalTail',wing:wing(4,1,0.6),position:0,incidence:9}];
  for(const id of [0,1,3])for(const dihedral of [-25,25]){
   const w=aircraftWings(d).find(instance=>instance.id===id)!.wing;w.dihedral=dihedral;
   for(const u of [0,0.15,0.5,0.85,1])for(const normal of [-0.08,0,0.12]){
    const left=wingInstancePoint(d,id,-1,0,u,normal,new Vector3()),right=wingInstancePoint(d,id,1,0,u,normal,new Vector3());
    expect(left.distanceTo(right)).toBeLessThan(1e-12);expect(left.z).toBeCloseTo(0,12);
   }
  }
 });
 it('垂翼支撑为封闭渐薄实体，机身端真实梁径且外端嵌入垂翼根',()=>{
  const d=clone(defaultAircraft);d.assembly.tailOnFin=false;
  d.verticalTail={...wing(2,0.8,0.5),mirrored:true,cant:30,lateralOffset:0.7};
  const peak=Math.max(...Array.from({length:17},(_,j)=>finThickness((1-Math.cos(j/16*Math.PI))/2)));
  for(const support of wingSupports(d)){
   expect(support.points).toHaveLength(13*32);expect(support.vertexWeights).toHaveLength(support.points.length);
   expect(support.mass).toBeGreaterThan(0);expect(Object.values(support.inertia).every(Number.isFinite)).toBe(true);
   expect(support.inertia.ix).toBeGreaterThan(0);expect(support.inertia.iy).toBeGreaterThan(0);expect(support.inertia.iz).toBeGreaterThan(0);
   const edges=new Map<string,number>();
   for(let i=0;i<support.indices.length;i+=3)for(let j=0;j<3;j++){
    const a=support.indices[i+j],b=support.indices[i+(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');
    edges.set(key,(edges.get(key)??0)+1);
   }
   expect([...edges.values()].every(count=>count===2)).toBe(true);
   for(let k=1;k<16;k++){
    const u=(1-Math.cos(k/16*Math.PI))/2,root=support.points[k];
    expect(root.y).toBeCloseTo(finThickness(u)/peak*fuselageBeamRadius(d,root.x),12);expect(root.z).toBe(0);
    let previous=Infinity;
    for(let ring=0;ring<=12;ring++){
     const a=support.points[ring*32+k],b=support.points[ring*32+32-k],width=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
     expect(width).toBeLessThanOrEqual(previous+1e-12);previous=width;
    }
    expect(previous).toBeLessThanOrEqual(0.06+1e-12);
    const normal=-Math.min(finThickness(u)*0.8,finThickness(u)/peak*0.03,root.y);
    const end=wingInstancePoint(d,2,support.side,0,u,normal,new Vector3()),actual=support.points[12*32+k];
    expect(new Vector3(actual.x,actual.y,actual.z).distanceTo(end)).toBeLessThan(1e-12);
   }
  }
  const embedded=clone(d);embedded.verticalTail.lateralOffset=0.01;
  expect(wingSupports(embedded)).toHaveLength(0);
 });
 it('净空细分只拆遮蔽边界，原0.8m结构格保留且短水平尾翼仍可操纵',()=>{
  const d=clone(defaultAircraft);d.birdman=false;d.assembly.tailOnFin=false;
  d.mainWing={...wing(8,1,1),dihedral:0,controlSurface:0.3};
  d.assembly.mainWing=1.8;d.assembly.mainWingHeight=1;d.assembly.mainIncidence=0;
  d.assembly.horizontalTail=d.assembly.verticalTail=-2.5;
  const regions=controlSurfaceRegions(d);
  for(const side of [-1,1]){
   const main=regions.filter(region=>region.wingInstance===0&&region.side===side);
   expect(main[0]).toEqual({wingInstance:0,side,spanStart:0,spanEnd:0.04,movable:false});
   expect(main[1]).toEqual({wingInstance:0,side,spanStart:0.04,spanEnd:0.8,movable:true});
   expect(main.slice(2).every(region=>region.movable&&region.spanEnd-region.spanStart<=0.8+1e-10)).toBe(true);
   expect(main.some(region=>Math.abs(region.spanStart-1.6)<1e-10)).toBe(true);
  }
  for(const preset of presets.filter(preset=>!preset.birdman)){
   const tail=controlSurfaceRegions(preset).filter(region=>region.wingInstance===1);
   expect(tail.some(region=>!region.movable)).toBe(true);
   expect(tail.some(region=>region.movable)).toBe(true);
  }
 });
 it('真实座舱椭球及尾部锥梁只裁掉风险小格，不扩展到整个初始格',()=>{
  for(const preset of presets.filter(preset=>preset.engine.count>0)){
   const regions=controlSurfaceRegions(preset);
   for(const side of [-1,1]){
    const main=regions.filter(region=>region.wingInstance===0&&region.side===side);
    const tail=regions.filter(region=>region.wingInstance===1&&region.side===side);
    expect(main[0].movable).toBe(false);expect(main[0].spanEnd).toBeLessThan(0.6);
    expect(tail[0].movable).toBe(false);expect(tail[0].spanEnd).toBeLessThan(0.2);
    expect(tail[0].spanEnd).toBeGreaterThanOrEqual(0.02);
    expect(main[1].movable).toBe(true);expect(tail[1].movable).toBe(true);
    expect(main.some(region=>Math.abs(region.spanEnd-0.8)<1e-10)).toBe(true);
    expect(tail.some(region=>Math.abs(region.spanEnd-0.8)<1e-10)).toBe(true);
   }
  }
 });
 it('中央固定带保持连接，支撑只关闭相交段，外侧操纵仍有效',()=>{
  const d=clone(defaultAircraft);d.birdman=false;d.assembly.tailOnFin=false;
  d.mainWing={...wing(8,1,1),controlSurface:0.3};d.assembly.mainWing=1;d.assembly.mainIncidence=0;d.assembly.mainWingHeight=0;
  d.horizontalTail={...wing(6,1,1),controlSurface:0.3};d.assembly.horizontalTail=-2;d.assembly.tailIncidence=0;
  d.verticalTail={...wing(2,0.8,0.5),mirrored:true,cant:0,lateralOffset:1,controlSurface:0.3};d.assembly.verticalTail=-2;
  const regions=controlSurfaceRegions(d);
  expect(regions.filter(region=>region.wingInstance<2&&region.spanStart===0).every(region=>!region.movable)).toBe(true);
  for(const side of [-1,1]){
   expect(regions.find(region=>region.wingInstance===1&&region.side===side&&region.spanStart<1&&region.spanEnd>1)?.movable).toBe(false);
   expect(regions.some(region=>region.wingInstance===1&&region.side===side&&region.spanStart>=1.6&&region.movable)).toBe(true);
   expect(regions.some(region=>region.wingInstance===0&&region.side===side&&region.spanStart>=0.8&&region.movable)).toBe(true);
  }
 });
 it('镜像垂翼附近只固定实际翼型范围内的控制面',()=>{
  const d=clone(defaultAircraft);d.birdman=false;d.engine.count=0;d.fuelTank.capacity=0;d.assembly.tailOnFin=false;
  d.mainWing={...wing(4,1,0.6),controlSurface:0.3};d.assembly.mainWing=0;d.assembly.mainWingHeight=0.7;d.assembly.mainIncidence=0;
  d.horizontalTail={...wing(1,0.5,0.5),controlSurface:0};d.assembly.horizontalTail=-3;
  d.verticalTail={...wing(3,0.8,0.4),mirrored:true,cant:0,lateralOffset:1,controlSurface:0.3};d.assembly.verticalTail=-1;
  const regions=controlSurfaceRegions(d).filter(region=>region.wingInstance===0);
  for(const side of [-1,1]){
   const at=(span:number)=>regions.find(region=>region.side===side&&region.spanStart<span&&region.spanEnd>span);
   expect(at(0.94)?.movable).toBe(true);
   expect(at(1)?.movable).toBe(false);
   expect(at(1.06)?.movable).toBe(true);
  }
 });
 it('机身梁包围盒角部与舵面扫掠重叠时仍保留分离的舵段',()=>{
  const d=clone(defaultAircraft);d.birdman=true;d.engine.count=0;
  d.mainWing={...wing(4,1,0.6),controlSurface:0.3};
  Object.assign(d.assembly,{mainWing:0,mainWingHeight:0.06,mainIncidence:5,horizontalTail:-3,verticalTail:-3,tailOnFin:false});
  const regions=controlSurfaceRegions(d).filter(region=>region.wingInstance===0);
  for(const side of [-1,1]){
   const at=(span:number)=>regions.find(region=>region.side===side&&region.spanStart<span&&region.spanEnd>span);
   expect(at(0.03)?.movable).toBe(false);
   expect(at(0.13)?.movable).toBe(true);
  }
 });
 it('双发接触圆柱排除包围盒角部，同时保留实际干涉限制',()=>{
  const d=clone(presets.find(preset=>preset.engine.count===2)!);
  d.mainWing={...wing(4,1,0.6),controlSurface:0.3};
  Object.assign(d.engine,{x:-0.5,y:-0.4,lateralOffset:0.8});
  Object.assign(d.assembly,{mainWing:0,mainWingHeight:-0.48,mainIncidence:10,horizontalTail:-3,verticalTail:-3,tailOnFin:false});
  const regions=controlSurfaceRegions(d).filter(region=>region.wingInstance===0);
  for(const side of [-1,1]){
   const at=(span:number)=>regions.find(region=>region.side===side&&region.spanStart<span&&region.spanEnd>span);
   expect(at(0.63)?.movable).toBe(true);
   expect(at(0.75)?.movable).toBe(false);
   expect(at(0.97)?.movable).toBe(true);
  }
 });
 it('镜像垂翼支撑的包围盒重叠时，实体分离的控制段仍可动',()=>{
  const d=clone(defaultAircraft);d.birdman=false;d.engine.count=0;d.fuelTank.capacity=0;d.assembly.tailOnFin=false;
  d.mainWing={...wing(4,1,0.6),controlSurface:0.3,dihedral:5};
  Object.assign(d.assembly,{mainWing:-0.5,mainWingHeight:0.12,mainIncidence:0,horizontalTail:-3,verticalTail:-1});
  d.horizontalTail={...wing(1,0.5,0.5),controlSurface:0};
  d.verticalTail={...wing(3,0.8,0.4),mirrored:true,cant:30,lateralOffset:1,controlSurface:0};
  const regions=controlSurfaceRegions(d).filter(region=>region.wingInstance===0);
  for(const side of [-1,1]){
   const at=(span:number)=>regions.find(region=>region.side===side&&region.spanStart<span&&region.spanEnd>span);
   expect(at(0.35)?.movable).toBe(true);
   expect(at(1.15)?.movable).toBe(false);
  }
 });
 it('两翼中立互不重叠但同时偏转相撞时，共同回退固定翼面',()=>{
  const d=clone(defaultAircraft);d.birdman=false;d.assembly.tailOnFin=false;
  d.mainWing={...wing(8,1,1),airfoil:'naca0012',controlSurface:0.3};
  d.assembly.mainWing=0.5;d.assembly.mainWingHeight=0.2;d.assembly.mainIncidence=0;
  d.assembly.horizontalTail=-2.5;d.assembly.verticalTail=-2.5;
  d.auxiliaryWings=[{kind:'horizontalTail',wing:{...wing(8,1,1),airfoil:'naca0012',controlSurface:0},position:0,incidence:0}];
  const neutral=controlSurfaceRegions(d).filter(region=>region.wingInstance===0&&region.spanStart>=0.8);
  expect(neutral.every(region=>region.movable)).toBe(true);
  d.auxiliaryWings[0].wing.controlSurface=0.3;
  const moving=controlSurfaceRegions(d).filter(region=>(region.wingInstance===0||region.wingInstance===3)&&region.spanStart>=0.8);
  expect(moving.length).toBeGreaterThan(0);expect(moving.every(region=>!region.movable)).toBe(true);
 });
 it('发动机连接支撑占用的舵面段回退固定，远离支撑的外段仍可动',()=>{
  const d=clone(defaultAircraft);d.birdman=false;d.assembly.tailOnFin=false;
  d.mainWing={...wing(8,1,1),controlSurface:0.3};d.assembly.mainWing=0.5;d.assembly.mainWingHeight=0;d.assembly.mainIncidence=0;
  d.assembly.horizontalTail=-2.5;d.assembly.verticalTail=-2.5;
  expect(controlSurfaceRegions(d).filter(region=>region.wingInstance===0&&region.spanStart>=0.8).every(region=>region.movable)).toBe(true);
  d.engine={type:'jet-01',count:2,x:-0.35,y:0,lateralOffset:2.3};
  const regions=controlSurfaceRegions(d).filter(region=>region.wingInstance===0);
  for(const side of [-1,1]){
   expect(regions.find(region=>region.side===side&&Math.abs(region.spanStart-0.8)<1e-8)?.movable).toBe(false);
   expect(regions.find(region=>region.side===side&&Math.abs(region.spanStart-3.2)<1e-8)?.movable).toBe(true);
  }
 });
});
