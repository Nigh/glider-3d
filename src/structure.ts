import { Matrix3, Quaternion, Vector3 } from 'three';
import { AIRFRAME_MASS, DEG, planform, wingOrigin, type AircraftDefinition, type WingKey } from './model';
import { beamSection, materialCatalog } from './materials';

export interface StructuralSurface {
  point: Vector3; normal: Vector3; spanDirection: Vector3; force: Vector3;
  chordDirection: Vector3; crossflowDirection: Vector3;
  kind: 'main' | 'tail' | 'vertical'; side: number; spanStart: number; spanEnd: number;
  area: number; chord: number; incidence: number; bodyId: number;
}
export interface StructureNode { span: number; position: Vector3; quaternion: Quaternion }
export interface StructureSection {
  id: number; wingKey: WingKey; side: number; spanStart: number; spanEnd: number; bodyId: number;
  /** 实际安装局部舵角rad，已包含场景侧别方向；断片冻结。 */
  controlDeflection: number;
  root: StructureNode; tip: StructureNode; referenceRoot: Vector3; referenceTip: Vector3;
  mass: number; center: Vector3; inertia: Matrix3; stress: number; stressRatio: number; yieldRatio: number;
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
export interface WingFragment extends StructuralBody {
  landed: boolean; force: Vector3; torque: Vector3; drag: Vector3; aeroPower: number;
  midpointVelocity: Vector3; midpointOmega: Vector3; midpointPosition: Vector3; midpointQuaternion: Quaternion;
  candidateVelocity: Vector3; candidateOmega: Vector3;
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
  maxStressRatio = 0; maxYieldRatio = 0; maxDeflection = 0; fractureCount = 0;
  private readonly force = new Vector3();
  private readonly moment = new Vector3();
  private readonly totalLoad = new Vector3();
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

  constructor(readonly definition: AircraftDefinition, surfaces: StructuralSurface[]) {
    this.sections = surfaces.map((surface, id) => {
      const wingKey: WingKey = surface.kind === 'main' ? 'mainWing' : surface.kind === 'tail' ? 'horizontalTail' : 'verticalTail';
      const wing = definition[wingKey], vertical = wingKey === 'verticalTail', p = planform(wing, !vertical);
      const material = materialCatalog[wing.materialId], section = beamSection(wing.structure);
      const origin = wingOrigin(definition, wingKey), incidence = surface.incidence;
      const reference = (span: number) => {
        const fraction = span / wing.points[1].y;
        const quarter = wing.points[0].x + (wing.points[1].x - wing.points[0].x) * fraction + (p.root + (p.tip - p.root) * fraction) / 4;
        return new Vector3(origin.x - quarter * Math.cos(incidence), vertical ? origin.y + span : origin.y - quarter * Math.sin(incidence) + span * Math.tan(wing.dihedral * DEG), vertical ? 0 : surface.side * span);
      };
      const referenceRoot = reference(surface.spanStart), referenceTip = reference(surface.spanEnd);
      const beamAxis = referenceTip.clone().sub(referenceRoot).normalize();
      const chordAxis = new Vector3(Math.cos(incidence), vertical ? 0 : Math.sin(incidence), 0);
      chordAxis.addScaledVector(beamAxis, -chordAxis.dot(beamAxis)).normalize();
      const normalAxis = new Vector3().crossVectors(beamAxis, chordAxis).normalize();
      const length = referenceRoot.distanceTo(referenceTip);
      const skinMass = surface.area * (wingKey === 'mainWing' ? AIRFRAME_MASS.mainArea : AIRFRAME_MASS.tailArea);
      const sparMass = material.density * section.area * length, mass = skinMass + sparMass;
      const center = surface.point.clone().addScaledVector(chordAxis, -surface.chord / 4);
      // 均匀条带质量代理；梁/蒙皮质量真实分段，惯量固定在参考几何，见 update 的准静态说明。
      const inertia = new Matrix3();
      const axes = [chordAxis, normalAxis, beamAxis];
      const variances = [surface.chord ** 2 / 12, wing.structure.height ** 2 / 12, length ** 2 / 12];
      const covariance = new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
      for (let a = 0; a < 3; a++) for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) covariance.elements[col * 3 + row] += mass * variances[a] * axes[a].getComponent(row) * axes[a].getComponent(col);
      const c = covariance.elements, trace = c[0] + c[4] + c[8];
      setInertia(inertia, trace - c[0], trace - c[4], trace - c[8], -c[3], -c[6], -c[7]);
      const innerWidth = wing.structure.width - wing.structure.wallThickness;
      const innerHeight = wing.structure.height - wing.structure.wallThickness;
      // 等效闭口梁截面独立于翼型外壳；恒高梁不保证能装进所有薄翼尖，非可制造性校验。
      return { id, wingKey, side: surface.side, spanStart: surface.spanStart, spanEnd: surface.spanEnd, bodyId: 0,
        root: { span: surface.spanStart, position: referenceRoot.clone(), quaternion: new Quaternion() },
        tip: { span: surface.spanEnd, position: referenceTip.clone(), quaternion: new Quaternion() },
        referenceRoot, referenceTip, mass, center, inertia, stress: 0, stressRatio: 0, yieldRatio: 0,
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
        normalModulus: section.secondMoment / (wing.structure.height / 2),
        lateralModulus: section.lateralSecondMoment / (wing.structure.width / 2),
        sectionArea: section.area,
        torsionModulus: 2 * innerWidth * innerHeight * wing.structure.wallThickness };
    });
  }

