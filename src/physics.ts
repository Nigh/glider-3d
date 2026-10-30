import { Quaternion, Vector3 } from 'three';
import { clamp, DEG, planform, validateAircraft, type AircraftDefinition, type Controls, type FlightMode, type Wing } from './model';

export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.225;
/** 平台顶面与匀加速发射轨道；离台后没有推进力。 */
export const LAUNCH = { startX: -20, endX: 0, height: 10, speed: 10, acceleration: 2.5 } as const;
const MAX_FRAMES = 36_000;
const FRAME_WIDTH = 5;
const ZERO_CONTROLS: Controls = { weight: 0, rudder: 0, elevator: 0, aileron: 0 };

export interface AircraftProperties {
  mass: number;
  cg: Vector3;
  inertia: Vector3;
  wingArea: number;
  span: number;
  aspect: number;
  wingLoading: number;
  glideRatio: number;
  staticMargin: number;
  /** 主翼平均气动弦 1/4 弦几何参考点，独立于全机合力中心。 */
  mainQuarterChord: Vector3;
  neutralPoint: number;
  /** 12 m/s、5°攻角、3°侧滑，零角速度、零操纵的设计参考。 */
  aerodynamics: AerodynamicReference;
}
interface MassPart { mass: number; x: number; y: number; z: number; ix: number; iy: number; iz: number; moving?: boolean }
interface Polar { cl: number; cd: number }
export interface WingAerodynamics {
  kind: AerodynamicSurface['kind'];
  name: string;
  area: number;
  aspect: number;
  alpha: number;
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
  normal: Vector3;
  incidence: number;
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
  landing: 'water' | 'boundary' | 'platform' | 'terrain';
}
export interface FlightTelemetry {
  speed: number; altitude: number; distance: number;
  alpha: number; pitch: number; roll: number; sink: number; glide: number;
  stall: boolean; physicsMs: number; cg: Vector3; mass: number;
  force: Vector3; drag: Vector3; torque: Vector3;
  aeroPower: number; energy: number; staticMargin: number;
  potentialEnergy: number; kineticEnergy: number; dissipatedEnergy: number; initialEnergy: number;
  liftDragRatio: number;
  aerodynamics: AerodynamicReference;
}
export interface InputRecording { frames: Float64Array; length: number }

function quarterChord(w: Wing) {
  const p = planform(w);
  const fraction = (p.root + 2 * p.tip) / (3 * (p.root + p.tip));
  return w.points[0].x + (w.points[1].x - w.points[0].x) * fraction
    + (p.root + (p.tip - p.root) * fraction) * 0.25;
}

function massLayout(d: AircraftDefinition): MassPart[] {
  const length = d.fuselage.length;
  const fuselageMass = 22 + 1.1 * length;
  const parts: MassPart[] = [
    { mass: fuselageMass, x: -0.13 * length, y: 0, z: 0, ix: fuselageMass * 0.04, iy: fuselageMass * length * length / 12, iz: fuselageMass * length * length / 12 },
    { mass: 4, x: d.cockpit.position, y: 0.12, z: 0, ix: 0.1, iy: 0.2, iz: 0.2 },
    // 趴姿只改变显示网格；乘员仍用此固定质点和局部惯量近似，不引入关节运动功。
    { mass: d.pilot.mass, x: d.cockpit.position, y: 0.15, z: 0, ix: d.pilot.mass * 0.08, iy: d.pilot.mass * 0.025, iz: d.pilot.mass * 0.08, moving: true },
  ];
  for (const key of ['mainWing', 'horizontalTail', 'verticalTail'] as const) {
    const vertical = key === 'verticalTail';
    const w = d[key], p = planform(w, !vertical);
    const density = key === 'mainWing' ? 0.95 : 0.9;
    const fraction = (p.root + 2 * p.tip) / (3 * (p.root + p.tip));
    const centerX = w.points[0].x + (w.points[1].x - w.points[0].x) * fraction
      + (p.root + (p.tip - p.root) * fraction) / 2;
    const halfSpan = vertical ? p.span : p.span / 2;
    const center = halfSpan * fraction;
    for (let side = -1; side <= 1; side += 2) {
      if (vertical && side === -1) continue;
      // 展长的立方惩罚近似梁的增强成本，避免等面积无限增展成为无代价最优解。
      const reinforcement = key === 'mainWing' ? 0.0025 * p.span ** 3 : 0;
      const mass = (p.area * density + reinforcement) / (vertical ? 1 : 2);
      const y = vertical ? center : (key === 'mainWing' ? d.assembly.mainWingHeight : 0) + center * Math.tan(w.dihedral * DEG);
      parts.push({ mass, x: d.assembly[key] - centerX, y, z: vertical ? 0 : side * center,
        ix: mass * halfSpan * halfSpan / 12,
        iy: mass * (p.chord * p.chord + (vertical ? 0 : halfSpan * halfSpan)) / 12,
        iz: mass * (p.chord * p.chord + (vertical ? halfSpan * halfSpan : 0)) / 12 });
    }
  }
  return parts;
}

