import { Quaternion, Vector3 } from 'three';
import { AIRFRAME_MASS, BODY_GEOMETRY, clamp, DEG, engineMounts, fuelTankDimensions, fuselageEnds, mainWingSupport, PILOT_MASS, planform, validateAircraft, wingOrigin, type AircraftDefinition, type Controls, type EngineMount, type Wing } from './model';
import { CHALLENGE_RIVER, challengeCenter, challengeCheckpoints, challengeCollisionHeight, challengeDefinitions, challengeLaunch, challengeRiverCenter, challengeRiverHeight, challengeStartGate, challengeTerrainGrid, LOW_ALTITUDE, type ChallengeMode } from './challenges';
import { engineCatalog, FUEL_DENSITY } from './engines';

export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.225;
/** 官方跑道几何；10 m/s 离台速度与两秒匀加速是游戏假设，不是官方速度。 */
export const LAUNCH = { length: 10, slope: 3.5 * DEG, startX: -10 * Math.cos(3.5 * DEG), endX: 0, height: 10, speed: 10, acceleration: 5 } as const;
export function runwayHeight(x: number) { return LAUNCH.height - x * Math.tan(LAUNCH.slope); }
/** 与可见坡面共用的有限厚度刚性平台，尺寸为游戏近似。 */
export const PLATFORM = { thickness: 0.6, width: 13, slotWidth: 0.6, slotDepth: 0.305, slotFloorThickness: 0.15 } as const;
const PLATFORM_COS = Math.cos(LAUNCH.slope), PLATFORM_SIN = Math.sin(LAUNCH.slope);
const CONTACT_TOLERANCE = 2e-6;
const PLATFORM_NORMALS = [
  new Vector3(-PLATFORM_COS, PLATFORM_SIN, 0), new Vector3(PLATFORM_COS, -PLATFORM_SIN, 0),
  new Vector3(-PLATFORM_SIN, -PLATFORM_COS, 0), new Vector3(PLATFORM_SIN, PLATFORM_COS, 0),
  new Vector3(0, 0, -1), new Vector3(0, 0, 1),
];
const PLATFORM_BOXES = [
  [new Vector3(-LAUNCH.length, -PLATFORM.thickness, -PLATFORM.width / 2), new Vector3(0, 0, -PLATFORM.slotWidth / 2)],
  [new Vector3(-LAUNCH.length, -PLATFORM.thickness, PLATFORM.slotWidth / 2), new Vector3(0, 0, PLATFORM.width / 2)],
  [new Vector3(-LAUNCH.length, -PLATFORM.slotDepth - PLATFORM.slotFloorThickness, -PLATFORM.slotWidth / 2),
    new Vector3(0, -PLATFORM.slotDepth, PLATFORM.slotWidth / 2)],
];
/** 整段助跑逐渐施加的滚转扰动上限（rad）。 */
export const LAUNCH_ROLL_LIMIT = DEG;
export const SURFACE_STEP = 0.8;
const AIR_VISCOSITY = 1.46e-5;
const SPAN_EFFICIENCY = 0.9;
/** 流线整流罩/尾梁等效阻力面积，工程近似，不是Squalo分项测量。 */
const BODY_DRAG_AREA = 0.07;
/**
 * DAE-11原型，XFOIL6.96/Mach0/Ncrit9预测，非TAKUMI-11实测。
 * 每行 alpha[deg], CL500k, CD500k, CL1M, CD1M；尾翼去除升力偏置后作对称代理。
 * http://airfoiltools.com/polar/details?polar=xf-dae11-il-500000
 * http://airfoiltools.com/polar/details?polar=xf-dae11-il-1000000
 */
const SECTION_POLAR = [
  [-6, 0.0205, 0.05252, 0.0197, 0.04617],
  [-4, 0.2041, 0.02022, 0.2024, 0.01203],
  [-2, 0.4291, 0.01277, 0.4314, 0.00912],
  [0, 0.6560, 0.01023, 0.6622, 0.00773],
  [1.25, 0.7988, 0.00899, 0.8047, 0.00610],
  [3, 0.9975, 0.00938, 1.0049, 0.00648],
  [5, 1.2203, 0.00977, 1.2299, 0.00705],
  [7.25, 1.4572, 0.01073, 1.4679, 0.00851],
  [9.25, 1.6214, 0.01339, 1.6254, 0.01199],
  [12, 1.6277, 0.02998, 1.6360, 0.02851],
  [15, 1.6100, 0.06077, 1.6475, 0.05556],
  [17, 1.5913, 0.08793, 1.6548, 0.07833],
] as const;
const MAX_FRAMES = 36_000;
const FRAME_WIDTH = 7;
const ZERO_CONTROLS: Controls = { weight: 0, lateral: 0, rudder: 0, elevator: 0, aileron: 0, throttle: 0 };
const AILERON_LIMIT = 18 * DEG, ELEVATOR_LIMIT = 22 * DEG, RUDDER_LIMIT = 15 * DEG;
/** 标准化舵量每秒最多变化2.5；回中、反向与打满共用相同行程速度。 */
export const CONTROL_SURFACE_RATE = 2.5;
const CONTROL_AXES = ['aileron', 'elevator', 'rudder'] as const;

export interface AircraftProperties {
  mass: number;
  cg: Vector3;
  inertia: Vector3;
  wingArea: number;
  span: number;
  aspect: number;
  wingLoading: number;
  /** m/s；全重、海平面、无地效；主翼CL峰值使用12m/s对应局部Re。 */
  stallSpeed: number;
  /** 12m/s扫迎角的全机最大瞬时L/D，不保证配平，不等于二维翼型Cl/Cd。 */
  glideRatio: number;
  staticMargin: number;
  /** 主翼平均气动弦 1/4 弦几何参考点，独立于全机合力中心。 */
  mainQuarterChord: Vector3;
  neutralPoint: number;
  /** 自由空气、无地效：12 m/s、5°攻角、3°侧滑，零角速度、零操纵。 */
  aerodynamics: AerodynamicReference;
}
interface MassPart { mass: number; x: number; y: number; z: number; ix: number; iy: number; iz: number; moving?: boolean; fuel?: boolean }
interface Polar { cl: number; cd: number; inducedCd: number; profileCd: number }
export interface WingAerodynamics {
  kind: AerodynamicSurface['kind'];
  name: string;
  area: number;
  aspect: number;
  alpha: number;
  /** 诱导阻力地效系数；1 为自由空气。垂尾恒为 1。 */
  groundEffect: number;
  inducedDrag: number;
  force: Vector3;
  lift: Vector3;
  drag: Vector3;
  torque: Vector3;
}
/** 所有向量使用机体坐标；力矩关于重心。alpha/beta 单位 rad。 */
export interface AerodynamicReference {
  speed: number;
  alpha: number;
  beta: number;
  wings: WingAerodynamics[];
  force: Vector3;
  lift: Vector3;
  drag: Vector3;
  torque: Vector3;
  bodyDrag: Vector3;
  /** 等效作用线距离CG最近的点；零合力时没有有限中心。 */
  liftCenter: Vector3 | null;
  dragCenter: Vector3 | null;
  /** 中心不能表示的自由力矩；另保留未解析角阻尼 freeMoment。 */
  liftMoment: Vector3;
  dragMoment: Vector3;
  freeMoment: Vector3;
}
export interface AerodynamicSurface {
  name: string;
  point: Vector3;
  force: Vector3;
  drag: Vector3;
  area: number;
  aspect: number;
  span: number;
  chord: number;
  spanStart: number;
  spanEnd: number;
  spanDirection: Vector3;
  /** 四分之一弦后掠角，rad；前掠为负。 */
  sweep: number;
  /** 世界作用点相对水面 Y=0 的净空；设计参考为 Infinity。 */
  clearance: number;
  groundEffect: number;
  inducedDrag: number;
  normal: Vector3;
  incidence: number;
  controlEffectiveness: number;
  kind: 'main' | 'tail' | 'vertical';
  side: number;
  alpha: number;
}
export interface FlightResult {
  distance: number;
  time: number;
  averageSpeed: number;
  maxSpeed: number;
  minSpeed: number;
  maxHeight: number;
  landing: 'water' | 'terrain' | 'boundary' | 'finish';
  challenge: ChallengeMode; score: number; completed: boolean;
}
export interface FlightTelemetry {
  speed: number; altitude: number; distance: number;
  alpha: number; pitch: number; roll: number; sink: number; glide: number;
  stall: boolean; physicsMs: number; cg: Vector3; mass: number;
  force: Vector3; drag: Vector3; torque: Vector3;
  aeroPower: number; energy: number; staticMargin: number;
  energyPerDistance: number | null;
  potentialEnergy: number; kineticEnergy: number; dissipatedEnergy: number; initialEnergy: number;
  liftDragRatio: number;
  aerodynamics: AerodynamicReference;
  challengeProgress: number; groundClearance: number; score: number; completed: boolean; timingStarted: boolean;
  /** 侧向移动改变惯量时，驾驶员克服/吸收转动能所做的真实功；前后仍用原准静态近似。 */
  controlWork: number;
  throttle: number; engineRpm: number; fuelRemaining: number; thrust: number; aboveHeightTime: number;
  propulsionWork: number;
  /** 燃油排出带走的机械能；不含燃料化学能。 */
  fuelEnergyRemoved: number;
}
export interface InputRecording { frames: Float64Array; length: number; launchRoll: number }

function quarterChord(w: Wing) {
  const p = planform(w);
  const fraction = (p.root + 2 * p.tip) / (3 * (p.root + p.tip));
  return w.points[0].x + (w.points[1].x - w.points[0].x) * fraction
    + (p.root + (p.tip - p.root) * fraction) * 0.25;
}

function sweepAngle(w: Wing) {
  const root = w.points[3].x - w.points[0].x, tip = w.points[2].x - w.points[1].x;
  return Math.atan2(w.points[1].x - w.points[0].x + (tip - root) / 4, w.points[1].y);
}

