import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { airfoilY, airfoilShapes, airfoilCoverage, AIR_VISCOSITY, naca0012Section } from '../src/airfoils';
import { clone, defaultAircraft, presets, validateAircraft, normalizeAircraftGeometry, finPoint, wingOrigin, wingLocalPoint, wingAirfoil, DEG } from '../src/model';
import { FlightSimulation, coefficients } from '../src/physics';
import { defaultWindTunnel, windTunnelSettings } from '../src/laboratory';
import { exportAircraft, importAircraft } from '../src/storage';
import { exportReplay, importReplay } from '../src/replay';
import { materialCatalog } from '../src/materials';

const neutral = { weight: 0, lateral: 0, elevator: 0, aileron: 0, rudder: 0, throttle: 0 };
const normal = () => clone(presets.find(p=>p.name==='基础单发型')!);
const section = (alpha: number, re: number) => naca0012Section(alpha * DEG, re, { cl: 0, cd: 0, alphaMax: 0 });

describe('traceable selectable airfoils', () => {
 it('preserves the 80-grit Re6M measured rows, XFOIL anchors and symmetric model processing', () => {
  expect(section(10.12, 6e6).cl).toBeCloseTo(1.0707, 12);
  expect(section(10.12, 6e6).cd).toBeCloseTo(.01201, 12);
  expect(section(18.02, 6e6).cl).toBeCloseTo(.9967, 12); // actual measured stall drop
  expect(section(0, 200000).cd).toBe(.0102);
  expect(section(0, 1e6).cd).toBe(.0054);
  expect(section(-10.12, 6e6).cl).toBeCloseTo(-1.0707, 12);
  expect(section(0, 6e6).cl).toBe(0); // constructed symmetry anchor
  expect(section(4, 3.5e6).cl).toBeCloseTo((section(4, 1e6).cl + section(4, 6e6).cl)/2, 12);
  expect(section(4, 20e6)).toEqual(section(4, 6e6)); // no fictitious high-Re improvement
 });
 it('keeps Re boundaries and reverse/post-stall flow finite and continuous', () => {
  for (const alpha of [-180,-90,-35,-20,0,18.8,35,90,180]) {
   for (const re of [0,200000,1e6,6e6,20e6]) {
    const a=coefficients(alpha*DEG,8,re,true,'naca0012');
    expect(Object.values(a).every(Number.isFinite)).toBe(true); expect(a.cd).toBeGreaterThanOrEqual(0);
    const b=coefficients(alpha*DEG,8,re+1,true,'naca0012');
    expect(Math.abs(a.cd-b.cd)).toBeLessThan(1e-5); expect(Math.abs(a.cl-b.cl)).toBeLessThan(1e-5);
   }
  }
  expect(coefficients(Math.PI,8,6e6,true,'naca0012').cd).toBeCloseTo(coefficients(-Math.PI,8,6e6,true,'naca0012').cd,12);
 });
 it('uses actual profiles and changes aerodynamic moment, mass, inertia and beam properties without changing material density', () => {
  expect(airfoilY('naca0012',.3,1)).toBeCloseTo(-airfoilY('naca0012',.3,-1),12);
  expect(airfoilY('dae11',.3,1)+airfoilY('dae11',.3,-1)).toBeGreaterThan(.01);
  expect(airfoilShapes.naca0012.thickness).toBeCloseTo(.12,3);
  const d=normal(), first=new FlightSimulation(d,'wind-tunnel',0), density=materialCatalog[d.mainWing.materialId].density;
  d.mainWing.airfoil='naca0012'; const second=new FlightSimulation(d,'wind-tunnel',0);
  const a=first.structure.sections[0], b=second.structure.sections[0];
  for (const key of ['mass','bendingStiffness','lateralStiffness','torsionalStiffness','normalModulus','sectionArea'] as const) expect(b[key]).not.toBeCloseTo(a[key],8);
  expect(b.inertia.elements).not.toEqual(a.inertia.elements);
  expect(first.mass).not.toBeCloseTo(second.mass,8);
  expect(first.aircraft.wingMass.mainWing / airfoilShapes.dae11.area).not.toBeCloseTo(second.aircraft.wingMass.mainWing / airfoilShapes.naca0012.area,8);
  expect(materialCatalog[d.mainWing.materialId].density).toBe(density);
  const old=coefficients(5*DEG,8,6e6), added=coefficients(5*DEG,8,6e6,true,'naca0012');
  expect(added.cl).not.toBeCloseTo(old.cl,3); expect(added.profileCd).not.toBeCloseTo(old.profileCd,5); expect(added.cm).toBe(0); expect(old.cm).toBeLessThan(0);
  // Contact skin uses the same profile ordinates as rendering.
  const contacts=(second as any).contacts;
  const contact=contacts.find((p:any)=>p.sectionId===0&&p.span===0&&p.u>0.2&&p.u<0.4&&p.normal>0);
  const chord=d.mainWing.points[3].x-d.mainWing.points[0].x;
  expect(contact.normal).toBeCloseTo(chord*airfoilY('naca0012',contact.u,1),10);
 });
 it('roundtrips independent selections, defaults legacy designs and fixes Birdman to DAE-11', () => {
  const d=normal(); d.mainWing.airfoil='naca0012'; d.horizontalTail.airfoil='dae11';
  const loaded=importAircraft(exportAircraft(d)); expect(loaded.mainWing.airfoil).toBe('naca0012'); expect(loaded.horizontalTail.airfoil).toBe('dae11');
  expect(wingAirfoil(normal(),'mainWing')).toBe('dae11');
  (d.mainWing as any).airfoil='__proto__'; expect(()=>validateAircraft(d)).toThrow('未知翼型');
  const bird=clone(defaultAircraft); bird.mainWing.airfoil=bird.horizontalTail.airfoil='naca0012';
  const fixed=validateAircraft(bird); expect(fixed.mainWing.airfoil).toBe('dae11'); expect(fixed.horizontalTail.airfoil).toBe('dae11');
  bird.mainWing.points[2].x=bird.mainWing.points[1].x+5; expect(()=>validateAircraft(bird)).not.toThrow();
 });
 it('retains selected airfoils through recording export/import and deterministic replay', async () => {
  const d=normal();d.mainWing.airfoil='naca0012';d.horizontalTail.airfoil='dae11';
  const sim=new FlightSimulation(d,'low-altitude',0);for(let i=0;i<20;i++)sim.step({...neutral,rudder:.3});
  const source={definition:d,challenge:'low-altitude' as const,recording:sim.getRecording()};
  const loaded=await importReplay(await exportReplay(source));expect(loaded.definition.mainWing.airfoil).toBe('naca0012');
  const replay=new FlightSimulation(loaded.definition,loaded.challenge,0);replay.loadReplay(loaded.recording);
  while(!replay.replayFinished)replay.step(neutral);
  expect(replay.position.toArray()).toEqual(sim.position.toArray());expect(replay.quaternion.toArray()).toEqual(sim.quaternion.toArray());
  expect(replay.mass).toBe(sim.mass);
 });
 it('checks both narrow/wide chords and the low-speed applicability envelope', () => {
  expect(airfoilCoverage('naca0012',200000,6e6,60)).toBe(true);
  expect(airfoilCoverage('dae11',200000,6e6,60)).toBe(false);
  expect(airfoilCoverage('naca0012',199999,6e6,60)).toBe(false);
  expect(airfoilCoverage('naca0012',200000,6e6+1,60)).toBe(false);
  expect(airfoilCoverage('naca0012',200000,6e6,69)).toBe(false);
  const d=normal(); d.mainWing.airfoil='naca0012'; d.mainWing.points[2].x=d.mainWing.points[1].x+.15;
  const sim=new FlightSimulation(d,'wind-tunnel',0); sim.setWindTunnel({...defaultWindTunnel,speed:20}); sim.setWindTunnelEnabled(true);
  for(let i=0;i<45;i++)sim.step(neutral);
  const wing=sim.telemetry.aerodynamics.wings[0];
  expect(wing.reynoldsMin).toBeCloseTo(20*.15/AIR_VISCOSITY,3); expect(wing.airfoil).toBe('naca0012');
 });
});