function properties(d: AircraftDefinition): AircraftProperties {
  const p = planform(d.mainWing);
  const tail = planform(d.horizontalTail);
  const vertical = planform(d.verticalTail, false);
  const mainQuarter = quarterChord(d.mainWing), mainAngle = d.assembly.mainIncidence * DEG;
  const mainX = d.assembly.mainWing - mainQuarter * Math.cos(mainAngle);
  const tailX = d.assembly.horizontalTail - quarterChord(d.horizontalTail) * Math.cos(d.assembly.tailIncidence * DEG);
  const tailSlopeRatio = (tail.aspect / (tail.aspect + 2)) / (p.aspect / (p.aspect + 2));
  const effectiveness = 0.65 * tail.area / p.area * tailSlopeRatio;
  const neutral = (mainX + effectiveness * tailX) / (1 + effectiveness);
  const cd0 = 0.018 + (0.28 + 0.018 * (tail.area + vertical.area)) / p.area;
  const center = p.span / 2 * (p.root + 2 * p.tip) / (3 * (p.root + p.tip));
  return { mass: 0, cg: new Vector3(), inertia: new Vector3(), wingArea: p.area, span: p.span, aspect: p.aspect,
    wingLoading: 0, glideRatio: 1 / (2 * Math.sqrt(cd0 / (Math.PI * p.aspect * 0.82))), staticMargin: 0,
    mainQuarterChord: new Vector3(mainX, d.assembly.mainWingHeight - mainQuarter * Math.sin(mainAngle) + center * Math.tan(d.mainWing.dihedral * DEG), 0),
    neutralPoint: neutral, aerodynamics: new AerodynamicSummary(makeSurfaces(d)) };
}

function updateMass(d: AircraftDefinition, parts: MassPart[], weight: number, out: AircraftProperties, neutral: number, chord: number, updateInertia = true) {
  let mass = 0, x = 0, y = 0, z = 0;
  for (const p of parts) {
    const px = p.x + (p.moving ? weight * d.controls.travel : 0);
    mass += p.mass; x += p.mass * px; y += p.mass * p.y; z += p.mass * p.z;
  }
  out.mass = mass;
  out.cg.set(x / mass, y / mass, z / mass);
  out.wingLoading = mass / out.wingArea;
  out.staticMargin = (out.cg.x - neutral) / chord;
  if (!updateInertia) return;
  let ix = 0, iy = 0, iz = 0;
  for (const p of parts) {
    const dx = p.x + (p.moving ? weight * d.controls.travel : 0) - out.cg.x;
    const dy = p.y - out.cg.y, dz = p.z - out.cg.z;
    ix += p.ix + p.mass * (dy * dy + dz * dz);
    iy += p.iy + p.mass * (dx * dx + dz * dz);
    iz += p.iz + p.mass * (dx * dx + dy * dy);
  }
  out.inertia.set(ix, iy, iz);
}

export function derive(d: AircraftDefinition, weight = 0): AircraftProperties {
  const out = properties(d), neutral = out.neutralPoint;
  updateMass(d, massLayout(d), clamp(weight, -1, 1), out, neutral, planform(d.mainWing).chord);
  evaluateReference(out);
  return out;
}