function massLayout(d: AircraftDefinition): MassPart[] {
  const length = d.fuselage.length;
  const fuselageMass = AIRFRAME_MASS.fuselageLinear * length;
  const parts: MassPart[] = [
    { mass: fuselageMass, x: d.fuselage.center - 0.13 * length, y: 0, z: 0, ix: fuselageMass * 0.04, iy: fuselageMass * length * length / 12, iz: fuselageMass * length * length / 12 },
    { mass: AIRFRAME_MASS.cockpit, x: d.cockpit.position, y: 0.12, z: 0, ix: 0.1, iy: 0.2, iz: 0.2 },
    // 趴姿只改变显示网格；乘员仍用此固定质点和局部惯量近似，不引入关节运动功。
    { mass: PILOT_MASS, x: d.cockpit.position, y: 0.15, z: 0, ix: PILOT_MASS * 0.08, iy: PILOT_MASS * 0.025, iz: PILOT_MASS * 0.08, moving: true },
  ];
  for (const key of ['mainWing', 'horizontalTail', 'verticalTail'] as const) {
    const vertical = key === 'verticalTail';
    const w = d[key], p = planform(w, !vertical);
    const density = key === 'mainWing' ? AIRFRAME_MASS.mainArea : AIRFRAME_MASS.tailArea;
    const origin = wingOrigin(d, key);
    const incidence = (key === 'mainWing' ? d.assembly.mainIncidence : key === 'horizontalTail' ? d.assembly.tailIncidence : 0) * DEG;
    const c = Math.cos(incidence), s = Math.sin(incidence), slope = Math.tan(w.dihedral * DEG);
    const fraction = (p.root + 2 * p.tip) / (3 * (p.root + p.tip));
    const centerX = w.points[0].x + (w.points[1].x - w.points[0].x) * fraction
      + (p.root + (p.tip - p.root) * fraction) / 2;
    const halfSpan = vertical ? p.span : p.span / 2;
    const center = halfSpan * fraction;
    for (let side = -1; side <= 1; side += 2) {
      if (vertical && side === -1) continue;
      // CFRP翼梁展长立方成本；8kg覆盖层+17kg梁为25.3m/17.8m²参考主翼的工程分配。
      const sparMass = key === 'mainWing' ? AIRFRAME_MASS.mainSpar * p.span ** 3 : 0;
      const mass = (p.area * density + sparMass) / (vertical ? 1 : 2);
      const y = vertical ? origin.y + center : origin.y - centerX * s + center * slope;
      parts.push({ mass, x: origin.x - centerX * c, y, z: vertical ? 0 : side * center,
        ix: mass * (halfSpan ** 2 * (vertical ? 1 : 1 + slope ** 2) + p.chord ** 2 * s ** 2) / 12,
        iy: mass * (p.chord ** 2 * c ** 2 + (vertical ? 0 : halfSpan ** 2)) / 12,
        iz: mass * (p.chord ** 2 + halfSpan ** 2 * (vertical ? 1 : slope ** 2)) / 12 });
    }
  }
  const support = mainWingSupport(d);
  if (support.mass > 0) {
    // 均匀斜边竖板：弦向斜率与安装角一致，正负安装高度共用同一质量分布。
    const vx = support.width ** 2 / 12;
    const vy = ((support.frontY - support.backY) ** 2 + support.height ** 2) / 12;
    parts.push({ mass: support.mass, x: support.x, y: support.y, z: 0,
      ix: support.mass * vy, iy: support.mass * vx, iz: support.mass * (vx + vy) });
  }
  const engine = engineCatalog[d.engine.type];
  for (const mount of engineMounts(d)) {
    parts.push({ mass: engine.mass, x: mount.x, y: mount.y, z: mount.z,
      ix: engine.mass * engine.radius ** 2 / 2,
      iy: engine.mass * (3 * engine.radius ** 2 + engine.length ** 2) / 12,
      iz: engine.mass * (3 * engine.radius ** 2 + engine.length ** 2) / 12 });
    const radial = Math.hypot(mount.y, mount.z), uy = mount.y / radial, uz = mount.z / radial;
    const half = mount.supportLength / 2, length2 = mount.supportLength ** 2, width2 = mount.supportWidth ** 2, thickness2 = 0.06 ** 2;
    parts.push({ mass: mount.supportMass, x: mount.x, y: uy * half, z: uz * half,
      ix: mount.supportMass * (length2 + thickness2) / 12,
      iy: mount.supportMass * (width2 + length2 * uz ** 2 + thickness2 * uy ** 2) / 12,
      iz: mount.supportMass * (width2 + length2 * uy ** 2 + thickness2 * uz ** 2) / 12 });
  }
  if (d.fuelTank.capacity > 0) {
    const tank = d.fuelTank, shape = fuelTankDimensions(tank.capacity), radius2 = shape.radius ** 2, length2 = (shape.length / 2) ** 2;
    for (const fuel of [false, true]) {
      const mass = fuel ? tank.capacity * FUEL_DENSITY : 0.8 + tank.capacity * 0.035;
      parts.push({ mass, x: tank.x, y: BODY_GEOMETRY.shell.y, z: 0, ix: mass * 2 * radius2 / 5,
        iy: mass * (length2 + radius2) / 5, iz: mass * (length2 + radius2) / 5, fuel });
    }
  }
  return parts;
}

function properties(d: AircraftDefinition): AircraftProperties {
  const p = planform(d.mainWing);
  const tail = planform(d.horizontalTail);
  const mainQuarter = quarterChord(d.mainWing), mainAngle = d.assembly.mainIncidence * DEG;
  const mainOrigin = wingOrigin(d, 'mainWing'), tailOrigin = wingOrigin(d, 'horizontalTail');
  const mainX = mainOrigin.x - mainQuarter * Math.cos(mainAngle);
  const tailX = tailOrigin.x - quarterChord(d.horizontalTail) * Math.cos(d.assembly.tailIncidence * DEG);
  const mainSlope = 1 / (1 + 6.45 / (Math.PI * SPAN_EFFICIENCY * p.aspect)) * Math.cos(sweepAngle(d.mainWing));
  const tailSlopeRatio = 1 / (1 + 6.45 / (Math.PI * SPAN_EFFICIENCY * tail.aspect)) * Math.cos(sweepAngle(d.horizontalTail)) / mainSlope;
  const effectiveness = 0.65 * tail.area / p.area * tailSlopeRatio;
  const neutral = (mainX + effectiveness * tailX) / (1 + effectiveness);
  const center = p.span / 2 * (p.root + 2 * p.tip) / (3 * (p.root + p.tip));
  return { mass: 0, cg: new Vector3(), inertia: new Vector3(), wingArea: p.area, span: p.span, aspect: p.aspect,
    wingLoading: 0, stallSpeed: 0, glideRatio: 0, staticMargin: 0,
    mainQuarterChord: new Vector3(mainX, mainOrigin.y - mainQuarter * Math.sin(mainAngle) + center * Math.tan(d.mainWing.dihedral * DEG), 0),
    neutralPoint: neutral, aerodynamics: new AerodynamicSummary(makeSurfaces(d)) };
}

function updateMass(d: AircraftDefinition, parts: MassPart[], weight: number, out: AircraftProperties, neutral: number, chord: number, updateInertia = true, lateral = 0) {
  let mass = 0, x = 0, y = 0, z = 0;
  for (const p of parts) {
    const px = p.x + (p.moving ? weight * d.controls.travel : 0);
    mass += p.mass; x += p.mass * px; y += p.mass * p.y; z += p.mass * (p.z + (p.moving ? lateral * d.controls.lateralTravel : 0));
  }
  out.mass = mass;
  out.cg.set(x / mass, y / mass, z / mass);
  out.wingLoading = mass / out.wingArea;
  out.staticMargin = (out.cg.x - neutral) / chord;
  if (!updateInertia) return;
  let ix = 0, iy = 0, iz = 0;
  for (const p of parts) {
    const dx = p.x + (p.moving ? weight * d.controls.travel : 0) - out.cg.x;
    const dy = p.y - out.cg.y, dz = p.z + (p.moving ? lateral * d.controls.lateralTravel : 0) - out.cg.z;
    ix += p.ix + p.mass * (dy * dy + dz * dz);
    iy += p.iy + p.mass * (dx * dx + dz * dz);
    iz += p.iz + p.mass * (dx * dx + dy * dy);
  }
  out.inertia.set(ix, iy, iz);
}

export function derive(d: AircraftDefinition, weight = 0, lateral = 0): AircraftProperties {
  d = validateAircraft(d);
  const out = properties(d), neutral = out.neutralPoint;
  updateMass(d, massLayout(d), clamp(weight, -1, 1), out, neutral, planform(d.mainWing).chord, true, clamp(lateral, -1, 1));
  evaluateReference(out);
  return out;
}

/** Empty CG removes fuel only; the configured tank and its dry shell remain installed. */
export function fuelCgRange(d: AircraftDefinition): { full: Vector3; empty: Vector3 } {
 d = validateAircraft(d);
 const full = new Vector3(), empty = new Vector3();
 let fullMass = 0, emptyMass = 0;
 for (const part of massLayout(d)) {
  fullMass += part.mass;
  full.x += part.mass * part.x; full.y += part.mass * part.y; full.z += part.mass * part.z;
  if (!part.fuel) {
   emptyMass += part.mass;
   empty.x += part.mass * part.x; empty.y += part.mass * part.y; empty.z += part.mass * part.z;
  }
 }
 return { full: full.divideScalar(fullMass), empty: empty.divideScalar(emptyMass) };
}

function polar(alpha: number, aspect: number, out: Polar, groundEffect = 1, reynolds = 500_000, cambered = true): Polar {
  alpha = Math.atan2(Math.sin(alpha), Math.cos(alpha));
  const degrees = alpha / DEG, query = clamp(cambered ? degrees : Math.abs(degrees), -6, 17);
  let index = 0;
  while (index < SECTION_POLAR.length - 2 && query > SECTION_POLAR[index + 1][0]) index++;
  const a = SECTION_POLAR[index], b = SECTION_POLAR[index + 1], t = (query - a[0]) / (b[0] - a[0]);
  const re = clamp((reynolds - 500_000) / 500_000, 0, 1);
  const clLow = a[1] + t * (b[1] - a[1]), clHigh = a[3] + t * (b[3] - a[3]);
  let sectionCl = clLow + re * (clHigh - clLow);
  const cdLow = a[2] + t * (b[2] - a[2]), cdHigh = a[4] + t * (b[4] - a[4]);
  if (!cambered) sectionCl = Math.sign(alpha) * (sectionCl - (0.656 + re * 0.0062));
  else if (degrees < -6) sectionCl += 2 * (alpha + 6 * DEG);
  // 200k预测在α0的CL=.6186、CD=.01968；500k以下保守幂律，非新风洞数据。
  const lowRe = clamp(reynolds / 500_000, 0.05, 1);
  sectionCl *= lowRe ** 0.065;
  const finiteWing = 1 / (1 + 6.45 / (Math.PI * SPAN_EFFICIENCY * Math.max(aspect, 0.1)));
  const outside = cambered && degrees < -6 ? (-degrees - 6) / 29 : (Math.abs(degrees) - 17) / 18;
  const blend = clamp(outside, 0, 1), separated = blend * blend * (3 - 2 * blend);
  out.cl = (1 - separated) * sectionCl * finiteWing + separated * 1.05 * Math.sin(2 * alpha);
  // 完全分离后改用下方平板阻力，避免弯度表两端在±π反向来流处造成跳变。
  out.profileCd = (1 - separated) * (cdLow + re * (cdHigh - cdLow)) / lowRe ** 0.75;
  out.inducedCd = groundEffect * out.cl ** 2 / (Math.PI * Math.max(aspect, 0.1) * SPAN_EFFICIENCY);
  out.cd = out.profileCd + out.inducedCd + separated * (1.7 * Math.sin(alpha) ** 2 + 0.3 * (1 - Math.cos(alpha)) ** 2);
  return out;
}

/** 有限翼系数；Re默认500k。cambered=false为对称尾翼工程代理，不是DAE-11风洞结果。 */
export function coefficients(alpha: number, aspect: number, reynolds = 500_000, cambered = true): Polar {
  return polar(alpha, aspect, { cl: 0, cd: 0, inducedCd: 0, profileCd: 0 }, 1, reynolds, cambered);
}

/**
 * 有限翼近地诱导阻力近似 φ=(16h/b)²/(1+(16h/b)²)，不是目标升阻比拟合。
 * h 为作用点到水面 Y=0 的净空，b 为翼展在水面上的投影；垂尾不调用。
 * FAA PHAK 第5章说明近地减弱下洗和诱导阻力：
 * https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/phak/07_phak_ch5.pdf
 * McCormick 近似见 COBEM 2007 式(14)，对梯形翼、强上反角和极小净空仅作趋势近似：
 * https://abcm.org.br/anais/cobem/2007/pdf/COBEM2007-1467.pdf
 * 保持既有 CL、型阻和分离模型；φ 仅修正诱导阻力及传至尾翼的主翼下洗。
 */
function groundEffectFactor(clearance: number, span: number) {
  if (span <= 1e-9) return 1;
  const ratio = 16 * Math.max(0, clearance) / span;
  return 1 - 1 / (1 + ratio * ratio);
}

