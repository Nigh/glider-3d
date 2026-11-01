export interface BeamStructure {
 width: number;
 height: number;
 wallThickness: number;
}

/** SI units. These are equivalent beam properties, not a laminate failure envelope. */
export const materialCatalog = {
 spruce: {
  name: '云杉', density: 425, youngModulus: 11.03e9, shearModulus: 0.69e9,
  yieldStrength: 40e6, ultimateStrength: 70e6, compressiveStrength: 35e6, shearStrength: 6e6,
  strengthLabel: '等效弹性限 / 等效拉伸极限',
  note: '密度与顺纹 E 为参考值；G 0.69 GPa、弹性限 40 MPa、拉伸极限 70 MPa、压缩 35 MPa、剪切 6 MPa 均为工程等效值，非方向实测。',
 },
 'aluminum-6061-t6': {
  name: '6061-T6 铝', density: 2700, youngModulus: 68.9e9, shearModulus: 26e9,
  yieldStrength: 276e6, ultimateStrength: 310e6, compressiveStrength: 276e6, shearStrength: 179e6,
  strengthLabel: '屈服 / 拉伸极限',
  note: '屈服 276 MPa、拉伸极限 310 MPa；G 26 GPa、压缩 276 MPa、剪切 179 MPa 为保守工程等效值，非方向实测。',
 },
 'carbon-epoxy': {
  name: '成品碳/环氧层板', density: 1500, youngModulus: 70e9, shearModulus: 5e9,
  yieldStrength: 350e6, ultimateStrength: 600e6, compressiveStrength: 300e6, shearStrength: 60e6,
  strengthLabel: '等效弹性限 / 拉伸极限',
  note: '成品层板密度 1500 kg/m³、E 70 GPa、拉伸极限 600 MPa；G 5 GPa、弹性限 350 MPa、压缩 300 MPa、剪切 60 MPa 为保守工程等效值，非金属屈服或方向实测。',
 },
} as const;
export type MaterialId = keyof typeof materialCatalog;

export const defaultStructures = {
 mainWing: { width: 0.055, height: 0.13, wallThickness: 0.0012 },
 horizontalTail: { width: 0.025, height: 0.055, wallThickness: 0.0008 },
 verticalTail: { width: 0.025, height: 0.055, wallThickness: 0.0008 },
} satisfies Record<string, BeamStructure>;

/** Closed rectangular tube; width chordwise, height normal to the wing. */
export function beamSection({ width, height, wallThickness: t }: BeamStructure) {
 const innerWidth = width - 2 * t, innerHeight = height - 2 * t;
 const middleWidth = width - t, middleHeight = height - t;
 return {
  area: width * height - innerWidth * innerHeight,
  secondMoment: (width * height ** 3 - innerWidth * innerHeight ** 3) / 12,
  lateralSecondMoment: (height * width ** 3 - innerHeight * innerWidth ** 3) / 12,
  // ponytail: Bredt thin-wall approximation; thick-wall torsion needs a section solver.
  torsionConstant: 2 * t * middleWidth ** 2 * middleHeight ** 2 / (middleWidth + middleHeight),
 };
}