function polar(alpha: number, aspect: number, out: Polar): Polar {
  alpha = Math.atan2(Math.sin(alpha), Math.cos(alpha));
  const absolute = Math.abs(alpha);
  const slope = 2 * Math.PI * aspect / (aspect + 2);
  const blend = clamp((absolute - 15 * DEG) / (20 * DEG), 0, 1);
  const separated = blend * blend * (3 - 2 * blend);
  out.cl = (1 - separated) * slope * alpha + separated * 1.05 * Math.sin(2 * alpha);
  const dragBlend = clamp((absolute - 12 * DEG) / (20 * DEG), 0, 1);
  const dragSeparation = dragBlend * dragBlend * (3 - 2 * dragBlend);
  out.cd = 0.018 + out.cl * out.cl / (Math.PI * Math.max(aspect, 0.1) * 0.82)
    + 1.7 * Math.sin(alpha) ** 2 * dragSeparation + 0.3 * (1 - Math.cos(alpha)) ** 2;
  return out;
}

/** 迎角为弧度；光滑失速混合保留失速前有限翼升力斜率。 */
export function coefficients(alpha: number, aspect: number): Polar {
  return polar(alpha, aspect, { cl: 0, cd: 0 });
}

function makeSurfaces(d: AircraftDefinition): AerodynamicSurface[] {
  const surfaces: AerodynamicSurface[] = [];
  for (const key of ['mainWing', 'horizontalTail', 'verticalTail'] as const) {
    const vertical = key === 'verticalTail', w = d[key], p = planform(w, !vertical);
    const center = (vertical ? p.span : p.span / 2) * (p.root + 2 * p.tip) / (3 * (p.root + p.tip));
    const quarter = quarterChord(w);
    const incidence = (key === 'mainWing' ? d.assembly.mainIncidence : key === 'horizontalTail' ? d.assembly.tailIncidence : 0) * DEG;
    const height = key === 'mainWing' ? d.assembly.mainWingHeight : 0.35;
    for (let side = -1; side <= 1; side += 2) {
      if (vertical && side === -1) continue;
      const angle = w.dihedral * DEG;
      surfaces.push({ name: vertical ? '垂直尾翼' : `${key === 'mainWing' ? '主翼' : '水平尾翼'}${side < 0 ? '左' : '右'}`,
        point: new Vector3(d.assembly[key] - quarter * Math.cos(incidence),
          vertical ? height + center : height - quarter * Math.sin(incidence) + center * Math.tan(angle), vertical ? 0 : side * center),
        normal: vertical ? new Vector3(0, 0, 1) : new Vector3(0, Math.cos(angle), -side * Math.sin(angle)),
        area: p.area / (vertical ? 1 : 2), aspect: p.aspect,
        incidence: vertical ? 0 : (key === 'mainWing' ? d.assembly.mainIncidence + 2 : d.assembly.tailIncidence) * DEG,
        kind: vertical ? 'vertical' : key === 'mainWing' ? 'main' : 'tail', side, alpha: 0,
        force: new Vector3(), drag: new Vector3() });
    }
  }
  return surfaces;
}

