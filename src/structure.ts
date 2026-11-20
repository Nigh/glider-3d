import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { AIRFRAME_MASS, wingInstanceAirfoil, wingInstancePoint, wingInstanceWing, planform, type AircraftDefinition, type WingKey } from './model';
import { airfoilDepthScale, airfoilSkinScale } from './airfoils';
import { beamSection, materialCatalog } from './materials';
import type { CompiledAttachmentSpan } from './compiled-geometry-cache';

/** Small-rotation model limit, not a material failure angle. */
export const MAX_ELASTIC_ROTATION = 0.25;

export interface StructuralSurface {
  point: Vector3; normal: Vector3; spanDirection: Vector3; force: Vector3; moment: Vector3;
  chordDirection: Vector3; crossflowDirection: Vector3; controlPoint: Vector3;
  kind: 'main' | 'tail' | 'vertical'; side: number; spanStart: number; spanEnd: number;
  wingInstance: number;
  area: number; chord: number; incidence: number; bodyId: number;
  controlEffectiveness: number;
}
export interface StructureNode { span: number; position: Vector3; quaternion: Quaternion }
export interface StructureSection {
  id: number; wingKey: WingKey; wingInstance: number; side: number; spanStart: number; spanEnd: number; bodyId: number;
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
  referenceChord: Vector3; referenceCrossflow: Vector3; referenceControlPoint: Vector3;
  attachmentBodyStart: number; attachmentBodyEnd: number;
  attachmentJointStart: number; attachmentJointEnd: number; attachmentAnchorId: number;
  /** A severed installation keeps its release frame in its own rigid body's coordinates. */
  attachmentFrozen: boolean; attachmentReference: Vector3; attachmentPosition: Vector3; attachmentRotation: Quaternion;
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
export interface SectionGeometry { root: Vector3; tip: Vector3; rootRotation: Quaternion; tipRotation: Quaternion }
const deformationPointMatrix = new Matrix4(), deformationUnitScale = new Vector3(1, 1, 1);
function attachmentWeight(span: number, start: number, end: number): number {
  if (start < 0) return 0;
  const distance = Math.max(start - span, span - end, 0), weight = Math.max(0, 1 - distance / 0.8);
  return weight * weight * (3 - 2 * weight);
}
export interface WingFragment extends StructuralBody {
  landed: boolean; force: Vector3; torque: Vector3; drag: Vector3; aeroPower: number;
  midpointVelocity: Vector3; midpointOmega: Vector3; midpointPosition: Vector3; midpointQuaternion: Quaternion;
  candidateVelocity: Vector3; candidateOmega: Vector3;
}

export function summarizeWingStructure(sections: readonly Pick<StructureSection, 'wingKey' | 'stressRatio' | 'yieldRatio' | 'bodyId'>[], wings = [
  { key: 'mainWing', name: '主翼', stress: 0, yieldRatio: 0, attached: 0, detached: 0 },
  { key: 'horizontalTail', name: '水平辅助翼', stress: 0, yieldRatio: 0, attached: 0, detached: 0 },
  { key: 'verticalTail', name: '垂直辅助翼', stress: 0, yieldRatio: 0, attached: 0, detached: 0 },
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
  private readonly shapeRotation = new Quaternion();
  private readonly shapeReference = new Vector3();
  private readonly shapeRootTangent = new Vector3();
  private readonly shapeTipTangent = new Vector3();
  private readonly shapeCenter = new Vector3();
  private readonly shapeTranslation = new Vector3();
  private readonly shapeAnchorReference = new Vector3();
  private readonly shapeAnchorPosition = new Vector3();
  private readonly shapeAnchorRotation = new Quaternion();
  private readonly shapeAnchorCenter = new Vector3();

  constructor(readonly definition: AircraftDefinition, surfaces: StructuralSurface[]) {
    this.sections = surfaces.map((surface, id) => {
      const wingKey: WingKey = surface.kind === 'main' ? 'mainWing' : surface.kind === 'tail' ? 'horizontalTail' : 'verticalTail';
      const wing = wingInstanceWing(definition, surface.wingInstance), vertical = wingKey === 'verticalTail';
      const airfoil = wingInstanceAirfoil(definition, surface.wingInstance);
      const material = materialCatalog[wing.materialId], section = beamSection(wing.structure, wing.materialAmount, vertical ? 1 : airfoilDepthScale(airfoil));
      const reference = (span: number) => wingInstancePoint(definition, surface.wingInstance, surface.side, span, 0.25, 0, new Vector3());
      const referenceRoot = reference(surface.spanStart), referenceTip = reference(surface.spanEnd);
      const beamAxis = referenceTip.clone().sub(referenceRoot).normalize();
      const chordAxis = surface.chordDirection.clone();
      chordAxis.addScaledVector(beamAxis, -chordAxis.dot(beamAxis)).normalize();
      const normalAxis = new Vector3().crossVectors(beamAxis, chordAxis).normalize();
      const length = referenceRoot.distanceTo(referenceTip);
      const skinMass = surface.area * (wingKey === 'mainWing' ? AIRFRAME_MASS.mainArea : AIRFRAME_MASS.tailArea) * (vertical ? 1 : airfoilSkinScale(airfoil));
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
      return { id, wingKey, wingInstance: surface.wingInstance, side: surface.side, spanStart: surface.spanStart, spanEnd: surface.spanEnd, bodyId: 0, parentId: null, depth: 0,
        root: { span: surface.spanStart, position: referenceRoot.clone(), quaternion: new Quaternion() },
        tip: { span: surface.spanEnd, position: referenceTip.clone(), quaternion: new Quaternion() },
        referenceRoot, referenceTip, crownIncidence: definition.assembly.tailIncidence, skinMass, sparLinearMass: material.density * section.area, sectionHeight: section.height, mass, center, inertia, stress: 0, stressRatio: 0, yieldRatio: 0,
        fractureDamage: 0, fractureDamageBase: 0, fractureDamagePeak: 0, fractureDamageTick: 0,
        moment: new Vector3(), load: new Vector3(), surface, controlDeflection: 0,
        baseRoot: referenceRoot.clone(), baseTip: referenceTip.clone(), baseRootRotation: new Quaternion(), baseTipRotation: new Quaternion(),
        referencePoint: surface.point.clone(), referenceNormal: surface.normal.clone(), referenceSpan: surface.spanDirection.clone(),
        referenceChord: surface.chordDirection.clone(), referenceCrossflow: surface.crossflowDirection.clone(), referenceControlPoint: surface.controlPoint.clone(),
        attachmentBodyStart: -1, attachmentBodyEnd: -1, attachmentJointStart: -1, attachmentJointEnd: -1, attachmentAnchorId: -1,
        attachmentFrozen: false, attachmentReference: new Vector3(), attachmentPosition: new Vector3(), attachmentRotation: new Quaternion(),
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
    const finTip = this.sections.filter(s => s.wingInstance === 2 && s.side === 1).at(-1);
    for (const s of this.sections) {
      const inner = this.sections.find(other => other.wingInstance === s.wingInstance && other.side === s.side && other.spanEnd === s.spanStart);
      s.parentId = inner?.id ?? (definition.assembly.tailOnFin && s.wingInstance === 1 ? finTip?.id ?? null : null);
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

  setAttachmentSpans(spans: readonly CompiledAttachmentSpan[]) {
    for (const s of this.sections) if (s.bodyId === 0) {
      s.attachmentBodyStart = s.attachmentBodyEnd = s.attachmentJointStart = s.attachmentJointEnd = s.attachmentAnchorId = -1;
    }
    for (const span of spans) {
      const anchor = span.anchorWingInstance < 0 ? undefined : this.sections.find(section => section.wingInstance === span.anchorWingInstance
        && section.side === span.anchorSide && Math.abs(section.spanEnd - span.anchorSpan) < 1e-7);
      for (const s of this.sections) {
        if (s.bodyId !== 0 || s.wingInstance !== span.wingInstance || s.side !== span.side) continue;
        if (span.anchorWingInstance < 0) {
          s.attachmentBodyStart = s.attachmentBodyStart < 0 ? span.spanStart : Math.min(s.attachmentBodyStart, span.spanStart);
          s.attachmentBodyEnd = Math.max(s.attachmentBodyEnd, span.spanEnd);
        } else {
          s.attachmentAnchorId = anchor!.id;
          s.attachmentJointStart = s.attachmentJointStart < 0 ? span.spanStart : Math.min(s.attachmentJointStart, span.spanStart);
          s.attachmentJointEnd = Math.max(s.attachmentJointEnd, span.spanEnd);
        }
      }
    }
  }

  /** -2 is a blended/free row; other IDs identify one exact common rigid map. */
  attachmentAnchor(s: StructureSection, span: number): number {
    if (attachmentWeight(span, s.attachmentBodyStart, s.attachmentBodyEnd) === 1) return -1;
    return attachmentWeight(span, s.attachmentJointStart, s.attachmentJointEnd) === 1 ? s.attachmentAnchorId : -2;
  }

  attachmentFreeWeight(s: StructureSection, spanStart: number, spanEnd: number): number {
    spanStart = Math.max(s.spanStart, Math.min(s.spanEnd, spanStart));
    spanEnd = Math.max(s.spanStart, Math.min(s.spanEnd, spanEnd));
    return 1 - Math.min(attachmentWeight(spanStart, s.attachmentBodyStart, s.attachmentBodyEnd),
      attachmentWeight(spanEnd, s.attachmentBodyStart, s.attachmentBodyEnd));
  }

  private setAttachmentAnchorFrame(s: StructureSection, geometry?: readonly SectionGeometry[]) {
    if (s.attachmentFrozen) {
      this.shapeAnchorReference.copy(s.attachmentReference); this.shapeAnchorPosition.copy(s.attachmentPosition);
      this.shapeAnchorRotation.copy(s.attachmentRotation); return;
    }
    const anchor = this.sections[s.attachmentAnchorId], frame = geometry?.[anchor.id];
    this.shapeAnchorReference.copy(anchor.referenceTip);
    this.shapeAnchorPosition.copy(frame?.tip ?? anchor.tip.position);
    this.shapeAnchorRotation.copy(frame?.tipRotation ?? anchor.tip.quaternion);
    // A short connector whose two fixed regions meet has no free skin between
    // them. Its tip installation shares the body's frame rather than fighting it.
    const bodyWeight = anchor.attachmentBodyStart >= 0 && anchor.attachmentJointStart <= anchor.attachmentBodyEnd
      && anchor.attachmentJointStart >= 0 ? 1 : attachmentWeight(anchor.spanEnd, anchor.attachmentBodyStart, anchor.attachmentBodyEnd);
    this.shapeAnchorPosition.lerp(this.shapeAnchorReference, bodyWeight); this.shapeAnchorRotation.slerp(this.identity, bodyWeight);
  }

  attachmentMotionBound(s: StructureSection, radius: number, bound: number, translation: Vector3): number {
    if (s.attachmentBodyStart >= 0 && s.spanEnd >= s.attachmentBodyStart - 0.8 && s.spanStart <= s.attachmentBodyEnd + 0.8)
      bound = Math.max(bound, translation.length());
    if (s.attachmentAnchorId < 0 || s.spanEnd < s.attachmentJointStart - 0.8 || s.spanStart > s.attachmentJointEnd + 0.8) return bound;
    this.setAttachmentAnchorFrame(s);
    const q = this.shapeAnchorRotation, angle = 2 * Math.atan2(Math.hypot(q.x, q.y, q.z), Math.abs(q.w));
    const centerRadius = Math.max(s.referenceRoot.distanceTo(this.shapeAnchorReference), s.referenceTip.distanceTo(this.shapeAnchorReference));
    this.shapeAnchorCenter.copy(this.shapeAnchorPosition).sub(this.shapeAnchorReference).sub(translation);
    return Math.max(bound, this.shapeAnchorCenter.length() + (centerRadius + radius) * angle);
  }

  syncFinGeometry() {
    const d = this.definition, scratch = this.arm;
    for (const s of this.sections) {
      if (s.wingInstance !== 2 || s.bodyId !== 0) continue;
      wingInstancePoint(d, 2, s.side, s.spanStart, 0.25, 0, scratch);
      this.displacement.copy(scratch).sub(s.referenceRoot);
      s.referenceRoot.copy(scratch); s.baseRoot.add(this.displacement); s.root.position.add(this.displacement);
      wingInstancePoint(d, 2, s.side, s.spanEnd, 0.25, 0, scratch);
      this.displacement.copy(scratch).sub(s.referenceTip);
      s.referenceTip.copy(scratch); s.baseTip.add(this.displacement); s.tip.position.add(this.displacement);
      const w = d.verticalTail, p = planform(w, false), half = Math.abs(w.points[1].y);
      const a = p.root + (p.tip - p.root) * s.spanStart / half, b = p.root + (p.tip - p.root) * s.spanEnd / half;
      const span = s.spanStart + (s.spanEnd - s.spanStart) * (a + 2 * b) / (3 * (a + b));
      wingInstancePoint(d, 2, s.side, span, 0.25, 0, s.referencePoint);
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
      s.attachmentFrozen = false; s.attachmentReference.set(0, 0, 0); s.attachmentPosition.set(0, 0, 0); s.attachmentRotation.identity();
      s.moment.set(0, 0, 0); s.load.set(0, 0, 0);
      s.root.position.copy(s.referenceRoot); s.tip.position.copy(s.referenceTip);
      s.baseRoot.copy(s.referenceRoot); s.baseTip.copy(s.referenceTip);
      s.root.quaternion.identity(); s.tip.quaternion.identity(); s.baseRootRotation.identity(); s.baseTipRotation.identity();
      s.surface.point.copy(s.referencePoint); s.surface.normal.copy(s.referenceNormal); s.surface.spanDirection.copy(s.referenceSpan);
      s.surface.chordDirection.copy(s.referenceChord); s.surface.crossflowDirection.copy(s.referenceCrossflow);
      s.surface.controlPoint.copy(s.referenceControlPoint);
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
        if (s.bodyId !== bodyId || s.wingInstance !== first.wingInstance || s.side !== first.side) continue;
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
      if (first.wingInstance !== 1 || this.hasInnerSection(first)) continue;
      const parent = this.parent(first); if (parent?.bodyId !== bodyId) continue;
      this.mountRotation.copy(parent.baseTipRotation).invert().premultiply(parent.tip.quaternion);
      this.mountTarget.copy(first.baseRoot).sub(parent.baseTip).applyQuaternion(this.mountRotation).add(parent.tip.position);
      this.mountOrigin.copy(first.root.position);
      this.mountDelta.copy(first.root.quaternion).invert().premultiply(this.rotation.copy(this.mountRotation).multiply(first.baseRootRotation));
      for (const s of this.sectionsForBody(bodyId)) if (s.wingInstance === first.wingInstance && s.side === first.side) {
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
    const root = s.referenceRoot, tip = s.referenceTip, axis = s.referenceSpan;
    const length = (tip.x - root.x) * axis.x + (tip.y - root.y) * axis.y + (tip.z - root.z) * axis.z;
    const point = s.referencePoint, offset = (point.x - root.x) * axis.x + (point.y - root.y) * axis.y + (point.z - root.z) * axis.z;
    this.deformFrame(s, Math.max(0, Math.min(1, offset / length)), deformationPointMatrix);
    s.surface.point.copy(point).applyMatrix4(deformationPointMatrix);
    s.surface.normal.copy(s.referenceNormal).applyQuaternion(this.shapeRotation);
    s.surface.spanDirection.copy(s.referenceSpan).applyQuaternion(this.shapeRotation);
    s.surface.chordDirection.copy(s.referenceChord).applyQuaternion(this.shapeRotation);
    s.surface.crossflowDirection.copy(s.referenceCrossflow).applyQuaternion(this.shapeRotation);
    const control = s.referenceControlPoint, controlOffset = (control.x - root.x) * axis.x + (control.y - root.y) * axis.y + (control.z - root.z) * axis.z;
    this.deformPoint(s, s.surface.controlPoint.copy(control), Math.max(0, Math.min(1, controlOffset / length)));
  }

  /** Shared skin map for physics, aerodynamics and interpolated rendering. */
  deformFrame(s: StructureSection, t: number, out: Matrix4, geometry?: readonly SectionGeometry[]): void {
    const frame = geometry?.[s.id], root = frame?.root ?? s.root.position, tip = frame?.tip ?? s.tip.position;
    const rootRotation = frame?.rootRotation ?? s.root.quaternion, tipRotation = frame?.tipRotation ?? s.tip.quaternion;
    this.shapeRotation.slerpQuaternions(rootRotation, tipRotation, t);
    this.shapeReference.lerpVectors(s.referenceRoot, s.referenceTip, t);
    this.shapeRootTangent.subVectors(s.referenceTip, s.referenceRoot).applyQuaternion(rootRotation);
    this.shapeTipTangent.subVectors(s.referenceTip, s.referenceRoot).applyQuaternion(tipRotation);
    const t2 = t * t, t3 = t2 * t;
    this.shapeCenter.copy(root).multiplyScalar(2 * t3 - 3 * t2 + 1).addScaledVector(tip, -2 * t3 + 3 * t2)
      .addScaledVector(this.shapeRootTangent, t3 - 2 * t2 + t).addScaledVector(this.shapeTipTangent, t3 - t2);
    const span = s.spanStart + (s.spanEnd - s.spanStart) * t;
    const bodyWeight = attachmentWeight(span, s.attachmentBodyStart, s.attachmentBodyEnd);
    this.shapeRotation.slerp(this.identity, bodyWeight); this.shapeCenter.lerp(this.shapeReference, bodyWeight);
    const jointWeight = attachmentWeight(span, s.attachmentJointStart, s.attachmentJointEnd);
    const denominator = 1 - bodyWeight * jointWeight;
    const jointBlend = denominator > 0 ? jointWeight * (1 - bodyWeight) / denominator : 0;
    if (jointBlend > 0) {
      this.setAttachmentAnchorFrame(s, geometry);
      this.shapeAnchorCenter.copy(this.shapeReference).sub(this.shapeAnchorReference).applyQuaternion(this.shapeAnchorRotation).add(this.shapeAnchorPosition);
      this.shapeRotation.slerp(this.shapeAnchorRotation, jointBlend); this.shapeCenter.lerp(this.shapeAnchorCenter, jointBlend);
    }
    this.shapeTranslation.copy(this.shapeReference).applyQuaternion(this.shapeRotation).negate().add(this.shapeCenter);
    out.compose(this.shapeTranslation, this.shapeRotation, deformationUnitScale);
  }

  deformPoint(s: StructureSection, point: Vector3, t: number, geometry?: readonly SectionGeometry[]) {
    this.deformFrame(s, t, deformationPointMatrix, geometry); point.applyMatrix4(deformationPointMatrix);
  }

  contactGeometryChanged(wingKey: WingKey, side: number, wingInstance: number): boolean {
    for (const s of this.sections) {
      if (s.bodyId !== 0 || !this.branchContains(s, wingKey, side, wingInstance)) continue;
      const before = this.geometryBefore[s.id];
      if (!s.root.position.equals(before.root) || !s.tip.position.equals(before.tip)
        || !s.root.quaternion.equals(before.rootRotation) || !s.tip.quaternion.equals(before.tipRotation)) return true;
    }
    return false;
  }

  /** Restrict a massless elastic shape change at a solid boundary, retaining
   * joint continuity and the full measured stress used for fracture decisions. */
  blendContactGeometry(wingKey: WingKey, side: number, fraction: number, wingInstance?: number) {
    for (const s of this.sections) {
      if (s.bodyId !== 0 || !this.branchContains(s, wingKey, side, wingInstance)) continue;
      const a = this.geometryBefore[s.id], b = this.geometryAfter[s.id];
      s.root.position.copy(a.root).lerp(b.root, fraction); s.tip.position.copy(a.tip).lerp(b.tip, fraction);
      s.root.quaternion.copy(a.rootRotation).slerp(b.rootRotation, fraction);
      s.tip.quaternion.copy(a.tipRotation).slerp(b.tipRotation, fraction);
      this.syncSurface(s);
    }
    // Endpoints are already coherent support-subtree snapshots. Re-mounting a
    // rejected proposal must not change its previously certified zero endpoint.
    if (fraction > 0 && fraction < 1) this.alignTailRoots(0);
  }

  branchContains(s: StructureSection, wingKey: WingKey, side: number, wingInstance?: number) {
    for (let node: StructureSection | undefined = s; node && node.bodyId === s.bodyId; node = this.parent(node)) {
      if (node.wingKey === wingKey && node.side === side && (wingInstance === undefined || node.wingInstance === wingInstance)) return true;
    }
    return false;
  }

  private hasInnerSection(section: StructureSection) {
    for (const inner of this.sections) {
      if (inner.bodyId === section.bodyId && inner.wingInstance === section.wingInstance && inner.side === section.side && inner.spanStart < section.spanStart) return true;
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
    for (const s of this.sections) {
      if (s.attachmentAnchorId < 0 || s.attachmentFrozen || this.sections[s.attachmentAnchorId].bodyId === s.bodyId) continue;
      this.setAttachmentAnchorFrame(s);
      s.attachmentReference.copy(this.shapeAnchorReference); s.attachmentPosition.copy(this.shapeAnchorPosition);
      s.attachmentRotation.copy(this.shapeAnchorRotation); s.attachmentFrozen = true;
    }
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
