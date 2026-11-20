import { BODY_GEOMETRY, cockpitGeometry, DEG, finThickness, fuselageEnds, planform, wingInstanceDirection, wingInstancePoint, wingInstanceWing, type AircraftDefinition, type BodyEllipsoid } from './model';
import { airfoilY } from './airfoils';
import type { AerodynamicSurface } from './physics';
import { Vector3 } from 'three';
import type { CompiledAircraft } from './compiled-geometry-cache';

type Patch = { x: number; y: number; z: number; nx: number; ny: number; nz: number; area: number; exposed: boolean };
type Volume = { patches: Patch[]; contains: (x: number, y: number, z: number) => boolean; bounds: number[] };
const azimuths = 48, rows = 24;
function patch(x: number, y: number, z: number, nx: number, ny: number, nz: number): Patch {
 return { x, y, z, nx, ny, nz, area: Math.hypot(nx, ny, nz), exposed: true };
}
function ellipsoid(shape: BodyEllipsoid, upperOnly = false): Volume {
 const { x, y, xRadius: a, yRadius: b, zRadius: c } = shape, patches: Patch[] = [];
 for(let i=0;i<rows;i++){
  const mu=-1+(i+.5)*2/rows, radius=Math.sqrt(1-mu*mu);
  if(upperOnly&&mu<0)continue;
  for(let j=0;j<azimuths;j++){
   const phi=(j+.5)*2*Math.PI/azimuths, nx=radius*Math.cos(phi), nz=radius*Math.sin(phi);
   const weight=4*Math.PI/rows/azimuths;
   patches.push(patch(x+a*nx,y+b*mu,c*nz,b*c*nx*weight,a*c*mu*weight,a*b*nz*weight));
  }
 }
 return { patches, bounds:[x-a,x+a,upperOnly?y:y-b,y+b,-c,c], contains:(px,py,pz)=>
  (!upperOnly||py>=y)&&(px-x)**2/a**2+(py-y)**2/b**2+pz*pz/c**2<1-1e-9 };
}
function beam(d: AircraftDefinition): Volume {
 const {nose,tail}=fuselageEnds(d), length=nose-tail, patches:Patch[]=[], slope=(BODY_GEOMETRY.beamRadius-.05)/length;
 for(let i=0;i<rows;i++)for(let j=0;j<azimuths;j++){
  const t=(i+.5)/rows, x=tail+t*length, r=.05+t*(BODY_GEOMETRY.beamRadius-.05), phi=(j+.5)*2*Math.PI/azimuths;
  const weight=r*length/rows*2*Math.PI/azimuths;
  patches.push(patch(x,r*Math.cos(phi),r*Math.sin(phi),-slope*weight,Math.cos(phi)*weight,Math.sin(phi)*weight));
 }
 for(const [x,r,sign] of [[tail,.05,-1],[nose,BODY_GEOMETRY.beamRadius,1]]){
  for(let i=0;i<8;i++)for(let j=0;j<azimuths;j++){
   const radius=r*Math.sqrt((i+.5)/8), phi=(j+.5)*2*Math.PI/azimuths;
   patches.push(patch(x,radius*Math.cos(phi),radius*Math.sin(phi),sign*Math.PI*r*r/8/azimuths,0,0));
  }
 }
 return {patches,bounds:[tail,nose,-BODY_GEOMETRY.beamRadius,BODY_GEOMETRY.beamRadius,-BODY_GEOMETRY.beamRadius,BODY_GEOMETRY.beamRadius],
  contains:(x,y,z)=>x>tail&&x<nose&&y*y+z*z<(.05+(x-tail)*slope)**2-1e-9};
}
const sectionY=(surface:AerodynamicSurface,u:number,face:number)=>surface.kind==='vertical'
 ? face*finThickness(u)
 : airfoilY(surface.airfoil,u,face);

/** Clip physical intersections, not the screen-space silhouettes of separate wings.
 * Fixed quadrature is rebuilt only when strip poses/ownership change; its cache
 * lives outside replay state and is derived again from restored geometry. */