/** 与飞行积分共用单翼计算；力、阻力输出先保留在机体坐标中。 */
function evaluateSurface(surface: AerodynamicSurface, input: Controls, mainLift: number, mainAspect: number,
  velocity: Vector3, coefficient: Polar, liftDirection: Vector3) {
  const speed = velocity.length(), normalSpeed = velocity.dot(surface.normal);
  let incidence = surface.incidence;
  if (surface.kind === 'main') incidence -= surface.side * input.aileron * 8 * DEG;
  else if (surface.kind === 'tail') incidence -= mainLift * 0.78 / (Math.PI * mainAspect) + input.elevator * 12 * DEG;
  else incidence -= input.rudder * 15 * DEG;
  surface.alpha = Math.atan2(-normalSpeed, velocity.x) + incidence;
  polar(surface.alpha, surface.aspect, coefficient);
  const lift = 0.5 * AIR_DENSITY * (velocity.x ** 2 + normalSpeed ** 2) * surface.area * coefficient.cl;
  liftDirection.copy(surface.normal);
  if (speed > 1e-9) liftDirection.addScaledVector(velocity, -normalSpeed / (speed * speed));
  if (liftDirection.lengthSq() > 1e-12) liftDirection.normalize();
  else liftDirection.set(0, 0, 0);
  surface.drag.copy(velocity).multiplyScalar(-0.5 * AIR_DENSITY * speed * surface.area * coefficient.cd);
  surface.force.copy(liftDirection).multiplyScalar(lift).add(surface.drag);
  return coefficient.cl;
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
      wing.torque.set(0, 0, 0); wing.alpha = 0;
    }
    for (const surface of this.surfaces) {
      const wing = this.wings[surface.kind === 'main' ? 0 : surface.kind === 'tail' ? 1 : 2];
      this.arm.copy(surface.point).sub(cg);
      this.localForce.copy(surface.force).applyQuaternion(this.inverse);
      this.localDrag.copy(surface.drag).applyQuaternion(this.inverse);
      wing.force.add(this.localForce); wing.drag.add(this.localDrag);
      wing.alpha += surface.alpha * surface.area / wing.area;
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
    this.bodyDrag.copy(this.velocity).multiplyScalar(-0.5 * AIR_DENSITY * this.speed * 0.28);
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
  const summary = aircraft.aerodynamics as AerodynamicSummary;
  const alpha = 5 * DEG, beta = 3 * DEG, speed = 12;
  const velocity = new Vector3(speed * Math.cos(alpha) * Math.cos(beta),
    -speed * Math.sin(alpha) * Math.cos(beta), speed * Math.sin(beta));
  const coefficient: Polar = { cl: 0, cd: 0 }, direction = new Vector3();
  let mainLift = 0;
  for (const surface of summary.surfaces) {
    const cl = evaluateSurface(surface, ZERO_CONTROLS, mainLift, aircraft.aspect, velocity, coefficient, direction);
    if (surface.kind === 'main') mainLift += cl;
  }
  summary.update(aircraft.cg, new Quaternion(), velocity);
}
/** 与 scene.wingGeometry 相同的翼型采样，碰撞与发射净空包含安装角和厚度。 */
function makeContacts(d: AircraftDefinition): Vector3[] {
  const points = [
    new Vector3(d.fuselage.length / 2, -0.12, 0),
    new Vector3(d.fuselage.length / 2 + 0.252, -0.156, 0),
    new Vector3(-d.fuselage.length / 2, -0.12, 0),
    new Vector3(d.cockpit.position - 0.75, -0.495, 0),
    new Vector3(d.cockpit.position + 0.75, -0.495, 0),
  ];
  for (const key of ['mainWing', 'horizontalTail', 'verticalTail'] as const) {
    const w = d[key], vertical = key === 'verticalTail';
    const height = key === 'mainWing' ? d.assembly.mainWingHeight : 0.35;
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
            points.push(vertical ? new Vector3(d.assembly[key] + x, height + span, y)
              : new Vector3(d.assembly[key] + x * c - y * s, height + x * s + y * c + span * Math.tan(w.dihedral * DEG), side * span));
          }
        }
      }
    }
  }
  return points;
}

/** 水平发射时重心高度；所有接触点至少高于平台顶面 5 cm。 */
export function launchHeight(d: AircraftDefinition, cg = derive(d).cg): number {
  let lowest = Infinity;
  for (const point of makeContacts(d)) lowest = Math.min(lowest, point.y - cg.y);
  return LAUNCH.height + 0.05 - lowest;
}