function makeSurfaces(d: AircraftDefinition): AerodynamicSurface[] {
  // 薄翼理论的后缘襟翼效能；全弦为1，零面积不产生控制力。
  const effectiveness = (fraction: number) => {
    if (fraction === 0 || fraction === 1) return fraction;
    const hingeAngle = Math.acos(2 * fraction - 1);
    return (Math.PI - hingeAngle + Math.sin(hingeAngle)) / Math.PI;
  };
  const surfaces: AerodynamicSurface[] = [];
  for (const key of ['mainWing', 'horizontalTail', 'verticalTail'] as const) {
    const vertical = key === 'verticalTail', w = d[key], p = planform(w, !vertical);
    const halfSpan = w.points[1].y;
    const incidence = (key === 'mainWing' ? d.assembly.mainIncidence : key === 'horizontalTail' ? d.assembly.tailIncidence : 0) * DEG;
    const origin = wingOrigin(d, key), angle = w.dihedral * DEG;
    for (let start = 0; start < halfSpan - 1e-10; start += SURFACE_STEP) {
      const end = Math.min(start + SURFACE_STEP, halfSpan), width = end - start;
      const root = p.root + (p.tip - p.root) * start / halfSpan;
      const tip = p.root + (p.tip - p.root) * end / halfSpan;
      const center = start + width * (root + 2 * tip) / (3 * (root + tip));
      const quarter = w.points[0].x + (w.points[1].x - w.points[0].x) * center / halfSpan
        + (p.root + (p.tip - p.root) * center / halfSpan) / 4;
      for (let side = -1; side <= 1; side += 2) {
        if (vertical && side === -1) continue;
        surfaces.push({ name: `${vertical ? '垂直尾翼' : `${key === 'mainWing' ? '主翼' : '水平尾翼'}${side < 0 ? '左' : '右'}`} ${start.toFixed(1)}–${end.toFixed(1)} m`,
          point: new Vector3(origin.x - quarter * Math.cos(incidence),
            vertical ? origin.y + center : origin.y - quarter * Math.sin(incidence) + center * Math.tan(angle), vertical ? 0 : side * center),
          normal: vertical ? new Vector3(0, 0, 1) : new Vector3(0, Math.cos(angle), -side * Math.sin(angle)),
          area: width * (root + tip) / 2, aspect: p.aspect, span: p.span,
          chord: 2 / 3 * (root * root + root * tip + tip * tip) / (root + tip), spanStart: start, spanEnd: end,
          spanDirection: vertical ? new Vector3(0, 1, 0) : new Vector3(0, Math.tan(angle), side),
          sweep: sweepAngle(w), clearance: Infinity, groundEffect: 1, inducedDrag: 0,
          incidence: vertical ? 0 : (key === 'mainWing' ? d.assembly.mainIncidence : d.assembly.tailIncidence) * DEG,
          controlEffectiveness: effectiveness(w.controlSurface),
          kind: vertical ? 'vertical' : key === 'mainWing' ? 'main' : 'tail', side, alpha: 0,
          force: new Vector3(), drag: new Vector3() });
      }
    }
  }
  return surfaces;
}

/** 与飞行积分共用单翼计算；力、阻力输出先保留在机体坐标中。 */
function evaluateSurface(surface: AerodynamicSurface, input: Controls, mainDownwash: number, mainAspect: number,
  velocity: Vector3, coefficient: Polar, liftDirection: Vector3) {
  const speed = velocity.length(), normalSpeed = velocity.dot(surface.normal);
  let incidence = surface.incidence;
  if (surface.kind === 'main') incidence -= surface.side * input.aileron * AILERON_LIMIT * surface.controlEffectiveness;
  else if (surface.kind === 'tail') incidence -= mainDownwash * 1.56 / (Math.PI * mainAspect) - input.elevator * ELEVATOR_LIMIT * surface.controlEffectiveness;
  else incidence -= input.rudder * RUDDER_LIMIT * surface.controlEffectiveness;
  // ponytail: 刚性展向条带的后掠法向来流近似；翼尖涡与弹性发散需升力线及结构刚度数据。
  // 侧滑改变两侧有效动压，后掠产生上反效应，前掠产生反向效应。
  const crossflow = surface.kind === 'vertical' ? velocity.y : surface.side * velocity.z;
  const chordSpeed = velocity.x * Math.cos(surface.sweep) + crossflow * Math.sin(surface.sweep);
  surface.alpha = Math.atan2(-normalSpeed, chordSpeed) + incidence;
  polar(surface.alpha, surface.aspect, coefficient, surface.groundEffect, speed * surface.chord / AIR_VISCOSITY, surface.kind === 'main');
  const pressureSpeedSq = chordSpeed ** 2 + normalSpeed ** 2;
  const lift = 0.5 * AIR_DENSITY * pressureSpeedSq * surface.area * coefficient.cl;
  surface.inducedDrag = 0.5 * AIR_DENSITY * pressureSpeedSq * surface.area * coefficient.inducedCd;
  liftDirection.copy(surface.normal);
  if (speed > 1e-9) liftDirection.addScaledVector(velocity, -normalSpeed / (speed * speed));
  if (liftDirection.lengthSq() > 1e-12) liftDirection.normalize();
  else liftDirection.set(0, 0, 0);
  // 型阻仍使用全来流动压；诱导阻力与产生升力的有效动压一致。
  const dragPressure = coefficient.profileCd * speed * speed + pressureSpeedSq * (coefficient.cd - coefficient.profileCd);
  surface.drag.copy(velocity).multiplyScalar(speed > 1e-9 ? -0.5 * AIR_DENSITY * surface.area * dragPressure / speed : 0);
  surface.force.copy(liftDirection).multiplyScalar(lift).add(surface.drag);
  // 下洗需要全来流动压下的等效 CL，而非后掠法向截面的 CL。
  return speed > 1e-9 ? coefficient.cl * pressureSpeedSq / (speed * speed) : 0;
}

/** 汇总复用已有翼面，不为每个时间步分配向量或数组。 */
class AerodynamicSummary implements AerodynamicReference {
  speed = 0; alpha = 0; beta = 0;
  readonly force = new Vector3();
  readonly lift = new Vector3();
  readonly drag = new Vector3();
  readonly torque = new Vector3();
  readonly bodyDrag = new Vector3();
  readonly liftMoment = new Vector3();
  readonly dragMoment = new Vector3();
  readonly freeMoment = new Vector3();
  liftCenter: Vector3 | null = null;
  dragCenter: Vector3 | null = null;
  readonly wings: WingAerodynamics[];
  private readonly liftPoint = new Vector3();
  private readonly dragPoint = new Vector3();
  private readonly inverse = new Quaternion();
  private readonly velocity = new Vector3();
  private readonly arm = new Vector3();
  private readonly localForce = new Vector3();
  private readonly localDrag = new Vector3();
  private readonly moment = new Vector3();

  constructor(readonly surfaces: AerodynamicSurface[]) {
    this.wings = (['main', 'tail', 'vertical'] as const).map((kind, index) => {
      const panels = surfaces.filter(surface => surface.kind === kind);
      return { kind, name: ['主翼', '水平尾翼', '垂直尾翼'][index],
        area: panels.reduce((sum, surface) => sum + surface.area, 0), aspect: panels[0].aspect, alpha: 0,
        groundEffect: 1, inducedDrag: 0,
        force: new Vector3(), lift: new Vector3(), drag: new Vector3(), torque: new Vector3() };
    });
  }

  update(cg: Vector3, orientation: Quaternion, velocity: Vector3, torque?: Vector3) {
    this.inverse.copy(orientation).invert();
    this.velocity.copy(velocity).applyQuaternion(this.inverse);
    this.speed = velocity.length();
    this.alpha = Math.atan2(-this.velocity.y, this.velocity.x);
    this.beta = Math.atan2(this.velocity.z, Math.hypot(this.velocity.x, this.velocity.y));
    this.force.set(0, 0, 0); this.lift.set(0, 0, 0); this.drag.set(0, 0, 0);
    this.torque.set(0, 0, 0); this.liftMoment.set(0, 0, 0); this.dragMoment.set(0, 0, 0);
    for (const wing of this.wings) {
      wing.force.set(0, 0, 0); wing.lift.set(0, 0, 0); wing.drag.set(0, 0, 0);
      wing.torque.set(0, 0, 0); wing.alpha = 0; wing.groundEffect = 0; wing.inducedDrag = 0;
    }
    for (const surface of this.surfaces) {
      const wing = this.wings[surface.kind === 'main' ? 0 : surface.kind === 'tail' ? 1 : 2];
      this.arm.copy(surface.point).sub(cg);
      this.localForce.copy(surface.force).applyQuaternion(this.inverse);
      this.localDrag.copy(surface.drag).applyQuaternion(this.inverse);
      wing.force.add(this.localForce); wing.drag.add(this.localDrag);
      wing.alpha += surface.alpha * surface.area / wing.area;
      wing.groundEffect += surface.groundEffect * surface.area / wing.area;
      wing.inducedDrag += surface.inducedDrag;
      this.moment.crossVectors(this.arm, this.localForce);
      wing.torque.add(this.moment); this.torque.add(this.moment);
      this.localForce.sub(this.localDrag);
      wing.lift.add(this.localForce);
      this.liftMoment.add(this.moment.crossVectors(this.arm, this.localForce));
      this.dragMoment.add(this.moment.crossVectors(this.arm, this.localDrag));
    }
    for (const wing of this.wings) {
      this.force.add(wing.force); this.lift.add(wing.lift); this.drag.add(wing.drag);
    }
    this.bodyDrag.copy(this.velocity).multiplyScalar(-0.5 * AIR_DENSITY * this.speed * BODY_DRAG_AREA);
    this.force.add(this.bodyDrag); this.drag.add(this.bodyDrag);
    this.freeMoment.set(0, 0, 0);
    if (torque) { this.freeMoment.copy(torque).sub(this.torque); this.torque.copy(torque); }
    this.liftCenter = this.center(this.lift, this.liftMoment, cg, this.liftPoint);
    this.dragCenter = this.center(this.drag, this.dragMoment, cg, this.dragPoint);
  }

  private center(force: Vector3, moment: Vector3, cg: Vector3, point: Vector3) {
    const squared = force.lengthSq();
    if (squared < 1e-18) return null;
    // r = F × M / |F|²；平行于 F 的力偶不能通过移动作用点消除。
    point.crossVectors(force, moment).multiplyScalar(1 / squared);
    moment.sub(this.moment.crossVectors(point, force));
    return point.add(cg);
  }
}

