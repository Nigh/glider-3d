import { Matrix3, Quaternion, Vector3 } from 'three';
import { AIRFRAME_MASS, BODY_GEOMETRY, clamp, cockpitGeometry, cockpitMass, DEG, engineMounts, fuelTankDimensions, fuselageEnds, mainWingSupport, PILOT_MASS, planform, validateAircraft, wingLocalPoint, wingOrigin, type AircraftDefinition, type BodyEllipsoid, type Controls, type EngineMount, type Wing, type WingKey } from './model';
import { challengeGateBlocked, hitsChallengeRuin, downhillRuins, CHALLENGE_RIVER, challengeCenter, challengeCheckpoints, challengeCollisionHeight, challengeDefinitions, challengeLaunch, challengeRiverCenter, challengeRiverHeight, challengeStartGate, challengeTerrainGrid, challengeTerrainHeight, LOW_ALTITUDE, LOW_ALTITUDE_RAIL, type ChallengeMode } from './challenges';
import { lowAltitudeRailSample, type LowAltitudeRailSample } from './challenges';
import { engineCatalog, engineDensityRatio, engineThrustFactor, FUEL_DENSITY } from './engines';
import { rotationalEnergy, setInertia, WingStructure, type SectionContactLoad, type StructuralBody, type WingFragment } from './structure';
import { advanceWindTunnel, createWindTunnelMotion, defaultTestSpace, defaultWindTunnel, isLaboratory, TEST_SPACE, testCatapultSample, testSpaceLaunch, testSpaceSettings, windTunnelRoom, windTunnelSettings, type TestSpaceSettings, type WindTunnelSettings } from './laboratory';
import { mixTrim } from './trim';
import { mixControlSurfaces, type MixingSurface } from './control-mixing';

export const GRAVITY = 9.81;
/** Production clock; diagnostic step(dt) calls share this overload interval. */
export const PHYSICS_TICK = 1 / 60;
/** Quasi-static impact proxy, calibrated to the default 60 Hz interval; not measured contact duration. */
export const STRUCTURAL_IMPACT_DURATION = PHYSICS_TICK;
export const AIR_DENSITY = 1.225;
/** 静水工程近似；薄翼排水量不代表密封浮筒，机身仅保留部分有效排水体积。 */
export const WATER = {
  density: 1000, stopSpeed: 1.5, wingDragCoefficient: 0.8, wingEdgeDrag: 0.02,
  wingThicknessRatio: 0.105, wingVolumeRatio: 0.012,
  bodyDragCoefficient: 0.65, bodyBuoyancyFraction: 0.2, bodySamples: 5,
} as const;
/** 官方跑道几何；10 m/s 离台速度与两秒匀加速是游戏假设，不是官方速度。 */
export const LAUNCH = { length: 10, slope: 3.5 * DEG, startX: -10 * Math.cos(3.5 * DEG), endX: 0, height: 10, speed: 10, acceleration: 5 } as const;
export function runwayHeight(x: number) { return LAUNCH.height - x * Math.tan(LAUNCH.slope); }
/** 与可见坡面共用的有限厚度刚性平台，尺寸为游戏近似。 */
export const PLATFORM = { thickness: 0.6, width: 13, slotWidth: 0.6, slotDepth: 0.305, slotFloorThickness: 0.15 } as const;
const PLATFORM_COS = Math.cos(LAUNCH.slope), PLATFORM_SIN = Math.sin(LAUNCH.slope);
const CONTACT_SLOTS = 5; // three launcher boxes, terrain, ruin
const CONTACT_TOLERANCE = 2e-6;
// Dry sliding contact of airframe/wing skin against ground, not rail rolling resistance.
export const GROUND_FRICTION = 0.35;
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
const RUNWAY_NORMALS = [
  new Vector3(-1, 0, 0), new Vector3(1, 0, 0), new Vector3(0, -1, 0),
  new Vector3(0, 1, 0), new Vector3(0, 0, -1), new Vector3(0, 0, 1),
];
const LOW_RUNWAY = challengeLaunch('low-altitude')!;
const DOWNHILL_LAUNCH = challengeLaunch('downhill')!;
const DOWNHILL_BOXES = [[new Vector3(-DOWNHILL_LAUNCH.length, -DOWNHILL_LAUNCH.thickness, -DOWNHILL_LAUNCH.width / 2), new Vector3(0, 0, DOWNHILL_LAUNCH.width / 2)]];
const RUNWAY_BOXES = [[new Vector3(-LOW_RUNWAY.length, -LOW_RUNWAY.thickness, -LOW_RUNWAY.width / 2),
  new Vector3(0, 0, LOW_RUNWAY.width / 2)]];
/** 整段助跑逐渐施加的滚转扰动上限（rad）。 */
export const LAUNCH_ROLL_LIMIT = DEG;
export const SURFACE_STEP = 0.8;
const AIR_VISCOSITY = 1.46e-5;
const SPAN_EFFICIENCY = 0.9;
/** 尾梁等未解析机体阻力面积；驾驶舱壳体和座舱罩另按可见尺寸计算。 */
const BODY_DRAG_AREA = 0.07;
/**
 * DAE-11原型，XFOIL6.96/Mach0/Ncrit9预测，非TAKUMI-11实测。
 * 每行 alpha[deg], CL500k, CD500k, CL1M, CD1M；垂尾去除升力偏置后作对称代理。
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
/** UIUC DAE-11 camber-line thin-airfoil integral; not measured/XFOIL Cm. */
export const SECTION_QUARTER_CHORD_CM = -0.12711943970034684;
export const MAX_FRAMES = 36_000;
export const FRAME_WIDTH = 12;
const ZERO_CONTROLS: Controls = { weight: 0, lateral: 0, rudder: 0, elevator: 0, aileron: 0, throttle: 0 };
const AILERON_LIMIT = 18 * DEG, HORIZONTAL_LIMIT = 22 * DEG, RUDDER_LIMIT = 15 * DEG;
/** 标准化舵量每秒最多变化1.25，减少高载荷下结构/操纵反馈的激励。 */
export const CONTROL_SURFACE_RATE = 1.25;
const CONTROL_AXES = ['aileron', 'elevator', 'rudder'] as const;
const ADAPTIVE_STRESS_TARGET = 0.9;

export interface FlightControls extends Controls {
  autoTrim?: boolean;
  adaptiveControls?: boolean;
  smartMixing?: boolean;
  trimPitch?: number;
  trimRoll?: number;
}

