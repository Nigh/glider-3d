import data from './airfoil-data.json';

export type AirfoilId = 'dae11' | 'naca0012';
export const airfoilCatalog = {
 dae11: { name: 'DAE-11' },
 naca0012: { name: 'NACA 0012' },
} as const;
export const AIR_VISCOSITY = 1.46e-5;
const limit = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** High-Re engineering extension: retain 40% pressure drag, scale the friction
 * share with turbulent Re^-1/5. Lift/stall stay at the last source anchor. */
export const highReDragScale = (reynolds: number, anchor: number) => reynolds <= anchor ? 1 : 0.4 + 0.6 * (reynolds / anchor) ** -0.2;
const nose = data.dae11.findIndex(row => row[0] === 0);
const upper = data.dae11.slice(0, nose + 1).reverse(), lower = data.dae11.slice(nose);
function ordinate(rows: number[][], x: number) {
 let i = 0;
 while (i < rows.length - 2 && x > rows[i + 1][0]) i++;
 const a = rows[i], b = rows[i + 1];
 return a[1] + (b[1] - a[1]) * limit((x - a[0]) / (b[0] - a[0]), 0, 1);
}
/** UIUC DAE-11 coordinates, or the standard closed-TE NACA 0012 equation.
 * Shared by skin, hinges and contact geometry. Unit chord, y upward. */
export function airfoilY(id: AirfoilId, x: number, face: number): number {
 x = limit(x, 0, 1);
 if (id === 'dae11') return ordinate(face > 0 ? upper : lower, x);
 return Math.sign(face) * 5 * 0.12 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}
export function airfoilCamber(id: AirfoilId, x: number) { return (airfoilY(id, x, 1) + airfoilY(id, x, -1)) / 2; }
function shapeMeasures(id: AirfoilId) {
 let perimeter = 0, area = 0, thickness = 0;
 for (let i = 1; i <= 256; i++) {
  const a = (i - 1) / 256, b = i / 256, upA = airfoilY(id, a, 1), upB = airfoilY(id, b, 1), loA = airfoilY(id, a, -1), loB = airfoilY(id, b, -1);
  perimeter += Math.hypot(b - a, upB - upA) + Math.hypot(b - a, loB - loA);
  area += (upA - loA + upB - loB) * (b - a) / 2;
  thickness = Math.max(thickness, upA - loA, upB - loB);
 }
 return { perimeter, area, thickness };
}
export const airfoilShapes = { dae11: shapeMeasures('dae11'), naca0012: shapeMeasures('naca0012') };
/** Equivalent spar recipe: retain the DAE-11 baseline and scale its normal
 * depth with the selected section thickness. Material properties stay fixed. */
export const airfoilDepthScale = (id: AirfoilId) => airfoilShapes[id].thickness / airfoilShapes.dae11.thickness;
export const airfoilSkinScale = (id: AirfoilId) => airfoilShapes[id].perimeter / airfoilShapes.dae11.perimeter;

function sample(rows: number[][], alpha: number, out: SectionSample) {
 let i = 0;
 while (i < rows.length - 2 && alpha > rows[i + 1][0]) i++;
 const a = rows[i], b = rows[i + 1], t = limit((alpha - a[0]) / (b[0] - a[0]), 0, 1);
 out.cl = a[1] + (b[1] - a[1]) * t; out.cd = a[2] + (b[2] - a[2]) * t;
}
export interface SectionSample { cl: number; cd: number; alphaMax: number }
const sampleLow: SectionSample = { cl: 0, cd: 0, alphaMax: 0 }, sampleHigh: SectionSample = { cl: 0, cd: 0, alphaMax: 0 };
/** 200k/1M: XFOIL Ncrit9, M=0. 6M: Ladson 80-grit tripped, M=.15.
 * Re interpolation crosses transition conditions: an explicitly uncalibrated
 * engineering bridge. Symmetric negative-alpha branch is model processing. */
export function naca0012Section(alpha: number, reynolds: number, out: SectionSample): SectionSample {
 const degrees = Math.abs(alpha * 180 / Math.PI), tables = data.naca0012;
 const index = reynolds <= tables[1].re ? 0 : 1, low = tables[index], high = tables[index + 1];
 const t = limit((reynolds - low.re) / (high.re - low.re), 0, 1);
 sample(low.rows, degrees, sampleLow); sample(high.rows, degrees, sampleHigh);
 out.cl = Math.sign(alpha) * (sampleLow.cl + (sampleHigh.cl - sampleLow.cl) * t);
 out.cd = (sampleLow.cd + (sampleHigh.cd - sampleLow.cd) * t) * highReDragScale(reynolds, tables[2].re);
 // Blend to the separated-flow proxy only beyond both tables' last rows.
 // Shorter tables are endpoint-held in that uncalibrated alpha interval.
 out.alphaMax = tables[2].rows.at(-1)![0];
 return out;
}