function evaluateReference(aircraft: AircraftProperties) {
  const summary = aircraft.aerodynamics as AerodynamicSummary, speed = 12;
  const velocity = new Vector3(), direction = new Vector3(), force = new Vector3();
  const coefficient: Polar = { cl: 0, cd: 0, inducedCd: 0, profileCd: 0 };
  let maxCl = 0;
  // 构型派生时搜索同一全机受力；12m/s、无侧滑、无地效，不声称已配平或达到冠军设计值。
  for (let sample = 0; sample <= 125; sample++) {
    const reference = sample === 125;
    const alpha = (reference ? 5 : -6 + sample / 4) * DEG, beta = reference ? 3 * DEG : 0;
    velocity.set(speed * Math.cos(alpha) * Math.cos(beta), -speed * Math.sin(alpha) * Math.cos(beta), speed * Math.sin(beta));
    let mainLift = 0;
    force.copy(velocity).multiplyScalar(-0.5 * AIR_DENSITY * speed * BODY_DRAG_AREA);
    for (const surface of summary.surfaces) {
      const cl = evaluateSurface(surface, ZERO_CONTROLS, mainLift, aircraft.aspect, velocity, coefficient, direction);
      if (surface.kind === 'main') mainLift += cl * surface.area / aircraft.wingArea;
      force.add(surface.force);
    }
    if (!reference) {
      maxCl = Math.max(maxCl, mainLift);
      const drag = -force.dot(velocity) / speed;
      if (drag > 1e-9 && force.y > 0) aircraft.glideRatio = Math.max(aircraft.glideRatio, Math.sqrt(Math.max(0, force.lengthSq() - drag ** 2)) / drag);
    }
  }
  // 失速估值使用12m/s对应各条带Re的主翼CL峰值；不计尾翼/地效增升。
  aircraft.stallSpeed = Math.sqrt(2 * aircraft.mass * GRAVITY / (AIR_DENSITY * aircraft.wingArea * maxCl));
  summary.update(aircraft.cg, new Quaternion(), velocity);
}
/** 与 scene.wingGeometry 相同的翼型采样，碰撞与发射净空包含安装角和厚度。 */
function makeContacts(d: AircraftDefinition): Vector3[] {
  const { nose, tail } = fuselageEnds(d);
  const points = [
    new Vector3(nose, -0.12, 0),
    new Vector3(nose + 0.252, -0.156, 0),
    new Vector3(tail, -0.12, 0),
    new Vector3(d.cockpit.position - 0.75, -0.495, 0),
    new Vector3(d.cockpit.position + 0.75, -0.495, 0),
  ];
  for (const key of ['mainWing', 'horizontalTail', 'verticalTail'] as const) {
    const w = d[key], vertical = key === 'verticalTail';
    const origin = wingOrigin(d, key);
    const incidence = (key === 'mainWing' ? d.assembly.mainIncidence : key === 'horizontalTail' ? d.assembly.tailIncidence : 0) * DEG;
    const c = Math.cos(incidence), s = Math.sin(incidence);
    for (const side of [-1, 1]) {
      if (vertical && side < 0) continue;
      // 高度随展向线性变化，根部与翼尖包含极值；弦向采样与可见网格一致。
      for (const row of [0, 1]) {
        const leading = w.points[row].x, trailing = w.points[row === 0 ? 3 : 2].x;
        const span = w.points[row].y, chord = trailing - leading;
        for (let j = 0; j <= 16; j++) {
          const u = (1 - Math.cos(j / 16 * Math.PI)) / 2;
          const thickness = 5 * 0.105 * chord * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4);
          const x = -leading - u * chord;
          for (const face of [-1, 1]) {
            const y = (vertical ? 0 : 0.018 * chord * Math.sin(Math.PI * u)) + face * thickness;
            points.push(vertical ? new Vector3(origin.x + x, origin.y + span, y)
              : new Vector3(origin.x + x * c - y * s, origin.y + x * s + y * c + span * Math.tan(w.dihedral * DEG), side * span));
          }
        }
      }
    }
  }
  const support = mainWingSupport(d);
  if (support.mass > 0) {
    points.push(new Vector3(support.frontX, support.frontY, 0), new Vector3(support.backX, support.backY, 0),
      new Vector3(support.frontX, support.frontY - support.height, 0), new Vector3(support.backX, support.backY - support.height, 0));
  }
  const engine = engineCatalog[d.engine.type];
  for (const mount of engineMounts(d)) {
    for (const end of [-1, 1]) for (let ring = 0; ring < 16; ring++) {
      const angle = ring / 16 * Math.PI * 2;
      points.push(new Vector3(mount.x + end * engine.length / 2, mount.y + engine.radius * Math.cos(angle), mount.z + engine.radius * Math.sin(angle)));
    }
    const radial = Math.hypot(mount.y, mount.z), uy = mount.y / radial, uz = mount.z / radial;
    for (const end of [-1, 1]) for (const distance of [0, mount.supportLength]) for (const face of [-1, 1]) {
      points.push(new Vector3(mount.x + end * mount.supportWidth / 2, uy * distance - uz * face * 0.03, uz * distance + uy * face * 0.03));
    }
  }
  if (d.fuelTank.capacity > 0) {
    const tank = d.fuelTank, shape = fuelTankDimensions(tank.capacity);
    for (let row = 0; row <= 8; row++) {
      const angle = row / 8 * Math.PI;
      for (let ring = 0; ring < 16; ring++) {
        const azimuth = ring / 16 * Math.PI * 2, radius = shape.radius * Math.sin(angle);
        points.push(new Vector3(tank.x + shape.length / 2 * Math.cos(angle), BODY_GEOMETRY.shell.y + radius * Math.cos(azimuth), radius * Math.sin(azimuth)));
      }
    }
  }
  return points;
}

/** 起点CG高度；机体俯仰贴合下坡，并为整个±1°滚转包络保留5 cm净空。 */
export function launchHeight(d: AircraftDefinition, cg = derive(d).cg): number {
  d = validateAircraft(d);
  return runwayHeight(LAUNCH.startX) + contactLaunchOffset(makeContacts(d), cg);
}

function contactLaunchOffset(contacts: Vector3[], cg: Vector3): number {
  let lowest = Infinity;
  const c = Math.cos(LAUNCH_ROLL_LIMIT), s = Math.sin(LAUNCH_ROLL_LIMIT);
  for (const point of contacts) {
    const y = point.y - cg.y, z = Math.abs(point.z - cg.z);
    lowest = Math.min(lowest, y, y * c - z * s);
    if (y < 0 && z <= -y * Math.tan(LAUNCH_ROLL_LIMIT)) lowest = Math.min(lowest, -Math.hypot(y, z));
  }
  return 0.05 - lowest / Math.cos(LAUNCH.slope);
}


export class FlightSimulation {
  readonly definition: AircraftDefinition;
  readonly challenge: ChallengeMode;
  readonly controlDeflections = { aileron: 0, elevator: 0, rudder: 0 };
  readonly pilotOffset = { x: 0, z: 0 };
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly quaternion = new Quaternion();
  /** 角速度使用机身坐标，单位 rad/s。 */
  readonly omega = new Vector3();
  readonly surfaces: AerodynamicSurface[];
  readonly aircraft: AircraftProperties;
  readonly telemetry: FlightTelemetry;
  readonly recording = new Float64Array(MAX_FRAMES * FRAME_WIDTH);
  recordingLength = 0;
  time = 0;
  ended = false;
  result: FlightResult | null = null;
  replayFinished = false;
  launching = true;
  private flightStarted = false;
  private launchTime = 0;
  private raceStarted = false;
  private launchRoll = 0;
  private replay: InputRecording | null = null;
  private replayIndex = 0;
  private readonly parts: MassPart[];
  private readonly fuelPart: MassPart | undefined;
  private readonly enginePositions: EngineMount[];
  private readonly fuelLocalInertia = new Vector3();
  private readonly cgShift = new Vector3();
  private engineRpm = 0;
  private fuelRemaining = 0;
  private thrust = 0;
  private propulsionPower = 0;
  private lowAltitudeDistance = 0;
  private farthestX = 0;
  private heightPenalty = 0;
  private aboveHeightTime = 0;
  private aboveHeightStreak = 0;
  private readonly neutral: number;
  private readonly chord: number;
  private readonly aerodynamics: AerodynamicSummary;
  private readonly flightInertia = new Vector3();
  private readonly launchAltitude: number;
  private readonly bodyVelocity = new Vector3();
  private readonly contacts: Vector3[];
  private readonly platformFaces: Int8Array;
  private readonly platformGaps: Float64Array;
  private readonly platformImpulses: Float64Array;
  private readonly platformAxes: Vector3[];
  private readonly platformActive: Int32Array;
  private platformCount = 0;
  private readonly platformStart = new Vector3();
  private readonly platformEnd = new Vector3();
  private readonly contactNormal = new Vector3();
  private readonly inverse = new Quaternion();
  private readonly rotation = new Quaternion();
  private readonly arm = new Vector3();
  private readonly localVelocity = new Vector3();
  private readonly liftDirection = new Vector3();
  private readonly localDrag = new Vector3();
  private readonly torque = new Vector3();
  private readonly cross = new Vector3();
  private readonly previousVelocity = new Vector3();
  private readonly previousPosition = new Vector3();
  private readonly previousOmega = new Vector3();
  private readonly midpointVelocity = new Vector3();
  private readonly midpointPosition = new Vector3();
  private readonly midpointOmega = new Vector3();
  private readonly candidateVelocity = new Vector3();
  private readonly candidateOmega = new Vector3();
  private readonly midpointQuaternion = new Quaternion();
  private readonly polar: Polar = { cl: 0, cd: 0, inducedCd: 0, profileCd: 0 };
  private readonly candidatePosition = new Vector3();
  private readonly candidateQuaternion = new Quaternion();
  private maxSpeed = 10;
  private minSpeed = 10;
  private maxHeight = 10;
  private travelled = 0;
  private weight = 0;
  private lateral = 0;
  private checkpointIndex = 0;
  private completed = false;
  private readonly effective: Controls = { ...ZERO_CONTROLS };
  private readonly applied: Controls = { ...ZERO_CONTROLS };

  constructor(d: AircraftDefinition, challenge: ChallengeMode = 'birdman', private readonly fixedLaunchRoll?: number) {
    this.definition = validateAircraft(d);
    if (!Object.hasOwn(challengeDefinitions, challenge)) throw new Error('未知飞行挑战');
    if (challenge === 'birdman' && (!this.definition.birdman || this.definition.engine.count > 0)) throw new Error('鸟人间比赛只允许无动力鸟人间设计');
    this.challenge = challenge;
    this.parts = massLayout(this.definition);
    this.fuelPart = this.parts.find(part => part.fuel);
    this.enginePositions = engineMounts(this.definition);
    const shape = fuelTankDimensions(this.definition.fuelTank.capacity);
    this.fuelLocalInertia.set(2 * shape.radius ** 2 / 5, ((shape.length / 2) ** 2 + shape.radius ** 2) / 5, ((shape.length / 2) ** 2 + shape.radius ** 2) / 5);
    this.aircraft = properties(this.definition);
    this.neutral = this.aircraft.neutralPoint;
    this.chord = planform(this.definition.mainWing).chord;
    this.surfaces = makeSurfaces(this.definition);
    this.aerodynamics = new AerodynamicSummary(this.surfaces);
    this.contacts = makeContacts(this.definition);
    const contactCount = this.contacts.length * PLATFORM_BOXES.length;
    this.platformFaces = new Int8Array(contactCount);
    this.platformGaps = new Float64Array(contactCount);
    this.platformImpulses = new Float64Array(contactCount);
    this.platformAxes = Array.from({ length: contactCount }, () => new Vector3());
    this.platformActive = new Int32Array(contactCount);
    updateMass(this.definition, this.parts, 0, this.aircraft, this.neutral, this.chord);
    evaluateReference(this.aircraft);
    this.flightInertia.copy(this.aircraft.inertia);
    const launch = challengeLaunch(this.challenge);
    this.launchAltitude = launch ? launch.y + contactLaunchOffset(this.contacts, this.aircraft.cg) * Math.cos(LAUNCH.slope)
      : runwayHeight(LAUNCH.startX) + contactLaunchOffset(this.contacts, this.aircraft.cg);
    this.telemetry = { speed: 10, altitude: 10, distance: 0, alpha: 0, pitch: 0, roll: 0, sink: 0, glide: 0,
      stall: false, physicsMs: 0, cg: this.aircraft.cg, mass: 0, force: new Vector3(), drag: new Vector3(), torque: new Vector3(),
      aeroPower: 0, energy: 0, staticMargin: 0, energyPerDistance: null, potentialEnergy: 0, kineticEnergy: 0,
      dissipatedEnergy: 0, initialEnergy: 0, liftDragRatio: 0, aerodynamics: this.aerodynamics,
      challengeProgress: 0, groundClearance: 0, score: 0, completed: false, timingStarted: false, controlWork: 0,
      throttle: 0, engineRpm: 0, fuelRemaining: 0, thrust: 0, aboveHeightTime: 0, propulsionWork: 0, fuelEnergyRemoved: 0 };
    this.reset();
  }