export class FlightSimulation {
  readonly definition: AircraftDefinition;
  readonly mode: FlightMode;
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
  private replay: InputRecording | null = null;
  private replayIndex = 0;
  private readonly parts: MassPart[];
  private readonly neutral: number;
  private readonly chord: number;
  private readonly aerodynamics: AerodynamicSummary;
  private readonly flightInertia = new Vector3();
  private readonly launchAltitude: number;
  private readonly bodyVelocity = new Vector3();
  private readonly contacts: Vector3[];
  private readonly inverse = new Quaternion();
  private readonly rotation = new Quaternion();
  private readonly arm = new Vector3();
  private readonly localVelocity = new Vector3();
  private readonly liftDirection = new Vector3();
  private readonly localDrag = new Vector3();
  private readonly torque = new Vector3();
  private readonly cross = new Vector3();
  private readonly previousVelocity = new Vector3();
  private readonly previousOmega = new Vector3();
  private readonly midpointVelocity = new Vector3();
  private readonly midpointOmega = new Vector3();
  private readonly candidateVelocity = new Vector3();
  private readonly candidateOmega = new Vector3();
  private readonly midpointQuaternion = new Quaternion();
  private readonly polar: Polar = { cl: 0, cd: 0 };
  private maxSpeed = 10;
  private minSpeed = 10;
  private maxHeight = 10;
  private travelled = 0;
  private weight = 0;
  private readonly effective: Controls = { ...ZERO_CONTROLS };

  constructor(d: AircraftDefinition, mode: FlightMode = 'standard') {
    this.definition = validateAircraft(d);
    this.mode = mode;
    this.parts = massLayout(this.definition);
    this.aircraft = properties(this.definition);
    this.neutral = this.aircraft.neutralPoint;
    this.chord = planform(this.definition.mainWing).chord;
    this.surfaces = makeSurfaces(this.definition);
    this.aerodynamics = new AerodynamicSummary(this.surfaces);
    this.contacts = makeContacts(this.definition);
    updateMass(this.definition, this.parts, 0, this.aircraft, this.neutral, this.chord);
    evaluateReference(this.aircraft);
    this.flightInertia.copy(this.aircraft.inertia);
    let lowest = Infinity;
    for (const point of this.contacts) lowest = Math.min(lowest, point.y - this.aircraft.cg.y);
    this.launchAltitude = LAUNCH.height + 0.05 - lowest;
    this.telemetry = { speed: 10, altitude: 10, distance: 0, alpha: 0, pitch: 0, roll: 0, sink: 0, glide: 0,
      stall: false, physicsMs: 0, cg: this.aircraft.cg, mass: 0, force: new Vector3(), drag: new Vector3(), torque: new Vector3(),
      aeroPower: 0, energy: 0, staticMargin: 0, potentialEnergy: 0, kineticEnergy: 0,
      dissipatedEnergy: 0, initialEnergy: 0, liftDragRatio: 0, aerodynamics: this.aerodynamics };
    this.reset();
  }

  reset() {
    this.position.set(LAUNCH.startX, this.launchAltitude, 0);
    this.velocity.set(0, 0, 0);
    this.quaternion.identity();
    this.omega.set(0, 0, 0);
    this.time = 0; this.ended = false; this.result = null;
    this.launching = true; this.flightStarted = false; this.launchTime = 0;
    this.recordingLength = 0; this.replayIndex = 0; this.replayFinished = false; this.replay = null;
    this.maxSpeed = LAUNCH.speed; this.minSpeed = LAUNCH.speed; this.maxHeight = this.launchAltitude;
    this.travelled = 0; this.weight = 0;
    Object.assign(this.effective, ZERO_CONTROLS);
    updateMass(this.definition, this.parts, 0, this.aircraft, this.neutral, this.chord);
    this.aircraft.inertia.copy(this.flightInertia);
    for (const surface of this.surfaces) { surface.force.set(0, 0, 0); surface.drag.set(0, 0, 0); surface.alpha = 0; }
    this.telemetry.force.set(0, 0, 0); this.telemetry.drag.set(0, 0, 0); this.telemetry.torque.set(0, 0, 0);
    this.telemetry.physicsMs = 0; this.telemetry.aeroPower = 0;
    this.telemetry.dissipatedEnergy = 0; this.telemetry.initialEnergy = 0; this.telemetry.liftDragRatio = 0;
    this.aerodynamics.update(this.aircraft.cg, this.quaternion, this.velocity);
    this.updateTelemetry();
  }

