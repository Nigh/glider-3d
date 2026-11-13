import { BODY_GEOMETRY, cockpitGeometry, fuselageEnds, planform, type AircraftDefinition, type BodyEllipsoid } from './model';
import { airfoilY } from './airfoils';
import type { AerodynamicSurface } from './physics';
import type { Vector3 } from 'three';

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
 ? face*5*.105*(.2969*Math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)
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
 constructor(d:AircraftDefinition, private readonly surfaces:AerodynamicSurface[]){
  const shell=cockpitGeometry(d), canopy=BODY_GEOMETRY.canopy;
  this.volumes=d.birdman?[]:[ellipsoid({...shell,x:shell.x+d.cockpit.position}),ellipsoid({...canopy,x:canopy.x+d.cockpit.position},true)];
  const bodyCount=this.volumes.length, nose=BODY_GEOMETRY.nose;
  this.volumes.push(beam(d),ellipsoid({...nose,x:fuselageEnds(d).nose+nose.x}));
  this.baselineBeam=this.volumes.slice(bodyCount).flatMap(volume=>volume.patches.filter(p=>
   !this.volumes.slice(bodyCount).some(other=>other!==volume&&other.contains(p.x,p.y,p.z))));
  this.bodies=this.volumes.map(volume=>volume.patches.filter(p=>!this.volumes.some(other=>other!==volume&&other.contains(p.x,p.y,p.z))));
  this.strips=surfaces.map(surface=>{
   const w=d[surface.kind==='main'?'mainWing':surface.kind==='tail'?'horizontalTail':'verticalTail'], p=planform(w,surface.kind!=='vertical');
   const half=Math.abs(w.points[1].y), root=p.root+(p.tip-p.root)*surface.spanStart/half, tip=p.root+(p.tip-p.root)*surface.spanEnd/half;
   const center=surface.spanStart+(surface.spanEnd-surface.spanStart)*(root+2*tip)/(3*(root+tip));
   const slope=(p.tip-p.root)/half, quarterSlope=(w.points[1].x-w.points[0].x+(p.tip-p.root)/4)/half;
   const samples:number[]=[];
   for(let i=0;i<12;i++)for(let j=0;j<24;j++){
    const span=surface.spanStart+(i+.5)*(surface.spanEnd-surface.spanStart)/12, offset=span-center, chord=p.root+slope*span, u=(j+.5)/24;
    for(const face of [-1,1])samples.push(-quarterSlope*offset+(.25-u)*chord,sectionY(surface,u,face)*chord,offset,chord/(12*24*(root+tip)));
   }
   return {surface,center,slope,root:p.root,quarterSlope,samples,radius:Math.max(root,tip)+(surface.spanEnd-surface.spanStart)*(1+Math.abs(quarterSlope))};
  });
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
   const s=strip.surface,p=s.point,r=strip.radius;
   const candidates=s.bodyId===0?this.volumes.filter(v=>p.x+r>=v.bounds[0]&&p.x-r<=v.bounds[1]&&p.y+r>=v.bounds[2]&&p.y-r<=v.bounds[3]&&p.z+r>=v.bounds[4]&&p.z-r<=v.bounds[5]):[];
   s.exposedFraction=1;
   if(!candidates.length)continue;
   let covered=0;
   for(let i=0;i<strip.samples.length;i+=4){
    const a=strip.samples[i],b=strip.samples[i+1],c=strip.samples[i+2];
    const x=p.x+a*s.chordDirection.x+b*s.normal.x+c*s.spanDirection.x;
    const y=p.y+a*s.chordDirection.y+b*s.normal.y+c*s.spanDirection.y;
    const z=p.z+a*s.chordDirection.z+b*s.normal.z+c*s.spanDirection.z;
    if(candidates.some(v=>v.contains(x,y,z)))covered+=strip.samples[i+3];
   }
   s.exposedFraction=Math.max(0,1-covered);
  }
  for(const patches of this.bodies)for(const p of patches){
   p.exposed=!this.strips.some(strip=>{
    const s=strip.surface;if(s.bodyId!==0)return false;
    const x=p.x-s.point.x,y=p.y-s.point.y,z=p.z-s.point.z;
    if(x*x+y*y+z*z>strip.radius**2)return false;
    const offset=x*s.spanDirection.x+y*s.spanDirection.y+z*s.spanDirection.z, span=strip.center+offset;
    if(span<s.spanStart||span>s.spanEnd)return false;
    const chord=strip.root+strip.slope*span, u=.25-(x*s.chordDirection.x+y*s.chordDirection.y+z*s.chordDirection.z+strip.quarterSlope*offset)/chord;
    if(u<=0||u>=1)return false;
    const normal=(x*s.normal.x+y*s.normal.y+z*s.normal.z)/chord;
    return normal>sectionY(s,u,-1)&&normal<sectionY(s,u,1);
   });
  }
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