  /** 新飞行重新抽样；构造时明确指定角度则保持该角度。回放仅覆盖本次重置。 */
  reset(launchRoll = this.fixedLaunchRoll ?? (Math.random() * 2 - 1) * LAUNCH_ROLL_LIMIT) {
    if (!Number.isFinite(launchRoll) || Math.abs(launchRoll) > LAUNCH_ROLL_LIMIT) throw new RangeError('离台滚转角须在 ±1° 之间');
    this.launchRoll = launchRoll;
    this.position.set(LAUNCH.startX, this.launchAltitude, 0);
    this.velocity.set(0, 0, 0);
    this.quaternion.setFromAxisAngle(this.cross.set(0, 0, 1), -LAUNCH.slope);
    this.omega.set(0, 0, 0);
    this.time = 0; this.ended = false; this.result = null;
    this.launching = true; this.flightStarted = false; this.launchTime = 0; this.raceStarted = false;
    const launch = challengeLaunch(this.challenge);
    if (launch) {
      this.position.set(launch.startX, this.launchAltitude, launch.z);
      this.quaternion.identity();
    }
    this.recordingLength = 0; this.replayIndex = 0; this.replayFinished = false; this.replay = null;
    this.maxSpeed = this.minSpeed = this.challenge === 'birdman' ? LAUNCH.speed : this.velocity.length();
    this.maxHeight = this.position.y;
    this.travelled = 0; this.weight = 0; this.lateral = 0; this.checkpointIndex = 0; this.completed = false;
    this.engineRpm = 0; this.thrust = 0; this.propulsionPower = 0;
    this.fuelRemaining = this.definition.fuelTank.capacity;
    this.lowAltitudeDistance = 0; this.farthestX = 0; this.heightPenalty = 0; this.aboveHeightTime = 0; this.aboveHeightStreak = 0;
    this.pilotOffset.x = 0; this.pilotOffset.z = 0;
    if (this.fuelPart) {
      this.fuelPart.mass = this.fuelRemaining * FUEL_DENSITY;
      this.fuelPart.ix = this.fuelPart.mass * this.fuelLocalInertia.x;
      this.fuelPart.iy = this.fuelPart.mass * this.fuelLocalInertia.y;
      this.fuelPart.iz = this.fuelPart.mass * this.fuelLocalInertia.z;
    }
    Object.assign(this.effective, ZERO_CONTROLS);
    Object.assign(this.applied, ZERO_CONTROLS);
    Object.assign(this.controlDeflections, { aileron: 0, elevator: 0, rudder: 0 });
    updateMass(this.definition, this.parts, 0, this.aircraft, this.neutral, this.chord);
    this.flightInertia.copy(this.aircraft.inertia);
    for (const surface of this.surfaces) {
      surface.force.set(0, 0, 0); surface.drag.set(0, 0, 0); surface.alpha = 0;
      surface.clearance = Infinity; surface.groundEffect = 1; surface.inducedDrag = 0;
    }
    this.telemetry.force.set(0, 0, 0); this.telemetry.drag.set(0, 0, 0); this.telemetry.torque.set(0, 0, 0);
    this.telemetry.physicsMs = 0; this.telemetry.aeroPower = 0;
    this.telemetry.dissipatedEnergy = 0; this.telemetry.initialEnergy = 0; this.telemetry.liftDragRatio = 0; this.telemetry.controlWork = 0;
    this.telemetry.propulsionWork = 0; this.telemetry.fuelEnergyRemoved = 0;
    this.aerodynamics.update(this.aircraft.cg, this.quaternion, this.velocity);
    this.updateTelemetry();
    if (!this.launching) this.beginFlight();
  }

  getRecording(): InputRecording {
    return { frames: this.recording.slice(0, this.recordingLength * FRAME_WIDTH), length: this.recordingLength, launchRoll: this.launchRoll };
  }

  loadReplay(recording: InputRecording) {
    if (!Number.isInteger(recording.length) || recording.length < 0 || recording.length > MAX_FRAMES || recording.frames.length < recording.length * FRAME_WIDTH) throw new Error('飞行记录长度无效');
    if (!Number.isFinite(recording.launchRoll) || Math.abs(recording.launchRoll) > LAUNCH_ROLL_LIMIT) throw new Error('飞行记录离台滚转角无效');
    for (let i = 0; i < recording.length * FRAME_WIDTH; i++) {
      if (!Number.isFinite(recording.frames[i]) || (i % FRAME_WIDTH === 0 && (recording.frames[i] <= 0 || recording.frames[i] > 0.25))) throw new Error('飞行记录包含无效输入');
    }
    const copy = { frames: recording.frames.slice(0, recording.length * FRAME_WIDTH), length: recording.length, launchRoll: recording.launchRoll };
    this.reset(copy.launchRoll);
    this.replay = copy;
    this.recording.set(copy.frames);
    this.recordingLength = copy.length;
    this.replayFinished = copy.length === 0;
  }