  reset() {
    this.maxStressRatio = 0; this.maxYieldRatio = 0; this.maxDeflection = 0; this.fractureCount = 0;
    for (const s of this.sections) {
      s.bodyId = s.surface.bodyId = 0; s.stress = s.stressRatio = s.yieldRatio = s.controlDeflection = 0;
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
  update(body: StructuralBody, totalForce: Vector3, totalTorque: Vector3) {
    this.inverse.copy(body.quaternion).invert();
    this.gravity.set(0, -9.81, 0).applyQuaternion(this.inverse);
    this.acceleration.copy(totalForce).applyQuaternion(this.inverse).multiplyScalar(1 / body.mass).add(this.gravity);
    this.angularAcceleration.copy(body.omega).applyMatrix3(body.inertiaTensor);
    this.cross.crossVectors(body.omega, this.angularAcceleration);
    this.angularAcceleration.copy(totalTorque).sub(this.cross).applyMatrix3(body.inverseInertia);
    for (const s of this.sections) {
      if (s.bodyId !== body.id) continue;
      this.arm.copy(s.center).sub(body.cg);
      this.force.crossVectors(this.angularAcceleration, this.arm);
      this.cross.crossVectors(body.omega, this.arm);
      this.force.add(this.moment.crossVectors(body.omega, this.cross)).add(this.acceleration);
      s.load.copy(s.surface.force).applyQuaternion(this.inverse).addScaledVector(this.gravity, s.mass).addScaledVector(this.force, -s.mass);
      s.moment.set(0, 0, 0);
      this.totalLoad.set(0, 0, 0);
      // 全部外侧段累计；气动力在变形四分之一弦，质量惯性在参考质量中心，各自保留力臂。
      for (const outer of this.sections) {
        if (outer.bodyId !== body.id || outer.wingKey !== s.wingKey || outer.side !== s.side || outer.spanStart < s.spanStart) continue;
        this.arm.copy(outer.center).sub(body.cg);
        this.force.crossVectors(this.angularAcceleration, this.arm);
        this.cross.crossVectors(body.omega, this.arm);
        this.force.add(this.moment.crossVectors(body.omega, this.cross)).add(this.acceleration).sub(this.gravity).multiplyScalar(-outer.mass);
        this.arm.copy(outer.center).sub(s.root.position);
        s.moment.add(this.moment.crossVectors(this.arm, this.force));
        this.totalLoad.add(this.force);
        this.force.copy(this.angularAcceleration).applyMatrix3(outer.inertia);
        this.cross.copy(body.omega).applyMatrix3(outer.inertia);
        this.force.add(this.moment.crossVectors(body.omega, this.cross));
        s.moment.sub(this.force);
        this.force.copy(outer.surface.force).applyQuaternion(this.inverse);
        this.totalLoad.add(this.force);
        this.arm.copy(outer.surface.point).sub(s.root.position);
        s.moment.add(this.moment.crossVectors(this.arm, this.force));
      }
      const bending = Math.abs(s.moment.dot(s.chordAxis)) / s.normalModulus + Math.abs(s.moment.dot(s.normalAxis)) / s.lateralModulus
        + Math.abs(this.totalLoad.dot(s.beamAxis)) / s.sectionArea;
      const shear = Math.abs(s.moment.dot(s.beamAxis)) / s.torsionModulus
        + Math.hypot(this.totalLoad.dot(s.chordAxis), this.totalLoad.dot(s.normalAxis)) / s.sectionArea;
      s.stress = Math.hypot(bending, Math.sqrt(3) * shear);
      s.stressRatio = Math.hypot(bending / s.normalStrength, shear / s.shearStrength);
      s.yieldRatio = s.stress / s.elasticLimit;
    }
    // 按每个连续拥有者从内到外积分，不跨断口。自由片首端保留断裂形状，但不把自由端作为断裂连接。
    for (const first of this.sections) {
      if (first.bodyId !== body.id || this.hasInnerSection(first)) continue;
      this.rotationVector.set(0, 0, 0); this.displacement.set(0, 0, 0);
      for (const s of this.sections) {
        if (s.bodyId !== body.id || s.wingKey !== first.wingKey || s.side !== first.side) continue;
        const length = s.referenceRoot.distanceTo(s.referenceTip);
        s.root.position.copy(s.baseRoot).add(this.displacement);
        this.setRotation(s.root.quaternion, this.rotationVector, s.baseRootRotation);
        this.cross.copy(s.chordAxis).multiplyScalar(s.moment.dot(s.chordAxis) / s.bendingStiffness)
          .addScaledVector(s.normalAxis, s.moment.dot(s.normalAxis) / s.lateralStiffness)
          .addScaledVector(s.beamAxis, s.moment.dot(s.beamAxis) / s.torsionalStiffness);
        // 有限旋转更新避免弱梁产生无穷节点；应力不钳制，超强度仍会在同一接受步断裂。
        this.arm.copy(this.rotationVector).addScaledVector(this.cross, length / 2);
        this.setRotation(this.rotation, this.arm, this.identity);
        this.arm.copy(s.baseTip).sub(s.baseRoot).applyQuaternion(this.rotation);
        this.displacement.add(this.arm).sub(this.arm.copy(s.baseTip).sub(s.baseRoot));
        this.rotationVector.addScaledVector(this.cross, length);
        s.tip.position.copy(s.baseTip).add(this.displacement);
        this.setRotation(s.tip.quaternion, this.rotationVector, s.baseTipRotation);
        this.rotation.copy(s.root.quaternion).slerp(s.tip.quaternion, 0.5);
        this.arm.copy(s.referenceRoot).lerp(s.referenceTip, 0.5);
        s.surface.point.copy(s.referencePoint).sub(this.arm).applyQuaternion(this.rotation);
        s.surface.point.addScaledVector(s.root.position, 0.5).addScaledVector(s.tip.position, 0.5);
        s.surface.normal.copy(s.referenceNormal).applyQuaternion(this.rotation);
        s.surface.spanDirection.copy(s.referenceSpan).applyQuaternion(this.rotation);
        s.surface.chordDirection.copy(s.referenceChord).applyQuaternion(this.rotation);
        s.surface.crossflowDirection.copy(s.referenceCrossflow).applyQuaternion(this.rotation);
      }
    }
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

  /** 返回每条连续链最危险的仍连接边界；自由断片的首端没有连接。 */
  fractureCandidates(bodyId: number) {
    const result = this.candidates;
    result.length = 0;
    for (const s of this.sections) {
      if (s.bodyId !== bodyId || s.stressRatio < 1) continue;
      if (bodyId !== 0 && !this.hasInnerSection(s)) continue;
      const previous = result.findIndex(other => other.wingKey === s.wingKey && other.side === s.side);
      if (previous < 0) result.push(s);
      else if (result[previous].stressRatio < s.stressRatio) result[previous] = s;
    }
    return result;
  }

  detach(boundary: StructureSection, id: number) {
    const previous = boundary.bodyId;
    for (const s of this.sections) if (s.bodyId === previous && s.wingKey === boundary.wingKey && s.side === boundary.side && s.spanStart >= boundary.spanStart) {
      s.bodyId = s.surface.bodyId = id;
      s.baseRoot.copy(s.root.position); s.baseTip.copy(s.tip.position);
      s.baseRootRotation.copy(s.root.quaternion); s.baseTipRotation.copy(s.tip.quaternion);
    }
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
