import { engineCatalog, type EngineType } from './engines';

export type Point = { x: number; y: number };
// Body coordinates: +X forward, +Y up, +Z right. Distances metres, angles degrees.
// Planform points: root leading, tip leading, tip trailing, root trailing; x aft, y outboard.
export interface Wing { points: [Point, Point, Point, Point]; dihedral: number; controlSurface: number }
export interface AircraftDefinition {
 name: string;
 birdman: boolean;
 fuselage: { length: number; center: number };
 cockpit: { position: number };
 mainWing: Wing; horizontalTail: Wing; verticalTail: Wing;
 assembly: { mainWing: number; mainWingHeight: number; horizontalTail: number; verticalTail: number; mainIncidence: number; tailIncidence: number };
 pilot: { mass: number }; controls: { travel: number; lateralTravel: number };
 engine: { type: EngineType; count: 0 | 1 | 2; mount: 'above' | 'below'; x: number; y: number; z: number };
 fuelTank: { x: number; y: number; capacity: number };
}
export interface Controls { weight: number; lateral?: number; rudder: number; elevator: number; aileron: number; throttle?: number }
export type FlightMode = 'standard' | 'assisted' | 'experimental';
export const clone = <T>(v:T):T => structuredClone(v);
export const clamp = (v:number,a:number,b:number) => Math.max(a,Math.min(b,v));
export const DEG = Math.PI / 180;
export const PILOT_MASS = 60;
export type WingKey = 'mainWing' | 'horizontalTail' | 'verticalTail';
/** Squalo公开空机38kg的工程分配，不是部件实测；参考尺寸25.3m/17.8m²/5.28m。 */
export const AIRFRAME_MASS = {
 mainArea: 8 / 17.8, mainSpar: 17 / 25.3 ** 3,
 tailArea: 2 / 3.5, fuselageLinear: 6 / 5.28, cockpit: 4,
} as const;
/** 参考支撑侧面积1.2m²分配1kg；板形仅为游戏的刚性支撑代理。 */
export const SUPPORT_AREAL_DENSITY = 1 / 1.2;
export interface EngineMount { x: number; y: number; z: number; supportLength: number; supportWidth: number; supportMass: number }
export function engineMounts(d: AircraftDefinition): EngineMount[] {
 const engine = d.engine, spec = engineCatalog[engine.type], mounts: EngineMount[] = [];
 for (let index = 0; index < engine.count; index++) {
  const y = (engine.mount === 'above' ? 1 : -1) * engine.y;
  const z = engine.count === 2 ? (index === 0 ? -1 : 1) * engine.z : engine.z;
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
/** 尾翼位置为翼根中心；主翼保留纵向前缘基准，高度统一为翼根中心高度。 */
export function wingOrigin(d: AircraftDefinition, key: WingKey) {
 const wing = d[key], middle = (wing.points[0].x + wing.points[3].x) / 2;
 const angle = (key === 'mainWing' ? d.assembly.mainIncidence : key === 'horizontalTail' ? d.assembly.tailIncidence : 0) * DEG;
 return { x: d.assembly[key] + (key === 'mainWing' ? 0 : middle * Math.cos(angle)),
  y: (key === 'mainWing' ? d.assembly.mainWingHeight : 0) + middle * Math.sin(angle) };
}
export function mainWingMountLimits(d: AircraftDefinition) {
 const ends = fuselageEnds(d), w = d.mainWing;
 const offset = (w.points[0].x + w.points[3].x) / 2 * Math.cos(d.assembly.mainIncidence * DEG);
 return { min: Math.max(-6, ends.tail + offset), max: Math.min(5, ends.nose + offset) };
}
export function mainWingSupport(d: AircraftDefinition) {
 const w = d.mainWing, angle = d.assembly.mainIncidence * DEG, origin = wingOrigin(d, 'mainWing');
 const width = (w.points[3].x - w.points[0].x) * Math.cos(angle), height = d.assembly.mainWingHeight;
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
export function resizeFuselage(d: AircraftDefinition, end: 'nose' | 'tail', position: number): void {
 if (!Number.isFinite(position)) throw Error('机身端点必须是有限数值');
 let { nose, tail } = fuselageEnds(d);
 const mainRoot = mainWingSupport(d).x;
 const engineX = d.engine.count > 0 ? d.engine.x : d.cockpit.position;
 const tankX = d.fuelTank.capacity > 0 ? d.fuelTank.x : d.cockpit.position;
 if (end === 'nose') nose = clamp(position, Math.max(tail + 3, d.cockpit.position + 0.95, d.assembly.horizontalTail, d.assembly.verticalTail, mainRoot, engineX, tankX), tail + 12);
 else tail = clamp(position, nose - 12, Math.min(nose - 3, d.cockpit.position, d.assembly.horizontalTail, d.assembly.verticalTail, mainRoot, engineX, tankX));
 d.fuselage.length = nose - tail;
 d.fuselage.center = (nose + tail) / 2;
}
export const wing = (span:number,root:number,tip:number,sweep=0):Wing => ({points:[{x:0,y:0},{x:sweep,y:span/2},{x:sweep+tip,y:span/2},{x:root,y:0}],dihedral:0,controlSurface:0});
export const defaultAircraft:AircraftDefinition = {name:'湖风 01',birdman:true,fuselage:{length:6.5,center:0},cockpit:{position:1.2},mainWing:{...wing(14,1.5,0.8,0.25),dihedral:5},horizontalTail:wing(3.5,0.9,0.55,0.15),verticalTail:{...wing(3,0.9,0.4,0.3),controlSurface:1},assembly:{mainWing:0.9,mainWingHeight:0.8,horizontalTail:-2.8,verticalTail:-2.9,mainIncidence:4,tailIncidence:0},pilot:{mass:PILOT_MASS},controls:{travel:0.45,lateralTravel:0.1},engine:{type:'jet-01',count:0,mount:'above',x:-0.5,y:0.5,z:0},fuelTank:{x:0,y:0,capacity:0}};
export function planform(w:Wing,symmetric=true) {
 const p=w.points; let twice=0; for(let i=0;i<4;i++){const a=p[i],b=p[(i+1)%4];twice+=a.x*b.y-b.x*a.y;}
 const area=Math.abs(twice)/2*(symmetric?2:1);const span=Math.max(...p.map(p=>p.y))*(symmetric?2:1);
 const root=p[3].x-p[0].x,tip=p[2].x-p[1].x;const taper=tip/root;
 return {area,span,aspect:span*span/area,root,tip,chord:2/3*root*(1+taper+taper*taper)/(1+taper),centerX:(p[0].x+p[1].x+p[2].x+p[3].x)/4,centerY:span/(symmetric?4:2)};
}
export function validateAircraft(value:unknown):AircraftDefinition {
 if(!value || typeof value!=='object')throw Error('飞机数据必须是对象');
 const d=clone(value) as AircraftDefinition;
 const finite=(n:unknown,a:number,b:number)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<a||n>b)throw Error(`参数必须在 ${a} 至 ${b} 之间`);};
 if(typeof d.name!=='string'||!d.name.trim()||d.name.length>60)throw Error('名称长度须为 1–60 字符');
 finite(d.fuselage?.length,3,12);finite(d.cockpit?.position,-3,4);finite(d.pilot?.mass,40,100);finite(d.controls?.travel,0.1,0.8);
 if (d.birdman === undefined) d.birdman = true;
 if (typeof d.birdman !== 'boolean') throw Error('鸟人间设计开关必须是布尔值');
 if (d.controls.lateralTravel === undefined) d.controls.lateralTravel = 0.1;
 finite(d.controls.lateralTravel,0.01,0.2);
 if (d.engine === undefined) d.engine = clone(defaultAircraft.engine);
 if (d.fuelTank === undefined) d.fuelTank = clone(defaultAircraft.fuelTank);
 if (!d.engine || typeof d.engine !== 'object' || !Object.hasOwn(engineCatalog,d.engine.type)) throw Error('未知发动机型号');
 if (![0,1,2].includes(d.engine.count)) throw Error('发动机数量须为0、1或2');
 if (d.engine.mount !== 'above' && d.engine.mount !== 'below') throw Error('发动机安装位置须为上方或下方');
 finite(d.engine.x,-12,12);finite(d.engine.y,0.2,2);finite(d.engine.z,-4,4);
 if(d.engine.count===2&&d.engine.z<0.35)throw Error('双发对称侧距至少0.35 m');
 finite(d.fuelTank?.x,-12,12);finite(d.fuelTank?.y,-1,1);finite(d.fuelTank?.capacity,0,40);
 if(d.birdman&&d.engine.count!==0)throw Error('鸟人间设计不能安装动力发动机');
 // Normalize existing saved designs at the trust boundary; flight mass is fixed.
 if (d.fuselage.center === undefined) d.fuselage.center = 0;
 finite(d.fuselage.center,-12,12);
 d.pilot.mass = PILOT_MASS;
 for(const key of ['mainWing','horizontalTail','verticalTail'] as const){const w=d[key];if(!w||!Array.isArray(w.points)||w.points.length!==4)throw Error('翼面必须有四个顶点');for(const p of w.points){finite(p.x,-3,6);finite(p.y,0,12);} finite(w.dihedral,0,25);
 if(w.controlSurface===undefined)w.controlSurface=key==='verticalTail'?1:0;
 finite(w.controlSurface,0,1);
 if(key!=='verticalTail'&&d.birdman&&w.controlSurface!==0)throw Error('鸟人间设计只允许垂尾操纵，主翼和平尾不能安装控制面');
 const p=w.points;if(p[0].y!==0||p[3].y!==0||Math.abs(p[1].y-p[2].y)>0.001||p[1].y<0.25||p[3].x-p[0].x<0.15||p[2].x-p[1].x<0.15)throw Error('翼面不得自交，根弦与梢弦至少 0.15 m');
 }
 for(const key of ['mainWing','horizontalTail','verticalTail'] as const)finite(d.assembly?.[key],-6,5);
 finite(d.assembly?.mainWingHeight,-0.5,1);finite(d.assembly?.mainIncidence,-10,18);finite(d.assembly?.tailIncidence,-12,12);
 const ends = fuselageEnds(d), epsilon = 1e-8;
 if (ends.nose + epsilon < d.cockpit.position + 0.95 || ends.tail - epsilon > d.cockpit.position) throw Error('机身必须支撑驾驶舱，机头须在驾驶舱前至少 0.95 m');
 for (const key of ['horizontalTail','verticalTail'] as const) {
  if (d.assembly[key] < ends.tail - epsilon || d.assembly[key] > ends.nose + epsilon) throw Error('机身必须支撑水平尾翼与垂直尾翼安装点');
 }
 if(d.engine.count>0&&(d.engine.x<ends.tail||d.engine.x>ends.nose))throw Error('机身必须支撑发动机安装点');
 if(d.fuelTank.capacity>0&&(d.fuelTank.x<ends.tail||d.fuelTank.x>ends.nose))throw Error('油箱必须安装在机身范围内');
 const limits = mainWingMountLimits(d);
 if (limits.min > limits.max) throw Error('主翼翼根无法安装到当前机身，请调整机身或翼根');
 d.assembly.mainWing = clamp(d.assembly.mainWing, limits.min, limits.max);
 return d;
}
export const presets = [
 {name:'默认均衡型',change:(d:AircraftDefinition)=>d},
 {name:'高展弦比型',change:(d:AircraftDefinition)=>{d.mainWing= {...wing(19,1.1,0.65,0.2),dihedral:5};return d;}},
 {name:'高稳定型',change:(d:AircraftDefinition)=>{d.mainWing.dihedral=12;d.horizontalTail=wing(4.5,1,0.7,0.15);d.verticalTail={...wing(4,1,0.6,0.2),controlSurface:1};return d;}},
 {name:'灵敏操纵型',change:(d:AircraftDefinition)=>{d.horizontalTail=wing(2.5,0.7,0.4);d.mainWing.dihedral=2;return d;}},
 {name:'重心过后不稳定型',change:(d:AircraftDefinition)=>{d.cockpit.position=-0.8;return d;}},
 {name:'高翼载荷型',change:(d:AircraftDefinition)=>{d.mainWing={...wing(8,0.9,0.45),dihedral:5};return d;}},
 {name:'高山速降机动型',change:(d:AircraftDefinition)=>{d.birdman=false;d.cockpit.position=0.45;d.mainWing={...wing(8.6,0.85,0.55,0.1),dihedral:3,controlSurface:0.28};d.horizontalTail={...wing(3,0.65,0.4,0.1),controlSurface:0.4};d.verticalTail={...wing(2.4,0.7,0.35,0.15),controlSurface:1};d.assembly.mainWing=0.8;d.assembly.mainWingHeight=0.35;d.assembly.mainIncidence=1;d.controls.travel=0.3;d.controls.lateralTravel=0.1;return d;}},
 {name:'低空喷气巡航型',change:(d:AircraftDefinition)=>{d.birdman=false;d.cockpit.position=0.45;d.mainWing={...wing(8.6,0.85,0.55,0.1),dihedral:3,controlSurface:0.28};d.horizontalTail={...wing(3,0.65,0.4,0.1),controlSurface:0.4};d.verticalTail={...wing(2.4,0.7,0.35,0.15),controlSurface:1};d.assembly.mainWing=0.8;d.assembly.mainWingHeight=0.35;d.assembly.mainIncidence=1;d.controls.travel=0.3;d.engine={type:'jet-01',count:1,mount:'above',x:-0.4,y:0.5,z:0};d.fuelTank={x:0.25,y:-0.1,capacity:4};return d;}}
].map(p=>({...p.change(clone(defaultAircraft)),name:p.name}));
