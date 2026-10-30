import { describe,it,expect } from 'vitest';
import { defaultAircraft,clone,wing,planform,validateAircraft,presets } from '../src/model';
describe('参数化几何与信任边界',()=>{
 it('矩形和梯形面积、展弦比、平均气动弦与左右对称一致',()=>{const p=planform(wing(10,2,1));expect(p.area).toBeCloseTo(15);expect(p.span).toBe(10);expect(p.aspect).toBeCloseTo(100/15);expect(p.chord).toBeCloseTo(14/9);expect(planform(wing(10,2,1),false).area).toBeCloseTo(7.5);});
 it('后掠不凭空改变面积，展弦比随翼展变化',()=>{expect(planform(wing(10,2,1,2)).area).toBeCloseTo(planform(wing(10,2,1,0)).area);expect(planform(wing(12,2,1)).aspect).toBeGreaterThan(planform(wing(10,2,1)).aspect);});
 it('预设均通过几何校验，包括空气动力学不稳定设计',()=>{for(const d of presets)expect(validateAircraft(d)).toEqual(d);});
 it('拒绝非有限数、自交、零面积与越界安装角',()=>{for(const mutate of [(d:any)=>d.fuselage.length=NaN,(d:any)=>d.mainWing.points[1].y=Infinity,(d:any)=>d.mainWing.points[2].x=-2,(d:any)=>d.mainWing.points[1].y=d.mainWing.points[2].y=0,(d:any)=>d.assembly.tailIncidence=50]){const d=clone(defaultAircraft);mutate(d);expect(()=>validateAircraft(d)).toThrow();}});
});
