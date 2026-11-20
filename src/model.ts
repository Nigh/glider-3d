import { Vector3 } from 'three';
import { t } from './i18n';
import { airfoilCatalog, airfoilY, type AirfoilId } from './airfoils';
import { engineCatalog, type EngineType } from './engines';
import { defaultStructures, materialCatalog, type BeamStructure, type MaterialId } from './materials';
import birdmanGlider from './aircraft/鸟人间滑翔基础型.json';
import performanceGlider from './aircraft/高性能滑翔型.json';
import twinJet from './aircraft/基础双发型.json';
import singleJet from './aircraft/基础单发型.json';

export type Point = { x: number; y: number };
// Body coordinates: +X forward, +Y up, +Z right. Distances metres, angles degrees.
// Planform points: root leading, tip leading, tip trailing, root trailing; x aft, y outboard.
export interface Wing { points: [Point, Point, Point, Point]; airfoil?: AirfoilId; rootReference?: number; mirrored?: boolean; cant?: number; lateralOffset?: number; dihedral: number; controlSurface: number; controlAxes?: { roll: boolean; pitch: boolean; yaw: boolean }; controlResponse?: number; controlReversed?: boolean; materialId: MaterialId; materialAmount: number; structure: BeamStructure }
export interface AircraftDefinition {
 name: string;
 birdman: boolean;
 fuselage: { length: number; center: number };
 cockpit: { position: number; rearLength?: number };
 mainWing: Wing; horizontalTail: Wing; verticalTail: Wing;
 auxiliaryWings?: { kind: 'horizontalTail' | 'verticalTail'; wing: Wing; position: number; incidence: number }[];
 assembly: { mainWing: number; mainWingHeight: number; horizontalTail: number; verticalTail: number; mainIncidence: number; tailIncidence: number; tailOnFin?: boolean };
 pilot: { mass: number }; controls: { travel: number; lateralTravel: number };
 engine: { type: EngineType; count: 0 | 1 | 2; x: number; y: number; lateralOffset?: number };
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
export function engineLateralOffsetLimits(d: AircraftDefinition): { min: number; max: number } {
 const radius = engineCatalog[d.engine.type].radius;
 const min = radius;
 const halfSpan = Math.max(d.mainWing.points[1].y, d.mainWing.points[2].y) * Math.cos(d.mainWing.dihedral * DEG);
 return { min, max: Math.max(min, Math.floor((halfSpan - radius) * 100 + 1e-8) / 100) };
}
export function engineLateralOffset(d: AircraftDefinition): number {
 const limits = engineLateralOffsetLimits(d);
 return clamp(d.engine.lateralOffset ?? limits.min, limits.min, limits.max);
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
 if (d.engine.lateralOffset !== undefined) d.engine.lateralOffset = engineLateralOffset(d);
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
export interface WingInstance { id: number; key: WingKey; wing: Wing; position: number; incidence: number }
export function wingInstance(d: AircraftDefinition, id: number): WingInstance {
 if (id >= 3) {
  const entry = d.auxiliaryWings![id - 3];
  return { id, key: entry.kind, wing: entry.wing, position: entry.position, incidence: entry.incidence };
 }
 const key = (['mainWing', 'horizontalTail', 'verticalTail'] as const)[id];
 return { id, key, wing: d[key], position: d.assembly[key],
  incidence: id === 0 ? d.assembly.mainIncidence : id === 1 ? d.assembly.tailIncidence : 0 };
}
export function aircraftWings(d: AircraftDefinition): WingInstance[] {
 return Array.from({ length: 3 + (d.auxiliaryWings?.length ?? 0) }, (_, id) => wingInstance(d, id));
}
export function hasMirroredFin(d: AircraftDefinition): boolean {
 return !!d.verticalTail.mirrored || !!d.auxiliaryWings?.some(entry => entry.kind === 'verticalTail' && entry.wing.mirrored);
}
export function wingInstanceWing(d: AircraftDefinition, id: number): Wing {
 return id >= 3 ? d.auxiliaryWings![id - 3].wing : id === 0 ? d.mainWing : id === 1 ? d.horizontalTail : d.verticalTail;
}
export function wingInstanceAirfoil(d: AircraftDefinition, id: number): AirfoilId {
 return d.birdman ? 'dae11' : wingInstanceWing(d, id).airfoil ?? 'dae11';
}
/** Vertical normals and span axes mirror together; positive cant points outboard. */
export function wingInstanceDirection<T extends { x: number; y: number; z: number }>(d: AircraftDefinition, id: number, side: number, x: number, normal: number, span: number, out: T): T {
 const w = wingInstanceWing(d, id), vertical = id === 2 || (id >= 3 && d.auxiliaryWings![id - 3].kind === 'verticalTail');
 const incidence = (id >= 3 ? d.auxiliaryWings![id - 3].incidence : id === 0 ? d.assembly.mainIncidence : id === 1 ? d.assembly.tailIncidence : 0) * DEG;
 if (!vertical) return wingLocalPoint(w, incidence, side, x, normal, span, out);
 const angle = (w.mirrored ? w.cant ?? 0 : 0) * DEG, c = Math.cos(angle), s = Math.sin(angle), direction = Math.sign(w.points[1].y);
 const chord = x * Math.cos(incidence) - normal * Math.sin(incidence), thickness = x * Math.sin(incidence) + normal * Math.cos(incidence);
 out.x = chord; out.y = direction * (span * c - thickness * s); out.z = side * (span * s + thickness * c);
 return out;
}
export function wingInstancePoint<T extends { x: number; y: number; z: number }>(d: AircraftDefinition, id: number, side: number, span: number, u: number, normal: number, out: T): T {
 if (id === 2) return finPoint(d, span, u, normal, out, d.assembly.tailIncidence, side);
 const w = wingInstanceWing(d, id), entry = id >= 3 ? d.auxiliaryWings![id - 3] : undefined;
 const vertical = entry?.kind === 'verticalTail', incidence = entry?.incidence ?? (id === 0 ? d.assembly.mainIncidence : d.assembly.tailIncidence);
 const fraction = span / Math.abs(w.points[1].y), leading = w.points[0].x + (w.points[1].x - w.points[0].x) * fraction;
 const chord = w.points[3].x - w.points[0].x + (w.points[2].x - w.points[1].x - w.points[3].x + w.points[0].x) * fraction;
 const middle = w.rootReference ?? (w.points[0].x + w.points[3].x) / 2;
 // Intersect both root profiles with the symmetry plane, tapering the miter
 // correction to zero at the tip. The mean surface and spar stay unchanged.
 const pointSpan = vertical ? span : span + normal * Math.tan(w.dihedral * DEG) * (1 - fraction);
 wingInstanceDirection(d, id, side, vertical ? middle - leading - u * chord : -leading - u * chord, normal, pointSpan, out);
 if (vertical) {
  out.x += entry!.position; out.z += side * (w.mirrored ? w.lateralOffset ?? 0 : 0);
  if (w.mirrored && (w.cant ?? 0) > 0 && incidence === 0) out.z = side * Math.max(0, side * out.z);
 } else if (id >= 3) {
  out.x += entry!.position + middle * Math.cos(incidence * DEG); out.y += middle * Math.sin(incidence * DEG);
 } else {
  out.x += id === 0 ? d.assembly.mainWing : d.assembly.tailOnFin ? d.assembly.verticalTail + (d.verticalTail.rootReference ?? (d.verticalTail.points[0].x + d.verticalTail.points[3].x) / 2) : d.assembly.horizontalTail + middle * Math.cos(incidence * DEG);
  out.y += id === 0 ? d.assembly.mainWingHeight : d.assembly.tailOnFin ? d.verticalTail.points[1].y : 0;
  if (id === 0 || !d.assembly.tailOnFin) out.y += middle * Math.sin(incidence * DEG);
 }
 return out;
}
/** Reject mirrored solid overlap, including inward cant and finite airfoil thickness. */
export function validateFinPair(w: Wing, incidence = 0): void {
 if (!w.mirrored) return;
 if (!(w.lateralOffset ?? 0) && (w.cant ?? 0) > 0 && incidence === 0) return;
 if ((w.lateralOffset ?? 0) + 1e-9 < finPairMinimumOffset(w, incidence) || (!(w.lateralOffset ?? 0) && !(w.cant ?? 0))) throw Error('镜像垂直辅助翼不得相交');
}
export function finPairMinimumOffset(w: Wing, incidence = 0): number {
 if ((w.cant ?? 0) > 0 && incidence === 0) return 0;
 const cant = (w.cant ?? 0) * DEG, angle = incidence * DEG, half = Math.abs(w.points[1].y);
 let minimum = 0;
 for (const span of [0, half]) {
  const f = span / half, leading = w.points[0].x + (w.points[1].x - w.points[0].x) * f;
  const chord = w.points[3].x - w.points[0].x + (w.points[2].x - w.points[1].x - w.points[3].x + w.points[0].x) * f;
  const middle = w.rootReference ?? (w.points[0].x + w.points[3].x) / 2;
  // The thickness profile is concave. Its tilted lower envelope has one minimum.
  let low = 0, high = 1;
  for (let i = 0; i < 55; i++) {
   const u = (low + high) / 2;
   const derivative = 5 * 0.105 * (0.2969 / (2 * Math.sqrt(u)) - 0.126 - 0.7032 * u + 0.8529 * u ** 2 - 0.4144 * u ** 3);
   if (-Math.sin(angle) - derivative * Math.cos(angle) < 0) low = u; else high = u;
  }
  const u = (low + high) / 2, local = (middle - leading - u * chord) * Math.sin(angle) - finThickness(u) * chord * Math.cos(angle);
  minimum = Math.max(minimum, -span * Math.sin(cant) - local * Math.cos(cant));
 }
 return minimum;
}
export function finThickness(u: number): number {
 return 5 * 0.105 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4);
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
   d.assembly.horizontalTail = wingOrigin(d, 'verticalTail').x - (d.verticalTail.points[1].x + d.verticalTail.points[2].x) / 2;
   continue;
  }
  const mount = wingMountLimits(d, key);
  if (mount.min > mount.max) throw Error(key === 'mainWing' ? '主翼翼根无法安装到当前机身，请调整机身或翼根' : '尾翼翼根无法安装到当前机身');
  d.assembly[key] = clamp(d.assembly[key], mount.min, mount.max);
 }
 for (const entry of d.auxiliaryWings ?? []) {
  const w = entry.wing, middle = w.rootReference ?? (w.points[0].x + w.points[3].x) / 2, c = Math.cos(entry.incidence * DEG), ends = fuselageEnds(d);
  const min = ends.tail + (w.points[3].x - middle) * c, max = ends.nose + (w.points[0].x - middle) * c;
  if (min > max) throw Error('机身必须支撑辅助翼安装点');
  entry.position = clamp(entry.position, min, max);
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
export function wingAirfoil(d: AircraftDefinition, key: WingKey): AirfoilId { return d.birdman ? 'dae11' : d[key].airfoil ?? 'dae11'; }
/** Only the last fin strip forms the crown. Its cap follows the mounted tail's
 * upper section, including incidence/camber; root and planform edits stay put.
 * Shared by render skin, contacts, aerodynamic points and beam references. */
export function finPoint<T extends { x: number; y: number; z: number }>(d: AircraftDefinition, span: number, u: number, normal: number, out: T, incidence = d.assembly.tailIncidence, side = 1): T {
 const w = d.verticalTail, half = Math.abs(w.points[1].y), t = span / half;
 const originX = d.assembly.verticalTail + (w.rootReference ?? (w.points[0].x + w.points[3].x) / 2);
 const lead = w.points[0].x + (w.points[1].x - w.points[0].x) * t;
 const rootChord = w.points[3].x - w.points[0].x, tipChord = w.points[2].x - w.points[1].x;
 out.x = originX - lead - u * (rootChord + (tipChord - rootChord) * t);
 out.y = Math.sign(w.points[1].y) * span; out.z = normal;
 if (d.assembly.tailOnFin && span > Math.max(0, half - 0.8)) {
  const crown = clamp((span - Math.max(0, half - 0.8)) / Math.min(0.8, half), 0, 1), angle = incidence * DEG;
  const tail = d.horizontalTail, tailHalf = Math.abs(tail.points[1].y), dihedral = tail.dihedral * DEG;
  const cd = Math.cos(dihedral), sd = Math.sin(dihedral);
  const tailRoot = tail.points[3].x - tail.points[0].x, tailTip = tail.points[2].x - tail.points[1].x;
  const profile = airfoilY(wingAirfoil(d, 'horizontalTail'), u, 1), y0 = profile * tailRoot;
  const ySlope = profile * (tailTip - tailRoot) / tailHalf;
  // Intersect the upper-section envelope with this fin thickness coordinate.
  // At negative dihedral the envelope bridges the two upper root edges.
  // Degenerate folded upper envelopes use a bounded end-section bridge.
  const tailSpan = clamp((Math.abs(normal) + y0 * sd) / Math.max(1e-6, cd - ySlope * sd), -tailHalf, tailHalf);
  const x = -tail.points[0].x - (tail.points[1].x - tail.points[0].x) * tailSpan / tailHalf
   - u * (tailRoot + (tailTip - tailRoot) * tailSpan / tailHalf);
  const y = (y0 + ySlope * tailSpan) * cd + tailSpan * sd;
  const baseX = -w.points[1].x - u * tipChord;
  const weight = crown * crown * (3 - 2 * crown);
  out.x += weight * (x * Math.cos(angle) - y * Math.sin(angle) - baseX);
  out.y += weight * (x * Math.sin(angle) + y * Math.cos(angle));
 }
 const angle = (w.mirrored ? w.cant ?? 0 : 0) * DEG, c = Math.cos(angle), s = Math.sin(angle), direction = Math.sign(w.points[1].y);
 const height = out.y * direction;
 out.y = direction * (height * c - normal * s);
 out.z = side * ((w.mirrored ? w.lateralOffset ?? 0 : 0) + height * s + normal * c);
 if (w.mirrored && (w.cant ?? 0) > 0) out.z = side * Math.max(0, side * out.z);
 return out;
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
type GeometryPoint = { x: number; y: number; z: number };
export interface WingSupport {
 wingInstance: number; side: number; points: GeometryPoint[]; indices: number[]; vertexWeights: number[];
 area: number; mass: number; center: GeometryPoint;
 inertia: { ix: number; iy: number; iz: number; ixy: number; ixz: number; iyz: number };
}
export function fuselageBeamRadius(d: AircraftDefinition, x: number): number {
 const { nose, tail } = fuselageEnds(d);
 return 0.05 + (BODY_GEOMETRY.beamRadius - 0.05) * clamp((x - tail) / (nose - tail), 0, 1);
}
/** Closed fairing loft. The inner profile uses the local beam diameter; the
 * outer section tapers to at most 6 cm and sits inside the mounted fin root. */
export function wingSupports(d: AircraftDefinition): WingSupport[] {
 const supports: WingSupport[] = [], rings = 12, profile = 32;
 const peak=Math.max(...Array.from({length:17},(_,j)=>finThickness((1-Math.cos(j/16*Math.PI))/2)));
 for (const { id, key, wing } of aircraftWings(d)) {
  if (key !== 'verticalTail' || !wing.mirrored || !(wing.lateralOffset ?? 0)) continue;
  const chord = wing.points[3].x - wing.points[0].x;
  const attachment=wingInstancePoint(d,id,1,0,0.5,0,new Vector3());
  if(Math.hypot(attachment.y,attachment.z)<=fuselageBeamRadius(d,attachment.x))continue;
  for (const side of [-1, 1]) {
   const points: GeometryPoint[] = [], indices: number[] = [], vertexWeights: number[] = [];
   const rootNormal = wingInstanceDirection(d,id,side,0,1,0,new Vector3());
   const rootSpan = wingInstanceDirection(d,id,side,0,0,1,new Vector3());
   const distance = wing.lateralOffset!, bend = Math.min(0.3, distance);
   for (let ring=0;ring<=rings;ring++) {
    const t=ring/rings, weight=t*t*(3-2*t), t2=t*t, t3=t2*t;
    const dy=(3*t2-2*t)*rootSpan.y*bend;
    const dz=(-6*t2+6*t)*side*distance+(3*t2-4*t+1)*side*distance*2+(3*t2-2*t)*rootSpan.z*bend;
    const length=Math.hypot(dy,dz), ny=side*dz/length, nz=-side*dy/length;
    for (let k=0;k<profile;k++) {
     const face=k<=16?1:-1, j=k<=16?k:32-k, u=(1-Math.cos(j/16*Math.PI))/2;
     const center=wingInstancePoint(d,id,side,0,u,0,new Vector3());
     const beam=fuselageBeamRadius(d,center.x),shape=finThickness(u)/peak;
     const inner=shape*beam,thickness=Math.min(finThickness(u)*chord,shape*0.03,inner);
     const depth=inner+(thickness-inner)*weight;
     // Hermite centerline approaches the fin along its span, not through its skin.
     const y=(3*t2-2*t3)*center.y+(t3-t2)*rootSpan.y*bend;
     const z=(3*t2-2*t3)*center.z+(t3-2*t2+t)*side*distance*2+(t3-t2)*rootSpan.z*bend;
     const orientation=-Math.sign(wing.points[1].y);
     const nx=rootNormal.x*weight*orientation;
     const normal=new Vector3(nx,ny,nz).normalize();
     if (ring===rings) {
      wingInstancePoint(d,id,side,0,u,face*orientation*thickness,center);
      points.push({x:center.x,y:center.y,z:center.z});
     } else points.push({x:center.x+face*depth*normal.x,y:y+face*depth*normal.y,z:z+face*depth*normal.z});
     vertexWeights.push(weight);
    }
   }
   for (let ring=0;ring<rings;ring++) for(let k=0;k<profile;k++){
    const a=ring*profile+k,b=ring*profile+(k+1)%profile;
    indices.push(a,b,a+profile,b,b+profile,a+profile);
   }
   for(let k=1;k<profile-1;k++)indices.push(0,k+1,k,rings*profile,rings*profile+k,rings*profile+k+1);
   // Exact tetrahedral volume moments of the same closed mesh used by contacts.
   let volume=0,area=0;
   const first=new Vector3(),second=new Vector3(),cross=new Vector3(),moment=new Vector3(),products=new Float64Array(9);
   for(let i=0;i<indices.length;i+=3){
    const a=points[indices[i]],b=points[indices[i+1]],c=points[indices[i+2]];
    cross.crossVectors(first.set(b.x-a.x,b.y-a.y,b.z-a.z),second.set(c.x-a.x,c.y-a.y,c.z-a.z));
    area+=cross.length()/2;
    const v=(a.x*(b.y*c.z-b.z*c.y)+a.y*(b.z*c.x-b.x*c.z)+a.z*(b.x*c.y-b.y*c.x))/6;
    volume+=v;moment.x+=v*(a.x+b.x+c.x)/4;moment.y+=v*(a.y+b.y+c.y)/4;moment.z+=v*(a.z+b.z+c.z)/4;
    const vertices=[a,b,c],axes=['x','y','z'] as const;
    for(let row=0;row<3;row++)for(let col=0;col<3;col++){
     let value=0;
     for(let j=0;j<3;j++)for(let k=0;k<3;k++)value+=vertices[j][axes[row]]*vertices[k][axes[col]]*(j===k?2:1);
     products[row*3+col]+=v*value/20;
    }
   }
   const sign=Math.sign(volume),density=SUPPORT_AREAL_DENSITY/0.06,mass=Math.abs(volume)*density;
   if(sign<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
   const center=moment.multiplyScalar(1/volume),axes=[center.x,center.y,center.z];
   for(let row=0;row<3;row++)for(let col=0;col<3;col++)products[row*3+col]=products[row*3+col]*sign*density-mass*axes[row]*axes[col];
   supports.push({wingInstance:id,side,points,indices,vertexWeights,area:area/2,mass,center,
    inertia:{ix:products[4]+products[8],iy:products[0]+products[8],iz:products[0]+products[4],ixy:-products[1],ixz:-products[2],iyz:-products[5]}});
  }
 }
 return supports;
}

export const WING_CONTROL_LIMIT = { horizontal: 22 * DEG, vertical: 15 * DEG } as const;
export interface ControlSurfaceRegion { wingInstance: number; side: number; spanStart: number; spanEnd: number; movable: boolean }
export function wingControlHinge<T extends GeometryPoint>(d:AircraftDefinition,id:number,side:number,span:number,out:T):T {
 const {key,wing:w}=wingInstance(d,id),vertical=key==='verticalTail',half=Math.abs(w.points[1].y),f=span/half;
 const chord=w.points[3].x-w.points[0].x+(w.points[2].x-w.points[1].x-w.points[3].x+w.points[0].x)*f;
 const leading=w.points[0].x+(w.points[1].x-w.points[0].x)*f,hinge=1-w.controlSurface;
 const u=vertical&&w.controlSurface===1?(w.points[0].x+(w.points[3].x-w.points[0].x)/4-leading)/chord:hinge;
 const normal=vertical?0:chord*(airfoilY(wingInstanceAirfoil(d,id),hinge,1)+airfoilY(wingInstanceAirfoil(d,id),hinge,-1))/2;
 return wingInstancePoint(d,id,side,span,u,normal,out);
}
export function wingControlAxis<T extends GeometryPoint>(d:AircraftDefinition,id:number,side:number,out:T):T {
 const {key,wing:w}=wingInstance(d,id),hinge=1-w.controlSurface;
 const root=-w.points[0].x-hinge*(w.points[3].x-w.points[0].x),tip=-w.points[1].x-hinge*(w.points[2].x-w.points[1].x);
 wingInstanceDirection(d,id,side,key==='verticalTail'&&w.controlSurface===1?0:tip-root,0,Math.abs(w.points[1].y),out);
 const length=Math.hypot(out.x,out.y,out.z);out.x/=length;out.y/=length;out.z/=length;return out;
}

type GeometryBox = { center:Vector3; axes:Vector3[]; half:number[] };
type GeometrySweepPoint = { base:Vector3; cosine:Vector3; sine:Vector3 };
type GeometryWingCell = { id:number; side:number; box:GeometryBox; skin:Vector3[]; sweep:GeometrySweepPoint[]; axes:Vector3[]; travel:GeometryTravel };
type GeometryTravel = { cos:number; sin:number; tan:number };
type GeometrySupportCell = { box:GeometryBox; points:GeometryPoint[] };

function extendSweepRange(point:GeometrySweepPoint,axis:Vector3,travel:GeometryTravel,range:number[],index:number):void {
 const offset=point.base.dot(axis),cosine=point.cosine.dot(axis),sine=point.sine.dot(axis);
 const center=offset+cosine*travel.cos,edge=Math.abs(sine)*travel.sin;
 range[index]=Math.min(range[index],center-edge);
 range[index+1]=Math.max(range[index+1],center+edge);
 if(Math.abs(sine)<=Math.abs(cosine)*travel.tan){
  if(cosine>0)range[index+1]=Math.max(range[index+1],offset+Math.hypot(cosine,sine));
  if(cosine<0)range[index]=Math.min(range[index],offset-Math.hypot(cosine,sine));
 }
}

function geometrySweepRange(cell:GeometryWingCell,axis:Vector3):[number,number] {
 const range:[number,number]=[Infinity,-Infinity];
 for(const point of cell.sweep)extendSweepRange(point,axis,cell.travel,range,0);
 return range;
}

// A separating plane proves that the full swept vertex trajectories cannot meet.
// The extrema are analytic, so this does not sample or skip actuator angles.
function geometrySweepSeparated(a:GeometryWingCell,b:GeometryWingCell,movingB:boolean):boolean {
 const range=(cell:GeometryWingCell,axis:Vector3,moving:boolean):[number,number]=>{
  if(moving)return geometrySweepRange(cell,axis);
  const bounds:[number,number]=[Infinity,-Infinity];
  for(const p of cell.skin){const value=p.dot(axis);bounds[0]=Math.min(bounds[0],value);bounds[1]=Math.max(bounds[1],value);}
  return bounds;
 };
 for(const axis of [...a.axes,...b.axes]){
  const [amin,amax]=range(a,axis,true),[bmin,bmax]=range(b,axis,movingB);
  if(amax<bmin-2e-6||bmax<amin-2e-6)return true;
 }
 return false;
}
function geometrySweepSupportSeparated(cell:GeometryWingCell,support:GeometrySupportCell):boolean {
 for(const axis of [...cell.box.axes,...cell.axes]){
  let min=Infinity,max=-Infinity;
  for(const p of support.points){
   const projection=p.x*axis.x+p.y*axis.y+p.z*axis.z;
   min=Math.min(min,projection);max=Math.max(max,projection);
  }
  const [sweepMin,sweepMax]=geometrySweepRange(cell,axis);
  if(sweepMax<min-2e-6||max<sweepMin-2e-6)return true;
 }
 return false;
}
function geometryBox(points:readonly GeometryPoint[],axes:Vector3[]):GeometryBox {
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const point of points)for(let i=0;i<3;i++){
  const axis=axes[i],value=point.x*axis.x+point.y*axis.y+point.z*axis.z;
  min[i]=Math.min(min[i],value);max[i]=Math.max(max[i],value);
 }
 const center=new Vector3();for(let i=0;i<3;i++)center.addScaledVector(axes[i],(min[i]+max[i])/2);
 return {center,axes,half:min.map((value,i)=>(max[i]-value)/2)};
}
function geometryBoxesOverlap(a:GeometryBox,b:GeometryBox):boolean {
 const dx=b.center.x-a.center.x,dy=b.center.y-a.center.y,dz=b.center.z-a.center.z;
 const separates=(axis:Vector3)=>{
  const length=axis.length();if(length<1e-9)return false;
  let extent=0;for(let i=0;i<3;i++)extent+=a.half[i]*Math.abs(axis.dot(a.axes[i]))+b.half[i]*Math.abs(axis.dot(b.axes[i]));
  return Math.abs(dx*axis.x+dy*axis.y+dz*axis.z)>=extent-1e-7*length;
 };
 for(const axis of a.axes)if(separates(axis))return false;
 for(const axis of b.axes)if(separates(axis))return false;
 const cross=new Vector3();
 for(const x of a.axes)for(const y of b.axes)if(separates(cross.crossVectors(x,y)))return false;
 return true;
}
/** Scale an ellipsoid to a unit sphere. Every accepted separating plane uses
 * exact support extents, so an unfinished closest-point search stays conservative. */
function geometryBoxEllipsoidOverlap(box:GeometryBox,center:GeometryPoint,radii:GeometryPoint):boolean {
 const delta=new Vector3((box.center.x-center.x)/radii.x,(box.center.y-center.y)/radii.y,(box.center.z-center.z)/radii.z);
 const edges=box.axes.map((axis,i)=>new Vector3(axis.x/radii.x,axis.y/radii.y,axis.z/radii.z).multiplyScalar(box.half[i]));
 const coordinates=[0,0,0],nearest=delta.clone();
 for(let pass=0;pass<12;pass++){
  for(let i=0;i<3;i++){
   const edge=edges[i],length=edge.lengthSq();if(length<1e-24)continue;
   const next=clamp(coordinates[i]-nearest.dot(edge)/length,-1,1);
   nearest.addScaledVector(edge,next-coordinates[i]);coordinates[i]=next;
  }
  const length=nearest.length();
  if(nearest.dot(delta)-edges.reduce((extent,edge)=>extent+Math.abs(nearest.dot(edge)),0)>length+1e-9)return false;
 }
 return true;
}
/** Full continuous actuator travel, including two controls moving toward each
 * other. Rebuild only for design/installation changes, never in a frame loop. */
export function controlSurfaceRegions(d:AircraftDefinition):ControlSurfaceRegion[] {
 const regions:ControlSurfaceRegion[]=[],solids:GeometryWingCell[]=[],sweeps:GeometryBox[]=[];
 const worldAxes=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)];
 const wings=aircraftWings(d).map(instance=>{
  const {id,key,wing:w}=instance, hinge=1-w.controlSurface;
  const profile=[0,1,hinge];
  for(let j=1;j<16;j++)profile.push((1-Math.cos(j/16*Math.PI))/2);
  if(w.controlSurface>0&&w.controlSurface<1){
   for(let j=1;j<=12;j++)profile.push(hinge*(1-Math.cos(j/12*Math.PI))/2);
   for(let j=1;j<4;j++)profile.push(hinge+w.controlSurface*(1-Math.cos(j/4*Math.PI))/2);
  }
  const vertical=key==='verticalTail', airfoil=wingInstanceAirfoil(d,id);
  const samples=profile.sort((a,b)=>a-b).flatMap(u=>[-1,1].map(face=>({
   u,face,ordinate:vertical?face*finThickness(u):airfoilY(airfoil,u,face),
  })));
  return {...instance,hinge,samples};
 });
 const append=(id:number,side:number,start:number,end:number)=>{
  const {key,wing:w,hinge,samples}=wings[id],vertical=key==='verticalTail',half=Math.abs(w.points[1].y);
  const axis=wingControlAxis(d,id,side,new Vector3()),chord=wingInstanceDirection(d,id,side,1,0,0,new Vector3());
  chord.addScaledVector(axis,-chord.dot(axis)).normalize();
  const axes=[chord,new Vector3().crossVectors(axis,chord).normalize(),axis],limit=vertical?WING_CONTROL_LIMIT.vertical:WING_CONTROL_LIMIT.horizontal;
  const travel={cos:Math.cos(limit),sin:Math.sin(limit),tan:Math.tan(limit)};
  const skin:Vector3[]=[],moving:GeometrySweepPoint[]=[], profileNormals:Vector3[]=[];
    const bounds=[Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity];
    // Bound every render/contact vertex. Rotated triangle interiors are convex
    // combinations of these vertices, so angular extrema cover the whole mesh.
    const rows=Math.max(1,Math.ceil((end-start)/0.2));
    for(let row=0;row<=rows;row++){
     const span=start+(end-start)*row/rows;
     const f=span/half,c=w.points[3].x-w.points[0].x+(w.points[2].x-w.points[1].x-w.points[3].x+w.points[0].x)*f;
     const pivot=wingControlHinge(d,id,side,span,new Vector3());
     let previousUpper:Vector3|undefined,previousLower:Vector3|undefined;
     for(const {u,face,ordinate} of samples){
      const normal=c*ordinate;
      const point=wingInstancePoint(d,id,side,span,u,normal,new Vector3());skin.push(point);
      if(row===0){
       const previous=face>0?previousUpper:previousLower;
       if(previous){
        const n=new Vector3().subVectors(point,previous).cross(axis);
        if(n.lengthSq()>1e-16){n.normalize();if(!profileNormals.some(existing=>Math.abs(existing.dot(n))>0.99999))profileNormals.push(n);}
       }
       if(face>0)previousUpper=point;else previousLower=point;
      }
      if(w.controlSurface===0||u<hinge-1e-9)continue;
      const relative=point.clone().sub(pivot),parallel=axis.clone().multiplyScalar(relative.dot(axis));
      const cosine=relative.clone().sub(parallel),sine=new Vector3().crossVectors(axis,relative),base=pivot.clone().add(parallel);
      const swept={base,cosine,sine};
      for(let i=0;i<3;i++)extendSweepRange(swept,axes[i],travel,bounds,i*2);
      moving.push(swept);
     }
    }
    const padding=1e-6,solid=geometryBox(skin,axes);
    for(let i=0;i<3;i++)solid.half[i]+=padding;
    solids.push({id,side,box:solid,skin,sweep:moving,axes:profileNormals,travel});
    const center=new Vector3();
    const halfExtents=axes.map((direction,i)=>{
     const min=bounds[2*i],max=bounds[2*i+1];
     center.addScaledVector(direction,(min+max)/2);
     return (max-min)/2+padding;
    });
    sweeps.push(moving.length?{center,axes,half:halfExtents}:solid);
    regions.push({wingInstance:id,side,spanStart:start,spanEnd:end,movable:w.controlSurface>0});
 };
 for(const {id,key,wing:w} of wings){
  const half=Math.abs(w.points[1].y);
  for(const side of key==='verticalTail'&&!w.mirrored?[1]:[-1,1])
   for(let cell=0;cell*0.2<half-1e-10;cell++)append(id,side,cell*0.2,Math.min((cell+1)*0.2,half));
 }
 const supportCells:GeometrySupportCell[]=[];
 for(const support of wingSupports(d)){
  for(let ring=0;ring<12;ring++){
   const points=support.points.slice(ring*32,(ring+2)*32);
   supportCells.push({box:geometryBox(points,worldAxes),points});
  }
 }
 const obstacles:GeometryBox[]=[];
 const support=mainWingSupport(d);
 if(support.mass>0)obstacles.push(geometryBox([
  {x:support.frontX,y:support.frontY,z:-0.03},{x:support.backX,y:support.backY,z:0.03},
  {x:support.frontX,y:support.frontY-support.height,z:-0.03},{x:support.backX,y:support.backY-support.height,z:0.03},
 ],worldAxes));
 for(const mount of engineMounts(d)){
  const spec=engineCatalog[d.engine.type],radial=Math.hypot(mount.y,mount.z);
  obstacles.push({center:new Vector3(mount.x,mount.y,mount.z),axes:worldAxes,half:[spec.length/2,spec.radius,spec.radius]});
  if(mount.supportLength>0){
   const radialAxis=new Vector3(0,mount.y/radial,mount.z/radial),normal=new Vector3(0,-mount.z/radial,mount.y/radial);
   obstacles.push({center:new Vector3(mount.x,0,0).addScaledVector(radialAxis,mount.supportLength/2),
    axes:[worldAxes[0],radialAxis,normal],half:[mount.supportWidth/2,mount.supportLength/2,0.03]});
  }
 }
 const {nose,tail}=fuselageEnds(d);
 for(let start=tail;start<nose-1e-10;start+=0.1){
  const end=Math.min(start+0.1,nose),radius=Math.max(fuselageBeamRadius(d,start),fuselageBeamRadius(d,end));
  obstacles.push({center:new Vector3((start+end)/2,0,0),axes:worldAxes,half:[(end-start)/2,radius,radius]});
 }
 const ellipsoids=(d.birdman?[]:[cockpitGeometry(d),BODY_GEOMETRY.canopy]).map(shape=>({
  center:{x:d.cockpit.position+shape.x,y:shape.y,z:0},radii:{x:shape.xRadius,y:shape.yRadius,z:shape.zRadius},
 }));
 const clear=(i:number)=>{
  const region=regions[i],horizontal=wings[region.wingInstance].key!=='verticalTail';
  return !(horizontal&&region.spanStart<0.02-1e-10)
   &&!obstacles.some(box=>geometryBoxesOverlap(sweeps[i],box))
   &&!supportCells.some(support=>geometryBoxesOverlap(sweeps[i],support.box)&&!geometrySweepSupportSeparated(solids[i],support))
   &&!ellipsoids.some(shape=>geometryBoxEllipsoidOverlap(sweeps[i],shape.center,shape.radii))
   &&!solids.some((other,j)=>!(other.id===region.wingInstance&&other.side===region.side)
    &&((geometryBoxesOverlap(sweeps[i],other.box)&&!geometrySweepSeparated(solids[i],other,false))
     ||(other.sweep.length>0&&geometryBoxesOverlap(sweeps[i],sweeps[j])&&!geometrySweepSeparated(solids[i],other,true))));
 };
 const risky=regions.map((region,i)=>region.movable&&!clear(i));
 const coarseRegions=regions.slice(),coarseSolids=solids.slice(),coarseSweeps=sweeps.slice();
 regions.length=solids.length=sweeps.length=0;
 for(let i=0;i<coarseRegions.length;i++){
  const region=coarseRegions[i];
  if(risky[i]){
   for(let cell=0;region.spanStart+cell*0.02<region.spanEnd-1e-10;cell++)
    append(region.wingInstance,region.side,region.spanStart+cell*0.02,Math.min(region.spanStart+(cell+1)*0.02,region.spanEnd));
  }else{
   regions.push(region);solids.push(coarseSolids[i]);sweeps.push(coarseSweeps[i]);
  }
 }
 const movable=regions.map((region,i)=>region.movable&&clear(i));
 for(let i=0;i<regions.length;i++)regions[i].movable=movable[i];
 // Keep existing structural joints; split only where actuator clearance changes.
 const merged:ControlSurfaceRegion[]=[];
 for(const region of regions){
  const previous=merged[merged.length-1];
  if(previous&&previous.wingInstance===region.wingInstance&&previous.side===region.side
   &&previous.movable===region.movable
   &&Math.floor((previous.spanStart+1e-8)/0.8)===Math.floor((region.spanStart+1e-8)/0.8)){
   previous.spanEnd=region.spanEnd;
  }else merged.push({...region});
 }
 return merged;
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
 for (const { id } of aircraftWings(d).slice(3)) {
  const front=wingInstancePoint(d,id,1,0,0,0,{x:0,y:0,z:0}),back=wingInstancePoint(d,id,1,0,1,0,{x:0,y:0,z:0});
  occupied.push(front.x,back.x);
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
normalizePropulsion(defaultAircraft);
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
 if (d.engine.lateralOffset !== undefined) finite(d.engine.lateralOffset,0,12);
 if (oldTank?.y !== undefined) finite(oldTank.y,-1,1);
 finite(d.fuelTank?.x,-12,12);finite(d.fuelTank?.capacity,0,40);
 d.engine = { type: d.engine.type, count: d.engine.count, x: d.engine.x, y: d.engine.y, ...(d.engine.lateralOffset === undefined ? {} : { lateralOffset: d.engine.lateralOffset }) };
 d.fuelTank = { x: d.fuelTank.x, capacity: d.fuelTank.capacity };
 if(d.birdman&&d.engine.count!==0)throw Error('鸟人间设计不能安装动力发动机');
 // Normalize existing saved designs at the trust boundary; flight mass is fixed.
 if (d.fuselage.center === undefined) d.fuselage.center = 0;
 finite(d.fuselage.center,-12,12);
 d.pilot.mass = PILOT_MASS;
 if (d.auxiliaryWings !== undefined && !Array.isArray(d.auxiliaryWings)) throw Error('辅助翼数据必须是数组');
 for (const entry of d.auxiliaryWings ?? []) {
  if (!entry || !['horizontalTail', 'verticalTail'].includes(entry.kind)) throw Error('未知辅助翼类型');
  finite(entry.position,-24,24); finite(entry.incidence,-12,12);
 }
 for(const instance of aircraftWings(d)){const {key,id}=instance,w=instance.wing;if(!w||!Array.isArray(w.points)||w.points.length!==4)throw Error('翼面必须有四个顶点');for(const p of w.points){finite(p?.x,-3,6);finite(p?.y,key==='verticalTail'?-0.5:0,12);} finite(w.dihedral,-25,25);
 if (w.mirrored !== undefined && typeof w.mirrored !== 'boolean') throw Error('镜像开关必须是布尔值');
 if (w.cant !== undefined) finite(w.cant,-45,45);
 if (w.lateralOffset !== undefined) finite(w.lateralOffset,0,1);
 if (key !== 'verticalTail' && (w.mirrored || w.cant || w.lateralOffset)) throw Error('仅垂直辅助翼支持镜像、偏转与横向偏移');
 if(w.controlSurface===undefined)w.controlSurface=d.birdman&&key!=='verticalTail'?0:0.3;
 finite(w.controlSurface,0,1);
 if(w.controlAxes===undefined)w.controlAxes={roll:key!=='verticalTail',pitch:key!=='verticalTail',yaw:key==='verticalTail'};
 if(!w.controlAxes||typeof w.controlAxes!=='object'||['roll','pitch','yaw'].some(axis=>typeof w.controlAxes![axis as keyof NonNullable<Wing['controlAxes']>]!=='boolean'))throw Error('舵面控制轴必须是布尔值');
 w.controlAxes={roll:w.controlAxes.roll,pitch:w.controlAxes.pitch,yaw:w.controlAxes.yaw};
 if(w.controlResponse===undefined)w.controlResponse=1;
 finite(w.controlResponse,0,1);
 if(w.controlReversed===undefined)w.controlReversed=false;
 if(typeof w.controlReversed!=='boolean')throw Error('舵面反向开关必须是布尔值');
 if(w.rootReference!==undefined)finite(w.rootReference,-3,6);
 if(w.airfoil!==undefined&&(typeof w.airfoil!=='string'||!Object.hasOwn(airfoilCatalog,w.airfoil)))throw Error('未知翼型');
 if(key==='verticalTail'&&w.airfoil!==undefined)throw Error('垂尾不支持选择翼型');
 if(d.birdman&&key!=='verticalTail'&&w.airfoil!==undefined)w.airfoil='dae11';
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
 const checked:Wing={points:w.points.map(p=>({x:p.x,y:p.y})) as Wing['points'],...(w.airfoil===undefined?{}:{airfoil:w.airfoil}),...(w.rootReference===undefined?{}:{rootReference:w.rootReference}),...(w.mirrored===undefined?{}:{mirrored:w.mirrored}),...(w.cant===undefined?{}:{cant:w.cant}),...(w.lateralOffset===undefined?{}:{lateralOffset:w.lateralOffset}),dihedral:w.dihedral,controlSurface:w.controlSurface,controlAxes:w.controlAxes,controlResponse:w.controlResponse,controlReversed:w.controlReversed,materialId:w.materialId,materialAmount:w.materialAmount,structure:w.structure};
 if (id < 3) d[key] = checked; else d.auxiliaryWings![id - 3] = { kind:key as 'horizontalTail'|'verticalTail', wing:checked, position:instance.position, incidence:instance.incidence };
 if(key!=='verticalTail'&&d.birdman&&w.controlSurface!==0)throw Error('鸟人间设计只允许垂尾操纵，主翼和副翼不能安装控制面');
 const p=w.points;if(p[0].y!==0||p[3].y!==0||Math.abs(p[1].y-p[2].y)>0.001||Math.abs(p[1].y)<0.25||p[3].x-p[0].x<0.15||p[2].x-p[1].x<0.15)throw Error('翼面不得自交，根弦与梢弦至少 0.15 m');
 if (key === 'verticalTail') validateFinPair(w, instance.incidence);
 }
 for(const key of ['mainWing','horizontalTail','verticalTail'] as const)finite(d.assembly?.[key],-24,24);
 if(d.assembly.tailOnFin!==undefined&&typeof d.assembly.tailOnFin!=='boolean')throw Error('副翼垂尾安装开关必须是布尔值');
 if (hasMirroredFin(d) && d.assembly.tailOnFin) throw Error('镜像垂直辅助翼不能顶置水平辅助翼');
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
 for (const entry of d.auxiliaryWings ?? []) if (entry.position < ends.tail - epsilon || entry.position > ends.nose + epsilon) throw Error('机身必须支撑辅助翼安装点');
 if(d.engine.count>0&&(d.engine.x<ends.tail||d.engine.x>ends.nose))throw Error('机身必须支撑发动机安装点');
 normalizeAircraftGeometry(d);
 return {name:d.name,birdman:d.birdman,
  fuselage:{length:d.fuselage.length,center:d.fuselage.center},cockpit:{position:d.cockpit.position,...(d.cockpit.rearLength===undefined?{}:{rearLength:d.cockpit.rearLength})},
  mainWing:d.mainWing,horizontalTail:d.horizontalTail,verticalTail:d.verticalTail,...(d.auxiliaryWings===undefined?{}:{auxiliaryWings:d.auxiliaryWings}),
  assembly:{mainWing:d.assembly.mainWing,mainWingHeight:d.assembly.mainWingHeight,horizontalTail:d.assembly.horizontalTail,verticalTail:d.assembly.verticalTail,mainIncidence:d.assembly.mainIncidence,tailIncidence:d.assembly.tailIncidence,...(d.assembly.tailOnFin===undefined?{}:{tailOnFin:d.assembly.tailOnFin})},
  pilot:{mass:d.pilot.mass},controls:{travel:d.controls.travel,lateralTravel:d.controls.lateralTravel},engine:d.engine,fuelTank:d.fuelTank};
}
export const presets: AircraftDefinition[] = [birdmanGlider, performanceGlider, twinJet, singleJet].map(definition => {
 const d = clone(definition as AircraftDefinition);
 normalizePropulsion(d);
 return d;
});