  step(controls: Controls, dt = 1 / 60) {
    if (this.ended || this.replayFinished) return;
    const started = performance.now();
    const input = this.effective;
    if (this.replay) {
      const offset = this.replayIndex * FRAME_WIDTH;
      dt = this.replay.frames[offset];
      input.weight = this.replay.frames[offset + 1]; input.rudder = this.replay.frames[offset + 2];
      input.elevator = this.replay.frames[offset + 3]; input.aileron = this.replay.frames[offset + 4];
      input.lateral = this.replay.frames[offset + 5];
      input.throttle = this.replay.frames[offset + 6];
      this.replayIndex++;
      this.replayFinished = this.replayIndex >= this.replay.length;
    } else {
      input.weight = controls.weight; input.rudder = controls.rudder;
      input.elevator = controls.elevator; input.aileron = controls.aileron;
      input.lateral = controls.lateral ?? 0;
      input.throttle = controls.throttle ?? 0;
    }
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25) throw new RangeError('步长须在 0 至 0.25 秒之间');
    if (!Number.isFinite(input.weight + input.rudder + input.elevator + input.aileron + input.lateral! + input.throttle!)) throw new RangeError('操纵输入必须为有限数');
    input.weight = clamp(input.weight, -1, 1); input.rudder = clamp(input.rudder, -1, 1);
    input.elevator = clamp(input.elevator, -1, 1); input.aileron = clamp(input.aileron, -1, 1);
    input.lateral = clamp(input.lateral!, -1, 1);
    input.throttle = clamp(input.throttle!, 0, 1);
    if (!this.replay && this.recordingLength < MAX_FRAMES) {
      const offset = this.recordingLength++ * FRAME_WIDTH;
      this.recording[offset] = dt; this.recording[offset + 1] = input.weight;
      this.recording[offset + 2] = input.rudder; this.recording[offset + 3] = input.elevator; this.recording[offset + 4] = input.aileron;
      this.recording[offset + 5] = input.lateral;
      this.recording[offset + 6] = input.throttle;
    }
    if (this.definition.birdman) { input.elevator = 0; input.aileron = 0; }
    // 60 Hz 是标准物理步；较大的外部步长只拆成相同上限，绝不按帧率缩放气动力。
    const steps = Math.max(1, Math.ceil(dt * 60 - 1e-10));
    const h = dt / steps;
    for (let i = 0; i < steps && !this.ended; i++) this.integrate(input, h);
    this.telemetry.physicsMs = performance.now() - started;
  }

  private updatePropulsion(throttle: number, dt: number) {
    const count = this.definition.engine.count, spec = engineCatalog[this.definition.engine.type];
    if (count === 0) { this.engineRpm = 0; this.thrust = 0; return; }
    const target = this.fuelRemaining > 0 ? throttle : 0, delta = this.engineRpm - target;
    const decay = Math.exp(-dt / spec.spoolTime);
    const integral = Math.max(0, target ** 2 * dt + 2 * target * delta * spec.spoolTime * (1 - decay)
      + delta ** 2 * spec.spoolTime / 2 * (1 - decay * decay));
    this.engineRpm = target + delta * decay;
    const required = count * spec.fuelFlow * integral, burned = Math.min(this.fuelRemaining, required);
    this.thrust = required > 0 ? count * spec.maxThrust * integral / dt * burned / required : 0;
    if (burned <= 0 || !this.fuelPart) return;
    const removedMass = burned * FUEL_DENSITY, tank = this.definition.fuelTank;
    this.arm.set(tank.x, BODY_GEOMETRY.shell.y, 0).sub(this.aircraft.cg);
    this.localVelocity.crossVectors(this.omega, this.arm).applyQuaternion(this.quaternion).add(this.velocity);
    this.cross.copy(this.arm).applyQuaternion(this.quaternion).add(this.position);
    this.telemetry.fuelEnergyRemoved += removedMass * (GRAVITY * this.cross.y + this.localVelocity.lengthSq() / 2
      + (this.fuelLocalInertia.x * this.omega.x ** 2 + this.fuelLocalInertia.y * this.omega.y ** 2 + this.fuelLocalInertia.z * this.omega.z ** 2) / 2);
    this.cgShift.copy(this.aircraft.cg);
    this.fuelRemaining -= burned;
    this.fuelPart.mass = this.fuelRemaining * FUEL_DENSITY;
    this.fuelPart.ix = this.fuelPart.mass * this.fuelLocalInertia.x;
    this.fuelPart.iy = this.fuelPart.mass * this.fuelLocalInertia.y;
    this.fuelPart.iz = this.fuelPart.mass * this.fuelLocalInertia.z;
    updateMass(this.definition, this.parts, 0, this.aircraft, this.neutral, this.chord);
    this.flightInertia.copy(this.aircraft.inertia);
    updateMass(this.definition, this.parts, this.weight, this.aircraft, this.neutral, this.chord, false, this.lateral);
    const shift = this.lateral * this.definition.controls.lateralTravel;
    const addition = PILOT_MASS * (1 - PILOT_MASS / this.aircraft.mass) * shift ** 2;
    this.aircraft.inertia.x += addition; this.aircraft.inertia.y += addition;
    // 质心随排出的燃油改变；保留机体几何和刚体速度场连续，不凭空推动剩余飞机。
    this.cgShift.subVectors(this.aircraft.cg, this.cgShift);
    this.cross.crossVectors(this.omega, this.cgShift).applyQuaternion(this.quaternion);
    this.velocity.add(this.cross);
    this.cgShift.applyQuaternion(this.quaternion);
    this.position.add(this.cgShift);
  }

  private integrate(input: Controls, dt: number) {
    for (const axis of CONTROL_AXES) {
      this.applied[axis] += clamp(input[axis] - this.applied[axis], -CONTROL_SURFACE_RATE * dt, CONTROL_SURFACE_RATE * dt);
    }
    this.controlDeflections.aileron = this.applied.aileron * AILERON_LIMIT;
    this.controlDeflections.elevator = -this.applied.elevator * ELEVATOR_LIMIT;
    this.controlDeflections.rudder = this.applied.rudder * RUDDER_LIMIT;
    this.updatePropulsion(input.throttle!, dt);
    // 保留前后准静态模型。侧向移动改变CG与对角惯量，并守恒机体轴角动量。
    this.weight += clamp(input.weight - this.weight, -dt * 1.5, dt * 1.5);
    this.lateral += clamp(input.lateral! - this.lateral, -dt * 1.5, dt * 1.5);
    this.pilotOffset.x = this.weight * this.definition.controls.travel;
    this.pilotOffset.z = this.lateral * this.definition.controls.lateralTravel;
    const inertia = this.aircraft.inertia;
    const oldX = inertia.x, oldY = inertia.y;
    updateMass(this.definition, this.parts, this.weight, this.aircraft, this.neutral, this.chord, false, this.lateral);
    const displacement = this.lateral * this.definition.controls.lateralTravel;
    const addition = PILOT_MASS * (1 - PILOT_MASS / this.aircraft.mass) * displacement ** 2;
    inertia.x = this.flightInertia.x + addition; inertia.y = this.flightInertia.y + addition;
    const oldEnergy = 0.5 * (oldX * this.omega.x ** 2 + oldY * this.omega.y ** 2);
    this.omega.x *= oldX / inertia.x; this.omega.y *= oldY / inertia.y;
    this.telemetry.controlWork += 0.5 * (inertia.x * this.omega.x ** 2 + inertia.y * this.omega.y ** 2) - oldEnergy;
    if (this.launching && this.challenge === 'low-altitude') {
      this.integrateRunway(input, dt);
      return;
    }
    if (this.launching) {
      const launch = challengeLaunch(this.challenge);
      const targetSpeed = launch?.speed ?? LAUNCH.speed, acceleration = launch?.acceleration ?? LAUNCH.acceleration;
      const slope = launch?.slope ?? LAUNCH.slope, startX = launch?.startX ?? LAUNCH.startX;
      const duration = targetSpeed / acceleration;
      const h = Math.min(dt, Math.max(0, duration - this.launchTime));
      const oldTime = this.launchTime;
      this.launchTime = Math.min(duration, this.launchTime + h);
      const distance = 0.5 * acceleration * this.launchTime ** 2;
      const u = this.launchTime / duration;
      const blend = u ** 3 * (10 + u * (-15 + 6 * u));
      this.quaternion.setFromAxisAngle(this.cross.set(0, 0, 1), -slope);
      this.rotation.setFromAxisAngle(this.cross.set(1, 0, 0), this.launchRoll * blend);
      this.quaternion.multiply(this.rotation);
      this.omega.set(this.launchRoll * 30 * u ** 2 * (1 - u) ** 2 / duration, 0, 0);
      this.position.set(startX + distance * Math.cos(slope),
        this.launchAltitude - distance * Math.sin(slope), launch?.z ?? 0);
      const speed = acceleration * this.launchTime;
      this.velocity.set(speed * Math.cos(slope), -speed * Math.sin(slope), 0);
      if (this.challenge === 'birdman') this.time += h;
      this.travelled += 0.5 * acceleration * (this.launchTime ** 2 - oldTime ** 2);
      if (duration - this.launchTime <= 1e-12) {
        this.position.x = launch?.endX ?? LAUNCH.endX;
        this.launching = false;
        this.omega.set(0, 0, 0);
        this.beginFlight();
      }
      this.updateTelemetry();
      if (dt - h > 1e-12 && !this.launching) this.integrateFlight(input, dt - h);
      return;
    }
    if (!this.flightStarted) this.beginFlight();
    this.integrateFlight(input, dt);
  }

  /** 起落架支撑的直线滑跑：速度仅来自真实发动机、气动阻力与滚阻，不赠送离地速度。 */
  private integrateRunway(input: Controls, dt: number) {
    const launch = challengeLaunch(this.challenge)!;
    this.evaluateForces(input, this.velocity, this.omega, this.quaternion, this.position);
    const mass = this.aircraft.mass;
    const normal = Math.max(0, mass * GRAVITY - this.telemetry.force.y);
    const acceleration = (this.telemetry.force.x - (this.velocity.x > 0 ? normal * 0.02 : 0)) / mass;
    const oldSpeed = this.velocity.x;
    this.velocity.x = Math.max(0, oldSpeed + acceleration * dt);
    const distance = (oldSpeed + this.velocity.x) * dt / 2;
    this.position.x += distance;
    this.position.y = launch.y + contactLaunchOffset(this.contacts, this.aircraft.cg) * Math.cos(LAUNCH.slope);
    this.telemetry.propulsionWork += this.thrust * distance;
    this.telemetry.dissipatedEnergy += Math.max(0, (-this.telemetry.drag.x + normal * 0.02) * distance);
    this.travelled += distance;
    if (this.telemetry.force.y >= mass * GRAVITY && this.velocity.x > 0) {
      this.launching = false;
      this.beginFlight();
    } else if (this.position.x >= launch.endX) {
      this.updateTelemetry();
      this.finish('terrain');
      return;
    }
    this.updateTelemetry();
  }

  private beginFlight() {
    this.flightStarted = true;
    this.maxSpeed = this.minSpeed = this.velocity.length();
    this.maxHeight = this.position.y;
    this.updateTelemetry();
    this.telemetry.initialEnergy = this.telemetry.energy;
    this.telemetry.dissipatedEnergy = 0;
    this.telemetry.controlWork = 0;
    this.telemetry.propulsionWork = 0;
    this.telemetry.fuelEnergyRemoved = 0;
  }

  private evaluateForces(_input: Controls, velocity: Vector3, omega: Vector3, orientation: Quaternion, position: Vector3) {
    this.inverse.copy(orientation).invert();
    this.bodyVelocity.copy(velocity).applyQuaternion(this.inverse);
    const speed = velocity.length();
    this.torque.set(0, 0, 0);
    this.telemetry.force.set(0, 0, 0); this.telemetry.drag.set(0, 0, 0);
    let mainDownwash = 0, power = 0;
    for (const surface of this.surfaces) {
      this.arm.copy(surface.point).sub(this.aircraft.cg);
      // 鸟人间地效保持相对连续水面；山谷使用同一可见三角地形的局部净空。
      this.cross.copy(this.arm).applyQuaternion(orientation).add(position);
      surface.clearance = this.cross.y - challengeCollisionHeight(this.challenge, this.cross.x, this.cross.z);
      surface.groundEffect = 1;
      if (surface.kind !== 'vertical') {
        this.cross.copy(surface.spanDirection).applyQuaternion(orientation);
        const span = surface.span * Math.hypot(this.cross.x, this.cross.z);
        surface.groundEffect = groundEffectFactor(surface.clearance, span);
      }
      this.localVelocity.crossVectors(omega, this.arm).add(this.bodyVelocity);
      const cl = evaluateSurface(surface, this.applied, mainDownwash, this.aircraft.aspect, this.localVelocity, this.polar, this.liftDirection);
      if (surface.kind === 'main') mainDownwash += cl * surface.groundEffect * surface.area / this.aircraft.wingArea;
      // 升力与作用点局部来流正交；仅真实阻力贡献耗散功率。
      power += surface.drag.dot(this.localVelocity);
      this.cross.crossVectors(this.arm, surface.force); this.torque.add(this.cross);
      surface.force.applyQuaternion(orientation);
      surface.drag.applyQuaternion(orientation);
      this.telemetry.force.add(surface.force); this.telemetry.drag.add(surface.drag);
    }
    // 机身/乘员阻力作用于重心；分布翼面之外补充未解析尺度的动压角阻尼。
    this.localDrag.copy(velocity).multiplyScalar(-0.5 * AIR_DENSITY * speed * BODY_DRAG_AREA);
    this.telemetry.force.add(this.localDrag); this.telemetry.drag.add(this.localDrag);
    power += this.localDrag.dot(velocity);
    const spec = engineCatalog[this.definition.engine.type];
    for (const engine of this.enginePositions) {
      this.arm.set(engine.x, engine.y, engine.z).sub(this.aircraft.cg);
      this.localVelocity.crossVectors(omega, this.arm).add(this.bodyVelocity);
      const area = Math.PI * spec.radius ** 2 * 0.22 + engine.supportLength * engine.supportWidth * 0.02;
      this.localDrag.copy(this.localVelocity).multiplyScalar(-0.5 * AIR_DENSITY * this.localVelocity.length() * area);
      power += this.localDrag.dot(this.localVelocity);
      this.cross.crossVectors(this.arm, this.localDrag); this.torque.add(this.cross);
      this.localDrag.applyQuaternion(orientation);
      this.telemetry.force.add(this.localDrag); this.telemetry.drag.add(this.localDrag);
    }
    const damping = 0.25 * AIR_DENSITY * speed * this.aircraft.wingArea;
    this.cross.set(-damping * this.aircraft.span ** 2 * 0.015 * omega.x,
      -damping * this.aircraft.span ** 2 * 0.004 * omega.y,
      -damping * this.chord ** 2 * 0.15 * omega.z);
    power += this.cross.dot(omega); this.torque.add(this.cross);
    this.telemetry.aeroPower = power;
    // 推进力不属于气动升阻比。
    const drag = speed > 1e-9 ? -this.telemetry.force.dot(velocity) / speed : 0;
    this.telemetry.liftDragRatio = drag > 1e-9
      ? Math.sqrt(Math.max(0, this.telemetry.force.lengthSq() - drag ** 2)) / drag : 0;
    this.propulsionPower = 0;
    if (this.thrust > 0) {
      const thrust = this.thrust / this.enginePositions.length;
      for (const engine of this.enginePositions) {
        this.arm.set(engine.x, engine.y, engine.z).sub(this.aircraft.cg);
        this.localVelocity.crossVectors(omega, this.arm).add(this.bodyVelocity);
        this.propulsionPower += thrust * this.localVelocity.x;
        this.torque.y += this.arm.z * thrust;
        this.torque.z -= this.arm.y * thrust;
      }
      this.cross.set(this.thrust, 0, 0).applyQuaternion(orientation);
      this.telemetry.force.add(this.cross);
    }
    this.telemetry.torque.copy(this.torque);
  }

  private integrateFlight(input: Controls, dt: number) {
    if (this.ended) return;
    const initialLanding = this.landingAt(this.position, this.quaternion);
    if (initialLanding) { this.updateTelemetry(); this.finish(initialLanding); return; }
    this.preparePlatformContacts();
    this.resolvePlatformImpact();
    const mass = this.aircraft.mass, inertia = this.aircraft.inertia;
    this.previousVelocity.copy(this.velocity); this.previousOmega.copy(this.omega);
    this.midpointVelocity.copy(this.velocity); this.midpointOmega.copy(this.omega);
    let converged = false;
    // 隐式中点同时求解平动、转动及陀螺项，使动能差严格对应中点功。
    for (let iteration = 0; iteration < 40; iteration++) {
      const angle = this.midpointOmega.length() * dt / 2;
      this.midpointQuaternion.copy(this.quaternion);
      if (angle > 0) {
        this.cross.copy(this.midpointOmega).normalize();
        this.rotation.setFromAxisAngle(this.cross, angle);
        this.midpointQuaternion.multiply(this.rotation).normalize();
      }
      this.midpointPosition.copy(this.position).addScaledVector(this.midpointVelocity, dt / 2);
      this.evaluateForces(input, this.midpointVelocity, this.midpointOmega, this.midpointQuaternion, this.midpointPosition);
      this.candidateVelocity.copy(this.previousVelocity).addScaledVector(this.telemetry.force, dt / (2 * mass));
      this.candidateVelocity.y -= GRAVITY * dt / 2;
      const w = this.midpointOmega;
      this.candidateOmega.set(
        this.previousOmega.x + dt / 2 * (this.torque.x + (inertia.y - inertia.z) * w.y * w.z) / inertia.x,
        this.previousOmega.y + dt / 2 * (this.torque.y + (inertia.z - inertia.x) * w.z * w.x) / inertia.y,
        this.previousOmega.z + dt / 2 * (this.torque.z + (inertia.x - inertia.y) * w.x * w.y) / inertia.z);
      this.constrainPlatformMidpoint(dt);
      const residual = this.candidateVelocity.distanceToSquared(this.midpointVelocity)
        + this.candidateOmega.distanceToSquared(this.midpointOmega);
      if (residual <= 1e-28 * (1 + this.midpointVelocity.lengthSq() + this.midpointOmega.lengthSq())) {
        converged = true;
        break;
      }
      this.midpointVelocity.copy(this.candidateVelocity); this.midpointOmega.copy(this.candidateOmega);
    }
    if (!converged) {
      // 不修补能量账本；刚性极端构型缩短真实积分步，再解同一方程。
      if (dt < 1e-8) throw new Error('气动力中点求解未收敛');
      this.integrateFlight(input, dt / 2);
      this.integrateFlight(input, dt / 2);
      return;
    }
    this.candidatePosition.copy(this.position).addScaledVector(this.midpointVelocity, dt);
    this.candidateQuaternion.copy(this.quaternion);
    const angle = this.midpointOmega.length() * dt;
    if (angle > 0) {
      this.cross.copy(this.midpointOmega).normalize(); this.rotation.setFromAxisAngle(this.cross, angle);
      this.candidateQuaternion.multiply(this.rotation).normalize();
    }
    const landing = this.landingAt(this.candidatePosition, this.candidateQuaternion);
    const platformHit = this.challenge === 'birdman' && this.sweepsPlatform();
    const terrainHit = this.challenge !== 'birdman' && this.sweepsTerrain();
    const finalGate = challengeCheckpoints(this.challenge)[this.checkpointIndex];
    const finishCrossing = finalGate && this.checkpointIndex === challengeCheckpoints(this.challenge).length - 1
      && this.position.x < finalGate.x && this.candidatePosition.x >= finalGate.x;
    if ((platformHit && dt > 1e-8) || (terrainHit && dt > 1e-7) || (finishCrossing && dt > 1e-7) || angle > 0.1) {
      // 先推进到首次接触附近；静止支撑用中点约束，不靠微小反弹消耗整帧。
      this.integrateFlight(input, dt / 2);
      this.integrateFlight(input, dt / 2);
      return;
    }
    if (landing && dt > 1e-7) {
      // 重新求解接触时刻，不插值/抬升终点，也不修补能量账本。
      this.integrateFlight(input, dt / 2);
      this.integrateFlight(input, dt / 2);
      return;
    }
    this.aerodynamics.update(this.aircraft.cg, this.midpointQuaternion, this.midpointVelocity, this.torque);
    const speed = this.previousVelocity.length();
    this.velocity.copy(this.midpointVelocity).multiplyScalar(2).sub(this.previousVelocity);
    this.omega.copy(this.midpointOmega).multiplyScalar(2).sub(this.previousOmega);
    this.previousPosition.copy(this.position);
    this.position.copy(this.candidatePosition);
    this.quaternion.copy(this.candidateQuaternion);
    this.telemetry.dissipatedEnergy -= this.telemetry.aeroPower * dt;
    this.telemetry.propulsionWork += this.propulsionPower * dt;
    for (let i = 0; i < this.platformCount; i++) {
      const index = this.platformActive[i], normal = PLATFORM_NORMALS[this.platformFaces[index] % 6];
      const contactSpeed = normal.dot(this.midpointVelocity) + this.platformAxes[index].dot(this.midpointOmega);
      this.telemetry.dissipatedEnergy -= 2 * this.platformImpulses[index] * contactSpeed;
    }
    const timed = this.challenge === 'birdman' || this.raceStarted ? dt : 0;
    const scoringTime = !landing ? this.advanceChallenge(dt, timed) : timed;
    this.time += scoringTime;
    const currentSpeed = this.velocity.length();
    if (this.challenge === 'birdman' || this.raceStarted) this.travelled += (speed + currentSpeed) * 0.5 * scoringTime;
    if (this.challenge === 'low-altitude' && this.raceStarted && scoringTime > 0) this.updateLowAltitudeScore(scoringTime);
    this.maxSpeed = Math.max(this.maxSpeed, currentSpeed); this.minSpeed = Math.min(this.minSpeed, currentSpeed);
    this.maxHeight = Math.max(this.maxHeight, this.position.y);
    if (platformHit) { this.preparePlatformContacts(); this.resolvePlatformImpact(); }
    this.updateTelemetry();
    if (landing) this.finish(landing);
    else if (this.completed) this.finish('finish');
    else if (this.outsideChallenge()) this.finish('boundary');
  }

  /** 世界坐标转为坡面坐标；两侧板和槽底共用同一有限盒接触路径。 */
  private platformPoint(point: Vector3, position: Vector3, orientation: Quaternion, out: Vector3) {
    out.copy(point).sub(this.aircraft.cg).applyQuaternion(orientation).add(position);
    const x = out.x - LAUNCH.endX, y = out.y - LAUNCH.height;
    out.set(PLATFORM_COS * x - PLATFORM_SIN * y, PLATFORM_SIN * x + PLATFORM_COS * y, out.z);
  }

  private preparePlatformContacts() {
    this.platformCount = 0;
    this.platformFaces.fill(-1);
    if (this.challenge !== 'birdman') return;
    for (let point = 0; point < this.contacts.length; point++) {
      this.platformPoint(this.contacts[point], this.position, this.quaternion, this.platformStart);
      const p = this.platformStart;
      for (let box = 0; box < PLATFORM_BOXES.length; box++) {
        const index = point * PLATFORM_BOXES.length + box;
        const [low, high] = PLATFORM_BOXES[box];
        if (p.x < low.x - CONTACT_TOLERANCE || p.x > high.x + CONTACT_TOLERANCE
          || p.y < low.y - CONTACT_TOLERANCE || p.y > high.y + CONTACT_TOLERANCE
          || p.z < low.z - CONTACT_TOLERANCE || p.z > high.z + CONTACT_TOLERANCE) continue;
        let face = 0, gap = low.x - p.x;
        for (let axis = 0; axis < 3; axis++) {
          const value = p.getComponent(axis);
          if (low.getComponent(axis) - value > gap) { gap = low.getComponent(axis) - value; face = axis * 2; }
          if (value - high.getComponent(axis) > gap) { gap = value - high.getComponent(axis); face = axis * 2 + 1; }
        }
        this.platformFaces[index] = box * 6 + face;
        this.platformGaps[index] = gap;
        this.platformActive[this.platformCount++] = index;
      }
    }
  }

  /** 无摩擦、完全非弹性冲量；每次冲量的动能损失直接进入耗散账本。 */
  private resolvePlatformImpact() {
    const mass = this.aircraft.mass, inertia = this.aircraft.inertia;
    this.inverse.copy(this.quaternion).invert();
    for (let iteration = 0; iteration < 32; iteration++) {
      let closing = false;
      for (let i = 0; i < this.platformCount; i++) {
        const index = this.platformActive[i], normal = PLATFORM_NORMALS[this.platformFaces[index] % 6];
        this.arm.copy(this.contacts[Math.floor(index / PLATFORM_BOXES.length)]).sub(this.aircraft.cg);
        this.contactNormal.copy(normal).applyQuaternion(this.inverse);
        this.cross.crossVectors(this.arm, this.contactNormal);
        const speed = this.velocity.dot(normal) + this.cross.dot(this.omega);
        if (speed >= -1e-10) continue;
        const inverseMass = 1 / mass + this.cross.x ** 2 / inertia.x + this.cross.y ** 2 / inertia.y + this.cross.z ** 2 / inertia.z;
        const impulse = -speed / inverseMass;
        this.velocity.addScaledVector(normal, impulse / mass);
        this.omega.x += impulse * this.cross.x / inertia.x;
        this.omega.y += impulse * this.cross.y / inertia.y;
        this.omega.z += impulse * this.cross.z / inertia.z;
        this.telemetry.dissipatedEnergy += -(impulse * speed + 0.5 * impulse ** 2 * inverseMass);
        closing = true;
      }
      if (!closing) break;
    }
  }

  /** 离散接触雅可比与四元数位移一致，约束功等于真实机械能变化。 */
  private constrainPlatformMidpoint(dt: number) {
    if (!this.platformCount) return;
    const mass = this.aircraft.mass, inertia = this.aircraft.inertia;
    const halfAngle = this.midpointOmega.length() * dt / 2;
    const sinc = halfAngle > 1e-8 ? Math.sin(halfAngle) / halfAngle : 1 - halfAngle ** 2 / 6;
    this.inverse.copy(this.midpointQuaternion).invert();
    for (let i = 0; i < this.platformCount; i++) {
      const index = this.platformActive[i];
      this.arm.copy(this.contacts[Math.floor(index / PLATFORM_BOXES.length)]).sub(this.aircraft.cg);
      this.contactNormal.copy(PLATFORM_NORMALS[this.platformFaces[index] % 6]).applyQuaternion(this.inverse);
      this.platformAxes[index].crossVectors(this.arm, this.contactNormal).multiplyScalar(sinc);
      this.platformImpulses[index] = 0;
    }
    for (let iteration = 0; iteration < 128; iteration++) {
      let change = 0;
      for (let i = 0; i < this.platformCount; i++) {
        const index = this.platformActive[i], axis = this.platformAxes[index], normal = PLATFORM_NORMALS[this.platformFaces[index] % 6];
        const speed = normal.dot(this.candidateVelocity) + axis.dot(this.candidateOmega);
        const inverseMass = 1 / mass + axis.x ** 2 / inertia.x + axis.y ** 2 / inertia.y + axis.z ** 2 / inertia.z;
        const previous = this.platformImpulses[index];
        const impulse = Math.max(0, previous + (-Math.max(0, this.platformGaps[index]) / dt - speed) / inverseMass);
        const delta = impulse - previous;
        this.platformImpulses[index] = impulse;
        this.candidateVelocity.addScaledVector(normal, delta / mass);
        this.candidateOmega.x += delta * axis.x / inertia.x;
        this.candidateOmega.y += delta * axis.y / inertia.y;
        this.candidateOmega.z += delta * axis.z / inertia.z;
        change = Math.max(change, Math.abs(delta));
      }
      if (change < 1e-12) break;
    }
  }

  /** 逐采样点做线段/长方体扫掠，能检测一帧内完全穿过薄板的情况。 */
  private sweepsPlatform() {
    for (let index = 0; index < this.contacts.length; index++) {
      this.platformPoint(this.contacts[index], this.position, this.quaternion, this.platformStart);
      this.platformPoint(this.contacts[index], this.candidatePosition, this.candidateQuaternion, this.platformEnd);
      for (let box = 0; box < PLATFORM_BOXES.length; box++) {
        if (this.platformFaces[index * PLATFORM_BOXES.length + box] >= 0) continue;
        const [low, high] = PLATFORM_BOXES[box];
        let entry = 0, exit = 1;
        for (let axis = 0; axis < 3; axis++) {
          const start = this.platformStart.getComponent(axis), delta = this.platformEnd.getComponent(axis) - start;
          if (Math.abs(delta) < 1e-15) {
            if (start < low.getComponent(axis) || start > high.getComponent(axis)) { entry = Infinity; break; }
          } else {
            const a = (low.getComponent(axis) - start) / delta, b = (high.getComponent(axis) - start) / delta;
            entry = Math.max(entry, Math.min(a, b));
            exit = Math.min(exit, Math.max(a, b));
          }
        }
        if (entry <= exit && exit >= 0 && entry <= 1) return true;
      }
    }
    return false;
  }

  /** 按真实接受的积分段穿过门面，不按径向距离或最终位置授予检查点。 */
  private advanceChallenge(dt: number, timed: number): number {
    const gate = this.raceStarted ? challengeCheckpoints(this.challenge)[this.checkpointIndex] : challengeStartGate(this.challenge);
    if (!gate || this.previousPosition.x >= gate.x || this.position.x < gate.x) return timed;
    const fraction = (gate.x - this.previousPosition.x) / (this.position.x - this.previousPosition.x);
    const z = this.previousPosition.z + (this.position.z - this.previousPosition.z) * fraction;
    const y = this.previousPosition.y + (this.position.y - this.previousPosition.y) * fraction;
    if (Math.abs(z - gate.z) > gate.halfWidth || y < gate.y + gate.minHeight || y > gate.y + gate.maxHeight) return timed;
    if (!this.raceStarted) {
      this.raceStarted = true;
      this.farthestX = gate.x;
      this.travelled = 0;
      return dt * (1 - fraction);
    }
    this.checkpointIndex++;
    this.completed = this.checkpointIndex === challengeCheckpoints(this.challenge).length;
    return timed;
  }

  private updateLowAltitudeScore(dt: number) {
    const clearance = this.position.y - challengeCollisionHeight(this.challenge, this.position.x, this.position.z);
    if (clearance > LOW_ALTITUDE.scoringHeight) {
      this.aboveHeightTime += dt;
      this.heightPenalty += (LOW_ALTITUDE.penaltyPerSecond + LOW_ALTITUDE.sustainedPenalty * (this.aboveHeightStreak + dt / 2)) * dt;
      this.aboveHeightStreak += dt;
    } else {
      this.aboveHeightStreak = 0;
    }
    if (!this.outsideChallenge()) {
      const x = clamp(this.position.x, challengeStartGate(this.challenge)!.x, challengeDefinitions['low-altitude'].length);
      const distance = Math.max(0, x - Math.max(this.farthestX, this.previousPosition.x));
      this.lowAltitudeDistance += distance * clamp(1 - clearance / LOW_ALTITUDE.scoringHeight, 0, 1);
      this.farthestX = Math.max(this.farthestX, x);
    }
  }

  private outsideChallenge() {
    if (this.challenge === 'birdman') return Math.abs(this.position.x) >= 2000 || Math.abs(this.position.z) >= 800 || this.position.y >= 300;
    const { x, y, z } = this.position;
    const next = this.raceStarted ? challengeCheckpoints(this.challenge)[this.checkpointIndex] : challengeStartGate(this.challenge);
    // 两种航线均须顺序过门；低空超高扣分而非直接淘汰。
    const downhill = this.challenge === 'downhill';
    return x < challengeLaunch(this.challenge)!.startX - 50 || x > challengeDefinitions[this.challenge].length + 100
      || Math.abs(z - challengeCenter(this.challenge, x)) > (downhill ? 65 : 100)
      || y - challengeCollisionHeight(this.challenge, x, z) > (downhill ? 125 : 1000)
      || (next != null && x > next.x);
  }

  /** 分片平面上，端点与X、Z、X+Z网格线交点包含线段净空的所有极小值。 */
  private sweepsTerrain() {
    const step = challengeTerrainGrid.step;
    for (const point of this.contacts) {
      this.platformStart.copy(point).sub(this.aircraft.cg).applyQuaternion(this.quaternion).add(this.position);
      this.platformEnd.copy(point).sub(this.aircraft.cg).applyQuaternion(this.candidateQuaternion).add(this.candidatePosition);
      const a = this.platformStart, b = this.platformEnd;
      if (this.sweepsLaunchBox(a, b) || this.sweepsRiver(a, b)) return true;
      if (b.y <= challengeCollisionHeight(this.challenge, b.x, b.z)) return true;
      for (let axis = 0; axis < 3; axis++) {
        const start = axis === 0 ? a.x : axis === 1 ? a.z : a.x + a.z;
        const end = axis === 0 ? b.x : axis === 1 ? b.z : b.x + b.z;
        const delta = end - start;
        if (Math.abs(delta) < 1e-12) continue;
        const low = Math.floor(Math.min(start, end) / step) + 1;
        const high = Math.floor(Math.max(start, end) / step);
        for (let line = low; line <= high; line++) {
          const fraction = (line * step - start) / delta;
          const x = a.x + (b.x - a.x) * fraction, z = a.z + (b.z - a.z) * fraction;
          const y = a.y + (b.y - a.y) * fraction;
          if (y <= challengeCollisionHeight(this.challenge, x, z)) return true;
        }
      }
    }
    return false;
  }

  private sweepsRiver(a: Vector3, b: Vector3): boolean {
    if (this.challenge !== 'low-altitude') return false;
    const step = challengeTerrainGrid.step, dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
    for (let slab = Math.floor(Math.min(a.x, b.x) / step); slab <= Math.floor(Math.max(a.x, b.x) / step); slab++) {
      const first = dx === 0 ? 0 : (slab * step - a.x) / dx;
      const last = dx === 0 ? 1 : ((slab + 1) * step - a.x) / dx;
      const start = Math.max(0, Math.min(first, last)), end = Math.min(1, Math.max(first, last));
      if (start > end) continue;
      const offset = a.z + dz * start - challengeRiverCenter(a.x + dx * start);
      const change = a.z + dz * end - challengeRiverCenter(a.x + dx * end) - offset;
      let entry = 0, exit = 1;
      if (Math.abs(change) < 1e-15) {
        if (Math.abs(offset) > CHALLENGE_RIVER.width / 2) continue;
      } else {
        const low = (-CHALLENGE_RIVER.width / 2 - offset) / change;
        const high = (CHALLENGE_RIVER.width / 2 - offset) / change;
        entry = Math.max(0, Math.min(low, high)); exit = Math.min(1, Math.max(low, high));
      }
      if (entry > exit) continue;
      const enterTime = start + (end - start) * entry, exitTime = start + (end - start) * exit;
      if (a.y + dy * enterTime <= challengeRiverHeight(a.x + dx * enterTime)
        || a.y + dy * exitTime <= challengeRiverHeight(a.x + dx * exitTime)) return true;
    }
    return false;
  }

  /** 与场景共用的有限起飞台/跑道盒；线段裁剪也捕获高速穿过侧边和底部。 */
  private sweepsLaunchBox(a: Vector3, b: Vector3): boolean {
    const launch = challengeLaunch(this.challenge);
    if (!launch) return false;
    let entry = 0, exit = 1;
    for (let axis = 0; axis < 3; axis++) {
      const low = axis === 0 ? launch.startX : axis === 1 ? launch.y - launch.thickness : launch.z - launch.width / 2;
      const high = axis === 0 ? launch.endX : axis === 1 ? launch.y : launch.z + launch.width / 2;
      const start = a.getComponent(axis), delta = b.getComponent(axis) - start;
      if (Math.abs(delta) < 1e-15) {
        if (start < low || start > high) return false;
      } else {
        const first = (low - start) / delta, last = (high - start) / delta;
        entry = Math.max(entry, Math.min(first, last));
        exit = Math.min(exit, Math.max(first, last));
      }
    }
    return entry <= exit && exit >= 0 && entry <= 1;
  }

  private updateTelemetry() {
    const t = this.telemetry;
    t.speed = this.velocity.length(); t.altitude = this.position.y;
    t.distance = this.challenge === 'birdman' ? (this.launching ? 0 : this.tailDistance()) : this.raceStarted ? this.travelled : 0;
    t.groundClearance = this.position.y - challengeCollisionHeight(this.challenge, this.position.x, this.position.z);
    t.challengeProgress = this.challenge !== 'birdman' ? this.checkpointIndex / challengeCheckpoints(this.challenge).length : 0;
    t.completed = this.completed;
    t.timingStarted = this.challenge === 'birdman' || this.raceStarted;
    t.score = this.challenge === 'birdman' ? t.distance : this.challenge === 'low-altitude'
      ? (this.time > 0 ? LOW_ALTITUDE.scoreScale * this.lowAltitudeDistance / this.time : 0) - this.heightPenalty : this.completed ? this.time : 0;
    t.throttle = this.definition.engine.count > 0 ? this.effective.throttle ?? 0 : 0;
    t.engineRpm = this.engineRpm; t.fuelRemaining = this.fuelRemaining; t.thrust = this.thrust;
    t.aboveHeightTime = this.aboveHeightTime;
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    t.energyPerDistance = !this.launching && horizontalSpeed > 0.05 ? -t.aeroPower / horizontalSpeed : null;
    this.inverse.copy(this.quaternion).invert();
    this.bodyVelocity.copy(this.velocity).applyQuaternion(this.inverse);
    t.alpha = Math.atan2(-this.bodyVelocity.y, this.bodyVelocity.x) + this.definition.assembly.mainIncidence * DEG;
    this.cross.set(1, 0, 0).applyQuaternion(this.quaternion);
    t.pitch = Math.atan2(this.cross.y, Math.hypot(this.cross.x, this.cross.z));
    const q = this.quaternion;
    t.roll = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x ** 2 + q.y ** 2));
    t.sink = -this.velocity.y;
    t.glide = t.sink > 0.05 ? horizontalSpeed / t.sink : 0;
    t.stall = !this.launching && (t.alpha > 12 * DEG || t.alpha < -6 * DEG);
    t.mass = this.aircraft.mass; t.staticMargin = this.aircraft.staticMargin;
    const inertia = this.aircraft.inertia;
    t.potentialEnergy = this.aircraft.mass * GRAVITY * this.position.y;
    t.kineticEnergy = 0.5 * this.aircraft.mass * this.velocity.lengthSq()
      + 0.5 * (inertia.x * this.omega.x ** 2 + inertia.y * this.omega.y ** 2 + inertia.z * this.omega.z ** 2);
    t.energy = t.potentialEnergy + t.kineticEnergy;
  }

  private landingAt(position: Vector3, orientation: Quaternion): FlightResult['landing'] | null {
    for (const point of this.contacts) {
      this.cross.copy(point).sub(this.aircraft.cg).applyQuaternion(orientation).add(position);
      const height = challengeCollisionHeight(this.challenge, this.cross.x, this.cross.z);
      if (this.cross.y <= height) {
        return this.challenge === 'birdman' || (this.challenge === 'low-altitude' && height === challengeRiverHeight(this.cross.x)) ? 'water' : 'terrain';
      }
      if (this.sweepsLaunchBox(this.cross, this.cross)) return 'terrain';
    }
    return null;
  }

  private tailDistance() {
    const x = this.position.x - LAUNCH.endX, z = this.position.z, radius = Math.hypot(x, z);
    if (radius < 1e-9) return 0;
    let distance = Infinity;
    for (const point of this.contacts) {
      this.cross.copy(point).sub(this.aircraft.cg).applyQuaternion(this.quaternion);
      distance = Math.min(distance, radius + (this.cross.x * x + this.cross.z * z) / radius);
    }
    return Math.max(0, distance);
  }

  private finish(landing: FlightResult['landing']) {
    this.ended = true;
    this.result = { distance: this.telemetry.distance, time: this.time, averageSpeed: this.time > 0 ? this.travelled / this.time : 0,
      maxSpeed: this.maxSpeed, minSpeed: this.minSpeed, maxHeight: this.maxHeight, landing,
      challenge: this.challenge, score: this.telemetry.score, completed: this.completed };
  }
}
