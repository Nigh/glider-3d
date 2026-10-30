export type Point = { x: number; y: number };
// Body coordinates: +X forward, +Y up, +Z right. Distances metres, angles degrees.
// Planform points: root leading, tip leading, tip trailing, root trailing; x aft, y outboard.
export interface Wing { points: [Point, Point, Point, Point]; dihedral: number }
export interface AircraftDefinition {
 name: string;
 fuselage: { length: number };
 cockpit: { position: number };
 mainWing: Wing; horizontalTail: Wing; verticalTail: Wing;
 assembly: { mainWing: number; mainWingHeight: number; horizontalTail: number; verticalTail: number; mainIncidence: number; tailIncidence: number };
 pilot: { mass: number }; controls: { travel: number };
}
export interface Controls { weight: number; rudder: number; elevator: number; aileron: number }
export type FlightMode = 'standard' | 'assisted' | 'experimental';
export const clone = <T>(v:T):T => structuredClone(v);
export const clamp = (v:number,a:number,b:number) => Math.max(a,Math.min(b,v));
export const DEG = Math.PI / 180;
export const wing = (span:number,root:number,tip:number,sweep=0):Wing => ({points:[{x:0,y:0},{x:sweep,y:span/2},{x:sweep+tip,y:span/2},{x:root,y:0}],dihedral:0});
export const defaultAircraft:AircraftDefinition = {name:'湖风 01',fuselage:{length:6.5},cockpit:{position:1.2},mainWing:{...wing(14,1.5,0.8,0.25),dihedral:5},horizontalTail:wing(3.5,0.9,0.55,0.15),verticalTail:wing(3,0.9,0.4,0.3),assembly:{mainWing:0.9,mainWingHeight:0.8,horizontalTail:-2.8,verticalTail:-2.9,mainIncidence:4,tailIncidence:0},pilot:{mass:65},controls:{travel:0.45}};
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
 for(const key of ['mainWing','horizontalTail','verticalTail'] as const){const w=d[key];if(!w||!Array.isArray(w.points)||w.points.length!==4)throw Error('翼面必须有四个顶点');for(const p of w.points){finite(p.x,-3,6);finite(p.y,0,12);} finite(w.dihedral,0,25);
 const p=w.points;if(p[0].y!==0||p[3].y!==0||Math.abs(p[1].y-p[2].y)>0.001||p[1].y<0.25||p[3].x-p[0].x<0.15||p[2].x-p[1].x<0.15)throw Error('翼面不得自交，根弦与梢弦至少 0.15 m');
 }
 for(const key of ['mainWing','horizontalTail','verticalTail'] as const)finite(d.assembly?.[key],-6,5);
 finite(d.assembly?.mainWingHeight,0,2);finite(d.assembly?.mainIncidence,-10,18);finite(d.assembly?.tailIncidence,-12,12);
 return d;
}
export const presets = [
 {name:'默认均衡型',change:(d:AircraftDefinition)=>d},
 {name:'高展弦比型',change:(d:AircraftDefinition)=>{d.mainWing= {...wing(19,1.1,0.65,0.2),dihedral:5};return d;}},
 {name:'高稳定型',change:(d:AircraftDefinition)=>{d.mainWing.dihedral=12;d.horizontalTail=wing(4.5,1,0.7,0.15);d.verticalTail=wing(4,1,0.6,0.2);return d;}},
 {name:'灵敏操纵型',change:(d:AircraftDefinition)=>{d.horizontalTail=wing(2.5,0.7,0.4);d.mainWing.dihedral=2;return d;}},
 {name:'重心过后不稳定型',change:(d:AircraftDefinition)=>{d.cockpit.position=-0.8;return d;}},
 {name:'高翼载荷型',change:(d:AircraftDefinition)=>{d.mainWing={...wing(8,0.9,0.45),dihedral:5};return d;}}
].map(p=>({...p.change(clone(defaultAircraft)),name:p.name}));
