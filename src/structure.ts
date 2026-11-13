import { Matrix3, Quaternion, Vector3 } from 'three';
import { AIRFRAME_MASS, finPoint, wingAirfoil, planform, wingLocalPoint, wingOrigin, type AircraftDefinition, type WingKey } from './model';
import { airfoilDepthScale, airfoilSkinScale } from './airfoils';
import { beamSection, materialCatalog } from './materials';

/** Small-rotation model limit, not a material failure angle. */
export const MAX_ELASTIC_ROTATION = 0.25;

export interface StructuralSurface {
  point: Vector3; normal: Vector3; spanDirection: Vector3; force: Vector3; moment: Vector3;
  chordDirection: Vector3; crossflowDirection: Vector3;
  kind: 'main' | 'tail' | 'vertical'; side: number; spanStart: number; spanEnd: number;
  area: number; chord: number; incidence: number; bodyId: number;
}
export interface StructureNode { span: number; position: Vector3; quaternion: Quaternion }
export interface StructureSection {
  id: number; wingKey: WingKey; side: number; spanStart: number; spanEnd: number; bodyId: number;
  /** Actual support joint: preceding strip, fin tip for a T-tail, or airframe. */
  parentId: number | null; depth: number;
  /** 实际安装局部舵角rad，已包含场景侧别方向；断片冻结。 */
  controlDeflection: number;
  root: StructureNode; tip: StructureNode; referenceRoot: Vector3; referenceTip: Vector3;
  crownIncidence: number; skinMass: number; sparLinearMass: number; sectionHeight: number;
  mass: number; center: Vector3; inertia: Matrix3; stress: number; stressRatio: number; yieldRatio: number;
  /** Consecutive overload, with one peak contribution per accepted 60 Hz tick. */
  fractureDamage: number; fractureDamageBase: number; fractureDamagePeak: number; fractureDamageTick: number;
  moment: Vector3; load: Vector3; surface: StructuralSurface;
  /** 基准在首次脱离后保留当时弯曲形状；自由断片没有虚构的机身夹持端。 */
  baseRoot: Vector3; baseTip: Vector3; baseRootRotation: Quaternion; baseTipRotation: Quaternion;
  referencePoint: Vector3; referenceNormal: Vector3; referenceSpan: Vector3;
  referenceChord: Vector3; referenceCrossflow: Vector3;
  chordAxis: Vector3; normalAxis: Vector3; beamAxis: Vector3;
  bendingStiffness: number; lateralStiffness: number; torsionalStiffness: number;
  normalStrength: number; shearStrength: number; elasticLimit: number;
  sectionArea: number;
  normalModulus: number; lateralModulus: number; torsionModulus: number;
}
export interface StructuralBody {
  id: number; position: Vector3; quaternion: Quaternion; velocity: Vector3; omega: Vector3;
  cg: Vector3; mass: number; inertiaTensor: Matrix3; inverseInertia: Matrix3;
}
/** Body-coordinate external force and its moment about the aircraft design origin. */
export interface SectionContactLoad { force: Vector3; moment: Vector3 }
interface SectionGeometry { root: Vector3; tip: Vector3; rootRotation: Quaternion; tipRotation: Quaternion }
export interface WingFragment extends StructuralBody {
  landed: boolean; force: Vector3; torque: Vector3; drag: Vector3; aeroPower: number;
  midpointVelocity: Vector3; midpointOmega: Vector3; midpointPosition: Vector3; midpointQuaternion: Quaternion;
  candidateVelocity: Vector3; candidateOmega: Vector3;
}

export function summarizeWingStructure(sections: readonly Pick<StructureSection, 'wingKey' | 'stressRatio' | 'yieldRatio' | 'bodyId'>[], wings = [
  { key: 'mainWing', name: '主翼', stress: 0, yieldRatio: 0, attached: 0, detached: 0 },
  { key: 'horizontalTail', name: '副翼', stress: 0, yieldRatio: 0, attached: 0, detached: 0 },
  { key: 'verticalTail', name: '垂直尾翼', stress: 0, yieldRatio: 0, attached: 0, detached: 0 },
]) {
 for (const wing of wings) wing.stress = wing.yieldRatio = wing.attached = wing.detached = 0;
 for (const section of sections) {
  const wing = wings[section.wingKey === 'mainWing' ? 0 : section.wingKey === 'horizontalTail' ? 1 : 2];
  wing.stress = Math.max(wing.stress, section.stressRatio);
  wing.yieldRatio = Math.max(wing.yieldRatio, section.yieldRatio);
  if (section.bodyId === 0) wing.attached++; else wing.detached++;
 }
 return wings;
}