export interface AircraftProperties {
  mass: number;
  cg: Vector3;
  inertia: Vector3;
  wingArea: number;
  /** 完整机体轴惯量张量；inertia 保留对角分量供现有参数显示。 */
  inertiaTensor: Matrix3;
  inverseInertia: Matrix3;
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
interface MassPart { mass: number; x: number; y: number; z: number; ix: number; iy: number; iz: number; ixy?: number; ixz?: number; iyz?: number; sectionId?: number; moving?: boolean; fuel?: boolean; wingSupport?: boolean }
interface ContactPoint extends Vector3 { sectionId?: number; tip?: boolean; reference?: Vector3 }
interface Polar { cl: number; cd: number; inducedCd: number; profileCd: number; cm: number }
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
export interface AerodynamicSurface extends MixingSurface {
  name: string;
  bodyId: number;
  point: Vector3;
  force: Vector3;
  drag: Vector3;
  /** World axes after force evaluation; body axes during strip calculation. */
  moment: Vector3;
  area: number;
  aspect: number;
  span: number;
  chord: number;
  spanStart: number;
  spanEnd: number;
  spanDirection: Vector3;
  chordDirection: Vector3;
  crossflowDirection: Vector3;
  /** 四分之一弦后掠角，rad；前掠为负。 */
  sweep: number;
  /** 世界作用点相对水面 Y=0 的净空；设计参考为 Infinity。 */
  clearance: number;
  groundEffect: number;
  /** Fluid velocity from other lifting wings, in the owning body's coordinates. */
  inducedFlow: Vector3;
  localFlow: Vector3;
  localOmega: Vector3;
  airFraction: number;
  circulation: number;
  nextCirculation: number;
  inducedDrag: number;
  normal: Vector3;
  incidence: number;
  controlEffectiveness: number;
  /** Actual independent actuator state, normalized to this wing's travel limit. */
  controlCommand: number;
  controlProjection: Vector3;
  controlMoment: Vector3;
  kind: 'main' | 'tail' | 'vertical';
  side: number;
  alpha: number;
}
export interface FlightResult {
  maxG: number;
  distance: number;
  time: number;
  averageSpeed: number;
  maxSpeed: number;
  minSpeed: number;
  maxHeight: number;
  landing: 'water' | 'terrain' | 'boundary' | 'finish' | 'manual';
  takeoffHeight?: number; takeoffSpeed?: number; platformHeight?: number;
  challenge: ChallengeMode; score: number; completed: boolean; checkpointScores: number[]; speedScore: number; heightPenalty: number;
}
export interface FlightTelemetry {
  /** Proper acceleration magnitude at the CG, including launch/support loads; 1 G at rest. */
  gForce: number;
  /** World-axis proper acceleration, including gravity-balanced support and impacts. */
  specificForce: Vector3;
  speed: number; altitude: number; distance: number;
  alpha: number; pitch: number; roll: number; sink: number; glide: number;
  stall: boolean; physicsMs: number; cg: Vector3; mass: number;
  force: Vector3; drag: Vector3; torque: Vector3;
  /** 空气和水阻的总耗散功率（非正）；不包含浮力功。 */
  aeroPower: number; energy: number; staticMargin: number;
  energyPerDistance: number | null;
  potentialEnergy: number; kineticEnergy: number; dissipatedEnergy: number; initialEnergy: number;
  liftDragRatio: number;
  aerodynamics: AerodynamicReference;
  challengeProgress: number; groundClearance: number; score: number; completed: boolean; timingStarted: boolean;
  /** 侧向移动改变惯量时，驾驶员克服/吸收转动能所做的真实功；前后仍用原准静态近似。 */
  controlWork: number;
  throttle: number; engineRpm: number; fuelRemaining: number; thrust: number; aboveHeightTime: number;
  autoTrim: boolean; adaptiveControls: boolean; smartMixing: boolean; trimPitch: number; trimRoll: number; controlLimit: number;
  controlInputs: { weight: number; lateral: number; elevator: number; aileron: number; rudder: number };
  propulsionWork: number;
  /** 燃油排出带走的机械能；不含燃料化学能。 */
  fuelEnergyRemoved: number;
  waterContact: boolean;
  /** 主体仍连接的几何接触点，世界坐标；未触水时归零，不使用CG替代。 */
  waterContactPoint: Vector3;
  /** 累计浮力功，可正可负；列于能量预算输入侧。 */
  waterWork: number;
}
/** One second bounds seek integration while template deltas avoid repeated geometry. */
export const REPLAY_KEYFRAME_INTERVAL = 1;
type SnapshotValue = number | string | boolean | null | [number];
type SnapshotNode = [string, string[], SnapshotValue[]];
export interface SimulationSnapshot { binding: string; changes: [number, (number | string | SnapshotValue)[]][]; extra: SnapshotNode[] }
export interface ReplayKeyframe { time: number; frame: number; state: SimulationSnapshot }
export interface InputRecording { frames: Float64Array; length: number; launchRoll: number; wingLoads?: Float64Array; keyframes?: ReplayKeyframe[] }

export function validateRecording(recording: InputRecording): void {
  if (!(recording.frames instanceof Float64Array) || !Number.isInteger(recording.length) || recording.length < 0 || recording.length > MAX_FRAMES || recording.frames.length !== recording.length * FRAME_WIDTH) throw new Error('飞行记录长度无效');
  if (recording.wingLoads !== undefined && (!(recording.wingLoads instanceof Float64Array) || recording.wingLoads.length !== recording.length * 3 || recording.wingLoads.some(value => !Number.isFinite(value) || value < 0))) throw new Error('飞行记录包含无效负载');
  if (!Number.isFinite(recording.launchRoll) || Math.abs(recording.launchRoll) > LAUNCH_ROLL_LIMIT) throw new Error('飞行记录离台滚转角无效');
  for (let i = 0; i < recording.frames.length; i++) {
    const value = recording.frames[i], field = i % FRAME_WIDTH;
    const valid = field === 0 ? value > 0 && value <= 0.25
      : field === 7 || field === 8 || field === 11 ? value === 0 || value === 1
      : field === 6 ? value >= 0 && value <= 1 : Math.abs(value) <= 1;
    if (!Number.isFinite(value) || !valid) throw new Error('飞行记录包含无效输入');
  }
  if (recording.keyframes !== undefined) {
    if (!Array.isArray(recording.keyframes) || recording.keyframes.length > recording.length + 1) throw Error('回放关键帧无效');
    let frame = -1, time = -1, elapsed = 0, index = 0;
    for (const point of recording.keyframes) {
      if (!point || !Number.isInteger(point.frame) || point.frame <= frame || point.frame > recording.length || !Number.isFinite(point.time) || point.time < 0 || point.time <= time) throw Error('回放关键帧无效');
      while (index < point.frame) elapsed += recording.frames[index++ * FRAME_WIDTH];
      if (Math.abs(elapsed - point.time) > 1e-8 || !point.state || !Array.isArray(point.state.changes) || !Array.isArray(point.state.extra)) throw Error('回放关键帧无效');
      frame = point.frame; time = point.time;
    }
    if (recording.length && (!recording.keyframes.length || recording.keyframes[0].frame !== 0 || recording.keyframes.at(-1)!.frame !== recording.length)) throw Error('回放关键帧缺少端点状态');
    const frames = new Set(recording.keyframes.map(point => point.frame));
    let total = 0, next = REPLAY_KEYFRAME_INTERVAL;
    for (let i = 0; i < recording.length; i++) {
      total += recording.frames[i * FRAME_WIDTH];
      if (total + 1e-9 >= next) {
        if (!frames.has(i + 1)) throw Error('回放关键帧间隔无效');
        next = (Math.floor((total + 1e-9) / REPLAY_KEYFRAME_INTERVAL) + 1) * REPLAY_KEYFRAME_INTERVAL;
      }
    }
  }
}

function quarterChord(w: Wing) {
  const p = planform(w);
  const fraction = (p.root + 2 * p.tip) / (3 * (p.root + p.tip));
  return w.points[0].x + (w.points[1].x - w.points[0].x) * fraction
    + (p.root + (p.tip - p.root) * fraction) * 0.25;
}

function sweepAngle(w: Wing) {
  const root = w.points[3].x - w.points[0].x, tip = w.points[2].x - w.points[1].x;
  return Math.atan2(w.points[1].x - w.points[0].x + (tip - root) / 4, Math.abs(w.points[1].y));
}

function massLayout(d: AircraftDefinition): MassPart[] {
  const length = d.fuselage.length;
  const fuselageMass = AIRFRAME_MASS.fuselageLinear * length;
  const shell = cockpitGeometry(d), cabinMass = cockpitMass(d);
  const parts: MassPart[] = [
    { mass: fuselageMass, x: d.fuselage.center - 0.13 * length, y: 0, z: 0, ix: fuselageMass * 0.04, iy: fuselageMass * length * length / 12, iz: fuselageMass * length * length / 12 },
    // 鸟人间保留座架代理；只有可见驾驶舱按同尺寸均匀椭球近似。
    d.birdman ? { mass: cabinMass, x: d.cockpit.position, y: 0.12, z: 0, ix: 0.1, iy: 0.2, iz: 0.2 }
      : { mass: cabinMass, x: d.cockpit.position + shell.x, y: shell.y, z: 0,
        ix: cabinMass * (shell.yRadius ** 2 + shell.zRadius ** 2) / 5,
        iy: cabinMass * (shell.xRadius ** 2 + shell.zRadius ** 2) / 5,
        iz: cabinMass * (shell.xRadius ** 2 + shell.yRadius ** 2) / 5 },
    // 趴姿只改变显示网格；乘员仍用此固定质点和局部惯量近似，不引入关节运动功。
    { mass: PILOT_MASS, x: d.cockpit.position, y: 0.15, z: 0, ix: PILOT_MASS * 0.08, iy: PILOT_MASS * 0.025, iz: PILOT_MASS * 0.08, moving: true },
  ];
  const structure = new WingStructure(d, makeSurfaces(d));
  for (const section of structure.sections) {
    const e = section.inertia.elements;
    parts.push({ mass: section.mass, x: section.center.x, y: section.center.y, z: section.center.z,
      ix: e[0], iy: e[4], iz: e[8], ixy: e[3], ixz: e[6], iyz: e[7], sectionId: section.id });
  }
  const support = mainWingSupport(d);
  if (support.mass > 0) {
    // 均匀斜边竖板：弦向斜率与安装角一致，正负安装高度共用同一质量分布。
    const vx = support.width ** 2 / 12;
    const vy = ((support.frontY - support.backY) ** 2 + support.height ** 2) / 12;
    parts.push({ mass: support.mass, x: support.x, y: support.y, z: 0, wingSupport: true,
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
      parts.push({ mass, x: tank.x, y: shell.y, z: 0, ix: mass * 2 * radius2 / 5,
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
  const center = p.span / 2 * (p.root + 2 * p.tip) / (3 * (p.root + p.tip));
  const mainQuarterChord = wingLocalPoint(d.mainWing, mainAngle, 1, -mainQuarter, 0, center, new Vector3());
  mainQuarterChord.x += mainOrigin.x; mainQuarterChord.y += mainOrigin.y; mainQuarterChord.z = 0;
  const mainX = mainQuarterChord.x;
  const tailCenter = tail.span / 2 * (tail.root + 2 * tail.tip) / (3 * (tail.root + tail.tip));
  const tailX = tailOrigin.x + wingLocalPoint(d.horizontalTail, d.assembly.tailIncidence * DEG, 1, -quarterChord(d.horizontalTail), 0, tailCenter, new Vector3()).x;
  const mainSlope = 1 / (1 + 6.45 / (Math.PI * SPAN_EFFICIENCY * p.aspect)) * Math.cos(sweepAngle(d.mainWing));
  const tailSlopeRatio = 1 / (1 + 6.45 / (Math.PI * SPAN_EFFICIENCY * tail.aspect)) * Math.cos(sweepAngle(d.horizontalTail)) / mainSlope;
  const effectiveness = 0.65 * tail.area / p.area * tailSlopeRatio;
  const neutral = (mainX + effectiveness * tailX) / (1 + effectiveness);
  return { mass: 0, cg: new Vector3(), inertia: new Vector3(), inertiaTensor: new Matrix3(), inverseInertia: new Matrix3(), wingArea: p.area, span: p.span, aspect: p.aspect,
    wingLoading: 0, stallSpeed: 0, glideRatio: 0, staticMargin: 0,
    mainQuarterChord,
    neutralPoint: neutral, aerodynamics: new AerodynamicSummary(makeSurfaces(d), d) };
}

function updateMass(d: AircraftDefinition, parts: MassPart[], weight: number, out: AircraftProperties, neutral: number, chord: number, updateInertia = true, lateral = 0, structure?: WingStructure) {
  let mass = 0, x = 0, y = 0, z = 0;
  for (const p of parts) {
    if (p.sectionId !== undefined && structure && structure.sections[p.sectionId].bodyId !== 0) continue;
    const px = p.x + (p.moving ? weight * d.controls.travel : 0);
    mass += p.mass; x += p.mass * px; y += p.mass * p.y; z += p.mass * (p.z + (p.moving ? lateral * d.controls.lateralTravel : 0));
  }
  out.mass = mass;
  out.cg.set(x / mass, y / mass, z / mass);
  out.wingLoading = mass / out.wingArea;
  out.staticMargin = (out.cg.x - neutral) / chord;
  if (!updateInertia) return;
  let ix = 0, iy = 0, iz = 0, ixy = 0, ixz = 0, iyz = 0;
  for (const p of parts) {
    if (p.sectionId !== undefined && structure && structure.sections[p.sectionId].bodyId !== 0) continue;
    const dx = p.x + (p.moving ? weight * d.controls.travel : 0) - out.cg.x;
    const dy = p.y - out.cg.y, dz = p.z + (p.moving ? lateral * d.controls.lateralTravel : 0) - out.cg.z;
    ix += p.ix + p.mass * (dy * dy + dz * dz);
    iy += p.iy + p.mass * (dx * dx + dz * dz);
    iz += p.iz + p.mass * (dx * dx + dy * dy);
    ixy += (p.ixy ?? 0) - p.mass * dx * dy;
    ixz += (p.ixz ?? 0) - p.mass * dx * dz;
    iyz += (p.iyz ?? 0) - p.mass * dy * dz;
  }
  out.inertia.set(ix, iy, iz);
  setInertia(out.inertiaTensor, ix, iy, iz, ixy, ixz, iyz);
  out.inverseInertia.copy(out.inertiaTensor).invert();
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
  const finiteWing = 1 / (1 + groundEffect * 6.45 / (Math.PI * SPAN_EFFICIENCY * Math.max(aspect, 0.1)));
  const outside = cambered && degrees < -6 ? (-degrees - 6) / 29 : (Math.abs(degrees) - 17) / 18;
  const blend = clamp(outside, 0, 1), separated = blend * blend * (3 - 2 * blend);
  out.cl = (1 - separated) * sectionCl * finiteWing + separated * 1.05 * Math.sin(2 * alpha);
  // 完全分离后改用下方平板阻力，避免弯度表两端在±π反向来流处造成跳变。
  out.profileCd = (1 - separated) * (cdLow + re * (cdHigh - cdLow)) / lowRe ** 0.75;
  out.inducedCd = groundEffect * out.cl ** 2 / (Math.PI * Math.max(aspect, 0.1) * SPAN_EFFICIENCY);
  out.cd = out.profileCd + out.inducedCd + separated * (1.7 * Math.sin(alpha) ** 2 + 0.3 * (1 - Math.cos(alpha)) ** 2);
  out.cm = cambered ? (1 - separated) * SECTION_QUARTER_CHORD_CM : 0;
  return out;
}

/** 有限翼系数；Re默认500k。cambered=false为对称垂尾工程代理，不是DAE-11风洞结果。 */
export function coefficients(alpha: number, aspect: number, reynolds = 500_000, cambered = true): Polar {
  return polar(alpha, aspect, { cl: 0, cd: 0, inducedCd: 0, profileCd: 0, cm: 0 }, 1, reynolds, cambered);
}

/**
 * 有限翼近地诱导阻力近似 φ=(16h/b)²/(1+(16h/b)²)，不是目标升阻比拟合。
 * h 为作用点到水面 Y=0 的净空，b 为翼展在水面上的投影；垂尾不调用。
 * FAA PHAK 第5章说明近地减弱下洗和诱导阻力：
 * https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/phak/07_phak_ch5.pdf
 * McCormick 近似见 COBEM 2007 式(14)，对梯形翼、强上反角和极小净空仅作趋势近似：
 * https://abcm.org.br/anais/cobem/2007/pdf/COBEM2007-1467.pdf
 * φ also reduces the self-induced lift-slope correction; other wings use image wakes.
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
    const halfSpan = Math.abs(w.points[1].y), direction = Math.sign(w.points[1].y);
    const incidence = (key === 'mainWing' ? d.assembly.mainIncidence : key === 'horizontalTail' ? d.assembly.tailIncidence : 0) * DEG;
    const origin = wingOrigin(d, key);
    for (let start = 0; start < halfSpan - 1e-10; start += SURFACE_STEP) {
      const end = Math.min(start + SURFACE_STEP, halfSpan), width = end - start;
      const root = p.root + (p.tip - p.root) * start / halfSpan;
      const tip = p.root + (p.tip - p.root) * end / halfSpan;
      const center = start + width * (root + 2 * tip) / (3 * (root + tip));
      const quarter = w.points[0].x + (w.points[1].x - w.points[0].x) * center / halfSpan
        + (p.root + (p.tip - p.root) * center / halfSpan) / 4;
      for (let side = -1; side <= 1; side += 2) {
        if (vertical && side === -1) continue;
        const point = vertical ? new Vector3(-quarter, direction * center, 0) : wingLocalPoint(w, incidence, side, -quarter, 0, center, new Vector3());
        point.x += origin.x; point.y += origin.y;
        surfaces.push({ bodyId: 0, name: `${vertical ? '垂直尾翼' : `${key === 'mainWing' ? '主翼' : '副翼'}${side < 0 ? '左' : '右'}`} ${start.toFixed(1)}–${end.toFixed(1)} m`,
          point,
          normal: vertical ? new Vector3(0, 0, 1) : wingLocalPoint(w, incidence, side, 0, 1, 0, new Vector3()),
          area: width * (root + tip) / 2, aspect: p.aspect, span: p.span,
          chord: 2 / 3 * (root * root + root * tip + tip * tip) / (root + tip), spanStart: start, spanEnd: end,
          spanDirection: vertical ? new Vector3(0, direction, 0) : wingLocalPoint(w, incidence, side, 0, 0, 1, new Vector3()),
          chordDirection: vertical ? new Vector3(1, 0, 0) : wingLocalPoint(w, incidence, side, 1, 0, 0, new Vector3()),
          crossflowDirection: vertical ? new Vector3(0, direction, 0) : wingLocalPoint(w, incidence, side, 0, 0, 1, new Vector3()),
          sweep: sweepAngle(w), clearance: Infinity, groundEffect: 1, inducedDrag: 0,
          inducedFlow: new Vector3(), localFlow: new Vector3(), localOmega: new Vector3(), airFraction: 1, circulation: 0, nextCirculation: 0,
          incidence,
          controlEffectiveness: effectiveness(w.controlSurface),
          controlAxes: w.controlAxes ?? { roll: !vertical, pitch: !vertical, yaw: vertical },
          controlResponse: w.controlResponse ?? 1, controlReversed: w.controlReversed ?? false,
          controlProjection: new Vector3(), controlMoment: new Vector3(), controlCommand: 0, controlCandidate: 0,
          kind: vertical ? 'vertical' : key === 'mainWing' ? 'main' : 'tail', side, alpha: 0,
          force: new Vector3(), drag: new Vector3(), moment: new Vector3() });
      }
    }
  }
  return surfaces;
}

/** 与飞行积分共用单翼计算；力、阻力输出先保留在机体坐标中。 */
function evaluateSurface(surface: AerodynamicSurface, deflection: number,
  velocity: Vector3, coefficient: Polar, liftDirection: Vector3, alphaOffset = 0) {
  const speed = velocity.length();
  const normalSpeed = velocity.dot(surface.normal) - surface.inducedFlow.dot(surface.normal);
  const incidence = deflection * surface.controlEffectiveness;
  // 后掠法向条带近似；弹性法向/作用点由结构模型更新，非真实非定常升力线或颤振求解。
  // 侧滑改变两侧有效动压，后掠产生上反效应，前掠产生反向效应。
  const crossflow = velocity.dot(surface.crossflowDirection) - surface.inducedFlow.dot(surface.crossflowDirection);
  const chordSpeed = (velocity.dot(surface.chordDirection) - surface.inducedFlow.dot(surface.chordDirection)) * Math.cos(surface.sweep) + crossflow * Math.sin(surface.sweep);
  surface.alpha = Math.atan2(-normalSpeed, chordSpeed) + incidence + alphaOffset;
  polar(surface.alpha, surface.aspect, coefficient, surface.groundEffect, speed * surface.chord / AIR_VISCOSITY, surface.kind !== 'vertical');
  // Wake changes incidence, not kinetic pressure or the force's power direction.
  const rawChord = velocity.dot(surface.chordDirection) * Math.cos(surface.sweep) + velocity.dot(surface.crossflowDirection) * Math.sin(surface.sweep);
  const pressureSpeedSq = rawChord ** 2 + velocity.dot(surface.normal) ** 2;
  const loss = Math.atan2(-velocity.dot(surface.normal), rawChord) - Math.atan2(-normalSpeed, chordSpeed);
  const crossInduced = coefficient.cl * Math.atan2(Math.sin(loss), Math.cos(loss));
  const inducedCd = Math.max(0, coefficient.inducedCd + crossInduced);
  coefficient.cd += inducedCd - coefficient.inducedCd;
  coefficient.inducedCd = inducedCd;
  const lift = 0.5 * AIR_DENSITY * pressureSpeedSq * surface.area * coefficient.cl;
  surface.inducedDrag = 0.5 * AIR_DENSITY * pressureSpeedSq * surface.area * coefficient.inducedCd;
  // v × (n × c) 在纯法向来流仍有有限连续方向；投影 n 再归一化会在90°附近产生跳变。
  // 按全来流速度缩放，纯展向来流连续归零；叉积保证升力始终与局部来流正交。
  liftDirection.crossVectors(surface.normal, surface.chordDirection);
  liftDirection.crossVectors(velocity, liftDirection).multiplyScalar(speed > 1e-9 ? 1 / speed : 0);
  // At pure spanwise flow alpha is undefined. Weight its profile drag by the
  // chord/normal dynamic pressure, blending into a finite skin-drag proxy for
  // the remaining spanwise flow. Otherwise a tumbling strip can jump between
  // attached and reverse-flow Cd at virtually identical velocity.
  const spanwiseCd = 0.012 / clamp(speed * surface.chord / AIR_VISCOSITY / 500_000, 0.05, 1) ** 0.75;
  const dragPressure = coefficient.cd * pressureSpeedSq + spanwiseCd * Math.max(0, speed * speed - pressureSpeedSq);
  surface.drag.copy(velocity).multiplyScalar(speed > 1e-9 ? -0.5 * AIR_DENSITY * surface.area * dragPressure / speed : 0);
  surface.force.copy(liftDirection).multiplyScalar(lift).add(surface.drag);
  applySectionMoment(surface, coefficient.cm, pressureSpeedSq);
  const liftSq = liftDirection.lengthSq();
  const circulationLift = liftSq > 1e-12 ? (surface.force.dot(liftDirection) - surface.drag.dot(liftDirection)) / liftSq : 0;
  surface.nextCirculation = speed > 1e-6 ? surface.airFraction * circulationLift / (AIR_DENSITY * speed * Math.max(surface.spanEnd - surface.spanStart, 1e-6)) : 0;
}

const momentForeFlow = new Vector3(), momentAftFlow = new Vector3();
const momentForeForce = new Vector3(), momentAftForce = new Vector3(), momentAxis = new Vector3(), momentDerivative = new Vector3();
/** Leading/trailing pressure stations. Each force is perpendicular to its own
 * velocity; the complete wrench does no work. No ledger-residual correction. */
function applySectionMoment(surface: AerodynamicSurface, cm: number, pressureSpeedSq: number) {
  surface.moment.set(0, 0, 0);
  if (cm === 0 || pressureSpeedSq < 1e-12) return;
  const speed = surface.localFlow.length(), chord = surface.chord;
  momentDerivative.crossVectors(surface.localOmega, surface.chordDirection);
  const retained = clamp(1 - momentDerivative.length() * chord / Math.max(speed, 1e-6), 0, 1);
  if (retained === 0) return; // Thin-airfoil Cm does not describe tumbling flow.
  momentForeFlow.copy(surface.localFlow).addScaledVector(momentDerivative, chord / 4);
  momentAftFlow.copy(surface.localFlow).addScaledVector(momentDerivative, -3 * chord / 4);
  const foreSq = momentForeFlow.lengthSq(), aftSq = momentAftFlow.lengthSq();
  momentForeForce.set(0, 0, 0); momentAftForce.set(0, 0, 0);
  if (foreSq > 1e-12) momentForeForce.copy(surface.normal).addScaledVector(momentForeFlow, -surface.normal.dot(momentForeFlow) / foreSq);
  if (aftSq > 1e-12) momentAftForce.copy(surface.normal).addScaledVector(momentAftFlow, -surface.normal.dot(momentAftFlow) / aftSq);
  surface.moment.crossVectors(surface.chordDirection, momentForeForce).multiplyScalar(chord / 4);
  surface.moment.addScaledVector(momentAxis.crossVectors(surface.chordDirection, momentAftForce), 3 * chord / 4);
  momentAxis.crossVectors(surface.chordDirection, surface.normal);
  const unit = surface.moment.dot(momentAxis);
  const strength = Math.abs(unit) > 1e-8 * chord ? 0.5 * AIR_DENSITY * pressureSpeedSq * surface.area * chord * cm * retained ** 2 / unit : 0;
  surface.moment.multiplyScalar(strength);
  surface.force.addScaledVector(momentForeForce, strength).addScaledVector(momentAftForce, -strength);
}

/** Regularized semi-infinite trailing vortex, circulation following its axis. */
function trailingVortex(out: Vector3, dx: number, dy: number, dz: number, ax: number, ay: number, az: number, circulation: number, core: number) {
  const along = dx * ax + dy * ay + dz * az;
  const radiusSq = Math.max(0, dx * dx + dy * dy + dz * dz - along * along) + core * core;
  const scale = circulation / (4 * Math.PI * radiusSq) * (1 + along / Math.sqrt(along * along + radiusSq));
  out.x += (ay * dz - az * dy) * scale;
  out.y += (az * dx - ax * dz) * scale;
  out.z += (ax * dy - ay * dx) * scale;
}

const wakeMatrices = new WeakMap<AerodynamicSurface[], Float64Array>();
const WAKE_PASSES = 6;
// Per stage: dΓ/dα, dα/dwake[3], dM/dα[3], dM/dloss[3]; then two adjoint buffers.
const CONTROL_LINEARIZATION_WIDTH = 10;
const controlLinearizations = new WeakMap<AerodynamicSurface[], Float64Array>();
const controlForceDerivative = new Vector3(), controlMomentArm = new Vector3();

function linearizeSurface(surface: AerodynamicSurface, center: number, cg: Vector3,
  coefficient: Polar, direction: Vector3, data: Float64Array, offset: number) {
  const delta = 0.0001;
  evaluateSurface(surface, center, surface.localFlow, coefficient, direction, -delta);
  controlForceDerivative.copy(surface.force);
  const low = surface.nextCirculation;
  const lowMomentX = surface.moment.x, lowMomentY = surface.moment.y, lowMomentZ = surface.moment.z;
  evaluateSurface(surface, center, surface.localFlow, coefficient, direction, delta);
  controlForceDerivative.subVectors(surface.force, controlForceDerivative).multiplyScalar(1 / (2 * delta));
  data[offset] = (surface.nextCirculation - low) / (2 * delta);
  controlMomentArm.subVectors(surface.point, cg).cross(controlForceDerivative);
  controlMomentArm.x += (surface.moment.x - lowMomentX) / (2 * delta);
  controlMomentArm.y += (surface.moment.y - lowMomentY) / (2 * delta);
  controlMomentArm.z += (surface.moment.z - lowMomentZ) / (2 * delta);
  controlMomentArm.multiplyScalar(surface.airFraction);
  for (let axis = 0; axis < 3; axis++) data[offset + 4 + axis] = controlMomentArm.getComponent(axis);
  controlForceDerivative.subVectors(surface.localFlow, surface.inducedFlow);
  const n = controlForceDerivative.dot(surface.normal), cosine = Math.cos(surface.sweep), sine = Math.sin(surface.sweep);
  const c = controlForceDerivative.dot(surface.chordDirection) * cosine + controlForceDerivative.dot(surface.crossflowDirection) * sine;
  const denominator = Math.max(1e-12, n * n + c * c);
  for (let axis = 0; axis < 3; axis++) data[offset + 1 + axis] =
    (c * surface.normal.getComponent(axis) - n * (surface.chordDirection.getComponent(axis) * cosine
      + surface.crossflowDirection.getComponent(axis) * sine)) / denominator;
  evaluateSurface(surface, center, surface.localFlow, coefficient, direction);
  // A wake changes geometric incidence and the cross-induced loss in opposite
  // directions. An actuator changes only incidence. Keep those derivatives apart.
  const speed = surface.localFlow.length();
  const rawChord = surface.localFlow.dot(surface.chordDirection) * cosine + surface.localFlow.dot(surface.crossflowDirection) * sine;
  const pressureSpeedSq = rawChord ** 2 + surface.localFlow.dot(surface.normal) ** 2;
  const lossDerivative = coefficient.inducedCd > 0 && speed > 1e-9
    ? -0.5 * AIR_DENSITY * surface.area * pressureSpeedSq * coefficient.cl * surface.airFraction / speed : 0;
  controlMomentArm.subVectors(surface.point, cg).cross(surface.localFlow).multiplyScalar(lossDerivative);
  for (let axis = 0; axis < 3; axis++) data[offset + 7 + axis] = controlMomentArm.getComponent(axis);
}

/**
 * Quasi-steady cross-wing wakes. Same-wing downwash already lives in polar().
 * ponytail: six relaxed passes, O(6N²); no time-history wake or inter-body wake.
 */
function evaluateCoupledSurfaces(surfaces: AerodynamicSurface[], bodyId: number, velocity: Vector3, omega: Vector3, cg: Vector3,
  coefficient: Polar, direction: Vector3, groundNormal: Vector3, candidates = false, scale = 1, neutral = false, linearize = false) {
  const count = surfaces.length;
  let derivatives = controlLinearizations.get(surfaces);
  if (linearize && !derivatives) {
    derivatives = new Float64Array(count * ((WAKE_PASSES + 1) * CONTROL_LINEARIZATION_WIDTH + 6));
    controlLinearizations.set(surfaces, derivatives);
  }
  for (let i = 0; i < count; i++) {
    const surface = surfaces[i];
    if (surface.bodyId !== bodyId) continue;
    surface.localFlow.subVectors(surface.point, cg).crossVectors(omega, surface.localFlow).add(velocity);
    surface.localOmega.copy(omega);
    surface.inducedFlow.set(0, 0, 0);
    const command = neutral ? 0 : candidates ? surface.controlCandidate : surface.controlCommand * scale;
    const deflection = command * (surface.kind === 'vertical' ? RUDDER_LIMIT : HORIZONTAL_LIMIT);
    if (linearize) linearizeSurface(surface, deflection, cg, coefficient, direction, derivatives!, i * CONTROL_LINEARIZATION_WIDTH);
    else evaluateSurface(surface, deflection, surface.localFlow, coefficient, direction);
    surface.circulation = surface.nextCirculation;
  }
  let matrix = wakeMatrices.get(surfaces);
  if (!matrix) { matrix = new Float64Array(count * count * 3); wakeMatrices.set(surfaces, matrix); }
  for (let i = 0; i < count; i++) {
    const receiver = surfaces[i];
    if (receiver.bodyId !== bodyId) continue;
    for (let j = 0; j < count; j++) {
        const source = surfaces[j], offset = (i * count + j) * 3;
        matrix[offset] = matrix[offset + 1] = matrix[offset + 2] = 0;
        if (source.bodyId !== bodyId || source.kind === receiver.kind) continue;
        receiver.inducedFlow.set(0, 0, 0);
        const speed = source.localFlow.length();
        if (speed < 1e-6) continue;
        const ax = -source.localFlow.x / speed, ay = -source.localFlow.y / speed, az = -source.localFlow.z / speed;
        // c × n gives one consistent bound-vortex orientation on both half wings.
        const half = (source.spanEnd - source.spanStart) / 2;
        const sx = (source.chordDirection.y * source.normal.z - source.chordDirection.z * source.normal.y) * half;
        const sy = (source.chordDirection.z * source.normal.x - source.chordDirection.x * source.normal.z) * half;
        const sz = (source.chordDirection.x * source.normal.y - source.chordDirection.y * source.normal.x) * half;
        const core = Math.max(0.15, source.chord * 0.5, receiver.chord * 0.25);
        for (let side = -1; side <= 1; side += 2) {
          const dx = receiver.point.x - source.point.x - side * sx;
          const dy = receiver.point.y - source.point.y - side * sy;
          const dz = receiver.point.z - source.point.z - side * sz;
          trailingVortex(receiver.inducedFlow, dx, dy, dz, ax, ay, az, side, core);
          if (Number.isFinite(source.clearance) && source.kind !== 'vertical') {
            const endpointHeight = Math.max(0, source.clearance + side * (sx * groundNormal.x + sy * groundNormal.y + sz * groundNormal.z));
            const projection = ax * groundNormal.x + ay * groundNormal.y + az * groundNormal.z;
            trailingVortex(receiver.inducedFlow,
              dx + 2 * endpointHeight * groundNormal.x, dy + 2 * endpointHeight * groundNormal.y, dz + 2 * endpointHeight * groundNormal.z,
              ax - 2 * projection * groundNormal.x, ay - 2 * projection * groundNormal.y, az - 2 * projection * groundNormal.z,
              -side, core);
          }
        }
        matrix[offset] = receiver.inducedFlow.x; matrix[offset + 1] = receiver.inducedFlow.y; matrix[offset + 2] = receiver.inducedFlow.z;
    }
  }
  for (let pass = 0; pass < WAKE_PASSES; pass++) {
    for (let i = 0; i < count; i++) {
      const receiver = surfaces[i];
      if (receiver.bodyId !== bodyId) continue;
      receiver.inducedFlow.set(0, 0, 0);
      for (let j = 0; j < count; j++) {
        const source = surfaces[j];
        if (source.bodyId !== bodyId) continue;
        const offset = (i * count + j) * 3, gamma = source.circulation;
        receiver.inducedFlow.x += matrix[offset] * gamma;
        receiver.inducedFlow.y += matrix[offset + 1] * gamma;
        receiver.inducedFlow.z += matrix[offset + 2] * gamma;
      }
    }
    for (let i = 0; i < count; i++) {
      const surface = surfaces[i];
      if (surface.bodyId !== bodyId) continue;
      const command = neutral ? 0 : candidates ? surface.controlCandidate : surface.controlCommand * scale;
      const deflection = command * (surface.kind === 'vertical' ? RUDDER_LIMIT : HORIZONTAL_LIMIT);
      if (linearize) linearizeSurface(surface, deflection, cg, coefficient, direction, derivatives!,
        ((pass + 1) * count + i) * CONTROL_LINEARIZATION_WIDTH);
      else evaluateSurface(surface, deflection, surface.localFlow, coefficient, direction);
      surface.circulation += 0.5 * (surface.nextCirculation - surface.circulation);
    }
  }
}

/** Reverse the actual finite relaxed solve, not an assumed converged fixed point. */
function coupledControlMoments(surfaces: AerodynamicSurface[]) {
  const count = surfaces.length, matrix = wakeMatrices.get(surfaces)!;
  const data = controlLinearizations.get(surfaces)!;
  let current = count * (WAKE_PASSES + 1) * CONTROL_LINEARIZATION_WIDTH, previous = current + count * 3;
  data.fill(0, current);
  for (let i = 0; i < count; i++) {
    const surface = surfaces[i], final = (WAKE_PASSES * count + i) * CONTROL_LINEARIZATION_WIDTH;
    surface.controlMoment.set(0, 0, 0);
    if (surface.bodyId !== 0) continue;
    surface.controlMoment.set(data[final + 4], data[final + 5], data[final + 6]);
    for (let j = 0; j < count; j++) {
      if (surfaces[j].bodyId !== 0) continue;
      const receiver = (WAKE_PASSES * count + j) * CONTROL_LINEARIZATION_WIDTH, kernel = (j * count + i) * 3;
      const feedback = data[receiver + 1] * matrix[kernel] + data[receiver + 2] * matrix[kernel + 1]
        + data[receiver + 3] * matrix[kernel + 2];
      for (let axis = 0; axis < 3; axis++) data[current + i * 3 + axis] +=
        feedback * (data[receiver + 4 + axis] - data[receiver + 7 + axis]);
    }
  }
  // The final force uses Γ from pass five. The relaxed Γ from pass six is unused.
  for (let pass = WAKE_PASSES - 1; pass > 0; pass--) {
    for (let i = 0; i < count; i++) {
      const surface = surfaces[i], offset = (pass * count + i) * CONTROL_LINEARIZATION_WIDTH;
      if (surface.bodyId !== 0) continue;
      for (let axis = 0; axis < 3; axis++) {
        surface.controlMoment.setComponent(axis, surface.controlMoment.getComponent(axis)
          + 0.5 * data[offset] * data[current + i * 3 + axis]);
        data[previous + i * 3 + axis] = 0.5 * data[current + i * 3 + axis];
      }
      for (let j = 0; j < count; j++) {
        if (surfaces[j].bodyId !== 0) continue;
        const receiver = (pass * count + j) * CONTROL_LINEARIZATION_WIDTH, kernel = (j * count + i) * 3;
        const feedback = 0.5 * data[receiver] * (data[receiver + 1] * matrix[kernel]
          + data[receiver + 2] * matrix[kernel + 1] + data[receiver + 3] * matrix[kernel + 2]);
        for (let axis = 0; axis < 3; axis++) data[previous + i * 3 + axis] += feedback * data[current + j * 3 + axis];
      }
    }
    const swap = current; current = previous; previous = swap;
  }
  for (let i = 0; i < count; i++) {
    const surface = surfaces[i];
    if (surface.bodyId !== 0) continue;
    for (let axis = 0; axis < 3; axis++) surface.controlMoment.setComponent(axis, surface.controlMoment.getComponent(axis)
      + data[i * CONTROL_LINEARIZATION_WIDTH] * data[current + i * 3 + axis]);
    surface.controlMoment.multiplyScalar(surface.controlEffectiveness * (surface.kind === 'vertical' ? RUDDER_LIMIT : HORIZONTAL_LIMIT));
  }
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
  readonly bodies: { point: Vector3; projection: Vector3; skinArea: number }[];
  readonly bodyTorque = new Vector3();
  bodyPower = 0;
  private readonly liftPoint = new Vector3();
  private readonly dragPoint = new Vector3();
  private readonly inverse = new Quaternion();
  private readonly velocity = new Vector3();
  private readonly localVelocity = new Vector3();
  private readonly arm = new Vector3();
  private readonly localForce = new Vector3();
  private readonly localDrag = new Vector3();
  private readonly moment = new Vector3();

  constructor(readonly surfaces: AerodynamicSurface[], d: AircraftDefinition) {
    this.bodies = (d.birdman ? [] : [cockpitGeometry(d), BODY_GEOMETRY.canopy]).map((shape, index) => {
      // 椭球投影面积 + 湿表面摩擦代理；罩体只取露出壳体的上半部，不重复计算下半部。
      const exposed = index === 0 ? 1 : 0.5, pressure = 0.18 * Math.PI * exposed;
      return { point: new Vector3(d.cockpit.position + shape.x, shape.y, 0),
        projection: new Vector3(shape.yRadius * shape.zRadius, shape.xRadius * shape.zRadius, shape.xRadius * shape.yRadius).multiplyScalar(pressure),
        skinArea: 0.004 * 2 * Math.PI * shape.xRadius * (shape.yRadius + shape.zRadius) * exposed };
    });
    this.wings = (['main', 'tail', 'vertical'] as const).map((kind, index) => {
      const panels = surfaces.filter(surface => surface.kind === kind);
      return { kind, name: ['主翼', '副翼', '垂直尾翼'][index],
        area: panels.reduce((sum, surface) => sum + surface.area, 0), aspect: panels[0].aspect, alpha: 0,
        groundEffect: 1, inducedDrag: 0,
        force: new Vector3(), lift: new Vector3(), drag: new Vector3(), torque: new Vector3() };
    });
  }
  updateBody(cg: Vector3, velocity: Vector3, omega?: Vector3) {
    this.bodyDrag.copy(velocity).multiplyScalar(-0.5 * AIR_DENSITY * velocity.length() * BODY_DRAG_AREA);
    this.bodyTorque.set(0, 0, 0);
    this.bodyPower = this.bodyDrag.dot(velocity);
    for (const body of this.bodies) {
      this.arm.copy(body.point).sub(cg);
      if (omega) this.localVelocity.crossVectors(omega, this.arm).add(velocity);
      else this.localVelocity.copy(velocity);
      const v = this.localVelocity, p = body.projection;
      const areaSpeed = Math.hypot(p.x * v.x, p.y * v.y, p.z * v.z) + body.skinArea * v.length();
      this.localForce.copy(v).multiplyScalar(-0.5 * AIR_DENSITY * areaSpeed);
      this.bodyDrag.add(this.localForce);
      this.bodyTorque.add(this.moment.crossVectors(this.arm, this.localForce));
      this.bodyPower += this.localForce.dot(v);
    }
  }


  update(cg: Vector3, orientation: Quaternion, velocity: Vector3, torque?: Vector3, omega?: Vector3) {
    this.inverse.copy(orientation).invert();
    this.velocity.copy(velocity).applyQuaternion(this.inverse);
    this.speed = velocity.length();
    this.alpha = Math.atan2(-this.velocity.y, this.velocity.x);
    this.beta = Math.atan2(this.velocity.z, Math.hypot(this.velocity.x, this.velocity.y));
    this.force.set(0, 0, 0); this.lift.set(0, 0, 0); this.drag.set(0, 0, 0);
    this.torque.set(0, 0, 0); this.liftMoment.set(0, 0, 0); this.dragMoment.set(0, 0, 0);
    this.freeMoment.set(0, 0, 0);
    for (const wing of this.wings) {
      wing.force.set(0, 0, 0); wing.lift.set(0, 0, 0); wing.drag.set(0, 0, 0);
      wing.torque.set(0, 0, 0); wing.alpha = 0; wing.groundEffect = 0; wing.inducedDrag = 0;
      wing.area = 0;
      for (const surface of this.surfaces) if (surface.bodyId === 0 && surface.kind === wing.kind) {
        wing.area += surface.area; wing.aspect = surface.aspect;
      }
    }
    for (const surface of this.surfaces) {
      if (surface.bodyId !== 0) continue;
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
      this.moment.copy(surface.moment).applyQuaternion(this.inverse);
      wing.torque.add(this.moment); this.torque.add(this.moment); this.freeMoment.add(this.moment);
      this.localForce.sub(this.localDrag);
      wing.lift.add(this.localForce);
      this.liftMoment.add(this.moment.crossVectors(this.arm, this.localForce));
      this.dragMoment.add(this.moment.crossVectors(this.arm, this.localDrag));
    }
    for (const wing of this.wings) {
      this.force.add(wing.force); this.lift.add(wing.lift); this.drag.add(wing.drag);
    }
    this.updateBody(cg, this.velocity, omega);
    this.force.add(this.bodyDrag); this.drag.add(this.bodyDrag);
    this.torque.add(this.bodyTorque); this.dragMoment.add(this.bodyTorque);
    if (torque) { this.freeMoment.add(this.moment.copy(torque).sub(this.torque)); this.torque.copy(torque); }
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
  const velocity = new Vector3(), direction = new Vector3(), force = new Vector3(), zero = new Vector3(), ground = new Vector3(0, 1, 0);
  const coefficient: Polar = { cl: 0, cd: 0, inducedCd: 0, profileCd: 0, cm: 0 };
  let maxCl = 0;
  // 构型派生时搜索同一全机受力；12m/s、无侧滑、无地效，不声称已配平或达到冠军设计值。
  for (let sample = 0; sample <= 125; sample++) {
    const reference = sample === 125;
    const alpha = (reference ? 5 : -6 + sample / 4) * DEG, beta = reference ? 3 * DEG : 0;
    velocity.set(speed * Math.cos(alpha) * Math.cos(beta), -speed * Math.sin(alpha) * Math.cos(beta), speed * Math.sin(beta));
    let mainLift = 0;
    summary.updateBody(aircraft.cg, velocity);
    evaluateCoupledSurfaces(summary.surfaces, 0, velocity, zero, aircraft.cg, coefficient, direction, ground, false, 1, true);
    force.copy(summary.bodyDrag);
    for (const surface of summary.surfaces) {
      if (surface.kind === 'main') mainLift += surface.nextCirculation * 2 * (surface.spanEnd - surface.spanStart) / (speed * aircraft.wingArea);
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
function makeContacts(d: AircraftDefinition, structure?: WingStructure): ContactPoint[] {
  const { nose, tail } = fuselageEnds(d);
  const shell = cockpitGeometry(d);
  const points: ContactPoint[] = [
    new Vector3(nose, -0.12, 0),
    new Vector3(nose + 0.252, -0.156, 0),
    new Vector3(tail, -0.12, 0),
  ];
  // 鸟人间只显示乘员和滑橇，不让隐藏驾驶舱挤占发射槽。
  if (d.birdman) {
    points.push(new Vector3(d.cockpit.position - 0.75, -0.495, 0), new Vector3(d.cockpit.position + 0.75, -0.495, 0));
  }
  for (const shape of d.birdman ? [] : [shell, BODY_GEOMETRY.canopy]) {
    for (let row = 0; row <= 16; row++) {
      const angle = row / 16 * Math.PI;
      for (let ring = 0; ring < 16; ring++) {
        const azimuth = ring / 16 * Math.PI * 2, section = Math.sin(angle);
        if (shape === BODY_GEOMETRY.canopy && Math.cos(azimuth) < 0) continue;
        points.push(new Vector3(d.cockpit.position + shape.x + shape.xRadius * Math.cos(angle),
          shape.y + shape.yRadius * section * Math.cos(azimuth), shape.zRadius * section * Math.sin(azimuth)));
      }
    }
  }
  for (const key of ['mainWing', 'horizontalTail', 'verticalTail'] as const) {
    const w = d[key], vertical = key === 'verticalTail';
    const origin = wingOrigin(d, key);
    const incidence = (key === 'mainWing' ? d.assembly.mainIncidence : key === 'horizontalTail' ? d.assembly.tailIncidence : 0) * DEG;
    for (const side of [-1, 1]) {
      if (vertical && side < 0) continue;
      const rows = structure ? structure.sections.filter(section => section.wingKey === key && section.side === side)
        .flatMap(section => [{ span: section.spanStart, section, tip: false }, { span: section.spanEnd, section, tip: true }])
        : [{ span: 0, section: undefined, tip: false }, { span: Math.abs(w.points[1].y), section: undefined, tip: true }];
      for (const row of rows) {
        const span = row.span, fraction = span / Math.abs(w.points[1].y);
        const leading = w.points[0].x + (w.points[1].x - w.points[0].x) * fraction;
        const trailing = w.points[3].x + (w.points[2].x - w.points[3].x) * fraction, chord = trailing - leading;
        for (let j = 0; j <= 16; j++) {
          const u = (1 - Math.cos(j / 16 * Math.PI)) / 2;
          const thickness = 5 * 0.105 * chord * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4);
          const x = -leading - u * chord;
          for (const face of [-1, 1]) {
            const y = (vertical ? 0 : 0.018 * chord * Math.sin(Math.PI * u)) + face * thickness;
            const point: ContactPoint = vertical ? new Vector3(origin.x + x, origin.y + Math.sign(w.points[1].y) * span, y)
              : wingLocalPoint(w, incidence, side, x, y, span, new Vector3());
            if (!vertical) { point.x += origin.x; point.y += origin.y; }
            if (row.section) { point.sectionId = row.section.id; point.tip = row.tip; point.reference = point.clone(); }
            points.push(point);
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
        points.push(new Vector3(tank.x + shape.length / 2 * Math.cos(angle), shell.y + radius * Math.cos(azimuth), radius * Math.sin(azimuth)));
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

function contactLaunchOffset(contacts: ContactPoint[], cg: Vector3, structure?: WingStructure): number {
  let lowest = Infinity;
  const c = Math.cos(LAUNCH_ROLL_LIMIT), s = Math.sin(LAUNCH_ROLL_LIMIT);
  for (const point of contacts) {
    if (point.sectionId !== undefined && structure && structure.sections[point.sectionId].bodyId !== 0) continue;
    const y = point.y - cg.y, z = Math.abs(point.z - cg.z);
    lowest = Math.min(lowest, y, y * c - z * s);
    if (y < 0 && z <= -y * Math.tan(LAUNCH_ROLL_LIMIT)) lowest = Math.min(lowest, -Math.hypot(y, z));
  }
  return 0.05 - lowest / Math.cos(LAUNCH.slope);
}


export class FlightSimulation {
  readonly definition: AircraftDefinition;
  private readonly cockpitShape: BodyEllipsoid;
  readonly id = 0;
  readonly structure: WingStructure;
  readonly fragments: WingFragment[] = [];
  private readonly sectionContacts: number[][];
  private readonly branchContacts: { key: WingKey; side: number; indices: number[] }[];
  get cg() { return this.aircraft.cg; }
  get mass() { return this.aircraft.mass; }
  get inertiaTensor() { return this.aircraft.inertiaTensor; }
  get inverseInertia() { return this.aircraft.inverseInertia; }
  get railAttachmentHeight() { return this.sampleRail(this.railX, this.railStart).y; }
  get railPositionX() { return this.railX; }
  get launch() { return this.laboratoryState.launchConfig; }
  get railAttached() { return this.launching && (this.challenge === 'low-altitude' || this.challenge === 'test-space' && !this.testSpace.catapult); }
  private get contactBoxes() { return this.challenge === 'test-space' ? this.laboratoryState.testPlatformBoxes : this.challenge === 'birdman' ? PLATFORM_BOXES : this.challenge === 'low-altitude' ? RUNWAY_BOXES : DOWNHILL_BOXES; }
  private get contactNormals() { return this.challenge === 'birdman' ? PLATFORM_NORMALS : RUNWAY_NORMALS; }
  readonly challenge: ChallengeMode;
  // Keep mode-specific state together so replay snapshots retain a compact body.
  private readonly laboratoryState = {
    testSpaceConfig: { ...defaultTestSpace },
    launchConfig: null as ReturnType<typeof challengeLaunch>,
    testPlatformBoxes: [[new Vector3(-50, -0.8, -20), new Vector3(0, 0, 20)]] as [Vector3, Vector3][],
    windTunnel: { ...defaultWindTunnel, speed: 0 }, windTarget: { ...defaultWindTunnel }, windEnabled: false, windVelocity: new Vector3(),
    windMotion: null as ReturnType<typeof createWindTunnelMotion> | null,
    takeoffHeight: 0, takeoffSpeed: 0,
  };
  get testSpace(): Readonly<TestSpaceSettings> { return this.laboratoryState.testSpaceConfig; }
  get windTunnel(): Readonly<WindTunnelSettings> { return this.laboratoryState.windTunnel; }
  get windTunnelEnabled() { return this.laboratoryState.windEnabled; }
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
  readonly recording: Float64Array;
  readonly wingLoads: Float64Array;
  private readonly frameLoads = [0, 0, 0];
  private keyframes: ReplayKeyframe[] = [];
  private nextKeyframe = REPLAY_KEYFRAME_INTERVAL;
  recordingLength = 0;
  time = 0;
  readonly groundImpactPoint = new Vector3();
  ended = false;
  result: FlightResult | null = null;
  replayFinished = false;
  private elapsed = 0;
  private fractureTick = 0;
  private fractureTickElapsed = 0;
  get elapsedTime() { return this.elapsed; }
  launching = true;
  private flightStarted = false;
  private launchTime = 0;
  private raceStarted = false;
  private launchRoll = 0;
  private replay: InputRecording | null = null;
  private replayIndex = 0;
  get replayFrame() { return this.replayIndex; }
  private readonly parts: MassPart[];
  private readonly fuelPart: MassPart | undefined;
  private readonly enginePositions: EngineMount[];
  private readonly fuelLocalInertia = new Vector3();
  private readonly cgShift = new Vector3();
  private engineRpm = 0;
  private fuelRemaining = 0;
  private thrust = 0;
  private availableThrust = 0;
  private propulsionPower = 0;
  /** Sea-level, free-air analysis only; no contact or atmospheric shortcut in normal flights. */
  private seaLevelReference = false;
  readonly checkpointScores: number[] = [];
  private heightPenalty = 0;
  private aboveHeightTime = 0;
  private aboveHeightStreak = 0;
  private readonly neutral: number;
  private readonly chord: number;
  private readonly aerodynamics: AerodynamicSummary;
  private launchAltitude = 0;
  /** 发射架固定设计坐标参考，不随驾驶员移动或断翼后重心跳动重新定位机体。 */
  private readonly launchCg = new Vector3();
  private railX = LOW_RUNWAY.startX;
  private readonly railStart: LowAltitudeRailSample = { x: 0, y: 0, pitch: 0, slope: 0, pitchDerivative: 0 };
  private readonly railEnd: LowAltitudeRailSample = { x: 0, y: 0, pitch: 0, slope: 0, pitchDerivative: 0 };
  private readonly railStartDerivative = new Vector3();
  private readonly railEndDerivative = new Vector3();
  private railRollingPower = 0;
  private readonly bodyVelocity = new Vector3();
  private readonly wakeGroundNormal = new Vector3();
  private readonly waterPoint = new Vector3();
  private readonly waterAxis = new Vector3();
  private readonly buoyancy = new Vector3();
  private waterPower = 0;
  private readonly waterBody: { point: Vector3; radius: number; area: number; volume: number }[];
  private readonly nosePoint = new Vector3();
  private readonly contacts: ContactPoint[];
  /** Impulses until an accepted step converts them to average structural loads. */
  private readonly wingContactLoads: SectionContactLoad[];
  private readonly wingImpactLoads: SectionContactLoad[];
  /** Frozen external wrenches exclude gravity and inertial pseudo-forces. */
  private readonly structuralExternal: SectionContactLoad[];
  private readonly structuralCorrections: SectionContactLoad[];
  private readonly structuralResidualForce = new Vector3();
  private readonly structuralResidualMoment = new Vector3();
  private readonly structuralForce = new Vector3();
  private readonly structuralMoment = new Vector3();
  private readonly structuralBodies: StructuralBody[] = [];
  private readonly structuralSeparated: boolean[] = [];
  private readonly initialImpactImpulse = new Vector3();
  private readonly initialImpactTorque = new Vector3();
  private readonly finalImpactImpulse = new Vector3();
  private readonly finalImpactTorque = new Vector3();
  private readonly platformFaces: Int8Array;
  private readonly platformGaps: Float64Array;
  private readonly platformImpulses: Float64Array;
  private readonly platformFriction: Vector3[];
  private readonly frictionDirection = new Vector3();
  private readonly frictionDelta = new Vector3();
  private readonly frictionAxis = new Vector3();
  private readonly platformAxes: Vector3[];
  private readonly groundNormals: Vector3[];
  private readonly platformActive: Int32Array;
  private platformCount = 0;
  private readonly platformStart = new Vector3();
  private readonly platformEnd = new Vector3();
  private readonly contactNormal = new Vector3();
  private readonly inverse = new Quaternion();
  private readonly rotation = new Quaternion();
  private readonly incidenceRotation = new Quaternion();
  private readonly incidenceInverse = new Quaternion();
  private readonly incidenceOldOrigin = new Vector3();
  private readonly incidenceNewOrigin = new Vector3();
  private readonly arm = new Vector3();
  private readonly localVelocity = new Vector3();
  private readonly liftDirection = new Vector3();
  private readonly localDrag = new Vector3();
  private readonly torque = new Vector3();
  private readonly cross = new Vector3();
  private readonly angularMomentum = new Vector3();
  private readonly angularAcceleration = new Vector3();
  private nextFragmentId = 1;
  private readonly supportForce = new Vector3();
  private readonly supportTorque = new Vector3();
  private readonly previousVelocity = new Vector3();
  private readonly previousPosition = new Vector3();
  private readonly previousOmega = new Vector3();
  private readonly midpointVelocity = new Vector3();
  private readonly midpointPosition = new Vector3();
  private readonly midpointOmega = new Vector3();
  private readonly candidateVelocity = new Vector3();
  private readonly candidateOmega = new Vector3();
  private readonly midpointQuaternion = new Quaternion();
  private readonly polar: Polar = { cl: 0, cd: 0, inducedCd: 0, profileCd: 0, cm: 0 };
  private readonly candidatePosition = new Vector3();
  private readonly candidateQuaternion = new Quaternion();
  private maxSpeed = 10;
  private minSpeed = 10;
  private maxHeight = 10;
  private maxG = 1;
  private travelled = 0;
  private weight = 0;
  private lateral = 0;
  private checkpointIndex = 0;
  private completed = false;
  private readonly effective: FlightControls = { ...ZERO_CONTROLS };
  private readonly applied: Controls = { ...ZERO_CONTROLS };
  private readonly requestedControls: Controls = { ...ZERO_CONTROLS };
  private readonly fullControls: Controls = { ...ZERO_CONTROLS };
  private readonly predictedControls: Controls = { ...ZERO_CONTROLS };
  private readonly trimOmega = new Vector3();
  private controlLimit = 1;
  private controlAuthority = 1;
  private trimPitch = 0;
  private trimPitchBias = 0;
  private trimPitchInput = 0;
  private autoTrim = false;

  constructor(d: AircraftDefinition, challenge: ChallengeMode = 'birdman', private readonly fixedLaunchRoll?: number, testSettings: TestSpaceSettings = defaultTestSpace) {
    this.definition = validateAircraft(d);
    this.cockpitShape = cockpitGeometry(this.definition);
    if (!Object.hasOwn(challengeDefinitions, challenge)) throw new Error('未知飞行挑战');
    if (challenge === 'birdman' && (!this.definition.birdman || this.definition.engine.count > 0)) throw new Error('鸟人间比赛只允许无动力鸟人间设计');
    this.challenge = challenge;
    this.laboratoryState.testSpaceConfig = testSpaceSettings(testSettings); this.laboratoryState.launchConfig = challengeLaunch(challenge, this.laboratoryState.testSpaceConfig);
    this.recording = new Float64Array(isLaboratory(challenge) ? 0 : MAX_FRAMES * FRAME_WIDTH);
    this.wingLoads = new Float64Array(isLaboratory(challenge) ? 0 : MAX_FRAMES * 3);
    this.parts = massLayout(this.definition);
    this.fuelPart = this.parts.find(part => part.fuel);
    this.enginePositions = engineMounts(this.definition);
    const shape = fuelTankDimensions(this.definition.fuelTank.capacity);
    this.fuelLocalInertia.set(2 * shape.radius ** 2 / 5, ((shape.length / 2) ** 2 + shape.radius ** 2) / 5, ((shape.length / 2) ** 2 + shape.radius ** 2) / 5);
    this.aircraft = properties(this.definition);
    this.neutral = this.aircraft.neutralPoint;
    this.chord = planform(this.definition.mainWing).chord;
    this.surfaces = makeSurfaces(this.definition);
    this.structure = new WingStructure(this.definition, this.surfaces);
    this.aerodynamics = new AerodynamicSummary(this.surfaces, this.definition);
    this.contacts = makeContacts(this.definition, this.structure);
    this.sectionContacts = this.structure.sections.map(() => []);
    this.contacts.forEach((point, index) => { if (point.sectionId !== undefined) this.sectionContacts[point.sectionId].push(index); });
    this.branchContacts = [];
    for (const key of ['mainWing', 'horizontalTail', 'verticalTail'] as const) for (const side of [-1, 1]) {
      const indices = this.contacts.flatMap((point, index) => point.sectionId !== undefined && this.structure.branchContains(this.structure.sections[point.sectionId], key, side) ? [index] : []);
      if (indices.length) this.branchContacts.push({ key, side, indices });
    }
    this.wingContactLoads = this.structure.sections.map(() => ({ force: new Vector3(), moment: new Vector3() }));
    this.wingImpactLoads = this.structure.sections.map(() => ({ force: new Vector3(), moment: new Vector3() }));
    this.structuralExternal = this.structure.sections.map(() => ({ force: new Vector3(), moment: new Vector3() }));
    this.structuralCorrections = this.structure.sections.map(() => ({ force: new Vector3(), moment: new Vector3() }));
    const shell = this.cockpitShape;
    this.waterBody = Array.from({ length: WATER.bodySamples }, (_, index) => {
      const fraction = (index + 0.5) / WATER.bodySamples * 2 - 1;
      const section = Math.sqrt(1 - fraction * fraction);
      return {
        point: new Vector3(this.definition.cockpit.position + shell.x + shell.xRadius * fraction, shell.y, 0),
        radius: shell.yRadius * section,
        area: Math.PI * shell.yRadius * shell.zRadius / WATER.bodySamples,
        volume: 4 / 3 * Math.PI * shell.xRadius * shell.yRadius * shell.zRadius
          * WATER.bodyBuoyancyFraction / WATER.bodySamples,
      };
    });
    const contactCount = this.contacts.length * CONTACT_SLOTS;
    this.platformFaces = new Int8Array(contactCount);
    this.platformGaps = new Float64Array(contactCount);
    this.platformImpulses = new Float64Array(contactCount);
    this.platformFriction = Array.from({ length: contactCount }, () => new Vector3());
    this.groundNormals = Array.from({ length: contactCount }, () => new Vector3());
    this.platformAxes = Array.from({ length: contactCount }, () => new Vector3());
    this.platformActive = new Int32Array(contactCount);
    updateMass(this.definition, this.parts, 0, this.aircraft, this.neutral, this.chord);
    this.launchCg.copy(this.aircraft.cg);
    evaluateReference(this.aircraft);
    this.telemetry = { gForce: 1, speed: 10, altitude: 10, distance: 0, alpha: 0, pitch: 0, roll: 0, sink: 0, glide: 0,
      stall: false, physicsMs: 0, cg: this.aircraft.cg, mass: 0, force: new Vector3(), specificForce: new Vector3(), drag: new Vector3(), torque: new Vector3(),
      aeroPower: 0, energy: 0, staticMargin: 0, energyPerDistance: null, potentialEnergy: 0, kineticEnergy: 0,
      dissipatedEnergy: 0, initialEnergy: 0, liftDragRatio: 0, aerodynamics: this.aerodynamics,
      challengeProgress: 0, groundClearance: 0, score: 0, completed: false, timingStarted: false, controlWork: 0,
      throttle: 0, engineRpm: 0, fuelRemaining: 0, thrust: 0, aboveHeightTime: 0, propulsionWork: 0, fuelEnergyRemoved: 0,
      autoTrim: false, adaptiveControls: false, smartMixing: false, trimPitch: 0, trimRoll: 0, controlLimit: 1,
      controlInputs: { weight: 0, lateral: 0, elevator: 0, aileron: 0, rudder: 0 },
      waterContact: false, waterContactPoint: new Vector3(), waterWork: 0 };
    this.reset();
  }

  /** 新飞行重新抽样；构造时明确指定角度则保持该角度。回放仅覆盖本次重置。 */
  reset(launchRoll = this.fixedLaunchRoll ?? (Math.random() * 2 - 1) * LAUNCH_ROLL_LIMIT) {
    this.maxG = 1;
    if (!Number.isFinite(launchRoll) || Math.abs(launchRoll) > LAUNCH_ROLL_LIMIT) throw new RangeError('离台滚转角须在 ±1° 之间');
    this.launchRoll = launchRoll;
    this.railX = LOW_RUNWAY.startX;
    this.position.set(LAUNCH.startX, this.launchAltitude, 0);
    this.velocity.set(0, 0, 0);
    this.quaternion.setFromAxisAngle(this.cross.set(0, 0, 1), -LAUNCH.slope);
    this.omega.set(0, 0, 0);
    this.time = 0; this.elapsed = 0; this.ended = false; this.result = null;
    this.fractureTick = this.fractureTickElapsed = 0;
    this.launching = true; this.flightStarted = false; this.launchTime = 0; this.raceStarted = false;
    const launch = this.launch;
    if (launch) {
      this.position.set(launch.startX, this.launchAltitude, launch.z);
      this.quaternion.identity();
    }
    this.recordingLength = 0; this.replayIndex = 0; this.replayFinished = false; this.replay = null;
    this.keyframes = []; this.nextKeyframe = REPLAY_KEYFRAME_INTERVAL;
    snapshotTemplates.delete(this);
    this.maxSpeed = this.minSpeed = this.challenge === 'birdman' ? LAUNCH.speed : this.velocity.length();
    this.travelled = 0; this.weight = 0; this.lateral = 0; this.checkpointIndex = 0; this.completed = false;
    this.engineRpm = 0; this.thrust = 0; this.availableThrust = 0; this.propulsionPower = 0;
    this.fuelRemaining = this.definition.fuelTank.capacity;
    this.checkpointScores.length = 0; this.heightPenalty = 0; this.aboveHeightTime = 0; this.aboveHeightStreak = 0;
    this.pilotOffset.x = 0; this.pilotOffset.z = 0;
    this.structure.reset(); this.fragments.length = 0; this.nextFragmentId = 1;
    this.clearContactLoads();
    this.updateSurfaceExtents();
    if (this.fuelPart) {
      this.fuelPart.mass = this.fuelRemaining * FUEL_DENSITY;
      this.fuelPart.ix = this.fuelPart.mass * this.fuelLocalInertia.x;
      this.fuelPart.iy = this.fuelPart.mass * this.fuelLocalInertia.y;
      this.fuelPart.iz = this.fuelPart.mass * this.fuelLocalInertia.z;
    }
    Object.assign(this.effective, ZERO_CONTROLS);
    this.effective.autoTrim = false; this.effective.adaptiveControls = false; this.effective.smartMixing = false;
    this.effective.trimPitch = 0; this.effective.trimRoll = 0;
    this.trimPitch = 0; this.trimPitchBias = 0; this.trimPitchInput = 0; this.autoTrim = false;
    Object.assign(this.applied, ZERO_CONTROLS);
    this.controlLimit = this.controlAuthority = 1;
    Object.assign(this.controlDeflections, { aileron: 0, elevator: 0, rudder: 0 });
    updateMass(this.definition, this.parts, 0, this.aircraft, this.neutral, this.chord);
    evaluateReference(this.aircraft);
    for (const surface of this.surfaces) {
      surface.airFraction = 1;
      surface.force.set(0, 0, 0); surface.drag.set(0, 0, 0); surface.moment.set(0, 0, 0); surface.alpha = 0;
      surface.clearance = Infinity; surface.groundEffect = 1; surface.inducedDrag = 0;
      surface.controlCommand = surface.controlCandidate = 0;
    }
    this.telemetry.force.set(0, 0, 0); this.telemetry.drag.set(0, 0, 0); this.telemetry.torque.set(0, 0, 0);
    this.telemetry.physicsMs = 0; this.telemetry.aeroPower = 0;
    this.telemetry.dissipatedEnergy = 0; this.telemetry.initialEnergy = 0; this.telemetry.liftDragRatio = 0; this.telemetry.controlWork = 0;
    this.telemetry.propulsionWork = 0; this.telemetry.fuelEnergyRemoved = 0;
    this.telemetry.waterWork = 0; this.telemetry.waterContact = false; this.telemetry.waterContactPoint.set(0, 0, 0);
    this.waterPower = 0;
    // 待发射也由发射架承重；先求真实自重下垂，不能等首个运动步才建立梁载荷。
    // 此处只恢复静载形状，断裂仍在接受物理步时提交。
    this.supportForce.set(0, this.mass * GRAVITY, 0);
    this.telemetry.gForce = 1;
    this.telemetry.specificForce.set(0, GRAVITY, 0);
    this.supportTorque.set(0, 0, 0);
    this.structure.update(this, this.supportForce, this.supportTorque);
    this.structure.summarize();
    this.syncContacts();
    // 发射净空取静载后的完整碰撞体，长翼下垂不能穿过导轨或平台。
    this.launchAltitude = launch ? launch.y + (this.challenge === 'low-altitude' || this.challenge === 'test-space' ? LOW_ALTITUDE_RAIL.height : 0)
      + contactLaunchOffset(this.contacts, this.aircraft.cg) * Math.cos(LAUNCH.slope)
      : runwayHeight(LAUNCH.startX) + contactLaunchOffset(this.contacts, this.aircraft.cg);
    this.position.y = this.launchAltitude;
    if (this.challenge === 'test-space') this.railX = this.laboratoryState.launchConfig!.startX;
    if (this.challenge === 'wind-tunnel') {
      Object.assign(this.laboratoryState.windTunnel, defaultWindTunnel, { speed: 0, mainIncidence: this.definition.assembly.mainIncidence, tailIncidence: this.definition.assembly.tailIncidence });
      Object.assign(this.laboratoryState.windTarget, this.laboratoryState.windTunnel, { speed: defaultWindTunnel.speed });
      this.laboratoryState.windEnabled = false; this.laboratoryState.windVelocity.set(0, 0, 0);
      this.laboratoryState.windMotion = createWindTunnelMotion();
      this.position.set(0, windTunnelRoom(this.definition).centerY, 0); this.quaternion.identity(); this.launching = false;
    }
    this.laboratoryState.takeoffHeight = 0; this.laboratoryState.takeoffSpeed = 0;
    this.maxHeight = this.position.y;
    this.aerodynamics.update(this.aircraft.cg, this.quaternion, this.velocity, undefined, this.omega);
    this.updateTelemetry();
    if (!this.launching) this.beginFlight();
  }

  getRecording(): InputRecording {
    if(this.replay) return { ...this.replay, frames:this.replay.frames.slice(), wingLoads:this.replay.wingLoads?.slice() };
    if (!isLaboratory(this.challenge) && this.recordingLength && this.keyframes.at(-1)?.frame !== this.recordingLength) this.captureKeyframe();
    return { frames: this.recording.slice(0, this.recordingLength * FRAME_WIDTH), length: this.recordingLength, launchRoll: this.launchRoll, wingLoads: this.wingLoads.slice(0, this.recordingLength * 3), keyframes: this.keyframes.slice() };
  }

  private captureKeyframe() {
    this.keyframes.push({ time: this.elapsed, frame: this.recordingLength, state: snapshotSimulation(this, this.launchRoll) });
  }

  configureTestSpace(settings: TestSpaceSettings) {
    if (this.challenge !== 'test-space' || this.elapsed > 0) throw Error('只能在开始前调整测试平台');
    this.laboratoryState.testSpaceConfig = testSpaceSettings(settings); this.laboratoryState.launchConfig = testSpaceLaunch(this.laboratoryState.testSpaceConfig);
    this.reset(this.launchRoll);
  }

  setWindTunnel(settings: WindTunnelSettings) {
    if (this.challenge !== 'wind-tunnel') throw Error('风洞参数无效');
    this.laboratoryState.windTarget = windTunnelSettings(settings);
    if (this.definition.assembly.tailOnFin) this.laboratoryState.windTarget.tailIncidence = 0;
  }

  /** Reusable full-fuel steady-flight force probe. Angles are radians; controls normalized. */
  sampleSteadyFlight(speed: number, pitch: number, elevator: number, throttle: number): FlightTelemetry {
    if (this.challenge !== 'test-space' || !Number.isFinite(speed + pitch + elevator + throttle) || speed <= 0 || Math.abs(elevator) > 1 || throttle < 0 || throttle > 1) throw Error('巡航参考参数无效');
    this.seaLevelReference = true; this.launching = false;
    this.ended = false; this.result = null; this.flightStarted = false; this.time = this.elapsed = 0;
    this.fragments.length = 0; this.nextFragmentId = 1;
    this.fuelRemaining = this.definition.fuelTank.capacity;
    if (this.fuelPart) {
      this.fuelPart.mass = this.fuelRemaining * FUEL_DENSITY;
      this.fuelPart.ix = this.fuelPart.mass * this.fuelLocalInertia.x;
      this.fuelPart.iy = this.fuelPart.mass * this.fuelLocalInertia.y;
      this.fuelPart.iz = this.fuelPart.mass * this.fuelLocalInertia.z;
    }
    this.position.set(100, 1000, 0); this.velocity.set(speed, 0, 0); this.omega.set(0, 0, 0);
    this.quaternion.setFromAxisAngle(this.cross.set(0, 0, 1), pitch);
    this.structure.reset();
    this.recomputeMainMass();
    this.updateControlDirections();
    this.applied.elevator = elevator;
    this.engineRpm = throttle;
    this.availableThrust = this.definition.engine.count * engineCatalog[this.definition.engine.type].maxThrust * throttle ** 2;
    this.predictedControls.elevator = elevator; this.predictedControls.aileron = this.predictedControls.rudder = 0;
    for (let iteration = 0; iteration < 4; iteration++) {
      this.evaluateForces(ZERO_CONTROLS, this.velocity, this.omega, this.quaternion, this.position, this.predictedControls);
      if (iteration < 3) this.structure.update(this, this.telemetry.force, this.telemetry.torque);
    }
    for (const surface of this.surfaces) surface.controlCommand = surface.controlCandidate;
    this.updateControlDeflections();
    return this.telemetry;
  }

  setWindTunnelEnabled(enabled: boolean) {
    if (this.challenge !== 'wind-tunnel') throw Error('风洞参数无效');
    this.laboratoryState.windEnabled = enabled;
  }

  /** Restore the aircraft without interrupting the airflow or its transition. */
  restoreWindTunnelAircraft() {
    if (this.challenge !== 'wind-tunnel') return;
    const actual = { ...this.windTunnel }, target = { ...this.laboratoryState.windTarget }, enabled = this.windTunnelEnabled;
    const time = this.time, elapsed = this.elapsed, omega = this.omega.clone(), motion = this.laboratoryState.windMotion;
    this.reset(this.launchRoll);
    Object.assign(this.laboratoryState.windTunnel, actual); this.laboratoryState.windTarget = target; this.laboratoryState.windEnabled = enabled;
    this.time = time; this.elapsed = elapsed; this.omega.copy(omega); this.previousOmega.copy(omega);
    this.laboratoryState.windMotion = motion;
    this.applyWindTunnelFixture(0);
    this.evaluateForces(ZERO_CONTROLS, this.laboratoryState.windVelocity, this.omega, this.quaternion, this.position);
    this.aerodynamics.update(this.cg, this.quaternion, this.laboratoryState.windVelocity, this.torque, this.omega);
    this.updateTelemetry();
  }

  stopTest() {
    if (!isLaboratory(this.challenge) || this.ended) return;
    this.updateTelemetry(); this.finish('manual');
  }

  sampleRail(x: number, out: LowAltitudeRailSample) {
    if (this.challenge !== 'test-space') return lowAltitudeRailSample(x, out);
    out.x = x; out.y = this.laboratoryState.launchConfig!.y + TEST_SPACE.railHeight;
    out.pitch = out.slope = out.pitchDerivative = 0;
    return out;
  }

  /** Move only attached wing geometry; detached parts keep their release geometry. */
  private syncWindTunnelIncidence() {
    for (const key of ['mainWing', 'horizontalTail'] as const) {
      const field = key === 'mainWing' ? 'mainIncidence' : 'tailIncidence';
      const value = key === 'horizontalTail' && this.definition.assembly.tailOnFin ? 0 : this.windTunnel[field];
      const delta = (value - this.definition.assembly[field]) * DEG;
      if (Math.abs(delta) < 1e-12) continue;
      const before = wingOrigin(this.definition, key);
      this.incidenceOldOrigin.set(before.x, before.y, 0);
      this.definition.assembly[field] = value;
      const after = wingOrigin(this.definition, key);
      this.incidenceNewOrigin.set(after.x, after.y, 0);
      this.incidenceRotation.setFromAxisAngle(this.cross.set(0, 0, 1), delta);
      this.incidenceInverse.copy(this.incidenceRotation).invert();
      const c = Math.cos(delta), s = Math.sin(delta);
      for (const section of this.structure.sections) {
        if (section.wingKey !== key || section.bodyId !== 0) continue;
        for (const point of [section.referenceRoot, section.referenceTip, section.referencePoint, section.baseRoot, section.baseTip,
          section.root.position, section.tip.position, section.center]) {
          point.sub(this.incidenceOldOrigin).applyQuaternion(this.incidenceRotation).add(this.incidenceNewOrigin);
        }
        for (const direction of [section.referenceNormal, section.referenceSpan, section.referenceChord, section.referenceCrossflow,
          section.chordAxis, section.normalAxis, section.beamAxis]) direction.applyQuaternion(this.incidenceRotation);
        for (const rotation of [section.root.quaternion, section.tip.quaternion, section.baseRootRotation, section.baseTipRotation]) {
          rotation.premultiply(this.incidenceRotation).multiply(this.incidenceInverse);
        }
        const e = section.inertia.elements, xx = e[0], yy = e[4], xy = e[3], xz = e[6], yz = e[7];
        setInertia(section.inertia, c * c * xx + s * s * yy - 2 * c * s * xy,
          s * s * xx + c * c * yy + 2 * c * s * xy, e[8],
          c * s * (xx - yy) + (c * c - s * s) * xy, c * xz - s * yz, s * xz + c * yz);
        section.surface.incidence = value * DEG;
        for (const index of this.sectionContacts[section.id]) {
          const reference = this.contacts[index].reference;
          if (reference) reference.sub(this.incidenceOldOrigin).applyQuaternion(this.incidenceRotation).add(this.incidenceNewOrigin);
        }
      }
    }
    this.structure.updateGeometry(0);
    for (const part of this.parts) {
      if (part.sectionId !== undefined) {
        const section = this.structure.sections[part.sectionId], e = section.inertia.elements;
        part.x = section.center.x; part.y = section.center.y; part.z = section.center.z;
        part.ix = e[0]; part.iy = e[4]; part.iz = e[8]; part.ixy = e[3]; part.ixz = e[6]; part.iyz = e[7];
      } else if (part.wingSupport) {
        const support = mainWingSupport(this.definition);
        const vx = support.width ** 2 / 12, vy = ((support.frontY - support.backY) ** 2 + support.height ** 2) / 12;
        part.mass = support.mass; part.x = support.x; part.y = support.y;
        part.ix = support.mass * vy; part.iy = support.mass * vx; part.iz = support.mass * (vx + vy);
      }
    }
    this.recomputeMainMass(); this.syncContacts(); this.updateSurfaceExtents();
  }

  private applyWindTunnelFixture(dt: number) {
    if (this.windTunnel.mainIncidence !== this.definition.assembly.mainIncidence || this.windTunnel.tailIncidence !== this.definition.assembly.tailIncidence) this.syncWindTunnelIncidence();
    if (this.definition.birdman) {
      this.weight = this.windTunnel.elevator; this.lateral = this.windTunnel.aileron;
      this.pilotOffset.x = this.weight * this.definition.controls.travel;
      this.pilotOffset.z = this.lateral * this.definition.controls.lateralTravel;
      this.recomputeMainMass();
    }
    this.previousOmega.copy(this.omega); this.inverse.copy(this.quaternion).invert();
    this.quaternion.setFromAxisAngle(this.cross.set(0, 0, 1), this.laboratoryState.windTunnel.pitch * DEG);
    this.rotation.setFromAxisAngle(this.cross.set(1, 0, 0), this.laboratoryState.windTunnel.roll * DEG);
    this.quaternion.multiply(this.rotation);
    this.rotation.copy(this.inverse).multiply(this.quaternion).normalize();
    const sine = Math.hypot(this.rotation.x, this.rotation.y, this.rotation.z);
    if (dt > 0) this.omega.set(this.rotation.x, this.rotation.y, this.rotation.z).multiplyScalar(sine > 1e-12 ? 2 * Math.atan2(sine, this.rotation.w) / (sine * dt) : 0);
    this.position.copy(this.cg).sub(this.launchCg).applyQuaternion(this.quaternion);
    this.position.y += windTunnelRoom(this.definition).centerY;
    this.velocity.set(0, 0, 0);
    this.laboratoryState.windVelocity.set(this.laboratoryState.windTunnel.speed, 0, 0);
    for (const axis of CONTROL_AXES) this.applied[axis] = this.definition.birdman ? 0 : this.laboratoryState.windTunnel[axis];
    this.updateControlDirections();
    mixControlSurfaces(this.surfaces, this.applied, this.effective.smartMixing === true);
    for (const surface of this.surfaces) if (surface.bodyId === 0) surface.controlCommand = surface.controlCandidate;
    this.updateControlDeflections();
  }

  private integrateWindTunnel(dt: number) {
    advanceWindTunnel(this.laboratoryState.windTunnel, this.laboratoryState.windTarget, dt, this.windTunnelEnabled, this.laboratoryState.windMotion!);
    this.applyWindTunnelFixture(dt);
    this.evaluateForces(ZERO_CONTROLS, this.laboratoryState.windVelocity, this.omega, this.quaternion, this.position);
    this.aerodynamics.update(this.cg, this.quaternion, this.laboratoryState.windVelocity, this.torque, this.omega);
    // The fixture balances the net force and torque. Wings still carry their
    // local aerodynamic/self-weight loads and the rig's imposed angular motion.
    this.supportForce.set(0, this.mass * GRAVITY, 0);
    this.supportTorque.subVectors(this.omega, this.previousOmega).multiplyScalar(1 / dt).applyMatrix3(this.inertiaTensor);
    this.angularMomentum.copy(this.omega).applyMatrix3(this.inertiaTensor);
    this.supportTorque.add(this.cross.crossVectors(this.omega, this.angularMomentum));
    this.advanceStructure(dt, this.supportForce, this.supportTorque);
    this.time += dt; this.maxSpeed = Math.max(this.maxSpeed, this.laboratoryState.windTunnel.speed);
    this.updateTelemetry();
  }

  private integrateTestCatapult(input: Controls, dt: number) {
    const oldTime = this.launchTime, oldSpeed = this.velocity.x;
    const duration = testCatapultSample(0, this.laboratoryState.testSpaceConfig).duration;
    const h = Math.min(dt, Math.max(0, duration - oldTime));
    this.launchTime += h;
    const sample = testCatapultSample(this.launchTime, this.laboratoryState.testSpaceConfig);
    const beforeX = testCatapultSample(oldTime, this.laboratoryState.testSpaceConfig).x;
    this.quaternion.identity(); this.omega.set(0, 0, 0);
    this.position.copy(this.cg).sub(this.launchCg).add(this.cross.set(sample.x, this.launchAltitude, 0));
    this.velocity.set(sample.speed, 0, 0);
    this.time += h; this.travelled += sample.x - beforeX;
    if (h > 0) {
      this.evaluateForces(input, this.velocity, this.omega, this.quaternion, this.position);
      this.supportForce.set(this.mass * (sample.speed - oldSpeed) / h, this.mass * GRAVITY, 0);
      this.supportTorque.set(0, 0, 0);
      this.advanceStructure(h, this.supportForce, this.supportTorque);
    }
    this.maxSpeed = Math.max(this.maxSpeed, sample.speed); this.maxHeight = Math.max(this.maxHeight, this.position.y);
    if (duration - this.launchTime <= 1e-12) {
      this.launching = false; this.laboratoryState.takeoffSpeed = this.velocity.length(); this.laboratoryState.takeoffHeight = this.position.y;
      this.beginFlight();
    }
    this.updateTelemetry();
    if (dt - h > 1e-12 && !this.launching) this.integrateFlight(input, dt - h);
  }

  /** Copy the complete mutable physics graph, preserving prototypes and internal aliases.
   * Large append-only recording buffers and the validated aircraft definition are shared. */
  checkpoint(): FlightSimulation {
    const seen = new Map<object, object>([[this.recording, this.recording], [this.wingLoads, this.wingLoads], [this.definition, this.definition], [this.keyframes, this.keyframes]]);
    // Contact solver workspaces are rebuilt before every use; synchronous steps may share them.
    for (const buffer of [this.platformFaces, this.platformGaps, this.platformImpulses, this.platformFriction, this.platformAxes, this.groundNormals, this.platformActive, this.sectionContacts, this.branchContacts]) seen.set(buffer, buffer);
    if (this.replay) seen.set(this.replay, this.replay);
    let bytes = 0;
    const copy = (value: unknown): unknown => {
      if (value === null || typeof value !== 'object') return value;
      if (seen.has(value)) return seen.get(value);
      if (value instanceof Float64Array || value instanceof Int32Array || value instanceof Int8Array) {
        const result = value.slice(); bytes += result.byteLength + 64; seen.set(value, result); return result;
      }
      const result: object = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
      seen.set(value, result);
      const keys = Object.keys(value);
      bytes += 64 + keys.reduce((sum, key) => sum + 24 + key.length * 2, 0);
      for (const key of keys) stateRecord(result)[key] = copy(stateRecord(value)[key]);
      return result;
    };
    // This graph comes only from the existing, typed simulation.
    const result = copy(this) as FlightSimulation;
    checkpointSizes.set(result, bytes);
    return result;
  }

  /** Conservative retained graph estimate; shared recording/design storage is excluded. */
  get checkpointBytes() { return checkpointSizes.get(this) ?? 0; }

  /** Attach immutable recorded inputs to an already restored state without resetting it. */
  resumeReplay(recording: InputRecording, frame: number) {
    this.replay = recording;
    this.replayIndex = frame;
    this.recordingLength = recording.length;
    this.replayFinished = frame >= recording.length;
  }

  loadReplay(recording: InputRecording) {
    if (isLaboratory(this.challenge)) throw Error('测试环境不支持回放');
    validateRecording(recording);
    const copy = { ...recording, frames: recording.frames.slice(0, recording.length * FRAME_WIDTH), wingLoads: recording.wingLoads?.slice() };
    this.reset(copy.launchRoll);
    this.replay = copy;
    this.recording.set(copy.frames);
    this.wingLoads.fill(0);
    if (copy.wingLoads) this.wingLoads.set(copy.wingLoads);
    this.recordingLength = copy.length;
    this.replayFinished = copy.length === 0;
  }

  step(controls: FlightControls, dt = PHYSICS_TICK) {
    if (this.ended || this.replayFinished) return;
    const started = performance.now(), recordingFrame = this.recordingLength;
    if (!this.replay && !isLaboratory(this.challenge) && !this.keyframes.length) this.captureKeyframe();
    const input = this.effective;
    if (this.replay) {
      const offset = this.replayIndex * FRAME_WIDTH;
      dt = this.replay.frames[offset];
      input.weight = this.replay.frames[offset + 1]; input.rudder = this.replay.frames[offset + 2];
      input.elevator = this.replay.frames[offset + 3]; input.aileron = this.replay.frames[offset + 4];
      input.lateral = this.replay.frames[offset + 5];
      input.throttle = this.replay.frames[offset + 6];
      input.autoTrim = this.replay.frames[offset + 7] === 1;
      input.adaptiveControls = this.replay.frames[offset + 8] === 1;
      input.trimPitch = this.replay.frames[offset + 9];
      input.trimRoll = this.replay.frames[offset + 10];
      input.smartMixing = this.replay.frames[offset + 11] === 1;
      this.replayIndex++;
      this.replayFinished = this.replayIndex >= this.replay.length;
    } else {
      input.weight = controls.weight; input.rudder = controls.rudder;
      input.elevator = controls.elevator; input.aileron = controls.aileron;
      input.lateral = controls.lateral ?? 0;
      input.throttle = controls.throttle ?? 0;
      input.autoTrim = controls.autoTrim ?? false;
      input.adaptiveControls = controls.adaptiveControls ?? false;
      input.smartMixing = controls.smartMixing ?? false;
      input.trimPitch = controls.trimPitch ?? 0;
      input.trimRoll = controls.trimRoll ?? 0;
    }
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25) throw new RangeError('步长须在 0 至 0.25 秒之间');
    if (!Number.isFinite(input.weight + input.rudder + input.elevator + input.aileron + input.lateral! + input.throttle! + input.trimPitch! + input.trimRoll!)) throw new RangeError('操纵输入必须为有限数');
    if (this.challenge === 'wind-tunnel') {
      this.elapsed += dt;
      this.integrateTicks(input, dt);
      this.telemetry.physicsMs = performance.now() - started;
      return;
    }
    input.weight = clamp(input.weight, -1, 1); input.rudder = clamp(input.rudder, -1, 1);
    input.elevator = clamp(input.elevator, -1, 1); input.aileron = clamp(input.aileron, -1, 1);
    input.lateral = clamp(input.lateral!, -1, 1);
    input.throttle = clamp(input.throttle!, 0, 1);
    input.trimPitch = clamp(input.trimPitch!, -1, 1); input.trimRoll = clamp(input.trimRoll!, -1, 1);
    if (!isLaboratory(this.challenge) && !this.replay && this.recordingLength < MAX_FRAMES) {
      const offset = this.recordingLength++ * FRAME_WIDTH;
      this.recording[offset] = dt; this.recording[offset + 1] = input.weight;
      this.recording[offset + 2] = input.rudder; this.recording[offset + 3] = input.elevator; this.recording[offset + 4] = input.aileron;
      this.recording[offset + 5] = input.lateral;
      this.recording[offset + 6] = input.throttle;
      this.recording[offset + 7] = input.autoTrim ? 1 : 0;
      this.recording[offset + 8] = input.adaptiveControls ? 1 : 0;
      this.recording[offset + 9] = input.trimPitch;
      this.recording[offset + 10] = input.trimRoll;
      this.recording[offset + 11] = input.smartMixing ? 1 : 0;
    }
    if (this.definition.birdman) { input.elevator = 0; input.aileron = 0; }
    const autoTrim = !this.definition.birdman && input.autoTrim === true;
    if (autoTrim !== this.autoTrim || input.trimPitch !== this.trimPitchInput) this.trimPitchBias = 0;
    if (this.definition.birdman || this.autoTrim && !autoTrim) this.trimPitch = 0;
    else if (input.trimPitch !== this.trimPitchInput || autoTrim && !this.autoTrim) this.trimPitch = input.trimPitch!;
    this.trimPitchInput = input.trimPitch!;
    this.autoTrim = autoTrim;
    this.elapsed += dt;
    this.frameLoads.fill(0);
    this.integrateTicks(input, dt);
    if (!this.replay && recordingFrame < this.recordingLength) this.wingLoads.set(this.frameLoads, recordingFrame * 3);
    this.telemetry.physicsMs = performance.now() - started;
    if (!this.replay && !isLaboratory(this.challenge) && this.recordingLength > recordingFrame && (this.elapsed + 1e-9 >= this.nextKeyframe || this.ended)) {
      this.captureKeyframe();
      this.nextKeyframe = (Math.floor((this.elapsed + 1e-9) / REPLAY_KEYFRAME_INTERVAL) + 1) * REPLAY_KEYFRAME_INTERVAL;
    }
  }

  /** Split at clock boundaries, not at call boundaries. Contact recursion shares the tick. */
  private integrateTicks(input: FlightControls, dt: number) {
    let remaining = dt;
    while (remaining > 0 && !this.ended) {
      if (this.fractureTickElapsed === 0) this.fractureTick++;
      const h = Math.min(remaining, PHYSICS_TICK - this.fractureTickElapsed);
      if (this.challenge === 'wind-tunnel') this.integrateWindTunnel(h);
      else this.integrate(input, h);
      this.fractureTickElapsed += h;
      if (this.fractureTickElapsed >= PHYSICS_TICK - 1e-12) this.fractureTickElapsed = 0;
      remaining -= h;
      if (remaining < 1e-12) remaining = 0;
    }
  }

  private updatePropulsion(throttle: number, dt: number) {
    const count = this.definition.engine.count, spec = engineCatalog[this.definition.engine.type];
    if (count === 0) { this.engineRpm = 0; this.thrust = 0; this.availableThrust = 0; return; }
    const target = this.fuelRemaining > 0 ? throttle : 0, delta = this.engineRpm - target;
    const spoolTime = target > this.engineRpm ? spec.spoolUpTime : spec.spoolDownTime;
    const decay = Math.exp(-dt / spoolTime);
    const integral = Math.max(0, target ** 2 * dt + 2 * target * delta * spoolTime * -Math.expm1(-dt / spoolTime)
      + delta ** 2 * spoolTime / 2 * -Math.expm1(-2 * dt / spoolTime));
    this.engineRpm = target + delta * decay;
    let density = 0;
    for (const engine of this.enginePositions) {
      this.arm.set(engine.x, engine.y, engine.z).sub(this.aircraft.cg).applyQuaternion(this.quaternion).add(this.position);
      density += engineDensityRatio(this.seaLevelReference ? 0 : this.arm.y);
    }
    const required = density * spec.fuelFlow * integral, burned = Math.min(this.fuelRemaining, required);
    this.availableThrust = required > 0 ? count * spec.maxThrust * integral / dt * burned / required : 0;
    if (burned <= 0 || !this.fuelPart) return;
    const removedMass = burned * FUEL_DENSITY, tank = this.definition.fuelTank;
    this.arm.set(tank.x, this.fuelPart.y, 0).sub(this.aircraft.cg);
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
    this.recomputeMainMass();
    // 质心随排出的燃油改变；保留机体几何和刚体速度场连续，不凭空推动剩余飞机。
    this.cgShift.subVectors(this.aircraft.cg, this.cgShift);
    this.cross.crossVectors(this.omega, this.cgShift).applyQuaternion(this.quaternion);
    this.velocity.add(this.cross);
    this.cgShift.applyQuaternion(this.quaternion);
    this.position.add(this.cgShift);
  }

  private integrate(input: FlightControls, dt: number) {
    // Quasi-static impact loads use the nominal physics interval. Narrowing a
    // swept-contact search must not turn the same impulse into infinite stress.
    this.controlLimit = 1;
    const trimming = this.autoTrim && !this.launching && Math.abs(input.elevator) < 0.05 && this.velocity.lengthSq() >= 25;
    this.updatePropulsion(input.throttle!, dt);
    // 前后移动仍沿用原准静态代理；侧移使用完整非对称惯量并守恒机体轴角动量。
    this.weight += clamp(input.weight - this.weight, -dt * 1.5, dt * 1.5);
    this.lateral += clamp(input.lateral! - this.lateral, -dt * 1.5, dt * 1.5);
    this.pilotOffset.x = this.weight * this.definition.controls.travel;
    this.pilotOffset.z = this.lateral * this.definition.controls.lateralTravel;
    const onRail = this.railAttached;
    let railSpeed = 0;
    const oldEnergy = rotationalEnergy(this.inertiaTensor, this.omega);
    const oldKinetic = onRail ? this.mass * this.velocity.lengthSq() / 2 + oldEnergy : 0;
    if (onRail) {
      this.railGeometry(this.railX, this.railStart, this.midpointPosition, this.railStartDerivative);
      railSpeed = this.velocity.dot(this.railStartDerivative) / this.railStartDerivative.lengthSq();
    }
    this.angularMomentum.copy(this.omega).applyMatrix3(this.inertiaTensor);
    this.cgShift.copy(this.aircraft.cg);
    this.recomputeMainMass();
    this.omega.copy(this.angularMomentum).applyMatrix3(this.inverseInertia);
    if (!onRail) this.telemetry.controlWork += rotationalEnergy(this.inertiaTensor, this.omega) - oldEnergy;
    if (onRail) {
      this.cgShift.subVectors(this.aircraft.cg, this.cgShift).applyQuaternion(this.quaternion);
      this.position.add(this.cgShift);
      this.telemetry.controlWork += this.mass * GRAVITY * this.cgShift.y;
      this.railGeometry(this.railX, this.railStart, this.midpointPosition, this.railStartDerivative);
      this.velocity.copy(this.railStartDerivative).multiplyScalar(railSpeed);
      this.omega.set(0, 0, this.railStart.pitchDerivative * railSpeed);
      this.telemetry.controlWork += this.mass * this.velocity.lengthSq() / 2 + rotationalEnergy(this.inertiaTensor, this.omega) - oldKinetic;
    }
    this.updateControlDirections();
    const pitchDamping = trimming ? this.updateAutoTrim(dt) : 0;
    for (const axis of CONTROL_AXES) {
      const trim = this.definition.birdman ? 0 : axis === 'elevator' ? clamp(this.trimPitch + pitchDamping, -1, 1) : axis === 'aileron' ? input.trimRoll! : 0;
      this.requestedControls[axis] = mixTrim(input[axis], trim);
    }
    if (input.adaptiveControls) {
      const magnitude = Math.max(Math.abs(this.requestedControls.aileron), Math.abs(this.requestedControls.elevator), Math.abs(this.requestedControls.rudder));
      for (const axis of CONTROL_AXES) this.fullControls[axis] = magnitude > 0 ? this.requestedControls[axis] / magnitude : 0;
      const safeLimit = this.adaptiveControlLimit(this.fullControls);
      // 安全收紧立即生效；恢复采用0.75s时间常数，避免每步在满舵与零舵间切换。
      this.controlAuthority = Math.min(safeLimit, this.controlAuthority + (safeLimit - this.controlAuthority) * (1 - Math.exp(-dt / 0.75)));
      this.controlLimit = this.controlAuthority;
    } else this.controlAuthority = 1;
    for (const axis of CONTROL_AXES) {
      const target = this.requestedControls[axis] * this.controlLimit;
      this.fullControls[axis] = target;
      this.applied[axis] = clamp(this.applied[axis] + clamp(target - this.applied[axis], -CONTROL_SURFACE_RATE * dt, CONTROL_SURFACE_RATE * dt),
        -this.controlLimit, this.controlLimit);
    }
    mixControlSurfaces(this.surfaces, this.fullControls, input.smartMixing === true);
    for (const surface of this.surfaces) if (surface.bodyId === 0) {
      const target = surface.controlCandidate;
      surface.controlCommand = clamp(surface.controlCommand + clamp(target - surface.controlCommand,
        -CONTROL_SURFACE_RATE * dt, CONTROL_SURFACE_RATE * dt), -this.controlLimit, this.controlLimit);
    }
    if (input.adaptiveControls) {
      // A reversing actuator's intermediate state may be less safe than its target.
      const transitionLimit = this.adaptiveControlLimit();
      for (const axis of CONTROL_AXES) this.applied[axis] *= transitionLimit;
      for (const surface of this.surfaces) if (surface.bodyId === 0) surface.controlCommand *= transitionLimit;
    }
    this.updateControlDeflections();
    if (this.launching && this.challenge === 'test-space' && this.testSpace.catapult) {
      this.integrateTestCatapult(input, dt); return;
    }
    if (this.railAttached) {
      if (!this.flightStarted) this.beginFlight();
      this.integrateFlight(input, dt);
      return;
    }
    if (this.launching) {
      const launch = this.launch;
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
      this.cgShift.subVectors(this.aircraft.cg, this.launchCg).applyQuaternion(this.quaternion);
      this.position.add(this.cgShift);
      const speed = acceleration * this.launchTime;
      this.velocity.set(speed * Math.cos(slope), -speed * Math.sin(slope), 0);
      this.arm.subVectors(this.aircraft.cg, this.launchCg);
      this.velocity.add(this.cross.crossVectors(this.omega, this.arm).applyQuaternion(this.quaternion));
      if (this.challenge === 'birdman') this.time += h;
      this.travelled += 0.5 * acceleration * (this.launchTime ** 2 - oldTime ** 2);
      if (h > 0) {
        this.evaluateForces(input, this.velocity, this.omega, this.quaternion, this.position);
        // 发射架提供指定平动/滚转约束；梁承受实际气动、自重及该运动场的惯性载荷。
        this.supportForce.set(acceleration * Math.cos(slope) * this.mass, (GRAVITY - acceleration * Math.sin(slope)) * this.mass, 0);
        this.angularAcceleration.set(this.launchRoll * 60 * u * (1 - u) * (1 - 2 * u) / duration ** 2, 0, 0);
        this.arm.subVectors(this.aircraft.cg, this.launchCg);
        this.cross.crossVectors(this.angularAcceleration, this.arm);
        this.localVelocity.crossVectors(this.omega, this.arm);
        this.cross.add(this.arm.crossVectors(this.omega, this.localVelocity)).applyQuaternion(this.quaternion);
        this.supportForce.addScaledVector(this.cross, this.mass);
        this.supportTorque.copy(this.angularAcceleration).applyMatrix3(this.inertiaTensor);
        this.angularMomentum.copy(this.omega).applyMatrix3(this.inertiaTensor);
        this.supportTorque.add(this.cross.crossVectors(this.omega, this.angularMomentum));
        this.advanceStructure(h, this.supportForce, this.supportTorque);
      }
      if (duration - this.launchTime <= 1e-12) {
        this.cgShift.subVectors(this.aircraft.cg, this.launchCg).applyQuaternion(this.quaternion);
        this.position.x = (launch?.endX ?? LAUNCH.endX) + this.cgShift.x;
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

  /** Actual deformed geometry and local airflow define independent actuator authority. */
  private updateControlDirections() {
    if (this.effective.smartMixing) {
      this.evaluateForces(ZERO_CONTROLS, this.challenge === 'wind-tunnel' ? this.laboratoryState.windVelocity : this.velocity,
        this.omega, this.quaternion, this.position, undefined, 1, true);
      coupledControlMoments(this.surfaces);
    }
    for (const surface of this.surfaces) if (surface.bodyId === 0) {
      this.arm.subVectors(surface.point, this.cg);
      surface.controlProjection.crossVectors(this.arm, surface.normal).normalize();
      if (!this.effective.smartMixing || surface.controlEffectiveness === 0 || surface.controlResponse === 0) surface.controlMoment.set(0, 0, 0);
    }
  }

  private updateControlDeflections() {
    this.controlDeflections.aileron = this.applied.aileron * AILERON_LIMIT;
    this.controlDeflections.elevator = -this.applied.elevator * HORIZONTAL_LIMIT;
    this.controlDeflections.rudder = this.applied.rudder * RUDDER_LIMIT;
    for (const section of this.structure.sections) if (section.bodyId === 0) {
      const surface = section.surface as AerodynamicSurface;
      // Rotation axes point outboard on horizontal wings and along signed fin height.
      const incidence = surface.controlCommand * (surface.kind === 'vertical' ? RUDDER_LIMIT : HORIZONTAL_LIMIT);
      section.controlDeflection = incidence * (surface.kind === 'vertical' ? -Math.sign(surface.spanDirection.y) : surface.side);
    }
  }

  /** Predict equilibrium trim; apply rate damping separately, without another low-pass delay. */
  private updateAutoTrim(dt: number) {
    this.trimOmega.copy(this.omega); this.trimOmega.z = 0;
    Object.assign(this.predictedControls, this.applied);
    const low = Math.max(-1, this.applied.elevator - 0.01), high = Math.min(1, this.applied.elevator + 0.01);
    this.predictedControls.elevator = low;
    this.evaluateForces(ZERO_CONTROLS, this.velocity, this.trimOmega, this.quaternion, this.position, this.predictedControls);
    this.angularMomentum.copy(this.trimOmega).applyMatrix3(this.inertiaTensor);
    this.cross.crossVectors(this.trimOmega, this.angularMomentum);
    const lowAcceleration = this.angularAcceleration.copy(this.torque).sub(this.cross).applyMatrix3(this.inverseInertia).z;
    this.predictedControls.elevator = high;
    this.evaluateForces(ZERO_CONTROLS, this.velocity, this.trimOmega, this.quaternion, this.position, this.predictedControls);
    this.angularMomentum.copy(this.trimOmega).applyMatrix3(this.inertiaTensor);
    this.cross.crossVectors(this.trimOmega, this.angularMomentum);
    const highAcceleration = this.angularAcceleration.copy(this.torque).sub(this.cross).applyMatrix3(this.inverseInertia).z;
    const authority = (highAcceleration - lowAcceleration) / (high - low);
    // A stalled or missing elevator cannot provide the requested restoring moment.
    if (authority >= -1e-6) return 0;
    const equilibrium = clamp(low - lowAcceleration / authority, -1, 1);
    const damping = clamp(-4 * this.omega.z / authority, -1, 1);
    // Remove persistent prediction/midpoint error; never wind up against travel or structural limits.
    const correction = -8 * this.omega.z / authority * dt;
    const requested = equilibrium + this.trimPitchBias + damping;
    if (correction * (this.requestedControls.elevator - this.applied.elevator) <= 1e-10
      && correction * (requested - clamp(requested, -1, 1)) <= 1e-10) {
      this.trimPitchBias = clamp(this.trimPitchBias + correction, -1, 1);
    }
    const target = clamp(equilibrium + this.trimPitchBias, -1, 1);
    const change = (target - this.trimPitch) * -Math.expm1(-dt / 0.25);
    this.trimPitch = clamp(this.trimPitch + clamp(change, -0.5 * dt, 0.5 * dt), -1, 1);
    return damping;
  }

  private predictControlStress(controls: Controls | undefined, scale: number): number {
    if (controls) for (const axis of CONTROL_AXES) this.predictedControls[axis] = controls[axis] * scale;
    this.evaluateForces(ZERO_CONTROLS, this.velocity, this.omega, this.quaternion, this.position, controls ? this.predictedControls : undefined, controls ? 1 : scale);
    return this.structure.predictStress(this, this.telemetry.force, this.telemetry.torque);
  }

  /** 冻结当前状态，直接重算候选舵量的气动力、惯性载荷及真实梁利用率。 */
  private adaptiveControlLimit(controls?: Controls): number {
    // 零舵已有的气动/惯性/水载不能靠限制杆量消除，也不钳制真实应力或免除断裂。
    if (this.predictControlStress(controls, 0) >= ADAPTIVE_STRESS_TARGET) return 0;
    if (this.predictControlStress(controls, 1) <= ADAPTIVE_STRESS_TARGET) return 1;
    let safe = 0, unsafe = 1;
    for (let iteration = 0; iteration < 14; iteration++) {
      const candidate = (safe + unsafe) / 2;
      if (this.predictControlStress(controls, candidate) <= ADAPTIVE_STRESS_TARGET) safe = candidate;
      else unsafe = candidate;
    }
    return safe;
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
    this.telemetry.waterWork = 0;
  }

  private waterHeight(x: number, z: number) {
    if (this.challenge === 'test-space') return z >= TEST_SPACE.beachHalfWidth ? 0 : -Infinity;
    if (this.challenge === 'wind-tunnel') return -Infinity;
    if (this.challenge === 'birdman') return 0;
    if (this.challenge !== 'low-altitude' || this.onRunway(x, z)
      || Math.abs(z - challengeRiverCenter(x)) > CHALLENGE_RIVER.width / 2) return -Infinity;
    const height = challengeRiverHeight(x);
    return challengeTerrainHeight(this.challenge, x, z) < height ? height : -Infinity;
  }

  /** Same immersion geometry drives both air-wake circulation and water loads. */
  private surfaceImmersion(surface: AerodynamicSurface, orientation: Quaternion, position: Vector3) {
    this.waterPoint.copy(this.arm).applyQuaternion(orientation).add(position);
    const height = this.waterHeight(this.waterPoint.x, this.waterPoint.z);
    if (height === -Infinity) return 0;
    this.waterAxis.copy(surface.spanDirection).applyQuaternion(orientation);
    let halfDepth = Math.abs(this.waterAxis.y) * (surface.spanEnd - surface.spanStart) / 2;
    this.waterAxis.copy(surface.chordDirection).applyQuaternion(orientation);
    halfDepth += Math.abs(this.waterAxis.y) * surface.chord / 2;
    this.waterAxis.copy(surface.normal).applyQuaternion(orientation);
    halfDepth = Math.max(1e-4, halfDepth + Math.abs(this.waterAxis.y) * surface.chord * WATER.wingThicknessRatio / 2);
    return clamp((height - this.waterPoint.y + halfDepth) / (2 * halfDepth), 0, 1);
  }

  /** 每个已有翼段只求一次水载，不把整翼空气密度切到水密度。 */
  private surfaceWater(surface: AerodynamicSurface) {
    const wet = 1 - surface.airFraction;
    if (wet === 0) return 0;
    surface.force.multiplyScalar(1 - wet); surface.drag.multiplyScalar(1 - wet);
    surface.moment.multiplyScalar(1 - wet);
    surface.inducedDrag *= 1 - wet;
    const speed = this.localVelocity.length();
    const projected = speed > 1e-9 ? Math.abs(this.localVelocity.dot(surface.normal)) / speed : 0;
    const area = surface.area * (WATER.wingEdgeDrag + (1 - WATER.wingEdgeDrag) * projected);
    this.localDrag.copy(this.localVelocity).multiplyScalar(-0.5 * WATER.density * WATER.wingDragCoefficient * area * wet * speed);
    surface.drag.add(this.localDrag); surface.force.add(this.localDrag);
    this.buoyancy.set(0, WATER.density * GRAVITY * surface.area * surface.chord * WATER.wingVolumeRatio * wet, 0)
      .applyQuaternion(this.inverse);
    this.waterPower += this.buoyancy.dot(this.localVelocity);
    surface.force.add(this.buoyancy);
    return wet;
  }

  private bodyWater(omega: Vector3, orientation: Quaternion, position: Vector3) {
    for (const sample of this.waterBody) {
      this.arm.copy(sample.point).sub(this.aircraft.cg);
      this.waterPoint.copy(this.arm).applyQuaternion(orientation).add(position);
      const height = this.waterHeight(this.waterPoint.x, this.waterPoint.z);
      this.waterAxis.set(0, 1, 0).applyQuaternion(this.inverse);
      const shell = this.cockpitShape;
      // ponytail: 五个机身截面用投影包围高度；需精确水线时再细分椭球切片。
      const halfDepth = Math.max(1e-4, sample.radius * Math.hypot(this.waterAxis.y, this.waterAxis.z * shell.zRadius / shell.yRadius)
        + Math.abs(this.waterAxis.x) * shell.xRadius / WATER.bodySamples);
      const wet = clamp((height - this.waterPoint.y + halfDepth) / (2 * halfDepth), 0, 1);
      if (wet === 0) continue;
      this.localVelocity.crossVectors(omega, this.arm).add(this.bodyVelocity);
      this.localDrag.copy(this.localVelocity).multiplyScalar(-0.5 * WATER.density * WATER.bodyDragCoefficient
        * sample.area * wet * this.localVelocity.length());
      this.telemetry.aeroPower += this.localDrag.dot(this.localVelocity);
      this.buoyancy.set(0, WATER.density * GRAVITY * sample.volume * wet, 0).applyQuaternion(this.inverse);
      this.waterPower += this.buoyancy.dot(this.localVelocity);
      this.cross.copy(this.localDrag).add(this.buoyancy);
      this.torque.add(this.waterAxis.crossVectors(this.arm, this.cross));
      this.cross.applyQuaternion(orientation); this.localDrag.applyQuaternion(orientation);
      this.telemetry.force.add(this.cross); this.telemetry.drag.add(this.localDrag);
    }
  }

  private evaluateForces(_input: Controls, velocity: Vector3, omega: Vector3, orientation: Quaternion, position: Vector3, controls?: Controls, surfaceScale = 1, linearize = false) {
    if (controls) mixControlSurfaces(this.surfaces, controls, this.effective.smartMixing === true);
    this.inverse.copy(orientation).invert();
    this.bodyVelocity.copy(velocity).applyQuaternion(this.inverse);
    const speed = velocity.length();
    this.torque.set(0, 0, 0);
    this.telemetry.force.set(0, 0, 0); this.telemetry.drag.set(0, 0, 0);
    let power = 0;
    this.waterPower = 0;
    for (const surface of this.surfaces) {
      if (surface.bodyId !== 0) continue;
      this.arm.copy(surface.point).sub(this.aircraft.cg);
      // 鸟人间地效保持相对连续水面；山谷使用同一可见三角地形的局部净空。
      this.cross.copy(this.arm).applyQuaternion(orientation).add(position);
      surface.clearance = this.seaLevelReference ? Infinity : this.cross.y - challengeCollisionHeight(this.challenge, this.cross.x, this.cross.z);
      surface.groundEffect = 1;
      if (surface.kind !== 'vertical') {
        this.cross.copy(surface.spanDirection).applyQuaternion(orientation);
        const span = surface.span * Math.hypot(this.cross.x, this.cross.z);
        surface.groundEffect = groundEffectFactor(surface.clearance, span);
      }
      surface.airFraction = this.seaLevelReference ? 1 : 1 - this.surfaceImmersion(surface, orientation, position);
    }
    this.wakeGroundNormal.set(0, 1, 0).applyQuaternion(this.inverse);
    evaluateCoupledSurfaces(this.surfaces, 0, this.bodyVelocity, omega, this.cg,
      this.polar, this.liftDirection, this.wakeGroundNormal, !!controls, surfaceScale, false, linearize);
    for (const surface of this.surfaces) {
      if (surface.bodyId !== 0) continue;
      this.arm.copy(surface.point).sub(this.aircraft.cg);
      this.localVelocity.copy(surface.localFlow);
      const previousWaterPower = this.waterPower;
      this.surfaceWater(surface);
      // Integrate the complete pressure wrench; buoyancy has its own work ledger.
      power += surface.force.dot(this.localVelocity) + surface.moment.dot(omega) - (this.waterPower - previousWaterPower);
      this.cross.crossVectors(this.arm, surface.force); this.torque.add(this.cross).add(surface.moment);
      surface.force.applyQuaternion(orientation);
      surface.moment.applyQuaternion(orientation);
      surface.drag.applyQuaternion(orientation);
      this.telemetry.force.add(surface.force); this.telemetry.drag.add(surface.drag);
    }
    this.aerodynamics.updateBody(this.aircraft.cg, this.bodyVelocity, omega);
    this.torque.add(this.aerodynamics.bodyTorque);
    this.localDrag.copy(this.aerodynamics.bodyDrag).applyQuaternion(orientation);
    this.telemetry.force.add(this.localDrag); this.telemetry.drag.add(this.localDrag);
    power += this.aerodynamics.bodyPower;
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
    this.bodyWater(omega, orientation, position);
    // 推进力不属于气动升阻比。
    const drag = speed > 1e-9 ? -this.telemetry.force.dot(velocity) / speed : 0;
    this.telemetry.liftDragRatio = drag > 1e-9
      ? Math.sqrt(Math.max(0, this.telemetry.force.lengthSq() - drag ** 2)) / drag : 0;
    this.propulsionPower = 0;
    this.thrust = 0;
    if (this.availableThrust > 0) {
      const staticThrust = this.availableThrust / this.enginePositions.length;
      for (const engine of this.enginePositions) {
        this.arm.set(engine.x, engine.y, engine.z).sub(this.aircraft.cg);
        this.localVelocity.crossVectors(omega, this.arm).add(this.bodyVelocity);
        this.cross.copy(this.arm).applyQuaternion(orientation).add(position);
        const thrust = staticThrust * engineThrustFactor(this.seaLevelReference ? 0 : this.cross.y, this.localVelocity.x, spec.exhaustVelocity);
        this.thrust += thrust;
        this.propulsionPower += thrust * this.localVelocity.x;
        this.torque.y += this.arm.z * thrust;
        this.torque.z -= this.arm.y * thrust;
      }
      this.cross.set(this.thrust, 0, 0).applyQuaternion(orientation);
      this.telemetry.force.add(this.cross);
    }
    this.telemetry.torque.copy(this.torque);
  }

  /** 同一导轨参数同时确定CG曲线、姿态及其切线；参考连接点固定在设计坐标中。 */
  private railGeometry(x: number, sample: LowAltitudeRailSample, position: Vector3, derivative: Vector3): number {
    this.sampleRail(x, sample);
    const c = Math.cos(sample.pitch), s = Math.sin(sample.pitch);
    const ox = this.cg.x - this.launchCg.x;
    const launch = this.launch!;
    const oy = this.cg.y - this.launchCg.y + this.launchAltitude - launch.y - LOW_ALTITUDE_RAIL.height;
    const rx = c * ox - s * oy, ry = s * ox + c * oy;
    position.set(x + rx, sample.y + ry, launch.z + this.cg.z - this.launchCg.z);
    derivative.set(1 - ry * sample.pitchDerivative, sample.slope + rx * sample.pitchDerivative, 0);
    return this.mass * derivative.lengthSq() + this.inertiaTensor.elements[8] * sample.pitchDerivative ** 2;
  }

  private solveRailMidpoint(input: Controls, dt: number): boolean {
    const m0 = this.railGeometry(this.railX, this.railStart, this.midpointPosition, this.railStartDerivative);
    const u0 = this.velocity.dot(this.railStartDerivative) / this.railStartDerivative.lengthSq();
    let u1 = u0;
    for (let iteration = 0; iteration < 60; iteration++) {
      const q1 = this.railX + (u0 + u1) * dt / 2;
      const m1 = this.railGeometry(q1, this.railEnd, this.candidatePosition, this.railEndDerivative);
      const dq = q1 - this.railX, dp = this.railEnd.pitch - this.railStart.pitch;
      // 离散梯度让真实推力/阻力功恰好等于平动、转动和重力势能变化，不补能量账本。
      if (Math.abs(dq) > 1e-10) this.midpointVelocity.subVectors(this.candidatePosition, this.position).multiplyScalar(1 / dq);
      else this.midpointVelocity.copy(this.railStartDerivative);
      const pitchGradient = Math.abs(dq) > 1e-10 ? dp / dq : this.railStart.pitchDerivative;
      const massGradient = Math.abs(dq) > 1e-10 ? (m1 - m0) / dq : 0;
      const gravity = this.mass * GRAVITY * this.midpointVelocity.y;
      const qSpeed = (u0 + u1) / 2;
      this.midpointVelocity.multiplyScalar(qSpeed);
      this.midpointOmega.set(0, 0, pitchGradient * qSpeed);
      this.midpointPosition.copy(this.position).add(this.candidatePosition).multiplyScalar(0.5);
      const pitch = (this.railStart.pitch + this.railEnd.pitch) / 2;
      this.midpointQuaternion.setFromAxisAngle(this.cross.set(0, 0, 1), pitch);
      this.evaluateForces(input, this.midpointVelocity, this.midpointOmega, this.midpointQuaternion, this.midpointPosition);
      this.cross.set(-Math.sin(pitch), Math.cos(pitch), 0);
      this.candidateVelocity.copy(this.railEndDerivative).multiplyScalar(u1);
      this.localDrag.subVectors(this.candidateVelocity, this.previousVelocity).multiplyScalar(1 / dt);
      const normal = Math.max(0, this.mass * (GRAVITY * Math.cos(pitch) + this.localDrag.dot(this.cross))
        - this.telemetry.force.dot(this.cross));
      const rollingLimit = normal * LOW_ALTITUDE_RAIL.rollingResistance / Math.cos(pitch);
      const generalized = Math.abs(qSpeed) > 1e-12
        ? (this.telemetry.force.dot(this.midpointVelocity) + this.torque.z * this.midpointOmega.z) / qSpeed
        : this.telemetry.force.dot(this.railStartDerivative) + this.torque.z * pitchGradient;
      const inertial = massGradient * (u0 * u0 + u1 * u1) / 4;
      const meanMass = (m0 + m1) / 2;
      const freeSpeed = u0 + dt * (generalized - gravity - inertial) / meanMass;
      // 库仑滚阻可使滑车停下，但不会凭空反向加速。
      const rolling = Math.sign(freeSpeed) * Math.min(rollingLimit, Math.abs(freeSpeed) * meanMass / dt);
      const next = freeSpeed - dt * rolling / meanMass;
      // 速度残差乘上质量与速度就是每步能量误差，须收敛到浮点精度而非相对1e-13。
      if (Math.abs(next - u1) <= Number.EPSILON * Math.max(1, Math.abs(u1))) {
        this.railRollingPower = Math.max(0, rolling * qSpeed);
        this.candidateOmega.set(0, 0, this.railEnd.pitchDerivative * u1);
        this.candidateQuaternion.setFromAxisAngle(this.cross.set(0, 0, 1), this.railEnd.pitch);
        return true;
      }
      u1 = next;
    }
    return false;
  }

  private integrateFlight(input: Controls, dt: number) {
    if (this.ended) return;
    const onRail = this.railAttached;
    const initialLanding = this.landingAt(this.position, this.quaternion);
    if (initialLanding) { this.updateTelemetry(); this.finish(initialLanding); return; }
    this.preparePlatformContacts();
    this.resolvePlatformImpact(true);
    const mass = this.aircraft.mass;
    this.previousVelocity.copy(this.velocity); this.previousOmega.copy(this.omega);
    this.midpointVelocity.copy(this.velocity); this.midpointOmega.copy(this.omega);
    let converged = false;
    // 隐式中点同时求解平动、转动及陀螺项，使动能差严格对应中点功。
    if (onRail) converged = this.solveRailMidpoint(input, dt);
    for (let iteration = 0; !onRail && iteration < 40; iteration++) {
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
      this.angularMomentum.copy(this.midpointOmega).applyMatrix3(this.inertiaTensor);
      this.cross.crossVectors(this.midpointOmega, this.angularMomentum);
      this.angularAcceleration.copy(this.torque).sub(this.cross).applyMatrix3(this.inverseInertia);
      this.candidateOmega.copy(this.previousOmega).addScaledVector(this.angularAcceleration, dt / 2);
      this.constrainPlatformMidpoint(dt);
      const residual = this.candidateVelocity.distanceToSquared(this.midpointVelocity)
        + this.candidateOmega.distanceToSquared(this.midpointOmega);
      if (!Number.isFinite(residual)) break;
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
    if (onRail && (this.railX >= this.launch!.endX || this.canLiftOffRail(dt))) {
      this.launching = false;
      if (this.challenge === 'test-space') { this.laboratoryState.takeoffSpeed = this.velocity.length(); this.laboratoryState.takeoffHeight = this.position.y; }
      this.integrateFlight(input, dt);
      return;
    }
    let angle = this.midpointOmega.length() * dt;
    if (!onRail) {
      this.candidatePosition.copy(this.position).addScaledVector(this.midpointVelocity, dt);
      this.candidateQuaternion.copy(this.quaternion);
      if (angle > 0) {
        this.cross.copy(this.midpointOmega).normalize(); this.rotation.setFromAxisAngle(this.cross, angle);
        this.candidateQuaternion.multiply(this.rotation).normalize();
      }
      this.candidateVelocity.copy(this.midpointVelocity).multiplyScalar(2).sub(this.previousVelocity);
    }
    const landing = this.landingAt(this.candidatePosition, this.candidateQuaternion, this.candidateVelocity.lengthSq());
    const noseHit = this.sweepsNose();
    const platformHit = this.sweepsPlatform();
    const terrainHit = this.challenge !== 'birdman' && this.sweepsTerrain();
    const finalGate = challengeCheckpoints(this.challenge)[this.checkpointIndex];
    const finishCrossing = finalGate && this.checkpointIndex === challengeCheckpoints(this.challenge).length - 1
      && this.position.x < finalGate.x && this.candidatePosition.x >= finalGate.x;
    const railEnd = onRail && this.railEnd.x >= this.launch!.endX;
    if ((railEnd && dt > 1e-7) || (platformHit && dt > 1e-8) || (terrainHit && dt > 1e-7)
      || (noseHit && dt > 1e-7) || (finishCrossing && dt > 1e-7) || angle > 0.1) {
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
    this.aerodynamics.update(this.aircraft.cg, this.midpointQuaternion, this.midpointVelocity, this.torque, this.midpointOmega);
    const speed = this.previousVelocity.length();
    if (onRail) {
      this.velocity.copy(this.candidateVelocity);
      this.omega.copy(this.candidateOmega);
      this.railX = this.railEnd.x;
    } else {
      this.velocity.copy(this.midpointVelocity).multiplyScalar(2).sub(this.previousVelocity);
      this.omega.copy(this.midpointOmega).multiplyScalar(2).sub(this.previousOmega);
    }
    this.previousPosition.copy(this.position);
    this.position.copy(this.candidatePosition);
    this.quaternion.copy(this.candidateQuaternion);
    this.telemetry.dissipatedEnergy -= this.telemetry.aeroPower * dt;
    this.telemetry.propulsionWork += this.propulsionPower * dt;
    this.telemetry.waterWork += this.waterPower * dt;
    for (let i = 0; i < this.platformCount; i++) {
      const index = this.platformActive[i], normal = this.groundNormals[index];
      const contactSpeed = normal.dot(this.midpointVelocity) + this.platformAxes[index].dot(this.midpointOmega);
      this.telemetry.dissipatedEnergy -= 2 * this.platformImpulses[index] * contactSpeed;
      const friction = this.platformFriction[index];
      this.arm.copy(this.contacts[Math.floor(index / CONTACT_SLOTS)]).sub(this.aircraft.cg);
      this.cross.crossVectors(this.midpointOmega, this.arm).applyQuaternion(this.midpointQuaternion);
      const halfAngle = this.midpointOmega.length() * dt / 2;
      const sinc = halfAngle > 1e-8 ? Math.sin(halfAngle) / halfAngle : 1 - halfAngle ** 2 / 6;
      this.telemetry.dissipatedEnergy -= 2 * (friction.dot(this.midpointVelocity) + sinc * friction.dot(this.cross));
      if (!onRail) {
        this.contactNormal.copy(normal).applyQuaternion(this.inverse.copy(this.midpointQuaternion).invert());
        // The constraint solves a half-step velocity; its full-step impulse is 2J.
        this.addWingContactImpulse(index, this.contactNormal, 2 * this.platformImpulses[index]);
        this.contactNormal.copy(friction).applyQuaternion(this.inverse);
        this.addWingContactImpulse(index, this.contactNormal, 2);
      }
    }
    if (onRail) {
      this.telemetry.dissipatedEnergy += this.railRollingPower * dt;
      if (railEnd) {
        this.launching = false;
        if (this.challenge === 'test-space') { this.laboratoryState.takeoffSpeed = this.velocity.length(); this.laboratoryState.takeoffHeight = this.position.y; }
      }
    }
    const timed = this.challenge === 'birdman' || this.challenge === 'test-space' || this.raceStarted ? dt : 0;
    const scoringTime = !landing ? this.advanceChallenge(dt, timed) : timed;
    this.time += scoringTime;
    const currentSpeed = this.velocity.length();
    if (this.challenge === 'birdman' || this.challenge === 'test-space' || this.raceStarted) this.travelled += (speed + currentSpeed) * 0.5 * scoringTime;
    if (this.challenge === 'low-altitude' && this.raceStarted && scoringTime > 0) this.updateLowAltitudeScore(scoringTime);
    this.maxSpeed = Math.max(this.maxSpeed, currentSpeed); this.minSpeed = Math.min(this.minSpeed, currentSpeed);
    this.maxHeight = Math.max(this.maxHeight, this.position.y);
    if (platformHit || terrainHit) { this.preparePlatformContacts(); this.resolvePlatformImpact(); }
    this.supportForce.subVectors(this.velocity, this.previousVelocity).multiplyScalar(mass / dt);
    this.supportForce.y += mass * GRAVITY;
    // Initial impacts occur before previousVelocity/previousOmega are saved.
    // Include them once in both the inertial load field and the local load path.
    this.supportForce.addScaledVector(this.initialImpactImpulse, 1 / STRUCTURAL_IMPACT_DURATION);
    this.supportTorque.subVectors(this.omega, this.previousOmega).applyMatrix3(this.inertiaTensor).multiplyScalar(1 / dt);
    this.angularMomentum.copy(this.midpointOmega).applyMatrix3(this.inertiaTensor);
    this.supportTorque.add(this.cross.crossVectors(this.midpointOmega, this.angularMomentum));
    this.supportTorque.addScaledVector(this.initialImpactTorque, 1 / STRUCTURAL_IMPACT_DURATION);
    const impactScale = 1 / STRUCTURAL_IMPACT_DURATION - 1 / dt;
    this.supportForce.addScaledVector(this.finalImpactImpulse, impactScale);
    this.supportTorque.addScaledVector(this.finalImpactTorque, impactScale);
    this.advanceStructure(dt, this.supportForce, this.supportTorque);
    this.updateTelemetry();
    if (landing) this.finish(landing);
    else if (this.completed) this.finish('finish');
    else if (this.outsideChallenge()) this.finish('boundary');
  }

  private canLiftOffRail(dt: number): boolean {
    const pitch = (this.railStart.pitch + this.railEnd.pitch) / 2;
    this.contactNormal.set(-Math.sin(pitch), Math.cos(pitch), 0);
    this.cross.subVectors(this.candidateVelocity, this.previousVelocity).multiplyScalar(1 / dt);
    const upwardAcceleration = this.telemetry.force.dot(this.contactNormal) / this.mass
      - GRAVITY * Math.cos(pitch) - this.cross.dot(this.contactNormal);
    if (upwardAcceleration <= LOW_ALTITUDE_RAIL.retentionAcceleration) return false;
    // 所有完整接触点都须比导轨约束运动更向外加速；机头/翼尖仍下压时保持连接。
    this.angularMomentum.copy(this.midpointOmega).applyMatrix3(this.inertiaTensor);
    this.cross.crossVectors(this.midpointOmega, this.angularMomentum);
    this.angularAcceleration.copy(this.torque).sub(this.cross).applyMatrix3(this.inverseInertia);
    this.cross.subVectors(this.candidateOmega, this.previousOmega).multiplyScalar(1 / dt);
    this.angularAcceleration.sub(this.cross);
    this.cross.set(0, 1, 0).cross(this.angularAcceleration);
    const threshold = LOW_ALTITUDE_RAIL.retentionAcceleration - upwardAcceleration + this.cross.dot(this.cg);
    for (const point of this.contacts) {
      if (this.mainContact(point) && this.cross.dot(point) <= threshold) return false;
    }
    return true;
  }

  private advanceStructure(dt: number, force: Vector3, torque: Vector3) {
    // Measure before fracturing can change the mass represented by this force.
    this.telemetry.gForce = force.length() / (this.mass * GRAVITY);
    this.telemetry.specificForce.copy(force).divideScalar(this.mass);
    this.maxG = Math.max(this.maxG, this.telemetry.gForce);
    // 仅接受步提交形变和拓扑；已有片先积分，刚产生的片不重复推进本步。
    const fragmentCount = this.fragments.length;
    for (let index = 0; index < fragmentCount; index++) {
      const fragment = this.fragments[index];
      this.integrateFragment(fragment, dt);
      if (!fragment.landed) this.unloadStructure(fragment, fragment.force, fragment.torque);
    }
    for (let i = 0; i < this.wingContactLoads.length; i++) {
      const load = this.wingContactLoads[i], impact = this.wingImpactLoads[i];
      load.force.multiplyScalar(1 / dt).addScaledVector(impact.force, 1 / STRUCTURAL_IMPACT_DURATION);
      load.moment.multiplyScalar(1 / dt).addScaledVector(impact.moment, 1 / STRUCTURAL_IMPACT_DURATION);
    }
    this.unloadStructure(this, force, torque, this.wingContactLoads);
    this.clearContactLoads();
    for (const fragment of this.fragments) if (!fragment.landed) this.telemetry.aeroPower += fragment.aeroPower;
    this.structure.summarize();
    this.syncContacts();
  }

  private unloadStructure(body: StructuralBody, force: Vector3, torque: Vector3, contacts?: readonly SectionContactLoad[]) {
    this.inverse.copy(body.quaternion).invert();
    this.structuralResidualForce.copy(force).applyQuaternion(this.inverse);
    this.structuralResidualMoment.copy(torque).add(this.cross.crossVectors(body.cg, this.structuralResidualForce));
    // Capture before changing geometry; descendants inherit this frozen wrench.
    for (const section of this.structure.sectionsForBody(body.id)) {
      const external = this.structuralExternal[section.id];
      external.force.copy(section.surface.force).applyQuaternion(this.inverse);
      external.moment.crossVectors(section.surface.point, external.force);
      external.moment.add(this.cross.copy(section.surface.moment).applyQuaternion(this.inverse));
      if (contacts) {
        external.force.add(contacts[section.id].force);
        external.moment.add(contacts[section.id].moment);
      }
      this.structuralResidualForce.sub(external.force);
      this.structuralResidualMoment.sub(external.moment);
    }
    if (body.id !== 0) {
      this.structuralResidualForce.set(0, 0, 0);
      this.structuralResidualMoment.set(0, 0, 0);
    }
    this.structuralBodies.length = this.structuralSeparated.length = 0;
    this.structuralBodies.push(body); this.structuralSeparated.push(false);
    for (let index = 0; index < this.structuralBodies.length; index++) {
      const current = this.structuralBodies[index];
      let separated = this.structuralSeparated[index];
      for (;;) {
        this.structuralForce.set(0, 0, 0); this.structuralMoment.set(0, 0, 0);
        if (current.id === 0) {
          this.structuralForce.copy(this.structuralResidualForce);
          this.structuralMoment.copy(this.structuralResidualMoment);
        }
        this.inverse.copy(current.quaternion).invert();
        for (const section of this.structure.sectionsForBody(current.id)) {
          const external = this.structuralExternal[section.id], correction = this.structuralCorrections[section.id];
          this.structuralForce.add(external.force); this.structuralMoment.add(external.moment);
          // Retain measureLoads' shared formula while compensating the moved
          // aerodynamic application point to the original external wrench.
          this.localVelocity.copy(section.surface.force).applyQuaternion(this.inverse);
          correction.force.copy(external.force).sub(this.localVelocity);
          correction.moment.copy(external.moment).sub(this.cross.crossVectors(section.surface.point, this.localVelocity));
          correction.moment.sub(this.cross.copy(section.surface.moment).applyQuaternion(this.inverse));
        }
        this.structuralMoment.sub(this.cross.crossVectors(current.cg, this.structuralForce));
        this.structuralForce.applyQuaternion(current.quaternion);
        this.structure.measureLoads(current, this.structuralForce, this.structuralMoment, this.structuralCorrections);
        this.structure.accumulateFractureDamage(current.id, this.fractureTick);
        for (const section of this.structure.sectionsForBody(current.id)) {
          const wing = section.wingKey === 'mainWing' ? 0 : section.wingKey === 'horizontalTail' ? 1 : 2;
          this.frameLoads[wing] = Math.max(this.frameLoads[wing], section.stressRatio);
        }
        const failing = this.structure.fractureCandidates(current.id).length > 0;
        if (!separated) {
          this.structure.updateGeometry(current.id);
          if (current.id === 0 && this.challenge !== 'wind-tunnel') this.constrainWingGeometry();
        }
        if (!failing) break;
        const fragment = this.commitFractures(current);
        if (!fragment) throw Error('结构失效连接未分离');
        separated = true;
        this.structuralBodies.push(fragment); this.structuralSeparated.push(true);
      }
    }
    this.structuralBodies.length = this.structuralSeparated.length = 0;
  }

  private recomputeMainMass() {
    updateMass(this.definition, this.parts, this.weight, this.aircraft, this.aircraft.neutralPoint, this.chord, true, this.lateral, this.structure);
  }

  private mainContact(point: ContactPoint) {
    return point.sectionId === undefined || this.structure.sections[point.sectionId].bodyId === 0;
  }

  private syncContacts(bodyId?: number) {
    if (bodyId !== undefined) {
      for (const section of this.structure.sectionsForBody(bodyId)) for (const index of this.sectionContacts[section.id]) this.syncContact(this.contacts[index]);
    } else for (const point of this.contacts) this.syncContact(point);
  }

  private syncContact(point: ContactPoint) {
    if (point.sectionId === undefined || !point.reference) return;
    const section = this.structure.sections[point.sectionId], node = point.tip ? section.tip : section.root;
    point.copy(point.reference).sub(point.tip ? section.referenceTip : section.referenceRoot).applyQuaternion(node.quaternion).add(node.position);
  }

  private blockedWingGeometry(key: WingKey, side: number) {
    for (let i = 0; i < this.platformCount; i++) {
      const index = this.platformActive[i], point = this.contacts[Math.floor(index / CONTACT_SLOTS)];
      // Terrain gaps are normal distances; the clearance tolerance is vertical.
      const tolerance = CONTACT_TOLERANCE * (index % CONTACT_SLOTS === 3 ? this.groundNormals[index].y : 1);
      if (point.sectionId === undefined || this.platformGaps[index] >= -tolerance) continue;
      const s = this.structure.sections[point.sectionId];
      if (s.bodyId === 0 && this.structure.branchContains(s, key, side)) return true;
    }
    return false;
  }

  private constrainWingGeometry() {
    this.syncContacts(0);
    // The rigid-body sweep used the previous elastic shape. Limit only a new
    // shape change that would enter a solid; do not teleport the mass or alter
    // the contact energy ledger. Stress remains unbounded for real fractures.
    for (const { key, side, indices } of this.branchContacts) {
      this.preparePlatformContacts(indices);
      if (!this.blockedWingGeometry(key, side)) continue;
      let low = 0, high = 1;
      for (let iteration = 0; iteration < 20; iteration++) {
        const fraction = (low + high) / 2;
        this.structure.blendContactGeometry(key, side, fraction);
        for (const index of indices) this.syncContact(this.contacts[index]);
        this.preparePlatformContacts(indices);
        if (this.blockedWingGeometry(key, side)) high = fraction; else low = fraction;
      }
      this.structure.blendContactGeometry(key, side, low);
      for (const index of indices) this.syncContact(this.contacts[index]);
    }
  }

  private updateSurfaceExtents() {
    for (const surface of this.surfaces) {
      let area = 0, low = Infinity, high = -Infinity;
      for (const other of this.surfaces) {
        if (other.bodyId !== surface.bodyId || other.kind !== surface.kind) continue;
        area += other.area;
        low = Math.min(low, other.side * other.spanStart, other.side * other.spanEnd);
        high = Math.max(high, other.side * other.spanStart, other.side * other.spanEnd);
      }
      surface.span = Math.max(1e-6, high - low);
      surface.aspect = Math.max(1e-6, surface.span ** 2 / area);
    }
    let area = 0, low = Infinity, high = -Infinity, quarterX = 0, tailArea = 0, tailX = 0;
    this.aircraft.mainQuarterChord.set(0, 0, 0);
    for (const surface of this.surfaces) if (surface.bodyId === 0) {
      if (surface.kind === 'main') {
        area += surface.area; quarterX += surface.point.x * surface.area;
        this.aircraft.mainQuarterChord.addScaledVector(surface.point, surface.area);
        low = Math.min(low, surface.side * surface.spanStart, surface.side * surface.spanEnd);
        high = Math.max(high, surface.side * surface.spanStart, surface.side * surface.spanEnd);
      } else if (surface.kind === 'tail') { tailArea += surface.area; tailX += surface.point.x * surface.area; }
    }
    const aircraft = this.aircraft;
    aircraft.wingArea = area; aircraft.span = area > 0 ? high - low : 0;
    aircraft.aspect = area > 0 ? aircraft.span ** 2 / area : 1;
    aircraft.wingLoading = area > 0 ? aircraft.mass / area : Infinity;
    aircraft.stallSpeed = area > 0 ? Math.sqrt(2 * aircraft.mass * GRAVITY / (AIR_DENSITY * area * 1.6)) : Infinity;
    if (area > 0) aircraft.mainQuarterChord.multiplyScalar(1 / area);
    else aircraft.mainQuarterChord.copy(aircraft.cg);
    const mainX = area > 0 ? quarterX / area : this.cg.x;
    const effectiveness = area > 0 ? 0.65 * tailArea / area : 0;
    aircraft.neutralPoint = this.structure.fractureCount === 0 ? this.neutral
      : (mainX + (tailArea > 0 ? effectiveness * tailX / tailArea : 0)) / (1 + effectiveness);
    aircraft.staticMargin = (aircraft.cg.x - aircraft.neutralPoint) / this.chord;
    for (const wing of this.aerodynamics.wings) {
      wing.area = 0; wing.aspect = 0;
      for (const surface of this.surfaces) if (surface.bodyId === 0 && surface.kind === wing.kind) {
        wing.area += surface.area; wing.aspect = surface.aspect;
      }
    }
  }

  private fragmentMass(fragment: WingFragment) {
    let mass = 0;
    fragment.cg.set(0, 0, 0);
    for (const section of this.structure.sectionsForBody(fragment.id)) {
      mass += section.mass; fragment.cg.addScaledVector(section.center, section.mass);
    }
    fragment.mass = mass;
    fragment.cg.multiplyScalar(1 / mass);
    let ix = 0, iy = 0, iz = 0, ixy = 0, ixz = 0, iyz = 0;
    for (const section of this.structure.sectionsForBody(fragment.id)) {
      const x = section.center.x - fragment.cg.x, y = section.center.y - fragment.cg.y, z = section.center.z - fragment.cg.z;
      const e = section.inertia.elements, m = section.mass;
      ix += e[0] + m * (y * y + z * z); iy += e[4] + m * (x * x + z * z); iz += e[8] + m * (x * x + y * y);
      ixy += e[3] - m * x * y; ixz += e[6] - m * x * z; iyz += e[7] - m * y * z;
    }
    setInertia(fragment.inertiaTensor, ix, iy, iz, ixy, ixz, iyz);
    fragment.inverseInertia.copy(fragment.inertiaTensor).invert();
  }

  private commitFractures(body: StructuralBody): WingFragment | undefined {
      const boundary = this.structure.fractureCandidates(body.id)[0];
      if (!boundary) return;
      const oldCg = body.cg.clone();
      const fragment: WingFragment = {
        id: this.nextFragmentId++, position: body.position.clone(), quaternion: body.quaternion.clone(),
        velocity: body.velocity.clone(), omega: body.omega.clone(), cg: new Vector3(), mass: 0,
        inertiaTensor: new Matrix3(), inverseInertia: new Matrix3(), landed: false,
        force: new Vector3(), torque: new Vector3(), drag: new Vector3(), aeroPower: 0,
        midpointVelocity: new Vector3(), midpointOmega: new Vector3(), midpointPosition: new Vector3(), midpointQuaternion: new Quaternion(),
        candidateVelocity: new Vector3(), candidateOmega: new Vector3(),
      };
      this.structure.detach(boundary, fragment.id);
      this.fragmentMass(fragment);
      // 无额外分离冲量/假能量损失：两部分继承同一速度场，完整张量平行轴分解守恒动量和动能。
      this.arm.copy(fragment.cg).sub(oldCg);
      this.cross.crossVectors(body.omega, this.arm).applyQuaternion(body.quaternion);
      fragment.velocity.add(this.cross);
      this.arm.applyQuaternion(body.quaternion); fragment.position.add(this.arm);
      this.fragments.push(fragment);
      if (body.id === 0) this.recomputeMainMass();
      else this.fragmentMass(body as WingFragment);
      this.arm.copy(body.cg).sub(oldCg);
      this.cross.crossVectors(body.omega, this.arm).applyQuaternion(body.quaternion);
      body.velocity.add(this.cross);
      this.arm.applyQuaternion(body.quaternion); body.position.add(this.arm);
      this.updateSurfaceExtents();
      return fragment;
  }

  private evaluateFragment(fragment: WingFragment, velocity: Vector3, omega: Vector3, orientation: Quaternion, position: Vector3) {
    // 独立连续翼段使用同一条带极曲线/局部转动来流；不模拟不同刚体之间的非定常尾流干扰。
    this.inverse.copy(orientation).invert();
    this.bodyVelocity.copy(velocity);
    if (this.challenge === 'wind-tunnel') this.bodyVelocity.add(this.laboratoryState.windVelocity);
    this.bodyVelocity.applyQuaternion(this.inverse);
    fragment.force.set(0, 0, 0); fragment.drag.set(0, 0, 0); fragment.torque.set(0, 0, 0); fragment.aeroPower = 0;
    for (const section of this.structure.sectionsForBody(fragment.id)) {
      const surface = section.surface as AerodynamicSurface;
      surface.airFraction = 1; // Fragments retain their existing stop-on-water rule.
      this.arm.copy(surface.point).sub(fragment.cg);
      this.cross.copy(this.arm).applyQuaternion(orientation).add(position);
      surface.clearance = this.seaLevelReference ? Infinity : this.cross.y - challengeCollisionHeight(this.challenge, this.cross.x, this.cross.z);
      surface.groundEffect = 1;
      if (surface.kind !== 'vertical') {
        this.cross.copy(surface.spanDirection).applyQuaternion(orientation);
        surface.groundEffect = groundEffectFactor(surface.clearance, surface.span * Math.hypot(this.cross.x, this.cross.z));
      }
    }
    this.wakeGroundNormal.set(0, 1, 0).applyQuaternion(this.inverse);
    evaluateCoupledSurfaces(this.surfaces, fragment.id, this.bodyVelocity, omega, fragment.cg,
      this.polar, this.liftDirection, this.wakeGroundNormal);
    for (const section of this.structure.sectionsForBody(fragment.id)) {
      const surface = section.surface as AerodynamicSurface;
      this.arm.copy(surface.point).sub(fragment.cg);
      this.localVelocity.copy(surface.localFlow);
      fragment.aeroPower += surface.force.dot(this.localVelocity) + surface.moment.dot(omega);
      fragment.torque.add(this.cross.crossVectors(this.arm, surface.force)).add(surface.moment);
      surface.force.applyQuaternion(orientation); surface.drag.applyQuaternion(orientation); surface.moment.applyQuaternion(orientation);
      fragment.force.add(surface.force); fragment.drag.add(surface.drag);
    }
  }

  private fragmentCollision(fragment: WingFragment, position: Vector3, orientation: Quaternion) {
    if (this.challenge === 'wind-tunnel') {
      const room = windTunnelRoom(this.definition);
      return Math.abs(position.x) >= room.halfX || Math.abs(position.z) >= room.halfZ || Math.abs(position.y - room.centerY) >= room.halfY;
    }
    for (const section of this.structure.sectionsForBody(fragment.id)) for (const index of this.sectionContacts[section.id]) {
      const point = this.contacts[index];
      this.platformStart.copy(point).sub(fragment.cg).applyQuaternion(fragment.quaternion).add(fragment.position);
      this.platformEnd.copy(point).sub(fragment.cg).applyQuaternion(orientation).add(position);
      const a = this.platformStart, b = this.platformEnd;
      if (hitsChallengeRuin(this.challenge,a,b) || b.y <= challengeCollisionHeight(this.challenge, b.x, b.z) || this.sweepsLaunchBox(a, b) || this.sweepsRiver(a, b)) return true;
      const step = this.challenge === 'test-space' ? TEST_SPACE.step : challengeTerrainGrid.step;
      for (let axis = 0; axis < 3; axis++) {
        const start = axis === 0 ? a.x : axis === 1 ? a.z : a.x + a.z;
        const end = axis === 0 ? b.x : axis === 1 ? b.z : b.x + b.z, delta = end - start;
        if (Math.abs(delta) < 1e-12) continue;
        for (let line = Math.floor(Math.min(start, end) / step) + 1; line <= Math.floor(Math.max(start, end) / step); line++) {
          const fraction = (line * step - start) / delta;
          const x = a.x + (b.x - a.x) * fraction, z = a.z + (b.z - a.z) * fraction;
          if (a.y + (b.y - a.y) * fraction <= challengeCollisionHeight(this.challenge, x, z)) return true;
        }
      }
      if (this.challenge === 'birdman') {
        for (let endpoint = 0; endpoint < 2; endpoint++) {
          const p = endpoint === 0 ? a : b;
          const x = p.x - LAUNCH.endX, y = p.y - LAUNCH.height;
          p.set(PLATFORM_COS * x - PLATFORM_SIN * y, PLATFORM_SIN * x + PLATFORM_COS * y, p.z);
        }
        for (const [low, high] of PLATFORM_BOXES) {
          let entry = 0, exit = 1;
          for (let axis = 0; axis < 3; axis++) {
            const start = a.getComponent(axis), delta = b.getComponent(axis) - start;
            if (Math.abs(delta) < 1e-15) {
              if (start < low.getComponent(axis) || start > high.getComponent(axis)) { entry = Infinity; break; }
            } else {
              const first = (low.getComponent(axis) - start) / delta, last = (high.getComponent(axis) - start) / delta;
              entry = Math.max(entry, Math.min(first, last)); exit = Math.min(exit, Math.max(first, last));
            }
          }
          if (entry <= exit && exit >= 0 && entry <= 1) return true;
        }
      }
    }
    return false;
  }

  private stopFragment(fragment: WingFragment) {
    // 完全非弹性落地：只移除明确的平动/转动动能，保留实际接触位置和势能。
    this.telemetry.dissipatedEnergy += fragment.mass * fragment.velocity.lengthSq() / 2 + rotationalEnergy(fragment.inertiaTensor, fragment.omega);
    fragment.velocity.set(0, 0, 0); fragment.omega.set(0, 0, 0); fragment.landed = true;
    fragment.force.set(0, 0, 0); fragment.drag.set(0, 0, 0); fragment.torque.set(0, 0, 0);
    for (const surface of this.surfaces) if (surface.bodyId === fragment.id) { surface.force.set(0, 0, 0); surface.drag.set(0, 0, 0); surface.moment.set(0, 0, 0); }
  }

  private integrateFragment(fragment: WingFragment, dt: number) {
    if (fragment.landed) return;
    if (this.fragmentCollision(fragment, fragment.position, fragment.quaternion)) { this.stopFragment(fragment); return; }
    fragment.midpointVelocity.copy(fragment.velocity); fragment.midpointOmega.copy(fragment.omega);
    let converged = false;
    let previousResidual = Infinity, relaxation = 1;
    for (let iteration = 0; iteration < 80; iteration++) {
      fragment.midpointQuaternion.copy(fragment.quaternion);
      const angle = fragment.midpointOmega.length() * dt / 2;
      if (angle > 0) {
        this.rotation.setFromAxisAngle(this.cross.copy(fragment.midpointOmega).normalize(), angle);
        fragment.midpointQuaternion.multiply(this.rotation).normalize();
      }
      fragment.midpointPosition.copy(fragment.position).addScaledVector(fragment.midpointVelocity, dt / 2);
      this.evaluateFragment(fragment, fragment.midpointVelocity, fragment.midpointOmega, fragment.midpointQuaternion, fragment.midpointPosition);
      fragment.candidateVelocity.copy(fragment.velocity).addScaledVector(fragment.force, dt / (2 * fragment.mass));
      fragment.candidateVelocity.y -= GRAVITY * dt / 2;
      this.angularMomentum.copy(fragment.midpointOmega).applyMatrix3(fragment.inertiaTensor);
      this.cross.crossVectors(fragment.midpointOmega, this.angularMomentum);
      this.angularAcceleration.copy(fragment.torque).sub(this.cross).applyMatrix3(fragment.inverseInertia);
      fragment.candidateOmega.copy(fragment.omega).addScaledVector(this.angularAcceleration, dt / 2);
      const residual = fragment.candidateVelocity.distanceToSquared(fragment.midpointVelocity) + fragment.candidateOmega.distanceToSquared(fragment.midpointOmega);
      if (!Number.isFinite(residual)) break;
      // Small independent strips can have stiff rotational aero response. Damp
      // an oscillating fixed-point iteration, retaining the same midpoint
      // equations and work accounting. A relative 1e-12 velocity tolerance
      // avoids recursively subdividing at floating-point noise near equilibrium.
      if (residual <= 1e-24 * (1 + fragment.midpointVelocity.lengthSq() + fragment.midpointOmega.lengthSq())) { converged = true; break; }
      if (residual > previousResidual * 0.9) relaxation = 0.5;
      previousResidual = residual;
      fragment.midpointVelocity.lerp(fragment.candidateVelocity, relaxation); fragment.midpointOmega.lerp(fragment.candidateOmega, relaxation);
    }
    const angle = fragment.midpointOmega.length() * dt;
    if (!converged || angle > 0.1) {
      if (dt < 1e-9) throw new Error('断片气动力中点求解未收敛');
      this.integrateFragment(fragment, dt / 2); this.integrateFragment(fragment, dt / 2); return;
    }
    fragment.midpointPosition.copy(fragment.position).addScaledVector(fragment.midpointVelocity, dt);
    fragment.midpointQuaternion.copy(fragment.quaternion);
    if (angle > 0) {
      this.rotation.setFromAxisAngle(this.cross.copy(fragment.midpointOmega).normalize(), angle);
      fragment.midpointQuaternion.multiply(this.rotation).normalize();
    }
    const collision = this.fragmentCollision(fragment, fragment.midpointPosition, fragment.midpointQuaternion);
    if (collision && dt > 1e-7) {
      this.integrateFragment(fragment, dt / 2); this.integrateFragment(fragment, dt / 2); return;
    }
    fragment.candidateVelocity.copy(fragment.velocity); fragment.candidateOmega.copy(fragment.omega);
    fragment.velocity.copy(fragment.midpointVelocity).multiplyScalar(2).sub(fragment.candidateVelocity);
    fragment.omega.copy(fragment.midpointOmega).multiplyScalar(2).sub(fragment.candidateOmega);
    fragment.position.copy(fragment.midpointPosition); fragment.quaternion.copy(fragment.midpointQuaternion);
    this.telemetry.dissipatedEnergy -= fragment.aeroPower * dt;
    // Commit geometry/topology only after this old fragment's full time step.
    this.syncContacts(fragment.id);
    if (collision) this.stopFragment(fragment);
  }

  /** 世界坐标转为坡面坐标；两侧板和槽底共用同一有限盒接触路径。 */
  private platformPoint(point: Vector3, position: Vector3, orientation: Quaternion, out: Vector3) {
    out.copy(point).sub(this.aircraft.cg).applyQuaternion(orientation).add(position);
    if (this.challenge !== 'birdman') { const launch = this.launch!; out.sub(this.contactNormal.set(launch.endX, launch.y, launch.z)); return; }
    const x = out.x - LAUNCH.endX, y = out.y - LAUNCH.height;
    out.set(PLATFORM_COS * x - PLATFORM_SIN * y, PLATFORM_SIN * x + PLATFORM_COS * y, out.z);
  }

  private preparePlatformContacts(pointIndices?: readonly number[]) {
    this.platformCount = 0;
    this.platformFaces.fill(-1);
    for (let cursor = (pointIndices || this.challenge === 'birdman') ? 0 : 2; cursor < (pointIndices?.length ?? this.contacts.length); cursor++) {
      const point = pointIndices ? pointIndices[cursor] : cursor;
      if (!this.mainContact(this.contacts[point])) continue;
      this.platformPoint(this.contacts[point], this.position, this.quaternion, this.platformStart);
      const p = this.platformStart;
      for (let box = 0; box < this.contactBoxes.length; box++) {
        const index = point * CONTACT_SLOTS + box;
        const [low, high] = this.contactBoxes[box];
        if (p.x < low.x - CONTACT_TOLERANCE || p.x > high.x + CONTACT_TOLERANCE
          || p.y < low.y - CONTACT_TOLERANCE || p.y > high.y + CONTACT_TOLERANCE
          || p.z < low.z - CONTACT_TOLERANCE || p.z > high.z + CONTACT_TOLERANCE) continue;
        let face = 0, gap = low.x - p.x;
        for (let axis = 0; axis < 3; axis++) {
          const value = p.getComponent(axis);
          if (low.getComponent(axis) - value > gap) { gap = low.getComponent(axis) - value; face = axis * 2; }
          if (value - high.getComponent(axis) > gap) { gap = value - high.getComponent(axis); face = axis * 2 + 1; }
        }
        this.groundNormals[index].copy(this.contactNormals[face]);
        this.platformFaces[index] = box * 6 + face;
        this.platformGaps[index] = gap;
        this.platformActive[this.platformCount++] = index;
      }
      if (this.challenge === 'birdman') continue;
      p.copy(this.contacts[point]).sub(this.aircraft.cg).applyQuaternion(this.quaternion).add(this.position);
      const height = challengeTerrainHeight(this.challenge, p.x, p.z);
      if (!this.onRunway(p.x, p.z) && p.y <= height + CONTACT_TOLERANCE) {
        const index = point * CONTACT_SLOTS + 3, h = 1e-4;
        const normal = this.groundNormals[index].set(
          -(challengeTerrainHeight(this.challenge, p.x+h, p.z)-challengeTerrainHeight(this.challenge, p.x-h, p.z))/(2*h), 1,
          -(challengeTerrainHeight(this.challenge, p.x, p.z+h)-challengeTerrainHeight(this.challenge, p.x, p.z-h))/(2*h)).normalize();
        this.platformGaps[index] = (p.y-height)*normal.y;
        this.platformFaces[index] = 0;
        this.platformActive[this.platformCount++] = index;
      }
      if (this.challenge !== 'downhill') continue;
      for (const ruin of downhillRuins) {
        if (Math.abs(p.x-ruin.x)>ruin.radiusX+CONTACT_TOLERANCE) continue;
        const cy=Math.cos(ruin.yaw),sy=Math.sin(ruin.yaw),ct=Math.cos(ruin.tilt),st=Math.sin(ruin.tilt);
        const x=p.x-ruin.x,y=p.y-ruin.y,z=p.z-ruin.z,r=sy*x+cy*z;
        const local=[cy*x-sy*z,ct*y+st*r,-st*y+ct*r], half=[ruin.width/2,ruin.height/2,ruin.length/2];
        if(local.some((v,i)=>Math.abs(v)>half[i]+CONTACT_TOLERANCE)) continue;
        let axis=0;for(let i=1;i<3;i++)if(Math.abs(local[i])-half[i]>Math.abs(local[axis])-half[axis])axis=i;
        const sign=local[axis]<0?-1:1,index=point*CONTACT_SLOTS+4;
        const n=this.groundNormals[index];
        if(axis===0)n.set(cy,0,-sy);else if(axis===1)n.set(st*sy,ct,st*cy);else n.set(ct*sy,-st,ct*cy);
        n.multiplyScalar(sign);this.platformGaps[index]=Math.abs(local[axis])-half[axis];this.platformFaces[index]=0;
        this.platformActive[this.platformCount++]=index;break;
      }
    }
  }

  private clearContactLoads() {
    for (const load of this.wingContactLoads) { load.force.set(0, 0, 0); load.moment.set(0, 0, 0); }
    for (const load of this.wingImpactLoads) { load.force.set(0, 0, 0); load.moment.set(0, 0, 0); }
    this.initialImpactImpulse.set(0, 0, 0); this.initialImpactTorque.set(0, 0, 0);
    this.finalImpactImpulse.set(0, 0, 0); this.finalImpactTorque.set(0, 0, 0);
  }

  private addWingContactImpulse(index: number, localNormal: Vector3, impulse: number, impact = false) {
    const point = this.contacts[Math.floor(index / CONTACT_SLOTS)];
    if (point.sectionId === undefined || impulse === 0) return;
    const load = (impact ? this.wingImpactLoads : this.wingContactLoads)[point.sectionId];
    load.force.addScaledVector(localNormal, impulse);
    // Store the moment before geometry changes, rather than moving the force to
    // the strip centre or the CG. Rejected midpoint trials never reach this path.
    load.moment.addScaledVector(this.localDrag.crossVectors(point, localNormal), impulse);
  }

  /** Project the tangential impulse onto the Coulomb disk. Returns exact impact work. */
  private solveContactFriction(index: number, velocity: Vector3, omega: Vector3, orientation: Quaternion, limit: number, sinc = 1) {
    const normal = this.groundNormals[index], accumulated = this.platformFriction[index];
    this.inverse.copy(orientation).invert();
    this.arm.copy(this.contacts[Math.floor(index / CONTACT_SLOTS)]).sub(this.aircraft.cg);
    this.frictionDirection.crossVectors(omega, this.arm).applyQuaternion(orientation).multiplyScalar(sinc).add(velocity);
    this.frictionDirection.addScaledVector(normal, -this.frictionDirection.dot(normal));
    const speed = this.frictionDirection.length();
    this.frictionDelta.copy(accumulated);
    if (speed > 1e-12) {
      this.frictionDirection.multiplyScalar(1 / speed);
      this.contactNormal.copy(this.frictionDirection).applyQuaternion(this.inverse);
      this.frictionAxis.crossVectors(this.arm, this.contactNormal).multiplyScalar(sinc);
      this.angularAcceleration.copy(this.frictionAxis).applyMatrix3(this.inverseInertia);
      const inverseMass = 1 / this.mass + this.frictionAxis.dot(this.angularAcceleration);
      accumulated.addScaledVector(this.frictionDirection, -speed / inverseMass);
    }
    accumulated.clampLength(0, limit);
    this.frictionDelta.subVectors(accumulated, this.frictionDelta);
    this.contactNormal.copy(this.frictionDelta).applyQuaternion(this.inverse);
    this.frictionAxis.crossVectors(this.arm, this.contactNormal).multiplyScalar(sinc);
    this.angularAcceleration.copy(this.frictionAxis).applyMatrix3(this.inverseInertia);
    const work = this.frictionDelta.dot(velocity) + this.frictionAxis.dot(omega)
      + (this.frictionDelta.lengthSq() / this.mass + this.frictionAxis.dot(this.angularAcceleration)) / 2;
    velocity.addScaledVector(this.frictionDelta, 1 / this.mass); omega.add(this.angularAcceleration);
    return work;
  }

  /** Inelastic normal impact and bounded dry friction; each impulse records its actual work. */
  private resolvePlatformImpact(initial = false) {
    const mass = this.aircraft.mass;
    this.inverse.copy(this.quaternion).invert();
    for (let i = 0; i < this.platformCount; i++) {
      const index = this.platformActive[i]; this.platformImpulses[index] = 0; this.platformFriction[index].set(0, 0, 0);
    }
    for (let iteration = 0; iteration < 32; iteration++) {
      let closing = false;
      for (let i = 0; i < this.platformCount; i++) {
        const index = this.platformActive[i], normal = this.groundNormals[index];
        this.arm.copy(this.contacts[Math.floor(index / CONTACT_SLOTS)]).sub(this.aircraft.cg);
        this.contactNormal.copy(normal).applyQuaternion(this.inverse);
        this.cross.crossVectors(this.arm, this.contactNormal);
        const speed = this.velocity.dot(normal) + this.cross.dot(this.omega);
        if (speed >= -1e-10) continue;
        this.angularAcceleration.copy(this.cross).applyMatrix3(this.inverseInertia);
        const inverseMass = 1 / mass + this.cross.dot(this.angularAcceleration);
        const impulse = -speed / inverseMass;
        this.velocity.addScaledVector(normal, impulse / mass);
        this.omega.addScaledVector(this.angularAcceleration, impulse);
        this.addWingContactImpulse(index, this.contactNormal, impulse, true);
        if (initial) {
          this.initialImpactImpulse.addScaledVector(normal, impulse);
          this.initialImpactTorque.addScaledVector(this.cross, impulse);
        } else {
          this.finalImpactImpulse.addScaledVector(normal, impulse);
          this.finalImpactTorque.addScaledVector(this.cross, impulse);
        }
        this.telemetry.dissipatedEnergy += -(impulse * speed + 0.5 * impulse ** 2 * inverseMass);
        this.platformImpulses[index] += impulse;
        this.telemetry.dissipatedEnergy -= this.solveContactFriction(index, this.velocity, this.omega, this.quaternion, GROUND_FRICTION * this.platformImpulses[index]);
        this.addWingContactImpulse(index, this.contactNormal, 1, true);
        const impactForce = initial ? this.initialImpactImpulse : this.finalImpactImpulse;
        const impactTorque = initial ? this.initialImpactTorque : this.finalImpactTorque;
        impactForce.add(this.frictionDelta); impactTorque.add(this.frictionAxis);
        closing = true;
      }
      if (!closing) break;
    }
    // Impacts have already been committed. Midpoint/rail work must not count
    // their temporary impulse budgets a second time.
    for (let i = 0; i < this.platformCount; i++) {
      const index = this.platformActive[i]; this.platformImpulses[index] = 0; this.platformFriction[index].set(0, 0, 0);
    }
  }

  /** 离散接触雅可比与四元数位移一致，约束功等于真实机械能变化。 */
  private constrainPlatformMidpoint(dt: number) {
    if (!this.platformCount) return;
    const mass = this.aircraft.mass;
    const halfAngle = this.midpointOmega.length() * dt / 2;
    const sinc = halfAngle > 1e-8 ? Math.sin(halfAngle) / halfAngle : 1 - halfAngle ** 2 / 6;
    this.inverse.copy(this.midpointQuaternion).invert();
    for (let i = 0; i < this.platformCount; i++) {
      const index = this.platformActive[i];
      this.arm.copy(this.contacts[Math.floor(index / CONTACT_SLOTS)]).sub(this.aircraft.cg);
      this.contactNormal.copy(this.groundNormals[index]).applyQuaternion(this.inverse);
      this.platformAxes[index].crossVectors(this.arm, this.contactNormal).multiplyScalar(sinc);
      this.platformImpulses[index] = 0;
      this.platformFriction[index].set(0, 0, 0);
    }
    for (let iteration = 0; iteration < 128; iteration++) {
      let change = 0;
      for (let i = 0; i < this.platformCount; i++) {
        const index = this.platformActive[i], axis = this.platformAxes[index], normal = this.groundNormals[index];
        const speed = normal.dot(this.candidateVelocity) + axis.dot(this.candidateOmega);
        this.angularAcceleration.copy(axis).applyMatrix3(this.inverseInertia);
        const inverseMass = 1 / mass + axis.dot(this.angularAcceleration);
        const previous = this.platformImpulses[index];
        const impulse = Math.max(0, previous + (-Math.max(0, this.platformGaps[index]) / dt - speed) / inverseMass);
        const delta = impulse - previous;
        this.platformImpulses[index] = impulse;
        this.candidateVelocity.addScaledVector(normal, delta / mass);
        this.candidateOmega.addScaledVector(this.angularAcceleration, delta);
        change = Math.max(change, Math.abs(delta));
        this.solveContactFriction(index, this.candidateVelocity, this.candidateOmega, this.midpointQuaternion, GROUND_FRICTION * impulse, sinc);
        change = Math.max(change, this.frictionDelta.length());
      }
      if (change < 1e-12) break;
    }
  }

  /** 逐采样点做线段/长方体扫掠，能检测一帧内完全穿过薄板的情况。 */
  private sweepsPlatform() {
    for (let index = this.challenge === 'birdman' ? 0 : 2; index < this.contacts.length; index++) {
      if (!this.mainContact(this.contacts[index])) continue;
      this.platformPoint(this.contacts[index], this.position, this.quaternion, this.platformStart);
      this.platformPoint(this.contacts[index], this.candidatePosition, this.candidateQuaternion, this.platformEnd);
      for (let box = 0; box < this.contactBoxes.length; box++) {
        const [low, high] = this.contactBoxes[box];
        const contact = index * CONTACT_SLOTS + box;
        if (this.platformFaces[contact] >= 0) {
          // A previously active contact can still move inward after the coupled
          // solve. Subdivide that motion instead of silently retaining penetration.
          const gap = Math.max(low.x - this.platformEnd.x, this.platformEnd.x - high.x,
            low.y - this.platformEnd.y, this.platformEnd.y - high.y,
            low.z - this.platformEnd.z, this.platformEnd.z - high.z);
          if (gap < Math.min(this.platformGaps[contact], -CONTACT_TOLERANCE) - 1e-12) return true;
          continue;
        }
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
    const checkpoints = challengeCheckpoints(this.challenge);
    let startFraction = this.raceStarted ? 0 : 1;
    while (!this.completed) {
      const gate = this.raceStarted ? checkpoints[this.checkpointIndex] : challengeStartGate(this.challenge);
      if (!gate || this.previousPosition.x > gate.x || this.position.x < gate.x || this.position.x <= this.previousPosition.x) break;
      const fraction = (gate.x - this.previousPosition.x) / (this.position.x - this.previousPosition.x);
      const z = this.previousPosition.z + (this.position.z - this.previousPosition.z) * fraction;
      const y = this.previousPosition.y + (this.position.y - this.previousPosition.y) * fraction;
      if (challengeGateBlocked(this.challenge, gate, y, z)) break;
      if (!this.raceStarted) {
        this.raceStarted = true;
        this.travelled = 0;
        startFraction = fraction;
        timed = dt * (1 - fraction);
        continue;
      }
      if (this.challenge === 'low-altitude') {
        const clearance = y - challengeCollisionHeight(this.challenge, gate.x, z);
        const low = LOW_ALTITUDE.scoreScale * clamp(1 - clearance / LOW_ALTITUDE.scoringHeight, 0, 1);
        const bonus = LOW_ALTITUDE.scoreScale * 0.5 * clamp(1 - clearance / LOW_ALTITUDE.bonusHeight, 0, 1);
        this.checkpointScores.push(low + bonus);
      }
      this.checkpointIndex++;
      this.completed = this.checkpointIndex === checkpoints.length;
      if (this.completed) return dt * (fraction - startFraction);
    }
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
  }

  private outsideChallenge() {
    if (this.challenge === 'test-space') return Math.abs(this.position.x) >= TEST_SPACE.halfSize || Math.abs(this.position.z) >= TEST_SPACE.halfSize || this.position.y < 0 || this.position.y >= TEST_SPACE.ceiling;
    if (this.challenge === 'wind-tunnel') return false;
    if (this.challenge === 'birdman') return Math.abs(this.position.x) >= 2000 || Math.abs(this.position.z) >= 800 || this.position.y >= 300;
    const { x, y, z } = this.position;
    const next = this.raceStarted ? challengeCheckpoints(this.challenge)[this.checkpointIndex] : challengeStartGate(this.challenge);
    // 两种航线均须顺序过门；低空超高扣分而非直接淘汰。
    const downhill = this.challenge === 'downhill';
    const ceiling = challengeCollisionHeight(this.challenge, x, z) + 1000;
    const rounding = 8 * Number.EPSILON * Math.max(1, Math.abs(y), Math.abs(ceiling));
    return x < challengeLaunch(this.challenge)!.startX - 50 || x > challengeDefinitions[this.challenge].length + 100
      || (!downhill && Math.abs(z - challengeCenter(this.challenge, x)) > 100)
      || (!downhill && y - ceiling > rounding)
      || (next != null && (x > next.x || (downhill && x === next.x && challengeGateBlocked(this.challenge, next, y, z))));
  }

  private onRunway(x: number, z: number) {
    if (this.challenge === 'test-space') return x >= this.laboratoryState.launchConfig!.startX && x <= this.laboratoryState.launchConfig!.endX && Math.abs(z) <= this.laboratoryState.launchConfig!.width / 2;
    return this.challenge === 'low-altitude' && x >= LOW_RUNWAY.startX && x <= LOW_RUNWAY.endX
      && Math.abs(z - LOW_RUNWAY.z) <= LOW_RUNWAY.width / 2;
  }
  /** 分片平面上，端点与X、Z、X+Z网格线交点包含线段净空的所有极小值。 */
  private sweepsTerrain() {
    const step = this.challenge === 'test-space' ? TEST_SPACE.step : challengeTerrainGrid.step;
    for (let pointIndex=2;pointIndex<this.contacts.length;pointIndex++) {
      const point=this.contacts[pointIndex];
      if (!this.mainContact(point)) continue;
      if (this.platformFaces[pointIndex*CONTACT_SLOTS+3]>=0 || this.platformFaces[pointIndex*CONTACT_SLOTS+4]>=0) continue;
      this.platformStart.copy(point).sub(this.aircraft.cg).applyQuaternion(this.quaternion).add(this.position);
      this.platformEnd.copy(point).sub(this.aircraft.cg).applyQuaternion(this.candidateQuaternion).add(this.candidatePosition);
      const a = this.platformStart, b = this.platformEnd;
      if (hitsChallengeRuin(this.challenge, a, b)) return true;
      // 河面是流体，不进入硬地递归；仍扫掠原三角河床、岸坡与有限起飞台。

      if (!this.onRunway(b.x, b.z) && b.y <= challengeTerrainHeight(this.challenge, b.x, b.z)) return true;
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
          if (!this.onRunway(x, z) && y <= challengeTerrainHeight(this.challenge, x, z)) return true;
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
    const launch = this.launch;
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
    this.waterContactAt(this.position, this.quaternion, true);
    t.distance = this.challenge === 'test-space' ? this.travelled : this.challenge === 'birdman' ? (this.launching ? 0 : this.tailDistance()) : this.raceStarted ? this.travelled : 0;
    t.groundClearance = this.position.y - challengeCollisionHeight(this.challenge, this.position.x, this.position.z);
    t.challengeProgress = !isLaboratory(this.challenge) && this.challenge !== 'birdman' ? this.checkpointIndex / challengeCheckpoints(this.challenge).length : 0;
    t.completed = this.completed;
    t.timingStarted = isLaboratory(this.challenge) || this.challenge === 'birdman' || this.raceStarted;
    t.score = this.challenge === 'birdman' ? t.distance : this.challenge === 'low-altitude'
      ? (this.checkpointScores.reduce((sum, score) => sum + score, 0) + (this.completed && this.time > 0 ? LOW_ALTITUDE.scoreScale * (challengeDefinitions['low-altitude'].length - challengeStartGate(this.challenge)!.x) / this.time : 0)) - this.heightPenalty : this.completed ? this.time : 0;
    t.throttle = this.definition.engine.count > 0 ? this.effective.throttle ?? 0 : 0;
    t.engineRpm = this.engineRpm; t.fuelRemaining = this.fuelRemaining; t.thrust = this.thrust;
    t.autoTrim = this.autoTrim; t.adaptiveControls = this.effective.adaptiveControls === true;
    t.smartMixing = this.effective.smartMixing === true;
    t.trimPitch = this.definition.birdman ? this.effective.trimPitch ?? 0 : this.trimPitch; t.trimRoll = this.effective.trimRoll ?? 0;
    t.controlLimit = t.adaptiveControls ? this.controlLimit : 1;
    t.controlInputs.weight = this.weight; t.controlInputs.lateral = this.lateral;
    t.controlInputs.elevator = this.applied.elevator; t.controlInputs.aileron = this.applied.aileron; t.controlInputs.rudder = this.applied.rudder;
    t.aboveHeightTime = this.aboveHeightTime;
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    t.energyPerDistance = !this.launching && horizontalSpeed > 0.05 ? -t.aeroPower / horizontalSpeed : null;
    this.inverse.copy(this.quaternion).invert();
    this.bodyVelocity.copy(this.velocity);
    if (this.challenge === 'wind-tunnel') this.bodyVelocity.add(this.laboratoryState.windVelocity);
    this.bodyVelocity.applyQuaternion(this.inverse);
    t.alpha = Math.atan2(-this.bodyVelocity.y, this.bodyVelocity.x) + this.definition.assembly.mainIncidence * DEG;
    this.cross.set(1, 0, 0).applyQuaternion(this.quaternion);
    t.pitch = Math.atan2(this.cross.y, Math.hypot(this.cross.x, this.cross.z));
    const q = this.quaternion;
    t.roll = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x ** 2 + q.y ** 2));
    t.sink = -this.velocity.y;
    t.glide = t.sink > 0.05 ? horizontalSpeed / t.sink : 0;
    t.stall = !this.launching && (t.alpha > 12 * DEG || t.alpha < -6 * DEG);
    t.mass = this.aircraft.mass; t.staticMargin = this.aircraft.staticMargin;
    t.potentialEnergy = this.aircraft.mass * GRAVITY * this.position.y;
    t.kineticEnergy = 0.5 * this.aircraft.mass * this.velocity.lengthSq() + rotationalEnergy(this.inertiaTensor, this.omega);
    for (const fragment of this.fragments) {
      t.potentialEnergy += fragment.mass * GRAVITY * fragment.position.y;
      t.kineticEnergy += fragment.mass * fragment.velocity.lengthSq() / 2 + rotationalEnergy(fragment.inertiaTensor, fragment.omega);
    }
    t.energy = t.potentialEnergy + t.kineticEnergy;
    if (this.challenge === 'wind-tunnel') { t.speed = this.laboratoryState.windTunnel.speed; t.groundClearance = this.position.y - 2; }
  }

  /** 椭球世界最低点：安装位置与scene共用，不以CG或旧机头碰撞代理决定入水。 */
  private lowestBodyPoint(shape: BodyEllipsoid, centerX: number, position: Vector3, orientation: Quaternion, out: Vector3, normal?: Vector3) {
    this.inverse.copy(orientation).invert();
    if (normal) this.waterAxis.copy(normal); else this.waterAxis.set(0, 1, 0);
    this.waterAxis.applyQuaternion(this.inverse);
    const x = shape.xRadius ** 2 * this.waterAxis.x;
    const y = shape === BODY_GEOMETRY.canopy && this.waterAxis.y > 0 ? 0 : shape.yRadius ** 2 * this.waterAxis.y;
    const z = shape.zRadius ** 2 * this.waterAxis.z;
    const radius = Math.sqrt(x * this.waterAxis.x + y * this.waterAxis.y + z * this.waterAxis.z);
    out.set(centerX - (radius > 0 ? x / radius : 0), shape.y - (radius > 0 ? y / radius : 0), radius > 0 ? -z / radius : 0)
      .sub(this.aircraft.cg).applyQuaternion(orientation).add(position);
  }

  private noseAt(position: Vector3, orientation: Quaternion, out: Vector3) {
    const shape = BODY_GEOMETRY.nose;
    this.lowestBodyPoint(shape, this.definition.fuselage.center + this.definition.fuselage.length / 2 + shape.x, position, orientation, out);
  }

  private waterContactAt(position: Vector3, orientation: Quaternion, publish = false) {
    let deepest = -Infinity;
    if (publish) { this.telemetry.waterContact = false; this.telemetry.waterContactPoint.set(0, 0, 0); }
    for (let index = -3; index < this.contacts.length; index++) {
      if (index === -3) this.noseAt(position, orientation, this.waterPoint);
      else if (index < 0) {
        const shape = index === -2 ? this.cockpitShape : BODY_GEOMETRY.canopy;
        this.lowestBodyPoint(shape, this.definition.cockpit.position + shape.x, position, orientation, this.waterPoint);
      } else {
        // 前三个接触点是旧机头/尾梁代理；其余均来自真实壳体、翼面和附件。
        if (index < 3) continue;
        const point = this.contacts[index];
        if (!this.mainContact(point)) continue;
        this.waterPoint.copy(point).sub(this.aircraft.cg).applyQuaternion(orientation).add(position);
      }
      const depth = this.waterHeight(this.waterPoint.x, this.waterPoint.z) - this.waterPoint.y;
      if (depth < 0 || depth <= deepest) continue;
      deepest = depth;
      if (publish) { this.telemetry.waterContact = true; this.telemetry.waterContactPoint.copy(this.waterPoint); }
      else return true;
    }
    return deepest >= 0;
  }

  private hardGroundAt(point: Vector3, tolerance=0) {
    return (this.challenge !== 'birdman' && !this.onRunway(point.x,point.z) && point.y <= challengeTerrainHeight(this.challenge,point.x,point.z)+tolerance)
      || hitsChallengeRuin(this.challenge,point) || this.sweepsLaunchBox(point,point);
  }

  private criticalGroundContact(position: Vector3, orientation: Quaternion) {
    const h = 1e-4, x = position.x, z = position.z;
    this.contactNormal.set(
      -(challengeTerrainHeight(this.challenge,x+h,z)-challengeTerrainHeight(this.challenge,x-h,z))/(2*h), 1,
      -(challengeTerrainHeight(this.challenge,x,z+h)-challengeTerrainHeight(this.challenge,x,z-h))/(2*h)).normalize();
    for (const key of ['nose', 'canopy'] as const) {
      const shape = BODY_GEOMETRY[key];
      const centerX = key === 'nose' ? this.definition.fuselage.center+this.definition.fuselage.length/2+shape.x : this.definition.cockpit.position+shape.x;
      // Ground-normal support plus all six extrema catch slopes, inverted
      // cockpits and frontal/side impacts with the finite launcher or ruins.
      for (let face = -1; face < RUNWAY_NORMALS.length; face++) {
        this.lowestBodyPoint(shape, centerX, position, orientation, this.cross, face < 0 ? this.contactNormal : RUNWAY_NORMALS[face]);
        if (this.hardGroundAt(this.cross)) { this.groundImpactPoint.copy(this.cross); return true; }
      }
    }
    return false;
  }

  private sweepsNose() {
    this.noseAt(this.position, this.quaternion, this.platformStart);
    this.noseAt(this.candidatePosition, this.candidateQuaternion, this.platformEnd);
    if (this.challenge === 'birdman') return Math.min(this.platformStart.y, this.platformEnd.y) <= 0;
    if (this.sweepsRiver(this.platformStart, this.platformEnd) || hitsChallengeRuin(this.challenge,this.platformStart,this.platformEnd) || this.sweepsLaunchBox(this.platformStart,this.platformEnd)) return true;
    for (const key of ['nose', 'canopy'] as const) {
      const shape=BODY_GEOMETRY[key];
      const centerX=key==='nose'?this.definition.fuselage.center+this.definition.fuselage.length/2+shape.x:this.definition.cockpit.position+shape.x;
      for (const normal of RUNWAY_NORMALS) {
        this.lowestBodyPoint(shape,centerX,this.position,this.quaternion,this.platformStart,normal);
        this.lowestBodyPoint(shape,centerX,this.candidatePosition,this.candidateQuaternion,this.platformEnd,normal);
        if(hitsChallengeRuin(this.challenge,this.platformStart,this.platformEnd) || this.sweepsLaunchBox(this.platformStart,this.platformEnd)) return true;
      }
    }
    return false;
  }

  private landingAt(position: Vector3, orientation: Quaternion, speedSquared = this.velocity.lengthSq()): FlightResult['landing'] | null {
    if (this.challenge !== 'birdman') {
      // Only the visible nose/cockpit end a moving flight. Wing and fuselage
      // contacts are supported by the impulse solver instead.
      if (this.criticalGroundContact(position, orientation)) return 'terrain';
      if (speedSquared < WATER.stopSpeed ** 2) {
        const shell = this.cockpitShape;
        this.lowestBodyPoint(shell, this.definition.cockpit.position+shell.x, position, orientation, this.cross);
        if (!this.sweepsLaunchBox(this.cross,this.cross) && this.hardGroundAt(this.cross, CONTACT_TOLERANCE)) { this.groundImpactPoint.copy(this.cross); return 'terrain'; }
        // Tail beam is part of the fuselage; a stationary wingtip alone is not.
        this.cross.copy(this.contacts[2]).sub(this.aircraft.cg).applyQuaternion(orientation).add(position);
        if (!this.sweepsLaunchBox(this.cross,this.cross) && this.hardGroundAt(this.cross, CONTACT_TOLERANCE)) { this.groundImpactPoint.copy(this.cross); return 'terrain'; }
      }
    }
    this.noseAt(position, orientation, this.nosePoint);
    if (this.nosePoint.y <= this.waterHeight(this.nosePoint.x, this.nosePoint.z)) return 'water';
    return speedSquared < WATER.stopSpeed ** 2 && this.waterContactAt(position, orientation) ? 'water' : null;
  }

  private tailDistance() {
    const x = this.position.x - LAUNCH.endX, z = this.position.z, radius = Math.hypot(x, z);
    if (radius < 1e-9) return 0;
    let distance = Infinity;
    for (const point of this.contacts) {
      if (!this.mainContact(point)) continue;
      this.cross.copy(point).sub(this.aircraft.cg).applyQuaternion(this.quaternion);
      distance = Math.min(distance, radius + (this.cross.x * x + this.cross.z * z) / radius);
    }
    return Math.max(0, distance);
  }

  private finish(landing: FlightResult['landing']) {
    this.ended = true;
    this.result = { maxG: this.maxG, distance: this.telemetry.distance, time: this.time, averageSpeed: this.time > 0 ? this.travelled / this.time : 0,
      takeoffHeight: this.laboratoryState.takeoffHeight, takeoffSpeed: this.laboratoryState.takeoffSpeed, platformHeight: this.challenge === 'test-space' ? this.testSpace.height : undefined,
      maxSpeed: this.maxSpeed, minSpeed: this.minSpeed, maxHeight: this.maxHeight, landing,
      challenge: this.challenge, score: this.telemetry.score, completed: this.completed,
      checkpointScores: [...this.checkpointScores], heightPenalty: this.heightPenalty,
      speedScore: this.challenge === 'low-altitude' && this.completed && this.time > 0
        ? LOW_ALTITUDE.scoreScale * (challengeDefinitions['low-altitude'].length - challengeStartGate(this.challenge)!.x) / this.time : 0 };
  }
}

// Snapshots are deltas against a trusted constructor graph. Static geometry and
// untouched scratch buffers cost no file space; aliases and every changed value survive.
const snapshotOmitted = ['recording', 'wingLoads', 'replay', 'replayIndex', 'recordingLength', 'replayFinished', 'keyframes', 'nextKeyframe', 'platformFaces', 'platformGaps', 'platformImpulses', 'platformFriction', 'platformAxes', 'groundNormals', 'platformActive', 'platformCount', 'sectionContacts', 'branchContacts', 'structuralExternal', 'structuralCorrections', 'structuralResidualForce', 'structuralResidualMoment', 'structuralForce', 'structuralMoment', 'structuralBodies', 'structuralSeparated'];
const structureSnapshotOmitted = ['curvature', 'branchRoot', 'geometryScale', 'frozenBudget', 'elasticBudget', 'budgetRotation'];
function omitSnapshotField(sim: FlightSimulation, object: unknown, key: string) {
  return object === sim && snapshotOmitted.includes(key)
    || object === sim.structure && structureSnapshotOmitted.includes(key);
}
const unsafeSnapshotKeys = ['__proto__', 'prototype', 'constructor'];
type StateRecord = Record<string, unknown>;
// Object traversal needs indexed access, after runtime object checks.
const stateRecord = (value: object): StateRecord => value as StateRecord;
type SnapshotTemplate = { simulation: FlightSimulation; binding: string; nodes: StateRecord[]; keys: string[][]; ids: Map<object, number> };
const snapshotTemplates = new WeakMap<FlightSimulation, SnapshotTemplate>();
const recordingTemplates = new WeakMap<InputRecording, SnapshotTemplate>();
const checkpointSizes = new WeakMap<FlightSimulation, number>();

function simulationGraph(simulation: FlightSimulation): SnapshotTemplate {
  const nodes: StateRecord[] = [], keys: string[][] = [], ids = new Map<object, number>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || ids.has(value)) return;
    const object = stateRecord(value);
    ids.set(value, nodes.length); nodes.push(object);
    const names = value === simulation.definition ? [] : Object.keys(value).filter(key => !omitSnapshotField(simulation, value, key));
    keys.push(names);
    for (const key of names) visit(object[key]);
  };
  visit(simulation);
  return { simulation, binding: JSON.stringify([simulation.definition, simulation.challenge, stateRecord(simulation).launchRoll]), nodes, keys, ids };
}

function snapshotTemplate(sim: FlightSimulation, launchRoll: number) {
  let template = snapshotTemplates.get(sim);
  if (!template) {
    template = simulationGraph(new FlightSimulation(sim.definition, sim.challenge, launchRoll));
    snapshotTemplates.set(sim, template);
  }
  return template;
}

function snapshotSimulation(sim: FlightSimulation, launchRoll: number): SimulationSnapshot {
  const template = snapshotTemplate(sim, launchRoll), ids = new Map<object, number>(), paired = new Map<number, StateRecord>();
  const align = (value: unknown, base: unknown) => {
    if (!value || !base || typeof value !== 'object' || typeof base !== 'object' || ids.has(value) || Object.getPrototypeOf(value) !== Object.getPrototypeOf(base)) return;
    const id = template.ids.get(base)!;
    if (paired.has(id)) return;
    ids.set(value, id); paired.set(id, stateRecord(value));
    if (base === template.simulation.definition) return;
    for (const key of template.keys[id]) align(stateRecord(value)[key], stateRecord(base)[key]);
  };
  align(sim, template.simulation);
  const extra: SnapshotNode[] = [];
  const encode = (value: unknown): SnapshotValue => {
    if (value === undefined) return [-1];
    if (Object.is(value, -0)) return [-4];
    if (value === Infinity) return [-2];
    if (value === -Infinity) return [-3];
    if (typeof value === 'number' && !Number.isFinite(value)) throw Error('回放状态包含无效数值');
    if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value !== 'object') throw Error('回放状态包含无效类型');
    const known = ids.get(value);
    if (known !== undefined) return [known];
    const id = template.nodes.length + extra.length;
    ids.set(value, id);
    const kind = value instanceof Vector3 ? 'v' : value instanceof Quaternion ? 'q' : value instanceof Matrix3 ? 'm' : Array.isArray(value) ? 'a' : 'o';
    const keys = Object.keys(value);
    const node: SnapshotNode = [kind, keys, []];
    extra.push(node);
    node[2] = keys.map(key => encode(stateRecord(value)[key]));
    return [id];
  };
  const changes: SimulationSnapshot['changes'] = [];
  for (const [id, value] of paired) {
    if (value === stateRecord(sim.definition)) continue;
    const base = template.nodes[id], keys = template.keys[id], fields: (number | string | SnapshotValue)[] = [];
    if (Array.isArray(value) && value.length !== base.length) fields.push('length', value.length);
    for (const key of Object.keys(value)) {
      if (omitSnapshotField(sim, value, key)) continue;
      const item = value[key], old = base[key];
      if (Object.is(item, old) || item && typeof item === 'object' && ids.has(item) && ids.get(item) === template.ids.get(old as object)) continue;
      const index = keys.indexOf(key);
      fields.push(index < 0 ? key : index, encode(item));
    }
    if (fields.length) changes.push([id, fields]);
  }
  return { binding: template.binding, changes, extra };
}

const controlSnapshotKeys = ['weight', 'lateral', 'throttle', 'rudder', 'elevator', 'aileron', 'autoTrim', 'adaptiveControls', 'smartMixing', 'trimPitch', 'trimRoll'];
const fragmentSnapshotKeys = ['id', 'position', 'quaternion', 'velocity', 'omega', 'cg', 'mass', 'inertiaTensor', 'inverseInertia', 'landed', 'force', 'torque', 'drag', 'aeroPower', 'midpointVelocity', 'midpointOmega', 'midpointPosition', 'midpointQuaternion', 'candidateVelocity', 'candidateOmega'];
const resultSnapshotKeys = ['maxG', 'distance', 'time', 'averageSpeed', 'maxSpeed', 'minSpeed', 'maxHeight', 'landing', 'takeoffHeight', 'takeoffSpeed', 'platformHeight', 'challenge', 'score', 'completed', 'checkpointScores', 'speedScore', 'heightPenalty'];

export function captureReplayKeyframe(sim: FlightSimulation, recording: InputRecording): ReplayKeyframe {
  return { time: sim.elapsedTime, frame: sim.replayFrame, state: snapshotSimulation(sim, recording.launchRoll) };
}

/** Decode only known constructors and template-owned fields, never file-provided prototypes. */
export function restoreReplayKeyframe(definition: AircraftDefinition, challenge: ChallengeMode, recording: InputRecording, point: ReplayKeyframe): FlightSimulation {
  function fail(): never { throw Error('回放关键帧状态无效'); }
  let template = recordingTemplates.get(recording);
  if (!template) {
    template = simulationGraph(new FlightSimulation(definition, challenge, recording.launchRoll));
    recordingTemplates.set(recording, template);
  }
  if (template.simulation.challenge !== challenge || JSON.stringify(template.simulation.definition) !== JSON.stringify(validateAircraft(definition))) fail();
  const state = point.state;
  if (!state || state.binding !== template.binding || !Array.isArray(state.changes) || !Array.isArray(state.extra) || state.changes.length > template.nodes.length || state.extra.length > 20_000) fail();
  const sim = template.simulation.checkpoint(), graph = simulationGraph(sim), nodes = graph.nodes;
  const shapes = template.keys.filter((keys, index) => Object.getPrototypeOf(template!.nodes[index]) === Object.prototype);
  let fields = 0;
  for (const node of state.extra) {
    if (!Array.isArray(node) || node.length !== 3 || !Array.isArray(node[1]) || !Array.isArray(node[2]) || node[1].length !== node[2].length || (fields += node[1].length) > 200_000) fail();
    const [kind, keys] = node;
    if (keys.some(key => typeof key !== 'string' || unsafeSnapshotKeys.includes(key)) || new Set(keys).size !== keys.length) fail();
    let value: object;
    if (kind === 'v') { if (keys.join(',') !== 'x,y,z') fail(); value = new Vector3(); }
    else if (kind === 'q') { if (keys.join(',') !== 'isQuaternion,_x,_y,_z,_w') fail(); value = new Quaternion(); }
    else if (kind === 'm') { if (keys.join(',') !== 'elements') fail(); value = new Matrix3(); }
    else if (kind === 'a') { if (keys.some((key, index) => key !== String(index))) fail(); value = []; }
    else if (kind === 'o') {
      const allowed = shapes.some(shape => keys.length === shape.length && keys.every(key => shape.includes(key)))
        || keys.length === fragmentSnapshotKeys.length && keys.every(key => fragmentSnapshotKeys.includes(key))
        || keys.every(key => resultSnapshotKeys.includes(key)) && resultSnapshotKeys.filter(key => !['takeoffHeight', 'takeoffSpeed', 'platformHeight'].includes(key)).every(key => keys.includes(key))
        || keys.every(key => controlSnapshotKeys.includes(key));
      if (!allowed) fail();
      value = {};
    } else fail();
    nodes.push(stateRecord(value));
  }
  const decode = (value: SnapshotValue): unknown => {
    if (Array.isArray(value)) {
      if (value.length !== 1 || !Number.isInteger(value[0]) || value[0] < -4 || value[0] >= nodes.length) fail();
      return value[0] === -4 ? -0 : value[0] === -1 ? undefined : value[0] === -2 ? Infinity : value[0] === -3 ? -Infinity : nodes[value[0]];
    }
    if (value !== null && !['number', 'string', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) fail();
    return value;
  };
  state.extra.forEach(([, keys, values], index) => keys.forEach((key, field) => { nodes[template!.nodes.length + index][key] = decode(values[field]); }));
  const changed = new Set<number>();
  const controls = ['effective', 'applied', 'requestedControls', 'fullControls', 'predictedControls'].map(key => stateRecord(sim)[key]);
  for (const change of state.changes) {
    if (!Array.isArray(change) || change.length !== 2) fail();
    const [id, updates] = change;
    if (!Number.isInteger(id) || id < 0 || id >= template.nodes.length || changed.has(id) || !Array.isArray(updates) || updates.length % 2 || (fields += updates.length) > 400_000) fail();
    changed.add(id);
    const object = nodes[id], keys = template.keys[id], seen = new Set<string>();
    if (object === stateRecord(sim.definition)) fail();
    for (let i = 0; i < updates.length; i += 2) {
      const field = updates[i];
      const key = typeof field === 'number' && Number.isInteger(field) ? keys[field] : typeof field === 'string' ? field : undefined;
      if (key === undefined || unsafeSnapshotKeys.includes(key) || seen.has(key) || omitSnapshotField(sim, object, key)) fail();
      seen.add(key);
      if (!keys.includes(key) && !(Array.isArray(object) && (key === 'length' || /^(0|[1-9]\d*)$/.test(key))) && !(controls.includes(object) && controlSnapshotKeys.includes(key))) fail();
      const value = decode(updates[i + 1] as SnapshotValue);
      if (Array.isArray(object) && (key === 'length' && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 20_000) || key !== 'length' && Number(key) >= 20_000)) fail();
      if (ArrayBuffer.isView(object) && (typeof value !== 'number' || !Number.isFinite(value))) fail();
      object[key] = value;
    }
  }
  // Validate restored shapes against trusted objects, including arrays introduced
  // by fractures/results. Typed buffers and class instances retain their methods.
  const checked = new Map<object, Set<object>>();
  const check = (value: unknown, base: unknown, key = '') => {
    // Live flights leave the reset policy unset; replay templates pin their launch roll.
    if (key === 'fixedLaunchRoll') {
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > LAUNCH_ROLL_LIMIT)) fail();
      return;
    }
    if (base === null || base === undefined) {
      if (value === null || value === undefined) return;
      if (key === 'energyPerDistance') { if (typeof value !== 'number' || !Number.isFinite(value)) fail(); return; }
      if (key === 'liftCenter' || key === 'dragCenter') { check(value, new Vector3()); return; }
      if (key === 'result') {
        if (!value || typeof value !== 'object' || Object.keys(value).some(name => !resultSnapshotKeys.includes(name))) fail();
        const result = stateRecord(value as object);
        for (const name of resultSnapshotKeys) {
          if (['takeoffHeight', 'takeoffSpeed', 'platformHeight'].includes(name) && result[name] === undefined) continue;
          if (name === 'checkpointScores') { check(result[name], [0], name); continue; }
          if (name === 'challenge') { if (result[name] !== challenge) fail(); continue; }
          if (name === 'landing') { if (!['water', 'terrain', 'boundary', 'finish', 'manual'].includes(String(result[name]))) fail(); continue; }
          if (typeof result[name] !== (name === 'completed' ? 'boolean' : 'number') || typeof result[name] === 'number' && !Number.isFinite(result[name])) fail();
        }
        return;
      }
      fail();
    }
    if (typeof base !== 'object') {
      const unboundedWingMetric = value === Infinity && sim.aircraft.wingArea === 0 && (key === 'wingLoading' || key === 'stallSpeed');
      if (typeof value !== typeof base || typeof value === 'number' && !Number.isFinite(value) && value !== base && !unboundedWingMetric) fail();
      return;
    }
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.getPrototypeOf(base)) fail();
    if (base instanceof Quaternion && Math.abs((value as Quaternion).lengthSq() - 1) > 1e-6) fail();
    if (checked.get(value)?.has(base)) return;
    if (!checked.has(value)) checked.set(value, new Set());
    checked.get(value)!.add(base);
    if (base === template!.simulation.definition) { if (JSON.stringify(value) !== JSON.stringify(base)) fail(); return; }
    if (Array.isArray(base)) {
      if (!Array.isArray(value)) fail();
      if (value.length > 20_000) fail();
      if (key === 'owned') {
        // Ownership is a derived acceleration index, never a second source of
        // topology. Reject duplicates, omissions and references to other strips.
        if (value.length > sim.structure.sections.length + 1) fail();
        const seen = new Set<unknown>();
        for (let id = 0; id < value.length; id++) {
          const sections = value[id]; if (!Array.isArray(sections)) fail();
          for (const section of sections) {
            if (!section || sim.structure.sections[section.id] !== section || section.bodyId !== id || seen.has(section)) fail();
            seen.add(section);
          }
        }
        if (seen.size !== sim.structure.sections.length) fail();
      } else if (key === 'fragments') {
        if (value.length > sim.structure.sections.length) fail();
        for (const item of value) {
          if (!item || typeof item !== 'object' || Object.keys(item).length !== fragmentSnapshotKeys.length || fragmentSnapshotKeys.some(name => !Object.hasOwn(item, name))) fail();
          const fragment = stateRecord(item);
          for (const name of fragmentSnapshotKeys) check(fragment[name], name === 'landed' ? false : name.includes('Quaternion') || name === 'quaternion' ? new Quaternion() : ['inertiaTensor', 'inverseInertia'].includes(name) ? new Matrix3() : ['id', 'mass', 'aeroPower'].includes(name) ? 0 : new Vector3(), name);
        }
      } else {
        const dynamic = ['candidates', 'checkpointScores'].includes(key);
        if (!dynamic && value.length !== base.length) fail();
        const element = key === 'candidates' ? template!.simulation.structure.sections[0] : key === 'checkpointScores' ? 0 : base[0];
        for (let i = 0; i < value.length; i++) check(value[i], dynamic ? element : base[i], String(i));
      }
      return;
    }
    if (ArrayBuffer.isView(base)) {
      const actual = value as Float64Array, expected = base as Float64Array;
      if (actual.length !== expected.length) fail();
      for (let i = 0; i < actual.length; i++) if (typeof actual[i] !== 'number' || !Number.isFinite(actual[i]) && actual[i] !== expected[i]) fail();
      return;
    }
    const actual = stateRecord(value as object), expected = stateRecord(base);
    const names = Object.keys(base).filter(name => !omitSnapshotField(template!.simulation, base, name));
    for (const name of names) {
      if (!Object.hasOwn(actual, name)) fail();
      check(actual[name], expected[name], name);
    }
    for (const name of Object.keys(actual)) {
      if (omitSnapshotField(template!.simulation, base, name) || names.includes(name)) continue;
      if (!controls.includes(actual) || !controlSnapshotKeys.includes(name)) fail();
      check(actual[name], name === 'autoTrim' || name === 'adaptiveControls' || name === 'smartMixing' ? false : 0, name);
    }
  };
  check(sim, template.simulation);
  // Support topology is fixed by the aircraft definition. A keyframe may change
  // ownership and shape, but must never introduce a forged parent or cycle.
  const expectedSections = template.simulation.structure.sections;
  const ordered = stateRecord(sim.structure).ordered as typeof sim.structure.sections;
  const expectedOrder = stateRecord(template.simulation.structure).ordered as typeof expectedSections;
  if (sim.structure.sections.some((section, index) => section.id !== index || section.parentId !== expectedSections[index].parentId || section.depth !== expectedSections[index].depth)
    || ordered.some((section, index) => section !== sim.structure.sections[expectedOrder[index].id])) fail();
  if (!sim.structure.rotationBudgetValid()) fail();
  const tick = stateRecord(sim).fractureTick as number, phase = stateRecord(sim).fractureTickElapsed as number;
  const clockTime = tick === 0 ? 0 : (tick - 1) * PHYSICS_TICK + (phase === 0 ? PHYSICS_TICK : phase);
  if (!Number.isSafeInteger(tick) || tick < 0 || !Number.isFinite(phase) || phase < 0 || phase >= PHYSICS_TICK
    || tick === 0 && phase !== 0 || clockTime > sim.elapsedTime + 1e-9) fail();
  for (const section of sim.structure.sections) {
    const { fractureDamage: damage, fractureDamageBase: base, fractureDamagePeak: peak, fractureDamageTick: measured } = section;
    if (![damage, base, peak].every(value => Number.isFinite(value) && value >= 0 && value <= 1)
      || !Number.isSafeInteger(measured) || measured < 0 || measured > tick
      || measured > 0 && Math.abs(damage - Math.min(1, base + peak)) > 1e-12
      || section.bodyId !== 0 && (section.parentId === null || sim.structure.sections[section.parentId].bodyId !== section.bodyId) && (damage !== 0 || base !== 0 || peak !== 0)) fail();
  }
  if (Math.abs(sim.elapsedTime - point.time) > 1e-8 || sim.challenge !== challenge || stateRecord(sim).launchRoll !== recording.launchRoll || sim.telemetry.cg !== sim.aircraft.cg || sim.telemetry.aerodynamics !== stateRecord(sim).aerodynamics || sim.structure.definition !== sim.definition || sim.structure.sections.some((section, index) => section.surface !== sim.surfaces[index])) fail();
  if (!Number.isInteger(point.frame) || point.frame < 0 || point.frame > recording.length || !Number.isFinite(point.time) || point.time < 0 || sim.mass <= 0 || sim.telemetry.fuelRemaining < 0 || sim.telemetry.fuelRemaining > sim.definition.fuelTank.capacity + 1e-8 || sim.ended !== (sim.result !== null)) fail();
  const bodies = new Set([0, ...sim.fragments.map(fragment => fragment.id)]);
  if (bodies.size !== sim.fragments.length + 1 || sim.fragments.some(fragment => !Number.isInteger(fragment.id) || fragment.id <= 0 || fragment.mass <= 0) || sim.structure.sections.some(section => !bodies.has(section.bodyId))) fail();
  sim.resumeReplay(recording, point.frame);
  return sim;
}