describe('T-tail crown and Birdman wind tunnel', () => {
 it('keeps the fin crown on the upper tail profile with positive/negative incidence and a smooth blend', () => {
  const d=normal(); d.assembly.tailOnFin=true; normalizeAircraftGeometry(d);
  for(const angle of [-12,0,12])for(const foil of ['dae11','naca0012'] as const){
   d.assembly.tailIncidence=angle; d.horizontalTail.airfoil=foil;
   const span=Math.abs(d.verticalTail.points[1].y), origin=wingOrigin(d,'horizontalTail'), chord=d.verticalTail.points[2].x-d.verticalTail.points[1].x;
   for(const u of [0,.25,.5,1]){
    const top=finPoint(d,span,u,0,new Vector3()), x=-d.verticalTail.points[1].x-u*chord, y=chord*airfoilY(foil,u,1);
    expect(top.x).toBeCloseTo(origin.x+x*Math.cos(angle*DEG)-y*Math.sin(angle*DEG),10);
    expect(top.y).toBeCloseTo(origin.y+x*Math.sin(angle*DEG)+y*Math.cos(angle*DEG),10);
   }
   const boundary=span-Math.min(.8,span), before=finPoint(d,boundary-1e-6,.25,0,new Vector3()), after=finPoint(d,boundary+1e-6,.25,0,new Vector3());
   expect(before.distanceTo(after)).toBeLessThan(1e-5);
  }
 });
 it('matches the upper tail surface across fin thickness with taper and signed dihedral', () => {
  const d=normal();d.assembly.tailOnFin=true;normalizeAircraftGeometry(d);
  for(const angle of [-12,12])for(const dihedral of [-25,25])for(const foil of ['dae11','naca0012'] as const){
   d.assembly.tailIncidence=angle;d.horizontalTail.dihedral=dihedral;d.horizontalTail.airfoil=foil;
   const w=d.horizontalTail,span=.1,t=span/Math.abs(w.points[1].y),u=.3;
   const lead=w.points[0].x+(w.points[1].x-w.points[0].x)*t,root=w.points[3].x-w.points[0].x,tip=w.points[2].x-w.points[1].x;
   const chord=root+(tip-root)*t,y=chord*airfoilY(foil,u,1);
   const expected=wingLocalPoint(w,angle*DEG,1,-lead-u*chord,y,span,new Vector3()),origin=wingOrigin(d,'horizontalTail');
   expected.x+=origin.x;expected.y+=origin.y;
   const top=finPoint(d,Math.abs(d.verticalTail.points[1].y),u,expected.z,new Vector3());
   expect(top.distanceTo(expected)).toBeLessThan(1e-9);
  }
 });
 it('matches fresh structural references, mass and contact geometry after live incidence and restore', () => {
  const d=normal(); d.assembly.tailOnFin=true; normalizeAircraftGeometry(d);
  const sim=new FlightSimulation(d,'wind-tunnel',0);
  for(const angle of [12,-12]){
   sim.setWindTunnel({...defaultWindTunnel,tailIncidence:angle}); for(let i=0;i<55;i++)sim.step(neutral);
   expect(sim.definition.assembly.tailIncidence).toBe(angle);
   const fresh=new FlightSimulation(sim.definition,'wind-tunnel',0);
   for(const s of sim.structure.sections){
    const f=fresh.structure.sections[s.id]; expect(s.referenceRoot.distanceTo(f.referenceRoot)).toBeLessThan(1e-9); expect(s.referenceTip.distanceTo(f.referenceTip)).toBeLessThan(1e-9);
    expect(s.mass).toBeCloseTo(f.mass,9); expect(s.center.distanceTo(f.center)).toBeLessThan(1e-8);
    for(let i=0;i<9;i++)expect(s.inertia.elements[i]).toBeCloseTo(f.inertia.elements[i],8);
   }
   const a=(sim as any).contacts,b=(fresh as any).contacts;
   for(let i=0;i<a.length;i++)if(a[i].reference)expect(a[i].reference.distanceTo(b[i].reference)).toBeLessThan(1e-8);
   sim.restoreWindTunnelAircraft(); expect(sim.definition.assembly.tailIncidence).toBe(angle);
  }
 });
 it('freezes detached crown references while attached geometry continues to move', () => {
  const d=normal(); d.assembly.tailOnFin=true; normalizeAircraftGeometry(d); const sim=new FlightSimulation(d,'wind-tunnel',0);
  const fin=sim.structure.sections.filter(s=>s.wingKey==='verticalTail').at(-1)!;
  sim.structure.detach(fin,1); const root=fin.referenceRoot.clone(),tip=fin.referenceTip.clone(), crown=fin.crownIncidence;
  sim.setWindTunnel({...defaultWindTunnel,tailIncidence:12}); (sim as any).laboratoryState.windTunnel.tailIncidence=12; (sim as any).syncWindTunnelIncidence();
  expect(fin.referenceRoot).toEqual(root); expect(fin.referenceTip).toEqual(tip); expect(fin.crownIncidence).toBe(crown);
 });
 it('passes Birdman rudder in both directions and preserves pilot weight shifts, axes and reversal', () => {
  const torques:number[]=[];
  for(const rudder of [-1,1]){
   const d=clone(defaultAircraft),sim=new FlightSimulation(d,'wind-tunnel',0);
   sim.setWindTunnel({...defaultWindTunnel,rudder,elevator:.5,aileron:-.5}); sim.setWindTunnelEnabled(true);
   for(let i=0;i<45;i++)sim.step(neutral);
   expect(sim.telemetry.controlInputs.rudder).toBe(rudder);
   expect(sim.telemetry.controlInputs.elevator).toBe(0); expect(sim.telemetry.controlInputs.aileron).toBe(0);
   expect(sim.pilotOffset.x).toBeCloseTo(d.controls.travel*.5,8); expect(sim.pilotOffset.z).toBeCloseTo(-d.controls.lateralTravel*.5,8);
   expect(Math.abs(sim.controlDeflections.rudder)).toBeGreaterThan(.1);
   torques.push(sim.telemetry.aerodynamics.wings[2].torque.y);
  }
  expect(torques[0]*torques[1]).toBeLessThan(0);
  for(const reversed of [false,true]){
   const d=clone(defaultAircraft);d.verticalTail.controlReversed=reversed;
   const sim=new FlightSimulation(d,'wind-tunnel',0);sim.setWindTunnel({...defaultWindTunnel,rudder:1});for(let i=0;i<45;i++)sim.step(neutral);
   expect(Math.sign(sim.structure.sections.find(s=>s.wingKey==='verticalTail')!.controlDeflection)).toBe(reversed?-1:1);
  }
  const d=clone(defaultAircraft);d.verticalTail.controlAxes={roll:false,pitch:false,yaw:false};
  const sim=new FlightSimulation(d,'wind-tunnel',0);sim.setWindTunnel({...defaultWindTunnel,rudder:1});for(let i=0;i<45;i++)sim.step(neutral);
  expect(sim.structure.sections.filter(s=>s.wingKey==='verticalTail').every(s=>s.controlDeflection===0)).toBe(true);
 });
 it('clamps Birdman targets to 50m/s, including restore, while normal aircraft retain 200m/s', () => {
  expect(windTunnelSettings({...defaultWindTunnel,speed:200},true).speed).toBe(50);
  expect(windTunnelSettings({...defaultWindTunnel,speed:200}).speed).toBe(200);
  expect(()=>windTunnelSettings({...defaultWindTunnel,speed:Infinity},true)).toThrow();
  const sim=new FlightSimulation(defaultAircraft,'wind-tunnel',0);sim.setWindTunnel({...defaultWindTunnel,speed:200});sim.setWindTunnelEnabled(true);
  // High speed needn't be integrated into destructive loads to verify the controller.
  expect(sim.windTunnelTarget.speed).toBe(50);sim.restoreWindTunnelAircraft();expect(sim.windTunnelTarget.speed).toBe(50);
  const ordinary=new FlightSimulation(normal(),'wind-tunnel',0);ordinary.setWindTunnel({...defaultWindTunnel,speed:200});expect(ordinary.windTunnelTarget.speed).toBe(200);
 });
});
