import { t } from './i18n';
import { engineCatalog, type EngineType } from './engines';
import { defaultStructures, materialCatalog, type BeamStructure, type MaterialId } from './materials';
import birdmanGlider from './aircraft/鸟人间滑翔基础型.json';
import performanceGlider from './aircraft/高性能滑翔型.json';
import twinJet from './aircraft/基础双发型.json';
import singleJet from './aircraft/基础单发型.json';

export type Point = { x: number; y: number };
// Body coordinates: +X forward, +Y up, +Z right. Distances metres, angles degrees.
// Planform points: root leading, tip leading, tip trailing, root trailing; x aft, y outboard.
export interface Wing { points: [Point, Point, Point, Point]; rootReference?: number; dihedral: number; controlSurface: number; materialId: MaterialId; materialAmount: number; structure: BeamStructure }
export interface AircraftDefinition {
 name: string;
 birdman: boolean;
 fuselage: { length: number; center: number };
 cockpit: { position: number; rearLength?: number };
 mainWing: Wing; horizontalTail: Wing; verticalTail: Wing;
 assembly: { mainWing: number; mainWingHeight: number; horizontalTail: number; verticalTail: number; mainIncidence: number; tailIncidence: number; tailOnFin?: boolean };
 pilot: { mass: number }; controls: { travel: number; lateralTravel: number };
 engine: { type: EngineType; count: 0 | 1 | 2; x: number; y: number };
 fuelTank: { x: number; capacity: number };
}
export interface Controls { weight: number; lateral?: number; rudder: number; elevator: number; aileron: number; throttle?: number }
export const clone = <T>(v:T):T => structuredClone(v);
export const clamp = (v:number,a:number,b:number) => Math.max(a,Math.min(b,v));
export const DEG = Math.PI / 180;
export const PILOT_MASS = 60;
export type WingKey = 'mainWing' | 'horizontalTail' | 'verticalTail';
/** Squalo空机参考的蒙皮/机身工程分配；梁质量独立按材料密度和管截面计算。 */
export const AIRFRAME_MASS = {
 mainArea: 8 / 17.8,
 tailArea: 2 / 3.5, fuselageLinear: 6 / 5.28, cockpit: 4,
} as const;
/** 参考支撑侧面积1.2m²分配1kg；板形仅为游戏的刚性支撑代理。 */
export const SUPPORT_AREAL_DENSITY = 1 / 1.2;
export interface BodyEllipsoid { x: number; y: number; xRadius: number; yRadius: number; zRadius: number }
/** Shared scene ellipsoids: offsets and semi-axes in body coordinates. */
export const BODY_GEOMETRY = {
 shell: { x: -0.15, y: 0.02, xRadius: 1.45, yRadius: 0.4, zRadius: 0.46 },
 canopy: { x: 0.12, y: 0.2, xRadius: 0.94, yRadius: 0.52, zRadius: 0.37 },
 nose: { x: -0.1, y: 0.02, xRadius: 0.352, yRadius: 0.176, zRadius: 0.165 },
 beamRadius: 0.12,
} as const;
/** Rear extension changes shell volume without moving its front or the canopy. */
export function cockpitGeometry(d: AircraftDefinition): BodyEllipsoid {
 const shell = BODY_GEOMETRY.shell, xRadius = (shell.xRadius + (d.cockpit.rearLength ?? shell.xRadius)) / 2;
 return { ...shell, x: shell.x + shell.xRadius - xRadius, xRadius };
}
export function cockpitLimits(d: AircraftDefinition) {
 const ends = fuselageEnds(d), shell = cockpitGeometry(d), canopy = BODY_GEOMETRY.canopy;
 return { min: Math.ceil((ends.tail - Math.min(shell.x - shell.xRadius, canopy.x - canopy.xRadius)) * 100 - 1e-8) / 100,
  max: Math.floor((ends.nose - Math.max(shell.x + shell.xRadius, canopy.x + canopy.xRadius)) * 100 + 1e-8) / 100 };
}
export function cockpitRearLengthLimits(d: AircraftDefinition) {
 return { min: 0.2, max: Math.max(0.2, Math.floor((d.cockpit.position - fuselageEnds(d).tail - 0.15) * 100 + 1e-8) / 100) };
}
export function cockpitMass(d: AircraftDefinition): number {
 return d.birdman ? AIRFRAME_MASS.cockpit : AIRFRAME_MASS.cockpit * cockpitGeometry(d).xRadius / BODY_GEOMETRY.shell.xRadius;
}
export function fuelCapacityLimit(d: AircraftDefinition): number {
 const shell = cockpitGeometry(d);
 const radius = 1 / Math.sqrt(9 / shell.xRadius ** 2 + 1 / shell.yRadius ** 2 + 1 / shell.zRadius ** 2);
 return Math.min(40, 40 * shell.xRadius / BODY_GEOMETRY.shell.xRadius, 4000 * Math.PI * radius ** 3);
}
const PROPULSION_CLEARANCE = 0.03;
export function engineLateralOffset(d: AircraftDefinition): number {
 return BODY_GEOMETRY.shell.zRadius + engineCatalog[d.engine.type].radius + PROPULSION_CLEARANCE;
}
/** Allowed signed heights; cylinder's full axial interval clears the visible body, not only its beam. */
export function engineHeightRanges(d: AircraftDefinition): { min: number; max: number }[] {
 if (d.engine.count !== 1) return [{ min: -0.5, max: 1 }];
 const spec = engineCatalog[d.engine.type], padding = spec.radius + PROPULSION_CLEARANCE;
 const blocked: { min: number; max: number }[] = [];
 const { nose, tail } = fuselageEnds(d);
 if (d.engine.x + spec.length / 2 >= tail && d.engine.x - spec.length / 2 <= nose) {
  blocked.push({ min: -BODY_GEOMETRY.beamRadius - padding, max: BODY_GEOMETRY.beamRadius + padding });
 }
 for (const [shape, x, upperHalf, side] of [
  [BODY_GEOMETRY.shell, d.cockpit.position + BODY_GEOMETRY.shell.x, false, 1],
  [{...BODY_GEOMETRY.shell,xRadius:d.cockpit.rearLength??BODY_GEOMETRY.shell.xRadius}, d.cockpit.position + BODY_GEOMETRY.shell.x, false, -1],
  [BODY_GEOMETRY.canopy, d.cockpit.position + BODY_GEOMETRY.canopy.x, true, 0],
  [BODY_GEOMETRY.nose, nose + BODY_GEOMETRY.nose.x, false, 0],
 ] as const) {
  if (side === 1 && d.engine.x + spec.length / 2 < x || side === -1 && d.engine.x - spec.length / 2 > x) continue;
  const nearest = Math.max(0, Math.abs(d.engine.x - x) - spec.length / 2);
  if (nearest > shape.xRadius) continue;
  const height = shape.yRadius * Math.sqrt(Math.max(0, 1 - (nearest / shape.xRadius) ** 2));
  blocked.push({ min: shape.y - (upperHalf ? 0 : height) - padding, max: shape.y + height + padding });
 }
 blocked.sort((a, b) => a.min - b.min);
 const ranges: { min: number; max: number }[] = [];
 let min = -0.5;
 for (const interval of blocked) {
  if (interval.max <= min || interval.min >= 1) continue;
  if (interval.min > min) ranges.push({ min, max: Math.min(1, interval.min) });
  min = Math.max(min, interval.max);
 }
 if (min < 1) ranges.push({ min, max: 1 });
 return ranges.map(range=>({min:Math.ceil(range.min*100-1e-8)/100,max:Math.floor(range.max*100+1e-8)/100})).filter(range=>range.min<=range.max);
}
export function normalizeEngineHeight(d: AircraftDefinition, value: number): number {
 const ranges = engineHeightRanges(d);
 let nearest = ranges[0].min, distance = Infinity;
 for (const range of ranges) {
  const candidate = clamp(value, range.min, range.max), delta = Math.abs(candidate - value);
  if (delta < distance) { nearest = candidate; distance = delta; }
 }
 return nearest;
}
export function engineMountLimits(d: AircraftDefinition) {
 const ends = fuselageEnds(d), halfWidth = engineCatalog[d.engine.type].length * 0.3;
 return { min: Math.ceil((ends.tail + halfWidth) * 100 - 1e-8) / 100,
  max: Math.floor((ends.nose - halfWidth) * 100 + 1e-8) / 100 };
}
export interface EngineMount { x: number; y: number; z: number; supportLength: number; supportWidth: number; supportMass: number }
export function engineMounts(d: AircraftDefinition): EngineMount[] {
 const engine = d.engine, spec = engineCatalog[engine.type], mounts: EngineMount[] = [];
 const y = normalizeEngineHeight(d, engine.y), offset = engineLateralOffset(d);
 for (let index = 0; index < engine.count; index++) {
  const z = engine.count === 2 ? (index === 0 ? -1 : 1) * offset : 0;
  const supportLength = Math.max(0, Math.hypot(y, z) - spec.radius), supportWidth = spec.length * 0.6;
  mounts.push({ x: engine.x, y, z, supportLength, supportWidth, supportMass: supportLength * supportWidth * SUPPORT_AREAL_DENSITY });
 }
 return mounts;
}
/** 3:1长椭球；capacity为升，半轴满足4πr³=体积。 */
export function fuelTankDimensions(capacity: number) {
 const radius = Math.cbrt(capacity * 0.001 / (4 * Math.PI));
 return { radius, length: radius * 6 };
}
/** Conservative box-in-ellipsoid fit keeps the whole tank inside the closed cockpit shell. */
export function fuelTankLimits(d: AircraftDefinition): { min: number; max: number } {
 const shell = BODY_GEOMETRY.shell, shape = fuelTankDimensions(Math.min(d.fuelTank.capacity, fuelCapacityLimit(d)));
 const radialFit = Math.sqrt(Math.max(0, 1 - (shape.radius / shell.yRadius) ** 2 - (shape.radius / shell.zRadius) ** 2));
 const seam = d.cockpit.position + shell.x;
 return { min: Math.ceil((seam - (d.cockpit.rearLength ?? shell.xRadius) * radialFit + shape.length / 2) * 100 - 1e-8) / 100,
  max: Math.floor((seam + shell.xRadius * radialFit - shape.length / 2) * 100 + 1e-8) / 100 };
}
export function fuelTankPosition(d: AircraftDefinition) {
 const limits = fuelTankLimits(d);
 return { x: clamp(d.fuelTank.x, limits.min, limits.max), y: BODY_GEOMETRY.shell.y, z: 0 };
}
export function normalizePropulsion(d: AircraftDefinition): void {
 if (d.engine.count === 0) d.fuelTank.capacity = 0;
 d.fuelTank.capacity = Math.min(d.fuelTank.capacity, fuelCapacityLimit(d));
 d.engine.y = normalizeEngineHeight(d, d.engine.y);
 d.fuelTank.x = fuelTankPosition(d).x;
}
/** 尾翼位置为翼根中心；主翼保留纵向前缘基准，高度统一为翼根中心高度。 */
export function wingOrigin(d: AircraftDefinition, key: WingKey): { x: number; y: number } {
 const wing = d[key], middle = wing.rootReference ?? (wing.points[0].x + wing.points[3].x) / 2;
 if (key === 'horizontalTail' && d.assembly.tailOnFin) {
  const origin = wingOrigin(d, 'verticalTail');
  return { x: origin.x, y: d.verticalTail.points[1].y };
 }
 const angle = (key === 'mainWing' ? d.assembly.mainIncidence : key === 'horizontalTail' ? d.assembly.tailIncidence : 0) * DEG;
 return { x: d.assembly[key] + (key === 'mainWing' ? 0 : middle * Math.cos(angle)),
  y: (key === 'mainWing' ? d.assembly.mainWingHeight : 0) + middle * Math.sin(angle) };
}
/** Rigid horizontal-wing rotation: dihedral about the chord, then incidence; x forward, y thickness, span outboard. */
export function wingLocalPoint<T extends { x: number; y: number; z: number }>(wing: Wing, incidence: number, side: number, x: number, y: number, span: number, out: T): T {
 const angle = wing.dihedral * DEG, c = Math.cos(incidence), s = Math.sin(incidence), cd = Math.cos(angle), sd = Math.sin(angle);
 const height = y * cd + span * sd;
 out.x = x * c - height * s;
 out.y = x * s + height * c;
 out.z = side * (span * cd - y * sd);
 return out;
}
/** Every root endpoint, rather than only its midpoint, stays on the body. */
export function wingMountLimits(d: AircraftDefinition, key: WingKey) {
 const ends = fuselageEnds(d), w = d[key];
 const c = Math.cos((key === 'mainWing' ? d.assembly.mainIncidence : key === 'horizontalTail' ? d.assembly.tailIncidence : 0) * DEG);
 const middle = key === 'mainWing' ? 0 : (w.rootReference ?? (w.points[0].x + w.points[3].x) / 2);
 return { min: Math.ceil((ends.tail + (w.points[3].x - middle) * c) * 100 - 1e-8) / 100,
  max: Math.floor((ends.nose + (w.points[0].x - middle) * c) * 100 + 1e-8) / 100 };
}
export function mainWingMountLimits(d: AircraftDefinition) {
 return wingMountLimits(d, 'mainWing');
}
export function normalizeAircraftGeometry(d: AircraftDefinition): void {
 const limits = cockpitLimits(d);
 if (limits.min > limits.max + 1e-8) throw Error('机身必须支撑完整驾驶舱');
 d.cockpit.position = clamp(d.cockpit.position, limits.min, limits.max);
 for (const key of ['mainWing', 'verticalTail', 'horizontalTail'] as const) {
  if (key === 'horizontalTail' && d.assembly.tailOnFin) {
   d.horizontalTail.points[0].x = d.verticalTail.points[1].x;
   d.horizontalTail.points[3].x = d.verticalTail.points[2].x;
   d.assembly.tailIncidence = 0;
   d.assembly.horizontalTail = wingOrigin(d, 'verticalTail').x - (d.verticalTail.points[1].x + d.verticalTail.points[2].x) / 2;
   continue;
  }
  const mount = wingMountLimits(d, key);
  if (mount.min > mount.max) throw Error(key === 'mainWing' ? '主翼翼根无法安装到当前机身，请调整机身或翼根' : '尾翼翼根无法安装到当前机身');
  d.assembly[key] = clamp(d.assembly[key], mount.min, mount.max);
 }
 if (d.engine.count > 0) {
  const limits = engineMountLimits(d);
  d.engine.x = clamp(d.engine.x, limits.min, limits.max);
 }
 normalizePropulsion(d);
}
/** Keep the coordinate origin fixed so editing one root end cannot move its neighbours. */
export function editWingPoint(d: AircraftDefinition, key: WingKey, index: number, x: number, y: number): void {
 if (key === 'horizontalTail' && d.assembly.tailOnFin && (index === 0 || index === 3)) {
  editWingPoint(d, 'verticalTail', index === 0 ? 1 : 2, x, d.verticalTail.points[1].y);
  return;
 }
 const wing = d[key], p = wing.points;
 if (wing.rootReference === undefined) wing.rootReference = (p[0].x + p[3].x) / 2;
 x = Math.round(x * 100) / 100; y = Math.round(y * 100) / 100;
 p[index].x = clamp(x, index < 2 ? -3 : p[index === 3 ? 0 : 1].x + 0.15, index < 2 ? p[index === 0 ? 3 : 2].x - 0.15 : 6);
 if (index === 1 || index === 2) {
  y = key === 'verticalTail' ? clamp(y, -0.5, 12) : clamp(y, 0.25, 12);
  if (Math.abs(y) < 0.25) y = y < 0 ? -0.25 : 0.25;
  p[1].y = p[2].y = y;
 }
 p[0].y = p[3].y = 0;
 if (index === 0 || index === 3) {
  const origin = wingOrigin(d, key);
  const c = Math.cos((key === 'mainWing' ? d.assembly.mainIncidence : key === 'horizontalTail' ? d.assembly.tailIncidence : 0) * DEG);
  const ends = fuselageEnds(d);
  p[index].x = clamp(p[index].x, Math.ceil((origin.x - ends.nose) / c * 100 - 1e-8) / 100, Math.floor((origin.x - ends.tail) / c * 100 + 1e-8) / 100);
 }
 normalizeAircraftGeometry(d);
}
export function mainWingSupport(d: AircraftDefinition) {
 const w = d.mainWing, angle = d.assembly.mainIncidence * DEG, origin = wingOrigin(d, 'mainWing');
 const width = (w.points[3].x - w.points[0].x) * Math.cos(angle), height = origin.y - (w.points[0].x + w.points[3].x) / 2 * Math.sin(angle);
 const area = width * Math.abs(height), mass = area * SUPPORT_AREAL_DENSITY;
 return { width, height, area, mass,
  x: origin.x - (w.points[0].x + w.points[3].x) / 2 * Math.cos(angle), y: height / 2,
  frontX: origin.x - w.points[0].x * Math.cos(angle), backX: origin.x - w.points[3].x * Math.cos(angle),
  frontY: origin.y - w.points[0].x * Math.sin(angle), backY: origin.y - w.points[3].x * Math.sin(angle) };
}
export function fuselageEnds(d: AircraftDefinition) {
 return { nose: d.fuselage.center + d.fuselage.length / 2, tail: d.fuselage.center - d.fuselage.length / 2 };
}
/** Resize one end without moving the other or detaching occupied mounting points. */
export function fuselageEndLimits(d: AircraftDefinition, end: 'nose' | 'tail') {
 const { nose, tail } = fuselageEnds(d);
 const occupied = [0.1, -0.1], shell = cockpitGeometry(d), canopy = BODY_GEOMETRY.canopy;
 occupied.push(d.cockpit.position + Math.min(shell.x - shell.xRadius, canopy.x - canopy.xRadius),
  d.cockpit.position + Math.max(shell.x + shell.xRadius, canopy.x + canopy.xRadius));
 for (const key of ['mainWing', 'horizontalTail', 'verticalTail'] as const) {
  if (key === 'horizontalTail' && d.assembly.tailOnFin) continue;
  const origin = wingOrigin(d, key), c = Math.cos((key === 'mainWing' ? d.assembly.mainIncidence : key === 'horizontalTail' ? d.assembly.tailIncidence : 0) * DEG);
  occupied.push(origin.x - d[key].points[0].x * c, origin.x - d[key].points[3].x * c);
 }
 if (d.engine.count > 0) {
  const halfWidth = engineCatalog[d.engine.type].length * 0.3;
  occupied.push(d.engine.x - halfWidth, d.engine.x + halfWidth);
 }
 return end === 'nose' ? { min: Math.ceil(Math.max(tail + 3, ...occupied) * 100 - 1e-8) / 100, max: tail + 12 }
  : { min: nose - 12, max: Math.floor(Math.min(nose - 3, ...occupied) * 100 + 1e-8) / 100 };
}
export function resizeFuselage(d: AircraftDefinition, end: 'nose' | 'tail', position: number): void {
 if (!Number.isFinite(position)) throw Error('机身端点必须是有限数值');
 position = Math.round(position * 100) / 100;
 let { nose, tail } = fuselageEnds(d);
 const limits = fuselageEndLimits(d, end);
 if (end === 'nose') nose = clamp(position, limits.min, limits.max);
 else tail = clamp(position, limits.min, limits.max);
 d.fuselage.length = nose - tail;
 d.fuselage.center = (nose + tail) / 2;
}
export const wing = (span:number,root:number,tip:number,sweep=0):Wing => ({points:[{x:0,y:0},{x:sweep,y:span/2},{x:sweep+tip,y:span/2},{x:root,y:0}],dihedral:0,controlSurface:0,materialId:'carbon-epoxy',materialAmount:1,structure:{...defaultStructures.horizontalTail}});
export const defaultAircraft:AircraftDefinition = clone(birdmanGlider as AircraftDefinition);
export function planform(w:Wing,symmetric=true) {
 const p=w.points; let twice=0; for(let i=0;i<4;i++){const a=p[i],b=p[(i+1)%4];twice+=a.x*b.y-b.x*a.y;}
 const area=Math.abs(twice)/2*(symmetric?2:1);const span=Math.max(...p.map(p=>Math.abs(p.y)))*(symmetric?2:1);
 const root=p[3].x-p[0].x,tip=p[2].x-p[1].x;const taper=tip/root;
 return {area,span,aspect:span*span/area,root,tip,chord:2/3*root*(1+taper+taper*taper)/(1+taper),centerX:(p[0].x+p[1].x+p[2].x+p[3].x)/4,centerY:p[1].y/2};
}
export function validateAircraft(value:unknown):AircraftDefinition {
 if(!value || typeof value!=='object')throw Error('飞机数据必须是对象');
 const d=clone(value) as AircraftDefinition;
 const finite=(n:unknown,a:number,b:number)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<a||n>b)throw Error(t('参数必须在 {p0} 至 {p1} 之间',{p0:a,p1:b}));};
 if(typeof d.name!=='string'||!d.name.trim()||d.name.length>60)throw Error('名称长度须为 1–60 字符');
 finite(d.fuselage?.length,3,12);finite(d.cockpit?.position,-24,24);finite(d.pilot?.mass,40,100);finite(d.controls?.travel,0.1,0.8);
 if (d.cockpit.rearLength !== undefined) finite(d.cockpit.rearLength,0.2,10.55);
 if (d.birdman === undefined) d.birdman = true;
 if (typeof d.birdman !== 'boolean') throw Error('鸟人间设计开关必须是布尔值');
 if (d.controls.lateralTravel === undefined) d.controls.lateralTravel = 0.1;
 finite(d.controls.lateralTravel,0.01,0.2);
 if (d.engine === undefined) d.engine = clone(defaultAircraft.engine);
 if (d.fuelTank === undefined) d.fuelTank = clone(defaultAircraft.fuelTank);
 if (!d.engine || typeof d.engine !== 'object' || !Object.hasOwn(engineCatalog,d.engine.type)) throw Error('未知发动机型号');
 if (![0,1,2].includes(d.engine.count)) throw Error('发动机数量须为0、1或2');
 const oldEngine = d.engine as AircraftDefinition['engine'] & { mount?: unknown; z?: unknown };
 const oldTank = d.fuelTank as AircraftDefinition['fuelTank'] & { y?: unknown };
 finite(d.engine.x,-12,12);
 if (oldEngine.mount !== undefined) {
  if (oldEngine.mount !== 'above' && oldEngine.mount !== 'below') throw Error('发动机安装位置须为上方或下方');
  finite(d.engine.y,0.2,2);
  d.engine.y = clamp((oldEngine.mount === 'below' ? -1 : 1) * d.engine.y,-0.5,1);
 } else finite(d.engine.y,-0.5,1);
 if (oldEngine.z !== undefined) finite(oldEngine.z,-4,4);
 if (oldTank?.y !== undefined) finite(oldTank.y,-1,1);
 finite(d.fuelTank?.x,-12,12);finite(d.fuelTank?.capacity,0,40);
 d.engine = { type: d.engine.type, count: d.engine.count, x: d.engine.x, y: d.engine.y };
 d.fuelTank = { x: d.fuelTank.x, capacity: d.fuelTank.capacity };
 if(d.birdman&&d.engine.count!==0)throw Error('鸟人间设计不能安装动力发动机');
 // Normalize existing saved designs at the trust boundary; flight mass is fixed.
 if (d.fuselage.center === undefined) d.fuselage.center = 0;
 finite(d.fuselage.center,-12,12);
 d.pilot.mass = PILOT_MASS;
 for(const key of ['mainWing','horizontalTail','verticalTail'] as const){const w=d[key];if(!w||!Array.isArray(w.points)||w.points.length!==4)throw Error('翼面必须有四个顶点');for(const p of w.points){finite(p.x,-3,6);finite(p.y,key==='verticalTail'?-0.5:0,12);} finite(w.dihedral,-25,25);
 if(w.controlSurface===undefined)w.controlSurface=key==='verticalTail'?1:0;
 finite(w.controlSurface,0,1);
 if(w.rootReference!==undefined)finite(w.rootReference,-3,6);
 if(w.materialId===undefined)w.materialId='carbon-epoxy';
 if(typeof w.materialId!=='string'||!Object.hasOwn(materialCatalog,w.materialId))throw Error('未知翼面材料');
 if(w.materialAmount===undefined)w.materialAmount=1;
 finite(w.materialAmount,0.5,2);
 if(w.structure===undefined)w.structure=clone(defaultStructures[key]);
 if(!w.structure||typeof w.structure!=='object')throw Error('梁截面必须是闭口矩形管参数');
 finite(w.structure.width,0.005,0.5);finite(w.structure.height,0.005,0.5);finite(w.structure.wallThickness,0.0002,0.05);
 if(2*w.structure.wallThickness>=Math.min(w.structure.width,w.structure.height))throw Error('梁管壁厚的两倍必须小于宽度和高度');
 w.structure={width:w.structure.width,height:w.structure.height,wallThickness:w.structure.wallThickness};
 // Design snapshots contain geometry and material only; runtime deformation never persists.
 d[key]={points:w.points.map(p=>({x:p.x,y:p.y})) as Wing['points'],...(w.rootReference===undefined?{}:{rootReference:w.rootReference}),dihedral:w.dihedral,controlSurface:w.controlSurface,materialId:w.materialId,materialAmount:w.materialAmount,structure:w.structure};
 if(key!=='verticalTail'&&d.birdman&&w.controlSurface!==0)throw Error('鸟人间设计只允许垂尾操纵，主翼和平尾不能安装控制面');
 const p=w.points;if(p[0].y!==0||p[3].y!==0||Math.abs(p[1].y-p[2].y)>0.001||Math.abs(p[1].y)<0.25||p[3].x-p[0].x<0.15||p[2].x-p[1].x<0.15)throw Error('翼面不得自交，根弦与梢弦至少 0.15 m');
 }
 for(const key of ['mainWing','horizontalTail','verticalTail'] as const)finite(d.assembly?.[key],-24,24);
 if(d.assembly.tailOnFin!==undefined&&typeof d.assembly.tailOnFin!=='boolean')throw Error('平尾垂尾安装开关必须是布尔值');
 finite(d.assembly?.mainWingHeight,-0.5,1);finite(d.assembly?.mainIncidence,-10,18);finite(d.assembly?.tailIncidence,-12,12);
 const ends = fuselageEnds(d), epsilon = 1e-8;
 if (ends.nose < 0.1 - epsilon || ends.tail > -0.1 + epsilon) throw Error('机头须至少为 0.1 m，机尾须不高于 -0.1 m');
 const cockpit = cockpitLimits(d);
 if (d.cockpit.position < cockpit.min - epsilon || d.cockpit.position > cockpit.max + epsilon) {
  // Older files constrained only the pilot anchor and front clearance.
  if (d.cockpit.rearLength !== undefined || d.cockpit.position < ends.tail - epsilon || d.cockpit.position + 0.95 > ends.nose + epsilon) throw Error('机身必须支撑完整驾驶舱');
 }
 for (const key of ['horizontalTail','verticalTail'] as const) {
  if (key === 'horizontalTail' && d.assembly.tailOnFin) continue;
  if (d.assembly[key] < ends.tail - epsilon || d.assembly[key] > ends.nose + epsilon) throw Error('机身必须支撑尾翼安装点');
 }
 if(d.engine.count>0&&(d.engine.x<ends.tail||d.engine.x>ends.nose))throw Error('机身必须支撑发动机安装点');
 normalizeAircraftGeometry(d);
 return {name:d.name,birdman:d.birdman,
  fuselage:{length:d.fuselage.length,center:d.fuselage.center},cockpit:{position:d.cockpit.position,...(d.cockpit.rearLength===undefined?{}:{rearLength:d.cockpit.rearLength})},
  mainWing:d.mainWing,horizontalTail:d.horizontalTail,verticalTail:d.verticalTail,
  assembly:{mainWing:d.assembly.mainWing,mainWingHeight:d.assembly.mainWingHeight,horizontalTail:d.assembly.horizontalTail,verticalTail:d.assembly.verticalTail,mainIncidence:d.assembly.mainIncidence,tailIncidence:d.assembly.tailIncidence,...(d.assembly.tailOnFin===undefined?{}:{tailOnFin:d.assembly.tailOnFin})},
  pilot:{mass:d.pilot.mass},controls:{travel:d.controls.travel,lateralTravel:d.controls.lateralTravel},engine:d.engine,fuelTank:d.fuelTank};
}
export const presets: AircraftDefinition[] = [birdmanGlider, performanceGlider, twinJet, singleJet].map(definition => clone(definition as AircraftDefinition));