export class AirframeExposure {
 private readonly volumes:Volume[];
 readonly bodies:Patch[][];
 private readonly baselineBeam:Patch[];
 private readonly strips;
 private readonly poses:Float64Array;
 constructor(d:AircraftDefinition, private readonly surfaces:AerodynamicSurface[], compiled?:CompiledAircraft){
  const shell=cockpitGeometry(d), canopy=BODY_GEOMETRY.canopy;
  this.volumes=d.birdman?[]:[ellipsoid({...shell,x:shell.x+d.cockpit.position}),ellipsoid({...canopy,x:canopy.x+d.cockpit.position},true)];
  const bodyCount=this.volumes.length, nose=BODY_GEOMETRY.nose;
  this.volumes.push(beam(d),ellipsoid({...nose,x:fuselageEnds(d).nose+nose.x}));
  this.baselineBeam=this.volumes.slice(bodyCount).flatMap(volume=>volume.patches.filter(p=>
   !this.volumes.slice(bodyCount).some(other=>other!==volume&&other.contains(p.x,p.y,p.z))));
  const kinds=[...(d.birdman?[]:['cockpit','canopy']),'fuselage','nose'];
  this.bodies=this.volumes.map((volume,index)=>{
   if(!compiled)return volume.patches.filter(p=>!this.volumes.some(other=>other!==volume&&other.contains(p.x,p.y,p.z)));
   const patches:Patch[]=[];
   for(const partition of compiled.partitions)if(partition.kind===kinds[index]){
    for(let triangle=0;triangle<partition.indices.length;triangle+=3){
     const a=partition.indices[triangle]*3,b=partition.indices[triangle+1]*3,c=partition.indices[triangle+2]*3,p=partition.positions;
     const ax=p[b]-p[a],ay=p[b+1]-p[a+1],az=p[b+2]-p[a+2],bx=p[c]-p[a],by=p[c+1]-p[a+1],bz=p[c+2]-p[a+2];
     const surface=patch((p[a]+p[b]+p[c])/3,(p[a+1]+p[b+1]+p[c+1])/3,(p[a+2]+p[b+2]+p[c+2])/3,
      (ay*bz-az*by)/2,(az*bx-ax*bz)/2,(ax*by-ay*bx)/2);
     if(surface.area<1e-15)continue;
     const offset=1e-5/surface.area;
     if(!this.volumes.some(other=>other!==volume&&other.contains(surface.x+surface.nx*offset,surface.y+surface.ny*offset,surface.z+surface.nz*offset)))patches.push(surface);
    }
   }
   return patches;
  });
  this.strips=surfaces.map(surface=>{
   const w=wingInstanceWing(d,surface.wingInstance), p=planform(w,surface.kind!=='vertical');
   const half=Math.abs(w.points[1].y), root=p.root+(p.tip-p.root)*surface.spanStart/half, tip=p.root+(p.tip-p.root)*surface.spanEnd/half;
   const center=surface.spanStart+(surface.spanEnd-surface.spanStart)*(root+2*tip)/(3*(root+tip));
   const slope=(p.tip-p.root)/half, quarterSlope=(w.points[1].x-w.points[0].x+(p.tip-p.root)/4)/half;
   const samples:number[]=[];
   // Local quadrature belongs to the design frame, not a checkpoint's deformed pose.
   const point=new Vector3(),origin=wingInstancePoint(d,surface.wingInstance,surface.side,center,.25,0,new Vector3());
   const chordDirection=wingInstanceDirection(d,surface.wingInstance,surface.side,1,0,0,new Vector3());
   const normal=wingInstanceDirection(d,surface.wingInstance,surface.side,0,1,0,new Vector3());
   const spanDirection=wingInstanceDirection(d,surface.wingInstance,surface.side,0,0,1,new Vector3());
   for(let i=0;i<12;i++)for(let j=0;j<24;j++){
    const span=surface.spanStart+(i+.5)*(surface.spanEnd-surface.spanStart)/12, chord=p.root+slope*span, u=(j+.5)/24;
    for(const face of [-1,1]){
     wingInstancePoint(d,surface.wingInstance,surface.side,span,u,sectionY(surface,u,face)*chord,point).sub(origin);
     samples.push(point.dot(chordDirection),point.dot(normal),point.dot(spanDirection),chord/(12*24*(root+tip)));
    }
   }
   const compiledFraction=surface.retainedAreaFraction;
   return {surface,center,slope,root:p.root,quarterSlope,samples,half,origin,normal,chordDirection,spanDirection,compiledFraction,baselineFraction:1,
    miter:surface.kind==='vertical'?0:Math.tan(w.dihedral*DEG),radius:Math.max(root,tip)+(surface.spanEnd-surface.spanStart)*(1+Math.abs(quarterSlope))};
  });
  for(const strip of this.strips)strip.baselineFraction=this.fraction(strip,true);
  this.poses=new Float64Array(surfaces.length*13).fill(NaN);
  this.update();
 }
 update(){
  let changed=false;
  for(let i=0;i<this.surfaces.length;i++){
   const s=this.surfaces[i];let index=i*13;
   for(let axis=0;axis<4;axis++){
    const v=axis===0?s.point:axis===1?s.normal:axis===2?s.chordDirection:s.spanDirection;
    if(this.poses[index]!==v.x||this.poses[index+1]!==v.y||this.poses[index+2]!==v.z)changed=true;
    this.poses[index++]=v.x;this.poses[index++]=v.y;this.poses[index++]=v.z;
   }
   if(this.poses[index]!==s.bodyId)changed=true;this.poses[index]=s.bodyId;
  }
  if(!changed)return;
  for(const strip of this.strips){
   const dynamic=this.fraction(strip,false),base=strip.baselineFraction,compiled=strip.compiledFraction;
   strip.surface.exposedFraction=compiled===undefined?dynamic:dynamic>=base?compiled:base>0?compiled*dynamic/base:compiled;
  }
  for(const patches of this.bodies)for(const p of patches){
   p.exposed=!this.strips.some(strip=>strip.surface.bodyId===0&&this.contains(strip,p.x,p.y,p.z,false));
  }
 }
 private contains(strip:AirframeExposure['strips'][number],px:number,py:number,pz:number,reference:boolean):boolean {
  const s=strip.surface,p=reference?strip.origin:s.point,n=reference?strip.normal:s.normal;
  const c=reference?strip.chordDirection:s.chordDirection,b=reference?strip.spanDirection:s.spanDirection;
  const x=px-p.x,y=py-p.y,z=pz-p.z;
  if(x*x+y*y+z*z>strip.radius**2)return false;
  const normalDistance=x*n.x+y*n.y+z*n.z,offset=x*b.x+y*b.y+z*b.z;
  const span=(strip.center+offset-normalDistance*strip.miter)/(1-normalDistance*strip.miter/strip.half);
  if(span<s.spanStart||span>s.spanEnd)return false;
  const chord=strip.root+strip.slope*span,u=.25-(x*c.x+y*c.y+z*c.z+strip.quarterSlope*(span-strip.center))/chord;
  if(u<=0||u>=1)return false;
  // Surface samples on a shared skin are not interior points within the 0.1 mm geometry budget.
  const margin=1e-4/chord,normal=normalDistance/chord;
  return normal>sectionY(s,u,-1)+margin&&normal<sectionY(s,u,1)-margin;
 }
 private fraction(strip:AirframeExposure['strips'][number],reference:boolean):number {
  const s=strip.surface,p=reference?strip.origin:s.point,n=reference?strip.normal:s.normal;
  const c=reference?strip.chordDirection:s.chordDirection,b=reference?strip.spanDirection:s.spanDirection;
  let covered=0;
  for(let i=0;i<strip.samples.length;i+=4){
   const a=strip.samples[i],normal=strip.samples[i+1],span=strip.samples[i+2];
   const x=p.x+a*c.x+normal*n.x+span*b.x,y=p.y+a*c.y+normal*n.y+span*b.y,z=p.z+a*c.z+normal*n.z+span*b.z;
   if((reference||s.bodyId===0)&&this.volumes.some(volume=>volume.contains(x,y,z))
    ||this.strips.some(other=>other.surface.wingInstance<s.wingInstance
     &&(reference||other.surface.bodyId===s.bodyId)&&this.contains(other,x,y,z,reference)))covered+=strip.samples[i+3];
  }
  return Math.max(0,Math.min(1,1-covered));
 }
 pressureSpeed(index:number,v:Vector3){
  let sum=0;for(const p of this.bodies[index])if(p.exposed)sum+=Math.max(0,p.nx*v.x+p.ny*v.y+p.nz*v.z);return sum;
 }
 skinArea(index:number){let sum=0;for(const p of this.bodies[index])if(p.exposed)sum+=p.area;return sum;}
 fuselageFraction(v:Vector3){
  let full=0,exposed=0;
  for(const p of this.baselineBeam)full+=Math.max(0,p.nx*v.x+p.ny*v.y+p.nz*v.z);
  for(let i=this.bodies.length-2;i<this.bodies.length;i++)exposed+=this.pressureSpeed(i,v);
  return full>1e-12?Math.min(1,exposed/full):1;
 }
}
