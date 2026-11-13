import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { AirframeExposure } from '../src/exposure';
import { BODY_GEOMETRY, clone, cockpitGeometry, presets, DEG } from '../src/model';
import { FlightSimulation } from '../src/physics';
import { DRAG_TERMS } from '../src/drag';

const normal=()=>clone(presets.find(d=>d.name==='基础单发型')!);
const neutral={weight:0,lateral:0,elevator:0,aileron:0,rudder:0,throttle:0};
const internal=(sim:FlightSimulation)=>sim as any;

it('recovers the axial union silhouette of the overlapping shell and visible canopy',()=>{
 const d=normal();d.cockpit.position=0;d.fuselage.center=100; // Isolate the two intersecting cockpit solids.
 const model=new AirframeExposure(d,[]),shell=cockpitGeometry(d),canopy=BODY_GEOMETRY.canopy;
 let pixels=0;const n=600, lowY=Math.min(shell.y-shell.yRadius,canopy.y), highY=Math.max(shell.y+shell.yRadius,canopy.y+canopy.yRadius), zMax=Math.max(shell.zRadius,canopy.zRadius);
 for(let i=0;i<n;i++)for(let j=0;j<n;j++){
  const y=lowY+(i+.5)*(highY-lowY)/n,z=-zMax+(j+.5)*2*zMax/n;
  if((y-shell.y)**2/shell.yRadius**2+z*z/shell.zRadius**2<=1||y>=canopy.y&&(y-canopy.y)**2/canopy.yRadius**2+z*z/canopy.zRadius**2<=1)pixels++;
 }
 const union=pixels*(highY-lowY)*2*zMax/n**2;
 const summed=Math.PI*(shell.yRadius*shell.zRadius+canopy.yRadius*canopy.zRadius/2);
 for(const sign of [-1,1]){
  const v=new Vector3(sign,0,0), projected=model.pressureSpeed(0,v)+model.pressureSpeed(1,v);
  expect(Math.abs(projected/union-1)).toBeLessThan(.025);
  expect(projected).toBeLessThan(summed*.95);
 }
});

it('removes only buried wing faces and follows deformation, detachment and restoration',()=>{
 const d=normal();d.assembly.mainWingHeight=0;d.cockpit.position=d.assembly.mainWing-.6;
 const sim=new FlightSimulation(d,'test-space',0), summary=internal(sim).aerodynamics;
 summary.updateExposure();
 const root=sim.surfaces.find(s=>s.kind==='main'&&s.side===1&&s.spanStart===0)!;
 const tip=sim.surfaces.filter(s=>s.kind==='main'&&s.side===1).at(-1)!;
 const covered=root.exposedFraction;
 expect(covered).toBeGreaterThan(0);expect(covered).toBeLessThan(.95);expect(tip.exposedFraction).toBe(1);
 const original=root.point.clone();root.point.y+=3;summary.updateExposure();expect(root.exposedFraction).toBe(1);
 root.point.copy(original);summary.updateExposure();expect(root.exposedFraction).toBe(covered);
 root.bodyId=1;summary.updateExposure();expect(root.exposedFraction).toBe(1);
 root.bodyId=0;summary.updateExposure();expect(root.exposedFraction).toBe(covered);
 sim.reset(0);summary.updateExposure();expect(root.exposedFraction).toBe(covered);
});

it('reduces the fuselage proxy only where its physical exterior is buried',()=>{
 const d=normal(), far=clone(d);far.cockpit.position=100;
 const a=new AirframeExposure(d,[]),b=new AirframeExposure(far,[]),side=new Vector3(0,0,1);
 expect(a.fuselageFraction(side)).toBeGreaterThan(0);
 expect(a.fuselageFraction(side)).toBeLessThan(b.fuselageFraction(side));
 expect(b.fuselageFraction(side)).toBeCloseTo(1,12);
});

it('keeps live forces, moments, signed drag terms and dissipated power closed under overlap and rotation',()=>{
 const sim=new FlightSimulation(normal(),'test-space',0),s=internal(sim);
 s.seaLevelReference=true;sim.launching=false;sim.position.set(100,1000,0);
 for(const pitch of [-35,0,5,90,180])for(const velocity of [new Vector3(31,-2,4),new Vector3(0,0,12),new Vector3()]){
  sim.quaternion.setFromAxisAngle(new Vector3(0,0,1),pitch*DEG);sim.omega.set(.03,-.04,.02);
  s.evaluateForces(neutral,velocity,sim.omega,sim.quaternion,sim.position,neutral);
  s.aerodynamics.update(sim.cg,sim.quaternion,velocity,sim.telemetry.torque,sim.omega);
  const a=sim.telemetry.aerodynamics,sum=new Vector3();
  for(const key of DRAG_TERMS)sum.add(a.dragTerms[key]);
  expect(sum.distanceTo(a.drag)).toBeLessThan(1e-8);
  expect(a.drag.clone().applyQuaternion(sim.quaternion).distanceTo(sim.telemetry.drag)).toBeLessThan(1e-8);
  expect(sim.telemetry.aeroPower).toBeLessThanOrEqual(1e-9);
  expect(Object.values(a.dragTerms).every(v=>v.toArray().every(Number.isFinite))).toBe(true);
 }
});

it('recomputes exposure after live incidence changes and restoring the intact aircraft',()=>{
 const sim=new FlightSimulation(normal(),'wind-tunnel',0),s=internal(sim);
 sim.setWindTunnel({...sim.windTunnel,speed:12,mainIncidence:12});sim.setWindTunnelEnabled(true);
 for(let i=0;i<40;i++)sim.step(neutral);
 const before=sim.surfaces.map(surface=>surface.exposedFraction);
 sim.setWindTunnel({...sim.windTunnel,speed:12,mainIncidence:-10});
 for(let i=0;i<40;i++)sim.step(neutral);
 expect(sim.surfaces.map(surface=>surface.exposedFraction)).not.toEqual(before);
 sim.restoreWindTunnelAircraft();s.aerodynamics.updateExposure();
 expect(sim.surfaces.every(surface=>surface.exposedFraction>=0&&surface.exposedFraction<=1)).toBe(true);
 expect(sim.surfaces.some(surface=>surface.exposedFraction<1)).toBe(true);
});

it('rebuilds the derived exposure cache for independent physics checkpoints',()=>{
 const sim=new FlightSimulation(normal(),'low-altitude',0);
 for(let i=0;i<20;i++)sim.step(neutral);
 const copy=sim.checkpoint();
 for(let i=0;i<10;i++){sim.step(neutral);copy.step(neutral);}
 expect(copy.position.toArray()).toEqual(sim.position.toArray());
 expect(copy.telemetry.force.toArray()).toEqual(sim.telemetry.force.toArray());
 expect(copy.telemetry.torque.toArray()).toEqual(sim.telemetry.torque.toArray());
 expect(copy.surfaces.map(surface=>surface.exposedFraction)).toEqual(sim.surfaces.map(surface=>surface.exposedFraction));
});