/** 非对称断翼使用完整对称惯量张量；三个非对角项不可省略。 */
export function setInertia(out: Matrix3, ix: number, iy: number, iz: number, ixy = 0, ixz = 0, iyz = 0) {
  return out.set(ix, ixy, ixz, ixy, iy, iyz, ixz, iyz, iz);
}
export function rotationalEnergy(inertia: Matrix3, omega: Vector3) {
  const e = inertia.elements, x = omega.x, y = omega.y, z = omega.z;
  return (e[0] * x * x + e[4] * y * y + e[8] * z * z + 2 * (e[3] * x * y + e[6] * x * z + e[7] * y * z)) / 2;
}

export class WingStructure {
  readonly sections: StructureSection[];
  readonly peakWings = summarizeWingStructure([]);
  maxStressRatio = 0; maxYieldRatio = 0; maxDeflection = 0; fractureCount = 0;
  private readonly force = new Vector3();
  private readonly moment = new Vector3();
  private readonly totalLoad = new Vector3();
  private readonly sectionMoment = new Vector3();
  private readonly arm = new Vector3();
  private readonly acceleration = new Vector3();
  private readonly angularAcceleration = new Vector3();
  private readonly gravity = new Vector3();
  private readonly cross = new Vector3();
  private readonly rotationVector = new Vector3();
  private readonly displacement = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly inverse = new Quaternion();
  private readonly identity = new Quaternion();
  private readonly candidates: StructureSection[] = [];
  private readonly geometryBefore: SectionGeometry[];
  private readonly geometryAfter: SectionGeometry[];
  private readonly ordered: StructureSection[];
  private readonly owned: StructureSection[][];
  private readonly branchLoads: SectionContactLoad[];
  private readonly mountRotation = new Quaternion();
  private readonly mountDelta = new Quaternion();
  private readonly mountOrigin = new Vector3();
  private readonly mountTarget = new Vector3();
  private readonly curvature: Vector3[];
  private readonly branchRoot: Int32Array;
  private readonly geometryScale: Float64Array;
  private readonly frozenBudget: Float64Array;
  private readonly elasticBudget: Float64Array;
  private readonly budgetRotation = new Quaternion();