  getRecording(): InputRecording {
    return { frames: this.recording.slice(0, this.recordingLength * FRAME_WIDTH), length: this.recordingLength };
  }

  loadReplay(recording: InputRecording) {
    if (!Number.isInteger(recording.length) || recording.length < 0 || recording.length > MAX_FRAMES || recording.frames.length < recording.length * FRAME_WIDTH) throw new Error('飞行记录长度无效');
    for (let i = 0; i < recording.length * FRAME_WIDTH; i++) {
      if (!Number.isFinite(recording.frames[i]) || (i % FRAME_WIDTH === 0 && (recording.frames[i] <= 0 || recording.frames[i] > 0.25))) throw new Error('飞行记录包含无效输入');
    }
    const copy = { frames: recording.frames.slice(0, recording.length * FRAME_WIDTH), length: recording.length };
    this.reset();
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
      this.replayIndex++;
      this.replayFinished = this.replayIndex >= this.replay.length;
    } else {
      input.weight = controls.weight; input.rudder = controls.rudder;
      input.elevator = controls.elevator; input.aileron = controls.aileron;
    }
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25) throw new RangeError('步长须在 0 至 0.25 秒之间');
    if (!Number.isFinite(input.weight + input.rudder + input.elevator + input.aileron)) throw new RangeError('操纵输入必须为有限数');
    input.weight = clamp(input.weight, -1, 1); input.rudder = clamp(input.rudder, -1, 1);
    input.elevator = clamp(input.elevator, -1, 1); input.aileron = clamp(input.aileron, -1, 1);
    if (!this.replay && this.recordingLength < MAX_FRAMES) {
      const offset = this.recordingLength++ * FRAME_WIDTH;
      this.recording[offset] = dt; this.recording[offset + 1] = input.weight;
      this.recording[offset + 2] = input.rudder; this.recording[offset + 3] = input.elevator; this.recording[offset + 4] = input.aileron;
    }
    // 60 Hz 是标准物理步；较大的外部步长只拆成相同上限，绝不按帧率缩放气动力。
    const steps = Math.max(1, Math.ceil(dt * 60 - 1e-10));
    const h = dt / steps;
    for (let i = 0; i < steps && !this.ended; i++) this.integrate(input, h);
    this.telemetry.physicsMs = performance.now() - started;
  }

  private integrate(input: Controls, dt: number) {
    // 准静态操纵只改变重心与气动力臂。惯量保持中立构型值，不模拟人体做功。
    this.weight += clamp(input.weight - this.weight, -dt * 1.5, dt * 1.5);
    updateMass(this.definition, this.parts, this.weight, this.aircraft, this.neutral, this.chord, false);
    if (this.launching) {
      const duration = LAUNCH.speed / LAUNCH.acceleration;
      const h = Math.min(dt, Math.max(0, duration - this.launchTime));
      const oldX = this.position.x;
      this.launchTime = Math.min(duration, this.launchTime + h);
      this.position.set(LAUNCH.startX + 0.5 * LAUNCH.acceleration * this.launchTime ** 2, this.launchAltitude, 0);
      this.velocity.set(LAUNCH.acceleration * this.launchTime, 0, 0);
      this.time += h;
      this.travelled += this.position.x - oldX;
      if (duration - this.launchTime <= 1e-12) {
        this.position.x = LAUNCH.endX;
        this.velocity.x = LAUNCH.speed;
        this.launching = false;
        this.beginFlight();
      }
      this.updateTelemetry();
      if (dt - h > 1e-12 && !this.launching) this.integrateFlight(input, dt - h);
      return;
    }
    if (!this.flightStarted) this.beginFlight();
    this.integrateFlight(input, dt);
  }

  private beginFlight() {
    this.flightStarted = true;
    this.maxSpeed = this.minSpeed = this.velocity.length();
    this.maxHeight = this.position.y;
    this.updateTelemetry();
    this.telemetry.initialEnergy = this.telemetry.energy;
    this.telemetry.dissipatedEnergy = 0;
  }

  private evaluateForces(input: Controls, velocity: Vector3, omega: Vector3, orientation: Quaternion) {
    const inertia = this.aircraft.inertia;
    this.inverse.copy(orientation).invert();
    this.bodyVelocity.copy(velocity).applyQuaternion(this.inverse);
    const speed = velocity.length();
    this.torque.set(0, 0, 0);
    this.telemetry.force.set(0, 0, 0); this.telemetry.drag.set(0, 0, 0);
    let mainLift = 0, power = 0;
    for (const surface of this.surfaces) {
      this.arm.copy(surface.point).sub(this.aircraft.cg);
      this.localVelocity.crossVectors(omega, this.arm).add(this.bodyVelocity);
      const cl = evaluateSurface(surface, input, mainLift, this.aircraft.aspect, this.localVelocity, this.polar, this.liftDirection);
      if (surface.kind === 'main') mainLift += cl;
      // 升力与作用点局部来流正交；仅真实阻力贡献耗散功率。
      power += surface.drag.dot(this.localVelocity);
      this.cross.crossVectors(this.arm, surface.force); this.torque.add(this.cross);
      surface.force.applyQuaternion(orientation);
      surface.drag.applyQuaternion(orientation);
      this.telemetry.force.add(surface.force); this.telemetry.drag.add(surface.drag);
    }
    // 机身/乘员阻力作用于重心；分布翼面之外补充未解析尺度的动压角阻尼。
    this.localDrag.copy(velocity).multiplyScalar(-0.5 * AIR_DENSITY * speed * 0.28);
    this.telemetry.force.add(this.localDrag); this.telemetry.drag.add(this.localDrag);
    power += this.localDrag.dot(velocity);
    const damping = 0.25 * AIR_DENSITY * speed * this.aircraft.wingArea;
    this.cross.set(-damping * this.aircraft.span ** 2 * 0.015 * omega.x,
      -damping * this.aircraft.span ** 2 * 0.004 * omega.y,
      -damping * this.chord ** 2 * 0.15 * omega.z);
    power += this.cross.dot(omega); this.torque.add(this.cross);
    if (this.mode === 'assisted') {
      // 辅助只耗散角速度；不锁角度、不额外造升力、不增加能量。
      this.cross.set(-inertia.x * omega.x * 0.65, -inertia.y * omega.y * 0.35, -inertia.z * omega.z * 0.4);
      power += this.cross.dot(omega); this.torque.add(this.cross);
    }
    this.telemetry.aeroPower = power;
    this.telemetry.torque.copy(this.torque);
    // 相对重心来流分解实际全机合力，区别于轨迹滑翔比和构型最佳估值。
    const drag = speed > 1e-9 ? -this.telemetry.force.dot(velocity) / speed : 0;
    this.telemetry.liftDragRatio = drag > 1e-9
      ? Math.sqrt(Math.max(0, this.telemetry.force.lengthSq() - drag ** 2)) / drag : 0;
  }

  private integrateFlight(input: Controls, dt: number) {
    if (this.ended) return;
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
      this.evaluateForces(input, this.midpointVelocity, this.midpointOmega, this.midpointQuaternion);
      this.candidateVelocity.copy(this.previousVelocity).addScaledVector(this.telemetry.force, dt / (2 * mass));
      this.candidateVelocity.y -= GRAVITY * dt / 2;
      const w = this.midpointOmega;
      this.candidateOmega.set(
        this.previousOmega.x + dt / 2 * (this.torque.x + (inertia.y - inertia.z) * w.y * w.z) / inertia.x,
        this.previousOmega.y + dt / 2 * (this.torque.y + (inertia.z - inertia.x) * w.z * w.x) / inertia.y,
        this.previousOmega.z + dt / 2 * (this.torque.z + (inertia.x - inertia.y) * w.x * w.y) / inertia.z);
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
    // 使用积分实际采用的中点来流与姿态；只在收敛后汇总一次。
    this.aerodynamics.update(this.aircraft.cg, this.midpointQuaternion, this.midpointVelocity, this.torque);
    const speed = this.previousVelocity.length();
    this.velocity.copy(this.midpointVelocity).multiplyScalar(2).sub(this.previousVelocity);
    this.omega.copy(this.midpointOmega).multiplyScalar(2).sub(this.previousOmega);
    this.position.addScaledVector(this.midpointVelocity, dt);
    const angle = this.midpointOmega.length() * dt;
    if (angle > 0) {
      this.cross.copy(this.midpointOmega).normalize(); this.rotation.setFromAxisAngle(this.cross, angle);
      this.quaternion.multiply(this.rotation).normalize();
    }
    this.telemetry.dissipatedEnergy -= this.telemetry.aeroPower * dt;
    this.time += dt;
    const currentSpeed = this.velocity.length();
    this.travelled += (speed + currentSpeed) * 0.5 * dt;
    this.maxSpeed = Math.max(this.maxSpeed, currentSpeed); this.minSpeed = Math.min(this.minSpeed, currentSpeed);
    this.maxHeight = Math.max(this.maxHeight, this.position.y);
    this.updateTelemetry();
    let landing: FlightResult['landing'] | null = null;
    for (const point of this.contacts) {
      this.cross.copy(point).sub(this.aircraft.cg).applyQuaternion(this.quaternion).add(this.position);
      if (this.cross.x >= LAUNCH.startX && this.cross.x <= LAUNCH.endX && Math.abs(this.cross.z) <= 6.5 && this.cross.y <= LAUNCH.height) landing = 'platform';
      else if (this.cross.x >= -132.5 && this.cross.x <= -17.5 && Math.abs(this.cross.z) <= 90 && this.cross.y <= 8 && landing !== 'platform') landing = 'terrain';
      else if (this.cross.y <= 0 && !landing) landing = 'water';
    }
    if (landing) this.finish(landing);
    else if (Math.abs(this.position.x) >= 2000 || Math.abs(this.position.z) >= 800 || this.position.y >= 300) this.finish('boundary');
  }

  private updateTelemetry() {
    const t = this.telemetry;
    t.speed = this.velocity.length(); t.altitude = this.position.y;
    t.distance = this.launching ? 0 : Math.hypot(this.position.x - LAUNCH.endX, this.position.z);
    this.inverse.copy(this.quaternion).invert();
    this.bodyVelocity.copy(this.velocity).applyQuaternion(this.inverse);
    t.alpha = Math.atan2(-this.bodyVelocity.y, this.bodyVelocity.x) + this.definition.assembly.mainIncidence * DEG;
    this.cross.set(1, 0, 0).applyQuaternion(this.quaternion);
    t.pitch = Math.atan2(this.cross.y, Math.hypot(this.cross.x, this.cross.z));
    this.arm.set(0, 1, 0).applyQuaternion(this.quaternion);
    t.roll = Math.atan2(this.arm.z, this.arm.y);
    t.sink = -this.velocity.y;
    t.glide = t.sink > 0.05 ? Math.hypot(this.velocity.x, this.velocity.z) / t.sink : 0;
    t.stall = !this.launching && Math.abs(t.alpha + 2 * DEG) > 16 * DEG;
    t.mass = this.aircraft.mass; t.staticMargin = this.aircraft.staticMargin;
    const inertia = this.aircraft.inertia;
    t.potentialEnergy = this.aircraft.mass * GRAVITY * this.position.y;
    t.kineticEnergy = 0.5 * this.aircraft.mass * this.velocity.lengthSq()
      + 0.5 * (inertia.x * this.omega.x ** 2 + inertia.y * this.omega.y ** 2 + inertia.z * this.omega.z ** 2);
    t.energy = t.potentialEnergy + t.kineticEnergy;
  }

  private finish(landing: FlightResult['landing']) {
    this.ended = true;
    this.result = { distance: this.telemetry.distance, time: this.time, averageSpeed: this.travelled / this.time,
      maxSpeed: this.maxSpeed, minSpeed: this.minSpeed, maxHeight: this.maxHeight, landing };
  }
}