  constructor(readonly definition: AircraftDefinition, surfaces: StructuralSurface[]) {
    this.sections = surfaces.map((surface, id) => {
      const wingKey: WingKey = surface.kind === 'main' ? 'mainWing' : surface.kind === 'tail' ? 'horizontalTail' : 'verticalTail';
      const wing = definition[wingKey], vertical = wingKey === 'verticalTail', p = planform(wing, !vertical);
      const material = materialCatalog[wing.materialId], section = beamSection(wing.structure, wing.materialAmount, vertical ? 1 : airfoilDepthScale(wingAirfoil(definition, wingKey)));
      const origin = wingOrigin(definition, wingKey), incidence = surface.incidence;
      const reference = (span: number) => {
        const fraction = span / Math.abs(wing.points[1].y);
        const quarter = wing.points[0].x + (wing.points[1].x - wing.points[0].x) * fraction + (p.root + (p.tip - p.root) * fraction) / 4;
        if (vertical) return finPoint(definition, span, 0.25, 0, new Vector3());
        const point = wingLocalPoint(wing, incidence, surface.side, -quarter, 0, span, new Vector3());
        point.x += origin.x; point.y += origin.y;
        return point;
      };
      const referenceRoot = reference(surface.spanStart), referenceTip = reference(surface.spanEnd);
      const beamAxis = referenceTip.clone().sub(referenceRoot).normalize();
      const chordAxis = surface.chordDirection.clone();
      chordAxis.addScaledVector(beamAxis, -chordAxis.dot(beamAxis)).normalize();
      const normalAxis = new Vector3().crossVectors(beamAxis, chordAxis).normalize();
      const length = referenceRoot.distanceTo(referenceTip);
      const skinMass = surface.area * (wingKey === 'mainWing' ? AIRFRAME_MASS.mainArea : AIRFRAME_MASS.tailArea) * (vertical ? 1 : airfoilSkinScale(wingAirfoil(definition, wingKey)));
      const sparMass = material.density * section.area * length, mass = skinMass + sparMass;
      const center = surface.point.clone().addScaledVector(chordAxis, -surface.chord / 4);
      // 均匀条带质量代理；梁/蒙皮质量真实分段，惯量固定在参考几何，见 update 的准静态说明。
      const inertia = new Matrix3();
      const axes = [chordAxis, normalAxis, beamAxis];
      const variances = [surface.chord ** 2 / 12, section.height ** 2 / 12, length ** 2 / 12];
      const covariance = new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
      for (let a = 0; a < 3; a++) for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) covariance.elements[col * 3 + row] += mass * variances[a] * axes[a].getComponent(row) * axes[a].getComponent(col);
      const c = covariance.elements, trace = c[0] + c[4] + c[8];
      setInertia(inertia, trace - c[0], trace - c[4], trace - c[8], -c[3], -c[6], -c[7]);
      const innerWidth = section.width - section.wallThickness;
      const innerHeight = section.height - section.wallThickness;
      // 翼型厚度缩放等效梁深度，蒙皮按外形周长缩放；仍非可制造性校验。
      return { id, wingKey, side: surface.side, spanStart: surface.spanStart, spanEnd: surface.spanEnd, bodyId: 0, parentId: null, depth: 0,
        root: { span: surface.spanStart, position: referenceRoot.clone(), quaternion: new Quaternion() },
        tip: { span: surface.spanEnd, position: referenceTip.clone(), quaternion: new Quaternion() },
        referenceRoot, referenceTip, crownIncidence: definition.assembly.tailIncidence, skinMass, sparLinearMass: material.density * section.area, sectionHeight: section.height, mass, center, inertia, stress: 0, stressRatio: 0, yieldRatio: 0,
        fractureDamage: 0, fractureDamageBase: 0, fractureDamagePeak: 0, fractureDamageTick: 0,
        moment: new Vector3(), load: new Vector3(), surface, controlDeflection: 0,
        baseRoot: referenceRoot.clone(), baseTip: referenceTip.clone(), baseRootRotation: new Quaternion(), baseTipRotation: new Quaternion(),
        referencePoint: surface.point.clone(), referenceNormal: surface.normal.clone(), referenceSpan: surface.spanDirection.clone(),
        referenceChord: surface.chordDirection.clone(), referenceCrossflow: surface.crossflowDirection.clone(),
        chordAxis, normalAxis, beamAxis,
        bendingStiffness: material.youngModulus * section.secondMoment,
        lateralStiffness: material.youngModulus * section.lateralSecondMoment,
        torsionalStiffness: material.shearModulus * section.torsionConstant,
        normalStrength: Math.min(material.ultimateStrength, material.compressiveStrength), shearStrength: material.shearStrength,
        elasticLimit: material.yieldStrength,
        normalModulus: section.secondMoment / (section.height / 2),
        lateralModulus: section.lateralSecondMoment / (section.width / 2),
        sectionArea: section.area,
        torsionModulus: 2 * innerWidth * innerHeight * section.wallThickness };
    });
    const geometry = () => this.sections.map(() => ({ root: new Vector3(), tip: new Vector3(), rootRotation: new Quaternion(), tipRotation: new Quaternion() }));
    this.geometryBefore = geometry(); this.geometryAfter = geometry();
    const finTip = this.sections.filter(s => s.wingKey === 'verticalTail').at(-1);
    for (const s of this.sections) {
      const inner = this.sections.find(other => other.wingKey === s.wingKey && other.side === s.side && other.spanEnd === s.spanStart);
      s.parentId = inner?.id ?? (definition.assembly.tailOnFin && s.wingKey === 'horizontalTail' ? finTip?.id ?? null : null);
    }
    for (const s of this.sections) for (let parent = this.parent(s); parent; parent = this.parent(parent)) s.depth++;
    this.ordered = [...this.sections].sort((a, b) => a.depth - b.depth || a.id - b.id);
    this.owned = [this.sections.slice()];
    this.branchLoads = this.sections.map(() => ({ force: new Vector3(), moment: new Vector3() }));
    this.curvature = this.sections.map(() => new Vector3());
    this.branchRoot = new Int32Array(this.sections.length);
    this.geometryScale = new Float64Array(this.sections.length);
    this.frozenBudget = new Float64Array(this.sections.length);
    this.elasticBudget = new Float64Array(this.sections.length);
  }

  syncFinGeometry() {
    const d = this.definition, scratch = this.arm;
    for (const s of this.sections) {
      if (s.wingKey !== 'verticalTail' || s.bodyId !== 0) continue;
      finPoint(d, s.spanStart, 0.25, 0, scratch);
      this.displacement.copy(scratch).sub(s.referenceRoot);
      s.referenceRoot.copy(scratch); s.baseRoot.add(this.displacement); s.root.position.add(this.displacement);
      finPoint(d, s.spanEnd, 0.25, 0, scratch);
      this.displacement.copy(scratch).sub(s.referenceTip);
      s.referenceTip.copy(scratch); s.baseTip.add(this.displacement); s.tip.position.add(this.displacement);
      const w = d.verticalTail, p = planform(w, false), half = Math.abs(w.points[1].y);
      const a = p.root + (p.tip - p.root) * s.spanStart / half, b = p.root + (p.tip - p.root) * s.spanEnd / half;
      const span = s.spanStart + (s.spanEnd - s.spanStart) * (a + 2 * b) / (3 * (a + b));
      finPoint(d, span, 0.25, 0, s.referencePoint);
      s.beamAxis.subVectors(s.referenceTip, s.referenceRoot).normalize();
      s.chordAxis.copy(s.referenceChord).addScaledVector(s.beamAxis, -s.referenceChord.dot(s.beamAxis)).normalize();
      s.normalAxis.crossVectors(s.beamAxis, s.chordAxis).normalize();
      const length = s.referenceRoot.distanceTo(s.referenceTip);
      s.mass = s.skinMass + s.sparLinearMass * length;
      s.center.copy(s.referencePoint).addScaledVector(s.chordAxis, -s.surface.chord / 4);
      s.inertia.set(0, 0, 0, 0, 0, 0, 0, 0, 0);
      const axes = [s.chordAxis, s.normalAxis, s.beamAxis];
      const variances = [s.surface.chord ** 2 / 12, s.sectionHeight ** 2 / 12, length ** 2 / 12];
      for (let k = 0; k < 3; k++) for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
        s.inertia.elements[col * 3 + row] += s.mass * variances[k] * ((row === col ? 1 : 0) - axes[k].getComponent(row) * axes[k].getComponent(col));
      }
      s.crownIncidence = d.assembly.tailIncidence;
    }
  }

  sectionsForBody(id: number): readonly StructureSection[] { return this.owned[id] ?? []; }
  private parent(s: StructureSection) { return s.parentId === null ? undefined : this.sections[s.parentId]; }
  private supportedBy(s: StructureSection, root: StructureSection): boolean {
    for (let node: StructureSection | undefined = s; node; node = this.parent(node)) if (node === root) return true;
    return false;
  }

  reset() {
    this.owned.length = 1; this.owned[0] = this.sections.slice();
    this.maxStressRatio = 0; this.maxYieldRatio = 0; this.maxDeflection = 0; this.fractureCount = 0;
    for (const wing of this.peakWings) wing.stress = wing.yieldRatio = 0;
    for (const s of this.sections) {
      s.bodyId = s.surface.bodyId = 0; s.stress = s.stressRatio = s.yieldRatio = s.controlDeflection = 0;
      s.fractureDamage = s.fractureDamageBase = s.fractureDamagePeak = s.fractureDamageTick = 0;
      s.moment.set(0, 0, 0); s.load.set(0, 0, 0);
      s.root.position.copy(s.referenceRoot); s.tip.position.copy(s.referenceTip);
      s.baseRoot.copy(s.referenceRoot); s.baseTip.copy(s.referenceTip);
      s.root.quaternion.identity(); s.tip.quaternion.identity(); s.baseRootRotation.identity(); s.baseTipRotation.identity();
      s.surface.point.copy(s.referencePoint); s.surface.normal.copy(s.referenceNormal); s.surface.spanDirection.copy(s.referenceSpan);
      s.surface.chordDirection.copy(s.referenceChord); s.surface.crossflowDirection.copy(s.referenceCrossflow);
    }
  }

  /**
   * ponytail: 分段 Euler–Bernoulli 双向弯曲 + Saint-Venant 扭转，准静态、小应变工程代理，非真实颤振/塑性/疲劳。
   * 只在已接受步更新，下一步冻结几何；不在中点求力迭代提交拓扑。
   * 质量和惯量保留参考几何，不把无质量气动形状偏移伪装成弹性动能/势能，也不登记虚构结构耗散。
   * 需真实弹性能/振型时，应整体替换为含节点质量的能量一致梁积分，而不是修补耗散账本。
   */
  private measureStress(body: StructuralBody, totalForce: Vector3, totalTorque: Vector3, commit: boolean, contacts?: readonly SectionContactLoad[]) {
    let maximum = 0;
    this.inverse.copy(body.quaternion).invert();
    this.gravity.set(0, -9.81, 0).applyQuaternion(this.inverse);
    this.acceleration.copy(totalForce).applyQuaternion(this.inverse).multiplyScalar(1 / body.mass).add(this.gravity);
    this.angularAcceleration.copy(body.omega).applyMatrix3(body.inertiaTensor);
    this.cross.crossVectors(body.omega, this.angularAcceleration);
    this.angularAcceleration.copy(totalTorque).sub(this.cross).applyMatrix3(body.inverseInertia);
    // Compute each strip's load once, then transmit the wrench up the actual
    // support tree. This includes both T-tail halves in the fin's load path.
    for (const s of this.sectionsForBody(body.id)) {
      this.arm.copy(s.center).sub(body.cg);
      this.force.crossVectors(this.angularAcceleration, this.arm);
      this.cross.crossVectors(body.omega, this.arm);
      this.force.add(this.moment.crossVectors(body.omega, this.cross)).add(this.acceleration);
      this.force.sub(this.gravity).multiplyScalar(-s.mass);
      const load = this.branchLoads[s.id];
      load.force.copy(this.force); load.moment.crossVectors(s.center, this.force);
      this.force.copy(this.angularAcceleration).applyMatrix3(s.inertia);
      this.cross.copy(body.omega).applyMatrix3(s.inertia);
      load.moment.sub(this.force.add(this.moment.crossVectors(body.omega, this.cross)));
      this.force.copy(s.surface.force).applyQuaternion(this.inverse);
      load.force.add(this.force); load.moment.add(this.moment.crossVectors(s.surface.point, this.force));
      load.moment.add(this.moment.copy(s.surface.moment).applyQuaternion(this.inverse));
      if (contacts) { load.force.add(contacts[s.id].force); load.moment.add(contacts[s.id].moment); }
      if (commit) s.load.copy(load.force);
    }
    for (let i = this.ordered.length - 1; i >= 0; i--) {
      const s = this.ordered[i]; if (s.bodyId !== body.id) continue;
      const load = this.branchLoads[s.id], parent = this.parent(s);
      if (parent?.bodyId === body.id) {
        this.branchLoads[parent.id].force.add(load.force); this.branchLoads[parent.id].moment.add(load.moment);
      }
      this.totalLoad.copy(load.force);
      this.sectionMoment.copy(load.moment).sub(this.moment.crossVectors(s.root.position, load.force));
      const bending = Math.abs(this.sectionMoment.dot(s.chordAxis)) / s.normalModulus + Math.abs(this.sectionMoment.dot(s.normalAxis)) / s.lateralModulus
        + Math.abs(this.totalLoad.dot(s.beamAxis)) / s.sectionArea;
      const shear = Math.abs(this.sectionMoment.dot(s.beamAxis)) / s.torsionModulus
        + Math.hypot(this.totalLoad.dot(s.chordAxis), this.totalLoad.dot(s.normalAxis)) / s.sectionArea;
      const stressRatio = Math.hypot(bending / s.normalStrength, shear / s.shearStrength);
      maximum = Math.max(maximum, stressRatio);
      if (commit) {
        s.moment.copy(this.sectionMoment);
        s.stress = Math.hypot(bending, Math.sqrt(3) * shear);
        s.stressRatio = stressRatio;
        s.yieldRatio = s.stress / s.elasticLimit;
        const peak = this.peakWings[s.wingKey === 'mainWing' ? 0 : s.wingKey === 'horizontalTail' ? 1 : 2];
        peak.stress = Math.max(peak.stress, s.stressRatio);
        peak.yieldRatio = Math.max(peak.yieldRatio, s.yieldRatio);
      }
    }
    return maximum;
  }

  /** 与接受步共用载荷和失效公式，不提交形变、峰值或断裂。 */
  predictStress(body: StructuralBody, totalForce: Vector3, totalTorque: Vector3) {
    return this.measureStress(body, totalForce, totalTorque, false);
  }

  measureLoads(body: StructuralBody, totalForce: Vector3, totalTorque: Vector3, contacts?: readonly SectionContactLoad[]): number {
    return this.measureStress(body, totalForce, totalTorque, true, contacts);
  }

  update(body: StructuralBody, totalForce: Vector3, totalTorque: Vector3, contacts?: readonly SectionContactLoad[]) {
    this.measureLoads(body, totalForce, totalTorque, contacts);
    this.updateGeometry(body.id);
  }

  updateGeometry(bodyId: number): void {
    for (const s of this.sectionsForBody(bodyId)) this.saveGeometry(s, this.geometryBefore[s.id]);
    this.fillRotationBudgets(true, this.frozenBudget);
    for (const s of this.ordered) {
      if (s.bodyId !== bodyId) continue;
      const parent = this.parent(s), connected = parent?.bodyId === bodyId;
      const root = connected ? this.branchRoot[parent.id] : s.id;
      this.branchRoot[s.id] = root;
      if (!connected) this.geometryScale[root] = 1;
      const curvature = this.curvature[s.id].copy(s.chordAxis).multiplyScalar(s.moment.dot(s.chordAxis) / s.bendingStiffness)
        .addScaledVector(s.normalAxis, s.moment.dot(s.normalAxis) / s.lateralStiffness)
        .addScaledVector(s.beamAxis, s.moment.dot(s.beamAxis) / s.torsionalStiffness);
      const budget = (connected ? this.elasticBudget[parent.id] : 0)
        + curvature.length() * s.referenceRoot.distanceTo(s.referenceTip);
      this.elasticBudget[s.id] = budget;
      // One scale for the full support branch, including both fin-mounted tails.
      this.geometryScale[root] = Math.min(this.geometryScale[root],
        1 / Math.max(1, s.stressRatio), 1 / Math.max(1, s.yieldRatio),
        budget > 0 ? Math.max(0, MAX_ELASTIC_ROTATION - this.frozenBudget[s.id]) / budget : 1);
    }
    // 按每个连续拥有者从内到外积分，不跨断口。自由片首端保留断裂形状，但不把自由端作为断裂连接。
    for (const first of this.sections) {
      if (first.bodyId !== bodyId || this.hasInnerSection(first)) continue;
      this.rotationVector.set(0, 0, 0); this.displacement.set(0, 0, 0);
      for (const s of this.sections) {
        if (s.bodyId !== bodyId || s.wingKey !== first.wingKey || s.side !== first.side) continue;
        const length = s.referenceRoot.distanceTo(s.referenceTip);
        s.root.position.copy(s.baseRoot).add(this.displacement);
        this.setRotation(s.root.quaternion, this.rotationVector, s.baseRootRotation);
        this.cross.copy(this.curvature[s.id]).multiplyScalar(this.geometryScale[this.branchRoot[s.id]]);
        this.arm.copy(this.rotationVector).addScaledVector(this.cross, length / 2);
        this.setRotation(this.rotation, this.arm, this.identity);
        this.arm.copy(s.baseTip).sub(s.baseRoot).applyQuaternion(this.rotation);
        this.displacement.add(this.arm).sub(this.arm.copy(s.baseTip).sub(s.baseRoot));
        this.rotationVector.addScaledVector(this.cross, length);
        s.tip.position.copy(s.baseTip).add(this.displacement);
        this.setRotation(s.tip.quaternion, this.rotationVector, s.baseTipRotation);
        this.syncSurface(s);
      }
    }
    this.alignTailRoots(bodyId);
    for (const s of this.sectionsForBody(bodyId)) this.saveGeometry(s, this.geometryAfter[s.id]);
  }

  private relativeRotation(a: Quaternion, b: Quaternion) {
    this.budgetRotation.copy(a).invert().multiply(b);
    const q = this.budgetRotation;
    return 2 * Math.atan2(Math.hypot(q.x, q.y, q.z), Math.abs(q.w));
  }

  /** Same root-to-leaf budget for frozen bases, submitted nodes and shape limits.
   * Node quaternions contain elastic rotation only; rigid T-tail mounting is in
   * reference geometry. A detached root retains its inherited elastic angle. */
  private fillRotationBudgets(base: boolean, out: Float64Array) {
    for (const s of this.ordered) {
      const parent = this.parent(s), connected = parent?.bodyId === s.bodyId;
      const root = base ? s.baseRootRotation : s.root.quaternion;
      const tip = base ? s.baseTipRotation : s.tip.quaternion;
      const support = connected ? (base ? parent.baseTipRotation : parent.tip.quaternion) : this.identity;
      out[s.id] = (connected ? out[parent.id] : 0)
        + this.relativeRotation(support, root) + this.relativeRotation(root, tip);
    }
  }

  /** Replay validation includes both frozen and current geometry, across owners. */
  rotationBudgetValid(): boolean {
    this.fillRotationBudgets(true, this.frozenBudget);
    this.fillRotationBudgets(false, this.elasticBudget);
    for (const s of this.sections) {
      const frozen = this.frozenBudget[s.id], current = this.elasticBudget[s.id];
      if (!Number.isFinite(frozen) || !Number.isFinite(current)
        || frozen > MAX_ELASTIC_ROTATION + 1e-9 || current > MAX_ELASTIC_ROTATION + 1e-9) return false;
    }
    return true;
  }

  /** The mounted tail's reference offset follows the fin tip's full rotation. */
  private alignTailRoots(bodyId: number) {
    if (!this.definition.assembly.tailOnFin) return;
    for (const first of this.sectionsForBody(bodyId)) {
      if (first.wingKey !== 'horizontalTail' || this.hasInnerSection(first)) continue;
      const parent = this.parent(first); if (parent?.bodyId !== bodyId) continue;
      this.mountRotation.copy(parent.baseTipRotation).invert().premultiply(parent.tip.quaternion);
      this.mountTarget.copy(first.baseRoot).sub(parent.baseTip).applyQuaternion(this.mountRotation).add(parent.tip.position);
      this.mountOrigin.copy(first.root.position);
      this.mountDelta.copy(first.root.quaternion).invert().premultiply(this.rotation.copy(this.mountRotation).multiply(first.baseRootRotation));
      for (const s of this.sectionsForBody(bodyId)) if (s.wingKey === first.wingKey && s.side === first.side) {
        s.root.position.sub(this.mountOrigin).applyQuaternion(this.mountDelta).add(this.mountTarget);
        s.tip.position.sub(this.mountOrigin).applyQuaternion(this.mountDelta).add(this.mountTarget);
        s.root.quaternion.premultiply(this.mountDelta); s.tip.quaternion.premultiply(this.mountDelta);
        this.syncSurface(s);
      }
    }
  }

  private saveGeometry(s: StructureSection, out: SectionGeometry) {
    out.root.copy(s.root.position); out.tip.copy(s.tip.position);
    out.rootRotation.copy(s.root.quaternion); out.tipRotation.copy(s.tip.quaternion);
  }

  private syncSurface(s: StructureSection) {
    this.rotation.copy(s.root.quaternion).slerp(s.tip.quaternion, 0.5);
    this.arm.copy(s.referenceRoot).lerp(s.referenceTip, 0.5);
    s.surface.point.copy(s.referencePoint).sub(this.arm).applyQuaternion(this.rotation);
    s.surface.point.addScaledVector(s.root.position, 0.5).addScaledVector(s.tip.position, 0.5);
    s.surface.normal.copy(s.referenceNormal).applyQuaternion(this.rotation);
    s.surface.spanDirection.copy(s.referenceSpan).applyQuaternion(this.rotation);
    s.surface.chordDirection.copy(s.referenceChord).applyQuaternion(this.rotation);
    s.surface.crossflowDirection.copy(s.referenceCrossflow).applyQuaternion(this.rotation);
  }

  /** Restrict a massless elastic shape change at a solid boundary, retaining
   * joint continuity and the full measured stress used for fracture decisions. */
  blendContactGeometry(wingKey: WingKey, side: number, fraction: number) {
    for (const s of this.sections) {
      if (s.bodyId !== 0 || !this.branchContains(s, wingKey, side)) continue;
      const a = this.geometryBefore[s.id], b = this.geometryAfter[s.id];
      s.root.position.copy(a.root).lerp(b.root, fraction); s.tip.position.copy(a.tip).lerp(b.tip, fraction);
      s.root.quaternion.copy(a.rootRotation).slerp(b.rootRotation, fraction);
      s.tip.quaternion.copy(a.tipRotation).slerp(b.tipRotation, fraction);
      this.syncSurface(s);
    }
    this.alignTailRoots(0);
  }

  branchContains(s: StructureSection, wingKey: WingKey, side: number) {
    for (let node: StructureSection | undefined = s; node && node.bodyId === s.bodyId; node = this.parent(node)) {
      if (node.wingKey === wingKey && node.side === side) return true;
    }
    return false;
  }

  private hasInnerSection(section: StructureSection) {
    for (const inner of this.sections) {
      if (inner.bodyId === section.bodyId && inner.wingKey === section.wingKey && inner.side === section.side && inner.spanStart < section.spanStart) return true;
    }
    return false;
  }

  private setRotation(out: Quaternion, vector: Vector3, base: Quaternion) {
    const angle = vector.length();
    if (angle > 1e-14) out.setFromAxisAngle(this.arm.copy(vector).multiplyScalar(1 / angle), angle).multiply(base);
    else out.copy(base);
  }

  /** Accepted loads only. Remeasurements replace this tick's contribution, never add another. */
  accumulateFractureDamage(bodyId: number, tick: number) {
    for (const s of this.sectionsForBody(bodyId)) {
      if (s.fractureDamageTick !== tick) {
        s.fractureDamageBase = s.fractureDamage;
        s.fractureDamagePeak = 0;
        s.fractureDamageTick = tick;
      }
      if (s.stressRatio < 1 || bodyId !== 0 && this.parent(s)?.bodyId !== bodyId) {
        s.fractureDamage = s.fractureDamageBase = s.fractureDamagePeak = 0;
        continue;
      }
      s.fractureDamagePeak = Math.max(s.fractureDamagePeak, Math.min(1, Math.max(0.2, s.stressRatio / 5)));
      s.fractureDamage = Math.min(1, s.fractureDamageBase + s.fractureDamagePeak);
    }
  }

  /** Only the most overloaded mature real joint; callers must remeasure after a cut. */
  fractureCandidates(bodyId: number) {
    const result = this.candidates;
    result.length = 0;
    for (const s of this.sections) {
      if (s.bodyId !== bodyId || s.stressRatio < 1 || s.fractureDamage < 1) continue;
      if (bodyId !== 0 && this.parent(s)?.bodyId !== bodyId) continue;
      if (!result.length || s.stressRatio > result[0].stressRatio
        || (s.stressRatio === result[0].stressRatio && s.id < result[0].id)) result[0] = s;
    }
    return result;
  }

  detach(boundary: StructureSection, id: number) {
    const previous = boundary.bodyId;
    const detached: StructureSection[] = [], retained: StructureSection[] = [];
    for (const s of this.sectionsForBody(previous)) if (this.supportedBy(s, boundary)) {
      detached.push(s);
      s.bodyId = s.surface.bodyId = id;
      s.baseRoot.copy(s.root.position); s.baseTip.copy(s.tip.position);
      s.baseRootRotation.copy(s.root.quaternion); s.baseTipRotation.copy(s.tip.quaternion);
    } else retained.push(s);
    this.owned[previous] = retained; this.owned[id] = detached;
    boundary.fractureDamage = boundary.fractureDamageBase = boundary.fractureDamagePeak = 0;
    this.fractureCount++;
  }

  summarize() {
    this.maxStressRatio = this.maxYieldRatio = this.maxDeflection = 0;
    for (const s of this.sections) {
      this.maxStressRatio = Math.max(this.maxStressRatio, s.stressRatio);
      this.maxYieldRatio = Math.max(this.maxYieldRatio, s.yieldRatio);
      this.maxDeflection = Math.max(this.maxDeflection, s.root.position.distanceTo(s.referenceRoot), s.tip.position.distanceTo(s.referenceTip));
    }
  }
}
